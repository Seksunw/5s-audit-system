-- =====================================================================
-- Migration: ให้แต่ละโรงงานเหลือ Warehouse/Production/Office ชั้นตัวแทนชั้นเดียว
-- Date: 2026-07-31
-- แนวคิด: 3 โรงงานอยู่อาคารเดียวกัน แต่ละโรงงานเป็นตัวแทนคนละชั้น
--          Supplement Plant            → ชั้น F1
--          Personal and Oral Care Plant → ชั้น F2
--          Nutrina Interfoods Plant     → ชั้น F3
--        ปิดพื้นที่ชั้นที่ไม่ใช่ตัวแทนของแต่ละโรงงาน (เก็บประวัติไว้ ไม่ลบ)
--        รอบอาคาร (outdoor) คงเดิมทุกโรงงาน
-- วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ปลอดภัย)
-- =====================================================================

update public.areas
   set status = 'inactive'
 where area_id in (
   -- Supplement เก็บ F1 → ปิด F2, F3
   'SUP-WH-F2','SUP-WH-F3','SUP-PR-F2','SUP-PR-F3','SUP-OF-F2','SUP-OF-F3',
   -- Personal and Oral Care เก็บ F2 → ปิด F1, F3
   'POC-WH-F1','POC-WH-F3','POC-PR-F1','POC-PR-F3','POC-OF-F1','POC-OF-F3',
   -- Nutrina Interfoods เก็บ F3 → ปิด F1, F2
   'NIF-WH-F1','NIF-WH-F2','NIF-PR-F1','NIF-PR-F2','NIF-OF-F1','NIF-OF-F2'
 );
