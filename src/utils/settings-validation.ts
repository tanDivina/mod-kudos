/**
 * Settings validation for ModKudos.
 *
 * Validates that numeric settings values fall within their acceptable ranges
 * and returns descriptive error messages for out-of-range values.
 *
 * Requirements: 7.4, 7.5
 */

// ---------------------------------------------------------------------------
// Validation result type
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

// ---------------------------------------------------------------------------
// Range definitions
// ---------------------------------------------------------------------------

/** Accepted ranges for each numeric setting. */
export const SETTING_RANGES = {
  minUpvoteRatio: { min: 0.0, max: 1.0, label: 'Min Upvote Ratio' },
  minPostScore: { min: 1, max: 10000, label: 'Min Post Score' },
  minCommentScore: { min: 1, max: 10000, label: 'Min Comment Score' },
  analysisIntervalHours: { min: 1, max: 168, label: 'Analysis Interval (hours)' },
} as const;

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

/**
 * Validate a partial settings object. Only keys present in the input are
 * checked. Returns `{ valid: true }` when all provided values are within
 * range, or `{ valid: false, errors }` with descriptive messages otherwise.
 */
export function validateSettings(
  settings: Partial<Record<string, unknown>>
): ValidationResult {
  const errors: string[] = [];

  for (const [key, range] of Object.entries(SETTING_RANGES)) {
    if (!(key in settings)) {
      continue;
    }

    const value = settings[key];

    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(`${range.label} must be a number.`);
      continue;
    }

    if (value < range.min || value > range.max) {
      errors.push(
        `${range.label} must be between ${range.min} and ${range.max} (got ${value}).`
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}
