import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getQualityLabel,
  buildContextCardData,
  formatActivityItem,
  formatModNote,
  buildContextCardSummary,
} from '../../src/context-card/index.js';
import type {
  ContributionEvent,
  ModAction,
  ModNote,
  QualityScore,
  ContextCardData,
} from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Mock UserTracker
// ---------------------------------------------------------------------------

function createMockUserTracker(options: {
  events?: ContributionEvent[];
  actions?: ModAction[];
  notes?: ModNote[];
  qualityScore?: QualityScore;
} = {}) {
  return {
    getQualityScore: vi.fn(async (username: string): Promise<QualityScore> => {
      return options.qualityScore ?? {
        username,
        score: 50,
        lastUpdated: 0,
      };
    }),
    getUserEvents: vi.fn(async () => options.events ?? []),
    getUserModActions: vi.fn(async () => options.actions ?? []),
    getUserModNotes: vi.fn(async () => options.notes ?? []),
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

function makeNote(overrides: Partial<ModNote> = {}): ModNote {
  return {
    noteId: 'note-1',
    targetUsername: 'alice',
    moderatorUsername: 'mod1',
    text: 'Watch this user',
    timestamp: 3000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Context_Card', () => {
  // -----------------------------------------------------------------------
  // getQualityLabel
  // -----------------------------------------------------------------------

  describe('getQualityLabel', () => {
    it('returns "Poor" for scores 0–24', () => {
      expect(getQualityLabel(0)).toBe('Poor');
      expect(getQualityLabel(12)).toBe('Poor');
      expect(getQualityLabel(24)).toBe('Poor');
    });

    it('returns "Fair" for scores 25–49', () => {
      expect(getQualityLabel(25)).toBe('Fair');
      expect(getQualityLabel(37)).toBe('Fair');
      expect(getQualityLabel(49)).toBe('Fair');
    });

    it('returns "Good" for scores 50–74', () => {
      expect(getQualityLabel(50)).toBe('Good');
      expect(getQualityLabel(62)).toBe('Good');
      expect(getQualityLabel(74)).toBe('Good');
    });

    it('returns "Excellent" for scores 75–100', () => {
      expect(getQualityLabel(75)).toBe('Excellent');
      expect(getQualityLabel(88)).toBe('Excellent');
      expect(getQualityLabel(100)).toBe('Excellent');
    });
  });

  // -----------------------------------------------------------------------
  // buildContextCardData
  // -----------------------------------------------------------------------

  describe('buildContextCardData', () => {
    it('returns zero counts and empty arrays for user with no history', async () => {
      const tracker = createMockUserTracker();
      const data = await buildContextCardData(tracker as any, 'newuser');

      expect(data.username).toBe('newuser');
      expect(data.qualityScore.score).toBe(50);
      expect(data.qualityLabel).toBe('Good');
      expect(data.stats.totalPosts).toBe(0);
      expect(data.stats.totalComments).toBe(0);
      expect(data.stats.totalRemovals).toBe(0);
      expect(data.stats.totalWarnings).toBe(0);
      expect(data.stats.totalRewards).toBe(0);
      expect(data.recentActivity).toEqual([]);
      expect(data.modNotes).toEqual([]);
    });

    it('computes correct stats from events and actions', async () => {
      const events = [
        makeEvent({ eventId: 'e1', eventType: 'post_created', timestamp: 100 }),
        makeEvent({ eventId: 'e2', eventType: 'post_created', timestamp: 200 }),
        makeEvent({ eventId: 'e3', eventType: 'comment_created', timestamp: 300 }),
        makeEvent({ eventId: 'e4', eventType: 'reward_granted', timestamp: 400 }),
      ];
      const actions = [
        makeAction({ actionId: 'a1', actionType: 'removal', timestamp: 500 }),
        makeAction({ actionId: 'a2', actionType: 'warning', timestamp: 600 }),
      ];

      const tracker = createMockUserTracker({ events, actions });
      const data = await buildContextCardData(tracker as any, 'alice');

      expect(data.stats.totalPosts).toBe(2);
      expect(data.stats.totalComments).toBe(1);
      expect(data.stats.totalRewards).toBe(1);
      expect(data.stats.totalRemovals).toBe(1);
      expect(data.stats.totalWarnings).toBe(1);
    });

    it('merges events and actions in reverse chronological order', async () => {
      const events = [
        makeEvent({ eventId: 'e1', eventType: 'post_created', timestamp: 100 }),
        makeEvent({ eventId: 'e2', eventType: 'comment_created', timestamp: 300 }),
      ];
      const actions = [
        makeAction({ actionId: 'a1', actionType: 'removal', timestamp: 200 }),
      ];

      const tracker = createMockUserTracker({ events, actions });
      const data = await buildContextCardData(tracker as any, 'alice');

      expect(data.recentActivity).toHaveLength(3);
      expect(data.recentActivity[0].timestamp).toBe(300);
      expect(data.recentActivity[1].timestamp).toBe(200);
      expect(data.recentActivity[2].timestamp).toBe(100);
    });

    it('limits recent activity to 10 items', async () => {
      const events: ContributionEvent[] = [];
      for (let i = 0; i < 15; i++) {
        events.push(makeEvent({ eventId: `e${i}`, timestamp: i * 100 }));
      }

      const tracker = createMockUserTracker({ events });
      const data = await buildContextCardData(tracker as any, 'alice');

      expect(data.recentActivity).toHaveLength(10);
    });

    it('includes all mod notes', async () => {
      const notes = [
        makeNote({ noteId: 'n1', timestamp: 100 }),
        makeNote({ noteId: 'n2', timestamp: 200 }),
        makeNote({ noteId: 'n3', timestamp: 300 }),
      ];

      const tracker = createMockUserTracker({ notes });
      const data = await buildContextCardData(tracker as any, 'alice');

      expect(data.modNotes).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // formatActivityItem
  // -----------------------------------------------------------------------

  describe('formatActivityItem', () => {
    it('formats a post_created event', () => {
      const event = makeEvent({ eventType: 'post_created', contentId: 't3_abc' });
      const result = formatActivityItem(event);
      expect(result).toContain('Post created');
    });

    it('formats a removal action', () => {
      const action = makeAction({ actionType: 'removal', moderatorUsername: 'mod1' });
      const result = formatActivityItem(action);
      expect(result).toContain('Removed');
      expect(result).toContain('mod1');
    });
  });

  // -----------------------------------------------------------------------
  // formatModNote
  // -----------------------------------------------------------------------

  describe('formatModNote', () => {
    it('formats a mod note with date, moderator, and text', () => {
      const note = makeNote({ moderatorUsername: 'mod1', text: 'Watch this user' });
      const result = formatModNote(note);
      expect(result).toContain('mod1');
      expect(result).toContain('Watch this user');
    });
  });

  // -----------------------------------------------------------------------
  // buildContextCardSummary
  // -----------------------------------------------------------------------

  describe('buildContextCardSummary', () => {
    it('includes all sections in the summary', () => {
      const data: ContextCardData = {
        username: 'alice',
        qualityScore: { username: 'alice', score: 75, lastUpdated: Date.now() },
        qualityLabel: 'Excellent',
        stats: {
          totalPosts: 10,
          totalComments: 5,
          totalRemovals: 1,
          totalWarnings: 0,
          totalRewards: 3,
        },
        recentActivity: [
          makeEvent({ eventId: 'e1', timestamp: 1000 }),
        ],
        modNotes: [
          makeNote({ noteId: 'n1', timestamp: 2000 }),
        ],
      };

      const summary = buildContextCardSummary(data);
      expect(summary).toContain('75/100');
      expect(summary).toContain('Excellent');
      expect(summary).toContain('Posts: 10');
      expect(summary).toContain('Comments: 5');
      expect(summary).toContain('Recent Activity');
      expect(summary).toContain('Mod Notes');
    });

    it('shows "No recorded history" for empty activity', () => {
      const data: ContextCardData = {
        username: 'newuser',
        qualityScore: { username: 'newuser', score: 50, lastUpdated: 0 },
        qualityLabel: 'Good',
        stats: {
          totalPosts: 0,
          totalComments: 0,
          totalRemovals: 0,
          totalWarnings: 0,
          totalRewards: 0,
        },
        recentActivity: [],
        modNotes: [],
      };

      const summary = buildContextCardSummary(data);
      expect(summary).toContain('No recorded history');
      expect(summary).toContain('No mod notes');
    });
  });
});
