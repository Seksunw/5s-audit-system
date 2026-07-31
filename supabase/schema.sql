-- =====================================================================
-- 5S Audit System — Supabase (PostgreSQL) schema
-- แปลงจาก Google Sheets 9 sheets → ตาราง Postgres + RLS
-- อ้างอิง: docs/PROJECT_SUMMARY.md §7 (โครงสร้างเดิม)
-- รันใน Supabase: SQL Editor → New query → วางทั้งไฟล์ → Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) ENUM types (แทน string เดิม เพื่อบังคับค่าที่ถูกต้อง)
-- ---------------------------------------------------------------------
create type user_role      as enum ('admin', 'manager', 'auditor', 'area_manager');
create type record_status  as enum ('active', 'inactive');
create type area_type      as enum ('office','production','warehouse','cafeteria','outdoor','maintenance');
create type audit_status   as enum ('excellent','good','need_improvement','pending','failed');
create type schedule_status as enum ('pending','completed');

-- ---------------------------------------------------------------------
-- 1) profiles  (แทน User_Master)
--    Auth (email/password) ย้ายไปให้ Supabase Auth = ตาราง auth.users
--    profiles เก็บข้อมูล "โปรไฟล์" ที่ผูก 1:1 กับ auth.users ผ่าน id
--    legacy_user_id เก็บ User_ID เดิม (USR-YYYYMMDD-XXXXXX) ไว้ map ข้อมูลเก่า
-- ---------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  legacy_user_id text unique,                    -- User_ID เดิม
  employee_id    text,
  name           text not null,
  department     text,
  email          text unique not null,
  role           user_role not null default 'auditor',
  status         record_status not null default 'active',
  assigned_plants text[]  default '{}',           -- เดิมเป็น comma-separated → เปลี่ยนเป็น array
  assigned_areas  text[]  default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) plants  (แทน Plant_Master)
-- ---------------------------------------------------------------------
create table public.plants (
  plant_id   text primary key,                    -- รหัส Plant เดิม (SUP/POC/NIF)
  plant_name text not null,
  status     record_status not null default 'active'
);

-- ---------------------------------------------------------------------
-- 3) areas  (แทน Area_Master)
-- ---------------------------------------------------------------------
create table public.areas (
  area_id   text primary key,
  plant_id  text not null references public.plants(plant_id) on delete restrict,
  area_name text not null,
  area_type area_type not null,
  status    record_status not null default 'active'
);
create index idx_areas_plant on public.areas(plant_id);

-- ---------------------------------------------------------------------
-- 4) criteria  (แทน Criteria_Master — 132 ข้อ / 34 หมวด)
--    area_types: เดิม "All"/"Office"/"Production,Warehouse" → เก็บเป็น array
-- ---------------------------------------------------------------------
create table public.criteria (
  criteria_id  text primary key,                  -- C-XX-X
  category     text not null,
  sub_category text,                               -- เลขข้อ เช่น 1.1
  question     text not null,
  description  text,
  area_types   area_type[] default '{}',          -- ว่าง = ใช้ทุก area type
  max_score    int not null default 2,
  active       boolean not null default true
);
create index idx_criteria_active on public.criteria(active);

-- ---------------------------------------------------------------------
-- 5) audit_headers  (แทน Audit_Header)
--    Total_Score / Percent / Status คำนวณอัตโนมัติจาก trigger (ดูข้อ 10)
-- ---------------------------------------------------------------------
create table public.audit_headers (
  audit_id    uuid primary key default gen_random_uuid(),
  legacy_audit_id text unique,                     -- AUD-... เดิม (ไว้ map ข้อมูลเก่า)
  plant_id    text not null references public.plants(plant_id),
  area_id     text not null references public.areas(area_id),
  auditor_id  uuid not null references public.profiles(id),
  audit_date  date not null default current_date,
  total_score int  not null default 0,
  max_score   int  not null default 0,
  percent     numeric(5,2) not null default 0,
  status      audit_status not null default 'pending',
  created_at  timestamptz not null default now()
);
create index idx_headers_auditor on public.audit_headers(auditor_id);
create index idx_headers_plant_area on public.audit_headers(plant_id, area_id);
create index idx_headers_date on public.audit_headers(audit_date);

-- ---------------------------------------------------------------------
-- 6) audit_details  (แทน Audit_Detail)
--    photo_urls: เดิม comma-separated → array
-- ---------------------------------------------------------------------
create table public.audit_details (
  detail_id   uuid primary key default gen_random_uuid(),
  audit_id    uuid not null references public.audit_headers(audit_id) on delete cascade,
  criteria_id text not null references public.criteria(criteria_id),
  score       int  not null check (score between 0 and 2),
  remark      text check (char_length(remark) <= 200),
  photo_urls  text[] default '{}',
  unique (audit_id, criteria_id)                   -- กันบันทึกซ้ำข้อเดิมใน audit เดียว
);
create index idx_details_audit on public.audit_details(audit_id);

-- ---------------------------------------------------------------------
-- 7) schedules  (แทน Schedule_Master)
--    auditor_ids: เดิม comma-separated → array ของ profiles.id
-- ---------------------------------------------------------------------
create table public.schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  legacy_schedule_id text unique,
  plant_id    text not null references public.plants(plant_id),
  area_id     text not null references public.areas(area_id),
  auditor_ids uuid[] default '{}',
  audit_date  date not null,
  audit_round text,
  status      schedule_status not null default 'pending'
);
create index idx_schedules_status on public.schedules(status);

