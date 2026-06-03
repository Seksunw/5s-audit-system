/**
 * ============================================================
 * app.js - ระบบตรวจ 5ส โรงงาน
 * Frontend JavaScript - ES6+ / Mobile First / PWA
 * ============================================================
 */

// ============================================================
// CONFIG - แก้ API_URL ให้ตรงกับ Google Apps Script URL
// ============================================================
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby2pJ2pv7OTnn2wKtWUJU3uC0rNRDQBc2prMQR0d3PtaoolwsDZEHVLYdtl9YSIu20Y/exec',
  IMGBB_API_KEY: '8449d25d43f8b34c3b7b046ec9a5451f',  // ← ใส่ API Key จาก api.imgbb.com
  APP_NAME: 'ระบบตรวจ 5ส',
  VERSION: '1.0.0',
  SESSION_KEY: '5s_session',
  CACHE_TTL: 5 * 60 * 1000,  // 5 นาที (ms)
};

// ============================================================
// STATE MANAGEMENT - ข้อมูลสถานะของแอป
// ============================================================
const AppState = {
  user:          null,   // ข้อมูลผู้ใช้ที่ login
  token:         null,   // Session token
  currentPlant:  null,   // Plant ที่เลือก
  currentArea:   null,   // Area ที่เลือก
  plants:        [],     // รายการ plants
  areas:         [],     // รายการ areas
  criteria:      [],     // Checklist items
  auditAnswers:  {},     // { criteriaId: { score, remark, photos:[] } }
  auditPhotos:   {},     // { criteriaId: [base64Data...] }
  cache:         {},     // Cache ข้อมูล API
};

// ============================================================
// API SERVICE - ติดต่อกับ Google Apps Script
// GAS Web App ต้องการ redirect:'follow' และรับ text ก่อน parse JSON
// ============================================================
const API = {
  /**
   * เรียก API แบบ GET
   */
  async get(action, params = {}) {
    const cacheKey = action + JSON.stringify(params);
    const cached   = AppState.cache[cacheKey];
    if (cached && (Date.now() - cached.time < CONFIG.CACHE_TTL)) {
      return cached.data;
    }

    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('token', AppState.token || '');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    // GAS ส่ง redirect → ต้องใช้ redirect:'follow' และรับ text ก่อน
    const res  = await fetch(url.toString(), { redirect: 'follow' });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      console.error('GAS response (not JSON):', text.slice(0, 300));
      throw new Error('Server returned invalid response. ตรวจสอบว่า Deploy GAS ถูกต้องแล้ว');
    }

    if (data.success) {
      AppState.cache[cacheKey] = { data, time: Date.now() };
    }

    return data;
  },

  /**
   * เรียก API แบบ POST
   * GAS Web App: POST ต้องส่งเป็น application/x-www-form-urlencoded
   * หรือส่ง JSON ผ่าน query param แทน (เพื่อหลีกเลี่ยง preflight CORS)
   */
  async post(action, body = {}) {
    const payload = JSON.stringify({ action, token: AppState.token, ...body });

    // ส่งเป็น GET พร้อม payload ใน query string เพื่อหลีกเลี่ยง CORS preflight
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('token', AppState.token || '');
    url.searchParams.set('payload', payload);

    const res  = await fetch(url.toString(), { redirect: 'follow' });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch(e) {
      console.error('GAS POST response (not JSON):', text.slice(0, 300));
      throw new Error('Server returned invalid response');
    }
  },

  /**
   * Write operations — ห้าม cache เด็ดขาด
   * ใช้แทน API.get() สำหรับทุก action ที่เขียนข้อมูลลง Sheets
   */
  async write(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('token', AppState.token || '');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    console.log(`[API.write] action=${action}`, params);
    const res  = await fetch(url.toString(), { redirect: 'follow' });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      console.log(`[API.write] response:`, data);
      return data;
    } catch(e) {
      console.error(`GAS write response (not JSON) action=${action}:`, text.slice(0, 300));
      throw new Error('Server returned invalid response');
    }
  },
};

// ============================================================
// SESSION - จัดการ Login / Logout
// ============================================================
const Session = {
  /** บันทึก session ลง localStorage */
  save(token, user) {
    AppState.token = token;
    AppState.user  = user;
    localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({ token, user }));
  },

  /** โหลด session จาก localStorage */
  load() {
    try {
      const data = JSON.parse(localStorage.getItem(CONFIG.SESSION_KEY) || 'null');
      if (data) {
        AppState.token = data.token;
        AppState.user  = data.user;
        return true;
      }
    } catch(e) {}
    return false;
  },

  /** ล้าง session */
  clear() {
    AppState.token = null;
    AppState.user  = null;
    localStorage.removeItem(CONFIG.SESSION_KEY);
  },

  /** ตรวจสอบว่า login อยู่หรือไม่ */
  isLoggedIn() {
    return !!AppState.token;
  },

  /** Guard - redirect ไป login ถ้ายังไม่ login */
  requireLogin() {
    if (!Session.load()) {
      navigate('index.html');
      return false;
    }
    return true;
  }
};

