# Production System Verification - 2026-06-25

ตรวจล่าสุด: 2026-06-25 14:28:01 +07:00

เอกสารนี้เป็นบันทึกปิดงาน production ของระบบ 2K Logistics Dashboard หลังย้าย flow หลักมาใช้ Supabase + Netlify Function โดยยังคงให้ Google Apps Script และ Google Sheet เป็นแหล่งประมวลผลต้นทางตามกระบวนการเดิม

## Source Of Truth

| ส่วน | ค่าที่ใช้งานจริง |
| --- | --- |
| Local workspace | `C:\Users\ADMIN\Desktop\Data sum Daily express 4 month V3` |
| GitHub repository | `awiruttangwong/2klogistics-dashboard-v2.0` |
| Netlify site | `2klogistics-dashboard` |
| Production URL | `https://2klogistics-dashboard.netlify.app` |
| Netlify publish directory | `dashboard` |
| Netlify Functions directory | `netlify/functions` |
| Apps Script project | `DASHBOARD-DAILY-QA` |
| Apps Script project id | `1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e` |
| Apps Script source directory | `dashboard/API` |
| Google Sheet | `Database Daily EXPRESS` |
| Google Sheet id | `1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw` |
| Production API mode | `supabase-with-fallback` |

ให้ถือ `dashboard/` ตัวพิมพ์เล็กเป็น source directory ที่ใช้งานจริงสำหรับ frontend และ Apps Script source ใน repo นี้ ส่วน `Dashboard/` ตัวพิมพ์ใหญ่เป็น historical docs/notes เดิม ไม่ใช่ publish directory ของ production

## Data Flow ปัจจุบัน

### 1. Google Sheet และ Apps Script เป็นต้นทางการประมวลผล

1. ข้อมูลต้นทางถูกดึงเข้ามาตาม config ใน `dashboard/API/config.gs`
2. Apps Script ทำงานผ่าน `dailyBatchJob`
3. Trigger ที่ตั้งไว้คือ `08:00 Asia/Bangkok`
4. `dailyBatchJob` rebuild ข้อมูลหลักใน Google Sheet:
   - `MASTER`
   - `SUMMARY_CACHE`
   - `TRIPS_CACHE`
5. Apps Script Web App เปิด endpoint สำคัญ:
   - `health`
   - `summary`
   - `trips`
   - `compare`
   - `oil`
   - `routes`
   - `customers`

ผลตรวจล่าสุดของ Apps Script:

```json
{
  "ok": true,
  "spreadsheetMatchesExpected": true,
  "dailyBatchJobTriggerCount": 1,
  "configuredTimezone": "Asia/Bangkok",
  "configuredHour": 8,
  "expectedWindow": "08:00 Asia/Bangkok",
  "contractPassed": true,
  "configuredMonths": ["DATA(M1)", "DATA(M2)", "DATA(M3)", "DATA(M4)", "DATA(M5)", "DATA(M6)"],
  "tripsTotal": 43000
}
```

หมายเหตุ: `DATA(M7)` ถึง `DATA(M12)` ยังรายงานเป็น missing เพราะตอนนี้ระบบ config ใช้ `DATA(M1)` ถึง `DATA(M6)` เท่านั้น ไม่ใช่ error ของ production ปัจจุบัน

### 2. GitHub Actions Sync จาก Apps Script เข้า Supabase

Workflow ที่ใช้จริง: `.github/workflows/supabase-sync.yml`

Schedule:

```yaml
cron: "30 1 * * *"
```

เวลานี้เท่ากับ `08:30 Asia/Bangkok` เพื่อให้ Apps Script ที่รัน `08:00` มีเวลาสร้าง cache ก่อน Supabase sync เริ่มทำงาน

Sync flow:

1. GitHub Actions เรียก `npm run supabase:sync -- --promote`
2. Script อ่านจาก Apps Script endpoint:
   - `summary`
   - `oil`
   - `trips` แบบ pagination
3. เตรียมข้อมูลเป็น staging rows
4. ตรวจ contract และ local parity
5. เขียน Supabase tables:
   - `sync_runs`
   - `summary_snapshots`
   - `oil_prices`
   - `trips_staging`
   - `parity_reports`
