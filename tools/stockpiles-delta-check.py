#!/usr/bin/env python3
"""The Point Tupper stockpile pack of the project brief: the committed pack, and its state on the baked land.

The pack (tools/stockpiles-delta/stockpiles.json) is committed with its SHA-256 (hashes.json), so every host can draw
and check it before the main thread installs it. The install is two things in data/baked/areas/pointtupper: the file
stockpiles.json, and the manifest key "stockpiles": {"file": "stockpiles.json", "count": 2}.
- Committed pack: its bytes must hash as hashes.json says.
- Land state: before (no key and no file) or after (the exact key, and the file hashes as the committed pack). A key
  without the file, a file without the key, other bytes or another key value is a mix and fails. The manifest is a
  shared file, so the state reads the key, never a hash of the whole manifest.
- EXPECT below is 'after' (installed into live data/baked/areas/pointtupper). An all-before land fails: a host with
  a land copied before the install, or a Point Tupper rebake (stage 21 writes a new manifest without the key).
- Remake: where GDAL and data/raw exist, pipeline/33_bake_stockpiles.py bakes the pack again in a scratch folder
  and its bytes must equal the committed pack. Elsewhere it prints NOT REMADE.
- A host without a Point Tupper land (a clean clone) prints NO LAND and checks the committed pack only.
Mutants: key without file, file without key, other pack bytes, another key value, and an all-before land while
EXPECT is 'after' must fail.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT/'tools/stockpiles-delta'
LAND = ROOT/'data/baked/areas/pointtupper'
RAW = ROOT/'data/raw/areas/pointtupper'
RAW_INPUTS = ('vectors/BASE_NSTDB_10k_Designated_Areas_WM84__01_designated_area_polygons.geojson',
              'vectors/BASE_NSTDB_10k_Buildings_WM84__04_building_polygons.geojson',
              'elevation/land-dtm-1m-epsg3979.vrt', 'elevation/land-dsm-1m-epsg3979.vrt')
KEY = dict(file='stockpiles.json', count=2)
# Which state the baked land must hold: 'after' (installed in data/baked/areas/pointtupper).
EXPECT = 'after'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def state(key, pack_sha, recorded_sha):
    """'before', 'after' or 'mixed: <reason>'. `key` is the manifest's stockpiles value (None when absent)."""
    if key is None and pack_sha is None:
        return 'before'
    if key == KEY and pack_sha == recorded_sha:
        return 'after'
    reasons = []
    if key is None: reasons.append('stockpiles.json is there but the manifest has no stockpiles key')
    elif key != KEY: reasons.append(f'the manifest key is {json.dumps(key)}, not {json.dumps(KEY)}')
    if pack_sha is None: reasons.append('the manifest has the key but stockpiles.json is missing')
    elif pack_sha != recorded_sha: reasons.append('stockpiles.json is not the committed pack')
    return 'mixed: ' + '; '.join(reasons)


def verdict(now, expect):
    """None when the state is acceptable, else the reason it fails."""
    if now.startswith('mixed'):
        return f'the baked land is {now}; install the file and the key together (tools/stockpiles-delta/README.md)'
    if expect and now != expect:
        return (f'the baked land is all {now}, but the pack is recorded as installed (EXPECT = {expect!r}); this land '
                'is older than the install, or a Point Tupper rebake dropped the key: see tools/stockpiles-delta/README.md')
    return None


def mutants(recorded_sha):
    cases = {
        'key without the file': (KEY, None),
        'file without the key': (None, recorded_sha),
        'other pack bytes': (KEY, '0' * 64),
        'another key value': (dict(file='stockpiles.json', count=3), recorded_sha),
    }
    assert state(None, None, recorded_sha) == 'before' and state(dict(KEY), recorded_sha, recorded_sha) == 'after', 'clean states not recognised'
    for label, (key, pack_sha) in cases.items():
        assert verdict(state(key, pack_sha, recorded_sha), EXPECT), f'mutant not caught: {label}'
    assert EXPECT == 'after' and verdict('before', EXPECT) and not verdict('after', EXPECT), 'EXPECT not applied'
    assert not verdict('before', None) and not verdict('after', None), 'clean states rejected'
    return len(cases) + 1


def remake(pack):
    try:
        import osgeo  # noqa: F401
    except ImportError:
        print('NOT REMADE: GDAL (osgeo) is missing; the committed pack and the land state were still checked')
        return
    missing = [name for name in RAW_INPUTS if not (RAW/name).is_file()]
    if missing or not (LAND/'roads.json').is_file():
        print(f'NOT REMADE: no raw Point Tupper inputs on this host ({(missing or ["baked roads.json"])[0]}); '
              'the committed pack and the land state were still checked')
        return
    with tempfile.TemporaryDirectory(dir=os.environ.get('OUT') or None) as folder:
        out = Path(folder)/'pack'
        run = subprocess.run([sys.executable, str(ROOT/'pipeline/33_bake_stockpiles.py'), str(ROOT/'data'), str(out)],
                             capture_output=True, text=True)
        assert run.returncode == 0, f'the bake failed: {run.stderr.strip()[-600:]}'
        made = (out/'stockpiles.json').read_bytes()
        assert made == pack, (f'the bake made other bytes (sha256 {sha(made)}) than the committed pack; a bake input '
                              'changed: review the new pack, then commit it with its hashes.json')
    print('remade: pipeline/33_bake_stockpiles.py wrote the committed pack again, byte for byte')


def main():
    recorded = json.loads((HERE/'hashes.json').read_text())
    pack = (HERE/'stockpiles.json').read_bytes()
    assert sha(pack) == recorded['pack']['sha256'] and len(pack) == recorded['pack']['bytes'], \
        'tools/stockpiles-delta/stockpiles.json does not hash as hashes.json says'
    data = json.loads(pack)
    assert recorded['key'] == KEY and len(data['piles']) == KEY['count'], 'the key count is not the number of piles'
    assert [dict(id=p['id'], kind=p['kind']) for p in data['piles']] == recorded['piles'], 'the pile list differs from hashes.json'
    caught = mutants(recorded['pack']['sha256'])
    print(f'committed pack: {len(pack)} bytes, sha256 {sha(pack)}; {caught} state mutants caught')
    if (LAND/'manifest.json').is_file():
        key = json.loads((LAND/'manifest.json').read_text()).get('stockpiles')
        installed = (LAND/'stockpiles.json').read_bytes() if (LAND/'stockpiles.json').is_file() else None
        now = state(key, installed and sha(installed), recorded['pack']['sha256'])
        why = verdict(now, EXPECT)
        assert not why, why
        print(f'land state: {now} (EXPECT = {EXPECT!r})')
    elif LAND.exists():
        raise AssertionError('Point Tupper land folder exists without manifest.json (orphaned or incomplete land)')
    else:
        print('NO LAND: no baked Point Tupper land on this host; the land state was not checked')
    remake(pack)
    print('PASS stockpiles-delta')


if __name__ == '__main__':
    try:
        main()
    except AssertionError as error:
        print(f'FAIL stockpiles-delta: {error}')
        sys.exit(1)
