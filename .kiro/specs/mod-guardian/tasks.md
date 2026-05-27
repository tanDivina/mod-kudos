# Implementation Plan: ModGuardian

## Overview

Implement ModGuardian as a Devvit moderation app with six subsystems: Quality_Detector, Reward_Engine, User_Tracker, Context_Card, Insight_Analyzer, and Dashboard_Post. Bottom-up approach: project scaffolding and data models first, then Redis persistence, then core subsystems, then UI, then integration. TypeScript on Devvit, Redis for storage, Vitest + fast-check for testing.

## Tasks

- [x] 1. Project setup and core data models
  - [x] 1.1 Initialize Devvit project structure and configure dependencies
    - Create `devvit.yaml` with app metadata for ModGuardian
    - Install and configure Vitest and fast-check as dev dependencies
    - Create directory structure: `src/` with subdirectories for each subsystem (`quality-detector/`, `reward-engine/`, `user-tracker/`, `context-card/`, `insight-analyzer/`, `dashboard/`), plus `src/types/`, `src/utils/`, and `tests/` with `unit/` and `property/` subdirectories
    - Create `src/main.ts` as the Devvit app entry point with placeholder registrations
    - _Requirements: All (project foundation)_

  - [x] 1.2 Define core TypeScript interfaces and types
    - Create `src/types/index.ts` with all shared interfaces: `ContributionEvent`, `ModAction`, `ModNote`, `QualityScore`, `QualityCheckJobData`, `QualityThresholds`, `RewardConfig`, `RewardType`, `ContextCardData`, `CommunityMetrics`
    - Include `schemaVersion` field (default: 1) on `ContributionEvent`, `ModAction`, and `CommunityMetrics`
    - Define `QualityLabel` type and event type unions
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 8.4, 9.1, 9.3_

  - [x] 1.3 Implement serialization and deserialization utilities
    - Create `src/utils/serialization.ts` with serialize/deserialize functions for `ContributionEvent`, `ModAction`, and `ModNote`
    - Use JSON.stringify for serialization and JSON.parse with field validation for deserialization
    - On deserialization failure, log malformed data and return a descriptive error (do not throw unhandled exceptions)
    - Validate required fields (`schemaVersion`, `eventId`/`actionId`, type, username, contentId, timestamp)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7, 8.4_

  - [ ]* 1.4 Write property test for ContributionEvent serialization round-trip
    - **Property 16: ContributionEvent serialization round-trip**
    - Generate random valid `ContributionEvent` objects using fast-check arbitraries
    - Assert that `deserializeEvent(serializeEvent(event))` produces an object deeply equal to the original
    - **Validates: Requirements 9.1, 9.2, 9.5, 8.4**

  - [ ]* 1.5 Write property test for ModAction serialization round-trip
    - **Property 17: ModAction serialization round-trip**
    - Generate random valid `ModAction` objects using fast-check arbitraries
    - Assert that `deserializeModAction(serializeModAction(action))` produces an object deeply equal to the original
    - **Validates: Requirements 9.3, 9.4, 9.6, 8.4**

