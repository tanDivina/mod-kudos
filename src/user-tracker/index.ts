/**
 * User_Tracker subsystem for ModKudos.
 *
 * Records contribution events, mod actions, and mod notes to Redis.
 * Maintains a running Quality_Score per user. Provides retrieval
 * functions for events, actions, and notes in reverse chronological order.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 8.1, 8.2
 */

import type {
  ContributionEvent,
  ModAction,
  ModNote,
  QualityScore,
} from '../types/index.js';
import type { RedisStore } from '../utils/redis-store.js';
import {
  serializeEvent,
  deserializeEvent,
  serializeModAction,
  deserializeModAction,
  serializeModNote,
  deserializeModNote,
} from '../utils/serialization.js';
import {
  eventKey,
  actionKey,
  noteKey,
  scoreKey,
  eventDetailKey,
  actionDetailKey,
  noteDetailKey,
  activeUsersKey,
} from '../utils/redis-keys.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default limit for event and action retrieval. */
const DEFAULT_LIMIT = 10;

/** Maximum time (ms) to keep queued items before retrying. */
const QUEUE_RETRY_TIMEOUT_MS = 60_000;

/** Base quality score for new users. */
const BASE_SCORE = 50;

// ---------------------------------------------------------------------------
// In-memory queue types
// ---------------------------------------------------------------------------

interface QueuedItem {
  type: 'event' | 'action' | 'note';
  data: ContributionEvent | ModAction | ModNote;
  queuedAt: number;
}

// ---------------------------------------------------------------------------
// UserTracker
// ---------------------------------------------------------------------------

export class UserTracker {
  private readonly store: RedisStore;
  private readonly queue: QueuedItem[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: RedisStore) {
    this.store = store;
  }

  // -----------------------------------------------------------------------
  // Recording functions (Task 5.1)
  // -----------------------------------------------------------------------

  /**
   * Record a contribution event for a user.
   *
   * Serializes the event, stores the detail as a string key, adds the
   * event ID to the user's sorted set by timestamp, adds the username
   * to the active users set, and recalculates the quality score.
   */
  async recordContributionEvent(event: ContributionEvent): Promise<void> {
    try {
      const serialized = serializeEvent(event);

      // Store event detail
      await this.store.setString(eventDetailKey(event.eventId), serialized);

      // Add event ID to user's sorted set by timestamp
      await this.store.addToSortedSet(
        eventKey(event.username),
        event.eventId,
        event.timestamp,
      );

      // Track user as active
      await this.store.addToSet(activeUsersKey(), [event.username]);

      // Recalculate quality score
      await this.recalculateQualityScore(event.username);
    } catch (error) {
      console.error('[UserTracker] Failed to record contribution event', {
        eventId: event.eventId,
        username: event.username,
        error,
      });
      this.enqueue({ type: 'event', data: event, queuedAt: Date.now() });
    }
  }

  /**
   * Record a mod action against a user.
   *
   * Serializes the action, stores the detail as a string key, adds the
   * action ID to the user's sorted set by timestamp, adds the username
   * to the active users set, and recalculates the quality score.
   */
  async recordModAction(action: ModAction): Promise<void> {
    try {
      const serialized = serializeModAction(action);

      // Store action detail
      await this.store.setString(actionDetailKey(action.actionId), serialized);

      // Add action ID to user's sorted set by timestamp
      await this.store.addToSortedSet(
        actionKey(action.targetUsername),
        action.actionId,
        action.timestamp,
      );

      // Track user as active
      await this.store.addToSet(activeUsersKey(), [action.targetUsername]);

      // Recalculate quality score
      await this.recalculateQualityScore(action.targetUsername);
    } catch (error) {
      console.error('[UserTracker] Failed to record mod action', {
        actionId: action.actionId,
        targetUsername: action.targetUsername,
        error,
      });
      this.enqueue({ type: 'action', data: action, queuedAt: Date.now() });
    }
  }

