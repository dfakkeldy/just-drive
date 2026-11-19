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


def verify(source, stage, pins):
    made = receipt.record(source, stage)
    made['bake'] = 'pipeline/36_stage_mabou_wharf.py'
    if made != pins:
        raise ValueError('The source or staged files do not match the wharf receipt')
    before = json.loads((source / 'roads.json').read_bytes())['roads']
    after = json.loads((stage / 'roads.json').read_bytes())['roads']
    paved, gravel = [r for r in after if r.get('correction') == '19nov:Mabou Harbour Road']
    old = next(r for r in before if r['id'] == paved['id'])
    lane, = [r for r in after if str(r['id']) in pins['undo']['kinds']]
    assert paved['pts'] + gravel['pts'][1:] == old['pts'] and paved['pts'][-1] == gravel['pts'][0]
    assert paved['kind'] == 2 and paved['pavement'] == 'double-yellow'
    assert gravel['kind'] == lane['kind'] == 3 and 'pavement' not in gravel and 'pavement' not in lane
    print(f'PASS wharf road staging: {len(pins["files"])} files and continuous centrelines')


if __name__ == '__main__':
    report = json.loads(PINS.read_text())
    if sys.argv[1:2] == ['land'] and len(sys.argv) == 3:
        print(f'PASS 19 Nov wharf road land: {receipt.state(sys.argv[2], report)}')
    elif len(sys.argv) == 4 and sys.argv[1] in ('verify', 'install', 'uninstall'):
        op, a, b = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
        if op == 'verify':
            verify(a, b, report)
        else:
            print(f'PASS 19 Nov wharf road land: {getattr(receipt, op)(a, b, report)}')
    else:
        sys.exit(__doc__)
