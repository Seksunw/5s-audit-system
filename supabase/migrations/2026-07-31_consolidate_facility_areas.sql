-- =====================================================================
-- Migration: แยกโรงอาหาร/ช่าง-ยูทิลิตี้ เป็น 2 กลุ่มรายงานของตัวเอง
-- Date: 2026-07-31
-- แนวคิด: เดิมแต่ละโรงงาน (SUP/POC/NIF) มีโรงอาหาร+ช่างของตัวเอง (3+3)
--        เปลี่ยนเป็น 2 กลุ่มส่วนกลางแยกกัน (สรุปคะแนนจะได้ 5 กลุ่ม):
--          CAF = Cafeteria           (โรงอาหาร 1 พื้นที่)
--          MTN = Maintenance & Utility (ช่าง/ยูทิลิตี้ 1 พื้นที่)
--        พื้นที่เดิมปิด (inactive) เก็บประวัติการตรวจไว้ ไม่ลบ
-- วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ปลอดภัย)
-- =====================================================================

-- 1) กลุ่มรายงานส่วนกลาง 2 กลุ่ม (เป็น plant เพื่อให้ dashboard แยกสรุปได้)
insert into public.plants (plant_id, plant_name, status) values
  ('CAF', 'Cafeteria',            'active'),
  ('MTN', 'Maintenance & Utility','active')
on conflict (plant_id) do nothing;

-- 2) พื้นที่ของแต่ละกลุ่ม อย่างละ 1
insert into public.areas (area_id, plant_id, area_name, area_type, status) values
  ('CAF-CF', 'CAF', 'โรงอาหาร',       'cafeteria',   'active'),
  ('MTN-MU', 'MTN', 'ช่าง/ยูทิลิตี้', 'maintenance', 'active')
on conflict (area_id) do nothing;

-- 3) ปิดพื้นที่โรงอาหาร/ช่าง เดิมของแต่ละโรงงาน (เก็บประวัติไว้)
update public.areas
   set status = 'inactive'
 where area_id in ('SUP-CF','POC-CF','NIF-CF','SUP-MU','POC-MU','NIF-MU');
