# Supabase Database Migration Plan

> Status: historical migration planning note. For the current production source
> of truth, use `README.md` in the repository root. Current GitHub repo is
> `awiruttangwong/2klogistics-dashboard-v2.0`; current Netlify site is
> `2klogistics-dashboard`; deploys are handled by GitHub Actions.

Last updated: 2026-06-23

## Purpose

เอกสารนี้เป็นแผนย้ายฐานข้อมูลของ `2klogistics-dashboard` จากรูปแบบ Google Sheets + Apps Script cache ไปสู่ Supabase โดยมีเป้าหมายหลักคือ:

- ให้ระบบใหม่ทำงานได้เหมือน `Dashboard/API/Code.gs` ทั้งหมดก่อน
- ลดความเสี่ยงต่อ repo และ production เดิม
- คง Google Sheet ต้นทางไว้ในช่วงแรก
- เพิ่ม Supabase เป็นฐานข้อมูลกลางที่เร็วกว่า เสถียรกว่า และตรวจสอบย้อนหลังได้ดีกว่า
- ให้ frontend เปลี่ยนแหล่งข้อมูลได้แบบค่อยเป็นค่อยไป โดยไม่เสีย contract เดิม

## Current Backend Model

ระบบปัจจุบันมี `Code.gs` เป็น backend หลัก และ frontend เรียกข้อมูลผ่าน Apps Script Web App URL ใน `Dashboard/scripts/api-config.js`

Flow ปัจจุบัน:

```text
Google Sheet ต้นทาง
  -> Code.gs เปิด source spreadsheet ตาม SHEET_SOURCES
  -> อ่าน tab SUM / SUMDATA ตาม SOURCE_SHEET_NAMES
  -> อ่านผลลัพธ์ที่แสดงจริงด้วย getDisplayValues()
  -> คัดคอลัมน์ตาม SELECT_COLS
  -> คัดแถวตาม NOT_NULL_COLS
  -> เขียน DATA(M1)-DATA(M12)
  -> processSheetData() cleanup
  -> rebuildMasterSheet() รวมเป็น MASTER
  -> parseTripRow() normalize เป็น trip object
  -> rebuildCaches() สร้าง SUMMARY_CACHE และ TRIPS_CACHE
  -> doGet() เปิด API ให้ frontend เรียก
```

ข้อสำคัญ: `Code.gs` ไม่ได้สร้างหรือรัน `QUERY()` เอง แต่จะอ่านผลลัพธ์ที่ tab ต้นทางแสดงไว้แล้ว ดังนั้นถ้า source sheet ใช้ `QUERY()` หรือ `IMPORTRANGE()` สูตรเหล่านั้นจะทำงานใน Google Sheet ต้นทางก่อน

## Current API Contract

Supabase version ต้องรองรับ endpoint หรือ payload shape เดิมเหล่านี้ก่อน:

```text
action=meta
action=health
action=summary
action=trips
action=compare
action=oil
action=routes
action=customers
```

Frontend ตอนนี้คาดหวัง payload หลัก:

```text
summary
- summary
- routeTrend
- routeRanking
- driverPerf
- customerProfit
- ownVsOutsource
- vehicleType
- lossTrip
- subcontractor
- revenueConcentration

trips
- trips[]
- total
- page
- limit
- hasMore
- start
- end
- route

trip row fields
- date
- customer
- route
- routeDesc
- routeKey
- routeCore
- routeVehicle
- routePrefix
- routeGroup
- isFlashRoute
- vtype
- driver
- plate
- payee
- recv
- pay
- oil
- margin
- reason
- anomalies
```

## Migration Principle

ห้ามเปลี่ยน source of truth ของ production เดิมทันที

แนวทางที่ปลอดภัยที่สุดคือทำแบบ shadow/mirror ก่อน:

```text
Google Sheet ต้นทาง
  -> Code.gs เดิมยังทำงานครบ
  -> SUMMARY_CACHE / TRIPS_CACHE เดิมยังใช้งานได้
  -> ส่ง normalized trips เข้า Supabase เพิ่ม
  -> เทียบ Apps Script payload กับ Supabase payload
  -> เมื่อผลตรงกันแล้วค่อยเปลี่ยน frontend ทีละ endpoint
```

## V3 Safety Amendment

