"""Mabou main street (the project brief): bounded building corrections. Plain Python 3; no imagery, no network.

Two kinds of correction, both on exact ids that must still sit where the brief found them:
- kinds: a building the bake typed wrong (a post office as a shed, a gas station as a house) gets the right kind.
- replace: a map outline of low confidence (the hall, game 3) becomes measured blocks: a main block and its wings.
  The first block keeps the id and gets the old record as its `site` (the property envelope), like a split wing in
  27_bake_buildings.add_wings; the other blocks get new ids above every measured root id.

Step 27 calls correct_buildings() after the hand buildings; it is idempotent, so a bake with --preserve-sites gives
the same records again. Other areas pass through untouched.
"""
import copy
import json
import math
from pathlib import Path

INPUT = json.loads(Path(__file__).with_name('mabou_main_20261117.json').read_text())
MARK = 'mabou-main-1229'


def _block(original, frame, block):
    """One record from a block given in the brief's local frame (u away from the road, v along it)."""
    ox, oy = frame['origin']
    u = (math.sin(math.radians(frame['u'])), math.cos(math.radians(frame['u'])))
    v = (math.sin(math.radians(frame['v'])), math.cos(math.radians(frame['v'])))
    (u0, u1), (v0, v1) = block['u'], block['v']
    corners = [[round(ox + u[0] * a + v[0] * b, 2), round(oy + u[1] * a + v[1] * b, 2)]
               for a, b in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]
    along_u = block['ridgeAlong'] == 'u'
    length, width = (u1 - u0, v1 - v0) if along_u else (v1 - v0, u1 - u0)
    if length < width:
        raise ValueError(f'{block["part"]}: the ridge must run along the long side')
    axis = (frame['u'] if along_u else frame['v']) % 180
    return dict(original, x=round(sum(p[0] for p in corners) / 4, 2), y=round(sum(p[1] for p in corners) / 4, 2),
                footprint=corners, axisDeg=round(axis, 2), length=round(length, 2), width=round(width, 2),
                eave=block['eave'], ridge=block['ridge'])


def _near(b, entry, what):
    if math.hypot(b['x'] - entry['x'], b['y'] - entry['y']) > .05:
        raise ValueError(f'{what} {entry["id"]} moved since the brief; reconcile mabou_main_20261117.json first')


def correct_buildings(buildings, area, audit=None):
    """The corrected records. With `audit` (step 27's audit rows), each new block gets the row of its building with its
    own id and `buildingId`, as 27_bake_buildings.add_wings does for a split wing; 27_check_buildings wants one row per id."""
    if area != 'mabou':
        return buildings
    result = [copy.deepcopy(b) for b in buildings]
    by_id = {b['id']: b for b in result}
    for entry in INPUT['kinds']:
        b = by_id.get(entry['id'])
        if b is None:
            raise ValueError(f'Building {entry["id"]} is missing; reconcile mabou_main_20261117.json first')
        _near(b, entry, 'Building')
        if b.get('correction') == MARK and b['kind'] == entry['to']:
            continue
        if b['kind'] != entry['from'] or 'buildingId' in b:
            raise ValueError(f'Building {entry["id"]} is a {b["kind"]}, not the {entry["from"]} the brief corrects')
        b['kind'], b['correction'] = entry['to'], MARK
    next_id = max(b['id'] for b in result if b.get('source') != 'hand') + 1
    for entry in INPUT['replace']:
        b = by_id.get(entry['id'])
        if b is None:
            raise ValueError(f'Building {entry["id"]} is missing; reconcile mabou_main_20261117.json first')
        if b.get('correction') == MARK:
            original = b['site']
            done = [x for x in result if x.get('buildingId') == entry['id']]
            wanted = [_block(original, entry['frame'], blk) for blk in entry['blocks']]
            if [x['footprint'] for x in sorted(done, key=lambda x: x['id'] != entry['id'])] != [w['footprint'] for w in wanted]:
                raise ValueError(f'Building {entry["id"]} carries other blocks than mabou_main_20261117.json')
            continue
        _near(b, entry, 'Building')
        if 'buildingId' in b or b['kind'] != entry['kind'] or b['confidence'] > .3:
            raise ValueError(f'Building {entry["id"]} is no longer the low-confidence outline the brief corrects')
        original = copy.deepcopy(b)
        for index, block in enumerate(entry['blocks']):
            item = _block(original, entry['frame'], block)
            item.update(buildingId=entry['id'], confidence=entry['confidence'], correction=MARK)
            if index == 0:
                item['site'] = original
                result[result.index(b)] = item
            else:
                item['id'] = next_id
                next_id += 1
                result.append(item)
                if audit is not None:
                    row = next((r for r in audit if r['id'] == entry['id'] and 'buildingId' not in r), None)
                    if row is None:
                        raise ValueError(f'Building {entry["id"]} has no audit row')
                    audit.append(dict(row, id=item['id'], buildingId=entry['id']))
    return sorted(result, key=lambda b: b['id'])


def is_corrected(b):
    return b.get('correction') == MARK


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(description='Apply the Mabou village delta corrections to a baked Mabou folder: buildings.json and the '
                                'buildings key of its manifest.json (count), as step 27 writes them.')
    p.add_argument('folder', type=Path)
    a = p.parse_args()
    path = a.folder / 'buildings.json'
    doc = json.loads(path.read_text())
    doc['buildings'] = correct_buildings(doc['buildings'], 'mabou')
    path.write_text(json.dumps(doc, separators=(',', ':'), allow_nan=False) + '\n')
    # Other stages write the manifest too. Read it now, change only the buildings key.
    manifest = json.loads((a.folder / 'manifest.json').read_text())
    manifest['buildings'] = dict(file='buildings.json', count=len(doc['buildings']))
    (a.folder / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
