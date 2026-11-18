#!/usr/bin/env python3
"""Bake the brooks: single-line streams of the provincial map, moved onto the channel the LiDAR shows.

The map's brook lines are drawn at 1:10,000 and lie several metres beside the real channel about half of the time.
The 1 m ground model shows the channel itself. So each mapped brook is traced again as the cheapest path through
low ground, inside a band 16 m to each side of the mapped line. A road is a wall in the ground model (the water goes
under it in a pipe), so the path may cross a road only at a mapped culvert line, or else at a high cost: that crossing
becomes a culvert record with its two mouths.

Reads:  data/raw/vectors/BASE_NSTDB_10k_Water_WM84__04_wet_features.geojson      brook lines (OGL-NS)
        data/raw/vectors/BASE_NSTDB_10k_Roads_WM84__10_non_vehicle_features.geojson   culvert lines (OGL-NS)
        data/baked/terrain: manifest.json, roads.json, 8/*.png (the 1 m ground)
Writes: data/baked/terrain/streams.json and the "streams" key of manifest.json
          {"crs": "EPSG:2961",
           "streams":  [{"id", "name", "half" (half width of the water, m), "pts": [[east, north], ...] downstream}],
           "culverts": [{"stream", "road", "a": [e, n], "b": [e, n] (the two mouths), "dia" (m), "mapped": bool}]}
Only where the 1 m ground exists (the village and the route corridors). Run after 23 and 24.
  --out DIR   write streams.json to DIR and leave the manifest alone (for a trial)
  --only N    trace only the first N brooks (for a quick trial; needs --out)
No network access. Needs GDAL (for coordinates) and numpy. Run in the GDAL container or with a local GDAL.
"""
import argparse
import collections
import heapq
import importlib.util
import json
import math
import os

import numpy as np
from osgeo import gdal, osr

spec = importlib.util.spec_from_file_location('terrain', os.path.join(os.path.dirname(os.path.abspath(__file__)), '21_bake_terrain.py'))
terrain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terrain)
OUT, RAW = terrain.OUT, terrain.RAW

BAND = 16.0          # metres to each side of the mapped line that the traced brook may use
HOLLOW_RADIUS = 6    # metres: a cell is in a hollow when it is lower than the mean ground this near
STEP = 2.0           # metres between points of a mapped line when it is tested against the tiles
BROOK = {'WARV50': 'brook', 'WARV55': 'faint', 'WARVSP50': 'brook'}   # single line, indefinite single line, split
TILE = 256           # metres and samples: a level 8 tile is 256 m with 257 samples


class Ground:
    """The 1 m ground from the level 8 tiles, as windows cut on demand."""

    def __init__(self, manifest):
        self.x0, self.y1 = manifest['origin']
        self.scale, self.offset = manifest['height']['scale'], manifest['height']['offset']
        self.have = set(manifest['levels']['8'])
        self.cache = collections.OrderedDict()

    def tile(self, i, j):
        key = f'{i}_{j}'
        if key not in self.have:
            return None
        if key not in self.cache:
            a = gdal.Open(f'{OUT}/8/{key}.png').ReadAsArray().astype(np.float32)   # bands R, G, B
            self.cache[key] = (a[0] * 256 + a[1]) * self.scale + self.offset
            if len(self.cache) > 400:
                self.cache.popitem(last=False)
        self.cache.move_to_end(key)
        return self.cache[key]

    def covered(self, e, n):
        return f'{int((e - self.x0) // TILE)}_{int((self.y1 - n) // TILE)}' in self.have

    def window(self, emin, nmin, emax, nmax):
        """Heights on whole metres for a box; NaN where no tile exists. Row 0 is north. Returns (array, east0, north0)."""
        c0, c1 = int(math.floor(emin - self.x0)), int(math.ceil(emax - self.x0))
        r0, r1 = int(math.floor(self.y1 - nmax)), int(math.ceil(self.y1 - nmin))
        out = np.full((r1 - r0 + 1, c1 - c0 + 1), np.nan, np.float32)
        for j in range(r0 // TILE, r1 // TILE + 1):
            for i in range(c0 // TILE, c1 // TILE + 1):
                t = self.tile(i, j)
                if t is None:
                    continue
                # Tile sample (a, b) sits at column i*256 + a, row j*256 + b; neighbours share their edge samples.
                ca, cb = max(c0, i * TILE), min(c1, i * TILE + TILE)
                ra, rb = max(r0, j * TILE), min(r1, j * TILE + TILE)
                if ca > cb or ra > rb:
                    continue
                out[ra - r0:rb - r0 + 1, ca - c0:cb - c0 + 1] = t[ra - j * TILE:rb - j * TILE + 1, ca - i * TILE:cb - i * TILE + 1]
        return out, self.x0 + c0, self.y1 - r0


def to_utm():
    src = osr.SpatialReference(); src.ImportFromEPSG(4326); src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference(); dst.ImportFromEPSG(2961)
    return osr.CoordinateTransformation(src, dst)


def read_lines(path, codes, tr):
    out = []
    for f in json.load(open(path))['features']:
        g, p = f.get('geometry'), f['properties']
        if not g or p.get('FEAT_CODE') not in codes:
            continue
        parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates'] if g['type'] == 'MultiLineString' else []
        for part in parts:
            pts = [tr.TransformPoint(c[0], c[1])[:2] for c in part]
            if len(pts) > 1:
                out.append({'code': p['FEAT_CODE'], 'name': (p.get('RIVNAME_1') or '').strip(), 'pts': pts})
    return out


def length(pts):
    return sum(math.dist(pts[k], pts[k + 1]) for k in range(len(pts) - 1))


def densify(pts, step):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.ceil(math.dist(a, b) / step)))
        out.extend((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1))
    return out


