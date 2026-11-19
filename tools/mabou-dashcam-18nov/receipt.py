#!/usr/bin/env python3
"""Receipt of the 18 Nov Mabou staged bake (pipeline/35_bake_mabou_dashcam.py).

record: python3 tools/mabou-dashcam-18nov/receipt.py record SOURCE STAGE   (prints a receipt for review; never writes)
verify: python3 tools/mabou-dashcam-18nov/receipt.py verify SOURCE STAGE   (before promotion: the land and the staged files are the receipt's)
install: python3 tools/mabou-dashcam-18nov/receipt.py install STAGE BAKED (main thread only: promote the staged files)
uninstall: python3 tools/mabou-dashcam-18nov/receipt.py uninstall STAGE BAKED (main thread only: put the before bytes back)
land:   python3 tools/mabou-dashcam-18nov/receipt.py land [BAKED]           (installed land is all before or all after; never mixed)

SOURCE is the Mabou terrain pack the bake read (data/baked/terrain) and STAGE the bake's --output folder.
hashes.json pins, for every file the bake writes except manifest.json, the bytes it replaces (`before`) and
its bytes (`sha256`), relative to data/baked. The manifest is pinned by the three counts the bake owns (buildings,
building styles and trees: the driveways drop the trees on them), because other bakes own every other manifest key.
`undo` rebuilds the bake's before props, road list and road kinds from its after files (it drops the split pieces
and the driveway pieces): tools/road-scene-delta-check.py reads it to judge step-29 props on promoted land, and `record` proves that
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
COUNTS = ('buildings', 'buildingStyles', 'trees')


def sha(data): return hashlib.sha256(data).hexdigest()


def compact(doc): return (json.dumps(doc, separators=(',', ':'), allow_nan=False) + '\n').encode()


def undo(props, roads, rule):
    """The props and roads of the land before the bake, from its after props and roads."""
    pieces = {int(k): v for k, v in rule['poles'].items()}
    kinds = {int(k): v for k, v in rule['kinds'].items()}
    added = set(pieces) | set(rule.get('driveways', []))
    props = copy.deepcopy(props)
    for record in props['poles'] + props.get('serviceDrops', []):
        record['road'] = pieces.get(record['road'], record['road'])
    return props, [dict(r, kind=kinds.get(r['id'], r['kind'])) for r in roads if r['id'] not in added]


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
    drives = [r['id'] for r in added if r.get('driveway')]
    if new[len(new)-len(drives):] != [r for r in added if r.get('driveway')]: raise ValueError('driveway pieces must come last')
    pieces = {}
    for r in added:
        if r.get('driveway'): continue
        kept = [o for o in new if o['id'] in old and o.get('correction') == r.get('correction')]
        if not r.get('correction') or len(kept) != 1: raise ValueError(f'road {r["id"]} is not one piece of a split road')
        pieces[str(r['id'])] = kept[0]['id']
    kinds = {str(r['id']): old[r['id']]['kind'] for r in new if r['id'] in old and r['kind'] != old[r['id']]['kind']}
    rule = dict(poles=pieces, kinds=kinds, driveways=drives)
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
    """Copy the staged files over BAKED/terrain and set only the three owned manifest counts: other bakes own every other
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
    for name, f in names.items():
        if (keep/name).exists() and sha((keep/name).read_bytes()) != f['before']:
            raise ValueError(f'kept {keep.name}/{name} is not the pinned before bytes; refusing')
    for name, f in names.items():
        if sha((live/name).read_bytes()) == f['before']:
            (keep/name).parent.mkdir(parents=True, exist_ok=True)
            if not (keep/name).exists(): shutil.copyfile(live/name, keep/name)
        write(live/name, (stage/name).read_bytes())
    set_counts(live, m['after'])
    return state(baked, report)


def write(target, data):
    if target.read_bytes() == data: return
    temporary = target.with_name(target.name + '.18nov-tmp')
    temporary.write_bytes(data); os.replace(temporary, target)


def set_counts(live, side):
    """Only the counts this bake owns; every other manifest key stays as other bakes left it."""
    manifest = json.loads((live/'manifest.json').read_bytes())
    for key, value in side.items(): manifest[key]['count'] = value['count']
    write(live/'manifest.json', compact(manifest))


