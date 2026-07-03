# Production Closeout And Operations Runbook

Last updated: 2026-07-03

## Purpose

This file is the practical closeout record for the current production system.
Use it when:

- reviewing what was fixed in this round
- validating that daily data flow is still healthy
- changing frontend code and releasing safely
- diagnosing why production is not showing the latest sheet data

This is not a design proposal. It reflects the system that is now in use.

## Mandatory rule before any frontend change

This file is the required entrypoint for any developer or AI agent working on
this project.

Required behavior:

1. read this runbook first
2. identify which layer is being changed
3. validate upstream and downstream impact before editing code
4. complete the release checks in this document before closing work

Do not start with code changes first.

Do not assume a frontend symptom is caused by frontend code.

Do not bypass this runbook and patch production behavior blindly.

## Developer and AI agent execution contract

Before making any change, state and record:

```text
Target repo/folder/site:
Change classification:
Smallest affected layer:
Expected pass condition:
Files expected to change:
Existing dirty files that must be preserved:
Production checks required before closeout:
```

During execution:

- maintain an evidence ledger of each check, result, and what it proves
- stop when a gate fails; do not compensate by editing an unrelated layer
- never print, commit, or place access tokens, passwords, service-role keys, or
  OAuth callback URLs in documentation or source files
- stage files explicitly by path; never use a broad commit when the worktree
  contains unrelated changes
- do not alter old repositories, accounts, sites, deployments, or spreadsheets
  to make a failing check appear successful

At closeout:

- distinguish verified facts from assumptions and unknowns
- list every changed/committed file and deployment side effect
- report unresolved warnings even when they are non-blocking
- do not claim completion while a required external action or production check
  remains pending

### Evidence and document precedence

When records disagree, use this order:

1. live production response and provider metadata verified during the task
2. current source on `origin/main`
3. this runbook
4. dated verification reports and roadmap documents

Historical documents are evidence of their date, not current configuration.
Update this runbook when verified production behavior changes. Never rewrite a
historical report merely to make it match the present.

## Quick start for every change

Use this section as the first checklist before touching files.

1. Confirm the target system:
   - repo is `awiruttangwong/2klogistics-dashboard-v2.0`
   - folder is `Data sum Daily express 4 month V3`
   - production site is `https://2klogistics-dashboard.netlify.app/`
   - Apps Script project id is
     `1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e`
   - spreadsheet id is `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw`
2. Classify the change as Type A, B, C, or D using the release
   classification section below.
3. Identify affected outputs before editing:
   - on-screen UI
   - Apps Script/API response
   - Supabase read model
   - `.xlsx` export
   - daily trigger/sync schedule
4. Write down the expected pass condition in one sentence.
5. Only then edit the smallest layer that can satisfy that pass condition.

If the pass condition cannot be stated clearly, stop and clarify the task
before changing code.

## Primary operating principle

This system must be treated as a pipeline, not as an isolated frontend app.

Production correctness depends on these layers staying aligned:

1. source monthly sheets
2. destination spreadsheet import tabs `DATA(M1)` to `DATA(M12)`
3. Apps Script normalization and cache rebuild
4. Apps Script trigger execution
5. Supabase sync and promotion freshness
6. Netlify production deploy
7. frontend rendering and export logic

If a later layer looks wrong, first prove the earlier layer is correct.

## Active production references

- Local workspace folder: `Data sum Daily express 4 month V3`
- GitHub repo: `https://github.com/awiruttangwong/2klogistics-dashboard-v2.0`
- Netlify production: `https://2klogistics-dashboard.netlify.app/`
- Apps Script project: `DASHBOARD-DAILY-QA`
- Apps Script project id: `1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e`
- Destination spreadsheet: `Database Daily EXPRESS`
- Destination spreadsheet id: `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw`

Do not mix this system with any old repository, old Netlify project, or any
`github.com/2klogistics/*` repository.

## System ownership map

Use this map before changing anything.

| Layer | Current owner/system | What it is responsible for |
| --- | --- | --- |
| Source data | Monthly Google Sheets | raw operational input |
| Import and normalization | Apps Script `Code.gs` + `config.gs` | import, clean, map, rebuild cache |
| Batch timing | Apps Script trigger `dailyBatchJob` | daily refresh at 08:00 Asia/Bangkok |
| Fast read model | Supabase | compact production read model |
| Public production delivery | Netlify | site hosting and serverless functions |
| UI behavior/export | `dashboard/scripts/app.js` and frontend files | rendering, compare logic, `.xlsx` generation |

## Non-negotiable safety rules

These rules exist to prevent random fixes that create new production problems.

### Rule 1: Never treat Google Sheets as optional

Google Sheets + Apps Script are the business-authoritative path.

Supabase is an acceleration layer. It is not the source of truth.

### Rule 2: Never ship a frontend fix without checking data freshness path

If data is stale, check:

- source sheet
- destination `DATA(Mx)`
- `MASTER`
- `SUMMARY_CACHE`
- `TRIPS_CACHE`
- Apps Script execution status
- Supabase freshness
- Netlify deploy status

in that order.

### Rule 3: Never change repo/account targets casually

This production system is tied to:

