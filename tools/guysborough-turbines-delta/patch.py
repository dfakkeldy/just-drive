#!/usr/bin/env python3
"""Build, verify, install or roll back the Guysborough County wind turbines far-data delta.

Updates farms c01 (16 turbines) and c02 (all 24 turbines placed, adding c02-08 at its
measured position E 622595.0 / N 5047275.0 under the narrow track-934 pad-access-road
exception) to status 'operating' (observed operating, 26 Nov 2026) across all six areas'
tall.json packs. Updates tall.json and the manifest.json tall counts; preserves all other
manifest keys and all far-land*.bin meshes untouched. Never writes inside data/baked during make.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RECEIPT = HERE / 'hashes.json'
POINTS_PATH = ROOT / 'pipeline/far-views-points.json'

PACKS = (
    ('mabou', 'terrain'),
    ('judique', 'areas/judique'),
    ('porthood', 'areas/porthood'),
    ('pointtupper', 'areas/pointtupper'),
    ('westbay', 'areas/westbay'),
    ('cansocauseway', 'areas/cansocauseway'),
)
VALID_STATUSES = ('operating', 'built', 'under-construction')
_DARWIN_SYSTEM_SYMLINKS = {Path('/tmp'), Path('/var'), Path('/etc')}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compact_json(value) -> bytes:
    return (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def pretty_json(value) -> bytes:
    return (json.dumps(value, indent=2) + '\n').encode('utf-8')


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
    """Return resolved path (if it exists) and every existing ancestor directory."""
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


def assert_safe_stage_output(output: Path, source: Path):
    if output.exists():
        raise ValueError(f'Stage output already exists; pass a new folder: {output}')
    out_r = output.resolve()
    src_r = source.resolve()
    if out_r == src_r or out_r.is_relative_to(src_r) or src_r.is_relative_to(out_r):
        raise ValueError(f'Stage output must be separate from source land: {output}')
    # Compare real filesystem identity on resolved existing ancestors (catches symlink + .. + case-insensitive aliases like data/BAKED on APFS).
    out_ancestors = _existing_ancestors(out_r)
    for anc in out_ancestors:
        if src_r.exists() and os.path.samefile(anc, src_r):
            raise ValueError(f'Stage output must be separate from source land: {output}')
    for forbidden_name in ('baked', 'site'):
        live_dir = ROOT / 'data' / forbidden_name
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


def _root_box(manifest: dict) -> list:
    x, y = manifest['origin']
    s = manifest['size']
    return [x, y - s, x + s, y]


def _inside(e: float, n: float, b: list) -> bool:
    return b[0] <= e <= b[2] and b[1] <= n <= b[3]


def _distance_box(e: float, n: float, b: list) -> float:
    return ((max(b[0] - e, 0, e - b[2])) ** 2 + (max(b[1] - n, 0, n - b[3])) ** 2) ** 0.5


def _load_far_bake():
    sys.path.insert(0, str(ROOT / 'pipeline'))
    spec = importlib.util.spec_from_file_location('far_views_bake', ROOT / 'pipeline/34_bake_far_views.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_area_tall(base_tall: dict, manifest: dict, points_by_id: dict, extra_points: list[dict],
                    dem, inside_fn, dist_box_fn, root_box_fn) -> tuple[dict, dict]:
    """Return (updated_tall, manifest_tall_key) for one area without mutating base_tall."""
    if base_tall.get('version') != 2:
        raise ValueError(f'Expected version 2 tall.json, got {base_tall.get("version")!r}')
    root = root_box_fn(manifest)
    if base_tall.get('root') != root:
        raise ValueError(f'tall.json root {base_tall.get("root")} differs from manifest root {root}')

    def tag_existing(items: list[dict]) -> list[dict]:
        out = []
        for p in items:
            q = dict(p)
            pid = q.get('id')
            if pid in points_by_id:
                src_pt = points_by_id[pid]
                st = src_pt.get('status')
                if st not in VALID_STATUSES:
                    raise ValueError(f'Invalid status for {pid}: {st!r}')
                q['status'] = st
                if 'statusSource' in src_pt:
                    q['statusSource'] = src_pt['statusSource']
            elif q.get('source') == 'NRCan':
                q['status'] = 'operating'
            else:
                raise ValueError(f'Unexpected turbine id without status rule: {pid!r}')
            out.append(q)
        return out

    near = tag_existing(base_tall['turbines'])
    far = tag_existing(base_tall['far'])
    existing_ids = {p['id'] for p in near + far}

    for p in extra_points:
        if p['id'] in existing_ids:
            continue
        if dist_box_fn(p['e'], p['n'], root) > 80000:
            continue
        q = {
            k: p[k]
            for k in ('id', 'e', 'n', 'hub', 'diameter', 'farm', 'status', 'statusSource', 'source', 'date',
                      'dateKind', 'confidence', 'uncertainty', 'dimensions', 'dimensionsSource', 'tower')
            if k in p
        }
        if q.get('status') not in VALID_STATUSES:
            raise ValueError(f'Invalid status for {p["id"]}: {q.get("status")!r}')
        q['ground'] = round(dem.at(p['e'], p['n']), 2)
        (near if inside_fn(q['e'], q['n'], root) else far).append(q)

    updated = dict(base_tall)
    updated['turbines'] = near
    updated['far'] = far
    if extra_points and isinstance(updated.get('omitted'), dict) and 'turbines' in updated['omitted']:
        placed_now = {p['id'] for p in near + far}
        omitted = dict(updated['omitted'])
        omitted['turbines'] = [o for o in omitted['turbines'] if o.get('id') not in placed_now]
        updated['omitted'] = omitted
    tall_key = {
        'file': 'tall.json',
        'turbines': len(near),
        'far': len(far),
        'towers': len(updated['towers']),
        'lines': len(updated['lines']),
    }
    return updated, tall_key


def make(source: Path, raw: Path, output: Path, *, verify: bool = True, receipt_path: Path = RECEIPT) -> dict:
    assert_safe_stage_output(output, source)
    measurements = json.loads(POINTS_PATH.read_text())
    points_by_id = {p['id']: p for p in measurements['points']}

    # Screen any unplaced Sentinel-2 points (including previously omitted points now allowed)
    # against every area's roads and buildings with the exact producer rule.
    placed_ids = set()
    for _, rel in PACKS:
        t = json.loads((source / rel / 'tall.json').read_text())
        placed_ids.update(p['id'] for p in t['turbines'] + t['far'])
    new_points = [p for p in measurements['points'] if p['id'] not in placed_ids]

    if new_points:
        bake = _load_far_bake()
        dem = bake.DEM(raw / 'far-views/regional-240m.tif')
        inside_fn, dist_box_fn, root_box_fn = bake.inside, bake.distance_box, bake.root_box
        rejected = {}
        for area_id, rel in PACKS:
            area_dir = source / rel
            bounds = root_box_fn(json.loads((area_dir / 'manifest.json').read_text()))
            in_area = [p for p in new_points if inside_fn(p['e'], p['n'], bounds)]
            if in_area:
                _, conflicts = bake.safe_turbines(area_dir, in_area, area=area_id)
                for c in conflicts:
                    rejected.setdefault(c['id'], {**c, 'checkedArea': area_id})
        if rejected:
            raise ValueError(f'New turbine point(s) failed road/building clearance: {rejected}')
    else:
        dem = None
        inside_fn, dist_box_fn, root_box_fn = _inside, _distance_box, _root_box

    planned = []
    files = []
    status_changed = set()
    any_changed = False
    for area_id, rel in PACKS:
        area_dir = source / rel
        tall_path = area_dir / 'tall.json'
        manifest_path = area_dir / 'manifest.json'
        before_bytes = tall_path.read_bytes()
        before_tall = json.loads(before_bytes)
        manifest = json.loads(manifest_path.read_text())
        if 'farLand' not in manifest or 'tall' not in manifest:
            raise ValueError(f'{rel}: source manifest missing far pack keys')

        updated_tall, after_tall_key = build_area_tall(
            before_tall, manifest, points_by_id, new_points,
            dem, inside_fn, dist_box_fn, root_box_fn,
        )
        before_status = {p['id']: p.get('status') for p in before_tall['turbines'] + before_tall['far']}
        for p in updated_tall['turbines'] + updated_tall['far']:
            if p['id'] in before_status and before_status[p['id']] != p.get('status'):
                status_changed.add(p['id'])
        after_bytes = compact_json(updated_tall)
        if after_bytes != before_bytes:
            any_changed = True
        patch_obj = {'tall': after_tall_key, 'farLand': manifest['farLand']}
        planned.append((rel, after_bytes, compact_json(patch_obj)))

        files.append({
            'area': area_id,
            'pack': rel,
            'file': f'{rel}/tall.json',
            'before': sha(before_bytes),
            'beforeBytes': len(before_bytes),
            'sha256': sha(after_bytes),
            'bytes': len(after_bytes),
            'beforeManifestTall': manifest['tall'],
            'afterManifestTall': after_tall_key,
        })

    if not any_changed:
        raise ValueError('No tall.json changes relative to source land; is source already at after state?')

    report = {
        'version': 2,
        'issue': 1430,
        'addedPoints': [p['id'] for p in new_points],
        'statusChanged': sorted(status_changed),
        'files': files,
    }
    if verify:
        committed = json.loads(receipt_path.read_text())
        if report != committed:
            raise ValueError('STALE RECEIPT: generated delta differs from committed hashes.json; do not install')

    output.mkdir(parents=True, exist_ok=False)
    for rel, after_bytes, patch_bytes in planned:
        out_dir = output / rel
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / 'tall.json').write_bytes(after_bytes)
        (out_dir / 'manifest-patch.json').write_bytes(patch_bytes)
    (output / 'hashes.json').write_bytes(pretty_json(report))

    total_bytes = sum(f['bytes'] for f in files)
    print(f'{len(files)} tall packs ({total_bytes:,} bytes) staged in {output}')
    return report


def land_state(baked: Path, receipt: dict) -> tuple[str, list[str]]:
    """Return ('before' | 'after' | 'mixed', details) for all six areas in baked."""
    states = {}
    details = []
    for entry in receipt['files']:
        pack = entry['pack']
        tall_path = baked / entry['file']
        manifest_path = baked / pack / 'manifest.json'
        if not tall_path.is_file() or not manifest_path.is_file():
            states[pack] = 'missing'
            details.append(f'{pack}: missing tall.json or manifest.json')
            continue
        digest = sha(tall_path.read_bytes())
        manifest = json.loads(manifest_path.read_text())
        mtall = manifest.get('tall')
        if digest == entry['before'] and mtall == entry['beforeManifestTall']:
            states[pack] = 'before'
        elif digest == entry['sha256'] and mtall == entry['afterManifestTall']:
            states[pack] = 'after'
        else:
            states[pack] = 'unknown'
            details.append(f'{pack}: tall={digest[:12]} manifest.tall={mtall}')
    unique = set(states.values())
    if unique == {'before'}:
        return 'before', []
    if unique == {'after'}:
        return 'after', []
    if not details:
        details = [f'{k}: {v}' for k, v in sorted(states.items())]
    return 'mixed', details


def verify_delta(delta: Path, receipt: dict) -> dict[str, bytes]:
    """Verify staged hashes.json, tall.json files, and manifest-patch.json files match receipt."""
    _assert_no_symlink_path(delta)
    staged_path = delta / 'hashes.json'
    _assert_no_symlink_path(staged_path)
    if not staged_path.is_file():
        raise ValueError(f'Missing hashes.json in delta folder: {delta}')
    if json.loads(staged_path.read_text()) != receipt:
        raise ValueError('Delta hashes.json does not match committed receipt')
    delta_bytes = {}
    for entry in receipt['files']:
        rel = entry['file']
        p = delta / rel
        _assert_no_symlink_path(p)
        if not p.is_file():
            raise ValueError(f'Missing delta file: {p}')
        raw = p.read_bytes()
        if sha(raw) != entry['sha256'] or len(raw) != entry['bytes']:
            raise ValueError(f'Tampered delta file {rel}: sha256 {sha(raw)} bytes {len(raw)}')
        patch_path = delta / entry['pack'] / 'manifest-patch.json'
        _assert_no_symlink_path(patch_path)
        if not patch_path.is_file():
            raise ValueError(f'Missing manifest-patch.json: {patch_path}')
        patch_obj = json.loads(patch_path.read_text())
        if patch_obj.get('tall') != entry['afterManifestTall']:
            raise ValueError(f'manifest-patch.json mismatch in {entry["pack"]}')
        delta_bytes[rel] = raw
    return delta_bytes


def install(delta: Path, baked: Path, *, receipt_path: Path = RECEIPT) -> str:
    """Install verified delta into baked, backing up before tall.json files into <delta>/before/."""
    receipt = json.loads(receipt_path.read_text())
    delta_bytes = verify_delta(delta, receipt)
    backup_root = delta / 'before'

    live_states = {}
    live_before_bytes = {}
    live_manifests = {}
    backup_present = {}
    for entry in receipt['files']:
        pack = entry['pack']
        rel = entry['file']
        tall_target = baked / rel
        manifest_target = baked / pack / 'manifest.json'
        backup = backup_root / rel
        _assert_no_symlink_path(tall_target)
        _assert_no_symlink_path(manifest_target)
        _assert_no_symlink_path(backup)
        if not tall_target.is_file() or not manifest_target.is_file():
            raise ValueError(f'Missing live file in {pack}')
        raw = tall_target.read_bytes()
        digest = sha(raw)
        manifest = json.loads(manifest_target.read_text())
        if 'farLand' not in manifest:
            raise ValueError(f'Live manifest in {pack} has no farLand key')
        if digest == entry['before'] and manifest.get('tall') == entry['beforeManifestTall']:
            live_states[pack] = 'before'
            live_before_bytes[pack] = raw
            live_manifests[pack] = manifest
        elif digest == entry['sha256'] and manifest.get('tall') == entry['afterManifestTall']:
            live_states[pack] = 'after'
        elif digest == entry['sha256'] and manifest.get('tall') == entry['beforeManifestTall']:
            # Interrupted between tall.json replace and manifest.json replace during an earlier install.
            live_states[pack] = 'half-install'
            live_manifests[pack] = manifest
        elif digest == entry['before'] and manifest.get('tall') == entry['afterManifestTall']:
            # Interrupted between tall.json replace and manifest.json replace during an earlier rollback.
            live_states[pack] = 'half-rollback'
            live_before_bytes[pack] = raw
            live_manifests[pack] = manifest
        else:
            raise ValueError(f'Unknown live bytes in {pack}: tall={digest} manifest.tall={manifest.get("tall")}')
        if backup.exists():
            if not backup.is_file() or sha(backup.read_bytes()) != entry['before']:
                raise ValueError(f'Existing backup has wrong hash: {backup}')
            backup_present[pack] = True
        else:
            backup_present[pack] = False

    for entry in receipt['files']:
        pack = entry['pack']
        if live_states[pack] in ('after', 'half-install') and not backup_present[pack]:
            raise ValueError(f'Missing backup for already-installed area {pack}: {backup_root / entry["file"]}')

    if set(live_states.values()) == {'after'}:
        print(f'already installed ({len(receipt["files"])} areas match after receipt) in {baked}')
        return 'already-installed'

    # Phase 2: write all missing backups before modifying any live file.
    for entry in receipt['files']:
        pack = entry['pack']
        if live_states[pack] in ('before', 'half-rollback') and not backup_present[pack]:
            _atomic_write(backup_root / entry['file'], live_before_bytes[pack])

    # Phase 3: atomically update tall.json, and update ONLY the tall key in manifest.json when counts changed.
    for entry in receipt['files']:
        pack = entry['pack']
        st = live_states[pack]
        if st in ('before', 'half-rollback'):
            _atomic_write(baked / entry['file'], delta_bytes[entry['file']])
        if st in ('before', 'half-install') and entry['afterManifestTall'] != entry['beforeManifestTall']:
            updated_manifest = dict(live_manifests[pack])
            updated_manifest['tall'] = entry['afterManifestTall']
            _atomic_write(baked / pack / 'manifest.json', compact_json(updated_manifest))

    state, details = land_state(baked, receipt)
    if state != 'after':
        raise ValueError(f'Post-install verification failed ({state}): {details}')
    print(f'installed {len(receipt["files"])} tall packs into {baked}; backup in {backup_root}')
    return 'installed'


def rollback(delta: Path, baked: Path, *, receipt_path: Path = RECEIPT) -> str:
    """Restore before tall.json files and before manifest tall keys in baked."""
    _assert_no_symlink_path(delta)
    receipt = json.loads(receipt_path.read_text())
    backup_root = delta / 'before'

    live_states = {}
    backup_bytes = {}
    live_manifests = {}
    for entry in receipt['files']:
        pack = entry['pack']
        rel = entry['file']
        tall_target = baked / rel
        manifest_target = baked / pack / 'manifest.json'
        backup = backup_root / rel
        _assert_no_symlink_path(tall_target)
        _assert_no_symlink_path(manifest_target)
        _assert_no_symlink_path(backup)
        if not tall_target.is_file() or not manifest_target.is_file():
            raise ValueError(f'Missing live file in {pack}')
        digest = sha(tall_target.read_bytes())
        manifest = json.loads(manifest_target.read_text())
        if digest == entry['before'] and manifest.get('tall') == entry['beforeManifestTall']:
            live_states[pack] = 'before'
        elif digest == entry['sha256'] and manifest.get('tall') == entry['afterManifestTall']:
            live_states[pack] = 'after'
            if not backup.is_file():
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            raw = backup.read_bytes()
            if sha(raw) != entry['before']:
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            backup_bytes[pack] = raw
            live_manifests[pack] = manifest
        elif digest == entry['sha256'] and manifest.get('tall') == entry['beforeManifestTall']:
            # Interrupted between tall.json replace and manifest.json replace during install: restore tall.json from backup.
            live_states[pack] = 'half-install'
            if not backup.is_file():
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            raw = backup.read_bytes()
            if sha(raw) != entry['before']:
                raise ValueError(f'Missing or mismatched backup for {rel}: {backup}')
            backup_bytes[pack] = raw
        elif digest == entry['before'] and manifest.get('tall') == entry['afterManifestTall']:
            # Interrupted between tall.json replace and manifest.json replace during rollback: restore manifest.json.
            live_states[pack] = 'half-rollback'
            live_manifests[pack] = manifest
        else:
            raise ValueError(f'Refusing rollback over unknown live bytes in {pack}: {digest}')

    if set(live_states.values()) == {'before'}:
        print(f'already at before state in {baked}')
        return 'already-before'

    for entry in receipt['files']:
        pack = entry['pack']
        st = live_states[pack]
        if st in ('after', 'half-install'):
            _atomic_write(baked / entry['file'], backup_bytes[pack])
        if st in ('after', 'half-rollback') and entry['afterManifestTall'] != entry['beforeManifestTall']:
            restored_manifest = dict(live_manifests[pack])
            restored_manifest['tall'] = entry['beforeManifestTall']
            _atomic_write(baked / pack / 'manifest.json', compact_json(restored_manifest))

    state, details = land_state(baked, receipt)
    if state != 'before':
        raise ValueError(f'Post-rollback verification failed ({state}): {details}')
    print(f'rolled back {len(receipt["files"])} tall packs in {baked}')
    return 'rolled-back'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_make = sub.add_parser('make', help='Stage the six updated tall.json packs into a NEW folder outside data/baked')
    p_make.add_argument('source', type=Path, help='Baked land root containing PR #9 far pack')
    p_make.add_argument('raw', type=Path, help='Raw data root containing far-views/regional-240m.tif')
    p_make.add_argument('output', type=Path, help='NEW output folder outside data/baked and data/site')
    p_make.add_argument('--record', action='store_true', help='Skip committed hashes.json comparison when recording')

    p_verify = sub.add_parser('verify', help='Verify a staged delta folder and optional baked land root')
    p_verify.add_argument('delta', type=Path)
    p_verify.add_argument('baked', type=Path, nargs='?')

    p_install = sub.add_parser('install', help='Install verified delta into a baked land root (main thread only)')
    p_install.add_argument('delta', type=Path)
    p_install.add_argument('baked', type=Path)

    p_rollback = sub.add_parser('rollback', help='Restore backed-up before tall.json files and manifest tall keys')
    p_rollback.add_argument('delta', type=Path)
    p_rollback.add_argument('baked', type=Path)

    args = parser.parse_args()
    if args.cmd == 'make':
        make(args.source, args.raw, args.output, verify=not args.record)
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
