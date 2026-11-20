#!/usr/bin/env python3
"""Offline public-road sidewalk recipe. Reads baked inputs; writes only tracked web JSON.

Shapely clips exact finite road surfaces, so a through road and either side of a
T junction use the same geometry. House and prop footprints are never published.
"""
import argparse, hashlib, heapq, json, math, subprocess
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from shapely import STRtree, Polygon, Point, LineString, box, unary_union

ROOT=Path(__file__).absolute().parents[1]
OUTPUT=ROOT/'web/src/sidewalks-plan.json'
DIRECTIONS={'north-west':(-1,1),'north-east':(1,1),'south-west':(-1,-1),'west':(-1,0)}
CLEAR=.025

def load_inputs():
    return json.loads(subprocess.check_output(['node','tools/sidewalks-inputs.mjs'],cwd=ROOT))

def road_surfaces(roads):
    """Flat ends distinguish the joining side; internal joins are filled by round joins."""
    records=[]
    public=[r for r in roads if 1<=r['kind']<=3 and not r['bridge']]
    lines=[LineString(r['pts']) for r in public];tree=STRtree(lines)
    for road in roads:
        pts=list(road['pts'])
        if road['kind']==4:
            # The props mouth rule: the nearest public road within 12 m, on either end.
            for k in [0,-1]:
                p=Point(pts[k]);i=int(tree.nearest(p));line=lines[i]
                if p.distance(line)<=12:
                    q=line.interpolate(line.project(p));pts=([(q.x,q.y)]+pts) if k==0 else (pts+[(q.x,q.y)])
        line=LineString(pts)
        records.append({'road':road,'shape':line.buffer(road['halfWidth'],cap_style='flat',join_style='round'),'line':line})
    return records

def section_data(run,route,road_by_id):
    values=[]
    for i,p in enumerate(route):
        a=route[max(0,i-1)];b=route[min(len(route)-1,i+1)]
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy) or 1
        nx,ny=-dy/length,dx/length;d=DIRECTIONS[run['side']]
        if nx*d[0]+ny*d[1]<0:nx,ny=-nx,-ny
        road=road_by_id[p[2]]
        # A unit averaged normal cuts the inside of a bend. Miter the centre offset,
        # retaining the measured slab width, so even LOW quads stay outside the road.
        cosines=[]
        for q in [route[max(0,i-1)],route[min(len(route)-1,i+1)]]:
            dx0,dy0=q[0]-p[0],q[1]-p[1];l=math.hypot(dx0,dy0)
            if l>1e-8:cosines.append(abs(nx*(-dy0/l)+ny*(dx0/l)))
        miter=1/max(.5,min(cosines,default=1.))
        offset=(road['halfWidth']+run['buffer']+CLEAR+run['width']/2)*miter
        values.append((p[0],p[1],nx,ny,p[0]+nx*offset,p[1]+ny*offset,p[2]))
    line=LineString([(p[4],p[5]) for p in values]);cum=[0.]
    for a,b in zip(values,values[1:]):cum.append(cum[-1]+math.hypot(b[4]-a[4],b[5]-a[5]))
    def at(s,width=None):
        import bisect
        i=min(len(values)-2,max(0,bisect.bisect_right(cum,s)-1));t=(s-cum[i])/(cum[i+1]-cum[i] or 1);a,b=values[i],values[i+1]
        e,n,nx,ny,x,y=[a[j]+(b[j]-a[j])*t for j in range(6)];length=math.hypot(nx,ny);nx/=length;ny/=length
        w=run['width'] if width is None else width
        inner=[x-nx*run['width']/2,y-ny*run['width']/2];outer=[inner[0]+nx*w,inner[1]+ny*w]
        return {'centre':[e,n],'normal':[nx,ny],'inner':inner,'outer':outer,'road':b[6],'lift':0.,'along':s}
    return line,cum,at

def parts(geom):
    if geom.is_empty:return []
    if hasattr(geom,'geoms'):return [p for g in geom.geoms for p in parts(g)]
    return [geom]

def poly(piece):return Polygon([piece['a']['inner'],piece['b']['inner'],piece['b']['outer'],piece['a']['outer']])
def buffer_poly(piece,roads):
    def edge(s):
        half=roads[s['road']]['halfWidth']+CLEAR
        return [s['centre'][0]+s['normal'][0]*half,s['centre'][1]+s['normal'][1]*half]
    return Polygon([edge(piece['a']),edge(piece['b']),piece['b']['inner'],piece['a']['inner']])

