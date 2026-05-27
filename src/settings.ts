/**
 * App settings configuration for ModKudos.
 *
 * Registers all configurable fields via Devvit.addSettings() and provides
 * a typed helper to retrieve settings with defaults applied.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.6
 */

import { Devvit } from '@devvit/public-api';
import type { QualityThresholds, RewardConfig } from './types/index.js';

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

export const DEFAULT_MIN_UPVOTE_RATIO = 0.85;
export const DEFAULT_MIN_POST_SCORE = 50;
export const DEFAULT_MIN_COMMENT_SCORE = 25;
export const DEFAULT_FLAIR_ENABLED = true;
export const DEFAULT_THANK_YOU_ENABLED = true;
export const DEFAULT_RECOGNITION_POST_ENABLED = false;
export const DEFAULT_FLAIR_TEXT = 'Quality Contributor';
export const DEFAULT_THANK_YOU_TEMPLATE =
  'Thanks for your quality contribution, {{username}}! Your post/comment has been recognized: {{link}}';
export const DEFAULT_RECOGNITION_POST_TITLE =
  'Shoutout to {{username}} for a quality contribution!';
export const DEFAULT_ANALYSIS_INTERVAL_HOURS = 24;

// ---------------------------------------------------------------------------
// Register settings with Devvit
// ---------------------------------------------------------------------------

Devvit.addSettings([
  // Quality thresholds
  {
    name: 'minUpvoteRatio',
    type: 'number',
    label: 'Min Upvote Ratio',
    defaultValue: DEFAULT_MIN_UPVOTE_RATIO,
    helpText: 'Minimum upvote ratio (0.0–1.0) for a post to be classified as high-quality.',
  },
  {
    name: 'minPostScore',
    type: 'number',
    label: 'Min Post Score',
    defaultValue: DEFAULT_MIN_POST_SCORE,
    helpText: 'Minimum score (1–10000) for a post to be classified as high-quality.',
  },
  {
    name: 'minCommentScore',
    type: 'number',
    label: 'Min Comment Score',
    defaultValue: DEFAULT_MIN_COMMENT_SCORE,
    helpText: 'Minimum score (1–10000) for a comment to be classified as high-quality.',
  },

  // Reward toggles
  {
    name: 'flairEnabled',
    type: 'boolean',
    label: 'Enable Flair Reward',
    defaultValue: DEFAULT_FLAIR_ENABLED,
  },
  {
    name: 'thankYouEnabled',
    type: 'boolean',
    label: 'Enable Thank-You Message',
    defaultValue: DEFAULT_THANK_YOU_ENABLED,
  },
  {
    name: 'recognitionPostEnabled',
    type: 'boolean',
    label: 'Enable Recognition Posts',
    defaultValue: DEFAULT_RECOGNITION_POST_ENABLED,
  },

  // Reward text templates
  {
    name: 'flairText',
    type: 'string',
    label: 'Flair Text',
    defaultValue: DEFAULT_FLAIR_TEXT,
    helpText: 'Text displayed on the flair awarded to quality contributors.',
  },
  {
    name: 'thankYouTemplate',
    type: 'string',
    label: 'Thank-You Message Template',
    defaultValue: DEFAULT_THANK_YOU_TEMPLATE,
    helpText: 'Supports {{username}} and {{link}} placeholders.',
  },
  {
    name: 'recognitionPostTitle',
    type: 'string',
    label: 'Recognition Post Title',
    defaultValue: DEFAULT_RECOGNITION_POST_TITLE,
    helpText: 'Supports {{username}} placeholder.',
  },

  // Scheduling
  {
    name: 'analysisIntervalHours',
    type: 'number',
    label: 'Analysis Interval (hours)',
    defaultValue: DEFAULT_ANALYSIS_INTERVAL_HOURS,
    helpText: 'How often the Insight_Analyzer runs (1–168 hours).',
  },
]);

// ---------------------------------------------------------------------------
// Settings retrieval helper
// ---------------------------------------------------------------------------

/** The shape returned by getSettings(). */
export interface AppSettings {
  thresholds: QualityThresholds;
  rewards: RewardConfig;
  analysisIntervalHours: number;
}

/**
 * Retrieve all ModKudos settings from the Devvit context with defaults
 * applied for any values that are missing or undefined.
 */
export async function getSettings(context: { settings: { getAll: () => Promise<Record<string, unknown>> } }): Promise<AppSettings> {
  const raw = await context.settings.getAll();

  const thresholds: QualityThresholds = {
    minUpvoteRatio: toNumber(raw.minUpvoteRatio, DEFAULT_MIN_UPVOTE_RATIO),
    minPostScore: toNumber(raw.minPostScore, DEFAULT_MIN_POST_SCORE),
    minCommentScore: toNumber(raw.minCommentScore, DEFAULT_MIN_COMMENT_SCORE),
  };

  const rewards: RewardConfig = {
    flairEnabled: toBoolean(raw.flairEnabled, DEFAULT_FLAIR_ENABLED),
    flairText: toString(raw.flairText, DEFAULT_FLAIR_TEXT),
    flairCssClass: toString(raw.flairCssClass, 'quality-contributor'),
    thankYouEnabled: toBoolean(raw.thankYouEnabled, DEFAULT_THANK_YOU_ENABLED),
    thankYouTemplate: toString(raw.thankYouTemplate, DEFAULT_THANK_YOU_TEMPLATE),
    recognitionPostEnabled: toBoolean(raw.recognitionPostEnabled, DEFAULT_RECOGNITION_POST_ENABLED),
    recognitionPostTitleTemplate: toString(raw.recognitionPostTitle, DEFAULT_RECOGNITION_POST_TITLE),
  };

  const analysisIntervalHours = toNumber(raw.analysisIntervalHours, DEFAULT_ANALYSIS_INTERVAL_HOURS);

  return { thresholds, rewards, analysisIntervalHours };
}

// ---------------------------------------------------------------------------
// Internal coercion helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  return fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function toString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}
