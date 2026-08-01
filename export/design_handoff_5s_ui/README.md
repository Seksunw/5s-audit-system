# Handoff: 5S Audit — Calm Premium Mobile UI

> **สำหรับ Claude Code** — วางไฟล์นี้ไว้ที่ root ของ repo `5s-audit-system`
> แล้วสั่ง Claude Code ตาม **PROMPT** ท้ายเอกสาร

---

## 0. TL;DR — สั่ง Claude Code ยังไง

วางโฟลเดอร์นี้ไว้ที่ root ของ repo แล้วรัน:

```bash
claude "อ่าน design_handoff_5s_ui/README.md ทั้งไฟล์ แล้วทำตามส่วน PROMPT ท้ายเอกสารให้ครบทุกข้อ ห้ามข้าม ห้ามเดา ค่าใดที่เอกสารระบุไว้ให้ใช้ค่านั้นเป๊ะ"
```

หรือใน session ที่เปิดอยู่แล้ว พิมพ์:

```
อ่าน design_handoff_5s_ui/README.md แล้วทำตาม PROMPT ท้ายเอกสาร
```

---

## 1. Overview

ระบบตรวจประเมิน 5ส ในโรงงาน (`Seksunw/5s-audit-system`) — vanilla HTML + CSS + JS
+ Supabase, PWA, mobile-first, ภาษาไทยเป็นหลัก (มี TH/EN switcher)

งานนี้คือ **การปรับ UI อย่างเดียว** ให้เรียบ-พรีเมียม โดยยืม design language
จาก Outlook for macOS: พื้นหลังเทาอมฟ้า, panel ขาวมุมโค้ง, เส้นคั่นบางมาก,
น้ำเงินเป็น accent เฉพาะจุดสำคัญ

**ห้ามลอกโลโก้ ไอคอน หรือข้อความของ Outlook — เอาแค่ภาษาการออกแบบ**

## 2. About the Design Files

ไฟล์ในชุดนี้:

| ไฟล์ | คืออะไร |
| --- | --- |
| `style.css` | **โค้ดจริงที่พร้อมใช้** — drop-in แทน `css/style.css` เดิม ใช้ชื่อคลาสเดิมครบ |
| `APPLY.md` | ขั้นตอนติดตั้ง + คำสั่ง sed + commit message |
| `prototype.dc.html` | **design reference เท่านั้น** — prototype ที่เขียนด้วย runtime อื่น ห้าม copy โค้ดไปใช้ตรงๆ ใช้ดูหน้าตา/พฤติกรรมที่ต้องการเท่านั้น |

`style.css` คือ deliverable หลัก — ไม่ต้องเขียนใหม่ ให้ใช้ไฟล์นี้

## 3. Fidelity

**High-fidelity** — ค่าสี ขนาด ระยะ น้ำหนักฟอนต์ ในเอกสารนี้เป็นค่าสุดท้าย
ให้ใช้ตามตัวเลขเป๊ะ ห้ามปัดเศษหรือ "ปรับให้สวยขึ้น" เอง

## 4. ข้อห้าม (ผู้ใช้ระบุชัดเจน)

ห้ามเปลี่ยนสิ่งเหล่านี้ — ปรับได้แค่หน้าตา:

1. ปุ่มให้คะแนน **0 / 1 / 2** ต่อข้อ และปุ่ม **"ไม่มีในพื้นที่"** ระดับหมวด — ต้องคงไว้ครบ
2. โครงนำทาง: **top nav bar + bottom tab bar** และ flow เดิม
   `home → plant → area → audit → summary`
3. ระบบคะแนน %: วงแหวน/แถบคะแนน + ระดับ **Excellent / Good / Need Improvement**
   เกณฑ์ **90 / 75**
4. สีสถานะเดิม: **เขียว** = ผ่าน/เสร็จ · **เหลือง** = รอ/บางส่วน · **แดง** = เกินกำหนด/ไม่ผ่าน
5. **ภาษาไทยเป็นหลัก** (มีสลับ EN) — เผื่อความยาวข้อความไทยที่ยาวกว่า
6. **mobile-first** + PWA
7. ห้ามแตะ `js/app.js` — logic, การเรียก API, การ render ทั้งหมดคงเดิม
8. ห้ามเปลี่ยนชื่อคลาสใน HTML — `app.js` query ด้วยคลาส/id เหล่านั้น

## 5. Pain points ที่ดีไซน์นี้แก้