หลังทบทวนเทียบกับ `Dashboard/API/Code.gs` แล้ว แผน V3 ต้องใช้แนวทาง staging-first และต้องไม่แก้/ไม่ deploy `Code.gs` ของ production เดิม:

- `Code.gs` production เดิมเป็น source/fallback แบบ read-only เท่านั้น
- phase แรกให้ sync service ของ V3 ดึง payload จาก Apps Script API เดิม (`action=trips`, `summary`, `oil`) แล้วเขียนเข้า Supabase staging
- ถ้าจำเป็นต้องใช้ Apps Script เป็น importer ต้องสร้าง Apps Script project/deployment แยกสำหรับ V3 เท่านั้น ห้าม deploy ทับ project เดิม
- Supabase phase แรกห้ามคำนวณ `route_key`, `pay = 0`, anomaly หรือ KPI เอง
- ทุก trip ที่ส่งไป Supabase ต้องมี `rowIdentityKey` และ `payloadHash`; `sourceMonth` ใช้เมื่อ source ให้มาเท่านั้น
- แยก `rowIdentityKey` ออกจาก `payloadHash`
- sync เข้าตาราง `trips_staging` ก่อนเสมอ
- promote เข้า `trips_active` ได้เฉพาะหลัง parity report ผ่าน
- frontend ห้ามอ่าน Supabase จริงจนกว่า `trips_active` และ `summary_snapshots.is_active` ผ่าน validation

ไฟล์ schema หลักของ V3:

```text
supabase/migrations/20260623000100_shadow_schema.sql
```

## Target Architecture

ช่วงเปลี่ยนผ่าน:

```text
Google Sheet ต้นทาง
  -> Apps Script Code.gs
      -> DATA(M1)-DATA(M12)
      -> MASTER
      -> SUMMARY_CACHE / TRIPS_CACHE
      -> Supabase sync tables
  -> Frontend ยังอ่าน Apps Script API เดิม
```

หลังผ่าน validation:

```text
Google Sheet ต้นทาง
  -> Apps Script importer/normalizer
  -> Supabase tables
  -> Netlify Function หรือ Supabase Edge Function
  -> Frontend อ่าน API ใหม่
  -> Apps Script API เดิมเป็น fallback
```

ระยะยาว:

```text
Google Sheet ต้นทาง
  -> Sync service
  -> Supabase normalized database
  -> API compatibility layer
  -> Frontend
```

## Supabase Schema Plan

Schema V3 ใช้ staging-first ไม่เขียน production read table โดยตรง:

```text
sync_runs
  -> source_month_imports
  -> trips_staging
  -> parity_reports
  -> promote_sync_run()
  -> trips_active
  -> summary_snapshots active
```

API ใหม่ต้องอ่านจาก `trips_active` และ `summary_snapshots` ที่ active เท่านั้น ไม่อ่านจาก `trips_staging` โดยตรง

### 1) sync_runs

เก็บประวัติการ sync แต่ละครั้ง เพื่อ audit และ rollback

```sql
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  source_months jsonb default '[]'::jsonb,
  rows_read integer default 0,
  rows_written integer default 0,
  rows_failed integer default 0,
  error_message text,
  app_version text,
  created_at timestamptz not null default now()
);
```

### 2) trips_staging / trips_active

ตารางหลักแทน `TRIPS_CACHE` ต้องแยก staging และ active

```sql
create table trips_staging (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references sync_runs(id),
  row_identity_key text not null,
  identity_base_key text not null,
  identity_ordinal integer not null default 1,
  payload_hash text not null,
  source_month text,

  date date not null,
  customer text not null,
  vtype text,
  route_desc text,
  route text not null,

  route_key text not null,
  route_core text,
  route_vehicle text,
  route_prefix text,
  route_group text,
  is_flash_route boolean default false,

  driver text,
  plate text,
  payee text,

  oil numeric(14,2) default 0,
  recv numeric(14,2) not null default 0,
  pay numeric(14,2) not null default 0,
  margin numeric(14,2) default 0,
  pct numeric(10,4),

  reason text,
  anomalies jsonb default '[]'::jsonb,

  raw_payload jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sync_run_id, row_identity_key)
);
```

`trips_active` ใช้ column หลักชุดเดียวกัน แต่มี unique `row_identity_key` และเป็น read model ที่ API ใหม่ใช้จริงหลัง promote เท่านั้น

Recommended indexes:

