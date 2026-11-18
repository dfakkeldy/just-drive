#!/usr/bin/env python3
"""Measure how well the baked ground fits the road lines. Reads baked tiles only; writes nothing into them.

For a point every 5 m along every road centre line where level-8 land (1 m samples) exists:
  cross   the ground's slope across the road: (height at the left edge - height at the right edge) / width
  rough   the second difference of the centre-line height at 2 m steps (how lumpy the line is to drive along)
  bench   how far to the side the real road bed lies: within +-8 m across the line, the strip of road width
          that is flattest and straightest across (road_ground.find_bed); counted only where it is clearly better
          than the line, 1.5 m or more away, and found over 30 m or more

Usage (local GDAL python, or the GDAL container):
  python3 pipeline/road_ground_measure.py [--baked DIR] [--roads FILE] [--out FILE.json] [--box x0,y0,x1,y1]
"""
import argparse
import collections
import json
import math
import os

import numpy as np

import road_ground as rg

STEP, REACH = rg.STEP, rg.REACH
KINDS = {1: 'highway', 2: 'paved', 3: 'gravel', 4: 'track', 5: 'rail trail'}


def measure_road(ground, road):
    line = rg.Line(road['pts'])
    bed = rg.find_bed(ground, line, road['halfWidth']) if line.length > 0 else None
    if bed is None:
        return None
    s, hw = bed['s'], road['halfWidth']
    xy, left = line.at(s), line.left(s)
    centre = ground.at(xy[:, 0], xy[:, 1])
    ahead, behind = line.at(s + 2), line.at(s - 2)
    rough = np.abs(ground.at(ahead[:, 0], ahead[:, 1]) - 2 * centre + ground.at(behind[:, 0], behind[:, 1]))
    edge_l = ground.at(xy[:, 0] + left[:, 0] * hw, xy[:, 1] + left[:, 1] * hw)
    edge_r = ground.at(xy[:, 0] - left[:, 0] * hw, xy[:, 1] - left[:, 1] * hw)
    cross = (edge_l - edge_r) / (2 * hw)
    ok = bed['ok'] & np.isfinite(centre) & np.isfinite(cross) & np.isfinite(rough)
    return dict(s=s, xy=xy, centre=centre, cross=cross, rough=rough, offset=np.where(ok, bed['offset'], 0.0),
                rawOffset=bed['raw'], gain=bed['gain'], ok=ok)


def pct(a, q):
    return float(np.percentile(a, q)) if len(a) else float('nan')


def summarise(rows):
    out = {}
    for kind, name in KINDS.items():
        sel = [r for r in rows if r['kind'] == kind and not r['bridge']]
        if not sel:
            continue
        cross = np.concatenate([np.abs(r['cross'][r['ok']]) for r in sel]) * 100
        rough = np.concatenate([r['rough'][r['ok']] for r in sel]) * 100
        off = np.concatenate([np.abs(r['offset'][r['ok']]) for r in sel])
        out[name] = dict(km=round(len(cross) * STEP / 1000, 1),
                         crossMedianPct=round(pct(cross, 50), 1), crossP90Pct=round(pct(cross, 90), 1),
                         crossOver8PctShare=round(float((cross > 8).mean()) * 100, 1),
                         crossOver15PctShare=round(float((cross > 15).mean()) * 100, 1),
                         roughMedianCm=round(pct(rough, 50), 1), roughP90Cm=round(pct(rough, 90), 1),
                         roughOver10CmShare=round(float((rough > 10).mean()) * 100, 1),
                         benchOffShare=round(float((off >= 1.5).mean()) * 100, 1),
                         benchOffMedianM=round(pct(off[off >= 1.5], 50), 1) if (off >= 1.5).any() else 0.0)
    return out


