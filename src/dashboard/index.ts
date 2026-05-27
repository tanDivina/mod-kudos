/**
 * Dashboard_Post subsystem for ModKudos.
 *
 * Provides a custom Devvit post type that renders community health metrics
 * and top contributor lists. Includes menu actions for creating and
 * refreshing dashboard posts.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import type { CommunityMetrics } from '../types/index.js';

// ---------------------------------------------------------------------------
// Dashboard rendering helpers (Task 11.1)
// ---------------------------------------------------------------------------

/**
 * Build a text summary of community metrics for display in the dashboard.
 *
 * @param metrics - The community metrics to render, or null if unavailable.
 * @returns A formatted string for display.
 */
export function buildDashboardSummary(metrics: CommunityMetrics | null): string {
  if (metrics === null) {
    return [
      '=== ModKudos Community Dashboard ===',
      '',
      '⚠️ Data may be stale — no metrics available yet.',
      'The Insight Analyzer has not completed its first run.',
      'Metrics will appear here after the next scheduled analysis.',
    ].join('\n');
  }

  const lines: string[] = [];

  lines.push('=== ModKudos Community Dashboard ===');
  lines.push('');

  // Metrics timestamp
  const updatedAt = new Date(metrics.timestamp).toISOString().split('T')[0];
  lines.push(`Last updated: ${updatedAt}`);
  lines.push('');

  // Community Metrics section
  lines.push('--- Community Metrics ---');
  lines.push(`Total Posts: ${metrics.totalPosts}`);
  lines.push(`Total Comments: ${metrics.totalComments}`);
  lines.push(`Total Removals: ${metrics.totalRemovals}`);
  lines.push(`Total Rewards: ${metrics.totalRewards}`);
  lines.push(`Average Quality Score: ${metrics.averageQualityScore}`);
  lines.push(`New High-Quality Contributors: ${metrics.newHighQualityContributors}`);
  lines.push('');

  // Top Contributors section
  lines.push('--- Top Contributors ---');
  if (metrics.topContributors.length === 0) {
    lines.push('No contributors data available.');
  } else {
    for (let i = 0; i < metrics.topContributors.length; i++) {
      const contributor = metrics.topContributors[i];
      lines.push(`${i + 1}. u/${contributor.username} — Score: ${contributor.score}`);
    }
  }

  // At-risk users section (if any)
  if (metrics.atRiskUsers.length > 0) {
    lines.push('');
    lines.push('--- At-Risk Users ---');
    for (const user of metrics.atRiskUsers) {
      lines.push(`u/${user.username} — Score drop: ${user.scoreDrop}`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract the key metric values from a CommunityMetrics object
 * for structured rendering in Devvit Blocks.
 *
 * Returns null if metrics are unavailable.
 */
export function extractDashboardData(metrics: CommunityMetrics | null): {
  isStale: boolean;
  totalPosts: number;
  totalComments: number;
  totalRemovals: number;
  totalRewards: number;
  averageQualityScore: number;
  topContributors: { username: string; score: number }[];
  lastUpdated: string;
} | null {
  if (metrics === null) return null;

  return {
    isStale: false,
    totalPosts: metrics.totalPosts,
    totalComments: metrics.totalComments,
    totalRemovals: metrics.totalRemovals,
    totalRewards: metrics.totalRewards,
    averageQualityScore: metrics.averageQualityScore,
    topContributors: metrics.topContributors,
    lastUpdated: new Date(metrics.timestamp).toISOString(),
  };
}