- [x] 2. Redis persistence layer
  - [x] 2.1 Implement Redis key generation utilities
    - Create `src/utils/redis-keys.ts` with functions generating namespaced keys following `modguardian:{namespace}:{identifier}` pattern
    - Key generators for: `eventKey(username)`, `actionKey(username)`, `noteKey(username)`, `scoreKey(username)`, `rewardIdempotencyKey(username, contentId, rewardType)`, `metricsKey(timestamp)`, `metricsLatestKey()`, `eventDetailKey(eventId)`, `actionDetailKey(actionId)`, `noteDetailKey(noteId)`, `activeUsersKey()`, `qualityCheckKey(contentId)`
    - _Requirements: 8.6_

  - [ ]* 2.2 Write property test for Redis key namespace separation
    - **Property 15: Key namespace separation**
    - Generate random data types and identifiers using fast-check
    - Assert that keys for different data types always have different namespace prefixes
    - **Validates: Requirements 8.6**

  - [x] 2.3 Implement Redis storage service
    - Create `src/utils/redis-store.ts` with a `RedisStore` class wrapping Devvit's `context.redis` API
    - Methods: `addToSortedSet`, `getFromSortedSet`, `setString`, `getString`, `setWithExpiry`, `addToSet`, `getSetMembers`
    - Retry logic: up to 3 retries with exponential backoff (1s, 2s, 4s) on write failures
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 3. Settings and validation
  - [x] 3.1 Implement app settings configuration
    - Create `src/settings.ts` using `Devvit.addSettings()` for all configurable fields: quality thresholds, reward toggles, reward text templates, analysis interval
    - Create `getSettings(context)` helper returning typed `QualityThresholds` and `RewardConfig` objects with defaults
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [x] 3.2 Implement settings validation
    - Create `src/utils/settings-validation.ts` with `validateSettings(settings)` function
    - Validate: upvote ratio 0.0–1.0, post score 1–10000, comment score 1–10000, analysis interval 1–168 hours
    - Return descriptive error messages for out-of-range values
    - _Requirements: 7.4, 7.5_

  - [ ]* 3.3 Write property test for settings validation
    - **Property 14: Settings validation**
    - Generate random numeric values across full range using fast-check
    - Assert validator accepts in-range values and rejects out-of-range values with descriptive errors
    - **Validates: Requirements 7.5**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. User_Tracker subsystem
  - [x] 5.1 Implement User_Tracker core recording functions
    - Create `src/user-tracker/index.ts` with `recordContributionEvent`, `recordModAction`, `addModNote`
    - Serialize objects, store details in string keys, add IDs to user's sorted set by timestamp
    - Add username to `modguardian:users:active` set on every record
    - Implement in-memory queue for Redis unavailability with retry within 60 seconds
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 8.1_

  - [x] 5.2 Implement User_Tracker retrieval functions
    - Add `getUserEvents`, `getUserModActions`, `getUserModNotes` to User_Tracker
    - Retrieve IDs from sorted sets in reverse chronological order, fetch and deserialize details
    - Default limit of 10 for events/actions; unlimited for mod notes
    - _Requirements: 3.1, 3.2, 3.3, 8.2_

  - [x] 5.3 Implement Quality_Score calculation
    - Add `recalculateQualityScore` and `getQualityScore` to User_Tracker
    - Formula: `clamp(0, 100, 50 + (posts*2) + (comments*1) + (qualityPosts*5) + (qualityComments*3) + (rewards*4) - (removals*10) - (warnings*15))`
    - Store score in `modguardian:score:{username}` as JSON; recalculate after each event recording
    - _Requirements: 3.5_

  - [ ]* 5.4 Write property test for Quality_Score calculation
    - **Property 7: Quality score calculation**
    - Generate random event type counts using fast-check
    - Assert computed score matches the formula with clamping to [0, 100]
    - **Validates: Requirements 3.5**

  - [ ]* 5.5 Write property test for event field preservation
    - **Property 6: Event recording preserves all required fields**
    - Generate random `ContributionEvent` and `ModAction` objects, record and retrieve them
    - Assert username, contentId, timestamp, and type fields are identical to originals
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [ ]* 5.6 Write property test for reverse chronological ordering
    - **Property 10: Reverse chronological ordering**
    - Generate random timestamped event lists, record and retrieve them
    - Assert returned list is sorted in non-increasing timestamp order
    - **Validates: Requirements 4.4, 4.5**

- [x] 6. Quality_Detector subsystem
  - [x] 6.1 Implement Quality_Detector trigger handlers and job scheduling
    - Create `src/quality-detector/index.ts` with `onPostCreate` and `onCommentCreate` trigger handlers
    - Record creation event via User_Tracker, schedule delayed quality check job via `context.scheduler.runJob()`
    - Store flag at `modguardian:quality:check:{contentId}` to prevent duplicate scheduling
    - _Requirements: 1.1, 1.2, 3.1, 3.2_

  - [x] 6.2 Implement quality evaluation logic
    - Add `evaluateQuality(context, jobData, thresholds)` to Quality_Detector
    - Posts: high-quality if `score >= minPostScore AND upvoteRatio >= minUpvoteRatio`
    - Comments: high-quality if `score >= minCommentScore`
    - On high-quality: record quality event via User_Tracker, invoke Reward_Engine
    - Retry up to 3 times with exponential backoff on Reddit API errors
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [ ]* 6.3 Write property test for content creation scheduling
    - **Property 1: Content creation schedules quality check**
    - Generate random content types, author usernames, and IDs using fast-check
    - Assert that for any post or comment creation event, a quality check job is scheduled with correct contentId, contentType, authorUsername, and createdAt
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 6.4 Write property test for quality classification correctness
    - **Property 2: Quality classification correctness**
    - Generate random scores (0–10000), upvote ratios (0.0–1.0), and thresholds using fast-check
    - Assert posts classified high-quality iff `score >= minPostScore AND upvoteRatio >= minUpvoteRatio`; comments iff `score >= minCommentScore`
    - **Validates: Requirements 1.3, 1.4**

  - [ ]* 6.5 Write property test for high-quality event recording
    - **Property 3: High-quality classification records event**
    - Generate random contributions and classification results using fast-check
    - Assert high-quality classification produces a matching event with correct username and contentId
    - **Validates: Requirements 1.5**

