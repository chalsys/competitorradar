# Competitor Post Radar

Replaces the weekly "screenshot each competitor's LinkedIn profile and retype the like counts" ritual with:

1. A **Capture Assistant** browser extension — one click on a competitor's profile logs their recent posts (text, link, media type, likes/comments/reposts) instead of screenshotting them.
2. A **dashboard** (Cloudflare Worker + D1) with a filterable feed — set a minimum like/comment/repost bar, competitor, date range, media type — plus tags, notes, and CSV export.
3. A **weekly email digest** of the top posts across tracked competitors.

## Decisions this build assumes

| Question | Decision |
|---|---|
| Automation appetite | **Human-in-the-loop.** No background scraper. The extension only ever reads a LinkedIn page you are already logged in and manually viewing — see [Compliance](#compliance-note) below. |
| Who captures | The **content marketer** runs the weekly scan across tracked competitors. |
| Digest audience | **Email** only (via [Resend](https://resend.com)). |
| Retention | **Indefinite** — there is no automatic deletion job for posts or snapshots. |

## Compliance note

LinkedIn's User Agreement prohibits automated scraping, and enforces against it. The Capture Assistant is deliberately **not** a background bot: it only parses the DOM of a profile a human has manually opened and clicked "Scan this page" on, and always shows an editable review before anything is saved. Nothing in this repo logs into LinkedIn programmatically or crawls unattended.

## Repo layout

```
competitor-post-radar (this repo)
  worker/         Cloudflare Worker: API + dashboard (static assets) + weekly digest cron
    schema.sql    D1 schema
    src/          API routes, D1 helpers, digest email
    public/       Dashboard (vanilla HTML/CSS/JS, no build step)
  extension/      Chrome extension (Manifest V3) — the Capture Assistant
```

## Deploy the worker

Prerequisites: a Cloudflare account and the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler` or use `npx wrangler`), logged in with `wrangler login`.

```bash
cd worker
npm install

# 1. Create the D1 database, then copy the printed database_id into wrangler.toml
npm run db:create

# 2. Apply the schema
npm run db:init:remote

# 3. Set the shared access token (used by both the dashboard and the extension).
#    Generate one with: openssl rand -hex 24
wrangler secret put CAPTURE_API_TOKEN

# 4. Optional but needed for the weekly email: an API key from resend.com,
#    and a FROM_EMAIL in wrangler.toml on a domain verified with Resend.
wrangler secret put RESEND_API_KEY

# 5. Deploy
npm run deploy
```

Wrangler prints your deployed URL (`https://competitor-post-radar.<your-subdomain>.workers.dev`). Open it — you'll be asked to paste the `CAPTURE_API_TOKEN` you set above once; it's remembered in the browser after that.

The weekly digest runs on the cron schedule in `wrangler.toml` (defaults to Monday 09:00 UTC — change the `[triggers]` block to your team's timezone/day). You can also trigger it on demand from the **Digest** tab's "Send now" button while testing.

If you'd rather gate the whole dashboard behind SSO instead of (or in addition to) the shared token, put it behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) — no code changes needed, since Access sits in front of the Worker's routes.

## Install the extension

1. In Chrome/Edge, go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this repo's `extension` folder.
3. Click the extension icon → **Settings** → enter:
   - **API base URL**: your deployed Worker URL from above
   - **API token**: the same `CAPTURE_API_TOKEN`
   - **Your name**: shown as who captured each post

## Weekly workflow

1. Open a tracked competitor's LinkedIn profile as you normally would.
2. Click the extension icon → **Scan this page**.
3. Review the parsed posts (LinkedIn's markup shifts periodically, so spot-check the numbers) — uncheck anything irrelevant, fix a miscounted field if needed.
4. **Log selected posts.**
5. Repeat for each competitor. Add new competitors from the dashboard's **Competitors** tab first.

Then use the **Feed** tab to filter by engagement and pull what's worth reacting to, and the **Digest** tab to configure who gets the Monday email and at what like threshold.

## Known limitation

The parser (`extension/parser.js`) matches LinkedIn's current DOM structure on a best-effort basis — LinkedIn changes this without notice, so a broken selector means a scan comes back empty or with a wrong count, not a crash. If scans stop finding posts, that file is where to update the selectors; the manual review step in the popup is the safety net in the meantime.
