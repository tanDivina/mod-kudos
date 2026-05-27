# Requirements Document

## Introduction

ModGuardian is a Devvit (Reddit Developer Platform) moderation app that combines positive reinforcement with user context tracking. It automatically detects high-quality community contributions, lets moderators reward good behavior, tracks user history within a subreddit, and provides a comprehensive user context card for informed moderation decisions. The app targets the "Best New Mod Tool" category of the Reddit Mod Tools and Migrated Apps Hackathon (April 29 – May 27, 2026).

ModGuardian addresses two core problems: moderator burnout from purely punitive workflows, and repeat-offender blindness caused by lack of persistent user context. By surfacing positive contributions and providing full user history at the point of decision, ModGuardian helps mods make fairer, faster calls while fostering a healthier community culture.

## Glossary

- **ModGuardian**: The Devvit application comprising all subsystems described in this document
- **Quality_Detector**: The subsystem that analyzes posts and comments to identify high-quality contributions based on configurable thresholds
- **Reward_Engine**: The subsystem that applies rewards (flair, recognition posts, thank-you messages) to users who make high-quality contributions
- **User_Tracker**: The subsystem that records and retrieves user interaction history within a subreddit, including warnings, removals, positive contributions, and mod notes
- **Context_Card**: The UI panel displayed via menu action that shows a user's full interaction history and quality score within the subreddit
- **Insight_Analyzer**: The subsystem that runs scheduled jobs to compute community-level patterns and surface moderation insights
- **Dashboard_Post**: A custom Reddit post created by ModGuardian that displays community health metrics and top contributor recognition
- **Quality_Score**: A numeric score (0–100) assigned to a user based on their contribution history within the subreddit
- **Contribution_Event**: Any tracked user action within the subreddit, including post creation, comment creation, post removal, comment removal, warning issued, or reward granted
- **Recognition_Post**: A custom post created by the Reward_Engine to publicly recognize high-quality contributors
- **Mod_Action**: Any moderator action tracked by the User_Tracker, including warnings, removals, bans, and rewards
- **App_Settings**: The Devvit app settings page where moderators configure thresholds, reward types, and scheduling preferences
- **Redis_Store**: The Devvit Redis-based persistent storage used by ModGuardian for all user data and community metrics

## Requirements

### Requirement 1: Detect High-Quality Contributions

**User Story:** As a moderator, I want the app to automatically identify high-quality posts and comments, so that I can recognize valuable community members without manually scanning every submission.

#### Acceptance Criteria

1. WHEN a new post is created in the subreddit, THE Quality_Detector SHALL evaluate the post against configured quality thresholds within 60 seconds of the post receiving its first 10 votes
2. WHEN a new comment is created in the subreddit, THE Quality_Detector SHALL evaluate the comment against configured quality thresholds within 60 seconds of the comment receiving its first 5 votes
3. THE Quality_Detector SHALL classify a post as high-quality when the post's upvote ratio meets or exceeds the configured minimum upvote ratio threshold AND the post's score meets or exceeds the configured minimum score threshold
4. THE Quality_Detector SHALL classify a comment as high-quality when the comment's score meets or exceeds the configured minimum comment score threshold
5. WHEN the Quality_Detector classifies a contribution as high-quality, THE Quality_Detector SHALL record the classification as a Contribution_Event in the Redis_Store
6. IF the Quality_Detector fails to evaluate a contribution due to a Reddit API error, THEN THE Quality_Detector SHALL retry the evaluation up to 3 times with exponential backoff and log the failure

### Requirement 2: Reward High-Quality Contributors

**User Story:** As a moderator, I want to reward users who make high-quality contributions, so that positive behavior is reinforced and the community culture improves.

#### Acceptance Criteria

1. WHEN the Quality_Detector classifies a contribution as high-quality, THE Reward_Engine SHALL apply the configured reward actions to the contributing user
2. WHERE the flair reward is enabled, THE Reward_Engine SHALL assign the configured custom flair text and CSS class to the contributing user
3. WHERE the thank-you message reward is enabled, THE Reward_Engine SHALL send a private message to the contributing user containing the configured thank-you message template with the contribution link
4. WHERE the recognition post reward is enabled, THE Reward_Engine SHALL create a Recognition_Post highlighting the contribution and the contributing user
5. THE Reward_Engine SHALL not apply the same reward type to the same user for the same contribution more than once
6. WHEN a moderator selects the "Reward User" menu action on a post or comment, THE Reward_Engine SHALL apply the configured reward actions to the author of the selected content
7. IF the Reward_Engine fails to apply a reward due to insufficient permissions, THEN THE Reward_Engine SHALL notify the invoking moderator of the missing permission and log the failure

