# spec.md — 5S Audit System

Living save-point document. **อ่านไฟล์นี้ก่อนเริ่ม session ใหม่เสมอ** (ดู CLAUDE.md rule ท้ายไฟล์)
คู่มือละเอียดกว่า: `CLAUDE.md` (กติกาการเขียนโค้ด/deploy) · `docs/PROJECT_SUMMARY.md` (สถาปัตยกรรมเชิงลึก) · `work-logs/` (ประวัติรายวัน)

---

## 1. Architecture

**Component คร่าวๆ:**

```
Browser (mobile-first PWA, TH/EN)
  ├─ *.html (14 หน้า, static, ไม่มี build step)
  ├─ js/app.js  ← โค้ด frontend ทั้งหมดไฟล์เดียว (~5,300+ บรรทัด)
  │    I18n · Session · API layer (_sb) · AppState · UI render · router (initPage() ตามชื่อไฟล์)
  ├─ css/style.css  ← global stylesheet, CSS variables
  └─ sw.js  ← Service Worker (cache HTML/CSS, JS ดึงสดจาก network เสมอ, cache-bust ผ่าน ?v=NN)
        │
        ▼  supabase-js (ตรงจาก browser, ไม่มี server กลาง)
Supabase (PostgreSQL + Auth + Storage)
  ├─ Auth  → auth.users, session ผูกกับ profiles (1:1)
  ├─ Postgres → 8 tables (ดู §5 data contract) + RLS policies + SECURITY DEFINER triggers/RPCs
  └─ Storage → bucket audit-photos
        │
        ▼
GitHub Pages (hosting, branch main, root ของ repo, .nojekyll)
```

**Tech:**
- Frontend: Vanilla JS ES6+, HTML, CSS, Bootstrap Icons — ไม่มี framework, ไม่มี bundler
- Backend: Supabase (Postgres + Auth + Storage), เรียกตรงผ่าน `supabase-js`
- Hosting: GitHub Pages, repo public (`Seksunw/5s-audit-system`)
- ความปลอดภัย: **RLS + trigger ที่ระดับ DB คือ trust boundary จริง** — client-side check เป็นแค่ UX เท่านั้น (client bypass ได้เสมอ)

**ทำไมเลือกสถาปัตยกรรมนี้:** ระบบเดิมเป็น Google Apps Script (ย้ายออกมา 2026-07-30) โจทย์คือโรงงานใช้งานบนมือถือเป็นหลัก ไม่ต้องการ backend เซิร์ฟเวอร์แยกให้ดูแล → เลือก static PWA + BaaS (Supabase) ที่ enforce สิทธิ์ผ่าน RLS ล้วนๆ แทนที่จะเขียน API layer เอง

---

## 2. Done — decisions made (ทำไมเลือกทางนี้)

- **คะแนนเฉลี่ยแบบ "เฉลี่ยรายคน" (mean of percent) ไม่ใช่ pooled (Σscore/Σmax).**
  ทำไม: ทุกผลตรวจต้องมีน้ำหนักเท่ากันไม่ว่าพื้นที่นั้นจะมีกี่ข้อ/กี่คนตรวจ — ป้องกัน bias จากพื้นที่ที่มีเกณฑ์เยอะกว่า
  **ห้ามเปลี่ยนกลับเป็น pooled** (ดูคอมเมนต์ "ส่วน H" ใน `getDashboard()` ใน app.js)

- **ไม่คำนวณคะแนน/สถานะที่ client** — trigger `recalc_audit_header` คำนวณให้ที่ DB ทุกครั้งที่ `audit_details` เปลี่ยน
  ทำไม: กัน client ปลอมคะแนน/สถานะผ่าน DevTools ตรงๆ (client เขียนแค่ raw score รายข้อ, DB เป็นคนสรุปเสมอ)

- **ล็อกผลตรวจหลัง finalize ผ่าน RPC `lock_audit` (security definer)** แทนการปล่อยให้ auditor แก้ header ได้เอง
  ทำไม: ป้องกัน auditor แก้ไข/ลบ/ปลอมคะแนนตัวเองย้อนหลังหลัง submit — `headers_update` policy = admin เท่านั้น, trigger `trg_chk_locked` กันแก้ `audit_details` ที่ล็อกแล้วด้วย

- **Roles เหลือ 3 ตัวใช้จริง (นโยบาย 2026-08-05): `admin` / `auditor` / `viewer`** — `manager`/`area_manager` เลิกใช้แต่ลบ enum value ไม่ได้ (ซ่อนจาก dropdown, `is_staff()` = admin-only แล้ว, คนที่ยังเป็น role เก่าได้สิทธิ์เท่า auditor)
  ทำไม: เดิมมี 5 roles ซับซ้อนเกินจำเป็นสำหรับขนาดทีมจริง

