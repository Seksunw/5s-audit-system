-- RUN 2026-10-20 — snapshot ของ patches.sql ส่วน K (ตรวจแบบทีม) สำหรับวางใน SQL Editor
-- วิธีใช้: เปิดแท็บ query ใหม่ที่ว่างเปล่า → วางทั้งไฟล์นี้ → Run · รันซ้ำได้ (idempotent)
-- ทดสอบแล้วบน Postgres 17 ในเครื่อง (schema + patches ทั้งหมด): Round 1 ไม่เปลี่ยน + กรณีทดสอบแบบทีมผ่านครบ

-- =====================================================================
-- ส่วน K: ตรวจแบบทีม (Team audit) สำหรับ Round 2+   (20 ต.ค. 2026)
-- =====================================================================
-- แผนเต็ม: TEAM_AUDIT_PLAN.md (ไม่อยู่ใน git) · สรุป:
--   • admin มอบหมายพื้นที่ + กรรมการ 2–3 คน → ทีมใช้ผลตรวจ "ใบเดียวกัน" (1 header ต่องาน)
--   • คำตอบบันทึกลง audit_details ทุกครั้งที่กด (ดราฟ = header ที่ locked_at is null)
--   • ทุกคนในทีมกดส่ง (lock) ได้ · ต้องตอบครบทุกเกณฑ์ active (คะแนนหรือ N/A)
--   • ปิด "ตรวจนอกงานมอบหมาย" (schedule_id null) ที่ระดับ DB
--   • Round 1 (ตรวจเดี่ยว) ไม่เปลี่ยน: แยกด้วย schedules.team_mode / audit_headers.is_team
--
-- ความเข้ากันได้: รันก่อน deploy หน้าเว็บใหม่ได้ ตราบใดที่ยังไม่มอบหมายงาน Round 2
-- idempotent: รันซ้ำได้ทั้งส่วน
-- ⚠️ วางเฉพาะส่วนนี้ในแท็บ query ใหม่ที่ว่างเปล่า — อย่ารันทั้งไฟล์ / อย่าใช้แท็บเก่า
-- =====================================================================

-- K1) schedules.team_mode — งานใหม่ = ทีม · งานที่มีผลตรวจแบบเดี่ยวผูกอยู่แล้ว (Round 1) = เดี่ยว
--     (ไม่ใช้ "แถวเดิมทั้งหมด = เดี่ยว" — ถ้าเผลอมอบหมาย Round 2 ไว้ก่อน งานพวกนั้นต้องเป็นทีม)
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'schedules' and column_name = 'team_mode') then
    alter table public.schedules add column team_mode boolean not null default true;
    update public.schedules s set team_mode = false
     where exists (select 1 from public.audit_headers h where h.schedule_id = s.schedule_id);
  end if;
end $$;

-- 1 พื้นที่ = 1 งานต่อรอบ (ตรงกับ Schedule Board ที่ผูกงานตามรอบ — แก้ 2026-10-20)
create unique index if not exists schedules_one_per_area_round
  on public.schedules (area_id, audit_round);

-- K2) audit_headers.is_team + งานทีมมีผลตรวจได้ใบเดียว
alter table public.audit_headers add column if not exists is_team boolean not null default false;
create unique index if not exists headers_one_per_team_schedule
  on public.audit_headers (schedule_id) where is_team;

-- รายชื่อทีม ณ ตอนส่งผล (lock_audit ตั้งให้) — ประวัติ/PDF/Dashboard อ่านจากตรงนี้
--   ทำไมไม่อ่านจาก schedules.auditor_ids: (1) admin แก้รายชื่องานได้ภายหลัง ชื่อในผลเก่าต้องไม่เปลี่ยนตาม
--   (2) RLS ของ schedules ให้ viewer/คนนอกทีมอ่านไม่ได้ แต่ audit_headers ทุกคนที่ล็อกอินอ่านได้
alter table public.audit_headers add column if not exists team_ids uuid[];

-- K3) BEFORE INSERT ของ audit_headers — ปิดตรวจนอกงาน + ก๊อปค่าจากงานมอบหมาย
create or replace function public.chk_header_schedule()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ids   uuid[];
  v_round text;
  v_team  boolean;
  v_plant text;
  v_area  text;