```sql
create index trips_active_date_idx on trips_active(date);
create index trips_active_customer_idx on trips_active(customer);
create index trips_active_route_key_idx on trips_active(route_key);
create index trips_active_vtype_idx on trips_active(vtype);
create index trips_active_date_route_key_idx on trips_active(date, route_key);
```

### 3) oil_prices

แทน `OIL_DIESEL_DATA`

```sql
create table oil_prices (
  date date primary key,
  diesel_b7 numeric(10,2) not null,
  source text default 'PTTOR',
  note text,
  updated_at timestamptz not null default now()
);
```

### 4) summary_snapshots

เก็บ payload summary ที่สร้างแล้ว เพื่อให้ frontend โหลดเร็ว และตรวจเทียบกับ Apps Script cache ได้

```sql
create table summary_snapshots (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references sync_runs(id),
  snapshot_date date not null default current_date,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
```

### 5) sync_audit_changes

แทนแนวคิด `SYNC_AUDIT_DETAIL`

```sql
create table sync_audit_changes (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references sync_runs(id),
  change_type text not null,
  row_identity_key text,
  before_data jsonb,
  after_data jsonb,
  changed_fields jsonb,
  created_at timestamptz not null default now()
);
```

### 6) source_month_imports

เก็บสถานะรายเดือน `DATA(M1)-DATA(M12)`

```sql
create table source_month_imports (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references sync_runs(id),
  source_month text not null,
  source_url text,
  source_sheet_name text,
  old_rows integer default 0,
  new_rows integer default 0,
  total_rows integer default 0,
  skipped boolean default false,
  error_message text,
  created_at timestamptz not null default now()
);
```

## Row Identity And Duplicate Protection

ต้องมีทั้ง `rowIdentityKey` และ `payloadHash`

### rowIdentityKey

ใช้กัน duplicate และใช้ upsert/promote identity ต้อง stable แม้ยอดเงินเปลี่ยน:

```text
date
customer
vtype
routeKey
route
routeDesc
driver
plate
payee
sourceMonth ถ้ามี
duplicate ordinal
```

`duplicate ordinal` ใช้กรณีมีแถวซ้ำ identity เดียวกันจริง ๆ โดยเรียงตาม order ที่ API เดิมส่งกลับมา

### payloadHash

ใช้ตรวจการเปลี่ยนแปลงของข้อมูลในแถวเดิม:

```text
date, customer, vtype, routeDesc, route, routeKey, routeCore,
routeVehicle, routePrefix, routeGroup, isFlashRoute, driver, plate,
payee, oil, recv, pay, margin, pct, sourceMonth ถ้ามี, anomalies
```

เหตุผล:

- ถ้า Apps Script รันซ้ำ ข้อมูลเดิมต้องไม่เพิ่มซ้ำ
- ถ้าต้นทางแก้ราคา/พขร./ทะเบียน ระบบต้องเห็นเป็น changed row ไม่ใช่ inserted row
- ใช้ทำ audit diff ได้

## Sync Strategy

### Option A: V3 Mirror Service Pulls From Existing Apps Script API

เหมาะกับช่วงแรกที่สุด เพราะไม่แตะ `Code.gs` production เดิม

```text
V3 scheduled sync service
  -> call Apps Script action=trips/action=summary/action=oil
  -> compute rowIdentityKey/payloadHash in V3 service
  -> upsert trips_staging / summary_snapshots / oil_prices
  -> run parity report against the same Apps Script payload
  -> promote only if parity passed
```

ข้อดี:

- ไม่ deploy `Code.gs` เดิม
- Logic เดิมยังอยู่ครบเพราะอ่าน payload จาก API เดิม
- ความเสี่ยงต่อ production ต่ำที่สุด
- Frontend เดิมไม่พัง
- เทียบข้อมูลได้ง่าย

ข้อเสีย:

- ยังขึ้นกับ Apps Script API response
- ถ้า Apps Script API timeout, sync ก็ timeout
- `sourceMonth` อาจไม่มีใน payload เดิม ต้องถือเป็น optional

### Option B: V3 Apps Script Project As Importer

ใช้ได้เฉพาะถ้าสร้าง Apps Script project/deployment ใหม่สำหรับ V3 เท่านั้น ห้าม deploy ทับ project เดิม

```text
V3 Apps Script Code.gs copy
  -> import/normalize เหมือนเดิม
  -> syncSupabaseTripsStaging_(tripsWithAnomalies)
  -> run parity report
```

