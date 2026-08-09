-- =====================================================================
-- 5S Audit System — PATCHES (รวม migration ทั้งหมดเป็นไฟล์เดียว)
-- =====================================================================
-- ไฟล์นี้เป็นการเปลี่ยนแปลง DB สะสมทั้งหมด "หลังจาก" schema.sql ตัวหลัก
-- เขียนแบบ idempotent — รันซ้ำทั้งไฟล์ได้ไม่พัง
--
-- วิธีใช้:
--   • DB ใหม่เปล่า  → รัน schema.sql → seed_master.sql (ครบแล้ว ไม่ต้องรันไฟล์นี้)
--   • DB ที่ใช้อยู่  → รันไฟล์นี้เพื่ออัปเดตให้ทันสมัย
--
-- ต่อไปมีการแก้ DB เพิ่ม → เพิ่ม statement ต่อท้ายไฟล์นี้ (ไม่ต้องสร้างไฟล์ใหม่)
-- =====================================================================


-- =====================================================================
-- ส่วน A: โครงสร้าง (STRUCTURE) — รันซ้ำปลอดภัย 100%
-- =====================================================================

-- A1) audit_details: คอลัมน์ na (ไม่มีในพื้นที่ → ตัดออกจากการคำนวณคะแนน)
alter table public.audit_details
  add column if not exists na boolean not null default false;

-- A2) Trigger คำนวณคะแนน header (เวอร์ชันล่าสุด)
--     - ตัด na ออกจากทั้ง total และ max (filter where not na)
--     - cast สถานะเป็น enum audit_status (กัน error 42804)
create or replace function public.recalc_audit_header()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_audit uuid := coalesce(new.audit_id, old.audit_id);
  v_total int;
  v_max   int;
  v_pct   numeric(5,2);
begin
  select coalesce(sum(d.score)     filter (where not d.na), 0),
         coalesce(sum(c.max_score) filter (where not d.na), 0)
    into v_total, v_max
  from public.audit_details d
  join public.criteria c on c.criteria_id = d.criteria_id
  where d.audit_id = v_audit;

  v_pct := case when v_max > 0 then round(v_total::numeric * 100 / v_max, 2) else 0 end;

  update public.audit_headers
     set total_score = v_total,
         max_score   = v_max,
         percent     = v_pct,
         status = (case
                    when v_max = 0        then 'pending'
                    when v_pct >= 90      then 'excellent'
                    when v_pct >= 75      then 'good'
                    else 'need_improvement'
                  end)::audit_status
   where audit_id = v_audit;

  return null;
end;
$$;

-- A3) [ยกเลิกแล้ว — ดูส่วน G4] RLS ให้ auditor อัปเดตสถานะงานตัวเอง
--
-- ⚠️ policy นี้ถูก DROP ทิ้งในส่วน G4 (5 ส.ค. 2026) เพราะกว้างเกินเจตนา:
--    `for update` ไม่จำกัดคอลัมน์ → auditor แก้ audit_date หนีเกินกำหนด
--    หรือถอดคนอื่นออกจาก auditor_ids ได้ (BOPLA)
--    แทนด้วย RPC public.mark_schedule_done(uuid) ที่แก้ได้แค่ status
--
-- คงบล็อกนี้ไว้เป็นคอมเมนต์เพื่อรักษาลำดับประวัติของไฟล์
-- (ถ้า uncomment จะถูก G4 ลบทิ้งอยู่ดี เพราะไฟล์รันจากบนลงล่าง)
--
-- drop policy if exists schedules_auditor_update on public.schedules;
-- create policy schedules_auditor_update on public.schedules
--   for update using (auth.uid() = any(auditor_ids)) with check (auth.uid() = any(auditor_ids));


-- =====================================================================
-- ส่วน B: ข้อมูล (DATA) — ตั้งค่าครั้งเดียว
--   ระวัง: ถ้าภายหลังแก้ค่าพวกนี้ด้วยมือ อย่ารันส่วน B ซ้ำ (จะทับค่ากลับ)
-- =====================================================================

-- B1) กลุ่มรายงานส่วนกลาง: Cafeteria (CAF) + Maintenance & Utility (MTN)
insert into public.plants (plant_id, plant_name, status) values
  ('CAF', 'Cafeteria',            'active'),
  ('MTN', 'Maintenance & Utility','active')
on conflict (plant_id) do nothing;

insert into public.areas (area_id, plant_id, area_name, area_type, status) values
  ('CAF-CF', 'CAF', 'โรงอาหาร',       'cafeteria',   'active'),
  ('MTN-MU', 'MTN', 'ช่าง/ยูทิลิตี้', 'maintenance', 'active')
on conflict (area_id) do nothing;

-- B2) ปิดพื้นที่โรงอาหาร/ช่าง เดิมของแต่ละโรงงาน (ย้ายไปกลุ่มส่วนกลางแล้ว)
update public.areas set status = 'inactive'
 where area_id in ('SUP-CF','POC-CF','NIF-CF','SUP-MU','POC-MU','NIF-MU');

-- B3) แต่ละโรงงานเหลือ WH/PR/Office ชั้นตัวแทนชั้นเดียว (SUP=F1, POC=F2, NIF=F3)
update public.areas set status = 'inactive'
 where area_id in (
   'SUP-WH-F2','SUP-WH-F3','SUP-PR-F2','SUP-PR-F3','SUP-OF-F2','SUP-OF-F3',
   'POC-WH-F1','POC-WH-F3','POC-PR-F1','POC-PR-F3','POC-OF-F1','POC-OF-F3',
   'NIF-WH-F1','NIF-WH-F2','NIF-PR-F1','NIF-PR-F2','NIF-OF-F1','NIF-OF-F2'
 );


-- =====================================================================
-- ส่วน C: ระบบ Audit Log (ความปลอดภัยหลังบ้าน) — โครงสร้าง รันซ้ำปลอดภัย
-- =====================================================================

-- C1) ขยายตาราง audit_logs (ของเดิม: log_id, user_id, action, detail, created_at)
alter table public.audit_logs
  add column if not exists entity    text,
  add column if not exists entity_id text,
  add column if not exists old_data  jsonb,
  add column if not exists new_data  jsonb;
create index if not exists idx_logs_created on public.audit_logs(created_at desc);
create index if not exists idx_logs_entity  on public.audit_logs(entity);

-- C2) ฟังก์ชัน log กลาง (security definer → เขียนได้โดยไม่ติด RLS)
--     รับชื่อคอลัมน์ PK ของตารางผ่าน argument เพื่อดึง entity_id
create or replace function public.log_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_pk  text  := tg_argv[0];
  v_id  text  := coalesce(v_new ->> v_pk, v_old ->> v_pk);
begin
  insert into public.audit_logs(user_id, action, entity, entity_id, old_data, new_data, detail)
  values (auth.uid(), tg_op, tg_table_name, v_id, v_old, v_new, tg_table_name || ' ' || tg_op);
  return null;   -- AFTER trigger
end;
$$;

-- C3) ติด trigger ตารางที่ต้องเฝ้า
--     master/config + ผู้ใช้ → เก็บครบ INSERT/UPDATE/DELETE
drop trigger if exists trg_log_profiles  on public.profiles;
create trigger trg_log_profiles  after insert or update or delete on public.profiles  for each row execute function public.log_activity('id');
drop trigger if exists trg_log_schedules on public.schedules;
create trigger trg_log_schedules after insert or update or delete on public.schedules for each row execute function public.log_activity('schedule_id');
drop trigger if exists trg_log_areas     on public.areas;
create trigger trg_log_areas     after insert or update or delete on public.areas     for each row execute function public.log_activity('area_id');
drop trigger if exists trg_log_criteria  on public.criteria;
create trigger trg_log_criteria  after insert or update or delete on public.criteria  for each row execute function public.log_activity('criteria_id');
--     audit_headers → เก็บเฉพาะ "สร้าง (INSERT)" กับ "ลบ (DELETE)"
--     (เลี่ยง noise จาก trigger คำนวณคะแนนที่ update header ถี่)
drop trigger if exists trg_log_headers    on public.audit_headers;
create trigger trg_log_headers   after insert or delete on public.audit_headers for each row execute function public.log_activity('audit_id');

