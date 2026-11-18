#!/usr/bin/env python3
"""Extract public vector inputs. Run with the project GDAL Python, then the ground sampler.
Usage: python tools/pt-infrastructure-extract.py data/work/pt-survey
Never reads imagery, intensity, civic address datasets or private reference material.
"""
import pathlib,sys,urllib.request,urllib.parse,json,zipfile,concurrent.futures,math
from osgeo import ogr,osr
raw=pathlib.Path(sys.argv[1]).resolve()
root=pathlib.Path(__file__).resolve().parents[1]
if not raw.is_relative_to(root/'data/work'): raise SystemExit('Use a scratch folder under data/work')
raw.mkdir(parents=True,exist_ok=True)
# Cache each downloaded public response for one extraction; remove the scratch folder afterwards.
def download(url,path):
 if not path.exists():
  with urllib.request.urlopen(url,timeout=120) as r:path.write_bytes(r.read())
 return path
p=raw
def one(arg):
 name,id=arg
 q={'$select':'*,:id','$where':"intersects(the_geom, 'POLYGON ((-61.468104 45.54932,-61.291694 45.54932,-61.291694 45.673129,-61.468104 45.673129,-61.468104 45.54932))')",'$limit':50000}
 d=json.loads(download('https://data.novascotia.ca/resource/'+id+'.json?'+urllib.parse.urlencode(q),p/(name+'.json')).read_text())
 from collections import Counter
 print(Counter((f.get('feat_code'),f.get('feat_desc')) for f in d),flush=True)

for arg in [('structures-line','kfmd-m3ru'),('structures-point','p4z4-pvgm'),('structures-poly','n23s-z3k7'),('water-poly','h8jb-hzrm'),('water-line','fpca-jrmt'),('water-point','458x-dmz3'),('utilities-line','yjmz-hpnc'),('utilities-point','eiwy-kfrj'),('roads-line','62ap-bhwk'),('roads-point','x8jw-yjc2')]:one(arg)
download('https://api.openstreetmap.org/api/0.6/map?bbox=-61.468104,45.54932,-61.291694,45.673129',p/'osm.xml')
import xml.etree.ElementTree as E,json,collections
r=E.parse(p/'osm.xml').getroot();nodes={n.get('id'):[float(n.get('lon')),float(n.get('lat'))] for n in r.findall('node')};out=[]
for x in r:
 tags={t.get('k'):t.get('v') for t in x.findall('tag')}
 if not any(tags.get(k) in vals for k,vals in {'waterway':['dam','weir','spillway'],'barrier':['fence','gate','lift_gate'],'man_made':['pipeline','goods_conveyor','light_tower','pier'],'tunnel':['culvert']}.items()):continue
 pts=[nodes[x.get('id')]] if x.tag=='node' else [nodes[n.get('ref')] for n in x.findall('nd') if n.get('ref') in nodes]
 out.append(dict(id=x.tag+'/'+x.get('id'),tags={k:v for k,v in tags.items() if k in ['barrier','waterway','man_made','tunnel','usage','height','width','fence_height','location','layer','area','mooring','source']},pts=pts))
open(p/'osm-survey.json','w').write(json.dumps(out));print(collections.Counter(next((v for k,v in x['tags'].items() if k in ['barrier','waterway','man_made','tunnel']),'?') for x in out))
for x in out:print(x['id'],x['tags'],len(x['pts']))

from osgeo import osr
import json,math
prefix=str(raw)+'/';s=osr.SpatialReference();s.ImportFromEPSG(4326);s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);t=osr.SpatialReference();t.ImportFromEPSG(2961);t.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);tr=osr.CoordinateTransformation(s,t)
d=json.load(open(prefix+'osm-survey.json'))
for f in d:
 f['pts']=[[round(q,2) for q in tr.TransformPoint(*pt)[:2]] for pt in f['pts']];f['length']=round(sum(math.dist(a,b) for a,b in zip(f['pts'],f['pts'][1:])),2)
 # keep only relevant public technical attributes
 f['tags']={k:v for k,v in f['tags'].items() if k in ['barrier','waterway','man_made','tunnel','usage','height','width','fence_height','location','layer','area','mooring','source']}
 if f['tags'].get('man_made')=='pier':print(f['id'],f['length'],f['pts'][0])
