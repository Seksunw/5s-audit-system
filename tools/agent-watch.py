#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ดูการทำงานของ agent (เช่น code-checker) แบบสด — อ่าน transcript ที่ Claude Code เขียนไว้ในเครื่อง
(~/.claude/projects/<repo>/<session>/subagents/agent-*.jsonl) แล้วพิมพ์ทีละขั้น: อ่านไฟล์อะไร รันคำสั่งอะไร ได้ผลอะไร

ใช้ (เปิดใน Terminal ของ VS Code แยกไว้ข้างแชท):
  python3 tools/agent-watch.py           รอ agent ตัวถัดไปเริ่มงาน แล้วโชว์สด (ถ้ามีตัวที่กำลังทำอยู่ โชว์ตัวนั้นเลย) · Ctrl+C ออก
  python3 tools/agent-watch.py --last    เล่นซ้ำรอบล่าสุดที่จบแล้ว
  python3 tools/agent-watch.py --list    รายการรอบที่ผ่านมา
  python3 tools/agent-watch.py --id a7b  เล่นซ้ำ/ตามดูรอบที่ id ขึ้นต้นด้วย a7b

อ่านอย่างเดียว ไม่ส่งข้อมูลออกไปไหน · transcript อยู่ในเครื่องผู้ใช้เท่านั้น (ไม่อยู่ใน repo)
"""
import glob, json, os, re, sys, time
from datetime import datetime

# repo = โฟลเดอร์แม่ของ tools/ (ไม่พึ่ง cwd — รันจากที่ไหนก็เฝ้าโปรเจกต์นี้)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTS = os.path.expanduser('~/.claude/projects')
SLUG = re.sub(r'[^A-Za-z0-9-]', '-', ROOT)
# รอบที่ไฟล์ไม่ขยับนานเกินนี้ถือว่าจบแล้ว แม้ไม่มี finished ใน meta (ถูก kill / ปิด session กลางทาง)
STALE_SEC = 15 * 60
POLL_SEC = 0.5

COLOR = sys.stdout.isatty() and not os.environ.get('NO_COLOR')
def c(code, s): return f'\033[{code}m{s}\033[0m' if COLOR else s
DIM, BOLD, RED, GREEN, YEL, CYAN = '2', '1', '31', '32', '33', '36'


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:                                 # Claude Code ล้าง transcript เก่าระหว่างที่เรา glob
        return 0


def runs():
    """transcript ของ agent ทุกตัวในโปรเจกต์นี้ เรียงเก่า → ใหม่"""
    files = glob.glob(os.path.join(PROJECTS, SLUG, '*', 'subagents', 'agent-*.jsonl'))
    return sorted(files, key=mtime)


def meta(path):
    try:
        with open(path[:-len('.jsonl')] + '.meta.json', encoding='utf-8') as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def is_done(path):
    return bool(meta(path).get('finished')) or time.time() - mtime(path) > STALE_SEC


def agent_id(path):
    return os.path.basename(path)[len('agent-'):-len('.jsonl')]


def hhmmss(ts):
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone().strftime('%H:%M:%S')
    except (AttributeError, ValueError):
        return '--:--:--'


def clean(s):
    """กัน escape sequence ใน transcript ไปสั่ง terminal"""
    return str(s if s is not None else '').replace('\x1b', '␛')


def short(s, n=110):
    s = ' '.join(clean(s).split())
    return s if len(s) <= n else s[:n - 1] + '…'


def rel(p):
    p = clean(p)
    return p[len(ROOT) + 1:] if p.startswith(ROOT + '/') else p


def describe_tool(name, inp):
    """ทำให้การเรียกเครื่องมือหนึ่งครั้งอ่านเป็นภาษาคน"""
    if name == 'Bash':
        cmd = clean(inp.get('command')).strip().splitlines()
        line = f'{c(BOLD, "รัน")}   {short(inp.get("description") or "", 100)}'
        if cmd:
            line += '\n' + ' ' * 13 + c(DIM, '$ ' + short(cmd[0], 100) + (' …' if len(cmd) > 1 else ''))
        return line
    if name == 'Read':
        extra = ''
        if inp.get('offset') or inp.get('limit'):
            extra = c(DIM, f'  (บรรทัด {inp.get("offset", 1)}+{inp.get("limit", "")})')
        return f'{c(BOLD, "อ่าน")}  {rel(inp.get("file_path"))}{extra}'
    if name == 'Grep':
        where = rel(inp.get('path') or inp.get('glob') or '')
        return f'{c(BOLD, "ค้น")}   "{short(inp.get("pattern", ""), 70)}"' + (c(DIM, f'  ใน {where}') if where else '')
    if name == 'Glob':
        return f'{c(BOLD, "หาไฟล์")} {short(inp.get("pattern", ""), 90)}'
    if name in ('Edit', 'Write', 'NotebookEdit'):
        return c(RED, f'แก้ไฟล์ {rel(inp.get("file_path"))}  ← agent ตรวจโค้ดไม่ควรแก้ไฟล์')
    if name == 'SubagentHandback':                  # รายงานฉบับเต็มที่ agent ส่งกลับให้ Claude หลัก
        return c(CYAN, 'ส่งรายงาน:') + '\n' + '\n'.join('    ' + l for l in clean(inp.get('message')).splitlines())
    if name.endswith('execute_sql'):
        return f'{c(BOLD, "SQL")}   ' + c(DIM, short(inp.get('query', ''), 100))
    return f'{c(BOLD, clean(name))} ' + c(DIM, short(json.dumps(inp, ensure_ascii=False), 90))


def result_text(block):
    content = block.get('content')
    if isinstance(content, list):
        content = '\n'.join(b.get('text') or '' for b in content if isinstance(b, dict))
    return clean(content)


class Printer:
    def __init__(self):
        self.tools = 0
        self.first = self.last = None
        self.handed_back = False

    def event(self, o):
        if not isinstance(o, dict) or o.get('type') not in ('assistant', 'user'):
            return
        ts = o.get('timestamp')
        self.first = self.first or ts
        self.last = ts or self.last
        content = (o.get('message') or {}).get('content')
        if isinstance(content, str):
            if self.tools:                          # ข้อความเพิ่มจากผู้เรียกระหว่างทาง (SendMessage)
                print(f'{c(DIM, hhmmss(ts))}  {c(YEL, "ผู้เรียกส่งข้อความ:")} {c(DIM, short(content, 90))}')
            return                                  # คำสั่งตั้งต้น — หัวรอบโชว์ description แล้ว
        for b in content if isinstance(content, list) else []:
            if not isinstance(b, dict):
                continue
            kind = b.get('type')
            if kind == 'tool_use':
                self.tools += 1
                name = b.get('name') or ''
                self.handed_back = self.handed_back or name == 'SubagentHandback'
                inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                print(f'{c(DIM, hhmmss(ts))}  {describe_tool(name, inp)}')
            elif kind == 'tool_result':
                lines = [l for l in result_text(b).splitlines() if l.strip()]
                mark = c(RED, '✗') if b.get('is_error') else c(GREEN, '✓')
                first = short(lines[0], 96) if lines else '(ไม่มีผลลัพธ์)'
                more = c(DIM, f'  (+{len(lines) - 1} บรรทัด)') if len(lines) > 1 else ''
                print(' ' * 10 + f'{mark} {c(DIM, first)}{more}')
            elif kind == 'text' and (b.get('text') or '').strip():
                print(f'{c(DIM, hhmmss(ts))}  {c(CYAN, "agent เขียน:")}')
                for l in clean(b['text']).rstrip().splitlines():
                    print('    ' + l)
            # thinking: ข้าม (เป็นความคิดภายใน ไม่ใช่การกระทำ)


def header(path):
    m = meta(path)
    title = clean(m.get('description') or agent_id(path))
    print(c(YEL, '━' * 72))
    print(c(YEL + ';' + BOLD, f'  {title}') + c(DIM, f'   [{clean(m.get("agentType", "?"))} · {agent_id(path)[:7]}]'))
    print(c(YEL, '━' * 72))


def footer(p, path, note=''):
    dur = ''
    try:
        a = datetime.fromisoformat(p.first.replace('Z', '+00:00'))
        b = datetime.fromisoformat(p.last.replace('Z', '+00:00'))
        s = int((b - a).total_seconds())
        dur = f'{s // 60} นาที {s % 60} วิ · '
    except (AttributeError, ValueError):
        pass
    print(c(YEL, f'━━ {note or "จบงาน"} {hhmmss(p.last)} ({dur}ใช้เครื่องมือ {p.tools} ครั้ง)'))
    stamp = os.path.join(ROOT, '.git', 'code-checker-ok')
    if os.path.exists(stamp):
        with open(stamp, encoding='utf-8', errors='replace') as f:
            last = (f.read().split() or ['-'])[-1]
        print(c(DIM, f'   stamp ล่าสุดใน .git/code-checker-ok: {last[:7]}'))
    print(flush=True)


def play(path, follow):
    """พิมพ์ transcript ทั้งหมด · follow=True ตามต่อจนกว่า agent จะจบงาน"""
    header(path)
    p, pos, buf, idle = Printer(), 0, b'', 0
    while True:
        try:
            with open(path, 'rb') as f:             # อ่านเป็น bytes — chunk อาจขาดกลางตัวอักษรไทย (UTF-8 หลายไบต์)
                f.seek(pos)
                chunk = f.read()
                pos = f.tell()
        except OSError:
            footer(p, path, 'ไฟล์ transcript หายไป')
            return
        buf += chunk
        *lines, buf = buf.split(b'\n')              # บรรทัดสุดท้ายอาจยังเขียนไม่จบ เก็บไว้รอบหน้า
        for ln in lines:
            try:
                p.event(json.loads(ln.decode('utf-8', errors='replace')))
            except (ValueError, AttributeError, TypeError):
                pass
        sys.stdout.flush()
        if not follow:
            break
        idle = 0 if chunk else idle + 1
        if (meta(path).get('finished') or p.handed_back) and idle * POLL_SEC >= 2:
            break
        if idle * POLL_SEC >= STALE_SEC:
            footer(p, path, f'ไม่มีความเคลื่อนไหว {STALE_SEC // 60} นาที — เลิกตามรอบนี้')
            return
        time.sleep(POLL_SEC)
    footer(p, path)


def pick(prefix):
    hits = [r for r in runs() if agent_id(r).startswith(prefix)]
    if not hits:
        sys.exit(f'ไม่เจอรอบที่ id ขึ้นต้นด้วย {prefix} — ดูรายการด้วย --list')
    return hits[-1]


def main():
    args = sys.argv[1:]
    if '--list' in args:
        for r in runs()[-20:]:
            m = meta(r)
            when = datetime.fromtimestamp(mtime(r)).strftime('%d/%m %H:%M')
            state = 'จบ' if is_done(r) else c(GREEN, 'กำลังทำ')
            print(f'{agent_id(r)[:7]}  {when}  {state:>6}  {clean(m.get("description", ""))}')
        return
    if '--id' in args:
        i = args.index('--id') + 1
        if i >= len(args) or args[i].startswith('-'):
            sys.exit('ใส่ id ต่อท้าย --id ด้วย เช่น --id a7b (ดู id ได้จาก --list)')
        path = pick(args[i])
        play(path, follow=not is_done(path))
        return
    if '--last' in args:
        done = [r for r in runs() if is_done(r)]
        if not done:
            sys.exit('ยังไม่มีรอบที่จบแล้ว')
        play(done[-1], follow=False)
        return

    # โหมดดูสด: ตามตัวที่กำลังทำงานอยู่ ไม่มีก็รอตัวถัดไป (วนไปเรื่อยๆ จนกด Ctrl+C)
    seen = {r for r in runs() if is_done(r)}
    print(c(DIM, f'รอ agent เริ่มงานในโปรเจกต์นี้… (Ctrl+C ออก)  · {os.path.join(PROJECTS, SLUG)}'), flush=True)
    while True:
        todo = [r for r in runs() if r not in seen and not is_done(r)]
        if todo:
            path = todo[0]
            seen.add(path)
            play(path, follow=True)
            print(c(DIM, 'รอ agent ตัวถัดไป… (Ctrl+C ออก)'), flush=True)
        time.sleep(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print()
    except BrokenPipeError:                         # เช่น ต่อ | head แล้วปลายท่อปิดก่อน
        sys.stderr.close()
