# Delayed production Supabase sync on 2026-06-29

## Summary

The Apps Script batch completed successfully at 08:07 Asia/Bangkok, but the
production dashboard still served the previous Supabase snapshot at 08:57.
The primary sync depended on GitHub scheduled workflows whose runs were delayed
for several hours. Commits `0f1705a`, `27e030b`, and `80a4b43` moved the primary
08:30 sync to Netlify, retained GitHub as a 10:17 recovery path, and made
production releases verify-before-promote with automatic rollback.

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
No independent 08:30 trigger promoted the completed Apps Script batch, so
`trips_active` and the latest promoted `sync_runs` row remained unchanged.

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

- `netlify/functions/schedule-supabase-sync.mjs` starts the primary sync at
  `30 1 * * *` (08:30 Asia/Bangkok).
- `netlify/functions/supabase-sync-background.mjs` waits for today's successful
  Apps Script batch, skips duplicate work, runs the compact sync, and verifies
  the promoted snapshot.
- `supabase/sync/daily-sync-readiness.mjs` centralizes source-ready and
  production-current decisions.
- GitHub `production-sync-watchdog.yml` now runs once at 10:17 Asia/Bangkok as
  a recovery path instead of acting as the primary clock.
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

The code path and manual authorized background invocation are validated. The
first naturally scheduled Netlify execution at 08:30 Asia/Bangkok on 2026-06-30
remains an operational observation, not an untested implementation dependency;
the 10:17 GitHub watchdog remains the recovery path if that execution fails.

## Action items

- Observe the 2026-06-30 08:30 Netlify function execution and record its start,
  completion, row count, and promoted timestamp in the production runbook.
- Keep the 10:17 GitHub watchdog enabled and review any run where
  `decision.shouldSync=true`, because that indicates the primary path missed its
  SLA.
- Do not reactivate Netlify direct Git builds unless the site is deliberately
  relinked to `awiruttangwong/2klogistics-dashboard-v2.0` and the duplicate
  deployment path is reviewed.
