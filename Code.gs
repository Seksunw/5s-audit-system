/**
 * ============================================================
 * Code.gs - Google Apps Script Backend
 * ระบบตรวจ 5ส โรงงาน | มาตรฐาน 5ส Draft 2026
 * Version 1.2 — Bug Fix (BUG-001~014)
 * ============================================================
 */

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  SPREADSHEET_ID: '1oTTXfdut9Ek1jbiMgzIPxvVATmzncIQnP0kZ6AQ7Br0',
  // DRIVE_FOLDER_ID อ่านจาก Script Properties (รัน setupDriveFolder() ครั้งเดียว)
  get DRIVE_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID') || '';
  },
  SESSION_DURATION_HOURS: 8,
  APP_NAME: '5S Audit System'
};

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
// ENTRY POINTS
// ============================================================
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    let action = e.parameter.action || '';
    let token  = e.parameter.token  || '';
    let body   = {};

    // รับ payload จาก query string (POST-as-GET)
    if (e.parameter.payload) {
      try {
        const p = JSON.parse(e.parameter.payload);
        body   = p;
        action = action || p.action || '';
        token  = token  || p.token  || '';
      } catch(pe) {}
    }

    // รับ payload จาก POST body
    if (e.postData && e.postData.contents) {
      try {
        const p = JSON.parse(e.postData.contents);
        if (!body.email) body = p;
        action = action || p.action || '';
        token  = token  || p.token  || '';
      } catch(pe) {}
    }

    if (!action) return createResponse({ success: false, error: 'Missing action' });

    // Public routes
    const publicRoutes = ['login'];
    let auth = { valid: false };
    if (!publicRoutes.includes(action)) {
      auth = validateSession(token);
      if (!auth.valid) return createResponse({ success: false, error: 'Unauthorized', code: 401 });
    }

    // Router — ส่ง auth ไปใช้ใน functions ที่ต้องการ (FIX BUG-006: ไม่ต้อง validateSession ซ้ำ)
    switch(action) {
      case 'login':              return createResponse(apiLogin(body));
      case 'logout':             return createResponse(apiLogout(token));
      case 'getPlants':          return createResponse(apiGetPlants());
      case 'getAreas':           return createResponse(apiGetAreas(e.parameter, auth));
      case 'getCriteria':        return createResponse(apiGetCriteria(e.parameter));
      case 'getSchedule':        return createResponse(apiGetSchedule(e.parameter));
      case 'submitAuditHeader':  return createResponse(apiSubmitAuditHeader(e.parameter, auth));
      case 'submitAuditDetails': return createResponse(apiSubmitAuditDetails(e.parameter));
      case 'finalizeAudit':      return createResponse(apiFinalizeAudit(e.parameter));
      case 'submitAudit':        return createResponse(apiSubmitAudit(body, auth));
      case 'getHistory':         return createResponse(apiGetHistory(e.parameter));
      case 'getAuditDetail':     return createResponse(apiGetAuditDetail(e.parameter));
      case 'uploadPhoto':        return createResponse(apiUploadPhoto(body));
      case 'getDashboard':       return createResponse(apiGetDashboard(e.parameter));
      case 'getUsers':           return createResponse(apiGetUsers(auth, e.parameter));
      // saveUser รับจาก body (POST) เพื่อให้ password ไม่ปรากฏใน URL
      case 'saveUser':           return createResponse(apiSaveUser(Object.assign({}, e.parameter, body), auth));
      case 'getScheduleAdmin':   return createResponse(apiGetScheduleAdmin(auth));
      case 'saveSchedule':       return createResponse(apiSaveSchedule(Object.assign({}, e.parameter, body), auth));
      case 'deleteSchedule':     return createResponse(apiDeleteSchedule(e.parameter, auth));
      default:                   return createResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch(err) {
    return createResponse({ success: false, error: err.message });
  }
}

// ============================================================
// AUTH
// ============================================================
function apiLogin(body) {
  const { email, password } = body;
  if (!email || !password) return { success: false, error: 'กรุณากรอก Email และ Password' };

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(SHEETS.USER_MASTER);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  const emailIdx    = headers.indexOf('Email');
  const passwordIdx = headers.indexOf('Password');
  const nameIdx     = headers.indexOf('Name');
  const roleIdx     = headers.indexOf('Role');
  const userIdIdx   = headers.indexOf('User_ID');
  const deptIdx     = headers.indexOf('Department');
  const statusIdx   = headers.indexOf('Status');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).toLowerCase().trim() === email.toLowerCase().trim()
        && data[i][statusIdx] === 'Active') {

      const storedPassword = String(data[i][passwordIdx] || '');
      const hashedInput    = hashPassword(password);

      // FIX BUG-001: รับเฉพาะ hashed password เท่านั้น (ไม่รับ plain text)
      if (storedPassword === hashedInput) {
        // Normalize role to Title Case (admin → Admin, auditor → Auditor)
        const rawRole = String(data[i][roleIdx] || '').trim();
        const normRole = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();
        const token = createSession(data[i][userIdIdx], email, normRole);
        logAction(data[i][userIdIdx], 'LOGIN', 'Logged in');
        return {
          success: true, token,
          user: {
            userId:     data[i][userIdIdx],
            name:       data[i][nameIdx],
            email,
            role:       normRole,
            department: data[i][deptIdx]
          }
        };
      } else {
        return { success: false, error: 'Password ไม่ถูกต้อง' };
      }
    }
  }
  return { success: false, error: 'ไม่พบผู้ใช้งาน หรือบัญชีถูกระงับ' };
}

function apiLogout(token) {
  deleteSession(token);
  return { success: true };
}

// ============================================================
// SESSION
// ============================================================
function createSession(userId, email, role) {
  const token  = Utilities.getUuid();
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + CONFIG.SESSION_DURATION_HOURS);
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEETS.SESSIONS, ['Token','User_ID','Email','Role','Created','Expiry']);

  // FIX BUG-008: ลบ sessions ที่หมดอายุก่อน insert ใหม่ (ป้องกัน Sheet โตเรื่อยๆ)
  try {
    const now      = new Date();
    const allData  = sheet.getDataRange().getValues();
    const headers  = allData[0];
    const expIdx   = headers.indexOf('Expiry');
    if (expIdx >= 0) {
      for (let i = allData.length - 1; i >= 1; i--) {
        if (allData[i][expIdx] && new Date(allData[i][expIdx]) < now) {
          sheet.deleteRow(i + 1);
        }
      }
    }
  } catch(e) {
    console.error('[createSession] cleanup error:', e.message);
  }

  sheet.appendRow([token, userId, email, role, new Date(), expiry]);
  // FIX BUG-004: ใช้ TTL 28800 ทั้งตอนสร้างและตอน re-cache (8 ชม. ตรงกัน)
  CacheService.getScriptCache().put(token, JSON.stringify({ userId, email, role }), 28800);
  return token;
}

function validateSession(token) {
  if (!token) return { valid: false };
  const cached = CacheService.getScriptCache().get(token);
  if (cached) return { valid: true, ...JSON.parse(cached) };

  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) return { valid: false };
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const tokenIdx  = headers.indexOf('Token');
  const userIdx   = headers.indexOf('User_ID');
  const emailIdx  = headers.indexOf('Email');
  const roleIdx   = headers.indexOf('Role');
  const expiryIdx = headers.indexOf('Expiry');
  if (tokenIdx < 0 || expiryIdx < 0) return { valid: false };

  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] === token && now < new Date(data[i][expiryIdx])) {
      const s = { userId: data[i][userIdx], email: data[i][emailIdx], role: data[i][roleIdx] };
      // FIX BUG-004: เปลี่ยนจาก 3600 → 28800 ให้ตรงกับ SESSION_DURATION_HOURS
      CacheService.getScriptCache().put(token, JSON.stringify(s), 28800);
      return { valid: true, ...s };
    }
  }
  return { valid: false };
}

function deleteSession(token) {
  CacheService.getScriptCache().remove(token);
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) return;
  const data     = sheet.getDataRange().getValues();
  const headers  = data[0];
  // FIX BUG-002: ใช้ header-based lookup แทน hardcoded index 0
  const tokenIdx = headers.indexOf('Token');
  if (tokenIdx < 0) return;
  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] === token) { sheet.deleteRow(i + 1); return; }
  }
}

// ============================================================
// MASTER DATA
// ============================================================
function apiGetPlants() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const data  = sheetToObjects(ss.getSheetByName(SHEETS.PLANT_MASTER));
  return { success: true, data: data.filter(p => p.Status === 'Active') };
}

function apiGetAreas(params, auth) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let data   = sheetToObjects(ss.getSheetByName(SHEETS.AREA_MASTER)).filter(a => a.Status === 'Active');
  if (params.plantId) data = data.filter(a => a.Plant_ID === params.plantId);

  const role = String(auth && auth.role || '').toLowerCase();
  if (role === 'auditor' || role === 'area manager') {
    ensureUserAssignmentColumns_(ss.getSheetByName(SHEETS.USER_MASTER));
    const user = getUserById_(ss, auth.userId) || {};
    const assignedAreas = splitCsv_(user.Assigned_Areas);
    const assignedPlants = splitCsv_(user.Assigned_Plants);
    const schedules = getPendingSchedulesForUser_(ss, auth.userId, params.plantId);
    const scheduledAreaIds = schedules.map(s => String(s.Area_ID || '').trim()).filter(Boolean);

    if (scheduledAreaIds.length > 0) {
      const allowed = new Set(scheduledAreaIds);
      data = data.filter(a => allowed.has(String(a.Area_ID)));
    } else if (assignedAreas.length > 0) {
      const allowed = new Set(assignedAreas);
      data = data.filter(a => allowed.has(String(a.Area_ID)));
    } else if (assignedPlants.length > 0) {
      const allowedPlants = new Set(assignedPlants);
      data = data.filter(a => allowedPlants.has(String(a.Plant_ID)));
    }

    const scheduleMap = {};
    schedules.forEach(s => {
      if (s.Area_ID) scheduleMap[String(s.Area_ID)] = s;
    });
    data = data.map(a => {
      const s = scheduleMap[String(a.Area_ID)] || {};
      return Object.assign({}, a, {
        Schedule_ID: s.Schedule_ID || '',
        Audit_Round: s.Audit_Round || '',
        Audit_Date: formatSheetDate_(s.Audit_Date)
      });
    });
  }

  return { success: true, data };
}

function apiGetCriteria(params) {
  const areaType = params.areaType || '';
  const ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let criteria   = sheetToObjects(ss.getSheetByName(SHEETS.CRITERIA_MASTER))
    .filter(c => String(c.Active).toUpperCase() === 'TRUE' || c.Active === true);

  if (areaType) {
    criteria = criteria.filter(c => {
      const at = String(c.Area_Type || '');
      return at === 'All' ||
             at === areaType ||
             at.split(',').map(t => t.trim()).includes(areaType);
    });
  }

  const grouped = {};
  criteria.forEach(c => {
    if (!grouped[c.Category]) grouped[c.Category] = [];
    grouped[c.Category].push(c);
  });

  return {
    success: true, data: criteria, grouped,
    totalMaxScore: criteria.reduce((s, c) => s + (parseInt(c.Max_Score) || 2), 0)
  };
}

