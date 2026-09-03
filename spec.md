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
- [x] **สำเนา (snapshot) repo ไว้ใต้ GitHub org — เสร็จแล้ว** (2026-08-13) — เปลี่ยนแผนจาก "ย้าย org" เป็นแค่ทำสำเนาไว้เฉยๆ ไม่ใช่การย้ายจริง: สร้าง repo เปล่า (private, ไม่มี README/.gitignore/license) ที่ `github.com/NBD-Health-Care-Company-Limited/5s-audit-system` แล้ว `git push` ประวัติ commit ทั้งหมดของ `main` ไปให้ (เพิ่ม git remote ชื่อ `org` ในเครื่อง คู่กับ `origin` เดิม) verify ตรงกันที่ commit `5a3a790` — **เป็น one-time snapshot เท่านั้น ไม่ sync ต่อเนื่อง**
- [ ] **ย้ายหน้าเว็บไป custom domain ของบริษัท** (ยังไม่ทำ, แยกจากเรื่อง org แล้ว) — ผู้ใช้มีแพลนย้าย hosting จาก `seksunw.github.io/5s-audit-system` ไป domain ของบริษัทเอง — ยังไม่รู้ว่ามี domain/สิทธิ์แก้ DNS พร้อมหรือยัง (ไม่เกี่ยวกับ org repo ด้านบนแล้ว เพราะ org เป็นแค่สำเนา ไม่ใช่ตัวที่ deploy จริง)
- [x] **ย้ายอีเมลผู้ใช้งานทุกคนในระบบ (15/15) → domain `suntorywellness.co.th` — เสร็จสมบูรณ์แล้ว (2026-09-03)** — **domain ยืนยันแล้ว** คือ `suntorywellness.co.th` (tenant จริงคือ Suntory Wellness ไม่ใช่ `nbd.co.th`/NBD ที่คาดไว้ก่อนหน้า) ขอบเขตขยายจาก "แค่คุณเสกสรรค์" เป็น**ทั้งบริษัท 15 คนรวม viewer ภายนอก** (คุณ Yukihiro ย้ายจาก `@suntory.co.jp` เข้า `@suntorywellness.co.th` ด้วย เพราะ tenant เดียวกันอยู่แล้ว) mapping เต็มอยู่ในแชท 2026-09-03
  - **บัญชีผู้พัฒนา (คุณเสกสรรค์) — GitHub + Supabase Dashboard account:** ✅ เปลี่ยนแล้ว (ผู้ใช้ทำเอง) · verify แล้วว่า push/pull + MCP ยังทำงานปกติ · `git config user.email` เครื่องนี้อัปเดตแล้วทั้ง global/local scope (เจอ local override ทับ global อยู่ก่อน แก้ครบทั้งคู่) · **Claude account — ยังไม่ทราบว่าทำหรือยัง** (นอกขอบเขตที่ทำแทนได้)
  - **`profiles.email` (ทั้ง 15 คน)** — ✅ เสร็จ: รัน `UPDATE ... FROM (VALUES...)` ผ่าน SQL Editor เอง (MCP read-only แก้ไม่ได้) verify ผ่าน MCP ครบ 15/15
  - **`auth.users.email` (login จริง, ทั้ง 15 คน)** — ✅ เสร็จ: **Supabase Dashboard เวอร์ชันปัจจุบันไม่มีปุ่มแก้อีเมลตรงๆ ใน UI แล้ว** (เช็คแล้วทั้ง row-click panel และ Raw JSON tab เป็นแค่ read-only) → แก้ทางเลี่ยงด้วย **Admin API ผ่านสคริปต์ Node.js** (`update_auth_emails.mjs`, ใช้ built-in `fetch` ยิง `PUT {url}/auth/v1/admin/users/{id}` ด้วย service role key, ไม่ commit ไฟล์นี้/ไม่ hardcode key) — ผู้ใช้รันเองสำเร็จครบ ยืนยันด้วยการ join `profiles`↔`auth.users` ผ่าน MCP: **`match = true` ครบ 15/15 แถว, UUID เดิมไม่เปลี่ยนเลยสักคน** (ไม่กระทบ FK ของ audit_headers/schedules/audit_logs)
  - **⚠️ ทางที่ปฏิเสธไปเพราะอันตรายเกิน:** เคยเสนอ "ลบ user เก่าแล้วสร้างใหม่" แทนการแก้อีเมล — **ห้ามเด็ดขาด** เพราะ `audit_headers.auditor_id`/`audit_logs.user_id` อ้าง `profiles.id` แบบไม่มี `ON DELETE CASCADE` (Postgres จะ block การลบทันทีถ้ามีประวัติผูกอยู่ — ทุกคนใน 15 คนนี้มีประวัติจริงหมด) ต่อให้ฝืนลบได้ก็จะทำให้ audit trail เก่าไม่มีเจ้าของ — ตรงกับเหตุผลที่โค้ด `setUserStatus()` ใช้ suspend แทน delete มาแต่ต้น

