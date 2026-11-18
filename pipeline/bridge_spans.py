"""Recover source bridge spans independently of the 15 m ordinary-trail gap subtraction.

Original roads, points and ids stay unchanged. The additional bridgeSpans are consumed by the
runtime and the road field. Layer=1 alone is not evidence of a bridge: embankments also use it.
"""
import math
import json
from pathlib import Path
from osgeo import ogr


def runtime_crossings(area):
    """The reviewed runtime inventory is also a bridge keep list for older roads.json inputs."""
    path=Path(__file__).absolute().parent.parent/'web/src/bridge-crossings.json'
    return [r for r in json.loads(path.read_text()) if r['area']==area]


def inferred_bridge_spans(area):
    return [dict(r,id=-2000000-i,bridge=True,washboard=False) for i,r in enumerate(runtime_crossings(area)) if r['inferred']]


def bridge_keep_boxes(spans):
    """Keep water/terrain under deck spans unchanged; the road-ground module itself stays untouched."""
    boxes=[]
    for span in spans:
        width=span['halfWidth']+2
        boxes.append((min(p[0]for p in span['pts'])-width,min(p[1]for p in span['pts'])-width,
                      max(p[0]for p in span['pts'])+width,max(p[1]for p in span['pts'])+width))
    return boxes


def source_bridges(elements, transform):
    seen = set()
    for element in elements:
        tags = element.get('tags', {})
        key = (element.get('type'), element.get('id'))
        if key in seen or not element.get('geometry'):
            continue
        seen.add(key)
        if tags.get('bridge') in (None, 'no') and tags.get('man_made') != 'bridge':
            continue
        pts = [transform(p['lon'], p['lat'])[:2] for p in element['geometry']]
        if len(pts) < 2:
            continue
        area = tags.get('man_made') == 'bridge' and pts[0] == pts[-1]
        line = ogr.Geometry(ogr.wkbLinearRing if area else ogr.wkbLineString)
        for x, y in pts:
            line.AddPoint_2D(x, y)
        if area:
            geometry = ogr.Geometry(ogr.wkbPolygon)
            geometry.AddGeometry(line)
        else:
            geometry = line
        yield {'source': f"osm/{key[0]}/{key[1]}", 'tags': tags, 'geometry': geometry, 'pts': pts, 'area': area}


def projection(pts, point):
    walked = 0.0
    best = (math.inf, 0.0, pts[0])
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        t = max(0.0, min(1.0, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(length*length or 1)))
        q = (a[0]+dx*t, a[1]+dy*t)
        d = math.dist(point, q)
        if d < best[0]:
            best = (d, walked+length*t, q)
        walked += length
    return best


def substring(pts, start, end):
    out, walked = [], 0.0
    for a, b in zip(pts, pts[1:]):
        length = math.dist(a, b)
        if length > 0 and walked <= end and walked+length >= start:
            for s in (max(start, walked), min(end, walked+length)):
                t = (s-walked)/length
                q = [round(a[0]+(b[0]-a[0])*t, 3), round(a[1]+(b[1]-a[1])*t, 3)]
                if not out or q != out[-1]:
                    out.append(q)
        walked += length
    return out


