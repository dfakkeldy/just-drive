#!/usr/bin/env python3
"""Independent synthetic geometry and correction checks. No historical mask inputs."""
import json
import subprocess
import sys
import tempfile
import types
from pathlib import Path
import numpy as np
from shapely.geometry import box, mapping, shape
sys.path.insert(0,str(Path(__file__).absolute().parents[1]/'pipeline'))
import paved
source=Path(paved.__file__).read_text()
mutation=sys.argv[sys.argv.index('--mutation')+1] if '--mutation' in sys.argv else None
changes={
    'building':('out = out.difference(unary_union(buildings).buffer(1))','out = out'),
    'hand-site':('if g.intersects(hand):','if False:'),
    'water':('out = out.difference(unary_union(water).buffer(1))','out = out'),
    'roads':('out = out.difference(unary_union(roads))','out = out'),
    'covers-tracks':('out = out.union(own.difference(unary_union(main_edges)))','out = out.union(own.difference(unary_union(edges)))'),
    'covers-roofs':('own = unary_union(covers).difference(unary_union(buildings).buffer(1)).difference(unary_union(water).buffer(1))','own = unary_union(covers)'),
    'covers-sites':('if g.intersects(hand):',"if g.intersects(hand) and not lot.get('coversTracks'):"),
    'gravel-flags':("            elif f['surface'] == 'gravel': cuts.append(g); gravel.append(dict(own, code='correction-gravel'))","            elif f['surface'] == 'gravel': cuts.append(g); gravel.append(dict(id=f['id'], geometry=mapping(g), code='correction-gravel'))"),
    'gravel-tracks':('cut_lots(gravel, buildings, water+ribbons, roads, sites, edges, main_edges)','cut_lots(gravel, buildings, water+ribbons, roads, sites, edges, edges)'),
    'gravel-cuts':('cut_lots(lots, buildings, water+paved_cuts, roads, sites, edges, main_edges)','cut_lots(lots, buildings, water, roads, sites, edges, main_edges)'),
    'gravel-priority':('a[(a == 0) & np.asarray(gravel, bool)] = 2','a[np.asarray(gravel, bool)] = 2'),
    'stalls-off':('if painted.difference(asphalt).area > 0.1*painted.area:','if False:'),
    'meets-road-edges':('out = out.union(edge.difference(unary_union(edges)))','out = out.union(edge)'),
    'meets-road-roofs':("edge = unary_union(meets).difference(unary_union(buildings).buffer(1))","edge = unary_union(meets)"),
}
DIAGNOSTIC={'building':'building cut removed','hand-site':'hand-site cut removed','water':'water cut removed','roads':'road cut removed',
            'meets-road-edges':'meets-road ribbon not cut','meets-road-roofs':'meets-road roof or water cut removed',
            'covers-tracks':'owner lot must cover its own track','covers-roofs':'covering lot keeps the roof, water and gravel cuts',
            'covers-sites':'covering lot near a hand site must stay out','gravel-flags':'gravel lot keeps its road flags','gravel-tracks':'gravel lot must cover its own track',
            'gravel-cuts':'owner gravel must cut mapped asphalt','gravel-priority':'asphalt wins over gravel','stalls-off':'stall row off its asphalt'}
if mutation:
    old,new=changes[mutation];assert source.count(old)==1
    module=types.ModuleType('mutant');module.__file__=paved.__file__
    exec(compile(source.replace(old,new),paved.__file__,'exec'),module.__dict__);paved=module
