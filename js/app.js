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
// ปิด console.log บน production
//
// เหตุผล: log มีข้อมูลภายใน (role, uuid, ชื่อ, จำนวนแถว) ที่ไม่ควรโชว์
// ให้ใครที่เปิด DevTools บนเครื่องผู้ใช้เห็น
//
// คง console.warn / console.error ไว้ — จำเป็นตอนตามปัญหาจริง
// เปิด log กลับชั่วคราวได้โดยรันใน Console:
//     localStorage.setItem('5s_debug', '1')   แล้ว refresh
//     localStorage.removeItem('5s_debug')     เพื่อปิดกลับ
// ============================================================
(function () {
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let debugOn = false;
  try { debugOn = localStorage.getItem('5s_debug') === '1'; } catch (_) {}
  if (!isLocal && !debugOn) {
    const noop = function () {};
    console.log = noop;
    console.debug = noop;
    console.info = noop;
  }
})();

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
  role:        { admin:'Admin', manager:'Manager', auditor:'Auditor', area_manager:'Area Manager', viewer:'Viewer' },
  status:      { active:'Active', inactive:'Inactive' },
  auditStatus: { excellent:'Excellent', good:'Good', need_improvement:'Need Improvement', pending:'Pending', failed:'Failed' },
};
// reverse: label เดิม → enum (DB)
const REV = {
  role:   { 'Admin':'admin', 'Manager':'manager', 'Auditor':'auditor', 'Area Manager':'area_manager', 'Viewer':'viewer' },
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

  /**
   * @param {string}  plantId   กรองตามโรงงาน
   * @param {string}  areaType  โหมดพื้นที่ส่วนกลาง (cafeteria / maintenance) ข้ามทุก plant
   * @param {boolean} all       true = ไม่ตัด cafeteria/maintenance ออก
   *                            ใช้ในหน้า "ดูผล" เช่น dashboard ที่ต้องเห็นทุกพื้นที่
   *                            (หน้า plant.html ไม่ส่ง → คงพฤติกรรมเดิมที่แยกการ์ดโรงอาหาร/ช่าง)
   */
  async getAreas({ plantId, areaType, all } = {}) {
    let q = _sb.from('areas').select('*').eq('status','active');
    if (plantId)  q = q.eq('plant_id', plantId);
    if (areaType) {
      // โหมดพื้นที่ส่วนกลาง: ดึงตามชนิดพื้นที่ข้ามทุก plant (โรงอาหาร / ช่าง-ยูทิลิตี้)
      q = q.eq('area_type', String(areaType).toLowerCase());
    } else if (plantId && !all) {
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

  /**
   * งานที่มอบหมาย — สถานะเป็น "ของฉัน" ไม่ใช่ของแถว
   *
   * เดิมอ่าน schedules.status ซึ่งเป็นค่าร่วมของทุกคนในแถว → พอคนแรก submit
   * คนที่ 2 เห็นว่า "เสร็จแล้ว" แล้วตรวจไม่ได้ (ส่วน H)
   *
   * ตอนนี้:
   *   Status   = ฉันมี header ที่ finalize แล้วของ schedule นี้ไหม
   *   Audit_ID = header ของฉัน  ← เดิมจับคู่จาก plant+area เอาอันล่าสุดของพื้นที่
   *              ทำให้ปุ่ม "ดูผล" เปิดผลของคนอื่น
   *   Done_N / Required_N = ความก้าวหน้าของทีม (จาก view schedule_progress)
   */
  async getSchedule() {
    const me = (AppState.user && AppState.user.userId) || null;

    const [{ data, error }, { data:prog }, { data:mine }] = await Promise.all([
      _sb.from('schedules').select('*, areas(area_name, area_type), plants(plant_name)'),
      _sb.from('schedule_progress').select('schedule_id, done_n, required_n, is_completed'),
      me ? _sb.from('audit_headers')
             .select('audit_id, schedule_id, locked_at, status')
             .eq('auditor_id', me)
             .not('schedule_id', 'is', null)
         : Promise.resolve({ data: [] }),
    ]);
    if (error) throw error;

    const progBySched = {};
    (prog || []).forEach(p => { progBySched[p.schedule_id] = p; });

    // header ของฉันที่ submit เสร็จแล้ว → เก็บ audit_id ไว้ให้ปุ่ม "ดูผล"
    const myAuditBySched = {};
    (mine || []).forEach(h => {
      if (h.locked_at || h.status !== 'pending') myAuditBySched[h.schedule_id] = h.audit_id;
    });

    return { success:true, data:(data || []).map(s => {
      const p    = progBySched[s.schedule_id] || {};
      const myId = myAuditBySched[s.schedule_id] || '';
      return {
        Schedule_ID:s.schedule_id, Plant_ID:s.plant_id, Area_ID:s.area_id,
        Area_Name:(s.areas && s.areas.area_name) || s.area_id,
        Area_Type:(s.areas && MAP.areaType[s.areas.area_type]) || '',
        Plant_Name:(s.plants && s.plants.plant_name) || s.plant_id,
        Auditor_ID:(s.auditor_ids||[]).join(','),
        Audit_Date:s.audit_date, Audit_Round:s.audit_round,
        Status:   myId ? 'Completed' : 'Pending',   // ← ของฉัน
        Audit_ID: myId,                             // ← ของฉัน
        Done_N:     Number(p.done_n)     || 0,
        Required_N: Number(p.required_n) || 0,
        Team_Done:  !!p.is_completed,
      };
    }) };
  },

  // completeSchedule() ถูกลบแล้ว (ส่วน H)
  //
  // เดิม: client เรียก RPC mark_schedule_done() หลัง submit เพื่อปิดงาน
  //   → ปิดทั้งแถว ทำให้คนที่ 2 ในทีมตรวจไม่ได้
  //   → ถ้า RPC ล้มจะพังเงียบ ๆ (มีแค่ console.warn ซึ่งถูกปิดบน production)
  //
  // ตอนนี้: trigger trg_sync_sched_status ทำให้เอง ฝั่ง client ไม่ต้องเรียกอะไร
  //   → ลืมไม่ได้ ปลอมไม่ได้ ล้มเงียบไม่ได้

  /**
   * ข้อมูลสำหรับหน้า "ตารางตรวจ"
   *
   * ขอบเขตข้อมูล:
   *   • schedules   → RLS `schedules_select` จำกัดให้เอง (auditor เห็นเฉพาะที่ตัวเองถูกมอบหมาย)
   *   • audit_headers → RLS `headers_select` เปิดให้ทุกคนที่ล็อกอิน (เจตนา: KPI ภาพรวมบริษัท
   *     ที่หน้า home/dashboard) → **ต้องกรองเองที่นี่** ไม่งั้น auditor เห็นคะแนนคนอื่น
   *
   * ⚠️ การกรองนี้เป็นระดับ UI ไม่ใช่ security control
   *    auditor ที่รู้เทคนิคยังเรียก _sb.from('audit_headers').select('*') เห็นได้
   *    ถ้าต้องการบังคับจริง ต้องแก้ RLS + ทำ view สำหรับ KPI รวม (ดู work log 4 ส.ค.)
   */
  async getAssignmentAnalytics() {
    const prof0 = await _currentProfile();
    const isStaff = !!(prof0 && prof0.role === 'admin');

    // แยก 2 query ตามข้อมูลที่ต้องใช้ (ส่วน H)
    //   1. schedule_progress → "ใครเสร็จ / ใครค้าง"  ไม่มีคอลัมน์ percent อยู่ในนั้นเลย
    //   2. audit_headers     → ตัวเลข %  จำกัดขอบเขตที่ query ไม่ใช่กรองใน JS
    //
    // เดิมดึง percent ของทุกคนมาแล้วค่อย .filter() ใน JS → % ของคนอื่นถึง browser
    // ไปแล้วก่อนกรอง เปิด DevTools ก็เห็น · ตอนนี้ไม่ส่งมาเลย
    let hq = _sb.from('audit_headers')
      .select('auditor_id, schedule_id, plant_id, area_id, percent, audit_date, audit_round')
      .neq('status','pending');
    if (!isStaff && prof0) hq = hq.eq('auditor_id', prof0.id);

    const [{ data:scheds }, { data:prog }, { data:hdrs }, { data:profs }, { data:plants }] =
      await Promise.all([
        _sb.from('schedules').select('*, areas(area_name, area_type), plants(plant_name)'),
        _sb.from('schedule_progress').select('schedule_id, required_ids, done_ids, required_n, done_n, is_completed'),
        hq,
        _sb.from('profiles').select('id, name, status'),
        _sb.from('plants').select('plant_id, plant_name').eq('status','active').order('plant_id'),
      ]);

    const nameById = {}; (profs||[]).forEach(p => { nameById[p.id] = p.name; });
    const progBySched = {}; (prog||[]).forEach(p => { progBySched[p.schedule_id] = p; });
    const today = new Date().toISOString().slice(0,10);

    const schedules = (scheds||[]).map(s => {
      const p        = progBySched[s.schedule_id] || {};
      const required = p.required_ids || [];      // มอบหมาย ∩ active (คนที่ถูกระงับไม่นับ)
      const doneSet  = new Set(p.done_ids || []);
      return {
        Schedule_ID: s.schedule_id,
        Plant_ID:    s.plant_id,
        Plant_Name:  (s.plants && s.plants.plant_name) || s.plant_id,
        Area_ID:     s.area_id,
        Area_Name:   (s.areas && s.areas.area_name) || s.area_id,
        Area_Type:   (s.areas && MAP.areaType[s.areas.area_type]) || '',
        Auditor_IDs:   s.auditor_ids || [],
        Auditor_Names: (s.auditor_ids||[]).map(id => nameById[id] || '—'),
        // รายคน — หน่วยนับใหม่คือ "ช่องงาน" (พื้นที่ × ผู้ตรวจ 1 คน)
        Required_IDs: required,
        Slots: required.map(id => ({
          Auditor_ID: id,
          Name:       nameById[id] || '—',
          Done:       doneSet.has(id),
        })),
        Required_N: Number(p.required_n) || 0,
        Done_N:     Number(p.done_n)     || 0,
        Audit_Round: s.audit_round || '',
        Audit_Date:  s.audit_date,
        Completed:   !!p.is_completed,                                   // ทีมเสร็จครบ
        Overdue:     !p.is_completed && s.audit_date && s.audit_date < today,
      };
    });

    const headers = (hdrs||[]).map(h => ({
      Auditor_ID:h.auditor_id, Schedule_ID:h.schedule_id,
      Plant_ID:h.plant_id, Area_ID:h.area_id,
      Percent:Number(h.percent)||0, Date:h.audit_date, Round:h.audit_round || ''
    }));

    return { success:true, schedules, headers, isStaff,
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

  /** รีเซ็ตข้อมูล (admin) — เรียก RPC ที่เช็คสิทธิ์ + สำรอง + ลบ ฝั่ง DB */
  /**
   * ลบรูปทั้ง bucket ผ่าน Storage API
   *
   * ⚠️ ทำที่ client ไม่ใช่ใน SQL — Supabase บล็อก `delete from storage.objects` แล้ว
   *    (Direct deletion from storage tables is not allowed. Use the Storage API instead.)
   *    ถ้าใส่ใน admin_reset_data() จะ raise แล้ว rollback ทั้ง transaction
   *
   * เดินทีละโฟลเดอร์เพราะ list() คืนไฟล์เฉพาะชั้นเดียว (path จริงคือ audit/xxx.jpg)
   */
  async purgeAuditPhotos() {
    const B = CONFIG.STORAGE_BUCKET;
    let removed = 0, failed = 0;

    const walk = async (prefix) => {
      const { data:items, error } = await _sb.storage.from(B)
        .list(prefix, { limit: 1000, sortBy: { column:'name', order:'asc' } });
      if (error) { failed++; return; }

      const files = [], dirs = [];
      (items || []).forEach(it => {
        // โฟลเดอร์ไม่มี metadata / id
        if (it.id === null || it.metadata == null) dirs.push(it.name);
        else files.push(prefix ? `${prefix}/${it.name}` : it.name);
      });

      // ลบเป็นชุดละ 100 กัน payload ใหญ่เกิน
      for (let i = 0; i < files.length; i += 100) {
        const chunk = files.slice(i, i + 100);
        const { error: rmErr } = await _sb.storage.from(B).remove(chunk);
        if (rmErr) failed += chunk.length; else removed += chunk.length;
      }
      for (const d of dirs) await walk(prefix ? `${prefix}/${d}` : d);
    };

    await walk('');
    return { removed, failed };
  },

  async resetData() {
    // 1) ลบรูปก่อน (ผ่าน Storage API) — ถ้าล้มก็ยังรีเซ็ต DB ต่อได้ แค่รายงานจำนวน
    let photos = { removed: 0, failed: 0 };
    try { photos = await SBH.purgeAuditPhotos(); } catch(_) {}

    // 2) รีเซ็ตตารางใน DB (สำรองลง *_backup ให้เอง)
    const { data, error } = await _sb.rpc('admin_reset_data');
    if (error) return { success:false, error:error.message, photos };
    return { success:true, ...(data || {}), photos };
  },

  // ---- History / detail ----
  async getHistory({ plantId, month, year } = {}) {
    // ตัด audit ที่ยังไม่สมบูรณ์/N-A ทั้งหมด (status=pending) ให้สอดคล้องกับ dashboard
    let q = _sb.from('audit_headers').select('*, profiles(name)').neq('status','pending');
    if (plantId) q = q.eq('plant_id', plantId);
    const range = _monthRange(month, year);
    if (range) q = q.gte('audit_date', range[0]).lt('audit_date', range[1]);
    const { data, error } = await q.order('audit_date', { ascending:false });
    if (error) throw error;
    const mapped = (data||[]).map(h => { const m = mapHeader(h); m.Auditor_ID = (h.profiles && h.profiles.name) || h.auditor_id; return m; });
    return { success:true, data:mapped, total:mapped.length };
  },

  /**
   * เฉพาะโรงงาน/พื้นที่ที่ "มีผลตรวจจริง" — ใช้ใน dashboard
   * ต่างจาก getAreas() 2 อย่าง:
   *   1. ไม่มีทางตัน — เลือกแล้วต้องมีข้อมูลให้ดูเสมอ
   *   2. รวมพื้นที่ที่ตั้ง inactive ไปแล้วแต่มีประวัติการตรวจ (ดูผลเก่าได้)
   */
  async getAuditedAreas() {
    const [{ data:heads, error }, { data:areas }, { data:plants }] = await Promise.all([
      _sb.from('audit_headers').select('area_id, plant_id').neq('status','pending'),
      _sb.from('areas').select('area_id, area_name, plant_id, area_type, status'),
      _sb.from('plants').select('plant_id, plant_name'),
    ]);
    if (error) return { success:false, error:error.message };

    const H = heads || [];
    // นับจำนวนครั้งที่ตรวจต่อพื้นที่ + จำ plant_id จาก header (เผื่อพื้นที่ถูกลบจากตาราง areas)
    const cnt = {}, pidFromHead = {};
    H.forEach(h => {
      cnt[h.area_id] = (cnt[h.area_id] || 0) + 1;
      if (!pidFromHead[h.area_id]) pidFromHead[h.area_id] = h.plant_id;
    });

    const areaById  = {}; (areas  || []).forEach(a => { areaById[a.area_id] = a; });
    const plantName = {}; (plants || []).forEach(p => { plantName[p.plant_id] = p.plant_name; });

    const list = Object.keys(cnt).map(aid => {
      const a   = areaById[aid];
      const pid = (a && a.plant_id) || pidFromHead[aid] || '';
      return {
        Area_ID:    aid,
        Area_Name:  (a && a.area_name) || aid,
        Plant_ID:   pid,
        Plant_Name: plantName[pid] || pid || '-',
        Area_Type:  a ? (MAP.areaType[a.area_type] || a.area_type) : null,
        Inactive:   a ? a.status !== 'active' : true,   // ไม่พบใน areas = ถือว่าเลิกใช้
        Audits:     cnt[aid],
      };
    }).sort((x, y) => (x.Plant_Name || '').localeCompare(y.Plant_Name || '', 'th')
                   || (x.Area_Name  || '').localeCompare(y.Area_Name  || '', 'th'));

    // โรงงานที่มีข้อมูลจริงเท่านั้น (เรียงชื่อ)
    const seen = new Set(), plantList = [];
    list.forEach(r => {
      if (r.Plant_ID && !seen.has(r.Plant_ID)) {
        seen.add(r.Plant_ID);
        plantList.push({ Plant_ID:r.Plant_ID, Plant_Name:r.Plant_Name });
      }
    });

    return { success:true, areas:list, plants:plantList };
  },

  /**
   * รายการตรวจของพื้นที่หนึ่ง เรียงวันใหม่→เก่า
   * ใช้ในการ์ด "พื้นที่ต้องปรับปรุง" (dashboard) เพื่อให้เลือกครั้งที่ตรวจได้
   */
  async getAreaAudits({ areaId }) {
    if (!areaId) return { success:true, data:[] };
    const { data, error } = await _sb.from('audit_headers')
      .select('audit_id, audit_date, percent, total_score, max_score, status, profiles(name)')
      .eq('area_id', areaId).neq('status','pending')
      .order('audit_date', { ascending:false }).limit(50);
    if (error) return { success:false, error:error.message };
    return { success:true, data:(data||[]).map(h => ({
      Audit_ID:   h.audit_id,
      Audit_Date: h.audit_date,
      Percent:    Number(h.percent) || 0,
      Total_Score:h.total_score,
      Max_Score:  h.max_score,
      Status:     MAP.auditStatus[h.status] || h.status,
      Auditor:    (h.profiles && h.profiles.name) || '-',
    })) };
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

  /**
   * ข้อมูล Dashboard
   *
   * @param {string} round  กรองตามรอบการตรวจ ('' = ทุกรอบ)
   *
   * 🔑 เปลี่ยนวิธีเฉลี่ยเป็น "รายคน" (ส่วน H — ตัดสินใจ 5 ส.ค. 2026)
   *
   *   เดิม pooled: Σ total_score / Σ max_score
   *     → `na` (ไม่มีในพื้นที่) ทำให้ max_score ของแต่ละคนไม่เท่ากัน
   *       คนที่กด NA น้อยกว่าจึงมีน้ำหนักในค่าเฉลี่ยมากกว่า
   *     ตัวอย่าง พื้นที่ A: อ้น 90% (เต็ม 100) · สมชาย 80% (เต็ม 50)
   *       pooled     = (90+40)/150 = 86.7%   ← อ้นมีน้ำหนัก 2 เท่า
   *       เฉลี่ยรายคน= (90+80)/2   = 85%     ← ทุกคนเท่ากัน  ✓ ใช้อันนี้
   *
   *   เจตนา: "คะแนนพื้นที่ = เฉลี่ยจากผลตรวจของ auditor ทุกคนที่รับมอบหมาย"
   *          ทุกความเห็นน้ำหนักเท่ากัน
   */
  async getDashboard({ round } = {}) {
    let hq = _sb.from('audit_headers').select('*').neq('status','pending');
    if (round) hq = hq.eq('audit_round', round);

    const [{ data:headers }, { data:areas }, { data:plants }, { data:allRounds }] =
      await Promise.all([
        hq,
        _sb.from('areas').select('area_id,area_name,plant_id'),
        _sb.from('plants').select('plant_id,plant_name'),
        // รายการรอบทั้งหมดสำหรับ dropdown — ดึงแยกไม่ให้ถูก filter ตัดตัวเลือกทิ้ง
        _sb.from('audit_headers').select('audit_round').neq('status','pending')
           .not('audit_round','is',null),
      ]);

    const H = headers || [];
    const pct = h => Number(h.percent) || 0;
    const tot = h => Number(h.total_score) || 0;
    const mx  = h => Number(h.max_score)   || 0;
    const totalAudit = H.length;

    // ค่าเฉลี่ยรายคน (mean of percent) — ทุกผลตรวจน้ำหนักเท่ากัน
    const meanPct = arr => arr.length
      ? arr.reduce((s,v)=>s+v, 0) / arr.length : 0;
    const avgRaw   = meanPct(H.map(pct));
    const avgScore = Math.round(avgRaw);

    const passRate = totalAudit ? Math.round(H.filter(h=>pct(h)>=75).length*100/totalAudit) : 0;
    const excellent = H.filter(h=>pct(h)>=90).length;
    const good = H.filter(h=>pct(h)>=75 && pct(h)<90).length;
    const needImprovement = H.filter(h=>pct(h)<75).length;

    const areaName  = {}; (areas||[]).forEach(a=>areaName[a.area_id]=a.area_name);
    const areaPlant = {}; (areas||[]).forEach(a=>areaPlant[a.area_id]=a.plant_id);
    const plantName = {}; (plants||[]).forEach(p=>plantName[p.plant_id]=p.plant_name);

    /**
     * @param keyFn    คีย์จัดกลุ่ม
     * @param labelFn  ป้ายที่แสดง
     * @param label    ชื่อ field ที่ส่งกลับ
     *
     * n = จำนวนผลตรวจในกลุ่ม — ranking จาก 1 ครั้ง กับ 10 ครั้งเชื่อถือได้ไม่เท่ากัน
     * avgScoreRaw = ค่าไม่ปัดเศษ ใช้ตัดสินแถบสี (กัน .5 ข้ามแถบ) และใช้ sort
     */
    const avgBy = (keyFn, labelFn, label) => {
      const g = {};
      H.forEach(h => { const k = keyFn(h); (g[k] = g[k] || []).push(pct(h)); });
      return Object.entries(g).map(([k, arr]) => {
        const raw = meanPct(arr);
        return { [label]:labelFn(k), avgScore:Math.round(raw), avgScoreRaw:raw, n:arr.length };
      }).sort((a,b) => b.avgScoreRaw - a.avgScoreRaw);
    };

    const plantComparison = avgBy(h => h.plant_id, k => plantName[k] || k, 'plantName');

    // จัดกลุ่มด้วย plant + area  (area_id มี prefix โรงงานอยู่แล้ว เช่น SUP-WH-F1
    // จึงไม่ชนกันข้ามโรงงาน — แต่ "ชื่อ" ซ้ำ เช่น "Warehouse F1" มีทั้ง 3 โรงงาน
    // ถ้าไม่ใส่ชื่อโรงงานในป้าย ranking จะมี 3 แถวชื่อเหมือนกันแยกไม่ออก)
    const areaRanking = avgBy(
      h => h.area_id,
      k => {
        const pid = areaPlant[k] || String(k).split('-')[0];
        const pn  = plantName[pid] || pid;
        return `${pn} · ${areaName[k] || k}`;
      },
      'areaName'
    );

    // แนวโน้มรายเดือน — เฉลี่ยรายคนเช่นกัน
    const mg = {};
    H.forEach(h => {
      const mth = String(h.audit_date||'').slice(0,7);
      if (mth) (mg[mth] = mg[mth] || []).push(pct(h));
    });
    const monthlyTrend = Object.entries(mg).sort().slice(-6).map(([month, arr]) => {
      const raw = meanPct(arr);
      return { month, avgScore:Math.round(raw), avgScoreRaw:raw };
    });

    const rounds = [...new Set((allRounds||[]).map(r => r.audit_round).filter(Boolean))].sort();

    return { success:true, data:{
      totalAudit, avgScore, avgScoreRaw:avgRaw, passRate, excellent, good, needImprovement,
      plantComparison, areaRanking, monthlyTrend, rounds, round: round || '',
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

  /**
   * ระงับ / เปิดใช้งานผู้ใช้  (แทนการลบ)
   *
   * ทำไมไม่ลบ — ลบผ่านแอปไม่ได้จริง:
   *   • audit_logs.user_id และ audit_headers.auditor_id อ้าง profiles(id)
   *     แบบไม่มี `on delete` → Postgres บล็อก
   *     ทุกคนที่เคย login มีแถวใน audit_logs (logEvent 'LOGIN') จึงติดแทบทุกคน
   *   • ถ้าลบได้ก็ลบแค่ profiles ไม่ลบ auth.users → อีเมลยังถูกจอง
   *     คนนั้น login ผ่าน auth ได้แต่เจอ "ไม่พบโปรไฟล์"
   *   • ระบบ audit: ลบคนออกทำให้ผลตรวจเก่าไม่มีเจ้าของ = เสีย audit trail
   *
   * ลบถาวรจริงทำที่ Supabase — ขั้นตอนอยู่ใน supabase/delete_user.sql
   *
   * @param {string} userId
   * @param {'active'|'inactive'} status
   */
  async setUserStatus({ userId, status }) {
    const next = status === 'inactive' ? 'inactive' : 'active';
    if (userId === (AppState.user && AppState.user.userId)) {
      return { success:false, error:I18n.t('err.self_suspend') };
    }

    // กันระงับ admin ที่ active คนสุดท้าย → ไม่มีใครเข้าจัดการระบบได้เลย
    if (next === 'inactive') {
      const { data:target } = await _sb.from('profiles')
        .select('role,status').eq('id', userId).single();
      if (target && target.role === 'admin' && target.status === 'active') {
        const { data:admins } = await _sb.from('profiles')
          .select('id').eq('role','admin').eq('status','active');
        if ((admins || []).length <= 1) return { success:false, error:I18n.t('err.last_admin') };
      }
    }

    const { error } = await _sb.from('profiles')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) return { success:false, error:error.message };
    return { success:true, status:next };
  },

  // ---- Schedule (admin) ----
  async getScheduleAdmin() {
    const [{ data:areas }, { data:scheds }, { data:prog }, { data:auditors }, { data:plants }] =
      await Promise.all([
        _sb.from('areas').select('*').eq('status','active').order('area_id'),
        _sb.from('schedules').select('*'),
        _sb.from('schedule_progress').select('schedule_id, required_n, done_n, is_completed'),
        _sb.from('profiles').select('*').eq('status','active').order('name'),
        _sb.from('plants').select('*').eq('status','active'),
      ]);

    // ⚠️ ข้อจำกัดที่ยังไม่แก้ (D2 — งานถัดไป): 1 พื้นที่เก็บได้แค่ 1 งาน
    //    ถ้ามอบหมายพื้นที่เดียวกันซ้อน 2 รอบ แถวหลังจะทับแถวหน้าในกระดานนี้
    //    → ระหว่างนี้: ปิดรอบเดิมให้ครบก่อนแล้วค่อยมอบหมายรอบใหม่
    //    (Dashboard/ตารางตรวจไม่กระทบ เพราะอ่านจาก audit_headers ที่มี audit_round)
    const byArea = {}; (scheds||[]).forEach(s => { byArea[s.area_id] = s; });
    const progBySched = {}; (prog||[]).forEach(p => { progBySched[p.schedule_id] = p; });

    const areaRows = (areas||[]).map(a => {
      const s = byArea[a.area_id];
      const p = s ? (progBySched[s.schedule_id] || {}) : {};
      const doneN = Number(p.done_n) || 0, reqN = Number(p.required_n) || 0;
      return {
        Area_ID:a.area_id, Plant_ID:a.plant_id, Area_Name:a.area_name, Area_Type:MAP.areaType[a.area_type]||a.area_type,
        Auditor_IDs: s ? (s.auditor_ids||[]).join(',') : '',
        Audit_Date: s ? s.audit_date : null, Audit_Round: s ? s.audit_round : null,
        Schedule_ID: s ? s.schedule_id : null,
        // สถานะรายคน: ยังไม่มีใครตรวจ / บางส่วน / ครบ
        Done_N: doneN, Required_N: reqN,
        Sched_Status: !s ? null
                    : p.is_completed        ? 'Completed'
                    : doneN > 0             ? 'Partial'
                    : 'Pending',
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
  /**
   * เคยตรวจงานที่มอบหมายนี้ไปแล้วหรือยัง — ใช้กันตรวจซ้ำ "ก่อน" เข้าหน้ากรอก
   * นับเฉพาะที่ submit เสร็จ (locked_at หรือ status<>pending)
   * header ค้างที่ยังไม่ finalize ไม่นับ → ยังตรวจใหม่ได้
   */
  async hasAuditedSchedule({ scheduleId, auditorId }) {
    if (!scheduleId || !auditorId) return { success:true, audited:false };
    const { data, error } = await _sb.from('audit_headers')
      .select('audit_id, locked_at, status')
      .eq('schedule_id', scheduleId).eq('auditor_id', auditorId);
    // เช็กไม่ได้ → ปล่อยผ่าน (unique index กันตอน submit อยู่แล้ว) ไม่บล็อกการทำงาน
    if (error) return { success:true, audited:false };
    const done = (data || []).find(h => h.locked_at || h.status !== 'pending');
    return { success:true, audited:!!done, auditId:done ? done.audit_id : '' };
  },

  /**
   * สร้าง header ของผลตรวจ
   *
   * scheduleId → ผูกผลตรวจกับงานที่มอบหมาย (ส่วน H)
   *   • trigger chk_header_schedule ตรวจว่าผู้ตรวจอยู่ในรายชื่อที่มอบหมายจริง
   *     และก๊อป audit_round มาเก็บให้เอง (ห้ามส่งจาก client — ปลอมได้)
   *   • unique (schedule_id, auditor_id) กันตรวจซ้ำงานเดียว
   *
   * ⚠️ ล้าง header ค้างของตัวเองก่อน (self-heal)
   *    flow การ submit คือ: insert header → ส่ง details เป็นชุด → finalize
   *    ถ้าเน็ตหลุดกลางทางและ rollback ไม่สำเร็จ จะเหลือ header ที่ยัง pending ค้างอยู่
   *    unique index จะบล็อกการตรวจใหม่ → auditor ตันสนิท
   *    จึงลบ header ที่ยังไม่ finalize (locked_at is null + pending) ของตัวเองทิ้งก่อน
   *    RLS headers_delete อนุญาตเจ้าของลบได้เมื่อ locked_at is null
   */
  async submitAuditHeader(p) {
    if (p.scheduleId) {
      const { error: cleanErr } = await _sb.from('audit_headers')
        .delete()
        .eq('schedule_id', p.scheduleId)
        .eq('auditor_id', p.auditorId)
        .is('locked_at', null)
        .eq('status', 'pending');
      if (cleanErr) console.warn('[submit] ล้าง header ค้างไม่สำเร็จ:', cleanErr.message);
    }

    const { data, error } = await _sb.from('audit_headers')
      .insert({
        plant_id:    p.plantId,
        area_id:     p.areaId,
        auditor_id:  p.auditorId,
        audit_date:  p.auditDate,
        schedule_id: p.scheduleId || null,
      })
      .select('audit_id').single();

    if (error) {
      // 23505 = unique_violation → ตรวจงานนี้ไปแล้ว (ผลเดิม finalize แล้ว ลบทิ้งไม่ได้)
      if (error.code === '23505') return { success:false, error:I18n.t('err.already_audited') };
      return { success:false, error:error.message };
    }
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

  /**
   * ปิดงานตรวจ — อ่านคะแนนที่ trigger คำนวณไว้ แล้ว "ล็อก" ไม่ให้แก้ย้อนหลัง
   *
   * 🔒 locked_at: หลังตั้งค่าแล้ว auditor แก้ไม่ได้อีก (RLS headers_update + trigger
   *    trg_chk_locked บน audit_details) · admin แก้ได้ตลอด
   *    ดู patches.sql ส่วน G2
   *
   * ⚠️ ต้องล็อก "หลัง" อ่านคะแนนเสร็จ — ถ้าล็อกก่อน trigger recalc ทำงานไม่ได้
   *    การล็อกล้มไม่ทำให้ submit ล้ม (ผลตรวจบันทึกแล้ว) แค่รายงานว่าล็อกไม่สำเร็จ
   */
  async finalizeAudit({ auditId }) {
    const { data, error } = await _sb.from('audit_headers').select('*').eq('audit_id', auditId).single();
    if (error) return { success:false, error:error.message };

    let locked = false;
    if (!data.locked_at) {
      const { error: lockErr } = await _sb.from('audit_headers')
        .update({ locked_at: new Date().toISOString() }).eq('audit_id', auditId);
      if (lockErr) console.warn('[finalize] ล็อกผลตรวจไม่สำเร็จ:', lockErr.message);
      else locked = true;
    } else {
      locked = true;
    }

    return { success:true, auditId, locked,
      totalScore:data.total_score, maxScore:data.max_score,
      percent:Number(data.percent), status:MAP.auditStatus[data.status]||data.status };
  },

  /**
   * ลบผลตรวจ 1 ใบ
   *
   * ใช้ 2 ทาง:
   *   1. rollback ตอน submit ล้มกลางทาง (header ยัง locked_at is null → เจ้าของลบได้)
   *   2. admin ลบผลที่ล็อกแล้ว (RLS headers_delete เปิดให้ role=admin — ส่วน G2)
   *
   * audit_details หายเองจาก `on delete cascade`
   * แต่ **รูปใน Storage ไม่หายตาม** → ต้องเก็บ path ก่อนลบแถว ไม่งั้นเหลือไฟล์กำพร้า
   * (บทเรียนเดียวกับ admin_reset_data ที่ต้องย้ายการลบรูปมาทำฝั่ง client)
   */
  async deleteAudit({ auditId, purgePhotos } = {}) {
    let paths = [];

    if (purgePhotos) {
      // อ่าน URL รูปก่อน — หลังลบแถวแล้วจะหาไม่ได้อีก
      const { data:dets } = await _sb.from('audit_details')
        .select('photo_urls').eq('audit_id', auditId);
      const prefix = `/storage/v1/object/public/${CONFIG.STORAGE_BUCKET}/`;
      (dets || []).forEach(d => (d.photo_urls || []).forEach(u => {
        const i = String(u).indexOf(prefix);
        if (i >= 0) paths.push(String(u).slice(i + prefix.length).split('?')[0]);
      }));
    }

    const { error } = await _sb.from('audit_headers').delete().eq('audit_id', auditId);
    if (error) return { success:false, error:error.message };

    // ลบรูปหลังลบแถวสำเร็จ — ถ้าลบรูปพลาดก็ไม่ย้อนกลับ (แถวหายแล้ว) แค่รายงาน
    let photoRemoved = 0, photoFailed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error:rmErr } = await _sb.storage.from(CONFIG.STORAGE_BUCKET).remove(chunk);
      if (rmErr) photoFailed += chunk.length; else photoRemoved += chunk.length;
    }
    return { success:true, photoRemoved, photoFailed };
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
    'home.greeting_hi':    'สวัสดี',
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
    'dash.area_rank':      'Area Ranking',
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
    'msg.saving':             'กำลังบันทึก...',
    'msg.suspended':          'ระงับการใช้งานแล้ว',
    'msg.restored':           'เปิดใช้งานอีกครั้งแล้ว',
    'err.self_suspend':       'ระงับบัญชีตัวเองไม่ได้',
    'err.last_admin':         'ระงับ Admin คนสุดท้ายไม่ได้ — จะไม่มีใครเข้าจัดการระบบได้',
    'users.suspend':          'ระงับการใช้งาน',
    'users.restore':          'เปิดใช้งานอีกครั้ง',
    'users.suspend_hint':     'ระงับแล้วเข้าสู่ระบบไม่ได้ และถูกออกจากระบบทันที · ผลตรวจและประวัติยังอยู่ครบ',
    'confirm.suspend_title':  'ยืนยันการระงับการใช้งาน',
    'confirm.suspend_body':   'ระงับ "{name}" ไม่ให้เข้าใช้งานหรือไม่? ผลตรวจและประวัติยังอยู่ครบ เปิดใช้งานคืนได้ทุกเมื่อ',
    'confirm.restore_title':  'เปิดใช้งานอีกครั้ง',
    'confirm.restore_body':   'ให้ "{name}" กลับมาเข้าใช้งานได้หรือไม่?',
    'msg.deleting':           'กำลังลบ...',
    'msg.delete_failed':      'ลบไม่สำเร็จ',
    'msg.audit_deleted':      'ลบผลตรวจแล้ว',
    'msg.photo_left':         'ลบรูปไม่สำเร็จ',
    'err.already_audited':    'คุณตรวจพื้นที่นี้ในงานนี้ไปแล้ว — ถ้าต้องแก้ ให้ Admin ลบผลเดิมก่อน',
    'dash.round':             'รอบการตรวจ',
    'dash.all_rounds':        'ทุกรอบ',
    'summary.del_hint':       'ลบผลตรวจใบนี้ถาวร (รวมรูปภาพ) · งานที่มอบหมายจะกลับเป็น "ค้าง" ให้ตรวจใหม่ได้',
    'summary.del_btn':        'ลบผลตรวจนี้',
    'confirm.del_audit_title':'ยืนยันการลบผลตรวจ',
    'confirm.del_audit_body': 'ลบผลตรวจนี้ถาวร?\n\nพื้นที่: {area}\nวันที่: {date}\nคะแนน: {percent}%\nรายการ: {items} ข้อ · รูป {photos} รูป\n\nลบแล้วกู้คืนไม่ได้ (มีบันทึกไว้ใน audit_logs)',
    'asg.unit_hint':          'นับเป็นรายคน — พื้นที่ที่มอบหมายให้หลายคนต้องตรวจครบทุกคนจึงถือว่าเสร็จ',
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
    'role.auditor_desc':      '📋 Auditor — ตรวจ 5ส + ดูผลทั้งบริษัท',
    'role.viewer_desc':       '👁️ Viewer — ผู้บริหาร ดูได้ทุกอย่าง (ตรวจไม่ได้)',
    'audit.nav_answered':     'ตอบแล้ว',
    'msg.viewer_no_audit':    'บัญชีผู้บริหาร (Viewer) ตรวจ 5ส ไม่ได้ — ดูผลและรายงานได้ทุกส่วน',
    'err.no_schedule_id':     'ไม่พบรหัสงานที่มอบหมาย',

    /* ===== Dashboard ใหม่ (4 ส.ค. 2026) ===== */
    // Dashboard — ranking
    'rank.from':                 'จาก',
    'rank.times':                'ครั้ง',
    // Dashboard — พื้นที่ต้องปรับปรุง
    'imp.title':                 'พื้นที่ต้องปรับปรุง',
    'imp.pick_plant':            'เลือกโรงงาน',
    'imp.pick_area':             'เลือกพื้นที่',
    'imp.pick_audit':            'ครั้งที่ตรวจ',
    'imp.opt_plant':             '— เลือกโรงงาน —',
    'imp.opt_area':              '— เลือกพื้นที่ —',
    'imp.opt_audit':             '— เลือกครั้งที่ตรวจ —',
    'imp.start_t':               'เลือกโรงงานและพื้นที่',
    'imp.start_d':               'ระบบจะแสดงข้อที่ไม่ผ่านพร้อมหมายเหตุและรูปภาพ',
    'imp.no_data_t':             'ยังไม่มีผลการตรวจในระบบ',
    'imp.no_data_d':             'เมื่อมีการตรวจแล้วจะเลือกดูข้อที่ต้องปรับปรุงได้ที่นี่',
    'imp.inactive':             'เลิกใช้แล้ว',
    'imp.no_audit_t':            'พื้นที่นี้ยังไม่มีผลการตรวจ',
    'imp.no_audit_d':            'เมื่อมีการตรวจแล้วจะแสดงข้อที่ต้องปรับปรุงที่นี่',
    'imp.perfect_t':             'ไม่มีข้อที่ต้องปรับปรุง',
    'imp.perfect_d':             'การตรวจครั้งนี้ผ่านทุกข้อ',
    'imp.failed_count':          'ข้อที่ต้องปรับปรุง',
    'imp.total_items':           'จากทั้งหมด',
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
    'home.greeting_hi':    'Hello',
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
    'dash.area_rank':      'Area Ranking',
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
    'role.auditor_desc':      '📋 Auditor — ตรวจ 5ส + ดูผลทั้งบริษัท',
    'role.viewer_desc':       '👁️ Viewer — ผู้บริหาร ดูได้ทุกอย่าง (ตรวจไม่ได้)',
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
    'home.greeting_hi':    'Hello',
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
    'dash.area_rank':      'Area Ranking',
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
    'msg.saving':             'Saving...',
    'msg.suspended':          'Account suspended',
    'msg.restored':           'Account reactivated',
    'err.self_suspend':       'You cannot suspend your own account',
    'err.last_admin':         'Cannot suspend the last active Admin — no one would be able to manage the system',
    'users.suspend':          'Suspend access',
    'users.restore':          'Reactivate',
    'users.suspend_hint':     'Suspended users cannot sign in and are signed out immediately · audit results and history are kept',
    'confirm.suspend_title':  'Confirm suspension',
    'confirm.suspend_body':   'Suspend access for "{name}"? Audit results and history are kept — you can reactivate at any time.',
    'confirm.restore_title':  'Reactivate account',
    'confirm.restore_body':   'Allow "{name}" to sign in again?',
    'msg.deleting':           'Deleting...',
    'msg.delete_failed':      'Delete failed',
    'msg.audit_deleted':      'Audit result deleted',
    'msg.photo_left':         'photos could not be removed:',
    'err.already_audited':    'You have already audited this area for this assignment — ask an Admin to delete the previous result first',
    'dash.round':             'Audit round',
    'dash.all_rounds':        'All rounds',
    'summary.del_hint':       'Permanently delete this audit (including photos) · the assignment returns to "pending" so it can be re-audited',
    'summary.del_btn':        'Delete this audit',
    'confirm.del_audit_title':'Confirm deletion',
    'confirm.del_audit_body': 'Permanently delete this audit?\n\nArea: {area}\nDate: {date}\nScore: {percent}%\nItems: {items} · photos: {photos}\n\nThis cannot be undone (a record is kept in audit_logs)',
    'asg.unit_hint':          'Counted per person — an area assigned to several auditors is only complete when all of them have audited it',
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
    'role.auditor_desc':      '📋 Auditor — audit + view all results',
    'role.viewer_desc':       '👁️ Viewer — executive, full read access (cannot audit)',
    'audit.nav_answered':     'Answered',
    'msg.viewer_no_audit':    'Viewer accounts cannot perform audits — view-only access',
    'err.no_schedule_id':     'Assignment ID not found',

    /* ===== Dashboard ใหม่ (4 ส.ค. 2026) ===== */
    // Dashboard — ranking
    'rank.from':                 'from',
    'rank.times':                'audit(s)',
    // Dashboard — areas needing improvement
    'imp.title':                 'Areas Needing Improvement',
    'imp.pick_plant':            'Select plant',
    'imp.pick_area':             'Select area',
    'imp.pick_audit':            'Audit round',
    'imp.opt_plant':             '— Select plant —',
    'imp.opt_area':              '— Select area —',
    'imp.opt_audit':             '— Select audit —',
    'imp.start_t':               'Select a plant and area',
    'imp.start_d':               'Failed items will be shown with remarks and photos',
    'imp.no_data_t':             'No audit results yet',
    'imp.no_data_d':             'Once an audit is submitted you can review its findings here',
    'imp.inactive':             'inactive',
    'imp.no_audit_t':            'No audit results for this area yet',
    'imp.no_audit_d':            'Items needing improvement will appear here after an audit',
    'imp.perfect_t':             'Nothing to improve',
    'imp.perfect_d':             'This audit passed every item',
    'imp.failed_count':          'items to improve',
    'imp.total_items':           'out of',
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

  /**
   * ดึง role ล่าสุดจาก DB มาทับค่าใน session
   *
   * ⚠️ จำเป็นเพราะ role ถูก "แช่" ไว้ใน localStorage ตอน login
   *    ถ้า admin เปลี่ยน role ให้คนที่กำลังล็อกอินอยู่ เครื่องนั้นจะยังใช้ role เดิม
   *    ไปเรื่อย ๆ จนกว่าจะ logout → พบจากการทดสอบ 5 ส.ค. 2026
   *    (เปลี่ยนเป็น viewer แล้วยังเห็นปุ่มตรวจ)
   *
   * เป็น query เบา ๆ 1 ครั้งต่อการเปิดหน้า · ล้มก็ไม่ทำให้หน้าพัง (คืน null)
   */
  async refreshRole() {
    const uid = (AppState.user || {}).userId;
    if (!uid) return null;
    try {
      const { data, error } = await _sb
        .from('profiles').select('role,status').eq('id', uid).single();
      if (error || !data) return null;

      // ถูกระงับการใช้งานระหว่างที่ยังล็อกอินอยู่ → เตะออก
      if (data.status && data.status !== 'active') {
        Session.clear();
        navigate('index.html');
        return null;
      }

      const fresh = MAP.role[data.role] || data.role;
      if (fresh !== AppState.user.role) {
        console.log('[Session] role เปลี่ยน:', AppState.user.role, '→', fresh);
        AppState.user.role = fresh;
        localStorage.setItem(CONFIG.SESSION_KEY,
          JSON.stringify({ token: AppState.token, user: AppState.user }));
        // ⚠️ ต้องล้าง _profileCache ด้วย — getAssignmentAnalytics() ใช้ _currentProfile()
        //    ตัดสินว่าเป็น admin ไหม (isStaff) ถ้าไม่ล้าง คนที่ถูกลดสิทธิ์กลางเซสชัน
        //    จะยังเห็น % ของทุกคนในหน้าตารางตรวจ
        _profileCache = null;
      }
      return currentRole();
    } catch (_) { return null; }
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
// กำหนดสถานะงานจากข้อมูลจริง: done / overdue / today / pending
function taskState(s) {
  if (s.Status === 'Completed') return 'done';
  if (!s.Audit_Date) return 'pending';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(s.Audit_Date); d.setHours(0, 0, 0, 0);
  if (d.getTime() < today.getTime()) return 'overdue';
  if (d.getTime() === today.getTime()) return 'today';
  return 'pending';
}

// ไอคอนสถานะแบบ inline SVG (fill: currentColor — สืบสีจาก div แม่) ไม่พึ่ง icon-font
const TASK_SVG = {
  pencil: '<path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12z"/><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>',
  clipboard: '<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z"/>',
  warn: '<path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/>',
  check: '<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>'
};
function statusSvg(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 16 16" fill="currentColor" style="display:block">${TASK_SVG[name]}</svg>`;
}

// ค่าคอนฟิกการแสดงผลของแต่ละสถานะ
const TASK_STATE_CFG = {
  today:   { svg: 'pencil',    label: 'ถึงกำหนดวันนี้', ico_bg: 'var(--primary-light)', ico_fg: 'var(--primary)', bd_bg: 'var(--primary-light)', bd_fg: 'var(--primary)' },
  pending: { svg: 'clipboard', label: 'รอตรวจ',        ico_bg: 'var(--gray-100)',      ico_fg: 'var(--gray-500)', bd_bg: 'var(--gray-100)',      bd_fg: 'var(--gray-600)' },
  overdue: { svg: 'warn',      label: 'เกินกำหนด',      ico_bg: '#fdecec',              ico_fg: 'var(--danger)',   bd_bg: '#fdecec',              bd_fg: 'var(--danger)' },
  done:    { svg: 'check',     label: 'เสร็จสิ้น',       ico_bg: '#e9f7ee',              ico_fg: 'var(--success)',  bd_bg: '#e9f7ee',              bd_fg: 'var(--success)' }
};

// สร้าง HTML แถวงานที่ได้รับมอบหมาย (สไตล์รายการกะทัดรัด)
function renderAssignedTaskCards(tasks) {
  return tasks.map(s => {
    const st  = taskState(s);
    const cfg = TASK_STATE_CFG[st];
    const dateLabel = st === 'today' ? 'วันนี้' : UI.formatDate(s.Audit_Date);
    const sub = [s.Plant_Name || s.Plant_ID || '', s.Audit_Round || '', dateLabel]
      .filter(Boolean).map(escHtml).join(' · ');
    const startArgs = `'${escAttr(s.Plant_ID)}','${escAttr(s.Plant_Name || s.Plant_ID)}','${escAttr(s.Area_ID)}','${escAttr(s.Area_Name || s.Area_ID)}','${escAttr(s.Area_Type || '')}','${escAttr(s.Schedule_ID || '')}'`;
    let action;
    if (st === 'done') {
      // ไปหน้าผลการตรวจของหัวข้อนี้โดยตรง (summary) — ถ้าหา audit ไม่เจอค่อย fallback หน้าประวัติ
      const doneAction = s.Audit_ID
        ? `navigate('summary.html', { auditId: '${escAttr(s.Audit_ID)}' })`
        : `navigate('history.html')`;
      action = `<button class="btn" style="flex-shrink:0;height:38px;padding:0 16px;font-size:0.82rem;font-weight:700;background:#fff;border:1.5px solid var(--gray-200);color:var(--dark)" onclick="${doneAction}">ดูผล</button>`;
    } else if (st === 'today') {
      action = `<button class="btn btn-primary" style="flex-shrink:0;height:38px;padding:0 16px;font-size:0.82rem;font-weight:700" onclick="startAssignedAudit(${startArgs})">เริ่มตรวจ</button>`;
    } else {
      action = `<button class="btn" style="flex-shrink:0;height:38px;padding:0 18px;font-size:0.82rem;font-weight:700;background:#fff;border:1.5px solid var(--gray-200);color:var(--dark)" onclick="startAssignedAudit(${startArgs})">เริ่ม</button>`;
    }
    return `
      <div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--gray-200);border-radius:14px;padding:12px 14px;margin-bottom:10px${st === 'done' ? ';opacity:.72' : ''}">
        <div style="width:42px;height:42px;border-radius:11px;background:${cfg.ico_bg};color:${cfg.ico_fg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${statusSvg(cfg.svg)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-weight:700;font-size:0.92rem;color:var(--dark)">${escHtml(s.Area_Name || s.Area_ID || '-')}</span>
            <span style="font-size:0.64rem;font-weight:700;padding:2px 8px;border-radius:20px;background:${cfg.bd_bg};color:${cfg.bd_fg};white-space:nowrap">${cfg.label}</span>
          </div>
          <div style="font-size:0.75rem;color:var(--gray-600);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>
        </div>
        ${action}
      </div>`;
  }).join('');
}

// ลำดับความสำคัญของสถานะสำหรับการเรียง
const TASK_STATE_ORDER = { today: 0, overdue: 1, pending: 2, done: 3 };

// โหลด + กรอง schedules ที่ user นี้ถูกมอบหมาย
function filterMyTasks(schedData, user) {
  const userId = (user && user.userId) || null;
  if (!userId || !Array.isArray(schedData)) return [];
  return schedData.filter(s => {
    const ids = String(s.Auditor_ID || '').split(',').map(x => x.trim());
    return ids.includes(String(userId));
  });
}

// หน้า "งานที่ได้รับมอบหมาย"
async function initMyTasks() {
  if (!Session.requireLogin()) return;
  await Session.refreshRole();   // role อาจถูกเปลี่ยนหลัง login — ต้องดึงใหม่ก่อนเช็ก
  // viewer ตรวจ 5ส ไม่ได้ (RLS headers_insert บล็อกอยู่แล้ว — นี่กันไม่ให้เข้ามาเจอ error)
  if (isViewer()) { bounceHome('msg.viewer_no_audit'); return; }
  updateUserUI();
  const user = AppState.user || {};
  const list = document.getElementById('myTasksList');
  const summary = document.getElementById('tasksSummary');
  try {
    UI.showLoading(I18n.t('msg.loading_home'));
    const schedRes = await API.get('getSchedule', {});
    UI.hideLoading();
    const myTasks = schedRes.success ? filterMyTasks(schedRes.data, user) : [];
    if (!list) return;
    if (myTasks.length > 0) {
      // เรียงตามสถานะ (วันนี้ → เกินกำหนด → รอตรวจ → เสร็จสิ้น) แล้วตามวันที่
      myTasks.sort((a, b) => {
        const oa = TASK_STATE_ORDER[taskState(a)], ob = TASK_STATE_ORDER[taskState(b)];
        if (oa !== ob) return oa - ob;
        return String(a.Audit_Date || '').localeCompare(String(b.Audit_Date || ''));
      });
      const pendingCount = myTasks.filter(t => t.Status !== 'Completed').length;
      if (summary) summary.innerHTML =
        `<span style="color:var(--dark);font-weight:700">${myTasks.length} รายการ</span> · ค้าง ${pendingCount}`;
      list.innerHTML = renderAssignedTaskCards(myTasks);
    } else {
      if (summary) summary.textContent = '';
      list.innerHTML = `
        <div class="card text-center" style="padding:32px 20px">
          <i class="bi bi-clipboard-check" style="font-size:2.4rem;color:var(--gray-500)"></i>
          <div style="margin-top:10px;font-weight:700;color:var(--dark)">ยังไม่มีงานที่ได้รับมอบหมาย</div>
          <div style="font-size:0.82rem;color:var(--gray-600);margin:6px 0 16px">คุณสามารถเลือกพื้นที่ตรวจเองได้</div>
          <button class="btn btn-primary btn-block" onclick="navigate('plant.html')" style="height:46px">
            <i class="bi bi-clipboard-check"></i> เลือกพื้นที่ตรวจเอง
          </button>
        </div>`;
    }
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.load_failed'), 'error');
  }
}

async function initHome() {
  if (!Session.requireLogin()) return;
  await Session.refreshRole();   // role อาจถูกเปลี่ยนหลัง login — ต้องดึงใหม่ก่อนเช็กสิทธิ์
  updateUserUI();

  // ข้อความที่หน้าอื่นฝากไว้ตอนเด้งกลับมา (ดู bounceHome)
  try {
    const bm = sessionStorage.getItem('bounceMsg');
    if (bm) { sessionStorage.removeItem('bounceMsg'); UI.toast(I18n.t(bm), 'error'); }
  } catch(_) {}

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

  // viewer (ผู้บริหาร) = ดูได้ทุกอย่าง แต่ตรวจไม่ได้
  //
  // 🔑 นโยบาย (ตัดสินใจ 5 ส.ค. 2026): ใช้ "เด้งกลับ" ไม่ใช่ "ซ่อนปุ่ม"
  //    ปุ่มยังอยู่ครบเหมือน role อื่น — viewer กดแล้วเจอ toast + กลับหน้าหลัก
  //    เหตุผล: ซ่อนปุ่มทำให้หน้าหลักดูโหว่ และต้องไปตามซ่อนอีก 7 หน้าที่มี
  //    bottom-nav "ตรวจ" (dashboard, history, summary, criteria, users,
  //    assign, schedule) ทุกครั้งที่เพิ่มหน้าใหม่
  //
  //    ด่านที่เชื่อได้จริงคือ RLS `headers_insert` (patches.sql ส่วน G1)
  //    ซึ่งบล็อกที่ระดับฐานข้อมูล — การเด้งกลับเป็นแค่ UX
  //
  // ทางเข้าการตรวจทุกทางมี guard: initMyTasks · initPlant · initArea · initAudit

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

    // งานที่ได้รับมอบหมายของ user นี้ (ใช้สรุปใน Hero Card)
    const myTasks = schedRes.success ? filterMyTasks(schedRes.data, user) : [];

    // Hero Card summary — รอบ/กำหนด + งานค้าง
    const pending = myTasks.filter(t => t.Status !== 'Completed');
    pending.sort((a, b) => String(a.Audit_Date || '').localeCompare(String(b.Audit_Date || '')));
    const near = pending[0];
    if (near) {
      setEl('heroMeta', `รอบ ${near.Audit_Round || '-'} · ครบกำหนด ${UI.formatDate(near.Audit_Date)}`);
      setEl('heroDesc', `คุณมีงานตรวจค้างอยู่ ${pending.length} พื้นที่ · เริ่มที่ ${near.Area_Name || near.Area_ID}`);
    } else {
      const up = (schedRes.success && schedRes.data.length)
        ? schedRes.data.find(s => s.Status === 'Pending') : null;
      setEl('heroMeta', up ? `รอบ ${up.Audit_Round || '-'} · ครบกำหนด ${UI.formatDate(up.Audit_Date)}` : '');
      setEl('heroDesc', 'พร้อมเริ่มตรวจ 5ส แล้ว — แตะปุ่มด้านล่างเพื่อดูงานที่ได้รับมอบหมาย');
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
  await Session.refreshRole();   // role อาจถูกเปลี่ยนหลัง login — ต้องดึงใหม่ก่อนเช็ก
  // viewer ตรวจ 5ส ไม่ได้ (RLS headers_insert บล็อกอยู่แล้ว — นี่กันไม่ให้เข้ามาเจอ error)
  if (isViewer()) { bounceHome('msg.viewer_no_audit'); return; }
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
  await Session.refreshRole();   // role อาจถูกเปลี่ยนหลัง login — ต้องดึงใหม่ก่อนเช็ก
  // viewer ตรวจ 5ส ไม่ได้ (RLS headers_insert บล็อกอยู่แล้ว — นี่กันไม่ให้เข้ามาเจอ error)
  if (isViewer()) { bounceHome('msg.viewer_no_audit'); return; }
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
  await Session.refreshRole();   // role อาจถูกเปลี่ยนหลัง login — ต้องดึงใหม่ก่อนเช็ก
  // viewer ตรวจ 5ส ไม่ได้ (RLS headers_insert บล็อกอยู่แล้ว — นี่กันไม่ให้เข้ามาเจอ error)
  if (isViewer()) { bounceHome('msg.viewer_no_audit'); return; }
  updateUserUI();

  // ---------------------------------------------------------------
  // กันตรวจซ้ำงานเดิม — เช็ก "ก่อน" ให้กรอก ไม่ใช่ตอนกด submit
  //
  // unique(schedule_id, auditor_id) จะปฏิเสธตอน submit อยู่แล้ว แต่ตอนนั้น
  // ผู้ใช้กรอกครบ ~67 ข้อ + อัปโหลดรูปไปแล้ว (STEP 0 มาก่อน STEP 1)
  // → เสียแรงเปล่า และเหลือรูปกำพร้าใน Storage
  //
  // เข้ามาได้ยังไง: getAreas() แนบ Schedule_ID ให้พื้นที่ที่ schedule ยัง pending
  // ซึ่งยัง pending อยู่จนกว่าทีมจะตรวจครบ → คนที่ตรวจไปแล้วเลือกพื้นที่นั้นเองได้อีก
  // ---------------------------------------------------------------
  const _sid = getParam('scheduleId');
  const _me  = AppState.user && AppState.user.userId;
  if (_sid && _me) {
    const dup = await API.get('hasAuditedSchedule', { scheduleId: _sid, auditorId: _me });
    if (dup && dup.audited) {
      UI.toast(I18n.t('err.already_audited'), 'error', 6000);
      navigate(dup.auditId ? 'summary.html' : 'mytasks.html',
               dup.auditId ? { auditId: dup.auditId } : {});
      return;
    }
  }

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

  // Guard: session หลุด/ไม่มี userId → ห้าม submit (กัน auditor_id='unknown' ที่ insert ไม่ผ่าน RLS)
  if (!AppState.user || !AppState.user.userId) {
    UI.toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'error', 5000);
    navigate('index.html');
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
      // ผูกกับงานที่มอบหมาย (ว่าง = ตรวจนอกรอบ เลือกพื้นที่เอง)
      // audit_round ไม่ส่งจาก client — trigger ก๊อปจาก schedules ให้เอง (ปลอมไม่ได้)
      scheduleId: getParam('scheduleId') || '',
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
      // ไม่ต้อง mark schedule เอง — trigger trg_sync_sched_status ทำให้แล้ว (ส่วน H)
      // (เดิมเรียก completeSchedule() ที่นี่ ซึ่งปิดงานทั้งแถวให้ทุกคน)
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

  const auditId = getParam('auditId');

  // โหลดจาก sessionStorage ก่อน (ผลที่เพิ่ง submit)
  const cached = sessionStorage.getItem('lastAuditResult');
  let result = cached ? JSON.parse(cached) : null;

  // ถ้าเปิดด้วย auditId เจาะจง (เช่นกด"ดูผล") และไม่ตรงกับ cache → อย่าใช้ cache เก่า ให้ดึงของจริง
  if (auditId && (!result || result.auditId !== auditId)) result = null;

  // ถ้าไม่มี ดึงจาก API
  if (!result) {
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
  const noItems = (Number(result.maxScore) || 0) === 0;   // มาร์ค N/A ทั้งหมด → ไม่มีข้อประเมิน
  const status = noItems ? 'good' : UI.statusClass(pct);

  setEl('resultPercent', noItems ? '—' : Math.round(pct));
  setEl('resultScore',   `${result.totalScore} / ${result.maxScore}`);
  setEl('resultStatus',  noItems ? 'ไม่มีข้อประเมินในพื้นที่ (N/A ทั้งหมด)' : UI.statusTH(pct));
  setEl('resultAuditId', result.auditId || '-');

  // Circle color — ล้าง class เดิมก่อน แล้วค่อย add ใหม่
  const circle = document.getElementById('scoreCircle');
  if (circle) {
    circle.classList.remove('excellent', 'good', 'need-improve');
    if (!noItems) circle.classList.add(status);
  }

  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = noItems ? 'status-badge' : `status-badge status-${status}`;
    badge.textContent = noItems ? 'ไม่มีข้อประเมิน' : (pct >= 90 ? '🏆 Excellent' : pct >= 75 ? '✅ Good' : '⚠️ Need Improvement');
  }

  // ---------------------------------------------------------------
  // D1: ปุ่มลบผลตรวจ (admin เท่านั้น)
  //
  // จำเป็นเพราะ locked_at (ล็อกหลัง submit) + unique(schedule_id, auditor_id)
  // ทำให้ auditor ที่ตรวจผิด "แก้ไม่ได้ และตรวจใหม่ก็ไม่ได้"
  // admin ลบให้แล้ว trigger จะเปิดงานที่มอบหมายกลับเป็นค้างเอง → ตรวจใหม่ได้
  // ---------------------------------------------------------------
  await Session.refreshRole();
  const delWrap = document.getElementById('sumAdminDel');
  if (delWrap && isAdminRole() && result.auditId) {
    delWrap.style.display = 'block';
    delWrap.dataset.auditId = result.auditId;
  }
}

/** ลบผลตรวจใบนี้ (admin) — ยืนยันด้วยรายละเอียดของจริงก่อน */
async function deleteAuditResult() {
  const wrap = document.getElementById('sumAdminDel');
  const auditId = wrap && wrap.dataset.auditId;
  if (!auditId) return;

  // ดึงรายละเอียดสด ๆ มาโชว์ในกล่องยืนยัน — กันลบผิดใบ
  UI.showLoading();
  const res = await API.get('getAuditDetail', { auditId });
  UI.hideLoading();
  if (!res.success || !res.header) { UI.toast(I18n.t('msg.load_failed'), 'error'); return; }

  const h = res.header;
  const nPhotos = (res.details || []).reduce(
    (n, d) => n + (d.Photo_URL ? String(d.Photo_URL).split(',').filter(Boolean).length : 0), 0);

  const ok = await showConfirm(
    I18n.t('confirm.del_audit_title'),
    I18n.t('confirm.del_audit_body')
      .replace('{area}',    h.Area_ID   || '-')
      .replace('{date}',    h.Audit_Date || '-')
      .replace('{percent}', String(Math.round(Number(h.Percent) || 0)))
      .replace('{items}',   String((res.details || []).length))
      .replace('{photos}',  String(nPhotos))
  );
  if (!ok) return;

  UI.showLoading(I18n.t('msg.deleting'));
  const del = await API.post('deleteAudit', { auditId, purgePhotos: true });
  UI.hideLoading();

  if (!del.success) { UI.toast(del.error || I18n.t('msg.delete_failed'), 'error'); return; }

  logEvent('DELETE_AUDIT', `ลบผลตรวจ ${h.Area_ID || ''} · ${h.Audit_Date || ''}`,
           'audit_headers', auditId);

  let msg = I18n.t('msg.audit_deleted');
  if (del.photoFailed) msg += ` (${I18n.t('msg.photo_left')} ${del.photoFailed})`;
  UI.toast(msg, 'success');

  sessionStorage.removeItem('lastAuditResult');
  navigate('history.html');
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
// รอบที่เลือกอยู่บน Dashboard ('' = ทุกรอบ) — คงไว้ระหว่างกดรีเฟรช
let _dashRound = '';

/** เปลี่ยนรอบแล้วโหลด ranking ใหม่ (ส่วน H) */
function dashRoundChange(v) {
  _dashRound = v || '';
  initDashboard();
}

async function initDashboard() {
  if (!Session.requireLogin()) return;
  updateUserUI();

  UI.showLoading(I18n.t('msg.loading_dashboard'));
  try {
    const [res, audRes] = await Promise.all([
      API.get('getDashboard', { round: _dashRound }),
      API.get('getAuditedAreas', {}),      // เฉพาะที่มีผลตรวจจริง — ไม่มีทางตัน
    ]);
    UI.hideLoading();

    if (!res.success) { UI.toast(res.error, 'error'); return; }
    const d = res.data;

    // 0) dropdown เลือกรอบ — ตัวเลือกมาจากรอบที่มีผลตรวจจริงเท่านั้น
    const rSel = document.getElementById('dashRound');
    if (rSel) {
      const opts = [`<option value="">${escHtml(I18n.t('dash.all_rounds'))}</option>`]
        .concat((d.rounds || []).map(r =>
          `<option value="${escAttr(r)}">${escHtml(r)}</option>`));
      rSel.innerHTML = opts.join('');
      rSel.value = _dashRound;                       // คงค่าที่เลือกไว้หลัง re-render
      // ไม่มีรอบให้เลือกเลย (ตรวจนอกรอบทั้งหมด) → ซ่อน filter ไม่ให้เข้าใจผิด
      const wrap = document.getElementById('dashRoundWrap');
      if (wrap) wrap.style.display = (d.rounds || []).length ? 'flex' : 'none';
    }

    // 1) Plant Ranking — แสดงทุกโรงงาน
    renderRanking('plantRanking', d.plantComparison || [], 'plantName', 100);

    // 2) Area Ranking — แสดงครบทุกพื้นที่ เพื่อหาจุดบกพร่องรายพื้นที่
    renderRanking('areaRanking', d.areaRanking || [], 'areaName', 100);

    // 3) การ์ดพื้นที่ต้องปรับปรุง — โหลดรายการครั้งเดียว แล้วกรองในเครื่อง
    _impAllAreas = (audRes.success && audRes.areas)  ? audRes.areas  : [];
    _impPlants   = (audRes.success && audRes.plants) ? audRes.plants : [];
    impFillPlants();

  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.dash_failed'), 'error');
  }
}

// ============================================================
// DASHBOARD — การ์ด "พื้นที่ต้องปรับปรุง"
// เลือก โรงงาน → พื้นที่ → ครั้งที่ตรวจ → แสดงข้อที่ตก (0–1) + หมายเหตุ + รูป
// ============================================================
let _impPlants   = [];   // โรงงานที่มีผลตรวจ
let _impAllAreas = [];   // ทุกพื้นที่ที่มีผลตรวจ (โหลดครั้งเดียว)
let _impAreas    = [];   // พื้นที่ของโรงงานที่เลือก (กรองจาก _impAllAreas)
let _impAudits   = [];

/** ใส่ตัวเลือกใน select แบบปลอดภัย (ไม่ใช้ innerHTML กับข้อมูลจาก DB) */
function impSetOptions(selectId, placeholderKey, items, valueOf, labelOf) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.textContent = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = I18n.t(placeholderKey);
  sel.appendChild(ph);
  items.forEach(it => {
    const o = document.createElement('option');
    o.value = valueOf(it);
    o.textContent = labelOf(it);   // textContent = ปลอดภัยจาก XSS โดยธรรมชาติ
    sel.appendChild(o);
  });
  sel.disabled = items.length === 0;
}

function impFillPlants() {
  impSetOptions('impPlant', 'imp.opt_plant', _impPlants,
    p => p.Plant_ID, p => p.Plant_Name || p.Plant_ID);
  const sel = document.getElementById('impPlant');
  if (sel) sel.disabled = _impPlants.length === 0;

  // ยังไม่มีผลตรวจในระบบเลย → บอกให้ชัด ไม่ปล่อยให้กดวนเปล่า ๆ
  if (!_impPlants.length) impShowHint('imp.no_data_t', 'imp.no_data_d', 'bi-clipboard-x');

  // มีโรงงานเดียว → เลือกให้เลย ลดคลิกบนมือถือ
  else if (_impPlants.length === 1 && sel) {
    sel.value = _impPlants[0].Plant_ID;
    impPlantChange(sel.value);
  }
}

/** ป้ายกำกับพื้นที่ใน dropdown — ใส่จำนวนครั้งและวงเล็บถ้าเลิกใช้แล้ว */
function impAreaLabel(a) {
  const parts = [a.Area_Name || a.Area_ID];
  if (a.Audits)  parts.push(`· ${a.Audits} ${I18n.t('rank.times')}`);
  if (a.Inactive) parts.push(`(${I18n.t('imp.inactive')})`);
  return parts.join(' ');
}

/** รีเซ็ต select ระดับล่างให้ว่างและปิดใช้งาน */
function impResetBelow(level) {
  if (level <= 2) {
    _impAreas = [];
    impSetOptions('impArea', 'imp.opt_area', [], () => '', () => '');
  }
  if (level <= 3) {
    _impAudits = [];
    impSetOptions('impAudit', 'imp.opt_audit', [], () => '', () => '');
  }
  impShowHint('imp.start_t', 'imp.start_d', 'bi-hand-index-thumb');
}

/** กรองในเครื่องจากรายการที่โหลดไว้แล้ว — ไม่ยิง API ซ้ำ ตอบสนองทันที */
function impPlantChange(plantId) {
  impResetBelow(2);
  if (!plantId) return;

  _impAreas = _impAllAreas.filter(a => a.Plant_ID === plantId);
  impSetOptions('impArea', 'imp.opt_area', _impAreas, a => a.Area_ID, impAreaLabel);

  // มีพื้นที่เดียว → เลือกให้เลย
  if (_impAreas.length === 1) {
    const sel = document.getElementById('impArea');
    if (sel) { sel.value = _impAreas[0].Area_ID; impAreaChange(sel.value); }
  }
}

async function impAreaChange(areaId) {
  impResetBelow(3);
  if (!areaId) return;

  UI.showLoading(I18n.t('loading'));
  try {
    const res = await API.get('getAreaAudits', { areaId });
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || I18n.t('msg.load_error'), 'error'); return; }
    _impAudits = res.data || [];

    if (!_impAudits.length) {
      impShowHint('imp.no_audit_t', 'imp.no_audit_d', 'bi-clipboard-x');
      return;
    }
    impSetOptions('impAudit', 'imp.opt_audit', _impAudits,
      a => a.Audit_ID,
      a => `${UI.formatDate(a.Audit_Date)} · ${a.Percent}%`);

    // มีครั้งเดียว → เลือกให้เลย ลดจำนวนคลิกบนมือถือ
    if (_impAudits.length === 1) {
      const sel = document.getElementById('impAudit');
      if (sel) { sel.value = _impAudits[0].Audit_ID; impAuditChange(sel.value); }
    }
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.error_prefix') + err.message, 'error');
  }
}

async function impAuditChange(auditId) {
  if (!auditId) { impShowHint('imp.start_t', 'imp.start_d', 'bi-hand-index-thumb'); return; }

  UI.showLoading(I18n.t('loading'));
  try {
    const res = await API.get('getAuditDetail', { auditId });
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || I18n.t('msg.load_error'), 'error'); return; }
    impRenderItems(res.header, res.details || []);
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.error_prefix') + err.message, 'error');
  }
}

/** ข้อความชี้แนะ/ว่างเปล่าในกล่องผลลัพธ์ */
function impShowHint(titleKey, descKey, icon, tone) {
  const box = document.getElementById('impResult');
  if (!box) return;
  const color = tone === 'ok' ? 'var(--excellent)' : 'var(--gray-400)';
  box.innerHTML = `
    <div class="imp-empty">
      <i class="bi ${escAttr(icon)}" style="color:${color}"></i>
      <div class="imp-empty-t">${escHtml(I18n.t(titleKey))}</div>
      <div class="imp-empty-d">${escHtml(I18n.t(descKey))}</div>
    </div>`;
}

/** แสดงเฉพาะข้อที่ตก (คะแนน 0–1, ไม่นับข้อที่ตัด N/A) พร้อมหมายเหตุและรูป */
function impRenderItems(header, details) {
  const box = document.getElementById('impResult');
  if (!box) return;

  const failed = details
    .filter(d => !d.Na && d.Score != null && Number(d.Score) <= 1)
    .sort((a, b) => Number(a.Score) - Number(b.Score));   // 0 ก่อน แล้ว 1

  const pct  = Number(header && header.Percent) || 0;
  const band = pct >= 90 ? 'var(--excellent)' : pct >= 75 ? 'var(--warning)' : 'var(--danger)';

  const summary = `
    <div class="imp-summary">
      <div class="imp-summary-pct" style="color:${band}">${pct}%</div>
      <div class="imp-summary-txt">
        ${escHtml(UI.statusTH(pct))}<br>
        ${escHtml(I18n.t('imp.failed_count'))} <b>${failed.length}</b> ${escHtml(I18n.t('audit.answered_suffix'))}
        · ${escHtml(I18n.t('imp.total_items'))} ${details.filter(d => !d.Na).length}
      </div>
    </div>`;

  if (!failed.length) {
    box.innerHTML = summary + `
      <div class="imp-empty">
        <i class="bi bi-patch-check-fill" style="color:var(--excellent)"></i>
        <div class="imp-empty-t">${escHtml(I18n.t('imp.perfect_t'))}</div>
        <div class="imp-empty-d">${escHtml(I18n.t('imp.perfect_d'))}</div>
      </div>`;
    return;
  }

  box.innerHTML = summary + failed.map(d => {
    const s = Number(d.Score);
    const cls = s === 0 ? 's0' : 's1';
    const scoreLabel = s === 0 ? I18n.t('audit.score_0') : I18n.t('audit.score_1');

    const photos = String(d.Photo_URL || '')
      .split(',').map(u => u.trim()).filter(Boolean)
      .map(safeUrl).filter(Boolean)          // ตัด javascript:/data: ทิ้ง (ดู safeUrl)
      .map(u => `<a href="${escAttr(u)}" target="_blank" rel="noopener noreferrer">
                   <img src="${escAttr(u)}" alt="${escAttr(I18n.t('img.alt_photo'))}" loading="lazy">
                 </a>`).join('');

    return `
      <div class="imp-item ${cls}">
        <div class="imp-head">
          <span class="imp-badge ${cls}">${escHtml(scoreLabel)} (${s})</span>
          <div style="flex:1;min-width:0">
            ${d.Category ? `<div class="imp-cat">${escHtml(d.Category)}</div>` : ''}
            <div class="imp-q">${escHtml(d.Question || d.Criteria_ID || '-')}</div>
          </div>
        </div>
        ${d.Remark ? `<div class="imp-remark"><i class="bi bi-chat-left-text"></i><span>${escHtml(d.Remark)}</span></div>` : ''}
        ${photos ? `<div class="imp-photos">${photos}</div>` : ''}
      </div>`;
  }).join('');
}

function renderRanking(containerId, items, nameField, limit = 10) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<p class="text-muted text-center">${I18n.t('msg.no_data')}</p>`;
    return;
  }

  container.innerHTML = items.slice(0, limit).map((item, idx) => {
    const band  = (item.avgScoreRaw != null ? item.avgScoreRaw : item.avgScore);
    const color = band >= 90 ? 'var(--excellent)' : band >= 75 ? 'var(--warning)' : 'var(--danger)';
    const label = band >= 90 ? I18n.t('badge.excellent')
                : band >= 75 ? I18n.t('badge.good')
                             : I18n.t('badge.need_improve');
    // เหรียญ 3 อันดับแรกเฉพาะเมื่อมีของเทียบกันจริง (2 ตัวขึ้นไป)
    const medal = (items.length > 1 && idx < 3) ? `m${idx + 1}` : '';
    // n = จำนวนครั้งที่ตรวจ — บอกว่าคะแนนนี้มาจากกี่ครั้ง
    const meta = item.n ? `${I18n.t('rank.from')} ${item.n} ${I18n.t('rank.times')}` : '';

    return `
    <div class="rk-row">
      <div class="rk-pos ${medal}">${idx + 1}</div>
      <div class="rk-mid">
        <div class="rk-name">${escHtml(item[nameField] || '-')}</div>
        ${meta ? `<div class="rk-meta">${escHtml(meta)}</div>` : ''}
        <div class="rk-track">
          <div class="rk-fill" style="width:${Math.max(Math.min(item.avgScore, 100), 2)}%;background:${color}"></div>
        </div>
      </div>
      <div class="rk-val">
        <div class="rk-pct" style="color:${color}">${item.avgScore}%</div>
        <div class="rk-band" style="color:${color}">${escHtml(label)}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// UTILITIES
// ============================================================

/** ตั้งค่า text content ของ element */
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * อนุญาตเฉพาะ URL ที่ปลอดภัยสำหรับใส่ใน href/src
 * กัน javascript: / data: / vbscript: ที่อาจถูกเขียนลง DB (photo_urls) แล้วยิง XSS
 * คืน '' ถ้าไม่ผ่าน → ฝั่งเรียกใช้ filter ทิ้ง
 */
function safeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  // อนุญาต absolute http(s) และ path ภายในเว็บเดียวกัน
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/[^/\\]/.test(u) || /^[\w.-]+\.(?:jpe?g|png|webp|gif)(?:\?.*)?$/i.test(u)) return u;
  return '';
}

/**
 * role ปัจจุบัน (ตัวเล็ก) จาก session ที่โหลดไว้
 * ระบบใช้ 3 roles: admin · auditor · viewer
 * (manager / area_manager ยังอยู่ใน enum เพราะ Postgres ลบค่าออกไม่ได้
 *  แต่เอาออกจาก dropdown แล้ว — ถ้ามีคนเป็น role เก่าอยู่ ได้สิทธิ์เท่า auditor)
 */
/**
 * เด้งกลับหน้าหลัก + ฝากข้อความไว้ให้ initHome() แสดง
 *
 * ⚠️ ห้ามใช้ UI.toast() แล้ว navigate() ทันที — navigate เปลี่ยน location
 *    ทำให้หน้าถูกทำลายก่อนคนอ่านทัน toast จะกะพริบแล้วหายไปเลย
 *    จึงฝาก key ไว้ใน sessionStorage แล้วให้หน้าปลายทางแสดงแทน
 */
function bounceHome(msgKey) {
  try { sessionStorage.setItem('bounceMsg', msgKey); } catch(_) {}
  navigate('home.html');
}

function currentRole() {
  return String((AppState.user || {}).role || '').trim().toLowerCase();
}

/** admin — จัดการทุกอย่าง */
function isAdminRole() { return currentRole() === 'admin'; }

/**
 * viewer (ผู้บริหาร) — ดูได้ทุกอย่าง แต่ตรวจไม่ได้ แก้ไม่ได้
 * ⚠️ ใช้ซ่อน UI เท่านั้น ด่านจริงคือ RLS `headers_insert` (patches.sql ส่วน G1)
 */
function isViewer() { return currentRole() === 'viewer'; }

/** Escape HTML สำหรับ text content */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');   // เผื่อกรณีถูกวางใน attribute ที่ครอบด้วย single quote
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
  const dz = document.getElementById('dangerZone');
  if (dz) dz.style.display = 'block';   // admin เท่านั้นเห็น Danger Zone
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

  const suspBtn  = document.getElementById('suspendUserBtn');
  const suspLb   = document.getElementById('suspendUserLabel');
  const suspHint = document.getElementById('suspendUserHint');

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
    // ปุ่มระงับ/เปิดใช้งาน — เฉพาะตอนแก้ไข และไม่ให้ทำกับบัญชีตัวเอง
    const isSelf     = u.User_ID === AppState.user?.userId;
    const isInactive = String(u.Status || '').toLowerCase() === 'inactive';
    if (suspBtn) {
      suspBtn.style.display = isSelf ? 'none' : 'block';
      // ระงับ = แดง · เปิดใช้งานอีกครั้ง = เขียว
      suspBtn.style.background = isInactive ? 'var(--success)' : 'var(--danger)';
      suspBtn.style.color = '#fff';
      suspBtn.dataset.next = isInactive ? 'active' : 'inactive';
      suspBtn.querySelector('i').className = isInactive
        ? 'bi bi-arrow-counterclockwise' : 'bi bi-slash-circle';
      if (suspLb) suspLb.textContent = I18n.t(isInactive ? 'users.restore' : 'users.suspend');
    }
    if (suspHint) suspHint.style.display = (isSelf || isInactive) ? 'none' : 'block';
  } else {
    title.textContent = I18n.t('modal.add_user');
    const sr = document.querySelector('input[name="fStatus"][value="Active"]');
    if (sr) sr.checked = true;
    if (suspBtn)  suspBtn.style.display  = 'none';
    if (suspHint) suspHint.style.display = 'none';
  }
  modal.classList.add('show');
}

/**
 * ระงับ / เปิดใช้งานผู้ใช้ (แทนปุ่ม "ลบผู้ใช้" เดิมที่ใช้ไม่ได้จริง)
 * ลบถาวรทำที่ Supabase — ดู supabase/delete_user.sql
 */
async function toggleUserStatus() {
  const userId = document.getElementById('editUserId').value.trim();
  if (!userId) return;
  const u    = _allUsers.find(x => x.User_ID === userId);
  const name = u?.Name || userId;
  const next = document.getElementById('suspendUserBtn')?.dataset.next || 'inactive';

  const ok = await showConfirm(
    I18n.t(next === 'inactive' ? 'confirm.suspend_title' : 'confirm.restore_title'),
    I18n.t(next === 'inactive' ? 'confirm.suspend_body'  : 'confirm.restore_body')
      .replace('{name}', name)
  );
  if (!ok) return;

  try {
    UI.showLoading(I18n.t('msg.saving'));
    const res = await API.post('setUserStatus', { userId, status: next });
    UI.hideLoading();
    if (!res.success) { UI.toast(res.error || I18n.t('msg.save_failed'), 'error'); return; }

    UI.toast(I18n.t(next === 'inactive' ? 'msg.suspended' : 'msg.restored'), 'success');
    closeUserModal();

    // อัปเดตในหน่วยความจำ ไม่ต้องโหลดใหม่ทั้งหน้า
    const row = _allUsers.find(x => x.User_ID === userId);
    if (row) row.Status = next === 'inactive' ? 'Inactive' : 'Active';
    _updateUserStats();
    _renderUsers(_allUsers);
  } catch(err) {
    UI.hideLoading();
    UI.toast(I18n.t('msg.error_prefix') + err.message, 'error');
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

// ---- Danger Zone: รีเซ็ตข้อมูลระบบ (admin) ----
function openResetModal() {
  const err = document.getElementById('resetError'); if (err) err.textContent = '';
  const p1 = document.getElementById('resetPhrase'); if (p1) p1.value = '';
  const p2 = document.getElementById('resetPassword'); if (p2) p2.value = '';
  document.getElementById('resetModal')?.classList.add('show');
}
function closeResetModal() {
  document.getElementById('resetModal')?.classList.remove('show');
}
async function confirmReset() {
  const err = document.getElementById('resetError');
  const phrase = (document.getElementById('resetPhrase')?.value || '').trim();
  const pw     = document.getElementById('resetPassword')?.value || '';
  if (err) err.textContent = '';
  if (phrase !== 'RESET') { if (err) err.textContent = 'พิมพ์ RESET (ตัวใหญ่) ให้ถูกต้อง'; return; }
  if (!pw) { if (err) err.textContent = 'กรอกรหัสผ่านของคุณ'; return; }
  const email = AppState.user && AppState.user.email;
  if (!email) { if (err) err.textContent = 'ไม่พบอีเมลผู้ใช้ — เข้าสู่ระบบใหม่'; return; }

  const btn = document.getElementById('resetConfirmBtn');
  if (btn) { btn.disabled = true; }
  try {
    UI.showLoading('ตรวจสอบรหัสผ่าน...');
    const { error: authErr } = await _sb.auth.signInWithPassword({ email, password: pw });
    if (authErr) { UI.hideLoading(); if (err) err.textContent = 'รหัสผ่านไม่ถูกต้อง'; if (btn) btn.disabled = false; return; }

    UI.showLoading('กำลังรีเซ็ตข้อมูล...');
    const res = await API.get('resetData', {});
    UI.hideLoading();
    if (res.success) {
      closeResetModal();
      const ph = res.photos || {};
      const phTxt = ph.failed ? ` · รูป ${ph.removed||0} (ลบไม่ได้ ${ph.failed})`
                              : (ph.removed ? ` · รูป ${ph.removed}` : '');
      UI.toast(`รีเซ็ตแล้ว: ประวัติ ${res.headers||0} · มอบหมาย ${res.schedules||0}${phTxt} (สำรองไว้ที่ *_backup)`, 'success', 6000);
    } else {
      if (err) err.textContent = res.error || 'รีเซ็ตไม่สำเร็จ';
    }
  } catch(e) {
    UI.hideLoading();
    if (err) err.textContent = 'เกิดข้อผิดพลาด: ' + e.message;
  }
  if (btn) btn.disabled = false;
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
  // บางคนตรวจแล้วแต่ยังไม่ครบทีม (ส่วน H) — เกินกำหนดสำคัญกว่า จึงเช็กก่อน
  if (d < today) return 'overdue';
  if (a.Sched_Status === 'Partial') return 'partial';
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
    partial:    { label:'บางส่วน',   icon:'bi-hourglass-split' },
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
      // ความก้าวหน้ารายคน — โชว์เมื่อมอบหมายหลายคนและยังไม่ครบ (ส่วน H)
      const prog = (area.Required_N > 0 && area.Done_N < area.Required_N && area.Done_N > 0)
        ? ` · ตรวจแล้ว ${area.Done_N}/${area.Required_N}` : '';
      body = `
        <div class="card-auditor-chips">${chips}</div>
        <div class="card-date-row"><i class="bi bi-calendar3"></i>${dateStr}${area.Audit_Round ? ' · ' + escHtml(area.Audit_Round) : ''}${prog}</div>
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

  // ---------------------------------------------------------------
  // KPI — หน่วยนับคือ "ช่องงาน" (พื้นที่ × ผู้ตรวจ 1 คน) ไม่ใช่ "แถว"
  //
  // เดิมนับแถว: พื้นที่ A มอบหมาย 2 คน คนแรกเสร็จ → 1/1 = 100%
  // ตอนนี้:                                        → 1/2 = 50%   (ส่วน H)
  // ---------------------------------------------------------------
  const total   = rows.reduce((n, s) => n + (s.Required_N || 0), 0);
  const done    = rows.reduce((n, s) => n + (s.Done_N     || 0), 0);
  const overdue = rows.reduce((n, s) => n + (s.Overdue
                    ? (s.Required_N || 0) - (s.Done_N || 0) : 0), 0);
  const prog    = total ? Math.round(done * 100 / total) : 0;
  setEl('asgTotal', total); setEl('asgDone', done);
  setEl('asgPending', total - done); setEl('asgOverdue', overdue);
  setEl('asgProgPct', prog + '%');
  const fill = document.getElementById('asgProgFill'); if (fill) fill.style.width = prog + '%';

  // ---------------------------------------------------------------
  // คะแนนที่ผู้ตรวจ "ให้" — จับคู่ด้วย (ผู้ตรวจ | schedule) ตรง ๆ
  //
  // เดิมจับคู่ด้วย (ผู้ตรวจ | พื้นที่) แล้วเดาว่าอันล่าสุดคือของรอบที่แสดง
  // เพราะ audit_headers ไม่มี schedule_id/audit_round → เป็นที่มาของบั๊ก
  // "การ์ดโชว์ 100% แต่ pill โชว์ 94%"
  // ตอนนี้ผูกตรงแล้ว ไม่ต้องเดา ไม่ต้องมี inScope
  //
  // ⚠️ data.headers ถูกจำกัดขอบเขตที่ query แล้ว:
  //    admin = ทุกคน · auditor = ของตัวเองเท่านั้น
  //    → เพื่อนร่วมทีมจะขึ้น "เสร็จ" แต่ไม่มี % (ตามนโยบาย 4 ส.ค.)
  // ---------------------------------------------------------------
  const schedIds = new Set(rows.map(s => s.Schedule_ID));
  const scoreLU = {};
  data.headers.forEach(h => {
    if (!h.Schedule_ID || !schedIds.has(h.Schedule_ID)) return;   // ตรวจนอกรอบ/นอกขอบเขต
    scoreLU[h.Auditor_ID + '|' + h.Schedule_ID] = h.Percent;
  });

  const cont = document.getElementById('asgAuditors');
  const hint = document.getElementById('asgHint');
  if (!cont) return;

  const isStaff = !!(data && data.isStaff);
  const myId    = (AppState.user && AppState.user.userId) || '';

  // group ตาม "ผู้ตรวจที่ต้องตรวจจริง" (Slots — ตัดคนที่ถูกระงับออกแล้ว)
  // auditor เห็นการ์ดของตัวเองใบเดียว · สถานะเพื่อนร่วมทีมอยู่ในรายละเอียดข้างใน
  const byAud = {};
  rows.forEach(s => (s.Slots || []).forEach(sl => {
    if (!isStaff && sl.Auditor_ID !== myId) return;
    (byAud[sl.Auditor_ID] = byAud[sl.Auditor_ID]
      || { id:sl.Auditor_ID, name:sl.Name, scheds:[] }).scheds.push(s);
  }));

  const auditors = Object.values(byAud).map(a => {
    const scores = a.scheds
      .map(s => scoreLU[a.id + '|' + s.Schedule_ID])
      .filter(v => typeof v === 'number');
    const avg  = scores.length ? Math.round(scores.reduce((x,y)=>x+y,0)/scores.length) : null;
    const done = a.scheds.filter(s =>
      (s.Slots || []).some(sl => sl.Auditor_ID === a.id && sl.Done)).length;
    return { ...a, total:a.scheds.length, done, avg,
             prog:a.scheds.length ? Math.round(done * 100 / a.scheds.length) : 0 };
  }).sort((x,y) => (y.avg ?? -1) - (x.avg ?? -1));

  setEl('asgAudTitle', isStaff ? 'รายผู้ตรวจ' : 'งานของฉัน');

  if (!auditors.length) {
    cont.innerHTML = `<p class="text-muted text-center" style="padding:16px 0">ยังไม่มีงานที่มอบหมายในเงื่อนไขนี้</p>`;
    if (hint) hint.style.display = 'none';
    return;
  }
  if (hint) hint.style.display = isStaff ? 'block' : 'none';

  const cls = p => p==null ? 'muted' : (p>=90 ? 'ok' : p>=75 ? 'warn' : 'danger');
  cont.innerHTML = auditors.map((a, idx) => {
    const detail = a.scheds.map(s => {
      const mySlot = (s.Slots || []).find(sl => sl.Auditor_ID === a.id) || {};
      let badge;
      if (mySlot.Done) {
        const pct = scoreLU[a.id + '|' + s.Schedule_ID];
        badge = `<span class="asg-badge ok">เสร็จ${typeof pct === 'number' ? ' · ' + pct + '%' : ''}</span>`;
      } else {
        badge = `<span class="asg-badge ${s.Overdue ? 'danger' : 'warn'}">ค้าง${s.Overdue ? ' · เกินกำหนด' : ''}</span>`;
      }
      const loc = [s.Area_Name, s.Plant_Name, s.Audit_Round].filter(Boolean).join(' · ');

      // พื้นที่ที่มอบหมายหลายคน → แสดงสถานะทีม (ไม่มี % ของคนอื่น)
      let team = '';
      if ((s.Required_N || 0) > 1) {
        const others = (s.Slots || []).filter(sl => sl.Auditor_ID !== a.id)
          .map(sl => `${sl.Done ? '✅' : '⏳'} ${escHtml(sl.Name)}`).join(' · ');
        team = `<div class="asg-team">ทีม ${s.Done_N}/${s.Required_N} · ${others}</div>`;
      }
      return `<div class="asg-drow"><span class="asg-da">${escHtml(loc)}</span>${badge}</div>${team}`;
    }).join('');
    return `
      <div class="asg-aud">
        <div class="asg-aud-head" onclick="toggleAssign(${idx})">
          <span class="asg-chev" id="asgchev-${idx}">▸</span>
          <div style="flex:1;min-width:0">
            <div class="asg-aud-name">${escHtml(a.name)}</div>
            <div class="asg-aud-meta">${a.total} พื้นที่ · เสร็จ ${a.done}/${a.total}</div>
          </div>
          <div class="asg-give">
            <div class="asg-give-lb">คะแนนที่ให้</div>
            <span class="asg-pill ${cls(a.avg)}">${a.avg==null ? '—' : a.avg + '%'}</span>
          </div>
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
    case 'mytasks':            initMyTasks();   break;
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
