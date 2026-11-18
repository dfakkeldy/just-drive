#!/usr/bin/env python3
"""Mabou main street land delta (the project brief). The maker writes a NEW folder outside data/; only the main thread installs.

props:   python3 tools/mabou-village-delta/patch.py props WORKROOT LIVE      (writes WORKROOT/data/baked/terrain/props.json)
make:    python3 tools/mabou-village-delta/patch.py make WORK PAVED LIVE NEW [--record]
install: python3 tools/mabou-village-delta/patch.py install NEW LIVE        (main thread only)

LIVE   the live baked root (terrain/ and areas/), with data/raw/paved-open/corrections.json two levels up.
WORK   a rehearsed copy of LIVE (a real checkout's data/baked, terrain as an APFS clone) after, for Mabou:
         python3 pipeline/mabou_main.py data/baked/terrain                   (step 27's Mabou village delta corrections and count)
         AREA=mabou tools/bake.sh 30_bake_building_styles.py                 (step 30: the Mabou village delta landmarks)
         python3 tools/mabou-village-delta/patch.py props <checkout> LIVE             (step 29, see below)
       It may differ from LIVE only in terrain/buildings.json, building-styles.json, props.json and the buildings,
       buildingStyles and props keys of terrain/manifest.json. The maker compares every file of both trees, and checks
       what each of the three files may change (check() below).
PAVED  a six-area output of pipeline/32_bake_paved.py on WORK, read with the corrections that compose() makes: LIVE's
       corrections file plus the features of tools/mabou-village-delta/corrections.json.

Step 29 needs the road lines from before the bed move for its mailbox choices, and the rented mini does not have them.
`props` runs step 29 on WORK with the current lines in their place, then keeps LIVE's mailboxes. That is exact here: the
lines only decide mailboxes, and no mailbox changes (the 120 m cabinet circle at the grocery moves 8.6 m, and no property
enters or leaves it; the corrected buildings keep their property records). check() refuses a mailbox or pole change.

The delta holds the three Mabou files, every changed or new paved file of the six areas (and the list of paved tiles that
go), the owned manifest keys and the composed corrections file. The receipt (hashes.json) pins each file before and
after, so the land check accepts all-before or all-after land and nothing between. The maker also writes the paved receipt
in the format of tools/paved-open/hashes.json (paved-receipt.json), so the paved-open-land row pins the same tiles.
Unless --record, both must equal the committed files.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'pipeline'))
from paved_provenance import validate  # role-scoped path patterns and the denied historical payload hashes
_spec = importlib.util.spec_from_file_location('paved_open_patch', ROOT/'tools/paved-open/patch.py')
paved_patch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(paved_patch)

RECEIPT = ROOT/'tools/mabou-village-delta/hashes.json'
PAVED_RECEIPT = ROOT/'tools/paved-open/hashes.json'
FEATURES = ROOT/'tools/mabou-village-delta/corrections.json'
LEGACY_PAVING_RECEIPT_SHA = '335ba4b26c87b20394945c785d49207ec6cfed07daa7813619920500a8b059ef'
AREAS = paved_patch.AREAS
AREA = 'mabou'
LAND_FILES = ('terrain/buildings.json', 'terrain/building-styles.json', 'terrain/props.json')
OWNED = {'mabou': ('buildings', 'buildingStyles', 'props', 'paved')}   # every other area: ('paved',)
MIRROR = paved_patch.MIRROR      # data/raw/paved-open/corrections.json
# What the Mabou village delta props may change: these community sites (by index in AREA.community_sites) and these drops.
COMMUNITY = {0: 'post office building: modules only', 3: 'grocery store: flush on its east wall'}
DROP_BUILDINGS = {3, 150}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def owned(area):
    return OWNED.get(area, ('paved',))


def keys(manifest_bytes, area):
    doc = json.loads(manifest_bytes)
    return {k: doc.get(k) for k in owned(area)}


def compose(live_bytes, features_path=FEATURES):
    """LIVE's owner corrections with the Mabou village delta lot features merged in: every byte of LIVE is kept, the features are
    appended to its list in the file's own layout (indent 2). Refuses a file it cannot merge into that way."""
    doc = json.loads(live_bytes)
    extra = json.loads(Path(features_path).read_text())
    if doc.get('version') != 1 or doc.get('epsg') != 2961 or extra.get('version') != 1 or extra.get('epsg') != 2961:
        raise ValueError('corrections version/EPSG')
    ids = {f['id'] for f in doc['features']}
    for f in extra['features']:
        if f['id'] in ids: raise ValueError(f'correction {f["id"]} is already in the live file')
    if not extra['features']: return live_bytes
    text, tail = live_bytes.decode(), '\n  ]\n}\n'
    if not doc['features'] or not text.endswith(tail) or list(doc)[-1] != 'features':
        raise ValueError('unexpected corrections.json layout: the features list must close the file')
    blocks = ['\n'.join('    '+line for line in json.dumps(f, indent=2, ensure_ascii=False).split('\n')) for f in extra['features']]
    merged = (text[:-len(tail)] + ',\n' + ',\n'.join(blocks) + tail).encode()
    if json.loads(merged) != dict(doc, features=doc['features'] + extra['features']) or not merged.startswith(live_bytes[:-len(tail)]):
        raise ValueError('unexpected corrections.json layout')
    return merged


