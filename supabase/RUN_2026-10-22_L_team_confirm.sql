-- RUN 2026-10-22 — snapshot ของ patches.sql ส่วน L (ทุกคนในทีมต้องกดยืนยัน) สำหรับวางใน SQL Editor
-- วิธีใช้: เปิดแท็บ query ใหม่ที่ว่างเปล่า → วางทั้งไฟล์นี้ → Run · รันซ้ำได้ (idempotent)
-- ทดสอบแล้วบน Postgres ในเครื่อง (schema + patches + K): Round 1 ไม่เปลี่ยน + กรณีทดสอบการยืนยัน 17 กรณีผ่านครบ
-- ⚠️ รันก่อน deploy หน้าเว็บ v59 (หน้าเว็บใหม่เรียก confirm_team_audit)
-- =====================================================================
-- ส่วน L: ตรวจแบบทีม — ทุกคนในทีมต้องกดยืนยันก่อนผลถูกส่ง/ล็อก   (22 ต.ค. 2026)
-- =====================================================================
-- ผู้ใช้ตัดสินใจ 2026-10-22: ทีม 2–4 คน (เดิม 2–3 · จำกัดที่หน้าเว็บเท่านั้น DB ไม่จำกัดจำนวน)
--   และ "ทุกคนในทีมต้องกดยืนยัน" แทน "ใครกดส่งก็ได้ 1 คน" (ส่วน K)
--   • กดยืนยัน = RPC confirm_team_audit (ต้องตอบครบ) → คนสุดท้ายที่ยืนยันครบ ระบบล็อกให้ทันที
--   • มีคนแก้คำตอบ/รูปหลังมีคนยืนยันแล้ว → ล้างการยืนยันทั้งหมด ทุกคนต้องยืนยันใหม่ (ทุกคนรับรองผลชุดเดียวกัน)
--   • คนที่ต้องยืนยัน = สมาชิกงานใน schedules.auditor_ids ที่ยัง active และไม่ใช่ viewer (ดูจากงาน ณ ตอนนั้น
--     admin เพิ่ม/ตัดชื่อระหว่างตรวจได้ — คนที่ถูกตัดไม่ต้องยืนยัน)
--   • lock_audit งานทีม: เหลือแค่ admin (ทางออกเมื่อกรรมการลาป่วย/ติดต่อไม่ได้ = "ส่งผลแทนทีม" ใน Schedule Board)
--     ยังต้องตอบครบทุกข้อเหมือนเดิม · งานเดี่ยว (Round 1) ไม่เปลี่ยน
--
-- ความเข้ากันได้: รันได้ทันที — ตอนนี้ยังไม่มีงานทีม/ดราฟใน DB · หน้าเว็บเก่า (v58 ลงไป) กดส่งผลทีมจะได้ข้อความ
--   "ต้องให้กรรมการทุกคนกดยืนยัน" จนกว่าจะ deploy หน้าเว็บใหม่ → รัน SQL นี้แล้ว push หน้าเว็บต่อเลย
-- idempotent: รันซ้ำได้ทั้งส่วน
-- ⚠️ วางเฉพาะส่วนนี้ในแท็บ query ใหม่ที่ว่างเปล่า — อย่ารันทั้งไฟล์ / อย่าใช้แท็บเก่า
-- =====================================================================

