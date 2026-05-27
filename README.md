# ModKudos

A Devvit moderation app that combines **positive reinforcement** with **user context tracking** — shifting mod workflows from purely punitive to balanced and data-driven.

## What It Does

ModKudos runs entirely on Reddit's Developer Platform and gives moderators two superpowers:

### 1. Positive Reinforcement Engine
- Automatically detects high-quality posts and comments based on configurable thresholds (upvote ratio, score)
- Rewards quality contributors with flair, thank-you messages, and recognition posts
- Mods can also manually reward any post or comment via the "Reward User" menu action
- All rewards are idempotent — the same user won't get double-rewarded for the same content

### 2. User Context Tracking
- Every post, comment, removal, warning, and reward is tracked per user within the subreddit
- Mods get a **Quality Score (0–100)** for every user, updated in real time
- "View User Context" menu action shows full history, score, stats, and mod notes — right from any post or comment
- "Add Mod Note" lets mods annotate users directly from the context card

### 3. Community Dashboard
- "Create Dashboard" generates a community health post with metrics and top contributors
- Scheduled Insight Analyzer runs daily (configurable) to compute trends, top contributors, and at-risk users

## Menu Actions

| Action | Location | What it does |
|--------|----------|--------------|
| View User Context | Post, Comment | Shows user history, quality score, stats, mod notes |
| Reward User | Post, Comment | Manually applies configured rewards to the author |
| Add Mod Note | Post, Comment | Adds a private mod note to the user's record |
| Create Dashboard | Subreddit | Creates a community health metrics post |
| Refresh Dashboard | Post | Updates an existing dashboard post |

## App Settings

All thresholds and reward types are configurable per subreddit:

- **Min Upvote Ratio** (default: 0.85) — for post quality detection
- **Min Post Score** (default: 50) — for post quality detection
- **Min Comment Score** (default: 25) — for comment quality detection
- **Enable Flair Reward** — award custom flair to quality contributors
- **Enable Thank-You Message** — send a private message to quality contributors
- **Enable Recognition Posts** — create a public shoutout post
- **Flair Text** — customize the flair text
- **Analysis Interval** (default: 24h) — how often the Insight Analyzer runs

## Quality Score Formula

```
Score = clamp(0, 100,
  50
  + posts_created × 2
  + comments_created × 1
  + quality_posts × 5
  + quality_comments × 3
  + rewards_granted × 4
  - removals × 10
  - warnings × 15
)
```

| Score | Label |
|-------|-------|
| 0–24 | Poor |
| 25–49 | Fair |
| 50–74 | Good |
| 75–100 | Excellent |

## Installation

1. Install from the [Devvit App Directory](https://developers.reddit.com/apps/mod-kudos)
2. Go to your subreddit's Mod Tools → Apps → ModKudos → Settings
3. Configure your quality thresholds and reward preferences
4. The app starts tracking immediately — no manual setup needed

## Development

```bash
npm install
npm test          # run all 195 tests
devvit login      # authenticate with Reddit
devvit playtest r/YOUR_SUBREDDIT  # test locally
devvit upload     # deploy to App Directory
```

## Why This Matters

Research shows that positive feedback leads to [2% more frequent posts and 57% higher quality contributions](https://arxiv.org/html/2409.20410v2) compared to purely punitive moderation. Yet every existing mod tool is focused on removal and banning. ModKudos is the first Devvit app to bring positive reinforcement to Reddit moderation at scale.

## Built For

Reddit Mod Tools and Migrated Apps Hackathon (April 29 – May 27, 2026)
Category: Best New Mod Tool
 