-- =====================================================================
-- ขั้นตอนรัน SQL — 5 สิงหาคม 2026
-- งาน: จัดระเบียบสิทธิ์ให้เหลือ 3 roles + ล็อกผลตรวจหลัง submit
--
-- ⚠️ ไฟล์นี้เป็น "คู่มือรัน" — แบ่งเป็น 4 ขั้น ต้องรันตามลำดับ
--    ห้ามก๊อปทั้งไฟล์ไปรันรอบเดียว (ขั้นที่ 1 ต้องแยก transaction)
--
-- เนื้อหาเหมือนกับ patches.sql ส่วน G — ไฟล์นี้แค่จัดให้ก๊อปง่าย
-- =====================================================================


-- #####################################################################
-- ขั้นที่ 0 — เก็บภาพก่อนแก้ (ไม่บังคับ แต่แนะนำ)
-- #####################################################################
-- ก๊อปผลลัพธ์เก็บไว้ ถ้าต้องย้อนกลับจะรู้ว่าเดิมเป็นอะไร

select unnest(enum_range(null::user_role))::text as role_ที่มีอยู่;

select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('audit_headers', 'schedules')
 order by tablename, policyname;

select prosrc as is_staff_เดิม
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'is_staff';


-- #####################################################################
-- ขั้นที่ 1 — เพิ่ม viewer เข้า enum  ★ รันบรรทัดนี้เดี่ยว ๆ ★
-- #####################################################################
-- ⚠️ ต้องแยกออกมารันคนเดียว — ค่า enum ที่เพิ่งเพิ่มใช้ใน transaction
--    เดียวกันไม่ได้ ถ้ารันพร้อมขั้นที่ 2 จะขึ้น
--    "unsafe use of new value of enum type"
--
-- วิธีรันให้แน่ใจว่าแยก: ลบ SQL อื่นออกจาก editor ให้เหลือบรรทัดนี้เท่านั้น

alter type user_role add value if not exists 'viewer';

-- ตรวจก่อนไปขั้นต่อไป — ต้องเห็น viewer ในผลลัพธ์
--   select unnest(enum_range(null::user_role))::text;


-- #####################################################################
-- ขั้นที่ 2 — RLS + ล็อกผลตรวจ + RPC  (รันรวมกันได้ทั้งบล็อก)
-- #####################################################################

-- ---- G1) viewer ตรวจ 5ส ไม่ได้ + ปิด BOPLA ---------------------------
-- เดิม: with check (auditor_id = auth.uid() or is_staff())
--       → admin/manager ปลอม auditor_id เป็นชื่อคนอื่นได้
drop policy if exists headers_insert on public.audit_headers;
create policy headers_insert on public.audit_headers
  for insert with check (
    auditor_id = auth.uid()
    and coalesce(public.auth_role()::text, '') <> 'viewer'
  );


-- ---- G2) 🔒 ล็อกผลตรวจหลัง submit -----------------------------------
alter table public.audit_headers
  add column if not exists locked_at timestamptz;

drop policy if exists headers_update on public.audit_headers;
create policy headers_update on public.audit_headers
  for update using (
    (auditor_id = auth.uid() and locked_at is null)
    or coalesce(public.auth_role()::text, '') = 'admin'
  );

drop policy if exists headers_delete on public.audit_headers;
create policy headers_delete on public.audit_headers
  for delete using (
    coalesce(public.auth_role()::text, '') = 'admin'
    or (auditor_id = auth.uid() and locked_at is null)
  );

-- RLS คุมได้แค่ "แถวไหนในตารางนี้" ไม่ได้คุมข้ามตาราง → ต้องใช้ trigger
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


-- ---- G3) log การแก้คะแนน (เดิมไม่มีร่องรอยเลย) ----------------------
drop trigger if exists trg_log_details on public.audit_details;
create trigger trg_log_details
after update of score, na, remark or delete on public.audit_details
for each row execute function public.log_activity('detail_id');


-- ---- G4) schedules: auditor แก้ได้แค่สถานะ --------------------------
-- เดิม: for update using (auth.uid() = any(auditor_ids))  ← ไม่จำกัดคอลัมน์
--       → auditor เลื่อน audit_date / ถอดคนอื่นออกจาก auditor_ids ได้
drop policy if exists schedules_auditor_update on public.schedules;

create or replace function public.mark_schedule_done(p_schedule_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.schedules
     where schedule_id = p_schedule_id
       and (auth.uid() = any(auditor_ids)
            or coalesce(public.auth_role()::text, '') = 'admin')
  ) then
    raise exception 'ไม่ได้รับมอบหมายงานนี้';
  end if;

  update public.schedules
     set status = 'completed'
   where schedule_id = p_schedule_id;
end $$;

grant execute on function public.mark_schedule_done(uuid) to authenticated;


-- ---- G5) is_staff() = admin เท่านั้น --------------------------------
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.auth_role()::text = 'admin', false);
$$;


-- #####################################################################
-- ขั้นที่ 3 — ตรวจผล (ต้องผ่านทุกข้อก่อน deploy โค้ด)
-- #####################################################################

