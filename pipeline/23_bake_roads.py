#!/usr/bin/env python3
"""Bake provincial vehicle centrelines. Rebuild: run this script in the GDAL container.

The misleadingly named __05_bridges export contains the complete provincial network,
including the bridge spans omitted from __07/__08. FEAT_CODE RRBR marks regular bridges; RRBM marks movable bridges.
OSM supplies matched names where useful; provincial FEAT_DESC supplies surface.
Widths are conservative class defaults, not measurements. No network access.
"""
import collections
import importlib.util
import json
import math
import os
import re

import numpy as np
from osgeo import gdal, ogr, osr

from areas import current

AREA = current()

spec = importlib.util.spec_from_file_location('terrain', os.path.join(os.path.dirname(os.path.abspath(__file__)), '21_bake_terrain.py'))
terrain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terrain)
OUT = terrain.OUT
RAW = terrain.RAW
ROUTE = AREA.route or ()
WASHBOARD = set(AREA.washboard)

# The old rail line is a maintained trail now. The provincial export encodes it as TRACK, named
# "<trail name>-<community>-<county>". It becomes its own kind of road (5): fine crusher dust, no mailboxes, no poles.
RAIL_TRAIL = re.compile(r'^(.+ Trail)-')


def drop_close(pts, least=1.0):
    """Drop inner points nearer than `least` metres to the point kept before them; the two ends never move."""
    if len(pts) < 3:
        return pts
    kept = [pts[0]]
    for p in pts[1:-1]:
        if math.hypot(p[0] - kept[-1][0], p[1] - kept[-1][1]) >= least:
            kept.append(p)
    while len(kept) > 1 and math.hypot(pts[-1][0] - kept[-1][0], pts[-1][1] - kept[-1][1]) < least:
        kept.pop()
    return [*kept, pts[-1]]


def smooth_line(pts, step=2.0, sigma=7.0, out_step=4.0):
    """Resample a line evenly, blur it along its length, and thin it again. The two ends do not move,
    so roads still meet at their junctions; near an end the blur shrinks to nothing."""
    import math
    if len(pts) < 3:
        return pts
    seg = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    total = sum(seg)
    if total < 3 * out_step:
        return pts
    n = max(2, int(round(total / step)))
    even, i, walked = [], 0, 0.0
    for k in range(n + 1):
        d = total * k / n
        while i < len(seg) - 1 and walked + seg[i] < d:
            walked += seg[i]
            i += 1
        t = 0.0 if seg[i] == 0 else min(1.0, (d - walked) / seg[i])
        even.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t))
    ds = total / n
    out = []
    for k in range(n + 1):
        reach = min(k, n - k)                       # samples to the nearer end
        s = min(sigma, reach * ds / 2.5)            # the blur shrinks toward the ends
        if s < ds * 0.5:
            out.append(even[k])
            continue
        w = min(reach, int(3 * s / ds))
        sx = sy = sw = 0.0
        for j in range(k - w, k + w + 1):
            g = math.exp(-0.5 * ((j - k) * ds / s) ** 2)
            sx += even[j][0] * g
            sy += even[j][1] * g
            sw += g
        out.append((sx / sw, sy / sw))
    keep = max(1, int(round(out_step / ds)))
    thin = out[::keep]
    if thin[-1] != out[-1]:
        # Keep the true end; drop the point before it when it would leave a very short last piece.
        if len(thin) > 1 and math.hypot(thin[-1][0] - out[-1][0], thin[-1][1] - out[-1][1]) < 3.0:
            thin.pop()
        thin.append(out[-1])
    return [[round(x, 2), round(y, 2)] for x, y in thin]

def transform():
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326)
    dst.ImportFromEPSG(2961)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(src, dst)


def rectangle(bounds):
    x0, y0, x1, y1 = bounds
    return ogr.CreateGeometryFromWkt(f'POLYGON(({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))')


def lines(g):
    if g is None or g.IsEmpty():
        return
    if g.GetGeometryName() == 'LINESTRING':
        yield g
    elif g.GetGeometryName() in ('MULTILINESTRING', 'GEOMETRYCOLLECTION'):
        for i in range(g.GetGeometryCount()):
            yield from lines(g.GetGeometryRef(i))


def canonical(name):
    name = (name or '').strip()
    if name in ('', 'Track', 'Driveway', 'Dryweather', 'Trail'):
        return None
    for a, b in [('Rd', 'Road'), ('St', 'Street'), ('Br', 'Branch'), ('Exten', 'Extension'), ('Dr', 'Drive')]:
        name = re.sub(r'\b' + a + r'\b', b, name)
    return name