begin
  -- ปิดตรวจนอกงานมอบหมาย (ตัดสินใจ 2026-10-20) — ทุกผลตรวจต้องผูกงานมอบหมาย
  if new.schedule_id is null then
    raise exception 'ตรวจได้เฉพาะพื้นที่ที่ได้รับมอบหมายเท่านั้น';
  end if;

  select auditor_ids, audit_round, team_mode, plant_id, area_id
    into v_ids, v_round, v_team, v_plant, v_area
    from public.schedules
   where schedule_id = new.schedule_id;

  if v_ids is null then
    raise exception 'ไม่พบงานที่มอบหมายนี้';
  end if;

  -- admin ก็ปลอมไม่ได้ — auditor_id ต้องอยู่ในรายชื่อที่ถูกมอบหมายจริง
  if not (new.auditor_id = any(v_ids)) then
    raise exception 'คุณไม่ได้รับมอบหมายงานนี้';
  end if;

  new.audit_round := v_round;                 -- ก๊อปไว้ ไม่ join ตอนอ่าน
  new.is_team     := coalesce(v_team, false);
  if new.is_team then                         -- งานทีม: พื้นที่/โรงงานมาจากงานมอบหมายเสมอ
    new.plant_id := v_plant;
    new.area_id  := v_area;
  end if;
  return new;
end $$;

-- K4) audit_details: คะแนนว่างได้ (= ยังไม่ตอบ) + ใครแก้ล่าสุด
--     ทำไม score ว่างได้: ทีมแนบรูป/พิมพ์หมายเหตุก่อนให้คะแนนได้ · Round 1 ไม่มีแถวไหน null
alter table public.audit_details alter column score drop not null;
alter table public.audit_details
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
alter table public.audit_details
  add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_details_audit_updated
  on public.audit_details (audit_id, updated_at);

-- ตั้งค่าที่ DB เท่านั้น — client ปลอมชื่อคนแก้/เวลาไม่ได้
create or replace function public.stamp_detail()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_stamp_detail on public.audit_details;
create trigger trg_stamp_detail
  before insert or update on public.audit_details
  for each row execute function public.stamp_detail();

-- K5) recalc_audit_header — ข้อที่ยังไม่ให้คะแนน (score is null) ไม่นับทั้งคะแนนและคะแนนเต็ม
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
  select coalesce(sum(d.score)     filter (where not d.na and d.score is not null), 0),
         coalesce(sum(c.max_score) filter (where not d.na and d.score is not null), 0)
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

-- K6) RLS audit_details — สมาชิกทีมเขียนคำตอบของผลตรวจทีมได้ (หลังล็อก trg_chk_locked บล็อกอยู่แล้ว)
--     งานเดี่ยว: เจ้าของเหมือนเดิม · งานทีม: ต้องอยู่ใน schedules.auditor_ids และไม่ใช่ viewer
--     แยก insert / update / delete — เดิม details_all เป็น "for all" ถ้าคงไว้ สมาชิกทีมจะลบคำตอบของเพื่อนได้
--     (หน้าเว็บไม่เคยลบรายข้อ) → ลบรายข้อได้แค่ admin / เจ้าของผลเดี่ยว เหมือนก่อนมีแบบทีม
create or replace function public.can_write_audit_details(p_audit_id uuid)
returns boolean
language sql stable set search_path = public
as $$
  select exists (
    select 1 from public.audit_headers h
     where h.audit_id = p_audit_id
       and (   public.is_staff()
            or (not h.is_team and h.auditor_id = auth.uid())
            or (h.is_team
                and coalesce(public.auth_role()::text, '') <> 'viewer'
                and exists (select 1 from public.schedules s
                             where s.schedule_id = h.schedule_id
                               and auth.uid() = any(s.auditor_ids)))));
$$;
revoke execute on function public.can_write_audit_details(uuid) from public;
grant  execute on function public.can_write_audit_details(uuid) to anon, authenticated;

drop policy if exists details_all    on public.audit_details;
drop policy if exists details_insert on public.audit_details;
drop policy if exists details_update on public.audit_details;
drop policy if exists details_delete on public.audit_details;

create policy details_insert on public.audit_details
  for insert with check (public.can_write_audit_details(audit_id));
