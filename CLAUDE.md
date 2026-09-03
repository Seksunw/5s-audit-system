# CLAUDE.md — 5S Audit System

คู่มือประจำโปรเจกต์สำหรับ Claude Code — **อ่านไฟล์นี้ก่อนเริ่มงานทุกครั้ง**
เอกสารเชิงลึก: `docs/PROJECT_SUMMARY.md` · **save point ปัจจุบัน: `spec.md`**
ประวัติรายวันแบบเก่า: `work-logs/WORK_LOG_YYYY-MM-DD.md` (เลิกเขียนใหม่แล้วตั้งแต่ 9 ส.ค. 2026 — ไฟล์เก่าเก็บไว้เป็นประวัติ ไม่ต้องอัปเดต ดู `spec.md` § Current state แทน)

---

## เริ่ม session ใหม่ — ทำก่อนเสมอ

**`read spec.md`** — ไฟล์นี้เก็บ architecture, decisions ที่ทำไปแล้ว (พร้อมเหตุผล), backlog, current state (save point), และ data contract ระหว่าง component ทั้งหมด อ่านก่อนเริ่มงานทุกครั้งเพื่อรู้ว่าตอนนี้อยู่ตรงไหน ค้างอะไรอยู่

## After completing any task หรือ commit + push หรืออื่นๆ

1. Update `spec.md` — section "Current state" (ทำอะไรเสร็จ ค้างอะไร ต่อทำอะไรต่อ) และ "Done" ถ้ามีการตัดสินใจใหม่ (พร้อมเหตุผลว่าทำไมเลือกทางนี้)
2. Update section "Data contract" ใน `spec.md` ถ้ามีการเปลี่ยน interface ระหว่าง component (DB schema, mapping function, router contract, RPC/trigger ใหม่)
3. **ห้ามบอกว่า "เสร็จแล้ว" โดยไม่ได้ update `spec.md` ก่อน**

## ภาพรวม

ระบบตรวจประเมินมาตรฐาน **5ส** สำหรับโรงงาน — **Mobile-first PWA** สองภาษา (TH/EN)
- **Hosting:** GitHub Pages · repo `Seksunw/5s-audit-system` · branch `main`
- **Live:** https://seksunw.github.io/5s-audit-system/
- ความปลอดภัยคุมด้วย **Row Level Security (RLS)** + trigger ที่ระดับ DB (client bypass ไม่ได้)

## โครงไฟล์ที่ต้องรู้

- `js/app.js` — **โค้ด frontend ทั้งหมดอยู่ไฟล์เดียว** (~5,400+ บรรทัด, โตขึ้นเรื่อยๆ): I18n · Session · API(`_sb`) · AppState · UI · ทุกหน้า
- `*.html` (14 หน้า) — router ใน app.js อ่านชื่อไฟล์ → เรียก `init<Page>()`
- `supabase/` — `schema.sql` (โครงจริง, ไม่มี role `viewer`/ไม่มี table ล่าสุด เพราะเพิ่มทีหลังผ่าน patches.sql), `seed_master.sql` (plants/areas/criteria), `patches.sql` (แก้ DB สะสม, ไฟล์เดียวจริง), `storage_and_first_admin.sql` · ไฟล์ SQL อื่นที่เป็น utility เดี่ยวๆ ไม่ใช่ migration: `delete_user.sql` (ลบ user ผ่าน SQL Editor เท่านั้น เพราะ FK+revoke กันไว้ไม่ให้ลบผ่านแอป), `reset_test_data.sql` (⚠️ DANGER ล้างข้อมูลทดสอบ ใช้ครั้งเดียวตอนเปลี่ยนเข้าสู่ production), `RUN_2026-08-05*.sql` (snapshot ของ patches.sql ส่วน G/H ที่รันไปแล้ว — ประวัติ ไม่ต้องรันซ้ำ)
- `sw.js` — Service Worker (JS ดึงสดจาก network เสมอ)
- `docs/PROJECT_SUMMARY.md` — สถาปัตยกรรมละเอียด · `work-logs/` — ประวัติงานรายวัน (archive เก่า ไม่เขียนเพิ่มแล้ว)

## Dev / Deploy workflow

