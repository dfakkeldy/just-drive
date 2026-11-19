#!/usr/bin/env python3
"""Receipt of the 18 Nov Mabou staged bake (pipeline/35_bake_mabou_dashcam.py).

record: python3 tools/mabou-dashcam-18nov/receipt.py record SOURCE STAGE   (prints a receipt for review; never writes)
verify: python3 tools/mabou-dashcam-18nov/receipt.py verify SOURCE STAGE   (before promotion: the land and the staged files are the receipt's)
install: python3 tools/mabou-dashcam-18nov/receipt.py install STAGE BAKED (main thread only: promote the staged files)
land:   python3 tools/mabou-dashcam-18nov/receipt.py land [BAKED]           (installed land is all before or all after; never mixed)

SOURCE is the Mabou terrain pack the bake read (data/baked/terrain) and STAGE the bake's --output folder.
hashes.json pins, for every file the bake writes except manifest.json, the bytes it replaces (`before`) and
its bytes (`sha256`), relative to data/baked. The manifest is pinned by the two counts the bake owns, because
other bakes own every other manifest key. `undo` rebuilds the bake's before props and road kinds from its after
files: tools/road-scene-delta-check.py reads it to judge step-29 props on promoted land, and `record` proves that
it reproduces the before props byte for byte.
"""
import copy
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECEIPT = HERE/'hashes.json'
FOLDER = 'terrain'
COUNTS = ('buildings', 'buildingStyles')


def sha(data): return hashlib.sha256(data).hexdigest()


def compact(doc): return (json.dumps(doc, separators=(',', ':'), allow_nan=False) + '\n').encode()


def undo(props, roads, rule):
    """The props and roads of the land before the bake, from its after props and roads."""
    pieces = {int(k): v for k, v in rule['poles'].items()}
    kinds = {int(k): v for k, v in rule['kinds'].items()}
    props = copy.deepcopy(props)
    for record in props['poles'] + props.get('serviceDrops', []):
        record['road'] = pieces.get(record['road'], record['road'])
    return props, [dict(r, kind=kinds.get(r['id'], r['kind'])) for r in roads if r['id'] not in pieces]


def counts(manifest): return {k: dict(count=manifest[k]['count']) for k in COUNTS}


def record(source, stage):
    source, stage = Path(source), Path(stage)
    files = []
    for path in sorted(p for p in stage.rglob('*') if p.is_file()):
        name = path.relative_to(stage).as_posix()
        if name == 'manifest.json': continue
        files.append(dict(file=f'{FOLDER}/{name}', before=sha((source/name).read_bytes()), sha256=sha(path.read_bytes())))
    old = {r['id']: r for r in json.loads((source/'roads.json').read_bytes())['roads']}
    new = json.loads((stage/'roads.json').read_bytes())['roads']
    added = [r for r in new if r['id'] not in old]
    pieces = {}
    for r in added:
        kept = [o for o in new if o['id'] in old and o.get('correction') == r.get('correction')]
        if not r.get('correction') or len(kept) != 1: raise ValueError(f'road {r["id"]} is not one piece of a split road')
        pieces[str(r['id'])] = kept[0]['id']
    kinds = {str(r['id']): old[r['id']]['kind'] for r in new if r['id'] in old and r['kind'] != old[r['id']]['kind']}
    rule = dict(poles=pieces, kinds=kinds)
    before = json.loads((source/'props.json').read_bytes())
    rebuilt, _ = undo(json.loads((stage/'props.json').read_bytes()), new, rule)
    if compact(rebuilt) != (source/'props.json').read_bytes() or rebuilt != before:
        raise ValueError('undo does not rebuild the before props byte for byte')
    manifests = [dict(folder=FOLDER, before=counts(json.loads((source/'manifest.json').read_bytes())),
                      after=counts(json.loads((stage/'manifest.json').read_bytes())))]
    return dict(version=1, bake='pipeline/35_bake_mabou_dashcam.py', files=files, manifests=manifests, undo=rule)


def verify(source, stage):
    report = json.loads(RECEIPT.read_text())
    made = record(source, stage)
    if made != report:
        raise AssertionError('the land or the staged files are not this receipt (land differs from the one it was made on?)')
    print(f'PASS staged bake is the receipt: {len(report["files"])} files and the manifest counts; undo rebuilds the before props')


def state(baked, report):
    """'before' or 'after' when every pinned file and the owned manifest counts are one side of the receipt."""
    seen = set()
    for f in report['files']:
        now = sha((Path(baked)/f['file']).read_bytes())
        seen.add('before' if now == f['before'] else 'after' if now == f['sha256'] else f'unknown bytes {f["file"]}')
    for m in report['manifests']:
        now = counts(json.loads((Path(baked)/m['folder']/'manifest.json').read_bytes()))
        seen.add('before' if now == m['before'] else 'after' if now == m['after'] else f'unknown counts {m["folder"]}/manifest.json')
    if len(seen) != 1 or not seen <= {'before', 'after'}:
        raise AssertionError('18 Nov land is mixed or unknown: ' + ', '.join(sorted(seen)))
    return seen.pop()


