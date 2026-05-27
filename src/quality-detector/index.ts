/**
 * Quality_Detector subsystem for ModKudos.
 *
 * Evaluates posts and comments against configurable quality thresholds.
 * Uses a delayed evaluation pattern: on content creation, records the event
 * via User_Tracker and schedules a quality check job after a delay to allow
 * votes to accumulate.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2
 */

import type {
  ContributionEvent,
  QualityCheckJobData,
  QualityThresholds,
} from '../types/index.js';
import type { UserTracker } from '../user-tracker/index.js';
import type { RedisStore } from '../utils/redis-store.js';
import { qualityCheckKey } from '../utils/redis-keys.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Delay in milliseconds before evaluating content quality (5 minutes). */
const QUALITY_CHECK_DELAY_MS = 5 * 60 * 1000;

/** Maximum retry attempts for Reddit API calls during evaluation. */
const MAX_EVAL_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff (1s, 2s, 4s). */
const BASE_BACKOFF_MS = 1000;

/** TTL in seconds for the duplicate-scheduling prevention flag (1 hour). */
const QUALITY_CHECK_FLAG_TTL_SECONDS = 3600;

/** Name of the scheduled job for quality checks. */
export const QUALITY_CHECK_JOB_NAME = 'modkudos:quality-check';

// ---------------------------------------------------------------------------
// Types for Devvit context (minimal interfaces for testability)
// ---------------------------------------------------------------------------

/** Minimal scheduler interface matching Devvit's context.scheduler. */
export interface Scheduler {
  runJob(options: {
    name: string;
    data: Record<string, unknown>;
    runAt: Date;
  }): Promise<unknown>;
}

/** Minimal Reddit API interface for fetching post/comment data. */
export interface RedditApi {
  getPostById(postId: string): Promise<{ score: number; upvoteRatio: number }>;
  getCommentById(commentId: string): Promise<{ score: number }>;
}

/** Minimal context interface for Quality_Detector functions. */
export interface QualityDetectorContext {
  scheduler: Scheduler;
  reddit: RedditApi;
}

// ---------------------------------------------------------------------------
// Trigger handlers (Task 6.1)
// ---------------------------------------------------------------------------

/**
 * Handle a new post creation event.
 *
 * Records the post creation as a ContributionEvent via User_Tracker,
 * then schedules a delayed quality check job (if not already scheduled).
 */
export async function onPostCreate(
  event: {
    post: {
      id: string;
      authorId?: string;
      subredditId: string;
    };
    author: {
      name: string;
    };
  },
  context: QualityDetectorContext,
  store: RedisStore,
  userTracker: UserTracker,
): Promise<void> {
  const { post, author } = event;
  const now = Date.now();

  // Record the post creation event via User_Tracker
  const contributionEvent: ContributionEvent = {
    schemaVersion: 1,
    eventId: `evt-post-${post.id}-${now}`,
    eventType: 'post_created',
    username: author.name,
    contentId: post.id,
    timestamp: now,
    metadata: { subredditId: post.subredditId },
  };

  await userTracker.recordContributionEvent(contributionEvent);

  // Schedule a delayed quality check (with duplicate prevention)
  await scheduleQualityCheck(
    context,
    store,
    {
      contentId: post.id,
      contentType: 'post',
      authorUsername: author.name,
      subredditId: post.subredditId,
      createdAt: now,
    },
  );
}

/**
 * Handle a new comment creation event.
 *
 * Records the comment creation as a ContributionEvent via User_Tracker,
 * then schedules a delayed quality check job (if not already scheduled).
 */
export async function onCommentCreate(
  event: {
    comment: {
      id: string;
      authorId?: string;
      subredditId: string;
    };
    author: {
      name: string;
    };
  },
  context: QualityDetectorContext,
  store: RedisStore,
  userTracker: UserTracker,
): Promise<void> {
  const { comment, author } = event;
  const now = Date.now();

  // Record the comment creation event via User_Tracker
  const contributionEvent: ContributionEvent = {
    schemaVersion: 1,
    eventId: `evt-comment-${comment.id}-${now}`,
    eventType: 'comment_created',
    username: author.name,
    contentId: comment.id,
    timestamp: now,
    metadata: { subredditId: comment.subredditId },
  };

  await userTracker.recordContributionEvent(contributionEvent);

  // Schedule a delayed quality check (with duplicate prevention)
  await scheduleQualityCheck(
    context,
    store,
    {
      contentId: comment.id,
      contentType: 'comment',
      authorUsername: author.name,
      subredditId: comment.subredditId,
      createdAt: now,
    },
  );
}