def tree(root):
    """Every file below root, by its relative path (links followed, as the game serves them)."""
    out = {}
    for base, dirs, files in os.walk(root, followlinks=True):
        for name in files:
            p = Path(base)/name
            out[p.relative_to(root).as_posix()] = p
    return out


def same(a, b):
    if a.stat().st_size != b.stat().st_size: return False
    with a.open('rb') as x, b.open('rb') as y:
        while True:
            u, v = x.read(1 << 20), y.read(1 << 20)
            if u != v: return False
            if not u: return True


def manifest_drift(work_bytes, live_bytes, area):
    """Keys that differ between two manifests, other than the owned non-paved keys of Mabou."""
    w, l = json.loads(work_bytes), json.loads(live_bytes)
    allowed = set(owned(area)) - {'paved'}
    return sorted(k for k in set(w) | set(l) if w.get(k) != l.get(k) and k not in allowed)


def area_folder(area):
    return paved_patch.folder(area).as_posix()


def compact(doc):
    return (json.dumps(doc, separators=(',', ':'), allow_nan=False)+'\n').encode()


def check(work, live):
    """What each Mabou file may change. Returns a short report; raises ValueError for anything else."""
    from mabou_main import correct_buildings, is_corrected
    lb = json.loads((live/'terrain/buildings.json').read_bytes())
    wb = (work/'terrain/buildings.json').read_bytes()
    if wb != compact(dict(lb, buildings=correct_buildings(lb['buildings'], AREA))):
        raise ValueError('terrain/buildings.json is not LIVE with the Mabou village delta corrections (pipeline/mabou_main.py)')
    buildings = json.loads(wb)['buildings']
    if json.loads((work/'terrain/manifest.json').read_bytes()).get('buildings') != dict(file='buildings.json', count=len(buildings)):
        raise ValueError('terrain/manifest.json: the buildings key does not count terrain/buildings.json')
    changed = sorted(b['id'] for b in buildings if is_corrected(b))
    # Styles: only the buildings that the Mabou village delta landmarks name (and their matches) may change.
    observed = json.loads((ROOT/'pipeline/observed_styles.json').read_text())
    ls, ws = json.loads((live/'terrain/building-styles.json').read_bytes()), json.loads((work/'terrain/building-styles.json').read_bytes())
    names = {lm['what'] for lm in observed['landmarks'] if lm['what'].startswith('Mabou main street landmark:')}
    matched = {m['id'] for m in ws['landmarks'] if m['what'] in names}
    if None in matched or len(matched) != len(names): raise ValueError('a Mabou village delta landmark is unmatched')
    if [m for m in ws['landmarks'] if m['what'] not in names] != ls['landmarks']: raise ValueError('other landmarks changed')
    restyled = sorted(int(k) for k in set(ls['styles']) | set(ws['styles']) if ls['styles'].get(k) != ws['styles'].get(k))
    if set(ls['styles']) != set(ws['styles']) or not set(restyled) <= matched:
        raise ValueError(f'styles changed beyond the Mabou village delta landmarks: {sorted(set(restyled) - matched)}')
    # Props: no mailbox or pole moves; two community sites; the drops of the corrected buildings.
    lp, wp = json.loads((live/'terrain/props.json').read_bytes()), json.loads((work/'terrain/props.json').read_bytes())
    if set(lp) != set(wp) or lp['crs'] != wp['crs'] or lp['mailboxes'] != wp['mailboxes'] or lp['poles'] != wp['poles']:
        raise ValueError('props: a mailbox or pole changed')
    sites = [i for i, (a, b) in enumerate(zip(lp['communityBoxes'], wp['communityBoxes'])) if a != b]
    if len(lp['communityBoxes']) != len(wp['communityBoxes']) or sites != sorted(COMMUNITY):
        raise ValueError(f'props: community sites {sites} changed, expected {sorted(COMMUNITY)}')
    po, grocery = wp['communityBoxes'][0], wp['communityBoxes'][3]
    if {k: v for k, v in po.items() if k != 'modules'} != {k: v for k, v in lp['communityBoxes'][0].items() if k != 'modules'} or po['modules'] != 2:
        raise ValueError('props: the post office site must keep its place and get 2 modules')
    if grocery != dict(x=624896.85, y=5103595.12, heading=70.0, modules=4):
        raise ValueError(f'props: the grocery site is {grocery}')
    key = lambda d: json.dumps(d, sort_keys=True)
    gone = [d for d in lp['serviceDrops'] if key(d) not in {key(e) for e in wp['serviceDrops']}]
    new = [d for d in wp['serviceDrops'] if key(d) not in {key(e) for e in lp['serviceDrops']}]
    if not {d['building'] for d in gone + new} <= DROP_BUILDINGS:
        raise ValueError(f'props: drops changed beyond buildings {sorted(DROP_BUILDINGS)}')
    return dict(buildings=changed, restyled=restyled, community=sites, drops=dict(gone=len(gone), new=len(new)))


