---
name: setup-supabase-mcp
description: Step-by-step guide to connect Supabase MCP (read-only) to Claude Code for the 5S Audit System project — Personal Access Token, .mcp.json, project ref oibjnkngraulcccdqevm. Use when setting up the Supabase MCP connection for the first time, reconnecting on a new machine, or troubleshooting /mcp showing the supabase server as disconnected.
---

# ต่อ Supabase MCP กับ Claude Code (read-only — แนะนำเริ่มแบบนี้ก่อน)

ให้ Claude Code "มองเห็น" DB จริงได้ (query/inspect schema+ข้อมูล) โดย **read-only กันแก้พลาด**
> เอกสารอ้างอิง: [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) · [Claude Code MCP](https://code.claude.com/docs/en/mcp)

**ต้องมีก่อน:** Node 18+ (`npx`)

**1. สร้าง Personal Access Token (PAT)**
- Supabase Dashboard → Account → [Access Tokens](https://supabase.com/dashboard/account/tokens) → Generate new token (ตั้งชื่อ เช่น `Claude Code MCP`)
- 🔴 เก็บเป็นความลับ — **ห้าม commit ลง repo (repo นี้ public)** · ใช้ PAT เท่านั้น อย่าใช้ service_role key

**2. Project ref ของโปรเจกต์นี้:** `oibjnkngraulcccdqevm` (จาก `https://oibjnkngraulcccdqevm.supabase.co`)

**3. สร้างไฟล์ `.mcp.json` ที่ root ของโปรเจกต์** (ไฟล์นี้ commit ได้ ไม่มี secret — token อ้างผ่าน env):

```json
{
  "mcpServers": {
    "supabase": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=oibjnkngraulcccdqevm"
      ],
      "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
    }
  }
}
```

**4. ตั้ง env var แล้วเปิด Claude Code** (token อยู่ในเชลล์/`.env` เท่านั้น ไม่อยู่ในไฟล์ที่ commit):

```bash
export SUPABASE_ACCESS_TOKEN="<PAT ของคุณ>"
claude
```

**5. เช็คว่าต่อติด:** ใน Claude Code พิมพ์ `/mcp` (ควรขึ้น `supabase ✔ Connected`) หรือ terminal `claude mcp list`

**ความปลอดภัย:**
- `--read-only` = query ได้ แต่ INSERT/UPDATE/DELETE ไม่ได้ — เริ่มแบบนี้เสมอ
- `--project-ref` ล็อกให้เห็นแค่โปรเจกต์นี้
- 🔴 **repo เป็น public** → เพิ่ม `.env` และ `*.token` ลง `.gitignore` ก่อน (ห้ามให้ token หลุด) · `.mcp.json` เอง commit ได้เพราะไม่มี secret
- จะแก้ DB จริง (ตัด `--read-only`) ค่อยทำทีหลังเมื่อมั่นใจ และยังต้องยึดกติกา: ต่อท้าย `patches.sql` แบบ idempotent เท่านั้น