-- C4) Hardening: append-only — ห้ามแก้/ลบ log (แม้แต่ admin) กันการลบร่องรอย
revoke update, delete on public.audit_logs from anon, authenticated;


-- =====================================================================
-- ส่วน D: RPC รีเซ็ตข้อมูล (สำหรับปุ่มในแอป — admin เท่านั้น)
-- =====================================================================
-- ลบ: ประวัติการตรวจ+คะแนน (audit_headers/details) + การมอบหมาย (schedules) + รูปใน Storage
-- เก็บ: profiles, audit_logs, plants/areas/criteria
-- สำรองอัตโนมัติลงตาราง *_backup ก่อนลบ (กู้คืนได้)
-- ตัวฟังก์ชันเช็คสิทธิ์ admin เอง จึงไม่ต้องเปิดสิทธิ์ลบให้ client
create or replace function public.admin_reset_data()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_h int; v_d int; v_s int;
  v_uid uuid := auth.uid();
begin
  -- ⚠️ ต้อง cast เป็น text ก่อนเทียบ
  -- auth_role() คืนชนิด user_role (enum) · เขียน coalesce(auth_role(), '') จะพัง
  -- เพราะ Postgres ต้องแปลง '' ให้เป็น user_role เพื่อให้ชนิดตรงกับ argument แรก
  -- แต่ '' ไม่ใช่ค่าที่ถูกต้องของ enum → error: invalid input value for enum user_role: ""
  -- (บั๊กนี้ทำให้ปุ่มรีเซ็ตไม่เคยทำงานได้เลย — พบ 5 ส.ค. 2026)
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'permission denied: admin only';
  end if;

  select count(*) into v_h from public.audit_headers;
  select count(*) into v_d from public.audit_details;
  select count(*) into v_s from public.schedules;

  -- สำรอง (เขียนทับ backup เดิม)
  drop table if exists public.audit_headers_backup;
  drop table if exists public.audit_details_backup;
  drop table if exists public.schedules_backup;
  create table public.audit_headers_backup as table public.audit_headers;
  create table public.audit_details_backup as table public.audit_details;
  create table public.schedules_backup     as table public.schedules;

  -- ⚠️ ปิดตารางสำรองไม่ให้เข้าถึงผ่าน API — สำคัญมาก
  -- Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ตารางใหม่ใน public grant ให้ anon/authenticated
  -- อัตโนมัติ → ถ้าไม่ revoke ผู้ใช้ที่ล็อกอินคนไหนก็อ่านผลตรวจทั้งบริษัทจากตารางสำรองได้
  -- (bypass RLS ของตารางจริง) · enable RLS โดยไม่มี policy = ล็อกตาย เข้าถึงผ่าน API ไม่ได้เลย
  -- การกู้คืนทำผ่าน SQL Editor (รันเป็น role postgres ซึ่ง bypass RLS) จึงไม่กระทบ
  revoke all on public.audit_headers_backup from anon, authenticated;
  revoke all on public.audit_details_backup from anon, authenticated;
  revoke all on public.schedules_backup     from anon, authenticated;
  alter table public.audit_headers_backup enable row level security;
  alter table public.audit_details_backup enable row level security;
  alter table public.schedules_backup     enable row level security;

  -- ลบ (truncate ไม่ปลุก trigger log)
  truncate table public.audit_details, public.audit_headers, public.schedules restart identity cascade;

  -- ⚠️ ไม่ลบรูปที่นี่ — Supabase บล็อก DELETE ตรงบน storage.objects แล้ว
  --    error: Direct deletion from storage tables is not allowed. Use the Storage API instead.
  --    (พบ 5 ส.ค. 2026 · ถ้าใส่ไว้ ฟังก์ชันจะ raise แล้ว rollback ทั้ง transaction
  --     ทำให้รีเซ็ตไม่สำเร็จเลย)
  --    การลบรูปย้ายไปทำที่ฝั่ง client ผ่าน Storage API ก่อนเรียกฟังก์ชันนี้
  --    ดู confirmReset() ใน js/app.js

  -- บันทึกการรีเซ็ตลง audit_logs (เก็บ log ไว้)
  insert into public.audit_logs(user_id, action, entity, detail)
  values (v_uid, 'RESET', 'system',
          format('รีเซ็ตข้อมูล: ประวัติ %s / รายละเอียด %s / มอบหมาย %s + รูปภาพ (สำรองที่ *_backup)', v_h, v_d, v_s));

  return jsonb_build_object('success', true, 'headers', v_h, 'details', v_d, 'schedules', v_s);
end;
$$;

grant execute on function public.admin_reset_data() to authenticated;


-- =====================================================================
-- ส่วน D: KPI ภาพรวมทั้งบริษัท — เปิดสิทธิ์ "อ่าน" ให้ผู้ล็อกอินทุกคน
-- (การ "เขียน" ยังจำกัดเจ้าของ header / admin เหมือนเดิม)
-- รันซ้ำได้ (drop if exists ก่อน create)
-- =====================================================================

-- D1) audit_headers: ทุกคนที่ล็อกอินอ่านได้ → dashboard/home/history เห็นทั้งบริษัท
drop policy if exists headers_select on public.audit_headers;
create policy headers_select on public.audit_headers
  for select using (auth.uid() is not null);

-- D2) audit_details: เปิด "อ่าน" ให้ทุกคนที่ล็อกอิน (ดูรายละเอียดผลตรวจของทุกคน)
--     การเขียนยังคุมด้วย policy details_all เดิม (เจ้าของ header/staff เท่านั้น)
drop policy if exists details_select_all on public.audit_details;
create policy details_select_all on public.audit_details
  for select using (auth.uid() is not null);

-- D3) profiles: เปิด "อ่าน" ให้ทุกคนที่ล็อกอิน → แสดงชื่อผู้ตรวจร่วมในตาราง/ประวัติ
--     การแก้ไขยังเป็นของ admin เท่านั้น (policy profiles_admin_all เดิม)
--     หมายเหตุ: ผู้ใช้ภายในจะอ่าน profiles ได้ทั้งตาราง (รวม email/role/department)
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (auth.uid() is not null);


-- =====================================================================
-- ส่วน F: ปิดช่องตารางสำรอง *_backup ไม่ให้เข้าถึงผ่าน API
-- =====================================================================
-- ที่มา: รายงานประเมินความปลอดภัย 3 ส.ค. 2026
--
-- ปัญหา: `create table X_backup as table X` สร้างตารางใหม่ใน schema public
--   ซึ่ง Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ grant แก่ anon/authenticated อัตโนมัติ
--   และ RLS ของตารางใหม่ "ปิด" โดยปริยาย
--   → ผู้ใช้ที่ล็อกอินคนไหนก็ SELECT ผลตรวจทั้งบริษัทจากตารางสำรองได้
--     (bypass RLS ทั้งหมดที่ตั้งไว้บน audit_headers / audit_details / schedules)
--
-- แก้ 2 ที่:
--   1. ในตัวฟังก์ชัน admin_reset_data() (ส่วน D) — ล็อกทันทีหลังสร้าง
--   2. บล็อกด้านล่าง — ล็อกตารางสำรองที่ "มีอยู่แล้ว" เผื่อเคยรันเวอร์ชันเก่า
--      หรือเคยรัน reset_test_data.sql มาก่อน
--
-- ทำไม enable RLS โดยไม่สร้าง policy: ตารางสำรองมีไว้กู้คืนผ่าน SQL Editor เท่านั้น
--   ไม่มีหน้าไหนในแอปอ่าน → ล็อกตายคือ least privilege ที่ถูกต้อง
--   SQL Editor รันเป็น role postgres ซึ่ง bypass RLS จึงกู้คืนได้ปกติ
--
-- รันซ้ำได้ 100%
-- =====================================================================

