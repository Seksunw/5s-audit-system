#!/usr/bin/env python3
"""
export_to_obsidian.py — Export 5s-audit-system project docs to Obsidian vault
รัน: python3 ~/Desktop/5S/5S\ apps/export_to_obsidian.py
"""

import csv, os, re
from pathlib import Path
from datetime import datetime

# ===== CONFIG =====
PROJECT = Path.home() / "Desktop/5S/5S apps"
VAULT   = Path.home() / "Desktop/5S/5S apps/5S Brain"
NOW     = datetime.now().strftime("%Y-%m-%d")
# ==================

def mkdir(p): p.mkdir(parents=True, exist_ok=True)

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  ✅ {path.relative_to(VAULT)}")

# ── 1. MOC ──────────────────────────────────────────────────────────────────
def create_moc():
    content = f"""---
tags: [moc, 5s-audit, project]
updated: {NOW}
---

# 5S Audit System — Map of Content

ระบบตรวจ 5ส โรงงาน 2026 | PWA + Google Apps Script

## 🔗 Project Links
- [GitHub Repo](https://github.com/Seksunw/5s-audit-system)
- [Live App (GitHub Pages)](https://seksunw.github.io/5s-audit-system/)

## 📁 โครงสร้างไฟล์
| ไฟล์ | หน้าที่ |
|------|---------|
| [[Code.gs]] | Backend — Google Apps Script API |
| [[app.js]] | Frontend — Logic, i18n, State, UI |
| [[Criteria Master]] | มาตรฐาน 5ส 131 ข้อ |
| `index.html` | หน้า Login + เลือกภาษา |
| `home.html` | หน้าหลัก |
| `plant.html` | เลือก Plant |
| `area.html` | เลือกพื้นที่ |
| `audit.html` | ทำ Checklist |
| `summary.html` | ผลการตรวจ |
| `history.html` | ประวัติการตรวจ |
| `dashboard.html` | Dashboard |
| `users.html` | จัดการ Users (Admin) |

## 🌐 ระบบ 2 ภาษา (TH/EN)
- เลือกภาษาตอน Login — บันทึกใน `localStorage`
- ใช้ `data-i18n`, `data-i18n-ph`, `data-i18n-title`, `data-i18n-html`
- `I18n.apply()` — apply translation ทั้งหน้า

## 🏭 Plants & Areas
- รองรับ 3 Plants
- หลายพื้นที่ (Area) ต่อ Plant
- มาตรฐาน 131 ข้อ ตาม Draft 2026

## 📝 Recent Commits
"""
    write(VAULT / "000 Index/5S Audit System MOC.md", content)


# ── 2. Code.gs note ─────────────────────────────────────────────────────────
def create_codejs_note():
    src = (PROJECT / "Code.gs").read_text(encoding="utf-8")
    # Extract function names + first comment line
    funcs = []
    lines = src.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r'^function (\w+)\(', line)
        if m:
            desc = ""
            if i > 0 and lines[i-1].strip().startswith("//"):
                desc = lines[i-1].strip().lstrip("/ ").strip()
            funcs.append((m.group(1), desc))

    func_table = "\n".join(
        f"| `{name}()` | {desc or '—'} |"
        for name, desc in funcs
    )

    content = f"""---
tags: [code, backend, gas, 5s-audit]
updated: {NOW}
language: Google Apps Script
lines: {len(lines)}
---

# Code.gs — Backend (Google Apps Script)

[[5S Audit System MOC]]

## หน้าที่
Backend API สำหรับ 5S Audit System ทำงานบน Google Apps Script (GAS)
รับ-ส่งข้อมูลกับ Google Sheets เป็น database

## Google Sheets (Tabs)
| Sheet | ข้อมูล |
|-------|--------|
| `User_Master` | ข้อมูล Users + hashed password |
| `Plant_Master` | Plants ทั้งหมด |
| `Area_Master` | Areas แยกตาม Plant |
| `Criteria_Master` | มาตรฐาน 131 ข้อ |
| `Audit_Header` | Header ของแต่ละ Audit |
| `Audit_Detail` | รายละเอียดคะแนนแต่ละข้อ |
| `Session_Master` | Sessions ที่ active |
| `Action_Log` | Log การกระทำทั้งหมด |

## Functions ทั้งหมด
| Function | Description |
|----------|-------------|
{func_table}

## Security
- Password hashing ด้วย SHA-256 (`hashPassword()`)
- Session token — expire หลัง 8 ชั่วโมง
- Role-based: `admin`, `auditor`
- Header-based column lookup (ไม่ใช้ index ตายตัว)

## Config สำคัญ
```javascript
CONFIG.SPREADSHEET_ID  // Google Sheet ID
CONFIG.DRIVE_FOLDER_ID // อ่านจาก Script Properties
```

## การ Deploy
1. เปิด Apps Script Editor
2. Deploy → New deployment → Web App
3. Execute as: **Me**, Access: **Anyone**

## Links
- [[app.js]] — Frontend ที่เรียก API นี้
- [[5S Audit System MOC]]
"""
    write(VAULT / "200 Code/Code.gs.md", content)


