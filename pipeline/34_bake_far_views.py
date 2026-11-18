#!/usr/bin/env python3
"""Derived far meshes and sourced turbine points. Never writes data/baked or data/site.

Inputs: --data-root/raw/far-views, existing baked tall.json (towers/lines only).
Output must be below --data-root/work/bakes. No imagery is baked or copied.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
from osgeo import gdal, osr
import areas
from shapely.geometry import Point, LineString, Polygon
from shapely.strtree import STRtree


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False)+'\n');temporary.replace(path)


def transformer(a, b):
    s, t = osr.SpatialReference(), osr.SpatialReference()
    s.ImportFromEPSG(a); t.ImportFromEPSG(b)
    for r in (s, t): r.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(s, t)


class DEM:
    def __init__(self, path):
        self.ds = gdal.Open(str(path)); self.a = self.ds.ReadAsArray(); self.gt = self.ds.GetGeoTransform()
    def at(self, e, n):
        x=(e-self.gt[0])/self.gt[1]-.5; y=(n-self.gt[3])/self.gt[5]-.5
        if not 0 <= x < self.a.shape[1]-1 or not 0 <= y < self.a.shape[0]-1: raise ValueError('Outside DEM')
        c,r=int(x),int(y); tx,ty=x-c,y-r
        v=self.a[r:r+2,c:c+2]
        if np.any(v < -1000): raise ValueError('Missing DEM')
        return max(0.,float(v[0,0]*(1-tx)*(1-ty)+v[0,1]*tx*(1-ty)+v[1,0]*(1-tx)*ty+v[1,1]*tx*ty))


def root_box(manifest):
    x,y=manifest['origin']; s=manifest['size']; return [x,y-s,x+s,y]


def inside(e,n,b): return b[0] <= e <= b[2] and b[1] <= n <= b[3]


def distance_box(e,n,b): return math.hypot(max(b[0]-e,0,e-b[2]),max(b[1]-n,0,n-b[3]))


def mesh(dem, root, anchor, step, origin, ground=None, radius=90000):
    # Independent cells: no index cracks. Coast cells interpolate the DEM's zero
    # contour, rather than making a 240/480 m staircase at low island shores.
    # Grid aligns with root edges, so no triangles overlap the flat near world.
    x0=math.floor((anchor[0]-radius-root[0])/step)*step+root[0]
    n0=math.floor((anchor[1]-radius-root[1])/step)*step+root[1]
    positions=[]
    boundary={}
    def h(e,n):
        e,n=float(e),float(n)
        value=dem.at(e,n)
        if ground is not None:
            x=max(root[0],min(root[2],e));y=max(root[1],min(root[3],n));distance=math.hypot(e-x,n-y)
            if distance<1920:
                key=(float(x),float(y))
                if key not in boundary:
                    near=ground.at(x,y);boundary[key]=None if near is None else max(0,near)-dem.at(x,y)
                correction=boundary[key]
                if correction is not None:
                    t=distance/1920;value+=correction*(1-t*t*(3-2*t))
        return max(0,value)-.5  # sea-level coastal zero mask, below 0.5 m omitted
    def emit(poly):
        clipped=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            if a[2] >= 0: clipped.append(a)
            if (a[2] >= 0) != (b[2] >= 0):
                t=a[2]/(a[2]-b[2]); clipped.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),0.))
        for k in range(1,len(clipped)-1):
            for e,n,z in (clipped[0],clipped[k],clipped[k+1]): positions.extend((e-origin[0],z+.5,origin[1]-n))
    # Quadtree simplification keeps coastal cells fine, but allows 1.92 km
    # inland cells only when every fine sample fits bilinear relief within 12 m (desktop) or 20 m (LOW).
    # Gather shared edge vertices before triangulation to avoid T junctions.
    leaves=[]; cache={}; horizontal={};vertical={}
    def height(e,n):
        key=(round(float(e),6),round(float(n),6))
        if key not in cache:cache[key]=h(e,n)
        return cache[key]
    def divide(a,c,b,d):
        if distance_box(anchor[0],anchor[1],[a,c,b,d])>radius:return
        xs=np.linspace(a,b,max(2,math.ceil((b-a)/step)+1));ys=np.linspace(c,d,max(2,math.ceil((d-c)/step)+1))
        samples=np.array([[height(x,y) for x in xs] for y in ys]);wet=samples<0
        if np.all(wet):return
        ta=np.linspace(0,1,len(xs))[None,:];tb=np.linspace(0,1,len(ys))[:,None]
        approx=samples[0,0]*(1-ta)*(1-tb)+samples[0,-1]*ta*(1-tb)+samples[-1,0]*(1-ta)*tb+samples[-1,-1]*ta*tb
        if max(b-a,d-c)>step+1e-6 and (np.any(wet) or np.max(np.abs(samples-approx))>(12 if step==240 else 20)):
            x=(a+b)/2;y=(c+d)/2
            for box in [(a,c,x,y),(x,c,b,y),(a,y,x,d),(x,y,b,d)]:divide(*box)
        else:
            leaves.append((a,c,b,d))
            for y in (c,d):horizontal.setdefault(y,set()).update((a,b))
            for x in (a,b):vertical.setdefault(x,set()).update((c,d))
    coarse=1920
    x0=math.floor((anchor[0]-radius-root[0])/coarse)*coarse+root[0]
    n0=math.floor((anchor[1]-radius-root[1])/coarse)*coarse+root[1]
    for n in np.arange(n0,anchor[1]+radius,coarse):
        for e in np.arange(x0,anchor[0]+radius,coarse):
            xs=sorted(set([e,e+coarse]+[v for v in (root[0],root[2]) if e<v<e+coarse]))
            ns=sorted(set([n,n+coarse]+[v for v in (root[1],root[3]) if n<v<n+coarse]))
            for a,b in zip(xs,xs[1:]):
                for c,d in zip(ns,ns[1:]):
                    if not inside((a+b)/2,(c+d)/2,root):divide(a,c,b,d)
    # The near root can cut through a narrow valley. Extra edge samples keep
    # that seam tied to the local DTM without making the whole far ring finer.
    for edge in (root[1],root[3]):
        if edge in horizontal:horizontal[edge].update(np.arange(root[0],root[2]+1,64))
    for edge in (root[0],root[2]):
        if edge in vertical:vertical[edge].update(np.arange(root[1],root[3]+1,64))
    for a,c,b,d in leaves:
        edge=[(x,c) for x in sorted(horizontal[c]) if a<=x<b]
        edge += [(b,y) for y in sorted(vertical[b]) if c<=y<d]
        edge += [(x,d) for x in sorted(horizontal[d],reverse=True) if a<x<=b]
        edge += [(a,y) for y in sorted(vertical[a],reverse=True) if c<y<=d]
        if len(edge)==4 and all(height(*v)>=0 for v in edge):
            p=[(*v,height(*v)) for v in edge];emit([p[0],p[1],p[2]]);emit([p[0],p[2],p[3]]);continue
        centre=((a+b)/2,(c+d)/2,height((a+b)/2,(c+d)/2))
        for v,w in zip(edge,edge[1:]+edge[:1]):emit([centre,(*v,height(*v)),(*w,height(*w))])
    # Indexed, little endian float positions followed by uint32 indices.
    a=np.array(positions,dtype='<f4').reshape(-1,3)
    vertices,idx=np.unique(a,axis=0,return_inverse=True)
    indices=idx.astype('<u4')
    return vertices.astype('<f4'),indices


def safe_structures(base, legacy):
    roads=json.loads((base/'roads.json').read_text());roads=roads.get('roads',[]) if isinstance(roads,dict) else roads
    buildings=json.loads((base/'buildings.json').read_text());buildings=buildings.get('buildings',[]) if isinstance(buildings,dict) else buildings
    shapes=[LineString(r['pts']).buffer(r['halfWidth']+2) for r in roads if len(r['pts'])>1]
    shapes += [Polygon(b['footprint']) for b in buildings if len(b['footprint'])>2]
    tree=STRtree(shapes)
    def conflict(p):return len(tree.query(Point(p['e'],p['n']),predicate='intersects'))>0
    towers=[p for p in legacy['towers'] if not conflict(p)]
    lines=[p for p in legacy['lines'] if not any(conflict(q) for q in p['towers'])]
    omitted=dict(towers=len(legacy['towers'])-len(towers),lines=len(legacy['lines'])-len(lines),reason='Source overlaps mapped road or building; whole line omitted, positions never shifted')
    return towers,lines,omitted


def safe_turbines(base, points):
    """Both sources use the same physical base + 2 m clearance, including tracks."""
    roads=json.loads((base/'roads.json').read_text())['roads']
    buildings=json.loads((base/'buildings.json').read_text())['buildings']
    shapes=[LineString(r['pts']).buffer(r['halfWidth']+2) for r in roads if len(r['pts'])>1]
    labels=[dict(kind='road',id=r['id'],halfWidth=r['halfWidth']) for r in roads if len(r['pts'])>1]
    shapes += [Polygon(b['footprint']).buffer(2) for b in buildings if len(b['footprint'])>2]
    labels += [dict(kind='building',id=b['id']) for b in buildings if len(b['footprint'])>2]
    tree=STRtree(shapes);kept=[];omitted=[]
    for p in points:
        radius=p['hub']*.023
        hits=tree.query(Point(p['e'],p['n']).buffer(radius),predicate='intersects')
        if len(hits):
            omitted.append(dict(id=p['id'],e=p['e'],n=p['n'],source=p['source'],radius=radius,
                                reason='Measured base fails 2 m clearance from mapped road/track or building; position not shifted',
                                conflicts=[labels[int(i)] for i in hits]))
        else:kept.append(p)
    return kept,omitted


def inventory(data):
    def point(kind,p):return f'{kind}:{p["e"]:.2f}:{p["n"]:.2f}'
    return set([point('wind',p) for p in data.get('turbines',[])+data.get('far',[])]+
               [point('mast',p) for p in data.get('towers',[])]+
               ['line:'+hashlib.sha256(json.dumps(l['pts'],separators=(',',':')).encode()).hexdigest() for l in data.get('lines',[])])


def removals(previous, candidate):
    """Coordinates identify legacy and v2 points alike; moving one is a removal."""
    return sorted(inventory(previous)-inventory(candidate))


def require_preserved(previous, candidate, allowed):
    missing=removals(previous,candidate)
    if set(missing)-set(allowed):raise ValueError('Refusing unreviewed landmark removals: '+', '.join(set(missing)-set(allowed)))
    return missing


def baseline_report(baselines,candidate):
    return {name:dict(sha256=value['sha256'],removed=removals(value['data'],candidate)) for name,value in baselines.items()}


def guard_baselines(baselines,candidate,allowed):
    # A previous candidate never hides a change to the live inventory.
    for name,value in baselines.items():
        permission=allowed.get(name,{})
        missing=removals(value['data'],candidate)
        approved=permission.get('removed',[]) if permission.get('sha256')==value['sha256'] and set(permission.get('removed',[]))==set(missing) else []
        require_preserved(value['data'],candidate,approved)



def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--output-root',type=Path,required=True)
    ap.add_argument('--area',choices=list(areas.AREAS));ap.add_argument('--turbines-only',action='store_true')
    ap.add_argument('--audit-root',type=Path,help='Separate review-only folder under data/work, outside the asset tree')
    ap.add_argument('--allow-removals',type=Path,help='Explicit reviewed removal ledger, with baseline hashes; never inferred from counts')
    args=ap.parse_args(); data=args.data_root.resolve(); output=args.output_root.resolve()
    if not output.is_relative_to(data/'work/bakes') or output==data/'work/bakes': ap.error('output-root must be a task directory inside data/work/bakes')
    audit=(args.audit_root or data/'work/threads'/output.name/'bake-audit').resolve()
    if not audit.is_relative_to(data/'work') or audit.is_relative_to(output):ap.error('audit-root must be under data/work and outside the asset tree')
    gdal.UseExceptions(); raw=data/'raw/far-views';dem=DEM(raw/'regional-240m.tif')
    measurements=json.loads((Path(__file__).parent/'far-views-points.json').read_text())
    areas.ROOT=data.parent
    spec=importlib.util.spec_from_file_location('far_local_ground',Path(__file__).parent/'33_bake_landmarks_tall.py');local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
    def edge_ground(area):
        g=local.Ground(area);g.sources=[s for s in g.sources if s[0].GetDescription()==str(area.bake_wide('dtm'))];return g
    official=json.loads((raw/'nrcan-turbines.geojson').read_text());tr=transformer(4326,2961)
    retrieved=datetime.fromtimestamp((raw/'nrcan-turbines.geojson').stat().st_mtime,timezone.utc).date().isoformat()
    # The archived legacy bake supplies only its neutral provincial towers/lines.
    source_url='https://open.canada.ca/data/en/dataset/79fdad93-9025-49ad-ba16-c26d718cc070'
    turbines=[]
    groups={name:f'n{idx:03}' for idx,name in enumerate(sorted({f['properties']['Project_Name'] for f in official['features']}))}
    for f in official['features']:
        p=f['properties'];e,n,_=tr.TransformPoint(*f['geometry']['coordinates'][:2])
        hub=float(p.get('Hub_Height_m') or 100);diameter=float(p.get('Rotor_Diameter_m') or 100)
        turbines.append(dict(id=f'nrcan-{f["id"]}',e=round(e,2),n=round(n,2),hub=hub,diameter=diameter,farm=groups[p['Project_Name']],source='NRCan',sourceUrl=source_url,date=retrieved,dateKind='retrieved',confidence='high',dimensions='NRCan' if p.get('Hub_Height_m') and p.get('Rotor_Diameter_m') else 'assumed-modern-era'))
    for p in measurements['points']:
        if any(math.hypot(p['e']-q['e'],p['n']-q['n'])<150 for q in turbines): raise ValueError('Sentinel point duplicates NRCan')
        turbines.append(p)
    # One physical inventory across packs: a mapped conflict in any area omits
    # that point everywhere, rather than making a tower appear on area changes.
    rejected={}
    for area in areas.AREAS.values():
        rel=Path('terrain') if area.id=='mabou' else Path('areas')/area.id;base=data/'baked'/rel
        bounds=root_box(json.loads((base/'manifest.json').read_text()))
        _,conflicts=safe_turbines(base,[p for p in turbines if inside(p['e'],p['n'],bounds)])
        for p in conflicts:rejected.setdefault(p['id'],{**p,'checkedArea':area.id})
    overview={};pending=[];review={};roots={};allowed=json.loads(args.allow_removals.read_text()) if args.allow_removals else {}
    for area in areas.AREAS.values():
        if args.area and area.id!=args.area:continue
        rel=Path('terrain') if area.id=='mabou' else Path('areas')/area.id
        base=data/'baked'/rel;m=json.loads((base/'manifest.json').read_text());root=root_box(m);target=output/rel
        if (target/'manifest.json').exists():raise ValueError('Retire the old work manifest snapshot outside the asset tree before baking')
        roots[area.id]={k:m[k] for k in ('crs','origin','size','village')}
        legacy=json.loads((base/'tall.json').read_text());near=[];far=[];omitted_wind=[]
        towers,lines,omitted=safe_structures(base,legacy)
        for p in turbines:
            if distance_box(p['e'],p['n'],root)>80000:continue
            if p['id'] in rejected:
                omitted_wind.append(rejected[p['id']]);continue
            q={k:p[k] for k in ('id','e','n','hub','diameter','farm','source','date','dateKind','confidence','uncertainty','dimensions','dimensionsSource','tower') if k in p}
            q['ground']=round(dem.at(p['e'],p['n']),2)
            (near if inside(q['e'],q['n'],root) else far).append(q)
        omitted['turbines']=omitted_wind
        result={**legacy,'towers':towers,'lines':lines,'omitted':omitted,'version':2,'turbines':near,'far':far,'sources':{'NRCan':source_url,'Sentinel-2 L2A':'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a','ground':'MRDEM-30 DTM, 2026-06-22; 240 m resample'},'dimensionsSources':measurements['dimensionsSources']}
        baselines={}
        for name,path in [('live',base/'tall.json'),('work',target/'tall.json')]:
            if path.exists():baselines[name]=dict(data=json.loads(path.read_text()),sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        records=baseline_report(baselines,result)
        review[area.id]=dict(baselines=records,reasons=omitted)
        permission=allowed.get(area.id,{}).get('baselines',{})
        try:guard_baselines(baselines,result,permission)
        except ValueError:continue
        pending.append((area,rel,base,m,root,target,result))
    write_json(audit/'removal-review.json',review)
    if len(pending)!=(1 if args.area else len(areas.AREAS)):
        raise ValueError('Inventory guard: inspect the separate audit/removal-review.json and pass its exact live/work baseline ledger with --allow-removals. No tall pack was replaced.')
    for area,rel,base,m,root,target,result in pending:
        near=result['turbines'];far=result['far'];legacy=json.loads((base/'tall.json').read_text());towers=result['towers'];lines=result['lines']
        write_json(target/'tall.json',result)
        info=dict(file='far-land.json',crs='EPSG:2961',root=root,origin=m['village'],anchor=legacy['anchor'],radius=90000,source='Natural Resources Canada, Medium Resolution Digital Elevation Model (MRDEM-30 DTM)',sourceDate='2026-06-22',boundary='1920 m smooth match to the existing NRCan wide DTM; 64 m edge samples',sourceLicense='OGL-Canada-2.0',sourceUrl='https://open.canada.ca/data/en/dataset/18752265-bda3-498c-a4ba-9dfe68cb98da',levels={})
        if not args.turbines_only:
            for name,step in [('desktop',240),('low',480)]:
                vertices,indices=mesh(dem,root,legacy['anchor'],step,m['village'],edge_ground(area));blob=vertices.tobytes()+indices.tobytes();filename=f'far-land-{name}.bin';target.mkdir(parents=True,exist_ok=True);temporary=target/(filename+'.tmp');temporary.write_bytes(blob);temporary.replace(target/filename)
                info['levels'][name]=dict(file=filename,cell=step,vertices=len(vertices),indices=len(indices),triangles=len(indices)//3,bytes=len(blob),sha256=hashlib.sha256(blob).hexdigest())
                print(area.id,name,info['levels'][name],flush=True)
            write_json(target/'far-land.json',info)
        else:
            old=target/'far-land.json'
            if old.exists():info=json.loads(old.read_text())
        if not info['levels']:raise ValueError('A metadata-only bake requires an existing complete far-land pack')
        patch={'tall':{'file':'tall.json','turbines':len(near),'far':len(far),'towers':len(towers),'lines':len(lines)},**({'farLand':{'file':'far-land.json'}} if info['levels'] else {})}
        write_json(target/'manifest-patch.json',patch)
        overview[area.id]=dict(near=len(near),far=len(far),sources={s:sum(p['source']==s for p in near+far) for s in ['NRCan','Sentinel-2 L2A']},levels=info['levels'])
        print(area.id,'turbines',overview[area.id],flush=True)
    write_json(audit/'inventory.json',overview)
    write_json(audit/'root-fields.json',roots)


if __name__=='__main__':main()
