# CLAUDE.md — 5S Audit System

คู่มือประจำโปรเจกต์สำหรับ Claude Code — **อ่านไฟล์นี้ก่อนเริ่มงานทุกครั้ง**
เอกสารเชิงลึก: `docs/PROJECT_SUMMARY.md` · ประวัติรายวัน: `work-logs/WORK_LOG_YYYY-MM-DD.md`

---

## ภาพรวม

ระบบตรวจประเมินมาตรฐาน **5ส** สำหรับโรงงาน — **Mobile-first PWA** สองภาษา (TH/EN)
- **Frontend:** static site (Vanilla JS ES6+, HTML, CSS, Bootstrap Icons) — **ไม่มี build step**
- **Backend:** Supabase (PostgreSQL + Auth + Storage) เรียกตรงผ่าน `supabase-js` — ไม่มี server กลาง
- **Hosting:** GitHub Pages · repo `Seksunw/5s-audit-system` · branch `main`
- **Live:** https://seksunw.github.io/5s-audit-system/
- ความปลอดภัยคุมด้วย **Row Level Security (RLS)** + trigger ที่ระดับ DB (client bypass ไม่ได้)

## โครงไฟล์ที่ต้องรู้

- `js/app.js` — **โค้ด frontend ทั้งหมดอยู่ไฟล์เดียว** (~5,300 บรรทัด): I18n · Session · API(`_sb`) · AppState · UI · ทุกหน้า
- `css/style.css` — global stylesheet (CSS variables)
- `*.html` (14 หน้า) — router ใน app.js อ่านชื่อไฟล์ → เรียก `init<Page>()`
- `supabase/` — `schema.sql` (โครงจริง), `seed_master.sql` (plants/areas/criteria), `patches.sql` (แก้ DB สะสม), `storage_and_first_admin.sql`
- `sw.js` — Service Worker (JS ดึงสดจาก network เสมอ)
- `docs/PROJECT_SUMMARY.md` — สถาปัตยกรรมละเอียด · `work-logs/` — ประวัติงานรายวัน

## Dev / Deploy workflow

- **ไม่มี build/compile** — แก้ไฟล์แล้วเปิดหน้าได้เลย
- **Deploy = push `main`** → GitHub Pages เสิร์ฟไฟล์จาก root ของ branch โดยตรง (มี `.nojekyll` = ข้าม Jekyll เสิร์ฟไฟล์ดิบ) เผยแพร่อัตโนมัติภายในไม่กี่นาที
- ⚠️ **repo เป็น PUBLIC** — ทุกไฟล์ที่ push ขึ้นไปคนทั่วไปเห็นได้ (รวม worklogs, docs, โค้ด) · **ห้ามใส่ secret/ข้อมูลลับใด ๆ ในไฟล์ที่ track**
- ⚠️ **หลังแก้ CSS/JS ต้อง bump cache-bust `?v=NN` ในทุก HTML + เลข cache ใน `sw.js`** ไม่งั้น SW เสิร์ฟไฟล์เก่า (อาการ: การ์ด/พื้นที่หายชั่วคราวหลังอัปเดต) — ปัจจุบันอยู่ที่ `v=43`
- **เขียน worklog ใหม่ทุกครั้งที่ทำงานเสร็จ** ที่ `work-logs/WORK_LOG_YYYY-MM-DD.md` (สไตล์: หัวข้อหลัก + สรุป + รายละเอียด + commit hash)
- **commit/push เมื่อผู้ใช้สั่งเท่านั้น** · commit message เป็นแนว conventional (`feat:`, `fix:`, `docs:`)

## ไฟล์ที่ push ขึ้น GitHub / ไฟล์ที่ห้าม push

**push ขึ้น (public, ถูก deploy):** `*.html` ทุกหน้า · `js/app.js` · `css/style.css` · `sw.js` · `manifest.json` · `.nojekyll` · `supabase/*.sql` · `docs/PROJECT_SUMMARY.md` · `work-logs/*` · `CLAUDE.md` · `SUPABASE_MIGRATION_PLAN.md`

**ห้าม push — อยู่ใน `.gitignore` แล้ว (อย่าเผลอ `git add -f`):**

