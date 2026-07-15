# Sync Incident Troubleshooting & Monthly Rollover Runbook

Last updated: 2026-07-15

เอกสารนี้สรุปขั้นตอนปฏิบัติ 2 เรื่อง:

1. เมื่อ production แสดงข้อมูลเก่า/ระบบสลับไปใช้ Apps Script fallback ชั่วคราว
2. เมื่อต้องเพิ่มเดือนใหม่ (`DATA(Mx)`) เข้า config เช่น `DATA(M8)` สำหรับเดือนสิงหาคม

อ้างอิงพื้นฐานสถาปัตยกรรมจาก `PRODUCTION_SYSTEM_VERIFICATION_2026-06-25.md` (root) และ
schedule/webhook จริงใน `.github/workflows/production-sync-watchdog.yml` และ
`dashboard/API/Code.gs` (`requestSupabaseSyncAfterBatch_`)

---

## ส่วนที่ 1: Supabase ข้อมูลเก่า / หน้าเว็บใช้ Apps Script fallback

### บริบทที่ต้องเข้าใจก่อน

Production มีเส้นทาง sync สองทาง:

- **ทางหลัก (event-driven)**: หลัง `dailyBatchJob` ใน Apps Script รันเสร็จและ contract ผ่าน
  Apps Script จะยิง webhook ไปที่ `netlify/functions/supabase-sync-background.mjs` ทันที
  เพื่อทำ staging → parity → promote เข้า Supabase โดยไม่ต้องรอ GitHub Actions
- **ทางสำรอง (GitHub Actions watchdog)**: `.github/workflows/production-sync-watchdog.yml`
  รันตาม cron `47 1 * * *` และ `17 3 * * *` (08:47 และ 10:17 เวลาไทย) แต่ GitHub อาจเริ่มช้ากว่ากำหนดจริง
  ได้หลายชั่วโมง จึงเป็นแค่ safety net ไม่ใช่เส้นทางหลัก

ดังนั้น **การเห็นหน้าเว็บ fallback ไป Apps Script ช่วงเช้าเป็นพฤติกรรมที่คาดไว้แล้ว** ไม่ใช่สัญญาณว่ามีบั๊กเสมอไป
มักหายเองภายในไม่กี่นาทีหลัง `dailyBatchJob` เสร็จ

### ขั้นตอนวินิจฉัย (ทำตามลำดับ)

**ขั้นที่ 1 — เช็ค Apps Script เอง**

```bash
node scripts/check-apps-script-health.mjs
```

- `"ok": true` และ `"contract": {"passed": true}` → Apps Script ปกติ ข้ามไปขั้นที่ 2
- `"ok": false` → นี่คือปัญหาจริง อ่าน `failures` ที่รายงานมา (เช่น spreadsheet ไม่ตรง, trips เป็น 0,
  เดือนปัจจุบันยังไม่ถูก config ใน `configuredMonths`) แล้วแก้ที่ต้นเหตุนั้นก่อน อย่าข้ามไปแตะ Supabase/frontend

**ขั้นที่ 2 — เช็คว่า Supabase รู้ตัวว่าเก่าหรือยัง**

```bash
curl "https://2klogistics-dashboard.netlify.app/.netlify/functions/supabase-api?action=health"
```

ดู `latestSyncRun.promoted_at`, `sync.ageHours`, `checks.syncFresh`
ถ้า `syncFresh: true` และ `activePromotedRun: true` แปลว่าไม่มีอะไรต้องทำ

**ขั้นที่ 3 — ให้ระบบซ่อมเอง หรือสั่ง sync ด้วยมือ**

```bash
node scripts/watchdog-production-sync.mjs --check-only
```

ถ้า `"shouldSync": true` และ `"blocked": false` ให้รันจริง (ตัด `--check-only` ออก):

```bash
node scripts/watchdog-production-sync.mjs
```

คำสั่งนี้จะดึงจาก Apps Script มาซิงค์เข้า Supabase ผ่าน staging → parity → promote ให้อัตโนมัติ
ต้องมี `.env` ที่มี `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPS_SCRIPT_API_URL` ครบ

### เมื่อไหร่ควรยกระดับเป็นปัญหาจริง (ต้องมีคนตรวจเพิ่ม)

- ขั้นที่ 1 ล้มเหลว (Apps Script contract ไม่ผ่าน)
- รันขั้นที่ 3 แล้วยัง sync ไม่ผ่าน หรือฟ้อง error ซ้ำหลายรอบ
- Fallback ค้างนานเกิน 1–2 ชั่วโมงหลัง 08:00 น. โดยไม่กลับมาเอง