- GitHub repo `awiruttangwong/2klogistics-dashboard-v2.0`
- Netlify production `2klogistics-dashboard.netlify.app`
- Apps Script project `1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e`
- spreadsheet `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw`

Do not reconnect to old repos, old Netlify sites, or unrelated Google accounts.

### Rule 4: Never claim production is fixed without production verification

Local success is not enough.

The fix is not complete until:

- intended files are committed
- production deploy is confirmed
- production behavior is checked on the live URL
- the affected user workflow succeeds end-to-end

### Rule 5: Never modify multiple layers without recording why

If a task changes frontend, Apps Script, and sync behavior together, document:

- the trigger reason
- the exact files changed
- the expected effect
- the verification used

This avoids future confusion about which layer solved the problem.

## Current production model

### Source of truth

Google Sheets + Apps Script remain the source of truth.

- Monthly source files are configured in `dashboard/API/config.gs`
- Apps Script imports those sources into `DATA(M1)` to `DATA(M12)`
- Apps Script rebuilds `MASTER`, `SUMMARY_CACHE`, and `TRIPS_CACHE`
- Frontend reads API/cache output, not raw monthly sheets directly

### Read path for production frontend

The production frontend is designed to prefer the faster Supabase read model
when it is fresh, but it must stay usable even if Supabase is stale or down.

Current intended behavior:

1. `dailyBatchJob` runs at 08:00 Asia/Bangkok
2. Apps Script rebuilds the cache sheets from source data
3. Apps Script can trigger Supabase sync immediately after success
4. Netlify scheduled recovery runs again before 09:00
5. Frontend checks freshness and can fall back to Apps Script if Supabase is
   behind the latest successful batch

This prevents the browser from being blocked by stale infrastructure when the
Google-side batch is already complete.

## Required troubleshooting posture

When something is broken, the operator must follow this mindset:

1. reproduce the exact symptom
2. locate the failing layer
3. prove the cause with evidence
4. fix the smallest correct layer
5. verify the full user flow afterward

Do not:

- edit frontend because production feels stale without checking caches
- change API mode without knowing why
- redeploy repeatedly without verifying which deploy is live
- patch around symptoms while the real upstream layer is still broken

## What was fixed in this closeout

### 1) Supabase storage amplification

The earlier sync design consumed far more disk than the real business payload.

Root cause:

- each sync wrote a full `trips_staging` snapshot
- promotion copied another full set into `trips_active`
- `raw_payload jsonb` was stored in staging and active rows
- multiple indexes amplified disk usage further
- PostgreSQL cleanup did not immediately return disk space

What changed:

- Supabase now stores a compact read model, not duplicated raw snapshots
- `raw_payload` was removed from production row storage
- staging retention was reduced to transient-only behavior
- staging rows are cleared after successful promotion
- recovery/watchdog flow was hardened around the pre-09:00 deadline

Reference:

- `dashboard/docs/SUPABASE_COMPACT_SYNC_DESIGN.md`

### 2) Production reliability before 09:00 Asia/Bangkok

The system was hardened so the daily batch does not depend on a single delayed
GitHub schedule.

Current recovery layers:

- Apps Script primary batch at 08:00
- Apps Script recovery trigger around 08:30; it runs only if today's successful
  batch is still missing
- event-driven sync after successful Apps Script batch
- Netlify scheduled recovery windows before 09:00
- GitHub watchdog as backup, not primary timing
- frontend freshness fallback to Apps Script

### 3) Frontend compare/export stability

Recent frontend work included compare-page and export behavior adjustments, and
the export layer must stay aligned with page logic.

Operational rule:

- any frontend change that touches compare logic, export mapping, labels, or
  API interpretation must be verified in both UI and `.xlsx` output before
  production deploy

Reference:

- `dashboard/docs/FRONTEND_RELEASE_CHECKLIST.md`

### 4) XLSX reviewer-reason contract

The reviewer-reason headers in the normal-view export are a shared data
contract. They are defined once in `qaReasonHeadersBySheet` in
`dashboard/scripts/app.js` and drive all of the following:

- checkbox columns in each detail sheet
- reason-column lookup used by `Helper_ตรวจสอบ`
- checked-trip and checked-route formulas
- the `สรุปเหตุผลที่ผู้ตรวจระบุ` section in `สรุปผลดำเนินงาน`

Current normal-view reason headers are:

| Sheet | Reviewer reasons |
| --- | --- |
| `ขาดทุน` | `ขาดทุน/ไม่สามารถลดราคา พขร. ได้`, `โปร`, `ดันราคา/หารถไม่ได้`, `รถแทน/รถด่วน`, `ใส่ราคารับผิด`, `ใส่ราคาจ่ายผิด`, `รถบริษัท` |
| `ราคาจ่ายผิดปกติ` | `ได้กำไรเท่าเดิม/มากขึ้น`, `ขาดทุน/ไม่สามารถลดราคา พขร. ได้`, `โปร`, `ดันราคา/หารถไม่ได้`, `รถแทน/รถด่วน`, `รอเรทราคาน้ำมันจากลูกค้า`, `ใส่ราคาจ่ายผิด`, `รถบริษัท` |
| `ราคารับผิดปกติ` | `ได้กำไรเท่าเดิม/มากขึ้น`, `ขาดทุน/ไม่สามารถลดราคา พขร. ได้`, `โปร`, `ดันราคา/หารถไม่ได้`, `รถแทน/รถด่วน`, `รอเรทราคาน้ำมันจากลูกค้า`, `ใส่ราคารับผิด`, `รถบริษัท` |
| `สำรองน้ำมัน > 50%` | `น้ำมันไม่พอวิ่ง`, `หลีกเลี่ยงการปิดตู้โอนจ่าย`, `สำรองน้ำมันขาเดียว`, `สำรองน้ำมัน 1 สัปดาห์`, `รถบริษัท` |

