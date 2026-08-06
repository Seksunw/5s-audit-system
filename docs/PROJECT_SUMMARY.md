# PROJECT_SUMMARY.md — ระบบตรวจ 5ส โรงงาน (5S Audit System)

> **อ้างอิงหลักสำหรับการพัฒนา** — อัปเดต: 2026-08-06 (3 roles · ล็อกผลตรวจ · ผู้ตรวจหลายคนต่อพื้นที่)
> ในการวิเคราะห์ครั้งต่อไป ให้อ่านไฟล์นี้ก่อนเสมอ แล้วอ่าน source code เฉพาะส่วนที่เปลี่ยน
> ประวัติการพัฒนารายวันดูที่ `work-logs/WORK_LOG_YYYY-MM-DD.md` (ล่าสุด 2026-08-06 มี 7 ส่วน)

---

## 1. Project Overview

### วัตถุประสงค์
ระบบตรวจสอบมาตรฐาน 5ส (สะสาง สะดวก สะอาด สุขลักษณะ สร้างนิสัย) สำหรับโรงงานอุตสาหกรรม
เป็น **Mobile-First PWA** ทำงานได้ Offline (บางส่วน) รองรับ 2 ภาษา (TH/EN) มอบหมายงานตรวจ
ตามรอบ/พื้นที่ บันทึกคะแนน+รูปถ่าย และดู Dashboard/ประวัติ/รายงานภาพรวมทั้งบริษัท

### สถาปัตยกรรม (ปัจจุบัน — ย้ายมา Supabase ตั้งแต่ 2026-07-30)
Frontend เป็น static PWA บน **GitHub Pages** เรียก **Supabase** โดยตรงผ่าน `supabase-js`
(ไม่มี backend server ตรงกลางอีกต่อไป) ความปลอดภัยคุมด้วย **Row Level Security (RLS)**
และ **trigger** ที่ระดับฐานข้อมูล การคำนวณคะแนน/สถานะ และ audit log ทำที่ DB (ไคลเอนต์ bypass ไม่ได้)

```
┌──────────────────────────────────────────────────────────┐
│  USER DEVICE (Mobile/Desktop) — PWA บน GitHub Pages       │
│                                                          │
│  index / home / mytasks / plant / area / audit / summary │
│  history / dashboard / schedule / assign / users / logs  │
│  criteria                                                │
│                                                          │
│  js/app.js  → I18n · Session · API(_sb) · AppState · UI  │
│  sw.js      → Service Worker (cache v4.6, JS fresh net)  │
└───────────────────────────┬──────────────────────────────┘
                            │  supabase-js (HTTPS + JWT)
                ┌───────────▼────────────┐
                │        SUPABASE         │
                │  ┌───────────────────┐  │
                │  │ Auth (JWT/bcrypt) │  │
                │  ├───────────────────┤  │
                │  │ PostgreSQL        │  │
                │  │  8 tables + RLS   │  │
                │  │  triggers + RPC   │  │
                │  ├───────────────────┤  │
                │  │ Storage           │  │
                │  │  bucket: audit-   │  │
                │  │  photos (public)  │  │
                │  └───────────────────┘  │
                └─────────────────────────┘
```

### Technologies
| Layer | Technology (ปัจจุบัน) | เดิม (ก่อน 2026-07-30) |
|-------|-----------|-----------|
| Frontend | Vanilla JS (ES6+), HTML5, CSS3, Bootstrap Icons | (เหมือนเดิม) |
| PWA | Service Worker, Web App Manifest | (เหมือนเดิม) |
| Backend | **Supabase** — PostgREST auto API ผ่าน `supabase-js` ใน `app.js` | Google Apps Script Web App |
| Database | **Supabase PostgreSQL** — 8 ตาราง + RLS + trigger + RPC | Google Sheets (9 sheets) |
| Auth | **Supabase Auth** (JWT + auto refresh) | SHA-256 + UUID session token |
| Photo Storage | **Supabase Storage** (bucket `audit-photos`, public read) | imgBB / Google Drive |
| Hosting | GitHub Pages (`Seksunw/5s-audit-system`) | GitHub Pages (`seksunw58-ai/...`) |
| i18n | Built-in TH/EN | (เหมือนเดิม) |
| Live URL | https://seksunw.github.io/5s-audit-system/ | — |

---

## 2. Folder Structure