def is_bridge(properties):
    return properties.get('FEAT_CODE', '').startswith(('RRBR', 'RRBM'))


def source_roads():
    tr = transform()
    ds = ogr.Open(f'{RAW}/vectors/BASE_NSTDB_10k_Roads_WM84__05_bridges.geojson')
    for f in ds.GetLayer(0):
        p = dict(f.items())
        name, desc = canonical(p.get('STREET')), p.get('FEAT_DESC', '')
        rail = RAIL_TRAIL.match((p.get('STREET') or '').strip()) if p.get('ROADCLASS') == 'TK' else None
        if rail:
            name = rail.group(1)
        # Other trails (footpaths, "no vehicular traffic") stay out; names must also be checked.
        elif ('Trail' in (name or '') or p.get('ROADCLASS') == 'TR' or
                'Abandoned' in desc or 'Placeholder' in desc or p.get('TRAFFICDIR') == 5):
            continue
        g = f.GetGeometryRef().Clone()
        g.Transform(tr)
        if AREA.interpolate_coastal_trail and p.get('ROADSEGID') == 700024:
            from canso_trail import aligned_trail
            g = aligned_trail(g, AREA)
        yield p, name, g, bool(rail)


def osm_trail_gaps(have, box):
    """Pieces of the OSM rail trail that have no provincial trail line within 15 m (two places, both on the ground,
    where the trail left the old rail bed). Each end is joined to the provincial line it stopped short of."""
    if not have:
        return
    tr = transform()
    known = ogr.Geometry(ogr.wkbMultiLineString)
    for _, pts in have:
        g = ogr.Geometry(ogr.wkbLineString)
        for x, y in pts:
            g.AddPoint_2D(x, y)
        known.AddGeometry(g)
    near = known.Buffer(15)

    def closest(p):
        best = (1e9, None, None)
        for name, pts in have:
            a, b = np.array(pts[:-1], dtype=float), np.array(pts[1:], dtype=float)
            d = b - a
            t = np.clip(((p - a) * d).sum(1) / np.maximum((d * d).sum(1), 1e-9), 0, 1)
            q = a + d * t[:, None]
            dist = np.linalg.norm(q - p, axis=1)
            k = int(dist.argmin())
            if dist[k] < best[0]:
                best = (float(dist[k]), (round(float(q[k, 0]), 3), round(float(q[k, 1]), 3)), name)
        return best

    seen = set()
    for e in json.load(open(f'{RAW}/vectors/osm.json'))['elements']:
        tags = e.get('tags', {})
        if (e.get('type') != 'way' or e['id'] in seen or not e.get('geometry') or
                'Rail Trail' not in tags.get('name', '')):
            continue
        seen.add(e['id'])
        g = ogr.Geometry(ogr.wkbLineString)
        for q in e['geometry']:
            x, y, _ = tr.TransformPoint(q['lon'], q['lat'])
            g.AddPoint_2D(x, y)
        for part in lines(g.Intersection(box).Difference(near)):
            if part.Length() < 25:
                continue
            pts = [(round(part.GetX(i), 3), round(part.GetY(i), 3)) for i in range(part.GetPointCount())]
            name = None
            for at in (0, -1):
                dist, q, owner = closest(np.array(pts[at]))
                if dist < 40:
                    name = name or owner
                    if at == 0:
                        pts.insert(0, q)
                    else:
                        pts.append(q)
            yield name or have[0][0], 5, tags.get('bridge') == 'yes', pts


def osm_roads():
    tr = transform()
    seen = set()
    for e in json.load(open(f'{RAW}/vectors/osm.json'))['elements']:
        tags = e.get('tags', {})
        if e.get('type') != 'way' or e['id'] in seen or tags.get('highway') not in (
                'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'track'):
            continue
        seen.add(e['id'])
        if not e.get('geometry'):
            continue
        g = ogr.Geometry(ogr.wkbLineString)
        for p in e['geometry']:
            x, y, _ = tr.TransformPoint(p['lon'], p['lat'])
            g.AddPoint_2D(x, y)
        yield tags, g


def resample(pts):
    g = ogr.Geometry(ogr.wkbLineString)
    for x, y in pts:
        g.AddPoint_2D(x, y)
    g = g.Simplify(0.3)
    a = np.array(g.GetPoints())[:, :2]
    a = a[np.r_[True, np.any(np.diff(a, axis=0) != 0, axis=1)]]
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(a, axis=0), axis=1))]
    if d[-1] < 3:
        return None
    s = np.linspace(0, d[-1], max(1, math.ceil(d[-1] / 10)) + 1)
    return np.round(np.column_stack([np.interp(s, d, a[:, k]) for k in (0, 1)]), 3).tolist()


