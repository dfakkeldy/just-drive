#!/usr/bin/env python3
"""Port Hawkesbury land delta (the project brief). The maker writes a NEW folder outside data/; only the main thread installs.

make:    python3 tools/point-tupper-delta/patch.py make WORK PAVED LIVE NEW [--record]
install: python3 tools/point-tupper-delta/patch.py install NEW LIVE        (main thread only)

LIVE   the live baked root (terrain/ and areas/), with data/raw/paved-open/corrections.json two levels up.
WORK   a rehearsed copy of LIVE after step 27 for pointtupper with MMM_BIG_BUILDINGS=1 (--preserve-sites), then
       step 29 for pointtupper with power_only=True (tools/point-tupper-delta/README.md): the installed mailboxes and poles stay,
       and only the service drops follow the new buildings. It may differ from LIVE only in pointtupper's
       buildings.json, props.json (service drops only) and the buildings and props keys of that manifest; the
       maker compares every file of both trees and refuses anything else. Step 30 is not run here: Point Tupper's
       colours are their own delta (grok-bots #1288), which owns building-styles.json and the buildingStyles key.
PAVED  a six-area output of pipeline/32_bake_paved.py on WORK, read with the corrections that compose() makes: LIVE's
       corrections file plus the features of tools/point-tupper-delta/corrections.json.

The delta holds buildings.json, props.json, every changed or new paved file of the six areas (and the list of paved
tiles that go), the owned manifest keys (buildings, props, paved) and the composed corrections file. The
receipt (hashes.json) pins each file before and after, so the land check accepts all-before or all-after land and
nothing between. The maker also writes the paved receipt in the format of tools/paved-open/hashes.json
(paved-receipt.json), so the paved-open-land row pins the same tiles. Unless --record, both must equal the committed
files. Nothing needs baking after the install. A FULL step 29 is not used: on today's land it would also add the
public poles and mailbox moves that the Industrial Park Road delta (#154) left out, which is a separate change.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'pipeline'))
from paved_provenance import validate  # role-scoped path patterns and the denied historical payload hashes
_spec = importlib.util.spec_from_file_location('paved_open_patch', ROOT/'tools/paved-open/patch.py')
paved_patch = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(paved_patch)

RECEIPT = ROOT/'tools/point-tupper-delta/hashes.json'
PAVED_RECEIPT = ROOT/'tools/paved-open/hashes-point-tupper.json'   # Mabou village delta made the next receipt (hashes.json)
FEATURES = ROOT/'tools/point-tupper-delta/corrections.json'
LEGACY_PAVING_RECEIPT_SHA = 'dd3e4ac36dd073df0fa21ed10c3c5058f3c58f2c28cf4c03ba761cb6ba396877'
AREAS = paved_patch.AREAS
AREA = 'pointtupper'
BUILDING_FILES = ('areas/pointtupper/buildings.json', 'areas/pointtupper/props.json')
OWNED = {'pointtupper': ('buildings', 'props', 'paved')}   # every other area: ('paved',)
MIRROR = paved_patch.MIRROR      # data/raw/paved-open/corrections.json
def sha(data):
    return hashlib.sha256(data).hexdigest()


def owned(area):
    return OWNED.get(area, ('paved',))


def keys(manifest_bytes, area):
    doc = json.loads(manifest_bytes)
    return {k: doc.get(k) for k in owned(area)}


def compose(live_bytes, features_path=FEATURES):
    """LIVE's owner corrections plus the Point Tupper delta lot features, in the live file's own format (indent 2)."""
    doc = json.loads(live_bytes)
    extra = json.loads(Path(features_path).read_text())
    if doc.get('version') != 1 or doc.get('epsg') != 2961 or extra.get('version') != 1 or extra.get('epsg') != 2961:
        raise ValueError('corrections version/EPSG')
    ids = {f['id'] for f in doc['features']}
    for f in extra['features']:
        if f['id'] in ids: raise ValueError(f'correction {f["id"]} is already in the live file')
    doc['features'] = doc['features'] + extra['features']
    return (json.dumps(doc, indent=2, ensure_ascii=False)+'\n').encode()


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
    """Keys that differ between two manifests, other than the owned buildings and props keys of pointtupper."""
    w, l = json.loads(work_bytes), json.loads(live_bytes)
    allowed = {'buildings', 'props'} if area == AREA else set()
    return sorted(k for k in set(w) | set(l) if w.get(k) != l.get(k) and k not in allowed)


def area_folder(area):
    return paved_patch.folder(area).as_posix()


def make(work, paved, live, output, verify=True, receipt=RECEIPT, paved_receipt=PAVED_RECEIPT, features=FEATURES, areas_=AREAS):
    work, paved, live, output = (Path(p).resolve() for p in (work, paved, live, output))
    live_data = live.parent
    if output.exists() or any(output.is_relative_to(p) or p.is_relative_to(output) for p in (work, paved, live, live_data)):
        raise ValueError('Output must be NEW, outside data/, and separate from the work, paved and live roots')
    # 1. WORK is LIVE plus the switch: compare every file of both trees.
    w, l = tree(work), tree(live)
    if set(w) != set(l):
        raise ValueError('WORK and LIVE hold different files: '+', '.join(sorted(set(w) ^ set(l))[:8]))
    changed = []
    for name in sorted(w):
        if same(w[name], l[name]): continue
        area = next((a for a in areas_ if name.startswith(area_folder(a)+'/')), None)
        if name in BUILDING_FILES:
            if name.endswith('props.json'):
                a, b = json.loads(w[name].read_bytes()), json.loads(l[name].read_bytes())
                moved = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k) and k != 'serviceDrops')
                if moved: raise ValueError(f'WORK props differ beyond the service drops: {moved} (run step 29 with power_only)')
            changed.append(name)
        elif area and name == area_folder(area)+'/manifest.json' and not manifest_drift(w[name].read_bytes(), l[name].read_bytes(), area):
            changed.append(name)
        else:
            raise ValueError(f'WORK differs from LIVE beyond the switch: {name}')
    if BUILDING_FILES[0] not in changed:
        raise ValueError('WORK has no new buildings: run step 27 with MMM_BIG_BUILDINGS=1 first')
    if BUILDING_FILES[1] not in changed:
        raise ValueError('WORK props were not re-run after step 27: run step 29 with power_only for the new service drops')
    props, man = json.loads(w[BUILDING_FILES[1]].read_bytes()), json.loads(w[area_folder(AREA)+'/manifest.json'].read_bytes())['props']
    if [man.get(k) for k in ('mailboxes', 'poles', 'serviceDrops')] != [len(props[k]) for k in ('mailboxes', 'poles', 'serviceDrops')]:
        raise ValueError('WORK manifest props counts differ from props.json')
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
    for name in BUILDING_FILES:
        add(name, l[name].read_bytes(), w[name].read_bytes())
    for area in areas_:
        bake = json.loads((paved/area/'bake.json').read_text())
        if bake['area'] != area: raise ValueError(f'{area}: paved bake names another area')
        inputs = {}
        for entry in bake['inputs']:
            if any(word in entry['path'].lower() for word in paved_patch.FORBIDDEN): raise ValueError(f'{area}: forbidden input {entry["path"]}')
            validate(entry['path'], entry['role'], entry['sha256'])
            if entry['role'] == 'owner-corrections' and entry['sha256'] != sha(corr):
                raise ValueError(f'{area}: the paved bake read other corrections than LIVE plus tools/point-tupper-delta/corrections.json')
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
            if name != 'index.json' and (len(data) != 128*128 or any(b > 1 for b in data)): raise ValueError(f'{area}: {name} is not a 0/1 class tile')
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
            raise ValueError('STALE RECEIPT: the delta differs from tools/point-tupper-delta/hashes.json. Do not install; review a new delta.')
        if paved_bytes != Path(paved_receipt).read_bytes():
            raise ValueError('STALE RECEIPT: the paved receipt differs from tools/paved-open/hashes.json. Do not install; review a new delta.')
    kept = [f for f in files if f['sha256']]
    print(f'{len(kept)} files ({sum(f["bytes"] for f in kept):,} bytes), {len(files)-len(kept)} paved tiles removed, '
          f'{len(manifests)} manifests, corrections mirror, in {output}')
    return report


def entries(live, report, later=()):
    """'before' or 'after' for every receipt file and owned manifest key set; AssertionError for unknown bytes."""
    live = Path(live)
    seen = []
    for f in report['files']:
        if f['before'] == f['sha256']: raise AssertionError(f'receipt entry without a change: {f["file"]}')
        p = live/f['file']
        now = sha(p.read_bytes()) if p.is_file() else None
        now = paved_patch.before_file(f['file'], now, later)
        if now == f['before']: seen.append('before')
        elif now == f['sha256']: seen.append('after')
        else: raise AssertionError(f'unknown bytes in {f["file"]}')
    for m in report['manifests']:
        area = next(a for a in AREAS if area_folder(a) == m['folder'])
        now = paved_patch.before_keys(m['folder'], keys((live/m['folder']/'manifest.json').read_bytes(), area), later)
        if now == m['before']: seen.append('before')
        elif now == m['after']: seen.append('after')
        else: raise AssertionError(f'unknown owned manifest keys in {m["folder"]}')
    return seen


def state(live, report, later=()):
    """'before' or 'after' for the whole receipt; AssertionError for a mixed or unknown land."""
    seen = set(entries(live, report, later))
    if len(seen) != 1: raise AssertionError('mixed land: some files before Point Tupper delta, some after')
    return seen.pop()


def stale_inputs(live, report, paved_report, later=()):
    """Baked inputs of the paved tiles (roads, tree tiles, manifest lattice, buildings) that changed since the bake.

    The files of this delta are left to state(); a manifest is compared with this delta's owned keys applied, so the
    same land passes before and after the install. A file at a later delta's exact after bytes is that delta's own
    business (its receipt pins it), and a manifest is read with the later delta's owned keys undone.
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
                folder = entry['file'].rsplit('/', 1)[0]
                doc = paved_patch.before_keys(folder, json.loads(data), later); doc.update(after.get(folder, {}))
                value = paved_patch.lattice(json.dumps(doc).encode())
            else:
                value = sha(data)
                if paved_patch.before_file(entry['file'], value, later) != value: continue
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
    refused. The bytes it replaces are kept in DELTA/before/ (and corrections.json.before-1227), so it can be undone.
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
    if now not in (report['mirror']['before'], report['mirror']['sha256']): raise ValueError('Live corrections file is neither before nor after; refusing')
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
        if live_corr.exists():
            keep = live_corr.with_name(live_corr.name+'.before-1227')
            if not keep.is_file() or sha(keep.read_bytes()) != report['mirror']['before']: atomic_write(keep, live_corr.read_bytes())
        atomic_write(live_corr, corr, 0o644)
    assert state(live, report) == 'after'
    print(f'installed {sum(1 for f in report["files"] if f["sha256"])} files, removed {sum(1 for f in report["files"] if not f["sha256"])}, '
          f'{len(report["manifests"])} manifests and the corrections file into {live} (replaced bytes kept in {delta/"before"}). '
          'Next: packs and site (no bake is needed).')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('make')
    for name in ('work', 'paved', 'live', 'output'): m.add_argument(name, type=Path)
    m.add_argument('--record', action='store_true', help='write the receipts into the NEW folder for review; never edits the committed ones')
    i = sub.add_parser('install'); i.add_argument('delta', type=Path); i.add_argument('live', type=Path)
    c = sub.add_parser('compose', help='print LIVE corrections plus the Point Tupper delta features'); c.add_argument('live_corrections', type=Path)
    a = p.parse_args()
    if a.cmd == 'make': make(a.work, a.paved, a.live, a.output, verify=not a.record)
    elif a.cmd == 'install': install(a.delta, a.live)
    else: sys.stdout.buffer.write(compose(a.live_corrections.read_bytes()))