def build_plan(area,inputs,low=False):
    roads=inputs['roads'];rmap={r['id']:r for r in roads};surfaces=road_surfaces(roads);road_shapes=[s['shape'] for s in surfaces];road_tree=STRtree(road_shapes)
    obstacles=inputs['obstacles'];effective=[Polygon(o['polygon']) for o in obstacles];obs_ids=[o['id'] for o in obstacles]
    pieces=[];crossings=[];skipped=[];moves=[];narrowed=[]
    runs={r['id']:r for r in ALL_RUNS if r['area']==area}
    for run in runs.values():
        line,cum,at=section_data(run,inputs['routes'][run['id']],rmap);length=line.length
        # A finite side road can reach only its joining side. A through-road reaches both.
        intervals=[]
        corridor=[]
        for aa,bb in zip(cum,cum[1:]):
            sa,sb=at(aa),at(bb);corridor.append(Polygon([sa['inner'],sb['inner'],sb['outer'],sa['outer']]))
        corridor_tree=STRtree(corridor)
        for si in road_tree.query(line.buffer(run['width']/2+.1)):
            surface=surfaces[int(si)];road=surface['road']
            if road['name']==run['road']:continue
            candidates=[];boundary=surface['shape'].buffer(.025)
            for ci in corridor_tree.query(boundary,predicate='intersects'):
                cut=corridor[int(ci)].intersection(boundary)
                for fragment in parts(cut):
                    if fragment.geom_type!='Polygon' or fragment.area<1e-9:continue
                    ss=[line.project(Point(p)) for p in fragment.exterior.coords]
                    candidates.append((max(0,min(ss)-.025),min(length,max(ss)+.025)))
            # Join spans cut at centreline knots; preserve distinct intersections on looping roads.
            spans=[]
            for lo,hi in sorted(candidates):
                if spans and lo<=spans[-1][1]+.03:spans[-1]=(spans[-1][0],max(hi,spans[-1][1]))
                else:spans.append((lo,hi))
            for lo,hi in spans:
                intervals.append((lo,hi,road['id'],road['kind']==4))
                crossings.append({'run':run['id'],'road':road['id'],'driveway':road['kind']==4,'start':lo,'end':hi})
        # Clip genuinely impassable building frontage before LOW segmentation. A coarse
        # four-metre piece must not turn a nearby building into an extra false junction gap.
        min_line=LineString([(at(v)['inner'][0]+at(v)['normal'][0]*.5,at(v)['inner'][1]+at(v)['normal'][1]*.5) for v in cum])
        building_intervals=[]
        for obstacle in obstacles:
            if not (obstacle['id'].startswith('building-') or obstacle['id'].startswith('hand-site-')):continue
            shape=Polygon(obstacle['polygon'])
            if shape.distance(min_line)>.51:continue
            for segment in parts(min_line.intersection(shape.buffer(.505))):
                if segment.geom_type!='LineString' or segment.length<.001:continue
                ss=[line.project(Point(p)) for p in segment.coords];building_intervals.append((max(0,min(ss)-.01),min(length,max(ss)+.01),obstacle['id']))
        cuts={0.,length,*cum}
        for lo,hi,_ in building_intervals:cuts.update([lo,hi])
        for lo,hi,_,_ in intervals:cuts.update([lo,hi,max(0,lo-1.5),min(length,hi+1.5)])
        for a,b in zip(cum,cum[1:]):
            steps=math.ceil((b-a)/(4 if low else 1.5))
            cuts.update(a+(b-a)*i/steps for i in range(1,steps))
        cuts=sorted(cuts)
        for start,end in zip(cuts,cuts[1:]):
            if end-start<.001:continue
            middle=(start+end)/2;blocked=next((i for i in intervals if i[0]<middle<i[1]),None)
            if blocked:
                skipped.append({'run':run['id'],'reason':f'road-{blocked[2]}','metres':end-start});continue
            building_block=next((i for i in building_intervals if i[0]<middle<i[1]),None)
            if building_block:
                skipped.append({'run':run['id'],'reason':building_block[2],'metres':end-start});continue
            a,b=at(start),at(end)
            for s in [a,b]:
                ramp=min(1,s['along']/1.5,(length-s['along'])/1.5)
                for lo,hi,_,_ in intervals:ramp=min(ramp,max(0,(lo-s['along'] if s['along']<lo else s['along']-hi)/1.5))
                s['lift']=.15*ramp if run['curb']=='raised' else 0
            p={'run':run['id'],'a':a,'b':b,'material':'concrete' if run['id']=='harbour-corner' and middle<8 else run['material']}
            shape=poly(p)
            # Check every kind, including the owning curved road. Keep a real edge clearance.
            if any(shape.intersection(road_shapes[int(i)]).area>1e-7 for i in road_tree.query(shape)):
                skipped.append({'run':run['id'],'reason':'road-edge','metres':end-start});continue
            pieces.append(p)
    # Poles move to the back edge rather than punching holes in the walk.
    slab_shapes=[poly(p) for p in pieces];slab_tree=STRtree(slab_shapes)
    for oi,oid in enumerate(obs_ids):
        if not oid.startswith('poles-'):continue
        old=effective[oi];hits=slab_tree.query(old,predicate='intersects')
        if not len(hits):continue
        centre=old.centroid;p=min((pieces[int(i)] for i in hits),key=lambda p:poly(p).distance(centre))
        line=LineString([p['a']['outer'],p['b']['outer']]);q=line.interpolate(line.project(centre));n=p['a']['normal'];found=None
        for distance in [.95,1.2,1.6,2.]:
            for along in [0,1,-1,2,-2,4,-4]:
                x,y=q.x+n[0]*distance+n[1]*along,q.y+n[1]*distance-n[0]*along
                candidate=box(x-.65,y-.65,x+.65,y+.65)
                if any(candidate.intersects(slab_shapes[int(i)]) for i in slab_tree.query(candidate)):continue
                if any(candidate.distance(road_shapes[int(i)])<.5 for i in road_tree.query(candidate.buffer(.5))):continue
                if any(j!=oi and candidate.intersects(o) for j,o in enumerate(effective)):continue
                found=(x,y,candidate);break
            if found:break
        if not found:raise ValueError(f'No back-edge clearance for {area}/{oid}')
        x,y,shape=found;moves.append({'index':int(oid.split('-')[1]),'from':[centre.x,centre.y],'to':[x,y]});effective[oi]=shape
    obstacle_tree=STRtree(effective)
    kept=[]
    for p in pieces:
        shape=poly(p);hits=obstacle_tree.query(shape,predicate='intersects')
        if len(hits):
            # Preserve a full metre where buildings leave enough room.
            def narrowed_piece(width):
                q={**p,'a':dict(p['a']),'b':dict(p['b'])}
                for s in [q['a'],q['b']]:s['outer']=[s['inner'][0]+s['normal'][0]*width,s['inner'][1]+s['normal'][1]*width]
                return q
            minimum=narrowed_piece(1.0)
            if not len(obstacle_tree.query(poly(minimum),predicate='intersects')):
                lo,hi=1.,runs[p['run']]['width']
                for _ in range(12):
                    mid=(lo+hi)/2
                    if len(obstacle_tree.query(poly(narrowed_piece(mid)),predicate='intersects')):hi=mid
                    else:lo=mid
                p=narrowed_piece(max(1.,lo-.005));narrowed.append({'run':p['run'],'along':p['a']['along'],'width':max(1.,lo-.005)})
            else:
                skipped.append({'run':p['run'],'reason':obs_ids[int(hits[0])],'metres':p['b']['along']-p['a']['along']});continue
        kept.append(p)
    # Do not leave isolated stepping stones between clearances.
    pieces=[];component=[]
    for p in kept+[None]:
        if component and (p is None or p['run']!=component[-1]['run'] or abs(p['a']['along']-component[-1]['b']['along'])>.002):
            metres=component[-1]['b']['along']-component[0]['a']['along']
            if metres>=4:pieces.extend(component)
            else:skipped.append({'run':component[0]['run'],'reason':'short-section','metres':metres})
            component=[]
        if p is not None:component.append(p)
    # Width transitions share the smaller end width at adjoining sections.
    widths={}
    for p in pieces:
        for s in [p['a'],p['b']]:
            key=(p['run'],round(s['along'],6));w=math.dist(s['inner'],s['outer']);widths[key]=min(widths.get(key,2),w)
    for p in pieces:
        for s in [p['a'],p['b']]:
            w=widths[(p['run'],round(s['along'],6))];s['outer']=[s['inner'][0]+s['normal'][0]*w,s['inner'][1]+s['normal'][1]*w]
        run=runs[p['run']];strip=buffer_poly(p,rmap)
        p['buffer']=run['buffer']>0 and not len(obstacle_tree.query(strip,predicate='intersects')) and not any(strip.intersection(road_shapes[int(i)]).area>1e-7 for i in road_tree.query(strip))
    slab_shapes=[poly(p) for p in pieces];slab_tree=STRtree(slab_shapes);furniture=[];used=set()
    for p in pieces:
        if p['run'] not in ['mabou-village','harbour-corner','harbour-west','porthood-main']:continue
        for kind,spacing,half,depth in [('lamp',42,.35,.35),('bench',160,1.,.45)]:
            key=(p['run'],kind,int(p['a']['along']/spacing))
            if key in used or p['a']['along']<12:continue
            s=p['a'];nx,ny=s['normal'];x,y=s['outer'][0]+nx*.75,s['outer'][1]+ny*.75
            coords=[[x+ny*u+nx*v,y-nx*u+ny*v] for u,v in [(-half,-depth),(half,-depth),(half,depth),(-half,depth)]];shape=Polygon(coords)
            if len(obstacle_tree.query(shape,predicate='intersects')) or len(slab_tree.query(shape,predicate='intersects')):continue
            if any(shape.distance(road_shapes[int(i)])<.5 for i in road_tree.query(shape.buffer(.5))):continue
            if any(shape.intersects(Polygon(f['polygon'])) for f in furniture):continue
            furniture.append({'run':p['run'],'kind':kind,'point':[x,y],'normal':[nx,ny],'polygon':coords});used.add(key)
    lengths={r:sum(p['b']['along']-p['a']['along'] for p in pieces if p['run']==r) for r in runs}
    return {'pieces':pieces,'furniture':furniture,'poleMoves':moves,'narrowed':narrowed,'crossings':crossings,'skipped':skipped,'lengths':lengths}

