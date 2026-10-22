-- RUN 2026-10-22 — snapshot ของ patches.sql ส่วน M (มาตรฐาน 5ส ฉบับ Draft 22.10.2026) สำหรับวางใน SQL Editor
-- วิธีใช้: เปิดแท็บ query ใหม่ที่ว่างเปล่า → วางทั้งไฟล์นี้ → Run · รันซ้ำได้ (idempotent)
-- ทดสอบแล้วบน Postgres ในเครื่อง (schema + patches + K + L): รัน 2 รอบ → active 169 / 38 หมวด / เต็ม 338 · ผล Round 1 ไม่เปลี่ยน · ทีมต้องตอบครบ 169 ข้อจึงยืนยันได้
-- =====================================================================
-- ส่วน M: มาตรฐาน 5ส ฉบับใหม่ (Draft 22.10.2026 Reviewed_2) — 132 → 169 ข้อ / 34 → 38 หมวด   (22 ต.ค. 2026)
-- =====================================================================
-- เทียบกับมาตรฐานเดิม R.00 16.06.2026 (= เกณฑ์ใน DB ทั้ง 132 ข้อ):
--   • ข้อใหม่ 43 ข้อ (หมวดใหม่ 35 พื้นที่สูบบุหรี่ · 36 พื้นที่ระบบผลิตน้ำ · 37 Work Shop ช่าง · 38 ห้อง Boiler = 29 ข้อ
--     + หมวดเดิม 14 ข้อ: 10 Pest Control 3 · 11 ขยะ 3 · 27 ห้องแต่งตัว 4 · 29.7 · 31.3 · 33.5–33.6)
--   • ปิดใช้งาน 6 ข้อ (6.3 · 10.1 · 10.2 · 11.4 · 34.6 · 34.7) — ห้าม DELETE เพราะผล Round 1 อ้างอยู่
--   • เปลี่ยนเลขข้อ 15 ข้อให้ตรงเอกสารใหม่ (ข้อความ/คะแนนเดิม) · แก้ข้อความข้อเดิม 6 ข้อ
-- ผู้ใช้ตัดสินใจ (2026-10-22): ข้อที่ความหมายเปลี่ยน (13.3, 25.2, 29.6) แก้ในข้อเดิม · ใช้เลขข้อตามเอกสารใหม่
--   ผลคือหน้าประวัติ/รายงานของ Round 1 แสดงข้อความและเลขข้อใหม่ แต่คะแนน Round 1 ไม่เปลี่ยน
--   (max_score ทุกข้อยังเป็น 2 · ไม่มีข้อไหนเปลี่ยน criteria_id)
-- รหัสข้อใหม่: C-<หมวด 2 หลัก>-<ลำดับถัดจากรหัสเดิมของหมวด> — เลขข้อที่แสดงอยู่ใน sub_category
--   (หน้าเว็บ v61+ เรียงตามเลขข้อ ไม่ใช่ตามรหัส)
-- ความเข้ากันได้: รันได้ทันที — ตอนนี้ไม่มีผลตรวจทีมค้าง (ดราฟ) · หน้าเว็บทุกรุ่นอ่านเกณฑ์ active จาก DB
-- idempotent: รันซ้ำได้ทั้งส่วน
-- ⚠️ วางเฉพาะส่วนนี้ในแท็บ query ใหม่ที่ว่างเปล่า — อย่ารันทั้งไฟล์ / อย่าใช้แท็บเก่า
-- =====================================================================

