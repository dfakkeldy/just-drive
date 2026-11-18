#!/usr/bin/env python3
"""Bake deterministic paint and cheap details from observed_styles.json. Plain Python 3.

Only building-styles.json and the manifest's buildingStyles key are written.
No video, stills, addresses, or private catalogue records are read or exported.
Measured footprints, heights, orientation and positions are never changed.
"""
from collections import Counter
import hashlib
import json
import os
import math
from pathlib import Path
import random

from areas import current

AREA = current()

ROOT = Path(os.path.abspath(__file__)).parents[1]
OUT = AREA.output
# sRGB paint families, slightly weathered rather than pure primaries.
PAINT = {
    'white': ['#e5e5dd', '#dedfd8', '#e8e7e0'],
    'cream': ['#d9d2b7', '#e1d8be', '#d8cfb1'],
    'grey': ['#969b99', '#a2a5a0', '#8e9493'],
    'brown': ['#82705c', '#786652', '#8d7963'],
    'blue-grey': ['#82969f', '#8b9da4', '#7e9199'],
    'dark blue': ['#344f63', '#3c5669', '#304a5c'],
    'pale yellow': ['#dfd29b', '#e6d9a6', '#dacf9f'],
    'dark red': ['#7b3937', '#873e39', '#733733'],
    'red': ['#a1483e', '#984136', '#a94d41'],
    'blue': ['#567f99', '#6089a0', '#50788f'],
    'pale grey': ['#c9cdca', '#c4cac8', '#d0d2cd'],
    'pink': ['#c6a59f', '#cfafa8', '#c9a69f'],
    'grey-green': ['#87958a', '#919c8e', '#7f8d81'],
    'tan': ['#b6a283', '#c0af91', '#bbaa8c'],
    'dark grey': ['#515657', '#585b5a', '#494f52'],
    'weathered grey': ['#85857a', '#929084', '#7e8078'],
    'light grey': ['#b7bdbb', '#bfc4c0', '#adb5b4'],
    'black': ['#353a3c', '#303639', '#3b3d3c'],
    'red brick': ['#914d3d', '#884637', '#97513f'],
    'weathered cedar': ['#88795f', '#93866b', '#82755f'],
    'green': ['#44624e', '#4e6b56', '#405d49'],
    # Mabou main street (the project brief): paint read from the dash cam, used only by its landmarks.
    'olive green': ['#7f8c4a', '#78854a', '#838f4f'],
    'turquoise': ['#1f9fae', '#2499a7', '#2aa2af'],
    'greige': ['#a8a397', '#a39e92', '#aca89c'],
    'maroon': ['#8a3b36', '#843833', '#8f3f39'],
    'charcoal': ['#3f4245', '#44474a', '#3b3e41'],
    'dark grey-brown': ['#4d4842', '#524c45', '#48443f'],
}


def rng(bid, field):
    seed = hashlib.sha256(f'{AREA.style_seed}:{bid}:{field}'.encode()).digest()
    return random.Random(int.from_bytes(seed[:8], 'big'))


def choice(bid, field, counts):
    # Sorted names make JSON object order irrelevant too.
    names = sorted(counts)
    return rng(bid, field).choices(names, [counts[n] for n in names])[0]


def colour(bid, field, name):
    return rng(bid, field + '-paint').choice(PAINT[name])


def area(b):
    p = b['footprint']
    return abs(sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(p, p[1:] + p[:1]))) / 2


def nearest_road(b, roads):
    best = (math.inf, 0, 0, (b['x'], b['y']))
    for road in roads:
        for i, (a, c) in enumerate(zip(road['pts'], road['pts'][1:])):
            dx, dy = c[0] - a[0], c[1] - a[1]
            den = dx * dx + dy * dy
            t = max(0, min(1, ((b['x'] - a[0]) * dx + (b['y'] - a[1]) * dy) / den)) if den else 0
            p = (a[0] + t * dx, a[1] + t * dy)
            candidate = (math.hypot(p[0] - b['x'], p[1] - b['y']), road['id'], i, p)
            best = min(best, candidate)
    return best[3]


