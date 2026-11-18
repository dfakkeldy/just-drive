#!/usr/bin/env python3
"""Bake anonymous NSTDB cemetery outer rings in EPSG:2961. No burial or name data.

Run directly with MMM_AREA for each area. Only cemeteries.json and the one
manifest key are changed, both in the area's own baked folder, each by a
temporary file and a rename. Re-bake cemeteries after any bake that moves roads
or tracks in roads.json.
The script has no output option. A bake into the live folder needs the main
thread's go. For a trial, run it from a work root: a folder that links
pipeline/ and tools/ (tools/bake.sh keeps that root) and holds its own REAL
data/baked: a clone made with `cp -cR`, never a link to the live folder. A
link there makes the trial write into the live land.
"""
import argparse
import hashlib
import json
import math
import os
import stat
import tempfile

from osgeo import ogr, osr
from areas import current


def projection(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length2 = dx * dx + dy * dy
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) if length2 else 0
    return (a[0] + t * dx, a[1] + t * dy)


def canonical_ring(poly):
    pts = [tuple(round(v, 2) for v in p[:2]) for p in poly.GetGeometryRef(0).GetPoints()]
    pts = list(dict.fromkeys(pts))  # the closing point is restored after canonicalization
    signed = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
    if signed < 0:
        pts.reverse()
    k = min(range(len(pts)), key=pts.__getitem__)
    pts = pts[k:] + pts[:k]
    return pts + [pts[0]]


def nearest_road(ring, roads):
    best = None
    # The closest pair of disjoint line segments has an endpoint on at least one.
    # Also handle a crossing explicitly, so a road through a polygon is not missed.
    for road in roads:
        if road['kind'] not in (1, 2, 3):
            continue
        for a, b in zip(road['pts'], road['pts'][1:]):
            a, b = a[:2], b[:2]
            for c, d in zip(ring, ring[1:]):
                pairs = [(p, projection(p, c, d)) for p in (a, b)]
                pairs += [(projection(p, a, b), p) for p in (c, d)]
                ax, ay, cx, cy = b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]
                det = ax * cy - ay * cx
                if abs(det) > 1e-12:
                    qx, qy = c[0] - a[0], c[1] - a[1]
                    t, u = (qx * cy - qy * cx) / det, (qx * ay - qy * ax) / det
                    if 0 <= t <= 1 and 0 <= u <= 1:
                        p = (a[0] + t * ax, a[1] + t * ay)
                        pairs.append((p, p))
                for rp, gate in pairs:
                    dist = math.dist(rp, gate)
                    if best is None or dist < best[0]:
                        best = (dist, road, rp, gate)
    if best is None:
        raise ValueError('No drivable road in the baked area')
    return best


def geometry(kind, points):
    g = ogr.Geometry(kind)
    for p in points:
        g.AddPoint_2D(p[0], p[1])
    return g


def polygon(ring):
    p = ogr.Geometry(ogr.wkbPolygon)
    p.AddGeometry(geometry(ogr.wkbLinearRing, ring))
    return p


def parts(g, name):
    if g.IsEmpty():
        return []
    if g.GetGeometryName() == name:
        return [g.Clone()]
    return [part for child in g for part in parts(child, name)]


def union(items):
    collection = ogr.Geometry(ogr.wkbMultiPolygon)
    for item in items:
        for p in parts(item, 'POLYGON'):
            collection.AddGeometry(p)
    return collection.UnionCascaded() if collection.GetGeometryCount() else polygon([])


def coordinates(line):
    pts = []
    for p in line.GetPoints():
        q = [round(p[0], 2), round(p[1], 2)]
        if not pts or pts[-1] != q:
            pts.append(q)
    return pts


def footprint(poly):
    return {'outer': coordinates(poly.GetGeometryRef(0)),
            'holes': [coordinates(poly.GetGeometryRef(i)) for i in range(1, poly.GetGeometryCount())]}


def closest_on_lines(point, roads):
    return min(((math.dist(point, q), road, q, a, b)
                for road in roads for a, b in zip(road['pts'], road['pts'][1:])
                for q in [projection(point, a, b)]), key=lambda item: item[0])


def midpoint(line):
    pts, left = line.GetPoints(), line.Length() / 2
    for a, b in zip(pts, pts[1:]):
        length = math.dist(a[:2], b[:2])
        if left <= length:
            t = left / length if length else 0
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        left -= length
    return list(pts[-1][:2])


