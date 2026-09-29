# Meta Organic Content Intelligence Dashboard

Production-oriented V1 dashboard for on-demand organic Facebook + Instagram performance using Meta Graph API.

## What V1 includes

- Discovers Facebook Pages available to the authenticated Meta user token.
- Detects linked Instagram professional accounts.
- Manual **SYNC META NOW** action pulls latest available Meta data.
- Facebook metrics: media views, unique media viewers, reactions, comments, shares, clicks.
- Instagram metrics: views, reach, likes, comments, shares, saves, total interactions when supported.
- Filters: client/Page, platform, date range, content type.
- KPI cards, publish-date performance chart, content signals, content leaderboard, thumbnails.
- No Meta token is ever exposed to browser JavaScript.

## Required Meta permissions

Use a fresh production token that has access to the Pages being monitored and includes the permissions needed by your approved use cases, including:

- `pages_show_list`
- `pages_read_engagement`
- `pages_read_user_content`
- `read_insights`
- `instagram_basic`
- `instagram_manage_insights`

The Instagram account must be a professional account and linked to the relevant Facebook Page for the Facebook Login-based flow used here.

## Environment variables

Create these in Vercel → Project → Settings → Environment Variables:

```env
META_USER_ACCESS_TOKEN=YOUR_FRESH_TOKEN
META_GRAPH_VERSION=v26.0
META_POST_LIMIT=25
```

**Important:** Do not reuse any token that was exposed in chat or screenshots. Generate a fresh token and store it directly in Vercel.

## Deploy on Vercel

1. Put these files in a Git repository or upload the project to Vercel.
2. Add the environment variables above.
3. Deploy/redeploy.
4. Open `/api/health` to confirm the server can authenticate to Meta.
5. Open the homepage, choose a Page, then click **SYNC META NOW**.

## API endpoints

- `GET /api/health` – validates server-side Meta authentication.
- `GET /api/accounts` – lists available Pages without exposing Page access tokens.
- `GET /api/sync?pageId=...&since=YYYY-MM-DD&until=YYYY-MM-DD` – pulls and normalizes current organic performance.

## V1 limitation / Phase 2

V1 is live-on-demand and does not persist historical snapshots. Phase 2 should add a database (e.g. Postgres/Supabase/Neon) and a scheduled sync so the dashboard can calculate follower growth, 1h/6h/24h content velocity, historical trend snapshots, and organic-to-paid relationships.
