/**
 * Serialization and deserialization utilities for ModKudos data models.
 *
 * Serialization uses JSON.stringify. Deserialization uses JSON.parse with
 * field validation — on failure, logs the issue via console.error and returns
 * a descriptive Error (never throws unhandled exceptions).
 */

import type {
  ContributionEvent,
  ContributionEventType,
  ModAction,
  ModActionType,
  ModNote,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Valid union values (used for runtime validation)
// ---------------------------------------------------------------------------

const VALID_EVENT_TYPES: ReadonlySet<ContributionEventType> = new Set([
  'post_created',
  'comment_created',
  'post_quality',
  'comment_quality',
  'reward_granted',
]);

const VALID_ACTION_TYPES: ReadonlySet<ModActionType> = new Set([
  'removal',
  'warning',
  'ban',
  'note',
  'reward',
]);

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Serialize a ContributionEvent to a JSON string. */
export function serializeEvent(event: ContributionEvent): string {
  return JSON.stringify(event);
}

/** Serialize a ModAction to a JSON string. */
export function serializeModAction(action: ModAction): string {
  return JSON.stringify(action);
}

/** Serialize a ModNote to a JSON string. */
export function serializeModNote(note: ModNote): string {
  return JSON.stringify(note);
}

// ---------------------------------------------------------------------------
// Deserialization helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

/**
 * Deserialize a JSON string into a ContributionEvent.
 * Returns an Error with a descriptive message on failure.
 */
export function deserializeEvent(json: string): ContributionEvent | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = `Failed to parse ContributionEvent JSON: ${(e as Error).message}`;
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  if (!isRecord(parsed)) {
    const msg = 'Invalid ContributionEvent: parsed value is not an object';
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  const missing: string[] = [];

  if (typeof parsed.schemaVersion !== 'number') missing.push('schemaVersion (number)');
  if (typeof parsed.eventId !== 'string') missing.push('eventId (string)');
  if (typeof parsed.eventType !== 'string' || !VALID_EVENT_TYPES.has(parsed.eventType as ContributionEventType)) {
    missing.push(`eventType (one of ${[...VALID_EVENT_TYPES].join(', ')})`);
  }
  if (typeof parsed.username !== 'string') missing.push('username (string)');
  if (typeof parsed.contentId !== 'string') missing.push('contentId (string)');
  if (typeof parsed.timestamp !== 'number') missing.push('timestamp (number)');
  if (!isStringRecord(parsed.metadata)) missing.push('metadata (object with string values)');

  if (missing.length > 0) {
    const msg = `Invalid ContributionEvent: missing or invalid fields: ${missing.join(', ')}`;
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  return parsed as unknown as ContributionEvent;
}

/**
 * Deserialize a JSON string into a ModAction.
 * Returns an Error with a descriptive message on failure.
 */
export function deserializeModAction(json: string): ModAction | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = `Failed to parse ModAction JSON: ${(e as Error).message}`;
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  if (!isRecord(parsed)) {
    const msg = 'Invalid ModAction: parsed value is not an object';
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  const missing: string[] = [];

  if (typeof parsed.schemaVersion !== 'number') missing.push('schemaVersion (number)');
  if (typeof parsed.actionId !== 'string') missing.push('actionId (string)');
  if (typeof parsed.actionType !== 'string' || !VALID_ACTION_TYPES.has(parsed.actionType as ModActionType)) {
    missing.push(`actionType (one of ${[...VALID_ACTION_TYPES].join(', ')})`);
  }
  if (typeof parsed.targetUsername !== 'string') missing.push('targetUsername (string)');
  if (typeof parsed.moderatorUsername !== 'string') missing.push('moderatorUsername (string)');
  if (typeof parsed.contentId !== 'string') missing.push('contentId (string)');
  if (typeof parsed.timestamp !== 'number') missing.push('timestamp (number)');
  if (typeof parsed.reason !== 'string') missing.push('reason (string)');
  if (!isStringRecord(parsed.metadata)) missing.push('metadata (object with string values)');

  if (missing.length > 0) {
    const msg = `Invalid ModAction: missing or invalid fields: ${missing.join(', ')}`;
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  return parsed as unknown as ModAction;
}

/**
 * Deserialize a JSON string into a ModNote.
 * Returns an Error with a descriptive message on failure.
 */
export function deserializeModNote(json: string): ModNote | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = `Failed to parse ModNote JSON: ${(e as Error).message}`;
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  if (!isRecord(parsed)) {
    const msg = 'Invalid ModNote: parsed value is not an object';
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  const missing: string[] = [];

  if (typeof parsed.noteId !== 'string') missing.push('noteId (string)');
  if (typeof parsed.targetUsername !== 'string') missing.push('targetUsername (string)');
  if (typeof parsed.moderatorUsername !== 'string') missing.push('moderatorUsername (string)');
  if (typeof parsed.text !== 'string') missing.push('text (string)');
  if (typeof parsed.timestamp !== 'number') missing.push('timestamp (number)');

  if (missing.length > 0) {
    const msg = `Invalid ModNote: missing or invalid fields: ${missing.join(', ')}`;
    console.error(msg, { rawData: json.slice(0, 200) });
    return new Error(msg);
  }

  return parsed as unknown as ModNote;
}