do $$
declare
  t record;
  n int := 0;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like '%\_backup'      -- escape _ เพราะเป็น wildcard ใน LIKE
    order by tablename
  loop
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
    execute format('alter table public.%I enable row level security',  t.tablename);
    n := n + 1;
    raise notice 'ล็อกตารางสำรอง: public.%', t.tablename;
  end loop;

  if n = 0 then
    raise notice 'ไม่พบตาราง *_backup — ยังไม่เคยรีเซ็ตข้อมูล (ปกติ)';
  else
    raise notice 'ล็อกเสร็จ % ตาราง', n;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- ตรวจผล: ตารางสำรองทุกตัวต้อง rls=true และ authenticated ต้องไม่มีสิทธิ์
-- ---------------------------------------------------------------------
-- select t.tablename,
--        t.rowsecurity as rls,
--        coalesce(string_agg(g.privilege_type, ',' order by g.privilege_type), '— ไม่มีสิทธิ์ ✓') as authenticated_grants
--   from pg_tables t
--   left join information_schema.role_table_grants g
--          on g.table_schema = t.schemaname
--         and g.table_name   = t.tablename
--         and g.grantee      = 'authenticated'
--  where t.schemaname = 'public' and t.tablename like '%\_backup'
--  group by t.tablename, t.rowsecurity
--  order by t.tablename;


-- =====================================================================
-- ส่วน G: จัดระเบียบสิทธิ์ให้เหลือ 3 roles + ล็อกผลตรวจ (5 ส.ค. 2026)
-- =====================================================================
-- ที่มา: ตัดสินใจร่วมกันว่าระบบใช้แค่ 3 roles
--   👑 admin   — จัดการทุกอย่าง · แก้ผลตรวจได้ตลอด
--   📋 auditor — ตรวจ 5ส ได้ · ดูผลตรวจทั้งบริษัท · แก้ผลตัวเองไม่ได้หลัง submit
--   👁️ viewer  — ผู้บริหาร ดูได้ทุกอย่าง แต่ตรวจไม่ได้ แก้ไม่ได้
--
-- ⚠️ ต้องรัน "ขั้นที่ 1" (alter type) แยกก่อน แล้วค่อยรันส่วนที่เหลือ
--    เพราะค่า enum ที่เพิ่งเพิ่มใช้งานใน transaction เดียวกันไม่ได้
-- =====================================================================


-- ---------------------------------------------------------------------
-- G0) [ขั้นที่ 1 — รันแยกก่อน] เพิ่ม viewer เข้า enum
-- ---------------------------------------------------------------------
-- manager / area_manager ยังอยู่ใน enum เพราะ Postgres ลบค่าออกไม่ได้
-- แต่จะถูกเอาออกจาก dropdown ใน users.html → เลือกไม่ได้อีก
-- คนที่เป็น role เก่าอยู่ยังใช้งานได้ต่อ (ได้สิทธิ์เท่า auditor)
--
--   alter type user_role add value if not exists 'viewer';
--
-- ↑ uncomment แล้วรันบรรทัดนี้เดี่ยว ๆ ก่อน จากนั้นรันส่วนที่เหลือด้านล่าง


-- ---------------------------------------------------------------------
-- G1) viewer ตรวจ 5ส ไม่ได้ — จุดต่างหลักจาก auditor
-- ---------------------------------------------------------------------
-- เดิม: with check (auditor_id = auth.uid() or is_staff())
--   is_staff() = admin+manager → ยังเปิดช่องให้ manager ปลอม auditor_id เป็นคนอื่นได้
-- ใหม่: บังคับ auditor_id = ตัวเอง (ปิด BOPLA) และ viewer ห้าม insert
drop policy if exists headers_insert on public.audit_headers;
create policy headers_insert on public.audit_headers
  for insert with check (
    auditor_id = auth.uid()
    and coalesce(public.auth_role()::text, '') <> 'viewer'
  );


-- ---------------------------------------------------------------------
-- G2) 🔒 ล็อกผลตรวจหลัง submit — auditor แก้ย้อนหลังไม่ได้
-- ---------------------------------------------------------------------
alter table public.audit_headers
  add column if not exists locked_at timestamptz;

-- auditor แก้ได้เฉพาะใบที่ยังไม่ล็อก · admin แก้ได้ตลอด
drop policy if exists headers_update on public.audit_headers;
create policy headers_update on public.audit_headers
  for update using (
    (auditor_id = auth.uid() and locked_at is null)
    or coalesce(public.auth_role()::text, '') = 'admin'
  );

-- ลบได้เฉพาะ admin (เดิม is_staff() หรือเจ้าของ — เปิดกว้างเกินสำหรับผลตรวจที่ล็อกแล้ว)
drop policy if exists headers_delete on public.audit_headers;
create policy headers_delete on public.audit_headers
  for delete using (
    coalesce(public.auth_role()::text, '') = 'admin'
    or (auditor_id = auth.uid() and locked_at is null)
  );

-- กันแก้/ลบรายละเอียดข้อของ audit ที่ล็อกแล้ว
-- (RLS คุมได้แค่ "แถวไหน" ไม่ได้คุมข้ามตาราง จึงต้องใช้ trigger)
create or replace function public.chk_header_locked()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_locked timestamptz;
begin
  select h.locked_at into v_locked
    from public.audit_headers h
   where h.audit_id = coalesce(new.audit_id, old.audit_id);

  if v_locked is not null and coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'ผลการตรวจนี้ถูกล็อกแล้ว แก้ไขไม่ได้ (ติดต่อ Admin)';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_chk_locked on public.audit_details;
create trigger trg_chk_locked
before insert or update or delete on public.audit_details
for each row execute function public.chk_header_locked();


-- ---------------------------------------------------------------------
-- G3) log การแก้คะแนน — เดิมไม่มีร่องรอยเลย
-- ---------------------------------------------------------------------
drop trigger if exists trg_log_details on public.audit_details;
create trigger trg_log_details
after update of score, na, remark or delete on public.audit_details
for each row execute function public.log_activity('detail_id');


-- ---------------------------------------------------------------------
-- G4) แก้ BOPLA ของ schedules — auditor แก้ได้แค่สถานะ
-- ---------------------------------------------------------------------
-- เดิม: for update using (auth.uid() = any(auditor_ids))  ← ไม่จำกัดคอลัมน์
--   → auditor เลื่อน audit_date หนีเกินกำหนด / ถอดคนอื่นออกจาก auditor_ids ได้
drop policy if exists schedules_auditor_update on public.schedules;

-- ⚠️ mark_schedule_done() ถูกยกเลิกในส่วน H (5 ส.ค. 2026 เย็น)
--    เพราะ "ปิดงาน" ต้องดูรายคน ไม่ใช่ปิดทั้งแถว — ดู H4
--    เก็บโค้ดเดิมไว้เป็นสำเนาสำหรับย้อนกลับ (ดูท้ายส่วน H)