ข้อดี:

- ได้ `sourceMonth` และ normalized pipeline ครบกว่า
- ใกล้ logic เดิมที่สุด

ข้อเสีย:

- ต้องดูแล Apps Script project ใหม่
- ถ้าเผลอ deploy เข้า project เดิมจะกระทบ production

### Option C: Rebuild Importer Outside Apps Script

```text
Server-side sync service
  -> Google Sheets API
  -> Normalize with ported Code.gs logic
  -> Supabase
```

ข้อดี:

- คุม performance ได้ดีที่สุด
- ไม่ติด Apps Script runtime limit

ข้อเสีย:

- ต้อง port logic ทั้งหมดจาก `Code.gs`
- เสี่ยง data mismatch ถ้าทำเร็วเกินไป

ข้อเสนอ: เริ่มด้วย Option A แล้วค่อยย้ายไป Option B/C เมื่อ Supabase payload ผ่าน validation แล้ว

## API Compatibility Layer

สร้าง API ใหม่ให้ตอบเหมือน `doGet()`

### GET /meta

คืนข้อมูลเทียบกับ `getApiInfo()`

### GET /health

คืนสถานะ sync ล่าสุด:

```json
{
  "trigger": { "dailyBatchJobCount": 1 },
  "sheets": {
    "masterRows": 0,
    "summaryCacheRows": 1,
    "tripsCacheRows": 1,
    "oilRows": 0
  },
  "supabase": {
    "tripsRows": 38246,
    "latestSyncStatus": "success"
  },
  "contract": {
    "passed": true,
    "errors": 0,
    "warnings": 0
  }
}
```

### GET /summary

คืน payload shape เดียวกับ `getSummaryCache()`

### GET /trips

รองรับ query เดิม:

```text
start
end
route
page
limit
fields
```

ต้อง match route แบบเดิม:

- `route`
- `route_key`
- `route_group`

### GET /compare

รองรับ:

```text
startA / a_start
endA / a_end
startB / b_start
endB / b_end
```

ช่วงแรกให้คืน summary-style เหมือน `getCompareData()` ก่อน เพราะ row pairing/anomaly comparison หลักอยู่ frontend

### GET /oil

คืน payload เหมือน `getOilPriceData()`

### GET /routes

คืน list route ตาม `route_key`, `route_group`, `route_core`, `route_vehicle`, `route_prefix`

### GET /customers

คืนลูกค้าพร้อมจำนวนเที่ยว

## Code Logic That Must Be Preserved

ส่วนเหล่านี้ต้องย้ายหรือ reuse อย่างระมัดระวัง:

```text
mapCustomer()
parseDate()
parseMoney()
parsePercent()
isCompanyTrip_()
parseTimedRouteParts_()
getRouteIdentity_()
getTripRouteKey_()
getTripRouteDisplay_()
ensureTripRouteIdentity_()
parseTripRow()
buildAnomalyGroupStats()
getAnomalies()
calculateSummary()
calculateRouteTrend()
calculateRouteRanking()
calculateDriverPerf()
calculateCustomerProfit()
calculateOwnVsOutsource()
calculateVehicleType()
calculateLossTrip()
calculateSubcontractor()
calculateRevenueConcentration()
```

ห้ามให้ Supabase หรือ API ใหม่คิด `route_key` คนละสูตรกับ `Code.gs` เพราะจะกระทบ logic เปรียบเทียบของ frontend โดยตรง

## Security Plan

### Do not expose service role key

ห้ามใส่ Supabase `service_role` key ใน frontend

เก็บ key เฉพาะใน:

- Apps Script Properties
- Netlify environment variables
- Supabase Edge Function secrets

### RLS

เปิด Row Level Security บนตารางหลักทั้งหมด

แนวทางเริ่มต้น:

- anonymous/frontend read ผ่าน API layer เท่านั้น
- write ทำผ่าน service role ฝั่ง server เท่านั้น
- ถ้าจะเปิด frontend read ตรงในอนาคต ต้องทำ policy แยกตามสิทธิ์ผู้ใช้

## Validation Plan

ต้องมี validation ก่อนเปลี่ยน frontend

### 1) Count parity

```text
Apps Script TRIPS_CACHE total == Supabase trips count
```

### 2) Financial parity