- ผู้ตรวจใช้บนมือถือ **ขณะเดินตรวจในโรงงาน** (ใส่ถุงมือ / แสงจ้า)
  → ปุ่มคะแนนสูง 56px, คอนทราสต์ผ่าน AA ทุกข้อความ
- checklist หนึ่งพื้นที่มีหลายสิบข้อ
  → progress bar ชัด + chip เลขข้อที่ยังไม่ตอบ กดกระโดดได้
- ให้คะแนน + แนบรูป + หมายเหตุ ต้องไว
  → segmented control กดครั้งเดียว, หมายเหตุ/รูปเป็นชิปแถวเดียว
- UI เดิมแน่น สีเยอะ ไม่พรีเมียม
  → ลดสีเหลือ accent เดียว + สีสถานะ, เพิ่ม whitespace, เส้นคั่นบาง

## 6. Design Tokens (ค่าสุดท้าย — ใช้เป๊ะ)

### สี

| Token | ค่า | ใช้ที่ไหน |
| --- | --- | --- |
| `--primary` | `#1b4ea8` | accent — selected, ปุ่ม primary, สถานะสำคัญ |
| `--primary-dark` | `#143c80` | hover ของ primary |
| `--primary-light` | `#e8eef9` | พื้นอ่อนของ accent |
| `--canvas` | `#edf0f6` | พื้นหลังเทาอมฟ้าของ scroll area |
| `--panel` | `#ffffff` | panel |
| `--dark` | `#101828` | ข้อความหลัก |
| `--gray-700` | `#5b6572` | ข้อความรองที่ต้องอ่านง่าย (7.0:1) |
| `--gray-600` | `#667085` | meta / label เล็ก (5.9:1) |
| `--gray-200` | `#eef1f6` | แถบ track, พื้นไอคอน |
| `--hairline` | `rgba(16,24,40,.07)` | เส้นคั่น/ขอบ panel |
| `--hairline-strong` | `rgba(16,24,40,.11)` | ขอบปุ่ม secondary |
| `--excellent` / `--score-2` | `#1a7f43` | เขียว — ผ่าน / เสร็จ |
| `--warning` / `--score-1` | `#96650a` | เหลือง — บางส่วน / รอ |
| `--danger` / `--score-0` | `#b42318` | แดง — ไม่ผ่าน / เกินกำหนด |
| green bg / border | `#e9f4ed` / `#bfe0cb` | |
| amber bg / border | `#fdf6e7` / `#eeddb2` | |
| red bg / border | `#fdeeec` / `#f2c9c3` | |

> **สำคัญ** — accent น้ำเงินห้ามใช้เป็นพื้นหลังขนาดใหญ่ (เช่น top nav ทั้งแถบ)
> ใช้ได้เฉพาะ: selected state, ปุ่ม primary, progress fill, badge สำคัญ

### Radius

`--radius-sm 9px` · `--radius-md 12px` · `--radius-lg 14px` · `--radius-xl 18px`

### Shadow

```
--shadow-sm: 0 1px 2px rgba(16,24,40,.05)
--shadow-md: 0 2px 8px rgba(16,24,40,.07)
--shadow-lg: 0 8px 24px rgba(16,24,40,.10)
--shadow-xl: 0 18px 46px rgba(16,24,40,.15)
```

เงาต้องนุ่มและบาง — ห้ามใช้เงาเข้มแบบเดิม (`0 10px 15px rgba(0,0,0,.1)`)

### Nav

`--nav-height: 56px` (เดิม 60) · `--bottom-nav: 72px` (เดิม 70, บวก safe-area padding 8px)

### Typography

Sarabun (Google Fonts, weights 400/500/600/700/800) — คงเดิม

| บทบาท | ค่า |
| --- | --- |
| หัวข้อหน้า (brand) | 1rem / 700 |
| section title | .845rem / 700 |
| คำถามเกณฑ์ | .875rem / 600 / line-height 1.5 |
| คำอธิบายเกณฑ์ | .78rem / 400 / line-height 1.55 / `--gray-700` |
| stat number | 1.56rem / 700 / letter-spacing -.015em |
| stat label | .72rem / 500 / `--gray-600` |
| badge / pill | .66–.69rem / 700 |

## 7. Screens

### 7.1 หน้าตรวจ (`audit.html`) — สำคัญที่สุด

**Purpose** — ผู้ตรวจให้คะแนนทีละข้อขณะเดินตรวจ

