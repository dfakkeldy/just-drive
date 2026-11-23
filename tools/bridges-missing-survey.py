#!/usr/bin/env python3
"""Read-only six-area source census. Original vectors stay at --source-data; output is work evidence.

Find discarded bridge ways/areas and mapped-water crossings on every unflagged road, track and trail.
Candidates require terrain/source adjudication; a water polygon alone does not prove a missing bridge.
"""
import argparse
import json
import math
import functools
import numpy as np
from pathlib import Path
from osgeo import ogr, osr, gdal
from shapely import from_wkb
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

ogr.UseExceptions()
ROOT=Path(__file__).absolute().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--source-data',type=Path,required=True);parser.add_argument('--out',type=Path,default=ROOT/'data/work/threads/bridges')
args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
src,dst=osr.SpatialReference(),osr.SpatialReference();src.ImportFromEPSG(4326);dst.ImportFromEPSG(2961)
src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);tr=osr.CoordinateTransformation(src,dst)
areas=['mabou','judique','porthood','westbay','pointtupper','cansocauseway'];sources=[];water_crossings=[];gullies=[];unknown=[]
def parts(g):
    if g.is_empty:return
    if g.geom_type=='LineString':yield g
    elif hasattr(g,'geoms'):
        for child in g.geoms:yield from parts(child)