/**
 * Schedule a delayed quality check job, preventing duplicate scheduling
 * by checking a Redis flag at `modkudos:quality:check:{contentId}`.
 */
async function scheduleQualityCheck(
  context: QualityDetectorContext,
  store: RedisStore,
  jobData: QualityCheckJobData,
): Promise<void> {
  const flagKey = qualityCheckKey(jobData.contentId);

  // Check if a quality check is already scheduled for this content
  const existing = await store.getString(flagKey);
  if (existing !== undefined) {
    return; // Already scheduled, skip
  }

  // Set the flag to prevent duplicate scheduling (with TTL)
  await store.setWithExpiry(flagKey, '1', QUALITY_CHECK_FLAG_TTL_SECONDS);

  // Schedule the delayed quality check job
  const runAt = new Date(Date.now() + QUALITY_CHECK_DELAY_MS);
  await context.scheduler.runJob({
    name: QUALITY_CHECK_JOB_NAME,
    data: jobData as unknown as Record<string, unknown>,
    runAt,
  });
}

// ---------------------------------------------------------------------------
// Quality evaluation (Task 6.2)
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a piece of content meets quality thresholds.
 *
 * - Posts: high-quality if `score >= minPostScore AND upvoteRatio >= minUpvoteRatio`
 * - Comments: high-quality if `score >= minCommentScore`
 *
 * On high-quality classification:
 *   1. Records a quality event via User_Tracker
 *   2. Returns `true` so the caller can invoke the Reward_Engine
 *
 * Retries up to 3 times with exponential backoff on Reddit API errors.
 *
 * @returns `true` if the content is classified as high-quality, `false` otherwise.
 */
export async function evaluateQuality(
  context: QualityDetectorContext,
  jobData: QualityCheckJobData,
  thresholds: QualityThresholds,
  userTracker: UserTracker,
): Promise<boolean> {
  let isHighQuality = false;

  // Fetch current vote data from Reddit with retry logic
  if (jobData.contentType === 'post') {
    const post = await fetchWithRetry(
      () => context.reddit.getPostById(jobData.contentId),
      'getPostById',
    );

    if (post === null) {
      return false; // All retries exhausted
    }

    isHighQuality =
      post.score >= thresholds.minPostScore &&
      post.upvoteRatio >= thresholds.minUpvoteRatio;
  } else {
    const comment = await fetchWithRetry(
      () => context.reddit.getCommentById(jobData.contentId),
      'getCommentById',
    );

    if (comment === null) {
      return false; // All retries exhausted
    }

    isHighQuality = comment.score >= thresholds.minCommentScore;
  }

  // On high-quality: record quality event via User_Tracker
  if (isHighQuality) {
    const qualityEvent: ContributionEvent = {
      schemaVersion: 1,
      eventId: `evt-quality-${jobData.contentId}-${Date.now()}`,
      eventType: jobData.contentType === 'post' ? 'post_quality' : 'comment_quality',
      username: jobData.authorUsername,
      contentId: jobData.contentId,
      timestamp: Date.now(),
      metadata: { subredditId: jobData.subredditId },
    };

    await userTracker.recordContributionEvent(qualityEvent);
  }

  return isHighQuality;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/**
 * Execute a Reddit API call with up to 3 retries and exponential backoff.
 *
 * @returns The result on success, or `null` if all retries are exhausted.
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  operationName: string,
): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_EVAL_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
      console.error(
        `[QualityDetector] ${operationName} failed (attempt ${attempt + 1}/${MAX_EVAL_RETRIES}), retrying in ${delayMs}ms`,
        error,
      );

      if (attempt < MAX_EVAL_RETRIES - 1) {
        await sleep(delayMs);
      }
    }
  }

  console.error(
    `[QualityDetector] ${operationName} failed after ${MAX_EVAL_RETRIES} attempts`,
  );
  return null;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
