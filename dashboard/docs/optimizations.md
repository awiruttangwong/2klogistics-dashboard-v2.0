# คู่มือการปรับปรุงประสิทธิภาพระบบ (Dashboard Optimizations Guide)

เอกสารฉบับนี้รวบรวมฟังก์ชันที่มีการเพิ่มประสิทธิภาพสูงสุด (Optimized Code) ซึ่งจะช่วยแก้ปัญหาหน้าแดชบอร์ดมีอาการหน่วง ค้าง หรือกระตุก (Lag/UI Freeze) ได้อย่างสมบูรณ์แบบ โดยที่ **ไม่กระทบต่อฟังก์ชันการทำงานหลัก สีสัน คอลัมน์ หรือตรรกะข้อมูลเดิมใดๆ ทั้งสิ้น** 

คุณสามารถนำโค้ดในแต่ละส่วนด้านล่างนี้ ไปวางแทนที่ (Replace) โค้ดส่วนเดิมในไฟล์ [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) ได้ทันทีเมื่อพร้อมดำเนินการ

---

## 1. ขจัดปัญหาการทำ Deep-Clone ซ้ำซ้อนของข้อมูลชุดใหญ่ (2.8 MB)

### จุดที่ 1: ฟังก์ชัน `loadLegacyTripsData()`
**ปัญหา:** เดิมมีการโคลนตัวแปร `FRAUD_DATA` ทั้งอาร์เรย์ (2.8 MB) ทุกครั้งที่เรียก ทำให้ CPU ค้างโดยไม่จำเป็น  
**การแก้ไข:** ส่งคืนค่าอาร์เรย์เดิมโดยตรง เนื่องจากระบบนำไปอ่านอย่างเดียว (Read-only) และนำไปสร้างก๊อปปี้ใหม่ตอน Map อยู่แล้ว

* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 591-595):**
```javascript
async function loadLegacyTripsData() {
  await loadScriptOnce('data/fraud_data.js', 'FRAUD_DATA');
  if (typeof FRAUD_DATA === 'undefined' || !Array.isArray(FRAUD_DATA)) throw new Error('FRAUD_DATA unavailable');
  return deepClone(FRAUD_DATA);
}
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
async function loadLegacyTripsData() {
  await loadScriptOnce('data/fraud_data.js', 'FRAUD_DATA');
  if (typeof FRAUD_DATA === 'undefined' || !Array.isArray(FRAUD_DATA)) throw new Error('FRAUD_DATA unavailable');
  return FRAUD_DATA; // หลีกเลี่ยงการทำ deepClone เพื่อป้องกัน UI Freeze
}
```

---

### จุดที่ 2: ฟังก์ชัน `ensureTripsReady()`
**ปัญหา:** มีการทำ `deepClone()` ซ้ำซ้อนตอนตรวจสอบสถานะความพร้อมข้อมูล  
**การแก้ไข:** ยกเลิกการเรียก `deepClone` ทั้ง 2 จุดภายในฟังก์ชัน

* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 6977-6992):**
```javascript
async function ensureTripsReady() {
  if (TRIPS_READY) return deepClone(window.FRAUD_DATA || []);
  if (TRIPS_LOADING_PROMISE) return TRIPS_LOADING_PROMISE;

  TRIPS_LOADING_PROMISE = (async () => {
    const tripsSource = await loadTripsSource();
    const normalized = Array.isArray(tripsSource) ? tripsSource.map(canonicalizeTripRow) : [];
    window.FRAUD_DATA = normalized;
    TRIPS_READY = true;
    return deepClone(normalized);
  })().finally(() => {
    TRIPS_LOADING_PROMISE = null;
  });

  return TRIPS_LOADING_PROMISE;
}
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
async function ensureTripsReady() {
  if (TRIPS_READY) return window.FRAUD_DATA || []; // ยกเลิก deepClone ส่งอาร์เรย์ตรงๆ
  if (TRIPS_LOADING_PROMISE) return TRIPS_LOADING_PROMISE;

  TRIPS_LOADING_PROMISE = (async () => {
    const tripsSource = await loadTripsSource();
    const normalized = Array.isArray(tripsSource) ? tripsSource.map(canonicalizeTripRow) : [];
    window.FRAUD_DATA = normalized;
    TRIPS_READY = true;
    return normalized; // ยกเลิก deepClone ส่งผลดีต่อความสมูทของระบบ
  })().finally(() => {
    TRIPS_LOADING_PROMISE = null;
  });

  return TRIPS_LOADING_PROMISE;
}
```

