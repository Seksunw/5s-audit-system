#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ตรวจโค้ดแบบกลไก (mechanical) ก่อน commit / push — ไม่ต้องติดตั้งอะไรเพิ่ม (python3 + node + git)

ใช้:
  python3 tools/precheck.py              ตรวจ working tree (รวมที่ยังไม่ commit) เทียบ origin/main
  python3 tools/precheck.py --ref HEAD   ตรวจเฉพาะสิ่งที่ commit แล้ว (ใช้ใน git pre-push hook)

ผล: FAIL = ต้องแก้ก่อน push (exit 1) · WARN = ให้ code-checker agent / คนตรวจดูต่อ (exit 0)
การตรวจเชิงความหมาย (บั๊ก, logic, การทำงานของแอป) เป็นงานของ agent `.claude/agents/code-checker.md`
"""
import os, re, subprocess, sys, tempfile

ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True).stdout.strip()
os.chdir(ROOT)
REF = None
if '--ref' in sys.argv:
    REF = sys.argv[sys.argv.index('--ref') + 1]
BASE = os.environ.get('PRECHECK_BASE', 'origin/main')

fails, warns = [], []
def fail(msg): fails.append(msg)
def warn(msg): warns.append(msg)

def git(*args):
    r = subprocess.run(['git', *args], capture_output=True, text=True)
    return r.stdout

def read(path, ref=None):
    """อ่านไฟล์จาก ref (เช่น HEAD / origin/main) หรือ working tree ถ้า ref เป็น None"""
    if ref:
        r = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else None
    try:
        return open(path, encoding='utf-8').read()
    except FileNotFoundError:
        return None

def tracked(ref=None):
    out = git('ls-tree', '-r', '--name-only', ref) if ref else git('ls-files')
    return [l for l in out.splitlines() if l]

# ---------- ขอบเขตการเปลี่ยนแปลง ----------
if not git('rev-parse', '--verify', '--quiet', BASE).strip():
    warn(f'ไม่พบ {BASE} — เทียบกับ HEAD~1 แทน'); BASE = 'HEAD~1'
diff_args = [BASE, REF] if REF else [BASE]
changed = [l for l in git('diff', '--name-only', *diff_args).splitlines() if l]
if not REF:   # รวมไฟล์ใหม่ที่ยังไม่ track แต่ไม่ถูก ignore
    untracked = [l for l in git('ls-files', '--others', '--exclude-standard').splitlines() if l]
else:
    untracked = []
patch = git('diff', '-U0', *diff_args)
added = []   # (file, line_text)
cur = None
for line in patch.splitlines():
    if line.startswith('+++ '):
        cur = line[6:] if line.startswith('+++ b/') else None
    elif line.startswith('+') and not line.startswith('+++') and cur:
        added.append((cur, line[1:]))

FILES = tracked(REF)
HTML = sorted(f for f in FILES if f.endswith('.html') and '/' not in f)

# ---------- 1) JS syntax ----------
for js in ('js/app.js', 'sw.js'):
    src = read(js, REF)
    if src is None: continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as t:
        t.write(src); tmp = t.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    os.unlink(tmp)
    if r.returncode != 0:
        fail(f'{js}: JavaScript syntax error — {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "?"}')

# ---------- 2) i18n parity + key ที่ใช้ต้องมีจริง ----------
app = read('js/app.js', REF) or ''
m = re.search(r'const TRANSLATIONS = \{', app)
if m:
    start = m.start()
    th0 = app.find('\n  th: {', start)
    en1 = app.find('\n  en: {', th0)
    en2 = app.find('\n  en: {', en1 + 5)          # บล็อก en ที่ 2 คือบล็อกที่ใช้จริง (บล็อกแรกถูกทับ — ดู CLAUDE.md)
    end = app.find('\n};', en2 if en2 > 0 else en1)
    key = re.compile(r"'([A-Za-z0-9_.]+)'\s*:")   # บางบรรทัดมีหลาย key (เช่น month.1–3)
    th = set(key.findall(app[th0:en1]))
    en = set(key.findall(app[en2:end])) if en2 > 0 else set(key.findall(app[en1:end]))
    if th - en: fail(f'i18n: มีใน th แต่ไม่มีใน en ({len(th - en)}): ' + ', '.join(sorted(th - en)[:10]))
    if en - th: fail(f'i18n: มีใน en แต่ไม่มีใน th ({len(en - th)}): ' + ', '.join(sorted(en - th)[:10]))
    used = set(re.findall(r"I18n\.t\('([a-z0-9_.]+)'\)", app))
    missing = sorted(k for k in used if k not in th)
    if missing: fail('i18n: เรียก I18n.t() ด้วย key ที่ไม่มี: ' + ', '.join(missing[:10]))
    html_keys = set()
    for h in HTML:
        html_keys |= set(re.findall(r'data-i18n(?:-[a-z]+)?="([^"]+)"', read(h, REF) or ''))
    missing_h = sorted(k for k in html_keys if k not in th)
    if missing_h: fail('i18n: data-i18n ใน HTML อ้าง key ที่ไม่มี: ' + ', '.join(missing_h[:10]))
else:
    fail('i18n: หา const TRANSLATIONS ใน js/app.js ไม่เจอ')

# ---------- 3) cache-bust ?v= + sw.js CACHE_NAME ----------
vers = {}
for h in HTML:
    for v in re.findall(r'(?:app\.js|style\.css)\?v=(\d+)', read(h, REF) or ''):
        vers.setdefault(v, []).append(h)
if len(vers) > 1:
    fail('cache-bust: ?v= ไม่เท่ากันทุกหน้า: ' + '; '.join(f'v={k} ใน {sorted(set(v))[:4]}' for k, v in vers.items()))
cur_v = max((int(k) for k in vers), default=0)
base_v = max((int(x) for h in HTML for x in re.findall(r'app\.js\?v=(\d+)', read(h, BASE) or '')), default=0)
sw_now = re.search(r"CACHE_NAME\s*=\s*'([^']+)'", read('sw.js', REF) or '')
sw_base = re.search(r"CACHE_NAME\s*=\s*'([^']+)'", read('sw.js', BASE) or '')
web_changed = [f for f in changed if f in ('js/app.js', 'css/style.css', 'manifest.json') or f in HTML]
if web_changed:
    if cur_v <= base_v:
        fail(f'cache-bust: แก้ {", ".join(web_changed[:4])} แต่ ?v= ยังเป็น {cur_v} (บนเว็บ {base_v}) — ต้อง bump ทุกหน้า')
    if sw_now and sw_base and sw_now.group(1) == sw_base.group(1):
        fail(f'sw.js: CACHE_NAME ยังเป็น {sw_now.group(1)} — HTML ถูก cache แบบ cache-first ต้องเปลี่ยนเลขทุกครั้งที่ deploy หน้าเว็บ')

# ---------- 4) CSP เหมือนกันทุกหน้า ----------
csps = {}
for h in HTML:
    mm = re.search(r'<meta http-equiv="Content-Security-Policy"[^>]*>', read(h, REF) or '')
    if not mm: fail(f'CSP: {h} ไม่มี <meta> Content-Security-Policy'); continue
    csps.setdefault(mm.group(0), []).append(h)
if len(csps) > 1:
    fail('CSP: ไม่เหมือนกันทุกหน้า — ' + ' | '.join(f'{len(v)} หน้า เช่น {v[0]}' for v in csps.values()))

# ---------- 5) secret ในบรรทัดที่เพิ่ม ----------
SECRET = [
    (r'(?i)service_role[_ ]?key\s*[:=]\s*[\'"][^\'"]{8,}', 'service_role key'), (r'sb_secret_[A-Za-z0-9_-]{10,}', 'Supabase secret key'),
    (r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.', 'JWT'), (r'gh[pousr]_[A-Za-z0-9]{20,}', 'GitHub token'),
    (r'github_pat_[A-Za-z0-9_]{20,}', 'GitHub token'), (r'sk-ant-[A-Za-z0-9_-]{10,}', 'Anthropic key'),
    (r'-----BEGIN [A-Z ]*PRIVATE KEY', 'private key'), (r'(?i)(password|passwd|pwd)\s*[:=]\s*[\'"][^\'"\s]{6,}', 'password'),
]
for f, line in added:
    if f == 'tools/precheck.py': continue          # ไฟล์นี้มีรูปแบบ secret เป็นตัวอย่างเอง
    for pat, name in SECRET:
        if re.search(pat, line):
            fail(f'secret?: {f}: พบรูปแบบ {name} ในบรรทัดที่เพิ่ม — repo เป็น public ห้ามมีความลับ')

# ---------- 6) ไฟล์ที่ห้ามขึ้น GitHub ----------
FORBID = [r'^5s-ui-screenshots/', r'^system-map/', r'^5s-system-map', r'\.docx$', r'SECURITY_ASSESSMENT', r'PENTEST',
          r'^work-logs/', r'^เกณฑ์ใหม่_ตรวจทาน', r'(^|/)\.env', r'^Criteria_Master\.csv$', r'\.pentest\.md$']
for f in FILES:
    for pat in FORBID:
        if re.search(pat, f):
            fail(f'ไฟล์ต้องห้ามถูก track: {f} (ดูตาราง "ห้าม push" ใน CLAUDE.md)')

# ---------- 7) ลิงก์ Artifact ส่วนตัว / ข้อมูลที่ตกลงไม่ push ----------
for f in FILES:
    if f.endswith(('.png', '.jpg', '.ico', '.pdf')): continue
    src = read(f, REF) or ''
    if re.search(r'https?://claude\.ai/(?:code/)?artifact/[A-Za-z0-9]', src):
        fail(f'{f}: มีลิงก์ Artifact บน claude.ai — ผู้ใช้สั่งไม่ให้ลิงก์แผนผังขึ้น repo')

# ---------- WARN: heuristic สำหรับ agent / คนตรวจ ----------
for f, line in added:
    if f != 'js/app.js': continue
    s = line.strip()
    if '${' in s and '<' in s:
        # ทุก ${...} ในบรรทัดที่สร้าง HTML ต้องผ่านฟังก์ชันกัน XSS หรือเป็นตัวเลข/ข้อความแปลจากระบบ
        SAFE = r'escHtml|escAttr|safeUrl|safeImg|_f1\b|_f2\b|toFixed|Number\(|Math\.|I18n\.t|statusSvg|\.length\b'
        bad = [e for e in re.findall(r'\$\{([^}]*)\}', s)
               if not re.search(SAFE, e) and not re.fullmatch(r'\s*(idx|i|n|done|total|pct|cls|medal|color)\s*', e)]
        if bad:
            warn(f'XSS?: js/app.js: ${{{bad[0].strip()[:40]}}} ใน template HTML ไม่ผ่าน escHtml/escAttr — {s[:100]}')
    if re.search(r"order\('criteria_id'\)", s) and 'critNoKey' not in s:
        warn('criteria: order(\'criteria_id\') ใหม่ — ต้องเรียงด้วย critNoKey(sub_category) ก่อนแสดง (CLAUDE.md)')
    if re.search(r"from\('audit_headers'\)", s) and 'locked_at' not in s:
        warn(f'reports: query audit_headers ใหม่ — ถ้าเป็นรายงานต้องกรอง locked_at is not null — {s[:100]}')
    if 'audit.html' in s and 'scheduleId' not in s:
        warn(f'audit.html: ลิงก์/navigate ใหม่ไปหน้าตรวจต้องส่ง scheduleId — {s[:100]}')
    if re.search(r'\bconsole\.(log|debug)\(', s):
        warn(f'console.log ใหม่ (ปิดอัตโนมัติบนเว็บจริง แต่ตรวจว่าไม่พิมพ์ข้อมูลส่วนตัว) — {s[:90]}')
if 'supabase/patches.sql' in changed:
    removed = [l for l in git('diff', '-U0', *diff_args, '--', 'supabase/patches.sql').splitlines()
               if l.startswith('-') and not l.startswith('---') and l[1:].strip()]
    if removed:
        warn(f'patches.sql: มีบรรทัดถูกลบ/แก้ {len(removed)} บรรทัด — ปกติต้อง "ต่อท้าย" ส่วนใหม่เท่านั้น')
    warn('patches.sql เปลี่ยน — ตรวจว่า idempotent (รันซ้ำได้), มี RUN_*.sql ให้ผู้ใช้รันในแท็บใหม่, และ verify ผ่าน MCP หลังรัน')
    if re.search(r'(?im)^\s*delete\s+from\s+public\.criteria', '\n'.join(l for f2, l in added if f2 == 'supabase/patches.sql')):
        fail('patches.sql: DELETE เกณฑ์ — ห้าม (ใช้ active=false)')
code_changed = [f for f in changed if f.endswith(('.js', '.html', '.css', '.sql'))]
if code_changed and 'spec.md' not in changed:
    warn('spec.md ไม่ได้อัปเดต — CLAUDE.md กำหนดให้อัปเดต Current state ทุกครั้งที่เปลี่ยนโค้ด')
for f in untracked:
    if f.endswith(('.js', '.html', '.css', '.sql', '.md')) and not f.startswith(('DATAVERSE_MIGRATION_PLAN', 'TEAM_AUDIT_PLAN')):
        warn(f'ไฟล์ใหม่ยังไม่ถูก add: {f} (ลืม git add หรือควรใส่ .gitignore?)')

# ---------- สรุป ----------
scope = f'{BASE}..{REF}' if REF else f'{BASE}..working tree'
print(f'precheck: {scope} · เปลี่ยน {len(changed)} ไฟล์')
for m in fails: print('  FAIL ', m)
for m in warns: print('  WARN ', m)
if not fails and not warns: print('  OK ทุกข้อ')
print(f'สรุป: FAIL {len(fails)} · WARN {len(warns)}')
sys.exit(1 if fails else 0)