The added reasons on `ขาดทุน` and `สำรองน้ำมัน > 50%`, together with
`รถบริษัท` on all four reviewer sheets, apply only to normal view. Compare view
keeps its original reason headers unless a future requirement explicitly
changes that scope.

When changing a reason header:

1. edit `qaReasonHeadersBySheet`; do not add a disconnected header directly to
   a worksheet or summary block
2. preserve the exact Thai text because formulas map reasons by exact string
3. keep existing reason order unless the business requirement changes it
4. run `npm run test:xlsx-reviewer-reasons`
5. export normal view and verify the detail sheet, `Helper_ตรวจสอบ`, and
   `สรุปเหตุผลที่ผู้ตรวจระบุ` together

Changing only the visible detail-sheet header is incomplete and can make the
workbook appear correct while its helper formulas and summary counts are wrong.

### 5) Route display contract

The route identity used for grouping/comparison and the label shown to users are
separate contracts. Do not change `routeIdentityKey` when the requirement only
changes visible text.

Current display policy:

- every customer prefers `routeDesc`, which carries the code from the source
  `ชื่อเส้นทาง` column
- parseable FLASH/SPX timed codes retain the existing normalized form with the
  time segment removed
- when `routeDesc` is empty, the resolver falls back to the existing route/group
  fields so the UI remains usable
- frontend tables, route filters, normal-view XLSX, status sheets, and
  `Helper_ตรวจสอบ` must all use `resolveRouteDisplayLabel` through
  `routeDisplay` or `routeGroupHeaderDisplay`

When changing this policy:

1. keep route identity/grouping unchanged unless the business requirement
   explicitly changes matching behavior
2. update the shared resolver instead of patching individual tables or sheets
3. run `npm run test:route-display-policy`
4. inspect normal-view UI and XLSX route labels together before production

### 6) Normal-view XLSX freeze-pane contract

The normal-view export must freeze rows 1 through 3 so the column headings stay
visible while users scroll. This applies only to these sheets:

- `รายเส้นทางที่เปรียบเทียบ`
- `ขาดทุน`
- `สำรองน้ำมัน > 50%`
- `ราคาจ่ายผิดปกติ`
- `ราคารับผิดปกติ`
- `ข้อมูลไม่เปลี่ยนแปลง`
- `ไม่มีข้อมูลเปรียบเทียบ`

The contract is configured with `freezeRows: 3` in `printSettingsBySheet` and
serialized into each worksheet XML by `patchWorksheetFreezeXml`. Do not rely on
the worksheet `!freeze` property alone: the current SheetJS writer does not
persist that property into the generated `.xlsx` file.

When changing worksheet names, header-row counts, or the export writer:

1. keep `printSettingsBySheet`, the worksheet names, and the XML patch aligned
2. run `npm run test:xlsx-freeze-panes`
3. run the route-display and reviewer-reason regression tests
4. download the production workbook and verify that cell `A4` is the first
   scrollable row on all seven sheets

## Release classification

Before touching code, classify the task.

### Type A: Frontend-only change

Examples:

- labels
- layout
- compare-page rendering
- export formatting
- client-side filtering or interaction behavior

Minimum required checks:

- local syntax check
- manual UI smoke test
- export smoke test
- production deploy verification

### Type B: Frontend + API interpretation change

Examples:

- new fields in compare/export
- changed mapping from API payload to UI/export
- changed fallback behavior

Minimum required checks:

- all Type A checks
- API response contract check
- verify both Apps Script and Supabase paths

### Type C: Apps Script/config change

Examples:

- new monthly source
- source tab name change
- import logic change
- trigger/scheduling behavior change

Minimum required checks:

- Apps Script save
- if Web App/API behavior is involved, create a new deployment version
- verify `DATA(Mx)`, `MASTER`, `SUMMARY_CACHE`, `TRIPS_CACHE`
- verify production reads the new result

### Type D: Sync/infra change

Examples:

- Supabase schema/sync flow
- Netlify serverless functions
- watchdog or recovery schedules

Minimum required checks:

- code validation
- freshness validation
- recovery-path validation
- production smoke test against live site

## Current known-good operating assumptions

These assumptions are required for the system to behave correctly every day:

- Apps Script trigger `dailyBatchJob` exists and remains scheduled at 08:00
  Asia/Bangkok
- Apps Script trigger `dailyBatchRecoveryJob` exists around 08:30 Asia/Bangkok
  and skips when the primary batch already succeeded
- the Apps Script project is the bound script for spreadsheet
  `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw`