# ── 3. app.js note ──────────────────────────────────────────────────────────
def create_appjs_note():
    src = (PROJECT / "js/app.js").read_text(encoding="utf-8")
    lines = src.split("\n")

    sections = []
    for line in lines:
        m = re.match(r'^// =+ (.+?) =+', line)
        if m:
            sections.append(m.group(1).strip())

    section_list = "\n".join(f"- {s}" for s in sections if s)

    content = f"""---
tags: [code, frontend, javascript, 5s-audit]
updated: {NOW}
language: JavaScript (Vanilla)
lines: {len(lines)}
---

# app.js — Frontend Logic

[[5S Audit System MOC]]

## หน้าที่
ไฟล์ JavaScript หลักของ PWA รวม logic ทั้งหมดไว้ที่เดียว

## โครงสร้าง Modules
{section_list}

## Objects สำคัญ
| Object | หน้าที่ |
|--------|---------|
| `CONFIG` | URL ของ GAS API, imgBB key |
| `TRANSLATIONS` | ข้อความ TH/EN ทั้งหมด |
| `I18n` | จัดการภาษา — `getLang()`, `t()`, `apply()` |
| `AppState` | State กลาง — plant, area, scores, photos |
| `API` | fetch wrapper เรียก GAS backend |
| `Session` | จัดการ login/logout/token |
| `UI` | Toast, Loading overlay, helpers |

## ระบบ i18n
```javascript
// ใช้ attribute บน HTML elements:
data-i18n="key"         // → textContent
data-i18n-ph="key"      // → placeholder
data-i18n-title="key"   // → title attribute
data-i18n-html="key"    // → innerHTML

// เรียกใช้ใน JS:
I18n.t('key')           // ดึงข้อความตามภาษาปัจจุบัน
I18n.apply()            // apply ทั้งหน้า
I18n.setLang('en')      // เปลี่ยนภาษา
```

## Photo Upload Flow
1. `triggerPhoto(criteriaId)` — เปิด file picker
2. `compressImage()` — compress ก่อน upload (max 1024px)
3. Upload ไป imgBB API
4. `renderPhotoPreviews()` — re-render grid ทั้งหมด

## การนำทางระหว่างหน้า
```javascript
navigate('plant.html')              // ไปหน้า plant
navigate('area.html', {{plant: id}})  // ส่ง params
getParam('plant')                   // อ่าน param
```

## Links
- [[Code.gs]] — Backend API ที่ app.js เรียกใช้
- [[5S Audit System MOC]]
"""
    write(VAULT / "200 Code/app.js.md", content)