-- ---------------------------------------------------------------------
-- 8) audit_logs  (แทน Audit_Log)
--    Sessions sheet ไม่ต้องมี — Supabase Auth จัดการ session เอง
-- ---------------------------------------------------------------------
create table public.audit_logs (
  log_id     uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id),
  action     text not null,                        -- LOGIN / AUDIT / ...
  detail     text,
  created_at timestamptz not null default now()
);
create index idx_logs_user on public.audit_logs(user_id);

-- =====================================================================
-- 9) Helper: อ่าน role ของผู้ใช้ปัจจุบัน (ใช้ใน RLS)
-- =====================================================================
-- หมายเหตุ: ห้ามตั้งชื่อ current_role() เพราะชนกับ keyword สงวนของ Postgres
create or replace function public.auth_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()   -- admin หรือ manager = เห็น/แก้ได้ทุก audit
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.auth_role() in ('admin','manager'), false);
$$;

-- =====================================================================
-- 10) Trigger: คำนวณ Total_Score / Percent / Status อัตโนมัติ
--     แก้ปัญหาเดิม "submit ไม่ atomic / คะแนนคำนวณฝั่ง client"
--     ทุกครั้งที่ audit_details เปลี่ยน → header อัปเดตเอง
-- =====================================================================
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
  select coalesce(sum(d.score),0),
         coalesce(sum(c.max_score),0)
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

create trigger trg_recalc_audit
after insert or update or delete on public.audit_details
for each row execute function public.recalc_audit_header();

-- =====================================================================
-- 11) Row Level Security (RLS) — แก้ IDOR + role scoping ที่ระดับ DB
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.plants        enable row level security;
alter table public.areas         enable row level security;
alter table public.criteria      enable row level security;
alter table public.audit_headers enable row level security;
alter table public.audit_details enable row level security;
alter table public.schedules     enable row level security;
alter table public.audit_logs    enable row level security;

-- profiles: อ่านโปรไฟล์ตัวเอง; staff เห็นทุกคน; admin แก้ไขได้ทุกคน
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_staff());
create policy profiles_admin_all on public.profiles
  for all using (public.auth_role() = 'admin')
  with check (public.auth_role() = 'admin');

-- master data: ผู้ล็อกอินอ่านได้ทั้งหมด; แก้ไขเฉพาะ admin
create policy plants_read   on public.plants   for select using (auth.uid() is not null);
create policy areas_read    on public.areas    for select using (auth.uid() is not null);
create policy criteria_read on public.criteria for select using (auth.uid() is not null);
create policy plants_admin   on public.plants   for all using (public.auth_role()='admin') with check (public.auth_role()='admin');
create policy areas_admin    on public.areas    for all using (public.auth_role()='admin') with check (public.auth_role()='admin');
create policy criteria_admin on public.criteria for all using (public.auth_role()='admin') with check (public.auth_role()='admin');

-- audit_headers: auditor เห็น/สร้าง/แก้เฉพาะของตัวเอง; staff เห็น/แก้ทุกอัน
create policy headers_select on public.audit_headers
  for select using (auditor_id = auth.uid() or public.is_staff());
create policy headers_insert on public.audit_headers
  for insert with check (auditor_id = auth.uid() or public.is_staff());
create policy headers_update on public.audit_headers
  for update using (auditor_id = auth.uid() or public.is_staff());
create policy headers_delete on public.audit_headers
  for delete using (auditor_id = auth.uid() or public.is_staff());

-- audit_details: สิทธิ์อิงตามเจ้าของ header (แก้ IDOR ที่รายงานเดิมชี้ไว้)
create policy details_all on public.audit_details
  for all using (
    exists (select 1 from public.audit_headers h
            where h.audit_id = audit_details.audit_id
              and (h.auditor_id = auth.uid() or public.is_staff()))
  )
  with check (
    exists (select 1 from public.audit_headers h
            where h.audit_id = audit_details.audit_id
              and (h.auditor_id = auth.uid() or public.is_staff()))
  );

-- schedules: auditor เห็นเฉพาะที่ถูกมอบหมาย; staff เห็น/แก้ทั้งหมด
create policy schedules_select on public.schedules
  for select using (auth.uid() = any(auditor_ids) or public.is_staff());
create policy schedules_staff on public.schedules
  for all using (public.is_staff()) with check (public.is_staff());

-- audit_logs: เขียน log ของตัวเองได้; admin อ่านได้ทั้งหมด
create policy logs_insert on public.audit_logs
  for insert with check (user_id = auth.uid());
create policy logs_admin_read on public.audit_logs
  for select using (public.auth_role() = 'admin');

-- =====================================================================
-- 12) Auto-create profile เมื่อมี auth.user ใหม่ (สมัคร/เชิญ)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_new_user
after insert on auth.users
for each row execute function public.handle_new_user();

-- =====================================================================
-- เสร็จ. ขั้นต่อไป: import master data (plants/areas/criteria) แล้ว
-- migrate audit เก่าจาก Google Sheet (ดู SUPABASE_MIGRATION_PLAN.md)
-- =====================================================================
