/**
 * Reward_Engine subsystem for ModKudos.
 *
 * Applies rewards (flair, private messages, recognition posts) to users
 * who make high-quality contributions. Supports both automatic invocation
 * from the Quality_Detector and manual invocation via moderator menu actions.
 *
 * All rewards are idempotent: the same reward type for the same user and
 * content will only be applied once, tracked via Redis idempotency keys
 * with a 30-day TTL.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import type {
  ContributionEvent,
  RewardConfig,
  RewardType,
} from '../types/index.js';
import type { RedisStore } from '../utils/redis-store.js';
import type { UserTracker } from '../user-tracker/index.js';
import { rewardIdempotencyKey } from '../utils/redis-keys.js';

// ---------------------------------------------------------------------------
// Praise macro pool (randomized to reduce repetition)
// ---------------------------------------------------------------------------

const PRAISE_MACROS = [
  'Thanks for your quality contribution, {{username}}! Your post/comment has been recognized: {{link}}',
  'Great work, {{username}}! This is exactly the kind of content that makes this community great: {{link}}',
  'Your contribution stood out, {{username}} — the mod team wanted to say thanks: {{link}}',
  'High-quality content spotted! Well done {{username}}, keep it up: {{link}}',
  'The mod team recognized your contribution as exceptional, {{username}}: {{link}}',
];

function getRandomPraiseTemplate(): string {
  return PRAISE_MACROS[Math.floor(Math.random() * PRAISE_MACROS.length)];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TTL in seconds for reward idempotency keys (30 days). */
const REWARD_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 3600; // 2592000

/** All reward types in the order they are applied. */
const ALL_REWARD_TYPES: RewardType[] = [
  'flair',
  'thank_you_message',
  'recognition_post',
];

// ---------------------------------------------------------------------------
// Minimal Reddit API interfaces (for testability)
// ---------------------------------------------------------------------------

/** Minimal interface for setting user flair. */
export interface FlairApi {
  setUserFlair(
    subredditName: string,
    username: string,
    text: string,
    cssClass: string,
  ): Promise<void>;
}

/** Minimal interface for sending private messages. */
export interface MessageApi {
  sendPrivateMessage(options: {
    to: string;
    subject: string;
    text: string;
  }): Promise<void>;
}

/** Minimal interface for submitting posts. */
export interface PostApi {
  submitPost(options: {
    subredditName: string;
    title: string;
    text: string;
  }): Promise<void>;
}

/** Combined Reddit API interface used by the RewardEngine. */
export interface RedditRewardApi extends FlairApi, MessageApi, PostApi {}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result of applying a single reward. */
export interface RewardResult {
  rewardType: RewardType;
  success: boolean;
  skipped: boolean;
  error?: string;
}

/** Result of applying all rewards for a contribution. */
export interface ApplyRewardsResult {
  username: string;
  contentId: string;
  results: RewardResult[];
}

// ---------------------------------------------------------------------------
// RewardEngine
// ---------------------------------------------------------------------------

export class RewardEngine {
  private readonly store: RedisStore;
  private readonly userTracker: UserTracker;
  private readonly reddit: RedditRewardApi;