# Raster pixels store a conservative integer lower distance to the cleared footprint.
# Geometry tests happen here once, never in vegetationAt or a terrain frame.
def encode_runs(values,default=None):
    out=[];start=0
    while start<len(values):
        v=int(values[start]);end=start+1
        while end<len(values) and values[end]==v:end+=1
        if default is None:out.extend([v,end-start])
        elif v!=default:out.extend([start,end-start,v])
        start=end
    return out

def make_masks(plans,roads,manifest):
    footprints=[]
    for plan in plans:
        for p in plan['pieces']:
            # Include the mown buffer and the half metre beyond the back edge.
            q=buffer_poly(p,roads) if p['buffer'] else poly(p)
            footprints.append(unary_union([q,poly(p)]).buffer(.5))
        footprints.extend(Polygon(f['polygon']).buffer(.2) for f in plan['furniture'])
    whole=unary_union(footprints);minx,miny,maxx,maxy=whole.bounds
    e0,n0=math.floor(minx)-23,math.floor(miny)-23;w,h=math.ceil(maxx)-e0+24,math.ceil(maxy)-n0+24
    image=Image.new('L',(w,h),255);draw=ImageDraw.Draw(image)
    for footprint in footprints:
        for p in parts(footprint.buffer(.8)):
            draw.polygon([(x-e0,y-n0) for x,y in p.exterior.coords],fill=0)
    field=np.array(image);queue=deque((int(y),int(x)) for y,x in np.argwhere(field==0))
    while queue:
        y,x=queue.popleft();d=int(field[y,x])+1
        if d>21:continue
        for dy,dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            yy,xx=y+dy,x+dx
            if 0<=yy<h and 0<=xx<w and field[yy,xx]>d:field[yy,xx]=d;queue.append((yy,xx))
    tiles=[]
    for ni in range(math.floor(n0/256),math.floor((n0+h-1)/256)+1):
        for ei in range(math.floor(e0/256),math.floor((e0+w-1)/256)+1):
            xa,ya=max(e0,ei*256),max(n0,ni*256);xb,yb=min(e0+w,(ei+1)*256),min(n0+h,(ni+1)*256)
            patch=field[ya-n0:yb-n0,xa-e0:xb-e0]
            if not np.any(patch<255):continue
            tiles.append([ei,ni,xa-ei*256,ya-ni*256,xb-xa,yb-ya,encode_runs(patch.ravel(),255)])
    def query_grid(es,ns):
        xs=np.floor(es-e0).astype(int);ys=np.floor(ns-n0).astype(int);valid=(xs>=0)&(xs<w)&(ys>=0)&(ys<h)
        values=np.zeros(xs.shape,dtype=np.uint8);values[valid]=(field[ys[valid],xs[valid]]==0);return values
    height_shapes=[[unary_union([poly(p),buffer_poly(p,roads)]).buffer(.001) if p['buffer'] else poly(p).buffer(.001) for p in plan['pieces']] for plan in plans]
    output={};origin=manifest['origin'];size=manifest['size'];v=manifest['village']
    for level in range(9):
        tile_size=size/2**level
        i0=math.floor((minx-origin[0])/tile_size);i1=math.floor((maxx-origin[0])/tile_size)
        j0=math.floor((origin[1]-maxy)/tile_size);j1=math.floor((origin[1]-miny)/tile_size)
        exists=set(manifest['levels'].get(str(level),[]))
        for j in range(j0,j1+1):
            for i in range(i0,i1+1):
                if f'{i}_{j}' not in exists:continue
                left,top=origin[0]+i*tile_size,origin[1]-j*tile_size
                e,n=np.meshgrid(left+np.arange(257)*tile_size/256,top-np.arange(257)*tile_size/256)
                pixel_mask=query_grid(e,n);indices=np.flatnonzero(pixel_mask.ravel())
                memberships=[];height_memberships=[]
                for quality,plan in enumerate(plans):
                    cell=box(left,top-tile_size,left+tile_size,top)
                    ids=[k for k,p in enumerate(plan['pieces']) if poly(p).intersects(cell)] if level>=6 else []
                    fs=[k for k,f in enumerate(plan['furniture']) if cell.covers(Point(f['point']))] if level>=6 else []
                    memberships.append([ids,fs])
                    hs=[k for k,shape in enumerate(height_shapes[quality]) if shape.intersects(cell)]
                    hf=[k for k,f in enumerate(plan['furniture']) if cell.intersects(Point(f['point']).buffer(.001))]
                    height_memberships.append([hs,hf])
                if not len(indices) and not any(ids or fs for ids,fs in height_memberships):continue
                output[f'{level}/{i}_{j}']={'pixels':encode_runs(pixel_mask.ravel(),0),'members':memberships,'heightMembers':height_memberships}
    return {'tiles':tiles,'terrain':output}