### Requirement 3: Track User Interaction History

**User Story:** As a moderator, I want to see a user's full interaction history within my subreddit, so that I can make informed moderation decisions based on patterns rather than isolated incidents.

#### Acceptance Criteria

1. WHEN a post is created in the subreddit, THE User_Tracker SHALL record the post creation as a Contribution_Event in the Redis_Store with the timestamp, post ID, and author username
2. WHEN a comment is created in the subreddit, THE User_Tracker SHALL record the comment creation as a Contribution_Event in the Redis_Store with the timestamp, comment ID, and author username
3. WHEN a post or comment is removed by a moderator, THE User_Tracker SHALL record the removal as a Mod_Action in the Redis_Store with the timestamp, content ID, author username, and removing moderator username
4. WHEN a moderator adds a mod note to a user via ModGuardian, THE User_Tracker SHALL store the note text, author moderator username, target username, and timestamp in the Redis_Store
5. THE User_Tracker SHALL maintain a running Quality_Score for each tracked user, recalculated each time a new Contribution_Event or Mod_Action is recorded for that user
6. THE User_Tracker SHALL retain user interaction data in the Redis_Store for a minimum of 365 days from the date of the most recent recorded event for that user
7. IF the Redis_Store is unavailable when recording an event, THEN THE User_Tracker SHALL queue the event in memory and retry storage within 60 seconds

### Requirement 4: Display User Context Card

**User Story:** As a moderator, I want to view a comprehensive user profile card from any post or comment, so that I can quickly understand a user's history before making a moderation decision.

#### Acceptance Criteria

1. WHEN a moderator selects the "View User Context" menu action on a post or comment, THE ModGuardian SHALL display a Context_Card for the author of the selected content
2. THE Context_Card SHALL display the user's current Quality_Score as a numeric value (0–100) and a corresponding label (Poor, Fair, Good, Excellent)
3. THE Context_Card SHALL display the total count of the user's posts, comments, removals, warnings, and rewards within the subreddit
4. THE Context_Card SHALL display the 10 most recent Contribution_Events and Mod_Actions for the user in reverse chronological order
5. THE Context_Card SHALL display all moderator notes associated with the user in reverse chronological order
6. WHEN the Context_Card is displayed, THE ModGuardian SHALL load and render the Context_Card data within 3 seconds of the menu action selection
7. THE Context_Card SHALL provide action buttons allowing the moderator to add a mod note, issue a warning, or reward the user directly from the card
8. IF no interaction history exists for the user, THEN THE Context_Card SHALL display a message indicating the user has no recorded history in the subreddit

### Requirement 5: Analyze Community Patterns

**User Story:** As a moderator, I want periodic insights into community health and contributor patterns, so that I can identify trends and adjust moderation strategy proactively.

#### Acceptance Criteria

1. THE Insight_Analyzer SHALL run a scheduled analysis job at the interval configured in App_Settings (default: once per day)
2. WHEN the scheduled analysis job runs, THE Insight_Analyzer SHALL compute the following community metrics for the configured analysis period: total posts, total comments, total removals, total rewards granted, average Quality_Score across active users, and count of new high-quality contributors
3. WHEN the scheduled analysis job runs, THE Insight_Analyzer SHALL identify the top 10 contributors by Quality_Score for the analysis period
4. WHEN the scheduled analysis job runs, THE Insight_Analyzer SHALL identify users whose Quality_Score has decreased by more than 20 points in the analysis period as "at-risk" users
5. THE Insight_Analyzer SHALL store computed metrics in the Redis_Store with a timestamp for historical comparison
6. IF the scheduled analysis job fails to complete, THEN THE Insight_Analyzer SHALL log the failure reason and retry at the next scheduled interval

### Requirement 6: Display Community Dashboard

**User Story:** As a moderator, I want a community dashboard post that shows health metrics and top contributors, so that the mod team and community can see the state of the subreddit at a glance.

#### Acceptance Criteria