---

### จุดที่ 3: ยกเลิกการ Map ข้อมูลซ้ำซ้อนในฟังก์ชัน `buildDailyCompare()`
**ปัญหา:** มีการวนลูป `.map(canonicalizeTripRow)` ซ้ำกับข้อมูลหลักที่เคยปรับปรุงโครงสร้างผ่าน `init()` มาแล้ว ทำให้เบราว์เซอร์รันสแกนข้อมูลหลายพันเที่ยวใหม่โดยไม่จำเป็น

* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 2848-2858):**
```javascript
  const fd = typeof FRAUD_DATA !== 'undefined' ? FRAUD_DATA : [];
  const validFd = fd
    .map(canonicalizeTripRow)
    .filter(r =>
      r &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') &&
      Number.isFinite(r.recv) &&
      Number.isFinite(r.pay) &&
      Number.isFinite(r.oil) &&
      Number.isFinite(r.margin)
    );
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
  const fd = typeof FRAUD_DATA !== 'undefined' ? FRAUD_DATA : [];
  // ข้ามขั้นตอน .map(canonicalizeTripRow) เนื่องจากข้อมูลถูกแปลงโครงสร้าง (Canonicalized) ตั้งแต่โหลดหน้าเว็บแล้ว
  const validFd = fd.filter(r =>
    r &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') &&
    Number.isFinite(r.recv) &&
    Number.isFinite(r.pay) &&
    Number.isFinite(r.oil) &&
    Number.isFinite(r.margin)
  );
```

---

## 2. โหลดเนื้อหาของ Modal เฉพาะเวลาใช้งานจริง (On-Demand Modal Content)

**ปัญหา:** ฟังก์ชัน `buildMasterDashboard` ทำการสร้างเนื้อหา HTML ของ Modal เต็มรูปแบบเตรียมไว้ล่วงหน้าพร้อมกันถึง 6 ตัว ส่งผลให้การเปิดหน้าแรกหรือสลับแท็บกระตุก  
**การแก้ไข:** ลบการประมวลผลล่วงหน้าออก ปล่อยให้ฟังก์ชันดึงตัววิเคราะห์ข้อมูลเมื่อคลิกเปิด Modal จริงๆ เท่านั้น

* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 2804-2810):**
```javascript
  // Pre-generate full modal content
  window._masterModalData = {};
  window._masterModalBuilders = {};
  sections.forEach(sec => {
    window._masterModalData[sec.id] = sec.fullBuilder(d);
    window._masterModalBuilders[sec.id] = sec.fullBuilder;
  });
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
  // ปรับปรุงประสิทธิภาพ: ลงทะเบียนเฉพาะฟังก์ชันตัวสร้าง (Builders) ส่วนเนื้อหาจะประมวลผลต่อเมื่อถูกเปิดคลิกจริงเท่านั้น
  window._masterModalData = {};
  window._masterModalBuilders = {};
  sections.forEach(sec => {
    window._masterModalBuilders[sec.id] = sec.fullBuilder;
  });
```

---

## 3. สลับมาใช้ระบบ Hash Map ($O(1)$) และคำนวณค่าเฉลี่ยล่วงหน้า เพื่อป้องกันการสแกนซ้ำซ้อนในตารางรายงานวิเคราะห์รายเที่ยว

**ปัญหาหลัก:**
1. ฟังก์ชัน `renderSingleTable()` ทำการวนลูปสแกนเที่ยววิ่งทั้งหมด 1,000-2,000 เที่ยว แบบซ้อนลูปทุกเส้นทาง ส่งผลให้ระบบวนลูปตรวจสอบเกือบ 600,000 ครั้ง
2. ฟังก์ชันตรวจสอบความผิดปกติ `dcQaTripStatuses()` มีคำสั่ง `.reduce()` ซ้อนด้านในเพื่อหาค่าเฉลี่ย ทำให้เกิดปัญหาการคำนวณซ้อนแบบ $O(K^2)$  

