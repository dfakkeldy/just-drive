#!/usr/bin/env python3
"""Open pavement land receipt (initial paving delta): all-before or all-after, never mixed. No land writes.

Default: fixture tests of the maker, the install step and the state rules in a scratch folder.
--land: also read the real data/baked (or --land-root) and report its state.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
# The main thread's install PR sets 'after'. None accepts before OR after while the delta is not installed.
EXPECT = 'after'
# Mabou village delta (Mabou main street: lots, mailbox bank, buildings) replaces the receipt. Until the main thread installs that
# delta, the land of the receipt it replaces (Point Tupper delta, with Judique lots delta's Judique lots) still passes; the install PR sets False.
PREVIOUS = ROOT/'tools/paved-open/hashes-point-tupper.json'
ACCEPT_PREVIOUS = False
spec = importlib.util.spec_from_file_location('paved_patch', ROOT/'tools/paved-open/patch.py')
patch = importlib.util.module_from_spec(spec); spec.loader.exec_module(patch)
spec = importlib.util.spec_from_file_location('judique_1219', ROOT/'tools/paved-open/judique_lots.py')
judique = importlib.util.module_from_spec(spec); spec.loader.exec_module(judique)
# the project brief replaces Judique's paved files and the corrections mirror. None accepts the Point Tupper delta Judique land or
# the Judique lots delta delta; the main thread's install PR sets 'after'.
EXPECT_1219 = 'after'


def sha(data): return hashlib.sha256(data).hexdigest()


def state(baked, receipt):
    """'before' when no area has paved files or a paved key; 'after' when all match the receipt."""
    baked = Path(baked); seen = set()
    for area in receipt['areas']:
        manifest = json.loads((baked/area['folder']/'manifest.json').read_bytes())
        key = manifest.get('paved')
        names = {f['file']: f['sha256'] for f in area['files']}
        folder = baked/area['folder']/'paved'
        present = {p.relative_to(baked).as_posix() for p in folder.iterdir()} if folder.exists() else set()
        if key is None and not present:
            seen.add('before'); continue
        if key != area['manifestKey']: raise AssertionError(f'unknown manifest paved key in {area["area"]}')
        if present != set(names): raise AssertionError(f'unknown or missing paved files in {area["area"]}')
        for name, value in names.items():
            if sha((baked/name).read_bytes()) != value: raise AssertionError(f'unknown paved file bytes {name}')
        seen.add('after')
    if len(seen) != 1: raise AssertionError('mixed paved land: some areas before, some after')
    return seen.pop()


def verdict(baked, receipt):
    """State plus freshness. Installed tiles over changed roads/roofs/trees, or a drifted corrections file, fail;
    before the install they only warn, so an unrelated land change never turns this row red."""
    mode = state(baked, receipt)
    stale = patch.stale_inputs(receipt, baked)
    raw = Path(baked).parent
    drift = [m['file'] for m in receipt['mirror'] if not (raw/m['file'][len('data/'):]).is_file() or sha((raw/m['file'][len('data/'):]).read_bytes()) != m['sha256']]
    if mode == 'after' and stale: raise AssertionError('installed paved tiles are STALE against: '+', '.join(stale[:8]))
    if mode == 'after' and drift: raise AssertionError('corrections file differs from the installed receipt: '+', '.join(drift))
    return mode, stale, drift


def expectation(mode, expected):
    assert expected in (None, 'before', 'after')
    if expected is not None and mode != expected: raise AssertionError(f'land is {mode}, expected {expected}')


def fixture():
    """Two synthetic areas through the real maker and installer."""
    road = 'terrain/roads.json'
    original = dict(file=road, before='original', sha256='corrected')
    repaired = dict(file=road, sha256='repaired')
    later = dict(files=[original], roadBed=dict(files=[repaired]))
    assert patch.before_file(road, 'repaired', [later]) == 'original'
    assert patch.before_file(road, 'unknown', [later]) == 'unknown'
    created = dict(files=[dict(file=road, before=None, sha256='added')])
    assert patch.before_file(road, 'added', [created]) is None

    tmp = Path(tempfile.mkdtemp(prefix='paved-land-'))
    try:
        baked, work = tmp/'data/baked', tmp/'work'
        tile = bytes([0]*(128*128-3)+[1, 1, 1])
        correction = b'{"version":1,"epsg":2961,"features":[]}\n'
        (tmp/'data/raw/paved-open').mkdir(parents=True); (tmp/'data/raw/paved-open/corrections.json').write_bytes(correction)
        for area in ('mabou', 'judique'):
            f = baked/patch.folder(area); f.mkdir(parents=True)
            (f/'manifest.json').write_text(json.dumps(dict(crs='EPSG:2961', cemeteries=dict(file='cemeteries.json', count=1)), separators=(',', ':'))+'\n')
            (f/'roads.json').write_text('{"roads":[]}\n')
            w = work/area/'paved'; w.mkdir(parents=True)
            (w/'1_2.r8').write_bytes(tile)
            (w/'index.json').write_text(json.dumps(dict(area=area, source=patch.SOURCE, tiles=['1_2.r8']))+'\n')
            (work/area/'promotion.json').write_text(json.dumps([dict(source=str(w/n), sha256=sha((w/n).read_bytes())) for n in ('1_2.r8', 'index.json')]))
            rel = 'data/baked/'+patch.folder(area).as_posix()
            (work/area/'bake.json').write_text(json.dumps(dict(area=area, lots_m2=12, apron_m2=0, lot_eligibility=[dict(id=f'{area}-3', drop=True), dict(id=f'{area}-4', drop=False)],
                inputs=[dict(path=rel+'/manifest.json', role='terrain-lattice', sha256=sha((f/'manifest.json').read_bytes())), dict(path=rel+'/roads.json', role='road-exclusion', sha256=sha((f/'roads.json').read_bytes())),
                        dict(path='data/raw/paved-open/corrections.json', role='owner-corrections', sha256=sha(correction))])))
        areas = ('mabou', 'judique')
        live = tmp/'data'   # this fixture's own live data root (the runner's TMPDIR may sit under data/)
        report = patch.make(work, baked, tmp/'delta', verify=False, areas_=areas, live=live)
        receipt = tmp/'receipt.json'; receipt.write_text(json.dumps(report, indent=1)+'\n')
        bad = copy.deepcopy(report); bad['areas'][1]['lots_m2'] = 13; badfile = tmp/'bad.json'; badfile.write_text(json.dumps(bad))
        assert report['areas'][0]['omitted'] == [3]
        assert (tmp/'delta/raw-mirror/data/raw/paved-open/corrections.json').read_bytes() == correction and report['mirror'][0]['sha256'] == sha(correction)
        try: patch.make(work, baked, tmp/'delta', verify=False, areas_=areas, live=live)
        except ValueError: pass
        else: raise AssertionError('existing output accepted')
        try: patch.make(work, baked, live/'paved-open-delta-fixture', verify=False, areas_=areas, live=live)
        except ValueError: pass
        else: raise AssertionError('output under data/ accepted')
        # A stale baked input refuses the maker.
        stale = copy.deepcopy(json.loads((work/'judique/bake.json').read_text())); stale['inputs'][1]['sha256'] = '0'*64
        (work/'judique/bake.json').write_text(json.dumps(stale))
        try: patch.make(work, baked, tmp/'delta-stale', verify=False, areas_=areas, live=live)
        except ValueError as e: assert 'STALE WORK BAKE' in str(e)
        else: raise AssertionError('stale work bake accepted')
        # A forbidden input path refuses the maker.
        stale['inputs'][1] = dict(path='data/raw/areas/judique/lidar/intensity.tif', sha256='0'*64)
        (work/'judique/bake.json').write_text(json.dumps(stale))
        try: patch.make(work, baked, tmp/'delta-int', verify=False, areas_=areas, live=live)
        except ValueError as e: assert 'forbidden' in str(e)
        else: raise AssertionError('intensity input accepted')
        # A committed receipt mismatch refuses the maker.
        stale['inputs'] = stale['inputs'][:1]; (work/'judique/bake.json').write_text(json.dumps(stale))

        try: patch.make(work, baked, tmp/'delta-bad', verify=True, receipt=badfile, areas_=areas, live=live)
        except ValueError as e: assert 'STALE RECEIPT' in str(e)
        else: raise AssertionError('receipt mismatch accepted')
        r = json.loads(receipt.read_text())
        assert state(baked, r) == 'before' and verdict(baked, r) == ('before', [], [])
        assert all(a['inputs'] for a in r['areas']) and any(i.get('lattice') for i in r['areas'][0]['inputs'])
        # Install refuses a tampered delta file and a delta receipt that is not the committed one.
        tampered = tmp/'delta-tampered'; shutil.copytree(tmp/'delta', tampered)
        (tampered/'terrain/paved/1_2.r8').write_bytes(bytes(128*128))
        for bad_delta, bad_receipt, words in [(tampered, receipt, 'Delta file differs'), (tmp/'delta', badfile, 'differs from the committed')]:
            try: patch.install(bad_delta, baked, receipt=bad_receipt)
            except ValueError as e: assert words in str(e), e
            else: raise AssertionError('install accepted '+words)
        assert state(baked, r) == 'before', 'a refused install wrote land'
        # Install refuses stale land: a road change after the bake.
        roads = baked/'areas/judique/roads.json'; saved_roads = roads.read_bytes(); roads.write_text('{"roads":[1]}\n')
        assert verdict(baked, r)[1] == ['areas/judique/roads.json'], 'stale road input must be reported before install'
        try: patch.install(tmp/'delta', baked, receipt=receipt)
        except ValueError as e: assert 'STALE LAND' in str(e)
        else: raise AssertionError('install accepted stale land')
        roads.write_bytes(saved_roads)
        # An unrelated manifest key is not a lattice change.
        m0 = baked/'areas/judique/manifest.json'; d0 = json.loads(m0.read_text()); d0['props'] = dict(file='props.json'); m0.write_text(json.dumps(d0, separators=(',', ':'))+'\n')
        assert verdict(baked, r)[1] == [], 'an unrelated manifest key must not count as stale'
        # The corrections mirror replaces a drifted live file and keeps the old one.
        live_corr = tmp/'data/raw/paved-open/corrections.json'; live_corr.write_bytes(b'{"version":1,"epsg":2961,"features":[{"old":1}]}\n')
        assert verdict(baked, r)[2] == [patch.MIRROR], 'drifted corrections must be reported before install'
        # Install with a newer unrelated manifest key: it must survive, and only `paved` is added.
        m = baked/'terrain/manifest.json'; doc = json.loads(m.read_text()); doc['tall'] = dict(file='tall.json'); m.write_text(json.dumps(doc, separators=(',', ':'))+'\n')
        before_other = {a: json.loads((baked/patch.folder(a)/'manifest.json').read_text()) for a in areas}
        patch.install(tmp/'delta', baked, receipt=receipt)
        assert state(baked, r) == 'after' and verdict(baked, r) == ('after', [], [])
        assert live_corr.read_bytes() == correction and (live_corr.parent/'corrections.json.before-1212').read_bytes().startswith(b'{"version":1,"epsg":2961,"features":[{"old"')
        for a in areas:
            after = json.loads((baked/patch.folder(a)/'manifest.json').read_text()); assert after.pop('paved') == r['areas'][areas.index(a)]['manifestKey']; assert after == before_other[a]
        patch.install(tmp/'delta', baked, receipt=receipt)   # idempotent
        assert state(baked, r) == 'after'
        for label, change in [('mixed', lambda: (shutil.rmtree(baked/'areas/judique/paved'), strip(baked/'areas/judique/manifest.json'))),
                              ('unknown bytes', lambda: (baked/'terrain/paved/1_2.r8').write_bytes(bytes(128*128))),
                              ('extra file', lambda: (baked/'terrain/paved/9_9.r8').write_bytes(tile)),
                              ('key only', lambda: shutil.rmtree(baked/'terrain/paved')),
                              ('files only', lambda: strip(baked/'terrain/manifest.json'))]:
            copyroot = tmp/'case'; shutil.copytree(baked, copyroot)
            saved = baked; baked = copyroot
            try:
                change()
                try: state(baked, r)
                except AssertionError: print('PASS rejected', label)
                else: raise AssertionError(label+' accepted')
            finally:
                shutil.rmtree(copyroot); baked = saved
        roads.write_text('{"roads":[2]}\n')
        try: verdict(baked, r)
        except AssertionError as e: assert 'STALE' in str(e); print('PASS rejected installed tiles over changed roads')
        else: raise AssertionError('stale installed land accepted')
        roads.write_bytes(saved_roads)
        live_corr.write_bytes(b'{}\n')
        try: verdict(baked, r)
        except AssertionError as e: assert 'corrections' in str(e); print('PASS rejected drifted corrections after install')
        else: raise AssertionError('drifted corrections accepted after install')
        live_corr.write_bytes(correction)
        # Install refuses to replace a different live tile.
        (baked/'terrain/paved/1_2.r8').write_bytes(bytes(128*128))
        try: patch.install(tmp/'delta', baked, receipt=receipt)
        except ValueError as e: assert 'Live file differs' in str(e)
        else: raise AssertionError('install replaced a different live file')
        # Industrial Park Road width delta: stale_inputs accepts both a direct match (receipt baked on widened roads)
        # and the mapped before-hash (receipt baked before the width delta), while rejecting an unknown hash.
        ind = json.loads(patch.INDUSTRIAL_WIDTH.read_text())
        ind_roads = next(f for f in ind['files'] if f['file'] == 'roads.json')
        pt_dir = baked/'areas/pointtupper'; pt_dir.mkdir(parents=True, exist_ok=True)
        # Write a payload whose hash is neither before nor after -> rejected.
        (pt_dir/'roads.json').write_bytes(b'{"roads":[]}\n')
        assert patch.stale_inputs(dict(areas=[dict(inputs=[dict(file='areas/pointtupper/roads.json', sha256=ind_roads['before'])])]), baked) == ['areas/pointtupper/roads.json']
        # Direct match on after-hash receipt passes without forcing remap to before-hash.
        after_bytes = b'{"roads":[{"id":107}]}\n'
        (pt_dir/'roads.json').write_bytes(after_bytes)
        assert patch.stale_inputs(dict(areas=[dict(inputs=[dict(file='areas/pointtupper/roads.json', sha256=sha(after_bytes))])]), baked) == []
        # Mapped before-hash passes when live hash equals ind_roads['sha256'].
        assert patch._industrial_width_stands_for('areas/pointtupper/roads.json', ind_roads['sha256']) == ind_roads['before']
        assert patch._industrial_width_stands_for('areas/pointtupper/roads.json', '0'*64) == '0'*64
        for allowed in [('before', None), ('after', None), ('after', 'after')]: expectation(*allowed)
        for invalid in [('before', 'after'), ('after', 'before')]:
            try: expectation(*invalid)
            except AssertionError: pass
            else: raise AssertionError('expectation accepted '+str(invalid))
        print('PASS paved land fixture: maker refusals (existing/data output, stale bake, intensity path, receipt); install refusals (tampered delta, foreign receipt, stale land, different live tile); install keeps other manifest keys, mirrors corrections, idempotent; before/after accepted; mixed/unknown/stale-after/drifted-after rejected')
    finally:
        shutil.rmtree(tmp)


def strip(path):
    doc = json.loads(path.read_text()); doc.pop('paved', None); path.write_text(json.dumps(doc, separators=(',', ':'))+'\n')


def with_1219(receipt, after):
    """The paved receipt (Point Tupper delta) with Judique's entry and the corrections mirror taken from the Judique lots delta delta."""
    merged = copy.deepcopy(receipt)
    merged['areas'] = [dict(after['area'], omitted=a['omitted']) if a['area'] == 'judique' else a for a in merged['areas']]
    merged['mirror'] = after['mirror']
    return merged


