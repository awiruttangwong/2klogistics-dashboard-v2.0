# 2K Logistics Dashboard V2

## Production Identity

Use these names as the source of truth:

```text
Local workspace folder: Data sum Daily express 4 month V3
GitHub repository: awiruttangwong/2klogistics-dashboard-v2.0
Netlify site: 2klogistics-dashboard
Production URL: https://2klogistics-dashboard.netlify.app
Netlify publish directory: dashboard
Apps Script source directory: dashboard/API
Apps Script project: DASHBOARD-DAILY-QA
Google Sheet: Database Daily EXPRESS
Active Supabase read model: cghcyuuyzahpzzbyxrgo (compact backend)
```

The local folder name is only a Windows workspace label. Netlify does not deploy
from that folder name; production deploys from the GitHub Actions workflow in
`awiruttangwong/2klogistics-dashboard-v2.0`, publishing the `dashboard` directory
to the Netlify site `2klogistics-dashboard`.

Use lowercase `dashboard/` as the active source directory. The uppercase
`Dashboard/` tree is retained only for historical docs/notes and must not be
used as the Netlify publish directory.

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

`SUPABASE_SERVICE_ROLE_KEY` is server-side only. Never put it in `dashboard/scripts/*` or any frontend bundle.

## Frontend Supabase API

The dashboard now supports:

```js
apiMode: 'apps-script' | 'supabase-with-fallback' | 'supabase'
```

The default is `supabase-with-fallback`: the browser calls `/.netlify/functions/supabase-api` first and falls back to the existing Apps Script URL if Supabase is unavailable.

Production currently uses the compact Supabase backend `cghcyuuyzahpzzbyxrgo`.
The previous project `juzkxljnyonckjkmttzq` is not used for production reads
because its 2 GB database disk filled during the first full-snapshot migration
design. Do not point Netlify or GitHub Actions back to that project.

`eagerTripsOnStartup: false` keeps the first dashboard screen fast by rendering from `summary_snapshots` first. Full trip rows are loaded lazily when the compare/export workflows need them.

Set these Netlify environment variables before deploying the function:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APPS_SCRIPT_API_URL
NETLIFY_SYNC_TRIGGER_SECRET
```

The primary daily sync is `netlify/functions/schedule-supabase-sync.mjs` at
08:30 Asia/Bangkok. It invokes the protected background function, waits for
today's successful Apps Script `dailyBatchJob`, and promotes only that completed
batch. GitHub Actions runs one recovery check at 10:17 Asia/Bangkok and remains
available for manual recovery because GitHub scheduled events do not provide a
strict start-time guarantee.

Add these GitHub Actions secrets for the backup watchdog and manual recovery:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APPS_SCRIPT_API_URL
```