  /**
   * Add a moderator note for a user.
   *
   * Serializes the note, stores the detail as a string key, adds the
   * note ID to the user's sorted set by timestamp, and adds the username
   * to the active users set.
   */
  async addModNote(note: ModNote): Promise<void> {
    try {
      const serialized = serializeModNote(note);

      // Store note detail
      await this.store.setString(noteDetailKey(note.noteId), serialized);

      // Add note ID to user's sorted set by timestamp
      await this.store.addToSortedSet(
        noteKey(note.targetUsername),
        note.noteId,
        note.timestamp,
      );

      // Track user as active
      await this.store.addToSet(activeUsersKey(), [note.targetUsername]);
    } catch (error) {
      console.error('[UserTracker] Failed to add mod note', {
        noteId: note.noteId,
        targetUsername: note.targetUsername,
        error,
      });
      this.enqueue({ type: 'note', data: note, queuedAt: Date.now() });
    }
  }

  // -----------------------------------------------------------------------
  // Retrieval functions (Task 5.2)
  // -----------------------------------------------------------------------

  /**
   * Retrieve a user's contribution events in reverse chronological order.
   *
   * @param username - The Reddit username.
   * @param limit    - Maximum number of events to return. Default: 10.
   */
  async getUserEvents(
    username: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<ContributionEvent[]> {
    // Get event IDs from sorted set (reverse chronological)
    const entries = await this.store.getFromSortedSet(
      eventKey(username),
      '-inf',
      '+inf',
    );

    // Apply limit
    const limited = entries.slice(0, limit);

    // Fetch and deserialize each event detail
    const events: ContributionEvent[] = [];
    for (const entry of limited) {
      const json = await this.store.getString(eventDetailKey(entry.member));
      if (json === undefined) {
        console.error('[UserTracker] Missing event detail', {
          eventId: entry.member,
          username,
        });
        continue;
      }
      const result = deserializeEvent(json);
      if (result instanceof Error) {
        console.error('[UserTracker] Failed to deserialize event', {
          eventId: entry.member,
          error: result.message,
        });
        continue;
      }
      events.push(result);
    }

    return events;
  }

  /**
   * Retrieve mod actions for a user in reverse chronological order.
   *
   * @param username - The Reddit username.
   * @param limit    - Maximum number of actions to return. Default: 10.
   */
  async getUserModActions(
    username: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<ModAction[]> {
    const entries = await this.store.getFromSortedSet(
      actionKey(username),
      '-inf',
      '+inf',
    );

    const limited = entries.slice(0, limit);

    const actions: ModAction[] = [];
    for (const entry of limited) {
      const json = await this.store.getString(actionDetailKey(entry.member));
      if (json === undefined) {
        console.error('[UserTracker] Missing action detail', {
          actionId: entry.member,
          username,
        });
        continue;
      }
      const result = deserializeModAction(json);
      if (result instanceof Error) {
        console.error('[UserTracker] Failed to deserialize mod action', {
          actionId: entry.member,
          error: result.message,
        });
        continue;
      }
      actions.push(result);
    }

    return actions;
  }

  /**
   * Retrieve all mod notes for a user in reverse chronological order.
   *
   * Unlike events and actions, mod notes have no default limit.
   */
  async getUserModNotes(username: string): Promise<ModNote[]> {
    const entries = await this.store.getFromSortedSet(
      noteKey(username),
      '-inf',
      '+inf',
    );

    const notes: ModNote[] = [];
    for (const entry of entries) {
      const json = await this.store.getString(noteDetailKey(entry.member));
      if (json === undefined) {
        console.error('[UserTracker] Missing note detail', {
          noteId: entry.member,
          username,
        });
        continue;
      }
      const result = deserializeModNote(json);
      if (result instanceof Error) {
        console.error('[UserTracker] Failed to deserialize mod note', {
          noteId: entry.member,
          error: result.message,
        });
        continue;
      }
      notes.push(result);
    }

    return notes;
  }

  // -----------------------------------------------------------------------
  // Quality Score (Task 5.3)
  // -----------------------------------------------------------------------

  /**
   * Recalculate and store the quality score for a user.
   *
   * Formula:
   *   clamp(0, 100, 50
   *     + (posts * 2)
   *     + (comments * 1)
   *     + (qualityPosts * 5)
   *     + (qualityComments * 3)
   *     + (rewards * 4)
   *     - (removals * 10)
   *     - (warnings * 15))
   *
   * Counts are derived from the user's full event and action history.
   */
  async recalculateQualityScore(username: string): Promise<number> {
    // Fetch ALL events (no limit) for counting
    const allEventEntries = await this.store.getFromSortedSet(
      eventKey(username),
      '-inf',
      '+inf',
    );

    // Count event types
    let posts = 0;
    let comments = 0;
    let qualityPosts = 0;
    let qualityComments = 0;
    let rewards = 0;

    for (const entry of allEventEntries) {
      const json = await this.store.getString(eventDetailKey(entry.member));
      if (json === undefined) continue;
      const event = deserializeEvent(json);
      if (event instanceof Error) continue;

      switch (event.eventType) {
        case 'post_created':
          posts++;
          break;
        case 'comment_created':
          comments++;
          break;
        case 'post_quality':
          qualityPosts++;
          break;
        case 'comment_quality':
          qualityComments++;
          break;
        case 'reward_granted':
          rewards++;
          break;
      }
    }

    // Fetch ALL actions (no limit) for counting
    const allActionEntries = await this.store.getFromSortedSet(
      actionKey(username),
      '-inf',
      '+inf',
    );

    let removals = 0;
    let warnings = 0;

    for (const entry of allActionEntries) {
      const json = await this.store.getString(actionDetailKey(entry.member));
      if (json === undefined) continue;
      const action = deserializeModAction(json);
      if (action instanceof Error) continue;

      switch (action.actionType) {
        case 'removal':
          removals++;
          break;
        case 'warning':
          warnings++;
          break;
      }
    }

    // Calculate score
    const raw =
      BASE_SCORE +
      posts * 2 +
      comments * 1 +
      qualityPosts * 5 +
      qualityComments * 3 +
      rewards * 4 -
      removals * 10 -
      warnings * 15;

    const score = Math.max(0, Math.min(100, raw));

    // Store the score
    const qualityScore: QualityScore = {
      username,
      score,
      lastUpdated: Date.now(),
    };

    await this.store.setString(scoreKey(username), JSON.stringify(qualityScore));

    return score;
  }

  /**
   * Get the current quality score for a user.
   *
   * Returns a default score of 50 if no score has been calculated yet.
   */
  async getQualityScore(username: string): Promise<QualityScore> {
    const json = await this.store.getString(scoreKey(username));

    if (json === undefined) {
      return {
        username,
        score: BASE_SCORE,
        lastUpdated: 0,
      };
    }

    try {
      const parsed = JSON.parse(json) as QualityScore;
      return parsed;
    } catch (error) {
      console.error('[UserTracker] Failed to parse quality score', {
        username,
        error,
      });
      return {
        username,
        score: BASE_SCORE,
        lastUpdated: 0,
      };
    }
  }

  // -----------------------------------------------------------------------
  // In-memory queue for Redis unavailability (Task 5.1)
  // -----------------------------------------------------------------------

  /**
   * Add an item to the in-memory queue and schedule a retry.
   */
  private enqueue(item: QueuedItem): void {
    this.queue.push(item);
    this.scheduleRetry();
  }

  /**
   * Schedule a retry of queued items within 60 seconds.
   */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;

    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      await this.processQueue();
    }, QUEUE_RETRY_TIMEOUT_MS);
  }

  /**
   * Process all queued items, attempting to store them again.
   * Items that fail again and are still within the retry window
   * are re-queued.
   */
  private async processQueue(): Promise<void> {
    const items = this.queue.splice(0, this.queue.length);
    const now = Date.now();

    for (const item of items) {
      // Drop items older than the retry window
      if (now - item.queuedAt > QUEUE_RETRY_TIMEOUT_MS) {
        console.error('[UserTracker] Dropping queued item past retry window', {
          type: item.type,
          queuedAt: item.queuedAt,
        });
        continue;
      }

      try {
        switch (item.type) {
          case 'event':
            await this.recordContributionEvent(item.data as ContributionEvent);
            break;
          case 'action':
            await this.recordModAction(item.data as ModAction);
            break;
          case 'note':
            await this.addModNote(item.data as ModNote);
            break;
        }
      } catch {
        // If it fails again, it will be re-enqueued by the record method
        console.error('[UserTracker] Retry failed for queued item', {
          type: item.type,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Test helpers
  // -----------------------------------------------------------------------

  /** Get the current in-memory queue length (for testing). */
  getQueueLength(): number {
    return this.queue.length;
  }

  /** Clear any pending retry timer (for cleanup in tests). */
  clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Manually trigger queue processing (for testing). */
  async processQueueManually(): Promise<void> {
    await this.processQueue();
  }
}