def compact(plan,roads,run_indices):
    # Repeated road polylines and object keys do not belong in the startup payload.
    pieces=[]
    for p in plan['pieces']:
        row=[run_indices[p['run']],1 if p['material']=='concrete' else 0,1 if p['buffer'] else 0]
        for s in [p['a'],p['b']]:row.extend([s['road'],*s['centre'],*s['normal'],*s['inner'],*s['outer'],s['lift'],s['along']])
        pieces.append(row)
    return {**plan,'pieces':pieces}

def fingerprints(sources=(),work_root=None):
    files=list(sources)+['web/src/terrain.ts','web/src/sidewalks-data.json','web/src/sidewalk-layout.ts','tools/sidewalks-inputs.mjs','tools/sidewalks_bake.py','tools/sidewalks-compile.mjs','tools/sidewalks-low-bake.mjs','web/src/sidewalks.ts','web/src/sidewalks-cache.ts','web/src/sidewalks-assets.ts','web/src/store.ts','web/src/sidewalks-worker.ts','web/src/sidewalks-heights.ts']
    files += [f'web/src/{s}-site.ts' for s in ['yard','home','church','porch','fishing','coast','quarry','mine']]
    for base in ['terrain','areas/porthood','areas/pointtupper']:
        files += [f'data/baked/{base}/{s}.json' for s in ['manifest','roads','props','buildings']]
    return {p:hashlib.sha256(((work_root/p) if work_root and p=='web/src/sidewalks-assets.ts' and (work_root/p).exists() else ROOT/p).read_bytes()).hexdigest() for p in files}

