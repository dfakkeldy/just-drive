#!/usr/bin/env python3
"""Open pavement land delta (initial paving delta). The maker writes a NEW folder; only the main thread installs.

make:    python3 tools/paved-open/patch.py make WORK BAKED NEW_FOLDER [--record]
install: python3 tools/paved-open/patch.py install NEW_FOLDER BAKED      (main thread only)

WORK is a six-area output of pipeline/32_bake_paved.py (or pipeline/paved_work.py).
BAKED is the live baked root holding terrain/ and areas/. The maker reads both and
writes paved/ tiles, paved/index.json and the one manifest key into NEW_FOLDER,
outside data/. It refuses a work bake whose baked inputs differ from BAKED, and,
unless --record, any result that differs from the committed tools/paved-open/hashes.json.

Owner lot corrections (data/raw/paved-open/corrections.json) are copied to raw-mirror/ and pinned;
install writes it into data/raw (keeping the old file as corrections.json.before-1212) so a later re-bake
reproduces the delta.
The install refuses stale land (any baked road, building, tree-tile or manifest-lattice input that changed
since the bake), copies only the new paved/ files (refusing to replace a different file)
and then adds the single `paved` key to each CURRENT manifest by a temporary file and
a rename, like the cemetery bake: other bakes own every other manifest key.
No intensity, OSM or old paved-layer input can enter: the work bake's own guards
and pipeline/paved-denied-sha256.json refuse them, and this script re-checks paths.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools'))
sys.path.insert(0, str(ROOT/'pipeline'))
from land_receipt_pins import previous_digest
from paved_provenance import validate  # role-scoped path patterns and the denied historical payload hashes
RECEIPT = ROOT/'tools/paved-open/hashes.json'
REFRESH = ROOT/'tools/paved-open/hashes-refresh.json'
# Verified Point Tupper road 107 width delta: re-baking all 117 Point Tupper paved tiles on its roads.json
# produces byte-for-byte identical .r8 tiles (only provenanceSha256 in index.json depends on the roads.json hash).
INDUSTRIAL_WIDTH = ROOT/'tools/industrial-surface/width-hashes.json'
AREAS = ('mabou', 'judique', 'porthood', 'westbay', 'pointtupper', 'cansocauseway')
SOURCE = 'nstdb-designated-open-v1'
FORBIDDEN = ('intensity', 'lidar', '.laz', '.las', '/data/work/threads/paved/', '/data/work/bakes/paved-layer', 'osm.json')
MIRROR = 'data/raw/paved-open/corrections.json'
# Manifest fields the bake reads; other bakes own every other key, so only these make a tile stale.
LATTICE = ('origin', 'mid', 'size', 'tile', 'village', 'buildings', 'trees')  # village: read by the hand-site catalog


def folder(area):
    return Path('terrain' if area == 'mabou' else f'areas/{area}')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def manifest_key(index):
    return dict(file='paved/index.json', tiles=len(index['tiles']), source=SOURCE)


def lattice(manifest_bytes):
    doc = json.loads(manifest_bytes)
    return sha(json.dumps({k: doc.get(k) for k in LATTICE}, sort_keys=True).encode())


def _industrial_width_stands_for(relative, digest):
    """Map Point Tupper road 107 width delta's exact after-hash of roads.json back to its before-hash."""
    if relative != 'areas/pointtupper/roads.json' or not INDUSTRIAL_WIDTH.is_file():
        return digest
    report = json.loads(INDUSTRIAL_WIDTH.read_text())
    return previous_digest(report, 'roads.json', digest, default=digest)


def stale_inputs(report, baked):
    """Baked inputs that changed since the bake: tiles cut against old roads, roofs or trees."""
    stale = []
    for area in report['areas']:
        for entry in area['inputs']:
            path = Path(baked)/entry['file']
            if not path.is_file(): stale.append(entry['file']); continue
            data = path.read_bytes()
            value = lattice(data) if entry.get('lattice') else _industrial_width_stands_for(entry['file'], sha(data))
            if value != entry['sha256']: stale.append(entry['file'])
    return sorted(set(stale))