lots=[dict(id='lot',geometry=mapping(box(0,0,100,100))),dict(id='hand',geometry=mapping(box(120,0,150,30)))]
sites=[dict(id='authored',geometry=mapping(box(140,10,160,40)))]
b=box(20,20,40,40);w=box(50,50,75,75);r=box(0,0,10,100)
out,omitted,stats=paved.cut_lots(lots,[b],[w],[r],sites)
assert out.intersection(b).area==0,'building cut removed'
assert out.intersection(w).area==0,'water cut removed'
assert out.intersection(r).area==0,'road cut removed'
assert out.intersection(box(120,0,140,30)).area==0,'hand-site cut removed: whole lot must stay out'
assert [x['id'] for x in omitted]==['hand']
assert out.area>7000 and out.contains(box(80,80,90,90))
# Owner lots (Judique lots delta): a main road (ribbon x<5, cut with its shoulder x<7) and a track (ribbon 40<x<44, cut 39<x<45) cross
# everything; owner gravel covers y>60. Lots that cover their tracks lose only the main ribbon.
from shapely.geometry import Point
main,track=box(0,0,5,100),box(40,0,44,100)
own=dict(meetsRoad=True,coversTracks=True)
lot_out,gravel_out,_,_=paved.lot_layers([dict(id='src',geometry=mapping(box(60,0,100,80))),dict(id='own',geometry=mapping(box(0,0,50,50)),**own)],
    [dict(id='grav',geometry=mapping(box(0,60,100,100)),**own)],[],[],[box(0,60,100,100)],[],[box(0,0,7,100),box(39,0,45,100)],[main,track],[main],[])
assert lot_out.contains(Point(42,25)),'owner lot must cover its own track'
assert gravel_out.contains(Point(42,80)),'gravel lot must cover its own track'
assert not lot_out.contains(Point(2,25)) and not gravel_out.contains(Point(2,80)),'owner lots keep the main road cut'
assert lot_out.contains(Point(6,25)) and gravel_out.contains(Point(6,80)),'owner lots meet the main road at its ribbon'
assert not lot_out.contains(Point(80,70)) and lot_out.contains(Point(80,30)),'owner gravel must cut mapped asphalt'
# The covering path keeps every other rule: roofs and water (+1 m), owner gravel, and whole hand sites.
roof,pond,grav2=box(10,10,15,15),box(20,30,25,35),box(30,0,35,8)
cov,om,_=paved.cut_lots([dict(id='own',geometry=mapping(box(0,0,50,50)),**own),dict(id='near-site',geometry=mapping(box(200,0,240,40)),**own)],
    [roof],[pond,grav2],[box(0,0,7,100),box(39,0,45,100)],[dict(id='site',geometry=mapping(box(230,10,260,40)))],[main,track],[main])
assert not any(cov.contains(Point(x,y)) for x,y in [(12,12),(22,32),(32,4)]) and cov.contains(Point(42,25)),'covering lot keeps the roof, water and gravel cuts'
assert [x['id'] for x in om]==['near-site'] and not cov.intersects(box(200,0,240,40)),'covering lot near a hand site must stay out'
c=paved.classes(np.array([[1,0,0]],bool),np.array([[1,1,0]],bool))
assert c.tolist()==[[1,2,0]] and c.dtype==np.uint8,'asphalt wins over gravel'
paved.check_stalls([dict(id='on',row=[10,10,37.5,10,5.5,2.75])],lot_out)
try:paved.check_stalls([dict(id='off',row=[10,46,37.5,46,5.5,2.75])],lot_out);raise AssertionError('stall row off its asphalt')
except ValueError:pass
assert stats['after_hand_sites']==10000
# A lot that meets the road (Point Tupper delta owner corrections): the shoulder band beside the ribbon stays paved, the ribbon
# itself, roofs and whole hand sites stay out. The road cut here is the ribbon plus a 2 m shoulder (0..12 m).
meet=[dict(id='edge',meetsRoad=True,geometry=mapping(box(0,0,100,100))),dict(id='edge-hand',meetsRoad=True,geometry=mapping(box(120,0,150,30)))]
out2,omitted2,stats2=paved.cut_lots(meet,[b],[w],[box(0,0,12,100)],sites,[box(0,0,10,100)])
assert out2.intersection(box(10.5,0,11.5,100)).area>90,'meets-road shoulder band not kept'
assert out2.intersection(box(0,0,10,100)).area==0,'meets-road ribbon not cut'
assert out2.intersection(b).area==0 and out2.intersection(w).area==0,'meets-road roof or water cut removed'
assert [x['id'] for x in omitted2]==['edge-hand'] and 'after_meets_road' in stats2
assert paved.cut_lots(lots,[b],[w],[r],sites,[box(0,0,10,100)])[2]==stats,'plain lots must not change with the ribbons given'
try:paved.cut_lots(meet,[b],[w],[r],sites);raise AssertionError('meets-road lot without ribbons accepted')
except ValueError:pass
# Cell centres, orientation, roof hole and exact tile payload.
a=paved.Shapes([out]).grid((0,0,256,256)).astype(np.uint8)
assert not a[128-16,16] and a[128-44,44]
assert len(paved.tile_bytes(a))==16384
assert len(paved.tile_bytes(np.full((128,128),2,np.uint8)))==16384,'gravel lot class 2 must be a valid class byte'
for bad in [np.full((128,128),72,np.uint8),np.full((128,128),3,np.uint8),np.zeros((128,128,3),np.uint8),np.zeros((128,128),np.float32)]:
    try:paved.tile_bytes(bad);raise AssertionError('Accepted non-class payload')
    except ValueError:pass