def merge_lines(g):
    lines = [list(p.GetPoints()) for p in parts(g, 'LINESTRING')]
    changed = True
    while changed:
        changed = False
        for i in range(len(lines)):
            for j in range(i + 1, len(lines)):
                a, b = lines[i], lines[j]
                for aa, bb in ((a,b),(a,list(reversed(b))),(list(reversed(a)),b),(list(reversed(a)),list(reversed(b)))):
                    if math.dist(aa[-1][:2], bb[0][:2]) < 1e-7:
                        lines[i] = aa + bb[1:]; lines.pop(j); changed = True; break
                if changed: break
            if changed: break
    return [geometry(ogr.wkbLineString, line) for line in lines]


WALL_THICKNESS = 0.3
MIN_PASSAGE = 3.5


def physical_width(gap):
    pts = coordinates(gap)
    return max(0.0, math.dist(pts[0], pts[-1]) - WALL_THICKNESS)


def opening_info(gap, track_roads, wall_point, cemetery):
    path = coordinates(gap)
    point = [(path[0][i] + path[-1][i]) / 2 for i in range(2)]
    is_gate = gap.Distance(geometry(ogr.wkbPoint, [wall_point])) < 0.05
    crossing = []
    for road in track_roads:
        hits = geometry(ogr.wkbLineString, road['pts']).Intersection(gap)
        points = [list(p.GetPoint()[:2]) for p in parts(hits, 'POINT')]
        points += [midpoint(line) for line in parts(hits, 'LINESTRING')]
        crossing.extend((math.dist(point, p), road, p) for p in points)
    track = None
    if crossing:
        _, track, point = min(crossing, key=lambda item: item[0])
        _, _, _, a, b = closest_on_lines(point, [track])
        heading = math.atan2(b[0] - a[0], b[1] - a[1])
        reach = max(4.0, min(12.0, gap.Length() / 2 + 2))
        local = geometry(ogr.wkbLineString, track['pts']).Intersection(geometry(ogr.wkbPoint, [point]).Buffer(reach, 16))
        lane = min(parts(local, 'LINESTRING'), key=lambda line: line.Distance(geometry(ogr.wkbPoint, [point])))
        radius, lane_half = track['halfWidth'] + 0.5, max(2.6, track['halfWidth'] + 1.5)
    else:
        toward = cemetery['road']['point'] if cemetery['road'] else None
        if not is_gate and track_roads:
            _, _, toward, _, _ = closest_on_lines(point, track_roads)
        # Cross the physical passage plane, rather than following an arbitrary
        # boundary midpoint. Its normal is oriented toward the approach road.
        dx, dy = path[-1][0] - path[0][0], path[-1][1] - path[0][1]
        length = math.hypot(dx, dy)
        east, north = (-dy / length, dx / length) if length else (math.sin(cemetery['gate']['heading']), math.cos(cemetery['gate']['heading']))
        if toward and east * (toward[0] - point[0]) + north * (toward[1] - point[1]) < 0:
            east, north = -east, -north
        heading = math.atan2(east, north)
        lane = geometry(ogr.wkbLineString, [[point[0] + east * t, point[1] + north * t] for t in (-1.4, 1.4)])
        radius, lane_half = 1.0, 2.6
    info = dict(point=point, heading=heading, laneHalfWidth=lane_half,
                width=round(physical_width(gap), 2), boundaryLength=round(gap.Length(), 2),
                kind='gate' if is_gate else 'track', path=path, lane=coordinates(lane), bodyRadius=radius)
    if track:
        info['track'] = track['id']
    return info, lane, radius


def cut_openings(loops, cuts, track_roads, wall_point, cemetery):
    """Grow cuts using clear chord width and swept bodies, never boundary arclength."""
    for attempt in range(24):
        remaining = ogr.Geometry(ogr.wkbMultiLineString)
        for loop in loops:
            for line in parts(loop.Difference(cuts), 'LINESTRING'):
                remaining.AddGeometry(line)
        if remaining.IsEmpty():
            return remaining, []
        additions, openings = [], []
        for loop in loops:
            for gap in merge_lines(loop.Intersection(cuts)):
                if gap.Length() < 0.02:
                    continue
                info, lane, radius = opening_info(gap, track_roads, wall_point, cemetery)
                openings.append(info)
                clear = physical_width(gap)
                if clear < MIN_PASSAGE + 0.02:
                    chord = clear + WALL_THICKNESS
                    grow = max(2.1, gap.Length() * 0.55 * (MIN_PASSAGE + WALL_THICKNESS + 0.04) / max(chord, 0.1))
                    additions.append(geometry(ogr.wkbPoint, [midpoint(gap)]).Buffer(grow, 16))
                if lane.Distance(remaining) < radius + WALL_THICKNESS / 2 + 0.02:
                    additions.append(lane.Buffer(radius + WALL_THICKNESS / 2 + 0.05, 16))
        if not additions:
            return remaining, openings
        cuts = union([cuts, *additions])
    raise RuntimeError(f"Opening cannot meet physical clearance: {cemetery['id']}")


