-- =====================================================================
-- Migration: ให้ auditor ที่ถูกมอบหมายอัปเดตสถานะงานของตัวเองได้
-- Date: 2026-08-01
-- เหตุผล: เมื่อ auditor ตรวจงานที่ถูกมอบหมายเสร็จ ระบบต้อง mark schedule
--        เป็น 'completed' แต่ policy เดิม (schedules_staff) ให้เฉพาะ admin/manager
--        แก้ไข → เพิ่ม policy update สำหรับ auditor ที่อยู่ใน auditor_ids ของงานนั้น
-- วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ปลอดภัย)
-- =====================================================================

drop policy if exists schedules_auditor_update on public.schedules;
create policy schedules_auditor_update on public.schedules
  for update
  using      (auth.uid() = any(auditor_ids))
  with check (auth.uid() = any(auditor_ids));