ถ้าไม่เข้าเงื่อนไขเหล่านี้ ให้รอสักครู่แล้วเช็คซ้ำ ไม่ต้องแก้โค้ดหรือ deploy ใดๆ

---

## ส่วนที่ 2: การเพิ่มเดือนใหม่ (เช่น `DATA(M8)` สำหรับสิงหาคม)

การเปลี่ยนแปลงนี้เป็น config-only change สำหรับ rollover ปกติ **ไม่ควรแก้ `Code.gs`, frontend,
Supabase schema, Netlify functions, trigger timing หรือ URL ของเดือนก่อนหน้า** เว้นแต่ source
เดือนใหม่มี schema ต่างจากเดิมจริง (ชื่อ tab เปลี่ยน, คอลัมน์เปลี่ยน, รูปแบบวันที่เปลี่ยน) — ถ้าเป็นแบบนั้น
ต้องยกระดับเป็นงานใหญ่กว่านี้ ไม่ใช่ rollover ปกติ

### ข้อมูลที่ต้องมีก่อนเริ่ม

```text
เดือนเป้าหมาย: DATA(M_)
Source spreadsheet URL:
Source spreadsheet id:
ชื่อ tab ต้นทาง (ปกติคือ SUMDATA):
วันที่แรกที่คาดว่าจะมีข้อมูล:
บัญชี Google ที่เป็นเจ้าของ:
```

ห้ามเดา URL/spreadsheet id/ชื่อ tab เอง ต้องได้รับยืนยันจากเจ้าของข้อมูลจริง

### ขั้นตอน

**Phase 0 — เช็ค workspace ก่อนแก้**

```bash
git remote get-url origin
git branch --show-current
git status --short
```

ต้องเป็น origin `awiruttangwong/2klogistics-dashboard-v2.0`, branch `main` (หรือ release branch ที่ตั้งใจ)
ถ้ามีไฟล์อื่นค้างอยู่ (dirty) ห้ามลบ/revert เอง แค่บันทึกไว้แล้ว stage เฉพาะไฟล์ที่เกี่ยวกับ config เดือนใหม่

**Phase 1 — ตรวจ source sheet ก่อนแตะ production**

ก่อนแก้ config ต้องพิสูจน์ก่อนว่า:

- มี tab ชื่อตรงกับที่ตั้งไว้ใน `SOURCE_SHEET_NAMES` (ปกติคือ `SUMDATA`)
- บัญชีของระบบ dashboard เปิด sheet นี้ได้
- หัวคอลัมน์/ตำแหน่งคอลัมน์ตรงกับเดือนก่อนหน้า
- วันที่แรกที่คาดไว้มีข้อมูลจริงและ parse เป็นวันที่ถูกต้อง
- ไม่มี `#REF!` หรือ error ใน column ที่จำเป็น

ถ้าข้อใดไม่ผ่าน ให้หยุด ห้าม deploy source ที่ว่างหรือโครงสร้างต่างไปทั้งที่ยังไม่ผ่านการตรวจ

**Phase 2 — แก้ config บรรทัดเดียว**

แก้เฉพาะบรรทัดนี้ใน `dashboard/API/config.gs`:

```js
'DATA(M8)': 'https://docs.google.com/spreadsheets/d/<spreadsheet-id>/edit?gid=...#gid=...',
```

`SOURCE_SHEET_NAMES['DATA(M8)']` ปกติตั้งเป็น `'SUMDATA'` ไว้แล้วล่วงหน้า ไม่ต้องแก้ เว้นแต่ Phase 1
พิสูจน์แล้วว่า tab ชื่อไม่ตรง

ตรวจ diff ก่อน commit ว่ามีแค่บรรทัดเดียวที่ตั้งใจแก้:

```bash
git --no-pager diff -- dashboard/API/config.gs dashboard/API/Code.gs
```

**Phase 3 — sync repo กับ Apps Script source**

1. commit + push เฉพาะไฟล์ที่ตั้งใจแก้
2. เปิด Apps Script editor แก้บรรทัดเดียวกันให้ตรงกับ repo แล้ว save
3. ยืนยันว่า repo, Apps Script source ที่ save ไว้ และ URL/tab ปลายทางตรงกันทั้งหมด

**Phase 4 — อัปเดต deployment เดิม (ห้ามสร้างใหม่)**

