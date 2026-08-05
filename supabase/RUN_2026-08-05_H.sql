-- =====================================================================
-- 🟢 รันไฟล์นี้ได้ทั้งไฟล์ในครั้งเดียว  (Supabase SQL Editor)
--
-- วิธีใช้: เปิดไฟล์นี้ → เลือกทั้งหมด (Cmd+A) → ก๊อป → วางใน SQL Editor → Run
--          ไม่ต้องเลือกบางส่วน ไม่ต้องแยกขั้น
--
-- เนื้อหาเดียวกับ patches.sql ส่วน H — ไฟล์นี้แค่ตัดมาให้ก๊อปทั้งไฟล์ได้
-- รันซ้ำได้ (idempotent): ใช้ if not exists / or replace / drop if exists ทุกจุด
-- =====================================================================


-- =====================================================================
-- ส่วน H: ผู้ตรวจหลายคนต่อพื้นที่ — สถานะรายคน  (5 ส.ค. 2026 เย็น)
-- =====================================================================
-- ปัญหา: schedules 1 แถวมี auditor_ids หลายคน แต่ status ช่องเดียว
--   → คนแรก submit แล้ว status='completed' → คนที่ 2 ตรวจไม่ได้
--   → KPI ผิด (นับแถว ไม่ใช่นับคน) · ปุ่ม "ดูผล" เปิดผลของคนอื่น
--
-- แนวทาง: ผลตรวจผูกกับงานที่มอบหมายตรง ๆ แล้วคำนวณสถานะจากผลตรวจจริง
--   "auditor X ทำงาน S เสร็จ ⟺ มี audit_headers ที่ schedule_id=S และ auditor_id=X"
--   ไม่เก็บสถานะรายคนไว้ที่ไหน → ข้อมูลขัดกันเองไม่ได้
--
-- ⚠️ รันส่วนนี้ได้ทั้งบล็อกในครั้งเดียว (ไม่มี alter type แบบส่วน G)
-- =====================================================================


-- ---------------------------------------------------------------------
-- H1) เส้นเชื่อม: ผลตรวจ → งานที่มอบหมาย
-- ---------------------------------------------------------------------
-- on delete set null: admin ลบงานที่มอบหมายได้ ผลตรวจไม่หายไปด้วย
alter table public.audit_headers
  add column if not exists schedule_id uuid references public.schedules(schedule_id) on delete set null;

-- audit_round เก็บซ้ำในตัว header ไม่ join เอาตอนอ่าน เพราะ:
--   1. schedule_id เป็น null ได้ (งานถูกลบ) → ถ้า join จะไม่รู้ว่ารอบไหน
--   2. admin แก้ audit_round ของงานทีหลัง ประวัติที่ตรวจไปแล้วต้องไม่เปลี่ยนตาม
alter table public.audit_headers
  add column if not exists audit_round text;

create index if not exists idx_headers_schedule on public.audit_headers(schedule_id);
create index if not exists idx_headers_round    on public.audit_headers(audit_round);

-- 1 คนตรวจ 1 งานได้ครั้งเดียว (partial — ตรวจนอกรอบที่ schedule_id is null ไม่ติด)
-- รอบ 1 / รอบ 2 ของพื้นที่เดียวกันเป็น schedule คนละตัว → ตรวจได้ทั้งสองรอบ
create unique index if not exists headers_one_per_schedule
  on public.audit_headers(schedule_id, auditor_id)
  where schedule_id is not null;