json.dump(d,open(prefix+'osm-projected.json','w'))

p=raw
from osgeo import ogr,osr
import json,pathlib,math
p=raw;src=osr.SpatialReference();src.ImportFromEPSG(4326);src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);dst=osr.SpatialReference();dst.ImportFromEPSG(2961);dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);tr=osr.CoordinateTransformation(src,dst)
features=[]
for n in ['structures-line','structures-point','structures-poly','water-poly','water-line','utilities-line','utilities-point','roads-line']:
 for f in json.load(open(p/(n+'.json'))):
  code=f['feat_code']
  if code not in ['WADM40','WADM50','RRCL50','STCV50','STFE50','STGT50','STBP60','WAWH40','UTPI50','UTPI56','UTTO60']:continue
  g=ogr.CreateGeometryFromJson(json.dumps(f['the_geom']));g.Transform(tr)
  o=dict(id=f[':id'],code=code,layer=n,geometry=json.loads(g.ExportToJson()),length=round(g.Length(),2),area=round(g.GetArea(),2),bounds=g.GetEnvelope(),z=f.get('zvalue'))
  features.append(o)
(p/'inventory.json').write_text(json.dumps(features))
for code in ['WADM40','WADM50','STCV50','STFE50','STGT50','UTPI50','STBP60']:
 print('\n',code)
 for f in features:
  if f['code']==code:print(f['id'],f['length'],f['area'],[round(x,1) for x in f['bounds']])

download('https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/canvec/shp/ManMade/canvec_50K_NS_ManMade_shp.zip',p/'canvec.zip')
with zipfile.ZipFile(p/'canvec.zip') as z:
 for n in z.namelist():
  if any('/'+s in n for s in ['dam_','delimiting_','tower_','sewage_','landmark_','protection_','pipeline_']):z.extract(n,p)
download('https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/canvec/shp/Res_MGT/canvec_50K_NS_Res_MGT_shp.zip',p/'resource.zip')
with zipfile.ZipFile(p/'resource.zip') as z:
 for n in z.namelist():
  if any('/'+s in n for s in ['dam_','delimiting_','tower_','sewage_','landmark_','protection_','pipeline_']):z.extract(n,p)
srs=osr.SpatialReference();srs.ImportFromEPSG(2961);srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
found=[]
for f in p.glob('canvec*/*.shp'):
 ds=ogr.Open(str(f));l=ds.GetLayer();src=l.GetSpatialRef();src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);tr=osr.CoordinateTransformation(src,srs)
 for r in l:
  g=r.GetGeometryRef().Clone();g.Transform(tr);a,b,c,d=g.GetEnvelope()
  if a>632460 or b<620172 or c>5058276 or d<5045988:continue
  obj=dict(layer=f.stem,properties=dict(r.items()),geometry=json.loads(g.ExportToJson()));found.append(obj);print(json.dumps(obj))
(p/'canvec-all.json').write_text(json.dumps(found))

(p/'canvec-pipeline-survey.json').write_text(json.dumps([f for f in found if f['layer']=='pipeline_1']))
import json,pathlib,math
from osgeo import ogr
p=raw;inv=json.load(open(p/'inventory.json'));osm=json.load(open(p/'osm-projected.json'));selected=[];rows=[]
def inside(pts):return all(620172<=a<=632460 and 5045988<=b<=5058276 for a,b in pts)
def paths(f):
 g=f['geometry'];c=g['coordinates'];return c if g['type']=='MultiLineString' else [r for poly in c for r in poly] if g['type']=='MultiPolygon' else [c]