def bake(buildings, roads, observed):
    # Match paint and details against the unchanged property, once per building.
    hand = [b for b in buildings if b.get('source') == 'hand']
    buildings = sorted((b.get('site', b) for b in buildings if b.get('source') != 'hand'
                        and b.get('buildingId', b['id']) == b['id']), key=lambda b: b['id'])
    styles = {}
    for b in buildings:
        bid = b['id']
        house = b['kind'] == 'house'
        counts = observed['houses' if house else 'farmBuildings']
        wall = choice(bid, 'wall', counts['wall'])
        roof = choice(bid, 'roof', counts['roof'])
        trim = choice(bid, 'trim', observed['houses']['trim']) if house else 'white'
        material = choice(bid, 'material', counts['roofMaterialKnown'])
        # Entrance counts are conditional on an entrance being visible, not all houses.
        entrance = choice(bid, 'entrance', observed['houses']['entranceKnown']) if house and rng(bid, 'entrance-known').random() < 35 / 109 else 'none'
        # Details were frequent but not counted. These rates are visual estimates, not measurements.
        flags = {name: house and rng(bid, name).random() < rate for name, rate in
                 [('chimney', .40), ('dormer', .23), ('shutters', .18), ('satelliteDish', .25)]}
        flags['dormer'] &= b['roof'] == 'gable' and 2.3 < b['eave'] < 4.3 and b['ridge'] - b['eave'] > 1.8
        flags['skirting'] = house and b['eave'] < 3.2 and b['length'] / b['width'] > 2.2
        flags['silo'] = False
        styles[str(bid)] = dict(wall=colour(bid, 'wall', wall), roof=colour(bid, 'roof', roof),
                                trim=colour(bid, 'trim', trim), wallName=wall, roofName=roof,
                                roofMaterial='metal' if material == 'metal' else 'shingle', entrance=entrance, **flags)

    matches = []
    for lm in observed['landmarks']:
        # Blocks and tanks ("shape") are no candidates. Every landmark was observed on a building that the land had
        # before them, and a new block nearer to the point must not take that building's paint.
        near = [b for b in buildings if 'shape' not in b and math.hypot(b['x'] - lm['east'], b['y'] - lm['north']) <= lm['within']]
        candidates = [b for b in near if b['kind'] == lm['kind']]
        # The LiDAR bake's guess at a building's kind is often wrong for one-off buildings (a brick post office
        # filed as a house, a store as a barn). The position is the trustworthy part: fall back to any kind.
        if not candidates:
            candidates = near
        if not candidates:
            matches.append(dict(what=lm['what'], id=None, within=lm['within']))
            continue
        # Nearest wins. (Choosing the largest building in range painted the house beside the post office.)
        candidates = near if lm['kind'] == 'large' else candidates
        key = lambda b: (math.hypot(b['x'] - lm['east'], b['y'] - lm['north']), b['id'])
        b = min(candidates, key=key)
        bid = b['id']
        s = styles[str(bid)]
        for field in ('wall', 'roof', 'trim'):
            if field in lm:
                s[field] = colour(bid, field, lm[field])
                if field != 'trim':
                    s[field + 'Name'] = lm[field]
        for field in ('entrance', 'roofMaterial', 'roofShape'):
            if field in lm:
                s[field] = lm[field]
        # Keep storeys as observed information; window rows must still fit the measured eave.
        s['observedStoreys'] = lm['storeys']
        if 'entrance' in lm and lm['entrance'] != 'none':
            s['dormer'] = False
        match = dict(what=lm['what'], id=bid, distance=round(math.hypot(b['x'] - lm['east'], b['y'] - lm['north']), 2))
        if lm.get('silo'):
            road = nearest_road(b, roads)
            a = math.radians(b['axisDeg'])
            ux, uy = math.sin(a), math.cos(a)
            # The end away from the nearest road segment, 0.7 m clear of the barn end.
            sign = -1 if (road[0] - b['x']) * ux + (road[1] - b['y']) * uy > 0 else 1
            u = sign * (b['length'] / 2 + 3.2)
            s['silo'] = True
            s['siloPosition'] = dict(u=round(u, 3), v=0, diameter=5, height=14)
            match['silo'] = dict(east=round(b['x'] + u * ux, 2), north=round(b['y'] + u * uy, 2),
                                 end='positive ridge axis' if sign > 0 else 'negative ridge axis', ground='matched barn ground')
        matches.append(match)

    # Apply after landmark paint, so nearby sheds can inherit its final colour.
    houses = [b for b in buildings if b['kind'] == 'house']
    landmark_ids = {m['id'] for m in matches}
    inherited = eligible = 0
    for b in buildings:
        if b['kind'] not in ('barn', 'shed') or b['id'] in landmark_ids:
            continue
        near = min(houses, key=lambda h: (math.hypot(h['x'] - b['x'], h['y'] - b['y']), h['id']), default=None)
        if near and math.hypot(near['x'] - b['x'], near['y'] - b['y']) <= 30:
            eligible += 1
            if rng(b['id'], 'match-house').random() < .5:
                s, h = styles[str(b['id'])], styles[str(near['id'])]
                s['wall'], s['wallName'], s['matchedHouse'] = h['wall'], h['wallName'], near['id']
                inherited += 1

    # Road-facing entrance, shared by doors, porches, dormers and dishes.
    road_by_id = {r['id']: r for r in roads}
    for b in buildings:
        if b['kind'] != 'house':
            continue
        p = nearest_road(b, [road_by_id[b['nearRoad']]]) if b.get('nearRoad') in road_by_id else nearest_road(b, roads)
        a = math.radians(b['axisDeg'])
        dx, dy = p[0] - b['x'], p[1] - b['y']
        u, v = dx * math.sin(a) + dy * math.cos(a), dx * math.cos(a) - dy * math.sin(a)
        end = abs(u) / b['length'] > abs(v) / b['width']
        styles[str(b['id'])]['front'] = dict(end=end, side=1 if (u if end else v) >= 0 else -1)
    from dashcam_corrections import hand_styles
    return hand_styles(dict(version=1, styles=styles, landmarks=matches,
                neighbours=dict(radius=30, eligible=eligible, inherited=inherited),
                notes='Detail probabilities are estimates. Landmark storeys and roof shapes do not change measured envelopes.'
                + (' ' + observed['about'] if 'sourceBuildingCounts' in observed else '')), hand, roads)


