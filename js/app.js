/**
 * ============================================================
 * app.js - ระบบตรวจ 5ส โรงงาน
 * Frontend JavaScript - ES6+ / Mobile First / PWA
 * ============================================================
 */

// ============================================================
// CONFIG - Supabase project URL + publishable key
// ============================================================
const CONFIG = {
  SUPABASE_URL: 'https://oibjnkngraulcccdqevm.supabase.co',
  SUPABASE_KEY: 'sb_publishable_ORPB_uS9OzqOGtyA1BvZgg_9WAt9--v',
  STORAGE_BUCKET: 'audit-photos',
  APP_NAME: 'ระบบตรวจ 5ส',
  VERSION: '2.0.0',
  SESSION_KEY: '5s_session',
  LANG_KEY:    '5s_lang',
  CACHE_TTL: 5 * 60 * 1000,
};

// ============================================================
// SUPABASE BACKEND ADAPTER
// แทน Google Apps Script — supabase-js query + แปลง response
// ให้เป็นรูปแบบ key เดิม (PascalCase) ที่หน้าเว็บใช้อยู่
// ต้องโหลด <script src="...supabase-js@2"></script> ก่อน app.js
// ============================================================
const _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// map enum (DB) → label เดิม (frontend)
const MAP = {
  areaType:    { office:'Office', production:'Production', warehouse:'Warehouse', cafeteria:'Cafeteria', outdoor:'Outdoor', maintenance:'Maintenance' },
  role:        { admin:'Admin', manager:'Manager', auditor:'Auditor', area_manager:'Area Manager' },
  status:      { active:'Active', inactive:'Inactive' },
  auditStatus: { excellent:'Excellent', good:'Good', need_improvement:'Need Improvement', pending:'Pending', failed:'Failed' },
};
// reverse: label เดิม → enum (DB)
const REV = {
  role:   { 'Admin':'admin', 'Manager':'manager', 'Auditor':'auditor', 'Area Manager':'area_manager' },
  status: { 'Active':'active', 'Inactive':'inactive' },
};

// mappers: row (snake_case) → object (PascalCase เดิม)
const mapPlant = p => ({ Plant_ID:p.plant_id, Plant_Name:p.plant_name, Status:MAP.status[p.status]||p.status });
const mapArea  = a => ({ Area_ID:a.area_id, Plant_ID:a.plant_id, Area_Name:a.area_name, Area_Type:MAP.areaType[a.area_type]||a.area_type, Status:MAP.status[a.status]||a.status });
const _critType = arr => (!arr || !arr.length) ? 'All' : arr.map(t => MAP.areaType[t]||t).join(',');
const mapCriteria = c => ({ Criteria_ID:c.criteria_id, Category:c.category, Sub_Category:c.sub_category, Question:c.question, Description:c.description, Area_Type:_critType(c.area_types), Max_Score:c.max_score, Active:c.active });
const mapProfile = u => ({ User_ID:u.id, Employee_ID:u.employee_id, Name:u.name, Department:u.department, Email:u.email, Role:MAP.role[u.role]||u.role, Status:MAP.status[u.status]||u.status, Assigned_Areas:(u.assigned_areas||[]).join(','), Assigned_Plants:(u.assigned_plants||[]).join(','), Password:'***' });
const mapHeader = h => ({ Audit_ID:h.audit_id, Plant_ID:h.plant_id, Area_ID:h.area_id, Auditor_ID:h.auditor_id, Audit_Date:h.audit_date, Total_Score:h.total_score, Max_Score:h.max_score, Percent:Number(h.percent), Status:MAP.auditStatus[h.status]||h.status });

let _profileCache = null;
async function _currentProfile() {
  if (_profileCache) return _profileCache;
  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) return null;
  const { data } = await _sb.from('profiles').select('*').eq('id', user.id).single();
  _profileCache = data || null;
  return _profileCache;
}

function _monthRange(month, year) {
  if (!year) return null;
  const m = month ? String(month).padStart(2,'0') : null;
  if (m) { const start=`${year}-${m}-01`; const nm = m==='12'?`${+year+1}-01-01`:`${year}-${String(+m+1).padStart(2,'0')}-01`; return [start, nm]; }
  return [`${year}-01-01`, `${+year+1}-01-01`];
}

