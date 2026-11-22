#!/usr/bin/env python3
"""Power rules on invented land; public poles also match the frozen pre-change rule byte for byte."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import tempfile
import contextlib
import io

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'pipeline'))
# The rules run on invented land: a shell left on another area must not lend it its AREA lists.
os.environ.pop('MMM_AREA', None)
sys.modules.setdefault('osgeo', types.SimpleNamespace(gdal=types.SimpleNamespace(UseExceptions=lambda: None)))
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m
P = load(ROOT/'pipeline/29_bake_props.py', 'power_props')
O = load(ROOT/'tools/power-network/poles-before.py', 'old_poles')
D = load(ROOT/'tools/power-network/make_delta.py', 'power_delta')

def road(rid, points, kind=3, name='Invented Road', **kw):
    return dict(id=rid, pts=points, kind=kind, halfWidth=3 if kind<4 else 1.5, name=name, bridge=False, **kw)
def house(bid, x, y, kind='house', **kw):
    return dict(id=bid, x=x, y=y, length=12, width=8, axisDeg=90, roof='gable', eave=4, ridge=7, ground=20, kind=kind, **kw)
def pole(x,y,n=0,road=1):
    return dict(x=x,y=y,n=n,road=road,heading=90,transformer=False,light=False)
def data(value):
    return json.dumps(value, separators=(',',':')).encode()

roads = [road(4,[[0,0],[500,0]],4), road(1,[[-100,0],[0,0]],1),
         road(2,[[-100,50],[500,50]],2),road(3,[[-100,100],[500,100]],3),
         road(5,[[0,200],[500,200]],4,None),road(6,[[0,300],[500,300]],4,propsDriveway=True)]
net=P.Network(copy.deepcopy(roads)); buildings=[house(1,302,20),house(2,450,76),house(3,300,210),house(4,300,310)]
safe=lambda p: True
new=P.place_poles(list(net.roads.values()),net,buildings,safe,(-10000,-10000))
old=O.place_poles(list(net.roads.values()),net,safe,(-10000,-10000),P.SEED,P.public,P.shifted,P.heading,P.distance)
assert data(old)==data([p for p in new if p['road']<=3]), 'public pole bytes, including random marks/order, are unchanged'
added=[p for p in new if p['road']==4]
assert len(added)>3 and max(p['x'] for p in added)==302, 'stop at last building within 75 m, not at a distant building'
assert not any(p['road'] in (5,6) for p in new), 'unnamed tracks and explicit named driveways get no poles'
# A named kind-4 road listed as unpowered (AREA.unpowered_tracks) gets no run; the public pass keeps its bytes.
quiet=P.place_poles(list(net.roads.values()),net,buildings,safe,(-10000,-10000),unpowered=('Invented Road',))
assert not any(p['road']==4 for p in quiet), 'an unpowered named track gets no poles'
assert data(old)==data([p for p in quiet if p['road']<=3]), 'leaving a track unpowered keeps the public pole bytes'
try:
    P.place_poles(list(net.roads.values()),net,buildings,safe,(-10000,-10000),unpowered=('Misspelt Road',))
    raise AssertionError('an unpowered name that matches no kind-4 road must stop the bake')
except RuntimeError:
    pass
reverse=[road(4,[[500,0],[0,0]],4),road(1,[[-100,0],[0,0]],1)]
net=P.Network(reverse)
back=P.place_poles(reverse,net,[house(1,302,20)],safe,(-10000,-10000))
assert max(p['x'] for p in back if p['road']==4)<=302, 'reversing source points cannot extend poles into the unbuilt end'
net=P.Network([road(1,[[-100,0],[500,0]],1)])
h=house(1,100,20)
bs=[h,house(2,105,21,'shed'),house(3,110,23,'barn'),house(4,120,20,'large',shape='tank'),
    house(5,130,22,'large'),house(6,132,22,'large',buildingId=5)]
ps=[pole(100,-5),pole(100,50,1)]
drops=P.service_drops(net,ps,bs,'mabou',{})
assert len(drops)==2 and {d['building'] for d in drops}=={1,5}, 'one per house/large property, none for sheds, barns, tanks or extra wings'
assert all(d['n']==1 for d in drops), 'prefer same-side pole even when a closer pole crosses a highway'
assert drops[0]['y']==24 and drops[0]['height']==4 and drops[0]['ground']==20, 'roof seam and surveyed datum'
assert P.service_drops(net,[pole(100,69)], [h],'mabou',{})[0]['y']==24, '45 m is included'
assert P.service_drops(net,[pole(100,69.01)],[h],'mabou',{})==[], 'over 45 m is excluded'
assert P.service_drops(net,[pole(100,-5)],[h],'mabou',{}), 'opposite-side connection is possible when no same-side pole is in reach'
# Crossing at a shared highway vertex must count too (the road bends right at the crossing).
bend=P.Network([road(1,[[0,0],[100,0],[200,0]],1)])
assert P.crosses_highway(bend,(90,-10),(110,10)), 'a highway vertex is still a centre line'
# The church has no power (Dan, 21 Nov 2026): no drop for the model, nor for its surveyed envelope as any kind.
for kind in ('barn','house','large'):
    assert P.powered_buildings([house(99,630844.2,5080637.2,kind)], 'judique')=={}, 'the church gets no drop'
assert set(P.powered_buildings([house(99,630844.2,5080637.2)], 'mabou'))=={99}, 'only Judique leaves that site unpowered'
flat=house(20,100,20,buildingId=20);flat.update(roof='flat')
assert P.roof_edge(flat,pole(100,40),{'20':{'roofShape':'gable'}})['height']==7, 'flat wings keep the renderer roof height'
R = load(ROOT/'tools/power-network/rehearse.py', 'power_rehearse')
assert R.replacement(Path('/invented/delta'),Path('terrain'),'roads.json') is None, 'extra delta inputs are never served'
assert R.replacement(Path('/invented/delta'),Path('terrain'),'props.json') == Path('/invented/delta/terrain/props.json')
print('PASS power rules, unchanged public pole bytes, direction, bounds, service reach, roof seam, group/datum, unpowered tracks and the unpowered church')
if '--land' in sys.argv:
    D.check_properties(ROOT/'data/baked')
