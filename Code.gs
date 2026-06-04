/**
 * ============================================================
 * Code.gs - Google Apps Script Backend
 * ระบบตรวจ 5ส โรงงาน
 * มาตรฐาน 5ส Draft 2026
 * ============================================================
 * วิธี Deploy:
 * 1. เปิด script.google.com > New Project
 * 2. วางโค้ดนี้ใน Code.gs
 * 3. Deploy > New Deployment > Web App
 * 4. Execute as: Me | Who has access: Anyone
 * 5. Copy URL ไปใส่ใน js/app.js (CONFIG.API_URL)
 * ============================================================
 */

// ============================================================
// CONFIG - แก้ไขค่านี้ตามโปรเจกต์ของคุณ
// ============================================================
const CONFIG = {
  SPREADSHEET_ID: '1oTTXfdut9Ek1jbiMgzIPxvVATmzncIQnP0kZ6AQ7Br0',  // ✅ แก้ไขแล้ว - ใช้ ID เท่านั้น ไม่ใช่ URL
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID_HERE', // โฟลเดอร์ Google Drive สำหรับเก็บรูป
  SESSION_DURATION_HOURS: 8,                     // อายุ Session (ชั่วโมง)
  APP_NAME: '5S Audit System'
};

// Sheet Names
const SHEETS = {
  PLANT_MASTER:    'Plant_Master',
  AREA_MASTER:     'Area_Master',
  CRITERIA_MASTER: 'Criteria_Master',
  AUDIT_HEADER:    'Audit_Header',
  AUDIT_DETAIL:    'Audit_Detail',
  USER_MASTER:     'User_Master',
  SCHEDULE_MASTER: 'Schedule_Master',
  AUDIT_LOG:       'Audit_Log',
  SESSIONS:        'Sessions'
};

// ============================================================
// MAIN ENTRY POINT - รับ HTTP Request ทั้งหมด
// ============================================================

/**
 * จัดการ HTTP GET Request
 */
function doGet(e) {
  return handleRequest(e, 'GET');
}

/**
 * จัดการ HTTP POST Request
 */
function doPost(e) {
  return handleRequest(e, 'POST');
}

/**
 * Router หลักของระบบ
 * รองรับทั้ง GET และ POST พร้อม payload ใน query string
 */
function handleRequest(e, method) {
  try {
    // ดึง action และ token จาก query params ก่อน
    // ถ้ามี payload ใน query string (จาก app.js POST-as-GET) ให้ parse ด้วย
    let action = e.parameter.action || '';
    let token  = e.parameter.token  || '';
    let body   = {};

    // กรณีส่ง payload ผ่าน query string (วิธีหลีกเลี่ยง CORS preflight)
    if (e.parameter.payload) {
      try {
        const parsed = JSON.parse(e.parameter.payload);
        body   = parsed;
        action = action || parsed.action || '';
        token  = token  || parsed.token  || '';
      } catch(pe) {}
    }

    // กรณีส่งผ่าน POST body จริง (รองรับไว้ด้วย)
    if (!body.email && e.postData && e.postData.contents) {
      try {
        const parsed = JSON.parse(e.postData.contents);
        body   = parsed;
        action = action || parsed.action || '';
        token  = token  || parsed.token  || '';
      } catch(pe) {}
    }

    // ถ้า action ว่าง return error
    if (!action) {
      return createResponse({ success: false, error: 'Missing action parameter' });
    }

    // Routes ที่ไม่ต้องการ Authentication
    const publicRoutes = ['login'];

    // ตรวจสอบ Authentication
    if (!publicRoutes.includes(action)) {
      const authResult = validateSession(token);
      if (!authResult.valid) {
        return createResponse({ success: false, error: 'Unauthorized', code: 401 });
      }
    }

    // Route ตาม action
    switch(action) {
      // Auth
      case 'login':               return createResponse(apiLogin(body));
      case 'logout':              return createResponse(apiLogout(token));

      // Master Data
      case 'getPlants':           return createResponse(apiGetPlants());
      case 'getAreas':            return createResponse(apiGetAreas(e.parameter));
      case 'getCriteria':         return createResponse(apiGetCriteria(e.parameter));
      case 'getSchedule':         return createResponse(apiGetSchedule(e.parameter));

      // Audit - แบบ Chunked (แก้ URL too long)
      case 'submitAuditHeader':   return createResponse(apiSubmitAuditHeader(e.parameter));
      case 'submitAuditDetails':  return createResponse(apiSubmitAuditDetails(e.parameter));
      case 'finalizeAudit':       return createResponse(apiFinalizeAudit(e.parameter));

      // Audit - แบบเดิม (fallback)
      case 'submitAudit':         return createResponse(apiSubmitAudit(body));
      case 'getHistory':          return createResponse(apiGetHistory(e.parameter));
      case 'getAuditDetail':      return createResponse(apiGetAuditDetail(e.parameter));

      // Photo
      case 'uploadPhoto':         return createResponse(apiUploadPhoto(body));

      // Dashboard
      case 'getDashboard':        return createResponse(apiGetDashboard(e.parameter));

      // Admin
      case 'getUsers':            return createResponse(apiGetUsers(token));
      case 'createUser':          return createResponse(apiCreateUser(body, token));
      case 'updateUser':          return createResponse(apiUpdateUser(body, token));
      case 'deleteUser':          return createResponse(apiDeleteUser(body, token));

      default:
        return createResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch(err) {
    return createResponse({ success: false, error: err.message });
  }
}

// ============================================================
// AUTHENTICATION API
// ============================================================

/**
 * POST /login
 * Body: { email, password }
 */
function apiLogin(body) {
  const { email, password } = body;

  if (!email || !password) {
    return { success: false, error: 'กรุณากรอก Email และ Password' };
  }

  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.USER_MASTER);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];

  const emailIdx    = headers.indexOf('Email');
  const passwordIdx = headers.indexOf('Password');
  const nameIdx     = headers.indexOf('Name');
  const roleIdx     = headers.indexOf('Role');
  const userIdIdx   = headers.indexOf('User_ID');
  const deptIdx     = headers.indexOf('Department');
  const statusIdx   = headers.indexOf('Status');

  // หาผู้ใช้
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === email &&
        data[i][statusIdx] === 'Active') {

      // ตรวจสอบ password (ใน production ควรใช้ hash)
      const storedPassword = data[i][passwordIdx];
      if (storedPassword === password || storedPassword === hashPassword(password)) {

        // สร้าง Session Token
        const token = createSession(data[i][userIdIdx], email, data[i][roleIdx]);

        // บันทึก Log
        logAction(data[i][userIdIdx], 'LOGIN', 'User logged in');

        return {
          success: true,
          token: token,
          user: {
            userId:     data[i][userIdIdx],
            name:       data[i][nameIdx],
            email:      email,
            role:       data[i][roleIdx],
            department: data[i][deptIdx]
          }
        };
      } else {
        return { success: false, error: 'Password ไม่ถูกต้อง' };
      }
    }
  }

  return { success: false, error: 'ไม่พบผู้ใช้งานในระบบ หรือบัญชีถูกระงับ' };
}

/**
 * POST /logout
 */
function apiLogout(token) {
  deleteSession(token);
  return { success: true, message: 'Logged out successfully' };
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

function createSession(userId, email, role) {
  const token = Utilities.getUuid();
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + CONFIG.SESSION_DURATION_HOURS);

  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.SESSIONS, ['Token','User_ID','Email','Role','Created','Expiry']);

  sheet.appendRow([token, userId, email, role, new Date(), expiry]);

  // เก็บใน CacheService เพื่อความเร็ว
  CacheService.getScriptCache().put(token, JSON.stringify({ userId, email, role }), 28800);

  return token;
}

function validateSession(token) {
  if (!token) return { valid: false };

  // ตรวจ Cache ก่อน
  const cached = CacheService.getScriptCache().get(token);
  if (cached) {
    return { valid: true, ...JSON.parse(cached) };
  }

  // ตรวจ Sheet
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) return { valid: false };

  const data  = sheet.getDataRange().getValues();
  const now   = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      const expiry = new Date(data[i][5]);
      if (now < expiry) {
        const sessionData = { userId: data[i][1], email: data[i][2], role: data[i][3] };
        CacheService.getScriptCache().put(token, JSON.stringify(sessionData), 3600);
        return { valid: true, ...sessionData };
      }
      return { valid: false, error: 'Session expired' };
    }
  }

  return { valid: false };
}

function deleteSession(token) {
  CacheService.getScriptCache().remove(token);
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// ============================================================
// MASTER DATA API
// ============================================================

/**
 * GET /getPlants
 * ดึงข้อมูล Plant ทั้งหมด
 */
function apiGetPlants() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.PLANT_MASTER);
  const data  = sheetToObjects(sheet);
  const plants = data.filter(p => p.Status === 'Active');
  return { success: true, data: plants };
}

/**
 * GET /getAreas?plantId=SUP
 * ดึงข้อมูล Area ตาม Plant
 */
function apiGetAreas(params) {
  const plantId = params.plantId || '';
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.AREA_MASTER);
  const data  = sheetToObjects(sheet);

  let areas = data.filter(a => a.Status === 'Active');
  if (plantId) areas = areas.filter(a => a.Plant_ID === plantId);

  return { success: true, data: areas };
}

/**
 * GET /getCriteria?areaType=Office
 * ดึง Checklist ตามประเภทพื้นที่
 */
function apiGetCriteria(params) {
  const areaType = params.areaType || '';
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.CRITERIA_MASTER);
  const data  = sheetToObjects(sheet);

  let criteria = data.filter(c => c.Active === 'TRUE' || c.Active === true || c.Active === 'Yes');

  // กรองตาม Area Type (รองรับ All และ specific type)
  if (areaType) {
    criteria = criteria.filter(c =>
      c.Area_Type === 'All' ||
      c.Area_Type === areaType ||
      c.Area_Type.split(',').map(t => t.trim()).includes(areaType)
    );
  }

  // จัดกลุ่มตาม Category
  const grouped = {};
  criteria.forEach(c => {
    if (!grouped[c.Category]) grouped[c.Category] = [];
    grouped[c.Category].push(c);
  });

  return {
    success: true,
    data: criteria,
    grouped: grouped,
    totalMaxScore: criteria.reduce((sum, c) => sum + (parseInt(c.Max_Score) || 2), 0)
  };
}

/**
 * GET /getSchedule
 */
function apiGetSchedule(params) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SCHEDULE_MASTER);
  const data  = sheetToObjects(sheet);
  return { success: true, data: data };
}

// ============================================================
// AUDIT API
// ============================================================

/**
 * POST /submitAudit
 * Body: {
 *   plantId, areaId, auditorId, auditDate,
 *   details: [{ criteriaId, score, remark, photoUrl }]
 * }
 */

// ============================================================
// CHUNKED SUBMIT - แก้ปัญหา URL too long (400 Bad Request)
// ส่งข้อมูลเป็น 3 ขั้นตอน แทนการส่งครั้งเดียว
// ============================================================