- `config.gs` contains the correct monthly source URLs
- the source tabs referenced in `SOURCE_SHEET_NAMES` still exist
- Netlify production still points to the repo
  `awiruttangwong/2klogistics-dashboard-v2.0`
- production frontend still uses the current API mode/freshness fallback logic

If any one of these assumptions changes silently, production can look healthy
while serving stale data.

## Frontend change contract

Any person or AI agent changing frontend must preserve these contracts unless
the task explicitly changes them:

1. production must remain usable even if Supabase is stale
2. compare page must open without hanging
3. `มุมมองปกติ` and `เปรียบเทียบ` exports must stay aligned with on-screen logic
4. date/range filters must affect rendered data and exported data consistently
5. no frontend change may silently point production to the wrong backend

If a change breaks one of these contracts, the work is not complete.

## When frontend changes are made

Use this sequence every time.

### Step 1: Local validation

- `cmd /c node --check dashboard\\scripts\\app.js`
- `git status --short`
- manual smoke check:
  - main page loads
  - compare page opens
  - filters change results correctly
  - export works in normal and compare views

Recommended command set for frontend/export changes:

```powershell
cmd /c node --check dashboard\scripts\app.js
cmd /c npm run test:xlsx-reviewer-reasons
cmd /c npm run test:daily-sync-readiness
cmd /c npm run test:pre-nine-recovery
cmd /c npm run test:supabase-cli-guard
cmd /c npm run production:health
cmd /c npm run apps-script:health
git diff --check
```

Use the relevant subset only when the task is very small. For any production
release that changes compare, export, API mode, freshness, sync, or scheduling,
run the full set and record the result.

### Step 2: Push only intended files

- commit only files related to the release
- push to `main`

Before push, confirm:

- no unrelated debugging files were included
- no secrets or tokens were added
- no account-specific local settings were staged accidentally

### Step 3: Verify Netlify production actually updated

Do not assume GitHub push means production changed.

Check:

- latest Netlify deploy is published
- production page reflects the new code
- no loading loop or console error appears

If auto deploy does not publish, use:

- `dashboard/docs/NETLIFY_MANUAL_PRODUCTION_DEPLOY.md`

### Step 4: Smoke test against production URL

Required checks on `https://2klogistics-dashboard.netlify.app/`:

- summary data loads
- compare page opens without hanging
- selected dates/ranges return expected rows
- export file downloads and sheet content is correct

### Step 5: Close the work with evidence

Record at minimum:

- date
- commit SHA
- files changed
- deployment path used
- production verification result
- unresolved risks, if any

Do not close work with vague statements like "should be fine now".

Suggested closeout note format:

```text
Date:
Change type:
Commit:
Files changed:
Deploy path:
Production URL checked:
Local checks:
Production checks:
Affected user workflow verified:
Known remaining risk:
Next monthly/config action, if any:
```

If any field is unknown, the work is not ready to be called complete.

## Mandatory monthly roll-forward protocol

Use this protocol for every new `DATA(Mx)` source, including `DATA(M8)`.
Do not improvise a different sequence unless the source schema itself changed.

### Monthly change boundary

For a normal month rollover, the intended change is exactly one source URL in
`SHEET_SOURCES` inside `dashboard/API/config.gs`.

The following are already generic for `DATA(M1)` through `DATA(M12)`:

- source iteration in `Code.gs`
- destination sheet creation
- `MASTER` rebuild
- `SUMMARY_CACHE` and `TRIPS_CACHE` rebuild
- API date filtering
- Supabase compact sync and promotion
- frontend date/range filtering

Therefore, do not change `Code.gs`, frontend files, Supabase schema, Netlify
functions, trigger timing, or previous month URLs for a normal rollover.

Stop and reclassify the work as a larger Type C/B/D change if any of these are
different in the new source:

- source tab name
- required headers or column positions
- date format
- route/customer/vehicle identity rules
- permissions or owning Google account

### Required inputs

Record these before editing anything:

```text
Target month: DATA(M_)
Source spreadsheet URL:
Source spreadsheet id:
Source tab name:
First expected operational date:
Expected owner/account:
Production Apps Script deployment id:
Previous deployment version:
```

For August, the target is `DATA(M8)` and the default source tab is `SUMDATA`.
Never guess the URL, spreadsheet id, tab name, or account.

### Phase 0: Target and workspace preflight

Run:

```powershell
git remote get-url origin
git branch --show-current
git status --short
cmd /c netlify status
```

Pass conditions:

- origin is `awiruttangwong/2klogistics-dashboard-v2.0`
- branch is `main` or an explicitly named monthly release branch
- Netlify project is `2klogistics-dashboard`
- Apps Script project id remains
  `1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e`
- destination spreadsheet id remains
  `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw`

An unrelated dirty worktree is not permission to clean, revert, or commit those
files. Record them and stage only the monthly config/runbook files.

### Phase 1: Source acceptance gate

Before changing production, inspect the new source spreadsheet and prove:

- the expected tab exists with the exact name in `SOURCE_SHEET_NAMES`
- the dashboard account can open it
- required headers and column positions match the previous accepted month
- the first expected date is present and parses as the intended calendar date
- at least one valid operational row exists
- there are no `#REF!`, permission, or formula errors in required columns