def land(root):
    if patch.refresh_installed(root):
        print('PASS refreshed pavement and current inputs match the receipt in all six areas')
        return
    receipt = json.loads(patch.RECEIPT.read_text())
    previous = json.loads(PREVIOUS.read_text())
    for r in (receipt, previous):
        assert [a['area'] for a in r['areas']] == list(patch.AREAS)
        for a in r['areas']:
            assert a['manifestKey'] == dict(file='paved/index.json', tiles=len(a['files'])-1, source=patch.SOURCE)
            assert all(len(f['sha256']) == 64 for f in a['files'])
    judique_mode = judique.state(root)
    if judique_mode == 'half': raise AssertionError('Judique Judique lots delta install is half done (new files, old manifest key): run judique_lots.py install again')
    if EXPECT_1219 is not None and judique_mode != EXPECT_1219: raise AssertionError(f'Judique Judique lots delta land is {judique_mode}, expected {EXPECT_1219}')
    print(f'Judique Judique lots delta lots: {judique_mode}; EXPECT_1219={EXPECT_1219}')
    try:
        # The current receipt (Mabou village delta) covers all six areas, Judique's Judique lots delta lots included.
        mode, stale, drift = verdict(root, receipt)
    except AssertionError as error:
        if not ACCEPT_PREVIOUS: raise
        if judique_mode == 'after': previous = with_1219(previous, json.loads(judique.RECEIPT.read_text()))
        try: mode, stale, drift = verdict(root, previous)
        except AssertionError: raise error from None
        if mode != 'after': raise error
        print('NOTE: the land holds the previous paved receipt (tools/paved-open/hashes-point-tupper.json'
              + (', with Judique lots delta' if judique_mode == 'after' else '') + '); the Mabou village delta delta is not installed yet')
        receipt = previous
    expectation(mode, EXPECT)
    for line in stale: print('WARNING: the delta is stale against', line, '- re-bake the pavement and review a new receipt before install')
    for line in drift: print('NOTE:', line, 'differs from the receipt mirror; install writes the mirrored file')
    print(f'PASS paved land is {mode} in all six areas ({sum(len(a["files"]) for a in receipt["areas"])} receipt files, '
          f'{sum(len(a["inputs"]) for a in receipt["areas"])} pinned baked inputs, {len(stale)} stale); EXPECT={EXPECT}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--land', action='store_true'); p.add_argument('--land-root', type=Path, default=ROOT/'data/baked')
    a = p.parse_args()
    fixture()
    if a.land: land(a.land_root)
