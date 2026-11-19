"""Bounded corrections from dash-cam observations. No imagery or network access."""
import copy
import json
import math
from pathlib import Path

INPUT = json.loads(Path(__file__).with_name('dashcam_20261116.json').read_text())


NOV18 = json.loads(Path(__file__).with_name('dashcam_20261118.json').read_text())


def project(roads, point, name=None):
    hits = []
    for road in roads:
        if name is not None and (road['name'] != name or road['bridge']):
            continue
        along = 0
        for a, b in zip(road['pts'], road['pts'][1:]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            length = math.hypot(dx, dy)
            if not length:
                continue
            t = max(0, min(1, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length**2))
            hits.append((math.dist(point, (a[0]+t*dx, a[1]+t*dy)), road['id'], along+t*length))
            along += length
    gap, rid, station = min(hits)
    return gap, rid, station


def nearest(roads, point, name):
    gap, rid, station = project(roads, point, name)
    if gap > 15:
        raise ValueError(f'Correction is not on {name}: {gap:.1f} m')
    return rid, station


def correct_roads(roads, area, guardrails=True):
    """Split at existing vertices; keep all geometry and unrelated IDs. Idempotent."""
    roads = copy.deepcopy(roads)
    next_id = max(r['id'] for r in roads)+1
    for rule in INPUT['roads'].get(area, []):
        key = '16nov:'+rule['name']
        if any(r.get('correction') == key for r in roads):
            continue
        choices = [r for r in roads if r['name'] == rule['name'] and not r['bridge'] and
                   math.dist(r['pts'][0], rule['mouth']) < 5]
        if len(choices) != 1:
            raise ValueError(f'Expected one mouth for {rule["name"]}')
        road = choices[0]
        if road['kind'] != 3:
            raise ValueError('Expected gravel before correction')
        end = min(range(len(road['pts'])), key=lambda i: math.dist(road['pts'][i], rule['cut']))
        start = min(range(len(road['pts'])), key=lambda i: math.dist(road['pts'][i], rule['start'])) if 'start' in rule else 0
        if (not 0 <= start < end < len(road['pts'])-1 or math.dist(road['pts'][end], rule['cut']) > 5 or
                ('start' in rule and math.dist(road['pts'][start], rule['start']) > 5)):
            raise ValueError('Unexpected correction bounds')
        cuts = sorted(set([0, start, end, len(road['pts'])-1]))
        for index, (a, b) in enumerate(zip(cuts, cuts[1:])):
            part = copy.deepcopy(road)
            part['pts'] = road['pts'][a:b+1]
            part['correction'] = key
            if a == start:
                for field in ('kind', 'washboard'):
                    if field in rule:
                        part[field] = rule[field]
            if index == 0:
                replacement = part
            else:
                part['id'] = next_id
                next_id += 1
                roads.append(part)
        roads[roads.index(road)] = replacement
    if area == 'mabou':
        # Only the driven, public lower stretch. The remote track retains its source class.
        for road in roads:
            if road['name'] == 'MacKillop Road' and road['kind'] == 3:
                road['halfWidth'] = 2.25
    if guardrails:
        attach_guardrails(roads,area)
    return roads


def correct_nov18_roads(roads, area):
    """Keep the original centreline and tie order while splitting at the track junction."""
    if area != 'mabou':
        return roads
    rule = NOV18['harbour']
    key = '18nov:' + rule['name']
    if any(r.get('correction') == key for r in roads):
        return roads
    mouths = [(i, r) for i, r in enumerate(roads)
              if r['name'] == rule['name'] and r['kind'] == 3 and not r['bridge']
              and math.dist(r['pts'][0], rule['mouth']) <= 5]
    lanes = [(i, r) for i, r in enumerate(roads)
             if r['name'] == NOV18['lane'] and r['kind'] == 4 and not r['bridge']]
    if len(mouths) != 1 or len(lanes) != 1:
        raise ValueError('Expected one Harbour Road gravel mouth and one Weaver Lane track')
    index, harbour = mouths[0]
    lane_index, lane = lanes[0]
    pts = harbour['pts']
    cut = min(range(len(pts)), key=lambda i: math.dist(pts[i], rule['cut']))
    if cut in (0, len(pts)-1) or math.dist(pts[cut], rule['cut']) > 5:
        raise ValueError('Harbour Road cut must be at the track junction')
    result = list(roads)
    result[lane_index] = dict(lane, kind=2, pavement='worn')
    # Keep the gravel ID on the western remainder. Insert its paved prefix in
    # place so raster ties at junctions still favour the original centreline.
    next_id = max(r['id'] for r in roads) + 1
    result[index:index+1] = [
        dict(harbour, id=next_id, kind=2, halfWidth=3.0, pts=pts[:cut+1], pavement='double-yellow', correction=key),
        dict(harbour, pts=pts[cut:], correction=key),
    ]
    return result


def hand_building_specs():
    for observations in (INPUT, NOV18):
        for building in observations['buildings']:
            yield building, observations['provenance']


def attach_guardrails(roads, area):
    """Project observed run bounds onto the FINAL line, after any optional bed move. Metadata only."""
    if area != 'mabou':
        return roads
    rail = INPUT['guardrail']
    rid, s = nearest(roads, rail['point'], rail['name'])
    road = next(r for r in roads if r['id'] == rid)
    road['guardrailRuns'] = [dict(start=round(s-rail['halfLength'], 2), end=round(s+rail['halfLength'], 2),
                                 side=rail['side'], posts=rail['posts'])]
    return roads


def measured_root_id_limit(buildings):
    """Hand IDs have a separate range; they never raise the generated-wing ID floor."""
    return max((b['id'] for b in buildings if b.get('source') != 'hand' and b.get('buildingId',b['id']) == b['id']),default=0)


def hand_buildings(kept, area, ground, roads=None, observations=INPUT):
    """Generic gable boxes; source terrain gives ground only, never invented roof measurements."""
    if area != 'mabou':
        return kept
    ids = {b['id'] for b in kept}
    result = list(kept)
    for source in observations['buildings']:
        if source['id'] in ids:
            old = next(b for b in kept if b['id'] == source['id'])
            if old.get('source') != 'hand' or old.get('provenance') != observations['provenance']:
                raise ValueError('Hand-building ID collision')
            continue
        x, y, length, width = (source[k] for k in ('x', 'y', 'length', 'width'))
        if any(math.hypot(b['x']-x, b['y']-y) < (math.hypot(b['length'], b['width'])+math.hypot(length, width))/2+2 for b in result):
            raise ValueError('Hand building overlaps existing building; reconcile input first')
        a = math.radians(source['axisDeg'])
        u, v = (math.sin(a), math.cos(a)), (-math.cos(a), math.sin(a))
        footprint = [[round(x+u[0]*s*length/2+v[0]*t*width/2, 2),
                      round(y+u[1]*s*length/2+v[1]*t*width/2, 2)] for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        h = float(ground(x,y))
        if not math.isfinite(h) or h < -100:
            raise ValueError('Missing source ground for hand building')
        gap, rid = None, None
        if roads and observations is INPUT:
            gap, rid, _ = project(roads, (x,y), 'Southwest Ridge Road')
            half = next(r['halfWidth'] for r in roads if r['id'] == rid)
            if any(project(roads, p, 'Southwest Ridge Road')[0] <= half+2 for p in footprint):
                raise ValueError('Hand-building footprint is too close to road')
        elif roads:
            # These properties are well back from the mapped network. Include room
            # for the deck/overhang and check tracks as well as public roads.
            clearance = project(roads, (x,y))[0]
            if clearance <= math.hypot(length, width)/2 + max(r['halfWidth'] for r in roads) + 3:
                raise ValueError('Hand-building footprint is too close to road')
        result.append(dict(**{k:source[k] for k in ('id','x','y','length','width','axisDeg','eave','ridge','kind')},
                           ground=round(h,2), footprint=footprint, roof=source.get('roof', 'gable'), source='hand', confidence=.4,
                           provenance=observations['provenance'], nearRoad=rid, roadDist=round(gap,2) if gap is not None else None))
    return sorted(result, key=lambda b:b['id'])


def hand_styles(data, buildings, roads=(), observations=INPUT):
    paints = {'cream':'#e1d8be', 'pale yellow':'#e6d9a6', 'dark red':'#7b3937', 'weathered grey':'#85857a', 'grey':'#858b8d', 'pale grey':'#aeb3b7'}
    present = {b['id']:b for b in buildings if b.get('source') == 'hand'}
    for b in observations['buildings']:
        if b['id'] in present:
            data['styles'][str(b['id'])] = dict(wall=paints[b['wall']], wallName=b['wall'], roof='#515657',
                roofName='dark grey', trim='#dedfd8', roofMaterial='shingle', entrance='none', chimney=False,
                dormer=False, shutters=False, satelliteDish=False, skirting=False, silo=False)
            data['styles'][str(b['id'])].update(b.get('style', {}))
            if b['kind'] == 'house' and roads and observations is INPUT:
                actual = present[b['id']]
                gap, rid, station = project(roads,(actual['x'],actual['y']),'Southwest Ridge Road')
                road = next(r for r in roads if r['id']==rid)
                x,y = road['pts'][-1]
                for a,c in zip(road['pts'],road['pts'][1:]):
                    length = math.dist(a,c)
                    if station <= length:
                        t = station/length if length else 0
                        x,y = a[0]+t*(c[0]-a[0]), a[1]+t*(c[1]-a[1])
                        break
                    station -= length
                angle = math.radians(actual['axisDeg'])
                dx,dy = x-actual['x'],y-actual['y']
                u,v = dx*math.sin(angle)+dy*math.cos(angle),dx*math.cos(angle)-dy*math.sin(angle)
                end = abs(u)/actual['length'] > abs(v)/actual['width']
                data['styles'][str(b['id'])]['front'] = dict(end=end,side=1 if (u if end else v)>=0 else -1)
    return data


def remap_road_references(data, kind, roads):
    """Follow only split descendants of the referenced road; preserve all positions."""
    result = copy.deepcopy(data)
    groups = {}
    for road in roads:
        if road.get('correction'):
            groups.setdefault(road['correction'], []).append(road)
    parts = {r['id']: group for group in groups.values() if len(group) > 1 for r in group}

    def moved(rid, point):
        candidates = parts.get(rid)
        if not candidates:
            return rid
        return project(candidates, point, candidates[0]['name'])[1]

    if kind == 'cemeteries':
        for c in result['cemeteries']:
            r = c['road']
            r['id'] = moved(r['id'], r['point'])
    elif kind == 'buildings':
        for b in result['buildings']:
            if b.get('nearRoad') is not None:
                b['nearRoad'] = moved(b['nearRoad'], (b['x'], b['y']))
    elif kind == 'streams':
        for c in result['culverts']:
            point = [(a+b)/2 for a,b in zip(c['a'], c['b'])]
            c['road'] = moved(c['road'], point)
    elif kind == 'props':
        moved_poles = {}
        for p in result['poles']:
            rid = p['road']
            p['road'] = moved(rid, (p['x'], p['y']))
            if p['road'] != rid:
                moved_poles[rid, p['n']] = p['road']
        for drop in result.get('serviceDrops', []):
            drop['road'] = moved_poles.get((drop['road'], drop['n']), drop['road'])
    else:
        raise ValueError('Unknown road-reference schema: '+kind)
    return result
