#!/usr/bin/env python3
"""Mabou main street land delta (the project brief): all-before or all-after, never mixed. No land writes.

Default: the building corrections and the delta's content rules on made-up records, then a synthetic two-area land
through the real maker and installer, with their refusals.
--land: also read the real data/baked (or --land-root) against tools/mabou-village-delta/hashes.json, report its state, and
show that the committed corrections give the receipt's buildings.json from the before land (or keep the after one).
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

ROOT = Path(__file__).resolve().parents[1]
# Installed in the canonical land by the main thread (17 Nov 2026): only 'after' land passes.
EXPECT = 'after'
spec = importlib.util.spec_from_file_location('mabou_1229_patch', ROOT/'tools/mabou-village-delta/patch.py')
patch = importlib.util.module_from_spec(spec); spec.loader.exec_module(patch)
sys.path.insert(0, str(ROOT/'pipeline'))
import mabou_main  # noqa: E402
AREAS = ('mabou', 'pointtupper')


def sha(data): return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value, separators=(',', ':'))+'\n')


def tile(*ones):
    a = bytearray(128*128)
    for i in ones: a[i] = 1
    return bytes(a)


def refused(words, fn, *a, **k):
    try: fn(*a, **k)
    except (ValueError, AssertionError) as e: assert words in str(e), (words, e); return
    raise AssertionError('accepted: '+words)


def records():
    """The three corrected buildings as the brief found them, plus a neighbour, with made-up other fields."""
    out = []
    for e in mabou_main.INPUT['kinds'] + mabou_main.INPUT['replace']:
        kind = e.get('from', e.get('kind'))
        out.append(dict(id=e['id'], x=e['x'], y=e['y'], ground=10.0, footprint=[[e['x']-5, e['y']-4], [e['x']+5, e['y']-4], [e['x']+5, e['y']+4], [e['x']-5, e['y']+4]],
                        axisDeg=90.0, length=10.0, width=8.0, eave=3.0, ridge=5.0, roof='gable', kind=kind, source='osm',
                        confidence=.25 if 'kind' in e else .9, nearRoad=1, roadDist=20.0))
    out.append(dict(out[0], id=2000, x=1.0, y=1.0, kind='house'))
    out.append(dict(out[0], id=900001, x=2.0, y=2.0, kind='house', source='hand'))
    return sorted(out, key=lambda b: b['id'])


def corrections():
    base = records()
    after = mabou_main.correct_buildings(base, 'mabou')
    assert mabou_main.correct_buildings(base, 'judique') == base, 'another area must pass through'
    assert mabou_main.correct_buildings(after, 'mabou') == after, 'not idempotent'
    by = {b['id']: b for b in after}
    assert by[150]['kind'] == 'large' and by[169]['kind'] == 'large' and by[2000] == next(b for b in base if b['id'] == 2000)
    hall = [b for b in after if b.get('buildingId') == 3]
    assert [b['id'] for b in hall] == [3, 2001, 2002], 'wing ids follow the highest measured id, never a hand id'
    assert hall[0]['site'] == next(b for b in base if b['id'] == 3) and all('site' not in b for b in hall[1:])
    assert [(b['length'], b['width'], b['eave'], b['ridge'], b['axisDeg']) for b in hall] == [
        (20.0, 12.5, 4.0, 7.2, 144.0), (12.5, 4.5, 2.8, 3.9, 144.0), (20.5, 11.3, 3.9, 6.6, 54.0)]
    for b in hall:
        xs, ys = zip(*b['footprint'])
        assert abs(sum(xs)/4 - b['x']) <= .011 and abs(sum(ys)/4 - b['y']) <= .011 and b['length'] >= b['width']
    # --preserve-sites gives the property records back; the corrections then give the same land.
    sites = [b.get('site', b) for b in after if b.get('buildingId', b['id']) == b['id']]
    assert mabou_main.correct_buildings(sites, 'mabou') == after, 'a preserve-sites bake must give the same records'
    moved = copy.deepcopy(base); next(b for b in moved if b['id'] == 169)['x'] += .5
    refused('moved since the brief', mabou_main.correct_buildings, moved, 'mabou')
    retyped = copy.deepcopy(base); next(b for b in retyped if b['id'] == 150)['kind'] = 'barn'
    refused('not the shed', mabou_main.correct_buildings, retyped, 'mabou')
    measured = copy.deepcopy(base); next(b for b in measured if b['id'] == 3)['confidence'] = .9
    refused('low-confidence outline', mabou_main.correct_buildings, measured, 'mabou')
    missing = [b for b in base if b['id'] != 3]
    refused('missing', mabou_main.correct_buildings, missing, 'mabou')
    tampered = copy.deepcopy(after); next(b for b in tampered if b['id'] == 2001)['footprint'][0][0] += 1
    refused('other blocks', mabou_main.correct_buildings, tampered, 'mabou')
    # Step 27 hands its audit rows: each new block gets its building's row with its own id, as add_wings does, so
    # 27_check_buildings finds one row per building id.
    audit = [dict(id=b['id'], key=f'k{b["id"]}', aliases=[]) for b in base]
    with_audit = mabou_main.correct_buildings(base, 'mabou', audit)
    assert with_audit == after and {r['id'] for r in audit} == {b['id'] for b in after}, 'one audit row per building id'
    assert [r for r in audit if r['id'] in (2001, 2002)] == [dict(id=i, key='k3', aliases=[], buildingId=3) for i in (2001, 2002)]
    refused('no audit row', mabou_main.correct_buildings, base, 'mabou', [r for r in audit if r['id'] != 3][:0])
    # The command line writes buildings.json and the manifest's buildings count, as step 27 does; nothing else.
    folder = Path(tempfile.mkdtemp(prefix='mabou-village-delta-cli-'))
    try:
        dump(folder/'buildings.json', dict(crs='EPSG:2961', buildings=base))
        dump(folder/'manifest.json', dict(buildings=dict(file='buildings.json', count=len(base)), props=dict(file='props.json', mailboxes=3)))
        import subprocess
        subprocess.run([sys.executable, str(ROOT/'pipeline/mabou_main.py'), str(folder)], check=True)
        assert json.loads((folder/'buildings.json').read_text())['buildings'] == after
        assert json.loads((folder/'manifest.json').read_text()) == dict(buildings=dict(file='buildings.json', count=len(after)), props=dict(file='props.json', mailboxes=3))
    finally:
        shutil.rmtree(folder)
    print('PASS corrections: kinds, hall blocks and wing ids, property record kept as site, idempotent, preserve-sites round trip, '
          'audit rows for new blocks, the command line writes the buildings count, '
          'other areas untouched; moved, retyped, measured, missing and tampered records refused')
    return base, after


def content(base, after):
    """check(): what the three Mabou files may change, on a made-up land."""
    tmp = Path(tempfile.mkdtemp(prefix='mabou-village-delta-content-'))
    try:
        live, work = tmp/'live', tmp/'work'
        observed = json.loads((ROOT/'pipeline/observed_styles.json').read_text())
        names = [lm['what'] for lm in observed['landmarks'] if lm['what'].startswith('Mabou main street landmark:')]
        styles = {str(b['id']): dict(wall='#ffffff', wallName='white') for b in base if b.get('source') != 'hand'}
        styles.update({str(i): dict(wall='#ffffff', wallName='white') for i in range(3000, 3000+len(names))})
        old_lm = [dict(what='old landmark', id=2000, distance=1.0)]
        cabinets = [dict(x=10.0, y=10.0, heading=1.0, modules=3), dict(x=20.0, y=20.0, heading=2.0, modules=4),
                    dict(x=30.0, y=30.0, heading=3.0, modules=4), dict(x=624905.26, y=5103596.84, heading=76.0, modules=4)]
        drops = [dict(building=3, x=1.0), dict(building=2000, x=2.0)]
        lp = dict(crs='EPSG:2961', mailboxes=[dict(x=1)], communityBoxes=cabinets, poles=[dict(x=2)], serviceDrops=drops)
        dump(live/'terrain/buildings.json', dict(crs='EPSG:2961', buildings=base))
        dump(live/'terrain/building-styles.json', dict(version=1, styles=styles, landmarks=old_lm))
        dump(live/'terrain/props.json', lp)
        ws = copy.deepcopy(styles); ws['3']['wallName'] = 'green'; ws['3001']['wallName'] = 'red'
        wl = old_lm + [dict(what=n, id=3000+i if i else 3, distance=0.0) for i, n in enumerate(names)]
        wp = copy.deepcopy(lp); wp['communityBoxes'][0]['modules'] = 2
        wp['communityBoxes'][3] = dict(x=624896.85, y=5103595.12, heading=70.0, modules=4)
        wp['serviceDrops'] = [dict(building=3, x=1.5), drops[1], dict(building=150, x=3.0)]
        dump(work/'terrain/buildings.json', dict(crs='EPSG:2961', buildings=after))
        dump(work/'terrain/manifest.json', dict(buildings=dict(file='buildings.json', count=len(after))))
        dump(work/'terrain/building-styles.json', dict(version=1, styles=ws, landmarks=wl))
        dump(work/'terrain/props.json', wp)
        summary = patch.check(work, live)
        assert summary == dict(buildings=[3, 150, 169, 2001, 2002], restyled=[3, 3001], community=[0, 3], drops=dict(gone=1, new=2)), summary
        cases = [
            ('not LIVE with the Mabou village delta', 'buildings.json', lambda d: d['buildings'][0].update(eave=9.0)),
            ('beyond the Mabou village delta landmarks', 'building-styles.json', lambda d: d['styles']['2000'].update(wallName='pink')),
            ('unmatched', 'building-styles.json', lambda d: d['landmarks'][-1].update(id=None)),
            ('other landmarks changed', 'building-styles.json', lambda d: d['landmarks'][0].update(id=1)),
            ('mailbox or pole', 'props.json', lambda d: d['mailboxes'][0].update(x=5)),
            ('mailbox or pole', 'props.json', lambda d: d['poles'].append(dict(x=9))),
            ('community sites [0, 2, 3]', 'props.json', lambda d: d['communityBoxes'][2].update(modules=2)),
            ('keep its place', 'props.json', lambda d: d['communityBoxes'][0].update(x=11.0)),
            ('community sites [3] changed', 'props.json', lambda d: d['communityBoxes'][0].update(modules=3)),
            ('keep its place', 'props.json', lambda d: d['communityBoxes'][0].update(modules=4)),
            ('the grocery site', 'props.json', lambda d: d['communityBoxes'][3].update(heading=76.0)),
            ('drops changed beyond', 'props.json', lambda d: d['serviceDrops'][1].update(x=9.0)),
        ]
        saved = (work/'terrain/manifest.json').read_bytes(); dump(work/'terrain/manifest.json', dict(buildings=dict(file='buildings.json', count=len(base))))
        try: refused('does not count', patch.check, work, live)
        finally: (work/'terrain/manifest.json').write_bytes(saved)
        for words, name, change in cases:
            path = work/'terrain'/name; saved = path.read_bytes()
            doc = json.loads(saved); change(doc); dump(path, doc)
            try: refused(words, patch.check, work, live)
            finally: path.write_bytes(saved)
        print(f'PASS content rules: corrected buildings only, restyles only on Mabou village delta landmarks, two community sites, drops of 3 and 150; '
              f'{len(cases)} wrong changes refused')
    finally:
        shutil.rmtree(tmp)


def fixture():
    tmp = Path(tempfile.mkdtemp(prefix='mabou-village-delta-land-'))
    try:
        data = tmp/'data'; live = data/'baked'; work = tmp/'work-root/baked'; paved = tmp/'work-root/paved'
        corrections_doc = {'version': 1, 'epsg': 2961, 'features': [{'id': 'old-lot', 'area': 'judique', 'kind': 'lot', 'surface': 'paved',
                           'source': 'synthetic', 'date': '2026-11-17', 'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 0]]]}}]}
        (data/'raw/paved-open').mkdir(parents=True)
        (data/'raw/paved-open/corrections.json').write_bytes((json.dumps(corrections_doc, indent=2)+'\n').encode())
        features = tmp/'features.json'
        dump(features, {'version': 1, 'epsg': 2961, 'features': [{'id': 'new-lot', 'area': 'mabou', 'kind': 'lot', 'surface': 'paved',
                        'source': 'synthetic', 'date': '2026-11-17', 'geometry': {'type': 'Polygon', 'coordinates': [[[5, 5], [9, 5], [9, 9], [5, 5]]]}}]})
        for area in AREAS:
            f = live/patch.area_folder(area)
            dump(f/'manifest.json', {'crs': 'EPSG:2961', 'origin': [0, 0], 'buildings': {'file': 'buildings.json', 'count': 1},
                                     'buildingStyles': {'file': 'building-styles.json', 'count': 1},
                                     'paved': {'file': 'paved/index.json', 'tiles': 2, 'source': patch.paved_patch.SOURCE},
                                     'props': {'file': 'props.json', 'mailboxes': 3}, 'tall': {'file': 'tall.json'}})
            for name in ('buildings.json', 'building-styles.json', 'props.json'): dump(f/name, {'n': 1})
            dump(f/'roads.json', {'roads': []})
            dump(f/'paved/index.json', {'area': area, 'source': patch.paved_patch.SOURCE, 'tiles': ['1_1.r8', '2_2.r8'], 'provenanceSha256': 'old'})
            (f/'paved/1_1.r8').write_bytes(tile(1)); (f/'paved/2_2.r8').write_bytes(tile(2))
        shutil.copytree(live, work)
        mb = work/'terrain'
        for name, value in (('buildings.json', {'n': 2}), ('building-styles.json', {'n': 3}), ('props.json', {'n': 4})): dump(mb/name, value)
        m = json.loads((mb/'manifest.json').read_text()); m['buildings']['count'] = 2; m['props']['mailboxes'] = 4; dump(mb/'manifest.json', m)
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
        bake('mabou', {'1_1.r8': tile(1, 7), '3_3.r8': tile(3)})          # one changed, one new, one gone
        bake('pointtupper', {'1_1.r8': tile(1), '2_2.r8': tile(2)})     # only its index provenance changes
        kw = dict(features=features, areas_=AREAS, validate_files=False)

        report = patch.make(work, paved, live, tmp/'delta', verify=False, **kw)
        receipt = tmp/'hashes.json'; receipt.write_text(json.dumps(report, indent=1)+'\n')
        names = {f['file']: f for f in report['files']}
        assert set(names) == {'terrain/buildings.json', 'terrain/building-styles.json', 'terrain/props.json', 'terrain/paved/index.json',
                              'terrain/paved/1_1.r8', 'terrain/paved/2_2.r8', 'terrain/paved/3_3.r8', 'areas/pointtupper/paved/index.json'}, sorted(names)
        assert names['terrain/paved/2_2.r8']['sha256'] is None and names['terrain/paved/3_3.r8']['before'] is None
        assert [m['folder'] for m in report['manifests']] == ['terrain']
        after = report['manifests'][0]['after']
        assert after['buildings']['count'] == 2 and after['props']['mailboxes'] == 4 and after['paved']['tiles'] == 2 and 'tall' not in after
        assert (tmp/'delta/raw-mirror/data/raw/paved-open/corrections.json').read_bytes() == corr
        paved_receipt = json.loads((tmp/'delta/paved-receipt.json').read_text())
        assert [a['area'] for a in paved_receipt['areas']] == list(AREAS) and paved_receipt['areas'][1]['omitted'] == [3]
        assert paved_receipt['mirror'] == [dict(file=patch.MIRROR, sha256=sha(corr))]
        print('PASS maker: three Mabou files, changed/new/gone tiles, index provenance, owned manifest keys, corrections mirror, paved receipt')
        refused('NEW', patch.make, work, paved, live, tmp/'delta', verify=False, **kw)
        refused('outside data/', patch.make, work, paved, live, data/'delta', verify=False, **kw)
        for label, path, value in [('beyond the Mabou village delta bakes', work/'terrain/roads.json', '{"roads":[1]}\n'),
                                   ('beyond the Mabou village delta bakes', work/'areas/pointtupper/buildings.json', '{"n":9}\n')]:
            saved = path.read_bytes(); path.write_text(value)
            refused(label, patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
            path.write_bytes(saved)
        saved = (mb/'manifest.json').read_bytes(); m = json.loads(saved); m['tall'] = {'file': 'other.json'}; dump(mb/'manifest.json', m)
        refused('beyond the Mabou village delta bakes', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (mb/'manifest.json').write_bytes(saved)
        saved = (mb/'props.json').read_bytes(); (mb/'props.json').write_bytes((live/'terrain/props.json').read_bytes())
        refused('lacks a Mabou village delta bake', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (mb/'props.json').write_bytes(saved)
        saved = (mb/'buildings.json').read_bytes(); (mb/'buildings.json').write_bytes(saved+b' ')
        refused('STALE PAVED BAKE', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (mb/'buildings.json').write_bytes(saved)
        dump(tmp/'other.json', {'version': 1, 'epsg': 2961, 'features': []})
        refused('other corrections', patch.make, work, paved, live, tmp/'delta-x', verify=False, features=tmp/'other.json', areas_=AREAS, validate_files=False)
        shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        bad = copy.deepcopy(report); bad['files'][0]['sha256'] = '0'*64; (tmp/'bad.json').write_text(json.dumps(bad))
        refused('STALE RECEIPT', patch.make, work, paved, live, tmp/'delta-x', verify=True, receipt=tmp/'bad.json', **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        refused('STALE RECEIPT', patch.make, work, paved, live, tmp/'delta-x', verify=True, receipt=receipt, paved_receipt=tmp/'bad.json', **kw)
        shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        intensity = json.loads((paved/'mabou/bake.json').read_text()); saved = (paved/'mabou/bake.json').read_bytes()
        intensity['inputs'].append(dict(path='data/raw/areas/mabou/lidar/intensity.tif', role='road-exclusion', sha256='0'*64)); dump(paved/'mabou/bake.json', intensity)
        refused('forbidden', patch.make, work, paved, live, tmp/'delta-x', verify=False, **kw); shutil.rmtree(tmp/'delta-x', ignore_errors=True)
        (paved/'mabou/bake.json').write_bytes(saved)
        dup = tmp/'dup.json'; dump(dup, {'version': 1, 'epsg': 2961, 'features': corrections_doc['features']})
        refused('already in the live file', patch.compose, (data/'raw/paved-open/corrections.json').read_bytes(), dup)
        # The merge keeps every byte of the live file (here a hand-spaced entry) and appends; canonical in, canonical out.
        live_corr = (data/'raw/paved-open/corrections.json').read_bytes()
        assert patch.compose(live_corr, features) == (json.dumps(json.loads(corr), indent=2)+'\n').encode()
        odd = live_corr.replace(b'"source": "synthetic"', b'"source":   "synthetic"')
        merged = patch.compose(odd, features)
        assert merged.startswith(odd[:-len(b'\n  ]\n}\n')]) and json.loads(merged)['features'][-1]['id'] == 'new-lot'
        for label, bad in [('must close the file', json.dumps(dict(features=[corrections_doc['features'][0]], version=1, epsg=2961), indent=2)+'\n'),
                           ('must close the file', json.dumps(corrections_doc)+'\n'), ('must close the file', json.dumps(dict(corrections_doc, features=[]), indent=2)+'\n')]:
            refused(label, patch.compose, bad.encode(), features)
        print('PASS maker refusals: existing or data/ output, a change beyond the Mabou village delta bakes (file or manifest key), a missing bake, '
              'stale paved bake, other corrections, receipt, intensity input, a lot already in the live file')
        r = json.loads(receipt.read_text())
        assert patch.state(live, r) == 'before'
        tampered = tmp/'delta-t'; shutil.copytree(tmp/'delta', tampered); (tampered/'terrain/props.json').write_text('{}\n')
        refused('Delta file differs', patch.install, tampered, live, receipt=receipt)
        refused('differs from the committed', patch.install, tmp/'delta', live, receipt=tmp/'bad.json')
        saved = (live/'terrain/paved/1_1.r8').read_bytes(); (live/'terrain/paved/1_1.r8').write_bytes(tile(9))
        refused('unknown bytes', patch.install, tmp/'delta', live, receipt=receipt)
        assert (live/'terrain/buildings.json').read_bytes() != (tmp/'delta/terrain/buildings.json').read_bytes(), 'a refused install wrote land'
        (live/'terrain/paved/1_1.r8').write_bytes(saved)
        roads = live/'terrain/roads.json'; saved = roads.read_bytes(); roads.write_text('{"roads":[7]}\n')
        paved_doc = json.loads((tmp/'delta/paved-receipt.json').read_text())
        assert patch.stale_inputs(live, r, paved_doc) == ['terrain/roads.json']
        refused('STALE LAND', patch.install, tmp/'delta', live, receipt=receipt)
        assert patch.state(live, r) == 'before' and not (tmp/'delta/before').exists(), 'a refused install wrote land'
        roads.write_bytes(saved)
        assert patch.stale_inputs(live, r, paved_doc) == [], 'the before land with the owned keys applied must not be stale'
        mf = live/'terrain/manifest.json'; saved = mf.read_bytes(); dump(mf, dict(json.loads(saved), origin=[1, 1]))
        assert patch.stale_inputs(live, r, paved_doc) == ['terrain/manifest.json']
        mf.write_bytes(saved)
        corr_live = data/'raw/paved-open/corrections.json'; saved = corr_live.read_bytes(); corr_live.write_text('{}\n')
        refused('Unexpected live corrections.json', patch.install, tmp/'delta', live, receipt=receipt)
        corr_live.write_bytes(saved)
        for name in ('terrain/props.json', 'terrain/paved/3_3.r8'):
            (live/name).write_bytes((tmp/'delta'/name).read_bytes())
        refused('mixed', patch.state, live, r)
        partial = tmp/'partial/data'; shutil.copytree(data, partial)
        patch.install(tmp/'delta', partial/'baked', receipt=receipt)
        assert patch.state(partial/'baked', r) == 'after' and (partial/'raw/paved-open/corrections.json').read_bytes() == corr
        shutil.rmtree(tmp/'partial'); shutil.rmtree(tmp/'delta/before')
        dump(live/'terrain/props.json', {'n': 1}); (live/'terrain/paved/3_3.r8').unlink()
        assert patch.state(live, r) == 'before'
        m = json.loads((live/'terrain/manifest.json').read_text()); m['tall'] = {'file': 'tall2.json'}; m['cover'] = {'file': 'cover.png'}
        dump(live/'terrain/manifest.json', m)                     # another bake's keys: kept by the install
        patch.install(tmp/'delta', live, receipt=receipt)
        assert patch.state(live, r) == 'after' and not (live/'terrain/paved/2_2.r8').exists()
        assert (tmp/'delta/before/terrain/paved/2_2.r8').read_bytes() == tile(2), 'the replaced bytes must be kept'
        assert json.loads((tmp/'delta/before/terrain/props.json').read_text()) == {'n': 1}, 'the replaced props must be kept'
        corr_live.write_bytes((data/'raw/paved-open/corrections.json.before-1229').read_bytes())
        assert patch.state(live, r) == 'after'; patch.install(tmp/'delta', live, receipt=receipt); assert corr_live.read_bytes() == corr
        after_m = json.loads((live/'terrain/manifest.json').read_text())
        assert after_m['tall'] == {'file': 'tall2.json'} and after_m['cover'] == {'file': 'cover.png'} and after_m['props']['mailboxes'] == 4
        patch.install(tmp/'delta', live, receipt=receipt)   # idempotent
        assert patch.state(live, r) == 'after'
        cases = [('one tile back', lambda b: (b/'terrain/paved/1_1.r8').write_bytes(tile(1)), 'mixed'),
                 ('gone tile back', lambda b: (b/'terrain/paved/2_2.r8').write_bytes(tile(2)), 'mixed'),
                 ('props back', lambda b: dump(b/'terrain/props.json', {'n': 1}), 'mixed'),
                 ('styles back', lambda b: dump(b/'terrain/building-styles.json', {'n': 1}), 'mixed'),
                 ('manifest key back', lambda b: dump(b/'terrain/manifest.json', dict(json.loads((b/'terrain/manifest.json').read_text()),
                                                      buildings={'file': 'buildings.json', 'count': 1}, props={'file': 'props.json', 'mailboxes': 3})), 'mixed'),
                 ('one manifest key back', lambda b: dump(b/'terrain/manifest.json', dict(json.loads((b/'terrain/manifest.json').read_text()),
                                                          props={'file': 'props.json', 'mailboxes': 3})), 'unknown owned manifest keys'),
                 ('unknown buildings', lambda b: dump(b/'terrain/buildings.json', {'n': 7}), 'unknown bytes'),
                 ('unknown index', lambda b: dump(b/'areas/pointtupper/paved/index.json', {}), 'unknown bytes')]
        for label, change, words in cases:
            copyroot = tmp/'case'; shutil.copytree(live, copyroot)
            try:
                change(copyroot); refused(words, patch.state, copyroot, r); print('PASS rejected', label)
            finally: shutil.rmtree(copyroot)
        print('PASS install: refusals (tampered delta, foreign receipt, unknown live bytes, stale road, foreign corrections) write nothing; '
              'a half-done install is finished; replaced bytes kept; other manifest keys kept; gone tile removed; corrections mirrored with the old file kept; idempotent')
    finally:
        shutil.rmtree(tmp)


def land(baked):
    baked = Path(baked)
    report = json.loads(patch.RECEIPT.read_text())
    mode = patch.state(baked, report)
    if EXPECT is not None and mode != EXPECT: raise AssertionError(f'land is {mode}, expected {EXPECT}')
    corr = baked.parent/patch.MIRROR[len('data/'):]
    now = sha(corr.read_bytes()) if corr.is_file() else None
    if now != report['mirror']['before' if mode == 'before' else 'sha256']:
        raise AssertionError(f'land is {mode} but the corrections file is not the {mode} one (install refuses it)')
    if mode == 'before' and sha(patch.compose(corr.read_bytes())) != report['mirror']['sha256']:
        raise AssertionError('the before corrections file plus tools/mabou-village-delta/corrections.json is not the receipt mirror')
    paved = patch.PAVED_RECEIPT.read_bytes()
    if sha(paved) != report['pavedReceiptSha256']: raise AssertionError('tools/paved-open/hashes.json is not the Mabou village delta paved receipt')
    stale = patch.stale_inputs(baked, report, json.loads(paved))
    if stale and mode == 'after': raise AssertionError('installed Mabou village delta tiles are STALE against: '+', '.join(stale[:8]))
    for line in stale: print('WARNING: the delta is stale against', line, '- install refuses it; re-bake and review a new delta')
    # The committed corrections give the receipt's buildings.json: from the before land, or unchanged on the after land.
    doc = json.loads((baked/'terrain/buildings.json').read_bytes())
    made = patch.compact(dict(doc, buildings=mabou_main.correct_buildings(doc['buildings'], 'mabou')))
    want = next(f['sha256'] for f in report['files'] if f['file'] == 'terrain/buildings.json')
    if sha(made) != want: raise AssertionError('pipeline/mabou_main.py does not give the receipt buildings.json from this land')
    props = json.loads((baked/'terrain/props.json').read_bytes())['communityBoxes']
    grocery = dict(x=624896.85, y=5103595.12, heading=70.0, modules=4) if mode == 'after' else dict(x=624905.26, y=5103596.84, heading=76.0, modules=4)
    if props[3] != grocery or props[0]['modules'] != (2 if mode == 'after' else 3):
        raise AssertionError(f'{mode} land: the grocery or post office mailbox site is not the {mode} one')
    kept = [f for f in report['files'] if f['sha256']]
    print(f'PASS Mabou village delta land is {mode} ({len(kept)} files, {len(report["files"]) - len(kept)} tiles removed, {len(report["manifests"])} manifests); '
          f'the corrections give the receipt buildings; grocery site {grocery["x"]}, {grocery["y"]} at {grocery["heading"]}; EXPECT={EXPECT}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--land', action='store_true'); p.add_argument('--land-root', type=Path, default=ROOT/'data/baked')
    a = p.parse_args()
    base, after = corrections()
    content(base, after)
    fixture()
    if a.land: land(a.land_root)
