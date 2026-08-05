-- =====================================================================
-- 5S Audit System — Storage bucket (รูปถ่าย) + ตั้ง Admin คนแรก
-- รันใน Supabase SQL Editor หลัง schema.sql + seed_master.sql
-- =====================================================================

-- 1) สร้าง bucket สำหรับรูป audit (public read)
insert into storage.buckets (id, name, public)
values ('audit-photos', 'audit-photos', true)
on conflict (id) do nothing;

-- 2) policy: ผู้ล็อกอินอัปโหลดได้ / ใครก็อ่าน (bucket public)
-- viewer (ผู้บริหาร) อัปโหลดไม่ได้ — ตรวจ 5ส ไม่ได้อยู่แล้ว จึงไม่มีเหตุให้ส่งรูป
drop policy if exists audit_photos_insert on storage.objects;
create policy audit_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audit-photos'
    and coalesce(public.auth_role()::text, '') <> 'viewer'
  );

drop policy if exists audit_photos_read on storage.objects;
create policy audit_photos_read on storage.objects
  for select
  using (bucket_id = 'audit-photos');

-- =====================================================================
-- 3) ตั้ง Admin คนแรก
--    ก่อนรันบรรทัดล่าง: ไปที่ Authentication → Users → Add user
--    ใส่ email + password (ติ๊ก Auto Confirm) — trigger จะสร้าง profile ให้อัตโนมัติ
--    แล้วแก้ email ด้านล่างเป็น email ที่เพิ่งสร้าง → รัน
-- =====================================================================
update public.profiles
   set role = 'admin', status = 'active', name = 'ผู้ดูแลระบบ'
 where email = 'REPLACE_WITH_ADMIN_EMAIL';   -- << แก้เป็น email admin ของคุณ ก่อนรัน
-- ⚠️ อย่า commit อีเมลจริงลงไฟล์นี้ — repo เป็น public
--    อีเมลผู้ดูแลระบบเป็นข้อมูลที่ช่วยให้คนทำ credential stuffing / phishing ได้ง่ายขึ้น

-- ตรวจผล
select id, email, name, role, status from public.profiles;