def merge(items):
    groups = collections.defaultdict(list)
    for name, kind, bridge, pts in items:
        groups[(name, kind, bridge)].append(pts)
    for (name, kind, bridge), paths in sorted(groups.items(), key=lambda kv: str(kv[0])):
        ends = collections.defaultdict(list)
        for n, p in enumerate(paths):
            ends[tuple(p[0])].append((n, 0))
            ends[tuple(p[-1])].append((n, 1))
        used = set()
        for n in range(len(paths)):
            if n in used:
                continue
            used.add(n)
            pts = paths[n][:]
            for _ in (0, 1):
                while len(ends[tuple(pts[-1])]) == 2:
                    options = [(m, e) for m, e in ends[tuple(pts[-1])] if m not in used]
                    if len(options) != 1:
                        break
                    m, e = options[0]
                    used.add(m)
                    q = paths[m] if e == 0 else paths[m][::-1]
                    pts.extend(q[1:])
                pts.reverse()
            pts = resample(pts)
            if pts:
                yield dict(name=name, kind=kind, halfWidth={1:3.6, 2:3.0, 3:2.6, 4:1.5, 5:1.6}[kind], bridge=bridge, pts=pts)


def hillshade(bounds):
    d = terrain.warp(str(AREA.elevation("dtm")), bounds, 1, 'bilinear')
    d[d == terrain.NODATA] = -4
    dy, dx = np.gradient(d)
    light = np.clip((0.7 - dx * 0.45 + dy * 0.55) / np.sqrt(1 + dx*dx + dy*dy), 0, 1)
    return np.repeat((65 + 175*light)[None], 3, axis=0).astype(np.uint8)


def comparison(prov, osm):
    # Three independent sites: village, Mabou Harbour Road, Highway 252.
    centres = AREA.comparison_centres or (AREA.bake_anchor,)
    panels = []
    for x, y in centres:
        bounds = (x-300, y-300, x+300, y+300)
        rgb = hillshade(bounds)
        for geoms, colour in [(prov, (255, 70, 35)), ([g for _, g in osm], (30, 210, 255))]:
            for g in geoms:
                for line in lines(g.Intersection(rectangle(bounds))):
                    p = np.array(line.GetPoints())[:, :2]
                    for a, b in zip(p[:-1], p[1:]):
                        n = max(2, math.ceil(np.linalg.norm(b-a)*2))
                        q = np.linspace(a, b, n)
                        c = np.clip(np.rint(q[:, 0]-bounds[0]).astype(int),0,600)
                        r = np.clip(np.rint(bounds[3]-q[:, 1]).astype(int),0,600)
                        rgb[:, r, c] = np.array(colour)[:,None]
        panels.append(rgb)
    os.makedirs(terrain.OVERVIEW, exist_ok=True)
    terrain.write_png(f'{terrain.OVERVIEW}/roads-source-comparison.png', np.concatenate(panels, axis=2))