Apps Script มีโค้ด 2 สถานะ: installable trigger ใช้โค้ดล่าสุดที่ save เสมอ แต่ `/exec` (Web App)
ใช้ version ที่เลือกไว้ตอน deploy เท่านั้น ต้องอัปเดต deployment เดิมที่ `APPS_SCRIPT_API_URL` ชี้อยู่:

```text
Deploy > Manage deployments > Edit > New version > Deploy
```

ห้ามสร้าง Web App URL ใหม่ ต้อง `/exec` URL เดิมเสมอ จากนั้นตรวจ:

```bash
npm run apps-script:health -- --month 8
```

ผ่านเมื่อ: `ok: true`, `requiredCurrentMonth` ตรงกับเดือนเป้าหมาย, `configuredMonths` มีเดือนนั้นอยู่,
spreadsheet/project id ตรงกับ production, trigger `dailyBatchJob` มี 1 ตัวที่ 08:00 และ
`dailyBatchRecoveryJob` มี 1 ตัวที่ประมาณ 08:30 เวลาไทย

**Phase 5 — ปล่อยให้ batch รันและตรวจผล**

ปล่อยให้ trigger 08:00 รันเอง หรือรันครั้งเดียวหลัง Phase 1 ผ่านแล้ว ห้ามรันซ้ำซ้อนกันหลายรอบ
ตรวจว่า: `ok: true`, `contractPassed: true`, ไม่มี sync error, เดือนปัจจุบันมี import rows,
Supabase callback ตอบรับ (HTTP 202)

**Phase 6 — ตรวจ parity ให้ครบทุกชั้นในวันแรกที่มีข้อมูลจริง**

เทียบจำนวนแถวของวันแรกที่มีข้อมูล: source sheet → `DATA(Mx)` ปลายทาง → `MASTER` →
`SUMMARY_CACHE`/`TRIPS_CACHE` → Apps Script `trips` API → Supabase `trips` API → หน้า production
รันเช็คมาตรฐาน:

```bash
npm run test:daily-sync-readiness
npm run test:pre-nine-recovery
npm run test:supabase-cli-guard
npm run apps-script:health -- --month 8
npm run production:health
```

### กฎเมื่อมีอะไรผิดพลาดระหว่างทำ

- Phase 1 (source gate) ไม่ผ่าน → ห้ามแตะ production เลย
- แก้ config ผิด URL/tab แต่ยังไม่ deploy → แก้กลับให้ถูกก่อน deploy
- deploy config ผิดไปแล้วแต่ batch ยังไม่รัน → เลือก version ก่อนหน้ากลับ หรือ deploy config ที่ถูกต้อง
  ทันทีด้วย deployment id เดิม
- batch fail ก่อน cache rebuild → ห้าม promote Supabase เก็บ fallback หน้าเว็บที่ยังใช้ข้อมูลล่าสุดที่ถูกต้องไว้ก่อน
- Apps Script กับ Supabase นับจำนวนไม่ตรงกัน → ถือว่า Supabase เก่ากว่า ให้ Apps Script เป็นความจริงหลัก
  รัน recovery หนึ่งรอบแล้วสืบสาเหตุก่อนปิดงาน
- ห้ามลบข้อมูลเดือนก่อนหน้า, reset Supabase, เปลี่ยน trigger schedule หรือแก้ frontend logic
  เพื่อ "แก้ปัญหา" การเพิ่มเดือนใหม่

### กำหนดเวลาแนะนำ

- ก่อนเดือนใหม่เริ่ม 3 วันทำการ: ขอ URL/สิทธิ์เข้าถึง sheet เดือนใหม่ และทำ Phase 1 ให้เสร็จ
- ก่อนเดือนใหม่เริ่ม 1 วันทำการ: ทำ Phase 0–4 ให้เสร็จ (แก้ config, sync repo/Apps Script, deploy)
- วันแรกที่มีข้อมูลจริงของเดือนใหม่: ทำ Phase 5–6 ให้เสร็จ

---

## หมายเหตุ

รายละเอียดเชิงลึกกว่านี้ (release classification, closeout record format แบบเต็ม, ประวัติการปิดงานที่ผ่านมา)
อยู่ใน `Dashboard/docs/runbooks/PRODUCTION_CLOSEOUT_AND_OPERATIONS_RUNBOOK.md` เอกสารทั้งสองไฟล์นี้
เก็บไว้ในโฟลเดอร์เดียวกัน (`Dashboard/docs/runbooks/`) เพื่อให้หาง่ายและอ้างอิงถึงกันได้ตรงจุด