**⚠️ กติกาสำคัญเรื่อง git remote `org` (ยืนยันกับผู้ใช้ 2026-08-13):**
- **`origin` (`Seksunw/5s-audit-system`) คือที่ deploy จริงและเป็นเป้าหมายเดียวของคำสั่ง "commit + push" ตามปกติเสมอ** — ไม่เปลี่ยน ไม่กระทบจากการมี remote `org`
- **ห้าม push ไปที่ remote `org` โดยอัตโนมัติเด็ดขาด** แม้ตอน commit+push ปกติไป `origin` — การอัปเดตสำเนาที่ `org` ต้องเป็นคำสั่งแยกต่างหากที่ผู้ใช้พิมพ์ชัดเจนเท่านั้น (เช่น "push ไป org ด้วย") ไม่ใช่ default behavior

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

**2026-08-10:**
- **เช็ค `supabase/*.sql` เทียบ DB จริงผ่าน MCP** — เทียบ `pg_get_functiondef` ของฟังก์ชันทั้ง 8 ตัว (`recalc_audit_header`, `chk_header_locked`, `chk_header_schedule`, `sync_schedule_status`, `lock_audit`, `is_staff`, `log_activity`, `admin_reset_data`) กับ `patches.sql` ตรงกันคำต่อคำทุกตัว รวมถึง `admin_reset_data()` ที่เคยเจอ deployment gap จริง (บั๊ก enum cast, 2026-08-07) — **ตอนนี้ตรงกันแล้ว ไม่มีอะไรค้าง** เช็ค RLS policy `headers_update` ก็ตรงกับเวอร์ชัน admin-only ล่าสุด (§G5) ไม่ได้ค้างเวอร์ชันเก่า · เช็ค `pg_proc` ทั้งหมดใน schema `public` (10 ฟังก์ชัน) ไม่มีตัวแปลกปลอมที่ไม่มีในไฟล์
- **แก้คะแนนย้อนหลังรวม 8 รายการ** (ผู้ใช้ review remark/รูปแนบเทียบสภาพจริงแล้วสั่งแก้เองทีละรายการ) — ทุกรายการทำผ่าน pattern **unlock→edit→relock** ตาม §5 (MCP ต่อแบบ read-only แก้ไม่ได้ ต้องให้ผู้ใช้รัน SQL เองใน SQL Editor ทุกครั้ง) คืนค่า `locked_at` เป็นเวลาล็อกเดิมเป๊ะหลังแก้เสร็จทุกรายการ (ไม่ทับเป็นเวลาปัจจุบัน กันประวัติ finalize เพี้ยน) · `trg_recalc_audit` คำนวณ header ใหม่ให้อัตโนมัติทุกครั้ง verify ผ่าน MCP แล้วทั้งหมด:
  1. Production Line F3 (NIF) R1 — คุณกนัฐยา รัดนะ, `C-23-1` (พัดลม/แอร์มีฝุ่นเกาะ) 0→1 → 136/146 (93.15%) → 137/146 (93.84%)
  2. Production Line F3 (NIF) R1 — คุณอัญชลี เสือร้าย, `C-23-1` 0→1 → 134/146 (91.78%) → 135/146 (92.47%)
  3. Production Line F1 (SUP) R1 — คุณกนัฐยา รัดนะ, `C-23-1` 2→1 → 137/140 (97.86%) → 136/140 (97.14%)
  4. Production Line F3 (NIF) R1 — คุณอัญชลี เสือร้าย, `C-03-2` (อุปกรณ์ดับเพลิง ป้ายบ่งชี้/วิธีใช้) 1→2 + เคลียร์ remark เดิม ("ไม่มีวิธีใช้งานถังดับเพลิง" ขัดกับคะแนนเต็ม) → 135/146 (92.47%) → 136/146 (93.15%)
  5–8. Warehouse F3 (NIF) R1 — คุณดิรทยา เสือป่า / คุณประเสริฐ ทิมจร / คุณรัชณี จิตรสุนทร / คุณศิริลักษณ์ ศรีสำราญ (ทั้ง 4 คนที่ตรวจพื้นที่นี้), `C-32-2` (จุดจอดรถเข็น/แฮนด์ลิฟท์ ระบุใน Layout) 2→1 → 97/98 (98.98%) → 95/98 (96.94%) เท่ากันทุกคน (max_score พื้นที่นี้เท่ากันทั้ง 4 audit)

  ทุกรายการยัง status **excellent** เหมือนเดิม ไม่มี audit ไหนเปลี่ยน tier · เช็คผลกระทบ Plant Ranking แล้วบางส่วน: NIF Round 1 เฉลี่ยรายคน (mean of percent) 96.3% → 96.4% (+0.1pp, จากรายการ 1/2/4 ที่อยู่ใน audit เดียวกันของ Production Line F3) — **ยังไม่เช็ค** ผลกระทบต่อ SUP ranking (รายการ 3) และผลกระทบเพิ่มเติมต่อ NIF ranking จาก Warehouse F3 (รายการ 5–8)