def props(checkout, live):
    """Step 29 on WORK (checkout/data/baked) with the current road lines in place of the ones before the bed move, then
    LIVE's mailboxes back in. Writes only the checkout's own terrain/props.json and its manifest props key."""
    checkout, live = Path(checkout).resolve(), Path(live).resolve()
    out = checkout/'data/baked/terrain'
    if out.resolve() == (live/'terrain').resolve() or (checkout/'data/baked').is_symlink() or out.is_symlink():
        raise ValueError('props writes the WORK checkout only: give it its own data/baked/terrain')
    runner = ('import pathlib,runpy,sys; p=pathlib.Path(sys.argv[1]); sys.path.insert(0,str(p)); import road_ground; '
              'road_ground.lines_before=lambda *a,**k: {}; sys.argv=[str(p/"29_bake_props.py")]; '
              'runpy.run_path(str(p/"29_bake_props.py"),run_name="__main__")')
    subprocess.run([sys.executable, '-c', runner, str(checkout/'pipeline')], cwd=checkout, check=True,
                   env=dict(os.environ, MMM_AREA=AREA))
    doc, before = json.loads((out/'props.json').read_bytes()), json.loads((live/'terrain/props.json').read_bytes())
    if doc['poles'] != before['poles']: raise ValueError('step 29 moved poles; this delta does not cover that')
    doc['mailboxes'] = before['mailboxes']
    (out/'props.json').write_bytes(compact(doc))
    manifest = json.loads((out/'manifest.json').read_text())
    manifest['props'] = dict(file='props.json', mailboxes=len(doc['mailboxes']), poles=len(doc['poles']), serviceDrops=len(doc['serviceDrops']))
    (out/'manifest.json').write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
    print(f'props.json: LIVE mailboxes ({len(doc["mailboxes"])}), step-29 community sites, poles ({len(doc["poles"])}) and drops ({len(doc["serviceDrops"])})')


