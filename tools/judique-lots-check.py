#!/usr/bin/env python3
"""Judique lots delta (the project brief): maker/installer refusals on a synthetic land, and the content of the real
delta or installed land. No land writes.

python3 tools/judique-lots-check.py                      fixture only
python3 tools/judique-lots-check.py --land [--land-root]  also the real land: before (Point Tupper delta) or after (Judique lots delta), never mixed; pre-1227 passes with a note
python3 tools/judique-lots-check.py --delta FOLDER        also a delta folder: SHA256SUMS, receipt, and what it paints
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'pipeline'))
from paved import stall_area  # noqa: E402
spec = importlib.util.spec_from_file_location('judique_1219', ROOT/'tools/paved-open/judique_lots.py')
judique = importlib.util.module_from_spec(spec); spec.loader.exec_module(judique)
# The main thread's install PR sets 'after'; None accepts the Point Tupper delta land or the Judique lots delta.
EXPECT = 'after'
ORIGIN = (591500, 5136100)


def sha(data): return hashlib.sha256(data).hexdigest()


def refuses(words, call):
    try: call()
    except (ValueError, AssertionError) as e:
        assert words in str(e), (words, str(e)); return
    raise AssertionError('accepted: '+words)


def fixture():
    tmp = Path(tempfile.mkdtemp(prefix='judique-lots-'))
    saved = judique.BEFORE, judique.RECEIPT, judique.CORRECTIONS, judique.PRE_1227
    try:
        data, baked, work = tmp/'data', tmp/'data/baked', tmp/'work'
        area = baked/'areas/judique'; (area/'paved').mkdir(parents=True)
        old_tile, new_tile = bytes(128*128-1)+b'\1', bytes(128*128-2)+b'\2\1'
        (area/'paved/1_2.r8').write_bytes(old_tile)
        old_index = json.dumps(dict(area='judique', source=judique.patch.SOURCE, tiles=['1_2.r8'])).encode()
        (area/'paved/index.json').write_bytes(old_index)
        key = dict(file='paved/index.json', tiles=1, source=judique.patch.SOURCE)
        (area/'manifest.json').write_text(json.dumps(dict(origin=list(ORIGIN), paved=key, props=dict(file='props.json')))+'\n')
        (area/'roads.json').write_text('{"roads":[]}\n')
        dump = lambda d: (json.dumps(d, indent=2, ensure_ascii=False)+'\n').encode()
        # The post-Point Tupper delta corrections file: another area's entry (kept byte for byte) and a Judique one we replace.
        old_corr = dump(dict(version=1, epsg=2961, features=[dict(id='ph-1227-x', area='pointtupper', note='Café'), dict(id='judique-a', area='judique', v=1)]))
        mine = dict(version=1, epsg=2961, features=[dict(id='judique-a', area='judique', v=2), dict(id='judique-b', area='judique')])
        (data/'raw/paved-open').mkdir(parents=True); (data/'raw/paved-open/corrections.json').write_bytes(old_corr)
        before = dict(areas=[dict(area='judique', folder='areas/judique', manifestKey=key, files=[
            dict(file='areas/judique/paved/1_2.r8', bytes=len(old_tile), sha256=sha(old_tile)),
            dict(file='areas/judique/paved/index.json', bytes=len(old_index), sha256=sha(old_index))], inputs=[], omitted=[])],
            mirror=[dict(file=judique.MIRROR, sha256=sha(old_corr))])
        judique.BEFORE = tmp/'hashes.json'; judique.BEFORE.write_text(json.dumps(before))
        judique.CORRECTIONS = tmp/'judique-lots-corrections.json'; judique.CORRECTIONS.write_bytes(dump(mine))
        new_corr = judique.compose(old_corr)
        assert json.loads(new_corr)['features'] == [dict(id='ph-1227-x', area='pointtupper', note='Café'), dict(id='judique-a', area='judique', v=2),
                                                    dict(id='judique-b', area='judique')], 'compose replaces in place and appends'
        assert '"note": "Café"' in new_corr.decode(), 'other entries keep their bytes'
        refuses('re-serialise', lambda: judique.compose(b'{"version":1,"epsg":2961,"features":[]}\n'))
        judique.CORRECTIONS.write_bytes(dump(dict(mine, features=[dict(id='ph-1227-x', area='pointtupper')])))
        refuses('Judique only', lambda: judique.compose(old_corr))
        judique.CORRECTIONS.write_bytes(dump(dict(mine, features=mine['features']+mine['features'][:1])))
        refuses('duplicate Judique lots delta id', lambda: judique.compose(old_corr))
        judique.CORRECTIONS.write_bytes(dump(mine))
        pre_tile = bytes(128*128)
        judique.PRE_1227 = tmp/'hashes-initial.json'
        judique.PRE_1227.write_text(json.dumps(dict(areas=[dict(area='judique', manifestKey=key, files=[
            dict(file='areas/judique/paved/1_2.r8', sha256=sha(pre_tile)), dict(file='areas/judique/paved/index.json', sha256=sha(old_index))])], mirror=[])))
        judique.RECEIPT = tmp/'judique-lots.json'
        # A Judique work bake that read the new corrections and the current roads.
        w = work/'judique'; (w/'paved').mkdir(parents=True)
        (w/'paved/1_2.r8').write_bytes(new_tile); (w/'paved/7_7.r8').write_bytes(new_tile)
        (w/'paved/index.json').write_text(json.dumps(dict(area='judique', source=judique.patch.SOURCE, tiles=['1_2.r8', '7_7.r8'], stalls=[[0, 0, 5.5, 0, 5.5, 2.75]])))
        (w/'promotion.json').write_text(json.dumps([dict(source=str(w/'paved'/n), sha256=sha((w/'paved'/n).read_bytes())) for n in ('1_2.r8', '7_7.r8', 'index.json')]))
        inputs = [dict(path='data/baked/areas/judique/roads.json', role='road-exclusion', sha256=sha((area/'roads.json').read_bytes())),
                  dict(path=judique.MIRROR, role='owner-corrections', sha256=sha(new_corr))]
        (w/'bake.json').write_text(json.dumps(dict(area='judique', lots_m2=8, apron_m2=0, gravel_m2=4, inputs=inputs)))
        report = judique.make(w, baked, tmp/'delta', verify=False, data=data)
        judique.RECEIPT.write_text(json.dumps(report, indent=1)+'\n')
        sums = (tmp/'delta/SHA256SUMS').read_text().splitlines()
        assert len(sums) == 7 and all(sha((tmp/'delta'/line.split('  ', 1)[1]).read_bytes()) == line.split('  ')[0] for line in sums), 'SHA256SUMS'
        refuses('Output must be NEW', lambda: judique.make(w, baked, tmp/'delta', verify=False, data=data))
        refuses('Output must be NEW', lambda: judique.make(w, baked, data/'delta-under-data', verify=False, data=data))
        bad = copy.deepcopy(report); bad['area']['lots_m2'] = 9; badfile = tmp/'bad.json'; badfile.write_text(json.dumps(bad))
        refuses('STALE RECEIPT', lambda: judique.make(w, baked, tmp/'delta-bad', receipt=badfile, data=data))
        judique.CORRECTIONS.write_bytes(dump(dict(mine, features=mine['features'][:1])))
        refuses('did not read', lambda: judique.make(w, baked, tmp/'delta-corr', verify=False, data=data))
        judique.CORRECTIONS.write_bytes(dump(mine))
        (data/'raw/paved-open/corrections.json').write_bytes(dump(dict(version=1, epsg=2961, features=[])))
        refuses('install Point Tupper delta first', lambda: judique.make(w, baked, tmp/'delta-pre', verify=False, data=data))
        (data/'raw/paved-open/corrections.json').write_bytes(old_corr)
        (w/'paved/7_7.r8').write_bytes(bytes(128*128-1)+b'\3')
        refuses('differs from its promotion hash', lambda: judique.make(w, baked, tmp/'delta-3', verify=False, data=data))
        (w/'paved/7_7.r8').write_bytes(new_tile)
        roads = area/'roads.json'; roads.write_text('{"roads":[1]}\n')
        refuses('STALE WORK BAKE', lambda: judique.make(w, baked, tmp/'delta-stale', verify=False, data=data))
        assert judique.state(baked) == 'before'
        refuses('STALE LAND', lambda: judique.install(tmp/'delta', baked))
        roads.write_text('{"roads":[]}\n')
        # Judique still on the land before Point Tupper delta: state says so and install refuses before writing.
        (area/'paved/1_2.r8').write_bytes(pre_tile)
        assert judique.state(baked) == 'pre-1227'
        refuses('install Point Tupper delta first', lambda: judique.install(tmp/'delta', baked))
        assert (area/'paved/1_2.r8').read_bytes() == pre_tile and not (data/'work/paved-before-1219').exists()
        (area/'paved/1_2.r8').write_bytes(old_tile)
        # Install refusals leave the land as it was.
        tampered = tmp/'delta-tampered'; shutil.copytree(tmp/'delta', tampered); (tampered/'areas/judique/paved/7_7.r8').write_bytes(old_tile)
        refuses('Delta file differs', lambda: judique.install(tampered, baked))
        refuses('differs from the committed', lambda: judique.install(tmp/'delta', baked, receipt=badfile))
        (data/'raw/paved-open/corrections.json').write_bytes(b'{"drift":1}\n')
        refuses('neither the post-Point Tupper delta file', lambda: judique.install(tmp/'delta', baked))
        (data/'raw/paved-open/corrections.json').write_bytes(old_corr)
        (area/'paved/extra.r8').write_bytes(old_tile)
        refuses('neither the Point Tupper delta land', lambda: judique.install(tmp/'delta', baked))
        (area/'paved/extra.r8').unlink()
        moved = tmp/'live-paved'; shutil.move(area/'paved', moved); (area/'paved').symlink_to(moved)
        refuses('is a link', lambda: judique.install(tmp/'delta', baked))
        (area/'paved').unlink(); shutil.move(moved, area/'paved')
        assert judique.state(baked) == 'before'
        keep = data/'work/paved-before-1219'; keep.mkdir(parents=True)
        refuses('move it away', lambda: judique.install(tmp/'delta', baked))
        assert not (area/'.paved.new-1219').exists() and judique.state(baked) == 'before', 'a refused install wrote land'
        keep.rmdir()
        linked = tmp/'linked'; linked.mkdir(); (linked/'baked').symlink_to(baked)
        refuses('is a link', lambda: judique.install(tmp/'delta', linked/'baked'))
        manifest_before = json.loads((area/'manifest.json').read_text())
        # A run cut short after both renames (new files, old key) is 'half'; install finishes it.
        shutil.move(area/'paved', keep); shutil.copytree(tmp/'delta/areas/judique/paved', area/'paved')
        assert judique.state(baked) == 'half'
        archived_receipt = judique.ARCHIVED_RECEIPT
        try:
            # A prepared delta can predate the removal of tracker metadata and source notes.
            judique.ARCHIVED_RECEIPT = judique.RECEIPT
            legacy = dict(report, issue=1, replaces=dict(report['replaces'], issue=2))
            report_file = tmp/'delta/hashes.json'
            report_file.write_text(json.dumps(legacy))
            judique.CORRECTIONS.write_bytes(dump(dict(mine, features=[
                dict(feature, source='Clean public description') for feature in mine['features']])))
            judique.install(tmp/'delta', baked)
            report_file.write_text(json.dumps(report))
            judique.CORRECTIONS.write_bytes(dump(mine))
        finally:
            judique.ARCHIVED_RECEIPT = archived_receipt
        assert judique.state(baked) == 'after'
        # A run cut short between the renames (no paved/, the full new folder beside it) also finishes.
        shutil.rmtree(area/'paved'); shutil.move(keep, area/'paved')
        (area/'manifest.json').write_text(json.dumps(dict(manifest_before))+'\n')
        (data/'raw/paved-open/corrections.json').write_bytes(old_corr)
        for p in (data/'raw/paved-open').glob('*.before-1219'): p.unlink()
        assert judique.state(baked) == 'before'
        shutil.move(area/'paved', keep); shutil.copytree(tmp/'delta/areas/judique/paved', area/'.paved.new-1219')
        (area/'.paved.new-1219/7_7.r8').write_bytes(old_tile)   # cut short mid-write: not the delta, so no rename
        refuses('is not the delta', lambda: judique.install(tmp/'delta', baked))
        assert not (area/'paved').exists() and keep.is_dir(), 'a refused recovery moved a folder'
        (area/'.paved.new-1219/7_7.r8').write_bytes(new_tile)
        judique.install(tmp/'delta', baked)
        assert judique.state(baked) == 'after' and not (area/'.paved.new-1219').exists()
        # Back to before, for the plain install below.
        shutil.rmtree(area/'paved'); shutil.move(keep, area/'paved')
        (area/'manifest.json').write_text(json.dumps(dict(manifest_before))+'\n')
        (data/'raw/paved-open/corrections.json').write_bytes(old_corr)
        for p in (data/'raw/paved-open').glob('*.before-1219'): p.unlink()
        assert judique.state(baked) == 'before'
        judique.install(tmp/'delta', baked)
        assert judique.state(baked) == 'after'
        after = json.loads((area/'manifest.json').read_text())
        assert after.pop('paved') == report['area']['manifestKey'] and manifest_before.pop('paved') == key and after == manifest_before, 'only the paved key changes'
        assert sorted(p.name for p in (data/'work/paved-before-1219').iterdir()) == ['1_2.r8', 'index.json'], 'old folder kept'
        assert (data/'raw/paved-open/corrections.json').read_bytes() == new_corr
        assert (data/'raw/paved-open/corrections.json.before-1219').read_bytes() == old_corr
        judique.install(tmp/'delta', baked)   # idempotent
        assert judique.state(baked) == 'after'
        (area/'paved/7_7.r8').write_bytes(old_tile)
        refuses('neither the Point Tupper delta land', lambda: judique.state(baked))
        print('PASS Judique lots delta fixture: maker refusals (existing/data output, receipt, corrections, tile bytes, stale bake); '
              'compose (in place, other entries byte for byte, refuses a non-round-trip file); pre-1227 land refused; install refusals before any write (stale land, tampered delta, foreign receipt, drifted corrections, unknown land, linked folder, '
              'linked baked root, an old backup in the way); install swaps paved/, keeps the old folder, changes only the paved key, '
              'mirrors corrections, finishes a run cut short at either rename, idempotent; mixed land rejected')
    finally:
        judique.BEFORE, judique.RECEIPT, judique.CORRECTIONS, judique.PRE_1227 = saved
        shutil.rmtree(tmp)


def tiles(folder):
    index = json.loads((folder/'index.json').read_text())
    out = {}
    for name in index['tiles']:
        a = np.frombuffer((folder/name).read_bytes(), np.uint8)
        assert a.size == 128*128 and a.max() <= 2, name
        out[tuple(map(int, name[:-3].split('_')))] = a.reshape(128, 128)
    return index, out


def cls(grid, e, n):
    i, j = int((e-ORIGIN[0])//256), int((ORIGIN[1]-n)//256)
    a = grid.get((i, j))
    return 0 if a is None else int(a[int((ORIGIN[1]-n-j*256)//2), int((e-ORIGIN[0]-i*256)//2)])


def facts(folder):
    """What the delta paints, in map metres (EPSG:2961), against the owner's 17 Nov note."""
    index, grid = tiles(folder)
    assert index['classes'] == {'0': 'unknown', '1': 'hard paved', '2': 'gravel lot'}
    corrections = json.loads(judique.CORRECTIONS.read_text())['features']
    rows = [f for f in corrections if f['kind'] == 'stalls' and f['area'] == 'judique' and f.get('enabled', True)]
    assert index['stalls'] == [[float(v) for v in f['geometry']['coordinates'][0]+f['geometry']['coordinates'][1]]+[f['depth'], f['spacing']] for f in rows]
    checks = {'store lot is gravel': ((617110, 5081490), 2), 'mailbox bank stands on the gravel lot': ((617093, 5081495), 2),
              'store forecourt is gravel': ((617121, 5081465), 2), 'community centre lot is asphalt': ((617070, 5081580), 1),
              'music centre lot is asphalt': ((617095, 5081515), 1), 'church lot is asphalt': ((617130, 5081662), 1),
              'church driveway covers its track': ((617104, 5081639), 1), 'Highway 19 keeps its own paint': ((617127, 5081475), 0),
              'Keltic Drive keeps its own paint': ((617090, 5081506), 0)}
    for label, ((e, n), want) in checks.items(): assert cls(grid, e, n) == want, (label, cls(grid, e, n))
    for row in index['stalls']:
        area = stall_area(row); x0, y0, x1, y1 = area.bounds
        from shapely.geometry import Point
        cells = [(e, n) for e in np.arange(x0+1, x1, 2) for n in np.arange(y0+1, y1, 2) if area.contains(Point(e, n))]
        on = sum(cls(grid, e, n) == 1 for e, n in cells)
        assert on >= 0.85*len(cells), ('stall row off its asphalt', row, on, len(cells))
    gravel = sum(int((a == 2).sum()) for a in grid.values())*4
    print(f'PASS Judique lots delta content: {len(index["tiles"])} tiles; store lot and forecourt gravel ({gravel} m2), community centre, music centre '
          f'and church lots asphalt, church driveway over its track, roads keep their paint, {len(index["stalls"])} stall rows on asphalt')