-- ---------------------------------------------------------------------
-- H2) BEFORE INSERT: ปิด BOPLA + ก๊อป audit_round
-- ---------------------------------------------------------------------
-- schedule_id มาจาก client (getParam('scheduleId')) → เชื่อไม่ได้
-- ถ้าไม่ตรวจ auditor จะใส่ schedule_id ของงานคนอื่นแล้วปิดงานคนอื่นได้
create or replace function public.chk_header_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_round text;
begin
  if new.schedule_id is null then
    return new;                       -- ตรวจนอกรอบ (เลือกพื้นที่เอง) — ปล่อยผ่าน
  end if;

  select auditor_ids, audit_round into v_ids, v_round
    from public.schedules
   where schedule_id = new.schedule_id;

  if v_ids is null then
    raise exception 'ไม่พบงานที่มอบหมายนี้';
  end if;

  -- admin ก็ปลอมไม่ได้ — auditor_id ต้องอยู่ในรายชื่อที่ถูกมอบหมายจริง
  if not (new.auditor_id = any(v_ids)) then
    raise exception 'คุณไม่ได้รับมอบหมายงานนี้';
  end if;

  new.audit_round := v_round;         -- ก๊อปไว้ ไม่ join ตอนอ่าน
  return new;
end $$;

drop trigger if exists trg_chk_header_schedule on public.audit_headers;
create trigger trg_chk_header_schedule
before insert on public.audit_headers
for each row execute function public.chk_header_schedule();


-- ---------------------------------------------------------------------
-- H3) view schedule_progress — ความจริงเรื่อง "ใครเสร็จ / ปิดงานหรือยัง"
-- ---------------------------------------------------------------------
-- นิยามที่เดียว ทุกหน้าอ่านจากนี่
-- (เคยเจอบั๊ก "pill 94% แต่ badge 100%" จากการคำนวณเลขเดียวกัน 2 ที่ — ไม่ทำซ้ำ)
--
-- ⚠️ security_invoker = true จำเป็นมาก
--    ถ้าไม่ใส่ view จะรันด้วยสิทธิ์เจ้าของ → RLS ของ schedules ไม่ทำงาน
--    → auditor เห็นงานของทุกคน (ย้อนนโยบายความเป็นส่วนตัว 4 ส.ค.)
--
-- required = ที่มอบหมาย ∩ active   (คนที่ถูกระงับไม่นับเป็น "ต้องตรวจ")
-- done ⊆ required เสมอ            (admin ถอดคนออกหลังเขาตรวจแล้ว ตัวเลขไม่เกิน 100%)
drop view if exists public.schedule_progress;
create view public.schedule_progress
with (security_invoker = true) as
select
  s.schedule_id,
  s.plant_id,
  s.area_id,
  s.audit_date,
  s.audit_round,
  s.auditor_ids,
  coalesce(r.required_ids, '{}'::uuid[])          as required_ids,
  coalesce(array_length(r.required_ids, 1), 0)    as required_n,
  coalesce(d.done_ids, '{}'::uuid[])              as done_ids,
  coalesce(array_length(d.done_ids, 1), 0)        as done_n,
  (
    coalesce(array_length(r.required_ids, 1), 0) > 0
    and coalesce(array_length(d.done_ids, 1), 0)
      = coalesce(array_length(r.required_ids, 1), 0)
  )                                               as is_completed
from public.schedules s
left join lateral (
  select array_agg(p.id order by p.name) as required_ids
    from public.profiles p
   where p.id = any(s.auditor_ids)
     and p.status = 'active'
) r on true
left join lateral (
  select array_agg(p.id order by p.name) as done_ids
    from public.profiles p
   where p.id = any(s.auditor_ids)
     and p.status = 'active'
     and exists (
       select 1 from public.audit_headers h
        where h.schedule_id = s.schedule_id
          and h.auditor_id  = p.id
          -- ⚠️ "มี header" ยังไม่พอ — ต้อง "submit เสร็จแล้ว"
          -- submitAuditHeader สร้าง header ก่อน แล้วส่ง details เป็นชุด ๆ ทีหลัง
          -- ถ้ายังส่ง details ไม่ครบ header จะค้างอยู่ที่ status='pending'
          -- (recalc_audit_header: v_max = 0 → 'pending')
          --
          -- locked_at  → finalizeAudit ตั้งเป็นขั้นสุดท้ายของการ submit ที่สำเร็จ
          -- status<>pending → เผื่อกรณี lock ล้มแต่คะแนนถูกคำนวณแล้ว
          --                   (finalizeAudit คืน success แม้ตั้ง lock ไม่ผ่าน)
          and (h.locked_at is not null or h.status <> 'pending')
     )
) d on true;

