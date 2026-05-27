/**
 * Insight_Analyzer subsystem for ModKudos.
 *
 * Computes community-level metrics via a scheduled job: total posts,
 * comments, removals, rewards, average quality score, top 10 contributors,
 * at-risk users, and new high-quality contributors.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.3
 */

import type {
  CommunityMetrics,
  ContributionEvent,
  ModAction,
} from '../types/index.js';
import type { RedisStore } from '../utils/redis-store.js';
import type { UserTracker } from '../user-tracker/index.js';
import {
  metricsKey,
  metricsLatestKey,
  activeUsersKey,
} from '../utils/redis-keys.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the scheduled job for insight analysis. */
export const INSIGHT_ANALYSIS_JOB_NAME = 'modkudos:insight-analysis';

/** Number of top contributors to include in metrics. */
const TOP_CONTRIBUTORS_COUNT = 10;

/** Score drop threshold for at-risk user identification. */
const AT_RISK_SCORE_DROP_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Analysis (Task 10.1)
// ---------------------------------------------------------------------------

/**
 * Run community analysis for a given time period.
 *
 * Aggregates events across all active users, computes totals, identifies
 * top contributors and at-risk users, and stores the resulting metrics.
 *
 * @param store       - The Redis store instance.
 * @param userTracker - The UserTracker instance for fetching user data.
 * @param periodStart - Start of the analysis period (epoch ms).
 * @param periodEnd   - End of the analysis period (epoch ms).
 * @returns The computed community metrics.
 */
