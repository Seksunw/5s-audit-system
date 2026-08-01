# UI ใหม่ (mobile-only) — วิธีติดตั้ง

ปรับแค่หน้าตา ไม่แตะโครงสร้างหรือฟังก์ชัน — ใช้ชื่อคลาสเดิมทั้งหมด
ไม่ต้องแก้ `js/app.js` และไม่ต้องแก้ markup ในไฟล์ HTML

## 1. วางไฟล์

```bash
cp style.css css/style.css
```

## 2. bump cache version ทุกหน้า (v23 → v24)

macOS (BSD sed):

```bash
sed -i '' 's/style\.css?v=23/style.css?v=24/g; s/app\.js?v=23/app.js?v=24/g' *.html
```

Linux (GNU sed):

```bash
sed -i 's/style\.css?v=23/style.css?v=24/g; s/app\.js?v=23/app.js?v=24/g' *.html
```

ตรวจว่าครบทุกหน้า (ควรได้ 0 บรรทัด):

```bash
grep -rn "v=23" *.html
```

ไฟล์ที่ควรถูกแก้: `index.html` `home.html` `plant.html` `area.html` `audit.html`
`summary.html` `history.html` `dashboard.html` `assign.html` `schedule.html`
`criteria.html` `users.html` `logs.html` `admin.html`

## 3. bump service worker cache (ถ้า sw.js มี CACHE name เป็นเวอร์ชัน)

```bash
grep -n "CACHE" sw.js
```

ถ้ามีบรรทัดแบบ `const CACHE = '5s-v23'` ให้เปลี่ยนเป็น `5s-v24`
ไม่งั้น PWA ที่ติดตั้งแล้วจะยังเห็น CSS เดิม

## 4. commit + push

```bash
git add css/style.css *.html sw.js
git commit -m "$(cat <<'EOF'
redesign(ui): calm premium mobile UI — Outlook-like design language

ปรับเฉพาะชั้นการนำเสนอ ไม่แตะ markup / logic / โครงนำทาง

- accent เปลี่ยนจาก #1a73e8 เป็น #1b4ea8 (น้ำเงินเข้มสุขุม) ใช้เฉพาะ
  selected state, ปุ่ม primary และสถานะสำคัญ
- top nav เปลี่ยนจากแถบน้ำเงินทึบเป็นแถบขาว ตัวหนังสือเข้ม + เส้นคั่นบาง
- พื้นหลังเทาอมฟ้า #edf0f6, panel ขาวมุมโค้ง 14px, เงานุ่มบาง,
  hairline 1px แทนเงาหนาและกรอบสี
- score buttons 0/1/2 เป็น segmented control แบบ macOS สูง 56px
  บนมือถือ (แตะง่ายขณะใส่ถุงมือ) คงสีสถานะเดิม แดง/เหลือง/เขียว
- คอนทราสต์ผ่าน WCAG AA ทุกข้อความ (คำอธิบายเกณฑ์ 7.0:1,
  ข้อความรอง 5.9:1) เพื่ออ่านกลางแดดในโรงงาน
- ลดจำนวนสีในหน้า: stat card เลิกใช้แถบสีหัวการ์ด ใช้จุดสีเล็กแทน
- ปรับ spacing และลำดับ typography ให้ชัดขึ้นทั้งระบบ
- คงไว้ครบ: ปุ่ม 0/1/2, ปุ่ม "ไม่มีในพื้นที่" ระดับหมวด, top nav +
  bottom tab bar, flow เดิม, เกณฑ์ 90/75, สีสถานะเดิม, TH/EN
EOF
)"
git push
```

## 5. rollback ถ้าไม่ชอบ

```bash
git revert HEAD
```

---

## หมายเหตุ

- ไฟล์นี้เป็น **mobile-only**: ตัด desktop sidebar (`.desktop-nav`,
  `.audit-layout`) ออกแล้ว bottom tab bar แสดงทุกขนาดจอ
  จอกว้างจะจำกัดคอนเทนต์ไว้ที่ 560px เพื่อความอ่านง่าย
- ถ้าภายหลังอยากได้ layout หลายคอลัมน์บนเดสก์ท็อป ต้องเพิ่ม markup
  sidebar ในไฟล์ HTML ด้วย (ไม่ใช่แค่ CSS)
- `--gray-500` และ `--gray-600` ตอนนี้เป็นค่าเดียวกัน (`#667085`)
  โดยตั้งใจ เพื่อไม่ให้มีข้อความสีอ่อนเกินเกณฑ์ AA หลงเหลือ
- ถ้ามีที่ไหนใช้ inline style สีจากธีมเดิม (เช่น `background:var(--secondary)`
  บน card-header) จะถูก override โดย `.card-header` แล้ว
