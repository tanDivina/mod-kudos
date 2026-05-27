/**
 * Redis key generation utilities for ModKudos.
 *
 * All keys follow the `modkudos:{namespace}:{identifier}` pattern to
 * prevent collisions between different data types (Requirement 8.6).
 */

import type { RewardType } from '../types/index.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const PREFIX = 'modkudos';

// ---------------------------------------------------------------------------
// Key generators
// ---------------------------------------------------------------------------

/** Sorted set of a user's contribution events, scored by timestamp. */
export function eventKey(username: string): string {
  return `${PREFIX}:events:${username}`;
}

/** Sorted set of mod actions on a user, scored by timestamp. */
export function actionKey(username: string): string {
  return `${PREFIX}:actions:${username}`;
}

/** Sorted set of mod notes for a user, scored by timestamp. */
export function noteKey(username: string): string {
  return `${PREFIX}:notes:${username}`;
}

/** String (JSON) key for a user's current QualityScore. */
export function scoreKey(username: string): string {
  return `${PREFIX}:score:${username}`;
}

/** Idempotency key for reward deduplication. */
export function rewardIdempotencyKey(
  username: string,
  contentId: string,
  rewardType: RewardType,
): string {
  return `${PREFIX}:rewards:${username}:${contentId}:${rewardType}`;
}

/** String (JSON) key for a community metrics snapshot at a given timestamp. */
export function metricsKey(timestamp: number): string {
  return `${PREFIX}:metrics:${timestamp}`;
}

/** String (JSON) key for the most recent community metrics. */
export function metricsLatestKey(): string {
  return `${PREFIX}:metrics:latest`;
}

/** String (JSON) key for an individual event detail. */
export function eventDetailKey(eventId: string): string {
  return `${PREFIX}:event:${eventId}`;
}

/** String (JSON) key for an individual mod action detail. */
export function actionDetailKey(actionId: string): string {
  return `${PREFIX}:action:${actionId}`;
}

/** String (JSON) key for an individual mod note detail. */
export function noteDetailKey(noteId: string): string {
  return `${PREFIX}:note:${noteId}`;
}

/** Set key for all tracked (active) usernames. */
export function activeUsersKey(): string {
  return `${PREFIX}:users:active`;
}

/** String key used as a flag to prevent duplicate quality checks. */
export function qualityCheckKey(contentId: string): string {
  return `${PREFIX}:quality:check:${contentId}`;
}