function apiGetSchedule(params) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  // FIX BUG-012: คืนเฉพาะ Pending schedules ไม่ส่ง Completed กลับไป
  const data = sheetToObjects(ss.getSheetByName(SHEETS.SCHEDULE_MASTER))
    .filter(s => s.Status === 'Pending');
  return { success: true, data };
}

// Admin: ดึง schedules ทั้งหมด + area info สำหรับ Assignment Board
function apiGetScheduleAdmin(auth) {
  if (!auth || auth.role !== 'Admin') return { success: false, error: 'Admin only' };
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const schedules = sheetToObjects(ss.getSheetByName(SHEETS.SCHEDULE_MASTER));
  const areas     = sheetToObjects(ss.getSheetByName(SHEETS.AREA_MASTER)).filter(a => a.Status === 'Active');
  const plants    = sheetToObjects(ss.getSheetByName(SHEETS.PLANT_MASTER)).filter(p => p.Status === 'Active');
  const users     = sheetToObjects(ss.getSheetByName(SHEETS.USER_MASTER))
    .filter(u => u.Status === 'Active' && (u.Role === 'Auditor' || u.Role === 'Admin'));

  // แนบ schedule ที่ Pending ให้แต่ละ area
  const areaData = areas.map(a => {
    const sch = schedules.find(s =>
      String(s.Area_ID) === String(a.Area_ID) && s.Status === 'Pending'
    ) || null;
    return {
      Area_ID:   a.Area_ID,
      Area_Name: a.Area_Name,
      Area_Type: a.Area_Type,
      Plant_ID:  a.Plant_ID,
      Schedule_ID:  sch ? sch.Schedule_ID  : null,
      Audit_Date:   sch ? sch.Audit_Date   : null,
      Audit_Round:  sch ? sch.Audit_Round  : null,
      Auditor_IDs:  sch ? String(sch.Auditor_ID || '') : '',
      Sched_Status: sch ? sch.Status : 'unassigned',
    };
  });

  return {
    success: true,
    areas:   areaData,
    plants:  plants,
    auditors: users.map(u => ({
      User_ID:    u.User_ID,
      Name:       u.Name,
      Department: u.Department,
      Role:       u.Role,
    })),
  };
}

// Admin: บันทึก / อัปเดต schedule ใน Schedule_Master
function apiSaveSchedule(params, auth) {
  if (!auth || auth.role !== 'Admin') return { success: false, error: 'Admin only' };

  const { areaId, plantId, auditDate, auditRound, auditorIds, scheduleId } = params;
  if (!areaId || !plantId) return { success: false, error: 'areaId และ plantId จำเป็น' };

  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SCHEDULE_MASTER);
  const rows  = sheetToObjects(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const colIdx = h => headers.indexOf(h) + 1; // 1-based

  // ถ้ามี scheduleId → update row นั้น
  if (scheduleId) {
    const rowIndex = rows.findIndex(r => String(r.Schedule_ID) === String(scheduleId));
    if (rowIndex >= 0) {
      const r = rowIndex + 2; // +2 เพราะ header=row1 และ 0-based
      if (colIdx('Audit_Date')  > 0) sheet.getRange(r, colIdx('Audit_Date')).setValue(auditDate || '');
      if (colIdx('Audit_Round') > 0) sheet.getRange(r, colIdx('Audit_Round')).setValue(auditRound || '');
      if (colIdx('Auditor_ID')  > 0) sheet.getRange(r, colIdx('Auditor_ID')).setValue(auditorIds || '');
      if (colIdx('Status')      > 0) sheet.getRange(r, colIdx('Status')).setValue('Pending');
      logAction(auth.userId, 'SCHEDULE_UPDATE', `Updated schedule ${scheduleId} for area ${areaId}`);
      return { success: true, scheduleId, action: 'updated' };
    }
  }

  // ถ้าพื้นที่มี Pending schedule อยู่แล้ว → update แทนสร้างใหม่
  const existing = rows.findIndex(r => String(r.Area_ID) === String(areaId) && r.Status === 'Pending');
  if (existing >= 0) {
    const r = existing + 2;
    if (colIdx('Audit_Date')  > 0) sheet.getRange(r, colIdx('Audit_Date')).setValue(auditDate || '');
    if (colIdx('Audit_Round') > 0) sheet.getRange(r, colIdx('Audit_Round')).setValue(auditRound || '');
    if (colIdx('Auditor_ID')  > 0) sheet.getRange(r, colIdx('Auditor_ID')).setValue(auditorIds || '');
    const existingId = rows[existing].Schedule_ID;
    logAction(auth.userId, 'SCHEDULE_UPDATE', `Updated existing schedule for area ${areaId}`);
    return { success: true, scheduleId: existingId, action: 'updated' };
  }

  // สร้างใหม่
  const newId  = 'SCH-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss');
  const newRow = headers.map(h => {
    if (h === 'Schedule_ID')  return newId;
    if (h === 'Audit_Round')  return auditRound || 'Round 1';
    if (h === 'Audit_Date')   return auditDate  || '';
    if (h === 'Plant_ID')     return plantId;
    if (h === 'Area_ID')      return areaId;
    if (h === 'Auditor_ID')   return auditorIds || '';
    if (h === 'Status')       return 'Pending';
    return '';
  });
  sheet.appendRow(newRow);
  logAction(auth.userId, 'SCHEDULE_CREATE', `Created schedule ${newId} for area ${areaId}`);
  return { success: true, scheduleId: newId, action: 'created' };
}

// Admin: ลบ / ยกเลิก schedule
function apiDeleteSchedule(params, auth) {
  if (!auth || auth.role !== 'Admin') return { success: false, error: 'Admin only' };
  const { scheduleId } = params;
  if (!scheduleId) return { success: false, error: 'scheduleId จำเป็น' };

  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SCHEDULE_MASTER);
  const rows  = sheetToObjects(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIdx = h => headers.indexOf(h) + 1;

  const rowIndex = rows.findIndex(r => String(r.Schedule_ID) === String(scheduleId));
  if (rowIndex < 0) return { success: false, error: 'ไม่พบ schedule' };

  const r = rowIndex + 2;
  if (colIdx('Status') > 0) sheet.getRange(r, colIdx('Status')).setValue('Cancelled');
  logAction(auth.userId, 'SCHEDULE_DELETE', `Cancelled schedule ${scheduleId}`);
  return { success: true };
}

// ============================================================
// AUDIT — CHUNKED (แก้ปัญหา URL too long)
// ============================================================
function apiSubmitAuditHeader(params, auth) {
  const { plantId, areaId, auditDate } = params;
  const auditorId = auth && auth.userId ? auth.userId : params.auditorId;
  if (!plantId || !areaId || !auditorId) return { success: false, error: 'ข้อมูล Header ไม่ครบ' };

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  if (!canUserAuditArea_(ss, auth, plantId, areaId)) {
    return { success: false, error: 'คุณไม่มีสิทธิ์ตรวจพื้นที่นี้' };
  }

  const auditId = 'AUD-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' +
                  Math.random().toString(36).substring(2, 6).toUpperCase();

  ss.getSheetByName(SHEETS.AUDIT_HEADER).appendRow([
    auditId, plantId, areaId, auditorId,
    auditDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    0, 0, 0, 'Pending'
  ]);
  return { success: true, auditId };
}

function apiSubmitAuditDetails(params) {
  const { auditId, details: detailsStr } = params;
  if (!auditId || !detailsStr) return { success: false, error: 'ข้อมูล Details ไม่ครบ' };

  let details;
  try { details = JSON.parse(detailsStr); } catch(e) { return { success: false, error: 'รูปแบบ details ไม่ถูกต้อง' }; }

  const ss          = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const detailSheet = ss.getSheetByName(SHEETS.AUDIT_DETAIL);
  // ใช้ lastRow + counter เพื่อป้องกัน Detail_ID ชน
  const startRow = detailSheet.getLastRow();
  const rows = details.map((d, i) => [
    auditId + '-' + String(startRow + i + 1).padStart(4, '0'),
    auditId, d.criteriaId, d.score, d.remark || '', d.photoUrl || ''
  ]);
  if (rows.length > 0) {
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
  return { success: true, saved: rows.length };
}

function apiFinalizeAudit(params) {
  const { auditId } = params;
  if (!auditId) return { success: false, error: 'Missing auditId' };

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const details = sheetToObjects(ss.getSheetByName(SHEETS.AUDIT_DETAIL)).filter(d => d.Audit_ID === auditId);

  // โหลด Criteria_Master เพื่อใช้ Max_Score จริง (ไม่ hardcode = 2)
  const criteriaData = sheetToObjects(ss.getSheetByName(SHEETS.CRITERIA_MASTER));
  const criteriaMap  = {};
  criteriaData.forEach(c => { criteriaMap[c.Criteria_ID] = parseInt(c.Max_Score) || 2; });

  let totalScore = 0, maxScore = 0;
  details.forEach(d => {
    totalScore += parseInt(d.Score) || 0;
    maxScore   += criteriaMap[d.Criteria_ID] || 2;
  });

  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const status  = percent >= 90 ? 'Excellent' : percent >= 75 ? 'Good' : 'Need Improvement';

  const headerSheet  = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const headerData   = headerSheet.getDataRange().getValues();
  const hHeaders     = headerData[0];
  const auditIdIdx   = hHeaders.indexOf('Audit_ID');
  const totalScoreCol = hHeaders.indexOf('Total_Score') + 1;
  const maxScoreCol   = hHeaders.indexOf('Max_Score')   + 1;
  const percentCol    = hHeaders.indexOf('Percent')     + 1;
  const statusCol     = hHeaders.indexOf('Status')      + 1;

  // ตรวจสอบ column ก่อนเขียน
  if (totalScoreCol < 1 || maxScoreCol < 1 || percentCol < 1 || statusCol < 1) {
    return { success: false, error: 'Audit_Header columns ไม่ครบ' };
  }

  for (let i = 1; i < headerData.length; i++) {
    if (headerData[i][auditIdIdx] === auditId) {
      const row = i + 1;
      // FIX BUG-009: เขียนทั้ง 4 columns ใน 1 Sheets API call แทนที่จะเรียก 4 ครั้ง
      const cols   = [totalScoreCol, maxScoreCol, percentCol, statusCol];
      const minCol = Math.min(...cols);
      const maxCol = Math.max(...cols);
      const rowData = new Array(maxCol - minCol + 1).fill('');
      rowData[totalScoreCol - minCol] = totalScore;
      rowData[maxScoreCol   - minCol] = maxScore;
      rowData[percentCol    - minCol] = percent;
      rowData[statusCol     - minCol] = status;
      headerSheet.getRange(row, minCol, 1, rowData.length).setValues([rowData]);
      break;
    }
  }
  return { success: true, auditId, totalScore, maxScore, percent, status, message: 'บันทึกสำเร็จ' };
}

function apiSubmitAudit(body, auth) {
  const { plantId, areaId, auditDate, details } = body;
  const auditorId = auth && auth.userId ? auth.userId : body.auditorId;
  if (!plantId || !areaId || !details) return { success: false, error: 'ข้อมูลไม่ครบ' };

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  if (!canUserAuditArea_(ss, auth, plantId, areaId)) {
    return { success: false, error: 'คุณไม่มีสิทธิ์ตรวจพื้นที่นี้' };
  }

  // FIX BUG-010: อ่าน maxScore จาก Criteria_Master (server-side) แทน client-provided
  const criteriaData = sheetToObjects(ss.getSheetByName(SHEETS.CRITERIA_MASTER));
  const criteriaMap  = {};
  criteriaData.forEach(c => { criteriaMap[c.Criteria_ID] = parseInt(c.Max_Score) || 2; });

  let totalScore = 0, maxScore = 0;
  details.forEach(d => {
    totalScore += parseInt(d.score) || 0;
    maxScore   += criteriaMap[d.criteriaId] || 2; // ใช้ server-side max score
  });
  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  // FIX BUG-013: ใช้ format เดียวกับ apiSubmitAuditHeader (มี HHmmss ลด collision)
  const auditId = 'AUD-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' +
                  Math.random().toString(36).substring(2, 6).toUpperCase();
  const status  = percent >= 90 ? 'Excellent' : percent >= 75 ? 'Good' : 'Need Improvement';

  ss.getSheetByName(SHEETS.AUDIT_HEADER).appendRow([
    auditId, plantId, areaId, auditorId,
    auditDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    totalScore, maxScore, percent, status
  ]);

  const detailSheet = ss.getSheetByName(SHEETS.AUDIT_DETAIL);
  details.forEach((d, idx) => {
    detailSheet.appendRow([auditId + '-' + String(idx+1).padStart(3,'0'),
      auditId, d.criteriaId, d.score, d.remark || '', d.photoUrl || '']);
  });

  return { success: true, auditId, totalScore, maxScore, percent, status, message: 'บันทึกสำเร็จ' };
}

function apiGetHistory(params) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let result = sheetToObjects(ss.getSheetByName(SHEETS.AUDIT_HEADER));
  if (params.plantId)   result = result.filter(r => r.Plant_ID   === params.plantId);
  if (params.areaId)    result = result.filter(r => r.Area_ID    === params.areaId);
  if (params.auditorId) result = result.filter(r => r.Auditor_ID === params.auditorId);
  if (params.month)     result = result.filter(r => new Date(r.Audit_Date).getMonth() + 1 === parseInt(params.month));
  if (params.year)      result = result.filter(r => new Date(r.Audit_Date).getFullYear() === parseInt(params.year));
  result.sort((a, b) => new Date(b.Audit_Date) - new Date(a.Audit_Date));
  return { success: true, data: result, total: result.length };
}

