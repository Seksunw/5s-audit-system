-- =====================================================================
-- ⚠️  DANGER — ล้างข้อมูลทดสอบก่อนใช้งานจริง (RESET)
-- =====================================================================
-- ไฟล์นี้ "ไม่ใช่" migration และไม่ควรรันโดยไม่ตั้งใจ
-- ใช้ครั้งเดียวตอนจะเปลี่ยนจากช่วงทดสอบ → ใช้งานจริง
--
-- ✅ เก็บไว้ (ไม่แตะ): plants, areas, criteria, profiles (ข้อมูลตั้งต้น + ผู้ใช้)
-- ❌ ล้าง: ผลการตรวจ, การมอบหมาย, log, รูปภาพ
--
-- วิธีใช้: Supabase → SQL Editor → New query (แยกจาก patches!) → วาง → Run
--         แนะนำรัน "ส่วนที่ 0 (สำรอง)" ก่อนเสมอ แล้วค่อยรันส่วนล้าง
-- =====================================================================


-- =====================================================================
-- ส่วนที่ 0: สำรองข้อมูลก่อนล้าง  (รันก่อนเสมอ!)
-- ก๊อปข้อมูลปัจจุบันไปเก็บเป็นตาราง _backup — ถ้าเปลี่ยนใจกู้กลับได้
-- =====================================================================
create table if not exists public.audit_headers_backup as table public.audit_headers;
create table if not exists public.audit_details_backup as table public.audit_details;
create table if not exists public.schedules_backup     as table public.schedules;
create table if not exists public.audit_logs_backup    as table public.audit_logs;

-- ⚠️ ปิดตารางสำรองไม่ให้เข้าถึงผ่าน API — ห้ามลืม!
-- Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ตารางใหม่ใน public grant แก่ anon/authenticated
-- อัตโนมัติ และ RLS ปิดโดยปริยาย → ถ้าไม่ล็อก ผู้ใช้ที่ล็อกอินคนไหนก็อ่านผลตรวจ
-- ทั้งบริษัทจากตารางสำรองได้ (bypass RLS ของตารางจริงทั้งหมด)
-- การกู้คืนทำผ่าน SQL Editor (role postgres bypass RLS) จึงไม่กระทบ
revoke all on public.audit_headers_backup from anon, authenticated;
revoke all on public.audit_details_backup from anon, authenticated;
revoke all on public.schedules_backup     from anon, authenticated;
revoke all on public.audit_logs_backup    from anon, authenticated;
alter table public.audit_headers_backup enable row level security;
alter table public.audit_details_backup enable row level security;
alter table public.schedules_backup     enable row level security;
alter table public.audit_logs_backup    enable row level security;

-- (ถ้าเคยสำรองไว้แล้วและอยากเขียนทับด้วยข้อมูลล่าสุด ให้ลบ backup เก่าก่อน:)
--   drop table if exists public.audit_headers_backup, public.audit_details_backup,
--                        public.schedules_backup, public.audit_logs_backup;
--   แล้วรัน create ด้านบนอีกครั้ง

-- เช็คว่าสำรองครบ (จำนวนควรเท่าตารางจริง)
-- select
--   (select count(*) from public.audit_headers_backup) as headers_backup,
--   (select count(*) from public.audit_details_backup) as details_backup,
--   (select count(*) from public.schedules_backup)     as schedules_backup,
--   (select count(*) from public.audit_logs_backup)    as logs_backup;


-- =====================================================================
-- ส่วนที่ 1–4: ล้างข้อมูล  (รันหลังสำรองแล้วเท่านั้น)
-- TRUNCATE ไม่ปลุก trigger log จึงไม่เกิด log การลบ
-- =====================================================================

-- 1) ผลการตรวจ + คะแนน  (audit_headers → cascade ไป audit_details)
truncate table public.audit_details, public.audit_headers restart identity cascade;

-- 2) การมอบหมาย (schedules) — ใส่ -- หน้าบรรทัดล่างถ้าอยากเก็บการมอบหมายไว้
truncate table public.schedules restart identity;

-- 3) บันทึกกิจกรรม (audit_logs) — ล้าง log ช่วงทดสอบ เริ่มนับใหม่
truncate table public.audit_logs restart identity;

-- 4) รูปภาพการตรวจใน Storage (bucket: audit-photos)
delete from storage.objects where bucket_id = 'audit-photos';


-- =====================================================================
-- ตรวจสอบหลังล้าง (ควรได้ 0 ทั้งหมด ยกเว้น master ที่ยังอยู่ครบ)
-- =====================================================================
-- select
--   (select count(*) from public.audit_headers) as headers,
--   (select count(*) from public.audit_details) as details,
--   (select count(*) from public.schedules)     as schedules,
--   (select count(*) from public.audit_logs)    as logs,
--   (select count(*) from public.areas)         as areas_kept,
--   (select count(*) from public.criteria)      as criteria_kept,
--   (select count(*) from public.profiles)      as users_kept;


-- =====================================================================
-- 🔄 วิธีกู้คืนจาก backup (ถ้าเปลี่ยนใจ — รันเฉพาะตอนต้องการกู้)
-- =====================================================================
-- insert into public.audit_headers select * from public.audit_headers_backup;
-- insert into public.audit_details select * from public.audit_details_backup;
-- insert into public.schedules     select * from public.schedules_backup;
-- insert into public.audit_logs    select * from public.audit_logs_backup;

-- =====================================================================
-- 🧹 ลบตาราง backup ทิ้ง (เมื่อมั่นใจว่าไม่ต้องกู้แล้ว)
-- =====================================================================
-- drop table if exists public.audit_headers_backup, public.audit_details_backup,
--                      public.schedules_backup, public.audit_logs_backup;