// ============================================================
// NAVIGATION - จัดการการเปลี่ยนหน้า
// ============================================================
function navigate(page, params = {}) {
  const url = new URL(page, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  window.location.href = url.toString();
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ============================================================
// UI HELPERS
// ============================================================
const UI = {
  /** แสดง Loading overlay */
  showLoading(msg = 'กำลังโหลด...') {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.querySelector('.loading-msg').textContent = msg;
      overlay.classList.add('show');
    }
  },

  /** ซ่อน Loading overlay */
  hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('show');
  },

  /** แสดง Toast notification */
  toast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer') ||
                      (() => {
                        const el = document.createElement('div');
                        el.id = 'toastContainer';
                        el.className = 'toast-container';
                        document.body.appendChild(el);
                        return el;
                      })();

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || ''}</span> ${msg}`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /** อัปเดต bottom nav active state */
  setActiveNav(page) {
    document.querySelectorAll('.bottom-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
  },

  /** สร้าง score badge */
  scoreBadge(percent) {
    percent = parseFloat(percent) || 0;
    if (percent >= 90) return `<span class="badge badge-excellent">Excellent ${percent}%</span>`;
    if (percent >= 75) return `<span class="badge badge-good">Good ${percent}%</span>`;
    return `<span class="badge badge-need-improve">Need Improvement ${percent}%</span>`;
  },

  /** ฟอร์แมตวันที่เป็นภาษาไทย */
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                      'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${d.getDate()} ${thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
  },

  /** status class */
  statusClass(percent) {
    percent = parseFloat(percent) || 0;
    if (percent >= 90) return 'excellent';
    if (percent >= 75) return 'good';
    return 'need-improve';
  },

  /** แสดงชื่อสถานะภาษาไทย */
  statusTH(percent) {
    percent = parseFloat(percent) || 0;
    if (percent >= 90) return 'ดีเยี่ยม (Excellent)';
    if (percent >= 75) return 'ผ่าน (Good)';
    return 'ต้องปรับปรุง (Need Improvement)';
  }
};

// ============================================================
// LOGIN PAGE
// ============================================================
async function initLogin() {
  // ถ้า login อยู่แล้ว ไปหน้า home
  if (Session.load()) {
    navigate('home.html');
    return;
  }

  const form     = document.getElementById('loginForm');
  const emailEl  = document.getElementById('email');
  const passEl   = document.getElementById('password');
  const errorEl  = document.getElementById('loginError');
  const submitBtn= document.getElementById('loginBtn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled  = true;
    submitBtn.textContent = 'กำลังเข้าสู่ระบบ...';

    try {
      UI.showLoading('กำลังตรวจสอบ...');
      const res = await API.post('login', {
        email:    emailEl.value.trim(),
        password: passEl.value
      });
      UI.hideLoading();

      if (res.success) {
        Session.save(res.token, res.user);
        UI.toast(`ยินดีต้อนรับ ${res.user.name} 👋`, 'success');
        setTimeout(() => navigate('home.html'), 800);
      } else {
        errorEl.textContent = res.error || 'เข้าสู่ระบบไม่สำเร็จ';
        submitBtn.disabled  = false;
        submitBtn.textContent = 'เข้าสู่ระบบ';
      }
    } catch(err) {
      UI.hideLoading();
      errorEl.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่';
      submitBtn.disabled  = false;
      submitBtn.textContent = 'เข้าสู่ระบบ';
    }
  });
}

// ============================================================
// HOME PAGE
// ============================================================
async function initHome() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  try {
    UI.showLoading();
    const [dashRes, schedRes] = await Promise.all([
      API.get('getDashboard', {}),
      API.get('getSchedule', {})
    ]);
    UI.hideLoading();

    if (dashRes.success) {
      const d = dashRes.data;
      setEl('totalAuditCount', d.totalAudit || 0);
      setEl('avgScoreHome', (d.avgScore || 0) + '%');
      setEl('passRateHome', (d.passRate || 0) + '%');
      setEl('excellentCount', d.excellent || 0);
    }

    // แสดง Next Schedule
    if (schedRes.success && schedRes.data.length) {
      const upcoming = schedRes.data.find(s => s.Status === 'Pending');
      if (upcoming) {
        setEl('nextAuditDate', UI.formatDate(upcoming.Audit_Date));
        setEl('nextAuditRound', upcoming.Audit_Round || '-');
      }
    }
  } catch(err) {
    UI.hideLoading();
    UI.toast('ไม่สามารถโหลดข้อมูลได้', 'error');
  }
}

// ============================================================
// PLANT PAGE
// ============================================================
async function initPlant() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  UI.showLoading('โหลดข้อมูล Plant...');
  try {
    const res = await API.get('getPlants');
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }

    AppState.plants = res.data;
    const container = document.getElementById('plantGrid');
    if (!container) return;

    const icons = { SUP: '🏭', POC: '🧴', NIF: '🌿' };
    const colors = { SUP: '#1a73e8', POC: '#34a853', NIF: '#ea4335' };

    container.innerHTML = res.data.map(p => `
      <div class="plant-card card-clickable" onclick="selectPlant('${p.Plant_ID}','${escHtml(p.Plant_Name)}')">
        <div class="plant-icon" style="background:${colors[p.Plant_ID]}20;color:${colors[p.Plant_ID]}">
          ${icons[p.Plant_ID] || '🏭'}
        </div>
        <div>
          <div class="plant-name">${escHtml(p.Plant_Name)}</div>
          <div class="plant-meta text-muted">Plant ID: ${p.Plant_ID}</div>
        </div>
        <i class="bi bi-chevron-right text-muted ms-auto"></i>
      </div>
    `).join('');
  } catch(err) {
    UI.hideLoading();
    UI.toast('โหลดข้อมูลไม่สำเร็จ', 'error');
  }
}

function selectPlant(plantId, plantName) {
  AppState.currentPlant = { Plant_ID: plantId, Plant_Name: plantName };
  navigate('area.html', { plantId, plantName });
}

// ============================================================
// AREA PAGE
// ============================================================
async function initArea() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  const plantId   = getParam('plantId');
  const plantName = getParam('plantName');
  if (!plantId) { navigate('plant.html'); return; }

  AppState.currentPlant = { Plant_ID: plantId, Plant_Name: plantName };

  setEl('currentPlantName', decodeURIComponent(plantName || plantId));

  UI.showLoading('โหลดพื้นที่ตรวจ...');
  try {
    const res = await API.get('getAreas', { plantId });
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }

    AppState.areas = res.data;
    const container = document.getElementById('areaList');
    if (!container) return;

    // Area type icons
    const areaIcons = {
      Warehouse:   'bi-box-seam',
      Production:  'bi-gear',
      Office:      'bi-building',
      Maintenance: 'bi-tools',
      Cafeteria:   'bi-cup-hot',
      Outdoor:     'bi-tree',
    };

    const areaTypeTH = {
      Warehouse:   'คลังสินค้า',
      Production:  'ไลน์ผลิต',
      Office:      'ออฟฟิศ',
      Maintenance: 'ช่าง/ยูทิลิตี้',
      Cafeteria:   'โรงอาหาร',
      Outdoor:     'รอบอาคาร',
    };

    // Group by type
    const grouped = {};
    res.data.forEach(a => {
      if (!grouped[a.Area_Type]) grouped[a.Area_Type] = [];
      grouped[a.Area_Type].push(a);
    });

    container.innerHTML = Object.entries(grouped).map(([type, areas]) => `
      <div class="mb-3">
        <div class="section-title">
          <i class="bi ${areaIcons[type] || 'bi-grid'}"></i>
          ${areaTypeTH[type] || type}
        </div>
        <div class="area-list">
          ${areas.map(a => `
            <div class="area-card area-type-${escHtml(a.Area_Type)}"
                 onclick="selectArea('${a.Area_ID}','${escHtml(a.Area_Name)}','${escHtml(a.Area_Type)}')">
              <div class="area-icon">
                <i class="bi ${areaIcons[a.Area_Type] || 'bi-grid'}"></i>
              </div>
              <div class="area-info">
                <div class="area-name">${escHtml(a.Area_Name)}</div>
                <span class="area-type-badge">${areaTypeTH[a.Area_Type] || a.Area_Type}</span>
              </div>
              <i class="bi bi-chevron-right text-muted"></i>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  } catch(err) {
    UI.hideLoading();
    UI.toast('โหลดข้อมูลไม่สำเร็จ', 'error');
  }
}

function selectArea(areaId, areaName, areaType) {
  const plantId = getParam('plantId');
  navigate('audit.html', {
    plantId,
    plantName: getParam('plantName'),
    areaId,
    areaName,
    areaType
  });
}

// ============================================================
// AUDIT PAGE
// ============================================================
async function initAudit() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  const plantId  = getParam('plantId');
  const areaId   = getParam('areaId');
  const areaName = getParam('areaName');
  const areaType = getParam('areaType');

  if (!plantId || !areaId) { navigate('plant.html'); return; }

  setEl('auditPlantName', getParam('plantName') || plantId);
  setEl('auditAreaName', decodeURIComponent(areaName || areaId));

  // ตั้ง audit date เป็นวันนี้
  const todayInput = document.getElementById('auditDate');
  if (todayInput) todayInput.value = new Date().toISOString().split('T')[0];

  UI.showLoading('โหลด Checklist...');
  try {
    const res = await API.get('getCriteria', { areaType });
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }

    AppState.criteria = res.data;

    // เริ่มต้น answers ทุกข้อ
    res.data.forEach(c => {
      AppState.auditAnswers[c.Criteria_ID] = { score: null, remark: '', photos: [] };
    });

    renderChecklist(res.grouped, res.data.length, res.totalMaxScore);
    updateProgress();
  } catch(err) {
    UI.hideLoading();
    UI.toast('โหลด Checklist ไม่สำเร็จ', 'error');
  }
}

/**
 * Render Checklist แบบ dynamic จาก Criteria_Master
 */
function renderChecklist(grouped, totalItems, totalMaxScore) {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  setEl('totalItemCount', totalItems);
  setEl('totalMaxScore', totalMaxScore);

  container.innerHTML = Object.entries(grouped).map(([category, items]) => `
    <div class="category-section mb-2" id="cat-${escHtml(category).replace(/\s/g,'_')}">
      <div class="category-header" onclick="toggleCategory(this)">
        <span><i class="bi bi-clipboard-check me-2"></i>${escHtml(category)}</span>
        <span class="category-count">${items.length} ข้อ</span>
      </div>
      <div class="category-body">
        ${items.map(c => renderCriteriaItem(c)).join('')}
      </div>
    </div>
  `).join('');
}

/**
 * Render แต่ละข้อใน Checklist
 */
function renderCriteriaItem(c) {
  return `
    <div class="criteria-item" id="item-${c.Criteria_ID}">
      <div class="criteria-question">
        <span class="text-muted fw-medium me-1">${c.Criteria_ID}</span>
        ${escHtml(c.Sub_Category || '')} — ${escHtml(c.Question)}
      </div>
      <div class="criteria-description">${escHtml(c.Description || '')}</div>

      <div class="score-buttons">
        <button class="score-btn" data-score="0" data-id="${c.Criteria_ID}"
                onclick="setScore('${c.Criteria_ID}', 0, this)">
          <span class="score-num">0</span>
          <span class="score-label">ไม่ทำ</span>
        </button>
        <button class="score-btn" data-score="1" data-id="${c.Criteria_ID}"
                onclick="setScore('${c.Criteria_ID}', 1, this)">
          <span class="score-num">1</span>
          <span class="score-label">บางส่วน</span>
        </button>
        <button class="score-btn" data-score="2" data-id="${c.Criteria_ID}"
                onclick="setScore('${c.Criteria_ID}', 2, this)">
          <span class="score-num">2</span>
          <span class="score-label">ผ่าน</span>
        </button>
      </div>

      <div class="criteria-extras">
        <textarea class="remark-input" placeholder="หมายเหตุ (ไม่บังคับ)"
                  oninput="setRemark('${c.Criteria_ID}', this.value)"
                  rows="2"></textarea>
        <button class="photo-btn" onclick="triggerPhoto('${c.Criteria_ID}')">
          <i class="bi bi-camera"></i> ถ่ายรูปประกอบ
          <span id="photoCount-${c.Criteria_ID}" class="badge badge-primary" style="display:none">0</span>
        </button>
        <div id="photoPreview-${c.Criteria_ID}" class="photo-preview-grid"></div>
      </div>
    </div>
  `;
}

/**
 * บันทึกคะแนนแต่ละข้อ
 */
function setScore(criteriaId, score, btn) {
  AppState.auditAnswers[criteriaId].score = score;

  // อัปเดต UI ปุ่มคะแนน
  const item = document.getElementById('item-' + criteriaId);
  if (item) {
    item.querySelectorAll('.score-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    // Highlight กรอบ
    item.style.borderLeft = score === 0 ? '3px solid var(--danger)' :
                            score === 1 ? '3px solid var(--warning)' :
                            '3px solid var(--score-2)';
  }

  updateProgress();
}

/**
 * บันทึกหมายเหตุ
 */
function setRemark(criteriaId, value) {
  AppState.auditAnswers[criteriaId].remark = value;
}

/**
 * อัปเดต Progress Bar
 */
function updateProgress() {
  const total    = AppState.criteria.length;
  const answered = Object.values(AppState.auditAnswers).filter(a => a.score !== null).length;
  const pct      = total > 0 ? Math.round((answered / total) * 100) : 0;

  setEl('progressPct', pct + '%');
  setEl('answeredCount', answered);

  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = pct + '%';

  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    submitBtn.disabled = answered < total;
    submitBtn.textContent = answered < total
      ? `ตอบแล้ว ${answered}/${total} ข้อ`
      : '✅ Submit ผลการตรวจ';
  }
}

/**
 * ซ่อน/แสดง category
 */
function toggleCategory(header) {
  const body = header.nextElementSibling;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  header.querySelector('.bi')?.classList.toggle('bi-chevron-up', !isOpen);
}

// ============================================================
// PHOTO UPLOAD
// ============================================================
function triggerPhoto(criteriaId) {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/*';
  input.capture= 'environment';   // เปิดกล้องหลังมือถือ
  input.multiple = true;

  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await addPhoto(criteriaId, file);
    }
  };

  input.click();
}

async function addPhoto(criteriaId, file) {
  // ลดขนาดรูปก่อน upload
  const compressed = await compressImage(file, 1024, 0.8);

  // แสดง Preview ทันที
  const previewGrid = document.getElementById('photoPreview-' + criteriaId);
  const countBadge  = document.getElementById('photoCount-' + criteriaId);

  if (!AppState.auditAnswers[criteriaId].photos) {
    AppState.auditAnswers[criteriaId].photos = [];
  }

  const photoId = `${criteriaId}_${Date.now()}`;
  const photoData = {
    id:       photoId,
    base64:   compressed,
    filename: `photo_${criteriaId}_${Date.now()}.jpg`,
    uploaded: false,
    url:      null,
  };

  AppState.auditAnswers[criteriaId].photos.push(photoData);

  // แสดง preview
  const div = document.createElement('div');
  div.className = 'photo-thumb';
  div.innerHTML = `
    <img src="${compressed}" alt="photo">
    <button class="remove-photo" onclick="removePhotoById('${criteriaId}', '${photoId}', this)">
      <i class="bi bi-x"></i>
    </button>
  `;
  previewGrid.appendChild(div);

  // อัปเดต badge count
  const count = AppState.auditAnswers[criteriaId].photos.length;
  if (countBadge) {
    countBadge.style.display = 'inline';
    countBadge.textContent   = count;
  }
}

function removePhoto(criteriaId, idx, btn) {
  // เก็บไว้ backward compatible แต่ใช้ removePhotoById แทนแล้ว
  AppState.auditAnswers[criteriaId].photos.splice(idx, 1);
  btn.closest('.photo-thumb').remove();
  const countBadge = document.getElementById('photoCount-' + criteriaId);
  const count = AppState.auditAnswers[criteriaId].photos.length;
  if (countBadge) {
    countBadge.textContent   = count;
    countBadge.style.display = count > 0 ? 'inline' : 'none';
  }
}

/** ลบรูปด้วย unique ID — ป้องกัน index เพี้ยนหลัง splice */
function removePhotoById(criteriaId, photoId, btn) {
  AppState.auditAnswers[criteriaId].photos =
    AppState.auditAnswers[criteriaId].photos.filter(p => p.id !== photoId);
  btn.closest('.photo-thumb').remove();
  const countBadge = document.getElementById('photoCount-' + criteriaId);
  const count = AppState.auditAnswers[criteriaId].photos.length;
  if (countBadge) {
    countBadge.textContent   = count;
    countBadge.style.display = count > 0 ? 'inline' : 'none';
  }
}

/**
 * Compress image ก่อน upload
 */
/**
 * Upload รูปไปยัง imgBB (ฟรี, ไม่มี CORS)
 * รับ base64 string → คืน URL ของรูปบน imgBB
 */
async function uploadToImgBB(base64) {
  if (!CONFIG.IMGBB_API_KEY || CONFIG.IMGBB_API_KEY === 'YOUR_IMGBB_API_KEY_HERE') {
    console.warn('[ImgBB] API Key ยังไม่ได้ตั้งค่า — ข้ามการ Upload รูป');
    UI.toast('ยังไม่ได้ตั้งค่า ImgBB API Key', 'warning');
    return null;
  }

  try {
    console.log('[ImgBB] เริ่มอัปโหลด, key 6 ตัวท้าย:', CONFIG.IMGBB_API_KEY.slice(-6));
    console.log('[ImgBB] ขนาด base64:', base64?.length, 'ตัวอักษร');

    // ตัด prefix "data:image/jpeg;base64," ออก
    const base64Data = base64.replace(/^data:[^;]+;base64,/, '');

    const formData = new FormData();
    formData.append('image', base64Data);
    formData.append('key', CONFIG.IMGBB_API_KEY);

    const res  = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData
    });

    console.log('[ImgBB] HTTP Status:', res.status);
    const data = await res.json();
    console.log('[ImgBB] Response:', JSON.stringify(data));

    if (data.success) {
      console.log('[ImgBB] ✅ Upload สำเร็จ:', data.data.url);
      return data.data.url;
    } else {
      const errMsg = data?.error?.message || JSON.stringify(data.error) || 'Unknown error';
      console.error('[ImgBB] ❌ Upload ล้มเหลว:', errMsg);
      UI.toast(`อัปโหลดรูปไม่สำเร็จ: ${errMsg}`, 'error', 6000);
      return null;
    }
  } catch(err) {
    console.error('[ImgBB] ❌ Network error:', err);
    UI.toast('ไม่สามารถเชื่อมต่อ ImgBB ได้: ' + err.message, 'error', 6000);
    return null;
  }
}

function compressImage(file, maxSize = 1024, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img    = new Image();
      img.onload   = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const ratio = Math.min(maxSize / width, maxSize / height, 1);
        canvas.width  = width  * ratio;
        canvas.height = height * ratio;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================
// SUBMIT AUDIT
// ============================================================
async function submitAudit() {
  const unanswered = AppState.criteria.filter(
    c => AppState.auditAnswers[c.Criteria_ID]?.score === null
  );

  if (unanswered.length > 0) {
    UI.toast(`ยังไม่ได้ให้คะแนน ${unanswered.length} ข้อ`, 'warning');
    const firstUnanswered = document.getElementById('item-' + unanswered[0].Criteria_ID);
    if (firstUnanswered) firstUnanswered.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const ok = await showConfirm('ยืนยันการ Submit?', 'คุณต้องการบันทึกผลการตรวจนี้หรือไม่?');
  if (!ok) return;

  try {
    // ============================================================
    // STEP 0: Upload รูปภาพทั้งหมดไปยัง imgBB ก่อน
    const totalPhotos = Object.values(AppState.auditAnswers)
      .reduce((sum, a) => sum + (a.photos?.length || 0), 0);

    if (totalPhotos > 0) {
      UI.showLoading(`กำลัง Upload รูปภาพ... (0/${totalPhotos})`);
      let uploaded    = 0;
      let failedCount = 0;

      for (const [criteriaId, answer] of Object.entries(AppState.auditAnswers)) {
        for (const photo of (answer.photos || [])) {
          if (!photo.uploaded && photo.base64) {
            console.log(`[SUBMIT] กำลังอัปโหลดรูป criteria: ${criteriaId} (${uploaded+1}/${totalPhotos})`);
            const url = await uploadToImgBB(photo.base64);
            uploaded++;

            if (url) {
              photo.url      = url;
              photo.uploaded = true;
              console.log(`[SUBMIT] ✅ รูปที่ ${uploaded} สำเร็จ: ${url}`);
            } else {
              failedCount++;
              console.error(`[SUBMIT] ❌ รูปที่ ${uploaded} ล้มเหลว criteria: ${criteriaId}`);
            }

            UI.showLoading(`กำลัง Upload รูปภาพ... (${uploaded}/${totalPhotos})`);
          }
        }
      }

      if (failedCount > 0) {
        const continueAnyway = await showConfirm(
          `อัปโหลดรูปล้มเหลว ${failedCount} รูป`,
          'ต้องการ Submit ต่อโดยไม่มีรูปที่อัปโหลดล้มเหลวหรือไม่?'
        );
        if (!continueAnyway) {
          UI.hideLoading();
          return;
        }
      }
    }

    // STEP 1: สร้าง Audit Header → รับ auditId กลับมา
    // ============================================================
    UI.showLoading('กำลังสร้างรายการตรวจ... (1/3)');

    const headerRes = await API.write('submitAuditHeader', {
      plantId:    getParam('plantId'),
      areaId:     getParam('areaId'),
      auditorId:  AppState.user?.userId || 'unknown',
      auditDate:  document.getElementById('auditDate')?.value || new Date().toISOString().split('T')[0],
      totalItems: AppState.criteria.length
    });

    if (!headerRes.success) {
      UI.hideLoading();
      UI.toast(headerRes.error || 'สร้าง Header ไม่สำเร็จ', 'error');
      return;
    }

    const auditId = headerRes.auditId;

    // ============================================================
    // STEP 2: ส่ง Details เป็น Chunk ทีละ 15 ข้อ
    // แก้ปัญหา URL ยาวเกิน (400 Bad Request)
    // ============================================================
    const details = AppState.criteria.map(c => ({
      criteriaId: c.Criteria_ID,
      score:      AppState.auditAnswers[c.Criteria_ID]?.score ?? 0,
      remark:     (AppState.auditAnswers[c.Criteria_ID]?.remark || '').slice(0, 200),
      photoUrl:   (AppState.auditAnswers[c.Criteria_ID]?.photos || [])
                    .map(p => p.url).filter(Boolean).join(',')
    }));

    const CHUNK_SIZE = 15;
    const totalChunks = Math.ceil(details.length / CHUNK_SIZE);

    for (let i = 0; i < details.length; i += CHUNK_SIZE) {
      const chunk     = details.slice(i, i + CHUNK_SIZE);
      const chunkNum  = Math.floor(i / CHUNK_SIZE) + 1;

      UI.showLoading(`กำลังบันทึกข้อมูล... (${chunkNum}/${totalChunks})`);

      console.log(`[SUBMIT] ส่ง chunk ${chunkNum}/${totalChunks}, details:`, JSON.stringify(chunk));
      const detailRes = await API.write('submitAuditDetails', {
        auditId: auditId,
        details: JSON.stringify(chunk)
      });

      if (!detailRes.success) {
        UI.hideLoading();
        UI.toast('บันทึก Details ล้มเหลว chunk ' + chunkNum, 'error');
        return;
      }
    }

    // ============================================================
    // STEP 3: Finalize — คำนวณคะแนนรวมและ Update Header
    // ============================================================
    UI.showLoading('กำลังคำนวณคะแนน... (3/3)');

    const finalRes = await API.write('finalizeAudit', { auditId });

    UI.hideLoading();

    if (finalRes.success) {
      sessionStorage.setItem('lastAuditResult', JSON.stringify(finalRes));
      navigate('summary.html', { auditId: finalRes.auditId });
    } else {
      UI.toast(finalRes.error || 'Finalize ไม่สำเร็จ', 'error');
    }

  } catch(err) {
    UI.hideLoading();
    console.error('submitAudit error:', err);
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

// ============================================================
// SUMMARY PAGE
// ============================================================
async function initSummary() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  // โหลดจาก sessionStorage ก่อน
  const cached = sessionStorage.getItem('lastAuditResult');
  let result = cached ? JSON.parse(cached) : null;

  // ถ้าไม่มี ดึงจาก API
  if (!result) {
    const auditId = getParam('auditId');
    if (auditId) {
      UI.showLoading();
      const res = await API.get('getAuditDetail', { auditId });
      UI.hideLoading();
      if (res.success && res.header) {
        result = {
          auditId,
          totalScore: res.header.Total_Score,
          maxScore:   res.header.Max_Score,
          percent:    res.header.Percent,
          status:     res.header.Status
        };
      }
    }
  }

  if (!result) { navigate('home.html'); return; }

  const pct    = parseFloat(result.percent) || 0;
  const status = UI.statusClass(pct);

  setEl('resultPercent', Math.round(pct));
  setEl('resultScore',   `${result.totalScore} / ${result.maxScore}`);
  setEl('resultStatus',  UI.statusTH(pct));
  setEl('resultAuditId', result.auditId || '-');

  // Circle color
  const circle = document.getElementById('scoreCircle');
  if (circle) {
    circle.classList.add(status);
  }

  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = `status-badge status-${status}`;
    badge.textContent = pct >= 90 ? '🏆 Excellent' : pct >= 75 ? '✅ Good' : '⚠️ Need Improvement';
  }
}

// ============================================================
// HISTORY PAGE
// ============================================================
async function initHistory() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  const [plantsRes, areasRes] = await Promise.all([
    API.get('getPlants'),
    API.get('getAreas', {})
  ]);

  // ใส่ options ใน filter dropdowns
  if (plantsRes.success) {
    const plantSel = document.getElementById('filterPlant');
    if (plantSel) {
      plantsRes.data.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.Plant_ID;
        opt.textContent = p.Plant_Name;
        plantSel.appendChild(opt);
      });
    }
  }

  // โหลด history เริ่มต้น
  await loadHistory();
}

async function loadHistory(filters = {}) {
  UI.showLoading('โหลดประวัติการตรวจ...');
  try {
    const res = await API.get('getHistory', filters);
    UI.hideLoading();

    const container = document.getElementById('historyList');
    if (!container) return;

    if (!res.success || !res.data.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-clipboard-x"></i>
          <p>ไม่พบประวัติการตรวจ</p>
        </div>`;
      return;
    }

    container.innerHTML = res.data.map(h => `
      <a class="history-item" href="summary.html?auditId=${h.Audit_ID}">
        <div class="history-score-ring ${UI.statusClass(h.Percent)}">
          ${Math.round(h.Percent)}%
        </div>
        <div class="history-info">
          <div class="history-title">${escHtml(h.Plant_ID)} — ${escHtml(h.Area_ID)}</div>
          <div class="history-meta">
            📅 ${UI.formatDate(h.Audit_Date)} &nbsp;|&nbsp;
            👤 ${escHtml(h.Auditor_ID)} &nbsp;|&nbsp;
            ${UI.scoreBadge(h.Percent)}
          </div>
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </a>
    `).join('');
  } catch(err) {
    UI.hideLoading();
    UI.toast('โหลดไม่สำเร็จ', 'error');
  }
}

