# Dashboard Roadmap (Current Status)

Last updated: 2026-07-02

For current production operations and release requirements, use
`PRODUCTION_CLOSEOUT_AND_OPERATIONS_RUNBOOK.md` as the authoritative document.

## Goal

Operate the `Dashboard` frontend on Netlify, keep Google Sheets + Apps Script as
the source of truth, and use Supabase as the compact production read model.

## Completed

1. Backend API contract aligned with frontend
- Added and verified endpoints: `meta`, `health`, `summary`, `trips`, `compare`, `oil`, `routes`, `customers`
- `health` now returns system status + contract result

2. Daily batch flow stabilized
- `dailyBatchJob` runs sync -> master rebuild -> cache rebuild -> oil refresh
- Batch report includes contract status, oil status, trigger count
- Partial source failures are surfaced in report

3. Parser and data quality improvements
- Added parse fail reason logs: `noDate`, `noRoute`, `noRecv`, `noPay`, `shortRow`
- Company-vehicle fallback for empty `pay` is supported (set `pay=0` only for company trips)
- Added company classification by `plate + vehicle type` for known company pairs

4. Frontend switched to API-first mode
- `index.html` uses `scripts/api-config.js` + `scripts/app.js`
- Removed eager static data script loading from HTML
- API base URL and freshness fallback configured in `Dashboard/scripts/api-config.js`
- Production frontend hosted at `https://2klogistics-dashboard.netlify.app/`

5. Validation and runtime checks passed
- `testSystemIntegrity`: `Errors=0`
- `dailyBatchJob`: contract check `PASS`
- API smoke test passed for `meta`, `health`, `summary`, `trips`, `compare`, `oil`
- Browser Network confirms API calls return 200 via Apps Script redirect flow (302 -> 200)

## Known Warnings (Accepted for now)

1. `M8-M12` source URLs are not configured
- Expected because current operation is monthly rolling update by manual config
- Warning remains until those months are configured

2. API-only deployment warning about HTML validation skip
- Expected and acceptable (frontend is hosted separately on Netlify)

## Current Production Status

- `DATA(M1)` through `DATA(M7)` are configured
- Apps Script production Web App deployment is version 20
- `dailyBatchJob` is configured for 08:00 Asia/Bangkok
- Netlify/Supabase recovery remains the secondary path
- production validation on 2026-07-02 confirmed 269 trips for 2026-07-01
  from both Apps Script and Supabase

## Operating Procedure (Ongoing)

1. Daily
- Run by trigger at 08:00 (UTC+7): `dailyBatchJob`

2. Monthly (day 1)
- Update new source in `config.gs` (`SHEET_SOURCES`) for next month
- Deploy new Apps Script version after config change

3. Post-update checks
- Run `testSystemIntegrity`
- Run `dailyBatchJob`
- Verify `?action=health`

## Next Action

Before August starts, configure `DATA(M8)`, deploy one new Apps Script Web App
version, and run `npm run apps-script:health`.
