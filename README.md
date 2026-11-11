# YoutubeChannelManager

A personal web app to manage YouTube channels from the browser: sign in with Google, pick a channel,
then edit videos and Shorts, upload and schedule videos from a `.md` metadata file, and (coming next)
run live streams, the live chat bot, playlists, comments, captions and branding.

Live site: https://erebernisek.github.io/YoutubeChannelManager/#/

The full build spec is [YoutubeChannelManager.md](YoutubeChannelManager.md). Deployment and Google
Cloud setup are in [GITHUB_PAGES.md](GITHUB_PAGES.md).

## Status

| Milestone (spec §7) | State |
|---|---|
| 1. Skeleton, Home/Privacy/Terms, static policy pages, Pages workflow | Done |
| 2. Google sign-in, multi-channel picker, `#/channels`, quota tracking, dashboard | Done (needs the OAuth client ID) |
| 3. Videos: list, filters, edit, thumbnail, bulk edit, delete | Done |
| 4. Upload & schedule: `.md` parser, resumable upload, post-upload steps, settings | Done |
| 5. Live broadcasts | To do |
| 6. Live chat bot + moderation | To do |
| 7. Shorts batch scheduler | To do (slot helper is ready) |
| 8. Playlists, comments, captions, channel branding pages | To do |

## Develop

```bash
npm install
npm start          # http://localhost:4200
npm test           # unit tests (Vitest)
npm run build:pages
```

Sign-in needs the OAuth client ID in `src/environments/environment.ts` (see GITHUB_PAGES.md §3).
`http://localhost:4200` must be an authorized JavaScript origin of that client.

## How it works

- Static Angular SPA with hash routing; no backend. All calls go from the browser to the YouTube Data
  API v3 with the user's OAuth token (Google Identity Services token model).
- One access token per channel, in memory and `sessionStorage` only. Settings live in `localStorage`
  per channel and can be exported/imported from Settings.
- Every API call goes through `YoutubeApiService.request`, which logs an estimated quota cost
  (`src/app/core/quota-costs.ts`) shown on the dashboard.
- `videos.update` replaces whole parts, so edits always re-read the video and send full parts
  (`src/app/core/video.util.ts`).

## Metadata `.md`

See [docs/metadata-template.md](docs/metadata-template.md). The older section format (`## Title` with a
`> quoted` line, `## Description` code block, `| Tags | … |` table row) is still accepted.

## Important limits

- **Uploads stay Private** until the Google Cloud project passes the YouTube API audit. Set
  `apiAuditApproved: true` in the environment once it's approved, to hide the warning.
- The daily quota is 10,000 units for all channels together; an upload costs about 1,600.
- The API can't pin comments, set the Shorts related video, the game title, end screens or cards. The
  upload page lists these as a manual checklist.
