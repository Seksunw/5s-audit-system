-- =====================================================================
-- Migration: เพิ่มตัวเลือก "ไม่มีในพื้นที่ (N/A)" และตัดออกจากการคำนวณคะแนน
-- Date: 2026-07-31
-- แนวคิด: ถ้าพื้นที่ไม่มีอุปกรณ์/หมวดนั้น ผู้ตรวจกด"ไม่มีในพื้นที่"
--        ข้อเหล่านั้นจะ na=true และถูกตัดออกจากทั้ง total_score และ max_score
--        (ไม่ถูกนับเป็น 0 อีกต่อไป → เปอร์เซ็นต์ยุติธรรมขึ้น)
-- วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ปลอดภัย)
-- =====================================================================

-- 1) เพิ่มคอลัมน์ na (default false = นับคะแนนตามปกติ)
alter table public.audit_details
  add column if not exists na boolean not null default false;

-- 2) แก้ trigger ให้ filter na ออกจากทั้งตัวตั้งและตัวหาร
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
  select coalesce(sum(d.score)      filter (where not d.na), 0),
         coalesce(sum(c.max_score)  filter (where not d.na), 0)
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
