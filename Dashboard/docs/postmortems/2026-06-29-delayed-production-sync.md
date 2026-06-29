# Delayed production Supabase sync on 2026-06-29

## Summary

The Apps Script batch completed successfully at 08:07 Asia/Bangkok, but the
production dashboard still served the previous Supabase snapshot at 08:57.
The primary sync depended on GitHub scheduled workflows whose runs were delayed
for several hours. Commits `0f1705a`, `27e030b`, and `80a4b43` moved the primary
08:30 sync to Netlify, retained GitHub as a 10:17 recovery path, and made
production releases verify-before-promote with automatic rollback. The
follow-up pre-deadline hardening adds an Apps Script completion callback,
Netlify recovery runs at 08:20, 08:30, 08:40, and 08:50, a GitHub 08:47
watchdog, a Supabase write lease, and a browser freshness fallback.

## Symptom

- Apps Script reported 43,963 source trips and a successful `dailyBatchJob`.
- Production Supabase still contained 43,755 trips from the previous promoted
  snapshot.
- Refreshing `https://2klogistics-dashboard.netlify.app/` did not change the
  data because the frontend correctly read the stale Supabase snapshot.
- Historical GitHub scheduled runs intended for the morning started between
  approximately 16:37 and 17:55 Asia/Bangkok.

## Root cause

`.github/workflows/production-sync-watchdog.yml` used GitHub `schedule` events
as the morning synchronization clock. GitHub scheduled workflows do not provide
an exact start-time guarantee and the observed runs were delayed by 7-9 hours.
No independent pre-deadline recovery loop promoted the completed Apps Script
batch, so `trips_active` and the latest promoted `sync_runs` row remained
unchanged until a manual recovery.

The first Netlify-only fix reduced the delay, but still did not fully meet the
"ready before 09:00" operating target. On 2026-06-29, the source batch finished
at 08:07:30 Asia/Bangkok while Supabase promotion completed at 09:09:52
Asia/Bangkok. That proved the system needed repeated pre-deadline recovery and
freshness-aware frontend routing, not a single 08:30 attempt.

The first rollout attempt also exposed a release-path gap:
`.github/workflows/netlify-production-deploy.yml` called
`netlify deploy --prod`, which returned HTTP 403 under the site's production
deploy restriction. Netlify also retained an active direct-Git link to the
legacy `awiruttangwong/2klogistics-dashboard` repository.

## Why it produced the symptom

The browser's `supabase-with-fallback` mode only falls back when the Supabase API
is unavailable; a healthy but old snapshot is still a valid response. Browser
refreshes therefore repeated the same 43,755-row snapshot. The cache layer could
extend visibility briefly, but it did not cause the missing 208 rows: no sync
had promoted them yet.

## Fix

- `netlify/functions/schedule-supabase-sync.mjs` starts recovery at
  `20,30,40,50 1 * * *` (08:20, 08:30, 08:40, 08:50 Asia/Bangkok).
- `netlify/functions/supabase-sync-background.mjs` waits for today's successful
  Apps Script batch, skips duplicate work, runs the compact sync, and verifies
  the promoted snapshot.
- Apps Script `dailyBatchJob` can call the protected background sync immediately
  after a successful source refresh, using `NETLIFY_SYNC_TRIGGER_SECRET` from
  Script Properties.
- `supabase/migrations/20260629000100_sync_lease.sql` adds
  `public.sync_leases`, `public.acquire_sync_lease()`, and
  `public.release_sync_lease()` so repeated recovery workers cannot mutate
  staging concurrently.
- `dashboard/scripts/app.js` calls the Supabase `freshness` action during boot
  and prefers Apps Script for trip/date data when today's source batch is ready
  but Supabase production is still behind.
- `supabase/sync/daily-sync-readiness.mjs` centralizes source-ready and
  production-current decisions.
- GitHub `production-sync-watchdog.yml` now runs at 08:47 and 10:17
  Asia/Bangkok as backup recovery instead of acting as the primary clock.
