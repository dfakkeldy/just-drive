#!/usr/bin/env python3
"""Independent source-data oracles. No call to sidewalkObstacles or the layout's road predicates."""
import json, math, sys
from pathlib import Path
from shapely import Point, Polygon, LineString, STRtree, box, unary_union
import sidewalks_bake as recipe
ROOT=Path(__file__).absolute().parents[1]
COMPASS={'north-west':(-1,1),'north-east':(1,1),'south-west':(-1,-1),'west':(-1,0)}

def source(area):
    base=ROOT/'data/baked'/('terrain' if area=='mabou' else f'areas/{area}')
    return {name:json.loads((base/f'{name}.json').read_text()) for name in ['manifest','roads','buildings','props']}

def decode(area,low=False):
    data=json.loads((ROOT/f'web/src/sidewalks-plan-{area}.json').read_text());plan=dict(data['plans'][int(low)]);runs=json.loads((ROOT/'web/src/sidewalks-data.json').read_text())['runs']
    def section(row,o):return dict(road=row[o],centre=row[o+1:o+3],normal=row[o+3:o+5],inner=row[o+5:o+7],outer=row[o+7:o+9],lift=row[o+9],along=row[o+10])
    plan['pieces']=[dict(run=runs[r[0]]['id'],a=section(r,3),b=section(r,14),material='concrete' if r[1] else 'asphalt',buffer=bool(r[2])) for r in plan['pieces']]
    return plan

def slab(p):return Polygon([p['a']['inner'],p['b']['inner'],p['b']['outer'],p['a']['outer']])
def obstacles(raw,plan,reservations):
    result=[('building-'+str(i),Polygon(b['footprint'])) for i,b in enumerate(raw['buildings']['buildings'])]
    moves={p['index']:p for p in plan.get('poleMoves',[])}
    for kind,default in [('mailboxes',1.),('communityBoxes',None),('poles',.65),('lamps',.65),('benches',1.7)]:
        for i,p in enumerate(raw['props'].get(kind,[])):
            x,y=p['x'],p['y'];r=p.get('modules',4)*.65+.6 if default is None else default
            if kind=='poles' and i in moves:
                move=moves[i];assert math.dist(move['from'],[x,y])<1e-6,'relocation must reference the actual source pole';x,y=move['to']
            result.append((kind+'-'+str(i),box(x-r,y-r,x+r,y+r)))
    return result+[(p['id'],Polygon(p['polygon'])) for p in reservations]

def roads(raw):
    rs=raw['roads']['roads'];public=[LineString(r['pts']) for r in rs if r['kind'] in [1,2,3] and not r['bridge']];tree=STRtree(public)
    result=[]
    for r in rs:
        coords=list(r['pts'])
        if r['kind']==4:
            # Derive each connection from the source graph, not from cached crossing records.
            for end in [0,-1]:
                point=Point(coords[end]);line=public[int(tree.nearest(point))]
                if point.distance(line)<=12:
                    q=line.interpolate(line.project(point));coords=([(q.x,q.y)]+coords) if end==0 else (coords+[(q.x,q.y)])
        result.append((r,LineString(coords).buffer(r['halfWidth'],cap_style=2,join_style=1)))
    return result

def clearance(area,raw,plan,reservations):
    obs=obstacles(raw,plan,reservations);oshapes=[p[1] for p in obs];otree=STRtree(oshapes)
    surfaces=roads(raw);rshapes=[p[1] for p in surfaces];rtree=STRtree(rshapes);rmap={r['id']:r for r in raw['roads']['roads']}
    run_table={r['id']:r for r in json.loads((ROOT/'web/src/sidewalks-data.json').read_text())['runs']}
    for p in plan['pieces']:
        direction=COMPASS[run_table[p['run']]['side']]
        for section in [p['a'],p['b']]:assert sum((section['inner'][i]-section['centre'][i])*direction[i] for i in range(2))>0,'wrong compass side'
        shapes=[('slab',slab(p))]
        if p.get('buffer'):
            edges=[]
            for s in [p['a'],p['b']]:
                hw=rmap[s['road']]['halfWidth']+.025;edges.append([s['centre'][0]+s['normal'][0]*hw,s['centre'][1]+s['normal'][1]*hw])
            shapes.append(('strip',Polygon([*edges,p['b']['inner'],p['a']['inner']])))
        for kind,shape in shapes:
            for i in rtree.query(shape):
                area_overlap=shape.intersection(rshapes[int(i)]).area
                assert area_overlap<1e-6,f'{area} {p["run"]} {kind} overlaps source road {surfaces[int(i)][0]["id"]}: {area_overlap:.6f} m2'
            for i in otree.query(shape):assert shape.intersection(oshapes[int(i)]).area<1e-7,f'{p["run"]} {kind} overlaps source {obs[int(i)][0]}'
    for f in plan['furniture']:
        nx,ny=f['normal'];x,y=f['point'];half,depth=(.9,.35) if f['kind']=='bench' else (.25,.25)
        actual=Polygon([(x+ny*u+nx*v,y-nx*u+ny*v) for u,v in [(-half,-depth),(half,-depth),(half,depth),(-half,depth)]])
        for i in rtree.query(actual.buffer(.5)):assert actual.distance(rshapes[int(i)])>=.49999,f'{f["run"]} {f["kind"]} on source road {surfaces[int(i)][0]["id"]}'
    if area=='pointtupper':
        mac=next(shape for r,shape in surfaces if r['id']==132)
        for run in ['reeves-ne','reeves-sw']:
            banks=[s for p in plan['pieces'] if p['run']==run for s in [p['a'],p['b']] if s['lift']<1e-6 and LineString([s['inner'],s['outer']]).distance(mac)<.15]
            assert len(banks)>=2,'MacSween must end at each road edge, with both curbs dropped'
    assert not any(s['reason'].startswith('poles-') for s in plan['skipped']),'pole must not cut a hole'
    component=[]
    for p in plan['pieces']+[None]:
        if component and (p is None or p['run']!=component[-1]['run'] or abs(p['a']['along']-component[-1]['b']['along'])>.002):
            assert component[-1]['b']['along']-component[0]['a']['along']>=3.999,'isolated slab shorter than 4 m';component=[]
        if p is not None:component.append(p)
    for p in plan['pieces']:
        for s in [p['a'],p['b']]:assert math.dist(s['inner'],s['outer'])>=.99999,'narrow slab below one metre'
    return len(plan['pieces']),len(plan.get('poleMoves',[]))