-- ---------------------------------------------------------------------
-- G5) is_staff() — เหลือแค่ admin (manager ไม่ใช้แล้ว)
-- ---------------------------------------------------------------------
-- เดิม admin+manager · ตอนนี้ระบบใช้ 3 roles ไม่มี manager
-- คงฟังก์ชันไว้เพื่อไม่ให้ policy อื่นที่อ้างถึงพัง แต่เปลี่ยนความหมาย
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.auth_role()::text = 'admin', false);
$$;


-- ---------------------------------------------------------------------
-- ตรวจผลหลังรัน
-- ---------------------------------------------------------------------
-- select unnest(enum_range(null::user_role))::text as roles_ที่มี;
--
-- select policyname, cmd, qual, with_check from pg_policies
--  where schemaname='public' and tablename in ('audit_headers','schedules')
--  order by tablename, policyname;
--
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='audit_headers' and column_name='locked_at';
--
-- select tgname from pg_trigger
--  where tgrelid='public.audit_details'::regclass and not tgisinternal;


-- =====================================================================
-- ส่วน H: ผู้ตรวจหลายคนต่อพื้นที่ — สถานะรายคน  (5 ส.ค. 2026 เย็น)
-- =====================================================================
-- ปัญหา: schedules 1 แถวมี auditor_ids หลายคน แต่ status ช่องเดียว
--   → คนแรก submit แล้ว status='completed' → คนที่ 2 ตรวจไม่ได้
--   → KPI ผิด (นับแถว ไม่ใช่นับคน) · ปุ่ม "ดูผล" เปิดผลของคนอื่น
--
-- แนวทาง: ผลตรวจผูกกับงานที่มอบหมายตรง ๆ แล้วคำนวณสถานะจากผลตรวจจริง
--   "auditor X ทำงาน S เสร็จ ⟺ มี audit_headers ที่ schedule_id=S และ auditor_id=X"
--   ไม่เก็บสถานะรายคนไว้ที่ไหน → ข้อมูลขัดกันเองไม่ได้
--
-- ⚠️ รันส่วนนี้ได้ทั้งบล็อกในครั้งเดียว (ไม่มี alter type แบบส่วน G)
-- =====================================================================


-- ---------------------------------------------------------------------
-- H1) เส้นเชื่อม: ผลตรวจ → งานที่มอบหมาย
-- ---------------------------------------------------------------------
-- on delete set null: admin ลบงานที่มอบหมายได้ ผลตรวจไม่หายไปด้วย
alter table public.audit_headers
  add column if not exists schedule_id uuid references public.schedules(schedule_id) on delete set null;

-- audit_round เก็บซ้ำในตัว header ไม่ join เอาตอนอ่าน เพราะ:
--   1. schedule_id เป็น null ได้ (งานถูกลบ) → ถ้า join จะไม่รู้ว่ารอบไหน
--   2. admin แก้ audit_round ของงานทีหลัง ประวัติที่ตรวจไปแล้วต้องไม่เปลี่ยนตาม
alter table public.audit_headers
  add column if not exists audit_round text;

create index if not exists idx_headers_schedule on public.audit_headers(schedule_id);
create index if not exists idx_headers_round    on public.audit_headers(audit_round);

-- 1 คนตรวจ 1 งานได้ครั้งเดียว (partial — ตรวจนอกรอบที่ schedule_id is null ไม่ติด)
-- รอบ 1 / รอบ 2 ของพื้นที่เดียวกันเป็น schedule คนละตัว → ตรวจได้ทั้งสองรอบ
create unique index if not exists headers_one_per_schedule
  on public.audit_headers(schedule_id, auditor_id)
  where schedule_id is not null;


-- ---------------------------------------------------------------------
-- H2) BEFORE INSERT: ปิด BOPLA + ก๊อป audit_round
-- ---------------------------------------------------------------------
-- schedule_id มาจาก client (getParam('scheduleId')) → เชื่อไม่ได้
-- ถ้าไม่ตรวจ auditor จะใส่ schedule_id ของงานคนอื่นแล้วปิดงานคนอื่นได้
create or replace function public.chk_header_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_round text;
begin
  if new.schedule_id is null then
    return new;                       -- ตรวจนอกรอบ (เลือกพื้นที่เอง) — ปล่อยผ่าน
  end if;

  select auditor_ids, audit_round into v_ids, v_round
    from public.schedules
   where schedule_id = new.schedule_id;

  if v_ids is null then
    raise exception 'ไม่พบงานที่มอบหมายนี้';
  end if;

  -- admin ก็ปลอมไม่ได้ — auditor_id ต้องอยู่ในรายชื่อที่ถูกมอบหมายจริง
  if not (new.auditor_id = any(v_ids)) then
    raise exception 'คุณไม่ได้รับมอบหมายงานนี้';
  end if;

  new.audit_round := v_round;         -- ก๊อปไว้ ไม่ join ตอนอ่าน
  return new;
end $$;

drop trigger if exists trg_chk_header_schedule on public.audit_headers;
create trigger trg_chk_header_schedule
before insert on public.audit_headers
for each row execute function public.chk_header_schedule();


-- ---------------------------------------------------------------------
-- H3) view schedule_progress — ความจริงเรื่อง "ใครเสร็จ / ปิดงานหรือยัง"
-- ---------------------------------------------------------------------
-- นิยามที่เดียว ทุกหน้าอ่านจากนี่
-- (เคยเจอบั๊ก "pill 94% แต่ badge 100%" จากการคำนวณเลขเดียวกัน 2 ที่ — ไม่ทำซ้ำ)
--
-- ⚠️ security_invoker = true จำเป็นมาก
--    ถ้าไม่ใส่ view จะรันด้วยสิทธิ์เจ้าของ → RLS ของ schedules ไม่ทำงาน
--    → auditor เห็นงานของทุกคน (ย้อนนโยบายความเป็นส่วนตัว 4 ส.ค.)
--
-- required = ที่มอบหมาย ∩ active   (คนที่ถูกระงับไม่นับเป็น "ต้องตรวจ")
-- done ⊆ required เสมอ            (admin ถอดคนออกหลังเขาตรวจแล้ว ตัวเลขไม่เกิน 100%)
drop view if exists public.schedule_progress;
create view public.schedule_progress
with (security_invoker = true) as
select
  s.schedule_id,
  s.plant_id,
  s.area_id,
  s.audit_date,
  s.audit_round,
  s.auditor_ids,
  coalesce(r.required_ids, '{}'::uuid[])          as required_ids,
  coalesce(array_length(r.required_ids, 1), 0)    as required_n,
  coalesce(d.done_ids, '{}'::uuid[])              as done_ids,
  coalesce(array_length(d.done_ids, 1), 0)        as done_n,
  (
    coalesce(array_length(r.required_ids, 1), 0) > 0
    and coalesce(array_length(d.done_ids, 1), 0)
      = coalesce(array_length(r.required_ids, 1), 0)
  )                                               as is_completed
from public.schedules s
left join lateral (
  select array_agg(p.id order by p.name) as required_ids
    from public.profiles p
   where p.id = any(s.auditor_ids)
     and p.status = 'active'
) r on true
left join lateral (
  select array_agg(p.id order by p.name) as done_ids
    from public.profiles p
   where p.id = any(s.auditor_ids)
     and p.status = 'active'
     and exists (
       select 1 from public.audit_headers h
        where h.schedule_id = s.schedule_id
          and h.auditor_id  = p.id
          -- ⚠️ "มี header" ยังไม่พอ — ต้อง "submit เสร็จแล้ว"
          -- submitAuditHeader สร้าง header ก่อน แล้วส่ง details เป็นชุด ๆ ทีหลัง
          -- ถ้ายังส่ง details ไม่ครบ header จะค้างอยู่ที่ status='pending'
          -- (recalc_audit_header: v_max = 0 → 'pending')
          --
          -- locked_at  → finalizeAudit ตั้งเป็นขั้นสุดท้ายของการ submit ที่สำเร็จ
          -- status<>pending → เผื่อกรณี lock ล้มแต่คะแนนถูกคำนวณแล้ว
          --                   (finalizeAudit คืน success แม้ตั้ง lock ไม่ผ่าน)
          and (h.locked_at is not null or h.status <> 'pending')
     )
) d on true;