- **`FACILITY_PLANT_IDS = ['CAF','MTN']` constant** (2026-08-07) — plant ที่ area หลักคือ cafeteria/maintenance เอง ยกเว้นออกจาก `getAreas()`'s normal type-hiding filter
  ทำไม: เดิม CAF/MTN เป็น "facility card" พิเศษที่ hardcode แยกจาก plant grid ปกติ พอเปลี่ยนให้โชว์เป็น plant ปกติ (P&C / Maintenance & Utility) ต้องกันไม่ให้ area หลักของมันเองโดนกรองออก — ใช้ constant เดียวกันทั้ง `getAreas()` และ `initPlant()` กัน hardcode ซ้ำ

- **`criteria.area_types` เป็น array บนตัวเกณฑ์ ไม่ใช่ mapping table แยก** — เกณฑ์ applies อัตโนมัติกับทุก area ที่ `area_type` ตรง
  ทำไม: เพิ่ม area ใหม่ (เช่น Office ใน CAF/MTN) ที่ใช้เกณฑ์เดียวกับ Office F1/F2/F3 ไม่ต้องผูก mapping เพิ่มเลย แค่ตั้ง `area_type='office'`

- **ทุกทางเข้า `audit.html` ต้องส่ง `scheduleId`** (แก้บั๊กจริง 2026-08-07) — `selectArea()` ตอนนี้ forward `scheduleId` เหมือน `startAssignedAudit()`
  ทำไม: `schedule_progress` view นับความคืบหน้าจาก `audit_headers.schedule_id` — ถ้า null งานจะค้าง "pending" ตลอดแม้ auditor ตรวจจริงและเห็นผลในประวัติตัวเองแล้ว

- **PDF improvement-items report ไม่โชว์ชื่อ/คะแนนรายคอมเมนต์** — โชว์แค่ remark+รูป, รวม tag "ตรวจซ้ำ N ครั้ง" ถ้าหลายคนเจอหัวข้อเดียวกัน, ชื่อผู้ตรวจรวมไว้ที่หัวพื้นที่แทน
  ทำไม: จุดประสงค์ของรายงานคือให้พื้นที่เอาไปปรับปรุง ไม่ใช่ให้เครดิต/ตำหนิรายคน — ผู้ใช้ยืนยันชัดเจนหลังดูดราฟต์จริง

- **`patches.sql` เป็นไฟล์เดียว idempotent สำหรับทุกการแก้ DB** (ไม่แก้ `schema.sql` ตรงๆ)
  ทำไม: `schema.sql` มีไว้สำหรับสร้าง DB ใหม่เปล่าเท่านั้น รันซ้ำบน DB จริงจะพัง — patches.sql append-only + idempotent ปลอดภัยกว่า, แต่**ต้องเช็ค live DB จริงเทียบไฟล์เป็นระยะ** (เจอ deployment gap จริงมาแล้วกับ `admin_reset_data()`)

- **เลิกเขียน `work-logs/WORK_LOG_YYYY-MM-DD.md` ใหม่ ใช้ `spec.md` § Current state อย่างเดียว** (9 ส.ค. 2026)
  ทำไม: ตั้งแต่มี `spec.md` (8 ส.ค.) พบว่าไม่ได้เขียน worklog คู่กันเลยจริง (ค้าง 2 วัน) เพราะซ้ำซ้อนกัน — spec.md สั้นกว่า อ่านเร็วกว่าตอนเริ่ม session ใหม่ ผู้ใช้ยืนยันว่าไม่ได้ใช้ worklog อ่านย้อนหลัง/ส่งรายงานคนอื่นแล้ว จึงไม่มีเหตุผลต้องดูแล 2 ระบบพร้อมกัน · ไฟล์เก่าใน `work-logs/` ยังเก็บไว้เป็นประวัติ ไม่ลบ แต่ไม่สร้างใหม่อีก

---

## 3. Todo — backlog (update ทุกครั้งที่มีงานใหม่/เสร็จ)