def bake():
    global ALL_RUNS
    data=load_inputs();ALL_RUNS=data['runs'];result={'version':2,'inputs':fingerprints(data['sources']),'areas':{}}
    run_indices={r['id']:i for i,r in enumerate(ALL_RUNS)}
    for area,inputs in data['areas'].items():
        plans=[build_plan(area,inputs,low) for low in [False,True]];roads={r['id']:r for r in inputs['roads']}
        masks=make_masks(plans,roads,inputs['manifest'])
        result['areas'][area]={'id':area,'roads':[[r['id'],r['name'],r['kind'],r['halfWidth'],r['bridge']] for r in inputs['roads'] if any(p['a']['road']==r['id'] or p['b']['road']==r['id'] for p in plans[0]['pieces'])],
            'plans':[compact(p,roads,run_indices) for p in plans],**masks}
        print(area,[(len(p['pieces']),len(p['poleMoves']),len(p['narrowed'])) for p in plans],file=__import__('sys').stderr)
    return result

# The 18 Nov Mabou bake (tools/mabou-dashcam-18nov) leaves every sidewalk output byte for byte the same: re-baked on its
# promoted land on 19 Nov (houses), and again with its two driveways, only these input digests moved. So a land file at
# exactly that receipt's after bytes stands for the bytes it replaced, and its manifest (only the counts the receipt owns
# change) for the same manifest with those counts set back.
NOV18=ROOT/'tools/mabou-dashcam-18nov/hashes.json'
NOV19=ROOT/'tools/mabou-wharf/roads.json'

