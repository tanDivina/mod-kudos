/**
 * Context_Card subsystem for ModKudos.
 *
 * Provides a quality label mapping, data builder for the context card,
 * and a Devvit form-based rendering for displaying user context to moderators.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import type {
  QualityLabel,
  QualityScore,
  ContributionEvent,
  ModAction,
  ModNote,
  ContextCardData,
} from '../types/index.js';
import type { UserTracker } from '../user-tracker/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of recent activity items to display. */
const RECENT_ACTIVITY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Quality label mapping (Task 9.1)
// ---------------------------------------------------------------------------

/**
 * Map a numeric quality score (0–100) to a human-readable label.
 *
 * | Score Range | Label     |
 * |-------------|-----------|
 * | 0–24        | Poor      |
 * | 25–49       | Fair      |
 * | 50–74       | Good      |
 * | 75–100      | Excellent |
 */
export function getQualityLabel(score: number): QualityLabel {
  if (score <= 24) return 'Poor';
  if (score <= 49) return 'Fair';
  if (score <= 74) return 'Good';
  return 'Excellent';
}

// ---------------------------------------------------------------------------
// Context card data builder (Task 9.1)
// ---------------------------------------------------------------------------

/**
 * Build the full context card data for a user.
 *
 * Fetches the user's quality score, computes stats from their event and
 * action history, retrieves the 10 most recent activities (events + actions
 * merged in reverse chronological order), and all mod notes.
 *
 * Handles empty history gracefully: returns zero counts and empty arrays.
 */
export async function buildContextCardData(
  userTracker: UserTracker,
  username: string,
): Promise<ContextCardData> {
  // Fetch quality score
  const qualityScore: QualityScore = await userTracker.getQualityScore(username);
  const qualityLabel = getQualityLabel(qualityScore.score);

  // Fetch all events and actions for stats computation
  // Use a large limit to get all events for counting
  const allEvents = await userTracker.getUserEvents(username, 10000);
  const allActions = await userTracker.getUserModActions(username, 10000);
  const modNotes = await userTracker.getUserModNotes(username);

  // Compute stats
  let totalPosts = 0;
  let totalComments = 0;
  let totalRewards = 0;

  for (const event of allEvents) {
    switch (event.eventType) {
      case 'post_created':
        totalPosts++;
        break;
      case 'comment_created':
        totalComments++;
        break;
      case 'reward_granted':
        totalRewards++;
        break;
    }
  }

  let totalRemovals = 0;
  let totalWarnings = 0;

  for (const action of allActions) {
    switch (action.actionType) {
      case 'removal':
        totalRemovals++;
        break;
      case 'warning':
        totalWarnings++;
        break;
    }
  }

  // Merge events and actions, sort by timestamp descending, take top 10
  const allActivity: (ContributionEvent | ModAction)[] = [
    ...allEvents,
    ...allActions,
  ];

  allActivity.sort((a, b) => {
    const tsA = a.timestamp;
    const tsB = b.timestamp;
    return tsB - tsA;
  });

  const recentActivity = allActivity.slice(0, RECENT_ACTIVITY_LIMIT);

  return {
    username,
    qualityScore,
    qualityLabel,
    stats: {
      totalPosts,
      totalComments,
      totalRemovals,
      totalWarnings,
      totalRewards,
    },
    recentActivity,
    modNotes,
  };
}

// ---------------------------------------------------------------------------
// Context_Card Devvit form rendering (Task 9.2)
// ---------------------------------------------------------------------------

/**
 * Format a ContributionEvent or ModAction into a human-readable string
 * for display in the context card.
 */
export function formatActivityItem(item: ContributionEvent | ModAction): string {
  const date = new Date(item.timestamp).toISOString().split('T')[0];

  if ('eventType' in item) {
    const event = item as ContributionEvent;
    switch (event.eventType) {
      case 'post_created':     return `${date} · 📝 Post created`;
      case 'comment_created':  return `${date} · 💬 Comment created`;
      case 'post_quality':     return `${date} · ⭐ High-quality post`;
      case 'comment_quality':  return `${date} · ⭐ High-quality comment`;
      case 'reward_granted':   return `${date} · 🏆 Reward granted`;
      default:                 return `${date} · Event`;
    }
  } else {
    const action = item as ModAction;
    switch (action.actionType) {
      case 'removal':  return `${date} · 🚫 Removed by ${action.moderatorUsername}`;
      case 'warning':  return `${date} · ⚠️ Warning: ${action.reason}`;
      case 'ban':      return `${date} · 🔨 Banned by ${action.moderatorUsername}`;
      case 'note':     return `${date} · 📌 Note by ${action.moderatorUsername}`;
      case 'reward':   return `${date} · 🏆 Rewarded by ${action.moderatorUsername}`;
      default:         return `${date} · Action`;
    }
  }
}

/**
 * Format a ModNote into a human-readable string for display.
 */
export function formatModNote(note: ModNote): string {
  const date = new Date(note.timestamp).toISOString().split('T')[0];
  return `[${date}] ${note.moderatorUsername}: ${note.text}`;
}

/**
 * Build a text summary of the context card data for display in a Devvit form.
 */
export function buildContextCardSummary(data: ContextCardData): string {
  const lines: string[] = [];

  // Score badge
  const scoreEmoji =
    data.qualityLabel === 'Excellent' ? '🌟' :
    data.qualityLabel === 'Good'      ? '✅' :
    data.qualityLabel === 'Fair'      ? '🔶' : '🔴';

  lines.push(`${scoreEmoji} Quality Score: ${data.qualityScore.score}/100 — ${data.qualityLabel}`);
  lines.push('');

  // Stats row
  lines.push('📊 Activity');
  lines.push(`  📝 Posts: ${data.stats.totalPosts}   💬 Comments: ${data.stats.totalComments}   🏆 Rewards: ${data.stats.totalRewards}`);
  lines.push(`  🚫 Removals: ${data.stats.totalRemovals}   ⚠️ Warnings: ${data.stats.totalWarnings}`);
  lines.push('');

  // Recent Activity
  lines.push('🕐 Recent Activity');
  if (data.recentActivity.length === 0) {
    lines.push('  No recorded history.');
  } else {
    for (const item of data.recentActivity) {
      lines.push(`  ${formatActivityItem(item)}`);
    }
  }
  lines.push('');

  // Mod Notes
  lines.push('📌 Mod Notes');
  if (data.modNotes.length === 0) {
    lines.push('  No mod notes.');
  } else {
    for (const note of data.modNotes) {
      lines.push(`  ${formatModNote(note)}`);
    }
  }

  return lines.join('\n');
}
