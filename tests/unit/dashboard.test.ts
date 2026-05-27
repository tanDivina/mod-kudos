import { describe, it, expect } from 'vitest';
import {
  buildDashboardSummary,
  extractDashboardData,
} from '../../src/dashboard/index.js';
import type { CommunityMetrics } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<CommunityMetrics> = {}): CommunityMetrics {
  return {
    schemaVersion: 1,
    timestamp: 1700000000000,
    periodStart: 1699900000000,
    periodEnd: 1700000000000,
    totalPosts: 42,
    totalComments: 128,
    totalRemovals: 5,
    totalRewards: 12,
    averageQualityScore: 67.5,
    newHighQualityContributors: 3,
    topContributors: [
      { username: 'alice', score: 95 },
      { username: 'bob', score: 88 },
      { username: 'carol', score: 82 },
    ],
    atRiskUsers: [
      { username: 'dave', scoreDrop: 25 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  describe('buildDashboardSummary', () => {
    it('shows stale data indicator when metrics are null', () => {
      const summary = buildDashboardSummary(null);
      expect(summary).toContain('Data may be stale');
    });

    it('includes all community metrics values', () => {
      const metrics = makeMetrics();
      const summary = buildDashboardSummary(metrics);

      expect(summary).toContain('Total Posts: 42');
      expect(summary).toContain('Total Comments: 128');
      expect(summary).toContain('Total Removals: 5');
      expect(summary).toContain('Total Rewards: 12');
      expect(summary).toContain('Average Quality Score: 67.5');
    });

    it('includes top contributors with usernames and scores', () => {
      const metrics = makeMetrics();
      const summary = buildDashboardSummary(metrics);

      expect(summary).toContain('u/alice');
      expect(summary).toContain('Score: 95');
      expect(summary).toContain('u/bob');
      expect(summary).toContain('Score: 88');
      expect(summary).toContain('u/carol');
      expect(summary).toContain('Score: 82');
    });

    it('includes at-risk users section when present', () => {
      const metrics = makeMetrics();
      const summary = buildDashboardSummary(metrics);

      expect(summary).toContain('At-Risk Users');
      expect(summary).toContain('u/dave');
      expect(summary).toContain('Score drop: 25');
    });

    it('has labeled sections for Community Metrics and Top Contributors', () => {
      const metrics = makeMetrics();
      const summary = buildDashboardSummary(metrics);

      expect(summary).toContain('Community Metrics');
      expect(summary).toContain('Top Contributors');
    });

    it('handles empty top contributors list', () => {
      const metrics = makeMetrics({ topContributors: [] });
      const summary = buildDashboardSummary(metrics);

      expect(summary).toContain('No contributors data available');
    });
  });

  describe('extractDashboardData', () => {
    it('returns null when metrics are null', () => {
      expect(extractDashboardData(null)).toBeNull();
    });

    it('extracts all required fields from metrics', () => {
      const metrics = makeMetrics();
      const data = extractDashboardData(metrics);

      expect(data).not.toBeNull();
      expect(data!.totalPosts).toBe(42);
      expect(data!.totalComments).toBe(128);
      expect(data!.totalRemovals).toBe(5);
      expect(data!.totalRewards).toBe(12);
      expect(data!.averageQualityScore).toBe(67.5);
      expect(data!.topContributors).toHaveLength(3);
      expect(data!.isStale).toBe(false);
    });
  });
});