export async function runAnalysis(
  store: RedisStore,
  userTracker: UserTracker,
  periodStart: number,
  periodEnd: number,
): Promise<CommunityMetrics> {
  // Get all active usernames
  const activeUsers = await store.getSetMembers(activeUsersKey());

  let totalPosts = 0;
  let totalComments = 0;
  let totalRemovals = 0;
  let totalRewards = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let newHighQualityContributors = 0;

  const userScores: { username: string; score: number }[] = [];
  const atRiskUsers: { username: string; scoreDrop: number }[] = [];

  for (const username of activeUsers) {
    // Fetch all events for this user (large limit)
    const events = await userTracker.getUserEvents(username, 10000);
    const actions = await userTracker.getUserModActions(username, 10000);

    // Filter events within the analysis period
    const periodEvents = events.filter(
      (e) => e.timestamp >= periodStart && e.timestamp <= periodEnd,
    );
    const periodActions = actions.filter(
      (a) => a.timestamp >= periodStart && a.timestamp <= periodEnd,
    );

    // Count event types within the period
    for (const event of periodEvents) {
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

    for (const action of periodActions) {
      if (action.actionType === 'removal') {
        totalRemovals++;
      }
    }

    // Get current quality score
    const qualityScore = await userTracker.getQualityScore(username);
    scoreSum += qualityScore.score;
    scoreCount++;
    userScores.push({ username, score: qualityScore.score });

    // Check for new high-quality contributors (first quality event in period)
    const hasQualityEventInPeriod = periodEvents.some(
      (e) => e.eventType === 'post_quality' || e.eventType === 'comment_quality',
    );
    const hasQualityEventBeforePeriod = events.some(
      (e) =>
        (e.eventType === 'post_quality' || e.eventType === 'comment_quality') &&
        e.timestamp < periodStart,
    );
    if (hasQualityEventInPeriod && !hasQualityEventBeforePeriod) {
      newHighQualityContributors++;
    }

    // Identify at-risk users: estimate score drop by comparing events
    // before and during the period. We use a simplified approach:
    // compute what the score would be without period events vs with them.
    const scoreDrop = estimateScoreDrop(events, actions, periodStart, periodEnd);
    if (scoreDrop > AT_RISK_SCORE_DROP_THRESHOLD) {
      atRiskUsers.push({ username, scoreDrop });
    }
  }

  // Compute average quality score
  const averageQualityScore = scoreCount > 0
    ? Math.round((scoreSum / scoreCount) * 100) / 100
    : 0;

  // Sort users by score descending, take top 10
  userScores.sort((a, b) => b.score - a.score);
  const topContributors = userScores.slice(0, TOP_CONTRIBUTORS_COUNT);

  const now = Date.now();
  const metrics: CommunityMetrics = {
    schemaVersion: 1,
    timestamp: now,
    periodStart,
    periodEnd,
    totalPosts,
    totalComments,
    totalRemovals,
    totalRewards,
    averageQualityScore,
    newHighQualityContributors,
    topContributors,
    atRiskUsers,
  };

  // Store metrics with timestamp key and update latest
  const metricsJson = JSON.stringify(metrics);
  await store.setString(metricsKey(now), metricsJson);
  await store.setString(metricsLatestKey(), metricsJson);

  // Also add to a sorted set for historical retrieval
  await store.addToSortedSet('modkudos:metrics:history', String(now), now);

  return metrics;
}

// ---------------------------------------------------------------------------
// Metrics retrieval (Task 10.2)
// ---------------------------------------------------------------------------

/**
 * Get the most recently computed community metrics.
 *
 * @returns The latest CommunityMetrics, or null if none exist.
 */
export async function getLatestMetrics(
  store: RedisStore,
): Promise<CommunityMetrics | null> {
  const json = await store.getString(metricsLatestKey());
  if (json === undefined) return null;

  try {
    return JSON.parse(json) as CommunityMetrics;
  } catch (error) {
    console.error('[InsightAnalyzer] Failed to parse latest metrics', { error });
    return null;
  }
}

/**
 * Get historical metrics within a date range.
 *
 * @param store     - The Redis store instance.
 * @param startDate - Start of the range (epoch ms).
 * @param endDate   - End of the range (epoch ms).
 * @returns Array of CommunityMetrics within the range, newest first.
 */
export async function getMetricsHistory(
  store: RedisStore,
  startDate: number,
  endDate: number,
): Promise<CommunityMetrics[]> {
  // Get metric timestamps from the history sorted set
  const entries = await store.getFromSortedSet(
    'modkudos:metrics:history',
    startDate,
    endDate,
  );

  const metrics: CommunityMetrics[] = [];
  for (const entry of entries) {
    const json = await store.getString(metricsKey(Number(entry.member)));
    if (json === undefined) continue;

    try {
      metrics.push(JSON.parse(json) as CommunityMetrics);
    } catch (error) {
      console.error('[InsightAnalyzer] Failed to parse historical metrics', {
        timestamp: entry.member,
        error,
      });
    }
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Estimate the score drop for a user during a period.
 *
 * Looks at negative events (removals, warnings) that occurred during the
 * period and computes the point impact. This is a simplified heuristic —
 * a true score drop would require storing historical scores.
 */
function estimateScoreDrop(
  events: ContributionEvent[],
  actions: ModAction[],
  periodStart: number,
  periodEnd: number,
): number {
  let negativePoints = 0;
  let positivePoints = 0;

  // Count negative actions in period
  for (const action of actions) {
    if (action.timestamp >= periodStart && action.timestamp <= periodEnd) {
      if (action.actionType === 'removal') negativePoints += 10;
      if (action.actionType === 'warning') negativePoints += 15;
    }
  }

  // Count positive events in period
  for (const event of events) {
    if (event.timestamp >= periodStart && event.timestamp <= periodEnd) {
      switch (event.eventType) {
        case 'post_created':
          positivePoints += 2;
          break;
        case 'comment_created':
          positivePoints += 1;
          break;
        case 'post_quality':
          positivePoints += 5;
          break;
        case 'comment_quality':
          positivePoints += 3;
          break;
        case 'reward_granted':
          positivePoints += 4;
          break;
      }
    }
  }

  // Net score change (negative means drop)
  const netChange = positivePoints - negativePoints;
  return netChange < 0 ? Math.abs(netChange) : 0;
}