- `netlify/functions/supabase-api.mjs` uses a 60-second shared cache with a
  120-second stale-while-revalidate window.
- `scripts/netlify-release.mjs` and
  `.github/workflows/netlify-production-deploy.yml` create a draft, verify its
  health and schedule metadata, promote it, verify production, and restore the
  previous deploy if verification fails.
- Netlify `build_settings.stop_builds=true` disables builds from the legacy
  direct-Git link while preserving CLI/API deploys from the v2.0 workflow.

## How it was found

The deterministic comparison was Apps Script `tripsTotal` versus production
`supabase.tripsRows`. Apps Script was current while Supabase was 208 rows behind.
GitHub run timestamps disproved Apps Script, Supabase write, and frontend cache
as the primary cause: no scheduled sync had run after the source batch. A manual
watchdog run promoted all 43,963 rows in 2 minutes 24 seconds and immediately
made the production counts equal.

## Why it slipped through

The workflow configuration treated cron expressions as an execution-time SLA.
Tests covered sync correctness after a run started, but did not cover the
absence or multi-hour delay of the scheduler itself. The release workflow also
tested direct production deploys only under account states where Netlify allowed
them.

## Validation

- Apps Script health: expected project and spreadsheet matched; one 08:00
  trigger; contract passed; 43,963 trips.
- Manual recovery run `28344203499`: success; production promoted at 09:09:52
  Asia/Bangkok with 43,963 rows.
- Netlify deploy `6a41ea4d4f2bab04320afc6b`: ready and published with
  `schedule-supabase-sync` at `30 1 * * *`.
- GitHub release run `28347214076`: draft deploy, draft health, promote, and
  production health all passed.
- Post-hardening dispatch run `28347468279`: the same release path passed after
  Netlify direct Git builds were stopped, confirming CLI/API releases remain
  operational.
- Production health after release: HTTP 200, 43,963 trips, promoted status,
  zero failures, and maximum operational date 2026-06-28.
- Frontend API configuration: `supabase-with-fallback` and the production
  Netlify function endpoint are present.
- Supabase production migration applied and verified:
  `public.sync_leases` exists; `acquire_sync_lease` and `release_sync_lease`
  exist; first owner acquires, second owner is rejected while locked, release
  succeeds, and the second owner acquires after release.
- Local regression checks passed: `test:daily-sync-readiness`,
  `test:pre-nine-recovery`, `test:supabase-cli-guard`, Netlify function syntax
  checks, frontend syntax check, sync service syntax check, and Apps Script
  parser check.
- Production watchdog after hardening reported source 43,963 rows, production
  43,963 rows, row delta 0, status `promoted`, and `shouldSync=false`.

The code path, Supabase lease, and production readiness decision are validated.
The next naturally scheduled pre-deadline cycle remains an operational
observation, but the system no longer depends on one exact scheduler firing:
Apps Script callback, repeated Netlify recovery, GitHub watchdog, and frontend
freshness fallback now cover the gap.

## Action items

- Observe the next 08:00-09:00 Asia/Bangkok cycle and record Apps Script finish
  time, first recovery start, promotion time, row count, and frontend freshness
  state in the production runbook.
- Re-authenticate clasp for the Google Workspace account and push
  `dashboard/API/Code.gs` plus `dashboard/API/config.gs` to the Apps Script
  project if Google returns `invalid_rapt`.
- Configure the Apps Script Script Property `NETLIFY_SYNC_TRIGGER_SECRET` to
  match the Netlify environment variable with the same name.
- Keep the 10:17 GitHub watchdog enabled and review any run where
  `decision.shouldSync=true`, because that indicates the primary path missed its
  SLA.
- Do not reactivate Netlify direct Git builds unless the site is deliberately
  relinked to `awiruttangwong/2klogistics-dashboard-v2.0` and the duplicate
  deployment path is reviewed.
