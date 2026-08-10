# Netlify → Cloudflare Pages Migration Checklist

Last updated: 2026-08-10

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

## Phase 0 — Cloudflare account setup (you do this first)

- [ ] Create a Cloudflare Pages project in account `6c6387119b50a72218ec37c3618d1972`,
      connected to GitHub repo `awiruttangwong/2klogistics-dashboard-v2.0`
      (or set up for direct/Wrangler upload if not using Git integration)
- [ ] Decide and register the custom domain (e.g. `dashboard.2klogistics.co.th`)
      and add it to the Cloudflare Pages project
- [ ] Create a Cloudflare API Token scoped to `Cloudflare Pages:Edit` for this account
- [ ] Note down: Cloudflare **Account ID** (`6c6387119b50a72218ec37c3618d1972`),
      **Pages project name**, and the **API Token** value
- [ ] Create a GitHub Personal Access Token (fine-grained, scoped only to
      `awiruttangwong/2klogistics-dashboard-v2.0`, `Actions: write` permission)
      to allow Apps Script to call `workflow_dispatch`
- [ ] Confirm with Claude that all of the above is ready before Phase 1 starts

---

## Phase 1 — Port the read API to Cloudflare Pages Functions

- [ ] Create `dashboard/functions/api/supabase-api.js`, ported from
      `netlify/functions/supabase-api.mjs`:
  - [ ] Convert `handler(event)` → `onRequestGet(context)` / `onRequest(context)`
  - [ ] Replace `process.env.X` → `context.env.X`
  - [ ] Replace return shape `{statusCode, headers, body}` → `new Response(body, {status, headers})`
  - [ ] Replace header `Netlify-CDN-Cache-Control` → `CDN-Cache-Control`
  - [ ] Keep all query actions identical: `meta`, `health`, `freshness`, `summary`,
        `trips`, `oil`, `routes`, `customers`, `dates`, `compare`
- [ ] Verify no other Netlify-only globals remain in the ported file
- [ ] Delete/retire `netlify/functions/schedule-supabase-sync.mjs` and
      `netlify/functions/supabase-sync-background.mjs` (superseded by Phase 4)
- [ ] Update `dashboard/scripts/api-config.js:5`:
      `/.netlify/functions/supabase-api` → `/api/supabase-api`
- [ ] Update the Thai error string in `dashboard/scripts/app.js` (~line 10185)
      that mentions "Netlify deploy" to reference the new hosting generically
- [ ] Update `scripts/serve-dashboard-local.mjs`:
  - [ ] Mock route path `/.netlify/functions/supabase-api` → `/api/supabase-api`
  - [ ] `FUNCTION_PATH` → point at `dashboard/functions/api/supabase-api.js`
- [ ] `node --check dashboard/scripts/app.js` passes
- [ ] `node --check dashboard/scripts/api-config.js` passes

## Phase 2 — Local verification of the ported function

- [ ] `npm run dashboard:dev` starts and serves the dashboard locally
- [ ] `http://127.0.0.1:8899/api/supabase-api?action=health` returns valid JSON
- [ ] All frontend pages (Page 1 summary, Page 2 compare) load real data locally
- [ ] `npx wrangler pages dev dashboard` (Cloudflare local emulator) also serves
      `functions/api/supabase-api.js` correctly with env vars from `.dev.vars`

## Phase 3 — Cloudflare deploy pipeline (GitHub Actions)

- [ ] Add GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
      `CLOUDFLARE_PAGES_PROJECT`
- [ ] Set Cloudflare Pages environment variables/secrets (via dashboard or
      `wrangler pages secret put`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `APPS_SCRIPT_API_URL`
- [ ] Write `.github/workflows/cloudflare-pages-deploy.yml` replacing
      `netlify-production-deploy.yml`, preserving the same safety shape:
  - [ ] Run the existing test suite first (`test:daily-sync-readiness`,
        `test:pre-nine-recovery`, `test:supabase-cli-guard`, `test:xlsx-reviewer-reasons`)
  - [ ] Deploy to a non-production Cloudflare Pages branch/preview deployment
  - [ ] Health-check the preview deployment (`/api/supabase-api?action=health`)
  - [ ] Only then deploy/promote to the production branch/domain
  - [ ] On failure, roll back to the last known-good production deployment
        (Cloudflare Pages deployment history / rollback API — confirm exact
        endpoint against current Cloudflare docs when implementing)
- [ ] Write/adjust `scripts/cloudflare-release.mjs` if a scripted
      promote/rollback step (mirroring `scripts/netlify-release.mjs`) is needed
- [ ] Delete `.github/workflows/netlify-production-deploy.yml` once the new
      workflow is proven (keep both temporarily side-by-side is fine)
- [ ] Delete `scripts/netlify-release.mjs` once no longer referenced

## Phase 4 — Move sync scheduling/triggering off Netlify

- [ ] Decide the exact GitHub Actions cron entries needed to replace Netlify's
      `20,30,40,50 1 * * *` (08:20/30/40/50 Asia/Bangkok) — add them to
      `production-sync-watchdog.yml` and/or `supabase-sync.yml`
- [ ] Confirm `supabase-sync.yml` can be safely triggered via
      `workflow_dispatch` with inputs (or `repository_dispatch`) from an
      external caller (Apps Script)
- [ ] Update `scripts/check-production-health.mjs` and
      `scripts/watchdog-production-sync.mjs`: replace the hardcoded default
      `DASHBOARD_HEALTH_URL` (`https://2klogistics-dashboard.netlify.app/...`)
      with the new custom domain
- [ ] Update `DASHBOARD_HEALTH_URL` env values inside
      `.github/workflows/production-sync-watchdog.yml` and
      `.github/workflows/supabase-sync.yml`
- [ ] Confirm GitHub secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `APPS_SCRIPT_API_URL` are unchanged and still valid

## Phase 5 — Apps Script (Google) changes

- [ ] Update `dashboard/API/config.gs` (and mirrored `Dashboard/API/config.gs`
      if not the same case-insensitive file — verify first):
  - [ ] `SUPABASE_SYNC_WEBHOOK_URL` → GitHub Actions dispatch endpoint
        (e.g. `https://api.github.com/repos/awiruttangwong/2klogistics-dashboard-v2.0/actions/workflows/supabase-sync.yml/dispatches`)
  - [ ] Update the code around line ~1390 (`UrlFetchApp.fetch(SUPABASE_SYNC_WEBHOOK_URL, ...)`)
        to send the GitHub-required request shape: `Authorization: Bearer <PAT>`,
        `Accept: application/vnd.github+json`, POST body `{"ref":"main"}`
  - [ ] Store the new GitHub PAT in Script Properties under
        `SUPABASE_SYNC_WEBHOOK_SECRET_PROPERTY` (rename the property key too
        if desired, e.g. `GITHUB_SYNC_DISPATCH_TOKEN`)
- [ ] In the Apps Script editor: **Deploy → New deployment** (a code-only save
      does not update the live Web App)
- [ ] Confirm `Access-Control-Allow-Origin: '*'` in `jsonOut()` needs no change
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