wharves=[ogr.CreateGeometryFromJson(json.dumps(f['geometry'])) for f in inv if f['code']=='WAWH40']
def add(kind,source,id,pts,closed=False,height=None):
 if not inside(pts):return
 selected.append(dict(kind=kind,source=source,id=id,outline=[[round(a,2),round(b,2)] for a,b in pts],closed=closed,**({'height':height} if height else {})))
for f in inv:
 kind={'WADM40':'dam','WADM50':'dam','STCV50':'conveyor','STFE50':'fence','STGT50':'gate','RRCL50':'culvert'}.get(f['code'])
 status='outside task'
 if kind:
  ps=paths(f);status='selected' if all(inside(x) for x in ps) else 'outside exact bounds'
  g=ogr.CreateGeometryFromJson(json.dumps(f['geometry']))
  if kind=='conveyor' and any(g.Distance(w)<12 for w in wharves):status='marine wharf exclusion'
  if status=='selected':
   for i,pts in enumerate(ps):add(kind,'NSTDB',f['id']+('/'+str(i) if len(ps)>1 else ''),pts,f['code']=='WADM40')
 rows.append([f['code'],'NSTDB '+f['layer'],f['id'],str(f['length'])+' m / '+str(f['area'])+' m2',status])
for f in osm:
 t=f['tags'];kind='fence' if t.get('barrier')=='fence' else 'gate' if t.get('barrier')=='gate' else 'pier' if t.get('man_made')=='pier' and f['id'] in ['way/181290627','way/181290650','way/880475520','way/1086135790','way/1086135798','way/1086135805'] else None
 status='candidate only'
 if kind and inside(f['pts']):
  status='selected'
  if kind=='fence':
   g=ogr.CreateGeometryFromJson(json.dumps({'type':'LineString','coordinates':f['pts']}))
   if any(g.Distance(ogr.CreateGeometryFromJson(json.dumps({'type':'LineString','coordinates':x['outline']})))<10 for x in selected if x['kind']=='fence'):status='NSTDB overlap'
  if status=='selected':add(kind,'OSM',f['id'],f['pts'],t.get('area')=='yes',float(t.get('fence_height','2')) if kind=='fence' else None)
 if t.get('usage')=='spillway':status='underground culvert, no open spillway mapped'
 rows.append([kind or next(iter(t.values()),'?'),'OSM',f['id'],str(f['length'])+' m',status])
for f in json.load(open(p/'canvec-pipeline-survey.json')):
 id=f['properties']['feature_id'];pts=f['geometry']['coordinates'];status='marine pipe exclusion'
 if id in ['9c794384d0ed43e296157a4b6897a81f','d4e4a05ec889430cb9ae6031780a2f35']:
  add('pipeline','CanVec',id,pts);status='selected'
 rows.append(['pipeline','CanVec',id,str(round(sum(math.dist(a,b) for a,b in zip(pts,pts[1:])),2))+' m',status])
json.dump(dict(licence='NSTDB: Open Government Licence - Nova Scotia. CanVec: Open Government Licence - Canada. OpenStreetMap contributors: ODbL 1.0.',crs='EPSG:2961',bounds=[620172,5045988,632460,5058276],features=selected),open(p/'selected.json','w'),separators=(',',':'))
text='# Point Tupper source inventory\n\nSurvey 15 Nov 2026. Sizes are mapped line length and polygon area, not measured structure heights. NSTDB ids are stable Socrata row ids from the provincial open-data mirror. OSM ids are original node/way ids. Exact UTM bounds apply after projection.\n\n| Kind/code | Source | Feature id | Size | Decision |\n|---|---|---|---|---|\n'+'\n'.join('| '+' | '.join(r)+' |' for r in rows)+'\n'
(p/'inventory.md').write_text(text)
from collections import Counter
print(Counter(x['kind'] for x in selected));print('bytes',len(json.dumps(selected)))

print("Now run: node tools/run-node-check.mjs tools/pt-infrastructure-ground.mjs",raw)