create policy details_update on public.audit_details
  for update using (public.can_write_audit_details(audit_id))
             with check (public.can_write_audit_details(audit_id));
create policy details_delete on public.audit_details
  for delete using (exists (
    select 1 from public.audit_headers h
     where h.audit_id = audit_details.audit_id
       and (public.is_staff() or (not h.is_team and h.auditor_id = (select auth.uid())))));

-- กันส่งผลพร้อมกับที่เพื่อนกำลังแก้คำตอบ: ทุกการเขียนคำตอบล็อกแถว header ก่อน (FOR UPDATE)
-- lock_audit ก็ล็อกแถวเดียวกัน → เช็คความครบกับการล็อกไม่มีใครแทรกได้ · ใช้ FOR UPDATE (ไม่ใช่ FOR SHARE)
-- เพราะ trigger recalc จะ UPDATE แถว header ตามมาในธุรกรรมเดียวกันอยู่แล้ว — FOR SHARE จะ deadlock
-- ระหว่างคนเขียน 2 คนพร้อมกัน
create or replace function public.chk_header_locked()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_locked timestamptz;
begin
  select h.locked_at into v_locked
    from public.audit_headers h
   where h.audit_id = coalesce(new.audit_id, old.audit_id)
     for update;

  if v_locked is not null and coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'ผลการตรวจนี้ถูกล็อกแล้ว แก้ไขไม่ได้ (ติดต่อ Admin)';
  end if;
  return coalesce(new, old);
end $$;

-- คนเปิดผลตรวจทีมคนแรก (auditor_id) ห้ามลบดราฟของทั้งทีม — ลบได้แค่ผลเดี่ยวของตัวเองที่ยังไม่ล็อก / admin
drop policy if exists headers_delete on public.audit_headers;
create policy headers_delete on public.audit_headers
  for delete using (
       coalesce(public.auth_role()::text, '') = 'admin'
    or (not is_team and auditor_id = (select auth.uid()) and locked_at is null));

