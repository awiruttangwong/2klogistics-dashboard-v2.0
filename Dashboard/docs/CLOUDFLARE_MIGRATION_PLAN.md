# Netlify → Cloudflare Pages Migration Checklist

Last updated: 2026-08-10

## Current status (read this first)

Merged to `main` (PR #1) and live in production. `cloudflare-pages-deploy.yml`
has run end-to-end successfully on `main`, including a real preview deploy,
a real production deploy, and both health checks passing against real
Supabase data. Production: `https://2klogistics-dashboard.pages.dev`.
Netlify is left in place untouched as a fallback (and is, as of this
writing, itself down with `503 usage_exceeded` — confirming the reason for
this migration).

**One thing is still missing:** the Apps Script event-driven webhook
(instant sync trigger right after the daily batch job finishes) is not
active yet. The GitHub PAT provided so far returned `403 Resource not
accessible by personal access token` when tested directly against the
dispatch endpoint — it needs the fine-grained PAT's repository permission
**Actions: Read and write** (scoped to
`awiruttangwong/2klogistics-dashboard-v2.0`). Until a working PAT is stored
in Script Properties under `GITHUB_SYNC_DISPATCH_TOKEN`, daily sync still
happens automatically via the GitHub Actions cron schedule added to
`production-sync-watchdog.yml` (08:20/08:30/08:40/08:50/08:47/10:17
Asia/Bangkok) — just without the instant push-triggered path. Nothing is
broken; this is a latency/redundancy gap, not a functional one.

Two bugs were found and fixed during the real end-to-end test that plain
code review wouldn't have caught:

- `dashboard/functions/api/supabase-api.js` had been committed as
  `Dashboard/functions/...` (capital D) because of this Windows workspace's
  case-insensitive filesystem. On GitHub's case-sensitive Linux runners that
  put the Function in a directory disconnected from the actual `dashboard/`
  publish root, so deploys silently shipped with no Functions at all —
  masked by Cloudflare Pages' SPA fallback returning a false-positive 200.
  Fixed by a case-only `git mv` to `dashboard/functions/...`.
- Fresh Cloudflare Pages deployments (a new preview alias every run, and the
  first production deploy after adding secrets) need a few seconds to
  propagate before the URL reliably resolves. Added a 15s wait before each
  health check in the workflow, and set the same three secrets for the
  Pages project's **Preview** environment (previously Production-only), so
  the preview health check exercises real data too.

Remaining work: a working GitHub PAT (see above) to finish Phase 5, then
Phase 6/9 burn-in before Netlify decommission.

## Purpose

Move production hosting for this dashboard off Netlify (repeated
`Account credit usage exceeded` outages — see
`NETLIFY_MANUAL_PRODUCTION_DEPLOY.md`) onto Cloudflare Pages at
`https://dash.cloudflare.com/6c6387119b50a72218ec37c3618d1972/workers-and-pages`,
without breaking the daily Supabase sync or the Apps Script data pipeline.

## Decisions already confirmed (do not re-litigate without asking)

- **Sync trigger architecture:** the Apps Script event-driven webhook and the
  4x/day schedule move entirely to GitHub Actions (`workflow_dispatch` +
  `on.schedule` on `supabase-sync.yml` / `production-sync-watchdog.yml`).
  Cloudflare will **not** host a background/scheduled function. This avoids
  porting `supabase/sync/sync-apps-script-to-supabase.mjs`, which has a
  static `import ... from 'node:fs'` that cannot run on Cloudflare
  Workers/Pages Functions (no filesystem).
- **Domain:** production will use the Cloudflare Pages default domain
  `https://2klogistics-dashboard.pages.dev` (decided 2026-08-10, overrides
  the earlier custom-domain option — no DNS cutover step needed).
- **Cloudflare hosts only:** the static `dashboard/` site + one read-only
  Pages Function ported from `netlify/functions/supabase-api.mjs` (no
  `node:fs` dependency there — safe to port as-is, logic only).
- **Sequencing:** Cloudflare account access was confirmed already available
  (Wrangler CLI is authenticated on this machine as
  `awirut.tan@2klogistics.co.th`, account `6c6387119b50a72218ec37c3618d1972`,
  with `pages (write)` scope), so Phase 0 project setup is done directly
  instead of waiting on the user.
- **Deploy safety pattern to preserve:** draft/preview deploy → health check
  → promote to production → auto-rollback on failure. Do not simplify this
  away; it exists because of a real past incident (silent stale production
  on Netlify).

---

## Phase 0 — Cloudflare account setup

- [x] Cloudflare Pages project `2klogistics-dashboard` created via Wrangler
      CLI (account `6c6387119b50a72218ec37c3618d1972`), production branch
      `main`, live at `https://2klogistics-dashboard.pages.dev`
- [x] `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT` GitHub secrets set
- [ ] Domain: using the default `*.pages.dev` domain (user decision,
      2026-08-10) — no custom domain, no DNS step needed
- [ ] Create a Cloudflare API Token scoped to `Cloudflare Pages:Edit` and add
      as GitHub secret `CLOUDFLARE_API_TOKEN` — **blocking Phase 3 automation**
- [ ] Create a GitHub Personal Access Token (fine-grained, scoped only to
      `awiruttangwong/2klogistics-dashboard-v2.0`, `Actions: write` permission)
      to allow Apps Script to call `workflow_dispatch` — **blocking Phase 5**

---

## Phase 1 — Port the read API to Cloudflare Pages Functions

- [x] Created `dashboard/functions/api/supabase-api.js`, ported from
      `netlify/functions/supabase-api.mjs` (`onRequestGet`/`onRequestOptions`,
      `context.env`, `Response` objects, `CDN-Cache-Control` header, and a
      real import of `supabase/sync/daily-sync-readiness.mjs` for the
      `freshness` action instead of a hand-rolled reimplementation)
- [x] `netlify/functions/schedule-supabase-sync.mjs` and
      `supabase-sync-background.mjs` intentionally **kept** (not deleted) —
      they remain Netlify's fallback until burn-in (Phase 9), and
      `netlify.toml`/Netlify itself are completely untouched by this branch
- [x] `dashboard/scripts/api-config.js:5` → `/api/supabase-api`
- [x] Thai error string in `dashboard/scripts/app.js` (~line 10185) updated
- [x] `scripts/serve-dashboard-local.mjs` updated to call
      `onRequestGet({request, env})` and serve `/api/supabase-api`
- [x] `node --check` passes on all touched files

## Phase 2 — Local verification of the ported function

- [x] `scripts/serve-dashboard-local.mjs` verified: index 200, `?action=health`
      correctly returns `Missing required environment variable: SUPABASE_URL`
      (no local `.env`, expected)
- [x] `wrangler pages dev` (real Cloudflare/workerd runtime, not just Node)
      verified the same way — **must be run with cwd inside `dashboard/`**
      for the `functions/` dir to be auto-detected (see Phase 3 note)

## Phase 3 — Cloudflare deploy pipeline (GitHub Actions)

- [x] `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_API_TOKEN`
      GitHub secrets set (the first API token given was IP-restricted and
      failed from GitHub's runners with a 401 even though it worked locally;
      a second, unrestricted token fixed it)
- [x] Cloudflare Pages secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `APPS_SCRIPT_API_URL`) set for **both** Production and Preview
      environments (copied from Netlify's existing values, user-authorized;
      Preview needed a separate API call since `wrangler pages secret put`
      only targets Production)