assert paved.tile_bounds('149_203.r8',(591500,5103332))==(629644,5051108,629900,5051364)
with tempfile.TemporaryDirectory(prefix='paved-open-fixture-') as tmp:
    p=Path(tmp)/'corrections.json'
    features=[dict(id='gps-lot',area='mabou',kind='lot',surface='paved',date='2026-11-14',source='owner GPS',geometry=mapping(box(0,0,20,20))),
              dict(id='gravel-lot',area='mabou',kind='lot',surface='gravel',date='2026-11-14',source='owner video',geometry=mapping(box(0,0,5,5))),
              dict(id='road',area='mabou',kind='road',surface='gravel',width=5,date='2026-11-14',source='owner video',geometry={'type':'LineString','coordinates':[[0,0],[100,0]]})]
    p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
    fixes=paved.corrections(p,'mabou');lots,cuts,roads=fixes;assert len(lots)==1 and len(cuts)==2 and len(roads)==1
    assert [g['id'] for g in fixes.gravel]==['gravel-lot'] and fixes.stalls==[],'gravel lot is its own class, not only a cut'
    assert paved.corrections(p,'judique')==([],[],[])
    features[2]['surface']='paved';p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
    assert paved.corrections(p,'mabou')[2][0]['surface']=='paved'
    features.append(dict(id='unapplied',area='mabou',enabled=False,kind='road',geometry=None))
    p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
    assert len(paved.corrections(p,'mabou')[2])==1,'disabled examples must never apply'
    features[0]['meetsRoad']=True;p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
    assert paved.corrections(p,'mabou')[0][0]['meetsRoad'] is True
    features[1]['meetsRoad']=True;features[1]['coversTracks']=True;p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
    assert paved.corrections(p,'mabou').gravel[0].get('coversTracks') is True and paved.corrections(p,'mabou').gravel[0].get('meetsRoad') is True,'gravel lot keeps its road flags'
    features[1].pop('meetsRoad');features[1].pop('coversTracks')
    for bad in [('meetsRoad','yes',0),('meetsRoad',1,0),('coversTracks',True,0),('coversTracks','yes',0),('meetsRoad',False,2),('coversTracks',True,2)]:
        features[bad[2]][bad[0]]=bad[1];p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
        try:paved.corrections(p,'mabou');raise AssertionError('Invalid meetsRoad accepted')
        except ValueError:pass
        features[bad[2]].pop(bad[0])
    features[2]['width']=-1;p.write_text(json.dumps(dict(version=1,epsg=2961,features=features)))
    try:paved.corrections(p,'mabou');raise AssertionError('Invalid correction width')
    except ValueError:pass
    # Owner stall rows: whole stalls, paint only on asphalt, stalls on the LEFT of the front line.
    row=dict(id='row',area='mabou',kind='stalls',surface='paved',depth=5.5,spacing=2.75,date='2026-11-17',source='owner note',
             geometry={'type':'LineString','coordinates':[[0,0],[27.5,0]]})
    p.write_text(json.dumps(dict(version=1,epsg=2961,features=[row])))
    assert paved.corrections(p,'mabou').stalls==[dict(id='row',row=[0,0,27.5,0,5.5,2.75])]
    area=paved.stall_area([0,0,27.5,0,5.5,2.75]);assert area.bounds==(0,0,27.5,5.5),'stalls lie left of an eastward front line'
    for bad in [dict(geometry={'type':'LineString','coordinates':[[0,0],[26,0]]}),dict(surface='gravel'),dict(depth=9),dict(spacing=1.5),
                dict(geometry={'type':'LineString','coordinates':[[0,0],[11,0],[22,0]]})]:
        p.write_text(json.dumps(dict(version=1,epsg=2961,features=[dict(row,**bad)])))
        try:paved.corrections(p,'mabou');raise AssertionError('Invalid stall row accepted: '+json.dumps(bad))
        except ValueError:pass