def worst(rows, window=100.0, count=10, per_road=2):
    """The worst 100 m stretches of named roads by mean cross slope; at most `per_road` per road name."""
    n = int(window / STEP)
    found = []
    for r in rows:
        if r['bridge'] or not r['name'] or r['kind'] == 4:
            continue
        ok = r['ok']
        if ok.sum() < n:
            continue
        c = np.where(ok, np.abs(r['cross']), np.nan)
        for a in range(0, len(c) - n + 1, n // 2):
            w = c[a:a + n]
            if np.isfinite(w).sum() < n * 0.9:
                continue
            mid = a + n // 2
            found.append(dict(name=r['name'], id=r['id'], kind=KINDS[r['kind']], east=round(float(r['xy'][mid, 0]), 1),
                              north=round(float(r['xy'][mid, 1]), 1), at=round(float(r['s'][mid])),
                              crossMeanPct=round(float(np.nanmean(w)) * 100, 1),
                              crossMaxPct=round(float(np.nanmax(w)) * 100, 1),
                              roughMeanCm=round(float(np.nanmean(r['rough'][a:a + n])) * 100, 1),
                              offsetMedianM=round(float(np.median(r['rawOffset'][a:a + n])), 1),
                              heading=round(math.degrees(math.atan2(r['xy'][min(mid + 1, len(c) - 1), 0] - r['xy'][mid - 1, 0],
                                                                    r['xy'][min(mid + 1, len(c) - 1), 1] - r['xy'][mid - 1, 1])) % 360)))
    found.sort(key=lambda f: -f['crossMeanPct'])
    out, seen, places = [], collections.Counter(), []
    for f in found:
        if seen[f['name']] >= per_road or any(math.hypot(f['east'] - e, f['north'] - nn) < 150 for e, nn in places):
            continue
        seen[f['name']] += 1
        places.append((f['east'], f['north']))
        out.append(f)
        if len(out) == count:
            break
    return out


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--baked', default=f'{root}/data/baked/terrain')
    ap.add_argument('--roads', help='roads.json to measure along (default: the baked folder\'s own)')
    ap.add_argument('--dem', help='measure on a 1 m source model (a GDAL raster) and not on baked tiles')
    ap.add_argument('--out')
    ap.add_argument('--box', help='only stations inside x0,y0,x1,y1 (EPSG:2961)')
    ap.add_argument('--stations', help='write every station to this .npz file')
    args = ap.parse_args()
    ground = rg.DemSampler(args.dem) if args.dem else rg.TileGround(args.baked)
    network = json.load(open(args.roads or f'{args.baked}/roads.json'))['roads']
    box = [float(v) for v in args.box.split(',')] if args.box else None
    rows = []
    for road in network:
        m = measure_road(ground, road)
        if m is None:
            continue
        if box:
            m['ok'] &= (m['xy'][:, 0] >= box[0]) & (m['xy'][:, 0] <= box[2]) & (m['xy'][:, 1] >= box[1]) & (m['xy'][:, 1] <= box[3])
        if not m['ok'].any():
            continue
        rows.append(dict(id=road['id'], name=road['name'], kind=road['kind'], bridge=road['bridge'],
                         washboard=bool(road.get('washboard')), **m))
    report = dict(baked=args.baked, step=STEP, reach=REACH, classes=summarise(rows), worst=worst(rows))
    named = collections.defaultdict(list)
    for r in rows:
        if r['name'] and not r['bridge'] and r['kind'] != 4:
            named[r['name']].append(r)
    report['roads'] = {name: dict(km=round(sum(int(r['ok'].sum()) for r in rs) * STEP / 1000, 2),
                                  crossMedianPct=round(pct(np.concatenate([np.abs(r['cross'][r['ok']]) for r in rs]) * 100, 50), 1),
                                  crossP90Pct=round(pct(np.concatenate([np.abs(r['cross'][r['ok']]) for r in rs]) * 100, 90), 1),
                                  roughP90Cm=round(pct(np.concatenate([r['rough'][r['ok']] for r in rs]) * 100, 90), 1),
                                  benchOffShare=round(float(np.concatenate([np.abs(r['offset'][r['ok']]) >= 1.5 for r in rs]).mean()) * 100, 1))
                       for name, rs in sorted(named.items())}
    text = json.dumps(report, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        open(args.out, 'w').write(text)
    if args.stations:
        np.savez_compressed(args.stations, **{f"{r['id']}_{k}": r[k] for r in rows
                                              for k in ('s', 'xy', 'centre', 'cross', 'rough', 'offset', 'rawOffset', 'gain', 'ok')})
    print(json.dumps(dict(classes=report['classes'], worst=report['worst']), indent=1))


if __name__ == '__main__':
    main()