6. เรียก RPC `get_staging_parity_summary`
7. ถ้า parity ผ่าน จึงเรียก RPC `promote_sync_run`
8. Promote แล้วข้อมูลจริงจะถูกย้ายเข้า `trips_active`
9. Production health ตรวจว่า active run เป็น `promoted`, rows ตรงกัน และ sync ไม่ stale

ผลตรวจ GitHub Actions ล่าสุด:

| Workflow | Run | Commit | สถานะ |
| --- | --- | --- | --- |
| Netlify Production Deploy | `28152788708` | `200dccc` | success |
| Supabase Shadow Sync | `28150710857` | `fc42b60` | success |

Secrets ที่ repo มีครบตามชื่อ:

```text
APPS_SCRIPT_API_URL
NETLIFY_AUTH_TOKEN
NETLIFY_SITE_ID
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

ไม่มีการบันทึก secret value ลง repo หรือเอกสารนี้

### 3. Supabase เป็น read model สำหรับ production frontend

Supabase ใช้แนวทาง staging-first:

1. `trips_staging` รับข้อมูลรอบ sync ใหม่
2. `parity_reports` เก็บผลตรวจเทียบ staging กับข้อมูลจาก Apps Script
3. `promote_sync_run` promote เฉพาะรอบที่ parity ผ่าน
4. `trips_active` เป็น active read table ที่ Netlify Function ใช้
5. Views สำหรับ frontend:
   - `active_routes_summary`
   - `active_customers_summary`
   - `active_dates_summary`
6. `summary_snapshots` เก็บ summary payload ที่ frontend ใช้เปิดหน้าแรกเร็วขึ้น
7. `oil_prices` เก็บราคาน้ำมันสำหรับ dashboard

ผลตรวจ production health ล่าสุด:

```json
{
  "ok": true,
  "source": "supabase",
  "syncStatus": "promoted",
  "tripsRows": 43000,
  "rowsMatchActiveTable": true,
  "syncAgeHours": 1,
  "maxDate": "2026-06-24"
}
```

มี warning เรื่อง date group ก่อน `2020-01-01` จำนวน 12 กลุ่ม ซึ่งระบบกรองออกจาก date picker แล้ว จึงไม่เป็น blocker ของการใช้งาน production

### 4. Netlify Function เป็น API layer ของ frontend

Function ที่ใช้จริง: `netlify/functions/supabase-api.mjs`

Production endpoint:

```text
https://2klogistics-dashboard.netlify.app/.netlify/functions/supabase-api
```

Actions ที่ตรวจแล้ว:

| Action | สถานะ | ผลตรวจล่าสุด |
| --- | --- | --- |
| `health` | 200 | `ok=true`, `tripsRows=43000`, `syncStatus=promoted` |
| `summary` | 200 | payload อ่านได้ |
| `dates` | 200 | 175 operational dates, latest `2026-06-24` |
| `routes` | 200 | 673 routes |
| `customers` | 200 | 7 customers |
| `oil` | 200 | 36 oil price rows |
| `trips` | 200 | latest date total 247 rows, pagination ทำงาน |
| `compare` | 200 | latest vs previous date: A 247 rows, B 239 rows |

### 5. Frontend Load Strategy

ไฟล์ config frontend: `dashboard/scripts/api-config.js`

ค่าปัจจุบัน:

```js
apiMode: 'supabase-with-fallback'
supabaseApiUrl: '/.netlify/functions/supabase-api'
eagerTripsOnStartup: false
backgroundTripPreload: false
```

ความหมาย:

1. หน้าแรกเรียก Supabase Function ก่อน
2. ถ้า Supabase Function ใช้งานไม่ได้ จะ fallback ไป Apps Script URL
3. ตอนเปิดระบบไม่โหลด trips ทั้งหมดทันที
4. หน้า dashboard ใช้ `summary_snapshots` ก่อนเพื่อลดเวลาโหลด
5. ข้อมูล trips ถูกโหลดแบบ lazy/on-demand เมื่อผู้ใช้เข้า workflow ที่ต้องใช้ เช่น compare/export
6. หน้า compare ใช้ `dates` เพื่อหา date range แล้วโหลด `trips` เฉพาะช่วงที่ต้องใช้

ผล browser smoke test ล่าสุด:

```json
{
  "status": 200,
  "title": "Logistics Profitability Dashboard",
  "hasApiConfig": true,
  "hasApp": true,
  "consoleIssues": []
}
```

## Deployment Flow

### Netlify Production Deploy

Workflow: `.github/workflows/netlify-production-deploy.yml`

Trigger:

- manual `workflow_dispatch`
- push เข้า `main` เฉพาะ path ที่เกี่ยวข้อง:
  - `dashboard/**`
  - `netlify/**`
  - `netlify.toml`
  - `package.json`
  - `package-lock.json`

Deploy command:

```bash
npx --yes netlify-cli deploy --prod --dir dashboard --functions netlify/functions --site "$NETLIFY_SITE_ID" --auth "$NETLIFY_AUTH_TOKEN"
```

Netlify metadata ล่าสุด:

```json
{
  "site": "2klogistics-dashboard",
  "siteId": "e2eb9250-8a5e-42b0-ba7f-c2acc6b877e4",
  "publishedDeploy": "6a3cd229aa243f86272e7a11",
  "publishedTitle": "GitHub Actions 200dcccca04653ac28493fbff725560f23a6612a",
  "buildSettings": {},
  "deploySource": "cli",
  "availableFunction": "supabase-api"
}
```

`buildSettings` ว่างเป็นสถานะที่ตั้งใจไว้ เพื่อไม่ให้ Netlify direct Git ไปผูก repo ผิด Production deploy ถูกควบคุมจาก GitHub Actions เท่านั้น

## Validation Checklist

| หมวด | ผลตรวจ |
| --- | --- |
| Git remote | `origin` ชี้ `awiruttangwong/2klogistics-dashboard-v2.0.git` |
| Git tracked source | มี `dashboard/API/Code.gs`, `dashboard/API/config.gs`, `dashboard/API/appsscript.json` |
| Netlify publish path | `netlify.toml` กำหนด `publish = "dashboard"` |
| Netlify deploy workflow | ใช้ `--dir dashboard` และ `--functions netlify/functions` |
| Supabase sync workflow | ตั้ง schedule `08:30 Asia/Bangkok` |
| Frontend config | `supabase-with-fallback`, lazy trips enabled |
| JavaScript syntax | `dashboard/scripts/app.js` ผ่าน `node --check` |
| Netlify Function syntax | `netlify/functions/supabase-api.mjs` ผ่าน `node --check` |
| JSON files | `package.json`, `package-lock.json`, `dashboard/API/appsscript.json` parse ได้ |
| Apps Script health | ผ่าน |
| Production health | ผ่าน |
| Production API actions | ผ่านทุก action สำคัญ |
| Browser smoke test | หน้า production โหลดได้และไม่มี console issue |

## Known Non-Blocking Notes

1. `.vscode/settings.json` เป็น local workspace change ที่ไม่ได้เกี่ยวกับ production และไม่ควร commit รวมกับงานปิด production
2. `DATA(M7)` ถึง `DATA(M12)` ยังไม่มีใน config ปัจจุบัน จึงแสดงเป็น missing ใน health report แต่ระบบ production ปัจจุบันใช้ `DATA(M1)` ถึง `DATA(M6)` และผ่าน contract แล้ว
3. มี date groups ก่อน `2020-01-01` ใน Supabase diagnostics จำนวน 12 กลุ่ม ระบบกรองออกจาก date picker แล้วและ production health ยังผ่าน
4. หากอนาคตเพิ่มเดือนใหม่ ต้องเพิ่มใน `DATA_SOURCE_URLS`, `DATA_SOURCE_SHEET_NAMES`, ตรวจ Apps Script health, รัน sync แล้วดู parity ก่อน promote

## Final Verdict

สถานะล่าสุดพร้อมใช้งาน production: **PASS**

ระบบปัจจุบันสามารถใช้งานต่อได้ โดยมี Apps Script + Google Sheet เป็น source processing, Supabase เป็น read model ที่ผ่าน parity ก่อน promote, Netlify Function เป็น API layer และ frontend โหลดข้อมูลแบบลดภาระหน้าแรกพร้อม fallback ไป Apps Script หาก Supabase API มีปัญหา
