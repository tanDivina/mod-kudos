/**
 * Redis storage service for ModKudos.
 *
 * Wraps Devvit's `context.redis` API with a consistent interface and
 * automatic retry logic (exponential backoff) on write operations.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.5
 */

import type { RedisClient, ZRangeOptions } from '@devvit/public-api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts for write operations. */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff (1s, 2s, 4s). */
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options for customising RedisStore behaviour (mainly useful in tests). */
export interface RedisStoreOptions {
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  baseDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a write operation with retry logic.
 *
 * Retries up to {@link MAX_RETRIES} times with exponential backoff.
 * If all attempts fail the last error is re-thrown.
 */
async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.error(
          `[RedisStore] ${operation} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delayMs}ms`,
          error,
        );
        await sleep(delayMs);
      }
    }
  }

  console.error(
    `[RedisStore] ${operation} failed after ${MAX_RETRIES + 1} attempts`,
    lastError,
  );
  throw lastError;
}

// ---------------------------------------------------------------------------
// RedisStore
// ---------------------------------------------------------------------------

/**
 * A thin wrapper around Devvit's Redis client that provides:
 *
 * - A simplified, domain-oriented API for sorted sets, strings, and sets
 * - Automatic retry with exponential backoff on write operations
 * - Consistent error logging
 */
export class RedisStore {
  private readonly redis: RedisClient;
  private readonly baseDelayMs: number;

  constructor(redis: RedisClient, options?: RedisStoreOptions) {
    this.redis = redis;
    this.baseDelayMs = options?.baseDelayMs ?? BASE_DELAY_MS;
  }

  // -----------------------------------------------------------------------
  // Sorted set operations
  // -----------------------------------------------------------------------

  /**
   * Add a member to a sorted set, retrying on failure.
   *
   * @param key   - The sorted set key.
   * @param member - The member string to add.
   * @param score  - The score used for ordering.
   */
  async addToSortedSet(
    key: string,
    member: string,
    score: number,
  ): Promise<void> {
    await withRetry(`zAdd(${key})`, () =>
      this.redis.zAdd(key, { member, score }),
      this.baseDelayMs,
    );
  }

  /**
   * Retrieve members from a sorted set by score range.
   *
   * Defaults to reverse order (highest score first) which gives
   * reverse-chronological ordering when scores are timestamps.
   *
   * @param key     - The sorted set key.
   * @param start   - The minimum score (inclusive).
   * @param stop    - The maximum score (inclusive).
   * @param options - Optional zRange options (by, reverse, limit).
   * @returns Array of `{ member, score }` objects.
   */
  async getFromSortedSet(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptions,
  ): Promise<{ member: string; score: number }[]> {
    return this.redis.zRange(
      key,
      start,
      stop,
      options ?? { by: 'score', reverse: true },
    );
  }

  // -----------------------------------------------------------------------
  // String operations
  // -----------------------------------------------------------------------

  /**
   * Set a string value, retrying on failure.
   *
   * @param key   - The key.
   * @param value - The string value to store.
   */
  async setString(key: string, value: string): Promise<void> {
    await withRetry(`set(${key})`, () => this.redis.set(key, value), this.baseDelayMs);
  }

  /**
   * Get a string value (no retry — read operation).
   *
   * @param key - The key.
   * @returns The stored string, or `undefined` if the key does not exist.
   */
  async getString(key: string): Promise<string | undefined> {
    return this.redis.get(key);
  }

  /**
   * Set a string value and configure an expiry, retrying on failure.
   *
   * @param key     - The key.
   * @param value   - The string value to store.
   * @param seconds - Time-to-live in seconds.
   */
  async setWithExpiry(
    key: string,
    value: string,
    seconds: number,
  ): Promise<void> {
    await withRetry(`setWithExpiry(${key})`, async () => {
      await this.redis.set(key, value);
      await this.redis.expire(key, seconds);
    }, this.baseDelayMs);
  }

  // -----------------------------------------------------------------------
  // Set operations
  // -----------------------------------------------------------------------

  /**
   * Add one or more members to a set, retrying on failure.
   *
   * Uses the Devvit `redis.zAdd` with a score of 0 to emulate set
   * behaviour when native `sAdd` is unavailable, but prefers `sAdd`
   * when the client exposes it.
   *
   * @param key     - The set key.
   * @param members - The member strings to add.
   */
  async addToSet(key: string, members: string[]): Promise<void> {
    await withRetry(`sAdd(${key})`, async () => {
      // Devvit's RedisClient exposes sAdd at runtime even though the
      // bundled type declarations may not include it.
      const client = this.redis as Record<string, unknown>;
      if (typeof client['sAdd'] === 'function') {
        await (client as any).sAdd(key, members);
      } else {
        // Fallback: emulate a set with a sorted set (score 0).
        const zmembers = members.map((m) => ({ member: m, score: 0 }));
        await this.redis.zAdd(key, ...zmembers);
      }
    }, this.baseDelayMs);
  }

  /**
   * Get all members of a set (no retry — read operation).
   *
   * Falls back to reading all members from a sorted set when native
   * `sMembers` is unavailable.
   *
   * @param key - The set key.
   * @returns Array of member strings.
   */
  async getSetMembers(key: string): Promise<string[]> {
    const client = this.redis as Record<string, unknown>;
    if (typeof client['sMembers'] === 'function') {
      return (client as any).sMembers(key) as Promise<string[]>;
    }

    // Fallback: read all members from a sorted set.
    const results = await this.redis.zRange(key, 0, '+', {
      by: 'score',
    });
    return results.map((r) => r.member);
  }
}
