import { describe, it, expect } from 'vitest';
import { validateSettings, SETTING_RANGES } from '../../src/utils/settings-validation.js';

// ---------------------------------------------------------------------------
// Valid settings
// ---------------------------------------------------------------------------

describe('validateSettings — valid inputs', () => {
  it('accepts all settings at their minimum values', () => {
    const result = validateSettings({
      minUpvoteRatio: 0.0,
      minPostScore: 1,
      minCommentScore: 1,
      analysisIntervalHours: 1,
    });
    expect(result).toEqual({ valid: true });
  });

  it('accepts all settings at their maximum values', () => {
    const result = validateSettings({
      minUpvoteRatio: 1.0,
      minPostScore: 10000,
      minCommentScore: 10000,
      analysisIntervalHours: 168,
    });
    expect(result).toEqual({ valid: true });
  });

  it('accepts typical mid-range values', () => {
    const result = validateSettings({
      minUpvoteRatio: 0.85,
      minPostScore: 50,
      minCommentScore: 25,
      analysisIntervalHours: 24,
    });
    expect(result).toEqual({ valid: true });
  });

  it('accepts an empty settings object (nothing to validate)', () => {
    const result = validateSettings({});
    expect(result).toEqual({ valid: true });
  });

  it('ignores unknown keys', () => {
    const result = validateSettings({ unknownSetting: 'hello' });
    expect(result).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Invalid settings — out of range
// ---------------------------------------------------------------------------

describe('validateSettings — out-of-range values', () => {
  it('rejects upvote ratio below 0', () => {
    const result = validateSettings({ minUpvoteRatio: -0.1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Min Upvote Ratio');
      expect(result.errors[0]).toContain('0');
      expect(result.errors[0]).toContain('1');
    }
  });

  it('rejects upvote ratio above 1', () => {
    const result = validateSettings({ minUpvoteRatio: 1.01 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Min Upvote Ratio');
    }
  });

  it('rejects post score below 1', () => {
    const result = validateSettings({ minPostScore: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Min Post Score');
    }
  });

  it('rejects post score above 10000', () => {
    const result = validateSettings({ minPostScore: 10001 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Min Post Score');
    }
  });

  it('rejects comment score below 1', () => {
    const result = validateSettings({ minCommentScore: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Min Comment Score');
    }
  });

  it('rejects comment score above 10000', () => {
    const result = validateSettings({ minCommentScore: 10001 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Min Comment Score');
    }
  });

  it('rejects analysis interval below 1', () => {
    const result = validateSettings({ analysisIntervalHours: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Analysis Interval');
    }
  });

  it('rejects analysis interval above 168', () => {
    const result = validateSettings({ analysisIntervalHours: 169 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Analysis Interval');
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid settings — non-numeric values
// ---------------------------------------------------------------------------

describe('validateSettings — non-numeric values', () => {
  it('rejects a string value for a numeric field', () => {
    const result = validateSettings({ minPostScore: 'fifty' as unknown });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('must be a number');
    }
  });

  it('rejects NaN for a numeric field', () => {
    const result = validateSettings({ minCommentScore: NaN });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('must be a number');
    }
  });

  it('rejects null for a numeric field', () => {
    const result = validateSettings({ analysisIntervalHours: null as unknown });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('must be a number');
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple errors
// ---------------------------------------------------------------------------

describe('validateSettings — multiple errors', () => {
  it('collects errors for all invalid fields', () => {
    const result = validateSettings({
      minUpvoteRatio: -1,
      minPostScore: 0,
      minCommentScore: 99999,
      analysisIntervalHours: 200,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(4);
    }
  });
});