def build_wall(cemetery, roads):
    """Roads win over 1:10,000 map boundaries. Bake the wall and the stone-centre regions.

    Wall centres clear public roads/trails by halfWidth + 1.8 m (the requested
    1.5 m plus room for rounding and the wall thickness). Tracks remove sections
    of the adjusted wall; their opening is at least 3.5 m, wider if road clearance
    requires it. Stone-centre regions include a conservative footprint margin.
    """
    shape = polygon(cemetery['ring'])
    xmin, xmax, ymin, ymax = shape.GetEnvelope()
    box = polygon([[xmin-40, ymin-40], [xmax+40, ymin-40], [xmax+40, ymax+40],
                   [xmin-40, ymax+40], [xmin-40, ymin-40]])
    near, public, tracks, stone_roads = [], [], [], []
    for road in roads:
        if road['kind'] not in (1, 2, 3, 4, 5):
            continue
        # Clip before buffering: a named road can extend for many kilometres.
        line = geometry(ogr.wkbLineString, road['pts'])
        if not line.Intersects(box):
            continue
        line = line.Intersection(box)
        near.append(road)
        radius = road['halfWidth'] + 1.8
        (tracks if road['kind'] == 4 else public).append(line.Buffer(radius, 12))
        stone_roads.append(line.Buffer(road['halfWidth'] + 1.5, 12))
    public_mask, track_mask = union(public), union(tracks)
    ground = shape.Difference(public_mask)
    keep = [p for p in parts(ground, 'POLYGON') if p.GetArea() >= 150 and p.Buffer(-3).GetArea() >= 24]
    cemetery['groundArea'] = round(sum(p.GetArea() for p in keep), 2)
    cemetery['wallAdjusted'] = shape.Difference(ground).GetArea() > 0.1 or (not track_mask.IsEmpty() and track_mask.Intersects(shape.Boundary()))
    cemetery['interior'] = [footprint(p) for p in keep]
    cemetery['wall'], cemetery['openings'], cemetery['stoneArea'] = [], [], []
    if not keep:
        cemetery['suppressed'] = 'small-or-sliver'
        return
    ground = union(keep)
    loops = [geometry(ogr.wkbLineString, coordinates(p.GetGeometryRef(i)))
             for p in keep for i in range(p.GetGeometryCount())]
    # Prefer an existing track crossing near the mapped approach as the main gate.
    track_roads = [r for r in near if r['kind'] == 4]
    crossings = []
    for road in track_roads:
        hits = geometry(ogr.wkbLineString, road['pts']).Intersection(shape.Boundary())
        crossings.extend((list(p.GetPoint()[:2]), road) for p in parts(hits, 'POINT'))
    if crossings:
        point, road = min(crossings, key=lambda pair: math.dist(pair[0], cemetery['gate']['point']))
        if math.dist(point, cemetery['gate']['point']) <= 20:
            cemetery['gate']['point'] = point
            cemetery['gate']['track'] = road['id']
            if cemetery['road']:
                rp = cemetery['road']['point']
                cemetery['gate']['heading'] = math.atan2(rp[0] - point[0], rp[1] - point[1])
    target = cemetery['gate']['point']
    wall_point = min((projection(target, a, b) for loop in loops
                      for a, b in zip(loop.GetPoints(), loop.GetPoints()[1:])),
                     key=lambda p: math.dist(target, p))
    gate_cut = geometry(ogr.wkbPoint, [wall_point]).Buffer(1.76, 16)
    cuts = union([track_mask, gate_cut])
    remaining, cemetery['openings'] = cut_openings(loops, cuts, track_roads, wall_point, cemetery)
    for line in parts(remaining, 'LINESTRING'):
        pts = coordinates(line)
        if len(pts) >= 2:
            if pts[0] == pts[-1]:
                k = len(pts) // 2
                cemetery['wall'].extend([pts[:k+1], pts[k:]])
            else:
                cemetery['wall'].append(pts)
    if not cemetery['wall']:
        cemetery['suppressed'] = 'no-wall-after-clearance'
        return
    stone_ground = ground.Buffer(-2.65).Difference(union(stone_roads))
    cemetery['stoneArea'] = [footprint(p) for p in parts(stone_ground, 'POLYGON') if p.GetArea() > 1]


