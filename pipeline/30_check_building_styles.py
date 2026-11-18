#!/usr/bin/env python3
"""Step 30 (30_bake_building_styles.py) on a made-up land with blocks, tanks and landmarks. Plain Python 3.

    python3 pipeline/30_check_building_styles.py

1. A block or a tank is no candidate for a landmark, also when it is the nearest building or the only one in range.
2. Large buildings change nothing for the other buildings: their paint, the landmarks and the neighbours are equal
   with and without the blocks and tanks on the land.
3. On a land without blocks and tanks, the step writes the same bytes with the filter and without it.
4. The check can fail: a copy of the step without the filter (the mutant) gives a landmark's paint to a block.

It writes only to a temporary folder. The counts of walls and roofs are the real observed ones; the buildings, the
roads and the landmarks are made up.
"""
import contextlib
import io
import json
import math
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).parent
STEP = HERE / '30_bake_building_styles.py'
SOURCE = STEP.read_text()
FILTER = "if 'shape' not in b and math.hypot("
assert SOURCE.count(FILTER) == 1, 'the filter that keeps blocks and tanks out of the landmark candidates'


def load(text):
    module = types.ModuleType('building_styles')
    module.__file__ = str(STEP)
    exec(compile(text, str(STEP), 'exec'), module.__dict__)
    module.AREA = types.SimpleNamespace(style_seed='check', observed_styles=None)
    return module


step, mutant = load(SOURCE), load(SOURCE.replace(FILTER, "if math.hypot("))


def item(bid, x, y, kind, length=12, width=8, **more):
    half = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    return dict(id=bid, x=x, y=y, ground=10, footprint=[[x + i * length / 2, y + j * width / 2] for i, j in half],
                axisDeg=90, length=length, width=width, eave=3, ridge=5.5, roof='gable', kind=kind, confidence=.9,
                nearRoad=1, roadDist=y, **more)


def tank(bid, x, y, diameter):
    turns = [k * math.pi / 16 for k in range(32)]
    return dict(item(bid, x, y, 'large', diameter, diameter, shape='tank'),
                footprint=[[x - diameter / 2 * math.sin(t), y + diameter / 2 * math.cos(t)] for t in turns])


site = item(7, 400, 30, 'house', 14, 9)
PLAIN = [item(1, 100, 30, 'house'), item(2, 200, 60, 'large', 40, 20), item(6, 318, 40, 'barn', 20, 10),
         item(7, 402, 31, 'house', 10, 9, buildingId=7, site=site), item(8, 396, 28, 'house', 5, 4, buildingId=7)]
LARGE = [item(3, 205, 60, 'large', 30, 20, shape='block', buildingId=3), item(4, 232, 60, 'large', 24, 20, shape='block', buildingId=3),
         tank(5, 300, 40, 30), item(9, 500, 50, 'large', 60, 30, shape='block')]
ROADS = [dict(id=1, pts=[[0, 0], [600, 0]]), dict(id=2, pts=[[250, 0], [250, 200]])]
LANDMARKS = [
    # A block of a large building is 1 m from this point; the hall that the land had before is 6 m from it.
    dict(what='made-up hall', kind='large', east=206, north=60, within=25, storeys=1, wall='red', roof='dark grey'),
    # Only a tank is in range.
    dict(what='made-up shop', kind='house', east=301, north=40, within=6, storeys=2, wall='blue'),
    dict(what='made-up barn', kind='barn', east=316, north=40, within=30, storeys=1, wall='dark red', silo=True),
    dict(what='made-up house', kind='house', east=101, north=30, within=15, storeys=2, wall='white', entrance='front porch'),
    # Only a block that is a building by itself is in range.
    dict(what='made-up mill', kind='large', east=500, north=52, within=10, storeys=1, wall='grey'),
]
real = json.loads((HERE / 'observed_styles.json').read_text())
OBSERVED = dict(houses=real['houses'], farmBuildings=real['farmBuildings'], landmarks=LANDMARKS)
ids = lambda data: [match['id'] for match in data['landmarks']]
text = lambda data: json.dumps(data, separators=(',', ':'), sort_keys=True)