def delta(folder):
    for line in (folder/'SHA256SUMS').read_text().splitlines():
        value, name = line.split('  ', 1)
        assert sha((folder/name).read_bytes()) == value, 'SHA256SUMS: '+name
    report = json.loads((folder/'hashes.json').read_text())
    expected = json.loads(judique.RECEIPT.read_text())
    assert judique.patch.matches_receipt(report, expected), 'delta receipt is not the committed one'
    before, after = (folder/'raw-before'/judique.MIRROR).read_bytes(), (folder/'raw-mirror'/judique.MIRROR).read_bytes()
    assert [sha(before)] == [m['sha256'] for m in judique.before_receipt()['mirror']], 'the delta was not composed on the previous corrections file'
    assert judique.matches_mirror(before, after, expected, judique.RECEIPT), 'delta corrections differ from the receipt'
    kept = [f for f in json.loads(before)['features'] if not f['id'].startswith('judique-')]
    assert kept == [f for f in json.loads(after)['features'] if not f['id'].startswith('judique-')], 'an entry outside Judique changed'
    facts(folder/'areas/judique/paved')


def land(root):
    mode = 'after' if judique.patch.refresh_installed(Path(root)) else judique.state(root)
    if mode == 'pre-1227':
        if EXPECT is not None: raise AssertionError(f'Judique lots delta land is pre-1227, expected {EXPECT}')
        print('NOTE: this land is from before Point Tupper delta; the Judique lots delta installs after it'); return
    if mode == 'half': raise AssertionError('Judique lots delta install is half done (new files, old manifest key): run judique_lots.py install again')
    if EXPECT is not None and mode != EXPECT: raise AssertionError(f'Judique lots delta land is {mode}, expected {EXPECT}')
    if mode == 'after': facts(Path(root)/'areas/judique/paved')
    print(f'PASS Judique paved land is {mode} (Point Tupper delta = before, Judique lots delta = after; pre-1227 = install Point Tupper delta first); EXPECT={EXPECT}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--land', action='store_true'); p.add_argument('--land-root', type=Path, default=ROOT/'data/baked')
    p.add_argument('--delta', type=Path)
    a = p.parse_args()
    fixture()
    if a.delta: delta(a.delta)
    if a.land: land(a.land_root)
