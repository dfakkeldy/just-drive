#!/usr/bin/env python3
"""Tiny source/bake guard fixtures. No promoted or real data is written."""
import importlib.util,json,tempfile,copy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'pipeline'))
spec=importlib.util.spec_from_file_location('far_bake_guard',ROOT/'pipeline/34_bake_far_views.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
source=(ROOT/'pipeline/34_bake_far_views.py').read_text()
from far_manifest import preserve_far_manifest

def suite(module):
 with tempfile.TemporaryDirectory(prefix='far-bake-fixture-') as tmp:
  p=Path(tmp);(p/'roads.json').write_text(json.dumps({'roads':[{'id':1,'kind':4,'halfWidth':1.5,'pts':[[-100,0],[100,0]]}]}));(p/'buildings.json').write_text(json.dumps({'buildings':[{'id':2,'footprint':[[20,19],[25,19],[25,24],[20,24]]}]}))
  for src in ['NRCan','Sentinel-2 L2A']:
   points=[dict(id='close-track',e=0,n=4.9,hub=118,source=src),dict(id='clear-track',e=0,n=10.5,hub=118,source=src),dict(id='close-building',e=18,n=22,hub=118,source=src)]
   before=copy.deepcopy(points);kept,omitted=module.safe_turbines(p,points)
   assert [v['id'] for v in kept]==['clear-track'],'same base/clearance rule for roads, tracks and both sources'
   assert [v['id'] for v in omitted]==['close-track','close-building'];assert points==before,'positions never shifted'
 old={'turbines':[dict(e=1,n=2)],'far':[],'towers':[dict(e=3,n=4)],'lines':[{'pts':[[0,0],[1,1]]}]}
 for kind in ['turbines','towers','lines']:
  new=copy.deepcopy(old);new[kind]=[]
  try:module.require_preserved(old,new,[])
  except ValueError:pass
  else:raise AssertionError('inventory removal must fail for '+kind)
  lost=module.removals(old,new);assert len(lost)==1;module.require_preserved(old,new,lost)
 moved=copy.deepcopy(old);moved['turbines'][0]['e']+=1
 try:module.require_preserved(old,moved,[])
 except ValueError:pass
 else:raise AssertionError('moving a point is a guarded removal')
 new=copy.deepcopy(old);new['far']=new.pop('turbines');new['turbines']=[];module.require_preserved(old,new,[])

suite(b)

def baselines_suite(module):
 live={'turbines':[dict(e=1,n=2),dict(e=3,n=4)]};work={'turbines':[dict(e=1,n=2)]};candidate=copy.deepcopy(work)
 states={'live':{'data':live,'sha256':'live-a'},'work':{'data':work,'sha256':'work-a'}}
 try:module.guard_baselines(states,candidate,{})
 except ValueError:pass
 else:raise AssertionError('work baseline must not hide live removals')
 report=module.baseline_report(states,candidate);assert len(report['live']['removed'])==1;assert report['work']['removed']==[]
 module.guard_baselines(states,candidate,report)
 states['live']={'data':{'turbines':live['turbines']+[dict(e=9,n=9)]},'sha256':'live-b'}
 try:module.guard_baselines(states,candidate,report)
 except ValueError:pass
 else:raise AssertionError('changed live hash/inventory must be rechecked')

baselines_suite(b)
def manifest_suite(fn):
 old=dict(crs='EPSG:2961',origin=[1,2],size=65536,village=[3,4],tall={'file':'tall.json'},farLand={'file':'far-land.json'})
 new={k:v for k,v in old.items() if k not in ('tall','farLand')}
 assert fn(old,new)==old
 try:fn(old,{**new,'size':1})
 except ValueError:pass
 else:raise AssertionError('root change must refuse a stale pack')

manifest_suite(preserve_far_manifest)
assert 'preserve_far_manifest(json.loads(previous.read_text()), manifest)' in (ROOT/'pipeline/21_bake_terrain.py').read_text()
assert 'run 33_bake_landmarks_tall.py' not in (ROOT/'tools/bake.sh').read_text(),'routine bake must not change optional landmark packs'
legacy=(ROOT/'pipeline/33_bake_landmarks_tall.py').read_text();assert "atomic(AREA.output" not in legacy;assert "34_bake_far_views.py" in legacy
if '--mutations' in sys.argv:
 for label,old,new in [('base radius omitted',"radius=p['hub']*.023",'radius=0'),('removal guard disabled','if set(missing)-set(allowed):','if False:')]:
  assert source.count(old)==1;ns={'__name__':'guard_mutant'};exec(compile(source.replace(old,new),'<guard-mutant>','exec'),ns);module=type('GuardMutant',(),ns)
  try:suite(module)
  except AssertionError:print('KILLED',label)
  else:raise AssertionError('mutant survived: '+label)
if '--mutations' in sys.argv:
 text=(ROOT/'pipeline/far_manifest.py').read_text()
 for label,old,new in [('optional keys dropped','return {**candidate,**keys}','return candidate'),('root guard disabled','if previous.get(field)!=candidate.get(field):','if False:')]:
  ns={};exec(compile(text.replace(old,new),'<manifest-mutant>','exec'),ns)
  try:manifest_suite(ns['preserve_far_manifest'])
  except AssertionError:print('KILLED',label)
  else:raise AssertionError('manifest mutant survived: '+label)
if '--mutations' in sys.argv:
 old='    for name,value in baselines.items():';assert source.count(old)==1
 ns={'__name__':'guard_mutant'};exec(compile(source.replace(old,"    for name,value in [('work',baselines['work'])]:"),'<live-guard-mutant>','exec'),ns)
 try:baselines_suite(type('GuardMutant',(),ns))
 except AssertionError:print('KILLED live inventory ignored')
 else:raise AssertionError('live-baseline mutant survived')
assert "write_json(target/'manifest.json'" not in source
assert "write_json(target/'manifest-patch.json',patch)" in source
if '--audit-live' in sys.argv:
 import hashlib
 at=sys.argv.index('--audit-live');data=Path(sys.argv[at+1]);pack=Path(sys.argv[at+2]);out=Path(sys.argv[at+3]);rows={}
 for area in ['mabou','judique','porthood','pointtupper','westbay','cansocauseway']:
  rel=Path('terrain') if area=='mabou' else Path('areas')/area
  old=data/'baked'/rel/'tall.json';candidate=json.loads((pack/rel/'tall.json').read_text());lost=b.removals(json.loads(old.read_text()),candidate)
  rows[area]={'liveSha256':hashlib.sha256(old.read_bytes()).hexdigest(),'removed':lost,'counts':{kind:sum(x.startswith(kind+':') for x in lost) for kind in ['wind','mast','line']},'reason':candidate.get('omitted')}
 out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps({a:r['counts'] for a,r in rows.items()}))
print('PASS uniform turbine clearance, immutable measurements, all inventory removals guarded and v2-only work entry point')