-- K7) RPC open_team_audit — เปิดผลตรวจของทีม ถ้ายังไม่มีให้สร้าง (กัน 2 คนเปิดพร้อมกันได้ 2 ใบ)
create or replace function public.open_team_audit(p_schedule_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  s        public.schedules%rowtype;
  v_id     uuid;
  v_locked timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(public.auth_role()::text, '') = 'viewer' then
    raise exception 'viewer ตรวจ 5ส ไม่ได้';
  end if;

  select * into s from public.schedules where schedule_id = p_schedule_id;
  if not found then
    raise exception 'ไม่พบงานที่มอบหมายนี้';
  end if;
  if not s.team_mode then
    raise exception 'งานนี้ไม่ใช่งานตรวจแบบทีม';
  end if;
  if not (v_uid = any(s.auditor_ids)) then
    raise exception 'คุณไม่ได้อยู่ในทีมของงานนี้';
  end if;

  select audit_id, locked_at into v_id, v_locked
    from public.audit_headers where schedule_id = p_schedule_id and is_team;

  if v_id is null then
    insert into public.audit_headers (plant_id, area_id, auditor_id, audit_date, schedule_id)
    values (s.plant_id, s.area_id, v_uid, (now() at time zone 'Asia/Bangkok')::date, p_schedule_id)
    on conflict do nothing
    returning audit_id into v_id;

    if v_id is null then                        -- เพื่อนในทีมสร้างไปพร้อมกันพอดี
      select audit_id, locked_at into v_id, v_locked
        from public.audit_headers where schedule_id = p_schedule_id and is_team;
    end if;
  end if;

  return jsonb_build_object('audit_id', v_id, 'locked_at', v_locked);
end $$;

-- K8) lock_audit — สมาชิกทีมล็อกได้ + งานทีมต้องตอบครบทุกเกณฑ์ active
create or replace function public.lock_audit(p_audit_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  h         public.audit_headers%rowtype;
  v_member  boolean := false;
  v_team    uuid[];
  v_missing int;
  v_role    text := coalesce(public.auth_role()::text, '');
begin
  -- FOR UPDATE: รอคนที่กำลังเขียนคำตอบให้เสร็จก่อน และกันการเขียนแทรกระหว่างเช็คความครบ → ล็อก
  select * into h from public.audit_headers where audit_id = p_audit_id for update;
  if not found then
    raise exception 'audit not found';
  end if;

  if h.is_team then
    select coalesce(auth.uid() = any(s.auditor_ids), false), s.auditor_ids
      into v_member, v_team
      from public.schedules s where s.schedule_id = h.schedule_id;
  end if;

  if not (   v_role = 'admin'
          or (not h.is_team and h.auditor_id = auth.uid())
          or (h.is_team and coalesce(v_member, false) and v_role <> 'viewer')) then
    raise exception 'permission denied';
  end if;

  if h.locked_at is not null then
    return jsonb_build_object('success', true, 'already_locked', true, 'locked_at', h.locked_at);
  end if;

  if h.is_team then
    select count(*) into v_missing
      from public.criteria c
     where c.active
       and not exists (select 1 from public.audit_details d
                        where d.audit_id = p_audit_id
                          and d.criteria_id = c.criteria_id
                          and (d.na or d.score is not null));
    if v_missing > 0 then
      raise exception 'ยังตอบไม่ครบ % ข้อ', v_missing;
    end if;
  end if;

  update public.audit_headers
     set locked_at  = now(),
         audit_date = case when h.is_team then (now() at time zone 'Asia/Bangkok')::date
                           else audit_date end,   -- งานทีม: วันที่ตรวจ = วันที่ส่งผล
         team_ids   = case when h.is_team then v_team else team_ids end
   where audit_id = p_audit_id;

  return jsonb_build_object('success', true, 'locked_at', now());
end $$;

-- K9) view schedule_progress — งานทีมเสร็จเมื่อผลของทีมล็อก (ดราฟไม่นับ)
--     คอลัมน์เดิมคงลำดับเดิม + เพิ่มท้าย team_mode / team_audit_id / team_locked
--     ⚠️ ต้องระบุ security_invoker ซ้ำ — create or replace view จะล้าง option เดิมถ้าไม่ระบุ
create or replace view public.schedule_progress
with (security_invoker = true)
as
select s.schedule_id,
       s.plant_id,
       s.area_id,
       s.audit_date,
       s.audit_round,
       s.auditor_ids,
       coalesce(r.required_ids, '{}'::uuid[])                as required_ids,
       coalesce(array_length(r.required_ids, 1), 0)          as required_n,
       coalesce(d.done_ids, '{}'::uuid[])                    as done_ids,
       coalesce(array_length(d.done_ids, 1), 0)              as done_n,
       coalesce(array_length(r.required_ids, 1), 0) > 0
         and coalesce(array_length(d.done_ids, 1), 0)
             = coalesce(array_length(r.required_ids, 1), 0)  as is_completed,
       s.team_mode,
       t.audit_id                                            as team_audit_id,
       (t.locked_at is not null)                             as team_locked
  from public.schedules s
  left join lateral (
         select array_agg(p.id order by p.name) as required_ids
           from public.profiles p
          where p.id = any(s.auditor_ids) and p.status = 'active'::record_status) r on true
  left join lateral (
         select h.audit_id, h.locked_at
           from public.audit_headers h
          where h.schedule_id = s.schedule_id and h.is_team
          limit 1) t on true
  left join lateral (
         select array_agg(p.id order by p.name) as done_ids
           from public.profiles p
          where p.id = any(s.auditor_ids) and p.status = 'active'::record_status
            and case when s.team_mode then t.locked_at is not null
                     else exists (select 1 from public.audit_headers h
                                   where h.schedule_id = s.schedule_id and h.auditor_id = p.id
                                     and (h.locked_at is not null or h.status <> 'pending'::audit_status))
                end) d on true;

-- K10) รูป — เพิ่ม/ลบแบบ atomic ฝั่ง DB (2 คนแนบรูปข้อเดียวกันพร้อมกัน รูปไม่หาย)
--      security invoker → RLS details_all + trg_chk_locked ยังคุมสิทธิ์เหมือนเขียนตรง
create or replace function public.add_detail_photo(p_audit_id uuid, p_criteria_id text, p_url text)
returns text[]
language plpgsql set search_path = public
as $$
declare v text[];
begin
  if p_url is null or p_url !~ '^https://' then
    raise exception 'invalid photo url';
  end if;
  insert into public.audit_details (audit_id, criteria_id, score, photo_urls)
  values (p_audit_id, p_criteria_id, null, array[p_url])
  on conflict (audit_id, criteria_id)
  do update set photo_urls = array_append(coalesce(audit_details.photo_urls, '{}'::text[]), p_url)
  returning photo_urls into v;
  return v;