- [x] 7. Reward_Engine subsystem
  - [x] 7.1 Implement Reward_Engine with idempotency
    - Create `src/reward-engine/index.ts` with `applyRewards` and `applyManualReward`
    - Implement `hasRewardBeenApplied` using idempotency key `modguardian:rewards:{username}:{contentId}:{rewardType}`
    - For each enabled reward: check idempotency, apply (flair/message/recognition post), set idempotency key with 30-day TTL, record reward event
    - Handle permission errors: notify moderator, log failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 7.2 Write property test for reward configuration matching
    - **Property 4: Reward application matches configuration**
    - Generate random boolean toggles for each reward type using fast-check
    - Assert exactly the enabled reward types are applied and no disabled types
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [ ]* 7.3 Write property test for reward idempotency
    - **Property 5: Reward idempotency**
    - Generate random (username, contentId, rewardType) tuples using fast-check
    - Call applyRewards twice, assert reward executed exactly once
    - **Validates: Requirements 2.5**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Context_Card UI
  - [x] 9.1 Implement Context_Card data builder and quality label mapping
    - Create `src/context-card/index.ts` with `getQualityLabel(score)` (0–24: Poor, 25–49: Fair, 50–74: Good, 75–100: Excellent)
    - Implement `buildContextCardData(context, username)` fetching QualityScore, computing stats, retrieving 10 most recent activities and all mod notes
    - Handle empty history: return zero counts and empty arrays
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.8_

  - [x] 9.2 Implement Context_Card Devvit form rendering
    - Create `renderContextCard` as a Devvit Blocks component
    - Display: Quality_Score with label, stats summary, recent activity list (10 items), mod notes list
    - Action buttons: "Add Mod Note", "Issue Warning", "Reward User"
    - Wire buttons to User_Tracker and Reward_Engine
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 9.3 Register "View User Context" menu action
    - In `src/main.ts`, register menu action on posts and comments labeled "View User Context"
    - Handler extracts author username, calls `buildContextCardData`, displays Context_Card
    - _Requirements: 4.1_

  - [ ]* 9.4 Write property test for quality label mapping
    - **Property 8: Quality label mapping**
    - Generate random integers in [0, 100] using fast-check
    - Assert correct label for each score range
    - **Validates: Requirements 4.2**

  - [ ]* 9.5 Write property test for event stats aggregation
    - **Property 9: Event stats aggregation**
    - Generate random sets of typed events using fast-check
    - Assert stats counts match actual event type counts
    - **Validates: Requirements 4.3**

- [x] 10. Insight_Analyzer subsystem
  - [x] 10.1 Implement Insight_Analyzer scheduled job
    - Create `src/insight-analyzer/index.ts` with `runAnalysis(context, periodStart, periodEnd)`
    - Aggregate: totalPosts, totalComments, totalRemovals, totalRewards, averageQualityScore
    - Identify top 10 contributors by Quality_Score, at-risk users (score drop > 20), new high-quality contributors
    - Store metrics at `modguardian:metrics:{timestamp}` and update `modguardian:metrics:latest`
    - Register scheduled job in `src/main.ts` with configured interval
    - On failure, log error; retry at next interval
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 10.2 Implement metrics retrieval functions
    - Add `getLatestMetrics` and `getMetricsHistory` to Insight_Analyzer
    - _Requirements: 5.5, 8.3_

  - [ ]* 10.3 Write property test for community metrics computation
    - **Property 11: Community metrics computation**
    - Generate random event sets within a time period using fast-check
    - Assert counts match, average score is correct, top 10 in descending order
    - **Validates: Requirements 5.2, 5.3**

  - [ ]* 10.4 Write property test for at-risk user identification
    - **Property 12: At-risk user identification**
    - Generate random (previousScore, currentScore) pairs using fast-check
    - Assert users with drop > 20 are flagged; drop <= 20 are not
    - **Validates: Requirements 5.4**

- [x] 11. Dashboard_Post custom post
  - [x] 11.1 Implement Dashboard_Post custom post type
    - Create `src/dashboard/index.ts` with `DashboardPost` as a Devvit custom post component
    - Render: community metrics (totalPosts, totalComments, totalRemovals, totalRewards, averageQualityScore), top 10 contributors with usernames and scores
    - Labeled sections for "Community Metrics" and "Top Contributors"
    - Show "data may be stale" indicator when metrics are unavailable
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 11.2 Register dashboard menu actions
    - Register "Create Dashboard" menu action on subreddit to create a new Dashboard custom post
    - Register "Refresh Dashboard" menu action on posts to update with latest metrics
    - _Requirements: 6.1, 6.6_

  - [ ]* 11.3 Write property test for dashboard rendering completeness
    - **Property 13: Dashboard renders all required data**
    - Generate random `CommunityMetrics` objects using fast-check
    - Assert rendered output includes all required metric values and contributor data
    - **Validates: Requirements 6.2, 6.3**

- [x] 12. Integration wiring and menu actions
  - [x] 12.1 Wire all triggers and menu actions in main.ts
    - Register `PostCreate` and `CommentCreate` triggers for Quality_Detector and User_Tracker
    - Register `ModAction` trigger for post/comment removals
    - Register "Reward User" and "Add Mod Note" menu actions
    - Register all scheduled jobs (quality check, insight analysis)
    - Wire settings so updates apply without reinstallation
    - _Requirements: 2.6, 3.3, 3.4, 4.7, 7.4_

  - [x] 12.2 Implement error logging utility
    - Create `src/utils/logger.ts` with structured logging (subsystem, operation, error, IDs, retry count)
    - Integrate into all subsystem error paths
    - _Requirements: 1.6, 2.7, 3.7, 5.6, 8.5_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 4, 8, and 13 ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation order prioritizes foundational layers (types, Redis, settings) before dependent subsystems