- ⚠️ **repo เป็น PUBLIC** — ทุกไฟล์ที่ push ขึ้นไปคนทั่วไปเห็นได้ (รวม worklogs, docs, โค้ด) · **ห้ามใส่ secret/ข้อมูลลับใด ๆ ในไฟล์ที่ track**
- ⚠️ **หลังแก้ CSS/JS ต้อง bump cache-bust `?v=NN` ในทุก HTML + เลข cache ใน `sw.js`** ไม่งั้น SW เสิร์ฟไฟล์เก่า (อาการ: การ์ด/พื้นที่หายชั่วคราวหลังอัปเดต) — เลขล่าสุดเช็คได้จาก `spec.md` § Current state (เลขนี้เปลี่ยนบ่อย ไม่ hardcode ไว้ที่นี่)
- **commit/push เมื่อผู้ใช้สั่งเท่านั้น** · commit message เป็นแนว conventional (`feat:`, `fix:`, `docs:`)
- ⚠️ **เลิกเขียน `work-logs/WORK_LOG_YYYY-MM-DD.md` ใหม่แล้ว (ตัดสินใจ 9 ส.ค. 2026)** — ซ้ำซ้อนกับ `spec.md` § Current state ที่ทำหน้าที่นี้อยู่แล้ว (สั้นกว่า อ่านเร็วกว่าตอนเริ่ม session ใหม่) ไฟล์ `work-logs/` เก่ายังเก็บไว้เป็นประวัติ ไม่ต้องลบ แต่**ห้ามสร้างไฟล์ใหม่ในโฟลเดอร์นี้อีก**

### Local dev / debug

- **ไม่มี dev/staging Supabase แยก** — `CONFIG.SUPABASE_URL` ใน `js/app.js` ชี้ไป project เดียวกับ production เสมอ (ref เดียวกับที่ `.mcp.json` ต่ออยู่) → ทดสอบ feature ใหม่ = กระทบข้อมูลจริงเสมอ ระวังเป็นพิเศษ
- เปิดไฟล์ตรงๆ ผ่าน `file://` พอสำหรับดูหน้าตา UI ทั่วไป แต่ **Service Worker register ไม่ได้ถ้าไม่ใช่ origin http(s)** — ถ้าต้องทดสอบพฤติกรรม PWA/offline cache ให้รันผ่าน static server (เช่น `python3 -m http.server`) แทน
- `console.log/.debug/.info` ถูกปิดอัตโนมัติทุกที่ ยกเว้น `localhost`/`127.0.0.1` — เปิดกลับมาดู log บนเว็บจริงได้ด้วย `localStorage.setItem('5s_debug','1')` แล้ว refresh (ปิดกลับด้วย `.removeItem('5s_debug')`)

## ไฟล์ที่ push ขึ้น GitHub / ไฟล์ที่ห้าม push

**push ขึ้น (public, ถูก deploy):** `*.html` ทุกหน้า · `js/app.js` · `css/style.css` · `sw.js` · `manifest.json` · `.nojekyll` · `supabase/*.sql` · `docs/PROJECT_SUMMARY.md` · `CLAUDE.md` · `spec.md` · `SUPABASE_MIGRATION_PLAN.md`

**ห้าม push — อยู่ใน `.gitignore` แล้ว (อย่าเผลอ `git add -f`):**

| pattern | เหตุผล |
|---------|--------|
| `docs/SECURITY_ASSESSMENT.md` · `*SECURITY_ASSESSMENT*` · `*PENTEST*` · `*.pentest.md` | 🔴 **repo public** — รายงานช่องโหว่ที่ยังไม่แก้ = แผนที่ให้ผู้โจมตี |
| `export/` · `*.zip` | build/design artifacts |
| `*.docx` · `Criteria_Master.csv` | เอกสาร/ข้อมูลต้นฉบับ (ไม่ต้อง deploy) |
| `export_to_obsidian.py` · `sync_commits.py` | เครื่องมือ local |
| `.obsidian/` · `.DS_Store` | editor/OS junk |
| `work-logs/` | เลิกเขียนใหม่แล้ว (9 ส.ค. 2026) — untrack ออกจาก GitHub แล้ว แต่ยังเก็บไว้ในเครื่อง local เป็นประวัติส่วนตัว |

> กติกา: เพิ่มไฟล์ประเภทลับ/ต้นฉบับ/artifact ใหม่ → ต่อ pattern ใน `.gitignore` ก่อน commit เสมอ · **secret จริงเคยรั่วแล้ว git history ต้อง rewrite มาแล้ว (2026-08-03)** อย่าให้เกิดซ้ำ

## กติกาการเขียนโค้ด (สำคัญ — ห้ามพลาด)