grant select on public.schedule_progress to authenticated;


-- ---------------------------------------------------------------------
-- H4) sync schedules.status — ให้คอลัมน์ไม่โกหกเวลา query จาก SQL Editor
-- ---------------------------------------------------------------------
-- view คือความจริง · คอลัมน์นี้เป็นสำเนาเพื่อความสะดวก
--
-- ⚠️ เขียนเฉพาะตอน "ค่าเปลี่ยนจริง" (status is distinct from ...) เพราะ
--    trg_log_schedules เป็น `after insert or update or delete` → ถ้าเขียนทุกครั้ง
--    จะได้ log ขยะ 1 แถวต่อการ submit 1 ครั้ง
--    (ปัญหาเดียวกับที่ trg_log_headers ตั้งใจเลี่ยงไว้ — ดูคอมเมนต์ C3)
--    เขียนเฉพาะตอนเปลี่ยน → log ที่ได้คือ "งานนี้ปิดแล้ว" ซึ่งมีประโยชน์
create or replace function public.sync_schedule_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sid uuid; v_done boolean;
begin
  v_sid := coalesce(new.schedule_id, old.schedule_id);
  if v_sid is null then return coalesce(new, old); end if;

  select sp.is_completed into v_done
    from public.schedule_progress sp
   where sp.schedule_id = v_sid;

  update public.schedules
     set status = (case when coalesce(v_done, false) then 'completed' else 'pending' end)::schedule_status
   where schedule_id = v_sid
     and status is distinct from
         (case when coalesce(v_done, false) then 'completed' else 'pending' end)::schedule_status;

  return coalesce(new, old);
end $$;

-- ไม่ต้อง trigger บน schedules / profiles เพราะ view คำนวณสด
-- (คอลัมน์ status อาจค้างชั่วคราวถ้า admin เพิ่มคนหรือระงับคน — UI ไม่ได้ใช้ค่านี้)
-- ⚠️ ต้องมี `update of locked_at, status` ด้วย ไม่ใช่แค่ insert/delete
--    เพราะตอน insert header ยังเป็น pending (ยังไม่ส่ง details) → ยังไม่นับว่าเสร็จ
--    ค่าจะเปลี่ยนเป็น "เสร็จ" ตอน recalc ตั้ง status หรือ finalizeAudit ตั้ง locked_at
--    ซึ่งทั้งคู่เป็น UPDATE
--
-- ไม่วนซ้ำ: recalc_audit_header() update audit_headers → trigger นี้ update schedules
--           (คนละตาราง) → จบ
drop trigger if exists trg_sync_sched_status on public.audit_headers;
create trigger trg_sync_sched_status
after insert or delete on public.audit_headers
for each row execute function public.sync_schedule_status();

-- แยก trigger ของ UPDATE ออกมาเพื่อใส่ WHEN — สำคัญเรื่องประสิทธิภาพ
--
-- ⚠️ trg_recalc_audit บน audit_details เป็น `for each row` → การ submit 1 ครั้ง
--    (เกณฑ์ ~67 ข้อ) ทำให้ audit_headers ถูก UPDATE ~67 ครั้ง
--    ถ้าไม่มี WHEN ตัวนี้จะยิงตาม 67 ครั้ง แต่ละครั้งอ่าน view ที่ join 3 ตาราง
--    → submit ช้าลงชัดเจนโดยไม่ได้อะไรเพิ่ม
--
--    WHEN นี้กรองให้เหลือเฉพาะครั้งที่ค่าที่เกี่ยวข้องเปลี่ยนจริง
--    (status: pending → good/excellent ครั้งเดียว · locked_at: null → เวลา ครั้งเดียว)
drop trigger if exists trg_sync_sched_status_upd on public.audit_headers;
create trigger trg_sync_sched_status_upd
after update of locked_at, status on public.audit_headers
for each row
when (old.status   is distinct from new.status
   or old.locked_at is distinct from new.locked_at)
execute function public.sync_schedule_status();

-- ยกเลิก RPC ตัวเก่า — trigger ทำแทนแล้ว
drop function if exists public.mark_schedule_done(uuid);


-- ---------------------------------------------------------------------
-- ตรวจผลหลังรันส่วน H
-- ---------------------------------------------------------------------
-- -- 1) คอลัมน์ใหม่ → ต้องได้ 2
-- select count(*) from information_schema.columns
--  where table_schema='public' and table_name='audit_headers'
--    and column_name in ('schedule_id','audit_round');
--
-- -- 2) trigger บน audit_headers → ต้องมี trg_chk_header_schedule, trg_sync_sched_status,
-- --    trg_log_headers  (trg_recalc_audit อยู่บน audit_details ไม่ใช่ที่นี่)
-- select tgname from pg_trigger
--  where tgrelid='public.audit_headers'::regclass and not tgisinternal order by tgname;
--
-- -- 3) view ต้องมี security_invoker = true  → ต้องเห็น security_invoker=true
-- select c.relname, c.reloptions from pg_class c
--  where c.oid = 'public.schedule_progress'::regclass;
--
-- -- 4) unique index → ต้องได้ 1
-- select count(*) from pg_indexes
--  where schemaname='public' and indexname='headers_one_per_schedule';
--
-- -- 5) RPC เก่าต้องหายไป → ต้องได้ 0
-- select count(*) from pg_proc
--  where pronamespace='public'::regnamespace and proname='mark_schedule_done';
--
-- -- 6) ลองอ่าน view (ไม่มีข้อมูลก็ไม่ error)
-- select * from public.schedule_progress order by audit_date desc limit 10;


-- ---------------------------------------------------------------------
-- แผนย้อนกลับส่วน H
-- ---------------------------------------------------------------------
-- drop trigger if exists trg_chk_header_schedule on public.audit_headers;
-- drop trigger if exists trg_sync_sched_status   on public.audit_headers;
-- drop view  if exists public.schedule_progress;
-- drop index if exists public.headers_one_per_schedule;
-- alter table public.audit_headers drop column if exists schedule_id;
-- alter table public.audit_headers drop column if exists audit_round;
--
-- -- คืน RPC เดิม (สำเนาจากส่วน G4)
-- create or replace function public.mark_schedule_done(p_schedule_id uuid)
-- returns void language plpgsql security definer set search_path = public as $$
-- begin
--   if not exists (
--     select 1 from public.schedules
--      where schedule_id = p_schedule_id
--        and (auth.uid() = any(auditor_ids) or coalesce(public.auth_role()::text,'') = 'admin')
--   ) then
--     raise exception 'ไม่ได้รับมอบหมายงานนี้';
--   end if;
--   update public.schedules set status = 'completed' where schedule_id = p_schedule_id;
-- end $$;
-- grant execute on function public.mark_schedule_done(uuid) to authenticated;
--
-- ⚠️ ต้อง git revert ฝั่ง client ด้วย ไม่งั้น submitAuditHeader จะส่งคอลัมน์ที่ไม่มี


