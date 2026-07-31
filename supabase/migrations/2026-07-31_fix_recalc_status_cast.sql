-- =====================================================================
-- Migration: fix recalc_audit_header() status cast
-- Date: 2026-07-31
-- ปัญหา: submit ให้คะแนนแล้วได้ 400 Bad Request
--        error 42804 "column status is of type audit_status but expression is of type text"
-- สาเหตุ: ประโยค CASE คืนค่าเป็น text แต่คอลัมน์ audit_headers.status เป็น enum audit_status
--        Postgres ไม่ cast ให้อัตโนมัติ → trigger UPDATE ล้มเหลว → rollback ทั้ง transaction
-- แก้: cast ผล CASE เป็น ::audit_status
-- วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์ → Run (ปลอดภัย รันซ้ำได้)
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
