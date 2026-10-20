-- =====================================================================
-- ทดสอบสิทธิ์ของ "ตรวจแบบทีม" ในมุมของ auditor จริง — ไม่ทิ้งข้อมูลใดๆ ไว้ใน DB
-- =====================================================================
-- ทำไมต้องมี: ทดสอบผ่านหน้าเว็บด้วยบัญชี admin ไม่พิสูจน์ว่า auditor ทำได้ (admin ข้ามสิทธิ์หลายจุด)
-- วิธีทำงาน: สร้างงานทดสอบชั่วคราว → สวมบทบาท auditor ทีละคน (set role authenticated + jwt sub)
--           → ลองทุกกรณี → เก็บผลไว้ในตัวแปร → โยน exception ให้ทุกอย่างที่เขียนลง DB ถูกยกเลิก
--           → แสดงผลเป็นตาราง (ทุกแถวคอลัมน์ ok ต้องเป็น true)
-- วิธีใช้: เปิดแท็บ query ใหม่ที่ว่างเปล่า → วางทั้งไฟล์ → Run · รันซ้ำได้
-- =====================================================================
create temp table if not exists _team_test (n int, check_name text, ok boolean, detail text);
truncate _team_test;

do $$
declare
  a1 uuid; a2 uuid; outsider uuid; viewer_id uuid;
  v_sid  uuid := gen_random_uuid();
  v_aid  uuid; v_aid2 uuid;
  v_area text;  v_plant text;
  r      jsonb;
  n      int;
  res    jsonb := '[]'::jsonb;
  procedure_ok boolean;