- [ ] เปิด **Leaked Password Protection** ใน Supabase Auth (Dashboard-only, ทำผ่าน SQL/MCP ไม่ได้)
- [ ] เคลียร์รูปกำพร้าใน Storage bucket `audit-photos` (~48 ไฟล์, ~6MB จากการทดสอบ)
- [ ] (เสนอไว้ ยังไม่ยืนยัน) สร้าง UI ในแอปให้ admin แก้ผลตรวจย้อนหลังได้ — ตอนนี้ทำได้ผ่าน SQL Editor เท่านั้น (ดู §5 "unlock→edit→relock" pattern)
- [ ] (เสนอไว้ ยังไม่ยืนยัน) auto-save คำตอบระหว่างตรวจลง `localStorage` กันหลุด/เน็ตขาดกลางคัน
- [ ] `profiles` ตอนนี้ผู้ใช้ภายในอ่านได้ทั้งตาราง (รวม email/role) — ยังไม่จำกัดเป็น view
- [ ] `isStaff` client-side ยังเช็ค legacy role `'manager'` อยู่ — pre-existing, low-risk (DB-side `is_staff()` เป็น admin-only แล้ว), ตัดสินใจแล้วว่าไม่แก้ตอนนี้ (`/code-review` 2026-08-07)
- [ ] `TRANSLATIONS` ใน app.js มี key `en:` ซ้ำ 2 ครั้ง (บล็อกแรกตาย โดนบล็อกหลังทับ ไม่กระทบผู้ใช้) — เช็คก่อนแก้ i18n อย่าไปแก้บล็อกแรกคาดหวังผล
- [ ] **ปรับโครงสร้างพื้นที่ "รอบอาคาร" ให้ตรงกับ P&C จริง ก่อนรอบตรวจถัดไป** — ตอนนี้แก้แบบเร่งด่วนไปแค่ `audit_headers.plant_id` (ดู §4 2026-08-08) ให้ Dashboard คำนวณถูก แต่ `areas.plant_id`/`area_name` ของ `NIF-OD`/`POC-OD`/`SUP-OD` ยังไม่แก้ ต้องทำให้ครบ: (1) `areas.plant_id` ทั้ง 3 → `CAF`, (2) rename `area_name` กันชื่อ "รอบอาคาร" ชนกัน 3 พื้นที่ (เช่น "รอบอาคาร (NIF)"), (3) backfill `schedules.plant_id` ของ 3 งานมอบหมายเดิม → `CAF` ด้วย — ถ้าไม่ทำก่อนรอบถัดไป auditor คนที่ยังไม่ตรวจ (schedule ยัง pending) จะได้ผลตรวจใหม่เป็น plant_id เดิม (NIF/POC/SUP) อัตโนมัติจากแอป ต้องแก้มือซ้ำอีกครั้ง
- [ ] (เสนอไว้ ยังไม่ยืนยัน) `Session.refreshRole()` ให้ sync `name` พร้อม `role`/`status` ด้วย — ตอนนี้คนที่ล็อกอินค้างอยู่ก่อนถูกเปลี่ยนชื่อใน `profiles` จะยังเห็นชื่อเก่าที่หัวเว็บ + ช่อง "จัดทำโดย" ใน PDF export จนกว่าจะ logout/login ใหม่ (ดู §4 2026-08-08)

---

## 4. Current state (save point — last updated 2026-08-08)

**สถานะล่าสุด:** ระบบเริ่มใช้งานจริงวันแรกไปเมื่อ 2026-08-07 ผ่านไปด้วยดี บั๊กที่เจอระหว่างวัน (reset button, assigned-task ค้าง) แก้และ verify กับข้อมูลจริงเรียบร้อยแล้ว ไม่มีงานค้างที่ต้องทำต่อทันที — งานทั้งหมดใน backlog (§3) เป็น "เสนอไว้ ยังไม่ยืนยัน" รอผู้ใช้สั่งเท่านั้น

**สิ่งที่เพิ่งทำเสร็จ (2026-08-07, เรียงตาม commit):**
1. `ea7ec6d` — ย้าย Supabase MCP setup guide ออกจาก CLAUDE.md ไปเป็น skill
2. `42f96a2` — เอา `capture=environment` ออกจาก photo picker (เปิดอัลบั้มได้ ไม่บังคับกล้อง)
3. `0528f94` → `9c7b598` — PDF improvement-items: merge หัวข้อซ้ำข้ามผู้ตรวจ + ลบชื่อ/คะแนนรายคอมเมนต์ออก
4. `d2f81f9` — CAF→"P&C" rename + เพิ่ม area Office ให้ CAF/MTN (inherit เกณฑ์ office อัตโนมัติ)
5. (commit เดียวกันช่วง) — CAF/MTN โชว์เป็น plant grid ปกติ + `FACILITY_PLANT_IDS` constant (ผ่าน `/code-review` แล้ว)
6. `60e7dec` — Dashboard Ranking โชว์ % ทศนิยม 1 ตำแหน่ง
7. `dd7abf8` — แก้บั๊ก `selectArea()` ไม่ส่ง `scheduleId` + backfill ข้อมูลจริง 7 audit rows (คุณเล็ก×6, คุณแหวน×1) + recompute `schedules.status`
8. `750a0d2` — WORK_LOG_2026-08-07.md + อัปเดต CLAUDE.md (cache-bust v50, gotchas ใหม่)

