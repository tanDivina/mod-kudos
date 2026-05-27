# ModKudos — Devpost Submission

## Tool Overview

ModKudos is a Devvit moderation app that solves two of the biggest pain points in Reddit moderation:

**Problem 1: Mod burnout from purely punitive workflows.**
Every existing mod tool is about removal, banning, and warnings. Moderators spend hours in the modqueue dealing with the worst content, with no tools to recognize or encourage the good. Academic research (Cornell, CMU) shows that positive feedback leads to 57% higher quality contributions and 2% more frequent posting — yet no practical tool exists to act on this.

**Problem 2: Repeat-offender blindness.**
Mods make decisions in isolation. When a borderline post comes in, there's no quick way to see if this user has a history of removals, warnings, or quality contributions. Each decision is made without context.

**ModKudos solves both.**

### Core Features

**Automatic Quality Detection**
ModKudos monitors every new post and comment. After a configurable delay (to let votes accumulate), it evaluates content against mod-configured thresholds (upvote ratio, score). High-quality content triggers the reward pipeline automatically.

**Positive Reinforcement Engine**
Three reward types, each independently toggleable:
- Custom flair awarded to the contributor
- Private thank-you message with a link to their contribution
- Public recognition post in the subreddit

All rewards are idempotent — the same user won't be double-rewarded for the same content.

**User Context Card**
Right-click any post or comment → "View User Context" → instant summary:
- Quality Score (0–100) with label (Poor / Fair / Good / Excellent)
- Stats: total posts, comments, removals, warnings, rewards
- 10 most recent events in reverse chronological order
- All mod notes

**Manual Mod Actions**
- "Reward User" — manually apply rewards to any post/comment author
- "Add Mod Note" — annotate users with private notes, visible in the context card

**Community Dashboard**
- "Create Dashboard" generates a community health post with metrics and top contributors
- Scheduled Insight Analyzer (configurable interval, default 24h) computes: total posts/comments/removals/rewards, average quality score, top 10 contributors, at-risk users (score drop > 20 points)

**Fully Configurable**
All thresholds and reward types are configurable per subreddit via App Settings — no code changes needed.

### How Moderators Use It

1. Install the app and configure thresholds in App Settings
2. The app runs silently in the background, tracking all activity
3. When a quality contribution is detected, rewards fire automatically
4. When reviewing a report, right-click → "View User Context" to see the full picture before acting
5. Run "Create Dashboard" monthly to share community health with the mod team

---

## Project Impact

**r/AskReddit and large Q&A subreddits**
These communities live and die by quality answers. ModKudos can automatically identify and reward the most helpful responses, encouraging the behavior that makes these communities valuable. Mods save time by having user context at their fingertips instead of manually checking post history.

**r/science, r/explainlikeimfive, and educational subreddits**
These communities have strict quality standards. ModKudos's quality detection helps surface the best contributions for recognition, while the user context card helps mods quickly identify repeat rule-breakers vs. first-time mistakes — leading to fairer, more consistent moderation.

**Growing communities (1k–100k members)**
Small mod teams with limited time benefit most from automation. ModKudos handles the positive reinforcement loop automatically, freeing mods to focus on the hard cases. The community dashboard gives small teams visibility into health trends they'd otherwise miss entirely.

**Estimated time savings:** A mod team reviewing 50 borderline cases per day currently spends ~2 minutes per case looking up user history. ModKudos reduces this to ~10 seconds (one click). That's 95 minutes saved per day per mod team.

---

## Category

Best New Mod Tool

---

## Submission Checklist

- [x] App listing: developers.reddit.com/apps/mod-kudos
- [x] Tool overview with full capabilities
- [x] Project impact with 3 target communities
- [x] 195 unit tests passing
- [x] All menu actions functional
- [x] App Settings configurable without reinstallation
- [x] Triggers, scheduled jobs, and custom post type registered
- [ ] Demo video (record a <1 min video showing: View User Context, Reward User, Create Dashboard)
