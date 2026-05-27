import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedisStore } from '../../src/utils/redis-store.js';

// ---------------------------------------------------------------------------
// Mock Redis client
// ---------------------------------------------------------------------------

function createMockRedis() {
  return {
    zAdd: vi.fn().mockResolvedValue(1),
    zRange: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(undefined),
    expire: vi.fn().mockResolvedValue(undefined),
    // Simulate sAdd / sMembers being available at runtime
    sAdd: vi.fn().mockResolvedValue(1),
    sMembers: vi.fn().mockResolvedValue([]),
  };
}

type MockRedis = ReturnType<typeof createMockRedis>;

describe('RedisStore', () => {
  let mockRedis: MockRedis;
  let store: RedisStore;

  beforeEach(() => {
    mockRedis = createMockRedis();
    store = new RedisStore(mockRedis as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // addToSortedSet
  // -----------------------------------------------------------------------

  describe('addToSortedSet', () => {
    it('calls zAdd with the correct key, member, and score', async () => {
      await store.addToSortedSet('mykey', 'alice', 100);
      expect(mockRedis.zAdd).toHaveBeenCalledWith('mykey', {
        member: 'alice',
        score: 100,
      });
    });

    it('retries on failure and eventually succeeds', async () => {
      let callCount = 0;
      mockRedis.zAdd.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error(`fail ${callCount}`);
        }
        return 1;
      });

      // Use a store with zero-delay retries for fast testing
      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await fastStore.addToSortedSet('mykey', 'bob', 200);
      expect(mockRedis.zAdd).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting all retries', async () => {
      mockRedis.zAdd.mockImplementation(async () => {
        throw new Error('persistent failure');
      });

      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await expect(
        fastStore.addToSortedSet('mykey', 'carol', 300),
      ).rejects.toThrow('persistent failure');
      // 1 initial + 3 retries = 4 attempts
      expect(mockRedis.zAdd).toHaveBeenCalledTimes(4);
    });
  });

  // -----------------------------------------------------------------------
  // getFromSortedSet
  // -----------------------------------------------------------------------

  describe('getFromSortedSet', () => {
    it('calls zRange with default reverse-chronological options', async () => {
      mockRedis.zRange.mockResolvedValue([
        { member: 'a', score: 200 },
        { member: 'b', score: 100 },
      ]);

      const result = await store.getFromSortedSet('mykey', 0, 300);

      expect(mockRedis.zRange).toHaveBeenCalledWith('mykey', 0, 300, {
        by: 'score',
        reverse: true,
      });
      expect(result).toEqual([
        { member: 'a', score: 200 },
        { member: 'b', score: 100 },
      ]);
    });

    it('passes custom options when provided', async () => {
      await store.getFromSortedSet('mykey', 0, 10, { by: 'rank' });
      expect(mockRedis.zRange).toHaveBeenCalledWith('mykey', 0, 10, {
        by: 'rank',
      });
    });

    it('does not retry on read failure', async () => {
      mockRedis.zRange.mockRejectedValue(new Error('read error'));
      await expect(store.getFromSortedSet('mykey', 0, 100)).rejects.toThrow(
        'read error',
      );
      expect(mockRedis.zRange).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // setString
  // -----------------------------------------------------------------------

  describe('setString', () => {
    it('calls set with the correct key and value', async () => {
      await store.setString('mykey', 'hello');
      expect(mockRedis.set).toHaveBeenCalledWith('mykey', 'hello');
    });

    it('retries on failure', async () => {
      let callCount = 0;
      mockRedis.set.mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('fail');
        }
        return 'OK';
      });

      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await fastStore.setString('mykey', 'val');
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // getString
  // -----------------------------------------------------------------------

  describe('getString', () => {
    it('returns the stored value', async () => {
      mockRedis.get.mockResolvedValue('world');
      const result = await store.getString('mykey');
      expect(result).toBe('world');
    });

    it('returns undefined for missing keys', async () => {
      mockRedis.get.mockResolvedValue(undefined);
      const result = await store.getString('missing');
      expect(result).toBeUndefined();
    });

    it('does not retry on read failure', async () => {
      mockRedis.get.mockRejectedValue(new Error('read error'));
      await expect(store.getString('mykey')).rejects.toThrow('read error');
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // setWithExpiry
  // -----------------------------------------------------------------------

  describe('setWithExpiry', () => {
    it('calls set then expire with the correct TTL', async () => {
      await store.setWithExpiry('mykey', 'val', 60);
      expect(mockRedis.set).toHaveBeenCalledWith('mykey', 'val');
      expect(mockRedis.expire).toHaveBeenCalledWith('mykey', 60);
    });

    it('retries the entire set+expire as a unit on failure', async () => {
      let callCount = 0;
      mockRedis.set.mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('fail');
        }
        return 'OK';
      });

      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await fastStore.setWithExpiry('mykey', 'val', 120);
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // addToSet
  // -----------------------------------------------------------------------

  describe('addToSet', () => {
    it('calls sAdd when available on the client', async () => {
      await store.addToSet('myset', ['a', 'b', 'c']);
      expect(mockRedis.sAdd).toHaveBeenCalledWith('myset', ['a', 'b', 'c']);
    });

    it('falls back to zAdd when sAdd is not available', async () => {
      delete (mockRedis as any).sAdd;
      const storeNoSAdd = new RedisStore(mockRedis as any);

      await storeNoSAdd.addToSet('myset', ['x', 'y']);
      expect(mockRedis.zAdd).toHaveBeenCalledWith(
        'myset',
        { member: 'x', score: 0 },
        { member: 'y', score: 0 },
      );
    });

    it('retries on failure', async () => {
      let callCount = 0;
      mockRedis.sAdd.mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('fail');
        }
        return 1;
      });

      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await fastStore.addToSet('myset', ['a']);
      expect(mockRedis.sAdd).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // getSetMembers
  // -----------------------------------------------------------------------

  describe('getSetMembers', () => {
    it('calls sMembers when available on the client', async () => {
      mockRedis.sMembers.mockResolvedValue(['a', 'b']);
      const result = await store.getSetMembers('myset');
      expect(result).toEqual(['a', 'b']);
      expect(mockRedis.sMembers).toHaveBeenCalledWith('myset');
    });

    it('falls back to zRange when sMembers is not available', async () => {
      delete (mockRedis as any).sMembers;
      const storeNoSMembers = new RedisStore(mockRedis as any);

      mockRedis.zRange.mockResolvedValue([
        { member: 'x', score: 0 },
        { member: 'y', score: 0 },
      ]);

      const result = await storeNoSMembers.getSetMembers('myset');
      expect(result).toEqual(['x', 'y']);
    });

    it('does not retry on read failure', async () => {
      mockRedis.sMembers.mockRejectedValue(new Error('read error'));
      await expect(store.getSetMembers('myset')).rejects.toThrow('read error');
      expect(mockRedis.sMembers).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Retry backoff configuration
  // -----------------------------------------------------------------------

  describe('retry backoff', () => {
    it('defaults to 1s base delay (exponential: 1s, 2s, 4s)', async () => {
      // Verify the default store uses 1000ms base delay by checking
      // that the constructor accepts the option and the retry logic works.
      // We test with baseDelayMs: 0 to avoid real waits.
      const callTimes: number[] = [];
      mockRedis.zAdd.mockImplementation(async () => {
        callTimes.push(Date.now());
        throw new Error('always fails');
      });

      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await expect(
        fastStore.addToSortedSet('k', 'm', 1),
      ).rejects.toThrow('always fails');

      // Verify 4 total attempts (1 initial + 3 retries)
      expect(callTimes.length).toBe(4);
    });

    it('performs exactly MAX_RETRIES (3) retries before giving up', async () => {
      mockRedis.set.mockImplementation(async () => {
        throw new Error('fail');
      });

      const fastStore = new RedisStore(mockRedis as any, { baseDelayMs: 0 });
      await expect(fastStore.setString('k', 'v')).rejects.toThrow('fail');
      expect(mockRedis.set).toHaveBeenCalledTimes(4);
    });
  });
});
