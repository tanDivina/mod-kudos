/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

/**
 * ModKudos — Devvit app entry point.
 *
 * Registers all triggers, menu actions, scheduled jobs, custom post types,
 * and forms. Wires subsystems together so events flow through the system.
 */

import { Devvit } from '@devvit/public-api';

// Import settings (registers Devvit.addSettings as a side effect)
import './settings.js';

import { getSettings } from './settings.js';
import { RedisStore } from './utils/redis-store.js';
import { UserTracker } from './user-tracker/index.js';
import { RewardEngine } from './reward-engine/index.js';
import {
  onPostCreate,
  onCommentCreate,
  evaluateQuality,
  getPositiveQueue,
  removeFromPositiveQueue,
  QUALITY_CHECK_JOB_NAME,
} from './quality-detector/index.js';
import { buildContextCardData, buildContextCardSummary } from './context-card/index.js';
import {
  runAnalysis,
  getLatestMetrics,
  INSIGHT_ANALYSIS_JOB_NAME,
} from './insight-analyzer/index.js';
import { buildDashboardSummary } from './dashboard/index.js';
import { logError, logInfo } from './utils/logger.js';

import type { QualityCheckJobData, ModAction, ModNote } from './types/index.js';

// ---------------------------------------------------------------------------
// Configure Devvit capabilities
// ---------------------------------------------------------------------------

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// ---------------------------------------------------------------------------
// Helper: create subsystem instances from context
// ---------------------------------------------------------------------------

function createSubsystems(context: { redis: any; reddit: any }) {
  const store = new RedisStore(context.redis);
  const userTracker = new UserTracker(store);
  const rewardEngine = new RewardEngine(store, userTracker, context.reddit);
  return { store, userTracker, rewardEngine };
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

// AppInstall trigger — schedule the recurring insight analysis job
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event: any, context: any) => {
    try {
      const settings = await getSettings(context);
      const intervalHours = settings.analysisIntervalHours;

      // Build a cron expression for the configured interval
      // Clamp to valid range 1–168 hours
      const hours = Math.max(1, Math.min(168, Math.round(intervalHours)));
      // Run every N hours at minute 0
      const cron = `0 */${hours} * * *`;

      await context.scheduler.runJob({
        name: INSIGHT_ANALYSIS_JOB_NAME,
        cron,
      });

      logInfo({
        subsystem: 'InsightAnalyzer',
        operation: `Scheduled insight analysis cron: ${cron}`,
      });
    } catch (error) {
      logError({
        subsystem: 'InsightAnalyzer',
        operation: 'AppInstall — schedule insight analysis',
        error: error instanceof Error ? error : String(error),
      });
    }
  },
});

// PostCreate trigger — records event via UserTracker and schedules quality check
Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: async (event: any, context: any) => {
    try {
      const { store, userTracker } = createSubsystems(context);
      const post = event.post;
      if (!post || !event.author?.name) return;

      await onPostCreate(
        {
          post: { id: post.id, subredditId: post.subredditId },
          author: { name: event.author.name },
        },
        { scheduler: context.scheduler as any, reddit: context.reddit as any },
        store,
        userTracker,
      );
    } catch (error) {
      logError({
        subsystem: 'QualityDetector',
        operation: 'PostCreate trigger',
        error: error instanceof Error ? error : String(error),
      });
    }
  },
});

// CommentCreate trigger — records event via UserTracker and schedules quality check
Devvit.addTrigger({
  event: 'CommentCreate',
  onEvent: async (event: any, context: any) => {
    try {
      const { store, userTracker } = createSubsystems(context);
      const comment = event.comment;
      if (!comment || !event.author?.name) return;

      await onCommentCreate(
        {
          comment: { id: comment.id, subredditId: comment.subredditId },
          author: { name: event.author.name },
        },
        { scheduler: context.scheduler as any, reddit: context.reddit as any },
        store,
        userTracker,
      );
    } catch (error) {
      logError({
        subsystem: 'QualityDetector',
        operation: 'CommentCreate trigger',
        error: error instanceof Error ? error : String(error),
      });
    }
  },
});