If any item fails, stop. Do not deploy an empty or structurally different
source and do not patch the frontend to hide the source failure.

### Phase 2: Minimal config change

1. Set only `SHEET_SOURCES['DATA(Mx)']` in `dashboard/API/config.gs`.
2. Keep `SOURCE_SHEET_NAMES['DATA(Mx)']` unchanged unless Phase 1 proved the
   source tab uses a different exact name.
3. Verify the diff:

```powershell
git --no-pager diff -- dashboard/API/config.gs dashboard/API/Code.gs
git diff --check
```

Pass condition: the diff contains only the intended month URL unless a separate
schema change was explicitly approved.

Never run `clasp push` from a workspace where `dashboard/API/Code.gs` or another
Apps Script file has unrelated changes. `clasp push` uploads the Apps Script
project, not just the one config line.

If Apps Script files are dirty, use one of these safe paths:

1. preferred: create a clean release worktree from `origin/main`, apply the one
   config change there, and push from that clean worktree
2. fallback: edit the same one line in the Apps Script editor, then use
   `clasp pull` into a temporary folder and compare remote source with the repo

### Phase 3: Repository and Apps Script alignment

Commit and push only intended files. Then save the same config in Apps Script.

Before deployment, prove all three copies agree:

- repository `config.gs`
- latest saved Apps Script source
- intended source spreadsheet URL/tab

Do not continue if any character of the spreadsheet id or tab name differs.

### Phase 4: Update the existing Web App deployment

Apps Script uses two code states:

- installable triggers run the latest saved project code
- `/exec` runs the version selected by the Web App deployment

List deployments and identify the deployment id already used by
`APPS_SCRIPT_API_URL`:

```powershell
npx -y @google/clasp deployments
```

Update that existing deployment to a new version. Preserve the deployment id
and `/exec` URL. Do not create or switch to an unrelated Web App URL.

After deployment:

```powershell
cmd /c npm run apps-script:health -- --month 8
```

Replace `8` with the target month number. The explicit override is mandatory
when preparing the next month before the calendar changes. Without `--month`,
the checker intentionally validates the current month in Asia/Bangkok.

Pass conditions:

- `ok` is `true`
- `requiredCurrentMonth` equals the target `DATA(Mx)`
- `configuredMonths` includes that exact month
- spreadsheet/project ids match production
- exactly one `dailyBatchJob` trigger exists at 08:00 Asia/Bangkok
- exactly one `dailyBatchRecoveryJob` trigger exists around 08:30 Asia/Bangkok

### Phase 5: Controlled import and promotion

Run `dailyBatchJob` once after the source acceptance gate passes, or let the
08:00 trigger run. Do not launch repeated overlapping batches.

Required batch evidence:

- `ok: true`
- `syncErrors: []`
- `errors: []`
- `contractPassed: true`
- current month reports imported rows
- audit status is `SUCCESS`
- Supabase callback is accepted with HTTP 202

If the callback fails but Apps Script data is correct, keep the frontend
fallback active and use the Netlify recovery path. Do not rerun the Google batch
just to retry Supabase.

### Phase 6: End-to-end parity gate

Verify the first operational date through every layer:

1. source sheet contains the expected rows
2. destination `DATA(Mx)` contains that date
3. `MASTER` contains those rows
4. `SUMMARY_CACHE` and `TRIPS_CACHE` were rebuilt
5. Apps Script `trips` API returns rows for that date
6. Supabase `trips` API returns the same row count for that date
7. production date selector exposes the date and renders its data

Run the standard checks:

```powershell
cmd /c npm run test:daily-sync-readiness
cmd /c npm run test:pre-nine-recovery
cmd /c npm run test:supabase-cli-guard
cmd /c npm run apps-script:health -- --month 8
cmd /c npm run production:health
git diff --check
```

Replace `8` with the target month number.

For a config-only rollover, `.xlsx` regression is not required unless export or
frontend code changed. If either changed, run the complete frontend/export
checklist instead.

### Phase 7: Closeout evidence

Append one monthly closeout record to this runbook containing:

```text
Date and timezone:
Target month and source spreadsheet id/tab:
Change type:
Commit SHA:
Apps Script deployment id and old/new version:
Trigger count/timezone/hour:
Batch finishedAt and imported row count:
Apps Script count for first operational date:
Supabase count for the same date:
Supabase promotion status:
Production URL checked:
Known warnings:
Next month action and deadline:
```

The work is not complete if a field is unknown. Do not use `100%`, `finished`,
or `production healthy` when parity or deployment identity was not verified.

### Stop and rollback rules

- source gate fails: make no production change
- wrong URL/tab saved but not deployed: restore the config before deployment
- wrong config deployed but batch not run: select the previous Web App version
  or deploy the corrected config immediately using the same deployment id
- batch fails before cache rebuild: do not promote Supabase; preserve the last
  known-good frontend fallback
- Apps Script and Supabase counts differ: treat Supabase as stale, keep Apps
  Script authoritative, run recovery once, and investigate before closing
- wrong repo/account/site detected: stop immediately; do not adapt the target

Never delete previous month data, reset Supabase, change trigger schedules, or
rewrite frontend logic as a monthly rollover rollback.

### Monthly timing