def seg_distance(shape, east0, north0, segs, reach):
    """Distance in metres from each cell to the nearest of `segs` ((ax, ay, bx, by) in map metres), capped at `reach`."""
    d = np.full(shape, reach, np.float32)
    rows, cols = shape
    for ax, ay, bx, by in segs:
        c0 = max(0, int(math.floor(min(ax, bx) - reach - east0))); c1 = min(cols - 1, int(math.ceil(max(ax, bx) + reach - east0)))
        r0 = max(0, int(math.floor(north0 - max(ay, by) - reach))); r1 = min(rows - 1, int(math.ceil(north0 - min(ay, by) + reach)))
        if c0 > c1 or r0 > r1:
            continue
        x = east0 + np.arange(c0, c1 + 1, dtype=np.float32)[None, :]
        y = north0 - np.arange(r0, r1 + 1, dtype=np.float32)[:, None]
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy
        t = np.clip(((x - ax) * dx + (y - ay) * dy) / ll, 0, 1) if ll > 0 else 0
        dist = np.hypot(x - (ax + t * dx), y - (ay + t * dy))
        view = d[r0:r1 + 1, c0:c1 + 1]
        np.minimum(view, dist, out=view)
    return d


def hollow(h, radius):
    """How far each cell lies below (negative) or above (positive) the mean ground within `radius` cells.

    A channel is a hollow whichever way the land slopes. (Height above the lowest ground near by does not work on a
    slope: the lowest ground is always further down the hill, also for a cell that is in the channel.)
    """
    ok = ~np.isnan(h)
    total, count = np.where(ok, h, 0).astype(np.float64), ok.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]; pad[axis] = (radius, radius)
        total = np.lib.stride_tricks.sliding_window_view(np.pad(total, pad), 2 * radius + 1, axis=axis).sum(axis=-1)
        count = np.lib.stride_tricks.sliding_window_view(np.pad(count, pad), 2 * radius + 1, axis=axis).sum(axis=-1)
    return (h - total / np.maximum(count, 1)).astype(np.float32)


NEIGHBOURS = [(-1, -1, 1.4142), (-1, 0, 1.0), (-1, 1, 1.4142), (0, -1, 1.0), (0, 1, 1.0), (1, -1, 1.4142), (1, 0, 1.0), (1, 1, 1.4142)]


