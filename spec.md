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

---

## 3. Todo — backlog (update ทุกครั้งที่มีงานใหม่/เสร็จ)

- [ ] เปิด **Leaked Password Protection** ใน Supabase Auth (Dashboard-only, ทำผ่าน SQL/MCP ไม่ได้)
- [ ] เคลียร์รูปกำพร้าใน Storage bucket `audit-photos` (~48 ไฟล์, ~6MB จากการทดสอบ)
- [ ] (เสนอไว้ ยังไม่ยืนยัน) สร้าง UI ในแอปให้ admin แก้ผลตรวจย้อนหลังได้ — ตอนนี้ทำได้ผ่าน SQL Editor เท่านั้น (ดู §5 "unlock→edit→relock" pattern)
- [ ] (เสนอไว้ ยังไม่ยืนยัน) auto-save คำตอบระหว่างตรวจลง `localStorage` กันหลุด/เน็ตขาดกลางคัน
- [ ] `profiles` ตอนนี้ผู้ใช้ภายในอ่านได้ทั้งตาราง (รวม email/role) — ยังไม่จำกัดเป็น view
- [ ] `isStaff` client-side ยังเช็ค legacy role `'manager'` อยู่ — pre-existing, low-risk (DB-side `is_staff()` เป็น admin-only แล้ว), ตัดสินใจแล้วว่าไม่แก้ตอนนี้ (`/code-review` 2026-08-07)
- [ ] `TRANSLATIONS` ใน app.js มี key `en:` ซ้ำ 2 ครั้ง (บล็อกแรกตาย โดนบล็อกหลังทับ ไม่กระทบผู้ใช้) — เช็คก่อนแก้ i18n อย่าไปแก้บล็อกแรกคาดหวังผล

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

**cache-bust ปัจจุบัน:** `js/app.js`/`css/style.css` = `?v=51` ในทุก HTML · `sw.js` `CACHE_NAME` = `5s-audit-v5.16`

**เรื่องที่คุยจบแล้วไม่ต้องทำอะไรต่อ:** GitHub Actions annotation "job was not acquired by Runner of type hosted" (run #69, ~19m50s) — ยืนยันแล้วว่าเป็น GitHub-side runner allocation hiccup ชั่วคราว ไม่เกี่ยวกับโค้ด/workflow ของ repo, run ถัดๆมา (#70-76) ปกติดีหมด

**2026-08-08 (วันนี้):**
- เริ่ม session ด้วยการตั้งระบบ `spec.md` นี้ + เพิ่ม rule ใน CLAUDE.md ให้ update ทุกครั้งหลังทำงานเสร็จ
- แก้ข้อมูลจริง (ผู้ใช้รัน SQL เอง, verify แล้ว): `audit_round` ที่กรอกผิดเป็น `'Round 2'` ตอนมอบหมายงาน Office (CAF-OF/MTN-OF, สร้าง 2026-08-07) — แก้เป็น `'Round 1'` ทั้งหมด ทั้ง `schedules` (2 แถว) และ `audit_headers` (4 แถว, locked แล้ว) ระบบมีรอบตรวจเดียวจริง ไม่มีรอบอื่นหลงเหลือ (verify: `schedules`/`audit_headers` เหลือค่า `audit_round` เดียวคือ Round 1 ทั้งหมด — 16 และ 57 แถวตามลำดับ) — ไม่ต้องผ่าน unlock/relock เพราะ `trg_chk_locked` ผูกแค่ `audit_details` ไม่ครอบ `audit_headers`
- Dashboard "พื้นที่ต้องปรับปรุง": เพิ่มตัวกรองโรงงาน (`impPlant` dropdown) คู่กับตัวกรองพื้นที่เดิม — เลือกโรงงานแล้ว area dropdown จะ cascade กรองเหลือแค่พื้นที่ของโรงงานนั้น (`_impPlantFilter`/`_impPlantList`, `impFillPlantFilter()`, `impPlantChange()` ใน app.js; เพิ่ม `Plant_ID` ใน `getImprovementItems()`'s areaList; เพิ่ม dropdown ใน dashboard.html; i18n key `imp.all_plants` TH/EN) — cache-bust v50→v51, sw.js v5.15→v5.16

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
