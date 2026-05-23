# Dashboard Roadmap (Current Status)

Last updated: 2026-05-15

## Goal

Move `Dashboard` frontend to GitHub Pages and use Google Apps Script (`Code.gs` + `config.gs`) as API over Google Sheets.

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
- API base URL configured in `Dashboard/scripts/api-config.js`

5. Validation and runtime checks passed
- `testSystemIntegrity`: `Errors=0`
- `dailyBatchJob`: contract check `PASS`
- API smoke test passed for `meta`, `health`, `summary`, `trips`, `compare`, `oil`
- Browser Network confirms API calls return 200 via Apps Script redirect flow (302 -> 200)

## Known Warnings (Accepted for now)

1. `M6-M12` source URLs are not configured
- Expected because current operation is monthly rolling update by manual config
- Warning remains until those months are configured

2. API-only deployment warning about HTML validation skip
- Expected and acceptable (frontend is hosted separately on GitHub Pages)

## Remaining Work Before Full Production Lock

1. Frontend final polish (small UI adjustments)
- Owner requested a small additional frontend tweak before final push

2. Final UI regression pass
- Check all 3 main pages and all 6 major sections for layout/function consistency
- Re-check no NaN/Infinity in KPI display
- Re-check FLASH grouping and company/outsource split

3. Deploy + publish workflow
- Commit and push frontend to GitHub repository
- Enable/verify GitHub Pages
- Final smoke test on public Pages URL

## Operating Procedure (Ongoing)

1. Daily
- Run by trigger at 08:30 (UTC+7): `dailyBatchJob`

2. Monthly (day 1)
- Update new source in `config.gs` (`SHEET_SOURCES`) for next month
- Deploy new Apps Script version after config change

3. Post-update checks
- Run `testSystemIntegrity`
- Run `dailyBatchJob`
- Verify `?action=health`

## Next Action

Proceed with the requested small frontend adjustments, then run a final regression checklist and publish to GitHub Pages.
