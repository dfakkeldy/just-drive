#!/usr/bin/env python3
"""Build, verify, install or roll back the Troy-to-West Bay land extension delta (#1475).

Extends areas/cansocauseway east by one 2048 m column (L5 tile column i=17, 9 new 8 m tiles
from E=626316 to E=628364) so it meets areas/westbay with zero gap, including LiDAR terrain,
roads, driveways, buildings, building styles, foundations, trees, props, streams, cemeteries,
open pavement, baked bridge decks, and tall.json mid box.

Only changed and added files under areas/cansocauseway/ enter the staged delta.
manifest.json is updated by owned keys only so unrelated manifest keys from other deltas
survive install and rollback. Never writes inside data/baked or data/site during make.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RECEIPT = HERE / 'hashes.json'

AREA_ID = 'cansocauseway'
PACK = 'areas/cansocauseway'
OWNED_MANIFEST_KEYS = (
    'buildingStyles',
    'buildings',
    'cemeteries',
    'cover',
    'height',
    'levels',
    'mid',
    'paved',
    'props',
    'roads',
    'streams',
    'trees',
)
_DARWIN_SYSTEM_SYMLINKS = {Path('/tmp'), Path('/var'), Path('/etc')}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compact_json(value) -> bytes:
    return (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def pretty_json(value) -> bytes:
    return (json.dumps(value, indent=2, allow_nan=False) + '\n').encode('utf-8')


def _is_system_symlink(path: Path) -> bool:
    return sys.platform == 'darwin' and path in _DARWIN_SYSTEM_SYMLINKS


def _assert_no_symlink_path(path: Path):
    """Refuse if path or any ancestor directory is a symlink."""
    base = Path(os.path.abspath(os.getcwd())) if not path.is_absolute() else Path(path.anchor)
    parts = list(base.parts[1:]) + [p for p in path.parts if p not in ('', path.anchor, '.')]
    cur = Path(base.anchor)
    for part in parts:
        cur = cur / part
        if cur.is_symlink() and not _is_system_symlink(cur):
            raise ValueError(f'Refusing to traverse or replace symlink: {cur}')


def _existing_ancestors(path: Path) -> list[Path]:
    cur = path.resolve()
    found = []
    while True:
        if cur.exists():
            found.append(cur)
        parent = cur.parent
        if parent == cur:
            break
        cur = parent
    return found


def _git_primary_root(start: Path) -> Path | None:
    try:
        out = subprocess.check_output(
            ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
            cwd=str(start), text=True, stderr=subprocess.DEVNULL,
        ).strip()
        return Path(out).resolve().parent
    except Exception:
        return None


def assert_safe_stage_output(output: Path, *sources: Path):
    """Refuse existing folders, source overlap, or any data/baked or data/site destination."""
    if output.exists() or output.is_symlink():
        raise ValueError(f'Stage output already exists; pass a new folder: {output}')
    out_r = output.resolve()
    out_ancestors = _existing_ancestors(out_r)
    for source in sources:
        src_r = source.resolve()
        if out_r == src_r or out_r.is_relative_to(src_r) or src_r.is_relative_to(out_r):
            raise ValueError(f'Stage output must be separate from source land: {output}')
        for anc in out_ancestors:
            if src_r.exists() and os.path.samefile(anc, src_r):
                raise ValueError(f'Stage output must be separate from source land: {output}')
    protected_bases = [b for b in (ROOT, _git_primary_root(ROOT)) if b is not None]
    for forbidden_name in ('baked', 'site'):
        for base in protected_bases:
            live_dir = base / 'data' / forbidden_name
            if live_dir.exists():
                for anc in out_ancestors:
                    if os.path.samefile(anc, live_dir):
                        raise ValueError(f'Stage output must stay outside data/{forbidden_name}: {output}')
        for i, part in enumerate(out_r.parts):
            if part.lower() == 'data' and i + 1 < len(out_r.parts) and out_r.parts[i + 1].lower() == forbidden_name:
                raise ValueError(f'Stage output must stay outside data/{forbidden_name}: {output}')


def _atomic_write(target: Path, data: bytes):
    _assert_no_symlink_path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f'.{target.name}.tmp-', dir=str(target.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def _walk_pack(pack_dir: Path) -> dict[str, Path]:
    if not pack_dir.is_dir():
        raise ValueError(f'Missing area folder: {pack_dir}')
    out = {}
    for p in sorted(pack_dir.rglob('*')):
        if p.is_file():
            rel = p.relative_to(pack_dir).as_posix()
            if rel.startswith('.') or '/.' in rel:
                continue
            out[rel] = p
    return out


def _record_paved_area(paved_work: Path, after_baked: Path) -> dict:
    spec = importlib.util.spec_from_file_location('paved_open_patch', ROOT / 'tools/paved-open/patch.py')
    paved_patch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(paved_patch)
    report = paved_patch.record(paved_work, after_baked, areas_=(AREA_ID,))
    assert len(report['areas']) == 1 and report['areas'][0]['area'] == AREA_ID
    return report['areas'][0]


def make(before_baked: Path, after_baked: Path, output: Path, *,
         paved_work: Path | None = None, verify: bool = True, receipt_path: Path = RECEIPT) -> dict:
    """Stage changed and added areas/cansocauseway/ files into a NEW folder outside data/baked."""
    before_baked, after_baked = before_baked.resolve(), after_baked.resolve()
    assert_safe_stage_output(output, before_baked, after_baked)

    before_pack = before_baked / PACK
    after_pack = after_baked / PACK
    before_files = _walk_pack(before_pack)
    after_files = _walk_pack(after_pack)

    if 'manifest.json' not in before_files or 'manifest.json' not in after_files:
        raise ValueError('Both before and after land must contain areas/cansocauseway/manifest.json')

    bm = json.loads(before_files['manifest.json'].read_bytes())
    am = json.loads(after_files['manifest.json'].read_bytes())
    unowned_diffs = sorted(k for k in (bm.keys() | am.keys())
                           if k not in OWNED_MANIFEST_KEYS and bm.get(k) != am.get(k))
    if unowned_diffs:
        raise ValueError(f'Unexpected manifest changes outside owned keys: {unowned_diffs}')

    before_manifest = {k: bm[k] for k in OWNED_MANIFEST_KEYS if k in bm}
    after_manifest = {k: am[k] for k in OWNED_MANIFEST_KEYS if k in am}

    output.mkdir(parents=True)
    entries = []
    replaced_count = 0
    added_count = 0
    removed_count = 0
    total_bytes = 0

    for rel in sorted((before_files.keys() | after_files.keys()) - {'manifest.json'}):
        full_rel = f'{PACK}/{rel}'
        b_path = before_files.get(rel)
        a_path = after_files.get(rel)
        b_bytes = b_path.read_bytes() if b_path is not None else None
        a_bytes = a_path.read_bytes() if a_path is not None else None
        if b_bytes == a_bytes:
            continue
        if a_bytes is not None:
            dest = output / full_rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(a_bytes)
            total_bytes += len(a_bytes)
            if b_bytes is None:
                added_count += 1
            else:
                replaced_count += 1
            entries.append(dict(
                file=full_rel,
                before=sha(b_bytes) if b_bytes is not None else None,
                sha256=sha(a_bytes),
                bytes=len(a_bytes),
            ))
        else:
            removed_count += 1
            entries.append(dict(
                file=full_rel,
                before=sha(b_bytes),
                sha256=None,
                bytes=0,
            ))

    manifest_patch_path = output / PACK / 'manifest-patch.json'
    manifest_patch_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_patch_path.write_bytes(compact_json(after_manifest))

    report = dict(
        version=1,
        issue=1475,
        area=AREA_ID,
        pack=PACK,
        beforeMid=bm['mid'],
        afterMid=am['mid'],
        manifestKeys=list(OWNED_MANIFEST_KEYS),
        beforeManifest=before_manifest,
        afterManifest=after_manifest,
        counts=dict(
            replaced=replaced_count,
            added=added_count,
            removed=removed_count,
            totalFiles=len(entries),
            totalBytes=total_bytes,
        ),
        files=entries,
    )
    if paved_work is not None:
        report['pavedArea'] = _record_paved_area(paved_work.resolve(), after_baked)

    (output / 'hashes.json').write_bytes(pretty_json(report))

    if verify:
        committed = json.loads(receipt_path.read_text())
        if report != committed:
            raise ValueError('STALE RECEIPT: generated delta differs from committed hashes.json; do not install')

    print(f'{len(entries)} files ({replaced_count} replaced, {added_count} added, {removed_count} removed), '
          f'{total_bytes:,} bytes in {output}')
    return report


def _manifest_state(manifest: dict, receipt: dict) -> tuple[str, list[str]]:
    before_m = receipt['beforeManifest']
    after_m = receipt['afterManifest']
    keys = receipt['manifestKeys']
    states = set()
    details = []
    for k in keys:
        has_k = k in manifest
        val = manifest.get(k)
        b_has = k in before_m
        a_has = k in after_m
        is_before = (has_k == b_has) and (not b_has or val == before_m[k])
        is_after = (has_k == a_has) and (not a_has or val == after_m[k])
        if is_before and is_after:
            continue
        elif is_before:
            states.add('before')
        elif is_after:
            states.add('after')
        else:
            states.add('unknown')
            details.append(f'manifest.json[{k}]: unknown value')
    if not states:
        return 'before', []
    if states == {'before'}:
        return 'before', []
    if states == {'after'}:
        return 'after', []
    return 'mixed', details or [f'manifest.json: mixed keys ({sorted(states)})']


def land_state(baked: Path, receipt: dict) -> tuple[str, list[str]]:
    """Return ('before' | 'after' | 'mixed', details) for areas/cansocauseway in baked."""
    manifest_path = baked / receipt['pack'] / 'manifest.json'
    if not manifest_path.is_file():
        return 'mixed', [f'missing {manifest_path}']
    manifest = json.loads(manifest_path.read_bytes())
    m_state, m_details = _manifest_state(manifest, receipt)

    seen = set()
    details = list(m_details)
    if m_state == 'mixed':
        seen.add('mixed')
    else:
        seen.add(m_state)

    for entry in receipt['files']:
        rel = entry['file']
        p = baked / rel
        b_sha = entry['before']
        a_sha = entry['sha256']
        if not p.exists():
            if b_sha is None:
                seen.add('before')
            elif a_sha is None:
                seen.add('after')
            else:
                seen.add('unknown')
                details.append(f'{rel}: missing')
            continue
        if not p.is_file():
            seen.add('unknown')
            details.append(f'{rel}: not a regular file')
            continue
        digest = sha(p.read_bytes())
        if b_sha is not None and digest == b_sha:
            seen.add('before')
        elif a_sha is not None and digest == a_sha:
            seen.add('after')
        else:
            seen.add('unknown')
            details.append(f'{rel}: unknown sha256 {digest}')

    if seen == {'before'}:
        return 'before', []
    if seen == {'after'}:
        return 'after', []
    if not details:
        details = [f'mixed states: {sorted(seen)}']
    return 'mixed', details


def verify_delta(delta: Path, receipt: dict) -> dict[str, bytes]:
    """Verify hashes.json, manifest-patch.json, and every staged file in delta matches receipt."""
    _assert_no_symlink_path(delta)
    staged_receipt_path = delta / 'hashes.json'
    _assert_no_symlink_path(staged_receipt_path)
    if not staged_receipt_path.is_file():
        raise ValueError(f'Missing hashes.json in delta folder: {delta}')
    staged_receipt = json.loads(staged_receipt_path.read_text())
    if staged_receipt != receipt:
        raise ValueError('Delta hashes.json does not match committed receipt')

    mp_path = delta / receipt['pack'] / 'manifest-patch.json'
    _assert_no_symlink_path(mp_path)
    if not mp_path.is_file() or json.loads(mp_path.read_bytes()) != receipt['afterManifest']:
        raise ValueError(f'Delta manifest-patch.json missing or tampered: {mp_path}')

    delta_bytes = {}
    for entry in receipt['files']:
        rel = entry['file']
        if entry['sha256'] is None:
            continue
        p = delta / rel
        _assert_no_symlink_path(p)
        if not p.is_file():
            raise ValueError(f'Missing delta file: {p}')
        raw = p.read_bytes()
        if sha(raw) != entry['sha256'] or len(raw) != entry['bytes']:
            raise ValueError(f'Tampered delta file {rel}: sha256 {sha(raw)} bytes {len(raw)}')
        delta_bytes[rel] = raw
    return delta_bytes


def install(delta: Path, baked: Path, *, receipt_path: Path = RECEIPT) -> str:
    """Install verified Troy-to-West Bay delta into baked, backing up replaced files in <delta>/before/."""
    receipt = json.loads(receipt_path.read_text())
    delta_bytes = verify_delta(delta, receipt)
    backup_root = delta / 'before'
    _assert_no_symlink_path(baked)
    _assert_no_symlink_path(backup_root)

    manifest_path = baked / receipt['pack'] / 'manifest.json'
    _assert_no_symlink_path(manifest_path)
    if not manifest_path.is_file():
        raise ValueError(f'Missing live manifest: {manifest_path}')
    manifest = json.loads(manifest_path.read_bytes())
    m_state, m_details = _manifest_state(manifest, receipt)
    if m_state == 'mixed':
        raise ValueError(f'Unknown or mixed live manifest keys: {m_details}')

    # Phase 1: validate every live file, symlink path, and existing backup before writing anything.
    live_states = {}
    live_before_bytes = {}
    backup_present = {}
    for entry in receipt['files']:
        rel = entry['file']
        target = baked / rel
        backup = backup_root / rel
        _assert_no_symlink_path(target)
        _assert_no_symlink_path(backup)
        b_sha = entry['before']
        a_sha = entry['sha256']

        if not target.exists():
            if b_sha is None:
                live_states[rel] = 'before'
            elif a_sha is None:
                live_states[rel] = 'after'
            else:
                raise ValueError(f'Missing live file: {target}')
        else:
            if not target.is_file():
                raise ValueError(f'Live target is not a regular file: {target}')
            raw = target.read_bytes()
            digest = sha(raw)
            if b_sha is not None and digest == b_sha:
                live_states[rel] = 'before'
                live_before_bytes[rel] = raw
            elif a_sha is not None and digest == a_sha:
                live_states[rel] = 'after'
            else:
                raise ValueError(f'Unknown live bytes in {rel}: {digest}')

        if b_sha is not None:
            if backup.exists():
                if not backup.is_file() or sha(backup.read_bytes()) != b_sha:
                    raise ValueError(f'Existing backup has wrong hash: {backup}')
                backup_present[rel] = True
            else:
                backup_present[rel] = False

    # Every already-replaced/removed file must have a valid backup so rollback stays complete (even on all-after).
    for entry in receipt['files']:
        rel = entry['file']
        if entry['before'] is not None and live_states[rel] == 'after' and not backup_present[rel]:
            raise ValueError(f'Missing backup for already-installed file {rel}: {backup_root / rel}')

    if m_state == 'after' and all(v == 'after' for v in live_states.values()):
        print(f'already installed ({len(receipt["files"])} files match after receipt) in {baked}')
        return 'already-installed'

    # Phase 2: write all missing backups before modifying live land.
    for entry in receipt['files']:
        rel = entry['file']
        if entry['before'] is not None and live_states[rel] == 'before' and not backup_present[rel]:
            _atomic_write(backup_root / rel, live_before_bytes[rel])

    # Phase 3: atomically install added/replaced files, unlink removed files, then patch owned manifest keys.
    for entry in receipt['files']:
        rel = entry['file']
        if live_states[rel] == 'before':
            if entry['sha256'] is not None:
                _atomic_write(baked / rel, delta_bytes[rel])
            else:
                target = baked / rel
                _assert_no_symlink_path(target)
                if target.exists():
                    target.unlink()

    if m_state != 'after':
        live_m = json.loads(manifest_path.read_bytes())
        for k in receipt['manifestKeys']:
            if k in receipt['afterManifest']:
                live_m[k] = receipt['afterManifest'][k]
            else:
                live_m.pop(k, None)
        _atomic_write(manifest_path, compact_json(live_m))

    state, details = land_state(baked, receipt)
    if state != 'after':
        raise ValueError(f'Post-install verification failed ({state}): {details}')
    print(f'installed {len(receipt["files"])} files into {baked}; backup in {backup_root}')
    return 'installed'


def rollback(delta: Path, baked: Path, *, receipt_path: Path = RECEIPT) -> str:
    """Restore before-files from <delta>/before/, remove added files, and restore owned manifest keys."""
    _assert_no_symlink_path(delta)
    _assert_no_symlink_path(baked)
    receipt = json.loads(receipt_path.read_text())
    backup_root = delta / 'before'
    _assert_no_symlink_path(backup_root)

    manifest_path = baked / receipt['pack'] / 'manifest.json'
    _assert_no_symlink_path(manifest_path)
    if not manifest_path.is_file():
        raise ValueError(f'Missing live manifest: {manifest_path}')
    manifest = json.loads(manifest_path.read_bytes())
    m_state, m_details = _manifest_state(manifest, receipt)
    if m_state == 'mixed':
        raise ValueError(f'Refusing rollback over unknown or mixed manifest keys: {m_details}')

    live_states = {}
    backup_bytes = {}
    for entry in receipt['files']:
        rel = entry['file']
        target = baked / rel
        backup = backup_root / rel
        _assert_no_symlink_path(target)
        _assert_no_symlink_path(backup)
        b_sha = entry['before']
        a_sha = entry['sha256']

        if not target.exists():
            if b_sha is None:
                live_states[rel] = 'before'
            elif a_sha is None:
                live_states[rel] = 'after'
            else:
                raise ValueError(f'Missing live file: {target}')
        else:
            if not target.is_file():
                raise ValueError(f'Live target is not a regular file: {target}')
            digest = sha(target.read_bytes())
            if b_sha is not None and digest == b_sha:
                live_states[rel] = 'before'
            elif a_sha is not None and digest == a_sha:
                live_states[rel] = 'after'
            else:
                raise ValueError(f'Refusing rollback over unknown live bytes in {rel}: {digest}')

        if live_states[rel] == 'after' and b_sha is not None:
            if not backup.is_file():
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            raw = backup.read_bytes()
            if sha(raw) != b_sha:
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            backup_bytes[rel] = raw

    if m_state == 'before' and all(v == 'before' for v in live_states.values()):
        print(f'already at before state in {baked}')
        return 'already-before'

    # Restore manifest keys first so readers never see missing tiles listed in manifest.json.
    if m_state != 'before':
        live_m = json.loads(manifest_path.read_bytes())
        for k in receipt['manifestKeys']:
            if k in receipt['beforeManifest']:
                live_m[k] = receipt['beforeManifest'][k]
            else:
                live_m.pop(k, None)
        _atomic_write(manifest_path, compact_json(live_m))

    for entry in receipt['files']:
        rel = entry['file']
        if live_states[rel] == 'after':
            if entry['before'] is not None:
                _atomic_write(baked / rel, backup_bytes[rel])
            else:
                target = baked / rel
                _assert_no_symlink_path(target)
                if target.exists():
                    target.unlink()

    state, details = land_state(baked, receipt)
    if state != 'before':
        raise ValueError(f'Post-rollback verification failed ({state}): {details}')
    print(f'rolled back {len(receipt["files"])} files in {baked}')
    return 'rolled-back'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_make = sub.add_parser('make', help='Stage changed and added cansocauseway files into a NEW folder')
    p_make.add_argument('before', type=Path, help='Before baked land root (live data/baked)')
    p_make.add_argument('after', type=Path, help='After baked land root (rehearsed data/baked)')
    p_make.add_argument('output', type=Path, help='NEW output folder outside data/baked and data/site')
    p_make.add_argument('--paved-work', type=Path, default=None, help='Work output dir of 32_bake_paved.py to pin pavedArea')
    p_make.add_argument('--record', action='store_true', help='Skip committed hashes.json comparison when recording')

    p_verify = sub.add_parser('verify', help='Verify a staged delta folder and optional baked land root')
    p_verify.add_argument('delta', type=Path)
    p_verify.add_argument('baked', type=Path, nargs='?')

    p_install = sub.add_parser('install', help='Install verified delta into a baked land root (main thread only)')
    p_install.add_argument('delta', type=Path)
    p_install.add_argument('baked', type=Path)

    p_rollback = sub.add_parser('rollback', help='Restore backed-up before files and remove added files')
    p_rollback.add_argument('delta', type=Path)
    p_rollback.add_argument('baked', type=Path)

    args = parser.parse_args()
    if args.cmd == 'make':
        make(args.before, args.after, args.output, paved_work=args.paved_work, verify=not args.record)
    elif args.cmd == 'verify':
        receipt = json.loads(RECEIPT.read_text())
        verify_delta(args.delta, receipt)
        print(f'PASS delta verified: {args.delta}')
        if args.baked is not None:
            state, details = land_state(args.baked, receipt)
            print(f'land state: {state}')
            if state == 'mixed':
                raise SystemExit(f'FAIL mixed/unknown land: {details}')
    elif args.cmd == 'install':
        install(args.delta, args.baked)
    elif args.cmd == 'rollback':
        rollback(args.delta, args.baked)


if __name__ == '__main__':
    main()