def receipt_entries(receipt):
    for area in receipt['areas']:
        for f in area['files']:
            yield area, f


def area_matches(baked, area):
    folder = baked/area['folder']/'paved'
    files = {f['file']: f['sha256'] for f in area['files']}
    return (folder.is_dir()
            and {p.relative_to(baked).as_posix() for p in folder.iterdir()} == files.keys()
            and all(sha((baked/name).read_bytes()) == digest for name, digest in files.items()))


def refresh_installed(baked):
    """Recognize the full refreshed pavement, and check its current inputs."""
    report = json.loads(REFRESH.read_text())
    for area in report['areas']:
        path = baked/area['folder']/'manifest.json'
        if not path.is_file():
            return False
        manifest = json.loads(path.read_bytes())
        if manifest.get('paved') != area['manifestKey'] or not area_matches(baked, area):
            return False
    stale = stale_inputs(report, baked)
    if stale:
        raise AssertionError('refreshed pavement is STALE against: '+', '.join(stale))
    for m in report['mirror']:
        if sha((baked.parent.parent/m['file']).read_bytes()) != m['sha256']:
            raise AssertionError('corrections file differs from the refreshed pavement receipt')
    return True


def refresh_delta():
    """The exact transition from the Mabou village pavement to the refresh."""
    before = json.loads(RECEIPT.read_text())
    after = json.loads(REFRESH.read_text())
    assert before['mirror'] == after['mirror']
    old = {f['file']: f['sha256'] for _, f in receipt_entries(before)}
    new = {f['file']: f['sha256'] for _, f in receipt_entries(after)}
    files = [dict(file=name, before=old.get(name), sha256=new.get(name))
             for name in sorted(old.keys() | new.keys()) if old.get(name) != new.get(name)]
    keys = {a['folder']: a['manifestKey'] for a in before['areas']}
    manifests = [dict(folder=a['folder'], before={'paved': keys[a['folder']]}, after={'paved': a['manifestKey']})
                 for a in after['areas'] if keys[a['folder']] != a['manifestKey']]
    return dict(files=files, manifests=manifests)


def before_file(name, digest, later):
    """Walk back exact file pins through later receipts, newest first."""
    for report in reversed(later):
        digest = previous_digest(report, name, digest, default=digest)
    return digest


def before_keys(folder, doc, later):
    """Walk back the manifest keys or counts that later receipts own."""
    doc = dict(doc)
    for report in reversed(later):
        for m in report['manifests']:
            if folder != m['folder']:
                continue
            for key in doc.keys() & m['before'].keys() & m['after'].keys():
                after, before = m['after'][key], m['before'][key]
                if doc[key] == after:
                    doc[key] = before
                elif after.keys() == {'count'} and doc[key].get('count') == after['count']:
                    doc[key] = dict(doc[key], count=before['count'])
    return doc