-- M1) ข้อใหม่ 43 ข้อ (รหัสใหม่ทั้งหมด — ไม่ใช้รหัสของข้อที่ปิดไปแล้วซ้ำ)
insert into public.criteria (criteria_id, category, sub_category, question, description, area_types, max_score, active,
                             category_en, question_en, description_en) values
  ('C-10-3', 'การควบคุมสัตว์พาหะ (Pest Control)', '10.1', 'มี Pest Control Map และหมายเลขติดบนอุปกรณ์', 'ตำแหน่งอุปกรณ์ควบคุมสัตว์พาหะแสดงใน Pest Control Map และมีหมายเลขติดบนอุปกรณ์ทุกจุด', '{}', 2, true, 'Pest Control', 'Pest Control Map posted; devices numbered', 'Pest control device locations shown on a Pest Control Map, each device numbered'),
  ('C-10-4', 'การควบคุมสัตว์พาหะ (Pest Control)', '10.2', 'อุปกรณ์ควบคุมสัตว์พาหะสมบูรณ์ ไม่ถูกย้าย ไม่มีสิ่งกีดขวาง', 'กล่องดักหนู กับดัก แผ่นกาวดักแมลง เครื่องดักแมลง สภาพสมบูรณ์ไม่ชำรุด ไม่ถูกเคลื่อนย้าย ไม่มีสิ่งของกีดขวางการตรวจ', '{}', 2, true, 'Pest Control', 'Pest control devices intact, not moved, unobstructed', 'Rodent boxes, traps, glue boards and insect light traps intact, not moved, and not blocked for inspection'),
  ('C-10-5', 'การควบคุมสัตว์พาหะ (Pest Control)', '10.3', 'บันทึกการตรวจของผู้ให้บริการ Pest Control เป็นปัจจุบัน', 'บันทึกการตรวจและรายงานผลของผู้ให้บริการ Pest Control (หน้างาน) เป็นปัจจุบัน', '{}', 2, true, 'Pest Control', 'Pest control provider''s inspection records up to date', 'On-site inspection records and reports from the pest control provider are current'),
  ('C-11-5', 'พื้นที่พักขยะและถังขยะ', '11.2', 'แบ่งโซนพักขยะตามประเภท มีป้ายชี้บ่งแต่ละโซน', 'พื้นที่พักขยะแบ่งโซนตามประเภทขยะอย่างชัดเจน และมีป้ายชี้บ่งแต่ละโซน', '{}', 2, true, 'Waste Holding Area & Bins', 'Waste area zoned by type, each zone labeled', 'Waste holding area clearly divided into zones by waste type, each zone labeled'),
  ('C-11-6', 'พื้นที่พักขยะและถังขยะ', '11.3', 'พื้นที่พักขยะสะอาด ไม่มีน้ำชะขยะ ไม่มีน้ำขัง', 'ไม่มีน้ำชะขยะไหลออกนอกพื้นที่ ไม่มีน้ำขังสะสม ไม่มีสิ่งสกปรกสะสมบนพื้น และล้างทำความสะอาดเป็นประจำ', '{}', 2, true, 'Waste Holding Area & Bins', 'Waste area clean, no leachate or standing water', 'No leachate flowing out, no standing water or dirt on the floor, washed regularly'),
  ('C-11-7', 'พื้นที่พักขยะและถังขยะ', '11.4', 'ถังขยะสะอาด ไม่มีคราบ ไม่มีกลิ่น ไม่ชำรุด', 'ถังขยะสะอาด ไม่มีคราบสกปรก ไม่มีกลิ่น และไม่ชำรุด', '{}', 2, true, 'Waste Holding Area & Bins', 'Bins clean, no stains or odor, not damaged', 'Bins clean, free of stains and odor, and not damaged'),
  ('C-27-6', 'ห้องแต่งตัว/เปลี่ยนชุด', '27.1', 'รองเท้าภายนอกกับรองเท้าในพื้นที่ผลิตเก็บแยกกัน', 'รองเท้าที่ใช้ภายนอกและรองเท้าที่ใช้ในพื้นที่ผลิตจัดเก็บแยกกัน ไม่ปะปนกัน', '{production}', 2, true, 'Changing Room', 'Outdoor and production-area shoes stored separately', 'Shoes worn outside and shoes used in the production area are stored apart, never mixed'),
  ('C-27-7', 'ห้องแต่งตัว/เปลี่ยนชุด', '27.5', 'บันทึกการทำความสะอาดห้องแต่งตัวเป็นปัจจุบัน', 'มีบันทึกการทำความสะอาดห้องแต่งตัวเป็นปัจจุบัน', '{production}', 2, true, 'Changing Room', 'Changing room cleaning record up to date', 'A current cleaning record for the changing room is kept'),
  ('C-27-8', 'ห้องแต่งตัว/เปลี่ยนชุด', '27.6', 'มีจุดฆ่าเชื้อมือก่อนเข้าพื้นที่ผลิต พร้อมใช้', 'มีจุดฆ่าเชื้อมือ เช่น แอลกอฮอล์ ก่อนเข้าพื้นที่ผลิต อุปกรณ์พร้อมใช้ ไม่หมด ไม่ชำรุด', '{production}', 2, true, 'Changing Room', 'Hand sanitizing point before production area, ready to use', 'Hand sanitizing point (e.g. alcohol) before entering production, not empty or damaged'),
  ('C-27-9', 'ห้องแต่งตัว/เปลี่ยนชุด', '27.8', 'Sticky Roller / Air Shower (ถ้ามี) พร้อมใช้งาน', 'อุปกรณ์เสริม เช่น ลูกกลิ้งเก็บฝุ่น/เส้นผม (Sticky Roller) หรือ Air Shower (ถ้ามี) อยู่ในสภาพพร้อมใช้งาน', '{production}', 2, true, 'Changing Room', 'Sticky roller / air shower (if any) ready to use', 'Auxiliary equipment such as lint/hair sticky rollers or an air shower (if present) is in working order'),
  ('C-29-7', 'ห้องผลิต', '29.7', 'ของเสีย (Reject) แยกใส่ภาชนะที่มีป้ายบ่งชี้', 'ผลิตภัณฑ์ที่ไม่ได้คุณภาพหรือของเสียจากการผลิตแยกใส่ภาชนะที่มีป้ายบ่งชี้ชัดเจน เช่น กล่อง NG ไม่วางปะปนกับของดี', '{production}', 2, true, 'Production Room', 'Rejects kept in labeled containers', 'Non-conforming products and production waste kept in clearly labeled containers (e.g. NG box), never mixed with good product'),
  ('C-31-6', 'การจัดวางผลิตภัณฑ์/วัตถุดิบ/พาเลท', '31.3', 'ของ Rejected / รับคืน / เรียกคืน / HOLD แยกเก็บ มีป้ายบ่งชี้', 'วัสดุที่มีสถานะไม่ผ่าน (Rejected) สินค้ารับคืน สินค้าเรียกคืน หรือ HOLD จัดเก็บแยกในพื้นที่ที่กำหนด มีป้ายบ่งชี้', '{warehouse,production}', 2, true, 'Product/Material/Pallet Storage', 'Rejected/returned/recalled/HOLD items stored apart and labeled', 'Rejected materials, returned and recalled goods, and HOLD items stored separately in a designated, labeled area'),
  ('C-33-5', 'ห้องล้างอุปกรณ์', '33.5', 'อุปกรณ์ล้างชิ้นส่วนเครื่องจักรแยกจากอุปกรณ์ทำความสะอาดพื้น/ห้องน้ำ', 'แปรง ฟองน้ำ สำหรับล้างชิ้นส่วนเครื่องจักร แยกจากอุปกรณ์ทำความสะอาดพื้นและห้องน้ำอย่างชัดเจน เช่น แยกด้วยสี อยู่ในสภาพดี (ถ้ามีในห้องล้าง)', '{production}', 2, true, 'Equipment Washing Room', 'Machine-part cleaning tools kept apart from floor/toilet tools', 'Brushes and sponges for machine parts clearly separated (e.g. color-coded) from floor and toilet cleaning tools, in good condition (if present)'),
  ('C-33-6', 'ห้องล้างอุปกรณ์', '33.6', 'มีอุปกรณ์ป้องกันส่วนบุคคล (PPE) สำหรับงานล้าง', 'มีอุปกรณ์ป้องกันส่วนบุคคลสำหรับงานล้างเบื้องต้น เช่น ถุงมือ ผ้ากันเปื้อนกันน้ำ รองเท้าบู๊ท', '{production}', 2, true, 'Equipment Washing Room', 'PPE for washing work available', 'Basic PPE for washing such as gloves, waterproof apron and boots is provided'),
  ('C-35-1', 'พื้นที่สูบบุหรี่', '35.1', 'กำหนดเขตสูบบุหรี่ชัดเจน มีป้าย อยู่ห่างพื้นที่เสี่ยง', 'มีป้าย "เขตสูบบุหรี่" อยู่แยกห่างจากพื้นที่ผลิต คลังสินค้า ทางเข้าอาคาร ช่องรับอากาศ และพื้นที่จัดเก็บวัสดุไวไฟ', '{outdoor}', 2, true, 'Smoking Area', 'Smoking area clearly designated, signed, away from risk areas', '"Smoking area" sign posted; located away from production, warehouses, building entrances, air intakes and flammable storage'),
  ('C-35-2', 'พื้นที่สูบบุหรี่', '35.2', 'ภาชนะทิ้งก้นบุหรี่ไม่ติดไฟ สมบูรณ์ ไม่ล้น', 'ภาชนะทิ้งก้นบุหรี่ทำจากวัสดุไม่ติดไฟ สภาพสมบูรณ์ ไม่ล้น และนำไปทิ้งตามรอบที่กำหนด', '{outdoor}', 2, true, 'Smoking Area', 'Non-flammable ashtray, intact, not overflowing', 'Cigarette butt container made of non-combustible material, intact, not overflowing, emptied on schedule'),
  ('C-35-3', 'พื้นที่สูบบุหรี่', '35.3', 'พื้นที่สะอาด ไม่มีก้นบุหรี่หรือขยะ', 'พื้นที่สะอาด ไม่มีก้นบุหรี่ ขยะ หรือสิ่งของที่ไม่เกี่ยวข้องวางอยู่', '{outdoor}', 2, true, 'Smoking Area', 'Area clean, no cigarette butts or litter', 'Area clean with no cigarette butts, litter or unrelated items'),
  ('C-36-1', 'พื้นที่ระบบผลิตน้ำ', '36.1', 'มีป้ายชื่อห้อง/พื้นที่ และป้ายอุปกรณ์หลักของระบบ', 'ป้ายชี้บ่งอุปกรณ์หลัก เช่น ถังพักน้ำ ถังกรองทราย/คาร์บอน Softener RO UV ถังเก็บน้ำ', '{maintenance}', 2, true, 'Water Treatment Area', 'Room/area name and main equipment labeled', 'Main equipment labeled, e.g. raw water tank, sand/carbon filters, softener, RO, UV, storage tank'),
  ('C-36-2', 'พื้นที่ระบบผลิตน้ำ', '36.2', 'ท่อชี้บ่งชนิดน้ำและทิศทางการไหล', 'ระบุชนิดของน้ำและทิศทางการไหลชัดเจน เช่น น้ำดิบ น้ำ RO น้ำที่ใช้ในการผลิต น้ำทิ้ง', '{maintenance}', 2, true, 'Water Treatment Area', 'Pipes marked with water type and flow direction', 'Water type and flow direction clearly marked, e.g. raw, RO, process water, wastewater'),
  ('C-36-3', 'พื้นที่ระบบผลิตน้ำ', '36.3', 'พื้นที่สะอาด ไม่มีน้ำขัง ตะไคร่ คราบสนิม', 'พื้นที่สะอาด ไม่มีน้ำขัง ไม่มีตะไคร่น้ำ คราบสนิม และไม่มีสิ่งของที่ไม่เกี่ยวข้อง', '{maintenance}', 2, true, 'Water Treatment Area', 'Area clean, no standing water, algae or rust', 'Area clean with no standing water, algae, rust stains or unrelated items'),
  ('C-36-4', 'พื้นที่ระบบผลิตน้ำ', '36.4', 'ท่อ วาล์ว ข้อต่อ ถังเก็บน้ำ สมบูรณ์ ไม่รั่วซึม', 'ท่อ วาล์ว ข้อต่อ ถังเก็บน้ำ ไม่ชำรุด ไม่รั่วซึม ฝาถังเก็บน้ำปิดสนิท', '{maintenance}', 2, true, 'Water Treatment Area', 'Pipes, valves, joints and tanks intact, no leaks', 'Pipes, valves, joints and storage tanks undamaged and leak-free; tank lids tightly closed'),
  ('C-36-5', 'พื้นที่ระบบผลิตน้ำ', '36.5', 'เครื่องวัดพร้อมใช้งาน', 'เครื่องวัด เช่น Pressure Gauge, Conductivity Meter, Flow Meter อยู่ในสภาพพร้อมใช้งาน', '{maintenance}', 2, true, 'Water Treatment Area', 'Meters in working order', 'Gauges and meters such as pressure gauge, conductivity meter and flow meter in working order'),
  ('C-36-6', 'พื้นที่ระบบผลิตน้ำ', '36.6', 'บันทึกตรวจสอบประจำวัน/บำรุงรักษาเป็นปัจจุบัน', 'บันทึกการตรวจสอบประจำวัน และการบำรุงรักษา (ถ้ามีในพื้นที่) เป็นปัจจุบัน', '{maintenance}', 2, true, 'Water Treatment Area', 'Daily check / maintenance records up to date', 'Daily check and maintenance records (if kept in the area) are current'),
  ('C-36-7', 'พื้นที่ระบบผลิตน้ำ', '36.7', 'สารเคมีในระบบเก็บในพื้นที่กำหนด มีป้าย', 'สารเคมีที่ใช้ในระบบ เช่น เกลือ คลอรีน สารป้องกันตะกรัน จัดเก็บในพื้นที่ที่กำหนด มีป้ายชี้บ่ง', '{maintenance}', 2, true, 'Water Treatment Area', 'System chemicals stored in a designated, labeled place', 'Chemicals used in the system (e.g. salt, chlorine, anti-scalant) stored in a designated, labeled place'),
  ('C-36-8', 'พื้นที่ระบบผลิตน้ำ', '36.8', 'จำกัดการเข้าพื้นที่เฉพาะผู้เกี่ยวข้อง', 'เช่น ประตูล็อค หรือป้ายห้ามบุคคลที่ไม่เกี่ยวข้องเข้า', '{maintenance}', 2, true, 'Water Treatment Area', 'Access limited to authorized people', 'E.g. locked door or "authorized personnel only" sign'),
  ('C-37-1', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.1', 'มีป้ายชื่อพื้นที่ หรือ Layout ตำแหน่งจัดเก็บ', 'มีป้ายชื่อพื้นที่ หรือแผนผัง (Layout) แสดงตำแหน่งจัดเก็บเครื่องมือช่าง อะไหล่ และวัสดุสิ้นเปลือง', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Area name sign or storage layout posted', 'Area name sign or layout showing where tools, spare parts and consumables are stored'),
  ('C-37-2', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.2', 'เครื่องมือช่างจัดเก็บเป็นหมวดหมู่ในตำแหน่งที่กำหนด', 'จัดเก็บเป็นหมวดหมู่ในตำแหน่งที่กำหนด หรือมีป้ายชี้บ่ง เช่น Shadow Board หรือกล่องเครื่องมือที่ระบุรายการ', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Tools sorted and kept in assigned places', 'Tools grouped and stored in assigned places or labeled, e.g. shadow board or tool box with a list'),
  ('C-37-3', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.3', 'อะไหล่เก็บบนชั้น/ในกล่อง แยกประเภท มีป้าย ไม่วางบนพื้น', 'อะไหล่จัดเก็บบนชั้นวางหรือในกล่อง แยกประเภทไม่ปะปนกัน มีป้ายชื่อ/รหัสอะไหล่ และไม่วางบนพื้นโดยตรง', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Spare parts on shelves/in boxes, sorted, labeled, off the floor', 'Spare parts kept on shelves or in boxes, sorted by type, labeled with name/code, never directly on the floor'),
  ('C-37-4', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.4', 'มีระบบควบคุมอะไหล่ (Stock / Min–Max) เป็นปัจจุบัน', 'มีระบบควบคุมอะไหล่ เช่น Stock Card หรือระบบคอมพิวเตอร์ แสดงชนิด ปริมาณคงเหลือ และจุดสั่งซื้อ (Min–Max) เป็นปัจจุบัน', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Spare parts control (stock / min–max) up to date', 'A spare parts control (stock card or computer system) shows type, quantity on hand and reorder point (min–max), kept current'),
  ('C-37-5', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.5', 'ของชำรุด/รอซ่อม/รอทิ้ง แยกจากของพร้อมใช้ มีป้ายสถานะ', 'อะไหล่/อุปกรณ์ที่ชำรุด รอซ่อม หรือรอทิ้ง แยกออกจากของพร้อมใช้งาน และมีป้ายแสดงสถานะชัดเจน', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Broken / awaiting repair / scrap items kept apart with status labels', 'Damaged, awaiting-repair or to-be-scrapped parts and equipment separated from usable stock, with clear status labels'),
  ('C-37-6', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.6', 'น้ำมัน จาระบี สารเคมีซ่อมบำรุง เก็บเป็นที่ มีถาดรอง แยก Food Grade', 'น้ำมันหล่อลื่น จาระบี และสารเคมีงานซ่อมบำรุง จัดเก็บในพื้นที่ที่กำหนด มีถาดรองกันหก มีป้ายชี้บ่ง และแยกชนิด Food Grade ออกจากชนิดทั่วไปอย่างชัดเจน', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Lubricants and maintenance chemicals stored properly; food grade kept apart', 'Lubricants, grease and maintenance chemicals in a designated, labeled place with drip trays; food-grade types clearly separated from general ones'),
  ('C-37-7', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.7', 'เครื่องมือไฟฟ้า เครื่องเชื่อม เครื่องเจียร พร้อมใช้ การ์ดครบ', 'เครื่องมือไฟฟ้า เครื่องเชื่อม เครื่องเจียร พร้อมใช้งาน สายไฟและปลั๊กไม่ชำรุด อุปกรณ์ป้องกัน (การ์ด) ครบ หากชำรุดต้องมีป้ายบ่งชี้สถานะ', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Power tools, welders and grinders ready, guards fitted', 'Power tools, welders and grinders in working order, cords and plugs undamaged, guards fitted; damaged tools tagged'),
  ('C-37-8', 'Work Shop ช่าง/พื้นที่เก็บอะไหล่', '37.8', 'โต๊ะช่างและพื้นที่สะอาด ไม่มีเศษโลหะ คราบน้ำมัน', 'ไม่มีเศษโลหะ เศษวัสดุ คราบน้ำมันสะสม และไม่มีสิ่งของที่ไม่เกี่ยวข้อง', '{maintenance}', 2, true, 'Maintenance Workshop & Spare Parts', 'Workbench and area clean, no metal chips or oil', 'No metal chips, scraps or oil buildup, and no unrelated items'),
  ('C-38-1', 'ห้อง Boiler', '38.1', 'มีป้ายชื่อห้อง และป้ายเตือนอันตราย', 'เช่น "พื้นผิวร้อน" "เขตอันตราย ห้ามบุคคลที่ไม่เกี่ยวข้องเข้า"', '{maintenance}', 2, true, 'Boiler Room', 'Room name and danger signs posted', 'E.g. "Hot surface", "Danger – authorized personnel only"'),
  ('C-38-2', 'ห้อง Boiler', '38.2', 'จำกัดการเข้าพื้นที่ ประตูปิด/ล็อคเมื่อไม่มีผู้ปฏิบัติงาน', 'จำกัดการเข้าพื้นที่เฉพาะผู้ที่ได้รับมอบหมาย ประตูปิดหรือล็อคเมื่อไม่มีผู้ปฏิบัติงาน', '{maintenance}', 2, true, 'Boiler Room', 'Access restricted; door closed/locked when unattended', 'Only assigned staff may enter; door closed or locked when nobody is working'),
  ('C-38-3', 'ห้อง Boiler', '38.3', 'มีวิธีเดินเครื่องและหยุดเครื่องฉุกเฉิน เห็นชัด/พร้อมใช้', 'มีวิธีการเดินเครื่อง วิธีหยุดเครื่องฉุกเฉิน ในตำแหน่งที่เห็นชัดเจนหรือมีพร้อมใช้', '{maintenance}', 2, true, 'Boiler Room', 'Operating and emergency stop procedures available', 'Start-up and emergency shutdown procedures posted where clearly visible or readily available'),
  ('C-38-4', 'ห้อง Boiler', '38.4', 'อุปกรณ์ความปลอดภัยของหม้อไอน้ำพร้อมใช้ อ่านค่าได้ชัด', 'อุปกรณ์ความปลอดภัยของหม้อไอน้ำอยู่ในสภาพพร้อมใช้งาน ไม่ชำรุด อ่านค่าได้ชัดเจน เกจวัดความดัน (Pressure Gauge)', '{maintenance}', 2, true, 'Boiler Room', 'Boiler safety devices working, readings clear', 'Boiler safety devices in working order, undamaged and clearly readable, pressure gauge'),
  ('C-38-5', 'ห้อง Boiler', '38.5', 'ปุ่มหยุดฉุกเฉินมีป้ายชัดเจน เข้าถึงได้', 'ปุ่มหยุดฉุกเฉิน (Emergency Stop) มีป้ายบ่งชี้ชัดเจน และไม่มีสิ่งกีดขวางการเข้าถึง', '{maintenance}', 2, true, 'Boiler Room', 'Emergency stop clearly marked and accessible', 'Emergency stop button clearly marked and not obstructed'),
  ('C-38-6', 'ห้อง Boiler', '38.6', 'ท่อชี้บ่งชนิดและทิศทางการไหล', 'เช่น ท่อไอน้ำ ท่อน้ำป้อน ท่อน้ำคอนเดนเสท ท่อเชื้อเพลิง', '{maintenance}', 2, true, 'Boiler Room', 'Pipes marked with type and flow direction', 'E.g. steam, feed water, condensate and fuel lines'),
  ('C-38-7', 'ห้อง Boiler', '38.7', 'เชื้อเพลิงเก็บในพื้นที่กำหนด มีป้าย มีถาดกันหก ห่างความร้อน', 'เชื้อเพลิง เช่น ถังน้ำมัน ถังก๊าซ จัดเก็บในพื้นที่ที่กำหนด มีป้ายบ่งชี้ ถังน้ำมันมีถาดหรือขอบกั้นกันหก และอยู่ห่างจากแหล่งความร้อนตามที่กำหนด', '{maintenance}', 2, true, 'Boiler Room', 'Fuel stored in place, labeled, bunded, away from heat', 'Fuel (oil drums, gas cylinders) in a designated, labeled place; oil drums on drip trays or bunded, kept the required distance from heat sources'),
  ('C-38-8', 'ห้อง Boiler', '38.8', 'สารเคมีปรับสภาพน้ำ Boiler เก็บเป็นที่ มีป้าย มี SDS', 'สารเคมีปรับสภาพน้ำ Boiler เช่น สารป้องกันตะกรัน สารกำจัดออกซิเจน จัดเก็บในพื้นที่ที่กำหนด มีป้ายบ่งชี้ มี SDS', '{maintenance}', 2, true, 'Boiler Room', 'Boiler water chemicals stored in place, labeled, with SDS', 'Boiler water treatment chemicals (anti-scalant, oxygen scavenger) in a designated, labeled place with SDS'),
  ('C-38-9', 'ห้อง Boiler', '38.9', 'ห้องสะอาด ไม่มีคราบน้ำมัน น้ำขัง เขม่า', 'ห้องสะอาด ไม่มีคราบน้ำมัน น้ำขัง หรือเขม่าสะสมบนพื้นและตัวเครื่อง', '{maintenance}', 2, true, 'Boiler Room', 'Room clean, no oil, standing water or soot', 'No oil stains, standing water or soot on the floor and equipment'),
  ('C-38-10', 'ห้อง Boiler', '38.10', 'ไม่มีวัสดุไวไฟหรือสิ่งของไม่เกี่ยวข้องในห้อง', 'ไม่มีวัสดุไวไฟ กล่องกระดาษ หรือสิ่งของที่ไม่เกี่ยวข้องวางในห้อง', '{maintenance}', 2, true, 'Boiler Room', 'No flammable or unrelated items in the room', 'No flammable materials, cardboard boxes or unrelated items in the room')