-- =====================================================================
-- G5) แก้ B2 — ล็อกผลตรวจให้ทำงานจริง + กันปลอมคะแนน   (2026-08-06)
-- ปัญหา: headers_update ไม่มี with_check → เจ้าของตั้ง locked_at ไม่ผ่าน RLS
--   → ผลตรวจไม่เคยล็อก + เจ้าของ update header ตัวเองได้ (ไม่มี recalc ตอน update) = ปลอมคะแนน
-- แก้: (1) ล็อกผ่าน RPC security definer  (2) headers_update เหลือ admin เท่านั้น
--   recalc_audit_header เป็น security definer (owner=postgres) → ยัง update คะแนนได้ (bypass RLS)
-- idempotent
-- =====================================================================
create or replace function public.lock_audit(p_audit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_locked timestamptz;
begin
  select auditor_id, locked_at into v_owner, v_locked
    from public.audit_headers where audit_id = p_audit_id;
  if v_owner is null then raise exception 'audit not found'; end if;
  if v_owner <> auth.uid() and coalesce(public.auth_role()::text,'') <> 'admin'
    then raise exception 'permission denied'; end if;
  if v_locked is not null then
    return jsonb_build_object('success',true,'already_locked',true,'locked_at',v_locked); end if;
  update public.audit_headers set locked_at = now() where audit_id = p_audit_id;
  return jsonb_build_object('success',true,'locked_at',now());
end $$;
grant execute on function public.lock_audit(uuid) to authenticated;

drop policy if exists headers_update on public.audit_headers;
create policy headers_update on public.audit_headers
  for update using (coalesce(public.auth_role()::text,'') = 'admin');


-- =====================================================================
-- G6) Hardening: ปิด PUBLIC execute บน RPC ที่มี security definer  (2026-08-06)
-- ปัญหา: Supabase advisor เตือนว่า admin_reset_data/lock_audit ถูก grant EXECUTE
--   ให้ PUBLIC โดย default ตอนสร้างฟังก์ชัน (คนละเรื่องกับ grant ... to authenticated
--   ที่ตั้งใจเขียนไว้) → anon (ยังไม่ล็อกอิน) ยิง RPC ตรงมาได้ แม้จะโดน internal
--   check ปฏิเสธอยู่แล้ว (auth_role()='admin' / เจ้าของ header เท่านั้น) ก็ตาม
-- แก้: revoke จาก public/anon เท่านั้น — ไม่แตะ grant ...to authenticated ที่มีอยู่แล้ว
--   จึงไม่กระทบผู้ใช้ที่ล็อกอินอยู่เลย
-- idempotent
-- =====================================================================
revoke execute on function public.admin_reset_data() from public, anon;
revoke execute on function public.lock_audit(uuid)   from public, anon;


-- =====================================================================
-- G7) Plant CAF/MTN: เพิ่มพื้นที่ Office + เปลี่ยนชื่อเฉพาะ CAF  (2026-08-07)
-- โครงเดิม: CAF (โรงอาหาร) / MTN (ช่าง/ยูทิลิตี้) มีแค่ area เดียวต่อ plant
--   ใช้เป็น "พื้นที่ส่วนกลาง" เข้าผ่านการ์ดพิเศษในหน้า plant.html (แยกจาก plant ปกติ)
-- เปลี่ยนเป็น: ให้ CAF/MTN โชว์เป็น plant ปกติ (แก้ js/app.js คู่กัน) แล้วเพิ่ม area
--   "Office" (type office) เข้าไปแต่ละ plant — ผูกเกณฑ์ชุดเดียวกับ Office F1/F2/F3
--   อัตโนมัติผ่าน criteria.area_types (ไม่ต้อง insert เกณฑ์เพิ่ม)
-- เปลี่ยนชื่อ plant_name แค่ CAF → 'P&C' ตามที่ขอ — MTN เก็บชื่อเดิม
--   'Maintenance & Utility' ไว้โดยตั้งใจ (ไม่ใช่ตกหล่น) ทั้งสอง plant ได้ area
--   Office ใหม่เหมือนกัน แต่ MTN ไม่ได้ขอเปลี่ยนชื่อ
-- idempotent
-- =====================================================================
update public.plants set plant_name = 'P&C'
  where plant_id = 'CAF' and plant_name <> 'P&C';

insert into public.areas (area_id, plant_id, area_name, area_type, status)
values ('CAF-OF', 'CAF', 'Office', 'office', 'active')
on conflict (area_id) do nothing;

insert into public.areas (area_id, plant_id, area_name, area_type, status)
values ('MTN-OF', 'MTN', 'Office', 'office', 'active')
on conflict (area_id) do nothing;

-- =====================================================================
-- ส่วน I: เกณฑ์ (criteria) รองรับภาษาอังกฤษ — question_en/description_en/category_en (9 ส.ค. 2026)
-- =====================================================================
-- ที่มา: เทียบกับไฟล์ "5S Standard (มาตรฐาน 5ส) _R.00 16.06.2026.pdf"
--   (มาตรฐานกลางฉบับทางการ ไทย+อังกฤษคู่กันทุกข้อ ตรงเลข sub_category กับตารางนี้เป๊ะ)
--   แต่คำแปลอังกฤษในไฟล์นั้นแปลจากข้อความไทยฉบับเต็ม (ยาวกว่า) — ในตาราง criteria
--   เก็บ question/description เป็นเวอร์ชันสรุปสั้นสำหรับจอมือถือ ดังนั้น question_en/
--   description_en ที่เติมด้านล่างนี้ "แปล/สรุปใหม่ให้กระชับเท่าภาษาไทยที่มีอยู่จริง"
--   ไม่ใช่แปลตรงจาก PDF คำต่อคำ — เพื่อให้ checklist หน้าตาเหมือนกันทั้ง 2 ภาษา
-- ใช้จริงที่: mapCriteria() (criteria.html + audit.html checklist),
--   getImprovementItems() (dashboard "พื้นที่ต้องปรับปรุง" + PDF export),
--   getAuditDetail() (summary.html) — เลือกคอลัมน์ตาม I18n.getLang()==='en'
--   fallback เป็นไทยเสมอถ้าแถวไหนยังไม่มีคำแปล (เผื่อเพิ่มเกณฑ์ใหม่ทีหลังลืมแปล)
-- idempotent: ALTER ... IF NOT EXISTS + UPDATE (เขียนทับค่าเดิมได้ถ้ารันซ้ำ)
-- =====================================================================
alter table public.criteria add column if not exists question_en text;
alter table public.criteria add column if not exists description_en text;
alter table public.criteria add column if not exists category_en text;

update public.criteria as t set
  question_en = v.question_en, description_en = v.description_en, category_en = v.category_en
