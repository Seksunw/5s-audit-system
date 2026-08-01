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
