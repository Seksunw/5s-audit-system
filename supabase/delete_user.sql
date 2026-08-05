-- =====================================================================
-- ลบผู้ใช้ออกจากระบบ (Supabase SQL Editor เท่านั้น)
--
-- ⚠️ อ่านก่อนใช้
--   • ทำผ่านแอปไม่ได้ — FK จาก audit_logs / audit_headers บล็อกอยู่
--     และ audit_logs ถูก revoke update,delete จาก authenticated (append-only)
--     SQL Editor รันเป็น postgres (เจ้าของตาราง) จึงข้ามได้
--   • ถ้าคนนั้น "มีผลตรวจ" → อย่าลบ ให้ใช้ Status = Inactive แทน
--     ลบแล้วผลตรวจเก่าจะไม่มีเจ้าของ = ทำลายคุณค่าของ audit trail
--
-- 📌 วิธีใช้: แก้อีเมลใน @email ของทุกขั้น (Find & Replace ทีเดียวก็ได้)
--    ไม่ต้องก๊อป UUID ไปมา — ทุก query หา id จากอีเมลเอง
--
-- ระบบใช้งานจริง — รันทีละขั้น อ่านผลก่อนไปขั้นถัดไป
-- =====================================================================


-- #####################################################################
-- ขั้นที่ 1 — ดูว่าเป็นใคร + ติดอะไรอยู่  ★ จุดตัดสินใจ ★
-- #####################################################################

select
  p.id as uuid, p.name, p.email, p.role::text, p.status::text,
  (select count(*) from public.audit_headers h where h.auditor_id = p.id) as ผลตรวจ,
  (select count(*) from public.audit_logs    l where l.user_id    = p.id) as log,
  (select count(*) from public.schedules     s where p.id = any(s.auditor_ids)) as งานที่มอบหมาย
from public.profiles p
where p.email = 'someone@example.com';   -- << แก้อีเมล

-- ตัดสินใจจากคอลัมน์ "ผลตรวจ":
--
--   ผลตรวจ = 0  → ลบได้ ไปขั้นที่ 2
--   ผลตรวจ > 0  → 🛑 หยุด ใช้ Inactive แทน (ดูท้ายไฟล์)
--                  ถ้ายืนยันจะลบจริง ต้องลบผลตรวจทิ้งด้วย = เสียประวัติถาวร
--
-- ถ้า query ไม่คืนแถวเลย = ไม่มี profile ของอีเมลนี้ (อาจมีแต่ auth.users)
--   ตรวจด้วย: select id, email from auth.users where email = 'someone@example.com';


-- #####################################################################
-- ขั้นที่ 2 — ตัด FK โดย "รักษา log ไว้"
-- #####################################################################
-- ไม่ลบแถวใน audit_logs — แค่ตัดความเชื่อมโยงกับ profiles
-- ข้อความใน log (detail / old_data / new_data) ยังอยู่ครบ ตรวจย้อนหลังได้
-- user_id เป็น nullable อยู่แล้ว จึงตั้งเป็น null ได้

begin;

update public.audit_logs
   set user_id = null
 where user_id = (select id from public.profiles
                   where email = 'someone@example.com');   -- << แก้อีเมล

-- ถอดออกจากงานที่มอบหมาย (auditor_ids เป็น array ไม่มี FK จึงไม่บล็อก
-- แต่ถ้าปล่อยไว้จะเหลือ UUID ผีที่หาชื่อไม่เจอ)
update public.schedules s
   set auditor_ids = array_remove(
         s.auditor_ids,
         (select id from public.profiles where email = 'someone@example.com'))  -- << แก้
 where (select id from public.profiles
         where email = 'someone@example.com') = any(s.auditor_ids);             -- << แก้

commit;

-- ตรวจว่าเคลียร์แล้ว → ต้องได้ 0 · 0
select
  (select count(*) from public.audit_logs l where l.user_id = p.id) as log_ที่ยังผูก,
  (select count(*) from public.schedules  s where p.id = any(s.auditor_ids)) as งานที่ยังผูก
from public.profiles p
where p.email = 'someone@example.com';   -- << แก้อีเมล


-- #####################################################################
-- ขั้นที่ 3 — ลบบัญชี
-- #####################################################################
-- profiles.id มี `references auth.users(id) on delete cascade`
-- → ลบที่ auth.users แล้ว profiles หายตามเอง ไม่ต้องลบ 2 ที่
--
-- ⚠️ อย่าลบ profiles ก่อน — จะได้ผลครึ่ง ๆ กลาง ๆ (อีเมลยังถูกจอง
--    คนนั้น login ผ่าน auth ได้แต่เจอ "ไม่พบโปรไฟล์")
--    นี่คือบั๊กของปุ่ม "ลบผู้ใช้" ในแอปตอนนี้
--
-- 🟢 วิธีที่แนะนำ — Dashboard
--    Authentication → Users → ค้นอีเมล → ⋯ → Delete user
--    (ผ่าน Admin API จัดการ session / identity ที่ค้างให้ด้วย)
--
-- 🟡 หรือรันตรงถ้าอยากทำในหน้าเดียว — uncomment:

-- delete from auth.users
--  where email = 'someone@example.com';   -- << แก้อีเมล


-- #####################################################################
-- ขั้นที่ 4 — ยืนยัน  → ต้องได้ 0 ทั้งคู่
-- #####################################################################

select
  (select count(*) from public.profiles where email = 'someone@example.com') as profiles,
  (select count(*) from auth.users      where email = 'someone@example.com') as auth_users;

-- อีเมลนั้นถูกปล่อยแล้ว → สมัครใหม่ด้วยอีเมลเดิมได้


-- =====================================================================
-- ทางเลือกที่แนะนำกว่า — ระงับการใช้งาน (ไม่เสียประวัติ)
-- =====================================================================
-- ทำในแอปได้เลย: users.html → แก้ผู้ใช้ → Status = Inactive
-- หรือรันตรง:
--
--   update public.profiles
--      set status = 'inactive', updated_at = now()
--    where email = 'someone@example.com';
--
-- ผล:
--   • login ใหม่ถูกบล็อก (SBH.login เช็ก status !== 'active')
--   • คนที่กำลังล็อกอินอยู่ถูกเตะออกทันทีที่เปลี่ยนหน้า
--     (Session.refreshRole() — เพิ่มเมื่อ 5 ส.ค. 2026)
--   • ผลตรวจเก่า ชื่อผู้ตรวจ ประวัติ ยังครบทุกอย่าง
--
-- กู้คืน: เปลี่ยน status กลับเป็น 'active'
-- =====================================================================