# 1. Blocks and tanks are no candidates.
both = step.bake(PLAIN + LARGE, ROADS, OBSERVED)
assert ids(both) == [2, None, 6, 1, None], ids(both)
shapes = {b['id'] for b in LARGE}
assert not shapes & set(ids(both)) and both['landmarks'][0]['distance'] == 6
assert both['styles']['2']['wallName'] == 'red' and both['styles']['2']['roofName'] == 'dark grey', 'the hall keeps its paint'
bare = step.bake(PLAIN + LARGE, ROADS, dict(OBSERVED, landmarks=[]))
for bid in ('3', '5', '9'):
    assert both['styles'][bid] == bare['styles'][bid], f'no landmark changes the paint of large item {bid}'
assert '4' not in both['styles'] and '8' not in both['styles'], 'one style for each building, by its first item'
assert text(both) == text(step.bake(list(reversed(PLAIN + LARGE)), list(reversed(ROADS)), OBSERVED)), 'the order of the input does not count'

# 2. The other buildings do not change when the large ones come.
plain = step.bake(PLAIN, ROADS, OBSERVED)
assert ids(plain) == ids(both) and sorted(plain['styles']) == ['1', '2', '6', '7']
assert text(dict(both, styles={k: both['styles'][k] for k in plain['styles']})) == text(plain)

# 3 and 4. The filter does nothing on a land without large items, and the mutant is caught on a land with them.
assert text(mutant.bake(PLAIN, ROADS, OBSERVED)) == text(plain)
wrong = mutant.bake(PLAIN + LARGE, ROADS, OBSERVED)
assert ids(wrong) == [3, 5, 6, 1, 9], ids(wrong)
assert wrong['styles']['3']['wallName'] == 'red' and wrong['styles']['2'] != both['styles']['2'], 'without the filter the block takes the paint of the hall'


def run(module, items):
    """main() of the step on a land in a temporary folder: the bytes of the two files that it writes."""
    with tempfile.TemporaryDirectory() as folder:
        land = Path(folder)
        (land / 'buildings.json').write_text(json.dumps(dict(crs='EPSG:2961', buildings=items)))
        (land / 'roads.json').write_text(json.dumps(dict(roads=ROADS)))
        (land / 'manifest.json').write_text(json.dumps(dict(mid=[0, 0, 1, 1], buildings=dict(file='buildings.json'))))
        (land / 'observed.json').write_text(json.dumps(OBSERVED))
        saved = module.OUT, module.AREA
        module.OUT, module.AREA = land, types.SimpleNamespace(style_seed='check', observed_styles=str(land / 'observed.json'))
        try:
            with contextlib.redirect_stdout(io.StringIO()) as said:
                module.main()
        finally:
            module.OUT, module.AREA = saved
        assert sorted(p.name for p in land.iterdir()) == ['building-styles.json', 'buildings.json', 'manifest.json', 'observed.json', 'roads.json']
        assert json.loads((land / 'buildings.json').read_text())['buildings'] == items, 'the step does not change the buildings'
        return (land / 'building-styles.json').read_bytes(), (land / 'manifest.json').read_bytes(), said.getvalue()


styles, manifest, said = run(step, PLAIN)
assert (styles, manifest) == run(mutant, PLAIN)[:2], 'a land without large items: the same bytes with and without the filter'
assert json.loads(styles) == plain and json.loads(manifest)['buildingStyles'] == dict(file='building-styles.json', count=4)
styles, manifest, said = run(step, PLAIN + LARGE)
assert json.loads(styles) == both and json.loads(manifest)['buildingStyles']['count'] == 7
assert 'MATCH id 2 at 6.00 m: made-up hall' in said and 'UNMATCHED within 6 m: made-up shop' in said and 'UNMATCHED within 10 m: made-up mill' in said, said
assert ids(json.loads(run(mutant, PLAIN + LARGE)[0])) == [3, 5, 6, 1, 9]
print('PASS: blocks and tanks are no landmark candidates (nearest, and alone in range); the other buildings keep their paint; '
      'a land without large items gives the same bytes; the step without the filter is caught.')