def uninstall(stage, baked, report=None):
    """Undo install: put back each pinned file from STAGE.before/ (checked against its before hash) and set the
    owned counts back. Refuses before writing on land or kept bytes that are not this receipt's. Run again: it does nothing."""
    report = report or json.loads(RECEIPT.read_text())
    live, keep = Path(baked)/FOLDER, Path(stage).with_name(Path(stage).name + '.before')
    names = {f['file'][len(FOLDER)+1:]: f for f in report['files']}
    (m,) = report['manifests']
    for name, f in names.items():
        now = sha((live/name).read_bytes())
        if now not in (f['before'], f['sha256']): raise ValueError(f'live {FOLDER}/{name} is neither before nor after; refusing')
        if now == f['sha256'] and (not (keep/name).exists() or sha((keep/name).read_bytes()) != f['before']):
            raise ValueError(f'{keep.name}/{name} is missing or not the pinned before bytes; refusing')
    if counts(json.loads((live/'manifest.json').read_bytes())) not in (m['before'], m['after']):
        raise ValueError('live manifest counts are neither before nor after; refusing')
    for name in names:
        if (keep/name).exists(): write(live/name, (keep/name).read_bytes())
    set_counts(live, m['before'])
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
        # install: each refusal writes nothing; other manifest keys stay; idempotent; uninstall restores the pinned bytes.
        stage = root/'stage'; stage.mkdir()
        def staged():
            for k, v in files.items(): (stage/k).write_bytes(v[1])
            (stage/'manifest.json').write_bytes(manifest(2))
            for extra in stage.glob('extra*'): extra.unlink()
        def before_land(count=1):
            lay(0, count); live = json.loads((root/FOLDER/'manifest.json').read_bytes()); live['other'] = 'kept'
            (root/FOLDER/'manifest.json').write_bytes(compact(live))
        snapshot = lambda: {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob('*')) if p.is_file() and 'stage' not in p.parts[len(root.parts)]}
        cases = [('foreign staged bytes in the last file', lambda: (stage/'b.json').write_bytes(b'8')),
                 ('a staged file outside the receipt', lambda: (stage/'extra.json').write_bytes(b'0')),
                 ('staged manifest counts', lambda: (stage/'manifest.json').write_bytes(manifest(3))),
                 ('unknown live bytes in the last file', lambda: (root/FOLDER/'b.json').write_bytes(b'7')),
                 ('unknown live manifest counts', lambda: before_land(5))]
        for label, change in cases:
            staged(); before_land(); change(); was = snapshot()
            try: install(stage, root, report)
            except ValueError: pass
            else: raise AssertionError(label + ' installed')
            assert snapshot() == was and not (root/'stage.before').exists(), label + ' wrote before refusing'
        staged(); before_land()
        assert install(stage, root, report) == 'after' and install(stage, root, report) == 'after'
        assert json.loads((root/FOLDER/'manifest.json').read_bytes())['other'] == 'kept'
        assert (root/'stage.before/a.json').read_bytes() == b'1', 'replaced bytes must be kept'
        assert not (root/'stage.before/manifest.json').exists(), 'the whole manifest is never kept or restored'
        live = json.loads((root/FOLDER/'manifest.json').read_bytes()); live['other'] = 'changed later'
        (root/FOLDER/'manifest.json').write_bytes(compact(live))
        assert uninstall(stage, root, report) == 'before' and uninstall(stage, root, report) == 'before'
        assert json.loads((root/FOLDER/'manifest.json').read_bytes())['other'] == 'changed later', 'uninstall keeps later keys'
        install(stage, root, report); (root/'stage.before/b.json').write_bytes(b'6'); was = snapshot()
        for action in (uninstall, install):
            try: action(stage, root, report)
            except ValueError: pass
            else: raise AssertionError(f'{action.__name__} used tampered kept bytes')
            assert snapshot() == was, f'{action.__name__} wrote before refusing'
        props = dict(poles=[dict(road=9, n=0), dict(road=5, n=1)], serviceDrops=[dict(road=9, n=0)])
        rebuilt, roads = undo(props, [dict(id=5, kind=3), dict(id=9, kind=2), dict(id=6, kind=2), dict(id=10, kind=4), dict(id=11, kind=4)],
                              dict(poles={'9': 5}, kinds={'6': 4}, driveways=[10, 11]))
        assert [q['road'] for q in rebuilt['poles'] + rebuilt['serviceDrops']] == [5, 5, 5] and props['poles'][0]['road'] == 9
        assert roads == [dict(id=5, kind=3), dict(id=6, kind=4)], 'undo drops the split and driveway pieces'
        assert undo(props, [dict(id=5, kind=3)], dict(poles={}, kinds={}))[1] == [dict(id=5, kind=3)], 'a rule without driveways' 


def land(baked):
    fixture()
    report = json.loads(RECEIPT.read_text())
    mode = state(baked, report)
    print(f'PASS 18 Nov Mabou land is {mode} ({len(report["files"])} files and the manifest counts); fixture: half install, counts left behind and unknown bytes refused; install/uninstall refusals write nothing, kept keys and bytes, idempotent')


if __name__ == '__main__':
    if sys.argv[1:2] == ['land'] and len(sys.argv) <= 3:
        land(Path(sys.argv[2]) if len(sys.argv) == 3 else HERE.parents[1]/'data/baked')
    elif len(sys.argv) == 4 and sys.argv[1] == 'uninstall':
        print(f'PASS 18 Nov Mabou land is {uninstall(sys.argv[2], sys.argv[3])}')
    elif len(sys.argv) == 4 and sys.argv[1] in ('record', 'verify', 'install'):
        if sys.argv[1] == 'record': print(json.dumps(record(sys.argv[2], sys.argv[3]), indent=1))
        elif sys.argv[1] == 'verify': verify(sys.argv[2], sys.argv[3])
        else: print(f'PASS 18 Nov Mabou land is {install(sys.argv[2], sys.argv[3])}; replaced bytes kept in {Path(sys.argv[2]).name}.before/')
    else: sys.exit(__doc__)
