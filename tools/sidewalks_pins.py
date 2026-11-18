#!/usr/bin/env python3
"""Write both budget pin files as main's pins plus the proven sidewalk deltas.

Usage after merging main: python3 tools/sidewalks_pins.py "$(git merge-base HEAD origin/main)"
Reads main's pins from that commit (not from the shared clone's moving origin/main ref) and
tools/baseline/sidewalks-count-deltas.json; every pinned row must have a delta row.
"""
import json, re, subprocess, sys

def main(ref):
    deltas = json.load(open('tools/baseline/sidewalks-count-deltas.json'))
    for path in ['tools/baseline/frame-budget.json', 'tools/baseline/frame-budget-traffic.json']:
        text = subprocess.check_output(['git', 'show', f'{ref}:{path}']).decode()
        main_pins, out, done = json.loads(text), [], []
        for line in text.splitlines(True):
            m = re.match(r'(\s*)"([^"]+)":(\{.*?\})(,?)\s*$', line)
            if m and m.group(2) in deltas:
                key, row = m.group(2), json.loads(m.group(3))
                for field, add in deltas[key].items(): row[field] += add
                line = f'{m.group(1)}"{key}":{json.dumps(row, separators=(",", ":"))}{m.group(4)}\n'; done.append(key)
            out.append(line)
        missing = sorted(set(main_pins) - set(done))
        if missing: raise SystemExit(f'{path}: no sidewalk delta for {missing}; measure them with SIDEWALK_COUNT_VIEWS (tools/sidewalks-counts.sh)')
        open(path, 'w').write(''.join(out))
        print(f'{path}: {len(done)} rows = {ref[:8]} pins + sidewalk deltas')

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