function apiGetAuditDetail(params) {
  const { auditId } = params;
  if (!auditId) return { success: false, error: 'Missing auditId' };
  const ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const header   = sheetToObjects(ss.getSheetByName(SHEETS.AUDIT_HEADER)).find(h => h.Audit_ID === auditId);
  const details  = sheetToObjects(ss.getSheetByName(SHEETS.AUDIT_DETAIL)).filter(d => d.Audit_ID === auditId);
  const criteria = sheetToObjects(ss.getSheetByName(SHEETS.CRITERIA_MASTER));
  const cMap     = {};
  criteria.forEach(c => cMap[c.Criteria_ID] = c);
  return { success: true, header, details: details.map(d => ({ ...d, criteria: cMap[d.Criteria_ID] || {} })) };
}

// ============================================================
// PHOTO UPLOAD
// ============================================================
function apiUploadPhoto(body) {
  const { base64, filename, mimeType, auditId } = body;
  if (!base64 || !filename) return { success: false, error: 'Missing photo data' };

  // FIX BUG-003: ตรวจสอบ DRIVE_FOLDER_ID ก่อนเรียก DriveApp
  const folderId = CONFIG.DRIVE_FOLDER_ID;
  if (!folderId) {
    return { success: false, error: 'Drive folder ยังไม่ได้ตั้งค่า — รัน setupDriveFolder() ใน Apps Script ก่อน' };
  }

  try {
    const blob         = Utilities.newBlob(
      Utilities.base64Decode(base64.replace(/^data:[^;]+;base64,/, '')),
      mimeType || 'image/jpeg', filename
    );
    const parentFolder = DriveApp.getFolderById(folderId);
    const subName      = auditId || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
    let subfolder;
    const subs = parentFolder.getFoldersByName(subName);
    subfolder  = subs.hasNext() ? subs.next() : parentFolder.createFolder(subName);
    const file   = subfolder.createFile(blob);
    const fileId = file.getId();
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // FIX BUG-007: ใช้ lh3.googleusercontent.com แทน uc?export=view ที่ deprecated
    return {
      success: true,
      url:         'https://lh3.googleusercontent.com/d/' + fileId,
      fallbackUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
      fileId:      fileId
    };
  } catch(err) {
    return { success: false, error: 'Upload failed: ' + err.message };
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function apiGetDashboard(params) {
  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let audits    = sheetToObjects(ss.getSheetByName(SHEETS.AUDIT_HEADER));
  const areas   = sheetToObjects(ss.getSheetByName(SHEETS.AREA_MASTER));
  const plants  = sheetToObjects(ss.getSheetByName(SHEETS.PLANT_MASTER));

  if (params.plantId) audits = audits.filter(a => a.Plant_ID === params.plantId);
  if (params.year)    audits = audits.filter(a => new Date(a.Audit_Date).getFullYear() === parseInt(params.year));
  if (params.month)   audits = audits.filter(a => new Date(a.Audit_Date).getMonth() + 1 === parseInt(params.month));

  if (!audits.length) return { success: true, data: { totalAudit: 0, avgScore: 0, passRate: 0 } };

  const totalAudit  = audits.length;
  const avgScore    = Math.round(audits.reduce((s, a) => s + parseFloat(a.Percent || 0), 0) / totalAudit);
  const passRate    = Math.round((audits.filter(a => parseFloat(a.Percent) >= 75).length / totalAudit) * 100);
  const excellent   = audits.filter(a => parseFloat(a.Percent) >= 90).length;
  const good        = audits.filter(a => parseFloat(a.Percent) >= 75 && parseFloat(a.Percent) < 90).length;
  const needImp     = audits.filter(a => parseFloat(a.Percent) < 75).length;

  const plantMap = {};
  plants.forEach(p => { plantMap[p.Plant_ID] = { name: p.Plant_Name, scores: [] }; });
  audits.forEach(a => { if (plantMap[a.Plant_ID]) plantMap[a.Plant_ID].scores.push(parseFloat(a.Percent || 0)); });
  const plantComparison = Object.entries(plantMap).map(([id, v]) => ({
    plantId: id, plantName: v.name,
    avgScore: v.scores.length ? Math.round(v.scores.reduce((a,b)=>a+b,0)/v.scores.length) : 0
  })).sort((a,b) => b.avgScore - a.avgScore);

  const areaMap = {};
  audits.forEach(a => {
    if (!areaMap[a.Area_ID]) areaMap[a.Area_ID] = { scores: [] };
    areaMap[a.Area_ID].scores.push(parseFloat(a.Percent || 0));
  });
  const areaRanking = Object.entries(areaMap).map(([id, v]) => {
    const info = areas.find(a => a.Area_ID === id) || {};
    return { areaId: id, areaName: info.Area_Name || id, plantId: info.Plant_ID || '',
             avgScore: Math.round(v.scores.reduce((a,b)=>a+b,0)/v.scores.length) };
  }).sort((a,b) => b.avgScore - a.avgScore);

  const monthlyMap = {};
  audits.forEach(a => {
    const key = new Date(a.Audit_Date).getFullYear() + '-' + String(new Date(a.Audit_Date).getMonth()+1).padStart(2,'0');
    if (!monthlyMap[key]) monthlyMap[key] = [];
    monthlyMap[key].push(parseFloat(a.Percent || 0));
  });
  const monthlyTrend = Object.entries(monthlyMap).sort(([a],[b]) => a.localeCompare(b)).slice(-6)
    .map(([month, scores]) => ({ month, avgScore: Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) }));

  return {
    success: true,
    data: { totalAudit, avgScore, passRate, excellent, good, needImprovement: needImp,
            plantComparison, areaRanking, monthlyTrend,
            highestArea: areaRanking[0] || null, lowestArea: areaRanking[areaRanking.length-1] || null }
  };
}

// ============================================================
// USER MANAGEMENT — รับ GET params (ไม่ใช่ POST body)
// ============================================================
// FIX BUG-005 + BUG-006: รับ auth object (ที่ validate แล้วจาก handleRequest) แทน token
// ไม่ต้อง validateSession ซ้ำ และแยก check valid vs role อย่างชัดเจน
function apiGetUsers(auth, params) {
  if (!auth.valid)            return { success: false, error: 'Unauthorized', code: 401 };
  if (auth.role !== 'Admin')  return { success: false, error: 'Permission denied', code: 403 };
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.USER_MASTER);
  ensureUserAssignmentColumns_(sheet);
  const data  = sheetToObjects(sheet);
  return { success: true, data: data.map(u => ({ ...u, Password: '***' })) };
}

function apiSaveUser(params, auth) {
  // FIX BUG-005 + BUG-006: รับ auth object แทน token
  if (!auth.valid)            return { success: false, error: 'Unauthorized', code: 401 };
  if (auth.role !== 'Admin')  return { success: false, error: 'Permission denied', code: 403 };

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(SHEETS.USER_MASTER);
  ensureUserAssignmentColumns_(sheet);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const uIdx    = headers.indexOf('User_ID');

  // UPDATE
  if (params.userId) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][uIdx]) === String(params.userId)) {
        const col = (name) => headers.indexOf(name) + 1;
        sheet.getRange(i+1, col('Name')).setValue(params.name || '');
        sheet.getRange(i+1, col('Email')).setValue(params.email || '');
        sheet.getRange(i+1, col('Department')).setValue(params.department || '');
        sheet.getRange(i+1, col('Employee_ID')).setValue(params.employeeId || '');
        sheet.getRange(i+1, col('Role')).setValue(params.role || '');
        sheet.getRange(i+1, col('Status')).setValue(params.status || 'Active');
        setCellIfColumnExists_(sheet, headers, i+1, 'Assigned_Areas', params.assignedAreas || '');
        setCellIfColumnExists_(sheet, headers, i+1, 'Assigned_Plants', params.assignedPlants || '');
        if (params.password) sheet.getRange(i+1, col('Password')).setValue(hashPassword(params.password));
        const updCol = headers.indexOf('Updated_Date') + 1;
        if (updCol > 0) sheet.getRange(i+1, updCol).setValue(
          Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'));
        return { success: true, message: 'อัปเดตสำเร็จ' };
      }
    }
    return { success: false, error: 'ไม่พบผู้ใช้' };
  }

  // INSERT — Hash password + รองรับ Extra Columns ใน Sheet
  const newId     = 'USR-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd') + '-' +
                    Math.random().toString(36).substring(2, 8).toUpperCase();
  const hashedPwd = params.password ? hashPassword(params.password) : '';
  const today     = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');

  // สร้าง row ตาม headers จริงใน Sheet (ยืดหยุ่นตาม column ที่มี)
  const newRow = new Array(headers.length).fill('');
  const setCol = (name, val) => { const i = headers.indexOf(name); if (i >= 0) newRow[i] = val; };
  setCol('User_ID',         newId);
  setCol('Employee_ID',     params.employeeId    || '');
  setCol('Name',            params.name          || '');
  setCol('Department',      params.department    || '');
  setCol('Email',           params.email         || '');
  setCol('Password',        hashedPwd);
  setCol('Role',            params.role          || 'Auditor');
  setCol('Status',          params.status        || 'Active');
  setCol('Assigned_Plants', params.assignedPlants|| '');
  setCol('Assigned_Areas',  params.assignedAreas || '');
  setCol('Created_Date',    today);
  setCol('Updated_Date',    today);
  sheet.appendRow(newRow);
  return { success: true, userId: newId, message: 'เพิ่มผู้ใช้สำเร็จ' };
}