def graph_sides(area,raw,plan,input):
    rs=raw['roads']['roads'];runs=json.loads((ROOT/'web/src/sidewalks-data.json').read_text())['runs'];checks={'farJunctions':0,'farDriveways':0,'ownJunctions':0,'ownDriveways':0}
    obs=unary_union([s for _,s in obstacles(raw,plan,input['reservations'])]);surfaces=roads(raw)
    for run in [r for r in runs if r['area']==area]:
        path=LineString([(p[0],p[1]) for p in input['routes'][run['id']]]);pieces=[p for p in plan['pieces'] if p['run']==run['id']];walk=unary_union([slab(p) for p in pieces])
        normal=COMPASS[run['side']]
        for other in rs:
            if other['name']==run['road'] or other['bridge'] or other['kind'] not in [1,2,3,4]:continue
            otherline=LineString(other['pts'])
            for end in [0,-1]:
                endpoint=Point(other['pts'][end]);q=path.interpolate(path.project(endpoint));limit=12 if other['kind']==4 else 2
                if endpoint.distance(q)>limit:continue
                inside=otherline.interpolate(min(10,otherline.length) if end==0 else max(0,otherline.length-10))
                # Find the local public-road tangent from graph points around the mouth.
                along=path.project(q);pa=path.interpolate(max(0,along-.5));pb=path.interpolate(min(path.length,along+.5));dx,dy=pb.x-pa.x,pb.y-pa.y;d=math.hypot(dx,dy) or 1;nx,ny=-dy/d,dx/d
                if nx*normal[0]+ny*normal[1]<0:nx,ny=-nx,-ny
                owner=min((r for r in rs if r['name']==run['road']),key=lambda r:LineString(r['pts']).distance(q))
                expected=Point(q.x+nx*(owner['halfWidth']+run['buffer']+.025+run['width']/2),q.y+ny*(owner['halfWidth']+run['buffer']+.025+run['width']/2))
                if expected.distance(path)>owner['halfWidth']+run['buffer']+run['width']+1:continue
                side=(inside.x-q.x)*nx+(inside.y-q.y)*ny
                key=('own' if side>0 else 'far')+('Driveways' if other['kind']==4 else 'Junctions')
                if side>0:checks[key]+=1;continue
                # Exclude independent real obstacles or another road at this exact spot.
                if obs.distance(expected)<.1 or any(r['name']!=run['road'] and r['id']!=other['id'] and shape.distance(expected)<2 for r,shape in surfaces):continue
                if expected.distance(Point(pieces[0]['a']['inner']))<3 or expected.distance(Point(pieces[-1]['b']['outer']))<3:continue
                checks[key]+=1
                assert walk.buffer(.06).covers(expected),f'far-side junction punched a gap: {run["id"]}/{other["id"]}'
                nearby=[s for p in pieces for s in [p['a'],p['b']] if math.dist(s['centre'],[q.x,q.y])<1.6]
                if run['curb']=='raised' and nearby:assert all(s['lift']>=.149 for s in nearby),f'far-side driveway dropped the curb: {run["id"]}/{other["id"]}'
    return checks

