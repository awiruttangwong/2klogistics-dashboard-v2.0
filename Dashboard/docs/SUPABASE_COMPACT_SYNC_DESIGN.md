# Supabase Compact Sync Design

## Goal

Keep Google Sheets and Apps Script as the source of truth, but use Supabase as a
small, fast production read model. Supabase must store only the current
dashboard-ready dataset, not an accumulating history of every full sync.

## Root Cause Fixed

The first shadow-sync design was intentionally conservative for migration
validation, but it amplified storage:

- every sync wrote a full `trips_staging` snapshot;
- every promote copied the same rows into `trips_active`;
- both tables stored `raw_payload jsonb`;
- payload hash indexes were kept on both staging and active;
- deleting old sync runs did not immediately return filesystem space and still
  needed WAL/temp space.

The Apps Script payload is not the large part. A 43,263-trip payload is roughly
26.5 MB as raw JSON from Apps Script. The large disk footprint came from
duplicated database storage, indexes, WAL, and bloat.

## Production Flow

1. Apps Script refreshes Google Sheet cache at 08:00 Asia/Bangkok.
2. When `dailyBatchJob` finishes successfully, Apps Script can call the
   protected Netlify Background Function immediately.
3. Netlify Scheduled Function also runs at 08:20, 08:30, 08:40, and 08:50
   Asia/Bangkok as pre-deadline recovery.
4. A protected Netlify Background Function waits until today's Apps Script
   `dailyBatchJob` reports success, then checks whether production already
   contains that exact completed batch.
5. Each sync worker must acquire `public.sync_leases` before mutating staging,
   so repeated recovery attempts do not write duplicate snapshots.
6. Sync service reads `summary`, `oil`, and paginated `trips` from Apps Script.
7. `reset_sync_staging()` truncates `trips_staging`.
8. Sync writes one normalized candidate snapshot into `trips_staging`.
9. Parity is checked against local totals from the same Apps Script payload.
10. `promote_sync_run()` truncates and replaces `trips_active`.
11. `promote_sync_run()` truncates `trips_staging` immediately after promotion.
12. The background function verifies row parity and a promotion timestamp after
    the Apps Script batch completion time.
13. Frontend reads active read-model tables through Netlify functions. If the
    source batch is ready but Supabase is still behind, the frontend temporarily
    prefers Apps Script until Supabase catches up.

GitHub Actions runs a backup watchdog at 08:47 Asia/Bangkok and a late recovery
at 10:17 Asia/Bangkok. It is not the primary timing mechanism because GitHub
scheduled events can be delayed. All paths refuse to sync until today's Apps
Script batch reports successful completion.

## Storage Rules

- Do not store `raw_payload` in Supabase production rows.
- Do not retain inactive staging runs by default.
- Do not keep promoted staging rows after `trips_active` has been replaced.
- Keep `trips_staging` as transient write workspace only.
- Keep `trips_active` as the single production read model.

## Validation Commands

```powershell
cmd /c node --check supabase\sync\sync-apps-script-to-supabase.mjs
cmd /c node --check netlify\functions\supabase-api.mjs
cmd /c node --check netlify\functions\supabase-sync-background.mjs
cmd /c node --check netlify\functions\schedule-supabase-sync.mjs
cmd /c npm run test:daily-sync-readiness
cmd /c npm run test:pre-nine-recovery
cmd /c npm run test:supabase-cli-guard
cmd /c npm run supabase:sync -- --dry-run
cmd /c npm run apps-script:health
```

## Deadline Controls

The operating target is that production has the completed daily batch before
09:00 Asia/Bangkok when the upstream Apps Script batch finishes normally.

- Apps Script trigger: 08:00 Asia/Bangkok.
- Event-driven sync: immediately after a successful `dailyBatchJob`, once the
  Apps Script project has `NETLIFY_SYNC_TRIGGER_SECRET` configured.
- Netlify pre-deadline recovery: 08:20, 08:30, 08:40, and 08:50 Asia/Bangkok.
- GitHub pre-deadline watchdog: 08:47 Asia/Bangkok.
- GitHub late recovery: 10:17 Asia/Bangkok.
- Supabase lease TTL: 2,400 seconds, shared by all write paths.
- Browser freshness fallback: use Apps Script for trip/date data if today's
  source batch is ready but Supabase production is still on an older promotion.

## Current Recovery Note

The old Supabase project reached a full 2 GB database disk with only about 192 KB
available. Once PostgreSQL cannot accept connections, cleanup SQL cannot run
without first freeing or adding disk. For a no-cost recovery, use a clean
Supabase project and apply this compact schema before the first sync.