1. **กัน XSS เสมอ:** ทุกค่าที่มาจากผู้ใช้/DB ก่อนใส่ลง DOM ต้องผ่าน `escHtml()` / `escAttr()` และ URL รูปผ่าน `safeUrl()` / `safeImg()` (อนุญาตเฉพาะ http/https)
2. **คะแนนเฉลี่ยเป็นแบบ "เฉลี่ยรายคน" (mean of percent)** ไม่ใช่ pooled (Σscore/Σmax) — ทุกผลตรวจน้ำหนักเท่ากัน · **ห้ามเปลี่ยนกลับ** (ดูคอมเมนต์ "ส่วน H" ใน `getDashboard`)
3. **ไม่คำนวณคะแนน/สถานะที่ client** — trigger `recalc_audit_header` คำนวณให้ที่ DB ทุกครั้งที่ `audit_details` เปลี่ยน (`finalizeAudit` แค่ "อ่านผลกลับ")
4. **ทุกหน้า HTML มี CSP `<meta>`** ระบุ domain Supabase — ถ้าเพิ่ม CDN/domain ใหม่ต้องอัปเดต CSP ให้ครบทุกหน้า ไม่งั้นถูกบล็อก
5. **i18n:** UI ใช้ `data-i18n` (text) / `data-i18n-ph` (placeholder) / `data-i18n-title` (title tooltip) / `data-i18n-aria` (aria-label) / `data-i18n-html` (มี HTML tag ในข้อความ เช่น `<b>`) + `I18n.t(key)` · ภาษาปัจจุบัน = `I18n.getLang()` ('th'/'en') · ข้อความที่ JS render ทีหลังต้องแปลเอง (`I18n.apply()` ครั้งเดียวไม่ครอบ) · **ทุก key ต้องมีทั้ง `th`/`en` เสมอ** (เช็ค parity ด้วย `grep`/`comm` ก่อน commit ถ้าเพิ่ม key เยอะ — เจอ key ชื่อซ้ำของเดิมโดยไม่รู้ตัวมาแล้ว 2026-08-09 ตอนเติม i18n ทีละหลายสิบ key)
6. **map snake_case (DB) ↔ PascalCase (UI):** ใช้ `mapPlant/mapArea/mapProfile/mapHeader/mapCriteria` — อย่าปน field ดิบกับที่ map แล้ว
7. คอมเมนต์ภาษาไทยได้ (ตามสไตล์ repo เดิม)

## Supabase / Database

- **Roles (นโยบาย 5 ส.ค. 2026 — ใช้จริง 3 ตัว):** `admin` (จัดการทุกอย่าง แก้/ลบผลตรวจได้ตลอด) · `auditor` (ตรวจ + ดู Dashboard ทั้งบริษัท แต่ประวัติเห็นเฉพาะของตัวเอง · แก้ผลตัวเองไม่ได้หลัง submit) · `viewer` (ดูได้ทุกอย่างรวมประวัติทุกคน แต่ตรวจ/อัปโหลด/แก้ไม่ได้) · `manager`+`area_manager` **เลิกใช้** (ซ่อนจาก dropdown · Postgres ลบค่า enum ไม่ได้ → คนที่ยังเป็น role เก่าได้สิทธิ์เท่า auditor · `is_staff()` = admin-only แล้ว)
- **ล็อกผลตรวจ:** หลัง finalize `audit_headers.locked_at` ถูกตั้งผ่าน RPC `lock_audit` (security definer) · `headers_update` policy = admin เท่านั้น · auditor แก้/ลบ/ปลอมคะแนน header ตัวเองไม่ได้ (patches.sql ส่วน G2+G5) · trigger `trg_chk_locked` กันแก้ audit_details ที่ล็อกแล้ว
- **เกณฑ์ผ่าน:** ≥90 excellent · ≥75 good · <75 need_improvement
- **RLS:** ผู้ล็อกอินทุกคน "อ่าน" ภาพรวมทั้งบริษัทได้ (plants/areas/criteria/profiles/audit_*) · "เขียน" จำกัดเจ้าของ/admin — ระวังตอน query ว่า auditor เห็นได้แค่ไหน
- **SQL rule:** แก้ DB เพิ่ม → **ต่อท้าย `patches.sql` ไฟล์เดียว เขียนให้ idempotent (รันซ้ำได้)** · **อย่ารัน `schema.sql` บน DB ที่ใช้อยู่** (มันสำหรับ DB ใหม่เปล่าเท่านั้น)
- `CONFIG.SUPABASE_KEY` เป็น anon/publishable key — public โดยตั้งใจ (RLS คุม) · **แต่ห้าม commit secret จริง** (service key, password, token) — git history เคยถูก rewrite เพื่อลบ credential ที่รั่วมาแล้ว (2026-08-03)

## Gotchas / Known issues