def fixtures():
    run={'id':'fixture','area':'mabou','road':'Test','side':'north-east','start':[624000,5103000],'end':[624050,5103000],'width':1.5,'buffer':0,'material':'concrete','curb':'raised','confidence':'high'}
    road={'id':1,'name':'Test','kind':2,'halfWidth':3,'bridge':False,'pts':[run['start'],run['end']]}
    def create(extra,obs=[]):
        data={'roads':[road,*extra],'obstacles':obs,'routes':{'fixture':[[*run['start'],1],[*run['end'],1]]}}
        original=recipe.ALL_RUNS;recipe.ALL_RUNS=[run]
        try:return recipe.build_plan('mabou',data)
        finally:recipe.ALL_RUNS=original
    branch=lambda kind,side:{'id':2,'name':'Branch' if kind==2 else None,'kind':kind,'halfWidth':2.5,'bridge':False,'pts':[[624025,5103000],[624025,5103000+side*20]]}
    for kind in [2,4]:
        far=create([branch(kind,-1)]);own=create([branch(kind,1)]);point=Point(624025,5103003.7)
        assert unary_union([slab(p) for p in far['pieces']]).covers(point),'far T must be continuous'
        assert not unary_union([slab(p) for p in own['pieces']]).covers(point),'joining side must stop'
        assert any(0<s['lift']<.15 for p in own['pieces'] for s in [p['a'],p['b']]),'joining side has a ramp'
    through={**branch(2,1),'pts':[[624025,5102980],[624025,5103020]]};assert not unary_union([slab(p) for p in create([through])['pieces']]).covers(Point(624025,5103003.7)),'through road must stop walk'
    building={'id':'building-0','polygon':[[624010,5103004.23],[624030,5103004.23],[624030,5103010],[624010,5103010]]}
    narrow=create([],[building]);assert narrow['lengths']['fixture']>49,'use the available 1.2 m instead of a building gap';assert narrow['narrowed'],'narrowing is used'
    pole={'id':'poles-0','polygon':[[624024.35,5103003.15],[624025.65,5103003.15],[624025.65,5103004.45],[624024.35,5103004.45]]}
    moved=create([],[pole]);assert moved['poleMoves'] and moved['lengths']['fixture']>49,'move pole without holes'
    return run,road,building,pole

if __name__=='__main__':
    data=recipe.load_inputs();recipe.ALL_RUNS=data['runs'];report={}
    for area,input in data['areas'].items():
        raw=source(area);report[area]=[]
        for low in [False,True]:
            plan=decode(area,low);counts=clearance(area,raw,plan,input['reservations']);sides=graph_sides(area,raw,plan,input);report[area].append({'low':low,'pieces':counts[0],'movedPoles':counts[1],**sides})
    fixture=fixtures();print('PASS independent source obstacles, every road kind, road-graph sides, pole continuity, narrowing and furniture',json.dumps(report))
    if '--legacy' in sys.argv:
        plans=json.load(sys.stdin);failures=[]
        for area,plan in plans.items():
            try:clearance(area,source(area),plan,data['areas'][area]['reservations']);graph_sides(area,source(area),plan,data['areas'][area])
            except AssertionError as e:failures.append(str(e))
        assert failures,'the pre-fix geometry must fail the new oracle';print('REJECTED pre-fix 2cd5725:',json.dumps(failures))
        old=plans['pointtupper'];mac=next(shape for road,shape in roads(source('pointtupper')) if road['id']==132)
        assert sum(slab(p).intersection(mac).area for p in old['pieces'] if p['run'].startswith('reeves-'))>1,'the old walk must reproduce MacSween overlap';print('REJECTED pre-fix MacSween through-road overlap')
        for area in plans:
            try:graph_sides(area,source(area),plans[area],data['areas'][area])
            except AssertionError as e:print('REJECTED pre-fix road-graph side:',str(e));break
        else:raise AssertionError('old side-blind gaps survived graph oracle')
        assert any(s['reason'].startswith('poles-') for s in plans['porthood']['skipped']);print('REJECTED pre-fix pole holes')
    if '--mutations' in sys.argv:
        for name,change in [('missing buildings',lambda d:d.update(obstacles=[o for o in d['obstacles'] if not o['id'].startswith('building-')])),('missing poles',lambda d:d.update(obstacles=[o for o in d['obstacles'] if not o['id'].startswith('poles-')]))]:
            import copy
            input=copy.deepcopy(data['areas']['mabou' if name=='missing buildings' else 'porthood']);change(input);area='mabou' if name=='missing buildings' else 'porthood';bad=recipe.build_plan(area,input)
            try:clearance(area,source(area),bad,data['areas'][area]['reservations'])
            except AssertionError as e:print('REJECTED',name,str(e))
            else:raise AssertionError('SURVIVED '+name)
        import copy
        bad=copy.deepcopy(decode('mabou'));f=bad['furniture'][0];f['point']=[f['point'][i]-f['normal'][i]*4 for i in range(2)]
        try:clearance('mabou',source('mabou'),bad,data['areas']['mabou']['reservations'])
        except AssertionError as e:print('REJECTED road-side furniture',str(e))
        else:raise AssertionError('SURVIVED furniture')