```
5s-audit-system/
├── docs/
│   └── PROJECT_SUMMARY.md          ← ไฟล์นี้ (อ้างอิงหลัก)
├── work-logs/                      ← บันทึกงานรายวัน (07-08, 07-30, 07-31, 08-01)
├── supabase/                       ← SQL ทั้งหมดของ backend
│   ├── schema.sql                  ← โครงสร้างตัวจริง (รันเฉพาะ DB ใหม่เปล่า)
│   ├── seed_master.sql             ← ข้อมูลตั้งต้น (plants, areas, criteria)
│   ├── patches.sql                 ← การแก้ DB สะสม (ไฟล์เดียว, idempotent, รันบน DB ที่ใช้อยู่)
│   └── storage_and_first_admin.sql ← storage bucket + admin คนแรก
├── css/style.css                   ← Global stylesheet (CSS variables, components)
├── js/app.js                       ← Frontend JS ทั้งหมด (~3,900 บรรทัด)
├── index.html                      ← Login
├── home.html                       ← Home (hero card + สรุป)
├── mytasks.html                    ← งานที่ได้รับมอบหมาย
├── plant.html / area.html          ← เลือกโรงงาน / พื้นที่
├── audit.html / summary.html       ← ทำ checklist / ผลการตรวจ
├── history.html / dashboard.html   ← ประวัติ / analytics
├── schedule.html / assign.html     ← มอบหมายงาน (admin) / ตารางตรวจ (analytics)
├── users.html / logs.html          ← จัดการผู้ใช้ / บันทึกกิจกรรม (admin)
├── criteria.html                   ← จัดการเกณฑ์ตรวจ
├── manifest.json                   ← PWA Manifest
├── sw.js                           ← Service Worker (cache v4.6)
└── SUPABASE_MIGRATION_PLAN.md      ← แผน/บันทึกการย้ายจาก GAS
```

> `.gitignore` ตัดไฟล์ส่วนตัวออก: `.obsidian/`, `export/`, scripts, `.docx`, `.csv` ต้นฉบับ

---

## 3. HTML Pages & Roles

| หน้า | URL | หน้าที่ | Role |
|------|-----|---------|------|
| Login | index.html | เข้าสู่ระบบ + เลือกภาษา | ทุกคน |
| Home | home.html | Hero card: ทักทาย + รอบ/ครบกำหนด + งานค้าง + ปุ่มเริ่มตรวจ + KPI ทั้งบริษัท | ทุกคน |
| My Tasks | mytasks.html | งานที่ได้รับมอบหมายของตัวเอง (เริ่มตรวจ / ดูผล) | ทุกคน |
| Plant | plant.html | เลือกโรงงาน + การ์ดพื้นที่ส่วนกลาง (โรงอาหาร/ช่าง) | ทุกคน |
| Area | area.html | เลือกพื้นที่ตรวจ (กรองตาม role/assignment) | ทุกคน |
| Audit | audit.html | ทำ checklist + คะแนน 0/1/2 + N/A + remark + รูป | ทุกคน |
| Summary | summary.html | ผลการตรวจของ audit นั้น (percent, badge, score circle) | ทุกคน |
| History | history.html | ประวัติการตรวจ (ตัด pending), filter ได้ | ทุกคน |
| Dashboard | dashboard.html | Analytics, trends, rankings (ทั้งบริษัท) | ทุกคน |
| Schedule | schedule.html | มอบหมายงานตรวจ (bulk, ตามพื้นที่/ตามคน) | Admin |
| Assign | assign.html | ตารางตรวจ — ภาพรวมการมอบหมาย + คะแนนเฉลี่ยต่อผู้ตรวจ | Admin เห็นทุกคน / Auditor เห็นตัวเอง |
| Users | users.html | จัดการผู้ใช้ (CRUD) + เขตอันตราย (reset data) | Admin |
| Logs | logs.html | บันทึกกิจกรรมทั้งระบบ (ค่าเดิม→ใหม่) | Admin |
| Criteria | criteria.html | จัดการเกณฑ์ตรวจ | Admin |

**Router:** `app.js` อ่านชื่อไฟล์จาก path แล้ว switch ไป `init<Page>()` (เช่น `mytasks` → `initMyTasks()`)

---

## 4. `js/app.js` — Frontend (~3,900 บรรทัด, รวม logic ทั้งหมดไว้ที่เดียว)

### Config (ต้นไฟล์)
```javascript
CONFIG.SUPABASE_URL  = 'https://oibjnkngraulcccdqevm.supabase.co'
CONFIG.SUPABASE_KEY  = '<publishable/anon key>'   // public โดยตั้งใจ — คุมด้วย RLS
CONFIG.VERSION       = '2.0.0'
CONFIG.SESSION_KEY   = '5s_session'   // localStorage
CONFIG.LANG_KEY      = '5s_lang'
CONFIG.CACHE_TTL     = 5*60*1000      // in-memory API cache 5 นาที
const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
```

