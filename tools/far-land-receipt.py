#!/usr/bin/env python3
"""Far views land receipt, in Python for hosts that install over a gated shell (no node).

The same rule as tools/far-delta-check.mjs landState(): every area is BEFORE (no far pack, old tall.json) or AFTER
(every file of tools/far-views-delta.json at its committed hash, manifest far keys equal to the committed patch),
never a mix.

  python3 tools/far-land-receipt.py [--baked DIR] [--expect before|after]
  python3 tools/far-land-receipt.py --plan DIR      # print the install plan for a staged pack (data/work/bakes/far-views)
  python3 tools/far-land-receipt.py --mutations     # synthetic land: before/after accepted, seven mutants refused

Exit 0 with "PASS far land receipt: <state>", else exit 1 with the first difference. Reads only; never writes data/baked.
"""
import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIST = json.loads((ROOT / 'tools/far-views-delta.json').read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Refused(Exception):
    pass


def check(ok, message):
    if not ok:
        raise Refused(message)


def land_state(baked, listing=LIST):
    baked = Path(baked)
    states = set()
    for pack, entry in listing['packs'].items():
        files, patch = entry['files'], entry['manifest']
        folder = baked / pack
        manifest = json.loads((folder / 'manifest.json').read_text())
        far = [n for n in files if n != 'tall.json']
        present = [n for n in far if (folder / n).exists()]
        if not present and 'farLand' not in manifest:
            check('far' not in (manifest.get('tall') or {}), pack + ': manifest tall key has a far count without the far pack')
            if (folder / 'tall.json').exists():
                check(json.loads((folder / 'tall.json').read_text()).get('version') != 2, pack + ': v2 tall.json without the far pack')
            states.add('before')
            continue
        check(len(present) == len(far), pack + ': far pack incomplete (' + ', '.join(present) + ')')
        for name, want in files.items():
            path = folder / name
            check(path.exists(), pack + ': missing ' + name)
            check(sha(path) == want['sha256'], pack + '/' + name + ': sha256 differs from tools/far-views-delta.json')
        check(manifest.get('farLand') == patch['farLand'], pack + ': manifest farLand key')
        check(manifest.get('tall') == patch['tall'], pack + ': manifest tall key')
        states.add('after')
    check(len(states) == 1, 'mixed land: some areas before, some after')
    return states.pop()


def plan(bake):
    """The files to copy and their committed hashes; the staged pack must hold every one of them."""
    bake = Path(bake)
    rows = []
    for pack, entry in LIST['packs'].items():
        for name, want in entry['files'].items():
            path = bake / pack / name
            check(path.exists() and sha(path) == want['sha256'], 'staged ' + pack + '/' + name + ' differs from tools/far-views-delta.json')
            rows.append((pack + '/' + name, want['bytes'], want['sha256']))
        patch = json.loads((bake / pack / 'manifest-patch.json').read_text())
        check(patch == entry['manifest'], 'staged ' + pack + '/manifest-patch.json differs from tools/far-views-delta.json')
    return rows


def mutations():
    listing = {'packs': {}}
    tmp = Path(tempfile.mkdtemp(prefix='far-receipt-'))
    try:
        def build(state):
            root = tmp / state
            for pack in ['terrain', 'areas/a']:
                folder = root / pack
                folder.mkdir(parents=True)
                files = {}
                for name, text in [('tall.json', json.dumps({'version': 2, 'pack': pack})), ('far-land.json', '{}'), ('far-land-desktop.bin', 'd' + pack), ('far-land-low.bin', 'l' + pack), ('far-land-coarse.bin', 'c' + pack)]:
                    (folder / name).write_text(text)
                    files[name] = {'sha256': sha(folder / name), 'bytes': len(text)}
                patch = {'tall': {'file': 'tall.json', 'turbines': 1, 'far': 2, 'towers': 0, 'lines': 0}, 'farLand': {'file': 'far-land.json'}}
                listing['packs'][pack] = {'files': files, 'manifest': patch}
                manifest = {'tall': patch['tall'], 'farLand': patch['farLand']} if state == 'after' else {'tall': {'file': 'tall.json', 'turbines': 1}}
                (folder / 'manifest.json').write_text(json.dumps(manifest))
                if state == 'before':
                    for name in files:
                        if name != 'tall.json':
                            (folder / name).unlink()
                    (folder / 'tall.json').write_text('{}')
            return root
        before, after = build('before'), build('after')
        assert land_state(before, listing) == 'before' and land_state(after, listing) == 'after'

        def refused(label, change):
            copy = tmp / ('m-' + label)
            shutil.copytree(after, copy)
            change(copy)
            try:
                land_state(copy, listing)
            except Refused:
                print('KILLED', label)
                return
            raise SystemExit('SURVIVED ' + label)
        refused('changed file', lambda d: (d / 'terrain/far-land-coarse.bin').write_text('x'))
        refused('missing coarse level', lambda d: (d / 'areas/a/far-land-coarse.bin').unlink())
        refused('missing key', lambda d: (d / 'terrain/manifest.json').write_text(json.dumps({'tall': listing['packs']['terrain']['manifest']['tall']})))
        refused('changed count', lambda d: (d / 'terrain/manifest.json').write_text(json.dumps({**listing['packs']['terrain']['manifest'], 'tall': {**listing['packs']['terrain']['manifest']['tall'], 'far': 3}})))

        def mixed(d):
            shutil.rmtree(d / 'areas/a')
            shutil.copytree(before / 'areas/a', d / 'areas/a')
        refused('mixed areas', mixed)

        def v2_without_pack(d):
            shutil.rmtree(d / 'areas/a')
            shutil.copytree(before / 'areas/a', d / 'areas/a')
            shutil.rmtree(d / 'terrain')
            shutil.copytree(before / 'terrain', d / 'terrain')
            (d / 'terrain/tall.json').write_text(json.dumps({'version': 2}))
        refused('v2 tall without pack', v2_without_pack)

        def far_count_without_pack(d):
            v2_without_pack(d)
            (d / 'terrain/tall.json').write_text('{}')
            (d / 'terrain/manifest.json').write_text(json.dumps({'tall': {'file': 'tall.json', 'far': 2}}))
        refused('far count without pack', far_count_without_pack)
    finally:
        shutil.rmtree(tmp)
    print('PASS far land receipt mutations: before and after accepted; 7 mutants refused')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--baked', default=str(ROOT / 'data/baked'))
    ap.add_argument('--expect', choices=['before', 'after'])
    ap.add_argument('--plan', metavar='BAKE')
    ap.add_argument('--mutations', action='store_true')
    args = ap.parse_args()
    if args.mutations:
        mutations()
        return
    try:
        if args.plan:
            for path, size, digest in plan(args.plan):
                print(path, size, digest)
            print('PASS staged pack matches tools/far-views-delta.json')
            return
        state = land_state(args.baked)
        check(args.expect in (None, state), 'land is ' + state + ', expected ' + str(args.expect))
        print('PASS far land receipt: ' + state + ' in ' + str(len(LIST['packs'])) + ' areas')
    except Refused as error:
        print('REFUSED ' + str(error))
        sys.exit(1)


if __name__ == '__main__':
    main()