def record(work, baked, areas_=AREAS):
    """Read a work bake and record its checked payload and baked inputs."""
    areas = []
    for area in areas_:
        bake = json.loads((work/area/'bake.json').read_text())
        if bake['area'] != area: raise ValueError(f'{area}: work bake names another area')
        inputs = {}
        for entry in bake['inputs']:
            text = entry['path'].lower()
            if any(word in text for word in FORBIDDEN): raise ValueError(f'{area}: forbidden input {entry["path"]}')
            validate(entry['path'], entry['role'], entry['sha256'])
            prefix = 'data/baked/'
            if entry['path'].startswith(prefix):
                relative = entry['path'][len(prefix):]
                current = baked/relative
                if not current.is_file() or sha(current.read_bytes()) != entry['sha256']:
                    raise ValueError(f'STALE WORK BAKE: {entry["path"]} changed since the bake; re-bake on current land')
                data = current.read_bytes()
                inputs[relative] = dict(file=relative, lattice=True, sha256=lattice(data)) if relative.endswith('manifest.json') else dict(file=relative, sha256=sha(data))
        src = work/area/'paved'
        index = json.loads((src/'index.json').read_text())
        if index['area'] != area or index['source'] != SOURCE: raise ValueError(f'{area}: index area/source')
        names = ['index.json', *index['tiles']]
        promotion = {Path(p['source']).name: p['sha256'] for p in json.loads((work/area/'promotion.json').read_text())}
        if sorted(promotion) != sorted(names): raise ValueError(f'{area}: promotion receipt names differ from the index')
        if {p.name for p in src.iterdir()} != set(names): raise ValueError(f'{area}: extra or missing paved files')
        files = []
        for name in sorted(names):
            data = (src/name).read_bytes()
            if sha(data) != promotion[name]: raise ValueError(f'{area}: {name} differs from its promotion hash')
            if name != 'index.json' and (len(data) != 128*128 or any(b > 2 for b in data)): raise ValueError(f'{area}: {name} is not a 0/1/2 class tile')
            files.append(dict(file=(folder(area)/'paved'/name).as_posix(), bytes=len(data), sha256=sha(data)))
        key = manifest_key(index)
        areas.append(dict(area=area, folder=folder(area).as_posix(), manifestKey=key, files=files, inputs=[inputs[k] for k in sorted(inputs)],
                          lots_m2=bake['lots_m2'], apron_m2=bake['apron_m2'], omitted=sorted(int(o['id'].rsplit('-', 1)[1]) for o in bake['lot_eligibility'] if o['drop'])))
    # Owner lot corrections are a bake input in raw/: copy them so the main thread mirrors the exact file.
    mirror = {}
    for area in areas_:
        for entry in json.loads((work/area/'bake.json').read_text())['inputs']:
            if entry['role'] == 'owner-corrections': mirror[entry['path']] = entry['sha256']
    if len(set(mirror.values())) > 1: raise ValueError('Areas were baked with different correction files')
    if set(mirror) - {MIRROR}: raise ValueError('Unexpected correction path')
    for path, value in mirror.items():
        data = (baked.parent.parent/path).read_bytes()
        if sha(data) != value: raise ValueError(f'STALE WORK BAKE: {path} changed since the bake')
    return dict(version=1, source=SOURCE, licence='https://support.novascotia.ca/services/open-data-portal-licence', areas=areas,
                mirror=[dict(file=p, sha256=v) for p, v in sorted(mirror.items())])


def make(work, baked, output, verify=True, receipt=RECEIPT, areas_=AREAS, live=ROOT/'data'):
    work, baked, output = work.resolve(), baked.resolve(), output.resolve()
    live = Path(live).resolve()
    if output.exists() or output.is_relative_to(baked) or baked.is_relative_to(output) or output.is_relative_to(live) or output.is_relative_to(work):
        raise ValueError('Output must be NEW, outside data/, and separate from the work and baked roots')
    for area in areas_:
        manifest = json.loads((baked/folder(area)/'manifest.json').read_bytes())
        if 'paved' in manifest: raise ValueError(f'{area}: live manifest already lists paved; nothing to make')
        if (baked/folder(area)/'paved').exists(): raise ValueError(f'{area}: live paved/ already exists')
    report = record(work, baked, areas_)
    if verify:
        committed = json.loads(Path(receipt).read_text())
        if report != committed:
            raise ValueError('STALE RECEIPT: generated files differ from tools/paved-open/hashes.json. Do not install; review a new delta.')
    for area, f in receipt_entries(report):
        target = output/f['file']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(work/area['area']/'paved'/target.name, target)
    for area in report['areas']:
        (output/area['folder']/'manifest-key.json').write_text(json.dumps(dict(paved=area['manifestKey']), separators=(',', ':'))+'\n')
    for m in report['mirror']:
        target = output/'raw-mirror'/m['file']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(baked.parent.parent/m['file'], target)
    (output/'hashes.json').write_text(json.dumps(report, indent=1)+'\n')
    areas = report['areas']
    total = sum(f['bytes'] for _, f in receipt_entries(report))
    print(f'{sum(len(a["files"]) for a in areas)} files, {total:,} bytes in {output}')
    return report


