# PROJECT_SUMMARY.md — ระบบตรวจ 5ส โรงงาน (5S Audit System)

> **อ้างอิงหลักสำหรับการพัฒนา** — อัปเดต: 2026-07-08  
> ในการวิเคราะห์ครั้งต่อไป ให้อ่านไฟล์นี้ก่อนเสมอ และอ่าน source code ใหม่เฉพาะเมื่อไฟล์เปลี่ยนแปลงแล้วเท่านั้น

---

> ⚠️ **สถาปัตยกรรมเปลี่ยนแล้ว (2026-07-30):** ระบบย้ายจาก **Google Apps Script + Google Sheets + imgBB** → **Supabase (PostgreSQL + Auth + Storage)** และย้าย repo ไป `Seksunw/5s-audit-system` (GitHub Pages: https://seksunw.github.io/5s-audit-system/)
>
> เนื้อหาส่วนที่กล่าวถึง Google Apps Script / Google Sheets / imgBB ด้านล่างเป็น **ประวัติก่อนการย้าย** — สถาปัตยกรรมปัจจุบันดูที่ **`WORK_LOG_2026-07-30.md`** และ **`SUPABASE_MIGRATION_PLAN.md`** ส่วน backend/schema จริงอยู่ในโฟลเดอร์ `supabase/`

---

## 1. Project Overview

### วัตถุประสงค์
ระบบตรวจสอบมาตรฐาน 5ส (สะสาง สะดวก สะอาด สุขลักษณะ สร้างนิสัย) สำหรับโรงงานอุตสาหกรรม รองรับการตรวจสอบแบบ Mobile-First PWA ทำงานได้ Offline และบันทึกผลลง Google Sheets โดยอัตโนมัติ

### Technologies
| Layer | Technology (ปัจจุบัน 2026-07-30) | เดิม (ก่อนย้าย) |
|-------|-----------|-----------|
| Frontend | Vanilla JS (ES6+), HTML5, CSS3, Bootstrap Icons | (เหมือนเดิม) |
| PWA | Service Worker, Web App Manifest | (เหมือนเดิม) |
| Backend | **Supabase** — PostgREST auto API + `supabase-js` adapter ใน `app.js` | Google Apps Script Web App |
| Database | **Supabase PostgreSQL** (8 ตาราง + RLS + trigger) | Google Sheets (9 sheets) |
| Hosting | GitHub Pages (`Seksunw/5s-audit-system`) | GitHub Pages (`seksunw58-ai/...`) |
| Photo Storage | **Supabase Storage** (bucket `audit-photos`) | imgBB API / Google Drive |
| Auth | **Supabase Auth** (bcrypt + JWT + auto refresh) | SHA-256 + Session token (UUID) |
| Font | Google Fonts — Sarabun (Thai/English) | (เหมือนเดิม) |
| i18n | Built-in TH/EN translation system | (เหมือนเดิม) |

### Architecture
```
GitHub Pages (Static Hosting)
    │
    ├── index.html / home.html / plant.html / area.html
    ├── audit.html / summary.html / history.html
    ├── dashboard.html / users.html
    ├── css/style.css
    ├── js/app.js          ← ไฟล์ JS หลักทั้งหมด
    ├── sw.js              ← Service Worker
    └── manifest.json      ← PWA Manifest
         │
         │  HTTPS GET/POST (query string)
         ▼
    Google Apps Script Web App (Code.gs)
         │
         ├── Google Sheets (Database)
         │    ├── User_Master
         │    ├── Plant_Master
         │    ├── Area_Master
         │    ├── Criteria_Master (132 ข้อ)
         │    ├── Audit_Header
         │    ├── Audit_Detail
         │    ├── Schedule_Master
         │    ├── Sessions
         │    └── Audit_Log
         │
         └── Google Drive (Photo Fallback)
              └── 5S Audit Photos/
                   └── {AuditID}/
```

---

## 2. Folder Structure

```
5S apps/
├── docs/                        ← โฟลเดอร์เอกสาร (ไฟล์นี้อยู่ที่นี่)
│   └── PROJECT_SUMMARY.md
├── css/
│   └── style.css                ← Global stylesheet (CSS Variables, components)
├── js/
│   └── app.js                   ← Frontend JS ทั้งหมด (~2200 lines)
├── 5S Brain/                    ← Obsidian vault (Knowledge base)
│   ├── 000 Index/               ← MOC + Architecture notes
│   ├── 100 Criteria/            ← Criteria reference notes
│   ├── 200 Code/                ← Code documentation notes
│   └── 300 Commits/             ← GitHub commit notes
├── index.html                   ← Login page
├── home.html                    ← Home / Dashboard summary
├── plant.html                   ← เลือก Plant
├── area.html                    ← เลือก Area
├── audit.html                   ← ทำ Checklist
├── summary.html                 ← ผลการตรวจ
├── history.html                 ← ประวัติการตรวจ
├── dashboard.html               ← Dashboard & Analytics
├── users.html                   ← User Management (Admin only)
├── Code.gs                      ← Google Apps Script Backend
├── Criteria_Master.csv          ← ข้อมูล criteria สำหรับ import เข้า Sheet
├── manifest.json                ← PWA Manifest
├── sw.js                        ← Service Worker (Cache v1.5)
├── sync_commits.py              ← Script: GitHub commits → Obsidian
├── export_to_obsidian.py        ← Script: Project docs → Obsidian
├── DEPLOYMENT_GUIDE.md          ← คู่มือ Deploy
└── มาตรฐาน_5ส_R.00 16.06.2026.docx  ← เอกสารมาตรฐาน (ต้นฉบับ)
```

---

## 3. File Summary

### `Code.gs` — Google Apps Script Backend
**วัตถุประสงค์:** API backend ทั้งหมดของระบบ รับ HTTP GET/POST แล้วส่ง JSON กลับ

**Config ที่สำคัญ:**
```javascript
CONFIG.SPREADSHEET_ID   = '1oTTXfdut9Ek1jbiMgzIPxvVATmzncIQnP0kZ6AQ7Br0'
CONFIG.DRIVE_FOLDER_ID  // อ่านจาก Script Properties (รัน setupDriveFolder() ครั้งเดียว)
CONFIG.SESSION_DURATION_HOURS = 8
```

**Functions หลัก:**
| Function | หน้าที่ |
|----------|---------|
| `doGet(e)` / `doPost(e)` | Entry point รับทุก request |
| `handleRequest(e)` | Router — parse action และ route ไป function ที่ถูกต้อง |
| `apiLogin(body)` | ตรวจสอบ email/password (SHA-256) สร้าง session token |
| `apiLogout(token)` | ลบ session |
| `createSession(userId, email, role)` | สร้าง UUID token บันทึกลง Sessions sheet + CacheService |
| `validateSession(token)` | ตรวจ token จาก Cache ก่อน ถ้าไม่มีไปดู Sheet |
| `deleteSession(token)` | ลบ token จาก Cache และ Sheet |
| `apiGetPlants()` | คืน Active plants |
| `apiGetAreas(params, auth)` | คืน areas พร้อม filter ตาม role/assignment/schedule |
| `apiGetCriteria(params)` | คืน criteria กรองตาม areaType, grouped by Category |
| `apiGetSchedule(params)` | คืน Pending schedules เท่านั้น |
| `apiSubmitAuditHeader(params, auth)` | สร้าง Audit_ID และ header row |
| `apiSubmitAuditDetails(params)` | บันทึก detail rows เป็น chunk |
| `apiFinalizeAudit(params)` | คำนวณคะแนนรวม อัปเดต header |
| `apiSubmitAudit(body, auth)` | Submit แบบ single-call (fallback) |
| `apiGetHistory(params)` | ดึงประวัติ filter ตาม plant/area/month/year |
| `apiGetAuditDetail(params)` | ดึงรายละเอียด audit + criteria mapping |
| `apiUploadPhoto(body)` | Upload รูปไป Google Drive |
| `apiGetDashboard(params)` | คำนวณ stats, trends, rankings |
| `apiGetUsers(auth, params)` | คืน users ทั้งหมด (Admin เท่านั้น) |
| `apiSaveUser(params, auth)` | INSERT หรือ UPDATE user |
| `setupSystem()` | รันครั้งเดียว: สร้าง Sheets ทั้งหมด + initial data |
| `setupDriveFolder()` | สร้าง Google Drive folder + บันทึก ID ลง Script Properties |
| `setupCriteria()` | Import 132 criteria ลง Criteria_Master sheet |
| `hashPassword(password)` | SHA-256 + base64 encode |
| `sheetToObjects(sheet)` | แปลง Sheet rows → Array of objects (header-based) |
| `logAction(userId, action, detail)` | เขียน log ลง Audit_Log sheet |

**Dependencies:** Google Apps Script built-ins (SpreadsheetApp, DriveApp, CacheService, PropertiesService, Utilities, ContentService)

---

### `js/app.js` — Frontend JavaScript (~2200 lines)
**วัตถุประสงค์:** ไฟล์ JS หลักรวม logic ทั้งหมดไว้ที่เดียว

**Objects / Modules หลัก:**
| Object | หน้าที่ |
|--------|---------|
| `CONFIG` | URL ของ GAS API, imgBB key, session key, cache TTL |
| `TRANSLATIONS` | ข้อความ TH/EN ครบทุก key |
| `I18n` | `getLang()`, `setLang()`, `t(key)`, `apply()` |
| `AppState` | State กลาง: user, token, plant, area, criteria, auditAnswers, auditPhotos, cache |
| `API` | `get(action, params)`, `post(action, body)` — fetch wrapper สำหรับ GAS |
| `Session` | `save()`, `load()`, `clear()`, `isLoggedIn()`, `requireLogin()` |
| `UI` | `showLoading()`, `hideLoading()`, `toast()`, `scoreBadge()`, `formatDate()`, `statusClass()`, `statusTH()` |

**Page Init Functions:**
| Function | Page |
|----------|------|
| `initLogin()` | index.html |
| `initHome()` | home.html |
| `initPlant()` | plant.html |
| `initArea()` | area.html |
| `initAudit()` | audit.html |
| `initSummary()` | summary.html |
| `initHistory()` | history.html |
| `initDashboard()` | dashboard.html |
| `initUsers()` | users.html |

**Key Config:**
```javascript
CONFIG.API_URL      = 'https://script.google.com/macros/s/***REDACTED-OLD-GAS***/exec'
CONFIG.IMGBB_API_KEY = '***REDACTED-OLD-IMGBB-KEY***'
CONFIG.SESSION_KEY  = '5s_session'
CONFIG.LANG_KEY     = '5s_lang'
CONFIG.CACHE_TTL    = 5 * 60 * 1000   // 5 นาที
```

---

### `sw.js` — Service Worker
**Cache Name:** `5s-audit-v1.5`  
**Strategy:** Cache First สำหรับ static assets, ไม่ intercept GAS / Google APIs  
**Cached Files:** index.html, home.html, plant.html, area.html, audit.html, summary.html, history.html, dashboard.html, users.html, css/style.css, js/app.js, manifest.json

---

### `css/style.css`
**วัตถุประสงค์:** Global stylesheet ใช้ CSS Variables สำหรับ theming  
**CSS Variables หลัก:** `--primary`, `--success`, `--danger`, `--warning`, `--gray-*`  
**Components:** login-page, bottom-nav, cards, badges (excellent/good/need-improve), toast, loading-overlay, criteria-item, photo-thumb

---

### `Criteria_Master.csv`
**วัตถุประสงค์:** ข้อมูล criteria สำหรับ import เข้า Google Sheets ด้วย `setupCriteria()`  
**Format:** `Criteria_ID, Category, Sub_Category, Question, Description, Area_Type, Max_Score, Active`  
**จำนวน:** 132 ข้อ / 34 หมวด (มาตรฐาน R.00 16.06.2026)  
**Encoding:** UTF-8 with BOM (รองรับ Excel)

---

### `manifest.json` — PWA Manifest
```json
{
  "name": "ระบบตรวจ 5ส โรงงาน",
  "short_name": "5S Audit",
  "start_url": "./index.html",
  "display": "standalone",
  "theme_color": "#1a73e8",
  "lang": "th"
}
```

---

## 4. Application Flow

```
User opens app
    │
    ▼
[index.html] Login Page
    │── I18n.apply() → แสดงภาษาตาม localStorage
    │── กรอก email + password
    │── API.post('login') → GAS: apiLogin()
    │── GAS: SHA-256 hash password → เปรียบ Sheet
    │── GAS: createSession() → บันทึก token ลง Sessions sheet + CacheService
    │── Frontend: Session.save(token, user) → localStorage
    ▼
[home.html] Home Page
    │── Session.requireLogin() — guard
    │── API.get('getDashboard') + API.get('getSchedule')
    │── แสดง stats + next schedule
    ▼
[plant.html] เลือก Plant
    │── API.get('getPlants') → แสดง Plant cards
    ▼
[area.html] เลือก Area
    │── API.get('getAreas', { plantId }) → filter ตาม role/assignment
    ▼
[audit.html] ทำ Checklist
    │── API.get('getCriteria', { areaType }) → โหลด criteria grouped by category
    │── User ให้คะแนน 0/1/2 + remark + ถ่ายรูป
    │── Submit:
    │     STEP 0: uploadToImgBB() สำหรับทุกรูป
    │     STEP 1: API.get('submitAuditHeader') → สร้าง AuditID
    │     STEP 2: API.get('submitAuditDetails') chunk ทีละ 15 ข้อ
    │     STEP 3: API.get('finalizeAudit') → คำนวณคะแนน อัปเดต header
    ▼
[summary.html] ผลการตรวจ
    │── อ่านจาก sessionStorage หรือ API.get('getAuditDetail')
    │── แสดง percent, status badge, score circle
    ▼
[history.html] ประวัติ / [dashboard.html] Dashboard / [users.html] Users
```

---

## 5. Screen Flow

```
index.html (Login)
    │
    ├── [Login สำเร็จ] ──────────────────────► home.html
    │                                              │
    │                         ┌────────────────────┼────────────────┐
    │                         ▼                    ▼                ▼
    │                    plant.html          history.html     dashboard.html
    │                         │
    │                         ▼
    │                    area.html
    │                         │
    │                         ▼
    │                    audit.html
    │                         │
    │                         ▼ (submit)
    │                    summary.html
    │                         │
    │              ┌──────────┴──────────┐
    │              ▼                     ▼
    │         area.html           history.html
    │
    └── [Admin] ──────────────────────► users.html
```

### รายละเอียดแต่ละหน้า

| หน้า | URL | หน้าที่ | Role |
|------|-----|---------|------|
| Login | index.html | เข้าสู่ระบบ + เลือกภาษา | ทุกคน |
| Home | home.html | ดู stats รวม + next schedule | ทุกคน |
| Plant | plant.html | เลือกโรงงาน | ทุกคน |
| Area | area.html | เลือกพื้นที่ตรวจ | ทุกคน |
| Audit | audit.html | ทำ Checklist 132 ข้อ + ถ่ายรูป | ทุกคน |
| Summary | summary.html | ดูผลการตรวจ + score circle | ทุกคน |
| History | history.html | ประวัติการตรวจ filter ได้ | ทุกคน |
| Dashboard | dashboard.html | Analytics, trends, rankings | ทุกคน |
| Users | users.html | จัดการ user (CRUD) | Admin เท่านั้น |

---

## 6. API Documentation

GAS Web App URL (base): `https://script.google.com/macros/s/***REDACTED-OLD-GAS***/exec`

ทุก request ส่งผ่าน HTTPS GET พร้อม query parameters เพื่อหลีกเลี่ยง CORS preflight

### Public Routes

#### `login`
```
GET ?action=login&payload={...}
Body: { email, password }
Response: { success, token, user: { userId, name, email, role, department } }
Backend: apiLogin()
```

### Protected Routes (ต้องมี token)

#### `getPlants`
```
GET ?action=getPlants&token=...
Response: { success, data: [{ Plant_ID, Plant_Name, Status, ... }] }
Backend: apiGetPlants()
```

#### `getAreas`
```
GET ?action=getAreas&token=...&plantId=...
Response: { success, data: [{ Area_ID, Area_Name, Area_Type, Plant_ID, Schedule_ID?, Audit_Round?, Audit_Date? }] }
Backend: apiGetAreas() — filter ตาม role + assignment + pending schedule
```

#### `getCriteria`
```
GET ?action=getCriteria&token=...&areaType=...
Response: { success, data: [...criteria], grouped: { Category: [...] }, totalMaxScore }
Backend: apiGetCriteria()
```

#### `getSchedule`
```
GET ?action=getSchedule&token=...
Response: { success, data: [...Pending schedules] }
Backend: apiGetSchedule()
```

#### `submitAuditHeader`
```
GET ?action=submitAuditHeader&token=...&plantId=...&areaId=...&auditorId=...&auditDate=...
Response: { success, auditId }
Backend: apiSubmitAuditHeader()
```

#### `submitAuditDetails`
```
GET ?action=submitAuditDetails&token=...&auditId=...&details=[{criteriaId,score,remark,photoUrl}]
Response: { success, saved: N }
Backend: apiSubmitAuditDetails() — batch insert
```

#### `finalizeAudit`
```
GET ?action=finalizeAudit&token=...&auditId=...
Response: { success, auditId, totalScore, maxScore, percent, status }
Backend: apiFinalizeAudit() — คำนวณ % และอัปเดต header
```

#### `getHistory`
```
GET ?action=getHistory&token=...&plantId=...&areaId=...&month=...&year=...
Response: { success, data: [...audits sorted by date desc], total }
Backend: apiGetHistory()
```

#### `getAuditDetail`
```
GET ?action=getAuditDetail&token=...&auditId=...
Response: { success, header, details: [...detail + criteria info] }
Backend: apiGetAuditDetail()
```

#### `getDashboard`
```
GET ?action=getDashboard&token=...&plantId=...&year=...&month=...
Response: { success, data: { totalAudit, avgScore, passRate, excellent, good, needImprovement, plantComparison, areaRanking, monthlyTrend, highestArea, lowestArea } }
Backend: apiGetDashboard()
```

#### `getUsers` (Admin only)
```
GET ?action=getUsers&token=...
Response: { success, data: [...users, Password: '***'] }
Backend: apiGetUsers()
```

#### `saveUser` (Admin only)
```
GET ?action=saveUser&token=...&payload={userId?,name,email,department,employeeId,role,status,password?}
Response (update): { success, message }
Response (insert): { success, userId, message }
Backend: apiSaveUser() — INSERT ถ้าไม่มี userId, UPDATE ถ้ามี
```

#### `uploadPhoto`
```
POST payload: { base64, filename, mimeType, auditId }
Response: { success, url, fallbackUrl, fileId }
Backend: apiUploadPhoto() — upload ไป Google Drive
```

#### `logout`
```
GET ?action=logout&token=...
Response: { success }
Backend: apiLogout() → deleteSession()
```

---

## 7. Database Structure (Google Sheets)

### `User_Master`
| Column | Type | Description |
|--------|------|-------------|
| User_ID | String | `USR-YYYYMMDD-XXXXXX` |
| Employee_ID | String | รหัสพนักงาน |
| Name | String | ชื่อ-นามสกุล |
| Department | String | แผนก |
| Email | String | email (ใช้ login) |
| Password | String | SHA-256 + base64 |
| Role | String | `Admin` / `Auditor` |
| Status | String | `Active` / `Inactive` |
| Assigned_Plants | String | Plant IDs คั่น comma |
| Assigned_Areas | String | Area IDs คั่น comma |
| Created_Date | Date | วันสร้าง |
| Updated_Date | Date | วันอัปเดตล่าสุด |

### `Plant_Master`
| Column | Type | Description |
|--------|------|-------------|
| Plant_ID | String | รหัส Plant |
| Plant_Name | String | ชื่อโรงงาน |
| Status | String | `Active` / `Inactive` |

### `Area_Master`
| Column | Type | Description |
|--------|------|-------------|
| Area_ID | String | รหัส Area |
| Plant_ID | String | FK → Plant_Master |
| Area_Name | String | ชื่อพื้นที่ |
| Area_Type | String | `Office` / `Production` / `Warehouse` / `Cafeteria` / `Outdoor` / `Maintenance` |
| Status | String | `Active` / `Inactive` |

### `Criteria_Master`
| Column | Type | Description |
|--------|------|-------------|
| Criteria_ID | String | `C-XX-X` เช่น `C-01-1` |
| Category | String | ชื่อหมวด |
| Sub_Category | String | เลขข้อ เช่น `1.1` |
| Question | String | คำถามที่ใช้ตรวจ |
| Description | String | รายละเอียดเพิ่มเติม |
| Area_Type | String | `All` / `Office` / `Production,Warehouse` ฯลฯ |
| Max_Score | Number | 2 (ทุกข้อ) |
| Active | Boolean | TRUE/FALSE |

**จำนวน:** 132 ข้อ, 34 หมวด (มาตรฐาน R.00 16.06.2026)

### `Audit_Header`
| Column | Type | Description |
|--------|------|-------------|
| Audit_ID | String | `AUD-YYYYMMDDHHmmss-XXXX` |
| Plant_ID | String | FK → Plant_Master |
| Area_ID | String | FK → Area_Master |
| Auditor_ID | String | FK → User_Master |
| Audit_Date | Date | วันที่ตรวจ |
| Total_Score | Number | คะแนนรวมที่ได้ |
| Max_Score | Number | คะแนนสูงสุดที่เป็นไปได้ |
| Percent | Number | Total_Score/Max_Score × 100 |
| Status | String | `Excellent` / `Good` / `Need Improvement` / `Pending` |

### `Audit_Detail`
| Column | Type | Description |
|--------|------|-------------|
| Detail_ID | String | `AUD-...-0001` |
| Audit_ID | String | FK → Audit_Header |
| Criteria_ID | String | FK → Criteria_Master |
| Score | Number | 0 / 1 / 2 |
| Remark | String | หมายเหตุ (max 200 chars) |
| Photo_URL | String | URL รูปถ่าย (comma separated ถ้าหลายรูป) |

### `Schedule_Master`
| Column | Type | Description |
|--------|------|-------------|
| Schedule_ID | String | รหัส schedule |
| Plant_ID | String | FK → Plant_Master |
| Area_ID | String | FK → Area_Master |
| Auditor_ID | String | FK → User_Master (comma separated) |
| Audit_Date | Date | วันที่กำหนดตรวจ |
| Audit_Round | String | รอบการตรวจ |
| Status | String | `Pending` / `Completed` |

### `Sessions`
| Column | Type | Description |
|--------|------|-------------|
| Token | String | UUID |
| User_ID | String | FK → User_Master |
| Email | String | email |
| Role | String | Admin / Auditor |
| Created | DateTime | วันเวลาสร้าง |
| Expiry | DateTime | หมดอายุหลัง 8 ชั่วโมง |

### `Audit_Log`
| Column | Type | Description |
|--------|------|-------------|
| Log_ID | String | `LOG-{timestamp}` |
| User | String | User_ID |
| Action | String | `LOGIN` / `AUDIT` ฯลฯ |
| Detail | String | รายละเอียด |
| DateTime | DateTime | เวลา log |

---

## 8. Authentication & Session Flow

```
1. User ส่ง email + password
2. GAS: SHA-256 hash password → เปรียบกับ User_Master
3. ถ้าตรง: createSession()
   a. สร้าง UUID token
   b. คำนวณ expiry = now + 8 hours
   c. ลบ expired sessions ออกจาก Sheet (cleanup)
   d. appendRow ลง Sessions sheet
   e. CacheService.put(token, {userId,email,role}, 28800 sec)
4. ส่ง token กลับ Frontend
5. Frontend: Session.save(token, user) → localStorage
6. ทุก request: ส่ง token ใน query string
7. GAS: validateSession(token)
   a. เช็ค CacheService ก่อน (เร็ว)
   b. ถ้าไม่มี Cache → อ่านจาก Sessions sheet
   c. ตรวจ expiry
   d. ถ้าผ่าน: re-cache 28800 sec
8. Logout: deleteSession() → ลบ Cache + Sheet row
```

**Security Notes:**
- Password ไม่เคยส่งผ่าน URL (ส่งใน payload JSON)
- Session expire หลัง 8 ชั่วโมง
- Admin routes ตรวจ `auth.role !== 'Admin'` แยกต่างหาก
- Area permission ตรวจ: schedule → assigned area → assigned plant → allow all

---

## 9. Image Upload Flow

```
User เลือกรูป (กล้องหรือ gallery)
    │
    ▼
compressImage(file, 1024px, quality=0.8)
    │── Canvas resize ไม่เกิน 1024px
    │── แปลง → base64 JPEG
    ▼
AppState.auditAnswers[criteriaId].photos.push({ filename, preview(base64), uploaded:false, url:null })
renderPhotoPreviews(criteriaId) → แสดง thumbnail ทันที
    │
    ▼ (ตอน Submit)
uploadToImgBB(base64)
    │── POST ไป https://api.imgbb.com/1/upload
    │── Key: CONFIG.IMGBB_API_KEY
    │── คืน: { url: "https://i.ibb.co/..." }
    │
    ▼ (ถ้า imgBB ล้มเหลว → fallback)
apiUploadPhoto() → Google Drive
    │── DriveApp.getFolderById(DRIVE_FOLDER_ID)
    │── สร้าง subfolder ตาม AuditID
    │── createFile(blob) → set sharing ANYONE_WITH_LINK
    │── URL: https://lh3.googleusercontent.com/d/{fileId}
    ▼
photo.url = urlที่ได้
photo.uploaded = true
บันทึก URL ลง Audit_Detail.Photo_URL
```

---

## 10. Configuration

### Frontend (`js/app.js`)
| Key | Value | หมายเหตุ |
|-----|-------|---------|
| `CONFIG.API_URL` | `https://script.google.com/macros/s/***REDACTED-OLD-GAS***/exec` | ต้องอัปเดตเมื่อ re-deploy GAS |
| `CONFIG.IMGBB_API_KEY` | `***REDACTED-OLD-IMGBB-KEY***` | imgBB free API key |
| `CONFIG.SESSION_KEY` | `5s_session` | localStorage key |
| `CONFIG.LANG_KEY` | `5s_lang` | localStorage key สำหรับภาษา |
| `CONFIG.CACHE_TTL` | `300000` (5 min) | TTL สำหรับ in-memory API cache |
| `CONFIG.VERSION` | `1.0.0` | app version |

### Backend (`Code.gs`)
| Key | Value | หมายเหตุ |
|-----|-------|---------|
| `CONFIG.SPREADSHEET_ID` | `1oTTXfdut9Ek1jbiMgzIPxvVATmzncIQnP0kZ6AQ7Br0` | Google Sheet ID |
| `CONFIG.DRIVE_FOLDER_ID` | อ่านจาก Script Properties | รัน `setupDriveFolder()` ครั้งเดียว |
| `CONFIG.SESSION_DURATION_HOURS` | `8` | session อายุ 8 ชั่วโมง |

### PWA (`sw.js`)
| Key | Value |
|-----|-------|
| `CACHE_NAME` | `5s-audit-v1.5` |

### Scripts การตั้งค่า (รันครั้งเดียวใน Apps Script Editor)
1. `setupSystem()` — สร้าง Sheets ทั้งหมด + initial data
2. `setupDriveFolder()` — สร้าง Drive folder + บันทึก ID ลง Properties
3. `setupCriteria()` — import 132 criteria (**ต้องล้าง Criteria_Master rows ก่อน**)

---

## 11. Dependency Map

```
index.html
    └── js/app.js
            ├── TRANSLATIONS (built-in)
            ├── I18n (built-in)
            ├── CONFIG.API_URL → Google Apps Script
            ├── CONFIG.IMGBB_API_KEY → imgBB API
            ├── Session → localStorage
            ├── AppState (in-memory)
            └── Bootstrap Icons CDN (stylesheet)

Code.gs (Google Apps Script)
    ├── SpreadsheetApp → Google Sheets
    ├── DriveApp → Google Drive
    ├── CacheService → GAS Script Cache
    ├── PropertiesService → Script Properties
    └── Utilities (SHA-256, UUID, date format)

sw.js
    └── Cache API (browser built-in)
```

---

## 12. Sequence Diagram — Login Flow

```
User          Browser(app.js)      GAS(Code.gs)        Sheets
 │                  │                   │                  │
 │──email+pass─────►│                   │                  │
 │                  │─POST login───────►│                  │
 │                  │                   │──read User_Master►│
 │                  │                   │◄─users data──────│
 │                  │                   │─SHA256(pass)      │
 │                  │                   │─compare hash      │
 │                  │                   │─createSession()   │
 │                  │                   │──write Sessions──►│
 │                  │                   │─CacheService.put  │
 │                  │◄─{success,token}──│                  │
 │                  │─localStorage.set  │                  │
 │◄──navigate home──│                   │                  │
```

## 12b. Sequence Diagram — Submit Audit Flow

```
User       app.js         imgBB API    GAS(Code.gs)      Sheets
 │            │                │            │               │
 │─submit────►│                │            │               │
 │            │─upload photos─►│            │               │
 │            │◄─photo URLs────│            │               │
 │            │─submitHeader──────────────►│               │
 │            │                │            │──appendRow───►│ Audit_Header
 │            │◄─{auditId}─────────────────│               │
 │            │─submitDetails(chunk)──────►│               │
 │            │                │            │──batch write─►│ Audit_Detail
 │            │─finalizeAudit─────────────►│               │
 │            │                │            │─calc scores   │
 │            │                │            │──update row──►│ Audit_Header
 │            │◄─{percent,status}──────────│               │
 │◄─summary───│                │            │               │
```

---

## 13. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    USER DEVICE (Mobile/Desktop)          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              PWA (GitHub Pages)                 │    │
│  │                                                 │    │
│  │   index.html → home → plant → area → audit      │    │
│  │   summary → history → dashboard → users          │    │
│  │                                                 │    │
│  │   js/app.js                                     │    │
│  │   ├── I18n (TH/EN)                              │    │
│  │   ├── Session (localStorage)                    │    │
│  │   ├── API (fetch wrapper)                       │    │
│  │   ├── AppState (in-memory)                      │    │
│  │   └── UI (toast, loading, score badge)          │    │
│  │                                                 │    │
│  │   sw.js (Service Worker)                        │    │
│  │   └── Cache First: static assets v1.5           │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                               │
│              HTTPS GET (query string)                   │
└─────────────────────────┼───────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │  Google Apps Script   │
              │  Web App (Code.gs)    │
              │                       │
              │  handleRequest()      │
              │  ├── apiLogin()       │
              │  ├── apiGetPlants()   │
              │  ├── apiGetAreas()    │
              │  ├── apiGetCriteria() │
              │  ├── apiSubmit*()     │
              │  ├── apiFinalizeAudit │
              │  ├── apiGetDashboard()│
              │  ├── apiGetUsers()    │
              │  └── apiSaveUser()    │
              └───────────┬───────────┘
                          │
              ┌───────────▼────────────────────────┐
              │         Google Sheets               │
              │                                     │
              │  User_Master | Plant_Master          │
              │  Area_Master | Criteria_Master (132) │
              │  Audit_Header | Audit_Detail          │
              │  Schedule_Master | Sessions           │
              │  Audit_Log                           │
              └─────────────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │     Google Drive      │
              │  5S Audit Photos/     │
              │  └── {AuditID}/       │
              │       └── photo.jpg   │
              └───────────────────────┘

External APIs:
  imgBB API → photo hosting (primary, no CORS)
  Google Fonts → Sarabun font
  Bootstrap Icons CDN → icons
```

---

## 14. Known Issues / TODO

### ⚠️ Security (ต้องแก้ก่อน Production)
- **Quick Login buttons** ใน `index.html` (Admin + Auditor) ต้องลบออกก่อน deploy production
- **IMGBB_API_KEY** อยู่ใน client-side code — ควรย้ายไป server-side ถ้าต้องการ secure
- **Password ส่งผ่าน query string** ใน API.post ใช้ `payload` param — รับได้ แต่ควรใช้ POST body จริงๆ

### 🐛 Bugs ที่แก้แล้ว (v1.2)
- BUG-001: Plain text password bypass ← แก้แล้ว
- BUG-002: deleteSession hardcoded index ← แก้แล้ว
- BUG-003: DRIVE_FOLDER_ID ไม่ validate ← แก้แล้ว
- BUG-004: Cache TTL ไม่ตรงกัน (3600 vs 28800) ← แก้แล้ว
- BUG-005/006: apiGetUsers/apiSaveUser รับ token แทน auth object ← แก้แล้ว
- BUG-007: Google Drive URL deprecated ← แก้แล้ว
- BUG-008: Session cleanup ไม่ทำงาน ← แก้แล้ว
- BUG-009: Batch setValue แทน 4 calls แยก ← แก้แล้ว
- BUG-010: maxScore hardcoded แทนอ่านจาก Criteria_Master ← แก้แล้ว
- BUG-011: logAction กลืน error เงียบ ← แก้แล้ว
- BUG-012: Schedule ส่ง Completed กลับมาด้วย ← แก้แล้ว
- BUG-013: Audit_ID format ไม่มี timestamp ← แก้แล้ว
- BUG-014: User management Optimistic UI Update ← แก้แล้ว

### 📋 TODO
- [ ] ลบ Quick Login buttons ออกก่อน Production
- [ ] เพิ่ม Push Notification สำหรับ schedule reminder
- [ ] Export PDF report จากผลการตรวจ
- [ ] ระบบ comment/action plan เมื่อคะแนนต่ำ
- [ ] Role: Area Manager (ตัวกลางระหว่าง Admin และ Auditor)
- [ ] Offline queue: บันทึกคะแนน offline แล้วส่งเมื่อมีเน็ต

---

## 15. Suggested Improvements

### Performance
- เพิ่ม pagination ใน History page (ตอนนี้โหลดทั้งหมด)
- Virtual scroll สำหรับ criteria list ที่มี 132 ข้อ
- Debounce filter ใน History/Dashboard

### Security
- ย้าย imgBB upload ไป server-side (Code.gs) เพื่อซ่อน API key
- เพิ่ม Rate limiting ใน GAS
- ใช้ POST body จริงๆ สำหรับ sensitive data แทน query string payload

### UX
- Dark mode
- ปุ่ม "บันทึก Draft" ระหว่างตรวจ (กันข้อมูลหาย)
- Progress bar แบบ persistent ข้าม session (IndexedDB)
- รายงาน PDF แบบ printable

### Architecture
- แยก API endpoints ตาม resource (RESTful)
- เพิ่ม TypeScript types สำหรับ frontend
- Unit tests สำหรับ GAS functions

---

*สร้างโดย Claude AI | อ้างอิงจาก source code โดยตรง | อัปเดต: 2026-07-08*