- three business days before month start: obtain URL/access and complete Phase 1
- one business day before month start: complete Phases 0-4
- first data day after source is ready: complete Phases 5-7
- before 09:00 Asia/Bangkok: production must either serve fresh Supabase data or
  current Apps Script data through fallback

### DATA(M8) operator card

Use this card for the August 2026 rollover:

1. by 2026-07-29: obtain the M8 source URL, confirm access, exact `SUMDATA` tab,
   headers, columns, and first expected date
2. by 2026-07-31: change only `SHEET_SOURCES['DATA(M8)']`, align repo and saved
   Apps Script source, then update the existing production deployment id
3. verify the deployment before August starts:

```powershell
cmd /c npm run apps-script:health -- --month 8
```

4. on the first August data day: run one batch after source data is ready
5. compare Apps Script and Supabase counts for the same first operational date
6. append a `DATA(M8)` closeout record before declaring completion

Do not copy the M7 URL, create a new Web App URL, or modify M7 while enabling M8.

## Required verification matrix

Use this matrix when validating a fix.

| Check | Why it matters | Pass condition |
| --- | --- | --- |
| Source tab | proves upstream data exists | expected rows/date visible |
| `DATA(Mx)` | proves import succeeded | current month data present |
| `MASTER` | proves merge layer succeeded | imported rows included |
| `SUMMARY_CACHE` | proves summary cache rebuilt | current aggregates visible |
| `TRIPS_CACHE` | proves trip cache rebuilt | current trip rows visible |
| Apps Script execution | proves batch ran | latest `dailyBatchJob` succeeded |
| Supabase freshness | proves fast path is current | promoted data matches latest batch |
| Netlify deploy | proves live code is current | latest intended release is published |
| Production UI | proves user path works | page loads and renders correctly |
| Production export | proves downstream artifact works | `.xlsx` content matches UI logic |

## How to diagnose "sheet has data but production does not update"

Follow this order. Do not skip layers.

### Layer 1: Confirm source sheet really has today’s data

Check the relevant monthly/source tab first.

If the source tab itself is incomplete, production is not the problem.

### Layer 2: Confirm Apps Script imported the source

Check in the destination spreadsheet:

- `DATA(Mx)` for the active month
- `MASTER`
- `SUMMARY_CACHE`
- `TRIPS_CACHE`

If source has data but these sheets do not, the issue is in Apps Script import
or cache rebuild.

### Layer 3: Confirm Apps Script batch succeeded today

Check:

- Apps Script executions for `dailyBatchJob`
- trigger status
- any import/cache rebuild errors

Typical causes:

- wrong source URL in `config.gs`
- source tab name mismatch
- `#REF!` or formula errors in source sheet
- permissions issue opening source spreadsheet

### Layer 4: Confirm Supabase sync caught the successful batch

If Apps Script is correct but frontend is stale:

- verify the Netlify sync/recovery functions ran
- verify Supabase health and promotion freshness
- verify the frontend freshness logic is not still seeing yesterday’s batch

If Supabase is behind but Apps Script is correct, the frontend should still
remain usable via fallback. That means the failure is a freshness/recovery issue,
not a source-data issue.

### Layer 5: Confirm production deploy is current

If logic was fixed in code but production still behaves like old code:

- check latest Git commit on `main`
- check latest Netlify published deploy
- redeploy using the manual draft-and-restore procedure if needed

## How to diagnose "frontend bug" correctly

Use this decision path.

### Case 1: Rendering bug only

Examples:

- wrong text
- spacing issue
- wrong section shown
- compare/export heading mismatch

Likely layer:

- frontend only

Still verify:

- export output if the affected screen exports data
- production deploy after release

### Case 2: Wrong totals, wrong rows, wrong compare results

Likely layers:

- Apps Script normalization
- API interpretation
- frontend mapping

Required action:

- compare source values, cache values, API values, and rendered values before
  editing code

### Case 3: Loading hangs or stale data

Likely layers:

- Apps Script batch status
- Supabase freshness
- production deploy mismatch
- fallback logic

Required action:

- do not start by changing UI code
- verify freshness path first

## Prohibited operator mistakes

These are common ways to make the system worse.

- changing frontend first when the issue is stale upstream data
- changing `config.gs` without noting which month/source changed
- forgetting Web App redeploy after API/config-impacting Apps Script changes
- assuming GitHub push means Netlify production updated
- treating Supabase as authoritative when Apps Script already has newer data
- fixing compare-page UI without checking export behavior
- committing unrelated local files with a production fix
- using old repos/accounts because they look familiar

Avoid all of them.

## Most common failure patterns and the correct response

### A) New month starts and data stops importing

Cause:

- `config.gs` for the new `DATA(Mx)` is blank

Fix:

1. fill the new month URL
2. save Apps Script
3. deploy a new Web App version once
4. run the batch again or wait for the trigger

### B) Google Sheet has data, dashboard still shows old data

Cause candidates:

- Apps Script batch did not finish
- Supabase sync did not promote latest batch
- Netlify production is serving old frontend code

Fix:

- trace in this order: source sheet -> `DATA(Mx)` -> cache sheets ->
  Apps Script execution -> Supabase freshness -> Netlify production deploy

### C) Supabase becomes unavailable or stale