def make(work, paved, live, output, verify=True, receipt=RECEIPT, paved_receipt=PAVED_RECEIPT, features=FEATURES, areas_=AREAS,
         validate_files=True):
    work, paved, live, output = (Path(p).resolve() for p in (work, paved, live, output))
    live_data = live.parent
    if output.exists() or any(output.is_relative_to(p) or p.is_relative_to(output) for p in (work, paved, live, live_data)):
        raise ValueError('Output must be NEW, outside data/, and separate from the work, paved and live roots')
    # 1. WORK is LIVE plus the Mabou village delta bakes: compare every file of both trees.
    w, l = tree(work), tree(live)
    if set(w) != set(l):
        raise ValueError('WORK and LIVE hold different files: '+', '.join(sorted(set(w) ^ set(l))[:8]))
    changed = []
    for name in sorted(w):
        if same(w[name], l[name]): continue
        area = next((a for a in areas_ if name.startswith(area_folder(a)+'/')), None)
        if name in LAND_FILES:
            changed.append(name)
        elif area and name == area_folder(area)+'/manifest.json' and not manifest_drift(w[name].read_bytes(), l[name].read_bytes(), area):
            changed.append(name)
        else:
            raise ValueError(f'WORK differs from LIVE beyond the Mabou village delta bakes: {name}')
    if not set(LAND_FILES) <= set(changed):
        raise ValueError('WORK lacks a Mabou village delta bake: '+', '.join(sorted(set(LAND_FILES) - set(changed))))
    summary = check(work, live) if validate_files else None
    # 2. The composed corrections that the paved bake must have read.
    live_corr = (live_data/MIRROR[len('data/'):]).read_bytes()
    corr = compose(live_corr, features)
    files, manifests, paved_areas = [], [], []

    def add(name, before, after):
        files.append(dict(file=name, before=None if before is None else sha(before), sha256=None if after is None else sha(after),
                          bytes=None if after is None else len(after)))
        if after is not None:
            target = output/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(after)

    output.mkdir(parents=True)
    for name in LAND_FILES:
        add(name, l[name].read_bytes(), w[name].read_bytes())
    for area in areas_:
        bake = json.loads((paved/area/'bake.json').read_text())
        if bake['area'] != area: raise ValueError(f'{area}: paved bake names another area')
        inputs = {}
        for entry in bake['inputs']:
            if any(word in entry['path'].lower() for word in paved_patch.FORBIDDEN): raise ValueError(f'{area}: forbidden input {entry["path"]}')
            validate(entry['path'], entry['role'], entry['sha256'])
            if entry['role'] == 'owner-corrections' and entry['sha256'] != sha(corr):
                raise ValueError(f'{area}: the paved bake read other corrections than LIVE plus tools/mabou-village-delta/corrections.json')
            if entry['path'].startswith('data/baked/'):
                rel = entry['path'][len('data/baked/'):]
                if rel not in w or sha(w[rel].read_bytes()) != entry['sha256']:
                    raise ValueError(f'STALE PAVED BAKE: {entry["path"]} differs from WORK; re-bake the pavement on WORK')
                data = w[rel].read_bytes()
                inputs[rel] = dict(file=rel, lattice=True, sha256=paved_patch.lattice(data)) if rel.endswith('manifest.json') else dict(file=rel, sha256=sha(data))
        if not any(e['role'] == 'owner-corrections' for e in bake['inputs']): raise ValueError(f'{area}: the paved bake read no corrections')
        src = paved/area/'paved'
        index = json.loads((src/'index.json').read_text())
        if index['area'] != area or index['source'] != paved_patch.SOURCE: raise ValueError(f'{area}: index area/source')
        names = ['index.json', *index['tiles']]
        promotion = {Path(p['source']).name: p['sha256'] for p in json.loads((paved/area/'promotion.json').read_text())}
        if sorted(promotion) != sorted(names): raise ValueError(f'{area}: promotion receipt names differ from the index')
        folder = area_folder(area)
        live_paved = {n[len(folder)+len('/paved/'):] for n in l if n.startswith(folder+'/paved/')}
        receipt_files = []
        for name in sorted(names):
            data = (src/name).read_bytes()
            if sha(data) != promotion[name]: raise ValueError(f'{area}: {name} differs from its promotion hash')
            if name != 'index.json' and (len(data) != 128*128 or any(b > 2 for b in data)): raise ValueError(f'{area}: {name} is not a 0/1/2 class tile')
            receipt_files.append(dict(file=f'{folder}/paved/{name}', bytes=len(data), sha256=sha(data)))
            rel = f'{folder}/paved/{name}'
            before = l[rel].read_bytes() if name in live_paved else None
            if before != data: add(rel, before, data)
        for name in sorted(live_paved - set(names)):
            add(f'{folder}/paved/{name}', l[f'{folder}/paved/{name}'].read_bytes(), None)
        key = paved_patch.manifest_key(index)
        mrel = f'{folder}/manifest.json'
        before_keys = keys(l[mrel].read_bytes(), area)
        after_keys = dict(keys(w[mrel].read_bytes(), area), paved=key)
        if before_keys != after_keys:
            manifests.append(dict(folder=folder, before=before_keys, after=after_keys))
        paved_areas.append(dict(area=area, folder=folder, manifestKey=key, files=receipt_files, inputs=[inputs[k] for k in sorted(inputs)],
                                lots_m2=bake['lots_m2'], apron_m2=bake['apron_m2'],
                                omitted=sorted(int(o['id'].rsplit('-', 1)[1]) for o in bake['lot_eligibility'] if o['drop'])))
    (output/'raw-mirror'/MIRROR).parent.mkdir(parents=True, exist_ok=True)
    (output/'raw-mirror'/MIRROR).write_bytes(corr)
    paved_report = dict(version=1, source=paved_patch.SOURCE, licence='https://support.novascotia.ca/services/open-data-portal-licence',
                        areas=paved_areas, mirror=[dict(file=MIRROR, sha256=sha(corr))])
    paved_bytes = (json.dumps(paved_report, indent=1)+'\n').encode()
    (output/'paved-receipt.json').write_bytes(paved_bytes)
    report = dict(version=1, files=sorted(files, key=lambda f: f['file']), manifests=manifests,
                  mirror=dict(file=MIRROR, before=sha(live_corr), sha256=sha(corr)), pavedReceiptSha256=sha(paved_bytes))
    (output/'hashes.json').write_text(json.dumps(report, indent=1)+'\n')
    if verify:
        if report != json.loads(Path(receipt).read_text()):
            raise ValueError('STALE RECEIPT: the delta differs from tools/mabou-village-delta/hashes.json. Do not install; review a new delta.')
        if paved_bytes != Path(paved_receipt).read_bytes():
            raise ValueError('STALE RECEIPT: the paved receipt differs from tools/paved-open/hashes.json. Do not install; review a new delta.')
    kept = [f for f in files if f['sha256']]
    print(f'{len(kept)} files ({sum(f["bytes"] for f in kept):,} bytes), {len(files)-len(kept)} paved tiles removed, '
          f'{len(manifests)} manifests, corrections mirror, in {output}' + (f'; {summary}' if summary else ''))
    return report


