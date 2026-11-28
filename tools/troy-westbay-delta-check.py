#!/usr/bin/env python3
"""Check the Troy-to-West Bay land extension delta (#1475): synthetic make/install/rollback/refusals,
committed receipt schema, and real baked land state (before or after, never mixed).

No land writes into data/baked. Runs in clean CI without data/ (synthetic fixture + refusals + schema),
and checks live/rehearsal land plus West Bay boundary continuity when data/baked exists.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DELTA_DIR = ROOT / 'tools/troy-westbay-delta'
RECEIPT = DELTA_DIR / 'hashes.json'
# None accepts all-before or all-after until the main thread installs the delta and flips this to 'after'.
EXPECT = None

spec = importlib.util.spec_from_file_location('troy_westbay_patch', DELTA_DIR / 'patch.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def refused(words: str, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except (ValueError, AssertionError, SystemExit) as err:
        assert words in str(err), f'expected {words!r} in error, got: {err}'
        return
    raise AssertionError(f'accepted mutant/invalid case: {words}')


def check_install_and_refusals():
    """Test stage path guards, make, verify, install, idempotence, rollback, manifest preservation, and all refusals."""
    with tempfile.TemporaryDirectory(prefix='troy-westbay-check-') as tmp_str:
        tmp = Path(tmp_str)
        data = tmp / 'data'
        baked = data / 'baked'
        after_src = tmp / 'after-baked'
        delta = tmp / 'delta'

        pack_before = baked / patch.PACK
        pack_after = after_src / patch.PACK
        pack_before.mkdir(parents=True, exist_ok=True)
        pack_after.mkdir(parents=True, exist_ok=True)

        # Synthetic files: 1 unchanged, 2 replaced, 2 added.
        (pack_before / 'unchanged.bin').write_bytes(b'same-bytes')
        (pack_after / 'unchanged.bin').write_bytes(b'same-bytes')
        (pack_before / 'roads.json').write_bytes(b'{"roads":[1]}\n')
        (pack_after / 'roads.json').write_bytes(b'{"roads":[1,2]}\n')
        (pack_before / '5').mkdir()
        (pack_after / '5').mkdir()
        (pack_before / '5/16_15.png').write_bytes(b'tile-16-before')
        (pack_after / '5/16_15.png').write_bytes(b'tile-16-after')
        (pack_after / '5/17_15.png').write_bytes(b'tile-17-added')
        (pack_after / 'paved').mkdir()
        (pack_after / 'paved/136_120.r8').write_bytes(b'\x01' * 16)

        base_manifest = {
            'area': {'id': 'cansocauseway', 'name': 'Canso Causeway and Troy'},
            'crs': 'EPSG:2961',
            'origin': [591500, 5103332],
            'size': 65536,
            'keepKey': {'v': 99},
            'buildingStyles': {'file': 'building-styles.json', 'count': 10},
            'buildings': {'file': 'buildings.json', 'count': 10},
            'cemeteries': {'file': 'cemeteries.json', 'count': 1},
            'cover': {'file': 'cover.png', 'xmax': 626316},
            'height': {'scale': 0.01, 'offset': -100},
            'levels': {'5': ['16_15']},
            'mid': [616076, 5054180, 626316, 5072612],
            'paved': {'file': 'paved/index.json', 'tiles': 1},
            'props': {'file': 'props.json', 'mailboxes': 10},
            'roads': {'file': 'roads.json', 'levels': {'5': ['16_15']}},
            'streams': {'file': 'streams.json', 'runs': 5},
            'trees': {'levels': {'8': ['135_120']}, 'count': 100},
        }
        after_manifest = dict(
            base_manifest,
            buildings={'file': 'buildings.json', 'count': 20},
            levels={'5': ['16_15', '17_15']},
            mid=[616076.0, 5054180.0, 628364.0, 5072612.0],
            paved={'file': 'paved/index.json', 'tiles': 2},
            roads={'file': 'roads.json', 'levels': {'5': ['16_15', '17_15']}},
        )
        (pack_before / 'manifest.json').write_bytes(patch.compact_json(base_manifest))
        (pack_after / 'manifest.json').write_bytes(patch.compact_json(after_manifest))

        # Stage output guards (existing, source overlap, data/baked, data/site, case-insensitive APFS aliases).
        receipt = patch.make(baked, after_src, delta, verify=False)
        receipt_file = tmp / 'committed-hashes.json'
        receipt_file.write_bytes(patch.pretty_json(receipt))

        assert receipt['counts']['replaced'] == 2 and receipt['counts']['added'] == 2 and receipt['counts']['removed'] == 0
        assert not (delta / patch.PACK / 'unchanged.bin').exists(), 'unchanged files must not enter delta'

        refused('already exists', patch.assert_safe_stage_output, delta, baked)
        refused('separate from source', patch.assert_safe_stage_output, baked / 'new-out', baked)
        refused('outside data/baked', patch.assert_safe_stage_output, data / 'baked/sub', tmp / 'other-src')
        refused('outside data/baked', patch.assert_safe_stage_output, data / 'BAKED/new-stage', tmp / 'other-src')
        refused('outside data/site', patch.assert_safe_stage_output, data / 'site/sub', tmp / 'other-src')
        refused('outside data/site', patch.assert_safe_stage_output, data / 'SITE/new-stage', tmp / 'other-src')
        if (data / 'BAKED').exists():
            refused('separate from source', patch.assert_safe_stage_output, data / 'BAKED/new-stage', baked)
        patch.assert_safe_stage_output(tmp / 'brand-new-stage', baked, after_src)

        # Unowned manifest change refused by make().
        bad_after = tmp / 'bad-after'
        shutil.copytree(after_src, bad_after)
        bm = json.loads((bad_after / patch.PACK / 'manifest.json').read_text())
        bm['village'] = [1, 2]
        (bad_after / patch.PACK / 'manifest.json').write_bytes(patch.compact_json(bm))
        refused('outside owned keys', patch.make, baked, bad_after, tmp / 'bad-out', verify=False)

        assert patch.land_state(baked, receipt) == ('before', [])

        # Tampered delta file refused.
        bad_delta = tmp / 'bad-delta'
        shutil.copytree(delta, bad_delta)
        (bad_delta / patch.PACK / '5/17_15.png').write_bytes(b'tampered')
        refused('Tampered delta file', patch.install, bad_delta, baked, receipt_path=receipt_file)

        # Foreign receipt refused.
        bad_rec = tmp / 'bad-rec'
        shutil.copytree(delta, bad_rec)
        (bad_rec / 'hashes.json').write_text('{"version":1,"files":[]}\n')
        refused('does not match committed receipt', patch.install, bad_rec, baked, receipt_path=receipt_file)

        # Unknown live bytes refused without writing backups.
        orig_roads = (pack_before / 'roads.json').read_bytes()
        (pack_before / 'roads.json').write_bytes(b'{"roads":[999]}\n')
        assert patch.land_state(baked, receipt)[0] == 'mixed'
        refused('Unknown live bytes', patch.install, delta, baked, receipt_path=receipt_file)
        assert not (delta / 'before').exists(), 'failed install must not write backups'
        (pack_before / 'roads.json').write_bytes(orig_roads)

        # Symlinked parent directory refusal (`wt/data -> data`).
        wt_link = tmp / 'wt/data'
        wt_link.parent.mkdir(parents=True, exist_ok=True)
        wt_link.symlink_to(data)
        refused('symlink', patch.install, delta, wt_link / 'baked', receipt_path=receipt_file)

        # Clean install preserves unrelated manifest key (keepKey) and unchanged files.
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'installed'
        assert patch.land_state(baked, receipt) == ('after', [])
        assert (pack_before / 'unchanged.bin').read_bytes() == b'same-bytes'
        assert json.loads((pack_before / 'manifest.json').read_text())['keepKey'] == {'v': 99}
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'already-installed'

        # All-after repeat install with a missing rollback backup must refuse.
        saved_bak = (delta / 'before' / patch.PACK / 'roads.json').read_bytes()
        (delta / 'before' / patch.PACK / 'roads.json').unlink()
        refused('Missing backup', patch.install, delta, baked, receipt_path=receipt_file)
        (delta / 'before' / patch.PACK / 'roads.json').write_bytes(saved_bak)

        # Rollback through symlinked parent refused.
        refused('symlink', patch.rollback, delta, wt_link / 'baked', receipt_path=receipt_file)

        # Rollback preserves unrelated manifest keys added after install and deletes added files.
        m = json.loads((pack_before / 'manifest.json').read_text())
        m['laterKey'] = 42
        (pack_before / 'manifest.json').write_bytes(patch.compact_json(m))
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'rolled-back'
        assert patch.land_state(baked, receipt) == ('before', [])
        assert not (pack_before / '5/17_15.png').exists(), 'added tile must be removed on rollback'
        assert not (pack_before / 'paved/136_120.r8').exists(), 'added paved tile must be removed on rollback'
        restored_m = json.loads((pack_before / 'manifest.json').read_text())
        assert restored_m['keepKey'] == {'v': 99} and restored_m['laterKey'] == 42
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'already-before'

        # Interrupted install between files and manifest.json: both retry install and rollback recover cleanly.
        real_write = patch._atomic_write

        def fail_on_manifest(target: Path, payload: bytes):
            if target.name == 'manifest.json':
                raise OSError('injected failure on manifest.json')
            return real_write(target, payload)

        patch._atomic_write = fail_on_manifest
        try:
            try:
                patch.install(delta, baked, receipt_path=receipt_file)
                raise AssertionError('expected injected install failure')
            except OSError:
                pass
        finally:
            patch._atomic_write = real_write
        assert patch.land_state(baked, receipt)[0] == 'mixed'
        assert patch.install(delta, baked, receipt_path=receipt_file) == 'installed'
        assert patch.land_state(baked, receipt) == ('after', [])

        # Interrupted rollback -> retry rollback recovers to clean before.
        def fail_on_roads(target: Path, payload: bytes):
            if target.name == 'roads.json' and target.parent == pack_before:
                raise OSError('injected failure on roads.json')
            return real_write(target, payload)

        patch._atomic_write = fail_on_roads
        try:
            try:
                patch.rollback(delta, baked, receipt_path=receipt_file)
                raise AssertionError('expected injected rollback failure')
            except OSError:
                pass
        finally:
            patch._atomic_write = real_write
        assert patch.land_state(baked, receipt)[0] == 'mixed'
        assert patch.rollback(delta, baked, receipt_path=receipt_file) == 'rolled-back'
        assert patch.land_state(baked, receipt) == ('before', [])
        print('PASS synthetic make/install/rollback lifecycle, interrupted-write recovery, manifest preservation, and all refusals')


def check_receipt_schema() -> dict:
    assert RECEIPT.is_file(), f'Missing committed receipt: {RECEIPT}'
    receipt = json.loads(RECEIPT.read_text())
    assert receipt.get('version') == 1 and receipt.get('issue') == 1475
    assert receipt.get('area') == 'cansocauseway' and receipt.get('pack') == 'areas/cansocauseway'
    assert receipt.get('beforeMid') == [616076, 5054180, 626316, 5072612]
    assert receipt.get('afterMid') == [616076.0, 5054180.0, 628364.0, 5072612.0]
    assert tuple(receipt.get('manifestKeys', [])) == patch.OWNED_MANIFEST_KEYS
    l5_before = set(receipt['beforeManifest']['levels']['5'])
    l5_after = set(receipt['afterManifest']['levels']['5'])
    added_l5 = sorted(l5_after - l5_before)
    assert added_l5 == [f'17_{j}' for j in range(15, 24)], f'Expected 9 L5 tiles 17_15..17_23, got {added_l5}'
    assert not (l5_before - l5_after), 'Existing L5 tiles must not be dropped'
    files = receipt.get('files', [])
    assert len(files) == receipt['counts']['totalFiles']
    seen = set()
    for f in files:
        rel = f['file']
        assert rel.startswith('areas/cansocauseway/') and rel not in seen
        seen.add(rel)
        assert f['before'] != f['sha256'], f'No-op entry: {rel}'
        if f['before'] is not None:
            assert isinstance(f['before'], str) and len(f['before']) == 64
        if f['sha256'] is not None:
            assert isinstance(f['sha256'], str) and len(f['sha256']) == 64 and f['bytes'] > 0
    for must_have in (
        'areas/cansocauseway/roads.json',
        'areas/cansocauseway/buildings.json',
        'areas/cansocauseway/tall.json',
        'areas/cansocauseway/bridge-decks.bin',
        'areas/cansocauseway/paved/index.json',
    ):
        assert must_have in seen, f'Missing expected file in receipt: {must_have}'
    assert receipt.get('pavedArea', {}).get('area') == 'cansocauseway'
    assert receipt['pavedArea']['manifestKey'] == receipt['afterManifest']['paved']
    print(f'PASS committed receipt schema ({len(files)} files: {receipt["counts"]["replaced"]} replaced, '
          f'{receipt["counts"]["added"]} added, 9 new L5 tiles 17_15..17_23)')
    return receipt


def check_real_land(baked: Path, receipt: dict):
    cc = baked / patch.PACK
    if not (cc / 'manifest.json').is_file():
        print('NO LAND: no baked cansocauseway land on this host; land state check skipped')
        return
    state, details = patch.land_state(baked, receipt)
    assert state in ('before', 'after'), f'Troy-to-West Bay land state is {state}: {details[:8]}'
    if EXPECT is not None:
        assert state == EXPECT, f'Land state is {state}, expected {EXPECT}'
    print(f'PASS Troy-to-West Bay land state: {state} (EXPECT={EXPECT!r})')

    if state == 'after':
        # Confirm zero gap between cansocauseway east edge and westbay west edge, and linking roads meet at E=628364.
        wb_m_path = baked / 'areas/westbay/manifest.json'
        if wb_m_path.is_file():
            cc_m = json.loads((cc / 'manifest.json').read_text())
            wb_m = json.loads(wb_m_path.read_text())
            assert cc_m['mid'][2] == wb_m['mid'][0] == 628364, \
                f'Expected cansocauseway east edge to meet westbay west edge at 628364, got {cc_m["mid"][2]} vs {wb_m["mid"][0]}'
            cc_roads = json.loads((cc / 'roads.json').read_text())['roads']
            wb_roads = json.loads((baked / 'areas/westbay/roads.json').read_text())['roads']
            linking = [
                'Highway 105',
                'Long Stretch Road',
                'MacGregor Lane',
                'MacIntyre Mountain Road',
                'MacIntyre Road',
                'MacMaster Road',
            ]
            for name in linking:
                cc_pts = [p for r in cc_roads if r.get('name') == name for p in r['pts'] if abs(p[0] - 628364) <= 2.0]
                wb_pts = [p for r in wb_roads if r.get('name') == name for p in r['pts'] if abs(p[0] - 628364) <= 2.0]
                assert cc_pts and wb_pts, f'{name} missing boundary point at E=628364'
                gap = min(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a in cc_pts for b in wb_pts)
                assert gap < 1.0, f'{name} boundary gap at E=628364 is {gap:.2f} m'
            print(f'PASS zero gap at E=628364; all {len(linking)} named linking roads meet West Bay (<1 m)')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--land', action='store_true', help='Also verify baked land state')
    parser.add_argument('--land-root', type=Path, default=ROOT / 'data/baked')
    args = parser.parse_args()

    check_install_and_refusals()
    receipt = check_receipt_schema()
    if args.land:
        check_real_land(args.land_root, receipt)
    print('PASS troy-westbay-delta')


if __name__ == '__main__':
    main()
