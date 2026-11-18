#!/usr/bin/env python3
"""The surface delta of the project brief (Industrial Park Road, road 107 at Point Tupper) on the baked land.

The delta lists every file it changes with the SHA-256 before and after (tools/industrial-surface/industrial-hashes.json).
The baked land must hold it either all before or all after. A mix, or a file that is neither, fails: that is a
half-done install, or a later Point Tupper rebake whose bytes differ. A rebake from unchanged inputs writes the
recorded "before" bytes again, so the state alone cannot tell "not installed yet" from "installed, then rebaked
away": EXPECT below says which state is right. It is None (either) until the install; the install PR sets it to
'after', and from then on an all-before land fails.
Road 634 at Mabou was withdrawn on 16 Nov 2026 and is not checked here.
- All before: patch.py makes the delta again in a scratch folder, and its hashes must equal the committed list.
  This needs GDAL and the raw road vectors (data/raw); without them it prints NOT REMADE and checks the state only.
- All after: every file hashes as the committed delta, and road 107 has kind 2 (paved) and half width 1.5 m.
Mutants: one file changed, one file reverted after an install, a missing file, roads.json alone, and an all-before
land while EXPECT is 'after' must fail.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
# Which state the baked land must hold. The delta was installed on the MacBook on 16 Nov 2026, so it is 'after':
# an all-before land now fails (a rebake dropped the correction, or a host holds a land copied before the install).
EXPECT = 'after'
DELTAS = (
    dict(name='pointtupper road 107', land=ROOT/'data/baked/areas/pointtupper',
         report=ROOT/'tools/industrial-surface/industrial-hashes.json', flags=['--industrial'],
         # patch.py imports the pipeline, which reads the raw road vectors; rented hosts get only data/baked.
         vectors=ROOT/'data/raw/areas/pointtupper/vectors/BASE_NSTDB_10k_Roads_WM84__05_bridges.geojson'),
)


def sha(path):
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


def state(hashes, files):
    """'before', 'after', or 'mixed: <reasons>' for one delta. `hashes` maps each listed file to its hash now."""
    seen = {}
    for f in files:
        h = hashes.get(f['file'])
        seen[f['file']] = 'before' if h == f['before'] else 'after' if h == f['sha256'] else 'missing' if h is None else 'other'
    kinds = set(seen.values())
    if kinds == {'before'} or kinds == {'after'}:
        return kinds.pop()
    counts = {k: sum(v == k for v in seen.values()) for k in sorted(kinds)}
    odd = [name for name, k in seen.items() if k in ('missing', 'other')][:5]
    return 'mixed: ' + ', '.join(f'{n} {k}' for k, n in counts.items()) + (f' (first odd files: {", ".join(odd)})' if odd else '')


def verdict(now, expect):
    """None when the state is acceptable, else the reason it fails."""
    if now.startswith('mixed'):
        return f'the baked land is {now}; install all of the delta or none (after a Point Tupper rebake, see tools/industrial-surface/README.md)'
    if expect and now != expect:
        return (f'the baked land is all {now}, but the delta is recorded as installed (EXPECT = {expect!r}); '
                'a Point Tupper rebake probably dropped it: see tools/industrial-surface/README.md')
    return None


def sound(report):
    files = report['files']
    assert files and files[0]['file'] == 'roads.json', 'the list must start with roads.json'
    assert len({f['file'] for f in files}) == len(files), 'a file is listed twice'
    assert all(f['before'] != f['sha256'] for f in files), 'a listed file does not change'
    assert report['kindBefore'] == 4 and report['kindAfter'] == 2, 'the delta must turn a track (4) into a paved road (2)'
    assert report['pixels'] == sum(f.get('pixels', 0) for f in files), 'the pixel total does not add up'


def mutants(report):
    files = report['files']
    before = {f['file']: f['before'] for f in files}
    after = {f['file']: f['sha256'] for f in files}
    last = files[-1]['file']
    cases = {
        'one field changed by something else': {**before, last: '0' * 64},
        'one file reverted after an install': {**after, last: before[last]},
        'a listed file missing': {k: v for k, v in before.items() if k != last},
        'roads.json installed alone': {**before, 'roads.json': after['roads.json']},
    }
    assert state(before, files) == 'before' and state(after, files) == 'after', 'clean states not recognised'
    for label, hashes in cases.items():
        assert verdict(state(hashes, files), None), f'mutant not caught: {label}'
    assert verdict(state(before, files), 'after') and not verdict(state(after, files), 'after'), 'EXPECT not applied'
    assert not verdict(state(before, files), None) and not verdict(state(after, files), None), 'clean states rejected'
    return len(cases) + 1


def remake(delta, report):
    try:
        import osgeo  # noqa: F401
    except ImportError:
        print(f'{delta["name"]}: NOT REMADE, GDAL (osgeo) is missing; the before/after state check above still ran')
        return
    if not delta['vectors'].is_file():
        print(f'{delta["name"]}: NOT REMADE, no raw vectors on this host ({delta["vectors"].relative_to(ROOT)});'
              ' the before/after state check above still ran')
        return
    scratch = os.environ.get('OUT') or None
    with tempfile.TemporaryDirectory(dir=scratch) as folder:
        out = Path(folder)/'delta'
        run = subprocess.run([sys.executable, str(ROOT/'tools/industrial-surface/patch.py'), *delta['flags'], str(delta['land']), str(out)],
                             capture_output=True, text=True)
        assert run.returncode == 0, f'{delta["name"]}: patch.py failed: {run.stderr.strip()[-600:]}'
        made = json.loads((out/'hashes.json').read_text())
        assert made == report, f'{delta["name"]}: patch.py made a delta that differs from {delta["report"].name}'
        listed = sorted(str(p.relative_to(out)) for p in out.rglob('*') if p.is_file() and p.name != 'hashes.json')
        assert listed == sorted(f['file'] for f in report['files']), f'{delta["name"]}: patch.py wrote unlisted files'
        assert state({f: sha(out/f) for f in listed}, report['files']) == 'after', f'{delta["name"]}: made files do not hash as listed'
    print(f'{delta["name"]}: patch.py remade all {len(listed)} files with the listed hashes')


def installed(delta, report):
    roads = {r['id']: r for r in json.loads((delta['land']/'roads.json').read_bytes())['roads']}
    road = roads[report['road']]
    assert road['kind'] == 2 and road['halfWidth'] == 1.5, f'{delta["name"]}: installed road is kind {road["kind"]}, half width {road["halfWidth"]}'


def main():
    caught = 0
    for delta in DELTAS:
        report = json.loads(delta['report'].read_text())
        sound(report)
        caught += mutants(report)
        now = state({f['file']: sha(delta['land']/f['file']) for f in report['files']}, report['files'])
        problem = verdict(now, EXPECT)
        assert not problem, f'{delta["name"]}: {problem}'
        if now == 'before':
            remake(delta, report)
        else:
            installed(delta, report)
        print(f'{delta["name"]}: {len(report["files"])} files, all {now}')
    print(f'industrial-surface: {caught} mutants caught')
    return 0


if __name__ == '__main__':
    sys.exit(main())