from (values
  ('C-01-1','5S info on the board is up to date','Board includes policy, objectives, sub-committee, slogan, news, before-after photos, audit results, and area layout with owners','Boards and Notice Boards'),
  ('C-01-2','Board in good condition, clean, no dust buildup','No stains or cobwebs','Boards and Notice Boards'),
  ('C-02-1','All employees understand 5S principles','All staff in the organization know the 5S principles','Basic 5S Knowledge'),
  ('C-02-2','Employees informed, participate, and can recite the 5S slogan','Staff receive activity updates and can state the slogan','Basic 5S Knowledge'),
  ('C-02-3','Employees know their responsible area and last audit results','Aware of the scope of their own responsible area','Basic 5S Knowledge'),
  ('C-03-1','Installed in a suitable spot, access not obstructed','Extinguisher hung/on stand/floor; no blocking objects, incl. hose cabinet','Fire Extinguishing Equipment'),
  ('C-03-2','Type label and usage instructions displayed','Label shows type and how to use','Fire Extinguishing Equipment'),
  ('C-03-3','Clean, no dust buildup','No dust on the extinguisher','Fire Extinguishing Equipment'),
  ('C-03-4','Not damaged, ready to use, inspected on schedule','Inspected by JSO or assigned person per plan','Fire Extinguishing Equipment'),
  ('C-04-1','Unit clean, no dust or stains','Every part of the unit must be clean','Water Dispensers/Refrigerators'),
  ('C-04-2','Unit and cord ready to use, not damaged','Cord and unit in complete condition','Water Dispensers/Refrigerators'),
  ('C-04-3','Cord not in the way, area clean, no spilled water','Area around unit clean, cord tidy','Water Dispensers/Refrigerators'),
  ('C-05-1','Cabinet clearly labeled','Label clear, easy to see','Medicine Cabinet'),
  ('C-05-2','Medicines sorted, labeled with name/use/dosage','Sorted, clearly labeled, easy to find','Medicine Cabinet'),
  ('C-05-3','Expiry and stock checked regularly','Expiry dates and stock levels checked regularly','Medicine Cabinet'),
  ('C-05-4','Checklist (if many items) and issue log kept','Must have a checklist and issue/receipt log','Medicine Cabinet'),
  ('C-06-1','Restroom clearly signed','Restroom sign clearly visible','Restrooms/Toilets'),
  ('C-06-2','Restroom sandals provided, neatly placed','Sandals arranged neatly','Restrooms/Toilets'),
  ('C-06-3','Bins covered/suitable, not overflowing','Covered bin, not overflowing','Restrooms/Toilets'),
  ('C-06-4','Kept clean, no smoking in restroom','Restroom clean, no odor, no smoking','Restrooms/Toilets'),
  ('C-06-5','Tissue/towel and liquid soap provided','Hand-drying item and liquid soap available','Restrooms/Toilets'),
  ('C-06-6','Cleaning tools stored in place, not damaged','Tools in place, damage reported','Restrooms/Toilets'),
  ('C-06-7','Other fittings in good condition','If damaged, status clearly marked and repair planned','Restrooms/Toilets'),
  ('C-07-1','Equipment in good condition','Good condition, ready to use','Cleaning Equipment'),
  ('C-07-2','Stored in place, sorted, tidy, labeled','Sorted, tidy, with layout','Cleaning Equipment'),
  ('C-08-1','Cleaned regularly, no dust or stains','Cleaned regularly','Telephone'),
  ('C-08-2','Placed for easy access, unobstructed','Suitable spot, unobstructed','Telephone'),
  ('C-08-3','Equipment in good condition','Good condition','Telephone'),
  ('C-09-1','Clean, no dust or cobwebs','Clean, no dust buildup','Emergency Lighting'),
  ('C-09-2','Ready to use','Always ready to use','Emergency Lighting'),
  ('C-10-1','Ready to use','Ready to use','Insect Trap Light'),
  ('C-10-2','Clean, no dust or cobwebs','No dust or cobwebs','Insect Trap Light'),
  ('C-11-1','Boundary clearly defined and marked','Waste area boundary clearly set','Waste Holding Area & Bins'),
  ('C-11-2','Bin covered, or not overflowing','Covered or not overflowing','Waste Holding Area & Bins'),
  ('C-11-3','Not a source of pests/insects','Not a breeding site for insects','Waste Holding Area & Bins'),
  ('C-11-4','No standing water or dirt on the floor','Waste area floor clean, no standing water','Waste Holding Area & Bins'),
  ('C-12-1','No waste/carcasses/tools left on ISOWALL','ISOWALL clean, no debris buildup','ISOWALL'),
  ('C-12-2','No unused tools or unrelated items on ISOWALL','No hammers, nails, bolts, wrenches, etc. on ISOWALL','ISOWALL'),
  ('C-13-1','Surroundings orderly, clean, no waste or hazards','No waste piles or unrelated items around the building','Building Surrounding Areas'),
  ('C-13-2','No overgrown weeds/grass around the building','No weeds or long grass around the building','Building Surrounding Areas'),
  ('C-13-3','Drains covered, clear; channels unobstructed','Drainage system intact, water flow unobstructed','Building Surrounding Areas'),
  ('C-13-4','Building structure sound, not a pest habitat','Repair plan in place if damaged','Building Surrounding Areas'),
  ('C-13-5','Fire exits ready, signed, unobstructed','Fire exits intact, not left open','Building Surrounding Areas'),
  ('C-14-1','Positions inside control cabinet clearly labeled','Circuit/network positions clearly marked','Electrical Control Cabinet/Room'),
  ('C-14-2','No hazards/clutter in room; floor/wall/ceiling intact','Room in good condition, no leaks, access unobstructed','Electrical Control Cabinet/Room'),
  ('C-14-3','Cabinet interior sound, no safety risk','No risk to life or property','Electrical Control Cabinet/Room'),
  ('C-14-4','Room and equipment clean, incl. inside cabinet','Cabinet and room interior clean, no dust/cobwebs','Electrical Control Cabinet/Room'),
  ('C-15-1','Floors/walls/ceiling/windows/doors clean, not damaged','Clean, no dust; repair plan if damaged','Meeting Room'),
  ('C-15-2','Meeting tables and chairs arranged neatly','Arranged neatly','Meeting Room'),
  ('C-15-3','Room layout and equipment plan displayed visibly','Meeting-room layout posted where easily seen','Meeting Room'),
  ('C-15-4','Board (if any) accessories stored conveniently','Markers/erasers easy to store','Meeting Room'),
  ('C-15-5','Electrical/network cables installed neatly','Power and internet cables tidy','Meeting Room'),
  ('C-16-1','Items stored by category, not mixed','Clearly sorted by category','Central Office Storage'),
  ('C-16-2','Control system in place (stock card/QR code)','Shows type and quantity of stored items','Central Office Storage'),
  ('C-16-3','Storage area clean, no dust/cobwebs, not damaged','Clean, no dirt or cobwebs buildup','Central Office Storage'),
  ('C-17-1','Name/code/position label shows ownership','Owner clearly identified','Lockers/Shoe Racks'),
  ('C-17-2','Inside/outside/top of locker clean','Every part clean','Lockers/Shoe Racks'),
  ('C-17-3','Nothing placed on top unless needed, then tidy','Neatly placed if necessary','Lockers/Shoe Racks'),
  ('C-18-1','Storage position set, dedicated area, labeled','Dedicated area, clearly labeled','Chemical Storage Room'),
  ('C-18-2','SDS readily accessible','SDS easy to access','Chemical Storage Room'),
  ('C-18-3','Chemical prep instructions readily accessible','Prep instructions posted at usage area','Chemical Storage Room'),
  ('C-18-4','Issue/receipt log kept up to date','Log updated regularly','Chemical Storage Room'),
  ('C-18-5','Storage locked/secured from unauthorized access','Locked or otherwise access-controlled','Chemical Storage Room'),
  ('C-19-1','Machine clean, ready to use','Machine clean, not damaged','Photocopier/Printer'),
  ('C-19-2','No leftover papers/documents at the machine','No documents left at the printer','Photocopier/Printer'),
  ('C-20-1','Clean, no debris/dust/water on walkway','Walkway floor always clean','Walkway/Room Floors'),
  ('C-20-2','Items tidy, no unrelated items blocking walkway','No unrelated equipment blocking the way','Walkway/Room Floors'),
  ('C-20-3','If items placed, boundary clearly defined','Placement area clearly bounded and marked','Walkway/Room Floors'),
  ('C-21-1','In good condition, not damaged','No damage without a repair plan','Windows/Doors/Walls/Ceilings'),
  ('C-21-2','Push/pull/slide/do-not-open/damaged signs on doors','Door/window status signs complete','Windows/Doors/Walls/Ceilings'),
  ('C-21-3','Clean, no cobwebs or stains','No stains or cobwebs buildup','Windows/Doors/Walls/Ceilings'),
  ('C-21-4','No sticky notes/items on door/window/wall edges','Except layout plans or status labels','Windows/Doors/Walls/Ceilings'),
  ('C-22-1','Switch/cord/bulb working, safe, not damaged','No broken parts, safe','Light Bulbs/Switches'),
  ('C-22-2','Clean, no cobwebs, water, or ingrained stains','No stains or cobwebs','Light Bulbs/Switches'),
  ('C-22-3','If more than 1 switch, mark on/off position or layout','On/off position or layout indicated','Light Bulbs/Switches'),
  ('C-23-1','Clean, working normally, labeled if broken','Out-of-service label if broken','Fans/Air Conditioners'),
  ('C-23-2','Fan/AC turned off when not in use','Turn off to save energy when unused','Fans/Air Conditioners'),
  ('C-24-1','Clean, sound condition, cables tidy','Cables stored neatly, not cluttered','Computers & Equipment'),
  ('C-24-2','No sticky notes/stickers on the computer','No stickers or notes on the unit','Computers & Equipment'),
  ('C-25-1','Clean, no dust/stains on desk and chair','Every part clean','Work Desks/Drawers/Chairs'),
  ('C-25-2','Items arranged neatly for easy use','Desk items kept tidy','Work Desks/Drawers/Chairs'),
  ('C-25-3','Under desk: max 1 box or designated item','PC case/UPS/bin or max 1 box','Work Desks/Drawers/Chairs'),
  ('C-25-4','Drawer contents arranged neatly','Drawer tidy','Work Desks/Drawers/Chairs'),
  ('C-25-5','Document trays/shelves clearly labeled','Trays clearly labeled','Work Desks/Drawers/Chairs'),
  ('C-25-6','Chair pushed in every time you leave your seat','Chair always kept under the desk','Work Desks/Drawers/Chairs'),
  ('C-26-1','Cabinet/shelf code or name for easy search','Cabinet and shelf names clearly labeled','Filing Cabinets/Document Shelves'),
  ('C-26-2','Outside, inside, and top of cabinet clean','Every part clean','Filing Cabinets/Document Shelves'),
  ('C-26-3','Documents in cabinet organized, no clutter','Only documents kept in the cabinet','Filing Cabinets/Document Shelves'),
  ('C-26-4','Items on top of cabinet arranged safely','Tidy, no risk of falling','Filing Cabinets/Document Shelves'),
  ('C-26-5','File spine shows company logo, dept, code/index','File spines meet the standard','Filing Cabinets/Document Shelves'),
  ('C-26-6','Files classified and ordered by index code','All files ordered continuously','Filing Cabinets/Document Shelves'),
  ('C-27-1','Floor/sink/lockers clean, no dust or stains','Every part of the changing room clean','Changing Room'),
  ('C-27-2','Soap available, handwashing steps clearly shown','Handwashing steps clearly displayed','Changing Room'),
  ('C-27-3','Gowning steps for each area shown before entry','Gowning steps shown before entering each area','Changing Room'),
  ('C-27-4','Storage cabinets clearly labeled and used correctly','Visitor cabinet used only by visitors','Changing Room'),
  ('C-27-5','No unrelated equipment in the area','Only gowning-related items present','Changing Room'),
  ('C-28-1','Clean, no dust or unrelated items on table','Table clean during and after use','Work Tables (Production)'),
  ('C-28-2','Ready to use, not damaged','Good condition','Work Tables (Production)'),
  ('C-28-3','Items cleared and tidied after use','Table clean when not in use','Work Tables (Production)'),
  ('C-29-1','Room clearly divided into zones by actual use','Production zones clearly defined','Production Room'),
  ('C-29-2','Room name sign posted at entrance','Room name sign clear','Production Room'),
  ('C-29-3','Clean, no dust/cobwebs; cleaning log up to date','Cleaning log updated regularly','Production Room'),
  ('C-29-4','Room in good, production-ready condition','Room fully ready for production','Production Room'),
  ('C-29-5','No unrelated items in production area; parts stored tidily if needed','Spare parts stored neatly if needed','Production Room'),
  ('C-29-6','Status sign posted matches actual work','Sign status matches actual work status','Production Room'),
  ('C-30-1','Installed suitably, easy to maintain','Machine layout fits its use','Machinery & Equipment'),
  ('C-30-2','Machine code label clearly attached','Code label matches area layout','Machinery & Equipment'),
  ('C-30-3','Operating/maintenance manual readily accessible','WI/manual easy to access','Machinery & Equipment'),
  ('C-30-4','Clean, no dust/stains; condition log kept regularly','Machine condition log kept updated','Machinery & Equipment'),
  ('C-30-5','No unrelated items mixed with the machine','Nothing extra placed on the machine','Machinery & Equipment'),
  ('C-30-6','Ready to use; "awaiting repair" tag if broken','"Awaiting repair" tag clear when broken','Machinery & Equipment'),
  ('C-31-1','Labels clearly show product/material/pallet status','Every item clearly identified','Product/Material/Pallet Storage'),
  ('C-31-2','Storage area boundary for products/materials/pallets clear','Area boundary lines clear','Product/Material/Pallet Storage'),
  ('C-31-3','Baskets/crates/pallets usable, not broken, stored in place','Not broken, stored correctly','Product/Material/Pallet Storage'),
  ('C-31-4','Racks/packaging/crates/baskets/pallets clean','Cleaned regularly','Product/Material/Pallet Storage'),
  ('C-31-5','Materials and containers placed safely per spec','On pallets, away from walls, per GMP/SOP','Product/Material/Pallet Storage'),
  ('C-32-1','Ready to use, not damaged','Good condition','Trolleys/Hand Pallet Trucks/Forklifts'),
  ('C-32-2','Parking spot clearly defined, in layout','Parking spot clearly marked/labeled','Trolleys/Hand Pallet Trucks/Forklifts'),
  ('C-32-3','Clean, no dust or oil stains (hand truck/forklift)','No oil stains buildup','Trolleys/Hand Pallet Trucks/Forklifts'),
  ('C-32-4','No unrelated items left on it when not in use','Clean, nothing left on it','Trolleys/Hand Pallet Trucks/Forklifts'),
  ('C-33-1','Room sound, no gaps risking contamination','No gaps risking cross-contamination','Equipment Washing Room'),
  ('C-33-2','No standing water; walls/ceiling clean','No standing water or stain buildup','Equipment Washing Room'),
  ('C-33-3','Hoses stored neatly, off the floor','Hoses hung or coiled for storage','Equipment Washing Room'),
  ('C-33-4','Cleaning cart/equipment stored in place, ready to use','Equipment in place, ready to use','Equipment Washing Room'),
  ('C-34-1','Clean, no dust/water/odor/food waste on floor','Canteen floor always clean','Canteen'),
  ('C-34-2','No unrelated items (e.g. machinery) in canteen','No machinery or production tools in canteen','Canteen'),
  ('C-34-3','Tables and chairs not damaged','Good condition','Canteen'),
  ('C-34-4','Dining/prep tables, chairs, racks, utensils clean & tidy','All kitchen items clean and tidy','Canteen'),
  ('C-34-5','Kitchen appliances clean inside and out','Rice cooker, microwave, water heater clean','Canteen'),
  ('C-34-6','Bin tightly covered, or not overflowing','Tight lid, no overflow','Canteen'),
  ('C-34-7','Sockets/switches/cables ready, not damaged','Good condition, safe','Canteen'),
  ('C-34-8','Ceiling/walls clean, no dead birds on netting','Structure clean and intact','Canteen')
) as v(criteria_id, question_en, description_en, category_en)
where t.criteria_id = v.criteria_id;
