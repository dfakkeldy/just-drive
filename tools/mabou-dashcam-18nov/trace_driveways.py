#!/usr/bin/env python3
"""How the two 18 Nov driveways in pipeline/dashcam_20261118.json were drawn, so their points can be made again.

  python3 tools/mabou-dashcam-18nov/trace_driveways.py [ROADS]   (prints the `driveways` list; never writes)
  python3 tools/mabou-dashcam-18nov/trace_driveways.py --check [ROADS]   (PASS when it equals the committed list)

ROADS is the Mabou roads.json the lines were drawn on (default data/baked/terrain/roads.json, before the 18 Nov bake).
Needs GDAL and the 1 m LiDAR ground (data/raw/elevation, DTM only: no surface, intensity or imagery).

- Above Mabou Mines Road: the LiDAR ground shows a bench cut along the slope from the road to the house pad. A
  least-cost line on the 1 m DTM between its two ends, with steep grade and cross slope penalised, follows it. Its
  mouth on the road and its last metres to the yard are fixed points. The line is thinned (1 m), rounded (Chaikin, three
  passes) and set every 3 m. The pad runs along the garage door, in the yard behind the house where the car turned round.
- Off Meadow Road: the LiDAR ground is a smooth field with no line, so the drive is the gentlest path through the dash
  cam's two points: from Meadow Road (square to it at the first point) to a 12 m apron and turnaround centred on that
  point, past the second point, straight to a pad along the garage door.
"""
import heapq
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OBSERVED = ROOT/'pipeline/dashcam_20261118.json'
DTM = ROOT/'data/raw/elevation/north-loop-dtm-1m-epsg3979.tif'
MINES = dict(box=(620300, 5105260, 620490, 5105360), start=(620333, 5105337), end=(620461, 5105345),
             head=[[620298.22, 5105343.78], [620316, 5105341]], tail=[[620460, 5105350]])
CAMERA = ([621242.6, 5100261.1], [621223, 5100272])


def least_cost(box, start, end, grade=0.10, cross=0.08):
    from osgeo import gdal
    gdal.UseExceptions()
    x0, y0, x1, y1 = box
    z = gdal.Warp('', str(DTM), format='MEM', dstSRS='EPSG:2961', xRes=1, yRes=1, outputBounds=box,
                  resampleAlg='bilinear').ReadAsArray().astype(float)
    pad = np.pad(z, 1, mode='edge').cumsum(0).cumsum(1)
    pad = np.pad(pad, ((1, 0), (1, 0)))
    smooth = (pad[3:, 3:] - pad[:-3, 3:] - pad[3:, :-3] + pad[:-3, :-3]) / 9
    gy, gx = np.gradient(smooth)
    gy = -gy
    rows, cols = smooth.shape
    cell = lambda p: (int(y1 - p[1]), int(p[0] - x0))
    source, target = cell(start), cell(end)
    best = np.full(smooth.shape, np.inf)
    best[source] = 0
    came, queue = {}, [(0, source)]
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1),
             (-2, -1), (-2, 1), (2, -1), (2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2)]
    while queue:
        cost, (r, c) = heapq.heappop(queue)
        if (r, c) == target:
            break
        if cost > best[r, c]:
            continue
        for dr, dc in steps:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < rows and 0 <= cc < cols):
                continue
            length = math.hypot(dr, dc)
            ux, uy = dc / length, -dr / length
            rise = abs(smooth[rr, cc] - smooth[r, c]) / length
            side = abs(-uy * (gx[r, c] + gx[rr, cc]) / 2 + ux * (gy[r, c] + gy[rr, cc]) / 2)
            total = cost + length * (1 + 5 * (rise / grade)**2 + 5 * (side / cross)**2)
            if total < best[rr, cc]:
                best[rr, cc] = total
                came[(rr, cc)] = (r, c)
                heapq.heappush(queue, (total, (rr, cc)))
    path = [target]
    while path[-1] != source:
        path.append(came[path[-1]])
    return [[x0 + c + .5, y1 - r - .5] for r, c in reversed(path)]