| pattern | เหตุผล |
|---------|--------|
| `docs/SECURITY_ASSESSMENT.md` · `*SECURITY_ASSESSMENT*` · `*PENTEST*` · `*.pentest.md` | 🔴 **repo public** — รายงานช่องโหว่ที่ยังไม่แก้ = แผนที่ให้ผู้โจมตี |
| `export/` · `*.zip` | build/design artifacts |
| `*.docx` · `Criteria_Master.csv` | เอกสาร/ข้อมูลต้นฉบับ (ไม่ต้อง deploy) |
| `export_to_obsidian.py` · `sync_commits.py` | เครื่องมือ local |
| `.obsidian/` · `.DS_Store` | editor/OS junk |

> กติกา: เพิ่มไฟล์ประเภทลับ/ต้นฉบับ/artifact ใหม่ → ต่อ pattern ใน `.gitignore` ก่อน commit เสมอ · **secret จริงเคยรั่วแล้ว git history ต้อง rewrite มาแล้ว (2026-08-03)** อย่าให้เกิดซ้ำ

## กติกาการเขียนโค้ด (สำคัญ — ห้ามพลาด)

1. **กัน XSS เสมอ:** ทุกค่าที่มาจากผู้ใช้/DB ก่อนใส่ลง DOM ต้องผ่าน `escHtml()` / `escAttr()` และ URL รูปผ่าน `safeUrl()` / `safeImg()` (อนุญาตเฉพาะ http/https)
2. **คะแนนเฉลี่ยเป็นแบบ "เฉลี่ยรายคน" (mean of percent)** ไม่ใช่ pooled (Σscore/Σmax) — ทุกผลตรวจน้ำหนักเท่ากัน · **ห้ามเปลี่ยนกลับ** (ดูคอมเมนต์ "ส่วน H" ใน `getDashboard`)
3. **ไม่คำนวณคะแนน/สถานะที่ client** — trigger `recalc_audit_header` คำนวณให้ที่ DB ทุกครั้งที่ `audit_details` เปลี่ยน (`finalizeAudit` แค่ "อ่านผลกลับ")
4. **ทุกหน้า HTML มี CSP `<meta>`** ระบุ domain Supabase — ถ้าเพิ่ม CDN/domain ใหม่ต้องอัปเดต CSP ให้ครบทุกหน้า ไม่งั้นถูกบล็อก
5. **i18n:** UI ใช้ `data-i18n` + `I18n.t(key)` · ภาษาปัจจุบัน = `I18n.getLang()` ('th'/'en') · ข้อความที่ JS render ทีหลังต้องแปลเอง (`I18n.apply()` ครั้งเดียวไม่ครอบ)
6. **map snake_case (DB) ↔ PascalCase (UI):** ใช้ `mapPlant/mapArea/mapProfile/mapHeader/mapCriteria` — อย่าปน field ดิบกับที่ map แล้ว
7. คอมเมนต์ภาษาไทยได้ (ตามสไตล์ repo เดิม)

## Supabase / Database

- 8 ตาราง: `profiles` (1:1 auth.users), `plants`, `areas`, `criteria`, `audit_headers`, `audit_details`, `schedules`, `audit_logs`
- **Enums:** `user_role`(admin/manager/auditor/area_manager), `audit_status`(excellent/good/need_improvement/pending/failed), `area_type`, `record_status`, `schedule_status`
- **เกณฑ์ผ่าน:** ≥90 excellent · ≥75 good · <75 need_improvement
- **RLS:** ผู้ล็อกอินทุกคน "อ่าน" ภาพรวมทั้งบริษัทได้ (plants/areas/criteria/profiles/audit_*) · "เขียน" จำกัดเจ้าของ/admin — ระวังตอน query ว่า auditor เห็นได้แค่ไหน
- **SQL rule:** แก้ DB เพิ่ม → **ต่อท้าย `patches.sql` ไฟล์เดียว เขียนให้ idempotent (รันซ้ำได้)** · **อย่ารัน `schema.sql` บน DB ที่ใช้อยู่** (มันสำหรับ DB ใหม่เปล่าเท่านั้น)
- `CONFIG.SUPABASE_KEY` เป็น anon/publishable key — public โดยตั้งใจ (RLS คุม) · **แต่ห้าม commit secret จริง** (service key, password, token) — git history เคยถูก rewrite เพื่อลบ credential ที่รั่วมาแล้ว (2026-08-03)

