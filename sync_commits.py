#!/usr/bin/env python3
"""
sync_commits.py — ดึง commits จาก GitHub แล้วสร้าง Zettelkasten notes ใน Obsidian
รัน: python3 sync_commits.py
"""

import subprocess, json, os, sys
from datetime import datetime
from pathlib import Path

# ===== CONFIG =====
OWNER = "Seksunw"
REPO  = "5s-audit-system"
VAULT = Path.home() / "Desktop/5S/5S apps/5S Brain"
COMMITS_DIR = VAULT / "300 Commits"
MOC_FILE    = VAULT / "000 Index/5S Audit System MOC.md"
# ==================

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode

def main():
    # ตรวจสอบ gh cli
    _, rc = run(["gh", "--version"])
    if rc != 0:
        print("❌ ไม่พบ gh CLI — ติดตั้งด้วย: brew install gh")
        sys.exit(1)

    print(f"📡 ดึง commits ทั้งหมดจาก {OWNER}/{REPO}...")
    all_commits = []
    page = 1
    while True:
        out, rc = run(["gh", "api",
                       f"repos/{OWNER}/{REPO}/commits?per_page=100&page={page}&sha=main"])
        if rc != 0:
            print("❌ ดึง commits ไม่ได้ — ลอง: gh auth login")
            sys.exit(1)
        batch = json.loads(out)
        if not batch:
            break
        all_commits.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    commits = all_commits
    print(f"   พบ {len(commits)} commits")
    COMMITS_DIR.mkdir(parents=True, exist_ok=True)
    (VAULT / "000 Index").mkdir(parents=True, exist_ok=True)

    new_notes = []

    for c in commits:
        sha     = c["sha"]
        short   = sha[:7]
        date    = c["commit"]["author"]["date"][:10]
        author  = c["commit"]["author"]["name"]
        msg_lines = c["commit"]["message"].split("\n")
        title   = msg_lines[0][:60]
        body    = "\n".join(msg_lines[1:]).strip() or "—"

        fname = COMMITS_DIR / f"{date} {short}.md"
        if fname.exists():
            continue  # ข้ามถ้ามีแล้ว

        # ดึงรายชื่อไฟล์ที่เปลี่ยน
        files_out, _ = run(["gh", "api", f"repos/{OWNER}/{REPO}/commits/{sha}",
                            "--jq", ".files[].filename"])
        changed = files_out or "—"
        changed_list = "\n".join(f"- {f}" for f in changed.split("\n") if f)

        # สร้าง links
        links = ["[[5S Audit System MOC]]"]
        if "Code.gs" in changed:   links.append("[[Code.gs]]")
        if "app.js"  in changed:   links.append("[[app.js]]")

        note = f"""---
tags: [github, commit, 5s-audit]
date: {date}
sha: {sha}
author: {author}
repo: {REPO}
---

# {title}

## ไฟล์ที่เปลี่ยน
{changed_list}

## รายละเอียด
{body}

## Links
{chr(10).join(links)}

---
[ดูบน GitHub](https://github.com/{OWNER}/{REPO}/commit/{sha})
"""
        fname.write_text(note, encoding="utf-8")
        new_notes.append(f"  ✅ {date} {short} — {title}")

    # อัปเดต MOC
    if new_notes:
        moc_entry = f"\n### Synced {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        moc_entry += "\n".join(f"- [[{Path(n.split('✅ ')[1].split(' — ')[0])}]]"
                               for n in new_notes)
        if MOC_FILE.exists():
            existing = MOC_FILE.read_text(encoding="utf-8")
            if "## Recent Commits" in existing:
                updated = existing.replace("## Recent Commits",
                                           "## Recent Commits\n" + moc_entry)
            else:
                updated = existing + "\n\n## Recent Commits\n" + moc_entry
            MOC_FILE.write_text(updated, encoding="utf-8")

    # รายงาน
    if new_notes:
        print(f"\n✅ สร้าง {len(new_notes)} notes ใน:\n  {COMMITS_DIR}\n")
        for n in new_notes:
            print(n)
    else:
        print("\n✅ ไม่มี commit ใหม่ — ทุกอย่าง up-to-date แล้ว")

if __name__ == "__main__":
    main()