function getUserById_(ss, userId) {
  const users = sheetToObjects(ss.getSheetByName(SHEETS.USER_MASTER));
  return users.find(u => String(u.User_ID) === String(userId)) || null;
}

function splitCsv_(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function getPendingSchedulesForUser_(ss, userId, plantId) {
  const sheet = ss.getSheetByName(SHEETS.SCHEDULE_MASTER);
  if (!sheet) return [];
  return sheetToObjects(sheet).filter(s => {
    if (s.Status !== 'Pending') return false;
    if (plantId && s.Plant_ID && s.Plant_ID !== plantId) return false;
    if (!s.Auditor_ID) return false;
    return splitCsv_(s.Auditor_ID).includes(String(userId));
  });
}

function canUserAuditArea_(ss, auth, plantId, areaId) {
  if (!auth || !auth.valid) return false;
  const role = String(auth.role || '').toLowerCase();
  if (role === 'admin' || role === 'manager') return true;

  if (role !== 'auditor' && role !== 'area manager') return false;

  ensureUserAssignmentColumns_(ss.getSheetByName(SHEETS.USER_MASTER));
  const user = getUserById_(ss, auth.userId) || {};
  const assignedAreas = splitCsv_(user.Assigned_Areas);
  const assignedPlants = splitCsv_(user.Assigned_Plants);
  const schedules = getPendingSchedulesForUser_(ss, auth.userId, plantId);
  const scheduledAreaIds = schedules.map(s => String(s.Area_ID || '').trim()).filter(Boolean);

  if (scheduledAreaIds.length > 0) return scheduledAreaIds.includes(String(areaId));
  if (assignedAreas.length > 0) return assignedAreas.includes(String(areaId));
  if (assignedPlants.length > 0) return assignedPlants.includes(String(plantId));

  return true;
}

function formatSheetDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  return String(value);
}

function setCellIfColumnExists_(sheet, headers, row, columnName, value) {
  const col = headers.indexOf(columnName) + 1;
  if (col > 0) sheet.getRange(row, col).setValue(value);
}

function ensureUserAssignmentColumns_(sheet) {
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  ['Assigned_Plants', 'Assigned_Areas'].forEach(name => {
    if (!headers.includes(name)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(name);
      headers.push(name);
    }
  });
}

// ============================================================
// UTILITIES
// ============================================================
// Hash password ด้วย SHA-256 (เหมือนกับที่ใช้ใน Sheet ปัจจุบัน)
function hashPassword(password) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
  );
}

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

function createResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.appendRow(headers); }
  return sheet;
}

function logAction(userId, action, detail) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = getOrCreateSheet(ss, SHEETS.AUDIT_LOG, ['Log_ID','User','Action','Detail','DateTime']);
    sheet.appendRow(['LOG-' + Date.now(), userId, action, detail, new Date()]);
  } catch(e) {
    // FIX BUG-011: log error ใน GAS console แทนกลืนเงียบ
    console.error('[logAction ERROR] userId=' + userId + ' action=' + action + ' err=' + e.message);
  }
}

// ============================================================
// SETUP DRIVE FOLDER — รันครั้งเดียว สร้าง Folder เก็บรูป
// ============================================================
function setupDriveFolder() {
  const FOLDER_NAME = '5S Audit Photos';
  let folder;

  // ตรวจว่ามี Folder ชื่อนี้อยู่แล้วหรือไม่
  const existing = DriveApp.getFoldersByName(FOLDER_NAME);
  if (existing.hasNext()) {
    folder = existing.next();
    Logger.log('📁 ใช้ Folder ที่มีอยู่แล้ว: ' + FOLDER_NAME);
  } else {
    folder = DriveApp.createFolder(FOLDER_NAME);
    Logger.log('📁 สร้าง Folder ใหม่: ' + FOLDER_NAME);
  }

  // บันทึก Folder ID ลง Script Properties
  PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', folder.getId());

  Logger.log('✅ DRIVE_FOLDER_ID = ' + folder.getId());
  Logger.log('✅ setupDriveFolder เสร็จสมบูรณ์ — พร้อม Upload รูปแล้ว');
}