on conflict (criteria_id) do update set
  category = excluded.category, sub_category = excluded.sub_category, question = excluded.question,
  description = excluded.description, area_types = excluded.area_types, max_score = excluded.max_score,
  active = excluded.active, category_en = excluded.category_en, question_en = excluded.question_en,
  description_en = excluded.description_en;

-- M2) ปิดใช้งาน 6 ข้อที่ตัดออก (ห้าม DELETE — ผล Round 1 อ้างอยู่ · ประวัติยังแสดงได้เพราะ embed ไม่กรอง active)
update public.criteria set active = false where criteria_id in ('C-06-3', 'C-10-1', 'C-10-2', 'C-11-4', 'C-34-6', 'C-34-7');

-- M3) เปลี่ยนเลขข้อให้ตรงเอกสารใหม่ (ข้อความ/คะแนนเดิม · ประวัติ Round 1 จะแสดงเลขใหม่ — ผู้ใช้เลือก)
update public.criteria as t set sub_category = v.no from (values
  ('C-06-4', '6.3'),
  ('C-06-5', '6.4'),
  ('C-06-6', '6.5'),
  ('C-06-7', '6.6'),
  ('C-11-2', '11.5'),
  ('C-11-3', '11.6'),
  ('C-27-1', '27.2'),
  ('C-27-2', '27.3'),
  ('C-27-3', '27.4'),
  ('C-27-4', '27.7'),
  ('C-27-5', '27.9'),
  ('C-31-3', '31.4'),
  ('C-31-4', '31.5'),
  ('C-31-5', '31.6'),
  ('C-34-8', '34.6')
) as v(criteria_id, no) where t.criteria_id = v.criteria_id;