// ModAction trigger — records removals via UserTracker
Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event: any, context: any) => {
    try {
      const action = event.action;
      if (!action) return;

      // Only track post/comment removals
      const actionType = action.actionType;
      if (actionType !== 'removelink' && actionType !== 'removecomment') return;

      const { userTracker } = createSubsystems(context);
      const targetUser = action.targetUser?.name;
      const moderator = action.moderator?.name;
      if (!targetUser || !moderator) return;

      const modAction: ModAction = {
        schemaVersion: 1,
        actionId: `act-${action.id ?? Date.now()}`,
        actionType: 'removal',
        targetUsername: targetUser,
        moderatorUsername: moderator,
        contentId: action.targetPost?.id ?? action.targetComment?.id ?? 'unknown',
        timestamp: Date.now(),
        reason: action.description ?? 'Content removed',
        metadata: {},
      };

      await userTracker.recordModAction(modAction);
    } catch (error) {
      logError({
        subsystem: 'UserTracker',
        operation: 'ModAction trigger',
        error: error instanceof Error ? error : String(error),
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Scheduled Jobs
// ---------------------------------------------------------------------------

// Quality check job — evaluates content quality after delay
Devvit.addSchedulerJob({
  name: QUALITY_CHECK_JOB_NAME,
  onRun: async (event: any, context: any) => {
    try {
      const jobData = event.data as QualityCheckJobData;
      if (!jobData?.contentId) return;

      const { store, userTracker, rewardEngine } = createSubsystems(context);
      const settings = await getSettings(context);

      const isHighQuality = await evaluateQuality(
        { scheduler: context.scheduler as any, reddit: context.reddit as any },
        jobData,
        settings.thresholds,
        userTracker,
        store,
      );

      if (isHighQuality) {
        const subreddit = await context.reddit.getCurrentSubreddit();
        await rewardEngine.applyRewards(
          jobData.authorUsername,
          jobData.contentId,
          jobData.contentType,
          subreddit.name,
          settings.rewards,
        );
      }
    } catch (error) {
      logError({
        subsystem: 'QualityDetector',
        operation: 'Quality check job',
        error: error instanceof Error ? error : String(error),
      });
    }
  },
});

// Insight analysis job — computes community metrics on cron schedule
Devvit.addSchedulerJob({
  name: INSIGHT_ANALYSIS_JOB_NAME,
  onRun: async (_event: any, context: any) => {
    try {
      const { store, userTracker } = createSubsystems(context);
      const settings = await getSettings(context);

      const periodEnd = Date.now();
      const periodStart = periodEnd - settings.analysisIntervalHours * 60 * 60 * 1000;

      await runAnalysis(store, userTracker, periodStart, periodEnd);

      logInfo({
        subsystem: 'InsightAnalyzer',
        operation: 'Scheduled analysis completed',
      });
    } catch (error) {
      logError({
        subsystem: 'InsightAnalyzer',
        operation: 'Insight analysis job',
        error: error instanceof Error ? error : String(error),
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

// Dynamic form for "View User Context" — shows full context card data via description
const viewContextForm = Devvit.createForm(
  (data: { [key: string]: any }) => ({
    title: `u/${data.username as string}`,
    description: data.summary as string,
    fields: [],
    acceptLabel: 'Close',
    cancelLabel: '',
  }),
  // No-op submit — this form is read-only
  (_event: any, _context: any) => {},
);

// Dynamic form for "Add Mod Note" — carries target username in form data
const addModNoteForm = Devvit.createForm(
  (data: { [key: string]: any }) => ({
    title: `Add Mod Note for u/${data.username as string}`,
    fields: [
      {
        name: 'targetUsername',
        label: 'User',
        type: 'string' as const,
        defaultValue: data.username as string,
        disabled: true,
      },
      {
        name: 'noteText',
        label: 'Note',
        type: 'paragraph' as const,
        helpText: 'This note is private and only visible to moderators.',
      },
    ],
    acceptLabel: 'Save Note',
    cancelLabel: 'Cancel',
  }),
  async (event: any, context: any) => {
    try {
      const noteText = (event.values.noteText as string | undefined)?.trim();
      const targetUsername = (event.values.targetUsername as string | undefined)?.trim() ?? 'unknown';

      if (!noteText) {
        context.ui.showToast('Note text is required.');
        return;
      }

      const { userTracker } = createSubsystems(context);
      const currentUser = await context.reddit.getCurrentUser();

      const note: ModNote = {
        noteId: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        targetUsername,
        moderatorUsername: currentUser?.username ?? 'unknown',
        text: noteText,
        timestamp: Date.now(),
      };

      await userTracker.addModNote(note);
      context.ui.showToast(`Note saved for u/${targetUsername}.`);
    } catch (error) {
      logError({
        subsystem: 'ContextCard',
        operation: 'Add mod note',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to add mod note.');
    }
  },
);

// Dynamic form for "Open Positive Queue" — shows high-quality content pending mod review
const positiveQueueForm = Devvit.createForm(
  (data: { [key: string]: any }) => ({
    title: '⭐ Positive Queue',
    description: data.summary as string,
    fields: [],
    acceptLabel: 'Close',
    cancelLabel: '',
  }),
  (_event: any, _context: any) => {},
);

// ---------------------------------------------------------------------------
// Menu Actions
// ---------------------------------------------------------------------------

// "View User Context" — opens a form showing the full context card
Devvit.addMenuItem({
  label: 'View User Context',
  location: ['post', 'comment'],
  onPress: async (event: any, context: any) => {
    try {
      const { userTracker } = createSubsystems(context);

      let authorUsername: string | undefined;

      if (event.targetId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(event.targetId);
        authorUsername = post.authorName;
      } else if (event.targetId.startsWith('t1_')) {
        const comment = await context.reddit.getCommentById(event.targetId);
        authorUsername = comment.authorName;
      }

      if (!authorUsername) {
        context.ui.showToast('Could not determine the author.');
        return;
      }

      const data = await buildContextCardData(userTracker, authorUsername);
      const summary = buildContextCardSummary(data);

      context.ui.showForm(viewContextForm, { summary, username: authorUsername });
    } catch (error) {
      logError({
        subsystem: 'ContextCard',
        operation: 'View User Context',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to load user context.');
    }
  },
});

// "Reward User" menu action
Devvit.addMenuItem({
  label: 'Reward User',
  location: ['post', 'comment'],
  onPress: async (event: any, context: any) => {
    try {
      const { rewardEngine } = createSubsystems(context);
      const settings = await getSettings(context);
      const currentUser = await context.reddit.getCurrentUser();

      let authorUsername: string | undefined;
      let contentType: 'post' | 'comment' = 'post';

      if (event.targetId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(event.targetId);
        authorUsername = post.authorName;
        contentType = 'post';
      } else if (event.targetId.startsWith('t1_')) {
        const comment = await context.reddit.getCommentById(event.targetId);
        authorUsername = comment.authorName;
        contentType = 'comment';
      }

      if (!authorUsername) {
        context.ui.showToast('Could not determine the author.');
        return;
      }

      const subreddit = await context.reddit.getCurrentSubreddit();
      const result = await rewardEngine.applyManualReward(
        authorUsername,
        event.targetId,
        contentType,
        subreddit.name,
        settings.rewards,
        currentUser?.username ?? 'unknown',
      );

      // Remove from positive queue if it was there
      const { store } = createSubsystems(context);
      await removeFromPositiveQueue(store, event.targetId);

      const applied = result.results.filter((r: any) => r.success && !r.skipped).length;
      const skipped = result.results.filter((r: any) => r.skipped).length;
      const failed = result.results.filter((r: any) => !r.success && !r.skipped).length;

      if (applied > 0) {
        context.ui.showToast(`Rewarded u/${authorUsername}: ${applied} reward(s) applied.`);
      } else if (skipped > 0) {
        context.ui.showToast(`u/${authorUsername} has already been rewarded for this content.`);
      } else if (failed > 0) {
        context.ui.showToast(`Reward failed for u/${authorUsername}. Check that flair is enabled in subreddit settings.`);
      } else {
        context.ui.showToast('No rewards are enabled. Go to Mod Tools → Apps → ModKudos → Settings to configure.');
      }
    } catch (error) {
      logError({
        subsystem: 'RewardEngine',
        operation: 'Reward User menu action',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to reward user.');
    }
  },
});

// "Add Mod Note" — opens a form with the target username pre-filled
Devvit.addMenuItem({
  label: 'Add Mod Note',
  location: ['post', 'comment'],
  onPress: async (event: any, context: any) => {
    try {
      let authorUsername: string | undefined;

      if (event.targetId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(event.targetId);
        authorUsername = post.authorName;
      } else if (event.targetId.startsWith('t1_')) {
        const comment = await context.reddit.getCommentById(event.targetId);
        authorUsername = comment.authorName;
      }

      if (!authorUsername) {
        context.ui.showToast('Could not determine the author.');
        return;
      }

      context.ui.showForm(addModNoteForm, { username: authorUsername });
    } catch (error) {
      logError({
        subsystem: 'ContextCard',
        operation: 'Add Mod Note menu action',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to open mod note form.');
    }
  },
});

// "Open Positive Queue" — shows high-quality content detected and awaiting mod recognition
Devvit.addMenuItem({
  label: 'Open Positive Queue',
  location: ['subreddit'],
  onPress: async (_event: any, context: any) => {
    try {
      const { store } = createSubsystems(context);
      const items = await getPositiveQueue(store, 20);

      if (items.length === 0) {
        context.ui.showToast('Positive Queue is empty — no high-quality content detected yet.');
        return;
      }

      const lines: string[] = [];
      lines.push(`${items.length} item(s) detected as high-quality and awaiting recognition:\n`);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const date = new Date(item.detectedAt).toISOString().split('T')[0];
        const type = item.contentType === 'post' ? '📝' : '💬';
        lines.push(`${i + 1}. ${type} u/${item.authorUsername} — ${item.contentType} ${item.contentId} (${date})`);
      }

      lines.push('\nUse "Reward User" on any of these to recognise the contributor and clear it from the queue.');

      context.ui.showForm(positiveQueueForm, { summary: lines.join('\n') });
    } catch (error) {
      logError({
        subsystem: 'PositiveQueue',
        operation: 'Open Positive Queue',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to load positive queue.');
    }
  },
});

// "Create Dashboard" — creates a new community health post
Devvit.addMenuItem({
  label: 'Create Dashboard',
  location: ['subreddit'],
  onPress: async (_event: any, context: any) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const { store, userTracker } = createSubsystems(context);

      // Run a fresh analysis before creating the dashboard
      const periodEnd = Date.now();
      const settings = await getSettings(context);
      const periodStart = periodEnd - settings.analysisIntervalHours * 60 * 60 * 1000;
      await runAnalysis(store, userTracker, periodStart, periodEnd);

      const metrics = await getLatestMetrics(store);
      const summary = buildDashboardSummary(metrics);

      await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: `ModKudos Community Dashboard — ${new Date().toISOString().split('T')[0]}`,
        text: summary,
      });

      context.ui.showToast('Dashboard post created with latest metrics.');
    } catch (error) {
      logError({
        subsystem: 'Dashboard',
        operation: 'Create Dashboard',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to create dashboard post.');
    }
  },
});

// "Refresh Dashboard" — edits the existing post with fresh metrics
Devvit.addMenuItem({
  label: 'Refresh Dashboard',
  location: ['post'],
  postFilter: 'currentApp',
  onPress: async (event: any, context: any) => {
    try {
      const { store, userTracker } = createSubsystems(context);

      // Run a fresh analysis
      const periodEnd = Date.now();
      const settings = await getSettings(context);
      const periodStart = periodEnd - settings.analysisIntervalHours * 60 * 60 * 1000;
      await runAnalysis(store, userTracker, periodStart, periodEnd);

      const metrics = await getLatestMetrics(store);
      const summary = buildDashboardSummary(metrics);

      // Edit the post in place
      const post = await context.reddit.getPostById(event.targetId);
      await post.edit({ text: summary });

      context.ui.showToast('Dashboard updated with latest metrics.');
    } catch (error) {
      logError({
        subsystem: 'Dashboard',
        operation: 'Refresh Dashboard',
        error: error instanceof Error ? error : String(error),
      });
      context.ui.showToast('Failed to refresh dashboard.');
    }
  },
});

// ---------------------------------------------------------------------------
// Custom Post Type — live dashboard rendered with Blocks
// ---------------------------------------------------------------------------

Devvit.addCustomPostType({
  name: 'ModKudos Dashboard',
  render: (context) => {
    const [metrics, setMetrics] = context.useState<string>(async () => {
      const { store, userTracker } = createSubsystems(context);
      const periodEnd = Date.now();
      const settings = await getSettings(context);
      const periodStart = periodEnd - settings.analysisIntervalHours * 60 * 60 * 1000;
      await runAnalysis(store, userTracker, periodStart, periodEnd);
      const m = await getLatestMetrics(store);
      return buildDashboardSummary(m);
    });

    return (
      <vstack padding="medium" gap="small" grow>
        <text size="xlarge" weight="bold">ModKudos Dashboard</text>
        <text size="small" color="neutral-content-weak">
          {new Date().toISOString().split('T')[0]}
        </text>
        <spacer size="xsmall" />
        <text size="small" wrap>{metrics}</text>
      </vstack>
    );
  },
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default Devvit;
