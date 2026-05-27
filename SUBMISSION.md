# ModKudos — Devpost Submission

## Elevator Pitch

The first native Reddit mod tool to bring positive reinforcement to community management — automatically rewarding quality contributors while giving mods instant user context for every post and comment.

---

## Tool Overview

### The Problem

Moderation interfaces are designed almost exclusively for punitive work: removing spam, banning users, filtering toxicity. Research by Lambert et al. (2025) identified this as a critical gap — moderators want to encourage good behavior but lack the tools to do so. Their study demonstrated that positive reinforcement causally improves future content quality and reduces the likelihood of future removals. Yet no native Reddit tool exists to act on this.

ModKudos is the first Devvit app to bring the Kudos Queue concept natively to Reddit — automatic, integrated, and requiring no browser extension.

---

### Core Features

**1. Automatic Quality Detection**
ModKudos monitors every new post and comment. After a short delay (to let votes accumulate), it evaluates content against mod-configured thresholds — minimum upvote ratio and score. High-quality content is automatically flagged and added to the Kudos Queue.

**2. The Kudos Queue**
Inspired by research into positive reinforcement moderation tools (Lambert et al., 2025), the Kudos Queue is a subreddit menu action that shows mods a live list of recently detected high-quality content awaiting recognition. Mods can review it at any time and reward contributors in one click. When a user is rewarded, the item is automatically cleared from the queue.

**3. Positive Reinforcement Engine**
Three reward types, each independently toggleable in App Settings:
- **Mod Pick 🏅 flair** — awarded to the contributor's account
- **Randomized thank-you message** — a private message chosen from a pool of 5 praise templates to reduce repetition and feel personal
- **Public recognition post** — a shoutout post in the subreddit

All rewards are idempotent — the same user won't be double-rewarded for the same content.

**4. User Context Card**
Right-click any post or comment → "View User Context" → instant summary showing:
- Quality Score (0–100) with label: Poor / Fair / Good / Excellent
- Total posts, comments, removals, warnings, and rewards
- 10 most recent events in reverse chronological order
- All private mod notes

**5. Manual Mod Actions**
- **Reward User** — manually apply rewards to any post or comment author
- **Add Mod Note** — annotate users with private notes, visible in the context card
- **Create Dashboard** — generates a community health post with metrics and top contributors
- **Refresh Dashboard** — updates an existing dashboard post with fresh data

**6. Scheduled Insight Analyzer**
Runs on a configurable schedule (default: every 24 hours). Computes community-wide metrics: total posts, comments, removals, rewards, average quality score, top 10 contributors, and at-risk users (score drop > 20 points).

**7. Quality Score Formula**
```
Score = clamp(0, 100,
  50
  + posts × 2
  + comments × 1
  + quality_posts × 5
  + quality_comments × 3
  + rewards × 4
  − removals × 10
  − warnings × 15
)
```

**8. Fully Configurable**
All thresholds and reward types are configurable per subreddit via App Settings — no reinstallation needed.

---

### How Moderators Use It

1. Install the app and configure thresholds in Mod Tools → Apps → ModKudos → Settings
2. The app runs silently in the background, tracking all activity and detecting quality content
3. Open the **Kudos Queue** from the subreddit menu to see what's been flagged
4. Use **Reward User** to recognize contributors — rewards fire automatically and the item clears from the queue
5. Right-click any post → **View User Context** before acting on a report to see the full picture
6. Run **Create Dashboard** to share community health metrics with the mod team

---

## Project Impact

**r/explainlikeimfive and r/askscience**
These communities live and die by the quality of their answers. Mods spend significant time manually identifying responses worth pinning or rewarding — ModKudos automates this entirely. The Kudos Queue surfaces the best answers automatically, and the reward engine recognizes contributors with flair and a personal thank-you. Research shows this kind of positive reinforcement causally improves future content quality (Lambert et al., 2025) — exactly what these communities need to maintain their high standards at scale.

**r/depression, r/anxiety, and mental health communities**
Volunteer moderators in support communities face severe burnout because every tool they have is punitive — they only ever see the worst content. ModKudos shifts this by surfacing supportive, empathetic, constructive comments for recognition. A mod can open the Kudos Queue and spend 5 minutes rewarding the people making the community better, rather than spending an hour removing the people making it worse. The User Context Card also helps mods distinguish first-time rule-breakers from repeat offenders, leading to more compassionate and consistent moderation decisions.

**r/worldnews and high-traffic news communities**
At massive scale, quality contributions get buried under noise. ModKudos helps mods find the rare well-cited, nuanced comment worth elevating — automatically flagged by the quality detector and waiting in the Kudos Queue. Estimated time saving: a mod team reviewing 50 borderline cases per day currently spends ~2 minutes per case looking up user history. ModKudos reduces this to ~10 seconds — 95 minutes saved per day per mod team.

---

## Category

Best New Mod Tool

---

## App Listing

https://developers.reddit.com/apps/modkudos

## Reddit Username

u/No-Patient-6511

## Public Repository

https://github.com/tanDivina/mod-kudos

---

## Submission Checklist

- [x] App listing: developers.reddit.com/apps/modkudos
- [x] Tool overview with full capabilities
- [x] Project impact with 3 target communities
- [x] 195 unit tests passing
- [x] Kudos Queue menu action
- [x] View User Context with quality score and history
- [x] Reward User with idempotency and queue clearing
- [x] Add Mod Note with correct user attribution
- [x] Create/Refresh Dashboard
- [x] Scheduled Insight Analyzer (starts on AppInstall)
- [x] App Settings configurable without reinstallation
- [x] Triggers, scheduled jobs registered
- [x] GitHub repository published
- [ ] Demo video (record: Kudos Queue → View User Context → Reward User → Dashboard)
