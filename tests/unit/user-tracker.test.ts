import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserTracker } from '../../src/user-tracker/index.js';
import type {
  ContributionEvent,
  ModAction,
  ModNote,
} from '../../src/types/index.js';
import {
  serializeEvent,
  serializeModAction,
  serializeModNote,
} from '../../src/utils/serialization.js';
import {
  eventKey,
  actionKey,
  noteKey,
  scoreKey,
  eventDetailKey,
  actionDetailKey,
  noteDetailKey,
  activeUsersKey,
} from '../../src/utils/redis-keys.js';

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
      // Remove existing entry for same member
      const idx = set.findIndex((e) => e.member === member);
      if (idx !== -1) set.splice(idx, 1);
      set.push({ member, score });
      // Sort by score descending (reverse chronological)
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

type MockStore = ReturnType<typeof createMockStore>;

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
    targetUsername: 'bob',
    moderatorUsername: 'mod1',
    contentId: 't3_xyz',
    timestamp: 2000,
    reason: 'spam',
    metadata: {},
    ...overrides,
  };
}

function makeNote(overrides: Partial<ModNote> = {}): ModNote {
  return {
    noteId: 'note-1',
    targetUsername: 'carol',
    moderatorUsername: 'mod1',
    text: 'Watch this user',
    timestamp: 3000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserTracker', () => {
  let mockStore: MockStore;
  let tracker: UserTracker;

  beforeEach(() => {
    mockStore = createMockStore();
    tracker = new UserTracker(mockStore as any);
  });

  afterEach(() => {
    tracker.clearRetryTimer();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Task 5.1: Recording functions
  // -----------------------------------------------------------------------

  describe('recordContributionEvent', () => {
    it('stores event detail, adds to sorted set, and tracks active user', async () => {
      const event = makeEvent();
      await tracker.recordContributionEvent(event);

      // Event detail stored
      expect(mockStore.setString).toHaveBeenCalledWith(
        eventDetailKey('evt-1'),
        serializeEvent(event),
      );

      // Added to sorted set
      expect(mockStore.addToSortedSet).toHaveBeenCalledWith(
        eventKey('alice'),
        'evt-1',
        1000,
      );

      // Active user tracked
      expect(mockStore.addToSet).toHaveBeenCalledWith(activeUsersKey(), ['alice']);
    });

    it('recalculates quality score after recording', async () => {
      const event = makeEvent();
      await tracker.recordContributionEvent(event);

      // Score should be stored (50 base + 2 for post_created = 52)
      const scoreJson = mockStore.stringStore.get(scoreKey('alice'));
      expect(scoreJson).toBeDefined();
      const score = JSON.parse(scoreJson!);
      expect(score.score).toBe(52);
      expect(score.username).toBe('alice');
    });
  });

  describe('recordModAction', () => {
    it('stores action detail, adds to sorted set, and tracks active user', async () => {
      const action = makeAction();
      await tracker.recordModAction(action);

      expect(mockStore.setString).toHaveBeenCalledWith(
        actionDetailKey('act-1'),
        serializeModAction(action),
      );

      expect(mockStore.addToSortedSet).toHaveBeenCalledWith(
        actionKey('bob'),
        'act-1',
        2000,
      );

      expect(mockStore.addToSet).toHaveBeenCalledWith(activeUsersKey(), ['bob']);
    });

    it('recalculates quality score after recording', async () => {
      const action = makeAction({ actionType: 'warning' });
      await tracker.recordModAction(action);

      // Score: 50 - 15 (warning) = 35
      const scoreJson = mockStore.stringStore.get(scoreKey('bob'));
      expect(scoreJson).toBeDefined();
      const score = JSON.parse(scoreJson!);
      expect(score.score).toBe(35);
    });
  });

  describe('addModNote', () => {
    it('stores note detail, adds to sorted set, and tracks active user', async () => {
      const note = makeNote();
      await tracker.addModNote(note);

      expect(mockStore.setString).toHaveBeenCalledWith(
        noteDetailKey('note-1'),
        serializeModNote(note),
      );

      expect(mockStore.addToSortedSet).toHaveBeenCalledWith(
        noteKey('carol'),
        'note-1',
        3000,
      );

      expect(mockStore.addToSet).toHaveBeenCalledWith(activeUsersKey(), ['carol']);
    });

    it('does NOT recalculate quality score', async () => {
      const note = makeNote();
      await tracker.addModNote(note);

      // No score key should be set for carol (notes don't affect score)
      const scoreJson = mockStore.stringStore.get(scoreKey('carol'));
      expect(scoreJson).toBeUndefined();
    });
  });

  describe('in-memory queue on Redis failure', () => {
    it('queues event when Redis write fails', async () => {
      const failingStore = createMockStore();
      failingStore.setString.mockRejectedValue(new Error('Redis down'));
      const failTracker = new UserTracker(failingStore as any);

      const event = makeEvent();
      await failTracker.recordContributionEvent(event);

      expect(failTracker.getQueueLength()).toBe(1);
      failTracker.clearRetryTimer();
    });

    it('queues action when Redis write fails', async () => {
      const failingStore = createMockStore();
      failingStore.setString.mockRejectedValue(new Error('Redis down'));
      const failTracker = new UserTracker(failingStore as any);

      const action = makeAction();
      await failTracker.recordModAction(action);

      expect(failTracker.getQueueLength()).toBe(1);
      failTracker.clearRetryTimer();
    });

    it('queues note when Redis write fails', async () => {
      const failingStore = createMockStore();
      failingStore.setString.mockRejectedValue(new Error('Redis down'));
      const failTracker = new UserTracker(failingStore as any);

      const note = makeNote();
      await failTracker.addModNote(note);

      expect(failTracker.getQueueLength()).toBe(1);
      failTracker.clearRetryTimer();
    });

    it('processes queued items on manual retry', async () => {
      const failingStore = createMockStore();
      let callCount = 0;
      failingStore.setString.mockImplementation(async (key: string, value: string) => {
        callCount++;
        if (callCount <= 1) throw new Error('Redis down');
        failingStore.stringStore.set(key, value);
      });
      const failTracker = new UserTracker(failingStore as any);

      const event = makeEvent();
      await failTracker.recordContributionEvent(event);
      expect(failTracker.getQueueLength()).toBe(1);

      // Manually process queue (simulates retry)
      await failTracker.processQueueManually();

      // Event should now be stored
      const stored = failingStore.stringStore.get(eventDetailKey('evt-1'));
      expect(stored).toBeDefined();
      failTracker.clearRetryTimer();
    });
  });

  // -----------------------------------------------------------------------
  // Task 5.2: Retrieval functions
  // -----------------------------------------------------------------------

  describe('getUserEvents', () => {
    it('returns events in reverse chronological order', async () => {
      const e1 = makeEvent({ eventId: 'e1', timestamp: 1000 });
      const e2 = makeEvent({ eventId: 'e2', timestamp: 2000 });
      const e3 = makeEvent({ eventId: 'e3', timestamp: 3000 });

      await tracker.recordContributionEvent(e1);
      await tracker.recordContributionEvent(e2);
      await tracker.recordContributionEvent(e3);

      const events = await tracker.getUserEvents('alice');
      expect(events).toHaveLength(3);
      expect(events[0].eventId).toBe('e3');
      expect(events[1].eventId).toBe('e2');
      expect(events[2].eventId).toBe('e1');
    });

    it('respects the default limit of 10', async () => {
      for (let i = 0; i < 15; i++) {
        await tracker.recordContributionEvent(
          makeEvent({ eventId: `e${i}`, timestamp: i * 1000 }),
        );
      }

      const events = await tracker.getUserEvents('alice');
      expect(events).toHaveLength(10);
    });

    it('respects a custom limit', async () => {
      for (let i = 0; i < 5; i++) {
        await tracker.recordContributionEvent(
          makeEvent({ eventId: `e${i}`, timestamp: i * 1000 }),
        );
      }

      const events = await tracker.getUserEvents('alice', 3);
      expect(events).toHaveLength(3);
    });

    it('returns empty array for unknown user', async () => {
      const events = await tracker.getUserEvents('unknown');
      expect(events).toEqual([]);
    });

    it('skips events with missing detail keys', async () => {
      const event = makeEvent();
      await tracker.recordContributionEvent(event);

      // Delete the detail key
      mockStore.stringStore.delete(eventDetailKey('evt-1'));

      const events = await tracker.getUserEvents('alice');
      expect(events).toEqual([]);
    });
  });

  describe('getUserModActions', () => {
    it('returns actions in reverse chronological order', async () => {
      const a1 = makeAction({ actionId: 'a1', timestamp: 1000 });
      const a2 = makeAction({ actionId: 'a2', timestamp: 2000 });

      await tracker.recordModAction(a1);
      await tracker.recordModAction(a2);

      const actions = await tracker.getUserModActions('bob');
      expect(actions).toHaveLength(2);
      expect(actions[0].actionId).toBe('a2');
      expect(actions[1].actionId).toBe('a1');
    });

    it('defaults to limit of 10', async () => {
      for (let i = 0; i < 12; i++) {
        await tracker.recordModAction(
          makeAction({ actionId: `a${i}`, timestamp: i * 1000 }),
        );
      }

      const actions = await tracker.getUserModActions('bob');
      expect(actions).toHaveLength(10);
    });

    it('returns empty array for unknown user', async () => {
      const actions = await tracker.getUserModActions('unknown');
      expect(actions).toEqual([]);
    });
  });

  describe('getUserModNotes', () => {
    it('returns all notes (no limit) in reverse chronological order', async () => {
      for (let i = 0; i < 20; i++) {
        await tracker.addModNote(
          makeNote({ noteId: `n${i}`, timestamp: i * 1000 }),
        );
      }

      const notes = await tracker.getUserModNotes('carol');
      expect(notes).toHaveLength(20);
      // First note should have the highest timestamp
      expect(notes[0].noteId).toBe('n19');
    });

    it('returns empty array for unknown user', async () => {
      const notes = await tracker.getUserModNotes('unknown');
      expect(notes).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Task 5.3: Quality Score
  // -----------------------------------------------------------------------

  describe('recalculateQualityScore', () => {
    it('returns base score of 50 for user with no events', async () => {
      const score = await tracker.recalculateQualityScore('newuser');
      expect(score).toBe(50);
    });

    it('adds 2 points per post_created', async () => {
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e1', eventType: 'post_created' }),
      );
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e2', eventType: 'post_created', timestamp: 2000 }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(50 + 2 * 2); // 54
    });

    it('adds 1 point per comment_created', async () => {
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e1', eventType: 'comment_created' }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(51);
    });

    it('adds 5 points per post_quality', async () => {
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e1', eventType: 'post_quality' }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(55);
    });

    it('adds 3 points per comment_quality', async () => {
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e1', eventType: 'comment_quality' }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(53);
    });

    it('adds 4 points per reward_granted', async () => {
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e1', eventType: 'reward_granted' }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(54);
    });

    it('subtracts 10 points per removal', async () => {
      await tracker.recordModAction(
        makeAction({ actionId: 'a1', actionType: 'removal', targetUsername: 'alice' }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(40);
    });

    it('subtracts 15 points per warning', async () => {
      await tracker.recordModAction(
        makeAction({ actionId: 'a1', actionType: 'warning', targetUsername: 'alice' }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(35);
    });

    it('clamps score to minimum of 0', async () => {
      // 4 warnings = 50 - 60 = -10 → clamped to 0
      for (let i = 0; i < 4; i++) {
        await tracker.recordModAction(
          makeAction({
            actionId: `a${i}`,
            actionType: 'warning',
            targetUsername: 'alice',
            timestamp: i * 1000,
          }),
        );
      }

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(0);
    });

    it('clamps score to maximum of 100', async () => {
      // 30 posts = 50 + 60 = 110 → clamped to 100
      for (let i = 0; i < 30; i++) {
        await tracker.recordContributionEvent(
          makeEvent({ eventId: `e${i}`, timestamp: i * 1000 }),
        );
      }

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(100);
    });

    it('combines positive and negative contributions correctly', async () => {
      // 3 posts (+6), 2 comments (+2), 1 quality post (+5), 1 removal (-10), 1 warning (-15)
      // = 50 + 6 + 2 + 5 - 10 - 15 = 38
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e1', eventType: 'post_created', timestamp: 100 }),
      );
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e2', eventType: 'post_created', timestamp: 200 }),
      );
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e3', eventType: 'post_created', timestamp: 300 }),
      );
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e4', eventType: 'comment_created', timestamp: 400 }),
      );
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e5', eventType: 'comment_created', timestamp: 500 }),
      );
      await tracker.recordContributionEvent(
        makeEvent({ eventId: 'e6', eventType: 'post_quality', timestamp: 600 }),
      );
      await tracker.recordModAction(
        makeAction({
          actionId: 'a1',
          actionType: 'removal',
          targetUsername: 'alice',
          timestamp: 700,
        }),
      );
      await tracker.recordModAction(
        makeAction({
          actionId: 'a2',
          actionType: 'warning',
          targetUsername: 'alice',
          timestamp: 800,
        }),
      );

      const score = await tracker.recalculateQualityScore('alice');
      expect(score).toBe(38);
    });
  });

  describe('getQualityScore', () => {
    it('returns default score of 50 for unknown user', async () => {
      const qs = await tracker.getQualityScore('unknown');
      expect(qs.username).toBe('unknown');
      expect(qs.score).toBe(50);
      expect(qs.lastUpdated).toBe(0);
    });

    it('returns stored score after recording events', async () => {
      await tracker.recordContributionEvent(makeEvent());

      const qs = await tracker.getQualityScore('alice');
      expect(qs.username).toBe('alice');
      expect(qs.score).toBe(52);
      expect(qs.lastUpdated).toBeGreaterThan(0);
    });

    it('handles malformed score JSON gracefully', async () => {
      mockStore.stringStore.set(scoreKey('alice'), 'not-json');

      const qs = await tracker.getQualityScore('alice');
      expect(qs.username).toBe('alice');
      expect(qs.score).toBe(50);
    });
  });
});