def atomic_json(path, data):
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            os.fchmod(f.fileno(), stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
            json.dump(data, f, separators=(',', ':')); f.write('\n')
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.parse_args()                 # no options: an old command with --out stops here, before any write
    ogr.UseExceptions(); osr.UseExceptions()
    area = current()
    paths = sorted((area.raw / 'vectors').glob('BASE_NSTDB_10k_Designated_Areas_WM84__*.geojson'))
    if not paths:
        raise FileNotFoundError('Fetch the Designated Areas theme first')
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326); dst.ImportFromEPSG(2961)
    for srs in (src, dst):
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr = osr.CoordinateTransformation(src, dst)
    x0, y0, x1, y1 = area.mid
    clip = ogr.CreateGeometryFromWkt(f'POLYGON (({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))')
    road_bytes = (area.output / 'roads.json').read_bytes()
    roads = json.loads(road_bytes)['roads']
    cemeteries, seen = [], set()
    for path in paths:
        for feature in json.loads(path.read_text())['features']:
            p = {k.lower(): v for k, v in feature['properties'].items()}
            if p.get('feat_desc') != 'CEMETERY polygon' or not feature.get('geometry'):
                continue
            geom = ogr.CreateGeometryFromJson(json.dumps(feature['geometry'])); geom.Transform(tr)
            if not geom.Intersects(clip):
                continue
            # Keep the mapped portion inside the playable mid box, including boundary features.
            geom = geom.Intersection(clip).SimplifyPreserveTopology(0.5)
            parts = [geom] if geom.GetGeometryName() == 'POLYGON' else list(geom)
            for poly in parts:
                if poly.GetGeometryName() != 'POLYGON' or poly.GetArea() < 1:
                    continue
                ring = canonical_ring(poly)
                if len(ring) < 4:
                    raise ValueError('Cemetery ring collapsed')
                key = hashlib.sha256(json.dumps(ring).encode()).hexdigest()[:12]
                if key in seen:
                    continue
                seen.add(key)
                dist, road, rp, gate = nearest_road(ring, roads)
                name = (road.get('name') or '').strip()
                # Keep the gate on the quantized ring, without a second rounding off its segment.
                gate = min((projection(rp, a, b) for a, b in zip(ring, ring[1:])), key=lambda q: math.dist(q, rp))
                signed = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
                cemeteries.append(dict(id=f'cemetery-{key}', ring=ring, area=round(abs(signed) / 2, 2),
                    road=dict(id=road['id'], name=name, point=[round(v, 2) for v in rp], distance=round(dist, 2)) if name else None,
                    gate=dict(point=gate, heading=math.atan2(rp[0] - gate[0], rp[1] - gate[1]))))
    for cemetery in cemeteries:
        build_wall(cemetery, roads)
    cemeteries.sort(key=lambda c: c['id'])
    # Both files are written by a temporary file and a rename inside the area's own baked folder.
    atomic_json(area.output / 'cemeteries.json', dict(crs='EPSG:2961', area=area.id, roadsSha256=hashlib.sha256(road_bytes).hexdigest(), cemeteries=cemeteries))
    manifest_path = area.output / 'manifest.json'
    # Read immediately before adding our key: other bakes own all the other keys.
    before = manifest_path.read_bytes()
    manifest = json.loads(before)
    manifest['cemeteries'] = dict(file='cemeteries.json', count=len(cemeteries))
    atomic_json(manifest_path, manifest)
    expected = json.loads(before); expected['cemeteries'] = manifest['cemeteries']
    if json.loads(manifest_path.read_text()) != expected:
        raise RuntimeError('Manifest changed beyond the cemetery key; inspect concurrent bake')
    print(f"{area.id}: {len(cemeteries)} cemeteries; PASS manifest equals the manifest before plus cemeteries; output {area.output}")


if __name__ == '__main__':
    main()