1. WHEN a moderator invokes the "Create Dashboard" menu action, THE ModGuardian SHALL create a Dashboard_Post as a custom Devvit post in the subreddit
2. THE Dashboard_Post SHALL display the most recent community metrics computed by the Insight_Analyzer, including total posts, total comments, total removals, total rewards, and average Quality_Score
3. THE Dashboard_Post SHALL display the current top 10 contributors by Quality_Score with their usernames and scores
4. WHEN a user views the Dashboard_Post, THE ModGuardian SHALL render the dashboard with data no older than the most recent completed analysis job
5. THE Dashboard_Post SHALL be visually structured with labeled sections for community metrics and top contributors
6. WHEN a moderator invokes the "Refresh Dashboard" menu action on an existing Dashboard_Post, THE ModGuardian SHALL update the Dashboard_Post content with the latest available metrics

### Requirement 7: Configure App Settings

**User Story:** As a moderator, I want to configure detection thresholds, reward types, and scheduling preferences, so that ModGuardian adapts to my subreddit's specific needs.

#### Acceptance Criteria

1. THE App_Settings SHALL provide configurable fields for: minimum upvote ratio threshold (default: 0.85), minimum post score threshold (default: 50), minimum comment score threshold (default: 25), and analysis job interval (default: 24 hours)
2. THE App_Settings SHALL provide toggles to enable or disable each reward type independently: flair reward, thank-you message reward, and recognition post reward
3. THE App_Settings SHALL provide configurable text fields for: custom flair text (default: "Quality Contributor"), thank-you message template, and recognition post title template
4. WHEN a moderator saves changes to App_Settings, THE ModGuardian SHALL apply the updated settings to all subsequent Quality_Detector evaluations, Reward_Engine actions, and Insight_Analyzer jobs without requiring app reinstallation
5. THE App_Settings SHALL validate that numeric threshold values are within acceptable ranges (upvote ratio: 0.0–1.0, post score: 1–10000, comment score: 1–10000, analysis interval: 1–168 hours) and reject invalid values with a descriptive error message
6. IF a moderator has not configured App_Settings after installation, THEN THE ModGuardian SHALL operate using the default values specified in each setting

### Requirement 8: Persist Data Reliably

**User Story:** As a moderator, I want all user data and metrics to be stored reliably, so that historical context is preserved across app restarts and Reddit platform updates.

#### Acceptance Criteria

1. THE Redis_Store SHALL store all Contribution_Events, Mod_Actions, Quality_Scores, moderator notes, and community metrics as structured data with consistent key naming conventions
2. THE Redis_Store SHALL support retrieval of all Contribution_Events and Mod_Actions for a given username within 2 seconds for users with up to 1000 recorded events
3. THE Redis_Store SHALL support retrieval of community metrics for a given date range within 2 seconds
4. WHEN storing a Contribution_Event or Mod_Action, THE Redis_Store SHALL include a schema version identifier to support future data migration
5. IF a Redis_Store write operation fails, THEN THE ModGuardian SHALL retry the write up to 3 times before logging the failure
6. THE Redis_Store SHALL use namespaced keys to prevent collisions between different data types (events, scores, metrics, notes, settings)

### Requirement 9: Serialize and Deserialize User Data

**User Story:** As a developer, I want user data to be reliably serialized to and deserialized from Redis, so that no data is lost or corrupted during storage and retrieval.

#### Acceptance Criteria

1. THE ModGuardian SHALL serialize Contribution_Event objects to JSON format before storing them in the Redis_Store
2. THE ModGuardian SHALL deserialize JSON strings from the Redis_Store back into Contribution_Event objects upon retrieval
3. THE ModGuardian SHALL serialize Mod_Action objects to JSON format before storing them in the Redis_Store
4. THE ModGuardian SHALL deserialize JSON strings from the Redis_Store back into Mod_Action objects upon retrieval
5. FOR ALL valid Contribution_Event objects, serializing to JSON then deserializing back SHALL produce an object equivalent to the original (round-trip property)
6. FOR ALL valid Mod_Action objects, serializing to JSON then deserializing back SHALL produce an object equivalent to the original (round-trip property)
7. IF a JSON string from the Redis_Store fails to deserialize into the expected object type, THEN THE ModGuardian SHALL log the malformed data and return a descriptive error rather than crashing
