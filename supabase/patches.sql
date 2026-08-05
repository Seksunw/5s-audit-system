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

-- แทนด้วย RPC ที่แก้ได้แค่ status  (schedule_id เป็น uuid ไม่ใช่ bigint)
create or replace function public.mark_schedule_done(p_schedule_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.schedules
     where schedule_id = p_schedule_id
       and (auth.uid() = any(auditor_ids) or coalesce(public.auth_role()::text,'') = 'admin')
  ) then
    raise exception 'ไม่ได้รับมอบหมายงานนี้';
  end if;

  update public.schedules
     set status = 'completed'
   where schedule_id = p_schedule_id;
end $$;

grant execute on function public.mark_schedule_done(uuid) to authenticated;


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