begin
  select id into a1 from public.profiles where role = 'auditor' and status = 'active' order by id limit 1;
  select id into a2 from public.profiles where role = 'auditor' and status = 'active' and id <> a1 order by id limit 1;
  select id into outsider from public.profiles
   where role = 'auditor' and status = 'active' and id not in (a1, a2) order by id limit 1;
  select id into viewer_id from public.profiles where role = 'viewer' and status = 'active' limit 1;
  select area_id, plant_id into v_area, v_plant from public.areas where status = 'active' order by area_id limit 1;

  begin   -- ===== ทุกอย่างในบล็อกนี้ถูกยกเลิกตอนจบ =====
    insert into public.schedules (schedule_id, plant_id, area_id, auditor_ids, audit_date, audit_round)
    values (v_sid, v_plant, v_area, array[a1, a2], current_date, '__TEST_ROLLBACK__');

    -- 1) สมาชิกคนแรกเปิดผลตรวจทีม
    perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.open_team_audit(v_sid);
    v_aid := (r ->> 'audit_id')::uuid;
    res := res || jsonb_build_object('n', 1, 'c', 'auditor สมาชิกเปิดผลตรวจทีมได้', 'ok', v_aid is not null, 'd', r::text);

    -- 2) สมาชิกคนที่สองเปิด → ได้ใบเดียวกัน
    perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
    r := public.open_team_audit(v_sid);
    v_aid2 := (r ->> 'audit_id')::uuid;
    res := res || jsonb_build_object('n', 2, 'c', 'สมาชิกคนที่ 2 ได้ผลตรวจใบเดียวกัน', 'ok', v_aid2 = v_aid, 'd', '');

    -- 3) สมาชิกบันทึกคำตอบได้ + updated_by เป็นคนบันทึก
    insert into public.audit_details (audit_id, criteria_id, score, na)
    select v_aid, criteria_id, 2, false from public.criteria where active order by criteria_id limit 1;
    select count(*) into n from public.audit_details where audit_id = v_aid and updated_by = a2;
    res := res || jsonb_build_object('n', 3, 'c', 'สมาชิกบันทึกคำตอบได้ (updated_by ถูกคน)', 'ok', n = 1, 'd', n::text);

    -- 4) คนนอกทีมบันทึกคำตอบไม่ได้
    perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
    begin
      insert into public.audit_details (audit_id, criteria_id, score)
      select v_aid, criteria_id, 0 from public.criteria where active order by criteria_id offset 1 limit 1;
      res := res || jsonb_build_object('n', 4, 'c', 'คนนอกทีมบันทึกคำตอบไม่ได้', 'ok', false, 'd', 'insert ผ่าน (ผิด)');
    exception when others then
      res := res || jsonb_build_object('n', 4, 'c', 'คนนอกทีมบันทึกคำตอบไม่ได้', 'ok', true, 'd', sqlerrm);
    end;

    -- 5) คนนอกทีมเปิดผลตรวจทีมไม่ได้
    begin
      perform public.open_team_audit(v_sid);
      res := res || jsonb_build_object('n', 5, 'c', 'คนนอกทีมเปิดผลตรวจทีมไม่ได้', 'ok', false, 'd', 'เปิดได้ (ผิด)');
    exception when others then
      res := res || jsonb_build_object('n', 5, 'c', 'คนนอกทีมเปิดผลตรวจทีมไม่ได้', 'ok', true, 'd', sqlerrm);
    end;

    -- 6) viewer เปิดไม่ได้
    if viewer_id is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', viewer_id, 'role', 'authenticated')::text, true);
      begin
        perform public.open_team_audit(v_sid);
        res := res || jsonb_build_object('n', 6, 'c', 'viewer เปิดผลตรวจไม่ได้', 'ok', false, 'd', 'เปิดได้ (ผิด)');
      exception when others then
        res := res || jsonb_build_object('n', 6, 'c', 'viewer เปิดผลตรวจไม่ได้', 'ok', true, 'd', sqlerrm);
      end;
    end if;

    -- 7) สมาชิกแนบรูปได้ (RPC atomic)
    perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
    perform public.add_detail_photo(v_aid,
      (select criteria_id from public.criteria where active order by criteria_id offset 1 limit 1),
      'https://example.com/__test__.jpg');
    select count(*) into n from public.audit_details where audit_id = v_aid and photo_urls @> array['https://example.com/__test__.jpg'];
    res := res || jsonb_build_object('n', 7, 'c', 'สมาชิกแนบรูปได้', 'ok', n = 1, 'd', '');

    -- 8) ส่งผลตอนยังตอบไม่ครบ → ถูกปฏิเสธ
    begin
      perform public.lock_audit(v_aid);
      res := res || jsonb_build_object('n', 8, 'c', 'ส่งผลไม่ได้ถ้ายังตอบไม่ครบ', 'ok', false, 'd', 'ล็อกได้ (ผิด)');
    exception when others then
      res := res || jsonb_build_object('n', 8, 'c', 'ส่งผลไม่ได้ถ้ายังตอบไม่ครบ', 'ok', sqlerrm like 'ยังตอบไม่ครบ%', 'd', sqlerrm);
    end;

    -- 9) คนเปิดผลตรวจคนแรกลบดราฟของทีมไม่ได้
    with d as (delete from public.audit_headers where audit_id = v_aid returning 1) select count(*) into n from d;
    res := res || jsonb_build_object('n', 9, 'c', 'สมาชิกลบดราฟของทีมไม่ได้', 'ok', n = 0, 'd', n::text);

    -- 9b) สมาชิกลบคำตอบของเพื่อนในทีมไม่ได้ (แก้ได้ แต่ลบแถวไม่ได้)
    with d as (delete from public.audit_details where audit_id = v_aid returning 1) select count(*) into n from d;
    res := res || jsonb_build_object('n', 9, 'c', 'สมาชิกลบคำตอบของเพื่อนไม่ได้', 'ok', n = 0, 'd', n::text);

    -- 10) ตรวจนอกงานมอบหมาย (ไม่มี schedule_id) ไม่ได้
    begin
      insert into public.audit_headers (plant_id, area_id, auditor_id, audit_date)
      values (v_plant, v_area, a1, current_date);
      res := res || jsonb_build_object('n', 10, 'c', 'ตรวจนอกงานมอบหมายไม่ได้', 'ok', false, 'd', 'insert ผ่าน (ผิด)');
    exception when others then
      res := res || jsonb_build_object('n', 10, 'c', 'ตรวจนอกงานมอบหมายไม่ได้', 'ok', true, 'd', sqlerrm);
    end;

    -- 11) ตอบครบ (คะแนนหรือ N/A) แล้วสมาชิกคนที่ 2 ส่งผลได้ + team_ids ถูกบันทึก
    perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
    insert into public.audit_details (audit_id, criteria_id, score, na)
    select v_aid, criteria_id, null, true from public.criteria where active
    on conflict (audit_id, criteria_id) do update set na = true where audit_details.score is null;
    r := public.lock_audit(v_aid);
    select count(*) into n from public.audit_headers
     where audit_id = v_aid and locked_at is not null and team_ids = array[a1, a2];
    res := res || jsonb_build_object('n', 11, 'c', 'สมาชิกส่งผลได้เมื่อตอบครบ + บันทึกรายชื่อทีม', 'ok', n = 1, 'd', r::text);

    -- 12) หลังส่งผลแล้ว แก้คำตอบไม่ได้
    perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
    begin
      update public.audit_details set score = 0 where audit_id = v_aid and score = 2;
      res := res || jsonb_build_object('n', 12, 'c', 'หลังส่งผลแก้คำตอบไม่ได้', 'ok', false, 'd', 'แก้ได้ (ผิด)');
    exception when others then
      res := res || jsonb_build_object('n', 12, 'c', 'หลังส่งผลแก้คำตอบไม่ได้', 'ok', true, 'd', sqlerrm);
    end;

    -- 13) งานถูกนับว่าเสร็จ
    execute 'reset role';
    select count(*) into n from public.schedule_progress where schedule_id = v_sid and is_completed and team_locked;
    res := res || jsonb_build_object('n', 13, 'c', 'ความคืบหน้างาน = เสร็จ', 'ok', n = 1, 'd', '');

    raise exception '__ROLLBACK_TEST__';     -- ยกเลิกทุกอย่างที่เขียนในบล็อกนี้
  exception when others then
    if sqlerrm <> '__ROLLBACK_TEST__' then
      res := res || jsonb_build_object('n', 99, 'c', 'สคริปต์หยุดกลางทาง', 'ok', false, 'd', sqlerrm);
    end if;
  end;

  execute 'reset role';
  insert into _team_test (n, check_name, ok, detail)
  select (e ->> 'n')::int, e ->> 'c', (e ->> 'ok')::boolean, left(e ->> 'd', 120)
    from jsonb_array_elements(res) e;
  -- ยืนยันว่าไม่เหลือข้อมูลทดสอบ
  insert into _team_test values (100, 'ไม่เหลือข้อมูลทดสอบใน DB',
    not exists (select 1 from public.schedules where audit_round = '__TEST_ROLLBACK__'), '');
end $$;

select n, check_name, ok, detail from _team_test order by n;