/**
 * ขั้นที่ 1: บันทึก Audit Header และสร้าง auditId
 * GET ?action=submitAuditHeader&plantId=SUP&areaId=...&auditorId=...&auditDate=...&totalItems=66
 */
function apiSubmitAuditHeader(params) {
  const { plantId, areaId, auditorId, auditDate, totalItems } = params;
  if (!plantId || !areaId || !auditorId) {
    return { success: false, error: 'ข้อมูล Header ไม่ครบ' };
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const auditId = 'AUD-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' +
                  Math.random().toString(36).substring(2, 6).toUpperCase();

  // บันทึก Header ด้วยสถานะ Pending (จะ update เมื่อ finalize)
  const headerSheet = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  headerSheet.appendRow([
    auditId, plantId, areaId, auditorId,
    auditDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    0, 0, 0, 'Pending'
  ]);

  logAction(auditorId, 'AUDIT_START', 'Started audit ' + auditId);
  return { success: true, auditId: auditId };
}

/**
 * ขั้นที่ 2: บันทึก Audit Details เป็น chunk
 * GET ?action=submitAuditDetails&auditId=AUD-xxx&details=[...]
 * ส่งทีละ 15 items เพื่อไม่ให้ URL ยาวเกิน
 */
function apiSubmitAuditDetails(params) {
  const { auditId, details: detailsStr } = params;
  if (!auditId || !detailsStr) {
    return { success: false, error: 'ข้อมูล Details ไม่ครบ' };
  }

  let details;
  try {
    details = JSON.parse(detailsStr);
  } catch(e) {
    return { success: false, error: 'รูปแบบ details ไม่ถูกต้อง' };
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const detailSheet = ss.getSheetByName(SHEETS.AUDIT_DETAIL);

  const rows = details.map((d, idx) => {
    const detailId = auditId + '-' + String(Math.random()).slice(2, 8);
    return [detailId, auditId, d.criteriaId, d.score, d.remark || '', d.photoUrl || ''];
  });

  if (rows.length > 0) {
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }

  return { success: true, saved: rows.length };
}

/**
 * ขั้นที่ 3: คำนวณคะแนนรวมและ Update Header
 * GET ?action=finalizeAudit&auditId=AUD-xxx
 */
function apiFinalizeAudit(params) {
  const { auditId } = params;
  if (!auditId) return { success: false, error: 'Missing auditId' };

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // ดึง Details ทั้งหมดของ audit นี้
  const detailSheet  = ss.getSheetByName(SHEETS.AUDIT_DETAIL);
  const detailData   = sheetToObjects(detailSheet);
  const myDetails    = detailData.filter(d => d.Audit_ID === auditId);

  let totalScore = 0, maxScore = 0;
  myDetails.forEach(d => {
    totalScore += parseInt(d.Score)     || 0;
    maxScore   += 2; // Max_Score ต่อข้อ = 2
  });

  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const status  = percent >= 90 ? 'Excellent' : percent >= 75 ? 'Good' : 'Need Improvement';

  // Update Header row
  const headerSheet = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const headerData  = headerSheet.getDataRange().getValues();
  const hHeaders    = headerData[0];
  const auditIdIdx  = hHeaders.indexOf('Audit_ID');

  for (let i = 1; i < headerData.length; i++) {
    if (headerData[i][auditIdIdx] === auditId) {
      const row = i + 1;
      headerSheet.getRange(row, hHeaders.indexOf('Total_Score') + 1).setValue(totalScore);
      headerSheet.getRange(row, hHeaders.indexOf('Max_Score')   + 1).setValue(maxScore);
      headerSheet.getRange(row, hHeaders.indexOf('Percent')     + 1).setValue(percent);
      headerSheet.getRange(row, hHeaders.indexOf('Status')      + 1).setValue(status);
      break;
    }
  }

  return {
    success: true,
    auditId, totalScore, maxScore, percent, status,
    message: 'บันทึกผลการตรวจเรียบร้อยแล้ว'
  };
}

// ============================================================
// ORIGINAL submitAudit (เก็บไว้เป็น fallback)
// ============================================================
function apiSubmitAudit(body) {
  const { plantId, areaId, auditorId, auditDate, details } = body;

  // Validate
  if (!plantId || !areaId || !auditorId || !details || !details.length) {
    return { success: false, error: 'ข้อมูลไม่ครบถ้วน' };
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // คำนวณคะแนน
  let totalScore = 0;
  let maxScore   = 0;
  details.forEach(d => {
    totalScore += parseInt(d.score) || 0;
    maxScore   += parseInt(d.maxScore) || 2;
  });
  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  // สร้าง Audit_ID
  const auditId = 'AUD-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd') + '-' +
                  Math.random().toString(36).substring(2, 7).toUpperCase();

  // บันทึก Audit Header
  const headerSheet = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const status = percent >= 90 ? 'Excellent' : percent >= 75 ? 'Good' : 'Need Improvement';

  headerSheet.appendRow([
    auditId,
    plantId,
    areaId,
    auditorId,
    auditDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    totalScore,
    maxScore,
    percent,
    status
  ]);

  // บันทึก Audit Detail
  const detailSheet = ss.getSheetByName(SHEETS.AUDIT_DETAIL);
  details.forEach((d, idx) => {
    const detailId = auditId + '-' + String(idx + 1).padStart(3, '0');
    detailSheet.appendRow([
      detailId,
      auditId,
      d.criteriaId,
      d.score,
      d.remark || '',
      d.photoUrl || ''
    ]);
  });

  // Log
  logAction(auditorId, 'SUBMIT_AUDIT', `Audit ${auditId} submitted for ${plantId}/${areaId}`);

  return {
    success: true,
    auditId: auditId,
    totalScore: totalScore,
    maxScore: maxScore,
    percent: percent,
    status: status,
    message: 'บันทึกผลการตรวจเรียบร้อยแล้ว'
  };
}

/**
 * GET /getHistory?plantId=&areaId=&auditorId=&month=&year=
 */
function apiGetHistory(params) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const data  = sheetToObjects(sheet);

  let result = [...data];

  if (params.plantId)   result = result.filter(r => r.Plant_ID === params.plantId);
  if (params.areaId)    result = result.filter(r => r.Area_ID  === params.areaId);
  if (params.auditorId) result = result.filter(r => r.Auditor_ID === params.auditorId);
  if (params.month)     result = result.filter(r => new Date(r.Audit_Date).getMonth() + 1 === parseInt(params.month));
  if (params.year)      result = result.filter(r => new Date(r.Audit_Date).getFullYear() === parseInt(params.year));

  // Sort by date desc
  result.sort((a, b) => new Date(b.Audit_Date) - new Date(a.Audit_Date));

  return { success: true, data: result, total: result.length };
}

/**
 * GET /getAuditDetail?auditId=AUD-xxx
 */
function apiGetAuditDetail(params) {
  const auditId = params.auditId;
  if (!auditId) return { success: false, error: 'Missing auditId' };

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Header
  const headerSheet = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const headers = sheetToObjects(headerSheet).find(h => h.Audit_ID === auditId);

  // Details
  const detailSheet = ss.getSheetByName(SHEETS.AUDIT_DETAIL);
  const details = sheetToObjects(detailSheet).filter(d => d.Audit_ID === auditId);

  // Criteria names
  const criteriaSheet  = ss.getSheetByName(SHEETS.CRITERIA_MASTER);
  const criteriaData   = sheetToObjects(criteriaSheet);
  const criteriaMap    = {};
  criteriaData.forEach(c => criteriaMap[c.Criteria_ID] = c);

  // Enrich details
  const enrichedDetails = details.map(d => ({
    ...d,
    criteria: criteriaMap[d.Criteria_ID] || {}
  }));

  return { success: true, header: headers, details: enrichedDetails };
}

// ============================================================
// PHOTO UPLOAD API
// ============================================================

/**
 * POST /uploadPhoto
 * Body: { base64, filename, mimeType, auditId }
 */
function apiUploadPhoto(body) {
  const { base64, filename, mimeType, auditId } = body;

  if (!base64 || !filename) {
    return { success: false, error: 'Missing photo data' };
  }

  try {
    // Decode base64
    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64.replace(/^data:[^;]+;base64,/, '')),
      mimeType || 'image/jpeg',
      filename
    );

    // Get or create audit subfolder
    const parentFolder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    const subfolderName = auditId || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
    let subfolder;

    const subfolders = parentFolder.getFoldersByName(subfolderName);
    if (subfolders.hasNext()) {
      subfolder = subfolders.next();
    } else {
      subfolder = parentFolder.createFolder(subfolderName);
    }

    // Upload file
    const file = subfolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const url = 'https://drive.google.com/uc?id=' + file.getId() + '&export=view';

    return { success: true, url: url, fileId: file.getId() };
  } catch(err) {
    return { success: false, error: 'Upload failed: ' + err.message };
  }
}

// ============================================================
// DASHBOARD API
// ============================================================

/**
 * GET /getDashboard?plantId=&year=&month=
 */
function apiGetDashboard(params) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const headerSheet = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const areaSheet   = ss.getSheetByName(SHEETS.AREA_MASTER);
  const plantSheet  = ss.getSheetByName(SHEETS.PLANT_MASTER);

  let audits = sheetToObjects(headerSheet);
  const areas  = sheetToObjects(areaSheet);
  const plants = sheetToObjects(plantSheet);

  // Filter
  if (params.plantId) audits = audits.filter(a => a.Plant_ID === params.plantId);
  if (params.year)    audits = audits.filter(a => new Date(a.Audit_Date).getFullYear() === parseInt(params.year));
  if (params.month)   audits = audits.filter(a => new Date(a.Audit_Date).getMonth() + 1 === parseInt(params.month));

  if (!audits.length) {
    return { success: true, data: { totalAudit: 0, avgScore: 0, passRate: 0 } };
  }

  // Summary
  const totalAudit = audits.length;
  const avgScore   = Math.round(audits.reduce((s, a) => s + parseFloat(a.Percent || 0), 0) / totalAudit);
  const passCount  = audits.filter(a => parseFloat(a.Percent) >= 75).length;
  const passRate   = Math.round((passCount / totalAudit) * 100);

  // Plant Comparison
  const plantMap = {};
  plants.forEach(p => { plantMap[p.Plant_ID] = { name: p.Plant_Name, scores: [], count: 0 }; });
  audits.forEach(a => {
    if (plantMap[a.Plant_ID]) {
      plantMap[a.Plant_ID].scores.push(parseFloat(a.Percent || 0));
      plantMap[a.Plant_ID].count++;
    }
  });
  const plantComparison = Object.entries(plantMap).map(([id, v]) => ({
    plantId: id,
    plantName: v.name,
    avgScore: v.scores.length ? Math.round(v.scores.reduce((a,b)=>a+b,0)/v.scores.length) : 0,
    count: v.count
  })).sort((a,b) => b.avgScore - a.avgScore);

  // Area Ranking
  const areaMap = {};
  audits.forEach(a => {
    if (!areaMap[a.Area_ID]) areaMap[a.Area_ID] = { scores: [], areaId: a.Area_ID };
    areaMap[a.Area_ID].scores.push(parseFloat(a.Percent || 0));
  });
  const areaRanking = Object.values(areaMap).map(v => {
    const areaInfo = areas.find(a => a.Area_ID === v.areaId) || {};
    return {
      areaId:   v.areaId,
      areaName: areaInfo.Area_Name || v.areaId,
      plantId:  areaInfo.Plant_ID  || '',
      avgScore: Math.round(v.scores.reduce((a,b)=>a+b,0)/v.scores.length)
    };
  }).sort((a,b) => b.avgScore - a.avgScore);

  // Monthly Trend (last 6 months)
  const monthlyMap = {};
  audits.forEach(a => {
    const d = new Date(a.Audit_Date);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    if (!monthlyMap[key]) monthlyMap[key] = [];
    monthlyMap[key].push(parseFloat(a.Percent || 0));
  });
  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, scores]) => ({
      month,
      avgScore: Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)
    }));

  // Status Distribution
  const excellent = audits.filter(a => parseFloat(a.Percent) >= 90).length;
  const good      = audits.filter(a => parseFloat(a.Percent) >= 75 && parseFloat(a.Percent) < 90).length;
  const needImp   = audits.filter(a => parseFloat(a.Percent) < 75).length;

  return {
    success: true,
    data: {
      totalAudit,
      avgScore,
      passRate,
      excellent,
      good,
      needImprovement: needImp,
      plantComparison,
      areaRanking,
      monthlyTrend,
      lowestArea:  areaRanking[areaRanking.length - 1] || null,
      highestArea: areaRanking[0] || null
    }
  };
}