print('PASS paved pipeline: building, water, road, whole hand-site cuts, cell orientation, class bytes 0/1/2, correction lot, gravel lot, stall row and road materials, lots that meet the road or cover their tracks (15 assertion groups)')
if '--mutations' in sys.argv:
    for name in changes:
        result=subprocess.run([sys.executable,__file__,'--mutation',name],capture_output=True,text=True)
        diagnostic=DIAGNOSTIC[name]
        assert result.returncode==1 and diagnostic in result.stderr,(name,result.stderr)
        print('KILLED',name,'exit 1:',diagnostic)
# Footage rules: synthetic road graph, no address/house input.
from paved_aprons import make_aprons, seeded_rate
if '--apron-mutant' in sys.argv:
 import paved_aprons
 text=Path(paved_aprons.__file__).read_text()
 if sys.argv[-1]=='edge':text=text.replace('lo=max(0,min(line.length,s+direction*edge))','lo=s')
 else:text=text.replace("halfWidth=drive.get('halfWidth',1.5)","halfWidth=3.0")
 module=types.ModuleType('apron_mutant');module.__file__=paved_aprons.__file__;exec(compile(text,module.__file__,'exec'),module.__dict__);make_aprons=module.make_aprons
from shapely.geometry import LineString, Point
roads=[dict(id=1,name='public',kind=1,halfWidth=3.6,bridge=False,pts=[[-100,0],[100,0]]),
       dict(id=2,name='gravel',kind=3,halfWidth=2.6,bridge=False,pts=[[0,0],[0,100]])]
aprons,audit=make_aprons(roads,[])
assert len(aprons)==1 and aprons[0]['code']=='junction','one gravel junction apron'
g=shape(aprons[0]['geometry'])
assert 18<g.bounds[3]-g.bounds[1]<22 and 11.9<g.bounds[2]-g.bounds[0]<12.1,'20 m / 12 m junction flare'
assert g.covers(Point(0,10)) and not g.covers(Point(0,30)),'short junction only'
drives=[dict(line=LineString([(x,0),(x,30)])) for x in range(-90,91,2)]
a,decision=make_aprons([roads[0]],drives)
b,reverse=make_aprons([roads[0]],list(reversed([dict(line=LineString(list(d['line'].coords)[::-1])) for d in drives])))
assert sorted(x['id'] for x in decision if x['selected'])==sorted(x['id'] for x in reverse if x['selected']),'stable driveway seed under source reversal'
assert all(f['code']!='driveway' for f in a+b),'no raster driveway aprons'
assert all(x['road_change']['kind']==2 and x['road_change']['halfWidth']==1.5 and 6<=x['road_change']['metres']<=10 for x in decision if x['selected'])
assert decision and all(x['rate']==.16 for x in decision)
_,patched=make_aprons([dict(roads[0],surface='patched_asphalt')],drives)
assert all(x['rate']==.21 for x in patched),'patched road rate'
_,gravel=make_aprons([dict(roads[0],kind=3)],drives)
assert all(not x['selected'] and x['rate']==0 for x in gravel),'no gravel driveway aprons'
assert .15<sum(seeded_rate(str(i))<.16 for i in range(10000))/10000<.17,'seed rate agrees with 16 percent'
print('PASS footage aprons: 20 m length, 12 m flare, endpoint-only driveway identities, 16/21/0 rates and stable reversal')
# Execute the actual HRDEM rule with synthetic, georeferenced elevation rasters.
from osgeo import gdal,osr
from paved_heights import filter_lots
if '--roof-mutant' in sys.argv:
 import paved_heights
 text=Path(paved_heights.__file__).read_text().replace('eligible=inside&~roofs','eligible=inside')
 module=types.ModuleType('height_mutant');module.__file__=paved_heights.__file__;exec(compile(text,module.__file__,'exec'),module.__dict__);filter_lots=module.filter_lots
