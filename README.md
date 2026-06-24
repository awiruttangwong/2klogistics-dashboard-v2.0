# Logistics-Profitability-Dashboard

## Supabase V3 Local Setup

Copy `.env.example` to `.env` and fill these values locally only:

```text
SUPABASE_PROJECT_REF=<project-ref>
SUPABASE_ACCESS_TOKEN=<personal-access-token>
SUPABASE_DB_PASSWORD=<database-password>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side-service-role-key>
APPS_SCRIPT_API_URL=<existing Apps Script Web App URL>
```

Do not commit `.env`. The root `.gitignore` already excludes it.

Remote CLI workflow on this Windows workspace:

```powershell
npm.cmd run supabase:link
npm.cmd run supabase:db:push:dry-run
npm.cmd run supabase:db:push
```

Shadow sync workflow on this Windows workspace:

```powershell
npm.cmd run supabase:sync -- --dry-run
npm.cmd run supabase:sync
npm.cmd run supabase:sync -- --promote
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only. Never put it in `Dashboard/scripts/*` or any frontend bundle.

## Frontend Supabase API

The dashboard now supports:

```js
apiMode: 'apps-script' | 'supabase-with-fallback' | 'supabase'
```

The default is `supabase-with-fallback`: the browser calls `/.netlify/functions/supabase-api` first and falls back to the existing Apps Script URL if Supabase is unavailable.

`eagerTripsOnStartup: false` keeps the first dashboard screen fast by rendering from `summary_snapshots` first. Full trip rows are loaded lazily when the compare/export workflows need them.

Set these Netlify environment variables before deploying the function:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Scheduled sync is defined in `.github/workflows/supabase-sync.yml`. Add these GitHub Actions secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APPS_SCRIPT_API_URL
```