**Layout (mobile, single column)**
1. top nav ขาว 56px — ปุ่มย้อนกลับ / ชื่อ plant + area / ตัวนับ "ตอบแล้ว x/y"
2. การ์ดความคืบหน้า sticky — label + % + progress bar 6px + pill วันที่ (มี % คะแนนปัจจุบันบรรทัดล่าง)
3. แถบเตือน "ยังไม่ตอบ N" พื้น amber + chip เลขข้อ scroll แนวนอน กดแล้วกระโดด
4. การ์ดหมวด (`.category-section`) พับได้ — หัวหมวดขาว + ปุ่ม "ไม่มีในพื้นที่"
5. รายข้อ (`.criteria-item`)
6. submit bar ติดเหนือ bottom tab
7. bottom tab bar 5 แท็บ

**`.category-header`** — พื้น **ขาว** (เดิมเป็นน้ำเงินทึบ) ตัวหนังสือ `--dark`
เส้นคั่นล่าง `rgba(16,24,40,.06)` · chevron `--gray-600` · count เป็น pill เทา

**`.cat-na-btn`** — ปกติ: พื้นขาว ขอบ hairline-strong ตัวหนังสือ `--gray-600` min-height 32px
active: พื้น `--gray-800` ตัวหนังสือขาว · หมวดที่ N/A → `.category-section` ได้ `opacity:.62`

**`.criteria-item`** — padding 14px, gap 11px, เส้นบนบาง `rgba(16,24,40,.05)`
เลขข้อเป็นชิปเทา (`.criteria-question .text-muted` → พื้น `#f2f5f9` radius 6px padding 4px 7px)

**`.score-buttons` — segmented control แบบ macOS** (จุดสำคัญที่สุด)
```css
.score-buttons{
  display:flex; gap:4px;
  background:#f4f6fa;
  border:1px solid rgba(16,24,40,.07);
  border-radius:11px;
  padding:4px;
}
.score-btn{
  flex:1; min-height:56px;              /* มือถือ — ใส่ถุงมือกดได้ */
  border:1.5px solid transparent;
  background:transparent;
  border-radius:9px;
  color:#667085;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
}
.score-btn .score-num{ font-size:1.06rem; font-weight:800 }
.score-btn .score-label{ font-size:.69rem; font-weight:500 }
```
selected: `0` → bg `#fdeeec` / border `#f2c9c3` / text `#b42318`
· `1` → `#fdf6e7` / `#eeddb2` / `#96650a`
· `2` → `#e9f4ed` / `#bfe0cb` / `#1a7f43`
hover ที่ยังไม่เลือก: เปลี่ยนแค่ bg + text (ไม่ใส่ border)

**`.remark-input`** — radius 11px, พื้น `#fbfcfe`, focus → ขอบ primary + ring `rgba(27,78,168,.12)` + พื้นขาว

**`.photo-btn`** — เปลี่ยนจากกล่อง dashed เต็มความกว้าง → **ชิป inline** ขอบ solid min-height 40px
`.photo-thumb` 64×64 radius 11px, ปุ่มลบเป็นวงกลมขาวลอยมุมขวาบน (`top:-6px;right:-6px`)

**`.audit-remaining-panel`** — พื้น `#fdf6e7` ขอบ `#eeddb2` · chip ขอบ `#e7cf95` ตัวหนังสือ `#7d5705` min-height 30px

**States ที่ต้องมี** — empty (ไม่มีเกณฑ์) · loading (skeleton) · hover · selected · disabled (`.btn:disabled` → `#e7ebf2` / `#8892a4`) · N/A · ตอบครบ (แถบเขียว + ปุ่มส่งเปิดใช้งาน)

### 7.2 Home (`home.html`)

- greeting + avatar
- `.stat-grid` 4 การ์ด — **เลิกใช้แถบสีหัวการ์ด** เปลี่ยนเป็น **จุดสี 7×7 radius 2px** มุมบนซ้าย
  (`.stat-card::before` → `top:16px;left:15px;width:7px;height:7px;border-radius:2px`)
  ตัวเลข `margin-top:22px` เพื่อเว้นที่ให้จุด · จัดชิดซ้าย (เดิม center)
- `#myTasksSection` — รายการงานที่ได้รับมอบหมาย ใช้ `.card` + `.badge-*`
- ปุ่ม CTA "เริ่มตรวจ 5ส" — `.btn-primary.btn-lg` min-height 52px
- เมนูด่วน — grid 4 คอลัมน์ของ `.card`
- เกณฑ์คะแนน — `.card` + จุดสี 3 ระดับ

