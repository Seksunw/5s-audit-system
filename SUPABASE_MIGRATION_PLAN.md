# แผนย้ายระบบ 5S Audit → Supabase (+ GitHub บัญชีใหม่)

> อัปเดต: 2026-07-30 · เป้าหมาย: ตัดขาดจาก Google (GAS + Sheet) และ imgBB เดิม ย้ายไป **Supabase (Postgres + Auth + Storage)** พร้อมย้าย repo ไป GitHub บัญชีใหม่
> สถานะข้อมูล: บัญชี Google เดิม **ยังเข้าถึงได้** → migrate audit จริงเข้ามาได้

---

## สรุปการตัดสินใจ

- **ไป Supabase เลย ข้าม Google** — ไม่ต้องสร้าง GAS/Sheet บนบัญชี Google ใหม่ ประหยัดงานส่วนที่หนักที่สุด
- Frontend PWA + GitHub Pages **คงไว้** เปลี่ยนแค่ชั้นที่คุยกับ backend
- Google เดิมใช้เป็น **แหล่งข้อมูลตั้งต้น** (export ครั้งเดียว) แล้วเลิกใช้

---

## สิ่งที่ผูกกับของเดิม (ต้องแก้/ตัด)

| รายการ | อยู่ที่ | จัดการ |
|---|---|---|
| GitHub remote `seksunw58-ai/5s-audit-system` | `.git/config` | เปลี่ยนเป็น repo บัญชีใหม่ |
| ชื่อ user `seksunw58-ai` | `sync_commits.py`, `export_to_obsidian.py`, `5S Brain/000 Index/MOC.md`, `WORK_LOG` | แก้เป็น user ใหม่ |
| GAS API URL | `js/app.js:12` | ลบทิ้ง → แทนด้วย Supabase client |
| imgBB key | `js/app.js:13` | ลบทิ้ง → แทนด้วย Supabase Storage |
| Spreadsheet ID | `Code.gs:13` | เลิกใช้ (Code.gs ทั้งไฟล์ถูกแทนที่) |
| GitHub Pages URL live | `MOC.md` | อัปเดตเป็น URL ใหม่ |

---

## แบ่งงาน: คุณทำ (บัญชี/สิทธิ์) vs ผมทำ (โค้ด/SQL)

### 🧑 คุณต้องทำเอง (ต้องล็อกอินบัญชี — ผมทำแทนไม่ได้)
1. สร้าง **GitHub repo ใหม่** บนบัญชีใหม่ (เช่น `pronovalabs/5s-audit-system`) + ตั้ง credential/PAT บนเครื่องนี้
2. สมัคร/สร้าง **Supabase project** → คัดลอก `Project URL` และ `anon key` มาให้ผม
3. เปิด **GitHub Pages** บน repo ใหม่ (Settings → Pages → branch `main`)
4. รัน SQL ที่ผมเตรียมให้ ใน **Supabase SQL Editor** (วาง–กด Run)
5. สร้างบัญชีผู้ใช้รอบแรกใน Supabase Auth (หรือเปิด invite) — เพราะ password เดิม migrate ตรงไม่ได้

### 🤖 ผมทำให้ได้เลย (โค้ด/สคริปต์/เอกสาร)
- `supabase/schema.sql` — ตาราง + RLS + trigger คำนวณคะแนน ✅ (สร้างแล้ว)
- สคริปต์ export ข้อมูลจาก Google Sheet เดิม → CSV/SQL (ยิงผ่าน GAS URL เดิมที่ยัง public อยู่ หรือรับไฟล์ CSV ที่คุณ export)
- เขียน API layer ใน `js/app.js` ใหม่ให้ใช้ `@supabase/supabase-js` แทน fetch wrapper เดิม
- ย้าย logic ที่ซับซ้อน (ถ้าจำเป็น) ไป Supabase Edge Function
- แก้ชื่อ user/URL ที่ hardcode ทุกไฟล์
- อัปเดตเอกสาร (`PROJECT_SUMMARY.md`, `Architecture.md`)

---

## ขั้นตอน (staged)

### Stage 0 — เตรียมบัญชี (คุณ)
สร้าง GitHub repo ใหม่ + Supabase project ส่ง `Project URL` + `anon key` มา