def trace(h, cost, start, goal):
    """Cheapest path of cells from start to goal over `cost` (inf = closed). Going uphill costs extra. None if cut off."""
    rows, cols = h.shape
    inf = float('inf')
    hl, kl = h.ravel().tolist(), cost.ravel().tolist()   # plain lists: this loop runs millions of times
    best = [inf] * (rows * cols)
    prev = [-1] * (rows * cols)
    s, g = start[0] * cols + start[1], goal[0] * cols + goal[1]
    best[s] = 0.0
    heap = [(0.0, s)]
    steps = [(dr * cols + dc, dr, dc, w) for dr, dc, w in NEIGHBOURS]
    while heap:
        d, at = heapq.heappop(heap)
        if d > best[at]:
            continue
        if at == g:
            break
        r, c = divmod(at, cols)
        hr = hl[at]
        for off, dr, dc, w in steps:
            rr, cc = r + dr, c + dc
            if rr < 0 or cc < 0 or rr >= rows or cc >= cols:
                continue
            to = at + off
            k = kl[to]
            if k == inf:
                continue
            up = hl[to] - hr
            nd = d + w * k + (3.0 * up if up > 0 else 0.0)
            if nd < best[to]:
                best[to] = nd
                prev[to] = at
                heapq.heappush(heap, (nd, to))
    if best[g] == inf:
        return None
    path = [g]
    while path[-1] != s:
        path.append(prev[path[-1]])
    return [divmod(p, cols) for p in reversed(path)]


def simplify(pts, tol):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay; ll = dx * dx + dy * dy
        worst, at = 0.0, -1
        for k in range(a + 1, b):
            px, py = pts[k]
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ll)) if ll > 0 else 0.0
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > worst:
                worst, at = d, k
        if worst > tol:
            keep[at] = True
            stack.extend(((a, at), (at, b)))
    return [p for p, k in zip(pts, keep) if k]


def smooth(pts, passes=2):
    """Round the staircase of a path of cells; the two ends stay where they are."""
    for _ in range(passes):
        if len(pts) < 3:
            break
        pts = [pts[0]] + [((pts[k - 1][0] + 2 * pts[k][0] + pts[k + 1][0]) / 4, (pts[k - 1][1] + 2 * pts[k][1] + pts[k + 1][1]) / 4)
                          for k in range(1, len(pts) - 1)] + [pts[-1]]
    return pts


def upstream_lengths(lines):
    """Kilometres of mapped brook that drain through each line: its own length plus every line joined to its upper end.

    Lines that share an end point form the network. The map does not say which way a line flows, so the upper end is
    the higher one in the 16 m ground model. Only single-line brooks count: a brook that leaves a lake starts again
    at zero, which suits a measure whose only job is to choose a width.
    """
    key = lambda p: (round(p[0] / 3), round(p[1] / 3))
    wide = gdal.Open(str(terrain.AREA.bake_wide("dtm")))
    gt = wide.GetGeoTransform()
    dtm = wide.GetRasterBand(1).ReadAsArray()
    high = lambda p: float(dtm[min(max(int((p[1] - gt[3]) / gt[5]), 0), dtm.shape[0] - 1), min(max(int((p[0] - gt[0]) / gt[1]), 0), dtm.shape[1] - 1)])
    ends = collections.defaultdict(list)
    for k, line in enumerate(lines):
        ends[key(line['pts'][0])].append(k); ends[key(line['pts'][-1])].append(k)
    lens = [length(line['pts']) / 1000 for line in lines]
    size = []
    for k, line in enumerate(lines):
        a, b = line['pts'][0], line['pts'][-1]
        top = key(a) if high(a) >= high(b) else key(b)
        # Everything reached through the upper end, without passing through this line again.
        seen, queue, total = {k}, [top], 0.0
        while queue:
            node = queue.pop()
            for other in ends[node]:
                if other in seen:
                    continue
                seen.add(other); total += lens[other]
                p0, p1 = key(lines[other]['pts'][0]), key(lines[other]['pts'][-1])
                queue.append(p1 if p0 == node else p0)
        size.append(lens[k] + total)
    return size


