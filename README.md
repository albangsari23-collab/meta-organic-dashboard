# Meta Organic Performance Dashboard

Production dashboard for on-demand Facebook + Instagram organic performance using Meta Graph API.

## Production auth strategy

The dashboard supports three credential layers, in this order:

1. **Permanent Page access tokens** via `META_PAGE_TOKENS_JSON` — preferred when Pages are managed individually.
2. **Meta Business System User token** via `META_SYSTEM_USER_ACCESS_TOKEN` + `META_BUSINESS_ID` — preferred when assets are assigned to one Business Portfolio.
3. **User access token** via `META_USER_ACCESS_TOKEN` — fallback only because it expires.

This means an expired Graph API Explorer token no longer has to take the whole dashboard offline if a permanent Page or System User credential is configured.

## Features

- Facebook + linked Instagram professional-account analytics.
- Manual **Sync Meta Now** action pulls the latest available Meta data.
- Facebook: media views, unique media viewers, reactions, comments, shares, clicks.
- Instagram: views, reach, likes, comments, shares, saves and total interactions when supported.
- Filters: client/Page, platform, date range and content type.
- KPI cards, platform trend, top content, format performance and searchable leaderboard.
- CSV export.
- Meta credentials remain server-side and are never exposed to browser JavaScript.

## Required permissions

The credential used for each asset must have the permissions and asset access required by the app/use case, including where applicable:

- `pages_show_list`
- `pages_read_engagement`
- `pages_read_user_content`
- `read_insights`
- `instagram_basic`
- `instagram_manage_insights`

The Instagram account must be professional and linked to the relevant Facebook Page for the Facebook Login-based flow.

## Vercel environment variables

Always configure credentials directly in Vercel. Never commit real tokens.

### Option A — permanent Page tokens

```env
META_PAGE_TOKENS_JSON=[{"pageId":"123456789","pageName":"Example Page","pageAccessToken":"YOUR_PAGE_TOKEN","instagramBusinessAccountId":"1784..."}]
META_GRAPH_VERSION=v26.0
META_POST_LIMIT=100
```

Multiple Pages can be added to the JSON array.

### Option B — System User

```env
META_SYSTEM_USER_ACCESS_TOKEN=YOUR_SYSTEM_USER_TOKEN
META_BUSINESS_ID=YOUR_BUSINESS_PORTFOLIO_ID
META_GRAPH_VERSION=v26.0
META_POST_LIMIT=100
```

### Fallback — User token

```env
META_USER_ACCESS_TOKEN=YOUR_USER_TOKEN
META_GRAPH_VERSION=v26.0
META_POST_LIMIT=100
```

A User token is useful for testing but should not be the only production credential because it expires.

## Health check

Open:

```
/api/health
```

A healthy response includes:

```json
{
  "ok": true,
  "authenticated": true,
  "authMode": "page_access_token"
}
```

Possible `authMode` values are `page_access_token`, `system_user`, or `user`.

## API endpoints

- `GET /api/health` — validates the best available server-side Meta credential.
- `GET /api/accounts` — lists usable Pages without exposing tokens.
- `GET /api/sync?pageId=...&since=YYYY-MM-DD&until=YYYY-MM-DD` — pulls and normalizes current organic performance.

## Security

- Never put a real Meta token in GitHub, client-side JavaScript, screenshots or chat.
- Store all production credentials as Vercel Environment Variables.
- Page and System User tokens can still be invalidated by permission changes, asset removal, app revocation or security events, so `/api/health` should remain part of operational monitoring.

## Next data layer

The dashboard is currently live-on-demand. A later database layer can store scheduled historical snapshots for follower growth, 1h/6h/24h content velocity, monthly comparisons and organic-to-paid analysis.
