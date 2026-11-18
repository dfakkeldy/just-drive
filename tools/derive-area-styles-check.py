#!/usr/bin/env python3
"""Check anonymous exports, duplicate handling, thin samples and area wiring."""
import copy
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('derive', ROOT / 'tools/derive-area-styles.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def row(bid, kind, **fields):
    return dict(game_area='judique', game_building_id=str(bid), kind=kind,
                wall_colour='white', roof_colour='grey', trim='white',
                roof_material='metal', porch='front porch', confidence='clear',
                private='PRIVATE_SENTINEL', best_still='PRIVATE_SENTINEL', **fields)

rows = [row(1, 'house'), row(2, 'shed')]
rows.append(dict(rows[0], confidence='glimpse', wall_colour='red'))
rows.append(dict(rows[0], game_area='westbay', game_building_id='3'))
before = copy.deepcopy(rows)
a = m.derive(rows, 'judique')
assert a == m.derive(rows[::-1], 'judique') and rows == before
assert a['sampleCounts'] == dict(matched=2, houses=1, farmBuildings=1)
assert a['houses']['wall'] == {'white': 1}
assert 'PRIVATE_SENTINEL' not in json.dumps(a)
rows[1]['roof_material'] = 'unknown'
assert m.derive(rows, 'judique')['farmBuildings']['roofMaterialKnown'] == {'metal': 1}
rows[0]['wall_colour'] = 'mixed private text'
try:
    m.derive(rows, 'judique')
except ValueError:
    pass
else:
    raise AssertionError('an empty palette must fail')
try:
    m.derive([], 'westbay')
except ValueError:
    pass
else:
    raise AssertionError('no footage must fail')
sys.path.insert(0, str(ROOT / 'pipeline'))
from areas import AREAS
for area in m.AREAS:
    observed = json.loads((ROOT / AREAS[area].observed_styles).read_text())
    assert observed['landmarks'] == []
    assert set(observed) == {'about', 'sampleCounts', 'houses', 'farmBuildings', 'landmarks'}
    for group in ('houses', 'farmBuildings'):
        for field, counts in observed[group].items():
            assert counts and all(type(n) is int and n > 0 for n in counts.values())
            allowed = m.MATERIALS if field == 'roofMaterialKnown' else m.ENTRANCES if field == 'entranceKnown' else m.PAINT
            assert set(counts) <= allowed
assert json.loads((ROOT / AREAS['westbay'].observed_styles).read_text()) == m.pool_westbay(ROOT)
print('PASS: private fields excluded; duplicate/order rules; thin material fallback; missing samples rejected; four filmed palettes wired; West Bay borrowed rural pool reproduced')
