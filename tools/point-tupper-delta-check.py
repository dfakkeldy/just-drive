#!/usr/bin/env python3
"""Port Hawkesbury land delta (the project brief): all-before or all-after, never mixed. No land writes.

Default: a synthetic two-area land through the real maker and installer, with their refusals.
--land: also read the real data/baked (or --land-root) against tools/point-tupper-delta/hashes.json and report its state.
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
spec = importlib.util.spec_from_file_location('ph_1227_patch', ROOT/'tools/point-tupper-delta/patch.py')
patch = importlib.util.module_from_spec(spec); spec.loader.exec_module(patch)
spec = importlib.util.spec_from_file_location('judique_1219', ROOT/'tools/paved-open/judique_lots.py')
judique = importlib.util.module_from_spec(spec); spec.loader.exec_module(judique)


def with_1219(baked, report, refreshed=False):
    """Judique lots delta (Judique lots, installed after Point Tupper delta) replaces Judique's paved/index.json and composes the corrections file.
    Once it is installed, those two entries are checked against its receipt; every other Point Tupper delta entry is unchanged."""
    if not refreshed and judique.state(baked) != 'after': return report
    after = json.loads(judique.RECEIPT.read_text())
    index = next(f for f in after['area']['files'] if f['file'] == 'areas/judique/paved/index.json')
    report = copy.deepcopy(report)
    for f in report['files']:
        if f['file'] == index['file']: f['sha256'] = index['sha256']
    if after['mirror'][0]['before'] != report['mirror']['sha256']: raise AssertionError('Judique lots delta was not composed on the Point Tupper delta corrections file')
    report['mirror']['sha256'] = after['mirror'][0]['sha256']
    print('NOTE: Judique carries the Judique lots delta lots delta: its paved/index.json and the corrections file are checked against tools/paved-open/judique-lots.json')
    return report
AREAS = ('mabou', 'pointtupper')


def sha(data): return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value, separators=(',', ':'))+'\n')


def tile(*ones):
    a = bytearray(128*128)
    for i in ones: a[i] = 1
    return bytes(a)


def fixture():
    tmp = Path(tempfile.mkdtemp(prefix='point-tupper-delta-land-'))
    try:
        data = tmp/'data'; live = data/'baked'; work = tmp/'work-root/baked'; paved = tmp/'work-root/paved'
        corrections = {'version': 1, 'epsg': 2961, 'features': [{'id': 'old-lot', 'area': 'mabou', 'kind': 'lot', 'surface': 'paved',
                       'source': 'synthetic', 'date': '2026-11-17', 'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 0]]]}}]}
        (data/'raw/paved-open').mkdir(parents=True)
        (data/'raw/paved-open/corrections.json').write_bytes((json.dumps(corrections, indent=2)+'\n').encode())
        features = tmp/'features.json'
        dump(features, {'version': 1, 'epsg': 2961, 'features': [{'id': 'new-lot', 'area': 'pointtupper', 'kind': 'lot', 'surface': 'paved', 'meetsRoad': True,
                        'source': 'synthetic', 'date': '2026-11-17', 'geometry': {'type': 'Polygon', 'coordinates': [[[5, 5], [9, 5], [9, 9], [5, 5]]]}}]})
        for area in AREAS:
            f = live/patch.area_folder(area)
            dump(f/'manifest.json', {'crs': 'EPSG:2961', 'origin': [0, 0], 'buildings': {'file': 'buildings.json', 'count': 1},
                                     'paved': {'file': 'paved/index.json', 'tiles': 2, 'source': patch.paved_patch.SOURCE}, 'props': {'file': 'props.json', 'count': 3}})
            dump(f/'buildings.json', {'buildings': [{'id': 1}]})
            dump(f/'roads.json', {'roads': []})
            dump(f/'props.json', {'mailboxes': [{'x': 1}], 'poles': [{'x': 2}], 'serviceDrops': [{'building': 1}]})
            dump(f/'paved/index.json', {'area': area, 'source': patch.paved_patch.SOURCE, 'tiles': ['1_1.r8', '2_2.r8'], 'provenanceSha256': 'old'})
            (f/'paved/1_1.r8').write_bytes(tile(1)); (f/'paved/2_2.r8').write_bytes(tile(2))
        shutil.copytree(live, work)
        pt = work/'areas/pointtupper'
        dump(pt/'buildings.json', {'buildings': [{'id': 1}, {'id': 2, 'shape': 'block'}]})
        dump(pt/'props.json', {'mailboxes': [{'x': 1}], 'poles': [{'x': 2}], 'serviceDrops': [{'building': 1}, {'building': 2}]})
        m = json.loads((pt/'manifest.json').read_text()); m['buildings']['count'] = 2; m['props'] = {'file': 'props.json', 'mailboxes': 1, 'poles': 1, 'serviceDrops': 2}; dump(pt/'manifest.json', m)
        corr = patch.compose((data/'raw/paved-open/corrections.json').read_bytes(), features)

        def bake(area, tiles):
            out = paved/area/'paved'; out.mkdir(parents=True, exist_ok=True)
            for name, data_ in tiles.items(): (out/name).write_bytes(data_)
            dump(out/'index.json', {'area': area, 'source': patch.paved_patch.SOURCE, 'tiles': sorted(tiles), 'provenanceSha256': 'new'})
            names = ['index.json', *tiles]
            (paved/area/'promotion.json').write_text(json.dumps([dict(source=str(out/n), sha256=sha((out/n).read_bytes())) for n in names]))
            rel = 'data/baked/'+patch.area_folder(area)
            wf = work/patch.area_folder(area)
            dump(paved/area/'bake.json', dict(area=area, lots_m2=8, apron_m2=0, lot_eligibility=[dict(id=f'{area}-3', drop=area == 'pointtupper')],
                 inputs=[dict(path=rel+'/manifest.json', role='terrain-lattice', sha256=sha((wf/'manifest.json').read_bytes())),
                         dict(path=rel+'/roads.json', role='road-exclusion', sha256=sha((wf/'roads.json').read_bytes())),
                         dict(path=rel+'/buildings.json', role='building-exclusion', sha256=sha((wf/'buildings.json').read_bytes())),
                         dict(path='data/raw/paved-open/corrections.json', role='owner-corrections', sha256=sha(corr))]))
        bake('mabou', {'1_1.r8': tile(1), '2_2.r8': tile(2)})              # only its index provenance changes
        bake('pointtupper', {'1_1.r8': tile(1, 7), '3_3.r8': tile(3)})     # one changed, one new, one gone
        kw = dict(features=features, areas_=AREAS)

        def refused(words, fn, *a, **k):
            try: fn(*a, **k)
            except (ValueError, AssertionError) as e: assert words in str(e), (words, e); return
            raise AssertionError('accepted: '+words)

        report = patch.make(work, paved, live, tmp/'delta', verify=False, **kw)
        receipt = tmp/'hashes.json'; receipt.write_text(json.dumps(report, indent=1)+'\n')
        names = {f['file']: f for f in report['files']}
        assert set(names) == {'areas/pointtupper/buildings.json', 'areas/pointtupper/props.json', 'terrain/paved/index.json', 'areas/pointtupper/paved/index.json',
                              'areas/pointtupper/paved/1_1.r8', 'areas/pointtupper/paved/2_2.r8', 'areas/pointtupper/paved/3_3.r8'}, sorted(names)
        assert names['areas/pointtupper/paved/2_2.r8']['sha256'] is None and names['areas/pointtupper/paved/3_3.r8']['before'] is None
        assert [m['folder'] for m in report['manifests']] == ['areas/pointtupper'] and report['manifests'][0]['after']['buildings']['count'] == 2
        assert report['manifests'][0]['after']['paved']['tiles'] == 2 and report['manifests'][0]['after']['props']['serviceDrops'] == 2
        assert 'serviceDrops' not in report['manifests'][0]['before']['props'] and 'tall' not in report['manifests'][0]['after']
        assert (tmp/'delta/raw-mirror/data/raw/paved-open/corrections.json').read_bytes() == corr
        paved_receipt = json.loads((tmp/'delta/paved-receipt.json').read_text())
        assert [a['area'] for a in paved_receipt['areas']] == list(AREAS) and paved_receipt['areas'][1]['omitted'] == [3]
        assert paved_receipt['mirror'] == [dict(file=patch.MIRROR, sha256=sha(corr))]
        print('PASS maker: buildings, changed/new/gone tiles, index provenance, owned manifest keys, corrections mirror, paved receipt')
        # Refusals of the maker.
        refused('NEW', patch.make, work, paved, live, tmp/'delta', verify=False, **kw)
        refused('outside data/', patch.make, work, paved, live, data/'delta', verify=False, **kw)
        for label, path, value in [('beyond the switch', work/'areas/pointtupper/roads.json', '{"roads":[1]}\n'),
                                   ('beyond the switch', work/'terrain/buildings.json', '{"buildings":[]}\n')]:
            saved = path.read_bytes(); path.write_text(value)
            refused(label, patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
            path.write_bytes(saved)
        m = json.loads((pt/'manifest.json').read_text()); saved = (pt/'manifest.json').read_bytes(); m['cemeteries'] = {'count': 4}; dump(pt/'manifest.json', m)
        refused('beyond the switch', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (pt/'manifest.json').write_bytes(saved)
        saved = (pt/'props.json').read_bytes(); dump(pt/'props.json', dict(json.loads(saved), poles=[{'x': 3}]))
        refused('beyond the service drops', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (pt/'props.json').write_bytes(saved)
        (pt/'props.json').write_bytes((live/'areas/pointtupper/props.json').read_bytes())
        refused('not re-run', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        dump(pt/'props.json', dict(json.loads(saved), serviceDrops=[{'building': 1}, {'building': 2}, {'building': 3}]))
        refused('counts differ', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (pt/'props.json').write_bytes(saved)
        saved = (pt/'buildings.json').read_bytes(); (pt/'buildings.json').write_bytes(saved+b' ')
        refused('STALE PAVED BAKE', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (pt/'buildings.json').write_bytes(saved)
        dump(tmp/'other.json', {'version': 1, 'epsg': 2961, 'features': []})
        refused('other corrections', patch.make, work, paved, live, tmp/'delta-x', verify=False, features=tmp/'other.json', areas_=AREAS)
        shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        bad = copy.deepcopy(report); bad['files'][0]['sha256'] = '0'*64; (tmp/'bad.json').write_text(json.dumps(bad))
        refused('STALE RECEIPT', patch.make, work, paved, live, tmp/'delta-x', verify=True, receipt=tmp/'bad.json', **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        refused('STALE RECEIPT', patch.make, work, paved, live, tmp/'delta-x', verify=True, receipt=receipt, paved_receipt=tmp/'bad.json', **kw)
        shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        intensity = json.loads((paved/'mabou/bake.json').read_text()); saved = (paved/'mabou/bake.json').read_bytes()
        intensity['inputs'].append(dict(path='data/raw/areas/mabou/lidar/intensity.tif', role='road-exclusion', sha256='0'*64)); dump(paved/'mabou/bake.json', intensity)
        refused('forbidden', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (paved/'mabou/bake.json').write_bytes(saved)
        print('PASS maker refusals: existing or data/ output, a change beyond the switch (file, manifest key, props beyond the drops), stale paved bake, other corrections, receipt, intensity input')
        # Install refusals, then the install, then mixed and unknown land.
        r = json.loads(receipt.read_text())
        assert patch.state(live, r) == 'before'
        tampered = tmp/'delta-t'; shutil.copytree(tmp/'delta', tampered); (tampered/'areas/pointtupper/buildings.json').write_text('{}\n')
        refused('Delta file differs', patch.install, tampered, live, receipt=receipt)
        refused('differs from the committed', patch.install, tmp/'delta', live, receipt=tmp/'bad.json')
        saved = (live/'areas/pointtupper/paved/1_1.r8').read_bytes(); (live/'areas/pointtupper/paved/1_1.r8').write_bytes(tile(9))
        refused('unknown bytes', patch.install, tmp/'delta', live, receipt=receipt)
        assert (live/'areas/pointtupper/buildings.json').read_bytes() != (tmp/'delta/areas/pointtupper/buildings.json').read_bytes(), 'a refused install wrote land'
        (live/'areas/pointtupper/paved/1_1.r8').write_bytes(saved)
        # A paved input outside the delta changed after the bake (a road): refused before any write, and the land
        # check reports it.
        roads = live/'areas/pointtupper/roads.json'; saved = roads.read_bytes(); roads.write_text('{"roads":[7]}\n')
        paved_doc = json.loads((tmp/'delta/paved-receipt.json').read_text())
        assert patch.stale_inputs(live, r, paved_doc) == ['areas/pointtupper/roads.json']
        refused('STALE LAND', patch.install, tmp/'delta', live, receipt=receipt)
        assert patch.state(live, r) == 'before' and not (tmp/'delta/before').exists(), 'a refused install wrote land'
        roads.write_bytes(saved)
        assert patch.stale_inputs(live, r, paved_doc) == [], 'the before land with the owned keys applied must not be stale'
        # A lattice key that this delta does not own (origin) is stale even with the owned keys applied.
        mf = live/'areas/pointtupper/manifest.json'; saved = mf.read_bytes(); dump(mf, dict(json.loads(saved), origin=[1, 1]))
        assert patch.stale_inputs(live, r, paved_doc) == ['areas/pointtupper/manifest.json']
        mf.write_bytes(saved)
        # A foreign corrections file is refused.
        corr_live = data/'raw/paved-open/corrections.json'; saved = corr_live.read_bytes(); corr_live.write_text('{}\n')
        refused('neither before nor after', patch.install, tmp/'delta', live, receipt=receipt)
        corr_live.write_bytes(saved)
        # An install that stopped half way (two files written) is finished, not refused.
        for name in ('areas/pointtupper/paved/1_1.r8', 'areas/pointtupper/paved/3_3.r8'):
            (live/name).write_bytes((tmp/'delta'/name).read_bytes())
        refused('mixed', patch.state, live, r)
        partial = tmp/'partial/data'; shutil.copytree(data, partial)   # a copy of the whole data root, raw included
        patch.install(tmp/'delta', partial/'baked', receipt=receipt)
        assert patch.state(partial/'baked', r) == 'after' and (partial/'raw/paved-open/corrections.json').read_bytes() == corr
        shutil.rmtree(tmp/'partial'); shutil.rmtree(tmp/'delta/before')
        (live/'areas/pointtupper/paved/1_1.r8').write_bytes(tile(1)); (live/'areas/pointtupper/paved/3_3.r8').unlink()
        assert patch.state(live, r) == 'before'
        m = json.loads((live/'areas/pointtupper/manifest.json').read_text()); m['tall'] = {'file': 'tall.json'}
        dump(live/'areas/pointtupper/manifest.json', m)                     # another bake's keys: kept by the install
        patch.install(tmp/'delta', live, receipt=receipt)
        assert patch.state(live, r) == 'after' and not (live/'areas/pointtupper/paved/2_2.r8').exists()
        assert (tmp/'delta/before/areas/pointtupper/paved/2_2.r8').read_bytes() == tile(2), 'the replaced bytes must be kept'
        assert json.loads((tmp/'delta/before/areas/pointtupper/buildings.json').read_text()) == {'buildings': [{'id': 1}]}, 'the replaced buildings must be kept'
        # Files and manifest written, corrections not yet (an install that stopped at the last step): finished.
        corr_live = data/'raw/paved-open/corrections.json'; corr_live.write_bytes((data/'raw/paved-open/corrections.json.before-1227').read_bytes())
        assert patch.state(live, r) == 'after'; patch.install(tmp/'delta', live, receipt=receipt); assert corr_live.read_bytes() == corr
        after = json.loads((live/'areas/pointtupper/manifest.json').read_text())
        assert after['tall'] == {'file': 'tall.json'} and after['buildings']['count'] == 2 and after['props']['serviceDrops'] == 2
        assert (data/'raw/paved-open/corrections.json').read_bytes() == corr and (data/'raw/paved-open/corrections.json.before-1227').exists()
        patch.install(tmp/'delta', live, receipt=receipt)   # idempotent
        assert patch.state(live, r) == 'after'
        cases = [('one tile back', lambda b: (b/'areas/pointtupper/paved/1_1.r8').write_bytes(tile(1)), 'mixed'),
                 ('gone tile back', lambda b: (b/'areas/pointtupper/paved/2_2.r8').write_bytes(tile(2)), 'mixed'),
                 ('buildings back', lambda b: dump(b/'areas/pointtupper/buildings.json', {'buildings': [{'id': 1}]}), 'mixed'),
                 ('manifest key back', lambda b: dump(b/'areas/pointtupper/manifest.json', dict(json.loads((b/'areas/pointtupper/manifest.json').read_text()),
                                                      buildings={'file': 'buildings.json', 'count': 1})), 'unknown owned manifest keys'),
                 ('unknown buildings', lambda b: dump(b/'areas/pointtupper/buildings.json', {'buildings': []}), 'unknown bytes'),
                 ('unknown index', lambda b: dump(b/'terrain/paved/index.json', {}), 'unknown bytes')]
        for label, change, words in cases:
            copyroot = tmp/'case'; shutil.copytree(live, copyroot)
            try:
                change(copyroot); refused(words, patch.state, copyroot, r); print('PASS rejected', label)
            finally: shutil.rmtree(copyroot)
        print('PASS install: refusals (tampered delta, foreign receipt, unknown live bytes, stale road, foreign corrections) write nothing; '
              'a half-done install is finished; replaced bytes kept; other manifest keys kept; gone tile removed; corrections mirrored with the old file kept; idempotent')
    finally:
        shutil.rmtree(tmp)


# Later deltas that replace files of this one; their own rows check them. See patch.entries().
LATER = (ROOT/'tools/mabou-village-delta/hashes.json',)


def land(baked):
    refreshed = patch.paved_patch.refresh_installed(baked)
    report = with_1219(baked, json.loads(patch.RECEIPT.read_text()), refreshed)
    later = [json.loads(p.read_text()) for p in LATER]
    if refreshed:
        later.append(patch.paved_patch.refresh_delta())
    mode = patch.state(baked, report, later)
    if EXPECT is not None and mode != EXPECT: raise AssertionError(f'land is {mode}, expected {EXPECT}')
    corr = Path(baked).parent/patch.MIRROR[len('data/'):]
    now = sha(corr.read_bytes()) if corr.is_file() else None
    for r in later:
        mirror = r.get('mirror')
        if mirror and now == mirror['sha256']: now = mirror['before']
    if now != report['mirror']['before' if mode == 'before' else 'sha256']:
        raise AssertionError(f'land is {mode} but the corrections file is not the {mode} one (install refuses it)')
    paved = patch.PAVED_RECEIPT.read_bytes()
    if sha(paved) != report['pavedReceiptSha256']: raise AssertionError('tools/paved-open/hashes-point-tupper.json is not the Point Tupper delta paved receipt')
    # The full refresh already checked the current pavement against its own inputs.
    stale = [] if refreshed else patch.stale_inputs(baked, report, json.loads(paved), later)
    if stale and mode == 'after': raise AssertionError('installed Point Tupper delta tiles are STALE against: '+', '.join(stale[:8]))
    for line in stale: print('WARNING: the delta is stale against', line, '- install refuses it; re-bake and review a new delta')
    kept = [f for f in report['files'] if f['sha256']]
    print(f'PASS Point Tupper delta land is {mode} ({len(kept)} files, {len(report["files"]) - len(kept)} tiles removed, '
          f'{len(report["manifests"])} manifests); EXPECT={EXPECT}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--land', action='store_true'); p.add_argument('--land-root', type=Path, default=ROOT/'data/baked')
    a = p.parse_args()
    fixture()
    if a.land: land(a.land_root)