def report(data, buildings, observed):
    buildings = [b.get('site', b) for b in buildings if b.get('buildingId', b['id']) == b['id']]
    houses = [b for b in buildings if b['kind'] == 'house']
    actual = Counter(data['styles'][str(b['id'])]['wallName'] for b in houses)
    total = sum(observed['houses']['wall'].values())
    print(f"Styles: {len(data['styles'])}; houses: {len(houses)}. House wall share: baked / observed / difference (percentage points)")
    for name, count in observed['houses']['wall'].items():
        a, o = actual[name] / len(houses) * 100, count / total * 100
        print(f'  {name:15} {a:5.1f}% / {o:5.1f}% / {a-o:+4.1f}')
    for match in data['landmarks']:
        if match['id'] is None:
            print(f"UNMATCHED within {match['within']} m: {match['what']}")
        else:
            print(f"MATCH id {match['id']} at {match['distance']:.2f} m: {match['what']}")
            if 'silo' in match:
                print('  Silo:', json.dumps(match['silo']))
    n = data['neighbours']
    print(f"Outbuildings inheriting house paint: {n['inherited']}/{n['eligible']} within {n['radius']} m (centre to centre)")
    print('Detail rates are estimates; colour/material/entrance weights are conditional counts or borrowed rates. Heights and footprints are unchanged.')
    if 'sourceBuildingCounts' in observed:
        print(observed['about'])


def main():
    observed = json.loads((ROOT / AREA.observed_styles).read_text()) if AREA.observed_styles else None
    buildings = json.loads((OUT / 'buildings.json').read_text())['buildings']
    roads = json.loads((OUT / 'roads.json').read_text())['roads']
    data = bake(buildings, roads, observed) if observed else dict(version=1, styles={}, landmarks=[],
        notes='No observed building styles for this area.')
    # An order-independence check runs on the real inputs before writing anything.
    if observed:
        assert data == bake(list(reversed(buildings)), list(reversed(roads)), observed)
    (OUT / 'building-styles.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
    # Re-read immediately before the update: other bakes own other manifest keys.
    path = OUT / 'manifest.json'
    manifest = json.loads(path.read_text())
    manifest['buildingStyles'] = dict(file='building-styles.json', count=len(data['styles']))
    path.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    if observed:
        report(data, buildings, observed)


if __name__ == '__main__':
    main()