// ============================================================
// USER MANAGEMENT API - จัดการผู้ใช้งาน
// ============================================================

/**
 * GET /getUsers
 * ดึงข้อมูลผู้ใช้งานทั้งหมด (Admin only)
 */
function apiGetUsers(token) {
  const session = validateSession(token);
  if (session.role !== 'Admin') {
    return { success: false, error: 'Permission denied - Admin only' };
  }

  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.USER_MASTER);
    const data  = sheetToObjects(sheet);

    // ซ่อนรหัสผ่าน และแปลง format
    const users = data.map(u => ({
      userId:           u.User_ID || '',
      name:             u.Name || '',
      email:            u.Email || '',
      role:             u.Role || 'Auditor',
      status:           u.Status || 'Active',
      assignedPlants:   u.Assigned_Plants || '',
      assignedAreas:    u.Assigned_Areas || '',
      createdDate:      u.Created_Date || '',
      updatedDate:      u.Updated_Date || ''
    }));

    return { success: true, data: users };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

/**
 * POST /createUser
 * สร้างผู้ใช้งานใหม่ (Admin only)
 * Body: { name, email, password, role, status, assignedPlants, assignedAreas }
 */
function apiCreateUser(body, token) {
  const session = validateSession(token);
  if (session.role !== 'Admin') {
    return { success: false, error: 'Permission denied - Admin only' };
  }

  try {
    const { name, email, password, role, status, assignedPlants, assignedAreas } = body;

    // Validate required fields
    if (!name || !email || !password) {
      return { success: false, error: 'Missing required fields: name, email, password' };
    }

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.USER_MASTER);
    const data = sheetToObjects(sheet);

    // Check if email already exists
    if (data.some(u => u.Email === email)) {
      return { success: false, error: 'Email already exists' };
    }

    // Generate userId
    const userId = 'USR-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd') +
                   '-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Hash password
    const hashedPassword = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    );

    // Append new user
    const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    sheet.appendRow([
      userId,
      email.split('@')[0],  // Employee_ID (from email)
      name,
      '',                    // Department (empty)
      email,
      hashedPassword,
      role || 'Auditor',
      status || 'Active',
      assignedPlants || '',
      assignedAreas || '',
      now,                   // Created_Date
      now                    // Updated_Date
    ]);

    // Log action
    logAction(session.userId, 'CREATE_USER', `Created user ${userId} (${email})`);

    return {
      success: true,
      userId: userId,
      message: 'User created successfully'
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

/**
 * POST /updateUser
 * อัปเดตข้อมูลผู้ใช้งาน (Admin only)
 * Body: { userId, name, email, password, role, status, assignedPlants, assignedAreas }
 */
function apiUpdateUser(body, token) {
  const session = validateSession(token);
  if (session.role !== 'Admin') {
    return { success: false, error: 'Permission denied - Admin only' };
  }

  try {
    const { userId, name, email, password, role, status, assignedPlants, assignedAreas } = body;

    if (!userId) {
      return { success: false, error: 'Missing userId' };
    }

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.USER_MASTER);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // Find user row
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === userId) {
        rowIndex = i + 1;  // Sheet rows start at 1
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, error: 'User not found' };
    }

    // Update fields
    const userIdIdx = headers.indexOf('User_ID');
    const nameIdx = headers.indexOf('Name');
    const emailIdx = headers.indexOf('Email');
    const passwordIdx = headers.indexOf('Password');
    const roleIdx = headers.indexOf('Role');
    const statusIdx = headers.indexOf('Status');
    const plantsIdx = headers.indexOf('Assigned_Plants');
    const areasIdx = headers.indexOf('Assigned_Areas');
    const updatedIdx = headers.indexOf('Updated_Date');

    if (name) sheet.getRange(rowIndex, nameIdx + 1).setValue(name);
    if (email) sheet.getRange(rowIndex, emailIdx + 1).setValue(email);

    // Only update password if provided
    if (password) {
      const hashedPassword = Utilities.base64Encode(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
      );
      sheet.getRange(rowIndex, passwordIdx + 1).setValue(hashedPassword);
    }

    if (role) sheet.getRange(rowIndex, roleIdx + 1).setValue(role);
    if (status !== undefined) sheet.getRange(rowIndex, statusIdx + 1).setValue(status);
    if (assignedPlants !== undefined) sheet.getRange(rowIndex, plantsIdx + 1).setValue(assignedPlants || '');
    if (assignedAreas !== undefined) sheet.getRange(rowIndex, areasIdx + 1).setValue(assignedAreas || '');

    // Update timestamp
    const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(now);

    // Log action
    logAction(session.userId, 'UPDATE_USER', `Updated user ${userId}`);

    return { success: true, message: 'User updated successfully' };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

/**
 * POST /deleteUser
 * ลบ (ทำให้ inactive) ผู้ใช้งาน (Admin only)
 * Body: { userId }
 */
function apiDeleteUser(body, token) {
  const session = validateSession(token);
  if (session.role !== 'Admin') {
    return { success: false, error: 'Permission denied - Admin only' };
  }

  try {
    const { userId } = body;

    if (!userId) {
      return { success: false, error: 'Missing userId' };
    }

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.USER_MASTER);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // Find user row
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === userId) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, error: 'User not found' };
    }

    // Mark as inactive
    const statusIdx = headers.indexOf('Status');
    const updatedIdx = headers.indexOf('Updated_Date');

    sheet.getRange(rowIndex, statusIdx + 1).setValue('Inactive');

    const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(now);

    // Log action
    logAction(session.userId, 'DELETE_USER', `Deleted (marked inactive) user ${userId}`);

    return { success: true, message: 'User deleted successfully' };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * แปลง Sheet เป็น Array of Objects
 */
function sheetToObjects(sheet) {
  if (!sheet) return [];
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  }).filter(obj => Object.values(obj).some(v => v !== '' && v !== null && v !== undefined));
}

/**
 * สร้าง JSON Response
 */
/**
 * สร้าง JSON Response
 * หมายเหตุ: GAS ContentService ไม่รองรับการ set custom headers
 * GAS จะ set CORS headers ให้อัตโนมัติเมื่อ Deploy เป็น "Anyone"
 */
function createResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Get or Create Sheet
 */
function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

/**
 * บันทึก Audit Log
 */
function logAction(userId, action, detail) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.AUDIT_LOG, ['Log_ID','User','Action','Detail','DateTime']);
    const logId = 'LOG-' + Date.now();
    sheet.appendRow([logId, userId, action, detail, new Date()]);
  } catch(e) { /* fail silently */ }
}

/**
 * Hash password (simple - ใช้ production ควรเปลี่ยนเป็น bcrypt)
 */
function hashPassword(password) {
  return Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password
  ));
}

// ============================================================
// SETUP SCRIPT - รันครั้งเดียวตอน Setup
// ============================================================

/**
 * รันฟังก์ชันนี้ครั้งเดียวเพื่อสร้าง Google Sheet ทั้งหมด
 * วิธีใช้: ใน Apps Script Editor กด Run > setupSystem
 */