-- L1) ตารางการยืนยัน — อ่านได้ทุกคนที่ล็อกอิน (เหมือน audit_*) · เขียนผ่าน RPC/trigger (security definer) เท่านั้น
create table if not exists public.audit_confirmations (
  audit_id     uuid not null references public.audit_headers(audit_id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (audit_id, user_id)
);
alter table public.audit_confirmations enable row level security;
drop policy if exists confirmations_select on public.audit_confirmations;
create policy confirmations_select on public.audit_confirmations
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.audit_confirmations from public, anon, authenticated;
revoke all on public.audit_confirmations from anon;
grant select on public.audit_confirmations to authenticated;

-- L2) คนที่ต้องยืนยันของงานหนึ่ง — สมาชิกงาน active ที่ไม่ใช่ viewer (viewer ตรวจ/ยืนยันไม่ได้ → ไม่ให้ค้างรอ)
--     security definer: team_audit_changes เป็น invoker และ RLS ของ schedules ให้อ่านเฉพาะงานของตัวเอง
create or replace function public.team_required_ids(p_schedule_id uuid)
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
    from public.schedules s
    join public.profiles p on p.id = any(s.auditor_ids)
   where s.schedule_id = p_schedule_id
     and p.status = 'active'::record_status
     and p.role::text <> 'viewer';
$$;

-- L3) RPC confirm_team_audit — ยืนยันผลของทีม · ครบทุกคน = ล็อก (คืนสถานะให้หน้าเว็บอัปเดตแถบทีม)
create or replace function public.confirm_team_audit(p_audit_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  h         public.audit_headers%rowtype;
  v_uid     uuid := auth.uid();
  v_role    text := coalesce(public.auth_role()::text, '');
  v_req     uuid[];
  v_conf    uuid[];
  v_team    uuid[];
  v_missing int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- FOR UPDATE: คิวเดียวกับการเขียนคำตอบ (chk_header_locked) — ไม่มีใครแก้แทรกระหว่างเช็คครบ → ยืนยัน → ล็อก
  select * into h from public.audit_headers where audit_id = p_audit_id for update;
  if not found then
    raise exception 'audit not found';
  end if;
  if not h.is_team then
    raise exception 'งานนี้ไม่ใช่งานตรวจแบบทีม';
  end if;
  if h.locked_at is not null then
    return jsonb_build_object('success', true, 'locked', true, 'locked_at', h.locked_at);
  end if;

  v_req := public.team_required_ids(h.schedule_id);
  if v_role = 'viewer' or not (v_uid = any(v_req)) then
    raise exception 'คุณไม่ได้อยู่ในทีมของงานนี้';
  end if;

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

  insert into public.audit_confirmations (audit_id, user_id)
  values (p_audit_id, v_uid)
  on conflict (audit_id, user_id) do nothing;

  select coalesce(array_agg(user_id), '{}'::uuid[]) into v_conf
    from public.audit_confirmations where audit_id = p_audit_id;

  if v_req <@ v_conf then                       -- ยืนยันครบทุกคน → ล็อก (เหมือน lock_audit ส่วน K8)
    select auditor_ids into v_team from public.schedules where schedule_id = h.schedule_id;
    update public.audit_headers
       set locked_at  = now(),
           audit_date = (now() at time zone 'Asia/Bangkok')::date,
           team_ids   = v_team
     where audit_id = p_audit_id;
    return jsonb_build_object('success', true, 'locked', true, 'locked_at', now());
  end if;

  return jsonb_build_object('success', true, 'locked', false,
                            'confirmed', to_jsonb(v_conf), 'required', to_jsonb(v_req));
end $$;

-- L4) แก้คำตอบ/รูปหลังมีคนยืนยัน → ล้างการยืนยันของผลนั้นทั้งหมด (เฉพาะผลที่ยังไม่ล็อก)
--     UPDATE ที่ค่าไม่เปลี่ยนจริง (กดคะแนนเดิมซ้ำ) ไม่ล้าง
create or replace function public.reset_team_confirmations()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.score      is not distinct from old.score
     and new.na         is not distinct from old.na
     and new.remark     is not distinct from old.remark
     and new.photo_urls is not distinct from old.photo_urls then
    return null;
  end if;
  delete from public.audit_confirmations c
   using public.audit_headers h
   where c.audit_id = coalesce(new.audit_id, old.audit_id)
     and h.audit_id = c.audit_id
     and h.locked_at is null;
  return null;
end $$;

