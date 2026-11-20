#!/usr/bin/env python3
"""Rebuild the public changelog from all first-parent origin/main history."""
import argparse
from collections import defaultdict
from datetime import datetime
import html
import json
from pathlib import Path
import re
import subprocess
import sys
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ATLANTIC = ZoneInfo('America/Halifax')
IMPORT_TITLE = 'Initial import of Mabou Mail Madness'
PR = re.compile(r'^(.*?)\s+\(#([1-9]\d*)\)$')
EMAIL = re.compile(r'[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}')
CIVIC = re.compile(
    r'\b\d+[A-Za-z]?(?:[-/]\d+)?\s+(?:[\w\u2019\'-]+\s+){0,6}'
    r'(?:road|rd|street|st|avenue|ave|lane|ln|drive|dr|court|ct|crescent|cres|'
    r'boulevard|blvd|highway|hwy|way|trail|terrace|place|pl)\b|'
    r'\bcivic\s*(?:number|no\.?|#)?\s*\d+', re.IGNORECASE)
PRIVATE_PATH = re.compile(r'(?:/(?:Users|home|Volumes|private|tmp)/|~/|[A-Za-z]:[\\/])')


def safe_line(line):
    if (not line or any(ord(c) < 32 for c in line) or EMAIL.search(line)
            or CIVIC.search(line) or PRIVATE_PATH.search(line)):
        # Never echo the offending text into a publish log.
        raise ValueError('refusing unsafe changelog line; hide or rewrite its PR note')
    return line


def read_history():
    def git(*args):
        result = subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True)
        if result.returncode:
            raise ValueError('complete origin/main history is required; fetch it before rebuilding')
        return result.stdout
    if git('rev-parse', '--is-shallow-repository').strip() != 'false':
        headers = git('cat-file', 'commit', 'origin/main').split('\n\n', 1)[0].splitlines()
        if any(line.startswith('parent ') for line in headers):
            raise ValueError('shallow history refused; fetch the complete origin/main history')
    fields = git('log', '--first-parent', '--format=%cI%x00%s%x00', 'origin/main').split('\0')
    history = [{'date': fields[i].strip(), 'title': fields[i + 1]}
               for i in range(0, len(fields) - 1, 2)]
    if history and history[-1]['title'] == IMPORT_TITLE:
        history[-1:] = json.loads((ROOT / 'tools/baseline/changelog.json').read_text())
    return history


def entries(history, notes, players=False):
    if not isinstance(notes, dict) or any(
        not re.fullmatch(r'[1-9]\d*', key) or (value is not None and not isinstance(value, str)
        and not (isinstance(value, dict) and set(value) == {'player'} and isinstance(value['player'], str)))
        for key, value in notes.items()
    ):
        raise ValueError('notes must map PR numbers to text, a player note, or null')
    groups = defaultdict(list)
    for commit in history:
        title = commit['title']
        match = PR.fullmatch(title)
        number = match[2] if match else None
        note = notes.get(number)
        if players and number not in notes:
            continue
        if isinstance(note, dict):
            safe_line(note['player'])
            line = note['player'] if players else match[1] if match else title
        else:
            line = notes.get(number, match[1] if match else title)
        if line is None:
            continue
        safe_line(line)
        date = datetime.fromisoformat(commit['date'])
        if date.tzinfo is None:
            raise ValueError('history dates must include a timezone')
        groups[date.astimezone(ATLANTIC).date().isoformat()].append((line, number))
    return [(day, groups[day]) for day in sorted(groups, reverse=True)]


def markdown(groups):
    lines = ['# Changelog', '', 'Changes on main, by Atlantic day. Rebuild with `python3 tools/changelog.py`.', '']
    for day, changes in groups:
        lines += [f'## {day}', '']
        for line, number in changes:
            escaped = re.sub(r'([\\`*_{}\[\]()#+.!<>|])', r'\\\1', line)
            suffix = f' (#{number})' if number else ''
            lines.append(f'- {escaped}{suffix}')
        lines.append('')
    return '\n'.join(lines)


def page(groups):
    sections = []
    for day, changes in groups:
        items = ''.join(f'<li>{html.escape(line)}' + (f' <small>#{number}</small>' if number else '')
                        + '</li>\n' for line, number in changes)
        date = datetime.strptime(day, "%Y-%m-%d")
        display_day = f"{date.day} {date.strftime('%B %Y')}"
        sections.append(f'<section><h2><time datetime="{day}">{display_day}</time></h2><ul>{items}</ul></section>')
    return '''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#0b1620">
<title>What's new</title>
<style>html{color-scheme:dark;background:#0b1620;color:#eef2f6;font:17px/1.6 system-ui,sans-serif}
body{max-width:48rem;margin:auto;padding:24px max(20px,env(safe-area-inset-right)) 48px max(20px,env(safe-area-inset-left))}
a{color:#b8dfcf}a:focus-visible{outline:3px solid white;outline-offset:4px}
h1{font:600 clamp(40px,7vw,64px)/1.08 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;letter-spacing:-.01em}.overline{font:700 13px/1.4 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#b8dfcf}h2{font:600 1.4rem/1.3 "Iowan Old Style",Palatino,Georgia,serif;margin-top:2rem}li{margin:.65rem 0;overflow-wrap:anywhere}
.topNav{font-size:13px;margin-bottom:24px}.topNav a{display:inline-flex;align-items:center;min-height:44px}small{color:#b9c3cc;font-size:12px}ul{padding-left:1.3rem}section{border-top:1px solid #34434e}footer{margin-top:40px;padding-top:16px;border-top:1px solid #34434e}footer nav{display:flex;flex-direction:column}footer a{display:flex;align-items:center;min-height:44px}</style>
</head><body><nav class="topNav" aria-label="Back"><a href="/">Back to the game</a> · <a href="/about">About</a></nav><main><p class="overline">From the roads of Cape Breton</p><h1>What's new</h1><p>Changes to the game, newest first. Dates use Atlantic time.</p>
''' + '\n'.join(sections) + '\n</main><footer><nav aria-label="More"><a href="/">Back to the game</a><a href="/about">About</a><a href="/help">Help and controls</a><a href="/listen/">Just Listen</a></nav></footer></body></html>\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fail without writing if output is stale')
    parser.add_argument('--fixture', type=Path, help='use JSON history instead of git, for isolated tests')
    parser.add_argument('--notes', type=Path, default=ROOT / 'tools/changelog-notes.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'CHANGELOG.md')
    parser.add_argument('--html', type=Path, help='also write the static page at this path')
    args = parser.parse_args()
    try:
        history = json.loads(args.fixture.read_text()) if args.fixture else read_history()
        notes = json.loads(args.notes.read_text())
        groups = entries(history, notes)
        outputs = [(args.output, markdown(groups))]
        if args.html:
            outputs.append((args.html, page(entries(history, notes, players=True))))
        # Render and validate everything before touching either destination.
        for path, content in outputs:
            encoded = content.encode('utf-8')
            if args.check:
                if not path.is_file() or path.read_bytes() != encoded:
                    raise ValueError('changelog output is stale; run python3 tools/changelog.py')
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(encoded)
    except (ValueError, OSError, KeyError, TypeError) as error:
        # JSON and OS exceptions can include private input or paths.
        message = str(error) if type(error) is ValueError else 'invalid changelog input or unavailable output'
        print(f'changelog: {message}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