def atomic_json(path, data):
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            os.fchmod(f.fileno(), stat.S_IMODE(path.stat().st_mode))
            json.dump(data, f, separators=(',', ':')); f.write('\n')
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def matches_receipt(actual, expected, legacy_paving_sha=None):
    """Compare prepared deltas after removing their retired tracker metadata."""
    actual = {key: value for key, value in actual.items() if key != 'issue'}
    if isinstance(actual.get('replaces'), dict):
        actual['replaces'] = {key: value for key, value in actual['replaces'].items() if key != 'issue'}
    if legacy_paving_sha and actual.get('pavedReceiptSha256') == legacy_paving_sha:
        # The installer still validates the original paving file against this legacy digest.
        actual['pavedReceiptSha256'] = expected.get('pavedReceiptSha256')
    return actual == expected


def install(delta, baked, receipt=RECEIPT):
    delta, baked = delta.resolve(), baked.resolve()
    report = json.loads((delta/'hashes.json').read_text())
    if not matches_receipt(report, json.loads(Path(receipt).read_text())): raise ValueError('Delta receipt differs from the committed receipt; refusing')
    for area, f in receipt_entries(report):
        data = (delta/f['file']).read_bytes()
        if sha(data) != f['sha256']: raise ValueError(f'Delta file differs from receipt: {f["file"]}')
        live = baked/f['file']
        if live.exists() and sha(live.read_bytes()) != f['sha256']: raise ValueError(f'Live file differs; refusing to replace {live}')
    stale = stale_inputs(report, baked)
    if stale: raise ValueError('STALE LAND: these baked inputs changed since the bake; re-bake the pavement and review a new receipt: '+', '.join(stale[:8]))
    for m in report['mirror']:
        if m['file'] != MIRROR or sha((delta/'raw-mirror'/m['file']).read_bytes()) != m['sha256']: raise ValueError('Delta corrections file differs from the receipt')
    for area in report['areas']:
        manifest = json.loads((baked/area['folder']/'manifest.json').read_bytes())
        if manifest.get('paved', area['manifestKey']) != area['manifestKey']: raise ValueError(f'{area["area"]}: live manifest has another paved key')
    for area, f in receipt_entries(report):
        live = baked/f['file']
        if live.exists(): continue
        live.parent.mkdir(parents=True, exist_ok=True)
        tmp = live.with_name('.'+live.name+'.part')
        tmp.write_bytes((delta/f['file']).read_bytes()); os.replace(tmp, live)
    for area in report['areas']:
        path = baked/area['folder']/'manifest.json'
        before = path.read_bytes()   # read immediately before adding our key
        manifest = json.loads(before); manifest['paved'] = area['manifestKey']
        atomic_json(path, manifest)
        expected = json.loads(before); expected['paved'] = area['manifestKey']
        if json.loads(path.read_bytes()) != expected: raise RuntimeError(f'{area["area"]}: manifest changed beyond the paved key')
    # Mirror the owner corrections so a later re-bake reproduces this land; keep the old file beside it.
    for m in report['mirror']:
        live = baked.parent/m['file'][len('data/'):]
        data = (delta/'raw-mirror'/m['file']).read_bytes()
        if live.exists() and sha(live.read_bytes()) == m['sha256']: continue
        if live.exists(): shutil.copy2(live, live.with_name(live.name+'.before-1212'))
        live.parent.mkdir(parents=True, exist_ok=True)
        tmp = live.with_name('.'+live.name+'.part'); tmp.write_bytes(data); os.replace(tmp, live)
    print('installed', sum(len(a['files']) for a in report['areas']), 'files,', len(report['areas']), 'manifest keys and the corrections mirror into', baked)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('make'); m.add_argument('work', type=Path); m.add_argument('baked', type=Path); m.add_argument('output', type=Path)
    m.add_argument('--record', action='store_true', help='write a changed receipt into the NEW folder for review; never edits the committed receipt')
    i = sub.add_parser('install'); i.add_argument('delta', type=Path); i.add_argument('baked', type=Path)
    a = p.parse_args()
    if a.cmd == 'make': make(a.work, a.baked, a.output, verify=not a.record)
    else: install(a.delta, a.baked)
