#!/usr/bin/env python3
"""No bake or source downloads: production OSM matching on small geometry fixtures."""
import copy
import ast
import collections
import json
import math
import sys
import numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).absolute().parent.parent/'pipeline'))
from bridge_spans import source_bridges, recover_bridge_spans, bridge_keep_boxes, runtime_crossings, inferred_bridge_spans

roads=[dict(id=1,name='Rail trail',kind=5,halfWidth=1.6,bridge=False,pts=[[0,0],[100,0]]),
       dict(id=2,name='Cross road',kind=2,halfWidth=3,bridge=False,pts=[[50,-50],[50,50]])]
before=copy.deepcopy(roads)
def feature(tags,points,ident=645016205):
    return dict(type='way',id=ident,tags=tags,geometry=[dict(lon=x,lat=y)for x,y in points])
project=lambda x,y:(x,y,0)
def recover(elements):return recover_bridge_spans(roads,source_bridges(elements,project))
way=feature({'bridge':'yes','railway':'abandoned','highway':'path','layer':'1'},[(40,2),(60,2)])
spans=recover([way,way])
assert len(spans)==1,'one bridge retained even though ordinary gaps subtract a 15m provincial buffer'
span=spans[0];assert span['road']==1 and span['pts']==[[40.,0.],[60.,0.]]
assert span['bridge'] is True and span['inferred'] is False and span['washboard'] is False
assert span['sources']==['osm/way/645016205']
assert roads==before,'recovery must preserve every original road id, point, flag and order'
alternatives=[*roads,{**roads[0],'id':6,'pts':[[40,0],[50,8],[60,0]]},{**roads[0],'id':7,'pts':[[0,8],[100,8]]}]
assert len(recover_bridge_spans(alternatives,source_bridges([way],project)))==1,'a bowed spur and a nearby parallel route must not acquire the bridge'
assert not recover([feature({'railway':'abandoned','layer':'1'},[(40,2),(60,2)])]),'an embankment is not automatically a bridge'
assert not recover([feature({'bridge':'no','highway':'path'},[(40,2),(60,2)])])
assert not recover([feature({'bridge':'yes','highway':'path'},[(40,40),(60,40)])]),'parallel distant trail is not a match'
assert not recover([feature({'bridge':'yes','highway':'path'},[(50,-10),(50,10)])]),'perpendicular crossing is not a trail deck'
area=feature({'man_made':'bridge'},[(35,-3),(65,-3),(65,3),(35,3),(35,-3)],2)
area_spans=recover([area]);assert any(s['road']==1 and s['pts']==[[35.,0.],[65.,0.]]for s in area_spans)
roads[0]['bridge']=True;assert not recover([way]),'already flagged span does not get a duplicate'
roads[0]['bridge']=False
gap=[{**roads[0],'id':10,'pts':[[0,0],[40,0]]},{**roads[0],'id':11,'pts':[[60,0],[100,0]]}]
joined=recover_bridge_spans(gap,source_bridges([feature({'bridge':'yes','railway':'abandoned'},[(40,0),(60,0)])],project))
assert len(joined)==1 and joined[0]['pts']==[[40.,0.],[60.,0.]],'separate bridge way must close a missing centreline gap'
print('PASS overlapping OSM bridge way, separate abandoned-rail way, bridge area, duplicates, negative tags, alignment and unchanged road ids')
area_names=['mabou','judique','porthood','westbay','pointtupper','cansocauseway']
repairs=[r for area in area_names for r in inferred_bridge_spans(area)]
assert len(repairs)==8 and all(r['inferred']is True and r['bridge']is True for r in repairs),'only the eight reviewed inferred survivors retain explicit status'
assert any('osm/way/645016205'in r['sources']for r in runtime_crossings('cansocauseway'))
# A trunk swing bridge beside railway must not enlarge the rail deck.
rail_road={**roads[0],'name':'Railroad','id':20,'kind':2}
assert not recover_bridge_spans([rail_road],source_bridges([feature({'bridge':'yes','highway':'trunk'},[(40,0),(60,0)],164815009)],project)),'motor highway never feeds railway'
for area in ('pointtupper','cansocauseway'):
    r=next(r for r in runtime_crossings(area) if r['name']=='Railroad' and 'osm/way/185891712' in r['sources'])
    assert r['sources']==['osm/way/185891712'],'Canso highway swing span must not feed Railroad'
    length=sum(math.dist(a,b) for a,b in zip(r['pts'],r['pts'][1:]))
    assert 96<length<97,('actual railway-only length',area,length)
# Every retained Mabou runtime centreline matches the new land road within 2 m.
root=Path(__file__).absolute().parent.parent
mapped={r['id']:r for r in json.loads((root/'data/baked/terrain/roads.json').read_text())['roads']}
from bridge_spans import projection
for r in runtime_crossings('mabou'):
    assert max(projection(mapped[r['road']]['pts'],p)[0] for p in r['pts'])<=2,(r['road'],'new Mabou land matching')