def entries(live, report):
    """'before' or 'after' for every receipt file and owned manifest key set; AssertionError for unknown bytes."""
    live = Path(live)
    seen = []
    for f in report['files']:
        if f['before'] == f['sha256']: raise AssertionError(f'receipt entry without a change: {f["file"]}')
        p = live/f['file']
        now = sha(p.read_bytes()) if p.is_file() else None
        if now == f['before']: seen.append('before')
        elif now == f['sha256']: seen.append('after')
        else: raise AssertionError(f'unknown bytes in {f["file"]}')
    for m in report['manifests']:
        area = next(a for a in AREAS if area_folder(a) == m['folder'])
        now = keys((live/m['folder']/'manifest.json').read_bytes(), area)
        if now == m['before']: seen.append('before')
        elif now == m['after']: seen.append('after')
        else: raise AssertionError(f'unknown owned manifest keys in {m["folder"]}')
    return seen


def state(live, report):
    """'before' or 'after' for the whole receipt; AssertionError for a mixed or unknown land."""
    seen = set(entries(live, report))
    if len(seen) != 1: raise AssertionError('mixed land: some files before Mabou village delta, some after')
    return seen.pop()


def stale_inputs(live, report, paved_report):
    """Baked inputs of the paved tiles (roads, tree tiles, manifest lattice, buildings) that changed since the bake.

    The files of this delta are left to state(); a manifest is compared with this delta's owned keys applied, so the
    same land passes before and after the install.
    """
    live, ours, stale = Path(live), {f['file'] for f in report['files']}, []
    after = {m['folder']: m['after'] for m in report['manifests']}
    for area in paved_report['areas']:
        for entry in area['inputs']:
            if entry['file'] in ours: continue
            path = live/entry['file']
            if not path.is_file(): stale.append(entry['file']); continue
            data = path.read_bytes()
            if entry.get('lattice'):
                doc = json.loads(data); doc.update(after.get(entry['file'].rsplit('/', 1)[0], {}))
                value = paved_patch.lattice(json.dumps(doc).encode())
            else: value = sha(data)
            if value != entry['sha256']: stale.append(entry['file'])
    return sorted(set(stale))