function setupSystem() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // 1. Plant_Master
  setupSheet(ss, SHEETS.PLANT_MASTER,
    ['Plant_ID', 'Plant_Name', 'Status'],
    [
      ['SUP', 'Supplement Plant', 'Active'],
      ['POC', 'Personal and Oral Care Plant', 'Active'],
      ['NIF', 'Nutrina Interfoods Plant', 'Active']
    ]
  );

  // 2. Area_Master
  setupSheet(ss, SHEETS.AREA_MASTER,
    ['Area_ID', 'Plant_ID', 'Area_Name', 'Area_Type', 'Status'],
    [
      // SUP
      ['SUP-WH-F1','SUP','Warehouse F1','Warehouse','Active'],
      ['SUP-WH-F2','SUP','Warehouse F2','Warehouse','Active'],
      ['SUP-WH-F3','SUP','Warehouse F3','Warehouse','Active'],
      ['SUP-PR-F1','SUP','Production Line F1','Production','Active'],
      ['SUP-PR-F2','SUP','Production Line F2','Production','Active'],
      ['SUP-PR-F3','SUP','Production Line F3','Production','Active'],
      ['SUP-OF-F1','SUP','Office F1','Office','Active'],
      ['SUP-OF-F2','SUP','Office F2','Office','Active'],
      ['SUP-OF-F3','SUP','Office F3','Office','Active'],
      ['SUP-MU','SUP','Maintenance & Utility','Maintenance','Active'],
      ['SUP-CF','SUP','Cafeteria','Cafeteria','Active'],
      ['SUP-OD','SUP','รอบอาคาร','Outdoor','Active'],
      // POC
      ['POC-WH-F1','POC','Warehouse F1','Warehouse','Active'],
      ['POC-WH-F2','POC','Warehouse F2','Warehouse','Active'],
      ['POC-WH-F3','POC','Warehouse F3','Warehouse','Active'],
      ['POC-PR-F1','POC','Production Line F1','Production','Active'],
      ['POC-PR-F2','POC','Production Line F2','Production','Active'],
      ['POC-PR-F3','POC','Production Line F3','Production','Active'],
      ['POC-OF-F1','POC','Office F1','Office','Active'],
      ['POC-OF-F2','POC','Office F2','Office','Active'],
      ['POC-OF-F3','POC','Office F3','Office','Active'],
      ['POC-MU','POC','Maintenance & Utility','Maintenance','Active'],
      ['POC-CF','POC','Cafeteria','Cafeteria','Active'],
      ['POC-OD','POC','รอบอาคาร','Outdoor','Active'],
      // NIF
      ['NIF-WH-F1','NIF','Warehouse F1','Warehouse','Active'],
      ['NIF-WH-F2','NIF','Warehouse F2','Warehouse','Active'],
      ['NIF-WH-F3','NIF','Warehouse F3','Warehouse','Active'],
      ['NIF-PR-F1','NIF','Production Line F1','Production','Active'],
      ['NIF-PR-F2','NIF','Production Line F2','Production','Active'],
      ['NIF-PR-F3','NIF','Production Line F3','Production','Active'],
      ['NIF-OF-F1','NIF','Office F1','Office','Active'],
      ['NIF-OF-F2','NIF','Office F2','Office','Active'],
      ['NIF-OF-F3','NIF','Office F3','Office','Active'],
      ['NIF-MU','NIF','Maintenance & Utility','Maintenance','Active'],
      ['NIF-CF','NIF','Cafeteria','Cafeteria','Active'],
      ['NIF-OD','NIF','รอบอาคาร','Outdoor','Active']
    ]
  );

  // 3. Criteria_Master - จาก มาตรฐาน 5ส Draft 2026
  setupCriteriaMaster(ss);

  // 4. Audit_Header
  setupSheet(ss, SHEETS.AUDIT_HEADER,
    ['Audit_ID','Plant_ID','Area_ID','Auditor_ID','Audit_Date','Total_Score','Max_Score','Percent','Status'],
    []
  );

  // 5. Audit_Detail
  setupSheet(ss, SHEETS.AUDIT_DETAIL,
    ['Detail_ID','Audit_ID','Criteria_ID','Score','Remark','Photo_URL'],
    []
  );

  // 6. User_Master
  setupSheet(ss, SHEETS.USER_MASTER,
    ['User_ID','Employee_ID','Name','Department','Email','Password','Role','Status','Assigned_Plants','Assigned_Areas','Created_Date','Updated_Date'],
    [
      ['USR-20260804-ABC001','EMP001','Admin System','IT','admin@company.com',hashPassword('admin1234'),'Admin','Active','SUP,POC,NIF','','2026-04-01','2026-04-01'],
      ['USR-20260804-ABC002','EMP002','คุณบอน','QA','bon@company.com',hashPassword('pass1234'),'Auditor','Active','','','2026-04-02','2026-04-02'],
      ['USR-20260804-ABC003','EMP003','คุณเล็ก','QA','lek@company.com',hashPassword('pass1234'),'Auditor','Active','','','2026-04-02','2026-04-02'],
      ['USR-20260804-ABC004','EMP004','คุณมด','Production','mod@company.com',hashPassword('pass1234'),'Auditor','Active','','','2026-04-03','2026-04-03'],
      ['USR-20260804-ABC005','EMP005','คุณแหวน','Production','waen@company.com',hashPassword('pass1234'),'Auditor','Active','','','2026-04-03','2026-04-03'],
      ['USR-20260804-ABC006','EMP006','Manager QA','QA','manager@company.com',hashPassword('pass1234'),'Area Manager','Active','SUP','SUP-WH-F1,SUP-WH-F2','2026-04-04','2026-04-04']
    ]
  );

  // 7. Schedule_Master
  setupSheet(ss, SHEETS.SCHEDULE_MASTER,
    ['Schedule_ID','Audit_Round','Audit_Date','Plant_ID','Area_ID','Auditor_ID','Status'],
    [
      ['SCH-001','Round 1','2026-08-07','SUP','','','Pending'],
      ['SCH-002','Round 1','2026-08-07','POC','','','Pending'],
      ['SCH-003','Round 1','2026-08-07','NIF','','','Pending'],
      ['SCH-004','Round 2','2026-11-06','SUP','','','Pending'],
      ['SCH-005','Round 2','2026-11-06','POC','','','Pending'],
      ['SCH-006','Round 2','2026-11-06','NIF','','','Pending']
    ]
  );

  // 8. Audit_Log
  setupSheet(ss, SHEETS.AUDIT_LOG,
    ['Log_ID','User','Action','Detail','DateTime'],
    []
  );

  // 9. Sessions
  setupSheet(ss, SHEETS.SESSIONS,
    ['Token','User_ID','Email','Role','Created','Expiry'],
    []
  );

  // SpreadsheetApp.getUi() ใช้ไม่ได้เมื่อรันจาก Apps Script Editor
  Logger.log('✅ Setup เสร็จสมบูรณ์! สร้าง ' + Object.keys(SHEETS).length + ' Sheets พร้อมใช้งาน');
}

/**
 * สร้าง Criteria_Master จากมาตรฐาน 5ส Draft 2026
 * ครอบคลุม 33 หัวข้อ + sub-items ทั้งหมด
 */