for area in areas:
    base=ROOT/'data/baked'/('terrain' if area=='mabou' else 'areas/'+area)
    raw=args.source_data/('raw' if area=='mabou' else 'raw/areas/'+area)/'vectors'
    roads=json.loads((base/'roads.json').read_text())['roads'];lines=[LineString(r['pts']) for r in roads];tree=STRtree(lines)
    manifest=json.loads((base/'manifest.json').read_text());available={int(k):set(v) for k,v in manifest['levels'].items()}
    @functools.lru_cache(maxsize=24)
    def tile(level,i,j):
        ds=gdal.Open(str(base/str(level)/f'{i}_{j}.png'));p=ds.ReadAsArray();return (p[0].astype(np.uint16)*256+p[1]).astype(np.float32)*manifest['height']['scale']+manifest['height']['offset']
    def ground(e,n):
        # The last border sample is in the PNG even though runtime tile ownership is half-open.
        # Read it from just inside the outer root; do not discard a whole road for its final sample.
        if abs(e-manifest['origin'][0]-manifest['size'])<1e-7:e-=1e-6
        if abs(n-manifest['origin'][1]+manifest['size'])<1e-7:n+=1e-6
        for level in sorted(available,reverse=True):
            size=manifest['size']/2**level;i=math.floor((e-manifest['origin'][0])/size);j=math.floor((manifest['origin'][1]-n)/size)
            if f'{i}_{j}' not in available[level]:continue
            p=tile(level,i,j);a=((e-manifest['origin'][0])/size-i)*256;b=((manifest['origin'][1]-n)/size-j)*256;x,y=min(255,math.floor(a)),min(255,math.floor(b));u,v=a-x,b-y
            return float((p[y,x]*(1-u)+p[y,x+1]*u)*(1-v)+(p[y+1,x]*(1-u)+p[y+1,x+1]*u)*v)
        return None
    def sample(candidate):
        g=LineString(candidate['pts']);length=g.length;a,b=g.coords[0],g.coords[-1]
        def bank(p,q):
            d=math.dist(p,q) or 1
            return ground(p[0]+(p[0]-q[0])*6/d,p[1]+(p[1]-q[1])*6/d)
        h=[ground(*g.interpolate(min(length,s)).coords[0]) for s in np.arange(0,length+1,1)]
        banks=[bank(a,g.coords[1]),bank(b,g.coords[-2])];known=[x for x in h if x is not None];candidate.update(banks=banks,land_min=min(known) if known else None,land_max=max(known) if known else None,deficit=min(banks)-min(known) if known and all(x is not None for x in banks) else None)
        return candidate
    flagged=unary_union([g.buffer(r['halfWidth']+1) for r,g in zip(roads,lines) if r['bridge']])
    water=[]
    for file in raw.glob('*Water*08_wet_features.geojson'):
        ds=ogr.Open(str(file))
        for f in ds.GetLayer(0):
            g=f.GetGeometryRef().Clone();g.Transform(tr);s=from_wkb(bytes(g.ExportToWkb()))
            if 'Polygon' in s.geom_type:water.append(s)
    wet=unary_union(water)
    for i,(road,g) in enumerate(zip(roads,lines)):
        if road['bridge']:continue
        for p in parts(g.intersection(wet).difference(flagged)):
            if p.length<2:continue
            a,b=p.coords[0],p.coords[-1]
            water_crossings.append(sample({'area':area,'road':road['id'],'name':road['name'],'kind':road['kind'],'length':p.length,'pts':[list(q) for q in p.coords],
                'position':[(a[0]+b[0])/2,(a[1]+b[1])/2], 'reason':'unflagged centreline intersects mapped water; terrain validation required'}))
    def consider(geometry,source,tags):
        if tags.get('bridge') in (None,'no') and tags.get('man_made')!='bridge' and 'FEAT_CODE' not in tags:
            geometry=geometry.intersection(wet) # layer=1 is supporting evidence only where water also crosses.
        trail=tags.get('highway') in ('path','cycleway','footway','bridleway') or tags.get('railway')=='abandoned' or tags.get('abandoned:railway')
        matches=[]
        for index in tree.query(geometry.buffer(20)):
            r,g=roads[index],lines[index]
            if trail and r['kind']!=5:continue
            if tags.get('railway') and r['kind']!=5 and r['name']!='Railroad':continue
            if not trail and tags.get('highway')=='track' and r['kind']<4:continue
            distance=g.distance(geometry)
            if distance>20:continue
            if geometry.geom_type=='LineString':
                a,b=geometry.coords[0],geometry.coords[-1];p0,p1=g.interpolate(g.project(Point(a))),g.interpolate(g.project(Point(b)))
                length=p0.distance(p1)
                if length<max(2,geometry.length*.55):continue
                piece=g.intersection(geometry.buffer(max(2,distance+1)))
            else:piece=g.intersection(geometry)
            for p in parts(piece):
                if p.length<2:continue
                matches.append((distance,r,p))
        if not matches:return
        best=min(x[0] for x in matches)
        for distance,r,p in matches:
            if distance>best+2 or r['bridge']:continue
            if p.difference(flagged).length<p.length*.5:continue
            a,b=p.coords[0],p.coords[-1]
            sources.append(sample({'area':area,'road':r['id'],'name':r['name'],'kind':r['kind'],'source':source,'tags':tags,'offset':distance,'length':p.length,
                'pts':[list(q) for q in p.coords],'position':[(a[0]+b[0])/2,(a[1]+b[1])/2],
                'reason':'source bridge is present, but baked centreline has no bridge flag'}))
    osm=raw/'osm.json'
    if osm.exists():
        seen=set()
        for e in json.loads(osm.read_text())['elements']:
            t=e.get('tags',{});key=(e['type'],e['id'])
            if key in seen or not e.get('geometry'):continue
            seen.add(key)
            if not (t.get('bridge') not in (None,'no') or t.get('man_made')=='bridge' or t.get('layer')=='1' and (t.get('railway')=='abandoned' or t.get('abandoned:railway'))):continue
            points=[tr.TransformPoint(p['lon'],p['lat'])[:2] for p in e['geometry']]
            if len(points)<2:continue
            geometry=Polygon(points) if t.get('man_made')=='bridge' and points[0]==points[-1] else LineString(points)
            consider(geometry,'osm/'+e['type']+'/'+str(e['id']),t)
    # Bridge features in railway/structure layers may be absent from the road-only provincial export.
    for file in [*raw.glob('*Roads*06_railways.geojson'),*raw.glob('*Structures*0[123]*.geojson')]:
        ds=ogr.Open(str(file))
        for f in ds.GetLayer(0):
            props=dict(f.items());desc=str(props.get('FEAT_DESC',''));code=str(props.get('FEAT_CODE',''))
            if 'bridge' not in desc.lower() and not code.startswith(('RRBR','RRBM')):continue
            g=f.GetGeometryRef()
            if not g:continue
            g=g.Clone();g.Transform(tr);shape=from_wkb(bytes(g.ExportToWkb()))
            consider(shape,file.name+'/'+str(props.get('OBJECTID',f.GetFID())),{'railway':'abandoned',**props})
    # Every remaining trail/track profile: find short, two-banked depressions in bare-earth land.
    # These are review candidates; a natural valley is not, by itself, evidence of a real bridge.
    for road,g in zip(roads,lines):
        if road['bridge'] or road['kind']<4 or g.length<8:continue
        at=np.arange(0,g.length+2,2);values=[ground(*g.interpolate(min(g.length,s)).coords[0]) for s in at]
        if any(v is None for v in values):unknown.append({'area':area,'road':road['id'],'name':road['name'],'missing_samples':sum(v is None for v in values)});continue
        heights=np.array(values);debt=np.zeros(len(at))
        for i in range(2,len(at)-2):debt[i]=min(max(heights[max(0,i-30):i]),max(heights[i+1:i+31]))-heights[i]
        i=0
        while i<len(at):
            if debt[i]<2.5:i+=1;continue
            start=i
            while i<len(at) and debt[i]>=2.5:i+=1
            end=i-1;centre=(start+end)//2;left=max(0,centre-30)+int(np.argmax(heights[max(0,centre-30):centre]));right=centre+1+int(np.argmax(heights[centre+1:min(len(at),centre+31)]))
            s0,s1=at[left],min(g.length,at[right]);piece=__import__('shapely').ops.substring(g,s0,s1)
            if piece.length>120 or piece.length<6 or piece.difference(flagged).length<piece.length*.8:continue
            a,b=piece.coords[0],piece.coords[-1]
            floor=left+int(np.argmin(heights[left:right+1]));drop=max([0,*(-np.diff(heights[left:floor+1])/2)]);rise=max([0,*(np.diff(heights[floor:right+1])/2)])
            gullies.append(sample({'area':area,'road':road['id'],'name':road['name'],'kind':road['kind'],'length':piece.length,'pts':[list(q) for q in piece.coords],'position':[(a[0]+b[0])/2,(a[1]+b[1])/2],
                'max_drop_grade':float(drop),'max_rise_grade':float(rise),
                'reason':'unflagged track/trail has a two-banked bare-earth depression of at least 2.5m; source adjudication required'}))
    print(area,'unflagged mapped-water pieces',sum(r['area']==area for r in water_crossings),'discarded source bridges',sum(r['area']==area for r in sources),flush=True)
(args.out/'missing-source-candidates.json').write_text(json.dumps(sources,indent=2)+'\n')
(args.out/'missing-water-candidates.json').write_text(json.dumps(water_crossings,indent=2)+'\n')
(args.out/'missing-gully-candidates.json').write_text(json.dumps(gullies,indent=2)+'\n')
(args.out/'missing-coverage.json').write_text(json.dumps(unknown,indent=2)+'\n')
