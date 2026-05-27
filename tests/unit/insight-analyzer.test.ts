import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runAnalysis,
  getLatestMetrics,
  getMetricsHistory,
} from '../../src/insight-analyzer/index.js';
import type {
  ContributionEvent,
  ModAction,
  QualityScore,
  CommunityMetrics,
} from '../../src/types/index.js';
import { metricsLatestKey, metricsKey } from '../../src/utils/redis-keys.js';

// ---------------------------------------------------------------------------
// Mock RedisStore
// ---------------------------------------------------------------------------

function createMockStore() {
  const stringStore = new Map<string, string>();
  const sortedSets = new Map<string, { member: string; score: number }[]>();
  const sets = new Map<string, Set<string>>();

  return {
    stringStore,
    sortedSets,
    sets,

    setString: vi.fn(async (key: string, value: string) => {
      stringStore.set(key, value);
    }),

    getString: vi.fn(async (key: string) => {
      return stringStore.get(key);
    }),

    addToSortedSet: vi.fn(async (key: string, member: string, score: number) => {
      if (!sortedSets.has(key)) sortedSets.set(key, []);
      const set = sortedSets.get(key)!;
      const idx = set.findIndex((e) => e.member === member);
      if (idx !== -1) set.splice(idx, 1);
      set.push({ member, score });
      set.sort((a, b) => b.score - a.score);
    }),

    getFromSortedSet: vi.fn(async (key: string) => {
      return sortedSets.get(key) ?? [];
    }),

    addToSet: vi.fn(async (key: string, members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key)!;
      for (const m of members) s.add(m);
    }),

    getSetMembers: vi.fn(async (key: string) => {
      return [...(sets.get(key) ?? [])];
    }),

    setWithExpiry: vi.fn(async (key: string, value: string, _seconds: number) => {
      stringStore.set(key, value);
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock UserTracker
// ---------------------------------------------------------------------------

function createMockUserTracker(userDataMap: Record<string, {
  events: ContributionEvent[];
  actions: ModAction[];
  qualityScore: QualityScore;
}>) {
  return {
    getUserEvents: vi.fn(async (username: string) => {
      return userDataMap[username]?.events ?? [];
    }),
    getUserModActions: vi.fn(async (username: string) => {
      return userDataMap[username]?.actions ?? [];
    }),
    getQualityScore: vi.fn(async (username: string): Promise<QualityScore> => {
      return userDataMap[username]?.qualityScore ?? {
        username,
        score: 50,
        lastUpdated: 0,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<ContributionEvent> = {}): ContributionEvent {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    eventType: 'post_created',
    username: 'alice',
    contentId: 't3_abc',
    timestamp: 1000,
    metadata: {},
    ...overrides,
  };
}

function makeAction(overrides: Partial<ModAction> = {}): ModAction {
  return {
    schemaVersion: 1,
    actionId: 'act-1',
    actionType: 'removal',
    targetUsername: 'alice',
    moderatorUsername: 'mod1',
    contentId: 't3_xyz',
    timestamp: 2000,
    reason: 'spam',
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Insight_Analyzer', () => {
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    mockStore = createMockStore();
  });

  // -----------------------------------------------------------------------
  // runAnalysis
  // -----------------------------------------------------------------------

  describe('runAnalysis', () => {
    it('computes correct totals for events within the period', async () => {
      // Set up active users
      mockStore.sets.set('modkudos:users:active', new Set(['alice', 'bob']));

      const userDataMap = {
        alice: {
          events: [
            makeEvent({ eventId: 'e1', eventType: 'post_created', timestamp: 500, username: 'alice' }),
            makeEvent({ eventId: 'e2', eventType: 'comment_created', timestamp: 600, username: 'alice' }),
          ],
          actions: [],
          qualityScore: { username: 'alice', score: 70, lastUpdated: 1000 },
        },
        bob: {
          events: [
            makeEvent({ eventId: 'e3', eventType: 'post_created', timestamp: 700, username: 'bob' }),
            makeEvent({ eventId: 'e4', eventType: 'reward_granted', timestamp: 800, username: 'bob' }),
          ],
          actions: [
            makeAction({ actionId: 'a1', actionType: 'removal', timestamp: 900, targetUsername: 'bob' }),
          ],
          qualityScore: { username: 'bob', score: 60, lastUpdated: 1000 },
        },
      };

      const tracker = createMockUserTracker(userDataMap);
      const metrics = await runAnalysis(mockStore as any, tracker as any, 0, 2000);

      expect(metrics.totalPosts).toBe(2);
      expect(metrics.totalComments).toBe(1);
      expect(metrics.totalRewards).toBe(1);
      expect(metrics.totalRemovals).toBe(1);
    });

    it('computes average quality score across active users', async () => {
      mockStore.sets.set('modkudos:users:active', new Set(['alice', 'bob']));

      const userDataMap = {
        alice: {
          events: [],
          actions: [],
          qualityScore: { username: 'alice', score: 80, lastUpdated: 1000 },
        },
        bob: {
          events: [],
          actions: [],
          qualityScore: { username: 'bob', score: 60, lastUpdated: 1000 },
        },
      };

      const tracker = createMockUserTracker(userDataMap);
      const metrics = await runAnalysis(mockStore as any, tracker as any, 0, 2000);

      expect(metrics.averageQualityScore).toBe(70);
    });

    it('identifies top contributors sorted by score descending', async () => {
      mockStore.sets.set('modkudos:users:active', new Set(['alice', 'bob', 'carol']));

      const userDataMap = {
        alice: {
          events: [],
          actions: [],
          qualityScore: { username: 'alice', score: 90, lastUpdated: 1000 },
        },
        bob: {
          events: [],
          actions: [],
          qualityScore: { username: 'bob', score: 60, lastUpdated: 1000 },
        },
        carol: {
          events: [],
          actions: [],
          qualityScore: { username: 'carol', score: 80, lastUpdated: 1000 },
        },
      };

      const tracker = createMockUserTracker(userDataMap);
      const metrics = await runAnalysis(mockStore as any, tracker as any, 0, 2000);

      expect(metrics.topContributors).toHaveLength(3);
      expect(metrics.topContributors[0].username).toBe('alice');
      expect(metrics.topContributors[0].score).toBe(90);
      expect(metrics.topContributors[1].username).toBe('carol');
      expect(metrics.topContributors[2].username).toBe('bob');
    });

    it('stores metrics at timestamp key and updates latest', async () => {
      mockStore.sets.set('modkudos:users:active', new Set());

      const tracker = createMockUserTracker({});
      const metrics = await runAnalysis(mockStore as any, tracker as any, 0, 2000);

      // Should have stored at metrics:{timestamp} and metrics:latest
      const latestJson = mockStore.stringStore.get(metricsLatestKey());
      expect(latestJson).toBeDefined();
      const latest = JSON.parse(latestJson!);
      expect(latest.schemaVersion).toBe(1);
    });

    it('returns empty metrics when no active users exist', async () => {
      mockStore.sets.set('modkudos:users:active', new Set());

      const tracker = createMockUserTracker({});
      const metrics = await runAnalysis(mockStore as any, tracker as any, 0, 2000);

      expect(metrics.totalPosts).toBe(0);
      expect(metrics.totalComments).toBe(0);
      expect(metrics.totalRemovals).toBe(0);
      expect(metrics.totalRewards).toBe(0);
      expect(metrics.averageQualityScore).toBe(0);
      expect(metrics.topContributors).toEqual([]);
    });

    it('only counts events within the analysis period', async () => {
      mockStore.sets.set('modkudos:users:active', new Set(['alice']));

      const userDataMap = {
        alice: {
          events: [
            makeEvent({ eventId: 'e1', eventType: 'post_created', timestamp: 100, username: 'alice' }),
            makeEvent({ eventId: 'e2', eventType: 'post_created', timestamp: 500, username: 'alice' }),
            makeEvent({ eventId: 'e3', eventType: 'post_created', timestamp: 1500, username: 'alice' }),
          ],
          actions: [],
          qualityScore: { username: 'alice', score: 56, lastUpdated: 1000 },
        },
      };

      const tracker = createMockUserTracker(userDataMap);
      // Period: 200–1000 (only e2 falls within)
      const metrics = await runAnalysis(mockStore as any, tracker as any, 200, 1000);

      expect(metrics.totalPosts).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // getLatestMetrics
  // -----------------------------------------------------------------------

  describe('getLatestMetrics', () => {
    it('returns null when no metrics exist', async () => {
      const result = await getLatestMetrics(mockStore as any);
      expect(result).toBeNull();
    });

    it('returns stored metrics', async () => {
      const metrics: CommunityMetrics = {
        schemaVersion: 1,
        timestamp: 1000,
        periodStart: 0,
        periodEnd: 1000,
        totalPosts: 5,
        totalComments: 3,
        totalRemovals: 1,
        totalRewards: 2,
        averageQualityScore: 65,
        newHighQualityContributors: 1,
        topContributors: [{ username: 'alice', score: 80 }],
        atRiskUsers: [],
      };

      mockStore.stringStore.set(metricsLatestKey(), JSON.stringify(metrics));

      const result = await getLatestMetrics(mockStore as any);
      expect(result).not.toBeNull();
      expect(result!.totalPosts).toBe(5);
      expect(result!.topContributors[0].username).toBe('alice');
    });

    it('returns null for malformed JSON', async () => {
      mockStore.stringStore.set(metricsLatestKey(), 'not-json');

      const result = await getLatestMetrics(mockStore as any);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getMetricsHistory
  // -----------------------------------------------------------------------

  describe('getMetricsHistory', () => {
    it('returns empty array when no history exists', async () => {
      const result = await getMetricsHistory(mockStore as any, 0, 10000);
      expect(result).toEqual([]);
    });

    it('returns metrics within the date range', async () => {
      // Simulate stored history
      const metrics1: CommunityMetrics = {
        schemaVersion: 1,
        timestamp: 1000,
        periodStart: 0,
        periodEnd: 1000,
        totalPosts: 5,
        totalComments: 3,
        totalRemovals: 1,
        totalRewards: 2,
        averageQualityScore: 65,
        newHighQualityContributors: 1,
        topContributors: [],
        atRiskUsers: [],
      };

      mockStore.stringStore.set(metricsKey(1000), JSON.stringify(metrics1));
      if (!mockStore.sortedSets.has('modkudos:metrics:history')) {
        mockStore.sortedSets.set('modkudos:metrics:history', []);
      }
      mockStore.sortedSets.get('modkudos:metrics:history')!.push(
        { member: '1000', score: 1000 },
      );

      const result = await getMetricsHistory(mockStore as any, 0, 2000);
      expect(result).toHaveLength(1);
      expect(result[0].totalPosts).toBe(5);
    });
  });
});