-- 3.1 enum มี viewer  → ต้องได้ 1
select count(*) as ok_enum_viewer
  from unnest(enum_range(null::user_role)) r
 where r::text = 'viewer';

-- 3.2 คอลัมน์ locked_at  → ต้องได้ 1
select count(*) as ok_locked_at
  from information_schema.columns
 where table_schema = 'public' and table_name = 'audit_headers'
   and column_name = 'locked_at';

-- 3.3 trigger บน audit_details  → ต้องเห็น 3 ชื่อ
--     trg_chk_locked · trg_log_details · trg_recalc_audit
select tgname
  from pg_trigger
 where tgrelid = 'public.audit_details'::regclass and not tgisinternal
 order by tgname;

-- 3.4 RPC mark_schedule_done รับ uuid  → ต้องได้ uuid
select proname, pg_get_function_arguments(oid) as args
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'mark_schedule_done';

-- 3.5 policy schedules_auditor_update ถูกลบแล้ว  → ต้องได้ 0
select count(*) as ควรได้_0
  from pg_policies
 where schemaname = 'public' and tablename = 'schedules'
   and policyname = 'schedules_auditor_update';

-- 3.6 is_staff() = admin เท่านั้น  → ต้องเห็นเฉพาะ 'admin' ไม่มี 'manager'
select prosrc from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'is_staff';

-- 3.7 headers_insert บังคับ auditor_id = auth.uid()  → ต้องเห็นทั้ง 2 เงื่อนไข
select policyname, cmd, coalesce(with_check, qual) as เงื่อนไข
  from pg_policies
 where schemaname = 'public' and tablename = 'audit_headers'
 order by policyname;


-- #####################################################################
-- ขั้นที่ 4 — smoke test เรียก RPC จริง (บทเรียน 5 ส.ค.)
-- #####################################################################
-- "โค้ดมีอยู่" ≠ "ทำงานได้" — admin_reset_data() ผ่าน static review 2 รอบ
-- แต่พังที่บรรทัดแรกเสมอ เพราะไม่มีใครเคย "เรียก" มันจริง
--
-- RPC ใหม่ต้องทดสอบว่า "เรียกได้" ไม่ใช่แค่ "สร้างได้"
-- SQL Editor รันเป็น postgres (ไม่มี auth.uid()) → คาดว่าจะได้ exception
-- "ไม่ได้รับมอบหมายงานนี้" ซึ่งถือว่า ✅ ผ่าน (ฟังก์ชันเรียกได้ + สิทธิ์ทำงาน)
-- ถ้าได้ "function does not exist" หรือ error เรื่องชนิดข้อมูล = ❌ ยังพัง

select public.mark_schedule_done('00000000-0000-0000-0000-000000000000'::uuid);


-- #####################################################################
-- ขั้นที่ 5 — [ยังไม่ได้รัน · ไม่บังคับ] กัน viewer อัปโหลดรูป
-- #####################################################################
-- ช่องที่ยังเปิดอยู่: policy audit_photos_insert เช็กแค่ bucket_id
-- → viewer อัปโหลดไฟล์เข้า bucket ได้ (ไม่กระทบข้อมูลผลตรวจ เพราะ
--   headers_insert บล็อกไว้แล้ว แต่เปลืองพื้นที่/เปิดช่องให้ทิ้งไฟล์)
--
-- ยังไม่รันเพราะยังไม่ตัดสินใจ — จะรันเมื่อไหร่ก็ได้ ไม่ต้องแก้โค้ด client

-- drop policy if exists audit_photos_insert on storage.objects;
-- create policy audit_photos_insert on storage.objects
--   for insert to authenticated
--   with check (
--     bucket_id = 'audit-photos'
--     and coalesce(public.auth_role()::text, '') <> 'viewer'
--   );


-- #####################################################################
-- แผนย้อนกลับ (ถ้าจำเป็น)
-- #####################################################################
-- ลบ enum value ไม่ได้ (Postgres ไม่มี drop value) — แต่ไม่กระทบอะไร
-- ที่เหลือย้อนได้:
--
--   drop trigger if exists trg_chk_locked  on public.audit_details;
--   drop trigger if exists trg_log_details on public.audit_details;
--   alter table public.audit_headers drop column if exists locked_at;
--
--   drop policy if exists headers_insert on public.audit_headers;
--   create policy headers_insert on public.audit_headers
--     for insert with check (auditor_id = auth.uid() or public.is_staff());
--
--   create policy schedules_auditor_update on public.schedules
--     for update using (auth.uid() = any(auditor_ids));
--
--   create or replace function public.is_staff() returns boolean
--   language sql stable security definer set search_path = public as $$
--     select coalesce(public.auth_role()::text in ('admin','manager'), false);
--   $$;
--
-- ⚠️ ต้องย้อนโค้ดฝั่ง client ด้วย (finalizeAudit / completeSchedule)
--    ไม่งั้น completeSchedule จะเรียก RPC ที่ไม่มีอยู่
