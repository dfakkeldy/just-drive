#!/usr/bin/env python3
"""Check the West Bay track 263 trough delta: synthetic shaping/refusals, receipt, land state, and GDAL remake.

No land writes into data/baked. Runs in clean CI without data/ (synthetic fixture + mutants + schema),
and checks live/rehearsal land plus byte-for-byte remake when data/ and GDAL exist.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DELTA_DIR = ROOT / 'tools/westbay-track263-delta'
RECEIPT = DELTA_DIR / 'hashes.json'
# None accepts all-before or all-after until the main thread installs the delta and flips this to 'after'.
EXPECT = None

spec = importlib.util.spec_from_file_location('westbay_track263_patch', DELTA_DIR / 'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def refused(words: str, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except (ValueError, AssertionError, SystemExit) as err:
        assert words in str(err), f'expected {words!r} in error, got: {err}'
        return
    raise AssertionError(f'accepted mutant/invalid case: {words}')


def check_shaping_math():
    """Verify synthetic trough + spoil berm shaping, narrow width, zero far changes, and canopy handling."""
    halo = (631500.0, 5064300.0, 631700.0, 5064500.0)
    h_shape = (201, 201)
    yy, xx = np.mgrid[0:h_shape[0], 0:h_shape[1]]
    ee = halo[0] + xx
    nn = halo[3] - yy

    # Straight E-W synthetic track along N = 5064400 from E = 631520 to 631680 (s = 800..960 shifted by prefix).
    pts = np.array([[630720.0, 5064400.0]] + [[631520.0 + i, 5064400.0] for i in range(161)], dtype=np.float64)
    # Uniform -3% grade from s=800 (60.0 m), with a 2.0 m gully across the whole N range at s=835 and +0.8 m berm at s=844.
    s_grid = ee - 631520.0 + 800.0
    base = 60.0 - 0.03 * (s_grid - 800.0)
    gully = -2.0 * np.exp(-0.5 * ((s_grid - 835.0) / 2.2) ** 2)
    berm = 0.8 * np.exp(-0.5 * ((s_grid - 844.0) / 2.0) ** 2)
    dtm = (base + gully + berm).astype(np.float32)
    dsm = (dtm + 0.4).astype(np.float32)  # 0.4 m low scrub across the gully

    out_dtm, out_dsm, stats = patch.shape_trough(
        dtm, dsm, halo, pts,
        patch_box=(631530.0, 5064380.0, 631590.0, 5064420.0),
    )

    row_centre = int(halo[3] - 5064400.0)
    col_835 = int(631555.0 - halo[0])
    col_844 = int(631564.0 - halo[0])
    # Centreline ditch is filled and spoil berm is shaved to within 5 cm of the undisturbed -3% grade.
    assert abs(float(out_dtm[row_centre, col_835]) - float(base[row_centre, col_835])) < 0.05, \
        f'ditch not filled: {out_dtm[row_centre, col_835]} vs {base[row_centre, col_835]}'
    assert abs(float(out_dtm[row_centre, col_844]) - float(base[row_centre, col_844])) < 0.05, \
        f'spoil berm not smoothed: {out_dtm[row_centre, col_844]} vs {base[row_centre, col_844]}'
    # Track bed (+/- 3 m) stays flat across the track; real gully beyond +/- 6 m stays untouched.
    assert abs(float(out_dtm[row_centre - 3, col_835]) - float(out_dtm[row_centre, col_835])) < 0.01
    assert abs(float(out_dtm[row_centre + 3, col_835]) - float(out_dtm[row_centre, col_835])) < 0.01
    assert float(out_dtm[row_centre - 7, col_835]) == float(dtm[row_centre - 7, col_835]), 'gully north of track must stay untouched'
    assert float(out_dtm[row_centre + 7, col_835]) == float(dtm[row_centre + 7, col_835]), 'gully south of track must stay untouched'
    # Outside s0-2..s1+2 along the track stays untouched.
    assert np.array_equal(out_dtm[:, :int(631545 - halo[0])], dtm[:, :int(631545 - halo[0])])
    assert np.array_equal(out_dtm[:, int(631576 - halo[0]):], dtm[:, int(631576 - halo[0]):])
    # Low scrub on the graded bed is cleared (canopy = 0); outside the bed gully scrub remains.
    assert abs(float(out_dsm[row_centre, col_835] - out_dtm[row_centre, col_835])) < 1e-5
    assert abs(float(out_dsm[row_centre - 7, col_835] - out_dtm[row_centre - 7, col_835]) - 0.4) < 1e-4
    # Edge check mutant: changing an edge pixel must fail _check_tile_edges_unchanged.
    before_rgb = np.zeros((3, 257, 257), dtype=np.uint8)
    bad_rgb = before_rgb.copy()
    bad_rgb[0, 0, 10] = 1
    refused('tile edge changed', patch._check_tile_edges_unchanged, before_rgb, bad_rgb, 'synthetic')
    # Nodata anchor mutant: NODATA at an anchor slope must fail closed.
    bad_dtm = dtm.copy()
    bad_dtm[row_centre, int(631548.0 - halo[0])] = patch.NODATA
    refused('nodata DTM', patch.shape_trough, bad_dtm, dsm, halo, pts,
            patch_box=(631530.0, 5064380.0, 631590.0, 5064420.0))
    print(f'PASS synthetic shaping math (delta [{stats["minDeltaM"]}, {stats["maxDeltaM"]}] m; bed flat, outer gully intact, edge and nodata guards)')


def check_install_and_refusals():
    """Test stage path guards, verify, install, idempotence, rollback, and all tamper/mixed refusals."""
    with tempfile.TemporaryDirectory(prefix='wb263-delta-check-') as tmp_str:
        tmp = Path(tmp_str)
        data = tmp / 'data'
        baked = data / 'baked'
        delta = tmp / 'delta'

        files = []
        for name, b0, b1 in (
            ('areas/westbay/7/78_76.png', b'before-l7-tile', b'after-l7-tile-v1'),
            ('areas/westbay/8/156_152.png', b'before-l8-tile', b'after-l8-tile-v1'),
        ):
            p_live = baked / name
            p_live.parent.mkdir(parents=True, exist_ok=True)
            p_live.write_bytes(b0)
            p_delta = delta / name
            p_delta.parent.mkdir(parents=True, exist_ok=True)
            p_delta.write_bytes(b1)
            files.append(dict(file=name, before=patch.sha(b0), sha256=patch.sha(b1), bytes=len(b1), changedPixels=10, maxEdgeDiff=0))

        receipt = dict(version=1, area='westbay', roadId=263, files=files)
        receipt_file = tmp / 'committed-hashes.json'
        receipt_file.write_bytes(patch.encoded_json(receipt))
        (delta / 'hashes.json').write_bytes(patch.encoded_json(receipt))

        # Stage output guards.
        refused('already exists', patch.assert_safe_stage_output, delta, baked)
        refused('separate from source', patch.assert_safe_stage_output, baked / 'new-out', baked)
        refused('outside data/baked', patch.assert_safe_stage_output, data / 'baked/sub', tmp / 'other-src')
        refused('outside data/baked', patch.assert_safe_stage_output, data / 'site/sub', tmp / 'other-src')
        patch.assert_safe_stage_output(tmp / 'brand-new-stage', baked)

        # Receipt & tamper refusals before install.
        assert patch.land_state(baked, receipt) == ('before', [])
        bad_delta = tmp / 'bad-delta'
        shutil.copytree(delta, bad_delta)
        (bad_delta / 'areas/westbay/8/156_152.png').write_bytes(b'tampered')
        refused('Tampered delta file', patch.install, bad_delta, baked, receipt_path=receipt_file)

        # Foreign receipt refusal.
        bad_rec = tmp / 'bad-rec-delta'
        shutil.copytree(delta, bad_rec)
        (bad_rec / 'hashes.json').write_text('{"version":1,"files":[]}\n')
        refused('does not match committed receipt', patch.install, bad_rec, baked, receipt_path=receipt_file)

        # Unknown live bytes refusal (writes nothing).
        orig_l8 = (baked / 'areas/westbay/8/156_152.png').read_bytes()
        (baked / 'areas/westbay/8/156_152.png').write_bytes(b'stranger')
        assert patch.land_state(baked, receipt)[0] == 'mixed'
        refused('Unknown live bytes', patch.install, delta, baked, receipt_path=receipt_file)
        assert not (delta / 'before').exists(), 'failed install must not write backups'
        (baked / 'areas/westbay/8/156_152.png').write_bytes(orig_l8)

        # Clean install -> idempotent repeat -> rollback -> idempotent rollback.
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'installed'
        assert patch.land_state(baked, receipt) == ('after', [])
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'already-installed'

        # Partial/mixed state detection.
        (baked / 'areas/westbay/7/78_76.png').write_bytes(b'before-l7-tile')
        assert patch.land_state(baked, receipt)[0] == 'mixed'
        # Resuming an interrupted install finishes cleanly.
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'installed'
        assert patch.land_state(baked, receipt) == ('after', [])

        # Symlink refusal on install/rollback.
        sym_baked = tmp / 'sym-baked'
        shutil.copytree(baked, sym_baked)
        sym_tile = sym_baked / 'areas/westbay/8/156_152.png'
        sym_tile.unlink()
        sym_tile.symlink_to(delta / 'areas/westbay/8/156_152.png')
        refused('symlink', patch.rollback, delta, sym_baked, receipt_path=receipt_file)

        # Rollback restores exact before state.
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'rolled-back'
        assert patch.land_state(baked, receipt) == ('before', [])
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'already-before'
        print('PASS synthetic install/rollback lifecycle and all 8 tamper/path/mixed/symlink refusals')


def check_receipt_schema() -> dict:
    assert RECEIPT.is_file(), f'Missing committed receipt: {RECEIPT}'
    receipt = json.loads(RECEIPT.read_text())
    assert receipt.get('version') == 1 and receipt.get('area') == 'westbay' and receipt.get('roadId') == 263
    names = [f['file'] for f in receipt.get('files', [])]
    assert names == ['areas/westbay/7/78_76.png', 'areas/westbay/8/156_152.png'], f'Unexpected files: {names}'
    for f in receipt['files']:
        for k in ('before', 'sha256'):
            assert isinstance(f[k], str) and len(f[k]) == 64, f'Bad hash in {f}'
        assert f['before'] != f['sha256'], f'No-op hash in {f}'
        assert f['maxEdgeDiff'] == 0 and f['changedPixels'] > 0 and f['bytes'] > 0
    print(f'PASS committed receipt schema ({len(names)} tiles)')
    return receipt


def check_real_land(baked: Path, raw: Path, receipt: dict, *, do_remake: bool):
    wb = baked / 'areas/westbay'
    if not (wb / 'manifest.json').is_file():
        print('NO LAND: no baked West Bay land on this host; land state and remake skipped')
        return
    state, details = patch.land_state(baked, receipt)
    assert state in ('before', 'after'), f'West Bay land is {state}: {details}'
    if EXPECT is not None:
        assert state == EXPECT, f'West Bay land is {state}, expected {EXPECT}'
    print(f'PASS West Bay land state: {state} (EXPECT={EXPECT!r})')

    if not do_remake:
        return
    try:
        from osgeo import gdal  # noqa: F401
    except ImportError:
        print('NOT REMADE: GDAL (osgeo) is missing')
        return
    vrt = raw / 'areas/westbay/elevation/land-dtm-1m-epsg3979.vrt'
    if not vrt.is_file():
        print(f'NOT REMADE: missing raw DTM VRT ({vrt})')
        return
    manifest = json.loads((wb / 'manifest.json').read_bytes())
    pts = patch.find_track_263(json.loads((wb / 'roads.json').read_bytes()))
    built, stats = patch.build_tiles(raw, manifest, pts)
    assert stats == receipt['shapeStats'], f'remade shapeStats mismatch: {stats} vs {receipt["shapeStats"]}'
    by_name = {f['file']: f for f in receipt['files']}
    with tempfile.TemporaryDirectory(dir=os.environ.get('OUT') or None, prefix='wb263-remake-') as tmp_str:
        stage = Path(tmp_str)
        for rel, repro_rgb, after_rgb in built:
            entry = by_name[str(rel)]
            out_tile = stage / rel
            out_tile.parent.mkdir(parents=True, exist_ok=True)
            patch._write_png_gdal(out_tile, after_rgb)
            raw_bytes = out_tile.read_bytes()
            assert patch.sha(raw_bytes) == entry['sha256'] and len(raw_bytes) == entry['bytes'], \
                f'remade {rel} differs from committed receipt: sha256 {patch.sha(raw_bytes)}'
            changed_px = int((np.abs(after_rgb.astype(int) - repro_rgb.astype(int)).max(axis=0) > 0).sum())
            assert changed_px == entry['changedPixels'], f'changedPixels mismatch for {rel}: {changed_px}'
    print('PASS remade: build_tiles reproduced both West Bay tiles byte-for-byte from the 1 m DTM/DSM')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--land', action='store_true', help='Also verify baked West Bay land state')
    parser.add_argument('--remake', action='store_true', help='Also remake from 1 m DTM/DSM when available')
    parser.add_argument('--land-root', type=Path, default=ROOT / 'data/baked')
    parser.add_argument('--raw-root', type=Path, default=ROOT / 'data/raw')
    args = parser.parse_args()

    check_shaping_math()
    check_install_and_refusals()
    receipt = check_receipt_schema()
    if args.land or args.remake:
        check_real_land(args.land_root, args.raw_root, receipt, do_remake=True)
    print('PASS westbay-track263-delta')


if __name__ == '__main__':
    main()