// ============================================================
// SETUP CRITERIA MASTER — มาตรฐาน 5ส R.00 16.06.2026 (132 ข้อ)
// ============================================================
function setupCriteria() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.CRITERIA_MASTER);

  if (!sheet) {
    Logger.log('❌ ไม่พบ Sheet Criteria_Master — รัน setupSystem() ก่อน');
    return;
  }

  // ป้องกันเขียนทับถ้ามีข้อมูลแล้ว
  if (sheet.getLastRow() > 1) {
    Logger.log('⚠️ Criteria_Master มีข้อมูลอยู่แล้ว (' + (sheet.getLastRow()-1) + ' แถว) — ยกเลิก');
    Logger.log('   หากต้องการ Reset ให้ลบข้อมูลใน Sheet แถว 2 เป็นต้นไปด้วยมือก่อน');
    return;
  }

  // มาตรฐาน 5ส R.00 16.06.2026 — 132 ข้อ
  // [Criteria_ID, Category, Sub_Category, Question, Description, Area_Type, Max_Score, Active]
  const criteria = [
    // 1. บอร์ด ป้ายติดประกาศ (2 ข้อ)
    ['C-01-1','บอร์ด ป้ายติดประกาศ','1.1','ข้อมูล 5ส บนบอร์ดเป็นปัจจุบัน','บอร์ดประกอบด้วย นโยบาย วัตถุประสงค์ คณะอนุกรรมการ คำขวัญ ข่าวสาร ภาพก่อน-หลัง ผลการตรวจ และแผนผังพื้นที่พร้อมผู้รับผิดชอบ','All',2,true],
    ['C-01-2','บอร์ด ป้ายติดประกาศ','1.2','บอร์ดมีสภาพสมบูรณ์ไม่ชำรุด สะอาด ไม่มีฝุ่นสะสม','ไม่มีคราบสกปรกหรือหยากไย่','All',2,true],
    // 2. ความรู้เบื้องต้นของพนักงานเกี่ยวกับ 5ส (3 ข้อ — ลบข้อ 2.4 จาก Draft เดิม)
    ['C-02-1','ความรู้เบื้องต้นของพนักงานเกี่ยวกับ 5ส','2.1','พนักงานทุกคนมีความรู้ความเข้าใจเกี่ยวกับหลักการของ 5ส','พนักงานทุกคนในองค์กรรู้หลักการ 5ส','All',2,true],
    ['C-02-2','ความรู้เบื้องต้นของพนักงานเกี่ยวกับ 5ส','2.2','พนักงานได้รับข่าวสาร มีส่วนร่วม และบอกคำขวัญ 5ส ได้','พนักงานได้รับข่าวสารการร่วมกิจกรรมอย่างทั่วถึง สามารถบอกคำขวัญได้','All',2,true],
    ['C-02-3','ความรู้เบื้องต้นของพนักงานเกี่ยวกับ 5ส','2.3','พนักงานรับทราบพื้นที่รับผิดชอบและผลการตรวจรอบที่ผ่านมา','ทราบขอบเขตพื้นที่ความรับผิดชอบของตนเอง','All',2,true],
    // 3. อุปกรณ์ดับเพลิง ถังดับเพลิง หัวฉีดและท่อน้ำดับเพลิง (4 ข้อ)
    ['C-03-1','อุปกรณ์ดับเพลิง','3.1','ติดตั้งในตำแหน่งที่เหมาะสม ไม่มีสิ่งกีดขวางการเข้าถึง','ถังดับเพลิงแขวน/วางบนแท่น/พื้น ห้ามวางสิ่งของกีดขวาง รวมถึงตู้เก็บหัวฉีดสายดับเพลิง','All',2,true],
    ['C-03-2','อุปกรณ์ดับเพลิง','3.2','มีป้ายบ่งชี้ประเภทถังดับเพลิงและวิธีใช้','ป้ายระบุประเภทและวิธีการใช้งาน','All',2,true],
    ['C-03-3','อุปกรณ์ดับเพลิง','3.3','สะอาด ไม่มีฝุ่นสะสม','ไม่มีฝุ่นสะสมบนอุปกรณ์ดับเพลิง','All',2,true],
    ['C-03-4','อุปกรณ์ดับเพลิง','3.4','ไม่ชำรุด พร้อมใช้งาน ตรวจสอบตามรอบที่กำหนด','ตรวจสอบโดย จป.วิชาชีพ/ผู้ที่ได้รับมอบหมายตามแผน','All',2,true],
    // 4. เครื่องทำน้ำเย็น/น้ำร้อน/ตู้เย็น (3 ข้อ)
    ['C-04-1','เครื่องทำน้ำเย็น/น้ำร้อน/ตู้เย็น','4.1','ตัวเครื่องสะอาด ไม่มีฝุ่นเกาะและไม่มีคราบสกปรก','ตัวเครื่องต้องสะอาดทุกส่วน','All',2,true],
    ['C-04-2','เครื่องทำน้ำเย็น/น้ำร้อน/ตู้เย็น','4.2','ตัวเครื่องและสายไฟพร้อมใช้งาน ไม่ชำรุด','สายไฟและตัวเครื่องอยู่ในสภาพสมบูรณ์','All',2,true],
    ['C-04-3','เครื่องทำน้ำเย็น/น้ำร้อน/ตู้เย็น','4.3','สายไฟไม่เกะกะ บริเวณสะอาด ไม่มีน้ำหกบนพื้น','รอบเครื่องสะอาด สายไฟเป็นระเบียบ','All',2,true],
    // 5. ตู้ยา (4 ข้อ)
    ['C-05-1','ตู้ยา','5.1','มีป้ายบ่งชี้ตู้ยาเห็นอย่างชัดเจน','ป้ายชัดเจน มองเห็นได้ง่าย','All',2,true],
    ['C-05-2','ตู้ยา','5.2','แยกประเภทยา มีป้ายชื่อ สรรพคุณ วิธีใช้','แยกประเภท ติดป้ายชัดเจน สืบค้นได้สะดวก','All',2,true],
    ['C-05-3','ตู้ยา','5.3','มีการตรวจสอบอายุและปริมาณยาอยู่เสมอ','ตรวจอายุยาและปริมาณสต็อกสม่ำเสมอ','All',2,true],
    ['C-05-4','ตู้ยา','5.4','มี Check list (กรณียามีจำนวนมาก) และบันทึกเบิก-จ่าย','ต้องมี checklist บันทึกเบิก-จ่าย','All',2,true],
    // 6. ห้องน้ำ/ห้องส้วม (7 ข้อ — เพิ่มข้อ 6.7 ใหม่)
    ['C-06-1','ห้องน้ำ/ห้องส้วม','6.1','มีป้ายบ่งชี้ห้องน้ำเห็นอย่างชัดเจน','ป้ายชื่อห้องน้ำมองเห็นได้ชัด','All',2,true],
    ['C-06-2','ห้องน้ำ/ห้องส้วม','6.2','มีรองเท้าให้เปลี่ยนเข้าห้องน้ำ วางเป็นระเบียบ','รองเท้าวางเป็นระเบียบ','All',2,true],
    ['C-06-3','ห้องน้ำ/ห้องส้วม','6.3','มีถังขยะฝาปิด/เหมาะสม ไม่ปล่อยให้ล้นถัง','ถังขยะฝาปิด ไม่ล้น','All',2,true],
    ['C-06-4','ห้องน้ำ/ห้องส้วม','6.4','ดูแลรักษาความสะอาด ห้ามสูบบุหรี่ในห้องน้ำ','ห้องน้ำสะอาด ไม่มีกลิ่น ห้ามสูบบุหรี่','All',2,true],
    ['C-06-5','ห้องน้ำ/ห้องส้วม','6.5','มีกระดาษ/ผ้าเช็ดมือ มีสบู่เหลวล้างมือ','มีอุปกรณ์ทำให้มือแห้งและสบู่เหลว','All',2,true],
    ['C-06-6','ห้องน้ำ/ห้องส้วม','6.6','อุปกรณ์ทำความสะอาดวางในพื้นที่กำหนด ไม่ชำรุด','อุปกรณ์วางถูกที่ ไม่มีชำรุดโดยไม่แจ้ง','All',2,true],
    ['C-06-7','ห้องน้ำ/ห้องส้วม','6.7','อุปกรณ์สุขภัณฑ์อื่นๆ มีสภาพสมบูรณ์ไม่ชำรุด','หากชำรุดต้องระบุสถานะชัดเจนและมีแผนซ่อม','All',2,true],
    // 7. อุปกรณ์ทำความสะอาด/อุปกรณ์อื่นๆ (2 ข้อ)
    ['C-07-1','อุปกรณ์ทำความสะอาด','7.1','อุปกรณ์มีสภาพสมบูรณ์ไม่ชำรุด','สภาพดีพร้อมใช้งาน','All',2,true],
    ['C-07-2','อุปกรณ์ทำความสะอาด','7.2','จัดเก็บในบริเวณที่กำหนด จัดหมวดหมู่ วางเป็นระเบียบ มีป้ายชี้บ่ง','จัดหมวดหมู่ วางเป็นระเบียบ มี Layout','All',2,true],
    // 8. โทรศัพท์ (3 ข้อ)
    ['C-08-1','โทรศัพท์','8.1','ทำความสะอาดสม่ำเสมอ ไม่มีฝุ่นหรือคราบสกปรก','ทำความสะอาดสม่ำเสมอ','All',2,true],
    ['C-08-2','โทรศัพท์','8.2','ติดตั้งบริเวณที่ใช้งานได้ง่าย ไม่มีสิ่งกีดขวาง','ตำแหน่งที่เหมาะสม ไม่กีดขวาง','All',2,true],
    ['C-08-3','โทรศัพท์','8.3','อุปกรณ์สภาพสมบูรณ์ไม่ชำรุด','สภาพสมบูรณ์','All',2,true],
    // 9. ไฟฉุกเฉิน (2 ข้อ)
    ['C-09-1','ไฟฉุกเฉิน','9.1','สะอาด ไม่มีฝุ่นสะสม ไม่มีหยากไย่','สะอาดไม่มีฝุ่นสะสม','All',2,true],
    ['C-09-2','ไฟฉุกเฉิน','9.2','อยู่ในสภาพพร้อมใช้งาน','อยู่ในสภาพพร้อมใช้งานเสมอ','All',2,true],
    // 10. ไฟดักแมลง (2 ข้อ)
    ['C-10-1','ไฟดักแมลง','10.1','อยู่ในสภาพพร้อมใช้งาน','อยู่ในสภาพพร้อมใช้งาน','All',2,true],
    ['C-10-2','ไฟดักแมลง','10.2','สะอาด ไม่มีฝุ่นสะสม ไม่มีหยากไย่','ไม่มีฝุ่นสะสม ไม่มีหยากไย่','All',2,true],
    // 11. พื้นที่พักขยะ และถังขยะ (4 ข้อ)
    ['C-11-1','พื้นที่พักขยะและถังขยะ','11.1','มีขอบเขตกำหนดชัดเจน มีป้ายชี้บ่ง','ขอบเขตพื้นที่ขยะกำหนดชัดเจน','All',2,true],
    ['C-11-2','พื้นที่พักขยะและถังขยะ','11.2','ถังขยะมีฝาปิด หรือขยะไม่ล้นออกจากถัง/พื้นจัดเก็บ','ฝาปิดหรือขยะไม่ล้นออกจากถัง','All',2,true],
    ['C-11-3','พื้นที่พักขยะและถังขยะ','11.3','ไม่เป็นแหล่งสะสมสัตว์พาหะ แมลง','ไม่เป็นแหล่งพักหรือเพาะตัวอ่อนแมลง','All',2,true],
    ['C-11-4','พื้นที่พักขยะและถังขยะ','11.4','พื้นไม่มีน้ำขังสะสม ไม่มีสิ่งสกปรกสะสมบนพื้น','พื้นบริเวณขยะสะอาด ไม่มีน้ำขัง','All',2,true],
    // 12. ISOWALL (2 ข้อ — ลบข้อ 12.3 เรื่องฝุ่น)
    ['C-12-1','ISOWALL','12.1','ไม่มีขยะ ซากสัตว์ อุปกรณ์ซ่อมบำรุงสะสมบน ISOWALL','บน ISOWALL สะอาด ไม่มีสิ่งสกปรกสะสม','Production,Warehouse',2,true],
    ['C-12-2','ISOWALL','12.2','ไม่มีอุปกรณ์ไม่ใช้งานหรือสิ่งที่ไม่เกี่ยวข้องบน ISOWALL','ค้อน ตะปู น็อต ปะแจ หรืออุปกรณ์อื่นๆ ไม่อยู่บน ISOWALL','Production,Warehouse',2,true],
    // 13. บริเวณพื้นที่โดยรอบอาคาร (5 ข้อ)
    ['C-13-1','บริเวณรอบอาคาร','13.1','รอบอาคารเป็นระเบียบ สะอาด ไม่มีกองขยะหรืออุปกรณ์อันตราย','ไม่มีกองขยะหรือสิ่งของไม่เกี่ยวข้องรอบอาคาร','Outdoor',2,true],
    ['C-13-2','บริเวณรอบอาคาร','13.2','ไม่มีวัชพืชขึ้นรก หญ้าไม่ยาวเกินไปรอบอาคาร','รอบอาคารไม่มีวัชพืชหรือหญ้ายาว','Outdoor',2,true],
    ['C-13-3','บริเวณรอบอาคาร','13.3','ท่อระบายน้ำมีฝาปิด ไม่มีขยะ รางระบายไม่กีดขวาง','ระบบระบายน้ำสมบูรณ์ ไม่กีดขวางทางน้ำ','Outdoor',2,true],
    ['C-13-4','บริเวณรอบอาคาร','13.4','โครงสร้างอาคารไม่ชำรุด ไม่เป็นแหล่งสัตว์พาหะ','มีแผนซ่อมถ้าชำรุด','Outdoor',2,true],
    ['C-13-5','บริเวณรอบอาคาร','13.5','ประตูหนีไฟพร้อมใช้งาน มีป้ายชี้บ่ง ไม่มีสิ่งกีดขวาง','ประตูหนีไฟไม่ชำรุด ไม่เปิดทิ้งไว้','Outdoor',2,true],
    // 14. ตู้/ห้องควบคุมระบบไฟฟ้า เครื่องปรับอากาศ และระบบเครือข่าย (4 ข้อ — ลบข้อ 14.5 เดิม รวมเข้า 14.2)
    ['C-14-1','ตู้/ห้องควบคุมไฟฟ้า','14.1','มีการชี้บ่งตำแหน่งภายในตู้ควบคุมชัดเจน','ระบุตำแหน่ง Circuit/ระบบเครือข่ายชัดเจน','Maintenance,All',2,true],
    ['C-14-2','ตู้/ห้องควบคุมไฟฟ้า','14.2','ไม่มีวัสดุอันตรายหรือสิ่งไม่เกี่ยวข้องในห้อง พื้น ผนัง ฝ้าไม่ชำรุด','ห้องสภาพดี ไม่มีน้ำรั่วซึม ไม่กีดขวางการปฏิบัติงาน','Maintenance,All',2,true],
    ['C-14-3','ตู้/ห้องควบคุมไฟฟ้า','14.3','สภาพภายในตู้สมบูรณ์ ไม่มีจุดเสี่ยงต่อความปลอดภัย','ไม่มีความเสี่ยงต่อชีวิตและทรัพย์สิน','Maintenance,All',2,true],
    ['C-14-4','ตู้/ห้องควบคุมไฟฟ้า','14.4','พื้นที่และอุปกรณ์ภายในห้องสะอาด รวมถึงภายในตู้ควบคุม','ภายในตู้และห้องสะอาด ไม่มีฝุ่นหยากไย่','Maintenance,All',2,true],
    // 15. ห้องประชุม (5 ข้อ)
    ['C-15-1','ห้องประชุม','15.1','พื้น ผนัง เพดาน หน้าต่าง ประตูสะอาด ไม่ชำรุด','สะอาดไม่มีฝุ่น มีแผนซ่อมถ้าชำรุด','Office',2,true],
    ['C-15-2','ห้องประชุม','15.2','โต๊ะประชุมและเก้าอี้จัดเป็นระเบียบเรียบร้อย','จัดวางเป็นระเบียบ','Office',2,true],
    ['C-15-3','ห้องประชุม','15.3','มีแผนผังการจัดห้องและวัสดุอุปกรณ์แสดงในตำแหน่งที่สังเกตได้','Layout ห้องประชุมติดในตำแหน่งสังเกตได้ง่าย','Office',2,true],
    ['C-15-4','ห้องประชุม','15.4','กรณีมีกระดาน อุปกรณ์จัดเก็บได้โดยสะดวกเหมาะสม','ปากกา แปรงลบกระดานจัดเก็บได้ง่าย','Office',2,true],
    ['C-15-5','ห้องประชุม','15.5','อุปกรณ์ไฟฟ้า สายไฟ สายอินเตอร์เน็ตติดตั้งเป็นระเบียบ','สายไฟและสายเน็ตเป็นระเบียบ','Office',2,true],
    // 16. ห้อง/พื้นที่จัดเก็บของสำนักงานส่วนกลาง (3 ข้อ — ใหม่ทั้งหมด)
    ['C-16-1','ห้อง/พื้นที่จัดเก็บของสำนักงานส่วนกลาง','16.1','จัดเก็บวัสดุอุปกรณ์เป็นหมวดหมู่ แยกประเภทไม่ปะปนกัน','จัดหมวดหมู่ชัดเจน แยกประเภท','Office',2,true],
    ['C-16-2','ห้อง/พื้นที่จัดเก็บของสำนักงานส่วนกลาง','16.2','มีระบบควบคุมวัสดุอุปกรณ์ เช่น ทะเบียนคุม Stock card หรือ QR Code','แสดงข้อมูลชนิดและปริมาณวัสดุที่จัดเก็บ','Office',2,true],
    ['C-16-3','ห้อง/พื้นที่จัดเก็บของสำนักงานส่วนกลาง','16.3','พื้นที่จัดเก็บสะอาด ไม่มีฝุ่น หยากไย่ ไม่ชำรุด','สะอาด ไม่สกปรก ไม่มีหยากไย่ฝุ่นละอองสะสม','Office',2,true],
    // 17. ตู้ล็อคเกอร์/ชั้นวางรองเท้า/ตู้ล็อคเกอร์เก็บของพนักงาน (3 ข้อ — เดิมคือหมวด 16)
    ['C-17-1','ตู้ล็อคเกอร์/ชั้นวางรองเท้า','17.1','มีป้ายแสดงชื่อ/รหัส/ตำแหน่งเพื่อบ่งชี้ความเป็นเจ้าของ','ชี้บ่งเจ้าของตู้ชัดเจน','All',2,true],
    ['C-17-2','ตู้ล็อคเกอร์/ชั้นวางรองเท้า','17.2','ภายใน ภายนอก และบนตู้สะอาด ไม่มีฝุ่นและคราบสกปรก','ทุกส่วนสะอาด','All',2,true],
    ['C-17-3','ตู้ล็อคเกอร์/ชั้นวางรองเท้า','17.3','ไม่มีสิ่งของวางบนตู้โดยไม่จำเป็น หากจำเป็นวางให้เป็นระเบียบ','วางเป็นระเบียบถ้าจำเป็น','All',2,true],
    // 18. ห้องเก็บสารเคมี สารทำความสะอาด หรือสารเคมีอื่นๆ (5 ข้อ — เดิมคือหมวด 17)
    ['C-18-1','ห้องเก็บสารเคมี','18.1','กำหนดตำแหน่งจัดเก็บสารเคมี มีบริเวณจำเพาะพร้อมป้ายชี้บ่ง','บริเวณจำเพาะพร้อมป้ายชัดเจน','Production,Warehouse',2,true],
    ['C-18-2','ห้องเก็บสารเคมี','18.2','มีเอกสาร SDS หยิบใช้ได้สะดวก','SDS หยิบใช้งานได้ง่าย','Production,Warehouse',2,true],
    ['C-18-3','ห้องเก็บสารเคมี','18.3','มีวิธีการเตรียมสารเคมีติดในบริเวณเตรียมหรือหยิบใช้ได้สะดวก','วิธีเตรียมสารเคมีติดไว้ในบริเวณใช้งาน','Production,Warehouse',2,true],
    ['C-18-4','ห้องเก็บสารเคมี','18.4','มีบันทึกเบิก-จ่ายเป็นปัจจุบัน','Record เบิก-จ่าย Update สม่ำเสมอ','Production,Warehouse',2,true],
    ['C-18-5','ห้องเก็บสารเคมี','18.5','จัดเก็บล็อคหรือป้องกันบุคคลที่ไม่เกี่ยวข้อง','มีการล็อคหรือกันเข้าถึงโดยไม่ได้รับอนุญาต','Production,Warehouse',2,true],
    // 19. เครื่องถ่ายเอกสาร/เครื่องปริ้น (2 ข้อ — เดิมคือหมวด 18)
    ['C-19-1','เครื่องถ่ายเอกสาร/ปริ้น','19.1','สภาพเครื่องสะอาด อยู่ในสภาพพร้อมใช้งาน','สภาพเครื่องสะอาด ไม่ชำรุด','Office',2,true],
    ['C-19-2','เครื่องถ่ายเอกสาร/ปริ้น','19.2','ไม่พบกระดาษหรือเอกสารที่ปริ้นทิ้งไว้ที่เครื่อง','ไม่มีเอกสารค้างที่เครื่องปริ้น','Office',2,true],
    // 20. พื้นทางเดิน พื้นห้อง (3 ข้อ — เดิมคือหมวด 19)
    ['C-20-1','พื้นทางเดิน/พื้นห้อง','20.1','สะอาด ไม่มีเศษขยะ ผงฝุ่น หรือน้ำบนพื้นทางเดิน','พื้นทางเดินสะอาดตลอดเวลา','All',2,true],
    ['C-20-2','พื้นทางเดิน/พื้นห้อง','20.2','วางของเป็นระเบียบ ไม่มีอุปกรณ์ไม่เกี่ยวข้องกีดขวางทางเดิน','ไม่มีอุปกรณ์ที่ไม่เกี่ยวข้องกีดขวาง','All',2,true],
    ['C-20-3','พื้นทางเดิน/พื้นห้อง','20.3','ถ้าต้องวางสิ่งของ กำหนดขอบเขตพื้นที่ชัดเจน','ขอบเขตพื้นที่วางชัดเจน มีสัญลักษณ์','All',2,true],
    // 21. หน้าต่าง ประตู ผนัง เพดาน (4 ข้อ — เดิมคือหมวด 20)
    ['C-21-1','หน้าต่าง/ประตู/ผนัง/เพดาน','21.1','สภาพสมบูรณ์ไม่ชำรุด','ไม่มีส่วนชำรุดโดยไม่มีแผนซ่อม','All',2,true],
    ['C-21-2','หน้าต่าง/ประตู/ผนัง/เพดาน','21.2','ติดสัญลักษณ์ ผลัก/ดึง/เลื่อน/ห้ามเปิด/ชำรุด ที่ประตู/หน้าต่าง','ป้ายบอกสถานะประตูหน้าต่างครบถ้วน','All',2,true],
    ['C-21-3','หน้าต่าง/ประตู/ผนัง/เพดาน','21.3','สะอาด ไม่มีหยากไย่ ไม่มีคราบสกปรก','ไม่มีคราบหรือหยากไย่สะสม','All',2,true],
    ['C-21-4','หน้าต่าง/ประตู/ผนัง/เพดาน','21.4','ห้ามติดกระดาษโน๊ตหรือวางของบนขอบประตู/หน้าต่าง/ผนัง','ยกเว้น Layout หรือป้ายชี้บ่งสถานะ','All',2,true],
    // 22. หลอดไฟ สวิทซ์ไฟ ฝาครอบสวิทซ์ไฟ และฝาครอบหลอดไฟ (3 ข้อ — เดิมคือหมวด 21)
    ['C-22-1','หลอดไฟ/สวิทซ์ไฟ','22.1','สวิทซ์ สายไฟ หลอดไฟ ใช้งานได้ดี ไม่ชำรุด มีความปลอดภัย','ไม่มีส่วนแตกหัก ปลอดภัย','All',2,true],
    ['C-22-2','หลอดไฟ/สวิทซ์ไฟ','22.2','สะอาด ไม่มีหยากไย่ ไม่มีน้ำและคราบฝังลึก','ไม่มีคราบหรือหยากไย่','All',2,true],
    ['C-22-3','หลอดไฟ/สวิทซ์ไฟ','22.3','ถ้ามีสวิทซ์มากกว่า 1 สวิทซ์ ให้ระบุตำแหน่ง เปิด-ปิด หรือ Layout','ระบุตำแหน่ง เปิด-ปิด หรือ Layout','All',2,true],
    // 23. พัดลม/เครื่องปรับอากาศ (2 ข้อ — เดิมคือหมวด 22)
    ['C-23-1','พัดลม/เครื่องปรับอากาศ','23.1','สะอาด ไม่มีหยากไย่ สามารถใช้งานได้ตามปกติ มีป้ายแสดงถ้าเสีย','มีป้ายแสดงถ้าเสีย','All',2,true],
    ['C-23-2','พัดลม/เครื่องปรับอากาศ','23.2','ปิดพัดลม/แอร์ทุกครั้งที่ไม่มีการใช้งาน','ประหยัดพลังงาน ปิดเมื่อไม่ใช้','All',2,true],
    // 24. เครื่องคอมพิวเตอร์และอุปกรณ์ สายไฟ ปลั๊กพ่วง สายโทรศัพท์ (2 ข้อ — เดิมคือหมวด 23)
    ['C-24-1','คอมพิวเตอร์และอุปกรณ์','24.1','สะอาด ไม่มีฝุ่นสะสม สภาพสมบูรณ์ จัดเก็บสายไฟเป็นระเบียบ','สายไฟเก็บเป็นระเบียบ ไม่รกรุงรัง','Office',2,true],
    ['C-24-2','คอมพิวเตอร์และอุปกรณ์','24.2','ไม่ติดกระดาษโน๊ต สติ๊กเกอร์หรือข้อความใดๆ บนเครื่องคอมพิวเตอร์','ไม่มีสติ๊กเกอร์หรือกระดาษโน๊ตบนเครื่อง','Office',2,true],
    // 25. โต๊ะทำงาน และลิ้นชัก เก้าอี้ (6 ข้อ — เดิมคือหมวด 24)
    ['C-25-1','โต๊ะทำงาน/ลิ้นชัก/เก้าอี้','25.1','สะอาด ไม่มีฝุ่นสะสมหรือคราบสกปรกบนโต๊ะและเก้าอี้','ทุกส่วนสะอาด','Office',2,true],
    ['C-25-2','โต๊ะทำงาน/ลิ้นชัก/เก้าอี้','25.2','จัดวางสิ่งของเป็นระเบียบ สะดวกในการใช้งาน','สิ่งของบนโต๊ะเป็นระเบียบ','Office',2,true],
    ['C-25-3','โต๊ะทำงาน/ลิ้นชัก/เก้าอี้','25.3','ใต้โต๊ะวางได้ไม่เกิน 1 กล่อง หรือของที่กำหนด','เคสคอม UPS ถังขยะ หรือกล่องไม่เกิน 1','Office',2,true],
    ['C-25-4','โต๊ะทำงาน/ลิ้นชัก/เก้าอี้','25.4','ภายในลิ้นชักจัดวางของเป็นระเบียบ','ลิ้นชักเป็นระเบียบ','Office',2,true],
    ['C-25-5','โต๊ะทำงาน/ลิ้นชัก/เก้าอี้','25.5','กรณีมีถาดเอกสาร/ชั้นเอกสาร ทำป้ายชี้บ่งระบุการจัดเก็บ','ถาดเอกสารชี้บ่งชัดเจน','Office',2,true],
    ['C-25-6','โต๊ะทำงาน/ลิ้นชัก/เก้าอี้','25.6','เลื่อนเก้าอี้ไว้ใต้โต๊ะทุกครั้งที่ลุกออกจากที่นั่ง','เก้าอี้เก็บใต้โต๊ะเสมอ','Office',2,true],
    // 26. ตู้เอกสาร/ชั้นเก็บเอกสาร สันแฟ้มและการจัดเก็บแฟ้ม (6 ข้อ — เดิมคือหมวด 25)
    ['C-26-1','ตู้เอกสาร/ชั้นวางแฟ้ม','26.1','กำหนดรหัส/ชื่อตู้และชั้นวางแฟ้มให้ค้นหาง่าย','ป้ายชื่อตู้และชั้นชัดเจน','Office',2,true],
    ['C-26-2','ตู้เอกสาร/ชั้นวางแฟ้ม','26.2','ภายนอก ภายใน และบนตู้สะอาด','ทุกส่วนสะอาด','Office',2,true],
    ['C-26-3','ตู้เอกสาร/ชั้นวางแฟ้ม','26.3','เอกสารในตู้จัดวางเป็นหมวดหมู่ ไม่มีของไม่เกี่ยวข้อง','ไม่วางสิ่งของที่ไม่ใช่เอกสารในตู้','Office',2,true],
    ['C-26-4','ตู้เอกสาร/ชั้นวางแฟ้ม','26.4','กรณีวางของบนตู้ จัดวางเป็นระเบียบ มีความปลอดภัย','วางระเบียบ ไม่เสี่ยงล้ม','Office',2,true],
    ['C-26-5','ตู้เอกสาร/ชั้นวางแฟ้ม','26.5','สันแฟ้มมีตราสัญลักษณ์บริษัท ชื่อหน่วยงาน รหัส/ดัชนี','สันแฟ้มครบถ้วนตามมาตรฐาน','Office',2,true],
    ['C-26-6','ตู้เอกสาร/ชั้นวางแฟ้ม','26.6','จัดประเภทเรียงลำดับแฟ้มตามรหัสดัชนีต่อเนื่อง','เรียงลำดับต่อเนื่องทั้งหมด','Office',2,true],
    // 27. ห้องแต่งตัว เปลี่ยนชุดเข้า-ออกไลน์ผลิต (5 ข้อ — เดิมคือหมวด 26)
    ['C-27-1','ห้องแต่งตัว/เปลี่ยนชุด','27.1','พื้น อ่างล้างมือ ชั้นวางรองเท้า ตู้ล็อกเกอร์สะอาด ไม่มีฝุ่นและคราบ','ทุกส่วนในห้องแต่งตัวสะอาด','Production',2,true],
    ['C-27-2','ห้องแต่งตัว/เปลี่ยนชุด','27.2','สบู่เหลวเพียงพอ มีวิธีล้างมือถูกต้องติดให้เห็นชัดเจน','วิธีล้างมือแสดงชัด','Production',2,true],
    ['C-27-3','ห้องแต่งตัว/เปลี่ยนชุด','27.3','มีวิธีแต่งตัวสำหรับแต่ละพื้นที่อย่างเหมาะสม ก่อนเข้าพื้นที่','แสดงวิธีแต่งตัวก่อนเข้าแต่ละพื้นที่','Production',2,true],
    ['C-27-4','ห้องแต่งตัว/เปลี่ยนชุด','27.4','ชี้บ่งตู้เก็บชุดชัดเจน จัดเก็บถูกต้องตามป้าย','ตู้ visitor ใช้เฉพาะ visitor','Production',2,true],
    ['C-27-5','ห้องแต่งตัว/เปลี่ยนชุด','27.5','ไม่มีอุปกรณ์ที่ไม่เกี่ยวข้องในพื้นที่','ไม่มีสิ่งของที่ไม่ใช่อุปกรณ์แต่งตัว','Production',2,true],
    // 28. โต๊ะปฏิบัติงาน พื้นที่ผลิต (3 ข้อ — เดิมคือหมวด 27)
    ['C-28-1','โต๊ะปฏิบัติงาน (ผลิต)','28.1','สะอาด ไม่มีฝุ่น ไม่มีของไม่เกี่ยวข้องบนโต๊ะ','โต๊ะผลิตสะอาดระหว่างและหลังใช้งาน','Production',2,true],
    ['C-28-2','โต๊ะปฏิบัติงาน (ผลิต)','28.2','อยู่ในสภาพพร้อมใช้งาน ไม่ชำรุด','สภาพสมบูรณ์','Production',2,true],
    ['C-28-3','โต๊ะปฏิบัติงาน (ผลิต)','28.3','หลังปฏิบัติงาน/ไม่ใช้งาน เก็บสิ่งของบนโต๊ะให้เรียบร้อย','โต๊ะสะอาดเมื่อเลิกใช้งาน','Production',2,true],
    // 29. ห้องผลิต (6 ข้อ — เดิมคือหมวด 28)
    ['C-29-1','ห้องผลิต','29.1','แบ่งส่วนห้องผลิตชัดเจนตามการปฏิบัติงานจริง','Zone การผลิตชัดเจน','Production',2,true],
    ['C-29-2','ห้องผลิต','29.2','มีป้ายชื่อห้องติดที่หน้าห้อง','ป้ายชื่อห้องชัดเจน','Production',2,true],
    ['C-29-3','ห้องผลิต','29.3','สะอาด ไม่มีฝุ่น หยากไย่ และมีบันทึกทำความสะอาด บันทึกอื่นๆ ที่เกี่ยวข้องอัพเดตปัจจุบัน','บันทึกทำความสะอาด Update สม่ำเสมอ','Production',2,true],
    ['C-29-4','ห้องผลิต','29.4','สภาพห้องสมบูรณ์เหมาะสมกับการผลิต','ห้องสมบูรณ์พร้อมผลิต','Production',2,true],
    ['C-29-5','ห้องผลิต','29.5','ไม่มีสิ่งของไม่เกี่ยวข้องในบริเวณผลิต หากจำเป็นให้จัดเก็บเป็นระเบียบ','อะไหล่จัดเก็บเป็นระเบียบถ้าจำเป็น','Production',2,true],
    ['C-29-6','ห้องผลิต','29.6','ติดป้ายแสดงสถานะการทำงาน ตรงกับการทำงานจริง','สถานะป้ายตรงกับสถานะจริงของงาน','Production',2,true],
    // 30. เครื่องจักรและอุปกรณ์ที่เกี่ยวข้อง (6 ข้อ — เดิมคือหมวด 29)
    ['C-30-1','เครื่องจักรและอุปกรณ์','30.1','ติดตั้งเหมาะสมกับการใช้งาน สะดวกต่อการเข้าบำรุงรักษา','Layout เครื่องจักรเหมาะกับการใช้งาน','Production,Maintenance',2,true],
    ['C-30-2','เครื่องจักรและอุปกรณ์','30.2','มีป้ายบ่งบอกรหัสเครื่องจักรติดที่เครื่องให้ชัดเจน','ป้ายรหัสตรงกับ Layout พื้นที่','Production,Maintenance',2,true],
    ['C-30-3','เครื่องจักรและอุปกรณ์','30.3','มีคู่มือการปฏิบัติงานและการบำรุงรักษาหยิบใช้ได้สะดวก','WI / คู่มือควบคุมเครื่องหยิบใช้ง่าย','Production,Maintenance',2,true],
    ['C-30-4','เครื่องจักรและอุปกรณ์','30.4','สะอาด ไม่มีฝุ่นและคราบ มีบันทึกตรวจสอบสภาพเป็นประจำ','บันทึกตรวจสอบสภาพเครื่องจักร Update','Production,Maintenance',2,true],
    ['C-30-5','เครื่องจักรและอุปกรณ์','30.5','ไม่มีอุปกรณ์อื่นที่ไม่เกี่ยวข้องวางปะปนกับเครื่องจักร','ไม่มีสิ่งของนอกเครื่องวางบนเครื่องจักร','Production,Maintenance',2,true],
    ['C-30-6','เครื่องจักรและอุปกรณ์','30.6','พร้อมใช้งาน ถ้าชำรุด/เสียต้องมีป้ายบ่งชี้สถานะรอซ่อม','ป้าย "รอซ่อม" ชัดเจนเมื่อเครื่องเสีย','Production,Maintenance',2,true],
    // 31. การจัดวางและจัดเก็บผลิตภัณฑ์ วัตถุดิบ และพาเลท (5 ข้อ — เดิมคือหมวด 30)
    ['C-31-1','การจัดวางผลิตภัณฑ์/วัตถุดิบ/พาเลท','31.1','มีป้ายชี้บ่งการจำแนกและแสดงสถานะผลิตภัณฑ์/วัตถุดิบ/พาเลทชัดเจน','จำแนกสถานะชัดเจนทุกชิ้น','Warehouse,Production',2,true],
    ['C-31-2','การจัดวางผลิตภัณฑ์/วัตถุดิบ/พาเลท','31.2','กำหนดขอบเขตพื้นที่วางผลิตภัณฑ์/วัตถุดิบ/พาเลทชัดเจน','เส้นแบ่งพื้นที่ชัดเจน','Warehouse,Production',2,true],
    ['C-31-3','การจัดวางผลิตภัณฑ์/วัตถุดิบ/พาเลท','31.3','ตะกร้า กะบะ พาเลท พร้อมใช้งาน ไม่แตกหัก จัดเก็บในพื้นที่กำหนด','ไม่แตกหัก วางถูกที่','Warehouse,Production',2,true],
    ['C-31-4','การจัดวางผลิตภัณฑ์/วัตถุดิบ/พาเลท','31.4','ชั้นวาง บรรจุภัณฑ์ กะบะ ตะกร้า พาเลทสะอาด ไม่มีฝุ่นและหยากไย่','ทำความสะอาดสม่ำเสมอ','Warehouse,Production',2,true],
    ['C-31-5','การจัดวางผลิตภัณฑ์/วัตถุดิบ/พาเลท','31.5','วางวัตถุดิบและภาชนะถูกต้องตามข้อกำหนด มีความปลอดภัย','วางบนพาเลท ห่างจากผนัง ตามข้อกำหนด GMP/SOP','Warehouse,Production',2,true],
    // 32. รถเข็น รถใส่งาน แฮนด์ลิฟท์ รถยกไฟฟ้า (4 ข้อ — เดิมคือหมวด 31)
    ['C-32-1','รถเข็น/แฮนด์ลิฟท์/รถยกไฟฟ้า','32.1','อยู่ในสภาพพร้อมใช้งาน ไม่ชำรุด','สภาพสมบูรณ์','Warehouse,Production',2,true],
    ['C-32-2','รถเข็น/แฮนด์ลิฟท์/รถยกไฟฟ้า','32.2','กำหนดจุดจอดชัดเจน ระบุใน Layout','จุดจอดมีสัญลักษณ์/ป้ายชัดเจน','Warehouse,Production',2,true],
    ['C-32-3','รถเข็น/แฮนด์ลิฟท์/รถยกไฟฟ้า','32.3','สะอาด ไม่มีฝุ่น ไม่มีคราบน้ำมันสะสม (แฮนด์ลิฟท์/รถยก)','ไม่มีคราบน้ำมันสะสม','Warehouse,Production',2,true],
    ['C-32-4','รถเข็น/แฮนด์ลิฟท์/รถยกไฟฟ้า','32.4','ไม่มีสิ่งของไม่เกี่ยวข้องวางบนรถเมื่อไม่ใช้งาน','รถสะอาด ไม่มีของค้าง','Warehouse,Production',2,true],
    // 33. ห้องล้างอุปกรณ์ (4 ข้อ — เดิมคือหมวด 32)
    ['C-33-1','ห้องล้างอุปกรณ์','33.1','สภาพห้องสมบูรณ์ พื้น ผนัง เพดานไม่ชำรุด ไม่มีรูหรือช่องเสี่ยงปนเปื้อน','ไม่มีช่องที่เสี่ยงต่อการปนเปื้อนข้าม','Production',2,true],
    ['C-33-2','ห้องล้างอุปกรณ์','33.2','พื้นไม่มีน้ำขัง ผนัง เพดานสะอาด ไม่เป็นแหล่งสะสมคราบ','ไม่มีน้ำขังและคราบสะสม','Production',2,true],
    ['C-33-3','ห้องล้างอุปกรณ์','33.3','สายยางจัดเก็บเรียบร้อย ไม่วางกับพื้น','สายยางเก็บบนที่แขวนหรือม้วนเก็บ','Production',2,true],
    ['C-33-4','ห้องล้างอุปกรณ์','33.4','รถเข็น ถังบีบ ม็อบ อุปกรณ์ทำความสะอาดจัดเก็บในที่กำหนด พร้อมใช้งาน','อุปกรณ์วางถูกที่ พร้อมใช้งาน','Production',2,true],
    // 34. โรงอาหาร (8 ข้อ — เดิมคือหมวด 33)
    ['C-34-1','โรงอาหาร','34.1','สะอาด ไม่มีผงฝุ่น น้ำบนพื้น ไม่มีกลิ่น ไม่มีเศษขยะ/อาหาร','พื้นโรงอาหารสะอาดตลอดเวลา','Cafeteria',2,true],
    ['C-34-2','โรงอาหาร','34.2','ไม่มีสิ่งของไม่เกี่ยวข้องในบริเวณโรงอาหาร เช่น เครื่องจักร','ไม่มีเครื่องจักรหรืออุปกรณ์ผลิตในโรงอาหาร','Cafeteria',2,true],
    ['C-34-3','โรงอาหาร','34.3','โต๊ะเก้าอี้ไม่ชำรุด','สภาพสมบูรณ์','Cafeteria',2,true],
    ['C-34-4','โรงอาหาร','34.4','โต๊ะอาหาร/เตรียมอาหาร เก้าอี้ ชั้นวางจาน เครื่องใช้ครัว สะอาดและจัดวางเป็นระเบียบ','ทุกอุปกรณ์ครัวสะอาดและเป็นระเบียบ','Cafeteria',2,true],
    ['C-34-5','โรงอาหาร','34.5','อุปกรณ์เครื่องครัวและเครื่องใช้ไฟฟ้าสะอาดทั้งภายในและภายนอก','หม้อหุงข้าว ไมโครเวฟ กระติกน้ำร้อนสะอาด','Cafeteria',2,true],
    ['C-34-6','โรงอาหาร','34.6','ถังขยะมีฝาปิดมิดชิด หรือขยะไม่ล้นออกจากถัง','ฝาปิดมิดชิด ขยะไม่ล้น','Cafeteria',2,true],
    ['C-34-7','โรงอาหาร','34.7','ปลั๊กไฟ สวิทซ์ไฟ สายไฟ ปลั๊กพ่วงพร้อมใช้งาน ไม่ชำรุด','สภาพสมบูรณ์ปลอดภัย','Cafeteria',2,true],
    ['C-34-8','โรงอาหาร','34.8','โครงสร้างเพดาน ผนังสะอาด ไม่มีหยากไย่ ไม่มีนกตายบนตาข่ายกันนก','สภาพโครงสร้างสะอาดสมบูรณ์','Cafeteria',2,true],
  ];

  // เขียนลง Sheet
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, criteria.length, 8).setValues(criteria);

  Logger.log('✅ setupCriteria เสร็จสมบูรณ์ — เพิ่ม ' + criteria.length + ' รายการ (มาตรฐาน R.00 16.06.2026)');
}

