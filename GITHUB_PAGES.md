# Publishing to GitHub Pages

The app is a static Angular build served from
`https://erebernisek.github.io/YoutubeChannelManager/`. Hash routing (`#/…`) means no server rewrites
are needed.

## 1. How the build works

- `angular.json` has a `github-pages` configuration with `"baseHref": "/YoutubeChannelManager/"`.
- `npm run build:pages` builds into `dist/YoutubeChannelManager/browser`.
- `public/privacy.html` and `public/terms.html` are copied as-is, so Google can link to real files:
  - https://erebernisek.github.io/YoutubeChannelManager/privacy.html
  - https://erebernisek.github.io/YoutubeChannelManager/terms.html

  The in-app `#/privacy` and `#/terms` routes render these same files, so edit only the HTML files.

## 2. Deploy

`.github/workflows/deploy-pages.yml` runs on every push to `main`: install, test, build, add
`.nojekyll`, upload and deploy. Pages is set to the **GitHub Actions** source:

```bash
gh api repos/erebernisek/YoutubeChannelManager/pages -X POST -f build_type=workflow
```

To deploy, push to `main` (or run the workflow manually from the Actions tab), wait for
"Deploy GitHub Pages" to go green, then open https://erebernisek.github.io/YoutubeChannelManager/#/.

## 3. Google Cloud setup (project `streambot-511716`)

Do this once the site is live.

1. **APIs & Services → Library**: enable **YouTube Data API v3**.
2. **Clients**: create an OAuth client of type **Web application** with authorized JavaScript origins
   `https://erebernisek.github.io` and `http://localhost:4200`. Put its client ID in
   `src/environments/environment.ts` (`googleClientId`), commit and push. The client ID is public;
   never commit a client secret.
3. **Branding**:
   - Application home page: `https://erebernisek.github.io/YoutubeChannelManager/`
   - Privacy policy: `https://erebernisek.github.io/YoutubeChannelManager/privacy.html`
   - Terms of service: `https://erebernisek.github.io/YoutubeChannelManager/terms.html`
   - Authorized domain: `erebernisek.github.io`
   - Don't upload a logo (it forces verification).
4. **Data access**: add the scopes `.../auth/youtube.force-ssl` and `.../auth/youtube.upload`.
5. **Audience → Publish app**. With under 100 users no verification is required; the consent screen
   shows "unverified app" → *Advanced → Go to StreamBot*.
6. **YouTube API audit**: submit https://support.google.com/youtube/contact/yt_api_form for this
   project. Until it's approved, every API upload is locked to Private. After approval, set
   `apiAuditApproved: true` in the environment. Ask for more quota in the same form if needed.