Cause:

- database health issue
- delayed recovery job
- stale promoted snapshot

Fix:

- keep frontend fallback active
- diagnose storage/health separately
- never force the browser to wait on a broken Supabase first

### D) A frontend release breaks compare or export

Cause:

- frontend mapping changed without validating page output and `.xlsx` output

Fix:

- compare the page logic and export logic together
- test both `มุมมองปกติ` and `เปรียบเทียบ`
- redeploy only after production smoke passes

## Minimum validation before saying "production is healthy"

All of these should be true:

- today’s source sheet is populated
- Apps Script batch completed successfully
- destination cache sheets contain today’s data
- production frontend loads without stuck loading states
- compare page opens normally
- export works for the affected views
- Netlify production is on the intended release
- Supabase is either fresh or the frontend fallback is correctly serving current
  Apps Script data

If any one of these is unknown, do not claim the system is fully healthy.

## Definition of done for production work

Production work is done only when all applicable items are true:

- the changed layer is identified and documented
- the code or config change is the smallest layer that solves the task
- no old repo, old Netlify site, or old Google account was used
- required local checks passed
- required production checks passed
- affected `.xlsx` exports were downloaded from production and inspected when
  export behavior changed
- no secrets, tokens, local settings, or unrelated dirty files were committed
- the final answer states any known limitation plainly

For frontend-only visual changes that do not affect data, export, API mode, or
sync, the export-specific item can be marked not applicable. For anything that
touches compare/export logic, it is mandatory.

## Recommended operating discipline going forward

1. Keep Google Sheets + Apps Script as the business-authoritative pipeline.
2. Keep Supabase small and disposable as a read model, not a raw history store.
3. Treat Netlify deploy verification as a required release step.
4. For every new month, update `config.gs` before the month starts.
5. After any API/config change in Apps Script, deploy a new Web App version once.
6. After any frontend change, verify both UI behavior and exported `.xlsx`.
7. If production looks stale, debug the pipeline in order instead of patching the
   browser first.

## Closeout record: DATA(M7) activation

Date: 2026-07-02 Asia/Bangkok

- change type: Type C (Apps Script/config) with production freshness verification
- repository commit: `6e0f962`
- source: `DATA(M7)` points to spreadsheet
  `1sMshl7_b-dvrtnDYcl-WQt467gSnfdLw0o35rgRFJMU`, tab `SUMDATA`
- Apps Script production deployment: existing `/exec` deployment updated from
  version 19 to version 20; URL was preserved
- trigger: one `dailyBatchJob` trigger at 08:00 Asia/Bangkok
- batch result: success, 269 rows added, no sync or audit errors
- Supabase callback: accepted with HTTP 202
- parity check for `2026-07-01`: Apps Script 269 trips, Supabase 269 trips
- production health: promoted, 44,698 active trips, maximum date `2026-07-01`
- next monthly action: configure and deploy `DATA(M8)` before August starts

## Backend validation record: Google-side batch recovery

Date: 2026-07-03 Asia/Bangkok

- reported symptom: source data appeared not to reach the destination/cache
  pipeline before the expected morning deadline
- verified observation: the successful batch started at 09:12 and finished at
  09:15 Asia/Bangkok even though the primary trigger was configured for 08:00
- verified pipeline result: 266 new source rows were imported, Apps Script
  completed without sync errors, and Supabase promotion succeeded
- design gap: Netlify and GitHub recovery could retry Supabase only after an
  Apps Script batch succeeded; they could not start a missing Google-side batch
- fix: added `dailyBatchRecoveryJob` around 08:30; it shares the primary lock
  and skips when a successful Bangkok-date batch already exists
- Apps Script production deployment: existing `/exec` deployment updated from
  version 20 to version 21; URL was preserved
- installed triggers: `dailyBatchJob` count 1 at 08:00 and
  `dailyBatchRecoveryJob` count 1 around 08:30
- validation: Apps Script health passed, production health passed, recovery
  tests passed, and Apps Script/Supabase both returned 271 trips for 2026-07-02
- limitation: Apps Script time triggers are approximate and provider execution
  logs were unavailable through clasp; the exact provider-side delay cause was
  not asserted
- release state: backend recovery work is complete; final production closeout
  remains pending the next requested frontend change and its regression checks

## Final production closeout: backend recovery and route-code display

Date: 2026-07-03 Asia/Bangkok

- backend commit: `233634b` (`Add Google-side daily batch recovery`)
- frontend commit: `37dfdb5` (`Use route-name codes across dashboard exports`)
- Apps Script production deployment: version 21 on the existing `/exec` URL
- installed triggers: `dailyBatchJob` count 1 at 08:00 and
  `dailyBatchRecoveryJob` count 1 around 08:30
- latest verified batch: success, 266 new rows, no batch/sync errors, contract
  passed, audit status `SUCCESS`, and Supabase callback accepted with HTTP 202
- parity: Apps Script and Supabase both returned 271 trips for 2026-07-02
- Supabase: latest production state `promoted`, 44,943 active trips
- route display: all customers prefer the source `ชื่อเส้นทาง` code; parseable
  FLASH/SPX timed codes retain the normalized no-time form