### Objects / Modules
| Object | หน้าที่ |
|--------|---------|
| `CONFIG` | Supabase URL/key, session/lang key, cache TTL, version |
| `MAP` | แปลงค่า enum DB ↔ label UI (role, areaType, status) ทั้งไป-กลับ |
| `TRANSLATIONS` / `I18n` | ข้อความ TH/EN + `t(key)`, `getLang()`, `setLang()`, `apply()` |
| `AppState` | State กลาง: user, plants, area, criteria, auditAnswers, assignData, cache |
| `API` | wrapper เรียก handler (`get(name, params)`) — handler จริงคุยกับ `_sb` โดยตรง |
| `Session` | `save()`, `load()`, `clear()`, `requireLogin()` — เก็บ user ใน localStorage |
| `UI` | `showLoading/hideLoading`, `toast`, `scoreBadge`, `formatDate`, `statusClass`, `statusTH` |
| `mapPlant/mapArea/mapProfile/mapHeader/mapCriteria` | แปลง row snake_case (DB) → PascalCase (UI) |

### API handlers (คุยกับ Supabase ตรง ๆ ผ่าน `_sb`)
`login`, `logout`,
`getPlants`, `getAreas`, `getCriteria`,
`getSchedule`, `getScheduleAdmin`, `saveSchedule`, `completeSchedule`, `deleteSchedule`,
`getAssignmentAnalytics`,
`submitAuditHeader`, `submitAuditDetails`, `finalizeAudit`, `getAuditDetail`, `getHistory`, `deleteAudit`,
`getDashboard`,
`getUsers`, `saveUser`, `deleteUser`,
`getLogs`, `resetData`

> หมายเหตุ: การคำนวณคะแนน/สถานะ audit ไม่ได้ทำที่ไคลเอนต์แล้ว — trigger `recalc_audit_header`
> คำนวณให้ที่ DB ทุกครั้งที่ `audit_details` เปลี่ยน (`finalizeAudit` จึงเป็นเพียงการอ่านผลกลับ)

---

## 5. Database (Supabase PostgreSQL)

### Enums
| Enum | ค่า |
|------|-----|
| `user_role` | admin, manager, auditor, area_manager, **viewer** — *ใช้จริง 3 ตัว: admin/auditor/viewer · manager+area_manager เลิกใช้ (ซ่อนจาก dropdown, Postgres ลบค่าออกไม่ได้ → คนที่เป็น role เก่าได้สิทธิ์เท่า auditor)* |
| `record_status` | active, inactive |
| `area_type` | office, production, warehouse, cafeteria, outdoor, maintenance |
| `audit_status` | excellent, good, need_improvement, pending, failed |
| `schedule_status` | pending, completed |

**3 roles ที่ใช้จริง (นโยบาย 5 ส.ค. 2026):**
| role | สิทธิ์ |
|------|--------|
| 👑 admin | จัดการทุกอย่าง · แก้/ลบผลตรวจได้ตลอด · เห็นทุกคน |
| 📋 auditor | ตรวจ 5ส · ดูผลตรวจ**ทั้งบริษัทบน Dashboard** แต่**ประวัติเห็นเฉพาะของตัวเอง** · แก้ผลตัวเองไม่ได้หลัง submit |
| 👁️ viewer | ผู้บริหาร — ดูได้ทุกอย่าง (รวมประวัติทุกคน) แต่**ตรวจไม่ได้ อัปโหลดรูปไม่ได้ แก้ไม่ได้** |

### ตาราง (8)
**`profiles`** (ผูก 1:1 กับ `auth.users`) — id(uuid, FK auth.users), employee_id, name, department,
email(unique), role, status, `assigned_plants text[]`, `assigned_areas text[]`, created_at, updated_at

**`plants`** — plant_id(PK), plant_name, status · **`areas`** — area_id(PK), plant_id(FK), area_name, area_type, status

**`criteria`** — criteria_id(PK), category, sub_category, question, description, `area_types text[]`,
max_score, active · **132 ข้อ / 34 หมวด** (มาตรฐาน R.00 16.06.2026)

**`audit_headers`** — audit_id(uuid PK), legacy_audit_id, plant_id, area_id, auditor_id(FK profiles),
audit_date, total_score, max_score, percent, status(audit_status), created_at

**`audit_details`** — detail_id(uuid PK), audit_id(FK, cascade), criteria_id(FK), score(0–2),
`na boolean` (true=ไม่มีในพื้นที่ → ตัดออกจากการคำนวณ), remark(≤200), `photo_urls text[]`,
`unique(audit_id, criteria_id)` (กันบันทึกซ้ำ)

