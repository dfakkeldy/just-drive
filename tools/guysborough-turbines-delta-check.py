#!/usr/bin/env python3
"""Check the Guysborough turbines far-data delta: synthetic build/install/rollback/refusals, receipt, land state, and remake.

No land writes into data/baked. Runs in clean CI without data/ (synthetic fixture + mutants + schema),
and checks live/rehearsal land plus byte-for-byte remake when data/ and GDAL exist.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DELTA_DIR = ROOT / 'tools/guysborough-turbines-delta'
RECEIPT = DELTA_DIR / 'hashes.json'
# None accepts all-before or all-after until the main thread installs the delta and flips this to 'after'.
EXPECT = None

spec = importlib.util.spec_from_file_location('guysborough_turbines_patch', DELTA_DIR / 'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def refused(words: str, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except (ValueError, AssertionError, SystemExit) as err:
        assert words in str(err), f'expected {words!r} in error, got: {err}'
        return
    raise AssertionError(f'accepted mutant/invalid case: {words}')


def check_build_logic():
    """Verify synthetic status tagging, c02-24 placement, and invalid-status refusal."""
    class FakeDem:
        def at(self, e, n):
            return 175.432

    root_box = lambda m: [m['origin'][0], m['origin'][1] - m['size'], m['origin'][0] + m['size'], m['origin'][1]]
    inside = lambda e, n, b: b[0] <= e <= b[2] and b[1] <= n <= b[3]
    dist_box = lambda e, n, b: ((max(b[0] - e, 0, e - b[2])) ** 2 + (max(b[1] - n, 0, n - b[3])) ** 2) ** 0.5

    manifest = {'origin': [591500, 5103332], 'size': 65536}
    base_tall = {
        'version': 2,
        'crs': 'EPSG:2961',
        'root': root_box(manifest),
        'turbines': [
            {'id': 'nrcan-1', 'e': 628000, 'n': 5052000, 'hub': 50, 'diameter': 48, 'farm': 'n068', 'source': 'NRCan', 'ground': 40},
            {'id': 'c02-01', 'e': 618355, 'n': 5049785, 'hub': 118, 'diameter': 163, 'farm': 'c02', 'source': 'Sentinel-2 L2A', 'ground': 170},
        ],
        'far': [
            {'id': 'c01-01', 'e': 562295, 'n': 5043505, 'hub': 125, 'diameter': 163, 'farm': 'c01', 'source': 'Sentinel-2 L2A', 'ground': 210},
        ],
        'towers': [],
        'lines': [],
    }
    pts_by_id = {
        'c01-01': {'id': 'c01-01', 'farm': 'c01', 'status': 'built'},
        'c02-01': {'id': 'c02-01', 'farm': 'c02', 'status': 'operating'},
    }
    extra = [{'id': 'c02-24', 'farm': 'c02', 'e': 622465.0, 'n': 5046105.0, 'hub': 118, 'diameter': 163,
              'status': 'operating', 'source': 'Sentinel-2 L2A', 'date': '2026-10-26', 'dateKind': 'acquired',
              'confidence': 'medium', 'uncertainty': 30, 'dimensions': 'assumed-modern-era',
              'dimensionsSource': 'assumption-c02', 'tower': 'not-resolved'}]

    updated, tall_key = patch.build_area_tall(base_tall, manifest, pts_by_id, extra, FakeDem(), inside, dist_box, root_box)
    assert len(updated['turbines']) == 3 and updated['turbines'][2]['id'] == 'c02-24'
    assert updated['turbines'][0]['status'] == 'operating'
    assert updated['turbines'][1]['status'] == 'operating'
    assert updated['turbines'][2]['status'] == 'operating'
    assert updated['turbines'][2]['ground'] == 175.43
    assert updated['far'][0]['status'] == 'built'
    assert tall_key == {'file': 'tall.json', 'turbines': 3, 'far': 1, 'towers': 0, 'lines': 0}

    # Far placement check when root is Mabou (north of c02-24).
    mabou_manifest = {'origin': [591500, 5136100], 'size': 65536}
    mabou_tall = {**base_tall, 'root': root_box(mabou_manifest), 'turbines': [], 'far': base_tall['turbines'] + base_tall['far']}
    m_up, m_key = patch.build_area_tall(mabou_tall, mabou_manifest, pts_by_id, extra, FakeDem(), inside, dist_box, root_box)
    assert m_key['turbines'] == 0 and m_key['far'] == 4 and any(p['id'] == 'c02-24' for p in m_up['far'])

    # Invalid status mutant refused.
    bad_pts = {**pts_by_id, 'c01-01': {'id': 'c01-01', 'farm': 'c01', 'status': 'planned'}}
    refused('Invalid status', patch.build_area_tall, base_tall, manifest, bad_pts, extra, FakeDem(), inside, dist_box, root_box)
    # Wrong tall version refused.
    refused('version 2', patch.build_area_tall, {**base_tall, 'version': 1}, manifest, pts_by_id, extra, FakeDem(), inside, dist_box, root_box)
    print('PASS synthetic build logic: operating/built status tagging, near/far c02-24 placement, and invalid-status/version refusals')


def check_install_and_refusals():
    """Test stage path guards, verify, install, idempotence, rollback, manifest preservation, and all refusals."""
    with tempfile.TemporaryDirectory(prefix='guysborough-delta-check-') as tmp_str:
        tmp = Path(tmp_str)
        data = tmp / 'data'
        baked = data / 'baked'
        delta = tmp / 'delta'

        files = []
        for area_id, pack in (('mabou', 'terrain'), ('pointtupper', 'areas/pointtupper')):
            rel = f'{pack}/tall.json'
            b0 = patch.compact_json({'version': 2, 'area': area_id, 'n': 1})
            b1 = patch.compact_json({'version': 2, 'area': area_id, 'n': 2, 'status': 'operating'})
            before_tall = {'file': 'tall.json', 'turbines': 2, 'far': 162, 'towers': 0, 'lines': 0}
            after_tall = {'file': 'tall.json', 'turbines': 2, 'far': 163, 'towers': 0, 'lines': 0}
            live_dir = baked / pack
            live_dir.mkdir(parents=True, exist_ok=True)
            (live_dir / 'tall.json').write_bytes(b0)
            (live_dir / 'manifest.json').write_bytes(patch.compact_json({
                'crs': 'EPSG:2961', 'tall': before_tall, 'farLand': {'file': 'far-land.json'}, 'keepKey': {'v': 7},
            }))
            delta_dir = delta / pack
            delta_dir.mkdir(parents=True, exist_ok=True)
            (delta_dir / 'tall.json').write_bytes(b1)
            (delta_dir / 'manifest-patch.json').write_bytes(patch.compact_json({'tall': after_tall, 'farLand': {'file': 'far-land.json'}}))
            files.append({
                'area': area_id, 'pack': pack, 'file': rel,
                'before': patch.sha(b0), 'sha256': patch.sha(b1), 'bytes': len(b1),
                'beforeManifestTall': before_tall, 'afterManifestTall': after_tall,
            })

        receipt = {'version': 1, 'issue': 1430, 'addedPoints': ['c02-24'], 'files': files}
        receipt_file = tmp / 'committed-hashes.json'
        receipt_file.write_bytes(patch.pretty_json(receipt))
        (delta / 'hashes.json').write_bytes(patch.pretty_json(receipt))

        # Stage output guards.
        refused('already exists', patch.assert_safe_stage_output, delta, baked)
        refused('separate from source', patch.assert_safe_stage_output, baked / 'new-out', baked)
        refused('outside data/baked', patch.assert_safe_stage_output, data / 'baked/sub', tmp / 'other-src')
        refused('outside data/site', patch.assert_safe_stage_output, data / 'site/sub', tmp / 'other-src')
        patch.assert_safe_stage_output(tmp / 'brand-new-stage', baked)

        assert patch.land_state(baked, receipt) == ('before', [])

        # Tampered delta refusal.
        bad_delta = tmp / 'bad-delta'
        shutil.copytree(delta, bad_delta)
        (bad_delta / 'terrain/tall.json').write_bytes(b'tampered')
        refused('Tampered delta file', patch.install, bad_delta, baked, receipt_path=receipt_file)

        # Foreign receipt refusal.
        bad_rec = tmp / 'bad-rec'
        shutil.copytree(delta, bad_rec)
        (bad_rec / 'hashes.json').write_text('{"version":1,"files":[]}\n')
        refused('does not match committed receipt', patch.install, bad_rec, baked, receipt_path=receipt_file)

        # Unknown live bytes refusal.
        orig = (baked / 'terrain/tall.json').read_bytes()
        (baked / 'terrain/tall.json').write_bytes(b'{"version":2}')
        assert patch.land_state(baked, receipt)[0] == 'mixed'
        refused('Unknown live bytes', patch.install, delta, baked, receipt_path=receipt_file)
        assert not (delta / 'before').exists(), 'failed install must not write backups'
        (baked / 'terrain/tall.json').write_bytes(orig)

        # Symlinked parent directory refusal.
        wt_link = tmp / 'wt/data'
        wt_link.parent.mkdir(parents=True, exist_ok=True)
        wt_link.symlink_to(data)
        refused('symlink', patch.install, delta, wt_link / 'baked', receipt_path=receipt_file)

        # Clean install preserves unrelated manifest keys (keepKey).
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'installed'
        assert patch.land_state(baked, receipt) == ('after', [])
        assert json.loads((baked / 'terrain/manifest.json').read_text())['keepKey'] == {'v': 7}
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'already-installed'

        # Rollback through symlinked parent refused.
        refused('symlink', patch.rollback, delta, wt_link / 'baked', receipt_path=receipt_file)

        # Rollback preserves unrelated manifest keys added after install.
        m = json.loads((baked / 'terrain/manifest.json').read_text())
        m['laterKey'] = 42
        (baked / 'terrain/manifest.json').write_bytes(patch.compact_json(m))
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'rolled-back'
        assert patch.land_state(baked, receipt) == ('before', [])
        restored_m = json.loads((baked / 'terrain/manifest.json').read_text())
        assert restored_m['keepKey'] == {'v': 7} and restored_m['laterKey'] == 42
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'already-before'
        print('PASS synthetic install/rollback lifecycle, manifest key preservation, and all refusals')


def check_receipt_schema() -> dict:
    assert RECEIPT.is_file(), f'Missing committed receipt: {RECEIPT}'
    receipt = json.loads(RECEIPT.read_text())
    assert receipt.get('version') == 1 and receipt.get('issue') == 1430
    assert receipt.get('addedPoints') == ['c02-24'], f'Unexpected addedPoints: {receipt.get("addedPoints")}'
    packs = [f['pack'] for f in receipt.get('files', [])]
    assert packs == [p for _, p in patch.PACKS], f'Unexpected packs: {packs}'
    for f in receipt['files']:
        for k in ('before', 'sha256'):
            assert isinstance(f[k], str) and len(f[k]) == 64, f'Bad hash in {f}'
        assert f['before'] != f['sha256'], f'No-op hash in {f}'
        assert f['bytes'] > 0
        bm, am = f['beforeManifestTall'], f['afterManifestTall']
        assert bm['towers'] == am['towers'] and bm['lines'] == am['lines']
        assert (am['turbines'] + am['far']) - (bm['turbines'] + bm['far']) == 1, f'Expected +1 turbine in {f["pack"]}'
    print(f'PASS committed receipt schema ({len(packs)} areas, +1 turbine each)')
    return receipt


def check_real_land(baked: Path, raw: Path, receipt: dict, *, do_remake: bool):
    if not (baked / 'terrain/manifest.json').is_file():
        print('NO LAND: no baked land on this host; land state and remake skipped')
        return
    state, details = patch.land_state(baked, receipt)
    assert state in ('before', 'after'), f'Guysborough delta land state is {state}: {details}'
    if EXPECT is not None:
        assert state == EXPECT, f'Land state is {state}, expected {EXPECT}'
    print(f'PASS Guysborough delta land state: {state} (EXPECT={EXPECT!r})')
    if not do_remake or state != 'before':
        if state == 'after':
            print('PASS remake skipped (land already at after state)')
        return
    try:
        from osgeo import gdal  # noqa: F401
    except ImportError:
        print('NOT REMADE: GDAL (osgeo) is missing')
        return
    if not (raw / 'far-views/regional-240m.tif').is_file():
        print('NOT REMADE: missing raw/far-views/regional-240m.tif')
        return
    with tempfile.TemporaryDirectory(dir=os.environ.get('OUT') or None, prefix='guysborough-remake-') as tmp_str:
        stage = Path(tmp_str) / 'stage'
        patch.make(baked, raw, stage, verify=True, receipt_path=RECEIPT)
        patch.verify_delta(stage, receipt)
    print('PASS remade: patch.py make reproduced all 6 tall.json packs byte-for-byte')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--land', action='store_true', help='Also verify baked land state')
    parser.add_argument('--remake', action='store_true', help='Also remake from baked + MRDEM when available')
    parser.add_argument('--land-root', type=Path, default=ROOT / 'data/baked')
    parser.add_argument('--raw-root', type=Path, default=ROOT / 'data/raw')
    args = parser.parse_args()

    check_build_logic()
    check_install_and_refusals()
    receipt = check_receipt_schema()
    if args.land or args.remake:
        check_real_land(args.land_root, args.raw_root, receipt, do_remake=True)
    print('PASS guysborough-turbines-delta')


if __name__ == '__main__':
    main()
