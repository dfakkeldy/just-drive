#!/usr/bin/env python3
"""Recognize regular and movable NSTDB road spans; rail overheads are separate."""
import importlib.util
import json
import sys
from pathlib import Path
root=Path(__file__).absolute().parent.parent
sys.path.insert(0,str(root/'pipeline'))
spec=importlib.util.spec_from_file_location('bridge_source_check',root/'pipeline/23_bake_roads.py')
roads=importlib.util.module_from_spec(spec);spec.loader.exec_module(roads)
assert roads.is_bridge({'FEAT_CODE':'RRBRLOZ1'})
assert roads.is_bridge({'FEAT_CODE':'RRBMTCY1'}), 'movable highway bridge must receive a deck'
for code in ('RRRDTCY1','RRRR57',''):
    assert not roads.is_bridge({'FEAT_CODE':code}),code
if '--baked' in sys.argv:
    from areas import AREAS
    area=AREAS[sys.argv[sys.argv.index('--area')+1] if '--area' in sys.argv else 'pointtupper']
    data=json.loads((area.output/'roads.json').read_text())['roads']
    spans=[r for r in data if r['bridge'] and r['name']=='Highway 104' and any(
        623600<x<623740 and 5056040<y<5056150 for x,y in r['pts'])]
    assert len(spans)==1, f'expected one baked canal road span, got {len(spans)}'
    import math
    length=sum(math.dist(a,b) for a,b in zip(spans[0]['pts'],spans[0]['pts'][1:]))
    assert 85<length<100, length
    print(f'PASS baked Canso canal road span: {length:.2f} m')
print('PASS regular/movable road bridge classification; road and railway negatives')
