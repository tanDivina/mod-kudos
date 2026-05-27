import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  onPostCreate,
  onCommentCreate,
  evaluateQuality,
  QUALITY_CHECK_JOB_NAME,
} from '../../src/quality-detector/index.js';
import type {
  QualityDetectorContext,
  Scheduler,
  RedditApi,
} from '../../src/quality-detector/index.js';
import { UserTracker } from '../../src/user-tracker/index.js';
import type { QualityCheckJobData, QualityThresholds } from '../../src/types/index.js';
import { qualityCheckKey } from '../../src/utils/redis-keys.js';

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

    setWithExpiry: vi.fn(async (key: string, value: string, _seconds: number) => {
      stringStore.set(key, value);
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
  };
}

type MockStore = ReturnType<typeof createMockStore>;

// ---------------------------------------------------------------------------
// Mock context
// ---------------------------------------------------------------------------

function createMockContext(): {
  context: QualityDetectorContext;
  scheduler: { runJob: ReturnType<typeof vi.fn> };
  reddit: {
    getPostById: ReturnType<typeof vi.fn>;
    getCommentById: ReturnType<typeof vi.fn>;
  };
} {
  const scheduler = {
    runJob: vi.fn(async () => undefined),
  };
  const reddit = {
    getPostById: vi.fn(async () => ({ score: 100, upvoteRatio: 0.95 })),
    getCommentById: vi.fn(async () => ({ score: 50 })),
  };
  return {
    context: { scheduler, reddit },
    scheduler,
    reddit,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Quality_Detector', () => {
  let mockStore: MockStore;
  let tracker: UserTracker;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    mockStore = createMockStore();
    tracker = new UserTracker(mockStore as any);
    ctx = createMockContext();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    tracker.clearRetryTimer();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Task 6.1: Trigger handlers and job scheduling
  // -----------------------------------------------------------------------

  describe('onPostCreate', () => {
    it('records a post_created contribution event via User_Tracker', async () => {
      const event = {
        post: { id: 't3_abc123', subredditId: 'sr_1' },
        author: { name: 'alice' },
      };

      await onPostCreate(event, ctx.context, mockStore as any, tracker);

      const events = await tracker.getUserEvents('alice');
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('post_created');
      expect(events[0].username).toBe('alice');
      expect(events[0].contentId).toBe('t3_abc123');
    });

    it('schedules a delayed quality check job', async () => {
      const event = {
        post: { id: 't3_abc123', subredditId: 'sr_1' },
        author: { name: 'alice' },
      };

      await onPostCreate(event, ctx.context, mockStore as any, tracker);

      expect(ctx.scheduler.runJob).toHaveBeenCalledTimes(1);
      const call = ctx.scheduler.runJob.mock.calls[0][0];
      expect(call.name).toBe(QUALITY_CHECK_JOB_NAME);
      expect(call.data.contentId).toBe('t3_abc123');
      expect(call.data.contentType).toBe('post');
      expect(call.data.authorUsername).toBe('alice');
      expect(call.data.subredditId).toBe('sr_1');
      expect(call.runAt).toBeInstanceOf(Date);
    });

    it('sets a duplicate-prevention flag in Redis', async () => {
      const event = {
        post: { id: 't3_abc123', subredditId: 'sr_1' },
        author: { name: 'alice' },
      };

      await onPostCreate(event, ctx.context, mockStore as any, tracker);

      const flagKey = qualityCheckKey('t3_abc123');
      expect(mockStore.setWithExpiry).toHaveBeenCalledWith(flagKey, '1', 3600);
    });

    it('does not schedule duplicate quality check for same content', async () => {
      const event = {
        post: { id: 't3_abc123', subredditId: 'sr_1' },
        author: { name: 'alice' },
      };

      await onPostCreate(event, ctx.context, mockStore as any, tracker);
      await onPostCreate(event, ctx.context, mockStore as any, tracker);

      // Job should only be scheduled once
      expect(ctx.scheduler.runJob).toHaveBeenCalledTimes(1);
    });
  });

  describe('onCommentCreate', () => {
    it('records a comment_created contribution event via User_Tracker', async () => {
      const event = {
        comment: { id: 't1_xyz789', subredditId: 'sr_1' },
        author: { name: 'bob' },
      };

      await onCommentCreate(event, ctx.context, mockStore as any, tracker);

      const events = await tracker.getUserEvents('bob');
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('comment_created');
      expect(events[0].username).toBe('bob');
      expect(events[0].contentId).toBe('t1_xyz789');
    });

    it('schedules a delayed quality check job for comment', async () => {
      const event = {
        comment: { id: 't1_xyz789', subredditId: 'sr_1' },
        author: { name: 'bob' },
      };

      await onCommentCreate(event, ctx.context, mockStore as any, tracker);

      expect(ctx.scheduler.runJob).toHaveBeenCalledTimes(1);
      const call = ctx.scheduler.runJob.mock.calls[0][0];
      expect(call.name).toBe(QUALITY_CHECK_JOB_NAME);
      expect(call.data.contentId).toBe('t1_xyz789');
      expect(call.data.contentType).toBe('comment');
      expect(call.data.authorUsername).toBe('bob');
    });

    it('does not schedule duplicate quality check for same comment', async () => {
      const event = {
        comment: { id: 't1_xyz789', subredditId: 'sr_1' },
        author: { name: 'bob' },
      };

      await onCommentCreate(event, ctx.context, mockStore as any, tracker);
      await onCommentCreate(event, ctx.context, mockStore as any, tracker);

      expect(ctx.scheduler.runJob).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Task 6.2: Quality evaluation logic
  // -----------------------------------------------------------------------

  describe('evaluateQuality', () => {
    const defaultThresholds: QualityThresholds = {
      minUpvoteRatio: 0.85,
      minPostScore: 50,
      minCommentScore: 25,
    };

    describe('post evaluation', () => {
      const postJobData: QualityCheckJobData = {
        contentId: 't3_abc123',
        contentType: 'post',
        authorUsername: 'alice',
        subredditId: 'sr_1',
        createdAt: Date.now(),
      };

      it('classifies post as high-quality when score and ratio meet thresholds', async () => {
        ctx.reddit.getPostById.mockResolvedValue({ score: 100, upvoteRatio: 0.95 });

        const result = await evaluateQuality(
          ctx.context,
          postJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(true);
      });

      it('classifies post as NOT high-quality when score is below threshold', async () => {
        ctx.reddit.getPostById.mockResolvedValue({ score: 49, upvoteRatio: 0.95 });

        const result = await evaluateQuality(
          ctx.context,
          postJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(false);
      });

      it('classifies post as NOT high-quality when upvote ratio is below threshold', async () => {
        ctx.reddit.getPostById.mockResolvedValue({ score: 100, upvoteRatio: 0.84 });

        const result = await evaluateQuality(
          ctx.context,
          postJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(false);
      });

      it('classifies post as high-quality at exact threshold values', async () => {
        ctx.reddit.getPostById.mockResolvedValue({ score: 50, upvoteRatio: 0.85 });

        const result = await evaluateQuality(
          ctx.context,
          postJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(true);
      });

      it('records post_quality event on high-quality classification', async () => {
        ctx.reddit.getPostById.mockResolvedValue({ score: 100, upvoteRatio: 0.95 });

        await evaluateQuality(ctx.context, postJobData, defaultThresholds, tracker);

        const events = await tracker.getUserEvents('alice');
        expect(events.some((e) => e.eventType === 'post_quality')).toBe(true);
        const qualityEvent = events.find((e) => e.eventType === 'post_quality')!;
        expect(qualityEvent.username).toBe('alice');
        expect(qualityEvent.contentId).toBe('t3_abc123');
      });

      it('does NOT record quality event when post is not high-quality', async () => {
        ctx.reddit.getPostById.mockResolvedValue({ score: 10, upvoteRatio: 0.5 });

        await evaluateQuality(ctx.context, postJobData, defaultThresholds, tracker);

        const events = await tracker.getUserEvents('alice');
        expect(events.some((e) => e.eventType === 'post_quality')).toBe(false);
      });
    });

    describe('comment evaluation', () => {
      const commentJobData: QualityCheckJobData = {
        contentId: 't1_xyz789',
        contentType: 'comment',
        authorUsername: 'bob',
        subredditId: 'sr_1',
        createdAt: Date.now(),
      };

      it('classifies comment as high-quality when score meets threshold', async () => {
        ctx.reddit.getCommentById.mockResolvedValue({ score: 30 });

        const result = await evaluateQuality(
          ctx.context,
          commentJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(true);
      });

      it('classifies comment as NOT high-quality when score is below threshold', async () => {
        ctx.reddit.getCommentById.mockResolvedValue({ score: 24 });

        const result = await evaluateQuality(
          ctx.context,
          commentJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(false);
      });

      it('classifies comment as high-quality at exact threshold', async () => {
        ctx.reddit.getCommentById.mockResolvedValue({ score: 25 });

        const result = await evaluateQuality(
          ctx.context,
          commentJobData,
          defaultThresholds,
          tracker,
        );

        expect(result).toBe(true);
      });

      it('records comment_quality event on high-quality classification', async () => {
        ctx.reddit.getCommentById.mockResolvedValue({ score: 50 });

        await evaluateQuality(ctx.context, commentJobData, defaultThresholds, tracker);

        const events = await tracker.getUserEvents('bob');
        expect(events.some((e) => e.eventType === 'comment_quality')).toBe(true);
        const qualityEvent = events.find((e) => e.eventType === 'comment_quality')!;
        expect(qualityEvent.username).toBe('bob');
        expect(qualityEvent.contentId).toBe('t1_xyz789');
      });
    });

    describe('retry logic on Reddit API errors', () => {
      const postJobData: QualityCheckJobData = {
        contentId: 't3_abc123',
        contentType: 'post',
        authorUsername: 'alice',
        subredditId: 'sr_1',
        createdAt: Date.now(),
      };

      it('retries up to 3 times on Reddit API error and succeeds', async () => {
        let callCount = 0;
        ctx.reddit.getPostById.mockImplementation(async () => {
          callCount++;
          if (callCount < 3) throw new Error('Reddit API error');
          return { score: 100, upvoteRatio: 0.95 };
        });

        const resultPromise = evaluateQuality(
          ctx.context,
          postJobData,
          defaultThresholds,
          tracker,
        );

        // Advance timers for backoff delays
        await vi.advanceTimersByTimeAsync(1000); // 1st retry delay
        await vi.advanceTimersByTimeAsync(2000); // 2nd retry delay

        const result = await resultPromise;
        expect(result).toBe(true);
        expect(callCount).toBe(3);
      });

      it('returns false after all retries are exhausted', async () => {
        ctx.reddit.getPostById.mockRejectedValue(new Error('Reddit API error'));

        const resultPromise = evaluateQuality(
          ctx.context,
          postJobData,
          defaultThresholds,
          tracker,
        );

        // Advance timers for all backoff delays
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);

        const result = await resultPromise;
        expect(result).toBe(false);
        expect(ctx.reddit.getPostById).toHaveBeenCalledTimes(3);
      });

      it('retries comment API errors as well', async () => {
        const commentJobData: QualityCheckJobData = {
          contentId: 't1_xyz789',
          contentType: 'comment',
          authorUsername: 'bob',
          subredditId: 'sr_1',
          createdAt: Date.now(),
        };

        ctx.reddit.getCommentById.mockRejectedValue(new Error('Reddit API error'));

        const resultPromise = evaluateQuality(
          ctx.context,
          commentJobData,
          defaultThresholds,
          tracker,
        );

        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);

        const result = await resultPromise;
        expect(result).toBe(false);
        expect(ctx.reddit.getCommentById).toHaveBeenCalledTimes(3);
      });
    });
  });
});
