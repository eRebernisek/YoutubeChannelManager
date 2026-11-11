# YoutubeChannelManager — Build Spec

Build **YoutubeChannelManager**, a personal web app where Eder signs in with his Google account and manages his **YouTube** channels end to end: channel, videos, Shorts, playlists, comments, captions, live streams and live chat, plus uploading and scheduling new videos.

The Google account owns **several YouTube channels**; a channel picker in the header switches which one is being managed (§2.1). Main channels today: **ManyTheGuy** (live streams) and **DoomerTron2000** (generated videos & Shorts). It is published for free on **GitHub Pages** the same way as https://erebernisek.github.io/startgg-manager-v2/#/.

- App / repo name: **`YoutubeChannelManager`** → `https://github.com/erebernisek/YoutubeChannelManager`
- Live site: **`https://erebernisek.github.io/YoutubeChannelManager/#/`**
- The site also serves as the **app domain** for the Google OAuth app "StreamBot" (home page, privacy policy and terms), so the app can be published to Production with no more 7-day token expiry.

Owner: Eder Rebernisek Mariano (ManyTheGuy) · São Paulo (America/Sao_Paulo) · GitHub user: `erebernisek` · contact `eder.rebernisek@gmail.com`

---

## 0. Read first: platform limits that shape the design

These come from the YouTube API itself, not from this app. Build around them instead of discovering them later.