grant select on public.schedule_progress to authenticated;


-- ---------------------------------------------------------------------
-- H4) sync schedules.status — ให้คอลัมน์ไม่โกหกเวลา query จาก SQL Editor
-- ---------------------------------------------------------------------
-- view คือความจริง · คอลัมน์นี้เป็นสำเนาเพื่อความสะดวก
--
-- ⚠️ เขียนเฉพาะตอน "ค่าเปลี่ยนจริง" (status is distinct from ...) เพราะ
--    trg_log_schedules เป็น `after insert or update or delete` → ถ้าเขียนทุกครั้ง
--    จะได้ log ขยะ 1 แถวต่อการ submit 1 ครั้ง
--    (ปัญหาเดียวกับที่ trg_log_headers ตั้งใจเลี่ยงไว้ — ดูคอมเมนต์ C3)
--    เขียนเฉพาะตอนเปลี่ยน → log ที่ได้คือ "งานนี้ปิดแล้ว" ซึ่งมีประโยชน์
create or replace function public.sync_schedule_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sid uuid; v_done boolean;
begin
  v_sid := coalesce(new.schedule_id, old.schedule_id);
  if v_sid is null then return coalesce(new, old); end if;

  select sp.is_completed into v_done
    from public.schedule_progress sp
   where sp.schedule_id = v_sid;

  update public.schedules
     set status = case when coalesce(v_done, false) then 'completed' else 'pending' end
   where schedule_id = v_sid
     and status is distinct from
         (case when coalesce(v_done, false) then 'completed' else 'pending' end)::schedule_status;

  return coalesce(new, old);
end $$;

-- ไม่ต้อง trigger บน schedules / profiles เพราะ view คำนวณสด
-- (คอลัมน์ status อาจค้างชั่วคราวถ้า admin เพิ่มคนหรือระงับคน — UI ไม่ได้ใช้ค่านี้)
-- ⚠️ ต้องมี `update of locked_at, status` ด้วย ไม่ใช่แค่ insert/delete
--    เพราะตอน insert header ยังเป็น pending (ยังไม่ส่ง details) → ยังไม่นับว่าเสร็จ
--    ค่าจะเปลี่ยนเป็น "เสร็จ" ตอน recalc ตั้ง status หรือ finalizeAudit ตั้ง locked_at
--    ซึ่งทั้งคู่เป็น UPDATE
--
-- ไม่วนซ้ำ: recalc_audit_header() update audit_headers → trigger นี้ update schedules
--           (คนละตาราง) → จบ
drop trigger if exists trg_sync_sched_status on public.audit_headers;
create trigger trg_sync_sched_status
after insert or delete on public.audit_headers
for each row execute function public.sync_schedule_status();

-- แยก trigger ของ UPDATE ออกมาเพื่อใส่ WHEN — สำคัญเรื่องประสิทธิภาพ
--
-- ⚠️ trg_recalc_audit บน audit_details เป็น `for each row` → การ submit 1 ครั้ง
--    (เกณฑ์ ~67 ข้อ) ทำให้ audit_headers ถูก UPDATE ~67 ครั้ง
--    ถ้าไม่มี WHEN ตัวนี้จะยิงตาม 67 ครั้ง แต่ละครั้งอ่าน view ที่ join 3 ตาราง
--    → submit ช้าลงชัดเจนโดยไม่ได้อะไรเพิ่ม
--
--    WHEN นี้กรองให้เหลือเฉพาะครั้งที่ค่าที่เกี่ยวข้องเปลี่ยนจริง
--    (status: pending → good/excellent ครั้งเดียว · locked_at: null → เวลา ครั้งเดียว)
drop trigger if exists trg_sync_sched_status_upd on public.audit_headers;
create trigger trg_sync_sched_status_upd
after update of locked_at, status on public.audit_headers
for each row
when (old.status   is distinct from new.status
   or old.locked_at is distinct from new.locked_at)
execute function public.sync_schedule_status();