-- M4) แก้ข้อความข้อเดิมตามเอกสารใหม่ (ผู้ใช้เลือกแก้ในข้อเดิม — ประวัติ Round 1 จะแสดงข้อความใหม่ · คะแนนไม่เปลี่ยน)
update public.criteria set question = 'พื้นที่พักขยะมีขอบเขตกำหนดชัดเจน มีป้ายชี้บ่ง', question_en = 'Waste area boundary clearly defined and marked' where criteria_id = 'C-11-1';
update public.criteria set question = 'พื้นที่พักขยะและถังขยะไม่เป็นแหล่งสะสมสัตว์พาหะ แมลง', question_en = 'Waste area and bins not a source of pests/insects' where criteria_id = 'C-11-3';
update public.criteria set question = 'ท่อระบายน้ำมีฝาปิด ไม่มีขยะ ท่อ/ฝา/ตะแกรงไม่ชำรุด ไม่กีดขวาง', description = 'ท่อและทางระบายน้ำไม่แตกร้าว ไม่รั่วซึม ฝาปิด/ตะแกรงไม่ชำรุดหรือสูญหาย ไม่มีขยะหรือวัสดุกีดขวางทางน้ำ', question_en = 'Drains covered and clear; pipes, covers and grates intact', description_en = 'Drains and channels not cracked or leaking, covers/grates not damaged or missing, nothing blocking the flow' where criteria_id = 'C-13-3';
update public.criteria set question = 'จัดวางสิ่งของเป็นระเบียบ สะดวกใช้งาน วางแก้วได้ไม่เกิน 3 ชิ้น', description = 'สิ่งของบนโต๊ะเป็นระเบียบ มีแก้วบนโต๊ะไม่เกิน 3 ชิ้น', question_en = 'Items arranged neatly for easy use; no more than 3 cups', description_en = 'Desk items kept tidy, no more than 3 cups/glasses on the desk' where criteria_id = 'C-25-2';
update public.criteria set question = 'ป้ายสถานะห้อง/เครื่องข้อมูลครบ ตรงกับงานจริง', description = 'ระบุชื่อผลิตภัณฑ์ Lot No. วันที่ และสถานะ "กำลังผลิต / ทำความสะอาดแล้ว / รอทำความสะอาด" ตรงกับงานที่ทำอยู่จริง', question_en = 'Room/machine status sign complete and matches actual work', description_en = 'Shows product name, lot no., date and status (in production / cleaned / awaiting cleaning) matching the actual work' where criteria_id = 'C-29-6';
update public.criteria set description = 'ค้อน ตะปู น็อต ประแจ หรืออุปกรณ์อื่นๆ ไม่อยู่บน ISOWALL' where criteria_id = 'C-12-2';

