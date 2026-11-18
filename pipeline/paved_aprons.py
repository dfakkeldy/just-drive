"""Owner footage rules, 14 Nov 2026. Seed mouths, never select households.

Junction: 20 m past the paved edge, flared to 12 m at the mouth.
Driveway: 16% on asphalt, 21% on explicitly tagged patched asphalt, none on gravel;
Road-bake handoff only, never rasterized. Only provincial DRIVEWAY features are eligible.
"""
import hashlib
import json
import math
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.strtree import STRtree
from shapely.ops import substring
from pathlib import Path
RULES=json.loads(Path(__file__).with_name("paved-rules.json").read_text())


def seeded_rate(key):
    return int.from_bytes(hashlib.sha256(('paved-open-mouth-v1:'+key).encode()).digest()[:8],'big')/2**64


def ribbon(line, s, direction, length, road, mouth_half, end_half):
    # Follow the mapped line, starting at the actual painted edge of the receiving road.
    running = line.length-s if direction>0 else s
    edge = None
    for distance in range(math.ceil(min(running,30))+1):
        p = line.interpolate(s+direction*min(distance,running))
        if road['line'].distance(p) >= road['halfWidth']:
            edge = distance; break
    if edge is None or running-edge < 3: return None
    end = min(running,edge+length)
    left,right = [],[]
    for i in range(math.ceil(end-edge)+1):
        t = min(end,edge+i)
        a=line.interpolate(max(0,min(line.length,s+direction*(t-.25))))
        b=line.interpolate(max(0,min(line.length,s+direction*(t+.25))))
        dx,dy=b.x-a.x,b.y-a.y;norm=math.hypot(dx,dy)
        if norm<1e-6:continue
        p=line.interpolate(s+direction*t)
        half=end_half+(mouth_half-end_half)*max(0,1-(t-edge)/min(RULES['junction_flare_length_m'],length))
        left.append((p.x-dy/norm*half,p.y+dx/norm*half));right.append((p.x+dy/norm*half,p.y-dx/norm*half))
    if len(left)<2:return None
    return Polygon(left+right[::-1]).buffer(0)


def make_aprons(roads,driveways):
    public=[dict(r,line=LineString(r['pts'])) for r in roads if r['kind']<=3 and not r.get('bridge') and r.get('name')!='Railroad' and len(r['pts'])>1]
    tree=STRtree([r['line'] for r in public]);features=[];audit=[];seen=set()
    def nearest(p, own=None):
        candidates=[public[int(i)] for i in tree.query(p.buffer(12)) if public[int(i)] is not own]
        candidates=[r for r in candidates if r['line'].distance(p)<=12]
        return min(candidates,key=lambda r:(r['line'].distance(p),r.get('id',0))) if candidates else None
    def add(kind,key,line,s,direction,road,length,half):
        g=ribbon(line,s,direction,length,road,RULES['junction_mouth_width_m']/2 if kind=='junction' else 2.5,half)
        if g is None or g.is_empty:return
        features.append(dict(id=f'{kind}-{key}',code=kind,geometry=mapping(g)))
    for r in public:
        if r['kind']!=3:continue
        line=r['line'];contacts=[]
        for k,s in [(0,0),(1,line.length)]:
            p=line.interpolate(s);hit=nearest(p,r)
            if hit and hit['kind']<=2:contacts.append((s,1 if k==0 else -1,hit))
        # Crossroads can sit inside one source polyline; include both gravel arms.
        for i in tree.query(line):
            hit=public[int(i)]
            if hit['kind']>2:continue
            cross=line.intersection(hit['line'])
            points=[cross] if cross.geom_type=='Point' else getattr(cross,'geoms',[])
            for p in points:
                if p.geom_type!='Point':continue
                s=line.project(p)
                if s>3 and s<line.length-3:contacts.extend([(s,1,hit),(s,-1,hit)])
        for s,direction,hit in contacts:
            p=line.interpolate(s);key=f'{round(p.x)}:{round(p.y)}:{direction}:{r.get("id")}'
            if key in seen:continue
            seen.add(key);add('junction',key,line,s,direction,hit,RULES['junction_length_m'],r['halfWidth'])
    for drive in driveways:
        line=drive['line']
        canonical=min(list(line.coords),list(line.coords)[::-1])
        identity=hashlib.sha256(json.dumps([[round(x,2),round(y,2)] for x,y in canonical]).encode()).hexdigest()[:20]
        for k,s in [(0,0),(1,line.length)]:
            p=line.interpolate(s);hit=nearest(p)
            if not hit:continue
            # Round the mouth's location into the seed, independent of source feature order or road IDs.
            key=f'{identity}:{round(p.x,2)}:{round(p.y,2)}'
            if key in seen:continue
            seen.add(key)
            rate=0 if hit['kind']==3 else RULES['driveway_rate_patched'] if hit.get('surface')=='patched_asphalt' else RULES['driveway_rate_asphalt']
            draw=seeded_rate(key);selected=draw<rate
            audit.append(dict(id=key,road_kind=hit['kind'],rate=rate,draw=draw,selected=selected))
            if selected:
                direction=1 if k==0 else -1
                # Locate the receiving pavement edge along the driveway, just as the junction ribbon does.
                available=line.length-s if direction>0 else s
                edge=None
                for distance in range(math.ceil(min(available,30))+1):
                    at=line.interpolate(s+direction*min(distance,available))
                    if hit['line'].distance(at)>=hit['halfWidth']:
                        edge=float(distance);break
                if edge is None:continue
                lo=max(0,min(line.length,s+direction*edge))
                hi=max(0,min(line.length,lo+direction*RULES['driveway_road_change_m']))
                if abs(hi-lo)<6:continue
                piece=substring(line,lo,hi)
                audit[-1]['road_change']=dict(id=key,kind=2,halfWidth=drive.get('halfWidth',1.5),metres=abs(hi-lo),geometry=mapping(piece),snapTolerance=7,apply=False)
                # Never rasterize a narrow driveway mouth into 2 m cells.

    return features,audit
