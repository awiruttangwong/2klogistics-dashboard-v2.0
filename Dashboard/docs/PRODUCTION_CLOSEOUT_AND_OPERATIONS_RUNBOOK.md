# Production Closeout And Operations Runbook

Last updated: 2026-07-02

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
| `ขาดทุน` | `ขาดทุน/ไม่สามารถลดราคา พขร. ได้`, `โปร`, `ดันราคา/หารถไม่ได้`, `รถแทน/รถด่วน`, `ใส่ราคารับผิด`, `ใส่ราคาจ่ายผิด` |
| `ราคาจ่ายผิดปกติ` | `ได้กำไรเท่าเดิม/มากขึ้น`, `ขาดทุน/ไม่สามารถลดราคา พขร. ได้`, `โปร`, `ดันราคา/หารถไม่ได้`, `รถแทน/รถด่วน`, `รอเรทราคาน้ำมันจากลูกค้า`, `ใส่ราคาจ่ายผิด` |
| `ราคารับผิดปกติ` | `ได้กำไรเท่าเดิม/มากขึ้น`, `ขาดทุน/ไม่สามารถลดราคา พขร. ได้`, `โปร`, `ดันราคา/หารถไม่ได้`, `รถแทน/รถด่วน`, `รอเรทราคาน้ำมันจากลูกค้า`, `ใส่ราคารับผิด` |
| `สำรองน้ำมัน > 50%` | `น้ำมันไม่พอวิ่ง`, `หลีกเลี่ยงการปิดตู้โอนจ่าย`, `สำรองน้ำมันขาเดียว`, `สำรองน้ำมัน 1 สัปดาห์` |

The added reasons on `ขาดทุน` and `สำรองน้ำมัน > 50%` apply only to normal
view. Compare view keeps the original four `ขาดทุน` reasons and the original
two `สำรองน้ำมัน > 50%` reasons unless a future requirement explicitly changes
that scope.

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

## When source data for a new month starts

Example: moving from June to July.

`config.gs` must be updated with the new source URL:

- add the correct spreadsheet URL to `SHEET_SOURCES['DATA(M7)']`

Important behavior:

- `Code.gs` already loops `DATA(M1)` to `DATA(M12)`
- `SOURCE_SHEET_NAMES['DATA(M7)']` already exists
- therefore, the logic does not need a code rewrite for a new month

What must be done:

1. update the URL in `config.gs`
2. commit the same URL to the repository copy of `config.gs`
3. save the Apps Script project
4. for Web App/API consistency, run:
   `Deploy > Manage deployments > Edit > New version > Deploy`
5. run `npm run apps-script:health` and confirm `requiredCurrentMonth`
   appears in `configuredMonths`

Impact of that deployment:

- trigger logic continues to use the latest saved code
- the existing `/exec` web app serves the new config version
- it should not affect other logic if no unrelated code changed

Important Apps Script behavior:

- an installable trigger runs the latest saved project code
- the Web App `/exec` endpoint runs its selected deployment version
- therefore, a trigger can import a newly configured month while `/exec?action=meta`
  still reports the old month configuration

Do not close a new-month change until the repository, saved Apps Script source,
and deployed Web App metadata all list the same current month.

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
