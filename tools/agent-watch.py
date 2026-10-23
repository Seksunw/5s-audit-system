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
import glob, json, os, re, subprocess, sys, time
from datetime import datetime, timezone

ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True).stdout.strip() or os.getcwd()
PROJECTS = os.path.expanduser('~/.claude/projects')
SLUG = re.sub(r'[^A-Za-z0-9-]', '-', ROOT)

COLOR = sys.stdout.isatty() and not os.environ.get('NO_COLOR')
def c(code, s): return f'\033[{code}m{s}\033[0m' if COLOR else s
DIM, BOLD, RED, GREEN, YEL, CYAN = '2', '1', '31', '32', '33', '36'


def runs():
    """transcript ของ agent ทุกตัวในโปรเจกต์นี้ เรียงเก่า → ใหม่"""
    files = glob.glob(os.path.join(PROJECTS, SLUG, '*', 'subagents', 'agent-*.jsonl'))
    return sorted(files, key=os.path.getmtime)


def meta(path):
    try:
        with open(path[:-len('.jsonl')] + '.meta.json', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def agent_id(path):
    return os.path.basename(path)[len('agent-'):-len('.jsonl')]


def hhmmss(ts):
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone().strftime('%H:%M:%S')
    except (AttributeError, ValueError):
        return '--:--:--'


def short(s, n=110):
    s = ' '.join(str(s).split())
    return s if len(s) <= n else s[:n - 1] + '…'


def rel(p):
    p = str(p or '')
    return p[len(ROOT) + 1:] if p.startswith(ROOT + '/') else p


def describe_tool(name, inp):
    """ทำให้การเรียกเครื่องมือหนึ่งครั้งอ่านเป็นภาษาคน"""
    if name == 'Bash':
        cmd = (inp.get('command') or '').strip().splitlines()
        head = inp.get('description') or ''
        line = f'{c(BOLD, "รัน")}   {head}'
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
        return f'{c(BOLD, "หาไฟล์")} {inp.get("pattern", "")}'
    if name in ('Edit', 'Write', 'NotebookEdit'):
        return c(RED, f'แก้ไฟล์ {rel(inp.get("file_path"))}  ← agent ตรวจโค้ดไม่ควรแก้ไฟล์')
    if name == 'SubagentHandback':                  # รายงานฉบับเต็มที่ agent ส่งกลับให้ Claude หลัก
        return c(CYAN, 'ส่งรายงาน:') + '\n' + '\n'.join('    ' + l for l in str(inp.get('message', '')).splitlines())
    if name.endswith('execute_sql'):
        return f'{c(BOLD, "SQL")}   ' + c(DIM, short(inp.get('query', ''), 100))
    return f'{c(BOLD, name)} ' + c(DIM, short(json.dumps(inp, ensure_ascii=False), 90))


def result_text(block):
    content = block.get('content')
    if isinstance(content, list):
        content = '\n'.join(b.get('text', '') for b in content if isinstance(b, dict))
    return str(content or '')


class Printer:
    def __init__(self):
        self.tools = 0
        self.first = self.last = None

    def event(self, o):
        t = o.get('type')
        if t not in ('assistant', 'user'):
            return
        ts = o.get('timestamp')
        self.first = self.first or ts
        self.last = ts or self.last
        content = (o.get('message') or {}).get('content')
        if isinstance(content, str):
            return                                  # คำสั่งตั้งต้นจากผู้เรียก — โชว์ในหัวแล้ว
        for b in content or []:
            kind = b.get('type')
            if kind == 'tool_use':
                self.tools += 1
                print(f'{c(DIM, hhmmss(ts))}  {describe_tool(b.get("name", ""), b.get("input") or {})}')
            elif kind == 'tool_result':
                text = result_text(b)
                lines = [l for l in text.splitlines() if l.strip()]
                mark = c(RED, '✗') if b.get('is_error') else c(GREEN, '✓')
                first = short(lines[0], 96) if lines else '(ไม่มีผลลัพธ์)'
                more = c(DIM, f'  (+{len(lines) - 1} บรรทัด)') if len(lines) > 1 else ''
                print(' ' * 10 + f'{mark} {c(DIM, first)}{more}')
            elif kind == 'text' and b.get('text', '').strip():
                print(f'{c(DIM, hhmmss(ts))}  {c(CYAN, "agent เขียน:")}')
                for l in b['text'].rstrip().splitlines():
                    print('    ' + l)
            # thinking: ข้าม (เป็นความคิดภายใน ไม่ใช่การกระทำ)


def header(path):
    m = meta(path)
    title = m.get('description') or agent_id(path)
    print(c(YEL, '━' * 72))
    print(c(YEL + ';' + BOLD, f'  {title}') + c(DIM, f'   [{m.get("agentType", "?")} · {agent_id(path)[:7]}]'))
    print(c(YEL, '━' * 72))


def footer(p, path):
    dur = ''
    try:
        a = datetime.fromisoformat(p.first.replace('Z', '+00:00'))
        b = datetime.fromisoformat(p.last.replace('Z', '+00:00'))
        s = int((b - a).total_seconds())
        dur = f'{s // 60} นาที {s % 60} วิ · '
    except (AttributeError, ValueError):
        pass
    print(c(YEL, f'━━ จบงาน {hhmmss(p.last)} ({dur}ใช้เครื่องมือ {p.tools} ครั้ง)'))
    stamp = os.path.join(ROOT, '.git', 'code-checker-ok')
    if os.path.exists(stamp):
        with open(stamp, encoding='utf-8') as f:
            last = (f.read().split() or ['-'])[-1]
        print(c(DIM, f'   stamp ล่าสุดใน .git/code-checker-ok: {last[:7]}'))
    print()


def play(path, follow):
    """พิมพ์ transcript ทั้งหมด · follow=True ตามต่อจนกว่า agent จะจบงาน"""
    header(path)
    p, pos, buf, idle = Printer(), 0, '', 0
    while True:
        with open(path, encoding='utf-8', errors='replace') as f:
            f.seek(pos)
            chunk = f.read()
            pos = f.tell()
        buf += chunk
        *lines, buf = buf.split('\n')               # บรรทัดสุดท้ายอาจยังเขียนไม่จบ เก็บไว้รอบหน้า
        for ln in lines:
            try:
                p.event(json.loads(ln))
            except ValueError:
                pass
        sys.stdout.flush()
        if not follow:
            break
        idle = 0 if chunk else idle + 1
        if meta(path).get('finished') and idle >= 4:
            break
        time.sleep(0.5)
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
            when = datetime.fromtimestamp(os.path.getmtime(r)).strftime('%d/%m %H:%M')
            state = 'จบ' if m.get('finished') else c(GREEN, 'กำลังทำ')
            print(f'{agent_id(r)[:7]}  {when}  {state:>6}  {m.get("description", "")}')
        return
    if '--id' in args:
        path = pick(args[args.index('--id') + 1])
        play(path, follow=not meta(path).get('finished'))
        return
    if '--last' in args:
        done = [r for r in runs() if meta(r).get('finished')]
        if not done:
            sys.exit('ยังไม่มีรอบที่จบแล้ว')
        play(done[-1], follow=False)
        return

    # โหมดดูสด: ตามตัวที่กำลังทำงานอยู่ ไม่มีก็รอตัวถัดไป (วนไปเรื่อยๆ จนกด Ctrl+C)
    seen = {r for r in runs() if meta(r).get('finished')}
    print(c(DIM, f'รอ agent เริ่มงานในโปรเจกต์นี้… (Ctrl+C ออก)  · {os.path.join(PROJECTS, SLUG)}'), flush=True)
    while True:
        todo = [r for r in runs() if r not in seen]
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