### 7.3 Dashboard (`dashboard.html`)

- `.stat-grid` เหมือน Home
- `.chart-container` — panel ขาว radius 14px border hairline
- `.chart-title` .79rem/700 ไอคอนสี primary
- `.ranking-item` — `.rank-number` เป็นสี่เหลี่ยมมน 22×22 radius 7px
  (อันดับ 1 = พื้น amber, อื่นๆ = `#f2f5fa`) · `.rank-bar` สูง 5px
- การ์ดสูงสุด/ต่ำสุด — `border-left:3px solid` สีเขียว/แดง

### 7.4 หน้าอื่น (ใช้คลาสร่วมกัน — style.css ครอบคลุมแล้ว)

`plant.html` `.plant-card` · `area.html` `.area-card` · `summary.html` `.result-card` `.score-circle`
· `history.html` `.history-item` · `assign.html` `.asg-*` · `logs.html` `.log-*` `.lfchip`

## 8. Accessibility (ข้อบังคับ — ห้ามลด)

ทุกข้อความต้องผ่าน **WCAG AA 4.5:1** บนพื้นหลังของตัวเอง
สีที่ห้ามใช้อีก (ต่ำกว่าเกณฑ์): `#80868b` `#7b8798` `#8892a4` `#98a2b3` `#8d99a9`
ใช้ `#5b6572` (7.0:1) หรือ `#667085` (5.9:1) แทน

`--gray-500` และ `--gray-600` ตั้งเป็นค่าเดียวกัน (`#667085`) โดยตั้งใจ
เพื่อกันไม่ให้มีข้อความสีอ่อนหลงเหลือจาก inline style เดิม

tap target ขั้นต่ำ: ปุ่มคะแนน 56px · ปุ่มทั่วไป 40px · ชิป 30px

## 9. Responsive

ชุดนี้เป็น **mobile-only** — ตัด `.desktop-nav` และ `.audit-layout` ออกแล้ว
bottom tab bar แสดงทุกขนาดจอ · จอ ≥600px จำกัดคอนเทนต์ที่ 560px

ถ้าจะทำ desktop 3 คอลัมน์แบบ Outlook ในอนาคต ต้องเพิ่ม markup sidebar ในไฟล์ HTML ด้วย ไม่ใช่แค่ CSS

## 10. Assets

- Sarabun — Google Fonts (มีอยู่แล้วในทุกหน้า)
- Bootstrap Icons 1.11.3 — CDN (มีอยู่แล้ว)
- ไม่มี asset ใหม่ ไม่มีรูปใหม่ ไม่มีไอคอนวาดเอง

## 11. Files

| ไฟล์ | สถานะ |
| --- | --- |
| `css/style.css` | **แทนที่ทั้งไฟล์** ด้วย `design_handoff_5s_ui/style.css` |
| `*.html` | แก้แค่ `?v=23` → `?v=24` |
| `sw.js` | bump cache name ถ้ามี |
| `js/app.js` | **ห้ามแตะ** |

---

# PROMPT — สั่ง Claude Code ตามนี้

คัดลอกทั้งบล็อกนี้ไปวางใน Claude Code ได้เลย

