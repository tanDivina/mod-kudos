import { describe, it, expect, vi } from 'vitest';
import {
  serializeEvent,
  deserializeEvent,
  serializeModAction,
  deserializeModAction,
  serializeModNote,
  deserializeModNote,
} from '../../src/utils/serialization.js';
import type { ContributionEvent, ModAction, ModNote } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validEvent: ContributionEvent = {
  schemaVersion: 1,
  eventId: 'evt-001',
  eventType: 'post_created',
  username: 'testuser',
  contentId: 't3_abc123',
  timestamp: 1700000000000,
  metadata: { subreddit: 'test' },
};

const validAction: ModAction = {
  schemaVersion: 1,
  actionId: 'act-001',
  actionType: 'removal',
  targetUsername: 'baduser',
  moderatorUsername: 'moduser',
  contentId: 't3_xyz789',
  timestamp: 1700000000000,
  reason: 'Spam',
  metadata: {},
};

const validNote: ModNote = {
  noteId: 'note-001',
  targetUsername: 'someuser',
  moderatorUsername: 'moduser',
  text: 'Repeated low-quality posts',
  timestamp: 1700000000000,
};

// ---------------------------------------------------------------------------
// ContributionEvent
// ---------------------------------------------------------------------------

describe('ContributionEvent serialization', () => {
  it('serializes a valid event to JSON', () => {
    const json = serializeEvent(validEvent);
    expect(JSON.parse(json)).toEqual(validEvent);
  });

  it('round-trips a valid event', () => {
    const result = deserializeEvent(serializeEvent(validEvent));
    expect(result).toEqual(validEvent);
  });

  it('returns Error for invalid JSON', () => {
    const result = deserializeEvent('not json');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Failed to parse');
  });

  it('returns Error for non-object JSON', () => {
    const result = deserializeEvent('"just a string"');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('not an object');
  });

  it('returns Error when schemaVersion is missing', () => {
    const { schemaVersion, ...rest } = validEvent;
    const result = deserializeEvent(JSON.stringify(rest));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('schemaVersion');
  });

  it('returns Error when eventType is invalid', () => {
    const bad = { ...validEvent, eventType: 'invalid_type' };
    const result = deserializeEvent(JSON.stringify(bad));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('eventType');
  });

  it('returns Error when metadata is not an object', () => {
    const bad = { ...validEvent, metadata: 'not an object' };
    const result = deserializeEvent(JSON.stringify(bad));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('metadata');
  });

  it('returns Error when metadata has non-string values', () => {
    const bad = { ...validEvent, metadata: { key: 123 } };
    const result = deserializeEvent(JSON.stringify(bad));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('metadata');
  });

  it('logs malformed data via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    deserializeEvent('not json');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ModAction
// ---------------------------------------------------------------------------

describe('ModAction serialization', () => {
  it('serializes a valid action to JSON', () => {
    const json = serializeModAction(validAction);
    expect(JSON.parse(json)).toEqual(validAction);
  });

  it('round-trips a valid action', () => {
    const result = deserializeModAction(serializeModAction(validAction));
    expect(result).toEqual(validAction);
  });

  it('returns Error for invalid JSON', () => {
    const result = deserializeModAction('{bad');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Failed to parse');
  });

  it('returns Error when actionId is missing', () => {
    const { actionId, ...rest } = validAction;
    const result = deserializeModAction(JSON.stringify(rest));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('actionId');
  });

  it('returns Error when actionType is invalid', () => {
    const bad = { ...validAction, actionType: 'unknown' };
    const result = deserializeModAction(JSON.stringify(bad));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('actionType');
  });

  it('returns Error when reason is missing', () => {
    const { reason, ...rest } = validAction;
    const result = deserializeModAction(JSON.stringify(rest));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('reason');
  });

  it('reports all missing fields at once', () => {
    const result = deserializeModAction(JSON.stringify({}));
    expect(result).toBeInstanceOf(Error);
    const msg = (result as Error).message;
    expect(msg).toContain('schemaVersion');
    expect(msg).toContain('actionId');
    expect(msg).toContain('actionType');
    expect(msg).toContain('targetUsername');
    expect(msg).toContain('moderatorUsername');
    expect(msg).toContain('contentId');
    expect(msg).toContain('timestamp');
    expect(msg).toContain('reason');
    expect(msg).toContain('metadata');
  });
});

// ---------------------------------------------------------------------------
// ModNote
// ---------------------------------------------------------------------------

describe('ModNote serialization', () => {
  it('serializes a valid note to JSON', () => {
    const json = serializeModNote(validNote);
    expect(JSON.parse(json)).toEqual(validNote);
  });

  it('round-trips a valid note', () => {
    const result = deserializeModNote(serializeModNote(validNote));
    expect(result).toEqual(validNote);
  });

  it('returns Error for invalid JSON', () => {
    const result = deserializeModNote('');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Failed to parse');
  });

  it('returns Error when noteId is missing', () => {
    const { noteId, ...rest } = validNote;
    const result = deserializeModNote(JSON.stringify(rest));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('noteId');
  });

  it('returns Error when text is missing', () => {
    const { text, ...rest } = validNote;
    const result = deserializeModNote(JSON.stringify(rest));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('text');
  });

  it('returns Error for array input', () => {
    const result = deserializeModNote(JSON.stringify([1, 2, 3]));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('not an object');
  });
});