def nov18_stands_for(file,digest,cached,root=ROOT,report=None):
    reports = [report] if report else [json.loads(p.read_text()) for p in (NOV19, NOV18) if p.exists()]
    for current in reports:
        for f in current['files']:
            if file == 'data/baked/' + f['file'] and digest == f['sha256']:
                digest = f['before']
                if digest == cached:
                    return True
        for m in current['manifests']:
            if file != f"data/baked/{m['folder']}/manifest.json" or m['before'] == m['after']:
                continue
            manifest = json.loads((root/file).read_bytes())
            if any(manifest[k]['count'] != v['count'] for k,v in m['after'].items()):
                return False
            for k,v in m['before'].items():
                manifest[k]['count'] = v['count']
            return hashlib.sha256((json.dumps(manifest,separators=(',',':'),allow_nan=False)+'\n').encode()).hexdigest() == cached
    return False

def nov18_cases():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp);(root/'data/baked/terrain').mkdir(parents=True)
        compact=lambda d:(json.dumps(d,separators=(',',':'))+'\n').encode();sha=lambda b:hashlib.sha256(b).hexdigest()
        before=compact({'buildings':{'count':1},'other':'x'});after=compact({'buildings':{'count':2},'other':'x'})
        report={'files':[{'file':'terrain/roads.json','before':'b'*64,'sha256':'a'*64}],'manifests':[{'folder':'terrain','before':{'buildings':{'count':1}},'after':{'buildings':{'count':2}}}]}
        name='data/baked/terrain/manifest.json'
        (root/name).write_bytes(after);assert nov18_stands_for(name,sha(after),sha(before),root,report),'manifest at the receipt counts'
        (root/name).write_bytes(compact({'buildings':{'count':2},'other':'y'}));assert not nov18_stands_for(name,'',sha(before),root,report),'another manifest key changed'
        (root/name).write_bytes(compact({'buildings':{'count':3},'other':'x'}));assert not nov18_stands_for(name,'',sha(before),root,report),'unknown counts'
        assert nov18_stands_for('data/baked/terrain/roads.json','a'*64,'b'*64,root,report),'roads at the receipt'
        assert not nov18_stands_for('data/baked/terrain/roads.json','c'*64,'b'*64,root,report),'unknown roads'
        assert not nov18_stands_for('data/baked/terrain/roads.json','a'*64,'c'*64,root,report),'a plan made on other land'
        assert not nov18_stands_for('web/src/terrain.ts','a'*64,'b'*64,root,report),'source files never map'
    print('PASS 18 Nov receipt stands for its before land: receipt files and counts only; other keys, unknown bytes and other land refused')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');parser.add_argument('--check-cases',action='store_true');parser.add_argument('--work-root',type=Path);args=parser.parse_args()
    if args.check_cases:
        # Land before the delta, after it, a partial install and a changed companion, in scratch roots.
        import shutil,sys,tempfile
        nov18_cases()
        plan=json.loads((ROOT/'web/src/sidewalks-plan.json').read_text());land=[f for f in plan['outputs'] if f.startswith('data/baked/')]
        source=Path(args.work_root).absolute() if args.work_root else ROOT
        have=all((source/f).exists() for f in land)
        def case(name,files,mutate=None,ok=True):
            with tempfile.TemporaryDirectory() as tmp:
                t=Path(tmp)
                for f in ['web/src/sidewalks-plan.json','web/src/sidewalks-assets.ts',*[f for f in plan['outputs'] if f.startswith('web/src/sidewalks-p')]]:
                    (t/f).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/f,t/f)
                for f in files:(t/f).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/f,t/f)
                if mutate:mutate(t)
                r=subprocess.run([sys.executable,__file__,'--check','--work-root',str(t)],cwd=ROOT,capture_output=True,text=True)
                assert (r.returncode==0)==ok,f'{name}: exit {r.returncode} {r.stdout}{r.stderr}'
                print(('ACCEPTED ' if ok else 'REJECTED ')+name)
        case('land before the data delta',[])
        if not have:print('NOT RUN after/partial/changed cases: the six companions are not installed here (pass --work-root of a bake)');raise SystemExit(0)
        case('land after the data delta',land)
        case('partial install (five of six)',land[:-1],ok=False)
        case('changed companion byte',land,lambda t:(t/land[0]).write_bytes((t/land[0]).read_bytes()[:-1]+b' '),ok=False)
        print('PASS sidewalk cache accepts land before or after the six-file delta, never a mix');raise SystemExit(0)
    work_root=args.work_root.absolute() if args.work_root else ROOT
    OUTPUT=work_root/'web/src/sidewalks-plan.json'
    if args.check:
        cached=json.loads(OUTPUT.read_text());current=fingerprints(load_inputs()['sources'],work_root)
        for file,digest in current.items():
            if cached['inputs'].get(file)!=digest and not nov18_stands_for(file,digest,cached['inputs'].get(file)):raise SystemExit(f'Stale sidewalk bake: {file}; run python3 tools/sidewalks_bake.py')
        outputs=cached.get('outputs',{});land=[f for f in outputs if f.startswith('data/baked/')]
        # The six companions arrive as a separate data install: all absent (before) or all present (after), never a mix.
        present=[f for f in land if (work_root/f).exists()]
        if present and len(present)!=len(land):raise SystemExit(f'Partial sidewalk data install: {len(present)} of {len(land)} companions present')
        for file,digest in outputs.items():
            if file in land and not present:continue
            if hashlib.sha256((work_root/file).read_bytes()).hexdigest()!=digest:raise SystemExit(f'Changed generated sidewalk data: {file}; regenerate the bake')
        print('PASS sidewalk bake input and generated-data fingerprints;',f'all {len(land)} installed companions match' if present else f'{len(land)} companions not installed yet (land before the data delta)')
    else:
        if not args.work_root or work_root.resolve()==ROOT.resolve():raise SystemExit('Use an isolated --work-root; installation requires a separate data go')
        subprocess.run(['node','tools/sidewalks-low-bake.mjs','--assert-work-root',str(work_root)],cwd=ROOT,check=True)
        result=bake()
        OUTPUT.parent.mkdir(parents=True,exist_ok=True)
        for area,values in result['areas'].items():
            dest=OUTPUT.with_name(f'sidewalks-plan-{area}.json');dest.write_text(json.dumps(values,separators=(',',':'))+'\n');print(dest.name,dest.stat().st_size)
        subprocess.run(['node','tools/sidewalks-compile.mjs','--work-root',str(work_root)],cwd=ROOT,check=True)
        result['inputs']=fingerprints(result['inputs'].keys(),work_root)
        generated=[OUTPUT.with_name(f'{stem}{area}.json') for area in result['areas'] for stem in ['sidewalks-plan-','sidewalks-packed-']]
        generated+=[work_root/'web/src/sidewalks-assets.ts']
        generated+=[work_root/'data/baked'/('terrain' if area=='mabou' else f'areas/{area}')/f'sidewalks-{quality}.json' for area in result['areas'] for quality in ['desktop','low']]
        outputs={str(p.relative_to(work_root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in generated}
        OUTPUT.write_text(json.dumps({'version':result['version'],'inputs':result['inputs'],'outputs':outputs},separators=(',',':'))+'\n')