**cache-bust ปัจจุบัน:** `js/app.js`/`css/style.css` = `?v=54` ในทุก HTML · `sw.js` `CACHE_NAME` = `5s-audit-v5.19`

**เรื่องที่คุยจบแล้วไม่ต้องทำอะไรต่อ:** GitHub Actions annotation "job was not acquired by Runner of type hosted" (run #69, ~19m50s) — ยืนยันแล้วว่าเป็น GitHub-side runner allocation hiccup ชั่วคราว ไม่เกี่ยวกับโค้ด/workflow ของ repo, run ถัดๆมา (#70-76) ปกติดีหมด

**2026-08-08 (วันนี้):**
- เริ่ม session ด้วยการตั้งระบบ `spec.md` นี้ + เพิ่ม rule ใน CLAUDE.md ให้ update ทุกครั้งหลังทำงานเสร็จ
- แก้ข้อมูลจริง (ผู้ใช้รัน SQL เอง, verify แล้ว): `audit_round` ที่กรอกผิดเป็น `'Round 2'` ตอนมอบหมายงาน Office (CAF-OF/MTN-OF, สร้าง 2026-08-07) — แก้เป็น `'Round 1'` ทั้งหมด ทั้ง `schedules` (2 แถว) และ `audit_headers` (4 แถว, locked แล้ว) ระบบมีรอบตรวจเดียวจริง ไม่มีรอบอื่นหลงเหลือ (verify: `schedules`/`audit_headers` เหลือค่า `audit_round` เดียวคือ Round 1 ทั้งหมด — 16 และ 57 แถวตามลำดับ) — ไม่ต้องผ่าน unlock/relock เพราะ `trg_chk_locked` ผูกแค่ `audit_details` ไม่ครอบ `audit_headers`
- Dashboard "พื้นที่ต้องปรับปรุง": เพิ่มตัวกรองโรงงาน (`impPlant` dropdown) คู่กับตัวกรองพื้นที่เดิม — เลือกโรงงานแล้ว area dropdown จะ cascade กรองเหลือแค่พื้นที่ของโรงงานนั้น (`_impPlantFilter`/`_impPlantList`, `impFillPlantFilter()`, `impPlantChange()` ใน app.js; เพิ่ม `Plant_ID` ใน `getImprovementItems()`'s areaList; เพิ่ม dropdown ใน dashboard.html; i18n key `imp.all_plants` TH/EN) — cache-bust v50→v51, sw.js v5.15→v5.16
- แก้ **PDF export ไม่ตรงกับ dashboard 100%** (bug จริงที่ผู้ใช้เจอ): (1) Plant Ranking/Area Ranking ในรายงานปัดเป็นจำนวนเต็ม (`Math.round`) ขณะที่ dashboard โชว์ทศนิยม 1 ตำแหน่งแล้วตั้งแต่ 2026-08-07 (`60e7dec`) — แก้ให้ `raw.toFixed(1)` ทั้ง `plantRows`, `areaRows`, และ badge คะแนนพื้นที่ (`areaScoreByName`/`areaPct`) ใน `buildReportHTML()`; (2) `exportDashboardPDF()` เดิมส่ง `_impItems` (ทุกพื้นที่ทั้งบริษัท) เข้ารายงานเสมอ ไม่สนตัวกรองโรงงาน/พื้นที่ที่เลือกอยู่บนหน้าจอ — แก้ให้ filter ด้วย `_impPlantFilter`/`_impAreaFilter` ก่อนส่งเข้า `buildReportHTML()` (เฉพาะ "พื้นที่ต้องปรับปรุง"/corrective-action sheets เท่านั้น — Plant/Area Ranking บนหน้าสรุปยังคงโชว์ทั้งบริษัทเหมือนเดิม เพราะเป็นตารางเปรียบเทียบภาพรวม ไม่ใช่ส่วนที่ตัวกรองนี้ครอบคลุม) — cache-bust v51→v52, sw.js v5.16→v5.17
- `/init` pass บน CLAUDE.md: fix cache-bust reference ที่ค้าง, เติมรายชื่อไฟล์ `supabase/*.sql` ที่ขาด (`delete_user.sql`, `reset_test_data.sql`, `RUN_2026-08-05*.sql`), เพิ่ม section "Local dev / debug" (ไม่มี dev Supabase แยก, SW ต้อง http(s) origin, `5s_debug` flag) — commit `0355ae4` (รวมกับ PDF fix ด้านบน)
- **ย้าย "รอบอาคาร" (NIF-OD/POC-OD/SUP-OD) เข้า Plant P&C ในการคำนวณ dashboard** (ผู้ใช้ตัดสินใจ): พื้นที่ทั้ง 3 เป็นพื้นที่รับผิดชอบของทีม P&C จริง แต่ระบบผูกด้วย `areas.plant_id` เดียว (โรงงานเจ้าของพื้นที่) เท่านั้น ไม่มีแนวคิด "ทีมที่รับผิดชอบตรวจ" แยกต่างหาก — แก้แบบเร่งด่วนเฉพาะข้อมูล (ยังไม่แก้โครงสร้าง เพราะผู้ใช้บอกจะปรับปรุงเต็มรูปแบบตอนตรวจรอบถัดไป): UPDATE `audit_headers.plant_id` ของ 9 ผลตรวจที่ล็อกแล้ว (auditor 3 คน × 3 พื้นที่ รอบ 2026-08-07 Round 1) จาก NIF/POC/SUP → `CAF` ผู้ใช้รันเองผ่าน SQL Editor, verify แล้ว (Plant Ranking: CAF ขยับเป็น 15 ผลตรวจ เฉลี่ย 85.6%, NIF/POC/SUP ไม่มีคะแนนรอบอาคารถ่วงแล้ว) · `areas.plant_id`/`areas.area_name` ของ 3 พื้นที่นี้ **ยังไม่แก้** (ผู้ใช้เลือกไม่เปลี่ยนชื่อตอนนี้) → ดู Gotchas ใน CLAUDE.md เรื่อง divergence ระหว่าง `areas.plant_id` กับ `audit_headers.plant_id`
  - **ค้าง:** ถ้า auditor คนที่ 4 (ยังไม่ตรวจ, schedule ยัง pending) ตรวจให้เสร็จก่อนโครงสร้างจะถูกแก้จริง ผลตรวจใหม่จะได้ `plant_id` เดิม (NIF/POC/SUP) อัตโนมัติจากแอป ต้องแก้มือซ้ำแบบนี้อีกครั้ง — ควรปรับโครงสร้างจริง (`areas.plant_id` + rename area_name กันชื่อชนกัน + backfill `schedules.plant_id`) ก่อนรอบตรวจถัดไปเพื่อเลิกพึ่งการแก้มือ
- ผู้ใช้อัปเดตชื่อ-นามสกุลจริงของ auditor ทุกคนใน `profiles.name` เอง (ผ่านแอปหรือ Dashboard, ไม่ใช่ผมทำ) — เช็คให้ว่ากระจายทั่วระบบครบหรือยัง: verify ผ่าน SQL แล้วครบ **15/15 โปรไฟล์** (คนสุดท้าย "Khun Nice"/Mr. Yukihiro Aoshima อัปเดตตามหลัง) ทุกจุดที่ query ชื่อจาก DB สดๆ (Dashboard ranking/roster, ประวัติ, งานมอบหมาย, พื้นที่ต้องปรับปรุง) ตรงทันทีเพราะไม่มีการเก็บชื่อซ้ำที่อื่นในสคีมา (audit_headers/schedules เก็บแค่ auditor_id/auditor_ids เป็น FK)
  - **พบช่องโหว่จริงที่ยังไม่แก้:** `Session.refreshRole()` (js/app.js ~line 1767) sync แค่ `role`/`status` จาก DB ทุกครั้งที่เปิดหน้า (fix เดิมจากบั๊ก role ค้าง 5 ส.ค. 2026) **แต่ไม่ sync `name` ด้วย** — คนที่ล็อกอินค้างอยู่ก่อนเปลี่ยนชื่อจะยังเห็นชื่อเก่าที่หัวเว็บ (`updateUserUI()`) และช่อง "จัดทำโดย" ตอน export PDF (`exportDashboardPDF()` ใช้ `AppState.user.name` จาก session cache) จนกว่าจะ logout/login ใหม่ — เสนอไว้แล้วว่าจะแก้ให้ sync `name` พร้อม `role` ในฟังก์ชันเดียวกัน ผู้ใช้ยังไม่ตอบรับ ค้างเป็น backlog (ดู §3)

**2026-08-09:**
- **เติม i18n (TH/EN) ให้ครบทุกหน้า** — ผู้ใช้ถามว่าการสลับภาษาตอนนี้เป็นยังไง มีตรงไหนยังไม่เปลี่ยนไหม ตรวจสอบทั้งระบบพบว่าหน้าแกนหลักของ auditor (audit/history/summary/dashboard/area) แปลดีอยู่แล้ว แต่**หน้าฝั่ง admin เกือบทั้งหมดแทบไม่มี `data-i18n` เลย** (`criteria.html`, `schedule.html`, `logs.html` = 0 จุด) เพราะทำตอนต้นโปรเจกต์ก่อนวาง convention — ผู้ใช้ยืนยันให้ทำเต็มรูปแบบทั้ง static HTML และ JS-rendered content (ไม่ใช่แค่เติม `data-i18n` attribute แต่ต้องแก้ template string ใน `app.js` ที่ hardcode ข้อความไทยตรงๆ ด้วย เช่น unit "ข้อ", error message, toast, สถานะต่างๆ)
  - เพิ่ม TRANSLATIONS key ใหม่ ~90 คู่ (TH+EN, prefix ตามหน้า: `crit.*`, `sched.*`, `asg.*`, `logs.*`, `tasks.*`, ส่วนเพิ่มเติมของ `home.*`/`plant.*`/`users.*`/`login.*`/`dash.*`/`area.*`) — verify key parity TH/EN ครบ 100% ทุกครั้งหลังแก้ (สุดท้าย 385/385 คู่ตรงกัน)
  - แก้ไฟล์: `criteria.html`+JS (`initCriteria`/`setTypeFilter`/`criteriaRender`), `schedule.html`+JS (ทั้งหน้า — grid, 2 modal, bulk bar, save/delete flow), `assign.html`+JS (`initAssign`/`renderAssign`), `logs.html`+JS (`initLogs`/`renderLogs`), `home.html` (quick-menu 4 ปุ่ม + hero card 3 ข้อความใน `initHome()`), `plant.html` (2 quick-link + subtitle), `users.html` (เขตอันตราย/reset modal/area picker/suspend label), `index.html` (app name + footer version), `mytasks.html`+JS (`TASK_STATE_CFG`, `renderAssignedTaskCards`, empty state — พลาดไปตอนแรกไม่ได้ตรวจ JS ของหน้านี้), `dashboard.html`+`area.html` (จุดเล็กๆ)
  - เพิ่มกลไกใหม่ใน `I18n.apply()`: `data-i18n-aria` (แปล `aria-label` — เดิมมีแค่ `data-i18n`/`-ph`/`-title`/`-html`) ใช้กับปุ่มปิด lightbox ใน dashboard
  - **ระหว่างทางเจอ key ซ้ำที่ตัวเองเผลอสร้างทับของเดิมที่มีอยู่แล้ว ~6 คู่** (เช่น `asg.unit_hint`, `users.suspend`/`suspend_hint`, `login.pass_ph`, `home.score_desc_html`) — ลบของใหม่ทิ้ง ใช้ key เดิมที่ผูกกับ HTML อยู่แล้วแทน เพื่อไม่ให้มี 2 key ความหมายเดียวกันลอยอยู่
  - verify: `node --check` ผ่าน, `<`/`>` เท่ากันทุกไฟล์ (ไม่มี tag เปิด/ปิดไม่ครบ), ทุก `data-i18n*` key ที่ใช้ใน HTML มีอยู่จริงใน TRANSLATIONS ทั้ง TH/EN (ไม่มี key ค้าง/สะกดผิด)
  - **ไม่กระทบข้อมูล/คะแนน/audit ที่ทำไปแล้วเลย** — เป็นการแก้ frontend text-display layer ล้วนๆ ไม่แตะ id/onclick/query/logic คำนวณใดๆ (คุยยืนยันกับผู้ใช้ก่อนเริ่มแล้ว)
  - cache-bust v52→v53, sw.js v5.17→v5.18

**2026-08-09 (ต่อ):**
- **เกณฑ์มาตรฐาน 5ส (criteria) รองรับ EN แล้ว** — ผู้ใช้มีไฟล์ต้นฉบับ `5S Standard (มาตรฐาน 5ส) _R.00 16.06.2026.pdf` (มาตรฐานกลางทางการ ไทย+อังกฤษคู่กันทุกข้อ 34 หมวด ตรงเลข sub_category กับตาราง `criteria` เป๊ะ — ยืนยันด้วย SQL: 132 ข้อ/34 หมวด ตรงกันทั้งหมด) ถามว่าใช้ไฟล์นี้ทำอะไรได้บ้างเรื่องเปลี่ยนภาษามาตรฐานตอนใช้แอปเป็น EN
  - **พบ nuance สำคัญ:** PDF มีคำแปลอังกฤษที่แปลจากข้อความไทย**ฉบับเต็ม** (ยาว/เป็นทางการ) แต่ `criteria.question`/`description` ในระบบเป็น**เวอร์ชันสรุปสั้น** (ตัดมาให้เหมาะจอมือถือ) — ไม่ใช่คำเดียวกัน แม้ความหมายตรงกัน
  - ผู้ใช้เลือก: แปล/สรุปคำแปล EN ใหม่ให้สั้นกระชับเท่าภาษาไทยปัจจุบัน (ไม่ใช้คำแปลยาวจาก PDF ตรงๆ) — ใช้ PDF เป็น reference ความถูกต้องของศัพท์เทคนิคเท่านั้น (เช่น "จป.วิชาชีพ" = professional safety officer/JSO, SDS = Safety Data Sheets)
  - **DB:** เพิ่มคอลัมน์ `criteria.question_en`, `description_en`, `category_en` (patches.sql ส่วน I, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `UPDATE ... FROM (VALUES...)` ครบทั้ง 132 แถว) — **ผู้ใช้รัน SQL แล้ว + verify ผ่าน MCP แล้ว: 132/132 แถวมีครบ 3 คอลัมน์ สุ่มเช็ค 4 แถวข้ามหลายหมวดตรงเป๊ะ** (รวมแถวที่มี escaped quote ซ้อน `C-30-6` ก็ไม่เพี้ยน)
  - **Code:** `mapCriteria()` (ใช้กับ `getCriteria()` → criteria.html + audit.html checklist), `getImprovementItems()` (dashboard "พื้นที่ต้องปรับปรุง" + PDF export), `getAuditDetail()` (summary.html) — ทั้ง 3 จุดเลือกคอลัมน์ EN/TH ตาม `I18n.getLang()==='en'` fallback เป็นไทยเสมอถ้าแถวไหนยังไม่มีคำแปล (กันเกณฑ์ใหม่ในอนาคตที่ลืมเติม _en)
  - node --check ผ่าน, verify criteria_id ครบ 132/132 ไม่ซ้ำไม่ขาดด้วย diff
  - cache-bust v53→v54, sw.js v5.18→v5.19
  - **commit + push แล้ว** (`638d4b6`) — ฟีเจอร์นี้เสร็จสมบูรณ์ ไม่มีอะไรค้าง (ยังไม่ได้ลองเปิดแอปจริงสลับ EN ดูด้วยตาตัวเองว่าหน้าตาถูกต้อง — ถ้าเจอปัญหาระหว่างใช้งานจริงค่อยแจ้ง)

**2026-08-09 (ต่ออีก):**
- **เลิกเขียน `work-logs/` ใหม่ ใช้ `spec.md` อย่างเดียว** — ผู้ใช้ถามว่า worklog รายวันยังจำเป็นไหม เช็คแล้วพบว่าตั้งแต่มี spec.md (8 ส.ค.) ไม่ได้เขียน worklog คู่กันเลย (ค้าง 2 วัน) ผู้ใช้ยืนยันไม่ได้ใช้อ่านย้อนหลัง/ส่งรายงานแล้ว ตัดสินใจเลิกเขียนใหม่ถาวร ดูเหตุผลเต็มใน §2 · แก้ CLAUDE.md ตัด rule "เขียน worklog ทุกครั้ง" ออก + ปรับ pointer ต้นไฟล์ให้ชี้ spec.md เป็นหลัก (ไฟล์เก่าใน `work-logs/` ยังเก็บไว้ ไม่ลบ)

---

## 5. Data contract — interface ระหว่าง component

### 5.1 DB schema (8 tables, `supabase/schema.sql`)

| Table | PK | คอลัมน์สำคัญ | หมายเหตุ |
|---|---|---|---|
| `profiles` | `id` (=`auth.users.id`) | `role`(enum `user_role`), `status`, `assigned_plants[]`, `assigned_areas[]`, `legacy_user_id` | 1:1 กับ auth.users |
| `plants` | `plant_id` (text, เช่น SUP/POC/NIF/CAF/MTN) | `plant_name`, `status` | |
| `areas` | `area_id` | `plant_id`→plants, `area_type`(enum `area_type`), `status` | |
| `criteria` | `criteria_id` (C-XX-X) | `category`, `sub_category`, `area_types[]`(enum array, ว่าง=ใช้ทุกประเภท), `max_score`, `active` | 132 ข้อ/34 หมวด |
| `audit_headers` | `audit_id` (uuid) | `plant_id`, `area_id`, `auditor_id`, `audit_date`, `total_score`, `max_score`, `percent`, `status`(enum `audit_status`), `schedule_id`, `audit_round`, `locked_at` | **total_score/max_score/percent/status คำนวณโดย trigger `recalc_audit_header` เท่านั้น ห้ามเขียนจาก client** |
| `audit_details` | `detail_id` (uuid) | `audit_id`→headers, `criteria_id`→criteria, `score`(0-2), `na`(bool), `remark`(≤200 chars), `photo_urls[]` | unique(`audit_id`,`criteria_id`) |
| `schedules` | `schedule_id` (uuid) | `plant_id`, `area_id`, `auditor_ids[]`(uuid array = quorum), `audit_date`, `audit_round`, `status`(enum `schedule_status`: pending/completed เท่านั้น) | |
| `audit_logs` | `log_id` (uuid) | `user_id`, `action`, `entity`, `entity_id`, `old_data`/`new_data`(jsonb) | audit trail |

**Enums:** `user_role`(admin/manager/auditor/area_manager — manager+area_manager เลิกใช้แล้ว), `record_status`(active/inactive), `area_type`(office/production/warehouse/cafeteria/outdoor/maintenance), `audit_status`(excellent/good/need_improvement/pending/failed), `schedule_status`(pending/completed)

**เกณฑ์ผ่าน:** ≥90 excellent · ≥75 good · <75 need_improvement

**View สำคัญ:** `schedule_progress` — `schedule_id, required_n, done_n, is_completed, required_ids, done_ids` (live view ไม่ใช่ค่า cache, ต้องคำนวณจาก `audit_headers.schedule_id` ที่ locked/non-pending เท่านั้น)

**RPC สำคัญ:** `lock_audit(audit_id)` (security definer, ล็อก header หลัง finalize) · `admin_reset_data()` (security definer, admin-only — **เคยเจอ deployment gap ระหว่างไฟล์กับ live DB จริง เช็ค `pg_get_functiondef` เทียบไฟล์ก่อนสงสัยจุดอื่นถ้าพฤติกรรมไม่ตรง**)

**Trigger สำคัญ:** `recalc_audit_header` (คำนวณคะแนน header จาก details ทุกครั้งที่ details เปลี่ยน) · `trg_chk_locked`/`chk_header_locked()` (กันแก้ audit_details ที่ header ล็อกแล้ว — bypass check ใช้ `auth_role()`→`auth.uid()` ซึ่งเป็น NULL ใน SQL Editor ไม่มี session ต้อง unlock→edit→relock ด้วยมือ) · `chk_header_schedule()` (BEFORE INSERT เท่านั้น, validate auditor อยู่ใน schedule's `auditor_ids`, stamp `audit_round`) · `sync_schedule_status()` (fire เฉพาะ INSERT/DELETE header หรือ UPDATE ของ `locked_at`/`status` — **ไม่ fire ถ้า UPDATE แค่ `schedule_id` เฉยๆ**, backfill ด้วยมือต้อง recompute `schedules.status` เองด้วย)

### 5.2 Client-side mapping (js/app.js) — snake_case (DB) ↔ PascalCase (UI)

`mapPlant(p)` → `Plant_ID, Plant_Name, Status`
`mapArea(a)` → `Area_ID, Plant_ID, Area_Name, Area_Type, Status`
`mapCriteria(c)` → `Criteria_ID, Category, Sub_Category, Question, Description, Area_Type, Max_Score, Active`
`mapProfile(u)` → `User_ID, Employee_ID, Name, Department, Email, Role, Status, Assigned_Areas, Assigned_Plants`
`mapHeader(h)` → `Audit_ID, Plant_ID, Area_ID, Auditor_ID, Audit_Date, Total_Score, Max_Score, Percent, Status`

**กติกา:** ห้ามปน field ดิบ (snake_case) กับที่ map แล้ว (PascalCase) ในโค้ดเดียวกัน — ทุกจุดที่ query ตรงจาก `_sb` (Supabase client) ต้อง map ก่อนส่งเข้า UI layer

### 5.3 Router contract

ไฟล์ HTML → `init<PageName>()` ใน app.js (เช่น `plant.html` → `initPlant()`) · navigation ผ่าน `navigate(page, paramsObj)` เขียน query string, อ่านกลับด้วย `URLSearchParams`

**Contract สำคัญ:** ทุก path ที่ navigate ไป `audit.html` ต้องมี key `scheduleId` (ว่างได้ถ้าไม่มีงานมอบหมาย แต่ต้อง include เสมอ) — ไม่งั้น `audit_headers.schedule_id` จะเป็น null และไม่นับ progress งานมอบหมาย (ดู §2 "ทุกทางเข้า audit.html")

---
*(รายละเอียดแต่ละงานย้อนหลังดูใน `work-logs/WORK_LOG_YYYY-MM-DD.md`)*