  constructor(store: RedisStore, userTracker: UserTracker, reddit: RedditRewardApi) {
    this.store = store;
    this.userTracker = userTracker;
    this.reddit = reddit;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Apply configured rewards to a user for a high-quality contribution.
   *
   * For each enabled reward type:
   *   1. Check idempotency (skip if already applied)
   *   2. Apply the reward (flair / message / recognition post)
   *   3. Set the idempotency key with 30-day TTL
   *   4. Record a `reward_granted` ContributionEvent via UserTracker
   *
   * Permission errors are caught, logged, and included in the result.
   */
  async applyRewards(
    username: string,
    contentId: string,
    contentType: 'post' | 'comment',
    subredditName: string,
    config: RewardConfig,
  ): Promise<ApplyRewardsResult> {
    const results: RewardResult[] = [];

    for (const rewardType of ALL_REWARD_TYPES) {
      if (!this.isRewardEnabled(rewardType, config)) {
        continue;
      }

      const result = await this.applySingleReward(
        username,
        contentId,
        contentType,
        subredditName,
        rewardType,
        config,
      );
      results.push(result);
    }

    return { username, contentId, results };
  }

  /**
   * Apply rewards manually, triggered by a moderator menu action.
   *
   * Behaves identically to `applyRewards` but is intended for manual
   * invocation from the "Reward User" menu action.
   */
  async applyManualReward(
    username: string,
    contentId: string,
    contentType: 'post' | 'comment',
    subredditName: string,
    config: RewardConfig,
    moderator: string,
  ): Promise<ApplyRewardsResult> {
    const results: RewardResult[] = [];

    for (const rewardType of ALL_REWARD_TYPES) {
      if (!this.isRewardEnabled(rewardType, config)) {
        continue;
      }

      const result = await this.applySingleReward(
        username,
        contentId,
        contentType,
        subredditName,
        rewardType,
        config,
        moderator,
      );
      results.push(result);
    }

    return { username, contentId, results };
  }

  /**
   * Check whether a reward has already been applied for a given
   * (username, contentId, rewardType) tuple.
   */
  async hasRewardBeenApplied(
    username: string,
    contentId: string,
    rewardType: RewardType,
  ): Promise<boolean> {
    const key = rewardIdempotencyKey(username, contentId, rewardType);
    const value = await this.store.getString(key);
    return value !== undefined;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether a specific reward type is enabled in the config.
   */
  private isRewardEnabled(rewardType: RewardType, config: RewardConfig): boolean {
    switch (rewardType) {
      case 'flair':
        return config.flairEnabled;
      case 'thank_you_message':
        return config.thankYouEnabled;
      case 'recognition_post':
        return config.recognitionPostEnabled;
      default:
        return false;
    }
  }

  /**
   * Apply a single reward type with idempotency checking.
   */
  private async applySingleReward(
    username: string,
    contentId: string,
    contentType: 'post' | 'comment',
    subredditName: string,
    rewardType: RewardType,
    config: RewardConfig,
    moderator?: string,
  ): Promise<RewardResult> {
    // 1. Check idempotency
    const alreadyApplied = await this.hasRewardBeenApplied(
      username,
      contentId,
      rewardType,
    );

    if (alreadyApplied) {
      return { rewardType, success: true, skipped: true };
    }

    // 2. Apply the reward
    try {
      await this.executeReward(
        username,
        contentId,
        contentType,
        subredditName,
        rewardType,
        config,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error('[RewardEngine] Failed to apply reward', {
        username,
        contentId,
        rewardType,
        error: errorMessage,
      });

      // Notify moderator of permission errors
      await this.notifyPermissionError(
        username,
        contentId,
        rewardType,
        errorMessage,
        moderator,
      );

      return { rewardType, success: false, skipped: false, error: errorMessage };
    }

    // 3. Set idempotency key with 30-day TTL
    const key = rewardIdempotencyKey(username, contentId, rewardType);
    await this.store.setWithExpiry(key, '1', REWARD_IDEMPOTENCY_TTL_SECONDS);

    // 4. Record a reward_granted ContributionEvent via UserTracker
    const rewardEvent: ContributionEvent = {
      schemaVersion: 1,
      eventId: `evt-reward-${contentId}-${rewardType}-${Date.now()}`,
      eventType: 'reward_granted',
      username,
      contentId,
      timestamp: Date.now(),
      metadata: {
        rewardType,
        contentType,
        subredditName,
        ...(moderator ? { grantedBy: moderator } : {}),
      },
    };

    await this.userTracker.recordContributionEvent(rewardEvent);

    return { rewardType, success: true, skipped: false };
  }

  /**
   * Execute the actual reward action via the Reddit API.
   */
  private async executeReward(
    username: string,
    contentId: string,
    contentType: 'post' | 'comment',
    subredditName: string,
    rewardType: RewardType,
    config: RewardConfig,
  ): Promise<void> {
    const link = this.buildContentLink(subredditName, contentId, contentType);

    switch (rewardType) {
      case 'flair':
        await this.reddit.setUserFlair(
          subredditName,
          username,
          config.flairText,
          config.flairCssClass,
        );
        break;

      case 'thank_you_message': {
        // Use a random praise macro unless the mod has customized the template
        const isDefaultTemplate = config.thankYouTemplate.includes('{{username}}') &&
          config.thankYouTemplate.includes('{{link}}') &&
          config.thankYouTemplate === 'Thanks for your quality contribution, {{username}}! Your post/comment has been recognized: {{link}}';
        const template = isDefaultTemplate ? getRandomPraiseTemplate() : config.thankYouTemplate;
        const messageText = this.replacePlaceholders(template, username, link);
        await this.reddit.sendPrivateMessage({
          to: username,
          subject: 'Thank you for your quality contribution!',
          text: messageText,
        });
        break;
      }

      case 'recognition_post': {
        const title = this.replacePlaceholders(
          config.recognitionPostTitleTemplate,
          username,
          link,
        );
        const body = `Congratulations to u/${username} for their quality contribution!\n\n${link}`;
        await this.reddit.submitPost({
          subredditName,
          title,
          text: body,
        });
        break;
      }
    }
  }

  /**
   * Replace `{{username}}` and `{{link}}` placeholders in a template string.
   */
  private replacePlaceholders(
    template: string,
    username: string,
    link: string,
  ): string {
    return template
      .replace(/\{\{username\}\}/g, username)
      .replace(/\{\{link\}\}/g, link);
  }

  /**
   * Build a Reddit content link from subreddit name, content ID, and type.
   */
  private buildContentLink(
    subredditName: string,
    contentId: string,
    contentType: 'post' | 'comment',
  ): string {
    // Strip Reddit type prefix (t3_, t1_) for the URL
    const cleanId = contentId.replace(/^t[0-9]_/, '');
    if (contentType === 'post') {
      return `https://www.reddit.com/r/${subredditName}/comments/${cleanId}`;
    }
    return `https://www.reddit.com/r/${subredditName}/comments/?comment=${cleanId}`;
  }

  /**
   * Log a permission error. In a real Devvit app this would notify the
   * moderator via a toast or message; here we log it for observability.
   */
  private async notifyPermissionError(
    username: string,
    contentId: string,
    rewardType: RewardType,
    errorMessage: string,
    _moderator?: string,
  ): Promise<void> {
    console.error('[RewardEngine] Permission/failure notification', {
      username,
      contentId,
      rewardType,
      error: errorMessage,
      moderator: _moderator ?? 'system',
    });
  }
}