print('PASS highway/rail source separation and new Mabou centreline pins')
boxes=bridge_keep_boxes([span]);assert boxes==[(36.4,-3.6,63.6,3.6)]
# The real optional shaper must preserve water/terrain inside those boxes, not just receive a label.
import road_ground as rg
class Land:
    def at(self,x,y):return 20+np.asarray(x)*.01+np.asarray(y)*.02+np.cos(np.asarray(y)*.4)*.3
land=Land();r=dict(id=9,name='Trail over water',kind=5,halfWidth=1.6,bridge=False,washboard=False,pts=[[float(x),0.]for x in range(0,101,2)])
profiles,_=rg.profiles(land,[r]);yy,xx=np.mgrid[0:21,0:101];raw=land.at(xx,10-yy).astype(np.float32)
shaped,_=rg.shape_block(raw,0,10,profiles,keep=boxes);unkept,_=rg.shape_block(raw,0,10,profiles)
inside=(xx>=36.4)&(xx<=63.6)&(10-yy>=-3.6)&(10-yy<=3.6)
assert np.array_equal(shaped[inside],raw[inside]),'bridge keep boxes retain every terrain cell below the deck'
assert np.max(np.abs(unkept[inside]-raw[inside]))>.001,'the protected-terrain check is not vacuous'
print('PASS inferred status, runtime fallback and actual road-ground keep-box preservation')
field_path=Path(__file__).absolute().parent.parent/'pipeline/25_bake_road_fields.py'
field_source=field_path.read_text()
def field_module(text):
    tree=ast.parse(text);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main')
    assert any(isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='bridge_network'for n in ast.walk(main)),'field main consumes recovered bridge metadata'
    selected=[n for n in tree.body if isinstance(n,ast.ClassDef)and n.name=='Field'or isinstance(n,ast.FunctionDef)and n.name=='bridge_network']
    ns={'np':np,'math':math,'collections':collections};exec(compile(ast.Module(body=selected,type_ignores=[]),str(field_path),'exec'),ns);return ns
def field_contract(mod):
    offset={**span,'pts':[[40,.0004],[60,.0004]]}
    network=mod['bridge_network']({'roads':before,'bridgeSpans':[offset]});f=mod['Field'](network)
    assert int(f.raster(np.array([50.]),np.array([0.]))[2,0,0])==21,'bridge bit survives a sub-millimetre projected-line offset'
    assert int(f.raster(np.array([70.]),np.array([0.]))[2,0,0])==5,'uncovered trail remains unflagged'
field_contract(field_module(field_source));print('PASS real road-field bridge bit at an overlapping rounded span; unflagged outside it')
if '--mutations' in sys.argv:
    # Execute the production helper from strings; source files and live data are never rewritten.
    path=Path(__file__).absolute().parent.parent/'pipeline/bridge_spans.py';source=path.read_text()
    for name,anchor,replacement in [
        ('lost-overlapping-way',"windows.setdefault(index, []).append((a,b,feature['source']));matched=True","pass"),
        ('layer-is-always-bridge',"if tags.get('bridge') in (None, 'no') and tags.get('man_made') != 'bridge':","if False:"),
    ]:
        assert source.count(anchor)==1
        ns={};exec(compile(source.replace(anchor,replacement),str(path),'exec'),ns)
        try:
            if name=='lost-overlapping-way':assert len(ns['recover_bridge_spans'](roads,ns['source_bridges']([way],project)))==1,'source bridge retained'
            else:assert not ns['recover_bridge_spans'](roads,ns['source_bridges']([feature({'railway':'abandoned','layer':'1'},[(40,2),(60,2)])],project)),'layer alone is not a bridge'
        except AssertionError:print('KILLED',name,'by source-bridge presence/absence contract')
        else:raise AssertionError(name+' survived the production contract')
    anchor='if self.has_overlays:';assert field_source.count(anchor)==1
    try:field_contract(field_module(field_source.replace(anchor,'if False:')))
    except AssertionError as error:assert 'sub-millimetre' in str(error);print('KILLED source span loses a rounded road-field tie')
    else:raise AssertionError('rounded source-span field mutant survived')

if '--mutations' in sys.argv:
    anchor="if motor and (road['kind']==5 or road['name']=='Railroad'):"
    ns={};exec(compile(source.replace(anchor,'if False:'),str(path),'exec'),ns)
    try:assert not ns['recover_bridge_spans']([rail_road],ns['source_bridges']([feature({'bridge':'yes','highway':'trunk'},[(40,0),(60,0)],164815009)],project)), 'motor highway never feeds railway'
    except AssertionError:print('KILLED highway source admitted to railway by the negative source contract')
    else:raise AssertionError('highway-to-railway match mutant survived')