function applyHistoryFilter() {
  const filters = {
    plantId:  document.getElementById('filterPlant')?.value  || '',
    month:    document.getElementById('filterMonth')?.value  || '',
    year:     document.getElementById('filterYear')?.value   || '',
  };
  // ลบ key ที่ว่าง
  Object.keys(filters).forEach(k => !filters[k] && delete filters[k]);
  loadHistory(filters);
}

// ============================================================
// DASHBOARD PAGE
// ============================================================
async function initDashboard() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  UI.showLoading('โหลด Dashboard...');
  try {
    const res = await API.get('getDashboard', {});
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }
    const d = res.data;

    // KPI Cards
    setEl('dashTotalAudit', d.totalAudit || 0);
    setEl('dashAvgScore',   (d.avgScore  || 0) + '%');
    setEl('dashPassRate',   (d.passRate  || 0) + '%');
    setEl('dashExcellent',  d.excellent  || 0);
    setEl('dashGood',       d.good       || 0);
    setEl('dashNeedImp',    d.needImprovement || 0);

    // Highest / Lowest
    if (d.highestArea) {
      setEl('highestAreaName',  d.highestArea.areaName);
      setEl('highestAreaScore', d.highestArea.avgScore + '%');
    }
    if (d.lowestArea) {
      setEl('lowestAreaName',  d.lowestArea.areaName);
      setEl('lowestAreaScore', d.lowestArea.avgScore + '%');
    }

    // Plant Comparison Ranking
    renderRanking('plantRanking', d.plantComparison || [], 'plantName');

    // Area Ranking
    renderRanking('areaRanking', d.areaRanking || [], 'areaName');

    // Monthly Trend (simple bar chart)
    renderMonthlyTrend('monthlyChart', d.monthlyTrend || []);

  } catch(err) {
    UI.hideLoading();
    UI.toast('โหลด Dashboard ไม่สำเร็จ', 'error');
  }
}

