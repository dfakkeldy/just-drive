#!/usr/bin/env python3
"""Verify, install, or roll back the six-area pavement refresh."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import tempfile

import patch
from paved_provenance import digest, resolve

ROWS = ('paved-open-land', 'point-tupper-delta-land', 'mabou-village-delta-land',
        'road-scene-delta-land', 'sidewalks-cache', 'mabou-wharf-land', 'judique-lots')


def verify(work, baked):
    before = json.loads(patch.RECEIPT.read_text())
    receipt = json.loads(patch.REFRESH.read_text())
    for area in before['areas']:
        manifest = json.loads((baked/area['folder']/'manifest.json').read_bytes())
        if manifest.get('paved') != area['manifestKey'] or not patch.area_matches(baked, area):
            raise ValueError(f'{area["area"]}: land differs from the pre-refresh pavement')
    if patch.record(work, baked) != receipt or before['mirror'] != receipt['mirror']:
        raise ValueError('work bake differs from the committed refresh receipt')
    checked = {}
    for area in receipt['areas']:
        source = work/area['area']
        inputs = read_manifest(source/'bake.json')['inputs']
        provenance = patch.sha(json.dumps(inputs, sort_keys=True).encode())
        if provenance != read_manifest(source/'paved/index.json')['provenanceSha256']:
            raise ValueError(f'{area["area"]}: staged index provenance differs from its bake')
        for entry in inputs:
            name = entry['path']
            if name.startswith('data/baked/'):
                continue  # record() checked every baked input.
            if name not in checked:
                checked[name] = digest(resolve(name, patch.ROOT, baked.parent.parent))
            if checked[name] != entry['sha256']:
                raise ValueError(f'bake input changed: {name}')
    print('PASS verified all staged pavement bytes, the bake inputs, and the pre-refresh land', flush=True)


@contextmanager
def lock(baked):
    path = baked.parent/'work/install.lock'
    path.mkdir()
    try:
        yield
    finally:
        path.rmdir()


def clone(source, target):
    subprocess.run(['cp', '-c', '-p', str(source), str(target)], check=True)


def replace(source, target):
    with tempfile.TemporaryDirectory(prefix='.pavement-', dir=target.parent) as directory:
        temporary = Path(directory)/target.name
        clone(source, temporary)
        os.replace(temporary, target)


def read_manifest(path):
    return json.loads(path.read_bytes())


def changed_manifests(delta):
    return [(Path(m['folder'])/'manifest.json', m) for m in delta['manifests']]


def restore(baked, backup, delta):
    for f in delta['files']:
        target = baked/f['file']
        if f['before'] is None:
            target.unlink(missing_ok=True)
        else:
            replace(backup/f['file'], target)
    for name, _ in changed_manifests(delta):
        replace(backup/name, baked/name)


def post_checks():
    subprocess.run([str(patch.ROOT/'tools/check-all.sh'), '--only', *ROWS], cwd=patch.ROOT, check=True)
    subprocess.run(['python3', 'tools/mabou-dashcam-18nov/receipt.py', 'land'], cwd=patch.ROOT, check=True)


def install(work, baked, backup):
    delta = patch.refresh_delta()
    with lock(baked):
        verify(work, baked)
        if backup.parent.stat().st_dev != baked.stat().st_dev:
            raise ValueError('keep the APFS backup on the same volume as the land')
        backup.mkdir()
        for name in [f['file'] for f in delta['files'] if f['before'] is not None] + [n for n, _ in changed_manifests(delta)]:
            target = backup/name
            target.parent.mkdir(parents=True, exist_ok=True)
            clone(baked/name, target)
        print(f'APFS clone backup: {backup}', flush=True)
        try:
            folders = {patch.folder(area): area for area in patch.AREAS}
            for f in delta['files']:
                name = Path(f['file'])
                target = baked/name
                if f['sha256'] is None:
                    target.unlink()
                else:
                    replace(work/folders[name.parent.parent]/'paved'/name.name, target)
            for name, m in changed_manifests(delta):
                path = baked/name
                manifest = read_manifest(path)
                manifest.update(m['after'])
                patch.atomic_json(path, manifest)
            if not patch.refresh_installed(baked):
                raise ValueError('installed pavement differs from the committed receipt')
            post_checks()
        except (Exception, KeyboardInterrupt):
            restore(baked, backup, delta)
            print('Restored pre-refresh pavement after an install or check failure', flush=True)
            raise


def rollback(baked, backup):
    delta = patch.refresh_delta()
    with lock(baked):
        if not patch.refresh_installed(baked):
            raise ValueError('land differs from the installed refresh receipt')
        for f in delta['files']:
            if f['before'] is not None and patch.sha((backup/f['file']).read_bytes()) != f['before']:
                raise ValueError(f'backup differs from receipt: {f["file"]}')
        for name, m in changed_manifests(delta):
            before = read_manifest(backup/name)
            if before.get('paved') != m['before']['paved'] or before | m['after'] != read_manifest(baked/name):
                raise ValueError(f'backup or live manifest differs: {name}')
        restore(baked, backup, delta)
        print('PASS restored pre-refresh pavement and manifest')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ('record', 'verify', 'install', 'rollback'):
        command = sub.add_parser(action)
        if action != 'rollback':
            command.add_argument('work', type=Path)
        if action in ('record', 'verify'):
            command.add_argument('baked', type=Path)
        else:
            command.add_argument('backup', type=Path)
    args = parser.parse_args()
    if args.action == 'record':
        print(json.dumps(patch.record(args.work, args.baked), indent=1))
    elif args.action == 'verify':
        verify(args.work, args.baked)
    else:
        baked = patch.ROOT/'data/baked'
        if baked.resolve() != baked:
            raise ValueError('install or rollback needs a real data/baked folder in this checkout')
        if args.backup.resolve().is_relative_to(baked):
            raise ValueError('keep the backup outside data/baked')
        for area in patch.AREAS:
            root = baked/patch.folder(area)
            for path in (root, root/'paved', root/'manifest.json'):
                if path.resolve() != path:
                    raise ValueError(f'install or rollback needs an unlinked path: {path}')
        if args.action == 'install':
            install(args.work, baked, args.backup)
        else:
            rollback(baked, args.backup)


if __name__ == '__main__':
    main()
