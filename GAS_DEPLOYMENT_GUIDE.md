================================================================================
Google Apps Script - Code.gs 
สำหรับ 5S Audit System Admin User Management
================================================================================

✅ ไฟล์ Code.gs พร้อมใช้งานแล้ว!

มีการปรับปรุง:
1. ✅ เพิ่ม apiCreateUser() - สร้าง user ใหม่
2. ✅ เพิ่ม apiUpdateUser() - อัปเดต user
3. ✅ เพิ่ม apiDeleteUser() - ลบ (ทำ inactive) user
4. ✅ อัปเดต User_Master sheet structure
5. ✅ เพิ่ม Assigned_Plants, Assigned_Areas columns
6. ✅ เพิ่ม Created_Date, Updated_Date columns

================================================================================
วิธีนำไปใช้ใน Google Apps Script
================================================================================

**ขั้นตอนที่ 1: เปิด Google Apps Script Project**
1. ไปที่ https://script.google.com
2. ค้นหา project "5S Audit System" หรือเปิด project ที่มี Deploy URL
3. เปิด Code.gs

**ขั้นตอนที่ 2: Copy-Paste Code**
1. เลือก CODE ทั้งหมดจากไฟล์ Code.gs ในโปรเจกต์นี้
2. ลบ Code เดิมใน Google Apps Script Editor ทั้งหมด
3. Paste Code ใหม่ลงไป

**ขั้นตอนที่ 3: ตรวจสอบ SPREADSHEET_ID**
- บรรทัด 20: CONFIG.SPREADSHEET_ID = '1oTTXfdut9Ek1jbiMgzIPxvVATmzncIQnP0kZ6AQ7Br0'
- ✅ ตรวจสอบว่าตรงกับ Google Sheet ของคุณ

**ขั้นตอนที่ 4: รัน setupSystem() ครั้งแรก**
1. คลิก Run button ที่ด้านบน
2. เลือก setupSystem function
3. รอให้สร้าง Sheets ทั้งหมด (ดูที่ Execution log)
4. ตรวจสอบว่า Google Sheet มี Sheet ใหม่ๆ:
   - Plant_Master
   - Area_Master
   - Criteria_Master
   - Audit_Header
   - Audit_Detail
   - User_Master
   - Schedule_Master
   - Audit_Log
   - Sessions

**ขั้นตอนที่ 5: Deploy as Web App**
1. คลิก "Deploy" > "New deployment"
2. เลือก Type: "Web app"
3. Execute as: "Me" (ผู้ที่สร้าง project)
4. Who has access: "Anyone"
5. คลิก Deploy
6. Copy URL ที่แสดง
7. นำ URL ไป Update ใน js/app.js
   - CONFIG.API_URL = 'https://script.google.com/macros/s/...'

================================================================================
การทำงานของ API Endpoints
================================================================================

1. **GET /getUsers**
   - ดึงข้อมูล user ทั้งหมด
   - ต้องเป็น Admin
   - Response: array of users

2. **POST /createUser**
   - สร้าง user ใหม่
   - ต้องเป็น Admin
   - Body: { name, email, password, role, status, assignedPlants, assignedAreas }
   - Response: { success, userId }

3. **POST /updateUser**
   - อัปเดต user
   - ต้องเป็น Admin
   - Body: { userId, name, email, password?, role, status, assignedPlants, assignedAreas }
   - Response: { success }

4. **POST /deleteUser**
   - ลบ user (mark as inactive)
   - ต้องเป็น Admin
   - Body: { userId }
   - Response: { success }

================================================================================
User_Master Sheet Structure
================================================================================

Column A:  User_ID (เช่น: USR-20260804-ABC001)
Column B:  Employee_ID (ID พนักงาน)
Column C:  Name (ชื่อจริง)
Column D:  Department (แผนก)
Column E:  Email (อีเมล)
Column F:  Password (รหัสผ่าน - hashed SHA256)
Column G:  Role (Admin, Area Manager, Auditor)
Column H:  Status (Active, Inactive)
Column I:  Assigned_Plants (คั่นด้วย comma เช่น: SUP,POC)
Column J:  Assigned_Areas (คั่นด้วย comma เช่น: SUP-WH-F1,SUP-WH-F2)
Column K:  Created_Date (วันสร้าง YYYY-MM-DD)
Column L:  Updated_Date (วันอัปเดตล่าสุด YYYY-MM-DD)

================================================================================
Password Hashing
================================================================================

- ใช้ SHA256 + Base64 encoding
- hashPassword() function ที่ล่างสุด
- ตัวอย่าง:
  hashPassword('admin1234') → 
  'U2FsdGVkX1...' (SHA256 + base64)

- ใน login: ตรวจสอบว่า password ตรงกับ hashed password
- เมื่อสร้าง user ใหม่: admin ตั้ง password เป็น plain text
  → backend hash ให้อัตโนมัติ

================================================================================
Testing the API
================================================================================

**Test ใน Google Apps Script:**

1. เปิด Execution log (บรรทัดล่างสุด)
2. Copy URL deploy ของคุณ
3. ทดสอบ getUsers ใน browser:
   ```
   https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=getUsers&token=YOUR_TOKEN
   ```

**ตัวอย่าง Response:**
```json
{
  "success": true,
  "data": [
    {
      "userId": "USR-20260804-ABC001",
      "name": "Admin System",
      "email": "admin@company.com",
      "role": "Admin",
      "status": "Active",
      "assignedPlants": "SUP,POC,NIF",
      "assignedAreas": "",
      "createdDate": "2026-04-01",
      "updatedDate": "2026-04-01"
    }
  ]
}
```

================================================================================
Troubleshooting
================================================================================

❌ Error: "Missing SPREADSHEET_ID"
✅ ตรวจสอบ config.SPREADSHEET_ID ให้ตรงกับ Google Sheet ID

❌ Error: "Permission denied"
✅ ตรวจสอบว่า Login User มี role = 'Admin'

❌ Error: "User not found"
✅ ตรวจสอบว่า userId ตรงกับฐานข้อมูล User_Master

❌ Sheet ไม่มี columns ใหม่
✅ รัน setupSystem() ใหม่ หรือสร้าง columns manually:
   - Assigned_Plants
   - Assigned_Areas
   - Created_Date
   - Updated_Date

❌ Deploy URL ไม่เปิด
✅ ตรวจสอบว่า deploy "Anyone"

================================================================================
ขั้นตอนต่อจากนี้
================================================================================

1. ✅ Copy Code.gs ไปยัง Google Apps Script
2. ✅ รัน setupSystem() 
3. ✅ Deploy as Web App
4. ✅ Update CONFIG.API_URL ใน js/app.js
5. ✅ ทดสอบ login เป็น Admin
6. ✅ ทดสอบเปิด admin panel (/admin.html)
7. ✅ ทดสอบ CRUD operations (Create, Read, Update, Delete users)

Ready! 🚀
================================================================================