## Gotchas / Known issues

- `TRANSLATIONS` ใน app.js **เคยมี key `en:` ซ้ำ 2 ครั้ง** — เช็คก่อนแก้ i18n
- `profiles` ตอนนี้ผู้ใช้ภายในอ่านได้ทั้งตาราง (รวม email/role) — ยังไม่จำกัดเป็น view
- **ก่อน production:** เอา Quick Login / บัญชีทดสอบใน `index.html` ออก · ปุ่มรีเซ็ตข้อมูล (`admin_reset_data`) เพิ่งแก้บั๊กให้ใช้ได้ (2026-08-05) ใช้ด้วยความระวัง

## ฟีเจอร์ล่าสุด

- **2026-08-06:** ปุ่ม **Export PDF** ในหน้า dashboard — `buildReportHTML()` + `exportDashboardPDF()` ประกอบรายงาน (สรุป + ใบแจ้งพื้นที่ต้องปรับปรุงรายพื้นที่ TH/EN) แล้วพิมพ์ผ่าน hidden iframe (Print CSS); `getDashboard` คืน `auditorRoster`, `getImprovementItems` ดึง `sub_category`
- **2026-08-04:** dashboard เขียนใหม่ เหลือ Plant/Area Ranking + การ์ดพื้นที่ต้องปรับปรุง
- **2026-07-30:** ย้ายทั้งระบบจาก Google Apps Script → Supabase

*(รายละเอียดแต่ละงานดูใน `work-logs/`)*

---

## ต่อ Supabase MCP กับ Claude Code (read-only — แนะนำเริ่มแบบนี้ก่อน)

ให้ Claude Code "มองเห็น" DB จริงได้ (query/inspect schema+ข้อมูล) โดย **read-only กันแก้พลาด**
> เอกสารอ้างอิง: [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) · [Claude Code MCP](https://code.claude.com/docs/en/mcp)

**ต้องมีก่อน:** Node 18+ (`npx`)

**1. สร้าง Personal Access Token (PAT)**
- Supabase Dashboard → Account → [Access Tokens](https://supabase.com/dashboard/account/tokens) → Generate new token (ตั้งชื่อ เช่น `Claude Code MCP`)
- 🔴 เก็บเป็นความลับ — **ห้าม commit ลง repo (repo นี้ public)** · ใช้ PAT เท่านั้น อย่าใช้ service_role key

**2. Project ref ของโปรเจกต์นี้:** `oibjnkngraulcccdqevm` (จาก `https://oibjnkngraulcccdqevm.supabase.co`)

**3. สร้างไฟล์ `.mcp.json` ที่ root ของโปรเจกต์** (ไฟล์นี้ commit ได้ ไม่มี secret — token อ้างผ่าน env):

```json
{
  "mcpServers": {
    "supabase": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=oibjnkngraulcccdqevm"
      ],
      "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
    }
  }
}
```

**4. ตั้ง env var แล้วเปิด Claude Code** (token อยู่ในเชลล์/`.env` เท่านั้น ไม่อยู่ในไฟล์ที่ commit):

```bash
export SUPABASE_ACCESS_TOKEN="<PAT ของคุณ>"
claude
```

**5. เช็คว่าต่อติด:** ใน Claude Code พิมพ์ `/mcp` (ควรขึ้น `supabase ✔ Connected`) หรือ terminal `claude mcp list`

**ความปลอดภัย:**
- `--read-only` = query ได้ แต่ INSERT/UPDATE/DELETE ไม่ได้ — เริ่มแบบนี้เสมอ
- `--project-ref` ล็อกให้เห็นแค่โปรเจกต์นี้
- 🔴 **repo เป็น public** → เพิ่ม `.env` และ `*.token` ลง `.gitignore` ก่อน (ห้ามให้ token หลุด) · `.mcp.json` เอง commit ได้เพราะไม่มี secret
- จะแก้ DB จริง (ตัด `--read-only`) ค่อยทำทีหลังเมื่อมั่นใจ และยังต้องยึดกติกา: ต่อท้าย `patches.sql` แบบ idempotent เท่านั้น