rules=json.loads((Path(paved.__file__).parent/'paved-rules.json').read_text())
with tempfile.TemporaryDirectory(prefix='paved-height-fixture-') as tmp:
    folder=Path(tmp)/'elevation';folder.mkdir()
    sr=osr.SpatialReference();sr.ImportFromEPSG(2961)
    for slope,height,expected in [(0.04,0,False),(0.10,0,True),(0,3,True)]:
        z=np.tile(np.arange(64,dtype=float)*slope,(64,1))
        for kind,array in [('dtm',z),('dsm',z+height)]:
            ds=gdal.GetDriverByName('GTiff').Create(str(folder/f'north-loop-{kind}-1m-epsg3979.tif'),64,64,1,gdal.GDT_Float32)
            ds.SetGeoTransform((600000,1,0,5100000,0,-1));ds.SetProjection(sr.ExportToWkt());ds.GetRasterBand(1).WriteArray(array);ds=None
        kept,audit=filter_lots([dict(id='synthetic',geometry=mapping(box(600010,5099950,600050,5099990)))],Path(tmp),lambda path,*args:path,paved.Shapes,rules)
        assert audit[0]['drop']==expected and bool(kept)==(not expected),'HRDEM slope/tall rule sensitivity'
print('PASS HRDEM rule: shallow bare lot kept, steep and tall lots dropped')

# A roof is a cutout, not tall cover on the paintable lot.
with tempfile.TemporaryDirectory(prefix='paved-roof-fixture-') as tmp:
 folder=Path(tmp)/'elevation';folder.mkdir()
 z=np.zeros((64,64));top=z.copy();top[14:40,14:40]=6
 for kind,array in [('dtm',z),('dsm',top)]:
  ds=gdal.GetDriverByName('GTiff').Create(str(folder/f'north-loop-{kind}-1m-epsg3979.tif'),64,64,1,gdal.GDT_Float32)
  ds.SetGeoTransform((600000,1,0,5100000,0,-1));ds.SetProjection(sr.ExportToWkt());ds.GetRasterBand(1).WriteArray(array);ds=None
 lot=dict(id='roof-lot',geometry=mapping(box(600010,5099950,600050,5099990)))
 kept,audit=filter_lots([lot],Path(tmp),lambda path,*args:path,paved.Shapes,rules,[box(600014,5099960,600040,5099986)])
 assert kept and audit[0]['tall_fraction']<.2,'Roof cut must precede lot eligibility'
print('PASS roof-excluded lot eligibility')
# First point is beyond the receiving pavement and carries the driveway width.
for decision in decision:
 if 'road_change' not in decision:continue
 change=decision['road_change'];assert change['halfWidth']==1.5
 assert abs(change['geometry']['coordinates'][0][1])>=3.6,'driveway starts at paved edge'

if '--mutations' in sys.argv:
 for args in [['--roof-mutant'],['--apron-mutant','edge'],['--apron-mutant','width']]:
  result=subprocess.run([sys.executable,__file__,*args],capture_output=True,text=True)
  assert result.returncode==1,(args,result.stdout,result.stderr)
  print('KILLED',args,'exit 1')
# The handoff must carry a driveway-specific width rather than the paved-road default.
_,width_audit=make_aprons([roads[0]],[dict(d,halfWidth=.9) for d in drives])
assert all(d['road_change']['halfWidth']==.9 for d in width_audit if 'road_change' in d),'driveway width must be carried'
print('PASS driveway-specific width is preserved')