// ============================================================
// SETUP — รันครั้งเดียวตอน Setup
// ============================================================
function setupSystem() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // ป้องกันการรัน setupSystem ซ้ำ — ตรวจทั้ง Audit_Header และ User_Master
  const existingAudit = ss.getSheetByName(SHEETS.AUDIT_HEADER);
  const existingUsers = ss.getSheetByName(SHEETS.USER_MASTER);
  if ((existingAudit && existingAudit.getLastRow() > 1) ||
      (existingUsers && existingUsers.getLastRow() > 1)) {
    Logger.log('⚠️ มีข้อมูลอยู่แล้ว (Audit หรือ User) — ยกเลิก setupSystem เพื่อป้องกันข้อมูลหาย');
    Logger.log('   หากต้องการ Reset จริงๆ ให้ลบ Sheet ด้วยมือก่อน');
    return;
  }

  setupSheet(ss, SHEETS.PLANT_MASTER, ['Plant_ID','Plant_Name','Status'], [
    ['SUP','Supplement Plant','Active'],
    ['POC','Personal and Oral Care Plant','Active'],
    ['NIF','Nutrina Interfoods Plant','Active']
  ]);

  setupSheet(ss, SHEETS.AREA_MASTER, ['Area_ID','Plant_ID','Area_Name','Area_Type','Status'], [
    ['SUP-WH-F1','SUP','Warehouse F1','Warehouse','Active'],['SUP-WH-F2','SUP','Warehouse F2','Warehouse','Active'],['SUP-WH-F3','SUP','Warehouse F3','Warehouse','Active'],
    ['SUP-PR-F1','SUP','Production Line F1','Production','Active'],['SUP-PR-F2','SUP','Production Line F2','Production','Active'],['SUP-PR-F3','SUP','Production Line F3','Production','Active'],
    ['SUP-OF-F1','SUP','Office F1','Office','Active'],['SUP-OF-F2','SUP','Office F2','Office','Active'],['SUP-OF-F3','SUP','Office F3','Office','Active'],
    ['SUP-MU','SUP','Maintenance & Utility','Maintenance','Active'],['SUP-CF','SUP','Cafeteria','Cafeteria','Active'],['SUP-OD','SUP','รอบอาคาร','Outdoor','Active'],
    ['POC-WH-F1','POC','Warehouse F1','Warehouse','Active'],['POC-WH-F2','POC','Warehouse F2','Warehouse','Active'],['POC-WH-F3','POC','Warehouse F3','Warehouse','Active'],
    ['POC-PR-F1','POC','Production Line F1','Production','Active'],['POC-PR-F2','POC','Production Line F2','Production','Active'],['POC-PR-F3','POC','Production Line F3','Production','Active'],
    ['POC-OF-F1','POC','Office F1','Office','Active'],['POC-OF-F2','POC','Office F2','Office','Active'],['POC-OF-F3','POC','Office F3','Office','Active'],
    ['POC-MU','POC','Maintenance & Utility','Maintenance','Active'],['POC-CF','POC','Cafeteria','Cafeteria','Active'],['POC-OD','POC','รอบอาคาร','Outdoor','Active'],
    ['NIF-WH-F1','NIF','Warehouse F1','Warehouse','Active'],['NIF-WH-F2','NIF','Warehouse F2','Warehouse','Active'],['NIF-WH-F3','NIF','Warehouse F3','Warehouse','Active'],
    ['NIF-PR-F1','NIF','Production Line F1','Production','Active'],['NIF-PR-F2','NIF','Production Line F2','Production','Active'],['NIF-PR-F3','NIF','Production Line F3','Production','Active'],
    ['NIF-OF-F1','NIF','Office F1','Office','Active'],['NIF-OF-F2','NIF','Office F2','Office','Active'],['NIF-OF-F3','NIF','Office F3','Office','Active'],
    ['NIF-MU','NIF','Maintenance & Utility','Maintenance','Active'],['NIF-CF','NIF','Cafeteria','Cafeteria','Active'],['NIF-OD','NIF','รอบอาคาร','Outdoor','Active']
  ]);

  setupSheet(ss, SHEETS.AUDIT_HEADER,  ['Audit_ID','Plant_ID','Area_ID','Auditor_ID','Audit_Date','Total_Score','Max_Score','Percent','Status'], []);
  setupSheet(ss, SHEETS.AUDIT_DETAIL,  ['Detail_ID','Audit_ID','Criteria_ID','Score','Remark','Photo_URL'], []);

  // Hash passwords ก่อน insert (ไม่เก็บ plain-text)
  setupSheet(ss, SHEETS.USER_MASTER,   ['User_ID','Employee_ID','Name','Department','Email','Password','Role','Status','Assigned_Plants','Assigned_Areas'], [
    ['USR-001','EMP001','Admin System',  'IT',          'admin@company.com',   hashPassword('admin1234'), 'Admin',   'Active', '', ''],
    ['USR-002','EMP002','คุณบอน',        'QA',          'bon@company.com',     hashPassword('pass1234'),  'Auditor', 'Active', '', ''],
    ['USR-003','EMP003','คุณเล็ก',       'QA',          'lek@company.com',     hashPassword('pass1234'),  'Auditor', 'Active', '', ''],
    ['USR-004','EMP004','คุณมด',         'Production',  'mod@company.com',     hashPassword('pass1234'),  'Auditor', 'Active', '', ''],
    ['USR-005','EMP005','คุณแหวน',       'Production',  'waen@company.com',    hashPassword('pass1234'),  'Auditor', 'Active', '', ''],
    ['USR-006','EMP006','Manager QA',   'QA',          'manager@company.com', hashPassword('pass1234'),  'Manager', 'Active', '', '']
  ]);

  // Criteria_Master — headers เท่านั้น (Admin ต้อง fill ข้อมูลจาก มาตรฐาน_5ส_Draft 2026)
  setupSheet(ss, SHEETS.CRITERIA_MASTER,
    ['Criteria_ID','Category','Sub_Category','Question','Description','Area_Type','Max_Score','Active'], []);
  setupSheet(ss, SHEETS.SCHEDULE_MASTER, ['Schedule_ID','Audit_Round','Audit_Date','Plant_ID','Area_ID','Auditor_ID','Status'], [
    ['SCH-001','Round 1','2026-08-07','SUP','','','Pending'],
    ['SCH-002','Round 1','2026-08-07','POC','','','Pending'],
    ['SCH-003','Round 1','2026-08-07','NIF','','','Pending'],
    ['SCH-004','Round 2','2026-11-06','SUP','','','Pending'],
    ['SCH-005','Round 2','2026-11-06','POC','','','Pending'],
    ['SCH-006','Round 2','2026-11-06','NIF','','','Pending']
  ]);
  setupSheet(ss, SHEETS.AUDIT_LOG, ['Log_ID','User','Action','Detail','DateTime'], []);
  getOrCreateSheet(ss, SHEETS.SESSIONS, ['Token','User_ID','Email','Role','Created','Expiry']);

  Logger.log('✅ Setup เสร็จสมบูรณ์!');
}

function resetPassword() {
  const email   = 'seksun@pronovalabs.com'; // ← เปลี่ยน email
  const newPass = 'ใส่รหัสผ่านใหม่ที่นี่';  // ← ใส่ password ที่ต้องการ

  const ss      = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(SHEETS.USER_MASTER);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('Email');
  const passIdx  = headers.indexOf('Password');

  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === email) {
      sheet.getRange(i + 1, passIdx + 1).setValue(hashPassword(newPass));
      Logger.log('✅ เปลี่ยน Password ของ ' + email + ' เรียบร้อย');
      return;
    }
  }
  Logger.log('❌ ไม่พบ email: ' + email);
}

function setupSheet(ss, name, headers, data) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); } else { sheet.clearContents(); }
  sheet.appendRow(headers);
  if (data && data.length) sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  const hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setBackground('#1a73e8'); hr.setFontColor('#ffffff'); hr.setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
  Logger.log('Setup sheet: ' + name);
  return sheet;
}