# ── 4. Criteria Master note ─────────────────────────────────────────────────
def create_criteria_note():
    rows = []
    with open(PROJECT / "Criteria_Master.csv", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    # Group by Category
    cats = {}
    for r in rows:
        cat = r.get("Category", "—")
        cats.setdefault(cat, []).append(r)

    cat_section = ""
    for cat, items in cats.items():
        cat_section += f"\n### {cat} ({len(items)} ข้อ)\n"
        for r in items:
            cid   = r.get("Criteria_ID", "")
            q     = r.get("Question", "")
            score = r.get("Max_Score", "")
            atype = r.get("Area_Type", "")
            cat_section += f"- **{cid}** {q} *(max {score} คะแนน, {atype})*\n"

    content = f"""---
tags: [criteria, 5s-standard, reference]
updated: {NOW}
total: {len(rows)}
---

# Criteria Master — มาตรฐาน 5ส 131 ข้อ

[[5S Audit System MOC]]

## ภาพรวม
- **จำนวนทั้งหมด:** {len(rows)} ข้อ
- **หมวดหมู่:** {len(cats)} หมวด
- **อ้างอิง:** มาตรฐาน_5ส_Draft 2026

## คอลัมน์
| คอลัมน์ | ความหมาย |
|---------|-----------|
| `Criteria_ID` | รหัสข้อ เช่น C-01-1 |
| `Category` | หมวดหมู่พื้นที่ |
| `Sub_Category` | หมวดย่อย |
| `Question` | คำถามที่ใช้ตรวจ |
| `Description` | รายละเอียดเพิ่มเติม |
| `Area_Type` | All / Office / Production |
| `Max_Score` | คะแนนสูงสุด (1-2) |
| `Active` | TRUE/FALSE |

## รายการทั้งหมด
{cat_section}

## Links
- [[5S Audit System MOC]]
- [[Code.gs]] — `setupCriteria()` import ข้อมูลนี้เข้า Google Sheets
"""
    write(VAULT / "100 Criteria/Criteria Master.md", content)


# ── 5. Architecture note ────────────────────────────────────────────────────
def create_arch_note():
    content = f"""---
tags: [architecture, diagram, 5s-audit]
updated: {NOW}
---

# System Architecture — 5S Audit System

[[5S Audit System MOC]]

## Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS PWA (HTML/CSS/JS) |
| Backend | Google Apps Script (GAS) |
| Database | Google Sheets |
| Hosting | GitHub Pages |
| Photos | imgBB API + Google Drive |
| Auth | Session token (SHA-256 hash) |

## Data Flow
```
User Browser (PWA)
    │
    │  HTTPS POST/GET
    ▼
Google Apps Script Web App
    │
    ├─ Google Sheets (Database)
    │     ├─ User_Master
    │     ├─ Plant_Master / Area_Master
    │     ├─ Criteria_Master (131 ข้อ)
    │     ├─ Audit_Header / Audit_Detail
    │     └─ Session_Master / Action_Log
    │
    └─ Google Drive (Photos)
          └─ 5S_Audit_Photos/
```

## PWA Features
- Service Worker (`sw.js`) — offline cache
- Web App Manifest (`manifest.json`) — install to home screen
- Cache version: `5s-audit-v1.5`

## Audit Flow
```
Login → เลือก Plant → เลือก Area
    → ทำ Checklist (131 ข้อ) + ถ่ายรูป
    → Submit → ดูผล (% คะแนน)
    → Excellent ≥90% / Good 75-89% / Need Improvement <75%
```

## Roles
| Role | สิทธิ์ |
|------|--------|
| `admin` | ทุกอย่าง + จัดการ Users |
| `auditor` | ตรวจ + ดูประวัติ + Dashboard |

## Links
- [[Code.gs]]
- [[app.js]]
- [[Criteria Master]]
- [[5S Audit System MOC]]
"""
    write(VAULT / "000 Index/Architecture.md", content)


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print(f"\n📤 Export 5s-audit-system → Obsidian\n   Vault: {VAULT}\n")

    if not VAULT.exists():
        print(f"❌ ไม่พบ Vault ที่: {VAULT}")
        return

    create_moc()
    create_codejs_note()
    create_appjs_note()
    create_criteria_note()
    create_arch_note()

    print(f"\n✅ Export เสร็จแล้ว! เปิด Obsidian แล้วดูได้เลยครับ")
    print(f"   📁 000 Index/  — MOC + Architecture")
    print(f"   📁 100 Criteria/ — Criteria Master 131 ข้อ")
    print(f"   📁 200 Code/   — Code.gs + app.js")

if __name__ == "__main__":
    main()