def install(stage, baked, report=None):
    """Copy the staged files over BAKED/terrain and set only the two owned manifest counts: other bakes own every other
    manifest key, so the staged manifest is never copied. Refuses before writing on staged bytes or land that are not
    this receipt's. Replaced bytes are kept in STAGE.before/ so the install can be undone. Run again: it does nothing."""
    report = report or json.loads(RECEIPT.read_text())
    stage, baked = Path(stage), Path(baked)
    names = {f['file'][len(FOLDER)+1:]: f for f in report['files']}
    extra = {p.relative_to(stage).as_posix() for p in stage.rglob('*') if p.is_file()} - set(names) - {'manifest.json'}
    if extra: raise ValueError('staged files outside the receipt: ' + ', '.join(sorted(extra)))
    for name, f in names.items():
        if sha((stage/name).read_bytes()) != f['sha256']: raise ValueError(f'staged {name} is not the receipt')
    (m,) = report['manifests']
    if counts(json.loads((stage/'manifest.json').read_bytes())) != m['after']: raise ValueError('staged manifest counts are not the receipt')
    live = baked/FOLDER
    for name, f in names.items():
        if sha((live/name).read_bytes()) not in (f['before'], f['sha256']): raise ValueError(f'live {FOLDER}/{name} is neither before nor after; refusing')
    manifest = json.loads((live/'manifest.json').read_bytes())
    if counts(manifest) not in (m['before'], m['after']): raise ValueError('live manifest counts are neither before nor after; refusing')
    keep = stage.with_name(stage.name + '.before')
    def replace(name, data):
        target = live/name
        if target.read_bytes() == data: return
        (keep/name).parent.mkdir(parents=True, exist_ok=True)
        if not (keep/name).exists(): shutil.copyfile(target, keep/name)
        temporary = target.with_name(target.name + '.18nov-tmp')
        temporary.write_bytes(data); os.replace(temporary, target)
    for name in names: replace(name, (stage/name).read_bytes())
    for key, value in m['after'].items(): manifest[key]['count'] = value['count']
    replace('manifest.json', compact(manifest))
    return state(baked, report)


def fixture():
    """The state rule on a synthetic receipt: both sides pass; a half install and unknown bytes fail."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root/FOLDER).mkdir()
        files = {'a.json': (b'1', b'2'), 'b.json': (b'3', b'4')}
        manifest = lambda n: compact({k: dict(count=n) for k in COUNTS})
        report = dict(files=[dict(file=f'{FOLDER}/{k}', before=sha(v[0]), sha256=sha(v[1])) for k, v in files.items()],
                      manifests=[dict(folder=FOLDER, before=counts(json.loads(manifest(1))), after=counts(json.loads(manifest(2))))])
        def lay(side, count, **override):
            for k, v in files.items(): (root/FOLDER/k).write_bytes(override.get(k, v[side]))
            (root/FOLDER/'manifest.json').write_bytes(manifest(count))
        lay(0, 1); assert state(root, report) == 'before'
        lay(1, 2); assert state(root, report) == 'after'
        for label, args in [('half install', (1, 2, {'b.json': b'3'})), ('counts left behind', (1, 1, {})), ('unknown bytes', (1, 2, {'a.json': b'9'}))]:
            lay(args[0], args[1], **args[2])
            try: state(root, report)
            except AssertionError: continue
            raise AssertionError(label + ' accepted')
        # install: refuses foreign staged bytes and unknown live bytes; keeps other manifest keys; idempotent; undoable.
        stage = root/'stage'; stage.mkdir()
        for k, v in files.items(): (stage/k).write_bytes(v[1])
        (stage/'manifest.json').write_bytes(manifest(2))
        lay(0, 1); live = json.loads((root/FOLDER/'manifest.json').read_bytes()); live['other'] = 'kept'
        (root/FOLDER/'manifest.json').write_bytes(compact(live))
        for label, change in [('foreign staged bytes', lambda: (stage/'a.json').write_bytes(b'8')),
                              ('unknown live bytes', lambda: (root/FOLDER/'b.json').write_bytes(b'7'))]:
            change()
            try: install(stage, root, report)
            except ValueError: pass
            else: raise AssertionError(label + ' installed')
            (stage/'a.json').write_bytes(b'2'); (root/FOLDER/'b.json').write_bytes(b'3')
            assert state(root, report) == 'before', label + ' wrote before refusing'
        assert install(stage, root, report) == 'after' and install(stage, root, report) == 'after'
        assert json.loads((root/FOLDER/'manifest.json').read_bytes())['other'] == 'kept'
        assert (root/'stage.before/a.json').read_bytes() == b'1', 'replaced bytes must be kept'
        props = dict(poles=[dict(road=9, n=0), dict(road=5, n=1)], serviceDrops=[dict(road=9, n=0)])
        rebuilt, roads = undo(props, [dict(id=5, kind=3), dict(id=9, kind=2), dict(id=6, kind=2)], dict(poles={'9': 5}, kinds={'6': 4}))
        assert [q['road'] for q in rebuilt['poles'] + rebuilt['serviceDrops']] == [5, 5, 5] and props['poles'][0]['road'] == 9
        assert roads == [dict(id=5, kind=3), dict(id=6, kind=4)]


def land(baked):
    fixture()
    report = json.loads(RECEIPT.read_text())
    mode = state(baked, report)
    print(f'PASS 18 Nov Mabou land is {mode} ({len(report["files"])} files and the manifest counts); fixture: half install, counts left behind and unknown bytes refused; install refusals, kept keys and bytes, idempotent')


if __name__ == '__main__':
    if sys.argv[1:2] == ['land'] and len(sys.argv) <= 3:
        land(Path(sys.argv[2]) if len(sys.argv) == 3 else HERE.parents[1]/'data/baked')
    elif len(sys.argv) == 4 and sys.argv[1] in ('record', 'verify', 'install'):
        if sys.argv[1] == 'record': print(json.dumps(record(sys.argv[2], sys.argv[3]), indent=1))
        elif sys.argv[1] == 'verify': verify(sys.argv[2], sys.argv[3])
        else: print(f'PASS 18 Nov Mabou land is {install(sys.argv[2], sys.argv[3])}; replaced bytes kept in {Path(sys.argv[2]).name}.before/')
    else: sys.exit(__doc__)
