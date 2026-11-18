#!/usr/bin/env python3
"""Judique lot delta (the project brief): replaces ONLY Judique's paved/ folder and its manifest `paved` key, and
composes the owner corrections file. The maker writes a NEW folder outside data/; only the main thread installs.

make:    python3 tools/paved-open/judique_lots.py make WORK_AREA BAKED NEW_FOLDER [--record]
install: python3 tools/paved-open/judique_lots.py install NEW_FOLDER BAKED          (main thread only)
state:   python3 tools/paved-open/judique_lots.py state BAKED            (before | after | half | pre-1227; never mixed)
compose: python3 tools/paved-open/judique_lots.py compose LIVE_CORRECTIONS   (prints the composed file)

The corrections file is composed, never replaced: the live (post-Point Tupper delta) file with the Judique entries of
tools/paved-open/judique-lots-corrections.json put in (an entry with the same id is replaced in place; new ones are
appended). Every other entry stays byte-identical: compose refuses a live file that does not re-serialise to its own
bytes. WORK_AREA is `<output>/judique` of pipeline/32_bake_paved.py run with that composed file as
data/raw/paved-open/corrections.json. BAKED is the live baked root (terrain/ and areas/), with
data/raw/paved-open/corrections.json beside it.
'before' is the Point Tupper delta land (tools/paved-open/hashes-point-tupper.json) for Judique; 'after' is this receipt
(tools/paved-open/judique-lots.json); 'pre-1227' is the older initial paving delta land (tools/paved-open/hashes-initial.json): install
Point Tupper delta first. The five other areas are never read or written here.

install: refuses a delta that differs from the committed receipt, land that is not before or after, stale baked
inputs (roads, buildings, tree tiles, manifest lattice) and a corrections file that is neither the post-Point Tupper delta file
(the receipt's `before`, and composing to the delta's file) nor this one. It builds the new paved/ beside the old one, swaps them by renames, keeps the old folder in
data/work/paved-before-1219/, rewrites only the manifest `paved` key (temporary file and rename), and writes the
corrections mirror (old file kept as corrections.json.before-1219). Run again: it does nothing (idempotent).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import patch  # noqa: E402  (initial paving delta: folder, lattice, stale_inputs, atomic_json, FORBIDDEN, validate)

ROOT = HERE.parents[1]
ARCHIVED_RECEIPT = HERE/'judique-lots.json'
RECEIPT = ARCHIVED_RECEIPT
BEFORE = HERE/'hashes-point-tupper.json'     # the Point Tupper delta paved receipt (Mabou village delta made the next one, hashes.json)
# Later deltas that replace Judique files of this one (Mabou village delta rewrites the index provenance): a file at a later delta's
# exact after bytes counts as the bytes that delta replaced. Their own checks pin them.
LATER = (ROOT/'tools/mabou-village-delta/hashes.json',)
PRE_1227 = HERE/'hashes-initial.json'   # the land before Point Tupper delta
CORRECTIONS = HERE/'judique-lots-corrections.json'
AREA, FOLDER = 'judique', 'areas/judique'
MIRROR = patch.MIRROR


def sha(data): return hashlib.sha256(data).hexdigest()


def before_receipt(path=None):
    """The Judique entry and corrections mirror of a paved receipt (default: Point Tupper delta, the land this delta replaces)."""
    doc = json.loads(Path(path or BEFORE).read_text())
    return dict(area=next(a for a in doc['areas'] if a['area'] == AREA), mirror=doc['mirror'])


def compose(live_bytes, features_path=None):
    """The live corrections with this delta's Judique entries put in, in the live file's own format (indent 2)."""
    doc = json.loads(live_bytes)
    if (json.dumps(doc, indent=2, ensure_ascii=False)+'\n').encode() != live_bytes:
        raise ValueError('the live corrections file does not re-serialise to its own bytes; refusing to compose')
    mine = json.loads(Path(features_path or CORRECTIONS).read_text())
    for d in (doc, mine):
        if d.get('version') != 1 or d.get('epsg') != 2961: raise ValueError('corrections version/EPSG')
    if any(f['area'] != AREA or not f['id'].startswith('judique-') for f in mine['features']): raise ValueError('Judique lots delta entries are Judique only')
    by_id = {f['id']: f for f in mine['features']}
    if len(by_id) != len(mine['features']): raise ValueError('duplicate Judique lots delta id in '+str(features_path or CORRECTIONS))
    out = [by_id.pop(f['id'], f) for f in doc['features']]
    doc['features'] = out+[f for f in mine['features'] if f['id'] in by_id]
    return (json.dumps(doc, indent=2, ensure_ascii=False)+'\n').encode()


def files_match(baked, entry):
    """True when Judique's paved/ folder holds exactly this receipt entry's files."""
    baked = Path(baked)
    folder = baked/FOLDER/'paved'
    present = {p.relative_to(baked).as_posix() for p in folder.iterdir()} if folder.is_dir() else set()
    names = {f['file']: f['sha256'] for f in entry['files']}
    later = {}
    for path in LATER:
        if path.is_file():
            for f in json.loads(path.read_text())['files']:
                if f['sha256'] and f['before']: later[f['file']] = (f['sha256'], f['before'])
    def now(n):
        value = sha((baked/n).read_bytes())
        return later[n][1] if n in later and value == later[n][0] else value
    return present == set(names) and all(now(n) == v for n, v in names.items())


def state(baked, after=None):
    """'before' (the Point Tupper delta Judique land), 'pre-1227' (the older initial paving delta land: install Point Tupper delta first), 'after' (this receipt), or 'half': the new files with the old manifest key,
    an install cut short between its folder swap and its key write (run install again to finish). Anything else raises."""
    after = after or json.loads(Path(RECEIPT).read_text())
    before = before_receipt()['area']
    key = json.loads((Path(baked)/FOLDER/'manifest.json').read_bytes()).get('paved')
    if files_match(baked, after['area']):
        if key == after['area']['manifestKey']: return 'after'
        if key == before['manifestKey']: return 'half'
    elif files_match(baked, before) and key == before['manifestKey']: return 'before'
    else:
        older = before_receipt(PRE_1227)['area']
        if files_match(baked, older) and key == older['manifestKey']: return 'pre-1227'
    raise AssertionError('Judique paved land is neither the Point Tupper delta land nor the Judique lots delta delta (mixed or unknown files)')


def make(work, baked, output, verify=True, receipt=None, corrections=None, data=ROOT/'data'):
    """`data` is this checkout's data folder (a fixture passes its own: the check runner's TMPDIR may sit under data/)."""
    receipt, corrections = receipt or RECEIPT, corrections or CORRECTIONS
    work, baked, output = Path(work).resolve(), Path(baked).resolve(), Path(output).resolve()
    live = baked.parent
    if output.exists() or output.is_relative_to(live) or output.is_relative_to(work) or output.is_relative_to(Path(data).resolve()):
        raise ValueError('Output must be NEW and outside data/ (and outside the work bake)')
    bake = json.loads((work/'bake.json').read_text())
    if bake['area'] != AREA: raise ValueError('work bake is not Judique')
    inputs, owner = {}, None
    for entry in bake['inputs']:
        if any(word in entry['path'].lower() for word in patch.FORBIDDEN): raise ValueError('forbidden input '+entry['path'])
        patch.validate(entry['path'], entry['role'], entry['sha256'])
        if entry['role'] == 'owner-corrections': owner = entry
        if entry['path'].startswith('data/baked/'):
            relative = entry['path'][len('data/baked/'):]
            current = baked/relative
            if not current.is_file() or sha(current.read_bytes()) != entry['sha256']:
                raise ValueError(f'STALE WORK BAKE: {entry["path"]} changed since the bake; re-bake on current land')
            data = current.read_bytes()
            inputs[relative] = dict(file=relative, lattice=True, sha256=patch.lattice(data)) if relative.endswith('manifest.json') else dict(file=relative, sha256=sha(data))
    live_corr = (live/MIRROR[len('data/'):]).read_bytes()
    if [sha(live_corr)] != [m['sha256'] for m in before_receipt()['mirror']]:
        raise ValueError('BAKED is not on the Point Tupper delta corrections file; install Point Tupper delta first')
    body = compose(live_corr, corrections)
    if owner is None or owner['path'] != MIRROR or owner['sha256'] != sha(body):
        raise ValueError('The work bake did not read the composed corrections (Point Tupper delta file plus judique-lots-corrections.json)')
    src = work/'paved'
    index = json.loads((src/'index.json').read_text())
    if index['area'] != AREA or index['source'] != patch.SOURCE: raise ValueError('index area/source')
    names = ['index.json', *index['tiles']]
    promotion = {Path(p['source']).name: p['sha256'] for p in json.loads((work/'promotion.json').read_text())}
    if sorted(promotion) != sorted(names): raise ValueError('promotion receipt names differ from the index')
    files = []
    for name in sorted(names):
        data = (src/name).read_bytes()
        if sha(data) != promotion[name]: raise ValueError(f'{name} differs from its promotion hash')
        if name != 'index.json' and (len(data) != 128*128 or any(b > 2 for b in data)): raise ValueError(f'{name} is not a 0/1/2 class tile')
        target = output/FOLDER/'paved'/name
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        files.append(dict(file=f'{FOLDER}/paved/{name}', bytes=len(data), sha256=sha(data)))
    key = patch.manifest_key(index)
    (output/FOLDER/'manifest-key.json').write_text(json.dumps(dict(paved=key), separators=(',', ':'))+'\n')
    for folder_name, data in (('raw-mirror', body), ('raw-before', live_corr)):
        mirror = output/folder_name/MIRROR
        mirror.parent.mkdir(parents=True, exist_ok=True); mirror.write_bytes(data)
    report = dict(version=1, source=patch.SOURCE, replaces=dict(receipt='tools/paved-open/hashes.json'),
                  area=dict(area=AREA, folder=FOLDER, manifestKey=key, files=files, inputs=[inputs[k] for k in sorted(inputs)],
                            lots_m2=bake['lots_m2'], apron_m2=bake['apron_m2'], gravel_m2=bake['gravel_m2'], stalls=len(index.get('stalls', []))),
                  mirror=[dict(file=MIRROR, before=sha(live_corr), sha256=sha(body))])
    (output/'hashes.json').write_text(json.dumps(report, indent=1)+'\n')
    sums = sorted((p.relative_to(output).as_posix(), sha(p.read_bytes())) for p in output.rglob('*') if p.is_file() and p.name != 'SHA256SUMS')
    (output/'SHA256SUMS').write_text(''.join(f'{v}  {n}\n' for n, v in sums))
    if verify and report != json.loads(Path(receipt).read_text()):
        raise ValueError('STALE RECEIPT: the delta differs from tools/paved-open/judique-lots.json. Do not install; review a new delta.')
    print(f'{len(files)} Judique paved files, {sum(f["bytes"] for f in files):,} bytes, receipt and SHA256SUMS in {output}')
    return report




def matches_mirror(before, after, report, receipt):
    hashes = [dict(file=MIRROR, before=sha(before), sha256=sha(after))]
    if hashes != report['mirror']:
        return False
    # The archived receipt already pins exact bytes with pre-cleanup provenance labels.
    return Path(receipt).resolve() == ARCHIVED_RECEIPT.resolve() or compose(before) == after


def install(delta, baked, receipt=None):
    receipt = receipt or RECEIPT
    given = Path(baked).absolute()
    # A worktree's data/baked is a link into the live land: only the checkout that owns the land installs.
    if given.is_symlink() or given.parent.is_symlink(): raise ValueError(f'{given} (or its data folder) is a link; install into the real land only')
    delta, baked = Path(delta).resolve(), Path(baked).resolve()
    report = json.loads((delta/'hashes.json').read_text())
    expected = json.loads(Path(receipt).read_text())
    if not patch.matches_receipt(report, expected):
        raise ValueError('Delta receipt differs from the committed receipt; refusing')
    for f in report['area']['files']:
        if sha((delta/f['file']).read_bytes()) != f['sha256']: raise ValueError('Delta file differs from receipt: '+f['file'])
    body, old = (delta/'raw-mirror'/MIRROR).read_bytes(), (delta/'raw-before'/MIRROR).read_bytes()
    if not matches_mirror(old, body, report, receipt):
        raise ValueError('Delta corrections file differs from the receipt (or does not compose from its before file)')
    folder, manifest_path = baked/FOLDER/'paved', baked/FOLDER/'manifest.json'
    for p in (folder, manifest_path, baked/FOLDER):
        if p.is_symlink(): raise ValueError(f'{p} is a link; install writes real folders only')
    live_corrections = baked.parent/MIRROR[len('data/'):]
    # Only the post-Point Tupper delta file (this delta's `before`, composing to its file) or this delta's own file.
    now = sha(live_corrections.read_bytes()) if live_corrections.is_file() else None
    if now not in (report['mirror'][0]['before'], report['mirror'][0]['sha256']) or \
            report['mirror'][0]['before'] not in [m['sha256'] for m in before_receipt()['mirror']]:
        raise ValueError('Live corrections file is neither the post-Point Tupper delta file nor this one; refusing')
    stale = patch.stale_inputs(dict(areas=[report['area']]), baked)
    if stale: raise ValueError('STALE LAND: baked inputs changed since the bake; re-bake and review a new receipt: '+', '.join(stale))
    fresh, keep = folder.with_name('.paved.new-1219'), baked.parent/'work/paved-before-1219'
    if not folder.exists() and fresh.is_dir() and keep.is_dir():
        # A run cut short between its two renames. Finish it only when the new folder is exactly the receipt's files.
        names = {Path(f['file']).name: f['sha256'] for f in report['area']['files']}
        if {q.name for q in fresh.iterdir()} != set(names) or any(sha((fresh/n).read_bytes()) != v for n, v in names.items()):
            raise ValueError(f'{folder} is missing and {fresh} is not the delta; restore {keep} to {folder} by hand')
        os.replace(fresh, folder)
    mode = state(baked, report)
    if mode == 'pre-1227': raise ValueError('Judique is still on the land before Point Tupper delta: install Point Tupper delta first')
    if mode == 'before':
        # Every refusal comes before the first write to the land.
        if keep.exists(): raise ValueError(f'{keep} exists; move it away before installing')
        if fresh.exists(): shutil.rmtree(fresh)   # a run cut short while writing it
        fresh.mkdir()
        for f in report['area']['files']: (fresh/Path(f['file']).name).write_bytes((delta/f['file']).read_bytes())
        keep.parent.mkdir(parents=True, exist_ok=True)
        os.replace(folder, keep); os.replace(fresh, folder)
        mode = 'half'
    if mode == 'half':
        before = manifest_path.read_bytes()
        manifest = json.loads(before); manifest['paved'] = report['area']['manifestKey']
        patch.atomic_json(manifest_path, manifest)
        expected = json.loads(before); expected['paved'] = report['area']['manifestKey']
        if json.loads(manifest_path.read_bytes()) != expected: raise RuntimeError('manifest changed beyond the paved key')
    if not live_corrections.exists() or sha(live_corrections.read_bytes()) != report['mirror'][0]['sha256']:
        if live_corrections.exists(): shutil.copy2(live_corrections, live_corrections.with_name(live_corrections.name+'.before-1219'))
        live_corrections.parent.mkdir(parents=True, exist_ok=True)
        tmp = live_corrections.with_name('.'+live_corrections.name+'.part'); tmp.write_bytes(body); os.replace(tmp, live_corrections)
    assert state(baked, report) == 'after'
    print('installed the Judique lots delta:', len(report['area']['files']), 'files, the manifest key and the corrections mirror into', baked)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('make'); m.add_argument('work', type=Path); m.add_argument('baked', type=Path); m.add_argument('output', type=Path)
    m.add_argument('--record', action='store_true', help='write a changed receipt into the NEW folder for review; never edits the committed one')
    i = sub.add_parser('install'); i.add_argument('delta', type=Path); i.add_argument('baked', type=Path)
    s = sub.add_parser('state'); s.add_argument('baked', type=Path)
    c = sub.add_parser('compose'); c.add_argument('live_corrections', type=Path)
    a = p.parse_args()
    if a.cmd == 'make': make(a.work, a.baked, a.output, verify=not a.record)
    elif a.cmd == 'install': install(a.delta, a.baked)
    elif a.cmd == 'compose': sys.stdout.buffer.write(compose(a.live_corrections.read_bytes()))
    else: print(state(a.baked))