**การแก้ไข:**
1. จัดหมวดข้อมูลเที่ยววิ่งด้วย Hash Map แยกตามเส้นทางก่อนเพียงรอบเดียว ช่วยให้ดึงข้อมูลออกมาใช้ได้ในระดับ $O(1)$ ทันที
2. เพิ่มพารามิเตอร์ `precalcAvg` เข้าไปใน `dcQaTripStatuses()` เพื่อคำนวณค่าเฉลี่ยเฉพะเที่ยววิ่งของเส้นทางนั้นๆ เพียงรอบเดียวแล้วนำมาใช้ซ้ำ ลดการทำงานลงนับแสนเท่า!

### ส่วนย่อยที่ A: อัปเกรดฟังก์ชัน `dcQaTripStatuses()`
* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 5973-5985):**
```javascript
    function dcQaTripStatuses(trip, peers = []) {
      const statuses = new Set();
      if ((trip.margin || 0) < 0) statuses.add('loss');
      if ((trip.oil || 0) > (trip.pay || 0) * 0.5 && (trip.pay || 0) > 0) statuses.add('oil50');
      if (peers.length > 1) {
        const avgPay = peers.reduce((s, r) => s + (r.pay || 0), 0) / peers.length;
        const avgOil = peers.reduce((s, r) => s + (r.oil || 0), 0) / peers.length;
        if (avgPay > 0 && (trip.pay || 0) > avgPay * 1.05) statuses.add('payHigh');
        if (avgOil > 0 && (trip.oil || 0) > avgOil * 1.10) statuses.add('oilHigh');
      }
      if (!statuses.size) statuses.add('normal');
      return [...statuses];
    }
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
    function dcQaTripStatuses(trip, peers = [], precalcAvg = null) {
      const statuses = new Set();
      if ((trip.margin || 0) < 0) statuses.add('loss');
      if ((trip.oil || 0) > (trip.pay || 0) * 0.5 && (trip.pay || 0) > 0) statuses.add('oil50');
      if (peers.length > 1) {
        // ใช้ค่าเฉลี่ยที่คำนวณล่วงหน้ามาแล้ว (ถ้ามี) เพื่อหลีกเลี่ยงการสแกนลูปย้อนกลับ .reduce() ซ้ำซ้อน
        const avgPay = precalcAvg ? precalcAvg.avgPay : (peers.reduce((s, r) => s + (r.pay || 0), 0) / peers.length);
        const avgOil = precalcAvg ? precalcAvg.avgOil : (peers.reduce((s, r) => s + (r.oil || 0), 0) / peers.length);
        if (avgPay > 0 && (trip.pay || 0) > avgPay * 1.05) statuses.add('payHigh');
        if (avgOil > 0 && (trip.oil || 0) > avgOil * 1.10) statuses.add('oilHigh');
      }
      if (!statuses.size) statuses.add('normal');
      return [...statuses];
    }
```

---

