import { describe, it, expect } from 'vitest';
import {
  getSettings,
  DEFAULT_MIN_UPVOTE_RATIO,
  DEFAULT_MIN_POST_SCORE,
  DEFAULT_MIN_COMMENT_SCORE,
  DEFAULT_FLAIR_ENABLED,
  DEFAULT_THANK_YOU_ENABLED,
  DEFAULT_RECOGNITION_POST_ENABLED,
  DEFAULT_FLAIR_TEXT,
  DEFAULT_THANK_YOU_TEMPLATE,
  DEFAULT_RECOGNITION_POST_TITLE,
  DEFAULT_ANALYSIS_INTERVAL_HOURS,
} from '../../src/settings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake Devvit context with the given raw settings. */
function fakeContext(raw: Record<string, unknown> = {}) {
  return {
    settings: {
      getAll: async () => raw,
    },
  };
}

// ---------------------------------------------------------------------------
// getSettings — defaults
// ---------------------------------------------------------------------------

describe('getSettings', () => {
  it('returns all defaults when no settings are configured', async () => {
    const result = await getSettings(fakeContext());

    expect(result.thresholds).toEqual({
      minUpvoteRatio: DEFAULT_MIN_UPVOTE_RATIO,
      minPostScore: DEFAULT_MIN_POST_SCORE,
      minCommentScore: DEFAULT_MIN_COMMENT_SCORE,
    });

    expect(result.rewards).toEqual({
      flairEnabled: DEFAULT_FLAIR_ENABLED,
      flairText: DEFAULT_FLAIR_TEXT,
      flairCssClass: 'quality-contributor',
      thankYouEnabled: DEFAULT_THANK_YOU_ENABLED,
      thankYouTemplate: DEFAULT_THANK_YOU_TEMPLATE,
      recognitionPostEnabled: DEFAULT_RECOGNITION_POST_ENABLED,
      recognitionPostTitleTemplate: DEFAULT_RECOGNITION_POST_TITLE,
    });

    expect(result.analysisIntervalHours).toBe(DEFAULT_ANALYSIS_INTERVAL_HOURS);
  });

  it('uses configured values when present', async () => {
    const result = await getSettings(
      fakeContext({
        minUpvoteRatio: 0.9,
        minPostScore: 100,
        minCommentScore: 50,
        flairEnabled: false,
        thankYouEnabled: false,
        recognitionPostEnabled: true,
        flairText: 'Top Poster',
        thankYouTemplate: 'Great job {{username}}!',
        recognitionPostTitle: 'Congrats {{username}}!',
        analysisIntervalHours: 12,
      })
    );

    expect(result.thresholds.minUpvoteRatio).toBe(0.9);
    expect(result.thresholds.minPostScore).toBe(100);
    expect(result.thresholds.minCommentScore).toBe(50);
    expect(result.rewards.flairEnabled).toBe(false);
    expect(result.rewards.thankYouEnabled).toBe(false);
    expect(result.rewards.recognitionPostEnabled).toBe(true);
    expect(result.rewards.flairText).toBe('Top Poster');
    expect(result.rewards.thankYouTemplate).toBe('Great job {{username}}!');
    expect(result.rewards.recognitionPostTitleTemplate).toBe('Congrats {{username}}!');
    expect(result.analysisIntervalHours).toBe(12);
  });

  it('falls back to defaults for NaN numeric values', async () => {
    const result = await getSettings(fakeContext({ minUpvoteRatio: NaN }));
    expect(result.thresholds.minUpvoteRatio).toBe(DEFAULT_MIN_UPVOTE_RATIO);
  });

  it('falls back to defaults for non-number numeric fields', async () => {
    const result = await getSettings(fakeContext({ minPostScore: 'not a number' }));
    expect(result.thresholds.minPostScore).toBe(DEFAULT_MIN_POST_SCORE);
  });

  it('falls back to defaults for non-boolean toggle fields', async () => {
    const result = await getSettings(fakeContext({ flairEnabled: 'yes' }));
    expect(result.rewards.flairEnabled).toBe(DEFAULT_FLAIR_ENABLED);
  });

  it('falls back to defaults for empty string text fields', async () => {
    const result = await getSettings(fakeContext({ flairText: '' }));
    expect(result.rewards.flairText).toBe(DEFAULT_FLAIR_TEXT);
  });

  it('falls back to defaults for undefined values', async () => {
    const result = await getSettings(fakeContext({ minUpvoteRatio: undefined }));
    expect(result.thresholds.minUpvoteRatio).toBe(DEFAULT_MIN_UPVOTE_RATIO);
  });
});