```text
sum(recv) ตรงกัน
sum(pay) ตรงกัน
sum(oil) ตรงกัน
sum(margin) ตรงกัน
```

### 3) Daily parity

เทียบตาม date:

```text
date
trip_count
recv_sum
pay_sum
oil_sum
margin_sum
```

### 4) Route parity

เทียบตาม route_key:

```text
route_key
trip_count
recv_sum
pay_sum
margin_sum
```

### 5) API contract parity

เรียก endpoint เดิมและใหม่แล้วตรวจ:

```text
summary keys ครบ
trips fields ครบ
compare shape ครบ
oil prices sorted
routes/customers ไม่ว่าง
```

### 6) Frontend smoke test

ทดสอบ:

- หน้าโหลดสำเร็จ
- summary cards ถูก
- filter date/customer/route/vtype ทำงาน
- มุมมองปกติทำงาน
- มุมมองเปรียบเทียบทำงาน
- 7D vs Previous ทำงาน
- export XLSX ทำงาน

## Rollback Plan

ต้อง rollback ได้ใน 1 นาที

เก็บ config แบบนี้:

```js
window.DASHBOARD_API_CONFIG = {
  baseUrl: 'Apps Script URL',
  supabaseApiUrl: 'New API URL',
  apiMode: 'apps-script' // apps-script | supabase | supabase-with-fallback
}
```

ลำดับ rollout:

1. `apps-script`
2. `supabase-with-fallback`
3. `supabase`

ถ้า error:

- เปลี่ยนกลับ `apiMode: 'apps-script'`
- redeploy frontend
- production กลับไปใช้ระบบเดิมทันที

## Repo Separation Plan

เพื่อไม่กระทบ repo production เดิม:

- repo เดิม: `awiruttangwong/2klogistics-dashboard`
- repo ใหม่สำหรับ migration: `awiruttangwong/2klogistics-dashboard-v2.0`

แนวทาง:

```text
ไม่เปลี่ยน origin เดิม
เพิ่ม remote ใหม่ชื่อ v2
push main ไป v2
พัฒนางาน Supabase ใน repo v2
production เดิมยังอยู่ repo เดิม
```

คำสั่งที่ควรใช้:

```powershell
git remote add v2 https://github.com/awiruttangwong/2klogistics-dashboard-v2.0.git
git push -u v2 main
```

ถ้า repo ใหม่มี README commit อยู่แล้วและ push ถูก reject ให้ตรวจสอบก่อนใช้:

```powershell
git ls-remote v2
```

จากนั้นค่อยตัดสินใจว่าจะ merge history หรือ force push ไป repo ใหม่ ห้าม force push โดยไม่ตั้งใจ

## Implementation Phases

### Phase 0: Documentation And Repo Split

- เพิ่มเอกสาร migration plan
- push code ปัจจุบันไป repo `2klogistics-dashboard-v2.0`
- ไม่เปลี่ยน production เดิม

### Phase 1: Supabase Project Setup

- สร้าง Supabase project
- รัน `supabase/migrations/20260623000100_shadow_schema.sql`
- เปิด RLS
- ตั้ง indexes
- ตั้ง service keys ใน server-side environment

### Phase 2: Shadow Sync

- เพิ่ม V3 sync service ที่ดึง `action=trips`, `action=summary`, `action=oil` จาก Apps Script API เดิม
  - implementation: `supabase/sync/sync-apps-script-to-supabase.mjs`
  - dry-run command: `npm run supabase:sync -- --dry-run`
  - staging command: `npm run supabase:sync`
  - promote command หลังตรวจ report แล้วเท่านั้น: `npm run supabase:sync -- --promote`