- **เอาคุณชัญธิกา อ่อนน้อมออกจากทีมตรวจ "รอบอาคาร" ที่ค้าง 3 พื้นที่** (SUP/POC/NIF, Round 1, 2026-08-07) — ผู้ใช้สั่งเพราะคนนี้ตรวจพื้นที่อื่นครบแล้ว (4 พื้นที่: CAF/Office, MTN/Office, MTN/ช่าง, CAF/โรงอาหาร ล็อกครบทุกอัน) แต่ไม่มี audit record ของ 3 พื้นที่ "รอบอาคาร" นี้เลย (เช็คแล้วไม่ใช่บั๊ก scheduleId เดิม — ไม่ได้ตรวจจริง) เดิม required 4/done 3 ค้างเพราะรอเธอคนเดียว — แก้โดย `UPDATE schedules SET auditor_ids = array_remove(auditor_ids, <her uuid>)` ทั้ง 3 แถว (ไม่ต้อง unlock/relock เพราะ `trg_chk_locked` ผูกแค่ `audit_details` ไม่ครอบ `schedules`) · ยืนยันแล้วว่าทุกหน้าที่โชว์สถานะงาน (My Tasks/Home hero/Schedule Board/Assignment Analytics) **อ่านจาก view `schedule_progress` สดๆ ไม่ได้อ่านคอลัมน์ `schedules.status`** → พอ required ลดเป็น 3 = done ที่มีอยู่แล้ว `is_completed` พลิกเป็น true ทันทีไม่ต้องแก้อะไรเพิ่ม · sync คอลัมน์ `schedules.status` เป็น `completed` ให้ด้วยเพื่อความสะอาดของข้อมูล (ตาม precedent 2026-08-08 — คอลัมน์นี้ไม่มีจุดไหนในแอปอ่านแล้วจริงๆ แต่เก็บให้ตรงกับ view ไว้กันสับสนตอนดู DB ตรงๆ) · verify ผ่าน MCP แล้วทั้ง 3 พื้นที่: required_n=3, done_n=3, is_completed=true