- `TRANSLATIONS` ใน app.js **มี key `en:` ซ้ำ 2 ครั้งจริง** (บล็อกแรกตาย โดนบล็อกหลังทับ — บล็อกหลังมี key ครบกว่าอยู่แล้วเลยไม่กระทบผู้ใช้ตอนนี้ แต่ห้ามไปแก้บล็อกแรกคาดว่าจะมีผล) — เช็คก่อนแก้ i18n
- `profiles` ตอนนี้ผู้ใช้ภายในอ่านได้ทั้งตาราง (รวม email/role) — ยังไม่จำกัดเป็น view
- **ก่อน production:** เอา Quick Login / บัญชีทดสอบใน `index.html` ออก (เช็คแล้วไม่มีแล้ว) · Leaked Password Protection ยังปิดอยู่ (เปิดเองใน Supabase Dashboard) · มีรูปกำพร้าใน Storage จากการทดสอบ ~48 ไฟล์ ยังไม่เคลียร์
- ⚠️ **`patches.sql` ไม่ใช่แหล่งความจริงของ DB จริงเสมอไป** — เจอเคส `admin_reset_data()` ที่ไฟล์เขียนถูกแล้ว (คอมเมนต์บอก "แก้แล้ว") แต่เวอร์ชันจริงบน Supabase ยังเป็นโค้ดเก่าค้างอยู่ (deployment gap, 2026-08-07) ถ้าฟังก์ชันไหนมีคอมเมนต์ "แก้แล้ว" แต่พฤติกรรมยังผิด ให้เช็ค `pg_get_functiondef` เทียบไฟล์ก่อนสงสัยที่อื่น
- ⚠️ **ทุกทางที่นำไปสู่หน้า `audit.html` ต้องส่ง `scheduleId` ต่อด้วยเสมอถ้าพื้นที่นั้นมีงานมอบหมายอยู่** — เจอบั๊กจริง (2026-08-07): `selectArea()` (ทางเข้าปกติ Plant→Area) ไม่เคยส่ง `scheduleId` ทั้งที่การ์ดโชว์ badge รอบตรวจอยู่แล้ว ต่างจาก `startAssignedAudit()` (จากหน้า "งานที่ได้รับมอบหมาย") ที่ส่งถูก ผลคือผลตรวจถูกต้องแต่ `audit_headers.schedule_id = null` ไม่นับเข้า progress งานมอบหมาย ถ้าเพิ่มทางเข้าหน้าตรวจใหม่ ต้องเช็คจุดนี้ด้วยทุกครั้ง
- `FACILITY_PLANT_IDS = ['CAF','MTN']` ใน app.js — 2 plant นี้ไม่เหมือน plant อื่น (SUP/POC/NIF): area หลักของมันคือ cafeteria/maintenance เอง (ไม่ใช่ production/warehouse) `getAreas()` เลยยกเว้นไม่ซ่อน area type พวกนี้ให้ 2 plant นี้โดยเฉพาะ — เพิ่ม plant ลักษณะนี้ในอนาคตต้องอัปเดต constant นี้ด้วย
- ⚠️ **`areas.plant_id` กับ `audit_headers.plant_id` ไม่จำเป็นต้องตรงกันเสมอไป** — ระบบไม่มีแนวคิด "ทีมที่รับผิดชอบตรวจ" แยกจาก "โรงงานเจ้าของพื้นที่" ทางกายภาพ ตอนนี้ (2026-08-08) พื้นที่ "รอบอาคาร" ของ NIF/POC/SUP (`NIF-OD`/`POC-OD`/`SUP-OD`) ยังผูก `areas.plant_id` เป็นโรงงานเดิม แต่ `audit_headers.plant_id` ของผลตรวจ Round 1 ถูกแก้มือเป็น `CAF` (P&C) แล้วเพราะเป็นพื้นที่รับผิดชอบของทีม P&C จริง — จงใจให้ไม่ตรงกันชั่วคราว (Dashboard: Plant Ranking อ่านจาก `audit_headers.plant_id` → นับเข้า P&C ถูก, แต่ Area Ranking/`getAreas()` อ่านจาก `areas.plant_id` → ยังโชว์ว่าเป็นของ NIF/POC/SUP) ถ้าจะปรับให้ตรงกันถาวรต้องแก้ `areas.plant_id` + rename `area_name` กันชื่อ "รอบอาคาร" ชนกัน 3 พื้นที่ + backfill `schedules.plant_id` ด้วย — ยังไม่ทำ รอทำตอนรอบตรวจถัดไป

---

## ต่อ Supabase MCP กับ Claude Code

ต่อแล้ว (read-only, project ref `oibjnkngraulcccdqevm`, config อยู่ที่ `.mcp.json`) — วิธีตั้งค่าใหม่/ย้ายเครื่อง/แก้ปัญหาต่อไม่ติด ดูที่ skill `setup-supabase-mcp`
