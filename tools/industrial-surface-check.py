#!/usr/bin/env python3
"""The surface and width delta for Industrial Park Road (road 107 at Point Tupper) on the baked land.

The width delta (tools/industrial-surface/width-hashes.json) chains directly onto the 16 Nov surface delta
(tools/industrial-surface/industrial-hashes.json). It widens road 107 from 1.5 m to 3.6 m half width (two 3.6 m
lanes) and sets pavement='double-yellow'.
The baked land must hold the delta either all before or all after. A mix, or a file that is neither, fails: that is a
half-done install, or a later Point Tupper rebake whose bytes differ. EXPECT below says which state is right.
Road 634 at Mabou was withdrawn on 16 Nov 2026 and is not checked here.
- All before: patch.py --width makes the delta again in a scratch folder, and its hashes must equal the committed list.
  This needs GDAL and the raw road vectors (data/raw); without them it prints NOT REMADE and checks the state only.
- All after: every file hashes as the committed delta, and road 107 has kind 2 (paved), half width 3.6 m and
  pavement='double-yellow'.
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
# Which state the baked land must hold. Set to 'after' so an all-before land fails once the width+paint
# delta is installed on the MacBook (a rebake dropped the correction, or a host holds an older copy).
EXPECT = 'after'
DELTAS = (
    dict(name='pointtupper road 107 width', land=ROOT/'data/baked/areas/pointtupper',
         report=ROOT/'tools/industrial-surface/width-hashes.json',
         prior=ROOT/'tools/industrial-surface/industrial-hashes.json',
         flags=['--width'],
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


def sound(report, prior=None):
    files = report['files']
    assert files and files[0]['file'] == 'roads.json', 'the list must start with roads.json'
    assert len({f['file'] for f in files}) == len(files), 'a file is listed twice'
    assert all(f['before'] != f['sha256'] for f in files), 'a listed file does not change'
    assert report['kindBefore'] == 2 and report['kindAfter'] == 2, 'the width delta runs on surface-corrected kind 2 road 107'
    assert report.get('halfWidthBefore') == 1.5 and report.get('halfWidthAfter') == 3.6, 'the width delta widens road 107 from 1.5 m to 3.6 m'
    assert report['pixels'] > 0, 'the width delta must touch paved road samples'
    if prior is not None:
        prior_after = {f['file']: f['sha256'] for f in prior['files']}
        for f in files:
            if f['file'] in prior_after:
                assert f['before'] == prior_after[f['file']], f'{f["file"]}: width delta before-hash must chain from industrial-hashes.json'


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
    assert road['kind'] == 2 and road['halfWidth'] == 3.6 and road.get('pavement') == 'double-yellow', (
        f'{delta["name"]}: installed road is kind {road["kind"]}, half width {road["halfWidth"]}, pavement {road.get("pavement")!r}')


def main():
    caught = 0
    for delta in DELTAS:
        report = json.loads(delta['report'].read_text())
        prior = json.loads(delta['prior'].read_text()) if delta.get('prior') else None
        sound(report, prior)
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