**`schedules`** — schedule_id(uuid PK), plant_id, area_id, `auditor_ids uuid[]` (มอบหลายคนได้),
audit_date, audit_round, status(schedule_status)

**`audit_logs`** — log_id, user_id, action, entity, entity_id, detail, `old_data jsonb`, `new_data jsonb`,
created_at · **append-only** (revoke update/delete)

### Triggers
| Trigger | ตาราง | ทำอะไร |
|---------|-------|--------|
| `trg_recalc_audit` | audit_details | คำนวณ total/max/percent/status ของ header อัตโนมัติ (ตัด N/A ออก, เกณฑ์ ≥90 excellent / ≥75 good / else need_improvement) |
| `trg_new_user` | auth.users | สร้าง row `profiles` ให้ผู้ใช้ใหม่อัตโนมัติ |
| `trg_log_*` | profiles, schedules, areas, criteria, audit_headers | เก็บ INSERT/UPDATE/DELETE ลง `audit_logs` (ค่าเดิม→ใหม่ เป็น JSON) |

### RPC
`admin_reset_data()` (security definer) — เช็คสิทธิ์ admin ที่ DB → สำรองลง `*_backup` → ล้าง
audit_headers/details, schedules, รูปใน Storage → บันทึกลง audit_logs (ไคลเอนต์ลบเองไม่ได้)

### RLS (สรุปหลักการ)
- **อ่าน (select):** ผู้ล็อกอินทุกคนอ่าน plants/areas/criteria/profiles และ audit_headers/details ได้
  → Home/Dashboard/History เห็น **ภาพรวมทั้งบริษัท** และแสดงชื่อผู้ตรวจร่วมได้
- **เขียน:** จำกัดเจ้าของ/admin — audit เขียนได้เฉพาะเจ้าของ header หรือ staff; schedules แก้ได้เฉพาะ
  staff + auditor ที่อยู่ใน `auditor_ids` (mark completed ของตัวเอง); plants/areas/criteria แก้ได้เฉพาะ admin
- **logs:** insert ได้ทุกคน, อ่านได้เฉพาะ admin, แก้/ลบไม่ได้เลย (append-only)

> ⚠️ ผลข้างเคียง: ผู้ใช้ภายในอ่าน `profiles` ได้ทั้งตาราง (รวม email/role) — ถ้าต้องซ่อน
> ให้เปลี่ยนเป็น view เปิดเฉพาะ id+name ภายหลัง

---

## 6. โครงไฟล์ SQL & วิธีรัน (สำคัญ)

| ไฟล์ | หน้าที่ | รันเมื่อไหร่ |
|------|---------|-------------|
| `supabase/schema.sql` | โครงสร้างตัวจริง | **เฉพาะ DB ใหม่เปล่า** (ห้ามรันบน DB ที่ใช้อยู่ → error already exists) |
| `supabase/seed_master.sql` | ข้อมูลตั้งต้น (plants/areas/criteria) | ครั้งเดียวตอนตั้ง DB ใหม่ |
| `supabase/patches.sql` | รวมการแก้ DB สะสม (idempotent, ไฟล์เดียว) | **DB ที่ใช้อยู่** เวลามีแก้เพิ่ม (รันซ้ำได้) |
| `supabase/storage_and_first_admin.sql` | storage bucket + admin คนแรก | ครั้งเดียว |

**patches.sql แบ่งเป็นส่วน:** A โครงสร้าง · B ข้อมูล · C ระบบ audit log · D RPC reset + KPI ทั้งบริษัท (RLS อ่าน)
> กติกา: มีแก้ DB เพิ่ม → **ต่อท้าย `patches.sql` ไฟล์เดียว** เขียนให้ idempotent ไม่สร้างไฟล์ราย patch ใหม่

---

## 7. Flow หลัก

### Login (Supabase Auth)
```
email+password → _sb.auth.signInWithPassword()
  → อ่าน profiles ของ user → Session.save(user) ลง localStorage
  → JWT เก็บ/refresh โดย supabase-js อัตโนมัติ → ทุก query แนบ token เอง
```

### Submit Audit
```
audit.html: โหลด criteria (getCriteria ตาม areaType) → ให้คะแนน/N/A/remark/รูป
  submit:
    1) อัปโหลดรูป → Supabase Storage (bucket audit-photos) → ได้ public URL
    2) submitAuditHeader → insert audit_headers (status=pending)
    3) submitAuditDetails → insert audit_details (score/na/remark/photo_urls)
         └─ trigger recalc_audit_header คำนวณ total/max/percent/status ให้เอง
    4) finalizeAudit → อ่านผลกลับ → summary.html
    5) ถ้ามาจากงานที่มอบหมาย (มี scheduleId) → completeSchedule (mark schedule completed)
```