function setupCriteriaMaster(ss) {
  const headers = ['Criteria_ID','Area_Type','Category','Sub_Category','Question','Description','Max_Score','Active'];

  // Area Types: All, Office, Production, Warehouse, Maintenance, Cafeteria, Outdoor
  const criteria = [
    // ============================================================
    // 1. บอร์ด ป้ายติดประกาศ - ทุกพื้นที่
    // ============================================================
    ['C001-1','All','บอร์ดประชาสัมพันธ์','ข้อมูลบนบอร์ด',
     'ข้อมูลที่เกี่ยวข้องกับกิจกรรม 5ส ติดที่บอร์ดและเป็นข้อมูลที่เป็นปัจจุบัน',
     'บอร์ดมีนโยบาย วัตถุประสงค์ คณะอนุกรรมการ 5ส, คำขวัญ 5ส, ข่าวประชาสัมพันธ์, ภาพก่อน-หลัง, ผลการตรวจ, แผนผังพื้นที่พร้อมผู้รับผิดชอบ',
     2,'TRUE'],
    ['C001-2','All','บอร์ดประชาสัมพันธ์','สภาพบอร์ด',
     'บอร์ดมีสภาพสมบูรณ์ ไม่ชำรุด สะอาด ไม่มีฝุ่นสะสม ไม่มีคราบสกปรกหรือหยากไย่',
     'ตรวจสอบสภาพกายภาพของบอร์ด ความสะอาดและความเป็นระเบียบ',
     2,'TRUE'],

    // ============================================================
    // 2. ความรู้พนักงาน - ทุกพื้นที่
    // ============================================================
    ['C002-1','All','ความรู้พนักงาน','ความรู้ 5ส',
     'พนักงานทุกคนในองค์กรมีความรู้ความเข้าใจเกี่ยวกับหลักการของ 5ส',
     'สัมภาษณ์พนักงานเกี่ยวกับหลักการ 5ส',
     2,'TRUE'],
    ['C002-2','All','ความรู้พนักงาน','การมีส่วนร่วม',
     'พนักงานได้รับข่าวสารในการร่วมกิจกรรมอย่างทั่วถึง สามารถบอกคำขวัญ 5ส ได้',
     'ตรวจสอบการสื่อสารและการมีส่วนร่วมของพนักงาน',
     2,'TRUE'],
    ['C002-3','All','ความรู้พนักงาน','พื้นที่รับผิดชอบ',
     'พนักงานทุกคนรับทราบพื้นที่รับผิดชอบของตนเองและทราบผลการตรวจรอบที่ผ่านมา',
     'สอบถามพนักงานถึงพื้นที่รับผิดชอบ',
     2,'TRUE'],
    ['C002-4','All','ความรู้พนักงาน','ตอบคำถาม',
     'สามารถตอบคำถามและข้อสงสัยต่างๆ เกี่ยวกับกิจกรรม 5ส ได้อย่างตรงประเด็น',
     'สัมภาษณ์เชิงลึกเกี่ยวกับกิจกรรม 5ส',
     2,'TRUE'],

    // ============================================================
    // 3. อุปกรณ์ดับเพลิง - ทุกพื้นที่
    // ============================================================
    ['C003-1','All','อุปกรณ์ดับเพลิง','ตำแหน่งติดตั้ง',
     'ติดตั้งในตำแหน่งที่เหมาะสม ห้ามวางสิ่งของกีดขวางการเข้าถึงถังดับเพลิง',
     'ตรวจสอบตำแหน่งติดตั้งและเส้นทางเข้าถึง',
     2,'TRUE'],
    ['C003-2','All','อุปกรณ์ดับเพลิง','ป้ายบ่งชี้',
     'มีป้ายบ่งชี้ประเภทของถังดับเพลิงและมีป้ายบอกวิธีใช้',
     'ตรวจสอบป้ายที่ชัดเจนและวิธีการใช้งาน',
     2,'TRUE'],
    ['C003-3','All','อุปกรณ์ดับเพลิง','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสม',
     'ตรวจสอบความสะอาดของถังดับเพลิงและตู้เก็บ',
     2,'TRUE'],
    ['C003-4','All','อุปกรณ์ดับเพลิง','สภาพพร้อมใช้',
     'ไม่ชำรุด สภาพพร้อมใช้งานอยู่เสมอ ตรวจสอบตามรอบที่กำหนดโดย จป.วิชาชีพ',
     'ตรวจสอบสติ๊กเกอร์วันตรวจสอบและสภาพอุปกรณ์',
     2,'TRUE'],

    // ============================================================
    // 4. เครื่องทำน้ำเย็น/น้ำร้อน/ตู้เย็น - ทุกพื้นที่
    // ============================================================
    ['C004-1','All','เครื่องทำน้ำเย็น','ความสะอาดตัวเครื่อง',
     'ตัวเครื่องต้องสะอาด ไม่มีฝุ่นเกาะและไม่มีคราบสกปรกใดๆ',
     'ตรวจสอบความสะอาดของตัวเครื่องทุกด้าน',
     2,'TRUE'],
    ['C004-2','All','เครื่องทำน้ำเย็น','สภาพเครื่องและสายไฟ',
     'ตัวเครื่องและสายไฟอยู่ในสภาพสมบูรณ์พร้อมใช้งาน ไม่มีการชำรุด',
     'ตรวจสอบสายไฟและสภาพเครื่องโดยรวม',
     2,'TRUE'],
    ['C004-3','All','เครื่องทำน้ำเย็น','พื้นที่โดยรอบ',
     'สายไฟไม่เกะกะขวางทางเดิน บริเวณโดยรอบต้องสะอาด และไม่มีน้ำหกอยู่บนพื้น',
     'ตรวจสอบพื้นที่รอบเครื่องและการจัดเก็บสาย',
     2,'TRUE'],

    // ============================================================
    // 5. ตู้ยา - ทุกพื้นที่
    // ============================================================
    ['C005-1','All','ตู้ยา','ป้ายบ่งชี้',
     'มีการติดป้ายบ่งชี้ให้มองเห็นอย่างชัดเจน',
     'ตรวจสอบป้ายบ่งชี้ตู้ยา',
     2,'TRUE'],
    ['C005-2','All','ตู้ยา','การจัดเก็บยา',
     'มีการแยกประเภทยา มีป้ายชื่อยา สรรพคุณของยา วิธีการใช้ยาอย่างชัดเจน',
     'ตรวจสอบการจัดเรียงและป้ายกำกับยา',
     2,'TRUE'],
    ['C005-3','All','ตู้ยา','การตรวจสอบอายุยา',
     'มีการตรวจสอบอายุของยา ปริมาณของยาอยู่เสมอ',
     'ตรวจสอบวันหมดอายุของยาและปริมาณยาที่มี',
     2,'TRUE'],
    ['C005-4','All','ตู้ยา','เอกสารบันทึก',
     'มี Check list (กรณีที่ยามีจำนวนมาก) มีบันทึกเบิก-จ่าย',
     'ตรวจสอบ Checklist และบันทึกการเบิกจ่ายยา',
     2,'TRUE'],

    // ============================================================
    // 6. ห้องน้ำ - ทุกพื้นที่
    // ============================================================
    ['C006-1','All','ห้องน้ำ','ป้ายบ่งชี้',
     'มีป้ายบ่งชี้ห้องสามารถเห็นได้ชัดเจน',
     'ตรวจสอบป้ายบอกห้องน้ำ',
     2,'TRUE'],
    ['C006-2','All','ห้องน้ำ','รองเท้า',
     'มีรองเท้าให้เปลี่ยนเข้าห้องน้ำ วางเป็นระเบียบ',
     'ตรวจสอบรองเท้าสำหรับห้องน้ำ',
     2,'TRUE'],
    ['C006-3','All','ห้องน้ำ','ถังขยะ',
     'มีถังขยะฝาปิด/เหมาะสม ไม่ปล่อยให้ล้นถัง',
     'ตรวจสอบสภาพและความเป็นระเบียบของถังขยะ',
     2,'TRUE'],
    ['C006-4','All','ห้องน้ำ','ความสะอาด',
     'ดูแลและรักษาความสะอาดบริเวณห้องน้ำ ห้ามสูบบุหรี่ในห้องน้ำ',
     'ตรวจสอบความสะอาดโดยรวมของห้องน้ำ',
     2,'TRUE'],
    ['C006-5','All','ห้องน้ำ','อุปกรณ์ล้างมือ',
     'มีกระดาษหรือผ้าสะอาดเพื่อทำให้มือแห้ง มีสบู่เหลวเพื่อล้างมือ',
     'ตรวจสอบสบู่และอุปกรณ์เช็ดมือ',
     2,'TRUE'],
    ['C006-6','All','ห้องน้ำ','อุปกรณ์ทำความสะอาด',
     'อุปกรณ์ทำความสะอาดวางอยู่ในพื้นที่ที่กำหนด ไม่มีอุปกรณ์ชำรุด',
     'ตรวจสอบอุปกรณ์ทำความสะอาดในห้องน้ำ',
     2,'TRUE'],

    // ============================================================
    // 7. อุปกรณ์ทำความสะอาด - ทุกพื้นที่
    // ============================================================
    ['C007-1','All','อุปกรณ์ทำความสะอาด','สภาพอุปกรณ์',
     'อุปกรณ์มีสภาพสมบูรณ์ไม่ชำรุด',
     'ตรวจสอบสภาพอุปกรณ์ทำความสะอาด',
     2,'TRUE'],
    ['C007-2','All','อุปกรณ์ทำความสะอาด','การจัดเก็บ',
     'จัดเก็บไว้ในบริเวณที่กำหนด จัดหมวดหมู่และวางให้เป็นระเบียบ ดูสะอาดตา ทำป้ายชี้บ่ง หรือ Layout',
     'ตรวจสอบการจัดเก็บและป้ายชี้บ่ง',
     2,'TRUE'],

    // ============================================================
    // 8. โทรศัพท์ - ทุกพื้นที่
    // ============================================================
    ['C008-1','All','โทรศัพท์','ความสะอาด',
     'มีการทำความสะอาดไม่มีฝุ่น หรือคราบสกปรก',
     'ตรวจสอบความสะอาดของโทรศัพท์',
     2,'TRUE'],
    ['C008-2','All','โทรศัพท์','ตำแหน่งติดตั้ง',
     'ติดตั้งอยู่ในบริเวณที่ใช้งานได้ง่ายไม่มีสิ่งกีดขวาง',
     'ตรวจสอบตำแหน่งและการเข้าถึงโทรศัพท์',
     2,'TRUE'],
    ['C008-3','All','โทรศัพท์','สภาพพร้อมใช้',
     'อุปกรณ์สภาพสมบูรณ์ไม่ชำรุด',
     'ตรวจสอบสภาพโทรศัพท์',
     2,'TRUE'],

    // ============================================================
    // 9. ไฟฉุกเฉิน - ทุกพื้นที่
    // ============================================================
    ['C009-1','All','ไฟฉุกเฉิน','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสม ไม่มีหยากไย่',
     'ตรวจสอบความสะอาดของไฟฉุกเฉิน',
     2,'TRUE'],
    ['C009-2','All','ไฟฉุกเฉิน','สภาพพร้อมใช้',
     'อยู่ในสภาพพร้อมใช้งาน',
     'ทดสอบการทำงานของไฟฉุกเฉิน',
     2,'TRUE'],

    // ============================================================
    // 10. ไฟดักแมลง - ทุกพื้นที่
    // ============================================================
    ['C010-1','All','ไฟดักแมลง','สภาพพร้อมใช้',
     'อยู่ในสภาพพร้อมใช้งาน',
     'ตรวจสอบการทำงานของไฟดักแมลง',
     2,'TRUE'],
    ['C010-2','All','ไฟดักแมลง','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสม ไม่มีหยากไย่',
     'ตรวจสอบความสะอาดและการจัดเก็บแมลงที่ดักไว้',
     2,'TRUE'],

    // ============================================================
    // 11. พื้นที่พักขยะ - ทุกพื้นที่
    // ============================================================
    ['C011-1','All','พื้นที่พักขยะ','ขอบเขตและป้าย',
     'มีขอบเขตกำหนดชัดเจน มีป้ายชี้บ่ง',
     'ตรวจสอบการกำหนดพื้นที่และป้ายชี้บ่ง',
     2,'TRUE'],
    ['C011-2','All','พื้นที่พักขยะ','สภาพถังขยะ',
     'ถังขยะควรมีฝาปิด หรือขยะต้องไม่ล้นออกจากถัง หรือพื้นจัดเก็บ',
     'ตรวจสอบสภาพและปริมาณขยะ',
     2,'TRUE'],
    ['C011-3','All','พื้นที่พักขยะ','แหล่งสะสมสัตว์',
     'ไม่เป็นแหล่งสะสมของสัตว์พาหะ หรือมีความเสี่ยงเป็นแหล่งพักหรือเพาะตัวอ่อนของแมลง',
     'ตรวจสอบสัญญาณของสัตว์พาหะ',
     2,'TRUE'],
    ['C011-4','All','พื้นที่พักขยะ','สภาพพื้นที่',
     'บริเวณพื้นต้องไม่มีน้ำขังสะสม ไม่มีสิ่งสกปรกสะสมบนพื้น',
     'ตรวจสอบพื้นรอบพื้นที่ขยะ',
     2,'TRUE'],

    // ============================================================
    // 12. ISOWALL - Production, Warehouse
    // ============================================================
    ['C012-1','Production,Warehouse','ISOWALL','ความสะอาดบน ISOWALL',
     'ไม่มีขยะ ซากสัตว์ อุปกรณ์ซ่อมบำรุง สะสมอยู่บน ISOWALL',
     'ตรวจสอบบน ISOWALL ว่าไม่มีสิ่งสกปรก',
     2,'TRUE'],
    ['C012-2','Production,Warehouse','ISOWALL','อุปกรณ์ที่ไม่เกี่ยวข้อง',
     'ไม่มีอุปกรณ์ที่ไม่ใช้งาน เช่น ค้อน ตะปู น็อต ปะแจ อยู่บนพื้นที่ ISOWALL',
     'ตรวจสอบสิ่งของที่ไม่ควรอยู่บน ISOWALL',
     2,'TRUE'],
    ['C012-3','Production,Warehouse','ISOWALL','ฝุ่นบน ISOWALL',
     'ไม่มีฝุ่นสะสมจำนวนมาก อยู่บนพื้น ISOWALL',
     'ตรวจสอบปริมาณฝุ่นบน ISOWALL',
     2,'TRUE'],

    // ============================================================
    // 13. บริเวณรอบอาคาร - Outdoor
    // ============================================================
    ['C013-1','Outdoor','รอบอาคาร','ความเป็นระเบียบ',
     'บริเวณรอบๆ อาคาร ต้องมีความเป็นระเบียบ สะอาด ไม่มีกองขยะ สิ่งของที่ไม่เกี่ยวข้อง',
     'ตรวจสอบความเป็นระเบียบรอบอาคาร',
     2,'TRUE'],
    ['C013-2','Outdoor','รอบอาคาร','วัชพืช/หญ้า',
     'ไม่มีวัชพืชขึ้นรกบริเวณรอบอาคารผลิต / ไม่มีหญ้ายาวเกินไปบริเวณรอบอาคาร',
     'ตรวจสอบสภาพพื้นที่สีเขียวรอบอาคาร',
     2,'TRUE'],
    ['C013-3','Outdoor','รอบอาคาร','ท่อระบายน้ำ',
     'ท่อระบายน้ำควรมีฝาปิดและไม่มีขยะสะสม รางระบายน้ำไม่มีวัสดุกีดขวางทางน้ำ',
     'ตรวจสอบฝาปิดท่อระบายน้ำและความสะอาด',
     2,'TRUE'],
    ['C013-4','Outdoor','รอบอาคาร','โครงสร้างอาคาร',
     'โครงสร้างอาคารไม่ชำรุด และไม่เป็นแหล่งอาศัยของสัตว์พาหะ',
     'ตรวจสอบสภาพโครงสร้างภายนอกอาคาร',
     2,'TRUE'],
    ['C013-5','Outdoor','รอบอาคาร','ประตูหนีไฟ',
     'ประตูหนีไฟ ต้องพร้อมใช้งาน มีป้ายชี้บ่ง ไม่ชำรุด ไม่เปิดทิ้งไว้และไม่มีสิ่งกีดขวาง',
     'ตรวจสอบประตูหนีไฟรอบอาคาร',
     2,'TRUE'],

    // ============================================================
    // 14. ตู้/ห้องควบคุมไฟฟ้า - All
    // ============================================================
    ['C014-1','All','ห้องควบคุมไฟฟ้า','ป้ายชี้บ่ง',
     'มีการชี้บ่งตำแหน่งภายในตู้ควบคุมไฟฟ้า/ระบบเครือข่ายอย่างชัดเจน',
     'ตรวจสอบป้ายชี้บ่งในตู้ควบคุม',
     2,'TRUE'],
    ['C014-2','All','ห้องควบคุมไฟฟ้า','สิ่งของรบกวน',
     'ไม่มีวัสดุอุปกรณ์ที่ก่อให้เกิดอันตรายและที่ไม่เกี่ยวข้องอยู่ในห้อง',
     'ตรวจสอบสิ่งของที่ไม่ควรอยู่ในห้องควบคุม',
     2,'TRUE'],
    ['C014-3','All','ห้องควบคุมไฟฟ้า','ความปลอดภัย',
     'สภาพภายในตู้สมบูรณ์ไม่มีจุดที่มีความเสี่ยงต่อความปลอดภัยต่อชีวิตและทรัพย์สิน',
     'ตรวจสอบความปลอดภัยของตู้ควบคุม',
     2,'TRUE'],
    ['C014-4','All','ห้องควบคุมไฟฟ้า','ความสะอาด',
     'พื้นที่และอุปกรณ์ภายในห้องสะอาด รวมถึงภายในตู้ควบคุม ไม่มีหยากไย่ ฝุ่น',
     'ตรวจสอบความสะอาดภายในห้องและตู้ควบคุม',
     2,'TRUE'],
    ['C014-5','All','ห้องควบคุมไฟฟ้า','สภาพห้อง',
     'พื้นที่และสภาพห้องอยู่ในสภาพที่ไม่ก่อให้เกิดอันตราย เช่น พื้น ผนัง ฝ้าเพดาน ไม่ชำรุด',
     'ตรวจสอบสภาพห้องโดยรวม',
     2,'TRUE'],

    // ============================================================
    // 15. ห้องประชุม - Office
    // ============================================================
    ['C015-1','Office','ห้องประชุม','พื้นผนังเพดาน',
     'พื้น ผนัง เพดาน หน้าต่าง ประตูสะอาด ไม่มีฝุ่นสะสม ไม่ชำรุด',
     'ตรวจสอบสภาพและความสะอาดของพื้น ผนัง เพดาน',
     2,'TRUE'],
    ['C015-2','Office','ห้องประชุม','โต๊ะและเก้าอี้',
     'โต๊ะประชุมและเก้าอี้จัดให้เป็นระเบียบเรียบร้อย',
     'ตรวจสอบการจัดวางโต๊ะและเก้าอี้',
     2,'TRUE'],
    ['C015-3','Office','ห้องประชุม','แผนผังการจัด',
     'มีแผนผังการจัดห้องประชุม และการจัดวางวัสดุอุปกรณ์ภายในห้อง แสดงในตำแหน่งที่สังเกตได้',
     'ตรวจสอบแผนผังห้องประชุม',
     2,'TRUE'],
    ['C015-4','Office','ห้องประชุม','กระดาน',
     'กรณีที่มีกระดาน จัดเก็บอุปกรณ์ปากกาแปรงลบกระดานได้โดยสะดวก เหมาะสม',
     'ตรวจสอบการจัดเก็บอุปกรณ์กระดาน',
     2,'TRUE'],
    ['C015-5','Office','ห้องประชุม','อุปกรณ์ไฟฟ้า',
     'อุปกรณ์ไฟฟ้าติดตั้งอย่างเป็นระเบียบ เช่น สายไฟ สายอินเตอร์เน็ต',
     'ตรวจสอบการจัดเก็บสายไฟและอุปกรณ์ไฟฟ้า',
     2,'TRUE'],

    // ============================================================
    // 16. ตู้ล็อคเกอร์ - All
    // ============================================================
    ['C016-1','All','ตู้ล็อคเกอร์','ป้ายชื่อ/รหัส',
     'มีป้ายแสดงชื่อหรือรหัส หรือตำแหน่ง เพื่อบ่งชี้ความเป็นเจ้าของของตู้นั้นๆ',
     'ตรวจสอบป้ายชื่อบนตู้ล็อคเกอร์',
     2,'TRUE'],
    ['C016-2','All','ตู้ล็อคเกอร์','ความสะอาด',
     'ภายใน ภายนอก บนตู้สะอาด ไม่มีฝุ่นสะสม คราบสกปรก',
     'ตรวจสอบความสะอาดทุกส่วนของตู้',
     2,'TRUE'],
    ['C016-3','All','ตู้ล็อคเกอร์','สิ่งของบนตู้',
     'ไม่มีสิ่งของวางบนตู้ หากจำเป็นต้องวาง วางให้เป็นระเบียบ',
     'ตรวจสอบสิ่งของที่วางบนตู้',
     2,'TRUE'],

    // ============================================================
    // 17. ห้องเก็บสารเคมี - All
    // ============================================================
    ['C017-1','All','ห้องสารเคมี','ตำแหน่งจัดเก็บ',
     'กำหนดตำแหน่งในการจัดเก็บสารเคมี มีบริเวณจำเพาะในการจัดเก็บ พร้อมติดป้ายชี้บ่ง',
     'ตรวจสอบการจัดเก็บและป้ายชี้บ่งสารเคมี',
     2,'TRUE'],
    ['C017-2','All','ห้องสารเคมี','เอกสาร SDS',
     'มีเอกสาร SDS หยิบใช้งานได้สะดวก',
     'ตรวจสอบความพร้อมของ SDS',
     2,'TRUE'],
    ['C017-3','All','ห้องสารเคมี','วิธีเตรียมสารเคมี',
     'มีวิธีการเตรียมสารเคมี ณ บริเวณเตรียม หรือหยิบใช้งานได้สะดวก',
     'ตรวจสอบวิธีการเตรียมสารเคมีที่ติดไว้',
     2,'TRUE'],
    ['C017-4','All','ห้องสารเคมี','บันทึกเบิก-จ่าย',
     'มีบันทึกเบิก-จ่าย เป็นปัจจุบัน',
     'ตรวจสอบบันทึกการเบิกจ่ายสารเคมี',
     2,'TRUE'],
    ['C017-5','All','ห้องสารเคมี','การป้องกัน',
     'จัดเก็บล็อคหรือป้องกันบุคคลที่ไม่เกี่ยวข้อง',
     'ตรวจสอบการล็อคและป้องกันการเข้าถึง',
     2,'TRUE'],

    // ============================================================
    // 18. เครื่องถ่ายเอกสาร/เครื่องปริ้น - Office
    // ============================================================
    ['C018-1','Office','เครื่องปริ้น','ความสะอาดและพร้อมใช้',
     'สภาพเครื่องต้องสะอาด อยู่ในสภาพพร้อมใช้งาน',
     'ตรวจสอบความสะอาดและสภาพเครื่องปริ้น',
     2,'TRUE'],
    ['C018-2','Office','เครื่องปริ้น','กระดาษค้าง',
     'ไม่พบกระดาษ หรือเอกสารที่ปริ้นทิ้งไว้อยู่ที่เครื่องถ่ายเอกสาร/เครื่องปริ้น',
     'ตรวจสอบว่าไม่มีเอกสารค้างที่เครื่อง',
     2,'TRUE'],

    // ============================================================
    // 19. พื้นทางเดิน - All
    // ============================================================
    ['C019-1','All','พื้นทางเดิน','ความสะอาด',
     'สะอาด ไม่มีเศษขยะ ผงฝุ่น หรือน้ำบนพื้นทางเดิน',
     'ตรวจสอบความสะอาดพื้นทางเดิน',
     2,'TRUE'],
    ['C019-2','All','พื้นทางเดิน','การจัดวางสิ่งของ',
     'วางของให้เป็นระเบียบ ไม่มีอุปกรณ์ที่ไม่เกี่ยวข้องกับงานวางกีดขวางทางเดิน',
     'ตรวจสอบสิ่งกีดขวางในทางเดิน',
     2,'TRUE'],
    ['C019-3','All','พื้นทางเดิน','การกำหนดขอบเขต',
     'ถ้าจำเป็นต้องวางสิ่งของบริเวณทางเดิน ให้กำหนดขอบเขตพื้นที่ของสิ่งที่วางบนพื้น',
     'ตรวจสอบการกำหนดขอบเขตพื้นที่วางของ',
     2,'TRUE'],

    // ============================================================
    // 20. หน้าต่าง ประตู ผนัง เพดาน - All
    // ============================================================
    ['C020-1','All','หน้าต่าง/ประตู/ผนัง','สภาพ',
     'หน้าต่าง ประตู ผนัง เพดาน อยู่ในสภาพสมบูรณ์ไม่ชำรุด',
     'ตรวจสอบสภาพกายภาพของหน้าต่าง ประตู ผนัง เพดาน',
     2,'TRUE'],
    ['C020-2','All','หน้าต่าง/ประตู/ผนัง','ป้ายสัญลักษณ์',
     'ติดสัญลักษณ์ "ผลัก" "ดึง" "เลื่อน" "ห้ามเปิด" "ชำรุด" ติดไว้ที่ประตู/หน้าต่าง',
     'ตรวจสอบป้ายสัญลักษณ์ประตู/หน้าต่าง',
     2,'TRUE'],
    ['C020-3','All','หน้าต่าง/ประตู/ผนัง','ความสะอาด',
     'สะอาด ไม่มีหยากไย่ ไม่มีคราบสกปรก',
     'ตรวจสอบความสะอาด',
     2,'TRUE'],
    ['C020-4','All','หน้าต่าง/ประตู/ผนัง','การติดกระดาษ',
     'ห้ามติดกระดาษโน๊ต หรือวางของบนขอบประตู หน้าต่าง ผนัง (ยกเว้น Layout หรือป้ายบ่งชี้สถานะ)',
     'ตรวจสอบว่าไม่มีกระดาษโน๊ตหรือสิ่งของที่ไม่เหมาะสม',
     2,'TRUE'],

    // ============================================================
    // 21. หลอดไฟ สวิทซ์ไฟ - All
    // ============================================================
    ['C021-1','All','หลอดไฟ/สวิทซ์ไฟ','สภาพการใช้งาน',
     'สวิทซ์เปิด-ปิด สายไฟและหลอดไฟ ใช้งานได้ดีไม่ชำรุด ไม่มีส่วนแตกหัก มีความปลอดภัย',
     'ทดสอบการทำงานและตรวจสภาพ',
     2,'TRUE'],
    ['C021-2','All','หลอดไฟ/สวิทซ์ไฟ','ความสะอาด',
     'สะอาด ไม่มีหยากไย่ ไม่มีน้ำและคราบฝังลึก',
     'ตรวจสอบความสะอาดหลอดไฟและสวิทซ์',
     2,'TRUE'],
    ['C021-3','All','หลอดไฟ/สวิทซ์ไฟ','ป้าย Layout',
     'ถ้ามีสวิทซ์ไฟมากกว่า 1 สวิทซ์ในแต่ละจุด ให้ระบุตำแหน่ง เปิด-ปิด หรือทำ Layout',
     'ตรวจสอบป้ายระบุตำแหน่งสวิทซ์ไฟ',
     2,'TRUE'],

    // ============================================================
    // 22. พัดลม/เครื่องปรับอากาศ - All
    // ============================================================
    ['C022-1','All','พัดลม/แอร์','ความสะอาดและพร้อมใช้',
     'สะอาด ไม่มีหยากไย่ อยู่ในสภาพสมบูรณ์ สามารถใช้งานได้ตามปกติ มีป้ายแสดงถ้าเสีย',
     'ตรวจสอบความสะอาดและสภาพพัดลม/แอร์',
     2,'TRUE'],
    ['C022-2','All','พัดลม/แอร์','การปิดเมื่อไม่ใช้',
     'ปิดพัดลม-ปิดแอร์ทุกครั้งที่ไม่มีการใช้งาน',
     'ตรวจสอบว่าพัดลม/แอร์ปิดเมื่อไม่มีคนใช้',
     2,'TRUE'],

    // ============================================================
    // 23. เครื่องคอมพิวเตอร์ - Office
    // ============================================================
    ['C023-1','Office','คอมพิวเตอร์','ความสะอาดและสายไฟ',
     'สะอาด ไม่มีฝุ่นสะสม สภาพสมบูรณ์พร้อมใช้งาน ไม่ชำรุด จัดเก็บสายไฟเป็นระเบียบ',
     'ตรวจสอบความสะอาดและการจัดเก็บสาย',
     2,'TRUE'],
    ['C023-2','Office','คอมพิวเตอร์','กระดาษโน๊ต',
     'ไม่ติดกระดาษโน๊ต สติ๊กเกอร์หรือข้อความใดๆ บนเครื่องคอมพิวเตอร์',
     'ตรวจสอบว่าไม่มีกระดาษโน๊ตติดที่เครื่อง',
     2,'TRUE'],

    // ============================================================
    // 24. โต๊ะทำงาน - Office
    // ============================================================
    ['C024-1','Office','โต๊ะทำงาน','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสมหรือคราบสกปรก บนโต๊ะ เก้าอี้ และส่วนหนึ่งส่วนใดของโต๊ะทำงาน',
     'ตรวจสอบความสะอาดโต๊ะและเก้าอี้',
     2,'TRUE'],
    ['C024-2','Office','โต๊ะทำงาน','การจัดวางสิ่งของ',
     'มีการจัดวางสิ่งของเป็นระเบียบ สะดวกในการใช้งาน',
     'ตรวจสอบการจัดวางสิ่งของบนโต๊ะ',
     2,'TRUE'],
    ['C024-3','Office','โต๊ะทำงาน','ใต้โต๊ะ',
     'ใต้โต๊ะทำงาน สามารถวางเคสคอมพิวเตอร์ UPS ถังขยะ หรือมีกล่องได้ไม่เกิน 1 กล่อง',
     'ตรวจสอบความเป็นระเบียบใต้โต๊ะ',
     2,'TRUE'],
    ['C024-4','Office','โต๊ะทำงาน','ลิ้นชัก',
     'ภายในลิ้นชัก มีการจัดวางของเป็นระเบียบ',
     'ตรวจสอบการจัดเก็บในลิ้นชัก',
     2,'TRUE'],
    ['C024-5','Office','โต๊ะทำงาน','ถาดเอกสาร',
     'กรณีมีถาดเอกสารหรือชั้นเอกสาร ทำป้ายชี้บ่งเพื่อระบุการจัดเก็บในแต่ละชั้น',
     'ตรวจสอบป้ายชี้บ่งถาดเอกสาร',
     2,'TRUE'],
    ['C024-6','Office','โต๊ะทำงาน','เก้าอี้',
     'เลื่อนเก้าอี้ไว้ใต้โต๊ะทุกครั้งที่ลุกออกจากที่นั่ง',
     'ตรวจสอบว่าเก้าอี้ถูกเลื่อนเข้าโต๊ะ',
     2,'TRUE'],

    // ============================================================
    // 25. ตู้เอกสาร - Office
    // ============================================================
    ['C025-1','Office','ตู้เอกสาร','รหัสและชื่อ',
     'กำหนดรหัส/ชื่อของตู้และชั้นวางแฟ้มเอกสารของตู้เก็บเอกสารให้ง่ายต่อการค้นหา',
     'ตรวจสอบรหัสและชื่อตู้เอกสาร',
     2,'TRUE'],
    ['C025-2','Office','ตู้เอกสาร','ความสะอาด',
     'ภายนอกตู้ ภายในตู้และบนตู้ต้องสะอาด',
     'ตรวจสอบความสะอาดของตู้เอกสาร',
     2,'TRUE'],
    ['C025-3','Office','ตู้เอกสาร','การจัดเก็บเอกสาร',
     'เอกสารภายในตู้ที่ไม่ได้อยู่ในแฟ้ม จัดวางไว้เป็นหมวดหมู่ เป็นระเบียบ',
     'ตรวจสอบการจัดเก็บเอกสาร',
     2,'TRUE'],
    ['C025-4','Office','ตู้เอกสาร','ของบนตู้',
     'ในกรณีมีการจัดวางสิ่งของบนตู้ให้จัดวางอย่างเป็นระเบียบ มีความปลอดภัย',
     'ตรวจสอบสิ่งของที่วางบนตู้',
     2,'TRUE'],
    ['C025-5','Office','ตู้เอกสาร','สันแฟ้ม',
     'กำหนดชื่อแฟ้มเอกสาร จัดทำสันแฟ้มเอกสาร มีตราสัญลักษณ์ ชื่อหน่วยงาน รหัสดัชนี',
     'ตรวจสอบสันแฟ้มเอกสาร',
     2,'TRUE'],
    ['C025-6','Office','ตู้เอกสาร','การเรียงแฟ้ม',
     'จัดประเภท หมวดหมู่ เรียงลำดับแฟ้มตามรหัสดัชนีหรือหมายเลขกำกับต่อเนื่องกัน',
     'ตรวจสอบการเรียงลำดับแฟ้มเอกสาร',
     2,'TRUE'],

    // ============================================================
    // 26. ห้องแต่งตัว - Production
    // ============================================================
    ['C026-1','Production','ห้องแต่งตัว','ความสะอาด',
     'พื้น อ่างล้างมือ อุปกรณ์ทำให้มือแห้ง ชั้นวางรองเท้า ตู้ล็อกเกอร์สะอาด เรียบร้อย',
     'ตรวจสอบความสะอาดในห้องแต่งตัว',
     2,'TRUE'],
    ['C026-2','Production','ห้องแต่งตัว','สบู่และวิธีล้างมือ',
     'สบู่เหลวล้างมือเพียงพอ มีวิธีการล้างมือที่ถูกต้องติดให้เห็นชัดเจน',
     'ตรวจสอบสบู่และป้ายวิธีล้างมือ',
     2,'TRUE'],
    ['C026-3','Production','ห้องแต่งตัว','วิธีแต่งตัว',
     'มีวิธีการแต่งตัวสำหรับเข้าพื้นที่แต่ละพื้นที่อย่างเหมาะสม ก่อนเข้าพื้นที่นั้นๆ',
     'ตรวจสอบป้ายวิธีการแต่งตัว',
     2,'TRUE'],
    ['C026-4','Production','ห้องแต่งตัว','ตู้เก็บชุด',
     'ชี้บ่งตู้เก็บชุดให้ชัดเจน และจัดเก็บให้ถูกต้องตามป้ายที่ระบุไว้',
     'ตรวจสอบป้ายชี้บ่งตู้เก็บชุดและการจัดเก็บ',
     2,'TRUE'],
    ['C026-5','Production','ห้องแต่งตัว','สิ่งของไม่เกี่ยวข้อง',
     'ไม่มีอุปกรณ์ที่ไม่เกี่ยวข้องในพื้นที่',
     'ตรวจสอบว่าไม่มีสิ่งของที่ไม่เกี่ยวข้อง',
     2,'TRUE'],

    // ============================================================
    // 27. โต๊ะปฏิบัติงาน - Production
    // ============================================================
    ['C027-1','Production','โต๊ะปฏิบัติงาน','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสม ไม่มีของที่ไม่เกี่ยวข้องกับงานวางไว้บนโต๊ะ',
     'ตรวจสอบความสะอาดโต๊ะปฏิบัติงาน',
     2,'TRUE'],
    ['C027-2','Production','โต๊ะปฏิบัติงาน','สภาพพร้อมใช้',
     'อยู่ในสภาพพร้อมใช้งาน ไม่ชำรุด',
     'ตรวจสอบสภาพโต๊ะปฏิบัติงาน',
     2,'TRUE'],
    ['C027-3','Production','โต๊ะปฏิบัติงาน','หลังการใช้งาน',
     'หลังปฏิบัติงาน/ไม่มีการใช้งานบนโต๊ะ ต้องเก็บสิ่งของบนโต๊ะให้เป็นระเบียบเรียบร้อย',
     'ตรวจสอบการจัดเก็บหลังใช้งาน',
     2,'TRUE'],

    // ============================================================
    // 28. ห้องผลิต - Production
    // ============================================================
    ['C028-1','Production','ห้องผลิต','การแบ่งส่วน',
     'มีการแบ่งส่วนต่างๆ ของห้องผลิตออกเป็นส่วนๆ อย่างชัดเจนตามการปฎิบัติงานจริง',
     'ตรวจสอบการแบ่งพื้นที่ในห้องผลิต',
     2,'TRUE'],
    ['C028-2','Production','ห้องผลิต','ป้ายชื่อห้อง',
     'มีป้ายชื่อห้องติดไว้ที่หน้าห้อง',
     'ตรวจสอบป้ายชื่อห้องผลิต',
     2,'TRUE'],
    ['C028-3','Production','ห้องผลิต','ความสะอาดและบันทึก',
     'สะอาด ไม่มีฝุ่นสะสม หยากไย่ และมีบันทึกการทำความสะอาด บันทึกอื่นๆ ที่เกี่ยวข้อง อัพเดตปัจจุบัน',
     'ตรวจสอบความสะอาดและบันทึกการดูแล',
     2,'TRUE'],
    ['C028-4','Production','ห้องผลิต','สภาพห้อง',
     'สภาพห้องสมบูรณ์เหมาะสมกับการผลิต',
     'ตรวจสอบสภาพโดยรวมของห้องผลิต',
     2,'TRUE'],
    ['C028-5','Production','ห้องผลิต','สิ่งของไม่เกี่ยวข้อง',
     'ไม่มีสิ่งของที่ไม่เกี่ยวข้องกับการทำงานอยู่ในบริเวณผลิต',
     'ตรวจสอบสิ่งของที่ไม่เกี่ยวข้อง',
     2,'TRUE'],
    ['C028-6','Production','ห้องผลิต','ป้ายสถานะการทำงาน',
     'ติดป้ายแสดงสถานะการทำงาน (การทำงานต้องตรงตามป้ายสถานะที่ระบุไว้)',
     'ตรวจสอบป้ายสถานะและความตรงกับการปฏิบัติจริง',
     2,'TRUE'],

    // ============================================================
    // 29. เครื่องจักร - Production, Maintenance
    // ============================================================
    ['C029-1','Production,Maintenance','เครื่องจักร','ตำแหน่งติดตั้ง',
     'การติดตั้งเครื่องจักร/จุดวาง เหมาะสมกับการใช้งาน สะดวกต่อการเข้าบำรุงรักษา',
     'ตรวจสอบตำแหน่งและการเข้าถึงเครื่องจักร',
     2,'TRUE'],
    ['C029-2','Production,Maintenance','เครื่องจักร','ป้ายรหัสเครื่องจักร',
     'มีป้ายบ่งบอกรหัสเครื่องจักรแสดงบริเวณที่เครื่องจักรติดตั้งอยู่ตาม Layout',
     'ตรวจสอบป้ายรหัสและ Layout เครื่องจักร',
     2,'TRUE'],
    ['C029-3','Production,Maintenance','เครื่องจักร','คู่มือการใช้งาน',
     'มีคู่มือการปฏิบัติงานหรือวิธีควบคุมเครื่องและการบำรุงรักษาเบื้องต้น หยิบใช้งานได้สะดวก',
     'ตรวจสอบความพร้อมของคู่มือเครื่องจักร',
     2,'TRUE'],
    ['C029-4','Production,Maintenance','เครื่องจักร','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสม ไม่มีคราบสกปรก และมีบันทึกการตรวจสอบสภาพเครื่องจักรเป็นประจำ',
     'ตรวจสอบความสะอาดและบันทึกการตรวจ',
     2,'TRUE'],
    ['C029-5','Production,Maintenance','เครื่องจักร','อุปกรณ์ไม่เกี่ยวข้อง',
     'ไม่มีอุปกรณ์อื่นๆ ที่ไม่เกี่ยวกับเครื่องหรือการทำงานวางปะปนอยู่กับเครื่องจักร',
     'ตรวจสอบสิ่งของที่ไม่ควรอยู่กับเครื่องจักร',
     2,'TRUE'],
    ['C029-6','Production,Maintenance','เครื่องจักร','สภาพพร้อมใช้',
     'เครื่องจักรอยู่ในสภาพพร้อมใช้งาน หากชำรุด/เสีย ต้องมีป้ายบ่งชี้สถานะรอซ่อม',
     'ตรวจสอบสภาพและป้ายสถานะเครื่องจักร',
     2,'TRUE'],

    // ============================================================
    // 30. วัตถุดิบ/ผลิตภัณฑ์/พาเลท - Warehouse, Production
    // ============================================================
    ['C030-1','Warehouse,Production','วัตถุดิบ/ผลิตภัณฑ์','ป้ายชี้บ่งสถานะ',
     'มีป้ายชี้บ่งการจำแนก แสดงสถานะของผลิตภัณฑ์ วัตถุดิบ และพาเลท อย่างชัดเจน',
     'ตรวจสอบป้ายสถานะวัตถุดิบและผลิตภัณฑ์',
     2,'TRUE'],
    ['C030-2','Warehouse,Production','วัตถุดิบ/ผลิตภัณฑ์','ขอบเขตพื้นที่',
     'กำหนดขอบเขตของพื้นที่การวางผลิตภัณฑ์ วัตถุดิบ พาเลท อย่างชัดเจน',
     'ตรวจสอบการกำหนดขอบเขตพื้นที่จัดเก็บ',
     2,'TRUE'],
    ['C030-3','Warehouse,Production','วัตถุดิบ/ผลิตภัณฑ์','สภาพภาชนะ',
     'ตะกร้า กะบะใส่สินค้า พาเลท อยู่ในสภาพพร้อมใช้งาน ไม่แตกหัก จัดเก็บในพื้นที่ที่กำหนด',
     'ตรวจสอบสภาพภาชนะและพาเลท',
     2,'TRUE'],
    ['C030-4','Warehouse,Production','วัตถุดิบ/ผลิตภัณฑ์','ความสะอาด',
     'ชั้นวางวัตถุดิบ บรรจุภัณฑ์ กะบะ ตะกร้า พาเลทสะอาด ไม่มีฝุ่นสะสม ไม่มีหยากไย่',
     'ตรวจสอบความสะอาดชั้นวางและภาชนะ',
     2,'TRUE'],
    ['C030-5','Warehouse,Production','วัตถุดิบ/ผลิตภัณฑ์','การวางตามข้อกำหนด',
     'การวางวัตถุดิบและภาชนะบรรจุผลิตภัณฑ์วางถูกต้องตามข้อกำหนด มีความปลอดภัย',
     'ตรวจสอบว่าวางบนพาเลท ห่างจากผนังตามกำหนด',
     2,'TRUE'],

    // ============================================================
    // 31. รถเข็น/แฮนด์ลิฟท์ - Warehouse, Production
    // ============================================================
    ['C031-1','Warehouse,Production','รถเข็น/แฮนด์ลิฟท์','สภาพพร้อมใช้',
     'รถเข็น รถใส่งาน แฮนด์ลิฟท์ รถยกไฟฟ้าต้องอยู่ในสภาพพร้อมใช้งาน ไม่ชำรุด',
     'ตรวจสอบสภาพรถเข็นและอุปกรณ์ขนส่ง',
     2,'TRUE'],
    ['C031-2','Warehouse,Production','รถเข็น/แฮนด์ลิฟท์','จุดจอด',
     'กำหนดจุดจอดรถให้ชัดเจน/ระบุใน Layout',
     'ตรวจสอบการกำหนดจุดจอดและการปฏิบัติ',
     2,'TRUE'],
    ['C031-3','Warehouse,Production','รถเข็น/แฮนด์ลิฟท์','ความสะอาด',
     'สะอาด ไม่มีฝุ่นสะสม ไม่พบคราบน้ำมันสะสม (แฮนด์ลิฟท์ รถยกไฟฟ้า)',
     'ตรวจสอบความสะอาดรถเข็นและแฮนด์ลิฟท์',
     2,'TRUE'],
    ['C031-4','Warehouse,Production','รถเข็น/แฮนด์ลิฟท์','สิ่งของค้างบนรถ',
     'ไม่มีอุปกรณ์ใดๆ หรือสิ่งของที่ไม่เกี่ยวข้องวางบนรถเข็นเมื่อไม่ใช้งาน',
     'ตรวจสอบว่าไม่มีสิ่งของค้างบนรถเข็น',
     2,'TRUE'],

    // ============================================================
    // 32. ห้องล้างอุปกรณ์ - Production
    // ============================================================
    ['C032-1','Production','ห้องล้างอุปกรณ์','สภาพห้อง',
     'สภาพห้องสมบูรณ์ พื้นห้อง ผนัง เพดาน ไม่ชำรุด ไม่มีรูหรือช่องต่างๆ',
     'ตรวจสอบสภาพโครงสร้างห้องล้างอุปกรณ์',
     2,'TRUE'],
    ['C032-2','Production','ห้องล้างอุปกรณ์','ความสะอาด',
     'พื้นไม่มีน้ำขัง ผนัง เพดาน สะอาด ไม่เป็นแหล่งสะสมของคราบสกปรก',
     'ตรวจสอบความสะอาดพื้น ผนัง เพดานห้องล้าง',
     2,'TRUE'],
    ['C032-3','Production','ห้องล้างอุปกรณ์','สายยาง',
     'สายยางจัดเก็บเรียบร้อยไม่วางกับพื้น',
     'ตรวจสอบการจัดเก็บสายยาง',
     2,'TRUE'],
    ['C032-4','Production','ห้องล้างอุปกรณ์','อุปกรณ์ทำความสะอาด',
     'รถเข็นถังบีบผ้าม็อบและอุปกรณ์ทำความสะอาด จัดเก็บในพื้นที่ที่กำหนด สภาพพร้อมใช้งาน',
     'ตรวจสอบการจัดเก็บอุปกรณ์ทำความสะอาด',
     2,'TRUE'],

    // ============================================================
    // 33. โรงอาหาร - Cafeteria
    // ============================================================
    ['C033-1','Cafeteria','โรงอาหาร','ความสะอาดพื้น',
     'สะอาด ไม่มีผงฝุ่น หรือน้ำบนพื้น ไม่มีกลิ่น ไม่มีเศษขยะและเศษอาหารตกอยู่',
     'ตรวจสอบความสะอาดพื้นโรงอาหาร',
     2,'TRUE'],
    ['C033-2','Cafeteria','โรงอาหาร','สิ่งของไม่เกี่ยวข้อง',
     'ไม่มีสิ่งของที่ไม่เกี่ยวข้อง เช่น เครื่องจักรในบริเวณโรงอาหาร',
     'ตรวจสอบว่าไม่มีสิ่งของไม่เกี่ยวข้อง',
     2,'TRUE'],
    ['C033-3','Cafeteria','โรงอาหาร','โต๊ะเก้าอี้',
     'โต๊ะเก้าอี้ไม่ชำรุด',
     'ตรวจสอบสภาพโต๊ะและเก้าอี้โรงอาหาร',
     2,'TRUE'],
    ['C033-4','Cafeteria','โรงอาหาร','อุปกรณ์ครัว',
     'โต๊ะอาหาร โต๊ะเตรียมอาหาร ชั้นวางจาน เครื่องใช้ในครัว สะอาดและจัดวางเป็นระเบียบ',
     'ตรวจสอบความสะอาดและระเบียบอุปกรณ์ครัว',
     2,'TRUE'],
    ['C033-5','Cafeteria','โรงอาหาร','เครื่องใช้ไฟฟ้าครัว',
     'อุปกรณ์เครื่องครัวสะอาด ได้แก่ หม้อหุงข้าว ไมโครเวฟ กระติกน้ำร้อน (ถ้ามี)',
     'ตรวจสอบความสะอาดเครื่องใช้ไฟฟ้าในครัว',
     2,'TRUE'],
    ['C033-6','Cafeteria','โรงอาหาร','ถังขยะ',
     'ถังขยะมีฝาปิดมิดชิด หากไม่มีฝาปิดขยะต้องไม่ล้นออกจากถัง',
     'ตรวจสอบสภาพถังขยะโรงอาหาร',
     2,'TRUE'],
    ['C033-7','Cafeteria','โรงอาหาร','ปลั๊กไฟ/สายไฟ',
     'ปลั๊กไฟ สวิทซ์ไฟ สายไฟ ปลั๊กพ่วงอยู่ในสภาพพร้อมใช้ไม่ชำรุด',
     'ตรวจสอบสายไฟและปลั๊กในโรงอาหาร',
     2,'TRUE'],
    ['C033-8','Cafeteria','โรงอาหาร','โครงสร้างเพดาน/ผนัง',
     'โครงสร้างเพดาน ผนังสะอาดไม่มีหยากไย่สะสม ไม่มีนกตายบนเน็ต',
     'ตรวจสอบเพดานและผนังโรงอาหาร',
     2,'TRUE'],
    ['C033-9','Cafeteria','โรงอาหาร','ความสะอาดโดยรวม',
     'โรงอาหารสะอาด ไม่มีกลิ่น บรรยากาศน่ารับประทานอาหาร',
     'ประเมินความสะอาดโดยรวมของโรงอาหาร',
     2,'TRUE']
  ];

  setupSheet(ss, SHEETS.CRITERIA_MASTER, headers, criteria);
}

/**
 * Helper: สร้าง Sheet พร้อมข้อมูล
 */
function setupSheet(ss, name, headers, data) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clearContents();
  }

  sheet.appendRow(headers);

  if (data && data.length) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  // Format header row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1a73e8');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');

  // Auto-resize columns
  sheet.autoResizeColumns(1, headers.length);

  Logger.log('Setup sheet: ' + name);
  return sheet;
}