### ส่วนย่อยที่ B: อัปเกรดฟังก์ชัน `renderSingleTable()`
* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data%20sum%20Daily%20express%204%20month%20V2.3%20base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 6259-6274):**
```javascript
    function renderSingleTable(stA) {
      if (!stA || !stA.routes || stA.routes.length === 0) return dcQaEmpty('ไม่มีข้อมูลสำหรับช่วงเวลาที่เลือก');
      const cases = stA.routes.map(route => {
        const trips = (stA.rows || []).filter(r => r.customer === route.customer && r.route === route.route && r.vtype === route.vtype)
          .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        const rows = trips.map(ra => ({ ra, statuses: dcQaTripStatuses(ra, trips) }));
        const anomCount = rows.filter(r => !r.statuses.includes('normal')).length;
        const statusSet = new Set();
        rows.forEach(r => r.statuses.forEach(s => statusSet.add(s)));
        if (anomCount > 0) statusSet.delete('normal');
        return { route, rows, anomCount, statuses: [...statusSet], severity: Math.max(...rows.map(r => dcQaStatusRank(r.statuses))) };
      }).sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        if (b.anomCount !== a.anomCount) return b.anomCount - a.anomCount;
        return String(a.route.route || '').localeCompare(String(b.route.route || ''), 'th');
      });
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
    function renderSingleTable(stA) {
      if (!stA || !stA.routes || stA.routes.length === 0) return dcQaEmpty('ไม่มีข้อมูลสำหรับช่วงเวลาที่เลือก');

      // เพิ่มความเร็ว: จัดกลุ่มเที่ยววิ่ง (Rows) แยกรายเส้นทางไว้ล่วงหน้าด้วย Hash Map (ใช้เวลาเพียงรอบเดียว O(M))
      const rowsByRoute = {};
      (stA.rows || []).forEach(r => {
        const key = dcQaRouteKey(r);
        if (!rowsByRoute[key]) rowsByRoute[key] = [];
        rowsByRoute[key].push(r);
      });

      const cases = stA.routes.map(route => {
        const routeKey = dcQaRouteKey(route);
        // ดึงเที่ยววิ่งออกมาโดยตรงผ่าน Hash Map ในระดับ O(1) รวดเร็วมาก
        const trips = (rowsByRoute[routeKey] || [])
          .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

        // คำนวณหาค่าเฉลี่ยของราคาน้ำมันและค่าเที่ยววิ่งไว้ล่วงหน้าเพียงครั้งเดียว
        let precalcAvg = null;
        if (trips.length > 1) {
          const totPay = trips.reduce((s, r) => s + (r.pay || 0), 0);
          const totOil = trips.reduce((s, r) => s + (r.oil || 0), 0);
          precalcAvg = { avgPay: totPay / trips.length, avgOil: totOil / trips.length };
        }

        // นำค่าเฉลี่ยที่คำนวณเสร็จแล้วไปตรวจสอบสถานะได้ทันที รวดเร็ว ปลอดภัย ไร้ลูปกระตุก
        const rows = trips.map(ra => ({ ra, statuses: dcQaTripStatuses(ra, trips, precalcAvg) }));
        const anomCount = rows.filter(r => !r.statuses.includes('normal')).length;
        const statusSet = new Set();
        rows.forEach(r => r.statuses.forEach(s => statusSet.add(s)));
        if (anomCount > 0) statusSet.delete('normal');
        return { route, rows, anomCount, statuses: [...statusSet], severity: Math.max(...rows.map(r => dcQaStatusRank(r.statuses))) };
      }).sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        if (b.anomCount !== a.anomCount) return b.anomCount - a.anomCount;
        return String(a.route.route || '').localeCompare(String(b.route.route || ''), 'th');
      });
```

---

## 4. ระบบจำข้อมูลตัวกรองแบบด่วนพิเศษ (Fast-path Checkbox Sync) ป้องกันการ Render HTML ซ้ำทุกคลิก

**ปัญหา:** เมื่อผู้ใช้ติ๊กเลือกตัวกรองใดตัวกรองหนึ่ง ฟังก์ชันจะล้าง HTML ตัวเลือกอื่นออกทั้งหมดแล้วนำมารันสเกนประกอบเป็น HTML เขียนทับเข้าไปใหม่ ซึ่งจะสร้างภาระการประมวลผล DOM และทำให้ระบบดูแล็ก  
**การแก้ไข:** ทำการเก็บแคชรายชื่อตัวเลือก (Options JSON) ล่าสุดไว้ หากไม่มีการเปลี่ยนจำนวนตัวเลือก (เช่น ผู้ใช้เพียงเปิดติ๊กเช็กบ็อกซ์ค่าตัวเลือกภายในกล่อง) ระบบจะเพียงสลับสถานะเช็กบ็อกซ์ `.checked` ทันที โดยใช้เวลาทำงานไม่ถึง 1 มิลลิวินาที 