### Stage 1 — วาง schema (ผมเตรียม / คุณรัน)
รัน `supabase/schema.sql` ใน SQL Editor → ได้ตาราง 8 ตาราง + RLS + trigger
> Sessions sheet ไม่ต้องมี — Supabase Auth จัดการ session/JWT เอง

### Stage 2 — ย้ายข้อมูล (ผม)
1. Master data: `plants`, `areas`, `criteria` (132 ข้อจาก `Criteria_Master.csv` ที่มีอยู่แล้วในเครื่อง)
2. ข้อมูล audit จริง: export `Audit_Header` / `Audit_Detail` / `Schedule_Master` จาก Sheet เดิม → insert เข้า Postgres (ใช้ `legacy_*_id` map ความสัมพันธ์)
3. Users: import เป็น `profiles` + สร้าง auth user (password ต้อง reset)

### Stage 3 — เขียน backend ใหม่ (ผม)
- แทน `API.get/post` เดิมด้วย Supabase client (query ตรง + RLS คุมสิทธิ์)
- คะแนน/สถานะคำนวณโดย trigger ใน DB แล้ว → ฝั่ง client แค่ insert details
- รูปภาพ → อัปโหลดเข้า Supabase Storage (bucket private + signed URL)

### Stage 4 — เปลี่ยน hosting/บัญชี (ผม + คุณ)
- แก้ remote git → repo ใหม่, แก้ user ที่ hardcode, push
- เปิด GitHub Pages บัญชีใหม่ → ได้ URL ใหม่ → อัปเดตในเอกสาร

### Stage 5 — ทดสอบ + ตัดระบบ (cutover)
- ทดสอบ login, ทำ audit, ดู dashboard/history, จัดการ user ครบ flow
- ยืนยันข้อมูลเก่าครบ → เลิกใช้ GAS/Sheet/imgBB

---

## จะส่งผลยังไง (impact)

**ผลบวก**
- แก้ปัญหา critical จาก audit เดิมได้ในตัว: IDOR + role scoping (RLS), race condition + atomic (transaction/trigger), 401 จริง (JWT), password มี salt (Supabase Auth), เลิกโชว์ imgBB key
- Query เร็วขึ้น (index + JOIN แทน full-sheet read)
- เลิก deploy GAS ด้วยมือทุกครั้ง
- เจ้าของระบบชัดเจน เหลือ 2 บัญชี: GitHub ใหม่ + Supabase

**ต้องแลก / ความเสี่ยง**
- **User ต้อง reset password** (hash SHA-256 เดิม import เข้า Supabase Auth ตรงไม่ได้)
- **เสียความสะดวก "เปิด Google Sheet แก้ข้อมูลตรงๆ"** — ต่อไปแก้ผ่านแอปหรือ Supabase dashboard
- Free tier: DB 500MB / storage 1GB / auth 50k MAU — พอสำหรับสเกลนี้ แต่ **โปรเจกต์ฟรี pause ถ้าไม่มี request 7 วัน** และไม่มี backup/SLA → ถ้าใช้จริงจังควรขึ้น Pro (~$25/เดือน)
- ต้อง rewrite API layer ใน `app.js` (แต่ HTML/UI/i18n เดิมใช้ต่อได้)

---

## Schema mapping (สรุป)

| Google Sheet | Postgres table | หมายเหตุการเปลี่ยน |
|---|---|---|
| User_Master | `profiles` (+ `auth.users`) | auth แยกไป Supabase Auth; assigned_* → array |
| Plant_Master | `plants` | — |
| Area_Master | `areas` | area_type → enum |
| Criteria_Master | `criteria` | area_types → enum array |
| Audit_Header | `audit_headers` | score/percent/status คำนวณโดย trigger |
| Audit_Detail | `audit_details` | photo → array; unique(audit,criteria) |
| Schedule_Master | `schedules` | auditor_ids → uuid array |
| Sessions | — (ตัดทิ้ง) | Supabase Auth จัดการเอง |
| Audit_Log | `audit_logs` | — |

รายละเอียด DDL + RLS ทั้งหมดอยู่ใน `supabase/schema.sql`

---

## ขั้นต่อไปที่รอจากคุณ
ส่ง **Supabase Project URL + anon key** และยืนยันชื่อ **GitHub repo/บัญชีใหม่** มา แล้วผมลุย Stage 2–4 ต่อได้ทันที
