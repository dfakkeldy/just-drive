#!/usr/bin/env python3
"""Make the Point Tupper stockpile install (the project brief) in a NEW folder. It never writes into a land.

Usage: python3 tools/stockpiles-delta/install.py SOURCE_POINTTUPPER NEW_OUTPUT_DIRECTORY

SOURCE_POINTTUPPER is a baked Point Tupper area folder and is only read. The output folder must not exist. It gets:
  stockpiles.json  the committed pack, byte for byte (its SHA-256 is in hashes.json next to this script)
  manifest.json    the source manifest plus the one key  "stockpiles": {"file": "stockpiles.json", "count": 2}
  install.json     the SHA-256 of both files, and of the source manifest this was made from
The source must not hold the pack yet (no key, no file). The manifest is a shared file, so the new one is made from
the manifest as it is now, and the script refuses when it cannot write those bytes back unchanged.
"""
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
KEY = dict(file='stockpiles.json', count=2)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact(manifest, like):
    """The manifest in the bakes' own form (json.dump, compact or default separators), with the source's line end."""
    for separators in ((',', ':'), None):
        text = json.dumps(manifest, separators=separators)
        for end in ('', '\n'):
            if (text + end).encode() == like:
                return lambda value: (json.dumps(value, separators=separators) + end).encode()
    raise SystemExit('The source manifest is not in a form this script can write back unchanged; add the key by hand '
                     '(see README.md) and keep every other byte.')


def make(source, out):
    recorded = json.loads((HERE/'hashes.json').read_text())
    pack = (HERE/'stockpiles.json').read_bytes()
    if sha(pack) != recorded['pack']['sha256'] or len(pack) != recorded['pack']['bytes']:
        raise SystemExit('tools/stockpiles-delta/stockpiles.json does not hash as hashes.json says')
    before = (source/'manifest.json').read_bytes()
    manifest = json.loads(before)
    if manifest.get('area', {}).get('id') != 'pointtupper':
        raise SystemExit(f'{source} is not a Point Tupper land')
    if 'stockpiles' in manifest or (source/'stockpiles.json').exists():
        raise SystemExit(f'{source} already holds a stockpile key or file; nothing made')
    write = compact(manifest, before)
    after = write({**manifest, 'stockpiles': KEY})
    check = json.loads(after)
    if check.pop('stockpiles') != KEY or check != manifest or list(check) != list(manifest):
        raise SystemExit('The new manifest differs from the source by more than the stockpiles key')
    out.mkdir(parents=True)
    (out/'stockpiles.json').write_bytes(pack)
    (out/'manifest.json').write_bytes(after)
    report = dict(area='pointtupper', key=KEY, files=[
        dict(file='stockpiles.json', sha256=sha(pack), bytes=len(pack), before=None),
        dict(file='manifest.json', sha256=sha(after), bytes=len(after), before=sha(before)),
    ])
    (out/'install.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source, out = Path(sys.argv[1]), Path(sys.argv[2]).absolute()
    if out.exists():
        raise SystemExit(f'Output folder already exists: {out}')
    resolved = out.resolve()
    if resolved.is_relative_to(source.resolve()):
        raise SystemExit('The output folder must not be inside the source land')
    lands = [folder for folder in source.resolve().parents if folder.name == 'baked']
    roots = [*lands, *(folder.parent/'site' for folder in lands)]
    named = any(folder.name in ('baked', 'site') and folder.parent.name == 'data' for folder in (resolved, *resolved.parents))
    if named or any(resolved.is_relative_to(root) for root in roots):
        raise SystemExit('The output folder must not be baked or site data, or inside them')
    print(json.dumps(make(source, out), indent=2))


if __name__ == '__main__':
    main()