- สร้าง `rowIdentityKey` และ `payloadHash` ใน V3 sync service
- ส่ง payload เข้า `trips_staging`
- ใช้ batch upsert โดย conflict ที่ `(sync_run_id, row_identity_key)`
- เขียน `sync_runs`
- เขียน `summary_snapshots`, `oil_prices`, `parity_reports`
- ตั้งค่า secrets เฉพาะฝั่ง server-side ของ V3 sync service:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side service role key>
APPS_SCRIPT_API_URL=<existing Apps Script Web App URL>
SUPABASE_SYNC_BATCH_SIZE=500
APPS_SCRIPT_PAGE_LIMIT=5000
SYNC_REQUEST_TIMEOUT_MS=60000
```

- ยังไม่เปลี่ยน frontend
- default mode ไม่ promote เข้า `trips_active`; ต้องใส่ `--promote` เองและ parity ต้องผ่าน

### Phase 3: Parity Reports

- เพิ่ม report เทียบ Apps Script cache กับ Supabase
- ตรวจ row count, financial totals, daily totals, route totals
- ถ้าไม่ตรง ให้ diff ตาม `rowIdentityKey` และ `payloadHash`
- ถ้าตรง ให้บันทึก `parity_reports.ok = true`
- promote ด้วย `promote_sync_run(sync_run_id)` เท่านั้น
- dry-run ล่าสุดแบบ read-only จาก Apps Script ผ่าน: `tripsRead=42611`, `stagingRows=42611`, `contractErrorCount=0`

### Phase 4: API Compatibility Layer

- ทำ API ใหม่บน Netlify Function หรือ Supabase Edge Function
- endpoint ใหม่ต้องอ่านจาก `trips_active` และ active `summary_snapshots` เท่านั้น
- endpoint ใหม่ต้องคืน payload เดิม
- เพิ่ม contract test

### Phase 5: Frontend Dual Source

- เพิ่ม config `apiMode`
- เปิด `supabase-with-fallback`
- smoke test ทุกมุมมอง
- export XLSX ต้องยังทำงานเหมือนเดิม

### Phase 6: Production Cutover

- เปลี่ยน frontend เป็น Supabase API
- Apps Script ยัง sync ข้อมูลจาก Google Sheet
- Apps Script API เดิมยังเป็น fallback

### Phase 7: Optimize

- ย้าย KPI บางส่วนเป็น SQL view/materialized view
- เพิ่ม pagination ที่ database จริง
- เพิ่ม scheduled sync ภายนอก Apps Script ถ้าจำเป็น

## Success Criteria

ถือว่าย้ายสำเร็จเมื่อ:

- Supabase trips count ตรงกับ Apps Script `TRIPS_CACHE`
- ยอดรวม `recv/pay/oil/margin` ตรงกัน
- summary payload shape ตรง contract เดิม
- frontend ทุกหน้าใช้งานได้
- export XLSX ใช้งานได้
- มี rollback path กลับ Apps Script
- ไม่มีการ deploy `Code.gs` ไปทับ Apps Script production เดิม
- production เดิมไม่ถูกกระทบระหว่างพัฒนา

## Immediate Next Actions

1. ผู้ใช้สร้าง/เชื่อม Supabase project สำหรับ V3 เท่านั้น
2. รัน `supabase/migrations/20260623000100_shadow_schema.sql` ใน Supabase SQL Editor หรือ migration runner
3. สร้าง `.env` จาก `.env.example` และใส่ค่า server-side: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPS_SCRIPT_API_URL`
4. เชื่อม local repo กับ Supabase project: `npm run supabase:link`
5. ตรวจ migration แบบ dry-run: `npm run supabase:db:push:dry-run`
6. ถ้า dry-run ผ่าน ให้ push schema: `npm run supabase:db:push`
7. ทดสอบ read-only ก่อน: `npm run supabase:sync -- --dry-run`
8. ถ้า dry-run ผ่าน ให้ sync เข้า staging: `npm run supabase:sync`
9. ตรวจ `sync_runs` และ `parity_reports`; ถ้า `ok=true` เท่านั้นจึงค่อยรัน `npm run supabase:sync -- --promote`
10. ยังไม่เปลี่ยน frontend และยังไม่ deploy `Dashboard/API/Code.gs` จนกว่า shadow sync + parity + promote ผ่าน

## Frontend Supabase Fallback Mode

หลัง schema และ promoted sync ผ่านแล้ว frontend สามารถเปิดอ่าน Supabase API ผ่าน Netlify Function โดยไม่เปิดเผย service role key:

```text
Dashboard/scripts/api-config.js
  apiMode: 'supabase-with-fallback'
  supabaseApiUrl: '/.netlify/functions/supabase-api'
  baseUrl: '<existing Apps Script Web App URL>'
```

โหมดนี้เรียก Supabase ก่อน ถ้า function, network, หรือ Supabase error จะ fallback กลับ Apps Script เดิมโดยอัตโนมัติ

ต้องตั้งค่า environment variables ใน Netlify:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

และตั้งค่า GitHub Actions secrets สำหรับ scheduled sync:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APPS_SCRIPT_API_URL
```