def recover_bridge_spans(roads, features, tolerance=12.0):
    """Match an elevated way/area onto the final smoothed centreline, never onto a crossing road."""
    geometries = []
    for road in roads:
        g = ogr.Geometry(ogr.wkbLineString)
        for x, y in road['pts']:
            g.AddPoint_2D(x, y)
        geometries.append(g)
    windows, orphaned = {}, []
    for feature in features:
        geometry, tags = feature['geometry'], feature['tags']
        rail = bool(tags.get('railway') or tags.get('abandoned:railway'))
        motor = tags.get('highway') in ('motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','service')
        path = tags.get('highway') in ('path', 'footway', 'cycleway', 'bridleway')
        matched, matches = False, []
        for index, (road, line) in enumerate(zip(roads, geometries)):
            if road['bridge'] or rail and road['kind'] != 5 and road['name'] != 'Railroad':
                continue
            if motor and (road['kind']==5 or road['name']=='Railroad'):
                continue
            if path and not rail and road['kind'] < 4:
                continue
            if line.Distance(geometry) > tolerance:
                continue
            intervals, distance = [], 0.0
            if feature['area']:
                part = line.Intersection(geometry)
                stack = [part]
                while stack:
                    g = stack.pop()
                    if g.IsEmpty():
                        continue
                    if g.GetGeometryName() == 'LINESTRING' and g.GetPointCount() >= 2:
                        a, b = projection(road['pts'], g.GetPoint_2D(0)), projection(road['pts'], g.GetPoint_2D(g.GetPointCount()-1))
                        intervals.append(sorted((a[1], b[1])))
                    else:
                        stack.extend(g.GetGeometryRef(i).Clone() for i in range(g.GetGeometryCount()))
            else:
                a, b = projection(road['pts'], feature['pts'][0]), projection(road['pts'], feature['pts'][-1])
                source_length = sum(math.dist(p, q) for p, q in zip(feature['pts'], feature['pts'][1:]))
                # Both banks and a substantial longitudinal overlap are required. A perpendicular road is not a match.
                if max(a[0], b[0]) > tolerance or abs(b[1]-a[1]) < max(2, source_length*.65):
                    continue
                distance=max(a[0],b[0])
                candidate=ogr.Geometry(ogr.wkbLineString)
                for x,y in substring(road['pts'],min(a[1],b[1]),max(a[1],b[1])):candidate.AddPoint_2D(x,y)
                if candidate.Intersection(geometry.Buffer(distance+2)).Length()<candidate.Length()*.8:
                    continue
                intervals.append(sorted((a[1], b[1])))
            for a, b in intervals:
                if b-a >= 2:
                    matches.append((distance,index,a,b))
        if matches:
            best=min(m[0]for m in matches)
            for distance,index,a,b in matches:
                if distance<=best+2:
                    windows.setdefault(index, []).append((a,b,feature['source']));matched=True
        # A separately mapped bridge can also be the missing piece BETWEEN two trail records.
        if not matched and not feature['area'] and (rail or path):
            eligible = [r for r in roads if r['kind'] >= 4 or rail and r['name'] == 'Railroad']
            banks = [min(((projection(r['pts'], p), r) for r in eligible), key=lambda v:v[0][0], default=None)
                     for p in (feature['pts'][0], feature['pts'][-1])]
            if all(banks) and max(v[0][0] for v in banks) <= tolerance and banks[0][1]['id'] != banks[1][1]['id'] and not any(v[1]['bridge'] for v in banks):
                pts = [[round(x,3),round(y,3)] for x,y in feature['pts']]
                pts[0] = [round(v,3) for v in banks[0][0][2]];pts[-1] = [round(v,3) for v in banks[1][0][2]]
                r = banks[0][1]
                orphaned.append(dict(road=r['id'],name=tags.get('name') or r['name'],kind=r['kind'],halfWidth=r['halfWidth'],bridge=True,inferred=False,washboard=False,pts=pts,sources=[feature['source']]))
    spans = []
    for index, intervals in windows.items():
        road = roads[index]
        merged = []
        for a, b, source in sorted(intervals):
            if merged and a <= merged[-1][1]+.25:
                merged[-1][1] = max(b, merged[-1][1]); merged[-1][2].add(source)
            else:
                merged.append([a, b, {source}])
        for a, b, sources in merged:
            pts = substring(road['pts'], a, b)
            if len(pts) < 2:
                continue
            spans.append(dict(id=-1000000-len(spans), road=road['id'], name=road['name'], kind=road['kind'],
                              halfWidth=road['halfWidth'], bridge=True, inferred=False, washboard=False,
                              pts=pts, sources=sorted(sources)))
    for span in orphaned:
        span['id']=-1000000-len(spans);spans.append(span)
    return spans