def thin(pts, tolerance):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    d = b - a
    gaps = [abs(d[0] * (q[1] - a[1]) - d[1] * (q[0] - a[0])) / np.hypot(*d) for q in pts[1:-1]]
    k = int(np.argmax(gaps)) + 1
    if gaps[k - 1] > tolerance:
        return thin(pts[:k + 1], tolerance)[:-1] + thin(pts[k:], tolerance)
    return [pts[0], pts[-1]]


def round_off(pts, passes):
    for _ in range(passes):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [[.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]], [.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]]]
        pts = out + [pts[-1]]
    return pts


def every(pts, step):
    run = [0]
    for a, b in zip(pts, pts[1:]):
        run.append(run[-1] + math.dist(a, b))
    count = max(1, round(run[-1] / step))
    out = []
    for k in range(count + 1):
        s = run[-1] * k / count
        i = min(len(pts) - 2, max(0, int(np.searchsorted(run, s)) - 1))
        t = (s - run[i]) / (run[i + 1] - run[i])
        out.append([round(pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), 2), round(pts[i][1] + t * (pts[i + 1][1] - pts[i][1]), 2)])
    return out


def shape(pts, tolerance=1.0, step=3.0):
    return every(round_off(thin(pts, tolerance), 3), step)


def beside(building, u, v):
    """A point `u` metres along a hand building's length and `v` across it (positive v is the back, away from its front)."""
    a = math.radians(building['axisDeg'])
    return [round(building['x'] + u * math.sin(a) - v * math.cos(a), 2), round(building['y'] + u * math.cos(a) + v * math.sin(a), 2)]


def on_road(roads, name, point):
    best = None
    for road in roads:
        if road['name'] != name:
            continue
        for a, b in zip(road['pts'], road['pts'][1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
            q = [a[0] + t * dx, a[1] + t * dy]
            if best is None or math.dist(point, q) < best[0]:
                best = (math.dist(point, q), q)
    return [round(best[1][0], 2), round(best[1][1], 2)]


def driveways(roads):
    hand = {b['id']: b for b in json.loads(OBSERVED.read_text())['buildings']}
    house, garage = hand[900007], hand[900011]
    traced = least_cost(MINES['box'], MINES['start'], MINES['end'])
    drive = shape(MINES['head'] + traced + MINES['tail'] + [beside(house, 2, 10.5)])
    mines = [dict(halfWidth=1.5, pts=drive), dict(halfWidth=3.0, pts=[drive[-1], beside(house, -9, 10.5)])]
    first, second = CAMERA
    mouth = on_road(roads, 'Meadow Road', first)
    length = math.dist(mouth, second)
    u = ((second[0] - mouth[0]) / length, (second[1] - mouth[1]) / length)
    apron = [[round(first[0] + k * u[0] * 6, 2), round(first[1] + k * u[1] * 6, 2)] for k in (-1, 1)]
    door = beside(garage, 9, -7.5)
    meadow = [dict(halfWidth=1.5, pts=every([mouth, apron[0]], 3)), dict(halfWidth=3.0, pts=apron),
              dict(halfWidth=1.5, pts=shape([apron[1], second, door], tolerance=.01)),
              dict(halfWidth=2.5, pts=[door, beside(garage, -4, -7.5)])]
    return [mines, meadow]


if __name__ == '__main__':
    check = '--check' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--check']
    roads = json.loads(Path(args[0] if args else ROOT/'data/baked/terrain/roads.json').read_bytes())['roads']
    made = driveways(roads)
    if not check:
        print(json.dumps(made))
        sys.exit()
    committed = [d['pieces'] for d in json.loads(OBSERVED.read_text())['driveways']]
    assert made == committed, 'the committed driveways are not what this tool draws on these roads'
    print(f'PASS the committed driveways are this tool\'s lines: {sum(len(p) for p in made)} pieces')