1. **Uploads from an unaudited API project are locked to Private.** YouTube restricts every video uploaded through `videos.insert` from an API project created after 28 July 2020 to *private* until the project passes the **YouTube API Services compliance audit**. A scheduled upload (`publishAt`) will **not** go public while the project is unaudited.
   - Action: submit the audit form for project `streambot-511716` (https://support.google.com/youtube/contact/yt_api_form) once the site, privacy policy and terms are live. The audit is separate from OAuth app verification.
   - Until it's approved, the upload page shows a banner: *"Uploads stay Private until the API audit is approved. Publish them manually in YouTube Studio."*
2. **Quota is 10,000 units/day per project.** Costs differ a lot by call. Check the current table at https://developers.google.com/youtube/v3/determine_quota_cost, because YouTube changes it. Keep all costs in **one config file** (`src/app/core/quota-costs.ts`) so they're easy to update. Rough costs today:
   - Reads (`*.list`) cost 1 unit, except `search.list`, which costs 100. **Never use `search.list` for your own videos**; page through the uploads playlist with `playlistItems.list`.
   - Writes (`*.insert` / `*.update` / `*.delete`, `thumbnails.set`) cost about 50.
   - `videos.insert` is the most expensive call: plan with 1,600 and read the real value from the config.
   - **The live chat bot is the biggest quota risk.** Each `liveChatMessages.list` poll costs units, so polling every 2–3 s can use the whole day's quota in a couple of hours. See `#/chat` for the guard rails. Ask for a quota increase in the audit form if needed.
3. **Scheduling happens on YouTube's side, not in the app.** A static site can't run jobs while it's closed. So "schedule" always means: **upload now** as `private` with `status.publishAt`, and YouTube publishes it at that time. Any other future action (for example changing a title at 18:00) only runs while a tab is open. Label such actions **"runs only while this tab is open"**.
   - `publishAt` only works when the video is private and has never been published.
4. **What the API can't do** (these go in the "Do manually in YouTube Studio" checklist): pin a comment, community posts, Shorts "Related video", the game title on gaming videos, end screens and cards, profile picture, channel name/handle, and monetization settings.
5. **Custom thumbnails** need a verified channel (phone verification). They must be JPG/PNG, ≤ 2 MB, and 1280×720 is recommended. Validate before upload.
6. **`videos.update` replaces whole parts.** Sending `snippet` without `tags` deletes the tags, and `categoryId` is required. Always **read → modify → write** the full part (`snippet`, `status`, `localizations`…), never a partial object.

---

## 1. Stack (same as startgg-manager-v2)

- **Angular** (latest, standalone components, signals) + `@angular/router` with **hash routing** (`withHashLocation()`), so client routes work on Pages without rewrites.
- Static SPA, with no backend. All YouTube calls are made from the browser with the user's OAuth access token, using `fetch`/`HttpClient` against the REST endpoints (no `gapi` client library).
- Storage: `localStorage` for settings, chat commands, title/description presets, the batch posting plan and the quota log. **Never** store the access token in `localStorage`; keep it in memory, and use `sessionStorage` at most.
- Export/import settings as JSON (Settings page), because `localStorage` is per-browser and easy to lose.
- Dark theme, responsive, English UI.

### Suggested structure
```
src/app/
  core/          auth.service, youtube-api.service (one thin wrapper per resource),
                 quota.service, quota-costs.ts, time.util (São Paulo ↔ UTC)
  shared/        components (file drop, progress bar, privacy picker, date-time picker)
  features/      home, dashboard, live, chat, videos, playlists, comments,
                 captions, upload, shorts-batch, channel, settings, privacy, terms
  metadata/      md-parser.ts + md-parser.spec.ts
```

## 2. Google auth (browser)

- Use **Google Identity Services** (`https://accounts.google.com/gsi/client`) token model (`google.accounts.oauth2.initTokenClient`).
- Needs a **Web application** OAuth client in project `streambot-511716`:
  - Authorized JavaScript origins: `https://erebernisek.github.io` and `http://localhost:4200`
  - Client ID goes in `src/environments/*.ts` (it's public; there's **no client secret** in the frontend).
- Scopes:
  - `https://www.googleapis.com/auth/youtube.force-ssl` covers full management: videos, playlists, comments, captions, live, chat and channel.
  - `https://www.googleapis.com/auth/youtube.upload` covers uploads.
  - Optional later: `https://www.googleapis.com/auth/yt-analytics.readonly` for the dashboard stats in §3.
  - `youtube.force-ssl` already includes everything `youtube` grants, so don't request `youtube` too. Fewer scopes make the consent screen simpler.
- The token model gives **no refresh token**. When the access token is about to expire (~1 h), call `requestAccessToken({ prompt: '' })` again, which is silent when consent already exists. If that fails, show a "Session expired, sign in again" button. Never lose unsaved edits on expiry: keep form state and retry the call after re-auth.
- Sign-out: `google.accounts.oauth2.revoke(token)` for every channel token, then clear session state. Also offer "Forget this channel" per channel.

### 2.1 Channel picker (multiple channels on one Google account)

The Google account owns **several YouTube channels** (brand accounts), and the app must manage **any** of them, not a fixed list.

**How YouTube auth works with several channels:** an OAuth token belongs to **one channel**, the one chosen in Google's popup ("Choose an account or brand account"). `channels.list?mine=true` only returns that channel. The API can't list every channel on the account with a single token. So the app builds its channel list from the channels you've signed in to.

- **Header picker** (visible on every page after sign-in): the active channel's avatar, name and handle, plus a dropdown with:
  - every **known channel** (avatar + name), with a dot showing whether it has a valid token this session;
  - **"+ Add / switch channel"**: opens the GIS popup with `prompt: 'select_account'`. After it returns, call `channels.list?mine=true&part=snippet,contentDetails,brandingSettings` to learn which channel was picked, and add it to the known list.
- **Known channels** are saved in `localStorage` (`channels: [{ id, title, handle, avatarUrl, uploadsPlaylistId, lastUsed }]`). No tokens are saved there. Seed it with the channels in the table below so they show up before the first sign-in.
- **Switching:** keep one in-memory token per channel (`Map<channelId, token>`). Switching to a channel with a valid token is instant, with no popup. Switching to one without a token opens the popup. Show a hint: *"Pick ‹channel name› in Google's list"*, because the popup can't preselect a brand channel.
- **Wrong channel guard:** if the user picks channel B in the popup while switching to A, don't fail. Accept B, add it to the list, make it active, and show a toast saying which channel is now active.
- **Token expiry with several channels:** silent refresh can't target a specific brand channel, so after refreshing, check the channel ID with `channels.list?mine=true`. If it changed, discard that token and ask the user to pick the channel again.
- **Active channel everywhere:** every API call uses the active channel's token, and every page reloads its data when the channel changes. While an upload, batch or chat bot is running, **lock the picker**, or ask before switching, because the job must finish on the channel it started on. The page title and header show the active channel at all times, so it's always clear which channel an edit goes to.
- **Settings are per channel:** chat commands, live presets, schedule slots, default playlists, upload defaults and the batch queue are stored under the channel ID (`settings.<channelId>.*`). Settings export/import includes all channels. The quota log is **per project, not per channel**, because all channels share the same 10,000 units/day. The dashboard shows the total.
- **`#/channels` page**: manage known channels: rename the label, reorder, set a default (opened at sign-in), forget a channel, and add a short "use" note (e.g. "Live streams").
- A `.md` file can include `channel: <channel ID or handle>` in its front matter. If it doesn't match the active channel, the upload page warns and blocks until you confirm or switch.

Known channels to seed (more are added through the picker):

| Channel | Use | ID |
|---|---|---|
| ManyTheGuy | Live streams (Rivals 2 / Rivals of Aether II), VODs | `UCRoE-dG8Ds_yh0Nzvds6Iuw` |
| DoomerTron2000 (handle @DoomerBot → @DoomerTron after Nov 24, 2026) | Generated videos & Shorts | `UCGbUGZwxXcp2K5NYj4clsCQ` |

## 3. Routes / features

| Route | Feature |
|---|---|
| `#/` | **Home**: what the app is, sign-in button, links to the channels, Discord (https://discord.gg/SPYnZ5Vy7), Privacy and Terms. Must be readable without sign-in (Google checks it). |
| `#/dashboard` | Active channel and its stats (subs, views, video count from `channels.list statistics`), live status, latest 10 uploads, upcoming scheduled videos (private + `publishAt` in the future), and quota used today (estimated, resets at **midnight Pacific Time**, which is YouTube's reset, not São Paulo midnight). |
| `#/live` | **Live streams**. List upcoming, active and completed broadcasts (`liveBroadcasts.list broadcastStatus=…`). **Create/schedule** a broadcast (`liveBroadcasts.insert`) and bind it to a stream key (`liveStreams.list` / `liveBroadcasts.bind`). Edit title, description, privacy, scheduled start, thumbnail and category (`videos.update` for snippet fields, `liveBroadcasts.update` for `contentDetails`, e.g. DVR, latency, auto-start/stop). Saved **presets** (e.g. "Rivals 2 Amateur") with one-click apply. Show the stream health (`liveStreams.list part=status`). |
| `#/chat` | **Live chat bot + moderation**. While the tab is open and a broadcast is live, poll `liveChatMessages.list` and answer custom commands with `liveChatMessages.insert`. **Quota guard rails**: poll interval = `max(pollingIntervalMillis, user setting, default 10 s)`; show "units used by chat today" live; auto-pause the bot when a configurable chat budget (default 4,000 units) is reached. Commands: an editor (add/edit/delete); owner-only chat commands `!addcmd !name text`, `!editcmd`, `!delcmd`, `!settitle text`; per-command cooldown (~10 s); `!commands` is auto-generated. **Moderation** (posts as the channel owner): delete a message (`liveChatMessages.delete`), timeout/ban a user (`liveChatBans.insert`), add/remove moderators (`liveChatModerators`). Stops polling when the broadcast ends. Note: replies are posted **as the channel itself**, not as a separate bot account. |
| `#/videos` | List the channel's videos and Shorts by paging `playlistItems.list` on the uploads playlist, then `videos.list` in batches of 50 for details. Filter by privacy, type (Short/regular/VOD) and text. Edit title, description, tags, category, privacy, `publishAt`, made-for-kids, license, embeddable, language and localizations (`videos.update`). Set the thumbnail (`thumbnails.set`). **Bulk edit**: select many videos, then append/replace text in descriptions, add/remove tags, or change privacy. Show a diff preview before saving and the quota cost of the batch. "Move chapters to top of description" button. Delete a video (`videos.delete`, with a typed confirmation). |
| `#/playlists` | List, create, edit and delete playlists (`playlists.*`). Add/remove/reorder videos (`playlistItems.*`). |
| `#/comments` | Recent comment threads across the channel (`commentThreads.list allThreadsRelatedToChannelId`) or per video. Reply (`comments.insert`), edit or delete your own comments, and **moderate** (`comments.setModerationStatus`: publish, hold, reject) including the "held for review" queue. |
| `#/captions` | Per video: list caption tracks (`captions.list`), upload a `.srt`/`.vtt` (`captions.insert`), replace (`captions.update`), download (`captions.download`) and delete. |
| `#/upload` | **Upload & schedule** one video. Pick an `.mp4`/`.mov`, an optional `.jpg`/`.png` thumbnail and an optional `.md` metadata file (format in §3.1). Preview and edit every field before sending. Choose **Publish now**, **Schedule** (`privacyStatus=private` + `publishAt`; the date/time is picked in America/Sao_Paulo and sent as UTC), **Unlisted** or **Private**. Resumable upload (`uploadType=resumable`, 8 MB chunks) with a progress bar, pause/resume, and retry after a network error or token refresh. After upload: set the thumbnail, add the video to the chosen playlists, post the "Pinned comment" (`commentThreads.insert`), then show the **"Do manually in YouTube Studio"** checklist (§0.4, with a direct Studio link to the video). |
| `#/shorts-batch` | **Batch scheduler** for Shorts and videos. Drop many files at once; pair `video.mp4` + `video.md` + `video.jpg` **by file name**, plus an optional `POSTING_PLAN.md` for order. Show the queue with each item's computed `publishAt` and let the user reorder or change times. The first item can publish now; the rest go to the next free slots (default slots 00:00, 12:00, 18:00 São Paulo, editable in Settings; slots already taken by scheduled videos count as busy). Uploads run one at a time, and the queue shows the quota estimate and stops before exceeding the daily budget. **The tab must stay open until all uploads finish**; after that, YouTube handles publishing. |
| `#/channel` | Branding: upload a banner (`channelBanners.insert` + `channels.update brandingSettings`); edit the channel description, keywords, country, default language, and the trailer for unsubscribed viewers. Watermark (`watermarks.set`/`unset`). Channel sections / home page shelves (`channelSections.*`). |
| `#/channels` | Known channels: add/switch, set default, rename label, reorder, forget (§2.1). |
| `#/settings` | Per-channel (§2.1) default upload values (category, language, made-for-kids, license, default playlists per channel), schedule slots, chat bot budget, quota cost table override, and **export/import all settings as JSON**. |
| `#/privacy` | Privacy policy (also exported as a static `privacy.html`, see §5). |
| `#/terms` | Terms of service (also exported as a static `terms.html`). |

### 3.1 Metadata `.md` format

The parser must accept **both** formats below. Prefer front matter for new files; the section format keeps existing files working. Add a ready-to-copy `docs/metadata-template.md` to the repo, and unit-test the parser with both formats.

**A. YAML front matter (preferred)**
````markdown
---
title: "Rivals 2 Amateur Bracket — Top 8"
tags: [rivals 2, rivals of aether 2, smash, fighting games]
category: 20            # Gaming
privacy: scheduled      # public | unlisted | private | scheduled
publishAt: 2026-11-15 18:00   # America/Sao_Paulo; required when privacy=scheduled
channel: "@ManyTheGuy"  # optional; channel ID or handle, warns if not the active channel
playlists: ["Rivals 2 Tournaments"]
madeForKids: false
language: en
thumbnail: thumb.jpg    # optional; overrides the picked file
---

## Description
```
Full description pasted as-is.
00:00 Intro
01:23 Grand Finals
```

## Pinned comment
```
Thanks for watching! Bracket: https://start.gg/...
```
````

**B. Section format (legacy, keep supporting)**
- `## Title`: the first `> quoted` or `**bold**` line is the title.
- `## Description`: the first fenced code block, pasted as-is.
- Tags: the `Tags` table row, or a fenced comma-separated block.
- Optional "Pinned comment" fenced block.

**Defaults** (overridable in Settings): category Gaming (`20`), `selfDeclaredMadeForKids=false`, `defaultLanguage/defaultAudioLanguage=en`, license youtube, embeddable.

**Validation** (show errors before uploading): title ≤ 100 chars, no `<` `>` in title or description, description ≤ 5,000 bytes, tags total ≤ 500 chars, `publishAt` in the future, thumbnail size and type (§0.5).

## 4. Privacy policy & terms content

**Privacy policy** must include:
- App name **StreamBot / YoutubeChannelManager**, operated by Eder Rebernisek Mariano, contact `eder.rebernisek@gmail.com`.
- It uses Google OAuth and the YouTube Data API v3 only for the owner's own channels to read and update video, playlist, caption, comment and broadcast data; upload and schedule videos; set thumbnails; read, post and moderate live chat messages; post and moderate comments; and manage channel branding. If the Analytics scope is added, list it too.
- Data is processed in the user's browser only. Nothing is sent to any other server, **sold, shared, or used for ads**. Tokens are kept in browser memory or session storage only; settings live in the browser's local storage and can be cleared at any time.
- Compliance with the **Google API Services User Data Policy, including the Limited Use requirements**, with links to the [YouTube Terms of Service](https://www.youtube.com/t/terms) and the [Google Privacy Policy](https://policies.google.com/privacy). The audit (§0.1) checks for these.
- How to revoke access: https://myaccount.google.com/permissions
- Last updated date.

**Terms**: a personal, non-commercial tool provided "as is"; use must follow the YouTube Terms of Service; contact email; last updated date.

## 5. Static pages for Google (important)

Google's Branding page needs real URLs (not `#/` routes). Put plain HTML copies in `public/` so they're served as files:
- `public/privacy.html` → `https://erebernisek.github.io/YoutubeChannelManager/privacy.html`
- `public/terms.html` → `https://erebernisek.github.io/YoutubeChannelManager/terms.html`

Keep a single source for the policy text so the route and the static file can't drift apart (e.g. the `#/privacy` route renders the same HTML).

## 6. Constraints
- Never commit secrets or tokens. The OAuth **client ID** is fine to commit, but a **client secret** must never be committed. Add a `.gitignore` for `.env*` and local test files.
- Respect the YouTube API quota (§0.2). Every API call goes through `quota.service`, which logs the estimated cost; the dashboard shows the total.
- Don't automate Google sign-in; only use the official GIS popup.
- Destructive actions (delete video/playlist/caption, bulk edits) need a confirmation step.
- Handle API errors visibly: show `quotaExceeded`, `forbidden`, `invalidPublishAt` and the like as readable messages, never failing silently.

## 7. Build order (milestones)

Each milestone should be usable on its own and deployed before starting the next.

1. **Skeleton & deploy**: Angular app, routing, dark theme, Home/Privacy/Terms, static HTML pages, GitHub Pages workflow (§8). Then do the Google Cloud setup (§8.5) and submit the audit form (§0.1), since the audit takes time.
2. **Auth, channel picker & dashboard**: GIS sign-in, multi-channel picker with per-channel tokens and settings (§2.1), `#/channels`, `quota.service`, dashboard.
3. **Videos**: list, edit, thumbnails, bulk edit.
4. **Upload & schedule**: `.md` parser + tests, resumable upload, scheduling, post-upload steps.
5. **Live**: broadcasts, presets, create/schedule, stream health.
6. **Chat**: bot with quota guard rails, moderation.
7. **Shorts batch**.
8. **Playlists, comments, captions, channel branding, settings export/import**.

---

## 8. Publish to GitHub Pages (same as startgg-manager-v2)

### 8.1 Create the repo (public)
```bash
cd /var/home/many/Documents/Programing/AiStreamManager
git init -b main
gh repo create erebernisek/YoutubeChannelManager --public --source=. --remote=origin
```
(Free Pages needs a public repo on a free personal account.)

Set the commit identity for this repo only, if it should differ from the global (work) one:
```bash
git config user.name "Eder Rebernisek Mariano"
git config user.email "eder.rebernisek@gmail.com"
```

### 8.2 Pages-friendly Angular build
Project sites live under `/REPO_NAME/`, so add a `github-pages` configuration in `angular.json` with:
```json
"baseHref": "/YoutubeChannelManager/"
```
And in `package.json`:
```json
"build:pages": "ng build --configuration=github-pages"
```
Hash routing (`withHashLocation()`) must be enabled.

### 8.3 GitHub Actions workflow
Create `.github/workflows/deploy-pages.yml`:
```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm test -- --watch=false
      - run: npm run build:pages
      - name: Add .nojekyll
        run: touch dist/YoutubeChannelManager/browser/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/YoutubeChannelManager/browser

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
(The Angular project name must be `YoutubeChannelManager` so the output path matches `dist/YoutubeChannelManager/browser`. Check the action versions against startgg-manager-v2's workflow and use whichever is newer.)

### 8.4 Enable Pages (Actions source) and push
```bash
gh api repos/erebernisek/YoutubeChannelManager/pages -X POST -f build_type=workflow
git add . && git commit -m "YoutubeChannelManager initial" && git push -u origin main
```
Wait for the "Deploy GitHub Pages" action to go green, then open **https://erebernisek.github.io/YoutubeChannelManager/#/**.

Also add a `GITHUB_PAGES.md` to the repo documenting these steps.

### 8.5 Google Cloud after the site is live (project `streambot-511716`)
1. **APIs & Services → Library**: make sure **YouTube Data API v3** is enabled (and the YouTube Analytics API, if that scope is used).
2. **Clients**: create an OAuth client of type **Web application** with JS origins `https://erebernisek.github.io` and `http://localhost:4200`, then put its client ID in the environments.
3. **Branding**:
   - Application home page: `https://erebernisek.github.io/YoutubeChannelManager/`
   - Privacy policy: `https://erebernisek.github.io/YoutubeChannelManager/privacy.html`
   - Terms of service: `https://erebernisek.github.io/YoutubeChannelManager/terms.html`
   - Authorized domain: `erebernisek.github.io`
   - Do **not** upload a logo (it forces verification). Save.
4. **Data access**: add the scopes from §2.
5. **Audience** → **Publish app** → confirm. For personal use with under 100 users, OAuth verification isn't required. The consent screen will show "unverified app"; click *Advanced → Go to StreamBot*.
6. **YouTube API audit** (§0.1): submit the form to unlock public uploads and, if needed, request more quota. This is separate from step 5.

## 9. Deliverables checklist
- [ ] Angular app `YoutubeChannelManager` with all routes in §3, built in the order of §7
- [ ] `.md` metadata parser (both formats) with unit tests + `docs/metadata-template.md`
- [ ] Channel picker in the header: any number of channels, per-channel tokens and settings
- [ ] `quota.service` with a single cost table, shown on the dashboard
- [ ] `public/privacy.html` and `public/terms.html`
- [ ] Repo `erebernisek/YoutubeChannelManager` (public) with `deploy-pages.yml`
- [ ] Site live at `https://erebernisek.github.io/YoutubeChannelManager/#/`
- [ ] README + `GITHUB_PAGES.md`
- [ ] Branding page filled in and StreamBot published to Production
- [ ] YouTube API audit submitted (uploads stay private until it's approved)