**2026-09-03: เริ่มวิจัยแผนย้าย backend จาก Supabase → Microsoft (ข้อกำหนดบริษัท)**
- **บริบท:** บริษัท (tenant จริงคือ **Suntory Wellness** — ไม่ใช่ NBD อย่างที่เข้าใจก่อนหน้า) กำหนดให้รวมระบบไว้บน Microsoft 365/Dynamics 365 — ไม่มีทางเลือกว่าจะย้ายหรือไม่ มีแค่ทางเลือกว่าจะย้ายไปเครื่องมือไหนใน M365
- **เปรียบเทียบ 4 ทางเลือกแล้ว** สรุปผล:
  - **SharePoint Lists** — ไม่แนะนำ เพราะไม่มี trigger จริง (พึ่ง Power Automate ที่ async/ไม่ atomic) กระทบกฎหลักของระบบที่ "ห้ามคำนวณคะแนนที่ client" และมีปัญหา scale ที่ ~5,000 แถว/list
  - **Dataverse (Power Platform)** — **ตัวเลือกที่แนะนำและผู้ใช้ยืนยันเลือกแล้ว** ใกล้เคียง Supabase ที่สุด (Security Roles ≈ RLS, Plugin C#/.NET ≈ trigger จริง atomic) แลกกับต้องมี license เพิ่ม (แนะนำ per-app plan ประหยัดกว่า per-user) และต้องมีคนเขียน C#/.NET
  - **Azure SQL** — ใกล้เคียง Postgres ทางเทคนิคที่สุด (มี native RLS + T-SQL trigger ตรงๆ) แต่ **เป็นผลิตภัณฑ์ Azure ไม่ใช่ M365/D365** ต้องเช็คก่อนว่าเข้าเงื่อนไขนโยบายบริษัทไหม (ยังไม่ได้เช็ค) + เสีย "no backend server" architecture เดิม (ต้องมี API layer คั่น)
  - **Microsoft Fabric** — **ตัดออก** ไม่เหมาะเลย เป็นแพลตฟอร์ม analytics/OLAP ไม่ใช่ transactional DB สำหรับแอปที่มีคน submit ข้อมูลสดๆ — อาจมีประโยชน์เป็นแค่ layer รายงานเสริมทีหลัง (ผ่าน "Link to Fabric" จาก Dataverse) ไม่ใช่ backend หลัก
- **สร้างไฟล์ `DATAVERSE_MIGRATION_PLAN.md`** (ยึดโครงจาก `SUPABASE_MIGRATION_PLAN.md` เดิม) มีเนื้อหา: concept mapping ครบ (table/RLS/trigger/RPC/Auth/Storage), ร่าง Dataverse table schema เต็ม 8 ตาราง (จุดออกแบบใหม่: `photo_urls[]`→child table `AuditPhoto`, `auditor_ids[]`→ใช้ N:N relationship ในตัวของ Dataverse แทน array), ร่าง Security Role 3 บทบาท, ร่างรายการ Plugin/Custom API 6 ตัวที่ต้องเขียนเทียบ trigger/RPC เดิม, ขั้นตอน data migration ละเอียด (ลำดับ FK, ID remapping, จุดที่ locked record ชนกับ `CheckHeaderLockedPlugin` แก้ด้วย pattern เดียวกับ unlock→edit→relock ที่ใช้แก้คะแนนย้อนหลังมาตลอด, ต้องปิด `RecalcAuditHeaderPlugin` ชั่วคราวตอน bulk insert, ย้ายรูปจริงไม่ใช่แค่ URL)
- **สถานะสิทธิ์ตอนนี้ (เช็คจริงแล้ว):** ผู้ใช้ login เข้า Power Platform admin center ของ tenant Suntory Wellness ได้ แต่**ไม่มีสิทธิ์พอดูหน้า Dataverse/Licensing** (ต้องเป็น tenant/Power Platform/Dynamics 365/environment administrator) — ยังไม่ยืนยันว่ามี Dataverse license premium อยู่แล้วหรือไม่ **ขั้นต่อไปที่แนะนำแล้ว:** ลองกด Power Apps → Create ดูว่า offer สร้าง environment แบบ full Dataverse ได้ไหม หรือมีแค่ "Dataverse for Teams" (tier จำกัด ใช้กับแอปนี้ไม่ได้)
- **ร่างอีเมลให้แล้ว 3 ฉบับ** (ยังไม่ได้ส่งจริง รอผู้ใช้ปรับ/ส่งเอง): (1) เหตุผลเลือก Dataverse เทียบ SharePoint (ไทย), (2) ขอสิทธิ์ license/dev resource (อังกฤษ), (3) รวมเปรียบเทียบ 3 ทาง Supabase/SharePoint/Dataverse+เหตุผลที่ Supabase ดีสำหรับ dev + ขอสิทธิ์แบบเจาะจง scope (Environment Maker + System Customizer/Administrator **เฉพาะ environment เดียว** ไม่ใช่ tenant-level) — ทั้งหมดอยู่ในเนื้อหาแชท ยังไม่ได้ save เป็นไฟล์แยก
- **เช็คความอ่อนไหวของข้อมูลก่อน migrate:** พบว่า `profiles` table ตอนนี้ auditor ทุกคนอ่านได้ทั้งตาราง (อีเมล/role ของทุกคนรวม viewer ภายนอก) — ควรใช้โอกาส migrate นี้แก้ security role ให้จำกัดกว่าเดิม ไม่ใช่ port ช่องโหว่เดิมไปตรงๆ · ตัวแนวคิด/สถาปัตยกรรมแอปเองไม่มีอะไรเป็นความลับ ปลอดภัยที่จะอธิบายให้ contractor ภายนอกฟังได้เต็มที่
- **ยังไม่ตัดสินใจ/รอคำตอบ:** license พร้อมหรือยัง (กำลังลองเช็ค), มีคนเขียน C#/.NET ได้ไหม, Azure SQL เข้าเงื่อนไขนโยบายบริษัทไหม, deadline, cutover ทีเดียวหรือคู่ขนาน — **ยังไม่ได้เริ่มลงมือสร้างอะไรจริงในระบบ ทั้งหมดยังเป็นขั้นวางแผน/ขอสิทธิ์**

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
