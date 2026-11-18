#!/usr/bin/env python3
"""Check borrowed rural rates and step 30, optionally on read-only West Bay geometry."""
from collections import Counter
import copy
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


derive = load('derive', 'tools/derive-area-styles.py')
step = load('step', 'pipeline/30_bake_building_styles.py')
from areas import AREAS
step.AREA = AREAS['westbay']
assert step.AREA.observed_styles, 'West Bay must have a palette'
palette = json.loads((ROOT / step.AREA.observed_styles).read_text())
assert palette == derive.pool_westbay(ROOT), 'committed pool must reproduce exactly'
assert palette['about'].startswith(derive.WESTBAY_SOURCE)
assert set(palette) == {'about', 'sourceBuildingCounts', 'houses', 'farmBuildings', 'landmarks'}
assert palette['sourceBuildingCounts'] == {
    'judique': {'houses': 77, 'farmBuildings': 19},
    'porthood': {'houses': 126, 'farmBuildings': 26},
    'mabou': {'houses': 109, 'farmBuildings': 51}}
assert palette['landmarks'] == []
assert 'Separate area slot allows later correction.' in palette['about']
# Hand calculation: farm metal = 19*(1/3) + 26*(4/7) + 51;
# shingle = 19*(2/3) + 26*(3/7). Multiply by 21 and reduce by 4.
assert palette['farmBuildings']['roofMaterialKnown'] == {'asphalt shingle': 125, 'metal': 379}
# Exercise invalid counts without writing source copies or reading private files.
source_path = ROOT / 'pipeline/observed_styles_judique.json'
source = json.loads(source_path.read_text())
read_text = Path.read_text
for invalid in ({}, {'PRIVATE_SENTINEL': 1}, {'white': -1}, {'white': 1.5}):
    bad = copy.deepcopy(source)
    bad['houses']['wall'] = invalid
    with patch.object(Path, 'read_text', lambda path: json.dumps(bad) if path == source_path else read_text(path)):
        try:
            derive.pool_westbay(ROOT)
        except ValueError:
            pass
        else:
            raise AssertionError('invalid counts must fail')
# Free text, landmark positions and unrelated sections never enter the pool.
extra = copy.deepcopy(source)
extra['landmarks'] = [{'what': 'PRIVATE_SENTINEL', 'east': 1, 'north': 2}]
extra['houses']['private'] = 'PRIVATE_SENTINEL'
with patch.object(Path, 'read_text', lambda path: json.dumps(extra) if path == source_path else read_text(path)):
    assert derive.pool_westbay(ROOT) == palette

for group, fields in derive.POOL_FIELDS.items():
    assert set(palette[group]) == set(fields)
    for field in fields:
        expected = Counter()
        for area, weights in palette['sourceBuildingCounts'].items():
            name = 'observed_styles.json' if area == 'mabou' else f'observed_styles_{area}.json'
            counts = json.loads((ROOT / 'pipeline' / name).read_text())[group][field]
            for key, n in counts.items():
                expected[key] += Fraction(n, sum(counts.values())) * weights[group]
        actual = palette[group][field]
        assert all(type(n) is int and n > 0 for n in actual.values())
        assert {key: Fraction(n, sum(actual.values())) for key, n in actual.items()} == {
            key: n / sum(expected.values()) for key, n in expected.items()}, (group, field)

if '--real' in sys.argv:
    land = ROOT / 'data/baked/areas/westbay'
    buildings = json.loads((land / 'buildings.json').read_text())['buildings']
    roads = json.loads((land / 'roads.json').read_text())['roads']
else:
    buildings = [dict(id=i, x=i * 80, y=30, kind='house' if i % 2 else 'barn',
                      footprint=[[0, 0], [12, 0], [12, 8], [0, 8]], axisDeg=90,
                      length=12, width=8, eave=3, ridge=5.5, roof='gable', nearRoad=1)
                 for i in range(1, 81)]
    roads = [dict(id=1, pts=[[0, 0], [7000, 0]])]
before = copy.deepcopy((buildings, roads, palette))
styles = step.bake(buildings, roads, palette)
assert styles == step.bake(buildings[::-1], roads[::-1], palette), 'stable per-building draws'
assert styles == step.bake(buildings, roads, palette), 'repeatable draws'
assert (buildings, roads, palette) == before, 'geometry and palette unchanged'
expected_ids = {str(b['id']) for b in buildings if b.get('buildingId', b['id']) == b['id']}
assert set(styles['styles']) == expected_ids and len(expected_ids) > 0
assert styles['landmarks'] == [], 'no invented West Bay landmark observations'
assert derive.WESTBAY_SOURCE in styles['notes'], 'borrowed provenance survives step 30'
for style in styles['styles'].values():
    assert style['wallName'] in set(palette['houses']['wall']) | set(palette['farmBuildings']['wall'])
    assert style['roofMaterial'] in ('metal', 'shingle')
print(f"PASS: West Bay {'real' if '--real' in sys.argv else 'fixture'} styles {len(expected_ids)} > 0; "
      'rural sample-weighted rates; deterministic draws; geometry unchanged; borrowed source retained')