end $$;

create or replace function public.remove_detail_photo(p_audit_id uuid, p_criteria_id text, p_url text)
returns text[]
language plpgsql set search_path = public
as $$
declare v text[];
begin
  update public.audit_details
     set photo_urls = array_remove(photo_urls, p_url)
   where audit_id = p_audit_id and criteria_id = p_criteria_id
  returning photo_urls into v;
  return coalesce(v, '{}'::text[]);
end $$;

-- K11) RPC team_audit_changes — กึ่งเรียลไทม์: 1 request ต่อรอบ คืนเฉพาะข้อที่เปลี่ยนหลัง p_since + สถานะ header
create or replace function public.team_audit_changes(p_audit_id uuid, p_since timestamptz default null)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'now', now(),
    -- cursor = เวลาสำหรับดึงรอบถัดไป: ถอยหลัง 5 วิ กันแถวที่ commit ช้ากว่าเวลาเริ่มธุรกรรมหลุด
    -- (client ส่งค่านี้กลับมาตรงๆ ไม่ต้อง parse — Safari บางรุ่น parse ทศนิยม 6 หลักไม่ได้)
    'cursor', now() - interval '5 seconds',
    'header', (select jsonb_build_object(
                        'locked_at', h.locked_at, 'total_score', h.total_score,
                        'max_score', h.max_score, 'percent', h.percent, 'status', h.status)
                 from public.audit_headers h where h.audit_id = p_audit_id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                        'criteria_id', d.criteria_id, 'score', d.score, 'na', d.na,
                        'remark', d.remark, 'photo_urls', d.photo_urls,
                        'updated_by', d.updated_by, 'updated_at', d.updated_at))
                        from public.audit_details d
                       where d.audit_id = p_audit_id
                         and (p_since is null or d.updated_at > p_since)), '[]'::jsonb));
$$;

-- K12) สิทธิ์ execute — ปิด public/anon ทุกตัวที่เพิ่ม/แก้ในส่วนนี้ (แบบเดียวกับ G6)
revoke execute on function public.open_team_audit(uuid)                    from public, anon;
revoke execute on function public.lock_audit(uuid)                         from public, anon;
revoke execute on function public.add_detail_photo(uuid, text, text)       from public, anon;
revoke execute on function public.remove_detail_photo(uuid, text, text)    from public, anon;
revoke execute on function public.team_audit_changes(uuid, timestamptz)    from public, anon;
revoke execute on function public.stamp_detail()                           from public, anon;
grant  execute on function public.open_team_audit(uuid)                    to authenticated;
grant  execute on function public.lock_audit(uuid)                         to authenticated;
grant  execute on function public.add_detail_photo(uuid, text, text)       to authenticated;
grant  execute on function public.remove_detail_photo(uuid, text, text)    to authenticated;
grant  execute on function public.team_audit_changes(uuid, timestamptz)    to authenticated;

-- ตรวจผลหลังรัน (Round 1 ต้องเหมือนเดิมทุกตัวเลข):
-- select
--   (select count(*) from public.schedules where team_mode = false)                  as sched_single,   -- 16
--   (select count(*) from public.schedules where team_mode)                          as sched_team,     -- 0
--   (select count(*) from public.audit_headers where is_team)                        as headers_team,   -- 0
--   (select count(*) || ' locked=' || count(locked_at) from public.audit_headers)    as headers,        -- 64 locked=64
--   (select sum(total_score) || '/' || sum(max_score) from public.audit_headers)     as score_sum,      -- 6410/6838
--   (select count(*) from public.schedule_progress where is_completed)               as sched_done,     -- 16
--   (select array_to_string(reloptions, ',') from pg_class
--     where oid = 'public.schedule_progress'::regclass)                             as view_opts;      -- security_invoker=true