### งานที่ได้รับมอบหมาย (mytasks)
```
getSchedule (pending+completed ที่ RLS ให้เห็น) → filterMyTasks (userId ∈ auditor_ids)
  สถานะการ์ด: วันนี้ / เกินกำหนด / รอตรวจ / เสร็จสิ้น (จาก schedule.status + audit_date)
  เสร็จสิ้น → ปุ่ม "ดูผล" → summary.html?auditId=... (getSchedule แนบ Audit_ID ล่าสุดของพื้นที่นั้น)
```

---

## 8. Versions & Deploy

| ส่วน | เวอร์ชันล่าสุด |
|------|---------------|
| `app.js` / `style.css` (cache-bust query) | `v=33` |
| Service Worker cache | `5s-audit-v4.6` (กลยุทธ์: JS ดึงสดจาก network เสมอ) |
| App version (`CONFIG.VERSION`) | `2.0.0` |

**Deploy:** push `main` → GitHub Pages เผยแพร่อัตโนมัติ · หลังอัปเดตไฟล์ให้ **bump `v=` ทุก HTML + cache SW**
เพื่อกัน service worker เสิร์ฟไฟล์เก่า (อาการที่เคยเจอ: การ์ดหาย/พื้นที่ไม่ครบชั่วคราวหลังอัปเดต = cache เก่า)

---

## 9. ฟีเจอร์ที่เพิ่มล่าสุด (30 ก.ค. – 1 ส.ค. 2026)

- **ย้ายทั้งระบบมา Supabase** (Auth/DB/Storage) + RLS + trigger คำนวณคะแนน/สถานะที่ DB
- **มอบหมายงานแบบใหม่** (schedule): เลือกหลายพื้นที่พร้อมกัน (bulk), โหมด "ตามพื้นที่"/"ตามคน",
  ตัวกรอง ยังไม่มอบ/เกินกำหนด + ค้นหา
- **หน้า Home hero card** + **หน้า mytasks** แยกงานที่ได้รับมอบหมายออกมา
- **หน้า assign (ตารางตรวจ)**: KPI มอบ/เสร็จ/ค้าง/เกินกำหนด + คะแนนเฉลี่ยต่อผู้ตรวจ (ชี้ความเข้มงวด)
- **ระบบ Audit Log** (trigger 5 ตาราง + client log LOGIN/LOGOUT/SUBMIT) + หน้า logs (admin)
- **ปุ่มรีเซ็ตข้อมูล** (เขตอันตราย, ยืนยัน 3 ชั้น, RPC + สำรองอัตโนมัติ) — ⚠️ ยังไม่ได้กดใช้จริง
- **KPI ภาพรวมทั้งบริษัท** (เปิด RLS อ่านให้ทุก auth), summary รองรับ N/A ทั้งหมด, guard กัน submit ตอน session หลุด
- **ปุ่ม "ดูผล"** ในงานที่มอบหมาย → ไปหน้าผลการตรวจของหัวข้อนั้นตรง ๆ (แนบ Audit_ID)

---

## 10. Known Issues / TODO

### ⚠️ ก่อน Production
- ล้างข้อมูลทดสอบด้วยปุ่ม/สคริปต์ reset (เตรียมไว้แล้ว ยังไม่กด)
- ตรวจ Quick Login / บัญชีทดสอบใน index.html ให้เอาออก
- พิจารณาจำกัด `profiles` ให้อ่านเฉพาะ id+name ผ่าน view (ตอนนี้อ่านได้ทั้งตาราง)

### 📋 TODO / แนวทางต่อ
- ฟีเจอร์ "ตรวจต่อ" — เก็บร่างการตรวจที่ยังไม่ส่ง (ตอนนี้มีแค่ pending/completed)
- Export รายงาน PDF จากผลการตรวจ / export audit log เป็นไฟล์
- Push notification เตือนรอบตรวจ
- ระบบ comment / action plan เมื่อคะแนนต่ำ
- Offline queue: บันทึกคะแนน offline แล้วส่งเมื่อมีเน็ต
- Role `area_manager` (มี enum แล้ว ยังไม่เดินเรื่อง flow เต็ม)

---

*อัปเดตจาก source code + schema จริง | สถาปัตยกรรม Supabase | 2026-08-01*
