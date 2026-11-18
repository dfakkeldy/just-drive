#!/usr/bin/env python3
"""Read only existing baked land and every road kind. Never bake or change terrain."""
import json
import math
import re
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('coast_survey', ROOT / 'tools/coast-survey.py')
survey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(survey)
source = (ROOT / 'web/src/deckhand.ts').read_text()
site = {k: float(v) for k, v in re.findall(r'\b(e|n|stopE|stopN):([\d.]+)', source)}
roads = json.loads((ROOT / 'data/baked/terrain/roads.json').read_text())['roads']

def gap(e, n):
    best = math.inf
    for r in roads:
        for a, b in zip(r['pts'], r['pts'][1:]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            t = max(0, min(1, ((e-a[0])*dx+(n-a[1])*dy)/(dx*dx+dy*dy or 1)))
            best = min(best, math.hypot(e-a[0]-t*dx, n-a[1]-t*dy)-r['halfWidth'])
    return best

buildings = json.loads((ROOT / 'data/baked/terrain/buildings.json').read_text())['buildings']

def building_gap(e, n):
    best = math.inf
    for building in buildings:
        points = building['footprint']
        inside = False
        for a, b in zip(points, points[1:]+points[:1]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            if (a[1]>n)!=(b[1]>n) and e < a[0]+dx*(n-a[1])/dy:
                inside = not inside
            t = max(0, min(1, ((e-a[0])*dx+(n-a[1])*dy)/(dx*dx+dy*dy or 1)))
            best = min(best, math.hypot(e-a[0]-t*dx, n-a[1]-t*dy))
        if inside:
            return 0
    return best

def check(e, n):
    heights = [survey.height(e+u, n+v) for u in [-.5, 0, .5] for v in [-.5, 0, .5]]
    assert min(heights) > .5, 'figure footprint is in water'
    assert max(heights)-min(heights) < .35, 'figure footprint is too steep'
    assert building_gap(e,n) > 1.0, 'figure is inside or beside a building'
    distance = gap(e, n)
    assert distance > .8, 'figure footprint is on a road'
    return dict(minHeight=min(heights), maxHeight=max(heights), roadEdgeGap=distance)

facts = check(site['e'], site['n'])
# Independent negative controls prove that unsafe relocation fails this same check.
for name, e, n in [('water', 618838, 5110100), ('road', 618870, 5110140)]:
    try:
        check(e, n)
    except AssertionError as error:
        assert name in str(error), f'{name} failed for wrong reason: {error}'
        print('REJECTED', name)
    else:
        raise AssertionError(name+' control survived')
assert survey.height(site['stopE'],site['stopN']) > .5, 'stop is dry'
assert building_gap(site['stopE'],site['stopN']) > 3, 'stopping car overlaps a building'
assert building_gap(618848,5110148)==0, 'old stop must be rejected inside shed'
print('REJECTED old stop in building')
assert math.hypot(site['stopE']-site['e'],site['stopN']-site['n']) < 40
print('PASS Finlay Point placement', json.dumps(facts))
