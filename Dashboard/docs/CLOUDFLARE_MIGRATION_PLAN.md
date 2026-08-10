# Netlify → Cloudflare Pages Migration Checklist

Last updated: 2026-08-10

## Current status (read this first)

Code changes for Phases 1–5 are done and committed on branch
`cloudflare-migration` (not merged to `main` yet — Netlify production is
untouched). The Cloudflare Pages project `2klogistics-dashboard` is live at
`https://2klogistics-dashboard.pages.dev` and the ported function correctly
returns `Missing required environment variable: SUPABASE_URL` (expected —
secrets aren't set yet). **Three things need the user before this can go
further:**

1. **`CLOUDFLARE_API_TOKEN`** — needed as a GitHub Actions secret so
   `cloudflare-pages-deploy.yml` can deploy non-interactively. Claude's local
   Cloudflare access is an OAuth session (used for the manual deploy above)
   and cannot mint this token itself. Create one at
   `https://dash.cloudflare.com/6c6387119b50a72218ec37c3618d1972/api-tokens`
   with the "Cloudflare Pages — Edit" template, then either paste it for
   Claude to set with `gh secret set CLOUDFLARE_API_TOKEN`, or run that
   command yourself.
2. **Cloudflare Pages secrets** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `APPS_SCRIPT_API_URL`) — these already exist as GitHub Actions secrets but
   GitHub secrets cannot be read back by anyone, including Claude, so the
   values have to come from you again. Safest path: create a local `.env`
   (gitignored) with these three lines, tell Claude it's ready, and Claude
   will pipe them into `wrangler pages secret put` without ever printing the
   values into the conversation.
3. **A GitHub fine-grained PAT** (repo-scoped to
   `awiruttangwong/2klogistics-dashboard-v2.0`, `Actions: write`) — needed so
   the Apps Script webhook can call `workflow_dispatch` on `supabase-sync.yml`.
   Store it in Apps Script Script Properties under
   `GITHUB_SYNC_DISPATCH_TOKEN` (via `configureSupabaseSyncWebhookSecret()`),
   then **manually redeploy the Apps Script Web App** (Deploy → New
   deployment) — this is a live production system Claude will not push to
   without your explicit go-ahead in the same conversation.

Once those three are in place, remaining work is verification (Phase 6),
merging `cloudflare-migration` to `main` (Phase 7 — safe, doesn't touch
Netlify), and burn-in before Netlify decommission (Phase 9).

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

- [x] `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT` GitHub secrets set
- [ ] `CLOUDFLARE_API_TOKEN` GitHub secret — **needs user**, see "Current status"
- [ ] Cloudflare Pages secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `APPS_SCRIPT_API_URL`) — **needs user**, see "Current status"
- [x] `.github/workflows/cloudflare-pages-deploy.yml` written: runs the same
      4 test scripts, deploys to a `ci-preview-<sha>` branch, health-checks
      it, deploys to `main` (production), health-checks that, and rolls back
      via `scripts/cloudflare-release.mjs rollback` on failure
  - Important discovery: `wrangler pages deploy <dir>` resolves `functions/`
    relative to the **current working directory**, not relative to
    `<dir>`. The workflow uses `working-directory: dashboard` and
    `wrangler pages deploy .` to get this right — confirmed by testing (a
    first attempt run from repo root silently deployed with *no* functions
    and Pages' SPA-fallback masked it as a false-positive 200).
- [x] `scripts/cloudflare-release.mjs` written (`current-production-id` /
      `rollback` via the Cloudflare Pages REST API)
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
- [ ] **Not yet deployed live** — this is a code change in the repo only.
      The live Apps Script Web App still runs the old Netlify-webhook code
      until someone runs `clasp push`/`clasp deploy` (Google credentials are
      available on this machine via an existing `clasp login`, but Claude
      will not push to this live production system without an explicit
      go-ahead in conversation, since it also runs the actual daily batch job)
- [ ] Store the GitHub PAT in Script Properties under
      `GITHUB_SYNC_DISPATCH_TOKEN` before/at the same time as the clasp deploy
- [ ] Manually trigger the webhook path once (outside 08:00–11:00 Bangkok) and
      confirm a GitHub Actions run of `supabase-sync.yml` starts

## Phase 6 — Staging verification (before touching DNS/production)

- [ ] Cloudflare Pages preview URL loads the dashboard correctly end-to-end
- [ ] `?action=health`, `?action=summary`, `?action=trips`, `?action=compare`
      all return correct data matching current Netlify production
- [ ] Page 1 (`มุมมองปกติ`): data loads, totals correct, `.xlsx` export works
- [ ] Page 2 (`เปรียบเทียบ`): compare table, anomaly/unmatched sections,
      `.xlsx` export works, `สำรองน้ำมัน` label correct
- [ ] No console/runtime errors in browser dev tools
- [ ] Manually run `workflow_dispatch` on `supabase-sync.yml` and confirm it
      completes and promotes successfully
- [ ] Manually run `production:watchdog` against the Cloudflare preview URL
      and confirm health check logic passes
- [ ] All existing automated tests still pass:
      `npm run test:daily-sync-readiness`,
      `npm run test:pre-nine-recovery`,
      `npm run test:supabase-cli-guard`,
      `npm run test:xlsx-reviewer-reasons`

## Phase 7 — Cutover

- [ ] Schedule cutover **outside 08:00–11:00 Asia/Bangkok** (the daily sync
      window) — prefer afternoon/evening Bangkok time
- [ ] Point the custom domain DNS to Cloudflare Pages
- [ ] Confirm HTTPS/SSL is active on the custom domain
- [ ] Re-run the Phase 6 verification checklist against the **production**
      custom domain (not just the preview URL)
- [ ] Leave the Netlify site live and untouched as a fallback (do not delete
      or unlink yet)
- [ ] Watch the next full daily cycle (08:20 → 08:50 → 10:17 Bangkok) end to
      end and confirm production Supabase data updates without any Netlify
      involvement

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

- [ ] Production dashboard is served from the Cloudflare custom domain with
      no references to `netlify.app` anywhere in the live site, API
      responses, or Apps Script code
- [ ] The daily Supabase sync has run successfully via GitHub Actions,
      triggered by the Apps Script webhook, for at least 5 consecutive days
      with no manual recovery needed
- [ ] The Cloudflare deploy pipeline (test → preview deploy → health check →
      promote → rollback-on-failure) has been exercised at least once
      end-to-end, including one deliberate failure to confirm rollback works
- [ ] All checklist items in Phases 0–9 above are checked
- [ ] Netlify site, tokens, and secrets are fully decommissioned

## Rollback plan (if Cloudflare cutover fails)

1. Point the custom domain DNS back to Netlify (if DNS was already switched).
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
  Phases 1–5 code changes completed and committed on branch
  `cloudflare-migration` (not merged to `main`). Cloudflare Pages project
  created and deployed; ported function verified working end-to-end via both
  the local Node dev server and the real `wrangler pages dev`/production
  Cloudflare runtime (missing-env-var error confirms correct wiring, since no
  secrets are set yet). GitHub secrets `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_PAGES_PROJECT` set. Blocked on: `CLOUDFLARE_API_TOKEN`,
  Cloudflare Pages secrets (values need to come from the user again since
  GitHub secrets can't be read back), and explicit confirmation before the
  live Apps Script Web App is redeployed via `clasp`.
