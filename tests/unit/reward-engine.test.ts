import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RewardEngine } from '../../src/reward-engine/index.js';
import type { RedditRewardApi } from '../../src/reward-engine/index.js';
import { UserTracker } from '../../src/user-tracker/index.js';
import type { RewardConfig, RewardType } from '../../src/types/index.js';
import { rewardIdempotencyKey } from '../../src/utils/redis-keys.js';

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
// Mock Reddit API
// ---------------------------------------------------------------------------

function createMockRedditApi(): {
  api: RedditRewardApi;
  setUserFlair: ReturnType<typeof vi.fn>;
  sendPrivateMessage: ReturnType<typeof vi.fn>;
  submitPost: ReturnType<typeof vi.fn>;
} {
  const setUserFlair = vi.fn(async () => {});
  const sendPrivateMessage = vi.fn(async () => {});
  const submitPost = vi.fn(async () => {});

  return {
    api: { setUserFlair, sendPrivateMessage, submitPost },
    setUserFlair,
    sendPrivateMessage,
    submitPost,
  };
}

// ---------------------------------------------------------------------------
// Default reward config
// ---------------------------------------------------------------------------

function defaultConfig(overrides?: Partial<RewardConfig>): RewardConfig {
  return {
    flairEnabled: true,
    flairText: 'Quality Contributor',
    flairCssClass: 'quality',
    thankYouEnabled: true,
    thankYouTemplate:
      'Thanks for your quality contribution, {{username}}! Check it out: {{link}}',
    recognitionPostEnabled: true,
    recognitionPostTitleTemplate:
      'Shoutout to {{username}} for a quality contribution!',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RewardEngine', () => {
  let mockStore: MockStore;
  let tracker: UserTracker;
  let redditMock: ReturnType<typeof createMockRedditApi>;
  let engine: RewardEngine;

  beforeEach(() => {
    mockStore = createMockStore();
    tracker = new UserTracker(mockStore as any);
    redditMock = createMockRedditApi();
    engine = new RewardEngine(mockStore as any, tracker, redditMock.api);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    tracker.clearRetryTimer();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // applyRewards — basic reward application
  // -----------------------------------------------------------------------

  describe('applyRewards', () => {
    it('applies all enabled rewards for a user', async () => {
      const config = defaultConfig();

      const result = await engine.applyRewards(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      expect(result.username).toBe('alice');
      expect(result.contentId).toBe('t3_abc123');
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.success)).toBe(true);
      expect(result.results.every((r) => !r.skipped)).toBe(true);
    });

    it('applies flair with correct parameters', async () => {
      const config = defaultConfig({
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      expect(redditMock.setUserFlair).toHaveBeenCalledWith(
        'testsubreddit',
        'alice',
        'Quality Contributor',
        'quality',
      );
    });

    it('sends thank-you message with placeholders replaced', async () => {
      const config = defaultConfig({
        flairEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      expect(redditMock.sendPrivateMessage).toHaveBeenCalledTimes(1);
      const call = redditMock.sendPrivateMessage.mock.calls[0][0];
      expect(call.to).toBe('alice');
      expect(call.text).toContain('alice');
      expect(call.text).toContain('https://www.reddit.com/r/testsubreddit/comments/abc123');
    });

    it('creates recognition post with placeholders replaced', async () => {
      const config = defaultConfig({
        flairEnabled: false,
        thankYouEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      expect(redditMock.submitPost).toHaveBeenCalledTimes(1);
      const call = redditMock.submitPost.mock.calls[0][0];
      expect(call.subredditName).toBe('testsubreddit');
      expect(call.title).toContain('alice');
      expect(call.text).toContain('alice');
    });

    it('only applies enabled reward types', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      const result = await engine.applyRewards(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].rewardType).toBe('flair');
      expect(redditMock.setUserFlair).toHaveBeenCalledTimes(1);
      expect(redditMock.sendPrivateMessage).not.toHaveBeenCalled();
      expect(redditMock.submitPost).not.toHaveBeenCalled();
    });

    it('does not apply any rewards when all are disabled', async () => {
      const config = defaultConfig({
        flairEnabled: false,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      const result = await engine.applyRewards(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      expect(result.results).toHaveLength(0);
      expect(redditMock.setUserFlair).not.toHaveBeenCalled();
      expect(redditMock.sendPrivateMessage).not.toHaveBeenCalled();
      expect(redditMock.submitPost).not.toHaveBeenCalled();
    });

    it('records a reward_granted event for each applied reward', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      const events = await tracker.getUserEvents('alice');
      const rewardEvents = events.filter((e) => e.eventType === 'reward_granted');
      expect(rewardEvents).toHaveLength(1);
      expect(rewardEvents[0].username).toBe('alice');
      expect(rewardEvents[0].contentId).toBe('t3_abc123');
      expect(rewardEvents[0].metadata.rewardType).toBe('flair');
    });
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  describe('idempotency', () => {
    it('does not apply the same reward twice for the same user and content', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);
      const result2 = await engine.applyRewards(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      // Second call should skip the reward
      expect(result2.results).toHaveLength(1);
      expect(result2.results[0].skipped).toBe(true);
      expect(result2.results[0].success).toBe(true);

      // Reddit API should only be called once
      expect(redditMock.setUserFlair).toHaveBeenCalledTimes(1);
    });

    it('sets idempotency key with 30-day TTL', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      const key = rewardIdempotencyKey('alice', 't3_abc123', 'flair');
      expect(mockStore.setWithExpiry).toHaveBeenCalledWith(key, '1', 2592000);
    });

    it('hasRewardBeenApplied returns true after reward is applied', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      expect(await engine.hasRewardBeenApplied('alice', 't3_abc123', 'flair')).toBe(
        false,
      );

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      expect(await engine.hasRewardBeenApplied('alice', 't3_abc123', 'flair')).toBe(
        true,
      );
    });

    it('allows same reward type for different content', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);
      const result2 = await engine.applyRewards(
        'alice',
        't3_def456',
        'post',
        'testsubreddit',
        config,
      );

      expect(result2.results[0].skipped).toBe(false);
      expect(redditMock.setUserFlair).toHaveBeenCalledTimes(2);
    });

    it('allows same reward type for different users', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);
      const result2 = await engine.applyRewards(
        'bob',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      expect(result2.results[0].skipped).toBe(false);
      expect(redditMock.setUserFlair).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Permission error handling
  // -----------------------------------------------------------------------

  describe('permission error handling', () => {
    it('catches permission errors and returns failure result', async () => {
      redditMock.setUserFlair.mockRejectedValue(
        new Error('Insufficient permissions to set flair'),
      );

      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      const result = await engine.applyRewards(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('Insufficient permissions');
    });

    it('does not set idempotency key when reward fails', async () => {
      redditMock.setUserFlair.mockRejectedValue(new Error('Permission denied'));

      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      expect(await engine.hasRewardBeenApplied('alice', 't3_abc123', 'flair')).toBe(
        false,
      );
    });

    it('does not record reward event when reward fails', async () => {
      redditMock.setUserFlair.mockRejectedValue(new Error('Permission denied'));

      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      const events = await tracker.getUserEvents('alice');
      expect(events.filter((e) => e.eventType === 'reward_granted')).toHaveLength(0);
    });

    it('continues applying other rewards when one fails', async () => {
      redditMock.setUserFlair.mockRejectedValue(new Error('Permission denied'));

      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: true,
        recognitionPostEnabled: false,
      });

      const result = await engine.applyRewards(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0].rewardType).toBe('flair');
      expect(result.results[0].success).toBe(false);
      expect(result.results[1].rewardType).toBe('thank_you_message');
      expect(result.results[1].success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // applyManualReward
  // -----------------------------------------------------------------------

  describe('applyManualReward', () => {
    it('applies rewards with moderator metadata', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      const result = await engine.applyManualReward(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
        'mod_bob',
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);

      const events = await tracker.getUserEvents('alice');
      const rewardEvent = events.find((e) => e.eventType === 'reward_granted')!;
      expect(rewardEvent.metadata.grantedBy).toBe('mod_bob');
    });

    it('respects idempotency for manual rewards', async () => {
      const config = defaultConfig({
        flairEnabled: true,
        thankYouEnabled: false,
        recognitionPostEnabled: false,
      });

      // First: automatic reward
      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      // Second: manual reward for same content
      const result = await engine.applyManualReward(
        'alice',
        't3_abc123',
        'post',
        'testsubreddit',
        config,
        'mod_bob',
      );

      expect(result.results[0].skipped).toBe(true);
      expect(redditMock.setUserFlair).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Template placeholder replacement
  // -----------------------------------------------------------------------

  describe('template placeholders', () => {
    it('replaces {{username}} in thank-you template', async () => {
      const config = defaultConfig({
        flairEnabled: false,
        thankYouEnabled: true,
        thankYouTemplate: 'Hello {{username}}, great job {{username}}!',
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      const call = redditMock.sendPrivateMessage.mock.calls[0][0];
      expect(call.text).toBe('Hello alice, great job alice!');
    });

    it('replaces {{link}} in thank-you template', async () => {
      const config = defaultConfig({
        flairEnabled: false,
        thankYouEnabled: true,
        thankYouTemplate: 'Check out {{link}}',
        recognitionPostEnabled: false,
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      const call = redditMock.sendPrivateMessage.mock.calls[0][0];
      expect(call.text).toContain(
        'https://www.reddit.com/r/testsubreddit/comments/abc123',
      );
    });

    it('replaces {{username}} in recognition post title', async () => {
      const config = defaultConfig({
        flairEnabled: false,
        thankYouEnabled: false,
        recognitionPostEnabled: true,
        recognitionPostTitleTemplate: 'Kudos to {{username}}!',
      });

      await engine.applyRewards('alice', 't3_abc123', 'post', 'testsubreddit', config);

      const call = redditMock.submitPost.mock.calls[0][0];
      expect(call.title).toBe('Kudos to alice!');
    });
  });
});