- route identity/grouping was not changed
- production frontend `app.js` SHA-256 matched the committed local file
- automated checks passed: route display policy, XLSX reviewer reasons,
  pre-09:00 recovery, daily sync readiness, and Supabase CLI guard
- production XLSX acceptance: user manually verified the post-deploy normal-view
  export `วิเคราะห์ผลการดำเนินงาน_02-07-2026.xlsx` created at 10:31 Asia/Bangkok
- Git: local `main` matched `origin/main` at closeout
- accepted warning: 12 date groups before 2020 remain excluded by the production
  date picker
- release state: complete

Do not rerun `installDailyTriggerForAutomation` during normal daily operation.
Run it only when health reports a missing/duplicate primary or recovery trigger,
after an intentional trigger configuration change, or after moving the Apps
Script project/account. Re-running it unnecessarily deletes and recreates the
two triggers and provides no additional reliability.

## Closeout record: normal-view XLSX freeze panes

Date: 2026-07-03 Asia/Bangkok

- implementation commit: `5cdae8e` (`Freeze normal XLSX headers through row 3`)
- scope: normal-view export only; rows 1 through 3 are frozen on the seven
  detail/status sheets listed in the freeze-pane contract
- implementation: worksheet pane state is serialized through
  `patchWorksheetFreezeXml`; the non-persisted `!freeze` hint is not treated as
  sufficient
- compare-view behavior, route identity, reviewer-reason formulas, backend
  import/sync logic, and trigger configuration were not changed
- automated checks passed: JavaScript syntax, XLSX freeze panes, route display,
  XLSX reviewer reasons, daily sync readiness, pre-09:00 recovery, Supabase CLI
  guard, and `git diff --check`
- Netlify production served cache version `20260703-xlsx-freeze-row3`; normalized
  production/local `app.js` SHA-256 matched at
  `e97e813ff424efeb8aaa09cd646d566bb8b54d042887448e40560445641ac490`
- post-deploy production health passed with Supabase status `promoted` and
  44,943 active trips
- post-deploy Apps Script health passed against project
  `1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e` and spreadsheet
  `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw`; primary/recovery trigger
  counts remained 1/1

## Closeout record: `รถบริษัท` reviewer reason

Date: 2026-07-03 Asia/Bangkok

- implementation commit: `f74945c` (`Add company vehicle reviewer reason`)
- scope: normal-view XLSX only; `รถบริษัท` is the final reviewer-reason column
  on `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, and
  `ราคารับผิดปกติ`
- the shared reason mapping drives the detail columns, `Helper_ตรวจสอบ`,
  checked-route/checked-trip formulas, and `สรุปเหตุผลที่ผู้ตรวจระบุ`
- `รถบริษัท` appears once in the summary reason list even though it is shared by
  four detail sheets
- compare-view XLSX retains its previous headers and contains no `รถบริษัท`
  reviewer reason
- production and local `app.js` normalized SHA-256 matched at
  `377cdba59cd35b338b482e42f526387ac5563423f60e7133c16afe21ae0b4753`
- production normal-view XLSX was downloaded and read back successfully: all
  four target sheets contain the header, worksheet XML contains the `☐,☑`
  validation list, `Helper_ตรวจสอบ` and summary each contain one shared reason
  column/row, and the workbook scan found no formula errors
- production compare-view XLSX was downloaded and read back successfully: all
  four target sheets contain zero `รถบริษัท` reason headers
- automated checks passed: JavaScript syntax, reviewer reasons, route display,
  freeze panes, daily sync readiness, pre-09:00 recovery, Supabase CLI guard,
  and `git diff --check`
- production health passed with Supabase status `promoted` and 44,943 active
  trips; Apps Script health passed with the expected project/spreadsheet,
  primary trigger count 1 at 08:00, and recovery trigger count 1 around 08:30

## Required handoff note for future developers and AI agents

Before making a change, read this file completely.

When finishing a task, update or reference the following if relevant:

- this runbook
- `dashboard/docs/FRONTEND_RELEASE_CHECKLIST.md`
- `dashboard/docs/NETLIFY_MANUAL_PRODUCTION_DEPLOY.md`
- `dashboard/docs/CODE_GS_IMPORT_AND_QUERY_LOGIC.md`
- `dashboard/docs/SUPABASE_COMPACT_SYNC_DESIGN.md`

The goal is not just to make the current bug disappear.

The goal is to keep the whole pipeline understandable, verifiable, and safe to
change repeatedly.

## Related documents

- `dashboard/docs/CODE_GS_IMPORT_AND_QUERY_LOGIC.md`
- `dashboard/docs/SUPABASE_COMPACT_SYNC_DESIGN.md`
- `dashboard/docs/NETLIFY_MANUAL_PRODUCTION_DEPLOY.md`
- `dashboard/docs/FRONTEND_RELEASE_CHECKLIST.md`
- `dashboard/docs/XLSX_NORMAL_VIEW_COUNT_DEFINITIONS.md` - นิยามตัวเลข
  `จำนวนรายการที่มีความผิดปกติ`, `รายการตรวจสอบทั้งหมด` และ
  `จำนวนเที่ยวที่อยู่ในรายการตรวจสอบ` ของ XLSX มุมมองปกติ
