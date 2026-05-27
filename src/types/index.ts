/**
 * Core TypeScript interfaces and types for ModKudos.
 *
 * All serialized objects that are persisted to Redis include a `schemaVersion`
 * field (current: 1) to support future data migrations without breaking
 * existing data.
 */

// ---------------------------------------------------------------------------
// Event type unions
// ---------------------------------------------------------------------------

/** Event types tracked as contribution events by the User_Tracker. */
export type ContributionEventType =
  | 'post_created'
  | 'comment_created'
  | 'post_quality'
  | 'comment_quality'
  | 'reward_granted';

/** Action types tracked as mod actions by the User_Tracker. */
export type ModActionType =
  | 'removal'
  | 'warning'
  | 'ban'
  | 'note'
  | 'reward';

/** Reward types that the Reward_Engine can apply. */
export type RewardType = 'flair' | 'thank_you_message' | 'recognition_post';

/** Quality label derived from a user's Quality_Score. */
export type QualityLabel = 'Poor' | 'Fair' | 'Good' | 'Excellent';

// ---------------------------------------------------------------------------
// User_Tracker data models
// ---------------------------------------------------------------------------

/** A tracked user contribution within the subreddit. */
export interface ContributionEvent {
  /** Schema version for forward-compatible deserialization. Current: 1. */
  schemaVersion: number;
  /** Unique identifier for this event. */
  eventId: string;
  /** The kind of contribution. */
  eventType: ContributionEventType;
  /** Reddit username of the contributor. */
  username: string;
  /** Reddit content ID (t3_ or t1_ prefixed). */
  contentId: string;
  /** Epoch milliseconds when the event occurred. */
  timestamp: number;
  /** Flexible extra data attached to the event. */
  metadata: Record<string, string>;
}

/** A moderator action recorded against a user. */
export interface ModAction {
  /** Schema version for forward-compatible deserialization. Current: 1. */
  schemaVersion: number;
  /** Unique identifier for this action. */
  actionId: string;
  /** The kind of moderator action. */
  actionType: ModActionType;
  /** Reddit username the action targets. */
  targetUsername: string;
  /** Reddit username of the moderator who performed the action. */
  moderatorUsername: string;
  /** Reddit content ID related to the action. */
  contentId: string;
  /** Epoch milliseconds when the action occurred. */
  timestamp: number;
  /** Human-readable reason for the action. */
  reason: string;
  /** Flexible extra data attached to the action. */
  metadata: Record<string, string>;
}

/** A free-text note left by a moderator on a user. */
export interface ModNote {
  /** Unique identifier for this note. */
  noteId: string;
  /** Reddit username the note is about. */
  targetUsername: string;
  /** Reddit username of the moderator who wrote the note. */
  moderatorUsername: string;
  /** The note text. */
  text: string;
  /** Epoch milliseconds when the note was created. */
  timestamp: number;
}

/** A user's computed quality score. */
export interface QualityScore {
  /** Reddit username. */
  username: string;
  /** Numeric score clamped to [0, 100]. */
  score: number;
  /** Epoch milliseconds when the score was last recalculated. */
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Quality_Detector
// ---------------------------------------------------------------------------

/** Payload stored when scheduling a delayed quality check job. */
export interface QualityCheckJobData {
  /** Reddit content ID (t3_ or t1_ prefixed). */
  contentId: string;
  /** Whether the content is a post or comment. */
  contentType: 'post' | 'comment';
  /** Reddit username of the content author. */
  authorUsername: string;
  /** The subreddit ID where the content was created. */
  subredditId: string;
  /** Epoch milliseconds when the content was created. */
  createdAt: number;
}

/** Configurable thresholds for quality classification. */
export interface QualityThresholds {
  /** Minimum upvote ratio (0.0–1.0) for a post to be high-quality. Default: 0.85. */
  minUpvoteRatio: number;
  /** Minimum score (1–10000) for a post to be high-quality. Default: 50. */
  minPostScore: number;
  /** Minimum score (1–10000) for a comment to be high-quality. Default: 25. */
  minCommentScore: number;
}

// ---------------------------------------------------------------------------
// Reward_Engine
// ---------------------------------------------------------------------------

/** Configuration for the reward system. */
export interface RewardConfig {
  /** Whether flair rewards are enabled. */
  flairEnabled: boolean;
  /** Text displayed on the flair. Default: "Quality Contributor". */
  flairText: string;
  /** CSS class applied to the flair. */
  flairCssClass: string;
  /** Whether thank-you message rewards are enabled. */
  thankYouEnabled: boolean;
  /** Message template supporting {{username}} and {{link}} placeholders. */
  thankYouTemplate: string;
  /** Whether recognition post rewards are enabled. */
  recognitionPostEnabled: boolean;
  /** Title template for recognition posts. */
  recognitionPostTitleTemplate: string;
}

// ---------------------------------------------------------------------------
// Context_Card
// ---------------------------------------------------------------------------

/** Aggregated data rendered in the Context_Card UI. */
export interface ContextCardData {
  /** Reddit username. */
  username: string;
  /** The user's current quality score. */
  qualityScore: QualityScore;
  /** Human-readable label derived from the quality score. */
  qualityLabel: QualityLabel;
  /** Aggregated counts of the user's activity. */
  stats: {
    totalPosts: number;
    totalComments: number;
    totalRemovals: number;
    totalWarnings: number;
    totalRewards: number;
  };
  /** The 10 most recent events/actions in reverse chronological order. */
  recentActivity: (ContributionEvent | ModAction)[];
  /** All moderator notes in reverse chronological order. */
  modNotes: ModNote[];
}

// ---------------------------------------------------------------------------
// Insight_Analyzer
// ---------------------------------------------------------------------------

/** Community-level metrics computed by the Insight_Analyzer. */
export interface CommunityMetrics {
  /** Schema version for forward-compatible deserialization. Current: 1. */
  schemaVersion: number;
  /** Epoch milliseconds when the metrics were computed. */
  timestamp: number;
  /** Start of the analysis period (epoch ms). */
  periodStart: number;
  /** End of the analysis period (epoch ms). */
  periodEnd: number;
  /** Total posts created during the period. */
  totalPosts: number;
  /** Total comments created during the period. */
  totalComments: number;
  /** Total content removals during the period. */
  totalRemovals: number;
  /** Total rewards granted during the period. */
  totalRewards: number;
  /** Mean Quality_Score across all active users. */
  averageQualityScore: number;
  /** Count of users who became high-quality contributors during the period. */
  newHighQualityContributors: number;
  /** Top 10 contributors by Quality_Score in descending order. */
  topContributors: { username: string; score: number }[];
  /** Users whose Quality_Score dropped by more than 20 points. */
  atRiskUsers: { username: string; scoreDrop: number }[];
}