drop trigger if exists trg_reset_confirm on public.audit_details;
create trigger trg_reset_confirm
  after insert or update or delete on public.audit_details
  for each row execute function public.reset_team_confirmations();

-- L5) lock_audit — งานทีมล็อกตรงได้แค่ admin ("ส่งผลแทนทีม") · สมาชิกต้องผ่าน confirm_team_audit
--     งานเดี่ยวเหมือนเดิม (เจ้าของ/admin)
create or replace function public.lock_audit(p_audit_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  h         public.audit_headers%rowtype;
  v_team    uuid[];
  v_missing int;
  v_role    text := coalesce(public.auth_role()::text, '');
begin
  select * into h from public.audit_headers where audit_id = p_audit_id for update;
  if not found then
    raise exception 'audit not found';
  end if;

  if h.is_team and v_role <> 'admin' then
    raise exception 'งานตรวจแบบทีมต้องให้กรรมการทุกคนกดยืนยัน';
  end if;
  if not (v_role = 'admin' or (not h.is_team and h.auditor_id = auth.uid())) then
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
    select auditor_ids into v_team from public.schedules where schedule_id = h.schedule_id;
  end if;

  update public.audit_headers
     set locked_at  = now(),
         audit_date = case when h.is_team then (now() at time zone 'Asia/Bangkok')::date
                           else audit_date end,
         team_ids   = case when h.is_team then v_team else team_ids end
   where audit_id = p_audit_id;

  return jsonb_build_object('success', true, 'locked_at', now());
end $$;

-- L6) team_audit_changes — เพิ่มสถานะการยืนยัน (ใครยืนยันแล้ว + ใครต้องยืนยัน) ไปกับรอบดึงเดิม ไม่เพิ่ม request
create or replace function public.team_audit_changes(p_audit_id uuid, p_since timestamptz default null)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'now', now(),
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
                         and (p_since is null or d.updated_at > p_since)), '[]'::jsonb),
    'confirmed', coalesce((select jsonb_agg(c.user_id order by c.confirmed_at)
                             from public.audit_confirmations c
                            where c.audit_id = p_audit_id), '[]'::jsonb),
    'required', (select to_jsonb(public.team_required_ids(h.schedule_id))
                   from public.audit_headers h where h.audit_id = p_audit_id));
$$;

-- L7) สิทธิ์ execute (แบบเดียวกับ K12)
revoke execute on function public.team_required_ids(uuid)                  from public, anon;
revoke execute on function public.confirm_team_audit(uuid)                 from public, anon;
revoke execute on function public.reset_team_confirmations()               from public, anon, authenticated;
revoke execute on function public.lock_audit(uuid)                         from public, anon;
revoke execute on function public.team_audit_changes(uuid, timestamptz)    from public, anon;
grant  execute on function public.team_required_ids(uuid)                  to authenticated;
grant  execute on function public.confirm_team_audit(uuid)                 to authenticated;
grant  execute on function public.lock_audit(uuid)                         to authenticated;
grant  execute on function public.team_audit_changes(uuid, timestamptz)    to authenticated;

-- ตรวจผลหลังรัน (Round 1 ต้องเหมือนเดิมทุกตัวเลข):
-- select
--   (select count(*) from public.audit_confirmations)                                as confirmations,  -- 0
--   (select count(*) || ' locked=' || count(locked_at) from public.audit_headers)    as headers,        -- 64 locked=64
--   (select sum(total_score) || '/' || sum(max_score) from public.audit_headers)     as score_sum,      -- 6410/6838
--   (select count(*) from public.schedule_progress where is_completed)               as sched_done,     -- 16
--   (select count(*) from pg_trigger where tgname = 'trg_reset_confirm')             as reset_trigger,  -- 1
--   (select left(md5(prosrc), 8) from pg_proc where proname = 'confirm_team_audit')  as confirm_fn;     -- มีค่า
