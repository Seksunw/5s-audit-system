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

-- A3) RLS: auditor ที่ถูกมอบหมายอัปเดตสถานะงานของตัวเองได้ (mark completed หลังตรวจเสร็จ)
drop policy if exists schedules_auditor_update on public.schedules;
create policy schedules_auditor_update on public.schedules
  for update using (auth.uid() = any(auditor_ids)) with check (auth.uid() = any(auditor_ids));


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
  if coalesce(public.auth_role(), '') <> 'admin' then
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

  -- ลบ (truncate ไม่ปลุก trigger log)
  truncate table public.audit_details, public.audit_headers, public.schedules restart identity cascade;

  -- ลบรูปใน Storage
  delete from storage.objects where bucket_id = 'audit-photos';

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
