#!/usr/bin/env python3
"""Verify and promote the 19 Nov road delta. The main thread owns installation.

    receipt.py land BAKED
    receipt.py verify SOURCE_TERRAIN STAGE
    receipt.py install STAGE BAKED
    receipt.py uninstall STAGE BAKED
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PINS = HERE / 'roads.json'
spec = importlib.util.spec_from_file_location('nov18_receipt', HERE.parent / 'mabou-dashcam-18nov' / 'receipt.py')
receipt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipt)


def pins_for(report, roads, baked=None):
    road = next(f for f in report['roadBed']['files'] if f['file'] == 'terrain/roads.json')
    with_bed = receipt.sha(roads.read_bytes()) in (road['before'], road['sha256'])
    if with_bed and baked is not None:
        companion = receipt.target(baked, receipt.PRE_BED)
        pin = json.loads(receipt.RECEIPT.read_text())['roadBed']['companion']['sha256']
        if not companion.is_file() or receipt.sha(companion.read_bytes()) != pin:
            raise ValueError('The repaired roads need their matching pre-bed lines')
    return receipt.receipt_for(report, with_bed)


def verify(source, stage, pins):
    pins = pins_for(pins, source/'roads.json')
    made = receipt.record(source, stage)
    made['bake'] = 'pipeline/36_stage_mabou_wharf.py'
    if made != pins:
        raise ValueError('The source or staged files do not match the wharf receipt')
    before = json.loads((source / 'roads.json').read_bytes())['roads']
    after = json.loads((stage / 'roads.json').read_bytes())['roads']
    paved, gravel = [r for r in after if r.get('correction') == '19nov:Mabou Harbour Road']
    old = next(r for r in before if r['id'] == paved['id'])
    old_by_id = {r['id']: r for r in before}
    lanes = [r for r in after if r.get('pavement') == 'gravel' and r != old_by_id.get(r['id'])]
    assert paved['pts'] + gravel['pts'][1:] == old['pts'] and paved['pts'][-1] == gravel['pts'][0]
    assert paved['kind'] == 2 and paved['pavement'] == 'double-yellow'
    assert gravel['kind'] == 3 and 'pavement' not in gravel
    assert len(lanes) == 2 and all(r['kind'] == 4 and r['pts'] == old_by_id[r['id']]['pts'] for r in lanes)
    print(f'PASS wharf road staging: {len(pins["files"])} files and continuous centrelines')


if __name__ == '__main__':
    report = json.loads(PINS.read_text())
    if sys.argv[1:2] == ['land'] and len(sys.argv) == 3:
        baked = Path(sys.argv[2])
        pins = pins_for(report, baked/'terrain/roads.json', baked)
        print(f'PASS 19 Nov wharf road land: {receipt.state(baked, pins)}')
    elif len(sys.argv) == 4 and sys.argv[1] in ('verify', 'install', 'uninstall'):
        op, a, b = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
        if op == 'verify':
            verify(a, b, report)
        else:
            pins = pins_for(report, a/'roads.json', b)
            print(f'PASS 19 Nov wharf road land: {getattr(receipt, op)(a, b, pins)}')
    else:
        sys.exit(__doc__)