-- ยกเลิก RPC ตัวเก่า — trigger ทำแทนแล้ว
drop function if exists public.mark_schedule_done(uuid);

-- =====================================================================
-- ✅ ขั้นที่ 2 — ตรวจผล  (รันหลังบล็อกข้างบนขึ้น "Success")
-- =====================================================================
-- ⚠️ SQL Editor โชว์ผลแค่ statement สุดท้าย → รวมเป็น query เดียว
--    ก๊อปทั้ง query นี้ (ตั้งแต่ select ถึง ; ) รันครั้งเดียว ได้ 5 บรรทัด
--
-- หมายเหตุ: ไม่อ่านจาก view ตรง ๆ ใน query นี้ตั้งใจ —
--   Postgres resolve ชื่อตารางตอน parse ทั้ง query ถ้า view ยังไม่มี
--   จะ error ทั้งชุดแล้วมองไม่เห็นผลข้ออื่นเลย (บทเรียนจาก to_regclass เมื่อเช้า)

select 'A) คอลัมน์ใหม่  (ควรได้ 2)' as ตรวจ,
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='audit_headers'
           and column_name in ('schedule_id','audit_round')) as ผล
union all
select 'B) view + security_invoker  (ต้องเห็น security_invoker=true)',
       coalesce((select array_to_string(c.reloptions, ', ') from pg_class c
                  where c.relnamespace='public'::regnamespace
                    and c.relname='schedule_progress'),
                'ไม่มี view / ไม่มี reloptions')
union all
select 'C) trigger บน audit_headers  (ควรได้ 4 ชื่อ)',
       coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                  where tgrelid='public.audit_headers'::regclass
                    and not tgisinternal), 'ไม่มี')
union all
select 'D) unique index  (ควรได้ 1)',
       (select count(*)::text from pg_indexes
         where schemaname='public' and indexname='headers_one_per_schedule')
union all
select 'E) mark_schedule_done ถูกลบแล้ว  (ควรได้ 0)',
       (select count(*)::text from pg_proc
         where pronamespace='public'::regnamespace and proname='mark_schedule_done');


-- ---------------------------------------------------------------------
-- ขั้นที่ 3 — อ่าน view จริง (รันแยก เพราะถ้า view ไม่มีจะ error)
-- ---------------------------------------------------------------------
-- ตอนนี้ยังไม่มีข้อมูลก็ได้ 0 แถว = ปกติ ขอแค่ไม่ error

select * from public.schedule_progress
 order by audit_date desc nulls last
 limit 10;


-- =====================================================================
-- แผนย้อนกลับ (ถ้าจำเป็น)
-- =====================================================================
-- drop trigger if exists trg_chk_header_schedule    on public.audit_headers;
-- drop trigger if exists trg_sync_sched_status      on public.audit_headers;
-- drop trigger if exists trg_sync_sched_status_upd  on public.audit_headers;
-- drop view  if exists public.schedule_progress;
-- drop index if exists public.headers_one_per_schedule;
-- alter table public.audit_headers drop column if exists schedule_id;
-- alter table public.audit_headers drop column if exists audit_round;
--
-- -- คืน RPC เดิม (สำเนาจาก patches.sql ส่วน G4)
-- create or replace function public.mark_schedule_done(p_schedule_id uuid)
-- returns void language plpgsql security definer set search_path = public as $$
-- begin
--   if not exists (
--     select 1 from public.schedules
--      where schedule_id = p_schedule_id
--        and (auth.uid() = any(auditor_ids) or coalesce(public.auth_role()::text,'') = 'admin')
--   ) then
--     raise exception 'ไม่ได้รับมอบหมายงานนี้';
--   end if;
--   update public.schedules set status = 'completed' where schedule_id = p_schedule_id;
-- end $$;
-- grant execute on function public.mark_schedule_done(uuid) to authenticated;
--
-- ⚠️ ต้อง git revert ฝั่ง client ด้วย ไม่งั้น submitAuditHeader จะส่งคอลัมน์ที่ไม่มี