function renderRanking(containerId, items, nameField) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<p class="text-muted text-center">ยังไม่มีข้อมูล</p>';
    return;
  }

  container.innerHTML = items.slice(0, 10).map((item, idx) => `
    <div class="ranking-item">
      <div class="rank-number rank-${idx+1}">${idx+1}</div>
      <div class="rank-bar-wrap">
        <div class="rank-name">${escHtml(item[nameField] || '-')}</div>
        <div class="rank-bar">
          <div class="rank-bar-fill" style="width:${item.avgScore}%;
               background:${item.avgScore>=90?'var(--excellent)':item.avgScore>=75?'var(--warning)':'var(--danger)'}">
          </div>
        </div>
      </div>
      <div class="rank-score ${item.avgScore>=90?'text-success':item.avgScore>=75?'text-warning':'text-danger'}">
        ${item.avgScore}%
      </div>
    </div>
  `).join('');
}

function renderMonthlyTrend(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container || !data.length) return;

  const max = Math.max(...data.map(d => d.avgScore), 100);

  container.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding:8px 0">
      ${data.map(d => `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:0.7rem;font-weight:700;color:${d.avgScore>=90?'var(--excellent)':d.avgScore>=75?'#c9a000':'var(--danger)'}">${d.avgScore}%</div>
          <div style="width:100%;background:${d.avgScore>=90?'var(--excellent)':d.avgScore>=75?'var(--warning)':'var(--danger)'};
                      border-radius:4px 4px 0 0;height:${(d.avgScore/max)*90}px;
                      transition:height 0.8s ease"></div>
          <div style="font-size:0.65rem;color:var(--gray-600);white-space:nowrap">${d.month.slice(5)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================
// UTILITIES
// ============================================================

/** ตั้งค่า text content ของ element */
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/** Escape HTML */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** อัปเดต UI ส่วน user */
function updateUserUI() {
  const user = AppState.user;
  if (!user) return;
  setEl('userName', user.name || user.email);
  setEl('userRole', user.role || '');
  setEl('userInitial', (user.name || 'U')[0].toUpperCase());
}

/** Logout */
async function logout() {
  try {
    await API.post('logout');
  } catch(e) {}
  Session.clear();
  navigate('index.html');
}

/** Confirm dialog */
function showConfirm(title, msg) {
  return new Promise(resolve => {
    // ใช้ native confirm ก่อน (จะทำ custom modal ในอนาคต)
    resolve(confirm(`${title}\n\n${msg}`));
  });
}

// ============================================================
// PWA SERVICE WORKER
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.log('SW error:', err));
  });
}

// ============================================================
// PWA INSTALL PROMPT
// ============================================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('pwaBanner');
  if (banner) banner.classList.add('show');
});

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      deferredPrompt = null;
      const banner = document.getElementById('pwaBanner');
      if (banner) banner.classList.remove('show');
    });
  }
}

// ============================================================
// AUTO-INIT ตาม page ปัจจุบัน
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop().replace('.html','');

  switch(page) {
    case 'index':    case '':  initLogin();     break;
    case 'home':               initHome();      break;
    case 'plant':              initPlant();     break;
    case 'area':               initArea();      break;
    case 'audit':              initAudit();     break;
    case 'summary':            initSummary();   break;
    case 'history':            initHistory();   break;
    case 'dashboard':          initDashboard(); break;
  }
});