def half_width(km, kind):
    """Half the width of the water, from the length of brook above. A faint line on the map is a trickle."""
    w = 0.45 + 0.5 * math.sqrt(max(km, 0.0))
    if kind == 'faint':
        w = min(w, 0.6)
    return round(min(max(w, 0.45), 4.0) / 2, 2)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out'); ap.add_argument('--only', type=int, default=0)
    args = ap.parse_args()
    if args.only and not args.out:
        ap.error('--only is a trial: give --out DIR too, so the real streams.json is not replaced by a part of it')
    manifest = json.load(open(f'{OUT}/manifest.json'))
    ground = Ground(manifest)
    tr = to_utm()
    brooks = read_lines(f'{RAW}/vectors/BASE_NSTDB_10k_Water_WM84__04_wet_features.geojson', set(BROOK), tr)
    mapped_culverts = [c['pts'] for c in read_lines(f'{RAW}/vectors/BASE_NSTDB_10k_Roads_WM84__10_non_vehicle_features.geojson', {'RRCL50'}, tr)]
    roads = json.load(open(f'{OUT}/roads.json'))['roads']
    sizes = upstream_lengths(brooks)

    # Road segments in a grid of 64 m cells, to find the ones near a window fast.
    grid = collections.defaultdict(list)
    for road in roads:
        if road.get('bridge'):
            continue   # under a bridge the channel is open
        reach = road['halfWidth'] + 1.5
        for a, b in zip(road['pts'], road['pts'][1:]):
            for gx in range(int((min(a[0], b[0]) - reach) // 64), int((max(a[0], b[0]) + reach) // 64) + 1):
                for gy in range(int((min(a[1], b[1]) - reach) // 64), int((max(a[1], b[1]) + reach) // 64) + 1):
                    grid[(gx, gy)].append((a[0], a[1], b[0], b[1], road['id'], reach))
    culvert_grid = collections.defaultdict(list)
    for pts in mapped_culverts:
        for a, b in zip(pts, pts[1:]):
            for gx in range(int(min(a[0], b[0]) // 64) - 1, int(max(a[0], b[0]) // 64) + 2):
                for gy in range(int(min(a[1], b[1]) // 64) - 1, int(max(a[1], b[1]) // 64) + 2):
                    culvert_grid[(gx, gy)].append((a[0], a[1], b[0], b[1]))

    streams, culverts = [], []
    nodes = {}   # mapped end point (whole metres) -> where that end really is, shared by the brooks that meet there
    stats = collections.Counter()
    before, after = [], []
    todo = brooks[:args.only] if args.only else brooks
    for n, line in enumerate(todo):
        kind = BROOK[line['code']]
        dense = densify(line['pts'], STEP)
        inside = [ground.covered(e, nn) for e, nn in dense]
        # Maximal runs of the mapped line that lie on the 1 m ground.
        k = 0
        while k < len(dense):
            if not inside[k]:
                k += 1; continue
            j = k
            while j + 1 < len(dense) and inside[j + 1]:
                j += 1
            run = dense[k:j + 1]
            k = j + 1
            if length(run) < 12:
                stats['short runs left out'] += 1; continue
            es = [p[0] for p in run]; ns = [p[1] for p in run]
            h, east0, north0 = ground.window(min(es) - BAND - 2, min(ns) - BAND - 2, max(es) + BAND + 2, max(ns) + BAND + 2)
            segs = [(a[0], a[1], b[0], b[1]) for a, b in zip(run, run[1:])]
            away = seg_distance(h.shape, east0, north0, segs, BAND + 1)
            band = (away <= BAND) & ~np.isnan(h)
            rel = np.clip(hollow(h, HOLLOW_RADIUS), -1.5, 1.5)
            # Cost of a metre of path: cheap in a hollow, dear on a bank or a ridge, plus a little for leaving the
            # mapped line (so a flat field does not let the path wander).
            cost = np.where(band, np.exp(2.5 * rel) + 0.03 * away, np.inf).astype(np.float32)
            # Roads: a wall, except along a mapped culvert line.
            near, seen = [], set()
            for gx in range(int((min(es) - BAND) // 64), int((max(es) + BAND) // 64) + 1):
                for gy in range(int((min(ns) - BAND) // 64), int((max(ns) + BAND) // 64) + 1):
                    for s in grid.get((gx, gy), ()):
                        if s not in seen:
                            seen.add(s); near.append(s)
            road_id = np.full(h.shape, -1, np.int32)
            if near:
                on_road = np.zeros(h.shape, bool)
                for reach in sorted({s[5] for s in near}):
                    group = [s for s in near if s[5] == reach]
                    d = seg_distance(h.shape, east0, north0, [s[:4] for s in group], reach + 1)
                    hit = d <= reach
                    on_road |= hit
                    for rid in sorted({s[4] for s in group}):
                        one = seg_distance(h.shape, east0, north0, [s[:4] for s in group if s[4] == rid], reach + 1) <= reach
                        road_id[one & (road_id < 0)] = rid
                pipes, pseen = [], set()
                for gx in range(int((min(es) - BAND) // 64), int((max(es) + BAND) // 64) + 1):
                    for gy in range(int((min(ns) - BAND) // 64), int((max(ns) + BAND) // 64) + 1):
                        for s in culvert_grid.get((gx, gy), ()):
                            if s not in pseen:
                                pseen.add(s); pipes.append(s)
                in_pipe = seg_distance(h.shape, east0, north0, pipes, 4.0) <= 1.6 if pipes else np.zeros(h.shape, bool)
                cost = np.where(on_road & band & ~in_pipe, cost + 25.0, cost)
                cost = np.where(in_pipe & band, 0.3, cost)   # the pipe is the way through, whatever the fill above it
            else:
                on_road = np.zeros(h.shape, bool); in_pipe = on_road
            cell = lambda p: (int(round(north0 - p[1])), int(round(p[0] - east0)))
            if any(not band[cell(p)] for p in (run[0], run[-1])):
                stats['runs with an end off the ground model'] += 1; continue

            def settle(p):
                """An end of a run, moved to the best hollow within 8 m. Brooks that meet share one such point."""
                key = (round(p[0]), round(p[1]))
                if key not in nodes:
                    r, c = cell(p)
                    r0, r1, c0, c1 = max(r - 8, 0), min(r + 9, h.shape[0]), max(c - 8, 0), min(c + 9, h.shape[1])
                    yy, xx = np.mgrid[r0:r1, c0:c1]
                    far = np.hypot(yy - r, xx - c)
                    score = np.where(band[r0:r1, c0:c1] & ~on_road[r0:r1, c0:c1] & (far <= 8), rel[r0:r1, c0:c1] + 0.04 * far, np.inf)
                    if np.isfinite(score).any():
                        br, bc = np.unravel_index(int(np.argmin(score)), score.shape)
                        nodes[key] = (east0 + c0 + int(bc), north0 - (r0 + int(br)))
                    else:
                        nodes[key] = (east0 + c, north0 - r)
                return cell(nodes[key])

            # Downstream is toward the lower end.
            ends = [settle(run[0]), settle(run[-1])]
            if any(not band[e] for e in ends) or ends[0] == ends[1]:
                stats['runs with an end off the ground model'] += 1; continue
            if h[ends[0]] < h[ends[1]]:
                ends.reverse()
            path = trace(h, cost, ends[0], ends[1])
            if path is None:
                stats['runs with no way through'] += 1; continue
            rr = np.array([p[0] for p in path]); cc = np.array([p[1] for p in path])
            after.extend(rel[rr, cc][~on_road[rr, cc]].tolist())
            mr = np.clip(np.round(north0 - np.array(ns)).astype(int), 0, h.shape[0] - 1); mc = np.clip(np.round(np.array(es) - east0).astype(int), 0, h.shape[1] - 1)
            before.extend(rel[mr, mc][~on_road[mr, mc]].tolist())
            pts = [(east0 + c, north0 - r) for r, c in path]
            hw = half_width(sizes[n], kind)
            # Culverts: each stretch of the path that lies under a road. A mapped culvert line gives the true length
            # of the pipe (it reaches the foot of the road's fill on both sides). Without one, the pipe is taken to
            # the foot of the fill: as far as the ground still falls away steeply.
            under = [bool(on_road[c] or in_pipe[c]) for c in path]
            cuts = []   # (first cell in the pipe, last cell in the pipe)
            a = 0
            while a < len(path):
                if not under[a]:
                    a += 1; continue
                b = a
                while b + 1 < len(path) and under[b + 1]:
                    b += 1
                stretch = range(a, b + 1)
                a_next = b + 1
                if any(on_road[path[q]] for q in stretch) and 0 < a and b < len(path) - 1:
                    ids = [int(road_id[path[q]]) for q in stretch if road_id[path[q]] >= 0]
                    rid = collections.Counter(ids).most_common(1)[0][0] if ids else -1
                    rkind = next((r['kind'] for r in roads if r['id'] == rid), 0)
                    piped = any(in_pipe[path[q]] for q in stretch)
                    # A farm track gets a culvert only where the map shows one; elsewhere the track simply hides the water.
                    if rkind != 4 or piped:
                        if not piped:
                            for _ in range(6):
                                if a > 1 and abs(float(h[path[a - 1]]) - float(h[path[a - 2]])) > 0.25: a -= 1
                                if b < len(path) - 2 and abs(float(h[path[b + 1]]) - float(h[path[b + 2]])) > 0.25: b += 1
                        if math.dist(pts[a - 1], pts[b + 1]) >= 3:
                            cuts.append((a, b, rid, piped))
                a = a_next
            # Two pipes that reach into each other (two roads side by side, each taken to the foot of its fill) are one
            # pipe: otherwise each would have a mouth inside the other.
            merged = []
            for cut in sorted(cuts):
                if merged and cut[0] <= merged[-1][1] + 1:
                    last = merged[-1]
                    merged[-1] = (last[0], max(last[1], cut[1]), last[2], last[3] or cut[3])
                else:
                    merged.append(cut)
            cuts = merged
            # The brook is cut at each pipe: no open water is drawn between the two mouths.
            pieces, start = [], 0
            for a, b, rid, piped in cuts:
                pieces.append((pts[start:a], (pts[a - 1], pts[b + 1], rid, piped)))
                start = b + 1
            pieces.append((pts[start:], None))
            for piece, pipe in pieces:
                sid = -1
                if len(piece) >= 2:
                    sid = len(streams)
                    piece = simplify(smooth(piece), 0.35) if len(piece) > 2 else piece
                    streams.append({'id': sid, 'name': line['name'], 'half': hw, 'pts': [[round(e, 1), round(nn, 1)] for e, nn in piece]})
                if pipe:
                    m0, m1, rid, piped = pipe
                    # `stream` is the open brook that runs into the pipe (-1 when the pipe starts at the very end of a run).
                    culverts.append({'stream': sid, 'road': rid, 'a': [round(m0[0], 1), round(m0[1], 1)], 'b': [round(m1[0], 1), round(m1[1], 1)],
                                     'dia': 0.6 if hw < 0.5 else 0.9 if hw < 0.9 else 1.2 if hw < 1.4 else 1.8, 'mapped': piped})
                    stats['culverts at a mapped culvert line' if piped else 'culverts where a brook meets a road'] += 1
            stats['runs traced'] += 1
        if n % 100 == 0:
            print(f'Brook {n + 1}/{len(todo)}: {len(streams)} runs, {sum(length(s["pts"]) for s in streams) / 1000:.1f} km, {len(culverts)} culverts', flush=True)

    km = sum(length(s['pts']) for s in streams) / 1000
    report = {
        'mappedBrookLines': len(brooks), 'runs': len(streams), 'km': round(km, 1), 'culverts': len(culverts),
        'points': sum(len(s['pts']) for s in streams), 'notes': dict(stats),
        'hollow': {
            'what': f'metres below (-) or above (+) the mean ground within {HOLLOW_RADIUS} m, off the roads: the mapped line, then the traced line',
            'mappedMedian': round(float(np.median(before)), 2) if before else None, 'mapped90': round(float(np.percentile(before, 90)), 2) if before else None,
            'tracedMedian': round(float(np.median(after)), 2) if after else None, 'traced90': round(float(np.percentile(after, 90)), 2) if after else None},
        'halfWidths': dict(collections.Counter(s['half'] for s in streams).most_common(8)),
    }
    out_dir = args.out or OUT
    os.makedirs(out_dir, exist_ok=True)
    with open(f'{out_dir}/streams.json', 'w') as f:
        json.dump({'crs': 'EPSG:2961', 'streams': streams, 'culverts': culverts}, f, separators=(',', ':'))
    print(json.dumps(report, indent=2))
    print(f'streams.json: {os.path.getsize(f"{out_dir}/streams.json"):,} bytes')
    if not args.out:
        manifest['streams'] = {'file': 'streams.json', 'count': len(streams), 'culverts': len(culverts), 'km': round(km, 1)}
        with open(f'{OUT}/manifest.json', 'w') as f:
            json.dump(manifest, f)
        os.makedirs(terrain.OVERVIEW, exist_ok=True)
        json.dump(report, open(f'{terrain.OVERVIEW}/streams-report.json', 'w'), indent=2)


if __name__ == '__main__':
    main()