- [x] `.github/workflows/cloudflare-pages-deploy.yml` written and **verified
      end-to-end on a real run** (test → preview deploy → 15s wait → preview
      health check → production deploy → 15s wait → production health check,
      all green: https://github.com/awiruttangwong/2klogistics-dashboard-v2.0/actions/runs/31362270366)
  - Discovery 1: `wrangler pages deploy <dir>` resolves `functions/` relative
    to the **current working directory**, not `<dir>`. Fixed with
    `working-directory: dashboard` + `wrangler pages deploy .`.
  - Discovery 2: the function file had been git-committed as
    `Dashboard/functions/...` (capital D) due to this Windows workspace's
    case-insensitive filesystem, which is invisible locally but on GitHub's
    case-sensitive Linux runners put it in a directory disconnected from the
    real `dashboard/` publish root. Both of these were masked by Cloudflare
    Pages' SPA fallback (a 200 with `index.html` instead of a 404), which is
    why they only surfaced once the pipeline actually ran on GitHub, not
    during local testing.
  - Discovery 3: fresh deployments need a few seconds to propagate before
    the URL reliably resolves — added a 15s wait before each health check.
- [x] `scripts/cloudflare-release.mjs` written and exercised for real
      (`current-production-id` / `rollback` via the Cloudflare Pages REST API)
- [ ] Delete `.github/workflows/netlify-production-deploy.yml` and
      `scripts/netlify-release.mjs` — deferred to Phase 9 (kept as fallback)

## Phase 4 — Move sync scheduling/triggering off Netlify

- [x] Added cron `20,30,40,50 1 * * *` (08:20/30/40/50 Asia/Bangkok) to
      `production-sync-watchdog.yml`, alongside the existing 08:47/10:17 checks
- [x] `supabase-sync.yml` already supports bare `workflow_dispatch` (no inputs
      required — a plain `{"ref":"main"}` POST is enough for Apps Script to
      trigger it)
- [x] `scripts/check-production-health.mjs` and
      `scripts/watchdog-production-sync.mjs` default `DASHBOARD_HEALTH_URL`
      updated to `https://2klogistics-dashboard.pages.dev/api/supabase-api?action=health`
- [x] `DASHBOARD_HEALTH_URL` env values updated in both workflow YAMLs
- [x] Confirmed `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `APPS_SCRIPT_API_URL` already exist as GitHub secrets (set 2026-06-25/26)

## Phase 5 — Apps Script (Google) changes

- [x] `dashboard/API/config.gs`: `SUPABASE_SYNC_WEBHOOK_URL` now points at
      `https://api.github.com/repos/awiruttangwong/2klogistics-dashboard-v2.0/actions/workflows/supabase-sync.yml/dispatches`;
      `SUPABASE_SYNC_WEBHOOK_SECRET_PROPERTY` renamed to
      `GITHUB_SYNC_DISPATCH_TOKEN`
- [x] `dashboard/API/Code.gs` (`requestSupabaseSyncAfterBatch_`): now sends
      `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
      `X-GitHub-Api-Version: 2022-11-28`, body `{"ref":"main"}`, and checks
      for GitHub's `204` success status instead of Netlify's `202`
- [x] `Access-Control-Allow-Origin: '*'` in `jsonOut()` confirmed unchanged
- [x] **Pushed live via `clasp push`** — but only after pulling the live
      project first and discovering it had real drift never committed to
      git (a `dailyBatchRecoveryJob` mechanism, an oil-price parsing fix, a
      current-month import guard, and the August `DATA(M8)` source URL).
      The webhook change was applied on top of that live code, not the
      stale git version, so none of the live fixes were overwritten. The
      repo was then synced to match (see the "Sync Apps Script source with
      live production" commit). No new Web App deployment was needed — the
      daily batch job runs via a time-based trigger, which always executes
      the latest saved code regardless of Web App deployment pinning.
- [ ] **Blocked:** store a working GitHub PAT in Script Properties under
      `GITHUB_SYNC_DISPATCH_TOKEN` — the PAT provided returned `403
      Resource not accessible by personal access token`; needs
      `Actions: Read and write` repository permission. See "Current status".
- [ ] Once the PAT is stored, manually trigger the webhook path (outside
      08:00–11:00 Bangkok) and confirm a GitHub Actions run of
      `supabase-sync.yml` starts

## Phase 6 — Verification

- [x] Cloudflare Pages URL loads the dashboard correctly end-to-end
- [x] `?action=health`, `?action=summary`, `?action=dates` verified live
      against real production Supabase data
- [ ] `?action=trips`, `?action=compare` not yet spot-checked directly (the
      frontend uses them; no reported issues, but not explicitly re-verified)
- [ ] Page 1/Page 2 UI, `.xlsx` export — not verified in an actual browser
      session (only the API layer has been tested end-to-end so far)
- [x] `workflow_dispatch` on `supabase-sync.yml` run manually and confirmed
      successful (restored a 52-hour-stale sync while Netlify was down)
- [x] All automated tests pass post-merge: `test:daily-sync-readiness`,
      `test:pre-nine-recovery`, `test:pttor-diesel-selector`,
      `test:route-display-policy`, `test:supabase-cli-guard`,
      `test:xlsx-reviewer-reasons`, `test:xlsx-freeze-panes` (7/7)

## Phase 7 — Cutover

- [x] No DNS step needed — using `2klogistics-dashboard.pages.dev` directly
      (user decision, overrides the earlier custom-domain option)
- [x] Netlify left live and untouched as a fallback
- [ ] Watch a full daily cycle (08:20 → 08:50 → 10:17 Bangkok) end to end
      and confirm production Supabase data updates without manual intervention
      — not yet observed since the cron schedule was only just added

## Phase 8 — Documentation updates

- [ ] Update `README.md` "Production Identity" block with the new domain,
      Cloudflare project name/ID, and updated architecture description
- [ ] Replace `dashboard/docs/NETLIFY_MANUAL_PRODUCTION_DEPLOY.md` with a
      `CLOUDFLARE_MANUAL_PRODUCTION_DEPLOY.md` equivalent
- [ ] Update `dashboard/docs/FRONTEND_RELEASE_CHECKLIST.md` references from
      Netlify to Cloudflare
- [ ] Update this file's checkboxes as each phase completes

## Phase 9 — Decommission Netlify (only after burn-in)

- [ ] Confirm production has been stable on Cloudflare for **at least one
      full week**, including at least 5 successful daily sync cycles with zero
      manual intervention
- [ ] Remove `netlify.toml`
- [ ] Remove `netlify/` directory (functions)
- [ ] Remove `.netlify/` directory
- [ ] Remove `.github/workflows/netlify-production-deploy.yml`
- [ ] Remove `scripts/netlify-release.mjs` (if not already removed in Phase 3)
- [ ] Revoke `NETLIFY_AUTH_TOKEN`, remove `NETLIFY_AUTH_TOKEN` /
      `NETLIFY_SITE_ID` GitHub secrets
- [ ] Downgrade or delete the Netlify site itself (only after everything
      above is confirmed and the old `NETLIFY_SYNC_TRIGGER_SECRET` Script
      Property in Apps Script has been removed)

---

## Definition of "100% done"

This migration is complete only when **all** of the following are true:

- [x] Production dashboard is served from Cloudflare
      (`https://2klogistics-dashboard.pages.dev`) with no `netlify.app`
      references left in the live site or API responses (Apps Script's
      `SUPABASE_SYNC_WEBHOOK_URL` also updated, though the PAT to actually
      activate that path is still pending — see Phase 5)
- [ ] The daily Supabase sync has run successfully via GitHub Actions for at
      least 5 consecutive days with no manual recovery needed — not yet
      observed (cron just added; event-driven webhook still pending a PAT)
- [x] The Cloudflare deploy pipeline (test → preview deploy → health check →
      promote) has been exercised end-to-end successfully on a real run
- [ ] Rollback has not been deliberately exercised yet (no failure has
      occurred to trigger it)
- [ ] Phase 5's PAT/webhook item and Phase 6/7's unverified items are still open
- [ ] Netlify site, tokens, and secrets are fully decommissioned (intentionally
      deferred until burn-in — Netlify is currently down, which is exactly the
      scenario this migration exists for)

## Rollback plan (if Cloudflare cutover fails)

1. Point users back at the Netlify URL (no DNS involved — just stop linking
   to `2klogistics-dashboard.pages.dev`).
2. Restore `SUPABASE_SYNC_WEBHOOK_URL` in `Dashboard/API/config.gs` back to
   the Netlify URL and redeploy the Apps Script Web App.
3. Re-enable the Netlify scheduled/background functions if they were removed.
4. File a note in this document's changelog on why the rollback happened
   before attempting cutover again.

## Changelog

- 2026-08-10 — Plan created; sync-via-GitHub-Actions and custom-domain
  decisions confirmed with user; Cloudflare project setup pending.
- 2026-08-10 — User switched domain decision to `2klogistics-dashboard.pages.dev`
  (no custom domain/DNS step) and authorized Claude to execute the migration.
  Cloudflare Pages project created and deployed manually first; while testing,
  confirmed Netlify was actively down (`503 usage_exceeded`) and manually
  triggered `supabase-sync.yml` to restore a 52-hour-stale sync. User
  authorized copying the existing Netlify env values into Cloudflare Pages
  secrets via CLI. Discovered the local git checkout was 21 commits behind
  GitHub's `main`; merged and resolved one real conflict (kept this branch's
  live-sourced `DATA(M8)` URL). Pulled the live Apps Script project before
  pushing and found real uncommitted drift (recovery-job trigger mechanism,
  oil-price parsing fix, current-month import guard); applied the webhook
  change on top of that live code and pushed, then synced the repo to match.
  PR #1 merged to `main`. `CLOUDFLARE_API_TOKEN` set (first token was
  IP-restricted and only worked from the user's machine, not GitHub's
  runners; a second token fixed it). `cloudflare-pages-deploy.yml` failed
  twice more on real infrastructure issues — a case-only git path bug
  (`Dashboard/functions/...` vs `dashboard/functions/...`, invisible on
  Windows, fatal on Linux runners) and missing Preview-environment secrets
  plus deployment-propagation timing — both fixed, then the pipeline ran
  green end-to-end. Remaining: a GitHub PAT with `Actions: Read and write`
  permission to activate the Apps Script event-driven webhook (the one
  provided lacks that permission); the GitHub Actions cron fallback covers
  daily sync in the meantime.