// ============================================================
// SUPABASE HANDLERS — 1 ตัวต่อ 1 action (คืน shape เดิม)
// ============================================================
const SBH = {
  // ---- Auth ----
  async login({ email, password }) {
    const { data, error } = await _sb.auth.signInWithPassword({ email:(email||'').trim(), password });
    if (error) return { success:false, error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
    _profileCache = null;
    const { data:prof } = await _sb.from('profiles').select('*').eq('id', data.user.id).single();
    if (!prof || prof.status !== 'active') { await _sb.auth.signOut(); return { success:false, error:'บัญชีถูกระงับหรือไม่พบโปรไฟล์' }; }
    _profileCache = prof;
    return { success:true, token:data.session.access_token, user:{ userId:prof.id, name:prof.name, email:prof.email, role:MAP.role[prof.role]||prof.role, department:prof.department } };
  },
  async logout() { _profileCache = null; await _sb.auth.signOut(); return { success:true }; },

  // ---- Master data ----
  async getPlants() {
    const { data, error } = await _sb.from('plants').select('*').eq('status','active').order('plant_id');
    if (error) throw error;
    return { success:true, data:data.map(mapPlant) };
  },

  async getAreas({ plantId, areaType } = {}) {
    let q = _sb.from('areas').select('*').eq('status','active');
    if (plantId)  q = q.eq('plant_id', plantId);
    if (areaType) {
      // โหมดพื้นที่ส่วนกลาง: ดึงตามชนิดพื้นที่ข้ามทุก plant (โรงอาหาร / ช่าง-ยูทิลิตี้)
      q = q.eq('area_type', String(areaType).toLowerCase());
    } else if (plantId) {
      // โหมดเลือก plant: ตัด cafeteria + maintenance ออก (แยกไปเป็นการ์ดต่างหากที่หน้า plant)
      q = q.not('area_type', 'in', '(cafeteria,maintenance)');
    }
    const { data, error } = await q.order('area_id');
    if (error) throw error;
    let areas = data.map(mapArea);

    // annotate pending schedule + scope สำหรับ auditor
    const { data:scheds } = await _sb.from('schedules').select('*').eq('status','pending');
    const byArea = {}; (scheds||[]).forEach(s => { byArea[s.area_id] = s; });
    areas.forEach(a => { const s = byArea[a.Area_ID]; if (s) { a.Schedule_ID=s.schedule_id; a.Audit_Round=s.audit_round; a.Audit_Date=s.audit_date; } });

    const prof = await _currentProfile();
    const isStaff = prof && ['admin','manager'].includes(prof.role);
    if (prof && !isStaff) {
      const assigned = new Set(prof.assigned_areas || []);
      areas = areas.filter(a => {
        if (assigned.size && assigned.has(a.Area_ID)) return true;
        const s = byArea[a.Area_ID];
        if (s && (s.auditor_ids||[]).includes(prof.id)) return true;
        return assigned.size === 0;   // ถ้าไม่มีการกำหนดพื้นที่ → เห็นทั้งหมด
      });
    }
    return { success:true, data:areas };
  },

  async getCriteria({ areaType } = {}) {
    const { data, error } = await _sb.from('criteria').select('*').eq('active', true).order('criteria_id');
    if (error) throw error;
    let items = data;
    const at = areaType || 'All';
    if (at && at !== 'All') {
      const low = String(at).toLowerCase();
      items = items.filter(c => !c.area_types || c.area_types.length === 0 || c.area_types.includes(low));
    }
    const mapped = items.map(mapCriteria);
    const grouped = {};
    mapped.forEach(c => { (grouped[c.Category] = grouped[c.Category] || []).push(c); });
    const totalMaxScore = mapped.reduce((s,c) => s + (c.Max_Score||0), 0);
    return { success:true, data:mapped, grouped, totalMaxScore };
  },

  async getSchedule() {
    // คืนทั้ง pending + completed เพื่อให้การ์ด "งานของฉัน" แสดงงานที่ตรวจเสร็จแล้วได้ด้วย
    const { data, error } = await _sb.from('schedules')
      .select('*, areas(area_name, area_type), plants(plant_name)')
      .in('status', ['pending','completed']);
    if (error) throw error;
    return { success:true, data:(data||[]).map(s => ({
      Schedule_ID:s.schedule_id, Plant_ID:s.plant_id, Area_ID:s.area_id,
      Area_Name:(s.areas && s.areas.area_name) || s.area_id,
      Area_Type:(s.areas && MAP.areaType[s.areas.area_type]) || '',
      Plant_Name:(s.plants && s.plants.plant_name) || s.plant_id,
      Auditor_ID:(s.auditor_ids||[]).join(','),
      Audit_Date:s.audit_date, Audit_Round:s.audit_round,
      Status: s.status === 'completed' ? 'Completed' : 'Pending'
    })) };
  },

  /** mark schedule เป็น completed (เรียกหลัง auditor ตรวจงานที่มอบหมายเสร็จ) */
  async completeSchedule({ scheduleId }) {
    if (!scheduleId) return { success:false, error:'ไม่มี scheduleId' };
    const { error } = await _sb.from('schedules').update({ status:'completed' }).eq('schedule_id', scheduleId);
    if (error) return { success:false, error:error.message };
    return { success:true };
  },

  /** ข้อมูลสำหรับหน้า "ตารางตรวจ" — RLS จำกัดขอบเขตให้เอง (admin เห็นทุกคน / auditor เห็นของตัวเอง) */
  async getAssignmentAnalytics() {
    const [{ data:scheds }, { data:hdrs }, { data:profs }, { data:plants }] = await Promise.all([
      _sb.from('schedules').select('*, areas(area_name, area_type), plants(plant_name)'),
      _sb.from('audit_headers').select('auditor_id, plant_id, area_id, percent, audit_date').neq('status','pending'),
      _sb.from('profiles').select('id, name'),
      _sb.from('plants').select('plant_id, plant_name').eq('status','active').order('plant_id'),
    ]);
    const nameById = {}; (profs||[]).forEach(p => { nameById[p.id] = p.name; });
    const today = new Date().toISOString().slice(0,10);
    const schedules = (scheds||[]).map(s => ({
      Schedule_ID: s.schedule_id,
      Plant_ID:    s.plant_id,
      Plant_Name:  (s.plants && s.plants.plant_name) || s.plant_id,
      Area_ID:     s.area_id,
      Area_Name:   (s.areas && s.areas.area_name) || s.area_id,
      Area_Type:   (s.areas && MAP.areaType[s.areas.area_type]) || '',
      Auditor_IDs:   s.auditor_ids || [],
      Auditor_Names: (s.auditor_ids||[]).map(id => nameById[id] || '—'),
      Audit_Round: s.audit_round || '',
      Audit_Date:  s.audit_date,
      Completed:   s.status === 'completed',
      Overdue:     s.status !== 'completed' && s.audit_date && s.audit_date < today,
    }));
    const headers = (hdrs||[]).map(h => ({
      Auditor_ID:h.auditor_id, Plant_ID:h.plant_id, Area_ID:h.area_id,
      Percent:Number(h.percent)||0, Date:h.audit_date
    }));
    return { success:true, schedules, headers,
      plants:(plants||[]).map(p => ({ Plant_ID:p.plant_id, Plant_Name:p.plant_name })) };
  },

  /** ดึง audit log (admin เท่านั้น — RLS จำกัดให้) */
  async getLogs({ entity, action, limit } = {}) {
    let q = _sb.from('audit_logs').select('*, profiles(name)')
      .order('created_at', { ascending:false }).limit(limit || 300);
    if (entity) q = q.eq('entity', entity);
    if (action) q = q.eq('action', action);
    const { data, error } = await q;
    if (error) return { success:false, error:error.message };
    return { success:true, data:(data||[]).map(l => ({
      Log_ID:l.log_id,
      User:(l.profiles && l.profiles.name) || l.user_id || 'ระบบ',
      Action:l.action, Entity:l.entity || '', Entity_ID:l.entity_id || '',
      Detail:l.detail || '', Old:l.old_data, New:l.new_data, At:l.created_at
    })) };
  },

  // ---- History / detail ----
  async getHistory({ plantId, month, year } = {}) {
    let q = _sb.from('audit_headers').select('*, profiles(name)');
    if (plantId) q = q.eq('plant_id', plantId);
    const range = _monthRange(month, year);
    if (range) q = q.gte('audit_date', range[0]).lt('audit_date', range[1]);
    const { data, error } = await q.order('audit_date', { ascending:false });
    if (error) throw error;
    const mapped = (data||[]).map(h => { const m = mapHeader(h); m.Auditor_ID = (h.profiles && h.profiles.name) || h.auditor_id; return m; });
    return { success:true, data:mapped, total:mapped.length };
  },

  async getAuditDetail({ auditId }) {
    const { data:h, error } = await _sb.from('audit_headers').select('*').eq('audit_id', auditId).single();
    if (error) return { success:false, error:'ไม่พบข้อมูล Audit' };
    const { data:d } = await _sb.from('audit_details').select('*, criteria(question,category,sub_category)').eq('audit_id', auditId);
    const details = (d||[]).map(x => ({
      Detail_ID:x.detail_id, Criteria_ID:x.criteria_id, Score:x.score, Na:x.na, Remark:x.remark,
      Photo_URL:(x.photo_urls||[]).join(','),
      Question:x.criteria && x.criteria.question, Category:x.criteria && x.criteria.category
    }));
    return { success:true, header:mapHeader(h), details };
  },

  async getDashboard() {
    const [{ data:headers }, { data:areas }, { data:plants }] = await Promise.all([
      _sb.from('audit_headers').select('*').neq('status','pending'),
      _sb.from('areas').select('area_id,area_name,plant_id'),
      _sb.from('plants').select('plant_id,plant_name'),
    ]);
    const H = headers || [];
    const pct = h => Number(h.percent) || 0;
    const tot = h => Number(h.total_score) || 0;   // คะแนนจริง
    const mx  = h => Number(h.max_score)   || 0;   // คะแนนเต็มจริง
    const totalAudit = H.length;

    // คะแนนรวม = pooled (รวมคะแนนจริง / รวมคะแนนเต็ม) — สะท้อนน้ำหนักงานจริง
    const poolPct = (t, m) => m > 0 ? Math.round(t * 100 / m) : 0;
    const sumT = H.reduce((s,h)=>s+tot(h),0);
    const sumM = H.reduce((s,h)=>s+mx(h),0);
    const avgScore = poolPct(sumT, sumM);

    // passRate + การนับระดับ = ต่อ audit (แต่ละครั้งเท่ากัน) เพราะเป็นตัวชี้ "กี่ครั้งที่ผ่าน"
    const passRate = totalAudit ? Math.round(H.filter(h=>pct(h)>=75).length*100/totalAudit) : 0;
    const excellent = H.filter(h=>pct(h)>=90).length;
    const good = H.filter(h=>pct(h)>=75 && pct(h)<90).length;
    const needImprovement = H.filter(h=>pct(h)<75).length;

    const areaName = {}; (areas||[]).forEach(a=>areaName[a.area_id]=a.area_name);
    const plantName = {}; (plants||[]).forEach(p=>plantName[p.plant_id]=p.plant_name);

    // คะแนนรายกลุ่ม = pooled ภายในกลุ่ม (รวมคะแนนจริงของกลุ่ม / เต็มจริง)
    // → เห็นคะแนนแต่ละพื้นที่ได้แม้จำนวนเกณฑ์ต่างกัน สำหรับประเมินและหาจุดบกพร่อง
    const avgBy = (keyFn, nameMap, label) => {
      const g = {}; H.forEach(h=>{ const k=keyFn(h); (g[k]=g[k]||{t:0,m:0}); g[k].t+=tot(h); g[k].m+=mx(h); });
      return Object.entries(g).map(([k,v])=>({ [label]:(nameMap[k]||k), avgScore:poolPct(v.t, v.m) }))
                   .sort((a,b)=>b.avgScore-a.avgScore);
    };
    const plantComparison = avgBy(h=>h.plant_id, plantName, 'plantName');
    const areaRanking = avgBy(h=>h.area_id, areaName, 'areaName');

    const mg = {}; H.forEach(h=>{ const mth=String(h.audit_date||'').slice(0,7); if(mth){(mg[mth]=mg[mth]||{t:0,m:0}); mg[mth].t+=tot(h); mg[mth].m+=mx(h);} });
    const monthlyTrend = Object.entries(mg).sort().slice(-6).map(([month,v])=>({ month, avgScore:poolPct(v.t, v.m) }));

    return { success:true, data:{
      totalAudit, avgScore, passRate, excellent, good, needImprovement,
      plantComparison, areaRanking, monthlyTrend,
      highestArea: areaRanking[0] || null,
      lowestArea:  areaRanking.length ? areaRanking[areaRanking.length-1] : null,
    }};
  },

  // ---- Users ----
  async getUsers() {
    const { data, error } = await _sb.from('profiles').select('*').order('name');
    if (error) throw error;
    return { success:true, data:data.map(mapProfile) };
  },

  async saveUser(p) {
    if (!p.userId) {
      return { success:false, error:'การสร้างผู้ใช้ใหม่ต้องผ่าน Supabase (Auth) — ยังไม่รองรับจากหน้านี้ ดู TODO' };
    }
    const patch = {
      name:p.name, email:p.email, department:p.department, employee_id:p.employeeId,
      role:REV.role[p.role]||'auditor', status:REV.status[p.status]||'active',
      assigned_areas: p.assignedAreas ? p.assignedAreas.split(',').map(s=>s.trim()).filter(Boolean) : [],
      updated_at: new Date().toISOString(),
    };
    const { error } = await _sb.from('profiles').update(patch).eq('id', p.userId);
    if (error) return { success:false, error:error.message };
    return { success:true, message:'อัปเดตผู้ใช้เรียบร้อย' };
  },

  async deleteUser({ userId }) {
    if (userId === (AppState.user && AppState.user.userId)) return { success:false, error:'ลบบัญชีตัวเองไม่ได้' };
    const { data:target } = await _sb.from('profiles').select('role,status').eq('id', userId).single();
    if (target && target.role === 'admin' && target.status === 'active') {
      const { data:admins } = await _sb.from('profiles').select('id').eq('role','admin').eq('status','active');
      if ((admins||[]).length <= 1) return { success:false, error:'ลบ Admin คนสุดท้ายไม่ได้' };
    }
    const { error } = await _sb.from('profiles').delete().eq('id', userId);
    if (error) return { success:false, error:error.message };
    return { success:true };
  },

  // ---- Schedule (admin) ----
  async getScheduleAdmin() {
    const [{ data:areas }, { data:scheds }, { data:auditors }, { data:plants }] = await Promise.all([
      _sb.from('areas').select('*').eq('status','active').order('area_id'),
      _sb.from('schedules').select('*'),
      _sb.from('profiles').select('*').eq('status','active').order('name'),
      _sb.from('plants').select('*').eq('status','active'),
    ]);
    const byArea = {}; (scheds||[]).forEach(s => { byArea[s.area_id] = s; });
    const areaRows = (areas||[]).map(a => {
      const s = byArea[a.area_id];
      return {
        Area_ID:a.area_id, Plant_ID:a.plant_id, Area_Name:a.area_name, Area_Type:MAP.areaType[a.area_type]||a.area_type,
        Auditor_IDs: s ? (s.auditor_ids||[]).join(',') : '',
        Audit_Date: s ? s.audit_date : null, Audit_Round: s ? s.audit_round : null,
        Schedule_ID: s ? s.schedule_id : null,
        Sched_Status: s ? (s.status === 'completed' ? 'Completed' : 'Pending') : null,
      };
    });
    return { success:true,
      areas: areaRows,
      auditors: (auditors||[]).map(u => ({ User_ID:u.id, Name:u.name, Department:u.department, Role:MAP.role[u.role]||u.role })),
      plants: (plants||[]).map(p => ({ Plant_ID:p.plant_id, Plant_Name:p.plant_name })),
    };
  },

  async saveSchedule(p) {
    const ids = p.auditorIds ? p.auditorIds.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const payload = { plant_id:p.plantId, area_id:p.areaId, auditor_ids:ids, audit_date:p.auditDate||null, audit_round:p.auditRound, status:'pending' };
    if (p.scheduleId) {
      const { error } = await _sb.from('schedules').update(payload).eq('schedule_id', p.scheduleId);
      if (error) return { success:false, error:error.message };
      return { success:true, scheduleId:p.scheduleId };
    }
    const { data, error } = await _sb.from('schedules').insert(payload).select('schedule_id').single();
    if (error) return { success:false, error:error.message };
    return { success:true, scheduleId:data.schedule_id };
  },

  async deleteSchedule({ scheduleId }) {
    const { error } = await _sb.from('schedules').delete().eq('schedule_id', scheduleId);
    if (error) return { success:false, error:error.message };
    return { success:true };
  },

  // ---- Audit submit ----
  async submitAuditHeader(p) {
    const { data, error } = await _sb.from('audit_headers')
      .insert({ plant_id:p.plantId, area_id:p.areaId, auditor_id:p.auditorId, audit_date:p.auditDate })
      .select('audit_id').single();
    if (error) return { success:false, error:error.message };
    return { success:true, auditId:data.audit_id };
  },

  async submitAuditDetails(p) {
    let arr; try { arr = JSON.parse(p.details); } catch(e) { return { success:false, error:'details JSON ไม่ถูกต้อง' }; }
    const rows = arr.map(d => ({
      audit_id:p.auditId, criteria_id:d.criteriaId, score:Number(d.score)||0,
      na: !!d.na,
      remark:(d.remark||'').slice(0,200),
      photo_urls: d.photoUrl ? String(d.photoUrl).split(',').filter(Boolean) : [],
    }));
    const { error } = await _sb.from('audit_details').upsert(rows, { onConflict:'audit_id,criteria_id' });
    if (error) return { success:false, error:error.message };
    return { success:true, saved:rows.length };   // trigger คำนวณคะแนน header ให้เอง
  },

  async finalizeAudit({ auditId }) {
    const { data, error } = await _sb.from('audit_headers').select('*').eq('audit_id', auditId).single();
    if (error) return { success:false, error:error.message };
    return { success:true, auditId, totalScore:data.total_score, maxScore:data.max_score, percent:Number(data.percent), status:MAP.auditStatus[data.status]||data.status };
  },

  async deleteAudit({ auditId }) {
    const { error } = await _sb.from('audit_headers').delete().eq('audit_id', auditId);
    if (error) return { success:false, error:error.message };
    return { success:true };
  },
};

// ============================================================
// TRANSLATIONS — TH / EN
// ============================================================
const TRANSLATIONS = {
  th: {
    // Common
    'nav.home':        'หน้าหลัก',
    'nav.audit':       'ตรวจ',
    'nav.history':     'ประวัติ',
    'nav.dashboard':   'Dashboard',
    'nav.users':       'ผู้ใช้',
    'btn.logout':      'ออกจากระบบ',
    'btn.refresh':     'รีเฟรช',
    'loading':         'กำลังโหลด...',
    // Login
    'login.app_sub':       'Factory 5S Audit System | Draft 2026',
    'login.email_label':   'อีเมล',
    'login.pass_label':    'รหัสผ่าน',
    'login.pass_ph':       'กรอกรหัสผ่าน',
    'login.btn':           'เข้าสู่ระบบ',
    'login.quick_title':   '🔧 Dev Mode — เข้าสู่ระบบด่วน',
    // Home
    'home.greeting':       'สวัสดี 👋',
    'home.total_audit':    'การตรวจทั้งหมด',
    'home.avg_score':      'คะแนนเฉลี่ย',
    'home.pass_rate':      'อัตราผ่าน',
    'home.excellent':      'Excellent',
    'home.next_schedule':  'กำหนดการตรวจถัดไป',
    'home.round':          'รอบการตรวจ',
    'home.date':           'วันที่',
    'home.start_btn':      'เริ่มตรวจ 5ส',
    'home.quick_menu':     'เมนูด่วน',
    'home.menu_history':   'ประวัติ',
    'home.menu_plant':     'เลือก Plant',
    'home.score_title':    'เกณฑ์คะแนน',
    'home.score_ex':       '90-100% — Excellent 🏆',
    'home.score_good':     '75-89% — Good ✅',
    'home.score_imp':      '0-74% — Need Improvement ⚠️',
    'home.score_desc':     'คะแนนแต่ละข้อ:',
    // Plant
    'plant.page_title':    'เลือก Plant',
    'plant.section':       'เลือกโรงงานที่ต้องการตรวจ',
    'plant.desc':          'รองรับ 3 Plant ตามมาตรฐาน 5ส Draft 2026',
    'plant.steps_title':   'ขั้นตอนการตรวจ',
    'plant.step1':         'เลือก Plant — โรงงานที่ต้องการตรวจ',
    'plant.step2':         'เลือกพื้นที่ (Area) ที่ต้องการตรวจ',
    'plant.step3':         'ทำ Checklist และให้คะแนน',
    'plant.step4':         'Submit และดูผล',
    // Area
    'area.section':        'เลือกพื้นที่ที่ต้องการตรวจ',
    'area.desc':           'Checklist จะโหลดอัตโนมัติตามประเภทพื้นที่',
    // Audit
    'audit.progress':      'ความคืบหน้า',
    'audit.score_0':       'ไม่ทำ',
    'audit.score_1':       'บางส่วน',
    'audit.score_2':       'ผ่าน',
    'audit.remark_ph':     'หมายเหตุ (ไม่บังคับ)',
    'audit.photo_btn':     'ถ่ายรูปประกอบ',
    'audit.confirm_back':  'คุณต้องการออกจากหน้าตรวจ?\nข้อมูลที่กรอกไว้จะหายทั้งหมด',
    'audit.confirm_title': 'ยืนยันการ Submit?',
    'audit.confirm_msg':   'คุณต้องการบันทึกผลการตรวจนี้หรือไม่?',
    // Summary
    'summary.title':       'ผลการตรวจ',
    'summary.score_label': 'คะแนนที่ได้',
    'summary.audit_id':    'Audit ID',
    'summary.btn_other':   'ตรวจพื้นที่อื่น',
    'summary.btn_history': 'ดูประวัติการตรวจทั้งหมด',
    'summary.btn_dash':    'ดู Dashboard',
    'summary.criteria':    'เกณฑ์คะแนน',
    // History
    'history.title':       'ประวัติการตรวจ',
    'history.all_plant':   '🏭 ทุก Plant',
    'history.all_month':   '📅 ทุกเดือน',
    'history.all_year':    '📆 ทุกปี',
    'history.empty':       'ไม่พบประวัติการตรวจ',
    // Dashboard
    'dash.title':          'Dashboard',
    'dash.overview':       'ภาพรวม',
    'dash.total':          'การตรวจทั้งหมด',
    'dash.avg':            'คะแนนเฉลี่ย',
    'dash.pass':           'อัตราผ่าน',
    'dash.dist':           'การกระจายผล',
    'dash.best':           '🏆 สูงสุด',
    'dash.worst':          '⚠️ ต้องปรับปรุง',
    'dash.monthly':        'แนวโน้มรายเดือน',
    'dash.plant_rank':     'Plant Ranking',
    'dash.area_rank':      'Area Ranking (Top 10)',
    'dash.looker':         'Looker Studio Dashboard',
    'dash.looker_desc':    'ดูรายงานเชิงลึกแบบ Interactive ใน Looker Studio',
    'dash.looker_btn':     'เปิด Looker Studio',
    // Users
    'users.title':         'จัดการผู้ใช้งาน',
    'users.add_btn':       'เพิ่มผู้ใช้งานใหม่',
    'users.all_role':      '👥 ทุก Role',
    'users.all_status':    '🔵 ทุกสถานะ',
    // Status
    'status.excellent':    'ดีเยี่ยม (Excellent)',
    'status.good':         'ผ่าน (Good)',
    'status.need_improve': 'ต้องปรับปรุง (Need Improvement)',
    'badge.excellent':     'Excellent',
    'badge.good':          'Good',
    'badge.need_improve':  'Need Improvement',
    // Area types (TH) — แก้ไข: ย้ายกลับมาอยู่ใน th section ที่ถูกต้อง
    'area.type.Warehouse':   'คลังสินค้า',
    'area.type.Production':  'ไลน์ผลิต',
    'area.type.Office':      'ออฟฟิศ',
    'area.type.Maintenance': 'ช่าง/ยูทิลิตี้',
    'area.type.Cafeteria':   'โรงอาหาร',
    'area.type.Outdoor':     'รอบอาคาร',
    'login.btn.loading':   'กำลังเข้าสู่ระบบ...',
    'login.btn.reset':     'เข้าสู่ระบบ',
    'msg.verifying':       'กำลังตรวจสอบ...',
    'msg.login_failed':    'เข้าสู่ระบบไม่สำเร็จ',
    'msg.no_connection':   'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่',
    'msg.welcome':         'ยินดีต้อนรับ',
    'msg.loading_home':       'กำลังโหลดข้อมูล...',
    'msg.loading_plant':      'โหลดข้อมูล Plant...',
    'msg.loading_area':       'โหลดพื้นที่ตรวจ...',
    'msg.loading_checklist':  'โหลด Checklist...',
    'msg.loading_history':    'โหลดประวัติการตรวจ...',
    'msg.loading_dashboard':  'โหลด Dashboard...',
    'msg.loading_users':      'โหลดรายชื่อผู้ใช้...',
    'msg.loading_saving':     'บันทึกข้อมูล...',
    'msg.loading_step1':      'กำลังสร้างรายการตรวจ... (1/3)',
    'msg.loading_step3':      'กำลังคำนวณคะแนน... (3/3)',
    'msg.load_failed':        'ไม่สามารถโหลดข้อมูลได้',
    'msg.load_error':         'โหลดข้อมูลไม่สำเร็จ',
    'msg.checklist_failed':   'โหลด Checklist ไม่สำเร็จ',
    'msg.dash_failed':        'โหลด Dashboard ไม่สำเร็จ',
    'msg.history_failed':     'โหลดไม่สำเร็จ',
    'msg.users_failed':       'โหลดไม่สำเร็จ',
    'msg.header_failed':      'สร้าง Header ไม่สำเร็จ',
    'msg.finalize_failed':    'Finalize ไม่สำเร็จ',
    'msg.save_failed':        'บันทึกไม่สำเร็จ',
    'msg.error_prefix':       'เกิดข้อผิดพลาด: ',
    'msg.no_criteria':        'ไม่มีรายการ Checklist กรุณาติดต่อผู้ดูแลระบบ เพื่อเพิ่มข้อมูลใน Criteria_Master',
    'msg.uploading':          'กำลัง Upload รูปภาพ...',
    'msg.saving_chunk':       'กำลังบันทึกข้อมูล...',
    'msg.detail_failed':      'บันทึก Details ล้มเหลว chunk ',
    'audit.no_criteria_btn':  'ไม่มีรายการ Checklist',
    'audit.answered_prefix':  'ตอบแล้ว',
    'audit.answered_suffix':  'ข้อ',
    'audit.submit_btn':       '✅ Submit ผลการตรวจ',
    'audit.na_btn':           'ไม่มีในพื้นที่',
    'audit.na_on':            '✓ ตัดออกแล้ว',
    'audit.unanswered_prefix':'ยังไม่ได้ให้คะแนน',
    'audit.unanswered_help':  'ยังมีข้อที่ยังไม่ได้ตรวจ แตะรหัสข้อเพื่อข้ามไปทันที',
    'audit.complete_hint':    'ตรวจครบแล้ว พร้อม Submit',
    'modal.edit_user':        'แก้ไขผู้ใช้งาน',
    'modal.add_user':         'เพิ่มผู้ใช้งานใหม่',
    'msg.save_success_edit':  'แก้ไขสำเร็จ ✅',
    'msg.save_success_add':   'เพิ่มผู้ใช้สำเร็จ ✅',
    'msg.saving_btn':         'กำลังบันทึก...',
    'val.name':               'กรุณากรอกชื่อ',
    'val.email':              'กรุณากรอก Email',
    'val.role':               'กรุณาเลือก Role',
    'val.password':           'กรุณากรอกรหัสผ่าน',
    'msg.admin_only':         'เฉพาะ Admin เท่านั้น',
    'msg.your_role':          'Role ของคุณ: ',
    'msg.go_home':            'กลับหน้าหลัก',
    'msg.no_users':           'ไม่พบผู้ใช้งาน',
    'msg.no_history':         'ไม่พบประวัติการตรวจ',
    'msg.no_data':            'ยังไม่มีข้อมูล',
    'form.full_name':         'ชื่อ-นามสกุล',
    'form.password_label':    'รหัสผ่าน',
    'form.dept':              'แผนก',
    'form.emp_id':            'รหัสพนักงาน',
    'form.role_label':        'บทบาท (Role)',
    'form.status':            'สถานะ',
    'form.select_role':       '-- เลือก Role --',
    'form.pass_hint':         'ปล่อยว่างถ้าไม่ต้องการเปลี่ยน',
    'form.cancel':            'ยกเลิก',
    'form.save':              'บันทึก',
    'summary.ex_desc':        'ทำตามข้อกำหนดครบถ้วน',
    'summary.good_desc':      'ทำได้ดีแต่ยังมีที่ปรับปรุง',
    'summary.imp_desc':       'ต้องปรับปรุงอย่างเร่งด่วน',
    'summary.processing':     'ประมวลผล...',
    'month.1':'มกราคม','month.2':'กุมภาพันธ์','month.3':'มีนาคม',
    'month.4':'เมษายน','month.5':'พฤษภาคม','month.6':'มิถุนายน',
    'month.7':'กรกฎาคม','month.8':'สิงหาคม','month.9':'กันยายน',
    'month.10':'ตุลาคม','month.11':'พฤศจิกายน','month.12':'ธันวาคม',
    'users.stat_all':         'ทั้งหมด',
    'audit.progress_label':   'ตอบแล้ว',
    // Tooltip + new UI keys (TH) — ต้องอยู่ใน th: section
    'img.alt_photo':          'รูปประกอบ',
    'area.default_title':     'เลือกพื้นที่',
    'form.name_ph':           'คุณสมชาย ใจดี',
    'btn.tooltip_logout':     'ออกจากระบบ',
    'btn.tooltip_refresh':    'รีเฟรช',
    'btn.tooltip_add_user':   'เพิ่มผู้ใช้',
    'home.score_desc_html':   'คะแนนแต่ละข้อ: <strong>2</strong>=ผ่าน &nbsp; <strong>1</strong>=บางส่วน &nbsp; <strong>0</strong>=ไม่ผ่าน',
    'role.admin_desc':        '👑 Admin — จัดการทุกอย่าง',
    'role.manager_desc':      '🏢 Manager — ดู Dashboard + ประวัติ',
    'role.area_mgr_desc':     '🗂️ Area Manager — จัดการพื้นที่ที่รับผิดชอบ',
    'role.auditor_desc':      '📋 Auditor — ตรวจ 5ส',
    'role.viewer_desc':       '👁️ Viewer — ดูอย่างเดียว',
    'audit.nav_answered':     'ตอบแล้ว',
  },
  en: {
    // Common
    'nav.home':        'Home',
    'nav.audit':       'Audit',
    'nav.history':     'History',
    'nav.dashboard':   'Dashboard',
    'nav.users':       'Users',
    'btn.logout':      'Logout',
    'btn.refresh':     'Refresh',
    'loading':         'Loading...',
    // Login
    'login.app_sub':       'Factory 5S Audit System | Draft 2026',
    'login.email_label':   'Email',
    'login.pass_label':    'Password',
    'login.pass_ph':       'Enter password',
    'login.btn':           'Sign In',
    'login.quick_title':   '🔧 Dev Mode — Quick Login',
    // Home
    'home.greeting':       'Hello 👋',
    'home.total_audit':    'Total Audits',
    'home.avg_score':      'Avg Score',
    'home.pass_rate':      'Pass Rate',
    'home.excellent':      'Excellent',
    'home.next_schedule':  'Next Audit Schedule',
    'home.round':          'Round',
    'home.date':           'Date',
    'home.start_btn':      'Start 5S Audit',
    'home.quick_menu':     'Quick Menu',
    'home.menu_history':   'History',
    'home.menu_plant':     'Select Plant',
    'home.score_title':    'Score Criteria',
    'home.score_ex':       '90-100% — Excellent 🏆',
    'home.score_good':     '75-89% — Good ✅',
    'home.score_imp':      '0-74% — Need Improvement ⚠️',
    'home.score_desc':     'Score per item:',
    // Plant
    'plant.page_title':    'Select Plant',
    'plant.section':       'Select factory to audit',
    'plant.desc':          'Supporting 3 Plants — 5S Standard Draft 2026',
    'plant.steps_title':   'Audit Steps',
    'plant.step1':         'Select Plant — factory to audit',
    'plant.step2':         'Select Area to audit',
    'plant.step3':         'Complete Checklist and score',
    'plant.step4':         'Submit and view results',
    // Area
    'area.section':        'Select area to audit',
    'area.desc':           'Checklist loads automatically by area type',
    // Audit
    'audit.progress':      'Progress',
    'audit.score_0':       'None',
    'audit.score_1':       'Partial',
    'audit.score_2':       'Pass',
    'audit.remark_ph':     'Remark (optional)',
    'audit.photo_btn':     'Take photo',
    'audit.confirm_back':  'Leave audit page?\nAll entered data will be lost.',
    'audit.confirm_title': 'Confirm Submit?',
    'audit.confirm_msg':   'Do you want to save this audit result?',
    // Summary
    'summary.title':       'Audit Result',
    'summary.score_label': 'Score',
    'summary.audit_id':    'Audit ID',
    'summary.btn_other':   'Audit Another Area',
    'summary.btn_history': 'View All History',
    'summary.btn_dash':    'View Dashboard',
    'summary.criteria':    'Score Criteria',
    // History
    'history.title':       'Audit History',
    'history.all_plant':   '🏭 All Plants',
    'history.all_month':   '📅 All Months',
    'history.all_year':    '📆 All Years',
    'history.empty':       'No audit history found',
    // Dashboard
    'dash.title':          'Dashboard',
    'dash.overview':       'Overview',
    'dash.total':          'Total Audits',
    'dash.avg':            'Avg Score',
    'dash.pass':           'Pass Rate',
    'dash.dist':           'Result Distribution',
    'dash.best':           '🏆 Best Area',
    'dash.worst':          '⚠️ Needs Improvement',
    'dash.monthly':        'Monthly Trend',
    'dash.plant_rank':     'Plant Ranking',
    'dash.area_rank':      'Area Ranking (Top 10)',
    'dash.looker':         'Looker Studio Dashboard',
    'dash.looker_desc':    'View interactive reports in Looker Studio',
    'dash.looker_btn':     'Open Looker Studio',
    // Users
    'users.title':         'User Management',
    'users.add_btn':       'Add New User',
    'users.all_role':      '👥 All Roles',
    'users.all_status':    '🔵 All Status',
    // Status
    'status.excellent':    'Excellent',
    'status.good':         'Good',
    'status.need_improve': 'Need Improvement',
    'badge.excellent':     'Excellent',
    'badge.good':          'Good',
    'badge.need_improve':  'Need Improvement',
    // Area types
    'area.type.Warehouse':   'คลังสินค้า',
    'area.type.Production':  'ไลน์ผลิต',
    'area.type.Office':      'ออฟฟิศ',
    'area.type.Maintenance': 'ช่าง/ยูทิลิตี้',
    'area.type.Cafeteria':   'โรงอาหาร',
    'area.type.Outdoor':     'รอบอาคาร',
    // Login states
    'login.btn.loading':   'กำลังเข้าสู่ระบบ...',
    'login.btn.reset':     'เข้าสู่ระบบ',
    'msg.verifying':       'กำลังตรวจสอบ...',
    'msg.login_failed':    'เข้าสู่ระบบไม่สำเร็จ',
    'msg.no_connection':   'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่',
    'msg.welcome':         'ยินดีต้อนรับ',
    // Loading messages
    'msg.loading_home':       'กำลังโหลดข้อมูล...',
    'msg.loading_plant':      'โหลดข้อมูล Plant...',
    'msg.loading_area':       'โหลดพื้นที่ตรวจ...',
    'msg.loading_checklist':  'โหลด Checklist...',
    'msg.loading_history':    'โหลดประวัติการตรวจ...',
    'msg.loading_dashboard':  'โหลด Dashboard...',
    'msg.loading_users':      'โหลดรายชื่อผู้ใช้...',
    'msg.loading_saving':     'บันทึกข้อมูล...',
    'msg.loading_step1':      'กำลังสร้างรายการตรวจ... (1/3)',
    'msg.loading_step3':      'กำลังคำนวณคะแนน... (3/3)',
    // Error messages
    'msg.load_failed':        'ไม่สามารถโหลดข้อมูลได้',
    'msg.load_error':         'โหลดข้อมูลไม่สำเร็จ',
    'msg.checklist_failed':   'โหลด Checklist ไม่สำเร็จ',
    'msg.dash_failed':        'โหลด Dashboard ไม่สำเร็จ',
    'msg.history_failed':     'โหลดไม่สำเร็จ',
    'msg.users_failed':       'โหลดไม่สำเร็จ',
    'msg.header_failed':      'สร้าง Header ไม่สำเร็จ',
    'msg.finalize_failed':    'Finalize ไม่สำเร็จ',
    'msg.save_failed':        'บันทึกไม่สำเร็จ',
    'msg.error_prefix':       'เกิดข้อผิดพลาด: ',
    // Audit submit
    'msg.no_criteria':        'ไม่มีรายการ Checklist กรุณาติดต่อผู้ดูแลระบบ เพื่อเพิ่มข้อมูลใน Criteria_Master',
    'msg.uploading':          'กำลัง Upload รูปภาพ...',
    'msg.saving_chunk':       'กำลังบันทึกข้อมูล...',
    'msg.detail_failed':      'บันทึก Details ล้มเหลว chunk ',
    // Audit UI
    'audit.no_criteria_btn':  'ไม่มีรายการ Checklist',
    'audit.answered_prefix':  'ตอบแล้ว',
    'audit.answered_suffix':  'ข้อ',
    'audit.submit_btn':       '✅ Submit ผลการตรวจ',
    'audit.na_btn':           'ไม่มีในพื้นที่',
    'audit.na_on':            '✓ ตัดออกแล้ว',
    'audit.unanswered_prefix':'ยังไม่ได้ให้คะแนน',
    'audit.unanswered_help':  'ยังมีข้อที่ยังไม่ได้ตรวจ แตะรหัสข้อเพื่อข้ามไปทันที',
    'audit.complete_hint':    'ตรวจครบแล้ว พร้อม Submit',
    // User modal
    'modal.edit_user':        'แก้ไขผู้ใช้งาน',
    'modal.add_user':         'เพิ่มผู้ใช้งานใหม่',
    'msg.save_success_edit':  'แก้ไขสำเร็จ ✅',
    'msg.save_success_add':   'เพิ่มผู้ใช้สำเร็จ ✅',
    'msg.saving_btn':         'กำลังบันทึก...',
    // Validation
    'val.name':               'กรุณากรอกชื่อ',
    'val.email':              'กรุณากรอก Email',
    'val.role':               'กรุณาเลือก Role',
    'val.password':           'กรุณากรอกรหัสผ่าน',
    // User list
    'msg.admin_only':         'เฉพาะ Admin เท่านั้น',
    'msg.your_role':          'Role ของคุณ: ',
    'msg.go_home':            'กลับหน้าหลัก',
    'msg.no_users':           'ไม่พบผู้ใช้งาน',
    'msg.no_history':         'ไม่พบประวัติการตรวจ',
    'msg.no_data':            'ยังไม่มีข้อมูล',
    // Form labels (users modal)
    'form.full_name':         'ชื่อ-นามสกุล',
    'form.password_label':    'รหัสผ่าน',
    'form.dept':              'แผนก',
    'form.emp_id':            'รหัสพนักงาน',
    'form.role_label':        'บทบาท (Role)',
    'form.status':            'สถานะ',
    'form.select_role':       '-- เลือก Role --',
    'form.pass_hint':         'ปล่อยว่างถ้าไม่ต้องการเปลี่ยน',
    'form.cancel':            'ยกเลิก',
    'form.save':              'บันทึก',
    // Summary criteria
    'summary.ex_desc':        'ทำตามข้อกำหนดครบถ้วน',
    'summary.good_desc':      'ทำได้ดีแต่ยังมีที่ปรับปรุง',
    'summary.imp_desc':       'ต้องปรับปรุงอย่างเร่งด่วน',
    'summary.processing':     'ประมวลผล...',
    // Months
    'month.1':'มกราคม','month.2':'กุมภาพันธ์','month.3':'มีนาคม',
    'month.4':'เมษายน','month.5':'พฤษภาคม','month.6':'มิถุนายน',
    'month.7':'กรกฎาคม','month.8':'สิงหาคม','month.9':'กันยายน',
    'month.10':'ตุลาคม','month.11':'พฤศจิกายน','month.12':'ธันวาคม',
    // Users stats
    'users.stat_all':         'ทั้งหมด',
    'audit.progress_label':   'ตอบแล้ว',
    // New keys
    'img.alt_photo':          'รูปประกอบ',
    'area.default_title':     'เลือกพื้นที่',
    'form.name_ph':           'คุณสมชาย ใจดี',
    'btn.tooltip_logout':     'ออกจากระบบ',
    'btn.tooltip_refresh':    'รีเฟรช',
    'btn.tooltip_add_user':   'เพิ่มผู้ใช้',
    'home.score_desc_html':   'คะแนนแต่ละข้อ: <strong>2</strong>=ผ่าน &nbsp; <strong>1</strong>=บางส่วน &nbsp; <strong>0</strong>=ไม่ผ่าน',
    'role.admin_desc':        '👑 Admin — จัดการทุกอย่าง',
    'role.manager_desc':      '🏢 Manager — ดู Dashboard + ประวัติ',
    'role.area_mgr_desc':     '🗂️ Area Manager — จัดการพื้นที่ที่รับผิดชอบ',
    'role.auditor_desc':      '📋 Auditor — ตรวจ 5ส',
    'role.viewer_desc':       '👁️ Viewer — ดูอย่างเดียว',
    'audit.nav_answered':     'ตอบแล้ว',
  },
  en: {
    // Common
    'nav.home':        'Home',
    'nav.audit':       'Audit',
    'nav.history':     'History',
    'nav.dashboard':   'Dashboard',
    'nav.users':       'Users',
    'btn.logout':      'Logout',
    'btn.refresh':     'Refresh',
    'loading':         'Loading...',
    // Login
    'login.app_sub':       'Factory 5S Audit System | Draft 2026',
    'login.email_label':   'Email',
    'login.pass_label':    'Password',
    'login.pass_ph':       'Enter password',
    'login.btn':           'Sign In',
    'login.quick_title':   '🔧 Dev Mode — Quick Login',
    // Home
    'home.greeting':       'Hello 👋',
    'home.total_audit':    'Total Audits',
    'home.avg_score':      'Avg Score',
    'home.pass_rate':      'Pass Rate',
    'home.excellent':      'Excellent',
    'home.next_schedule':  'Next Audit Schedule',
    'home.round':          'Round',
    'home.date':           'Date',
    'home.start_btn':      'Start 5S Audit',
    'home.quick_menu':     'Quick Menu',
    'home.menu_history':   'History',
    'home.menu_plant':     'Select Plant',
    'home.score_title':    'Score Criteria',
    'home.score_ex':       '90-100% — Excellent 🏆',
    'home.score_good':     '75-89% — Good ✅',
    'home.score_imp':      '0-74% — Need Improvement ⚠️',
    'home.score_desc':     'Score per item:',
    // Plant
    'plant.page_title':    'Select Plant',
    'plant.section':       'Select factory to audit',
    'plant.desc':          'Supporting 3 Plants — 5S Standard Draft 2026',
    'plant.steps_title':   'Audit Steps',
    'plant.step1':         'Select Plant — factory to audit',
    'plant.step2':         'Select Area to audit',
    'plant.step3':         'Complete Checklist and score',
    'plant.step4':         'Submit and view results',
    // Area
    'area.section':        'Select area to audit',
    'area.desc':           'Checklist loads automatically by area type',
    // Audit
    'audit.progress':      'Progress',
    'audit.score_0':       'None',
    'audit.score_1':       'Partial',
    'audit.score_2':       'Pass',
    'audit.remark_ph':     'Remark (optional)',
    'audit.photo_btn':     'Take photo',
    'audit.confirm_back':  'Leave audit page?\nAll entered data will be lost.',
    'audit.confirm_title': 'Confirm Submit?',
    'audit.confirm_msg':   'Do you want to save this audit result?',
    // Summary
    'summary.title':       'Audit Result',
    'summary.score_label': 'Score',
    'summary.audit_id':    'Audit ID',
    'summary.btn_other':   'Audit Another Area',
    'summary.btn_history': 'View All History',
    'summary.btn_dash':    'View Dashboard',
    'summary.criteria':    'Score Criteria',
    // History
    'history.title':       'Audit History',
    'history.all_plant':   '🏭 All Plants',
    'history.all_month':   '📅 All Months',
    'history.all_year':    '📆 All Years',
    'history.empty':       'No audit history found',
    // Dashboard
    'dash.title':          'Dashboard',
    'dash.overview':       'Overview',
    'dash.total':          'Total Audits',
    'dash.avg':            'Avg Score',
    'dash.pass':           'Pass Rate',
    'dash.dist':           'Result Distribution',
    'dash.best':           '🏆 Best Area',
    'dash.worst':          '⚠️ Needs Improvement',
    'dash.monthly':        'Monthly Trend',
    'dash.plant_rank':     'Plant Ranking',
    'dash.area_rank':      'Area Ranking (Top 10)',
    'dash.looker':         'Looker Studio Dashboard',
    'dash.looker_desc':    'View interactive reports in Looker Studio',
    'dash.looker_btn':     'Open Looker Studio',
    // Users
    'users.title':         'User Management',
    'users.add_btn':       'Add New User',
    'users.all_role':      '👥 All Roles',
    'users.all_status':    '🔵 All Status',
    // Status
    'status.excellent':    'Excellent',
    'status.good':         'Good',
    'status.need_improve': 'Need Improvement',
    'badge.excellent':     'Excellent',
    'badge.good':          'Good',
    'badge.need_improve':  'Need Improvement',
    // Area types
    'area.type.Warehouse':   'Warehouse',
    'area.type.Production':  'Production Line',
    'area.type.Office':      'Office',
    'area.type.Maintenance': 'Maintenance',
    'area.type.Cafeteria':   'Cafeteria',
    'area.type.Outdoor':     'Outdoor',
    // Login states
    'login.btn.loading':   'Signing in...',
    'login.btn.reset':     'Sign In',
    'msg.verifying':       'Verifying...',
    'msg.login_failed':    'Login failed',
    'msg.no_connection':   'Cannot connect to server. Please try again.',
    'msg.welcome':         'Welcome',
    // Loading messages
    'msg.loading_home':       'Loading...',
    'msg.loading_plant':      'Loading plants...',
    'msg.loading_area':       'Loading areas...',
    'msg.loading_checklist':  'Loading checklist...',
    'msg.loading_history':    'Loading audit history...',
    'msg.loading_dashboard':  'Loading dashboard...',
    'msg.loading_users':      'Loading users...',
    'msg.loading_saving':     'Saving...',
    'msg.loading_step1':      'Creating audit record... (1/3)',
    'msg.loading_step3':      'Calculating score... (3/3)',
    // Error messages
    'msg.load_failed':        'Failed to load data',
    'msg.load_error':         'Load failed',
    'msg.checklist_failed':   'Failed to load checklist',
    'msg.dash_failed':        'Failed to load dashboard',
    'msg.history_failed':     'Load failed',
    'msg.users_failed':       'Load failed',
    'msg.header_failed':      'Failed to create audit header',
    'msg.finalize_failed':    'Finalize failed',
    'msg.save_failed':        'Save failed',
    'msg.error_prefix':       'Error: ',
    // Audit submit
    'msg.no_criteria':        'No checklist items found. Please contact administrator.',
    'msg.uploading':          'Uploading photos...',
    'msg.saving_chunk':       'Saving data...',
    'msg.detail_failed':      'Failed to save details chunk ',
    // Audit UI
    'audit.no_criteria_btn':  'No Checklist',
    'audit.answered_prefix':  'Answered',
    'audit.answered_suffix':  'items',
    'audit.submit_btn':       '✅ Submit Audit',
    'audit.na_btn':           'Not in area',
    'audit.na_on':            '✓ Excluded',
    'audit.unanswered_prefix':'Unanswered',
    'audit.unanswered_help':  'Some items are still missing. Tap an item code to jump there.',
    'audit.complete_hint':    'All items answered. Ready to submit.',
    // User modal
    'modal.edit_user':        'Edit User',
    'modal.add_user':         'Add New User',
    'msg.save_success_edit':  'Updated ✅',
    'msg.save_success_add':   'User added ✅',
    'msg.saving_btn':         'Saving...',
    // Validation
    'val.name':               'Please enter name',
    'val.email':              'Please enter Email',
    'val.role':               'Please select Role',
    'val.password':           'Please enter password',
    // User list
    'msg.admin_only':         'Admin only',
    'msg.your_role':          'Your role: ',
    'msg.go_home':            'Back to Home',
    'msg.no_users':           'No users found',
    'msg.no_history':         'No audit history found',
    'msg.no_data':            'No data yet',
    // Form labels
    'form.full_name':         'Full Name',
    'form.password_label':    'Password',
    'form.dept':              'Department',
    'form.emp_id':            'Employee ID',
    'form.role_label':        'Role',
    'form.status':            'Status',
    'form.select_role':       '-- Select Role --',
    'form.pass_hint':         'Leave blank to keep current',
    'form.cancel':            'Cancel',
    'form.save':              'Save',
    // Summary criteria
    'summary.ex_desc':        'Full compliance with all requirements',
    'summary.good_desc':      'Good but room for improvement',
    'summary.imp_desc':       'Requires urgent improvement',
    'summary.processing':     'Processing...',
    // Months
    'month.1':'January','month.2':'February','month.3':'March',
    'month.4':'April','month.5':'May','month.6':'June',
    'month.7':'July','month.8':'August','month.9':'September',
    'month.10':'October','month.11':'November','month.12':'December',
    // Users stats
    'users.stat_all':         'All',
    'audit.progress_label':   'Answered',
    // New keys EN
    'img.alt_photo':          'Photo',
    'area.default_title':     'Select Area',
    'form.name_ph':           'e.g. John Smith',
    'btn.tooltip_logout':     'Logout',
    'btn.tooltip_refresh':    'Refresh',
    'btn.tooltip_add_user':   'Add User',
    'home.score_desc_html':   'Score per item: <strong>2</strong>=Pass &nbsp; <strong>1</strong>=Partial &nbsp; <strong>0</strong>=None',
    'role.admin_desc':        '👑 Admin — Full access',
    'role.manager_desc':      '🏢 Manager — Dashboard + History',
    'role.area_mgr_desc':     '🗂️ Area Manager — Manage assigned areas',
    'role.auditor_desc':      '📋 Auditor — 5S Audit',
    'role.viewer_desc':       '👁️ Viewer — Read only',
    'audit.nav_answered':     'Answered',
  }
};

// ============================================================
// I18n — จัดการภาษา
// ============================================================
const I18n = {
  /** คืนค่าภาษาปัจจุบัน */
  getLang() {
    return localStorage.getItem(CONFIG.LANG_KEY) || 'th';
  },

  /** บันทึกภาษาและ apply ทันที */
  setLang(lang) {
    localStorage.setItem(CONFIG.LANG_KEY, lang);
    this.apply();
  },

  /** แปลง key → ข้อความ */
  t(key) {
    const lang = this.getLang();
    return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) ||
           (TRANSLATIONS['th'][key]) || key;
  },

  /** Apply ทุก element ที่มี data-i18n */
  apply() {
    const lang = this.getLang();
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const val = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || key;
      // ถ้ามี child icon ให้เก็บไว้ แทนแค่ text node สุดท้าย
      const icon = el.querySelector('i.bi, i.ti');
      if (icon) {
        // หา text node ที่ไม่ใช่ icon แล้วแทน
        el.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            node.textContent = ' ' + val;
          }
        });
      } else {
        el.textContent = val;
      }
    });
    // placeholder
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const key = el.dataset.i18nPh;
      el.placeholder = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || key;
    });
    // title attribute (tooltip)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      el.title = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || key;
    });
    // innerHTML (สำหรับข้อความที่มี HTML tags เช่น <strong>)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      const val = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || key;
      el.innerHTML = val;
    });
    // lang pills — sync active state
    document.querySelectorAll('.lang-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }
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
   * Dispatch ไป SUPABASE handler (SBH) — คืน shape เดิมที่หน้าเว็บใช้
   * จัดการ auth error กลาง: ถ้า token/JWT หมดอายุ → เคลียร์ session + เด้ง login
   */
  async _run(action, params) {
    const handler = SBH[action];
    if (!handler) { console.warn('unknown action:', action); return { success:false, error:'ไม่รู้จัก action: ' + action }; }
    try {
      return await handler(params || {});
    } catch(err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (/JWT|not authenticated|invalid.*token|expired|refresh/i.test(msg)) {
        Session.clear();
        const onLogin = /(?:^|\/)index\.html$/.test(location.pathname) || location.pathname.endsWith('/');
        if (!onLogin) {
          try { UI.toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning', 3000); } catch(_){}
          setTimeout(() => navigate('index.html'), 800);
        }
      }
      console.error('[API] ' + action + ' error:', msg);
      return { success:false, error:msg };
    }
  },
  get(action, params = {})  { return this._run(action, params); },
  post(action, body = {})   { return this._run(action, body); },
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

  /** ล้าง session (localStorage + Supabase auth) */
  clear() {
    AppState.token = null;
    AppState.user  = null;
    _profileCache  = null;
    localStorage.removeItem(CONFIG.SESSION_KEY);
    try { _sb.auth.signOut(); } catch(_) {}
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
  showLoading(msg = null) {
    msg = msg || I18n.t('loading');
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
    // ใช้ textContent เพื่อป้องกัน XSS injection
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icons[type] || '';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = ' ' + msg;
    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
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

  /** ฟอร์แมตวันที่ตามภาษาปัจจุบัน */
  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    if (I18n.getLang() === 'en') {
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
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

  /** แสดงชื่อสถานะตามภาษาปัจจุบัน */
  statusTH(percent) {
    percent = parseFloat(percent) || 0;
    if (percent >= 90) return I18n.t('status.excellent');
    if (percent >= 75) return I18n.t('status.good');
    return I18n.t('status.need_improve');
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

  // Helper: อัปเดต text ใน button โดยไม่ทำลาย icon
  const setLoginBtnText = (btn, text, iconClass = 'bi-box-arrow-in-right') => {
    btn.innerHTML = `<i class="bi ${iconClass}"></i> <span>${text}</span>`;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled  = true;
    setLoginBtnText(submitBtn, I18n.t('login.btn.loading'), 'bi-hourglass-split');

    try {
      UI.showLoading(I18n.t('msg.verifying'));
      const res = await API.post('login', {
        email:    emailEl.value.trim(),
        password: passEl.value
      });
      UI.hideLoading();

      if (res.success) {
        Session.save(res.token, res.user);
        logEvent('LOGIN', 'เข้าสู่ระบบ');
        UI.toast(`${I18n.t('msg.welcome')} ${res.user.name} 👋`, 'success');
        setTimeout(() => navigate('home.html'), 800);
      } else {
        errorEl.textContent = res.error || I18n.t('msg.login_failed');
        submitBtn.disabled  = false;
        setLoginBtnText(submitBtn, I18n.t('login.btn'));
      }
    } catch(err) {
      UI.hideLoading();
      errorEl.textContent = I18n.t('msg.no_connection');
      submitBtn.disabled  = false;
      setLoginBtnText(submitBtn, I18n.t('login.btn'));
    }
  });
}

// ============================================================
// HOME PAGE
// ============================================================
async function initHome() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  // แสดง/ซ่อน menu ตาม role
  // FIX: Session.load() คืน boolean — ต้องอ่าน role/userId จาก AppState.user
  const user = AppState.user || {};
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const menuSched = document.getElementById('menuSchedule');
  const menuUsers = document.getElementById('menuUsers');
  // ทั้ง "มอบหมาย" และ "ผู้ใช้" เป็น admin-only แสดงพร้อมกัน; auditor ไม่เห็นทั้งคู่
  if (menuSched) menuSched.style.display = isAdmin ? 'block' : 'none';
  if (menuUsers) menuUsers.style.display = isAdmin ? 'block' : 'none';
  const menuLogs = document.getElementById('menuLogs');
  if (menuLogs) menuLogs.style.display = isAdmin ? 'block' : 'none';

  try {
    UI.showLoading(I18n.t('msg.loading_home'));
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

    // แสดง Assigned Tasks สำหรับ Auditor
    if (schedRes.success && schedRes.data.length) {
      const userId = user.userId || null;
      // กรอง schedules ที่ user นี้ถูก assign
      const myTasks = schedRes.data.filter(s => {
        if (!userId) return false;
        const ids = String(s.Auditor_ID || '').split(',').map(x => x.trim());
        return ids.includes(String(userId));
      });

      if (myTasks.length > 0) {
        const section = document.getElementById('myTasksSection');
        const list    = document.getElementById('myTasksList');
        const nextCard = document.getElementById('nextScheduleCard');
        if (section) section.style.display = 'block';
        if (nextCard) nextCard.style.display = 'none';

        if (list) {
          list.innerHTML = myTasks.map(s => {
            const dateStr = UI.formatDate(s.Audit_Date);
            const isDone  = s.Status === 'Completed';
            const isOverdue = !isDone && s.Audit_Date && new Date(s.Audit_Date) < new Date();
            const badgeClass = isDone ? 'success' : (isOverdue ? 'danger' : 'warning');
            const badgeText  = isDone ? '✓ เสร็จสิ้น' : (isOverdue ? '⚠️ เกินกำหนด' : '📅 รอตรวจ');
            const cta = isDone
              ? `<div class="btn btn-block" style="height:40px;font-size:0.85rem;background:var(--gray-100);color:var(--success);font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;cursor:default;">
                   <i class="bi bi-check-circle-fill"></i> ดำเนินการตรวจเสร็จสิ้นแล้ว
                 </div>`
              : `<button class="btn btn-primary btn-block" style="height:40px;font-size:0.85rem;"
                        onclick="startAssignedAudit('${escAttr(s.Plant_ID)}','${escAttr(s.Plant_Name || s.Plant_ID)}','${escAttr(s.Area_ID)}','${escAttr(s.Area_Name || s.Area_ID)}','${escAttr(s.Area_Type || '')}','${escAttr(s.Schedule_ID || '')}')">
                   <i class="bi bi-play-circle"></i> เริ่มตรวจ
                 </button>`;
            return `
              <div class="card mb-2" style="padding:14px 16px;border-left:4px solid var(--${badgeClass})${isDone ? ';opacity:.85' : ''}">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">
                  <div>
                    <div style="font-weight:700;font-size:0.9rem">${escHtml(s.Area_Name || s.Area_ID || '-')}</div>
                    <div style="font-size:0.75rem;color:var(--gray-600)">${escHtml(s.Plant_Name || s.Plant_ID || '')} · ${escHtml(s.Audit_Round || '')}</div>
                  </div>
                  <span class="badge badge-${badgeClass}" style="font-size:0.65rem;padding:3px 8px;border-radius:20px;">${badgeText}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--gray-600);margin-bottom:10px;">
                  <i class="bi bi-calendar3"></i> ${dateStr}
                </div>
                ${cta}
              </div>`;
          }).join('');
        }
      } else {
        // ไม่มี assigned task → แสดง next schedule ทั่วไป
        const upcoming = schedRes.data.find(s => s.Status === 'Pending');
        if (upcoming) {
          setEl('nextAuditDate', UI.formatDate(upcoming.Audit_Date));
          setEl('nextAuditRound', upcoming.Audit_Round || '-');
        }
      }
    }
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.load_failed'), 'error');
  }
}

// เริ่มตรวจจาก Assigned Task — ข้าม Plant/Area selection เข้าหน้าตรวจตรงพื้นที่ที่มอบหมาย
function startAssignedAudit(plantId, plantName, areaId, areaName, areaType, scheduleId) {
  if (!plantId || !areaId) { navigate('plant.html'); return; }
  navigate('audit.html', {
    plantId,
    plantName: plantName || plantId,
    areaId,
    areaName: areaName || areaId,
    areaType: areaType || '',
    scheduleId: scheduleId || ''
  });
}

// ============================================================
// PLANT PAGE
// ============================================================
async function initPlant() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  // แสดงปุ่ม "มอบหมายงาน" เฉพาะ Admin
  // FIX: อ่าน role จาก AppState.user (Session.load() คืน boolean)
  const user = AppState.user || {};
  const btnSched = document.getElementById('btnSchedule');
  if (btnSched && String(user.role || '').toLowerCase() === 'admin') btnSched.style.display = 'block';

  UI.showLoading(I18n.t('msg.loading_plant'));
  try {
    const res = await API.get('getPlants');
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }

    AppState.plants = res.data;
    const container = document.getElementById('plantGrid');
    if (!container) return;

    const icons = { SUP: '🏭', POC: '🧴', NIF: '🌿' };
    const colors = { SUP: '#1a73e8', POC: '#34a853', NIF: '#ea4335' };

    const plantCards = res.data
      .filter(p => !['CAF','MTN'].includes(p.Plant_ID))   // เข้าผ่านการ์ดโรงอาหาร/ช่างแทน
      .map(p => `
      <div class="plant-card card-clickable"
           data-plant-id="${escAttr(p.Plant_ID)}"
           data-plant-name="${escAttr(p.Plant_Name)}"
           onclick="selectPlantFromEl(this)">
        <div class="plant-icon" style="background:${colors[p.Plant_ID]}20;color:${colors[p.Plant_ID]}">
          ${icons[p.Plant_ID] || '🏭'}
        </div>
        <div>
          <div class="plant-name">${escHtml(p.Plant_Name)}</div>
          <div class="plant-meta text-muted">Plant ID: ${escHtml(p.Plant_ID)}</div>
        </div>
        <i class="bi bi-chevron-right text-muted ms-auto"></i>
      </div>
    `).join('');

    // การ์ดพื้นที่ส่วนกลาง (รวมทุก plant) — โรงอาหาร + ช่าง/ยูทิลิตี้
    const allTxt = I18n.getLang() === 'en' ? 'All plants' : 'รวมทุกโรงงาน';
    const facilityCards = `
      <div class="plant-card card-clickable" onclick="openFacility('cafeteria')">
        <div class="plant-icon" style="background:#f9971e20;color:#f9971e">🍽️</div>
        <div>
          <div class="plant-name">${escHtml(I18n.t('area.type.Cafeteria'))}</div>
          <div class="plant-meta text-muted">${escHtml(allTxt)}</div>
        </div>
        <i class="bi bi-chevron-right text-muted ms-auto"></i>
      </div>
      <div class="plant-card card-clickable" onclick="openFacility('maintenance')">
        <div class="plant-icon" style="background:#5f6c7b20;color:#5f6c7b">🔧</div>
        <div>
          <div class="plant-name">${escHtml(I18n.t('area.type.Maintenance'))}</div>
          <div class="plant-meta text-muted">${escHtml(allTxt)}</div>
        </div>
        <i class="bi bi-chevron-right text-muted ms-auto"></i>
      </div>
    `;

    container.innerHTML = plantCards + facilityCards;
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.load_error'), 'error');
  }
}

function selectPlantFromEl(el) {
  selectPlant(el.dataset.plantId, el.dataset.plantName);
}

function selectPlant(plantId, plantName) {
  AppState.currentPlant = { Plant_ID: plantId, Plant_Name: plantName };
  navigate('area.html', { plantId, plantName });
}

/** เปิดพื้นที่ส่วนกลางตามชนิด (โรงอาหาร / ช่าง-ยูทิลิตี้) ข้ามทุก plant */
function openFacility(type) {
  const title = type === 'cafeteria'
    ? I18n.t('area.type.Cafeteria')
    : I18n.t('area.type.Maintenance');
  navigate('area.html', { areaType: type, title });
}

// ============================================================
// AREA PAGE
// ============================================================
async function initArea() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  const plantId   = getParam('plantId');
  const plantName = getParam('plantName');
  const areaType  = getParam('areaType');     // โหมดพื้นที่ส่วนกลาง (cafeteria / maintenance)
  const title     = getParam('title');
  const byType    = !!areaType;               // true = จัดกลุ่มตาม plant

  if (!plantId && !byType) { navigate('plant.html'); return; }

  if (plantId) AppState.currentPlant = { Plant_ID: plantId, Plant_Name: plantName };

  // getParam() ใช้ URLSearchParams.get() ซึ่ง decode แล้ว ไม่ต้อง decode ซ้ำ
  setEl('currentPlantName', byType ? (title || areaType) : (plantName || plantId));

  UI.showLoading(I18n.t('msg.loading_area'));
  try {
    const res = await API.get('getAreas', byType ? { areaType } : { plantId });
    if (!res.success) { UI.hideLoading(); UI.toast(res.error, 'error'); return; }

    // โหมดพื้นที่ส่วนกลางต้องรู้ชื่อ plant → ดึงรายชื่อมา map
    const plantNameMap = {};
    if (plantId) plantNameMap[plantId] = plantName || plantId;
    if (byType) {
      const pr = await API.get('getPlants');
      if (pr.success) pr.data.forEach(p => { plantNameMap[p.Plant_ID] = p.Plant_Name; });
    }
    UI.hideLoading();

    AppState.areas = res.data;
    const container = document.getElementById('areaList');
    if (!container) return;

    if (!res.data.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-calendar-x"></i>
          <p>ไม่พบพื้นที่ที่ได้รับมอบหมายในรอบนี้</p>
        </div>`;
      return;
    }

    // Area type icons
    const areaIcons = {
      Warehouse:   'bi-box-seam',
      Production:  'bi-gear',
      Office:      'bi-building',
      Maintenance: 'bi-tools',
      Cafeteria:   'bi-cup-hot',
      Outdoor:     'bi-tree',
    };

    // ใช้ I18n.t() เพื่อรองรับ 2 ภาษา
    const areaTypeTH = {
      Warehouse:   I18n.t('area.type.Warehouse'),
      Production:  I18n.t('area.type.Production'),
      Office:      I18n.t('area.type.Office'),
      Maintenance: I18n.t('area.type.Maintenance'),
      Cafeteria:   I18n.t('area.type.Cafeteria'),
      Outdoor:     I18n.t('area.type.Outdoor'),
    };

    // สร้างการ์ดพื้นที่ 1 ใบ (badgeText ว่าง = ไม่โชว์ badge)
    const areaCard = (a, badgeText) => `
      <div class="area-card area-type-${escHtml(a.Area_Type)}"
           data-area-id="${escAttr(a.Area_ID)}"
           data-area-name="${escAttr(a.Area_Name)}"
           data-area-type="${escAttr(a.Area_Type)}"
           data-plant-id="${escAttr(a.Plant_ID)}"
           data-plant-name="${escAttr(plantNameMap[a.Plant_ID] || a.Plant_ID)}"
           onclick="selectAreaFromEl(this)">
        <div class="area-icon">
          <i class="bi ${areaIcons[a.Area_Type] || 'bi-grid'}"></i>
        </div>
        <div class="area-info">
          <div class="area-name">${escHtml(a.Area_Name)}</div>
          ${badgeText ? `<span class="area-type-badge">${escHtml(badgeText)}</span>` : ''}
          ${a.Audit_Round ? `<span class="area-type-badge" style="margin-left:6px;background:#fff8e1;color:#8a5b00">${escHtml(a.Audit_Round)} ${a.Audit_Date ? '• ' + escHtml(a.Audit_Date) : ''}</span>` : ''}
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </div>`;

    if (byType) {
      // โหมดพื้นที่ส่วนกลาง: แสดงรายการเดียว ไม่แยกตามโรงงาน ไม่โชว์ชื่อโรงงาน
      container.innerHTML = `<div class="area-list">${
        res.data.map(a => areaCard(a, '')).join('')
      }</div>`;
    } else {
      // โหมด plant: จัดกลุ่มตามชนิดพื้นที่
      const grouped = {};
      res.data.forEach(a => { (grouped[a.Area_Type] = grouped[a.Area_Type] || []).push(a); });
      container.innerHTML = Object.entries(grouped).map(([type, areas]) => `
        <div class="mb-3">
          <div class="section-title">
            <i class="bi ${areaIcons[type] || 'bi-grid'}"></i>
            ${escHtml(areaTypeTH[type] || type)}
          </div>
          <div class="area-list">
            ${areas.map(a => areaCard(a, areaTypeTH[a.Area_Type] || a.Area_Type)).join('')}
          </div>
        </div>`).join('');
    }
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.load_error'), 'error');
  }
}

function selectAreaFromEl(el) {
  selectArea(el.dataset.areaId, el.dataset.areaName, el.dataset.areaType, el.dataset.plantId, el.dataset.plantName);
}

function selectArea(areaId, areaName, areaType, plantId, plantName) {
  plantId   = plantId   || getParam('plantId');
  plantName = plantName || getParam('plantName') || '';
  navigate('audit.html', {
    plantId,
    plantName,
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
  // getParam() decode แล้ว ไม่ต้อง decode ซ้ำ
  setEl('auditAreaName', areaName || areaId);

  // ตั้ง audit date เป็นวันนี้
  const todayInput = document.getElementById('auditDate');
  if (todayInput) todayInput.value = new Date().toISOString().split('T')[0];

  UI.showLoading(I18n.t('msg.loading_checklist'));
  try {
    const res = await API.get('getCriteria', { areaType });
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }

    AppState.criteria = res.data;

    // เริ่มต้น answers ทุกข้อ
    res.data.forEach(c => {
      AppState.auditAnswers[c.Criteria_ID] = { score: null, na: false, remark: '', photos: [] };
    });

    renderChecklist(res.grouped, res.data.length, res.totalMaxScore);
    updateProgress();
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.checklist_failed'), 'error');
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
    <div class="category-section mb-2" data-category="${escAttr(category)}" id="cat-${escHtml(category).replace(/\s/g,'_')}">
      <div class="category-header" onclick="toggleAuditCategory(this)">
        <span><i class="bi bi-clipboard-check me-2"></i>${escHtml(category)}</span>
        <span class="category-head-right">
          <button type="button" class="cat-na-btn" onclick="event.stopPropagation(); toggleCategoryNA(this)">
            <i class="bi bi-slash-circle"></i> <span class="cat-na-label">${I18n.t('audit.na_btn')}</span>
          </button>
          <span class="category-count">${items.length} ${I18n.t('audit.answered_suffix')}</span>
        </span>
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
          <span class="score-label">${I18n.t('audit.score_0')}</span>
        </button>
        <button class="score-btn" data-score="1" data-id="${c.Criteria_ID}"
                onclick="setScore('${c.Criteria_ID}', 1, this)">
          <span class="score-num">1</span>
          <span class="score-label">${I18n.t('audit.score_1')}</span>
        </button>
        <button class="score-btn" data-score="2" data-id="${c.Criteria_ID}"
                onclick="setScore('${c.Criteria_ID}', 2, this)">
          <span class="score-num">2</span>
          <span class="score-label">${I18n.t('audit.score_2')}</span>
        </button>
      </div>

      <div class="criteria-extras">
        <textarea class="remark-input" placeholder="${I18n.t('audit.remark_ph')}"
                  oninput="setRemark('${c.Criteria_ID}', this.value)"
                  rows="2"></textarea>
        <button class="photo-btn" onclick="triggerPhoto('${c.Criteria_ID}')">
          <i class="bi bi-camera"></i> ${I18n.t('audit.photo_btn')}
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
  if (AppState.auditAnswers[criteriaId]?.na) return;   // ข้อที่ตัด N/A ให้คะแนนไม่ได้
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
    item.classList.remove('unanswered');
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
  // นับเฉพาะข้อที่ไม่ได้ตัด N/A (ข้อ N/A ไม่ต้องตอบ ไม่นับใน total)
  const active   = (AppState.criteria || []).filter(c => !AppState.auditAnswers[c.Criteria_ID]?.na);
  const total    = active.length;
  const answered = active.filter(c => AppState.auditAnswers[c.Criteria_ID]?.score !== null).length;
  const pct      = total > 0 ? Math.round((answered / total) * 100) : 0;
  const unanswered = getUnansweredCriteria();

  setEl('progressPct', pct + '%');
  setEl('answeredCount', answered);

  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = pct + '%';

  renderRemainingPanel(unanswered);

  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    if (total === 0) {
      submitBtn.disabled = true;
      submitBtn.textContent = I18n.t('audit.no_criteria_btn');
    } else if (answered < total) {
      submitBtn.disabled = false;
      submitBtn.textContent = `${I18n.t('audit.answered_prefix')} ${answered}/${total} ${I18n.t('audit.answered_suffix')}`;
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = I18n.t('audit.submit_btn');
    }
  }
}

function getUnansweredCriteria() {
  return (AppState.criteria || []).filter(c => {
    const a = AppState.auditAnswers[c.Criteria_ID];
    return a && !a.na && a.score === null;   // ข้อ N/A ไม่ถือว่า "ยังไม่ตอบ"
  });
}

function renderRemainingPanel(unanswered = getUnansweredCriteria()) {
  const panel = document.getElementById('auditRemainingPanel');
  if (!panel) return;

  if (!unanswered.length) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  const visible = unanswered.slice(0, 24);
  const more = unanswered.length - visible.length;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="audit-remaining-title">
      <i class="bi bi-exclamation-triangle"></i>
      ${I18n.t('audit.unanswered_help')} (${unanswered.length})
    </div>
    <div class="audit-remaining-list">
      ${visible.map(c => `
        <button type="button" class="audit-remaining-chip" onclick="jumpToCriteria('${escAttr(c.Criteria_ID)}')">
          ${escHtml(c.Criteria_ID)}
        </button>
      `).join('')}
      ${more > 0 ? `<span class="audit-remaining-chip">+${more}</span>` : ''}
    </div>
  `;
}

function markUnansweredItems(unanswered = getUnansweredCriteria()) {
  document.querySelectorAll('.criteria-item.unanswered').forEach(el => el.classList.remove('unanswered'));
  unanswered.forEach(c => {
    const item = document.getElementById('item-' + c.Criteria_ID);
    if (item) item.classList.add('unanswered');
  });
}

function jumpToCriteria(criteriaId) {
  const item = document.getElementById('item-' + criteriaId);
  if (!item) return;
  const body = item.closest('.category-body');
  if (body && body.classList.contains('collapsed')) slideToggle(body, false);
  item.classList.add('unanswered', 'jump-focus');
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => item.classList.remove('jump-focus'), 1300);
}

/**
 * หุบ/คลี่ body ด้วยอนิเมชั่น (max-height transition)
 * @param {HTMLElement} body   element .category-body
 * @param {boolean}     collapse  true=หุบ, false=คลี่
 */
function slideToggle(body, collapse) {
  if (!body) return;
  if (collapse) {
    body.style.maxHeight = body.scrollHeight + 'px';
    void body.offsetHeight;                    // force reflow ให้ transition ทำงาน
    body.classList.add('collapsed');
    body.style.maxHeight = '0px';
  } else {
    body.classList.remove('collapsed');
    body.style.maxHeight = body.scrollHeight + 'px';
    const done = (e) => {
      if (e.propertyName !== 'max-height') return;
      body.style.maxHeight = '';               // ปล่อยให้สูงตามเนื้อหาจริงหลังคลี่เสร็จ
      body.removeEventListener('transitionend', done);
    };
    body.addEventListener('transitionend', done);
  }
}

/**
 * ซ่อน/แสดง category (กดที่หัวหมวด) — หน้า audit
 */
function toggleAuditCategory(header) {
  const body = header.nextElementSibling;
  if (!body) return;
  const collapsed = body.classList.contains('collapsed');
  slideToggle(body, !collapsed);

  const icon = header.querySelector('.bi');
  if (icon) {
    icon.className = collapsed
      ? 'bi bi-clipboard-check me-2'
      : 'bi bi-chevron-down';
  }
}

/**
 * กด "ไม่มีในพื้นที่" ที่ระดับหมวด → ทุกข้อในหมวดถูกตัดออกจากการคำนวณคะแนน (na=true)
 * กดซ้ำ = ยกเลิก (na=false, ต้องให้คะแนนใหม่)
 */
function toggleCategoryNA(btn) {
  const section = btn.closest('.category-section');
  if (!section) return;
  const category = section.dataset.category;
  const willNA   = !btn.classList.contains('active');

  btn.classList.toggle('active', willNA);
  section.classList.toggle('cat-na', willNA);

  (AppState.criteria || [])
    .filter(c => c.Category === category)
    .forEach(c => {
      const a = AppState.auditAnswers[c.Criteria_ID];
      if (!a) return;
      a.na = willNA;
      if (willNA) a.score = null;   // เคลียร์คะแนนเดิมเมื่อกลายเป็น N/A

      const el = document.getElementById('item-' + c.Criteria_ID);
      if (el) {
        el.classList.toggle('na-disabled', willNA);
        if (willNA) {
          el.querySelectorAll('.score-btn').forEach(b => b.classList.remove('selected'));
          el.style.borderLeft = '';
          el.classList.remove('unanswered');
        }
      }
    });

  const label = btn.querySelector('.cat-na-label');
  if (label) label.textContent = I18n.t(willNA ? 'audit.na_on' : 'audit.na_btn');

  // หุบข้อย่อยด้วยอนิเมชั่นเมื่อตัด N/A / คลี่กลับเมื่อยกเลิก
  const body = section.querySelector('.category-body');
  slideToggle(body, willNA);
  const icon = section.querySelector('.category-header .bi');
  if (icon) icon.className = willNA ? 'bi bi-chevron-down' : 'bi bi-clipboard-check me-2';

  updateProgress();
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
  const compressed = await compressImage(file, 1024, 0.8);

  if (!AppState.auditAnswers[criteriaId]) {
    AppState.auditAnswers[criteriaId] = { score: null, remark: '', photos: [] };
  }
  if (!AppState.auditAnswers[criteriaId].photos) {
    AppState.auditAnswers[criteriaId].photos = [];
  }

  AppState.auditAnswers[criteriaId].photos.push({
    filename: `photo_${criteriaId}_${Date.now()}.jpg`,
    preview: compressed,
    uploaded: false,
    url: null,
  });

  // Re-render ทั้งหมด เพื่อให้ index ถูกต้องเสมอ
  renderPhotoPreviews(criteriaId);
}

/**
 * Re-render photo preview grid — ทำให้ index ของ removePhoto ถูกต้องเสมอ
 * แก้ Bug: index stale หลัง splice
 */
function renderPhotoPreviews(criteriaId) {
  const previewGrid = document.getElementById('photoPreview-' + criteriaId);
  const countBadge  = document.getElementById('photoCount-' + criteriaId);
  if (!previewGrid) return;

  const photos = AppState.auditAnswers[criteriaId]?.photos || [];

  previewGrid.innerHTML = photos.map((photo, i) => `
    <div class="photo-thumb">
      <img src="${photo.preview}" alt="${I18n.t('img.alt_photo')}">
      <button class="remove-photo" onclick="removePhoto('${criteriaId}', ${i})">
        <i class="bi bi-x"></i>
      </button>
    </div>
  `).join('');

  if (countBadge) {
    countBadge.textContent   = photos.length;
    countBadge.style.display = photos.length > 0 ? 'inline' : 'none';
  }
}

function removePhoto(criteriaId, idx) {
  AppState.auditAnswers[criteriaId]?.photos?.splice(idx, 1);
  // Re-render เพื่อ update index ใหม่ทั้งหมด
  renderPhotoPreviews(criteriaId);
}

/**
 * Compress image ก่อน upload
 */
/**
 * Upload รูปไปยัง imgBB (ฟรี, ไม่มี CORS)
 * รับ base64 string → คืน URL ของรูปบน imgBB
 */
async function uploadToImgBB(base64) {
  // ชื่อเดิมเพื่อไม่ต้องแก้ submitAudit() — จริง ๆ อัปโหลดขึ้น Supabase Storage
  try {
    const b64   = base64.replace(/^data:[^;]+;base64,/, '');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const path  = `audit/${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`;
    const { error } = await _sb.storage.from(CONFIG.STORAGE_BUCKET)
      .upload(path, bytes, { contentType:'image/jpeg', upsert:false });
    if (error) { console.error('[storage] upload failed:', error.message); return null; }
    const { data } = _sb.storage.from(CONFIG.STORAGE_BUCKET).getPublicUrl(path);
    console.log('[storage] ✅ uploaded:', data.publicUrl);
    return data.publicUrl;
  } catch(err) {
    console.error('[storage] error:', err.message);
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
  // Guard: ป้องกัน submit เมื่อไม่มี criteria
  if (!AppState.criteria || AppState.criteria.length === 0) {
    UI.toast(I18n.t('msg.no_criteria'), 'error', 5000);
    return;
  }

  const unanswered = getUnansweredCriteria();

  if (unanswered.length > 0) {
    markUnansweredItems(unanswered);
    renderRemainingPanel(unanswered);
    UI.toast(`${I18n.t('audit.unanswered_prefix')} ${unanswered.length} ${I18n.t('audit.answered_suffix')}`, 'warning', 4500);
    jumpToCriteria(unanswered[0].Criteria_ID);
    return;
  }

  const ok = await showConfirm(I18n.t('audit.confirm_title'), I18n.t('audit.confirm_msg'));
  if (!ok) return;

  try {
    // ============================================================
    // STEP 0: Upload รูปภาพทั้งหมดไปยัง imgBB ก่อน
    const totalPhotos = Object.values(AppState.auditAnswers)
      .reduce((sum, a) => sum + (a.photos?.length || 0), 0);

    console.log('[Submit] 📸 จำนวนรูปทั้งหมด:', totalPhotos);

    if (totalPhotos > 0) {
      UI.showLoading(`${I18n.t('msg.uploading')} (0/${totalPhotos})`);
      let uploaded = 0;

      for (const [criteriaId, answer] of Object.entries(AppState.auditAnswers)) {
        for (const photo of (answer.photos || [])) {
          console.log(`[Submit] รูปของ ${criteriaId}: uploaded=${photo.uploaded}, hasPreview=${!!photo.preview}, previewLen=${photo.preview?.length || 0}`);
          if (!photo.uploaded && photo.preview) {
            const url = await uploadToImgBB(photo.preview);
            if (url) {
              photo.url      = url;
              photo.uploaded = true;
              console.log(`[Submit] ✅ รูป ${criteriaId} → ${url}`);
            } else {
              console.warn(`[Submit] ⚠️ Upload รูป ${criteriaId} ล้มเหลว`);
            }
            uploaded++;
            UI.showLoading(`${I18n.t('msg.uploading')} (${uploaded}/${totalPhotos})`);
          }
        }
      }
    } else {
      console.log('[Submit] ℹ️ ไม่มีรูปภาพ — ข้ามขั้นตอน Upload');
    }

    // STEP 1: สร้าง Audit Header → รับ auditId กลับมา
    // ============================================================
    UI.showLoading(I18n.t('msg.loading_step1'));

    const headerRes = await API.get('submitAuditHeader', {
      plantId:    getParam('plantId'),
      areaId:     getParam('areaId'),
      auditorId:  AppState.user?.userId || 'unknown',
      auditDate:  document.getElementById('auditDate')?.value || new Date().toISOString().split('T')[0],
      totalItems: AppState.criteria.length
    });

    if (!headerRes.success) {
      UI.hideLoading();
      UI.toast(headerRes.error || I18n.t('msg.header_failed'), 'error');
      return;
    }

    const auditId = headerRes.auditId;

    // Rollback helper — ลบ header/details ที่ค้าง ถ้า submit ล้มเหลวกลางทาง (atomic)
    const rollbackAudit = async (reason) => {
      console.warn('[Submit] rollback audit', auditId, reason);
      try { await API.get('deleteAudit', { auditId }); }
      catch (e) { console.error('[Submit] rollback failed:', e.message); }
    };

    // ============================================================
    // STEP 2: ส่ง Details เป็น Chunk ทีละ 15 ข้อ
    // แก้ปัญหา URL ยาวเกิน (400 Bad Request)
    // ============================================================
    const details = AppState.criteria.map(c => {
      const a = AppState.auditAnswers[c.Criteria_ID] || {};
      return {
        criteriaId: c.Criteria_ID,
        na:         !!a.na,
        score:      a.na ? 0 : (a.score ?? 0),
        remark:     (a.remark || '').slice(0, 200),
        photoUrl:   (a.photos || []).map(p => p.url).filter(Boolean).join(',')
      };
    });

    const CHUNK_SIZE = 15;
    const totalChunks = Math.ceil(details.length / CHUNK_SIZE);

    for (let i = 0; i < details.length; i += CHUNK_SIZE) {
      const chunk     = details.slice(i, i + CHUNK_SIZE);
      const chunkNum  = Math.floor(i / CHUNK_SIZE) + 1;

      UI.showLoading(`${I18n.t('msg.saving_chunk')} (${chunkNum}/${totalChunks})`);

      const detailRes = await API.get('submitAuditDetails', {
        auditId: auditId,
        details: JSON.stringify(chunk)
      });

      if (!detailRes.success) {
        await rollbackAudit('detail chunk ' + chunkNum + ' failed');
        UI.hideLoading();
        console.error('[Submit] chunk', chunkNum, 'error:', detailRes.error, 'payload:', chunk);
        UI.toast(I18n.t('msg.detail_failed') + chunkNum + (detailRes.error ? ' — ' + detailRes.error : ''), 'error', 8000);
        return;
      }
    }

    // ============================================================
    // STEP 3: Finalize — คำนวณคะแนนรวมและ Update Header
    // ============================================================
    UI.showLoading(I18n.t('msg.loading_step3'));

    const finalRes = await API.get('finalizeAudit', { auditId });

    UI.hideLoading();

    if (finalRes.success) {
      // ถ้ามาจากงานที่มอบหมาย → mark schedule เป็น completed (ไม่ให้ล้มทั้ง flow ถ้าพลาด)
      const scheduleId = getParam('scheduleId');
      if (scheduleId) {
        try { await API.get('completeSchedule', { scheduleId }); }
        catch (e) { console.warn('[Submit] completeSchedule failed:', e.message); }
      }
      logEvent('SUBMIT_AUDIT', `ส่งผลตรวจ ${getParam('areaName') || getParam('areaId') || ''} · ${finalRes.percent}%`, 'audit_headers', finalRes.auditId);
      sessionStorage.setItem('lastAuditResult', JSON.stringify(finalRes));
      navigate('summary.html', { auditId: finalRes.auditId });
    } else {
      await rollbackAudit('finalize failed');
      UI.toast(finalRes.error || I18n.t('msg.finalize_failed'), 'error');
    }

  } catch(err) {
    UI.hideLoading();
    console.error('submitAudit error:', err);
    UI.toast(I18n.t('msg.error_prefix') + err.message, 'error');
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

  // Circle color — ล้าง class เดิมก่อน แล้วค่อย add ใหม่
  const circle = document.getElementById('scoreCircle');
  if (circle) {
    circle.classList.remove('excellent', 'good', 'need-improve');
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

  // areasRes ถูกลบออก — ไม่ได้ใช้ใน history filter (ประหยัด 1 API call)
  const [plantsRes] = await Promise.all([
    API.get('getPlants')
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
  UI.showLoading(I18n.t('msg.loading_history'));
  try {
    const res = await API.get('getHistory', filters);
    UI.hideLoading();

    const container = document.getElementById('historyList');
    if (!container) return;

    if (!res.success || !res.data.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-clipboard-x"></i>
          <p>${I18n.t('msg.no_history')}</p>
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
    UI.toast(I18n.t('msg.history_failed'), 'error');
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

  UI.showLoading(I18n.t('msg.loading_dashboard'));
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
    setEl('dashExcellent2', d.excellent  || 0);  // sync โดยตรง ไม่ต้องใช้ MutationObserver
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

    // Area Ranking — แสดงครบทุกพื้นที่ เพื่อประเมินและหาจุดบกพร่องรายพื้นที่
    renderRanking('areaRanking', d.areaRanking || [], 'areaName', 100);

    // Monthly Trend (simple bar chart)
    renderMonthlyTrend('monthlyChart', d.monthlyTrend || []);

  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.dash_failed'), 'error');
  }
}

function renderRanking(containerId, items, nameField, limit = 10) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<p class="text-muted text-center">${I18n.t('msg.no_data')}</p>`;
    return;
  }

  container.innerHTML = items.slice(0, limit).map((item, idx) => `
    <div class="ranking-item">
      <div class="rank-number rank-${idx+1}">${idx+1}</div>
      <div class="rank-bar-wrap">
        <div class="rank-name">${escHtml(item[nameField] || '-')}</div>
        <div class="rank-bar">
          <div class="rank-bar-fill" style="width:${Math.min(item.avgScore, 100)}%;
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

/** Escape HTML สำหรับ text content */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape สำหรับ HTML attribute (รวม single quote) */
function escAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
/** บันทึกเหตุการณ์ฝั่ง client ลง audit_logs (login/logout/submit ฯลฯ) — เงียบถ้าพลาด */
async function logEvent(action, detail, entity, entityId) {
  try {
    const uid = AppState.user && AppState.user.userId;
    if (!uid) return;
    await _sb.from('audit_logs').insert({
      user_id: uid, action,
      detail: detail || null, entity: entity || null, entity_id: entityId || null
    });
  } catch(e) { console.warn('[log]', e.message); }
}

async function logout() {
  await logEvent('LOGOUT', 'ออกจากระบบ');
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
// USER MANAGEMENT — ทั้งหมดอยู่ใน app.js ป้องกัน conflict
// ============================================================

var _allUsers = []; // ใช้ var + prefix _ ป้องกัน conflict
var _allAreasForAssign = [];
var _selectedAssignedAreas = new Set();

async function initUsers() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  const role = (AppState.user?.role || '').trim().toLowerCase();
  console.log('[Users] role:', role);

  if (role !== 'admin') {
    document.getElementById('userList').innerHTML = `
      <div class="empty-state" style="padding:40px 20px;text-align:center">
        <i class="bi bi-lock" style="font-size:3rem;color:var(--gray-300)"></i>
        <p style="margin-top:12px;font-weight:600">${I18n.t('msg.admin_only')}</p>
        <p style="font-size:0.8rem;color:var(--gray-600)">${I18n.t('msg.your_role')}${AppState.user?.role || '-'}</p>
        <button class="btn btn-outline mt-3" onclick="navigate('home.html')">${I18n.t('msg.go_home')}</button>
      </div>`;
    return;
  }
  await _loadUsers();
}

async function _loadUsers() {
  UI.showLoading(I18n.t('msg.loading_users'));
  try {
    const [res, areaRes] = await Promise.all([
      API.get('getUsers'),
      API.get('getAreas')
    ]);
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || I18n.t('msg.users_failed'), 'error'); return; }
    if (areaRes.success) _allAreasForAssign = areaRes.data || [];
    _allUsers = res.data || [];
    _updateUserStats();
    _renderUsers(_allUsers);
    renderAssignedAreaOptions();
  } catch(e) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.users_failed') + ': ' + e.message, 'error');
  }
}

function _updateUserStats() {
  setEl('countAll',     _allUsers.length);
  setEl('countAdmin',   _allUsers.filter(u => u.Role === 'Admin').length);
  setEl('countAuditor', _allUsers.filter(u => u.Role === 'Auditor').length);
  setEl('countActive',  _allUsers.filter(u => u.Status === 'Active').length);
}

function _renderUsers(users) {
  const el = document.getElementById('userList');
  if (!el) return;
  if (!users.length) {
    el.innerHTML = `<div class="empty-state"><i class="bi bi-people"></i><p>${I18n.t('msg.no_users')}</p></div>`;
    return;
  }
  const roleColor = { Admin:'#1a73e8', Manager:'#9c27b0', 'Area Manager':'#ff6f00', Auditor:'#34a853', Viewer:'#607d8b' };
  const roleIcon  = { Admin:'👑', Manager:'🏢', 'Area Manager':'🗂️', Auditor:'📋', Viewer:'👁️' };
  el.innerHTML = users.map(u => `
    <div class="user-card" onclick="openUserModal('${u.User_ID}')">
      <div class="user-avatar" style="background:${roleColor[u.Role]||'#607d8b'}">
        ${(u.Name||'U')[0].toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:0.9rem">${escHtml(u.Name||'-')}</div>
        <div style="font-size:0.75rem;color:var(--gray-600)">${escHtml(u.Email||'-')}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
          <span class="badge badge-primary">${roleIcon[u.Role]||''} ${u.Role||'-'}</span>
          <span class="badge ${u.Status==='Active'?'badge-excellent':'badge-need-improve'}">
            ${u.Status==='Active'?'✅':'❌'} ${u.Status||'-'}
          </span>
          ${u.Department?`<span class="badge badge-secondary">${escHtml(u.Department)}</span>`:''}
          ${u.Assigned_Areas?`<span class="badge badge-secondary"><i class="bi bi-geo-alt"></i> ${escHtml(u.Assigned_Areas)}</span>`:''}
        </div>
      </div>
      <i class="bi bi-chevron-right text-muted"></i>
    </div>
  `).join('');
}

function filterUsers() {
  const role   = document.getElementById('filterRole')?.value   || '';
  const status = document.getElementById('filterStatus')?.value || '';
  let list = [..._allUsers];
  if (role)   list = list.filter(u => u.Role   === role);
  if (status) list = list.filter(u => u.Status === status);
  _renderUsers(list);
}

function openUserModal(userId) {
  const modal   = document.getElementById('userModal');
  const title   = document.getElementById('modalTitle');
  const errorEl = document.getElementById('formError');
  if (!modal) return;

  document.getElementById('userForm').reset();
  if (errorEl) errorEl.textContent = '';
  document.getElementById('editUserId').value = '';
  document.getElementById('assignedAreasPicker')?.classList.remove('open');
  setAssignedAreasSelection('');
  const searchEl = document.getElementById('assignedAreasSearch');
  if (searchEl) searchEl.value = '';

  const delBtn = document.getElementById('deleteUserBtn');

  if (userId) {
    const u = _allUsers.find(x => x.User_ID === userId);
    if (!u) return;
    title.textContent = I18n.t('modal.edit_user');
    document.getElementById('editUserId').value = u.User_ID;
    document.getElementById('fName').value      = u.Name       || '';
    document.getElementById('fEmail').value     = u.Email      || '';
    document.getElementById('fDept').value      = u.Department || '';
    document.getElementById('fEmpId').value     = u.Employee_ID|| '';
    setAssignedAreasSelection(u.Assigned_Areas || '');
    document.getElementById('fRole').value      = u.Role       || '';
    document.getElementById('fPassword').value  = '';
    const sr = document.querySelector(`input[name="fStatus"][value="${u.Status}"]`);
    if (sr) sr.checked = true;
    // แสดงปุ่มลบเฉพาะตอนแก้ไข และห้ามลบบัญชีตัวเอง
    if (delBtn) delBtn.style.display = (u.User_ID === AppState.user?.userId) ? 'none' : 'block';
  } else {
    title.textContent = I18n.t('modal.add_user');
    const sr = document.querySelector('input[name="fStatus"][value="Active"]');
    if (sr) sr.checked = true;
    if (delBtn) delBtn.style.display = 'none';
  }
  modal.classList.add('show');
}

// ลบผู้ใช้ (ออกจากทั้งแอปและ Google Sheet)
async function deleteUser() {
  const userId = document.getElementById('editUserId').value.trim();
  if (!userId) return;
  const u = _allUsers.find(x => x.User_ID === userId);

  const ok = await showConfirm(
    'ยืนยันการลบผู้ใช้',
    `ต้องการลบ "${u?.Name || userId}" ออกจากระบบและ Google Sheet ถาวรหรือไม่?`
  );
  if (!ok) return;

  try {
    UI.showLoading('กำลังลบผู้ใช้...');
    const res = await API.get('deleteUser', { userId });
    UI.hideLoading();
    if (res.success) {
      UI.toast('ลบผู้ใช้สำเร็จ', 'success');
      closeUserModal();
      _allUsers = _allUsers.filter(x => x.User_ID !== userId);
      _updateUserStats();
      _renderUsers(_allUsers);
    } else {
      UI.toast(res.error || 'ลบไม่สำเร็จ', 'error');
    }
  } catch(err) {
    UI.hideLoading();
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function toggleAssignedAreasDropdown() {
  const picker = document.getElementById('assignedAreasPicker');
  if (!picker) return;
  picker.classList.toggle('open');
  if (picker.classList.contains('open')) renderAssignedAreaOptions(document.getElementById('assignedAreasSearch')?.value || '');
}

function renderAssignedAreaOptions(searchText = '') {
  const list = document.getElementById('assignedAreasList');
  if (!list) return;

  const q = String(searchText || '').toLowerCase().trim();
  const areas = (_allAreasForAssign || []).filter(a => {
    const haystack = `${a.Plant_ID || ''} ${a.Area_ID || ''} ${a.Area_Name || ''} ${a.Area_Type || ''}`.toLowerCase();
    return !q || haystack.includes(q);
  });

  if (!areas.length) {
    list.innerHTML = `<div style="padding:12px;color:var(--gray-600);font-size:0.82rem">ไม่พบพื้นที่</div>`;
    updateAssignedAreasSummary();
    return;
  }

  list.innerHTML = areas.map(a => {
    const id = String(a.Area_ID || '');
    const checked = _selectedAssignedAreas.has(id) ? 'checked' : '';
    return `
      <label class="area-picker-option">
        <input type="checkbox" value="${escAttr(id)}" ${checked} onchange="toggleAssignedArea('${escAttr(id)}', this.checked)">
        <span>
          <span class="area-picker-option-main">${escHtml(a.Plant_ID || '-')} / ${escHtml(a.Area_Name || id)}</span>
          <span class="area-picker-option-sub">${escHtml(id)} • ${escHtml(a.Area_Type || '-')}</span>
        </span>
      </label>
    `;
  }).join('');
  updateAssignedAreasSummary();
}

function toggleAssignedArea(areaId, checked) {
  if (checked) _selectedAssignedAreas.add(areaId);
  else _selectedAssignedAreas.delete(areaId);
  syncAssignedAreasField();
}

function setAssignedAreasSelection(value) {
  _selectedAssignedAreas = new Set(
    String(value || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  );
  syncAssignedAreasField();
  renderAssignedAreaOptions(document.getElementById('assignedAreasSearch')?.value || '');
}

function clearAssignedAreas() {
  _selectedAssignedAreas.clear();
  syncAssignedAreasField();
  renderAssignedAreaOptions(document.getElementById('assignedAreasSearch')?.value || '');
}

function selectAllAssignedAreas() {
  _allAreasForAssign.forEach(a => {
    if (a.Area_ID) _selectedAssignedAreas.add(String(a.Area_ID));
  });
  syncAssignedAreasField();
  renderAssignedAreaOptions(document.getElementById('assignedAreasSearch')?.value || '');
}

function syncAssignedAreasField() {
  const value = Array.from(_selectedAssignedAreas).join(',');
  const input = document.getElementById('fAssignedAreas');
  if (input) input.value = value;
  updateAssignedAreasSummary();
}

function updateAssignedAreasSummary() {
  const summary = document.getElementById('assignedAreasSummary');
  if (!summary) return;

  const count = _selectedAssignedAreas.size;
  if (count === 0) {
    summary.textContent = 'ทุกพื้นที่';
    return;
  }

  const selected = Array.from(_selectedAssignedAreas);
  const firstNames = selected.slice(0, 2).map(id => {
    const area = _allAreasForAssign.find(a => String(a.Area_ID) === id);
    return area ? `${area.Plant_ID}/${area.Area_Name}` : id;
  });
  summary.textContent = count <= 2 ? firstNames.join(', ') : `${firstNames.join(', ')} +${count - 2}`;
}

function closeUserModal() {
  const modal = document.getElementById('userModal');
  if (modal) modal.classList.remove('show');
}

async function saveUserForm(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  const saveBtn = document.getElementById('saveUserBtn');
  if (errorEl) errorEl.textContent = '';

  const userId   = document.getElementById('editUserId').value.trim();
  const name     = document.getElementById('fName').value.trim();
  const email    = document.getElementById('fEmail').value.trim();
  const password = document.getElementById('fPassword').value.trim();
  const dept     = document.getElementById('fDept').value.trim();
  const empId    = document.getElementById('fEmpId').value.trim();
  const assignedAreas = Array.from(_selectedAssignedAreas).join(',');
  const role     = document.getElementById('fRole').value;
  const statusEl = document.querySelector('input[name="fStatus"]:checked');
  const status   = statusEl ? statusEl.value : 'Active';

  if (!name)  { if (errorEl) errorEl.textContent = I18n.t('val.name');     return; }
  if (!email) { if (errorEl) errorEl.textContent = I18n.t('val.email');    return; }
  if (!role)  { if (errorEl) errorEl.textContent = I18n.t('val.role');     return; }
  if (!userId && !password) { if (errorEl) errorEl.textContent = I18n.t('val.password'); return; }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = I18n.t('msg.saving_btn'); }

  try {
    UI.showLoading(I18n.t('msg.loading_saving'));
    // ใช้ API.post เพื่อไม่ให้ password ปรากฏใน URL / browser history
    const res = await API.post('saveUser', {
      userId, employeeId: empId, name, email,
      password, department: dept, role, status, assignedAreas
    });
    UI.hideLoading();

    if (res.success) {
      UI.toast(userId ? I18n.t('msg.save_success_edit') : I18n.t('msg.save_success_add'), 'success');
      closeUserModal();

      // Optimistic update — แก้ local array ทันที ไม่ต้อง fetch ใหม่
      if (userId) {
        const idx = _allUsers.findIndex(u => u.User_ID === userId);
        if (idx >= 0) {
          _allUsers[idx].Name        = name;
          _allUsers[idx].Email       = email;
          _allUsers[idx].Department  = dept;
          _allUsers[idx].Employee_ID = empId;
          _allUsers[idx].Assigned_Areas = assignedAreas;
          _allUsers[idx].Role        = role;
          _allUsers[idx].Status      = status;
        }
      } else {
        _allUsers.push({
          User_ID:     res.userId || '',
          Name:        name,
          Email:       email,
          Department:  dept,
          Employee_ID: empId,
          Assigned_Areas: assignedAreas,
          Role:        role,
          Status:      status,
          Password:    '***'
        });
      }
      _updateUserStats();
      _renderUsers(_allUsers);
    } else {
      if (errorEl) errorEl.textContent = res.error || I18n.t('msg.save_failed');
    }
  } catch(err) {
    UI.hideLoading();
    if (errorEl) errorEl.textContent = I18n.t('msg.error_prefix') + err.message;
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = `<i class="bi bi-check-lg"></i> <span>${I18n.t('form.save')}</span>`; }
}

// ============================================================
// SCHEDULE PAGE — Admin Assignment Board
// ============================================================
let _schedAllAreas = [];
let _schedAuditors = [];
let _schedCurrentArea = null;
let _schedSelectedAuds = new Set();
// redesign state
let _schedPlant    = 'all';
let _schedMode     = 'area';      // 'area' | 'aud'
let _schedFilter   = 'all';       // 'all' | 'unassigned' | 'overdue'
let _schedSearch   = '';
let _schedSelected = new Set();   // Area_IDs ที่ติ๊กเลือก (bulk)
let _schedAudPickSet = new Set(); // ผู้ตรวจที่เลือกในโหมด "ตามคน" (หลายคนได้)
let _bulkAuds      = new Set();   // ผู้ตรวจที่เลือกใน bulk modal (โหมดตามพื้นที่)

async function initSchedule() {
  if (!Session.requireLogin()) return;
  // FIX: อ่าน role จาก AppState.user (Session.load() คืน boolean)
  const user = AppState.user || {};
  if (String(user.role || '').toLowerCase() !== 'admin') {
    UI.toast('เฉพาะ Admin เท่านั้น', 'error');
    navigate('home.html');
    return;
  }
  updateUserUI();

  UI.showLoading('โหลดข้อมูลการมอบหมาย...');
  try {
    const res = await API.get('getScheduleAdmin', {});
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || 'โหลดข้อมูลไม่สำเร็จ', 'error'); return; }

    _schedAllAreas  = res.areas   || [];
    _schedAuditors  = res.auditors || [];
    _schedPlant = 'all'; _schedMode = 'area'; _schedFilter = 'all';
    _schedSearch = ''; _schedSelected.clear(); _schedAudPickSet.clear();

    // สร้าง Plant tabs
    const plants = res.plants || [];
    const tabBar = document.getElementById('plantTabBar');
    if (tabBar && plants.length) {
      const extra = plants.map(p =>
        `<button class="plant-tab-btn" onclick="schedFilterPlant('${escAttr(p.Plant_ID)}',this)">${escHtml(p.Plant_Name || p.Plant_ID)}</button>`
      ).join('');
      tabBar.insertAdjacentHTML('beforeend', extra);
    }

    // วันครบกำหนด default = พรุ่งนี้
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
    const planDate = document.getElementById('planDate');
    if (planDate && !planDate.value) planDate.value = tmr.toISOString().split('T')[0];

    schedRenderAudPick();
    schedRenderGrid();
    schedUpdateBulk();
  } catch(err) {
    UI.hideLoading();
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function schedFilterPlant(plant, btn) {
  document.querySelectorAll('.plant-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _schedPlant = plant;
  _schedSelected.clear();
  schedRenderGrid();
  schedUpdateBulk();
}

function _schedStatus(a) {
  if (!a.Auditor_IDs || !a.Audit_Date) return 'unassigned';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(a.Audit_Date); d.setHours(0,0,0,0);
  if (a.Sched_Status === 'Completed') return 'completed';
  if (d < today) return 'overdue';
  return 'pending';
}

const _schedTypeInfo = {
  Office:      { icon:'bi-briefcase', bg:'rgba(26,115,232,0.1)', color:'var(--primary)' },
  Production:  { icon:'bi-building',  bg:'rgba(52,168,83,0.1)',  color:'var(--secondary)' },
  Warehouse:   { icon:'bi-boxes',     bg:'rgba(249,171,0,0.1)',  color:'var(--warning)' },
  Maintenance: { icon:'bi-tools',     bg:'rgba(234,67,53,0.1)',  color:'var(--danger)' },
  Cafeteria:   { icon:'bi-cup-hot',   bg:'rgba(147,52,230,0.1)', color:'#9334e6' },
  Outdoor:     { icon:'bi-tree',      bg:'rgba(52,168,83,0.1)',  color:'var(--secondary)' },
};

function schedRenderGrid() {
  const base = _schedPlant === 'all'
    ? _schedAllAreas
    : _schedAllAreas.filter(a => a.Plant_ID === _schedPlant);

  // stats จากทั้ง plant (ก่อนกรอง/ค้นหา)
  setEl('statAssigned', base.filter(a => a.Auditor_IDs).length);
  setEl('statPending',  base.filter(a => !a.Auditor_IDs).length);
  setEl('statOverdue',  base.filter(a => _schedStatus(a) === 'overdue').length);
  setEl('statTotal',    base.length);

  const q = _schedSearch.trim().toLowerCase();
  const filtered = base.filter(a => {
    if (_schedFilter === 'unassigned' && a.Auditor_IDs) return false;
    if (_schedFilter === 'overdue' && _schedStatus(a) !== 'overdue') return false;
    if (q && !(a.Area_Name || a.Area_ID || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const statusCfg = {
    pending:    { label:'รอตรวจ',    icon:'bi-clock' },
    completed:  { label:'ตรวจแล้ว', icon:'bi-check-circle-fill' },
    overdue:    { label:'เกินกำหนด',icon:'bi-exclamation-circle' },
    unassigned: { label:'ยังไม่มี', icon:'bi-dash-circle' },
  };

  const grid = document.getElementById('areaGrid');
  if (!grid) return;
  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--gray-500)">
      <i class="bi bi-inbox" style="font-size:2rem;display:block;margin-bottom:8px"></i>ไม่พบพื้นที่
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(area => {
    const st  = _schedStatus(area);
    const sc  = statusCfg[st] || statusCfg.unassigned;
    const ti  = _schedTypeInfo[area.Area_Type] || _schedTypeInfo.Office;
    const typeClass = (area.Area_Type || '').toLowerCase();
    const isSel = _schedSelected.has(area.Area_ID);
    const audIds = area.Auditor_IDs ? area.Auditor_IDs.split(',').map(x => x.trim()).filter(Boolean) : [];

    // เนื้อการ์ดต่างกันตามโหมด
    let body;
    if (_schedMode === 'aud') {
      const already = _schedAudPickSet.size > 0 && [..._schedAudPickSet].every(id => audIds.includes(id));
      body = `
        <div class="card-auditor-chips">
          ${already
            ? `<span class="sched-status-badge completed"><i class="bi bi-person-check"></i>อยู่ในทีมแล้ว</span>`
            : `<span style="font-size:0.7rem;color:var(--gray-500)"><i class="bi bi-people"></i> ${audIds.length} คนตรวจ</span>`}
        </div>`;
    } else {
      const chips = audIds.length
        ? audIds.slice(0,3).map(uid => {
            const u = _schedAuditors.find(x => x.User_ID === uid);
            if (!u) return '';
            const initials = (u.Name || uid).substring(0,2);
            const hue = uid.charCodeAt(uid.length-1) * 7 % 360;
            return `<span class="auditor-mini-chip"><span class="auditor-mini-avatar" style="background:hsl(${hue},55%,45%)">${escHtml(initials)}</span>${escHtml((u.Name||'').split(' ')[0] || uid)}</span>`;
          }).join('') + (audIds.length>3 ? `<span style="font-size:0.66rem;color:var(--gray-600)">+${audIds.length-3}</span>` : '')
        : `<span style="font-size:0.7rem;color:var(--gray-500);display:flex;align-items:center;gap:3px;"><i class="bi bi-person-x"></i>ยังไม่มอบหมาย</span>`;
      const dateStr = area.Audit_Date ? new Date(area.Audit_Date).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
      body = `
        <div class="card-auditor-chips">${chips}</div>
        <div class="card-date-row"><i class="bi bi-calendar3"></i>${dateStr}${area.Audit_Round ? ' · ' + escHtml(area.Audit_Round) : ''}</div>
        <button class="btn-assign-dashed" onclick="event.stopPropagation();openSchedModal('${escAttr(area.Area_ID)}')">
          <i class="bi bi-pencil-square"></i> แก้ไขเดี่ยว
        </button>`;
    }

    return `
      <div class="area-assign-card type-${typeClass}${isSel ? ' sel' : ''}" onclick="schedToggleSelect('${escAttr(area.Area_ID)}')">
        <div class="sched-ck">${isSel ? '<i class="bi bi-check-lg"></i>' : ''}</div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:6px;">
          <div class="area-type-icon" style="background:${ti.bg};color:${ti.color}"><i class="bi ${ti.icon}"></i></div>
          <span class="sched-status-badge ${st}" style="margin-right:26px"><i class="bi ${sc.icon}"></i>${sc.label}</span>
        </div>
        <div class="area-card-name">${escHtml(area.Area_Name || area.Area_ID)}</div>
        <div class="area-card-meta">${escHtml(area.Plant_ID)}</div>
        ${body}
      </div>`;
  }).join('');
}

// ---- selection / mode / filter ----
function schedToggleSelect(areaId) {
  if (_schedSelected.has(areaId)) _schedSelected.delete(areaId);
  else _schedSelected.add(areaId);
  schedRenderGrid();
  schedUpdateBulk();
}

function schedSetMode(m) {
  _schedMode = m;
  _schedSelected.clear();
  document.getElementById('smodeArea')?.classList.toggle('active', m === 'area');
  document.getElementById('smodeAud')?.classList.toggle('active', m === 'aud');
  const audPick = document.getElementById('schedAudPick');
  if (audPick) audPick.style.display = m === 'aud' ? 'flex' : 'none';
  schedRenderAudPick();
  schedRenderGrid();
  schedUpdateBulk();
}

function schedSetFilter(f, btn) {
  _schedFilter = f;
  document.querySelectorAll('.sfchip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  schedRenderGrid();
}

function schedSearchInput(v) {
  _schedSearch = v || '';
  schedRenderGrid();
}

function schedRenderAudPick() {
  const row = document.getElementById('audpickRow');
  if (!row) return;
  row.innerHTML = _schedAuditors.map(u => {
    const first = (u.Name || '').split(' ')[0] || u.User_ID;
    return `<button class="audpill ${_schedAudPickSet.has(u.User_ID) ? 'active' : ''}" onclick="schedPickAuditor('${escAttr(u.User_ID)}')">${escHtml(first)}</button>`;
  }).join('');
}

function schedPickAuditor(uid) {
  if (_schedAudPickSet.has(uid)) _schedAudPickSet.delete(uid);
  else _schedAudPickSet.add(uid);           // เลือกได้หลายคน
  schedRenderAudPick();
  schedRenderGrid();
  schedUpdateBulk();
}

function schedClearSel() {
  _schedSelected.clear();
  schedRenderGrid();
  schedUpdateBulk();
}

function schedUpdateBulk() {
  const n = _schedSelected.size;
  setEl('bulkCount', n);
  const bar = document.getElementById('schedBulk');
  if (bar) bar.classList.toggle('show', n > 0);
  const go = document.getElementById('bulkGo');
  if (go) {
    if (_schedMode === 'aud') {
      const c = _schedAudPickSet.size;
      go.innerHTML = c ? `เพิ่ม ${c} คน →` : 'เลือกผู้ตรวจก่อน';
    } else {
      go.innerHTML = 'มอบหมาย →';
    }
  }
}

function schedBulkGo() {
  if (!_schedSelected.size) return;
  if (_schedMode === 'aud') schedSaveByAuditor();
  else schedOpenBulk();
}

// ---- bulk modal (โหมดตามพื้นที่ = SET) ----
function schedOpenBulk() {
  _bulkAuds = new Set();
  const areas = [..._schedSelected].map(id => _schedAllAreas.find(a => a.Area_ID === id)).filter(Boolean);
  setEl('bulkTitle', `มอบหมาย ${areas.length} พื้นที่`);
  const list = document.getElementById('bulkAreaList');
  if (list) list.innerHTML = areas.map(a =>
    `<span class="bulk-area-chip">${escHtml(a.Area_Name || a.Area_ID)}</span>`).join('');
  schedRenderBulkAudGrid();
  const planDate = document.getElementById('planDate')?.value || '';
  const planRound = document.getElementById('planRound')?.value || 'Round 2';
  const bd = document.getElementById('bulkDate'); if (bd) bd.value = planDate;
  const br = document.getElementById('bulkRound'); if (br) br.value = planRound;
  document.getElementById('bulkModal')?.classList.add('show');
}

function schedRenderBulkAudGrid() {
  const grid = document.getElementById('bulkAuditorGrid');
  if (!grid) return;
  grid.innerHTML = _schedAuditors.map(u => {
    const sel = _bulkAuds.has(u.User_ID);
    const initials = (u.Name || u.User_ID).substring(0,2);
    const hue = u.User_ID.charCodeAt(u.User_ID.length-1) * 7 % 360;
    return `<div class="auditor-select-card ${sel ? 'selected' : ''}" onclick="schedBulkToggleAud('${escAttr(u.User_ID)}')">
      <div class="aud-avatar" style="background:hsl(${hue},55%,45%)">${escHtml(initials)}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-size:0.8rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml((u.Name||'').split(' ')[0] || u.User_ID)}</div>
        <div style="font-size:0.68rem;color:var(--gray-600)">${escHtml(u.Department || u.Role || '')}</div>
      </div>
      <i class="bi bi-check-circle-fill check-icon"></i>
    </div>`;
  }).join('');
}

function schedBulkToggleAud(uid) {
  if (_bulkAuds.has(uid)) _bulkAuds.delete(uid);
  else _bulkAuds.add(uid);
  schedRenderBulkAudGrid();
}

function schedCloseBulk() {
  document.getElementById('bulkModal')?.classList.remove('show');
}

async function schedSaveBulk() {
  const auds = Array.from(_bulkAuds).join(',');
  if (!auds) { UI.toast('เลือกผู้ตรวจอย่างน้อย 1 คน', 'warning'); return; }
  const date  = document.getElementById('bulkDate')?.value || '';
  const round = document.getElementById('bulkRound')?.value || 'Round 2';
  const areas = [..._schedSelected].map(id => _schedAllAreas.find(a => a.Area_ID === id)).filter(Boolean);
  const btn = document.getElementById('bulkSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
  try {
    const results = await Promise.all(areas.map(a =>
      API.post('saveSchedule', {
        areaId:a.Area_ID, plantId:a.Plant_ID, auditDate:date, auditRound:round,
        auditorIds:auds, scheduleId:a.Schedule_ID || ''
      }).then(res => {
        if (res.success) {
          a.Auditor_IDs = auds; a.Audit_Date = date; a.Audit_Round = round;
          a.Schedule_ID = res.scheduleId || a.Schedule_ID; a.Sched_Status = 'Pending';
        }
        return res;
      })
    ));
    const failed = results.filter(r => !r.success).length;
    schedCloseBulk();
    _schedSelected.clear();
    schedRenderGrid();
    schedUpdateBulk();
    if (failed) UI.toast(`บันทึกได้ ${results.length-failed}/${results.length} · ล้มเหลว ${failed}`, 'warning');
    else UI.toast(`มอบหมาย ${results.length} พื้นที่เรียบร้อย ✅`, 'success');
  } catch(err) {
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> บันทึกทั้งหมด'; }
}

// ---- by-auditor (โหมดตามคน = ADD) ----
async function schedSaveByAuditor() {
  const uids = [..._schedAudPickSet];
  if (!uids.length) { UI.toast('เลือกผู้ตรวจอย่างน้อย 1 คน', 'warning'); return; }
  const planDate  = document.getElementById('planDate')?.value || '';
  const planRound = document.getElementById('planRound')?.value || 'Round 2';
  const areas = [..._schedSelected].map(id => _schedAllAreas.find(a => a.Area_ID === id)).filter(Boolean);
  const go = document.getElementById('bulkGo');
  if (go) go.style.pointerEvents = 'none';
  try {
    const results = await Promise.all(areas.map(a => {
      const existing = a.Auditor_IDs ? a.Auditor_IDs.split(',').map(x => x.trim()).filter(Boolean) : [];
      uids.forEach(uid => { if (!existing.includes(uid)) existing.push(uid); });  // ADD ทุกคนที่เลือก (union)
      const auds  = existing.join(',');
      const date  = a.Audit_Date  || planDate;           // คงค่าเดิมถ้ามี
      const round = a.Audit_Round || planRound;
      return API.post('saveSchedule', {
        areaId:a.Area_ID, plantId:a.Plant_ID, auditDate:date, auditRound:round,
        auditorIds:auds, scheduleId:a.Schedule_ID || ''
      }).then(res => {
        if (res.success) {
          a.Auditor_IDs = auds; a.Audit_Date = date; a.Audit_Round = round;
          a.Schedule_ID = res.scheduleId || a.Schedule_ID; a.Sched_Status = 'Pending';
        }
        return res;
      });
    }));
    const failed = results.filter(r => !r.success).length;
    _schedSelected.clear();
    schedRenderGrid();
    schedUpdateBulk();
    if (failed) UI.toast(`บันทึกได้ ${results.length-failed}/${results.length} · ล้มเหลว ${failed}`, 'warning');
    else UI.toast(`เพิ่มผู้ตรวจ ${uids.length} คน ให้ ${results.length} พื้นที่เรียบร้อย ✅`, 'success');
  } catch(err) {
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
  if (go) go.style.pointerEvents = '';
}

function openSchedModal(areaId) {
  _schedCurrentArea = _schedAllAreas.find(a => a.Area_ID === areaId);
  if (!_schedCurrentArea) return;
  const area = _schedCurrentArea;
  _schedSelectedAuds = new Set(
    (area.Auditor_IDs || '').split(',').map(x => x.trim()).filter(Boolean)
  );

  // Area info
  const typeInfo = {
    Office:      { icon:'bi-briefcase',  bg:'rgba(26,115,232,0.1)',  color:'var(--primary)' },
    Production:  { icon:'bi-building',   bg:'rgba(52,168,83,0.1)',   color:'var(--secondary)' },
    Warehouse:   { icon:'bi-boxes',      bg:'rgba(249,171,0,0.1)',   color:'var(--warning)' },
    Maintenance: { icon:'bi-tools',      bg:'rgba(234,67,53,0.1)',   color:'var(--danger)' },
    Cafeteria:   { icon:'bi-cup-hot',    bg:'rgba(147,52,230,0.1)', color:'#9334e6' },
    Outdoor:     { icon:'bi-tree',       bg:'rgba(52,168,83,0.1)',   color:'var(--secondary)' },
  };
  const ti = typeInfo[area.Area_Type] || typeInfo.Office;
  const infoEl = document.getElementById('modalAreaInfo');
  if (infoEl) {
    infoEl.innerHTML = `
      <div class="modal-area-icon" style="background:${ti.bg};color:${ti.color}">
        <i class="bi ${ti.icon}" style="font-size:1.3rem"></i>
      </div>
      <div>
        <div style="font-size:1rem;font-weight:700">${escHtml(area.Area_Name || area.Area_ID)}</div>
        <div style="font-size:0.75rem;color:var(--gray-600);margin-top:2px">${escHtml(area.Plant_ID)} · ${escHtml(area.Area_Type || '')}</div>
      </div>`;
  }

  document.getElementById('modalTitle').textContent = area.Area_Name || area.Area_ID;

  // Date & Round
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  const dateEl = document.getElementById('schedDate');
  if (dateEl) dateEl.value = area.Audit_Date || tmr.toISOString().split('T')[0];
  const roundEl = document.getElementById('schedRound');
  if (roundEl) roundEl.value = area.Audit_Round || 'Round 2';

  // Delete button visibility
  const delRow = document.getElementById('deleteSchedRow');
  if (delRow) delRow.style.display = area.Schedule_ID ? 'block' : 'none';

  schedRenderAuditorGrid();
  document.getElementById('assignModal').classList.add('show');
}

function schedRenderAuditorGrid() {
  const grid = document.getElementById('auditorSelectGrid');
  if (!grid) return;
  grid.innerHTML = _schedAuditors.map(u => {
    const sel = _schedSelectedAuds.has(u.User_ID);
    const initials = (u.Name || u.User_ID).substring(0, 2);
    const hue = u.User_ID.charCodeAt(u.User_ID.length - 1) * 7 % 360;
    return `
      <div class="auditor-select-card ${sel ? 'selected' : ''}" onclick="schedToggleAud('${escAttr(u.User_ID)}')">
        <div class="aud-avatar" style="background:hsl(${hue},55%,45%)">${escHtml(initials)}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:0.8rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escHtml((u.Name || '').split(' ')[0] || u.User_ID)}
          </div>
          <div style="font-size:0.68rem;color:var(--gray-600)">${escHtml(u.Department || u.Role || '')}</div>
        </div>
        <i class="bi bi-check-circle-fill check-icon"></i>
      </div>`;
  }).join('');
}

function schedToggleAud(uid) {
  if (_schedSelectedAuds.has(uid)) _schedSelectedAuds.delete(uid);
  else _schedSelectedAuds.add(uid);
  schedRenderAuditorGrid();
}

async function saveSchedule() {
  const area = _schedCurrentArea;
  if (!area) return;
  const dateVal  = document.getElementById('schedDate')?.value || '';
  const roundVal = document.getElementById('schedRound')?.value || 'Round 2';
  const audIds   = Array.from(_schedSelectedAuds).join(',');

  const btn = document.getElementById('saveSchedBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

  try {
    const res = await API.post('saveSchedule', {
      areaId:     area.Area_ID,
      plantId:    area.Plant_ID,
      auditDate:  dateVal,
      auditRound: roundVal,
      auditorIds: audIds,
      scheduleId: area.Schedule_ID || '',
    });
    if (res.success) {
      // อัปเดต local state
      area.Auditor_IDs = audIds;
      area.Audit_Date  = dateVal;
      area.Audit_Round = roundVal;
      area.Schedule_ID = res.scheduleId || area.Schedule_ID;
      area.Sched_Status = 'Pending';
      closeAssignModal();
      schedRenderGrid();
      UI.toast('บันทึกการมอบหมายเรียบร้อย ✅', 'success');
    } else {
      UI.toast(res.error || 'บันทึกไม่สำเร็จ', 'error');
    }
  } catch(err) {
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> บันทึกการมอบหมาย'; }
}

async function deleteSchedule() {
  const area = _schedCurrentArea;
  if (!area || !area.Schedule_ID) return;
  if (!confirm('ยืนยันยกเลิกตารางตรวจนี้?')) return;

  try {
    const res = await API.get('deleteSchedule', { scheduleId: area.Schedule_ID });
    if (res.success) {
      area.Auditor_IDs = '';
      area.Audit_Date  = null;
      area.Audit_Round = null;
      area.Schedule_ID = null;
      area.Sched_Status = 'unassigned';
      _schedSelected.delete(area.Area_ID);
      closeAssignModal();
      schedRenderGrid();
      schedUpdateBulk();
      UI.toast('ยกเลิกตารางเรียบร้อย', 'success');
    } else {
      UI.toast(res.error || 'ยกเลิกไม่สำเร็จ', 'error');
    }
  } catch(err) {
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function closeAssignModal() {
  const modal = document.getElementById('assignModal');
  if (modal) modal.classList.remove('show');
}

// ============================================================
// CRITERIA PAGE — มาตรฐาน 5ส อ่านอย่างเดียว
// ============================================================
let _criteriaAll = [];
let _criteriaTypeFilter = 'All';

async function initCriteria() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  UI.showLoading('โหลดมาตรฐาน 5ส...');
  try {
    const res = await API.get('getCriteria', { areaType: 'All' });
    UI.hideLoading();
    if (!res.success) { UI.toast('โหลดข้อมูลไม่สำเร็จ', 'error'); return; }

    _criteriaAll = res.data || [];
    criteriaRender();
  } catch(err) {
    UI.hideLoading();
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function setTypeFilter(type, btn) {
  _criteriaTypeFilter = type;
  document.querySelectorAll('.type-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const searchEl = document.getElementById('criteriaSearch');
  criteriaRender(searchEl ? searchEl.value : '');

  const labelEl = document.getElementById('filterLabel');
  if (labelEl) labelEl.textContent = type === 'All' ? 'ทุกประเภทพื้นที่' : 'ประเภท: ' + type;
}

function filterCriteria(q) {
  criteriaRender(q);
}

function criteriaRender(searchQ = '') {
  const q = searchQ.toLowerCase().trim();

  // กรองตาม Area_Type
  let items = _criteriaTypeFilter === 'All'
    ? _criteriaAll
    : _criteriaAll.filter(c => {
        const types = String(c.Area_Type || 'All').split(',').map(t => t.trim());
        return types.includes('All') || types.includes(_criteriaTypeFilter);
      });

  // กรองตาม search
  if (q) {
    items = items.filter(c =>
      (c.Question    || '').toLowerCase().includes(q) ||
      (c.Description || '').toLowerCase().includes(q) ||
      (c.Category    || '').toLowerCase().includes(q) ||
      (c.Criteria_ID || '').toLowerCase().includes(q)
    );
  }

  // จัดกลุ่มตาม Category
  const grouped = {};
  items.forEach(c => {
    const cat = c.Category || 'ทั่วไป';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  setEl('statItems', items.length);
  setEl('statCats',  Object.keys(grouped).length);

  const container = document.getElementById('criteriaContent');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-search">
        <i class="bi bi-search"></i>
        ไม่พบข้อมูลที่ค้นหา
      </div>`;
    return;
  }

  container.innerHTML = Object.entries(grouped).map(([cat, list], idx) => {
    const items = list.map(c => `
      <div class="criteria-item-view">
        <span class="criteria-num">${escHtml(c.Criteria_ID || '')}</span>
        <div class="criteria-text">
          <div class="criteria-question">${escHtml(c.Question || '')}</div>
          ${c.Description ? `<div class="criteria-desc">${escHtml(c.Description)}</div>` : ''}
          ${c.Area_Type && c.Area_Type !== 'All'
            ? `<span class="criteria-type-badge"><i class="bi bi-tag"></i> ${escHtml(c.Area_Type)}</span>`
            : ''}
        </div>
      </div>`).join('');

    return `
      <div class="category-block${idx === 0 ? ' open' : ''}" id="cat-${idx}">
        <div class="category-header" onclick="toggleCategory('cat-${idx}')">
          <div class="category-icon"><i class="bi bi-folder2"></i></div>
          <div class="category-title">${escHtml(cat)}</div>
          <span class="category-count">${list.length} ข้อ</span>
          <i class="bi bi-chevron-down category-chevron"></i>
        </div>
        <div class="criteria-list">${items}</div>
      </div>`;
  }).join('');
}

function toggleCategory(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ============================================================
// ASSIGNMENT ANALYTICS PAGE (ตารางตรวจ)
// ============================================================
async function initAssign() {
  if (!Session.requireLogin()) return;
  updateUserUI();
  UI.showLoading('กำลังโหลด...');
  try {
    const res = await API.get('getAssignmentAnalytics', {});
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || 'โหลดข้อมูลไม่สำเร็จ', 'error'); return; }
    AppState.assignData = res;

    // เติมตัวกรอง รอบ + โรงงาน (เฉพาะที่มีงานมอบหมาย)
    const roundSel = document.getElementById('asgRound');
    if (roundSel) {
      const rounds = [...new Set(res.schedules.map(s => s.Audit_Round).filter(Boolean))].sort();
      roundSel.innerHTML = '<option value="">ทุกรอบ</option>' +
        rounds.map(r => `<option value="${escAttr(r)}">${escHtml(r)}</option>`).join('');
    }
    const plantSel = document.getElementById('asgPlant');
    if (plantSel) {
      const used = new Set(res.schedules.map(s => s.Plant_ID));
      plantSel.innerHTML = '<option value="">ทุกโรงงาน</option>' +
        res.plants.filter(p => used.has(p.Plant_ID))
          .map(p => `<option value="${escAttr(p.Plant_ID)}">${escHtml(p.Plant_Name)}</option>`).join('');
    }
    renderAssign();
  } catch(err) {
    UI.hideLoading();
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function renderAssign() {
  const data = AppState.assignData;
  if (!data) return;
  const roundF = (document.getElementById('asgRound') || {}).value || '';
  const plantF = (document.getElementById('asgPlant') || {}).value || '';

  const rows = data.schedules.filter(s =>
    (!roundF || s.Audit_Round === roundF) && (!plantF || s.Plant_ID === plantF));

  // KPI
  const total   = rows.length;
  const done    = rows.filter(s => s.Completed).length;
  const overdue = rows.filter(s => s.Overdue).length;
  const prog    = total ? Math.round(done * 100 / total) : 0;
  setEl('asgTotal', total); setEl('asgDone', done);
  setEl('asgPending', total - done); setEl('asgOverdue', overdue);
  setEl('asgProgPct', prog + '%');
  const fill = document.getElementById('asgProgFill'); if (fill) fill.style.width = prog + '%';

  // คะแนนที่ให้ ต่อ (ผู้ตรวจ+พื้นที่) เอาล่าสุด + คะแนนเฉลี่ยต่อผู้ตรวจ (ในขอบเขตโรงงาน)
  const scoreLU = {}, scoresByAud = {};
  data.headers.filter(h => !plantF || h.Plant_ID === plantF).forEach(h => {
    const k = h.Auditor_ID + '|' + h.Area_ID;
    if (!scoreLU[k] || (h.Date || '') > (scoreLU[k].date || '')) scoreLU[k] = { pct:h.Percent, date:h.Date };
    (scoresByAud[h.Auditor_ID] = scoresByAud[h.Auditor_ID] || []).push(h.Percent);
  });

  // group schedules ตามผู้ตรวจ (schedule อาจมีหลายคน)
  const byAud = {};
  rows.forEach(s => (s.Auditor_IDs || []).forEach((aid, i) => {
    if (!aid) return;
    (byAud[aid] = byAud[aid] || { id:aid, name:s.Auditor_Names[i] || '—', scheds:[] }).scheds.push(s);
  }));

  const auditors = Object.values(byAud).map(a => {
    const scores = scoresByAud[a.id] || [];
    const avg = scores.length ? Math.round(scores.reduce((x,y)=>x+y,0)/scores.length) : null;
    return { ...a, total:a.scheds.length, done:a.scheds.filter(s=>s.Completed).length,
             prog:a.scheds.length ? Math.round(a.scheds.filter(s=>s.Completed).length*100/a.scheds.length) : 0, avg };
  }).sort((x,y) => (y.avg ?? -1) - (x.avg ?? -1));

  const cont = document.getElementById('asgAuditors');
  const hint = document.getElementById('asgHint');
  if (!cont) return;
  if (!auditors.length) {
    cont.innerHTML = `<p class="text-muted text-center" style="padding:16px 0">ยังไม่มีงานที่มอบหมายในเงื่อนไขนี้</p>`;
    if (hint) hint.style.display = 'none';
    return;
  }
  if (hint) hint.style.display = 'block';

  const cls = p => p==null ? 'muted' : (p>=90 ? 'ok' : p>=75 ? 'warn' : 'danger');
  cont.innerHTML = auditors.map((a, idx) => {
    const detail = a.scheds.map(s => {
      let badge;
      if (s.Completed) {
        const sc = scoreLU[a.id + '|' + s.Area_ID];
        badge = `<span class="asg-badge ok">เสร็จ${sc ? ' · ' + sc.pct + '%' : ''}</span>`;
      } else {
        badge = `<span class="asg-badge ${s.Overdue ? 'danger' : 'warn'}">ค้าง${s.Overdue ? ' · เกินกำหนด' : ''}</span>`;
      }
      const loc = [s.Area_Name, s.Plant_Name, s.Audit_Round].filter(Boolean).join(' · ');
      return `<div class="asg-drow"><span class="asg-da">${escHtml(loc)}</span>${badge}</div>`;
    }).join('');
    return `
      <div class="asg-aud">
        <div class="asg-aud-head" onclick="toggleAssign(${idx})">
          <span class="asg-chev" id="asgchev-${idx}">▸</span>
          <div style="flex:1;min-width:0">
            <div class="asg-aud-name">${escHtml(a.name)}</div>
            <div class="asg-aud-meta">${a.total} พื้นที่ · เสร็จ ${a.done}/${a.total}</div>
          </div>
          <span class="asg-pill ${cls(a.avg)}">${a.avg==null ? '—' : a.avg + '%'}</span>
          <div class="asg-mini"><div style="width:${a.prog}%"></div></div>
        </div>
        <div class="asg-detail" id="asgdet-${idx}">${detail}</div>
      </div>`;
  }).join('');
}

function toggleAssign(idx) {
  const d = document.getElementById('asgdet-' + idx);
  const c = document.getElementById('asgchev-' + idx);
  if (!d) return;
  const open = d.classList.toggle('show');
  if (c) c.classList.toggle('open', open);
}

// ============================================================
// AUDIT LOG PAGE (บันทึกกิจกรรม — admin)
// ============================================================
let _allLogs = [];
let _logFilter = '';

async function initLogs() {
  if (!Session.requireLogin()) return;
  const user = AppState.user || {};
  if (String(user.role || '').toLowerCase() !== 'admin') {
    UI.toast('เฉพาะ Admin เท่านั้น', 'error'); navigate('home.html'); return;
  }
  updateUserUI();
  UI.showLoading('โหลดบันทึกกิจกรรม...');
  try {
    const res = await API.get('getLogs', {});
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || 'โหลดไม่สำเร็จ', 'error'); return; }
    _allLogs = res.data;
    renderLogs();
  } catch(err) {
    UI.hideLoading();
    UI.toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function logFilter(f, btn) {
  _logFilter = f;
  document.querySelectorAll('.lfchip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLogs();
}

function renderLogs() {
  const cont = document.getElementById('logList');
  if (!cont) return;
  const f = _logFilter;
  const rows = _allLogs.filter(l => !f || l.Action === f || l.Entity === f);

  if (!rows.length) {
    cont.innerHTML = `<p class="text-muted text-center" style="padding:24px 0">ไม่มีบันทึกในเงื่อนไขนี้</p>`;
    return;
  }

  const meta = {
    LOGIN:        { icon:'bi-box-arrow-in-right', cls:'ok',   label:'เข้าระบบ' },
    LOGOUT:       { icon:'bi-box-arrow-right',    cls:'muted',label:'ออกระบบ' },
    SUBMIT_AUDIT: { icon:'bi-clipboard-check',    cls:'ok',   label:'ส่งผลตรวจ' },
    INSERT:       { icon:'bi-plus-circle',        cls:'ok',   label:'เพิ่ม' },
    UPDATE:       { icon:'bi-pencil',             cls:'warn', label:'แก้ไข' },
    DELETE:       { icon:'bi-trash3',             cls:'danger',label:'ลบ' },
  };
  const entityTH = { profiles:'ผู้ใช้', schedules:'มอบหมาย', areas:'พื้นที่', criteria:'เกณฑ์', audit_headers:'การตรวจ' };

  cont.innerHTML = rows.map((l, i) => {
    const m = meta[l.Action] || { icon:'bi-dot', cls:'muted', label:l.Action };
    const ent = entityTH[l.Entity] || l.Entity;
    const when = new Date(l.At);
    const timeStr = isNaN(when) ? l.At : when.toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const hasData = l.Old || l.New;
    const sub = [ent, l.Entity_ID].filter(Boolean).join(' · ');
    return `
      <div class="log-item">
        <div class="log-row" ${hasData ? `onclick="toggleLog(${i})"` : ''}>
          <div class="log-ic ${m.cls}"><i class="bi ${m.icon}"></i></div>
          <div class="log-main">
            <div class="log-t1">${escHtml(l.User)} <span class="log-act ${m.cls}">${escHtml(m.label)}</span></div>
            <div class="log-t2">${escHtml(l.Detail || sub || '')}${sub && l.Detail ? ' · ' + escHtml(sub) : ''}</div>
          </div>
          <div class="log-time">${escHtml(timeStr)}${hasData ? ' <i class="bi bi-chevron-down" id="logchev-'+i+'"></i>' : ''}</div>
        </div>
        ${hasData ? `<pre class="log-data" id="logdata-${i}">${escHtml(JSON.stringify({ old:l.Old, new:l.New }, null, 2))}</pre>` : ''}
      </div>`;
  }).join('');
}

function toggleLog(i) {
  const d = document.getElementById('logdata-' + i);
  const c = document.getElementById('logchev-' + i);
  if (!d) return;
  const open = d.classList.toggle('show');
  if (c) c.style.transform = open ? 'rotate(180deg)' : '';
}

// ============================================================
// AUTO-INIT ตาม page ปัจจุบัน
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Apply ภาษาที่เลือกไว้ทุกหน้า
  I18n.apply();

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
    case 'users':              initUsers();     break;
    case 'schedule':           initSchedule();  break;
    case 'criteria':           initCriteria();  break;
    case 'assign':             initAssign();    break;
    case 'logs':               initLogs();      break;
  }
});