def main():
    manifest = json.load(open(f'{OUT}/manifest.json'))
    box = rectangle(manifest['mid'])
    osm = list(osm_roads())
    items, prov, seen = [], [], set()
    for p, name, g, rail in source_roads():
        prov.append(g)
        desc = p.get('FEAT_DESC', '')
        kind = (5 if rail else
                1 if p.get('RTE_NO') in AREA.highways else
                4 if p.get('ROADCLASS') in ('TK','DR','DW','SE') or 'Dry Weather' in desc or p.get('OWNER') == 'P' else
                2 if 'Paved' in desc else 3)
        for part in lines(g.Intersection(box)):
            pts = [(round(part.GetX(i),3), round(part.GetY(i),3)) for i in range(part.GetPointCount())]
            key = min(tuple(pts), tuple(pts[::-1]))
            if key in seen:
                continue
            seen.add(key)
            # Only transfer an OSM name to an unnamed public line, with a close match.
            if not name and kind in (1,2,3):
                candidates = [(part.Distance(og), tags.get('name')) for tags, og in osm if tags.get('name')]
                if candidates:
                    dist, candidate = min(candidates)
                    if dist < 2:
                        name = canonical(candidate)
            items.append((name, kind, is_bridge(p), pts))
    comparison(prov, osm)
    gaps = list(osm_trail_gaps([(name, pts) for name, kind, _, pts in items if kind == 5], box))
    items.extend(gaps)
    # The trail's pieces come after every road, so the roads keep the ids they had before the trail was added
    # (mailboxes and poles are seeded by road id).
    roads = [dict(id=n+1, **r) for n,r in enumerate([*merge([i for i in items if i[1] != 5]),
                                                      *merge([i for i in items if i[1] == 5])])]
    for (x, y), fixed_name, fixed_kind in AREA.renamed_roads:
        point = ogr.Geometry(ogr.wkbPoint); point.AddPoint_2D(x, y)
        def gap(road):
            line = ogr.Geometry(ogr.wkbLineString)
            for px, py in road['pts']:
                line.AddPoint_2D(px, py)
            return line.Distance(point)
        road = min((r for r in roads if not r['name']), key=gap, default=None)
        if road is None or gap(road) > 5:
            raise RuntimeError(f'No unnamed road within 5 m of {x}, {y} for {fixed_name}')
        road.update(name=fixed_name, kind=fixed_kind, halfWidth={1:3.6, 2:3.0, 3:2.6, 4:1.5, 5:1.6}[fixed_kind])
        length = sum(math.dist(a, b) for a, b in zip(road['pts'], road['pts'][1:]))
        print(f"Renamed road {road['id']} to {fixed_name}, kind {fixed_kind}: {length:.0f} m", flush=True)
    with open(f'{OUT}/roads.json','w') as f:
        # The map's centrelines carry small kinks from digitising; painted edge lines would show every one.
        for road in roads:
            road['pts'] = smooth_line(road['pts'])
            # In a hairpin the smoothing can leave two points almost on top of each other, which the road check
            # refuses (under 1 m). Mabou has none, and its points must not move, so only other areas are thinned.
            if not AREA.legacy_manifest:
                road['pts'] = drop_close(road['pts'])
        # Set legacy flags first. Bounded observed corrections must precede the optional bed move:
        # its saved lines and point counts must describe the final split inventory for step 29.
        for road in roads:
            road['washboard'] = (road.get('name') or '') in WASHBOARD
        from dashcam_corrections import correct_roads, correct_nov18_roads, finish_observed_roads, attach_guardrails
        roads = correct_roads(roads, AREA.id, guardrails=False)
        roads = correct_nov18_roads(roads, AREA.id)
        marks = {}
        # >>> road-ground trial (off unless asked for): move each line onto the road bed that the LiDAR shows.
        if os.environ.get('MMM_ROAD_BED') == '1':
            import road_ground
            before = {road['id']: road['pts'] for road in roads}
            moved = road_ground.move_to_bed(roads, road_ground.DemSampler(str(AREA.elevation('dtm'))), box=manifest['mid'],
                                            keep=AREA.keep_roads)
            json.dump(moved, open(f'{terrain.OVERVIEW}/roads-bed-report.json', 'w'), indent=1)
            print(f"Road bed: {moved['roadsMoved']} roads moved over {moved['metresMoved']:,} m; junctions whole "
                  f"({moved['junctions']['nodes']:,} nodes, ends apart by at most {moved['junctions']['endsApart']} m); "
                  f"{len(moved['junctionsHeld'])} odd junctions held", flush=True)
            roads = finish_observed_roads(roads, AREA.id, before)
            marks['bed'] = road_ground.keep_lines_before(terrain.OVERVIEW, before, roads)
        # <<< road-ground trial
        if not marks:
            roads = finish_observed_roads(roads, AREA.id)
        roads = attach_guardrails(roads, AREA.id)
        json.dump(dict(crs='EPSG:2961', roads=roads, **marks), f, separators=(',',':'))
    stats = {}
    for k in range(1,6):
        rs = [r for r in roads if r['kind']==k]
        km = sum(np.linalg.norm(np.diff(np.array(r['pts']),axis=0),axis=1).sum() for r in rs)/1000
        stats[k] = dict(roads=len(rs), km=round(float(km),3))
    names = sorted({r['name'] for r in roads if r['name']})
    report = dict(source='Provincial NSTDB __05 complete network', widths='class defaults', stats=stats,
                  railTrailGapsFromOsm=dict(pieces=len(gaps), metres=round(float(sum(
                      np.linalg.norm(np.diff(np.array(g[3]), axis=0), axis=1).sum() for g in gaps)), 1)),
                  names=names, missingRouteNames=sorted(set(ROUTE)-set(names)))
    json.dump(report, open(f'{terrain.OVERVIEW}/roads-report.json','w'), indent=2)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