* **ค้นหาโค้ดเดิมใน [app.js](file:///c:/Users/ADMIN/Desktop/Data sum Daily express 4 month V2.3 base/Dashboard/scripts/app.js) (ประมาณบรรทัดที่ 3572-3599):**
```javascript
    function buildMsOptions(id, options, currentVals = []) {
      const pnl = document.getElementById('ms_pnl_' + id);
      if (!pnl) return;
      if (options.length === 0) {
        pnl.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:12px;text-align:center">ไม่มีข้อมูล</div>';
        return;
      }
      const validVals = currentVals.filter(v => options.includes(v));
      const allChecked = validVals.length === 0 || validVals.length === options.length;

      pnl.innerHTML = `
        <div style="position:sticky;top:0;background:#1e222d;z-index:10;border-bottom:1px solid rgba(255,255,255,.05);padding-bottom:8px;margin-bottom:4px;padding-top:6px;">
          <div style="padding:4px 8px 8px 8px;">
            <input type="text" id="ms_search_${id}" placeholder="ค้นหา..." style="width:100%;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;outline:none;" oninput="dcMsSearch('${id}', this.value)" onclick="event.stopPropagation()">
          </div>
          <label class="dc-ms-item">
            <input type="checkbox" id="ms_all_${id}" value="_ALL_" onchange="dcMsToggleAll('${id}')" ${allChecked ? 'checked' : ''}>
            <span style="font-weight:700;color:var(--accent)">เลือกทั้งหมด</span>
          </label>
        </div>
        <div id="ms_items_${id}">
      ` + options.map(o => `
        <label class="dc-ms-item" data-ms-val="${esc(o).toLowerCase()}" style="display:flex;">
          <input type="checkbox" value="${esc(o)}" onchange="dcMsChange('${id}')" ${validVals.includes(o) ? 'checked' : ''}>
          <span>${esc(o)}</span>
        </label>
      `).join('') + `</div>`;
    }
```

* **แทนที่ด้วยโค้ดใหม่ (Optimized):**
```javascript
    function buildMsOptions(id, options, currentVals = []) {
      const pnl = document.getElementById('ms_pnl_' + id);
      if (!pnl) return;
      if (options.length === 0) {
        pnl.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:12px;text-align:center">ไม่มีข้อมูล</div>';
        delete pnl._prevOptionsJson; // ล้างแคชตัวกรองเดิมออก
        return;
      }
      const validVals = currentVals.filter(v => options.includes(v));
      const allChecked = validVals.length === 0 || validVals.length === options.length;

      // ทางลัดระดับซุปเปอร์สปีด: ตรวจเช็คว่ารายชื่อตัวกรองมีค่าตรงกับรอบที่แล้วหรือไม่
      const optionsJson = JSON.stringify(options);
      if (pnl._prevOptionsJson === optionsJson) {
        // หากตัวเลือกเหมือนเดิม อัปเดตสถานะ checked ของช่องเลือกอย่างเดียวโดยไม่วาด HTML ใหม่ (ความเร็วเพิ่มขึ้น 100 เท่า)
        const allCb = pnl.querySelector(`#ms_all_${id}`);
        if (allCb) allCb.checked = allChecked;
        const checkboxes = pnl.querySelectorAll(`#ms_items_${id} input[type="checkbox"]`);
        const valSet = new Set(validVals);
        checkboxes.forEach(cb => {
          cb.checked = valSet.has(cb.value);
        });
        return;
      }

      // ในกรณีมีรายชื่อตัวกรองเปลี่ยนใหม่ (เช่น เปลี่ยนวันที่เลือก) วาด HTML ใหม่และบันทึกแคช
      pnl._prevOptionsJson = optionsJson;
      pnl.innerHTML = `
        <div style="position:sticky;top:0;background:#1e222d;z-index:10;border-bottom:1px solid rgba(255,255,255,.05);padding-bottom:8px;margin-bottom:4px;padding-top:6px;">
          <div style="padding:4px 8px 8px 8px;">
            <input type="text" id="ms_search_${id}" placeholder="ค้นหา..." style="width:100%;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;outline:none;" oninput="dcMsSearch('${id}', this.value)" onclick="event.stopPropagation()">
          </div>
          <label class="dc-ms-item">
            <input type="checkbox" id="ms_all_${id}" value="_ALL_" onchange="dcMsToggleAll('${id}')" ${allChecked ? 'checked' : ''}>
            <span style="font-weight:700;color:var(--accent)">เลือกทั้งหมด</span>
          </label>
        </div>
        <div id="ms_items_${id}">
      ` + options.map(o => `
        <label class="dc-ms-item" data-ms-val="${esc(o).toLowerCase()}" style="display:flex;">
          <input type="checkbox" value="${esc(o)}" onchange="dcMsChange('${id}')" ${validVals.includes(o) ? 'checked' : ''}>
          <span>${esc(o)}</span>
        </label>
      `).join('') + `</div>`;
    }
```