-- M5) สะกดคำตามเอกสารใหม่: ล็อคเกอร์ → ล็อกเกอร์ (หมวด 17) · สวิทซ์ → สวิตช์ (หมวด 22)
update public.criteria set category = replace(category, 'ล็อคเกอร์', 'ล็อกเกอร์') where criteria_id like 'C-17-%';
update public.criteria set category = replace(category, 'สวิทซ์', 'สวิตช์'), question = replace(question, 'สวิทซ์', 'สวิตช์'),
       description = replace(description, 'สวิทซ์', 'สวิตช์') where criteria_id like 'C-22-%';

-- ตรวจผลหลังรัน:
-- select
--   (select count(*) from public.criteria where active)                              as active_items,   -- 169
--   (select count(distinct category) from public.criteria where active)              as active_cats,    -- 38
--   (select sum(max_score) from public.criteria where active)                        as full_score,     -- 338
--   (select count(*) from public.criteria)                                           as all_items,      -- 175
--   (select count(*) || ' locked=' || count(locked_at) from public.audit_headers)    as headers,        -- 64 locked=64
--   (select sum(total_score) || '/' || sum(max_score) from public.audit_headers)     as score_sum,      -- 6410/6838
--   (select count(*) from public.audit_details)                                      as details;        -- 4893