```
บริบท: repo นี้คือระบบตรวจ 5ส (vanilla HTML/CSS/JS + Supabase, PWA, mobile-first, ภาษาไทย)
งาน: ปรับ UI ให้เรียบ-พรีเมียม โดยใช้ design language แบบ Outlook for macOS
ตามที่ระบุใน design_handoff_5s_ui/README.md

ทำตามลำดับนี้ ห้ามข้ามขั้น:

1. อ่าน design_handoff_5s_ui/README.md ทั้งไฟล์ก่อนแตะโค้ด
   จำหัวข้อ "ข้อห้าม" และ "Design Tokens" ให้ได้

2. อ่าน css/style.css เดิม และ js/app.js เฉพาะฟังก์ชัน render
   (renderChecklist, renderCriteriaItem, setScore, updateProgress,
   renderRemainingPanel, renderLogs, renderAssign) เพื่อยืนยันว่า
   คลาสอะไรบ้างที่ JS พึ่งพา — ห้ามลบคลาสเหล่านั้นออกจาก CSS

3. cp design_handoff_5s_ui/style.css css/style.css
   (ไฟล์นี้เขียนเสร็จแล้ว ใช้ชื่อคลาสเดิมครบ — ห้ามเขียนใหม่เอง
    ห้ามแก้ค่าสี/ขนาดที่อยู่ในไฟล์)

4. เปลี่ยน cache-busting version ทุกไฟล์ HTML:
   macOS: sed -i '' 's/style\.css?v=23/style.css?v=24/g; s/app\.js?v=23/app.js?v=24/g' *.html
   Linux: sed -i    's/style\.css?v=23/style.css?v=24/g; s/app\.js?v=23/app.js?v=24/g' *.html
   ยืนยันด้วย: grep -rn "v=23" *.html  (ต้องได้ 0 บรรทัด)

5. เช็ค sw.js — ถ้ามี CACHE name เป็นเวอร์ชัน ให้ bump เป็น v24
   ไม่งั้น PWA ที่ติดตั้งแล้วจะยังเห็น CSS เดิม

6. ไล่ตรวจ inline style ในไฟล์ HTML ที่ขัดกับ design language ใหม่ แล้วแก้:
   - พื้นหลังน้ำเงินทึบขนาดใหญ่ (เช่น card-header ที่ตั้ง background:var(--secondary))
     → เอา inline background ออก ปล่อยให้ .card-header จาก CSS จัดการ
   - ตัวหนังสือสีขาวบน top-nav (audit.html) → ลบ color:#fff และ opacity ออก
     ให้ใช้สีจาก CSS แทน
   - gradient บนโลโก้ login (index.html) → เปลี่ยนเป็นสีทึบ #1b4ea8
   - meta theme-color ทุกหน้า: #1a73e8 → #1b4ea8
   - อีโมจิในตัวเลือกให้คะแนนหรือ badge สถานะ → เอาออก ใช้ Bootstrap Icons แทน
     (เก็บอีโมจิไว้ได้เฉพาะหน้าสรุปผลและตารางเกณฑ์คะแนน)

7. เปิดหน้าเหล่านี้ใน browser แล้วตรวจด้วยตา (mobile viewport 402px):
   index, home, plant, area, audit, summary, history, dashboard, assign, logs
   เช็คทีละหน้าว่า:
   - ไม่มีข้อความล้นหรือตัดบรรทัดกลางวลี (ภาษาไทยยาวกว่าอังกฤษ)
   - ปุ่มคะแนน 0/1/2 สูง 56px และเลือกได้ครบ 3 ค่า
   - ปุ่ม "ไม่มีในพื้นที่" ยังทำงาน (กดแล้วหมวดจาง + ให้คะแนนไม่ได้)
   - bottom tab bar ไม่บังเนื้อหา และ submit bar อยู่เหนือ tab bar พอดี
   - ไม่มี console error

8. ตรวจคอนทราสต์: grep หาสีที่ห้ามใช้ในทั้ง repo
   grep -rn "80868b\|7b8798\|8892a4\|98a2b3\|8d99a9" --include=*.html --include=*.css .
   ถ้าเจอใน inline style ให้เปลี่ยนเป็น #5b6572 (ข้อความ) หรือ #667085 (meta)

9. อย่าแตะ js/app.js เด็ดขาด และอย่าเปลี่ยนชื่อคลาสใน HTML
   ถ้าคิดว่าจำเป็นต้องแก้ ให้หยุดแล้วถามก่อน

10. commit ด้วยข้อความใน design_handoff_5s_ui/APPLY.md ข้อ 4 (ใช้ทั้งบล็อก
    รวม body) แล้วรายงานสรุปว่าแก้ไฟล์อะไรไปบ้าง กี่บรรทัด

ข้อห้ามเด็ดขาด:
- ห้ามเปลี่ยน flow, โครงนำทาง, ระบบคะแนน หรือ logic ใดๆ
- ห้ามเปลี่ยนความหมายสีสถานะ (เขียว=ผ่าน เหลือง=รอ/บางส่วน แดง=ไม่ผ่าน/เกินกำหนด)
- ห้ามเปลี่ยนเกณฑ์ 90/75
- ห้ามลบปุ่ม 0/1/2 หรือปุ่ม "ไม่มีในพื้นที่"
- ห้ามใช้น้ำเงินเป็นพื้นหลังขนาดใหญ่ — ใช้เฉพาะ accent
- ห้ามเพิ่มไลบรารีใหม่ ห้ามเพิ่ม build step
- ห้ามลอกโลโก้/ไอคอน/ข้อความของ Outlook
```