def atomic_write(path, data, mode=None):
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            if mode is not None: os.fchmod(f.fileno(), mode)
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def install(delta, live, receipt=RECEIPT):
    """Refuses before writing: a foreign or tampered delta, unknown bytes, stale paved inputs, a foreign corrections file.

    A land where every receipt entry is either before or after (an install that stopped half way) is finished, not
    refused. The bytes it replaces are kept in DELTA/before/ (and corrections.json.before-1229), so it can be undone.
    """
    delta, live = Path(delta).resolve(), Path(live).resolve()
    report = json.loads((delta/'hashes.json').read_text())
    expected = json.loads(Path(receipt).read_text())
    legacy_sha = LEGACY_PAVING_RECEIPT_SHA if Path(receipt).resolve() == RECEIPT else None
    if not paved_patch.matches_receipt(report, expected, legacy_sha):
        raise ValueError('Delta receipt differs from the committed receipt; refusing')
    for f in report['files']:
        if f['sha256'] and sha((delta/f['file']).read_bytes()) != f['sha256']: raise ValueError(f'Delta file differs from receipt: {f["file"]}')
    corr = (delta/'raw-mirror'/MIRROR).read_bytes()
    if sha(corr) != report['mirror']['sha256']: raise ValueError('Delta corrections file differs from the receipt')
    paved_bytes = (delta/'paved-receipt.json').read_bytes()
    if sha(paved_bytes) != report['pavedReceiptSha256']: raise ValueError('Delta paved receipt differs')
    try: seen = set(entries(live, report))   # unknown bytes refuse before anything is written
    except AssertionError as e: raise ValueError(f'{e}; refusing') from None
    stale = stale_inputs(live, report, json.loads(paved_bytes))
    if stale: raise ValueError('STALE LAND: these baked inputs changed since the bake; re-bake and review a new delta: '+', '.join(stale[:8]))
    live_corr = live.parent/MIRROR[len('data/'):]
    now = sha(live_corr.read_bytes()) if live_corr.is_file() else None
    if now not in (report['mirror']['before'], report['mirror']['sha256']):
        raise ValueError('Unexpected live corrections.json: neither the one this delta was made on nor that one with the Mabou village delta lots merged in; refusing')
    if seen == {'after'} and now == report['mirror']['sha256']:
        print('already installed'); return
    if len(seen) > 1: print('finishing an install that stopped half way')
    for f in report['files']:   # keep what is replaced, before any write
        p = live/f['file']
        if f['before'] and p.is_file() and sha(p.read_bytes()) == f['before']:
            keep = delta/'before'/f['file']
            if not keep.is_file() or sha(keep.read_bytes()) != f['before']:   # never trust a truncated or foreign copy
                keep.parent.mkdir(parents=True, exist_ok=True); atomic_write(keep, p.read_bytes())
    for f in report['files']:
        p = live/f['file']
        if f['sha256'] is None:
            if p.exists(): p.unlink()
            continue
        if p.is_file() and sha(p.read_bytes()) == f['sha256']: continue
        p.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(p, (delta/f['file']).read_bytes(), stat.S_IMODE(p.stat().st_mode) if p.exists() else 0o644)
    for m in report['manifests']:
        path = live/m['folder']/'manifest.json'
        before = path.read_bytes()   # read immediately before writing our keys; other bakes own every other key
        doc = json.loads(before)
        doc.update(m['after'])
        atomic_write(path, (json.dumps(doc, separators=(',', ':'))+'\n').encode(), stat.S_IMODE(path.stat().st_mode))
        expected = json.loads(before); expected.update(m['after'])
        if json.loads(path.read_bytes()) != expected: raise RuntimeError(f'{m["folder"]}: manifest changed beyond the owned keys')
    if now != report['mirror']['sha256']:
        # Merge, never replace: the live file plus the Mabou village delta features, every other byte as it is (checked above to be
        # the before file, so the merge is the receipt's file).
        before = live_corr.read_bytes()
        tail = b'\n  ]\n}\n'
        old, new = json.loads(before)['features'], json.loads(corr)['features']
        # The receipt file is the live file with entries appended, byte for byte: write it only when that holds.
        if (not before.endswith(tail) or not corr.startswith(before[:-len(tail)]+b',\n') or new[:len(old)] != old
                or {f['id'] for f in new[len(old):]} & {f['id'] for f in old}):
            raise RuntimeError('the receipt corrections file is not the live one with the Mabou village delta lots merged in')
        merged = corr
        keep = live_corr.with_name(live_corr.name+'.before-1229')
        if not keep.is_file() or sha(keep.read_bytes()) != report['mirror']['before']: atomic_write(keep, before)
        atomic_write(live_corr, merged, stat.S_IMODE(live_corr.stat().st_mode))
    assert state(live, report) == 'after'
    print(f'installed {sum(1 for f in report["files"] if f["sha256"])} files, removed {sum(1 for f in report["files"] if not f["sha256"])}, '
          f'{len(report["manifests"])} manifests and the corrections file into {live} (replaced bytes kept in {delta/"before"}). '
          'Next: packs and site.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('make')
    for name in ('work', 'paved', 'live', 'output'): m.add_argument(name, type=Path)
    m.add_argument('--record', action='store_true', help='write the receipts into the NEW folder for review; never edits the committed ones')
    i = sub.add_parser('install'); i.add_argument('delta', type=Path); i.add_argument('live', type=Path)
    c = sub.add_parser('compose', help='print LIVE corrections plus the Mabou village delta features'); c.add_argument('live_corrections', type=Path)
    s = sub.add_parser('props', help='step 29 on a WORK checkout, keeping LIVE mailboxes'); s.add_argument('checkout', type=Path); s.add_argument('live', type=Path)
    a = p.parse_args()
    if a.cmd == 'make': make(a.work, a.paved, a.live, a.output, verify=not a.record)
    elif a.cmd == 'install': install(a.delta, a.live)
    elif a.cmd == 'props': props(a.checkout, a.live)
    else: sys.stdout.buffer.write(compose(a.live_corrections.read_bytes()))
