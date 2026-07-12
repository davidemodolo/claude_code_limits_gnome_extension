#!/usr/bin/env python3
"""Claude Code statusline command.

Prints a short status line and mirrors the rate-limit data Claude Code
pipes in to ~/.claude/usage-cache.json, where the claude-limits GNOME
extension picks it up without hitting the (rate-limited) usage API.

Install: copy next to your settings and reference it in
~/.claude/settings.json:
    "statusLine": {"type": "command", "command": "/home/USER/.claude/statusline-usage.py"}
"""
import json
import os
import sys
import time


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    rl = data.get('rate_limits') or {}
    if rl:
        path = os.path.expanduser('~/.claude/usage-cache.json')
        tmp = path + '.tmp'
        try:
            with open(tmp, 'w') as f:
                json.dump({'cached_at': time.time(), 'rate_limits': rl}, f)
            os.replace(tmp, path)  # atomic: the extension never sees a partial file
        except OSError:
            pass

    def pct(key):
        w = rl.get(key) or {}
        v = w.get('used_percentage', w.get('utilization'))
        return f'{round(v)}%' if v is not None else '?'

    ctx = ''
    cw = data.get('context_window') or {}
    if cw.get('used_percentage') is not None:
        ctx = f' · ctx {round(cw["used_percentage"])}%'

    model = (data.get('model') or {}).get('display_name') or 'Claude'
    print(f'{model}{ctx} · 5h {pct("five_hour")} · 7d {pct("seven_day")}')


if __name__ == '__main__':
    main()
