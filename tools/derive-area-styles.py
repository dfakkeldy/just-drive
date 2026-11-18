#!/usr/bin/env python3
"""Export anonymous area palette counts from a locally held building catalogue.

Run on the MacBook. No stills are opened. Only allowlisted paint families,
material/entrance counts and sample counts are written; no source rows or paths.
Unknown or mixed colours are excluded rather than guessed. The output feeds
step 30's existing deterministic area palette; it does not locate buildings.
"""
import argparse
from collections import Counter
from fractions import Fraction
from functools import reduce
from math import gcd, lcm
import csv
import json
from pathlib import Path
import platform

AREAS = ('judique', 'porthood', 'pointtupper', 'cansocauseway')
PAINT = set(('white,cream,grey,brown,blue-grey,dark blue,pale yellow,dark red,red,blue,pale grey,pink,grey-green,tan,dark grey,weathered grey,light grey,black,red brick,weathered cedar,green').split(','))
ALIASES = {'gray': 'grey', 'dark gray': 'dark grey', 'light gray': 'light grey',
           'blue grey': 'blue-grey', 'grey green': 'grey-green'}
HOUSES = {'house', 'mobile home', 'cottage'}
FARM = {'barn', 'shed', 'garage'}
ENTRANCES = {'none', 'front porch', 'small steps', 'deck', 'wrap-around'}
MATERIALS = {'metal', 'asphalt shingle'}


def counts(rows, field, allowed, aliases=None):
    values = [str(row.get(field, '')).strip().lower() for row in rows]
    values = [(aliases or {}).get(v, v) for v in values]
    return dict(sorted(Counter(v for v in values if v in allowed).items()))


def derive(rows, area):
    # Use the catalogue's resolved game area, never road names or free text.
    rows = [r for r in rows if r.get('game_area') == area]
    if not rows:
        raise ValueError('No matched observations for area; skip it')
    # Multiple records matched to one building must count only once. Prefer
    # clear views, then partial views; ties use only the allowlisted fields.
    fields = ('kind', 'wall_colour', 'roof_colour', 'trim', 'roof_material', 'porch')
    rank = {'clear': 2, 'partial': 1, 'glimpse': 0}
    unique = {}
    for r in rows:
        bid = r.get('game_building_id', '')
        if not bid:
            continue
        key = (rank.get(r.get('confidence'), -1), tuple(r.get(f, '') for f in fields))
        if bid not in unique or key > unique[bid][0]:
            unique[bid] = (key, r)
    rows = [value[1] for value in unique.values()]
    houses = [r for r in rows if r.get('kind') in HOUSES]
    farms = [r for r in rows if r.get('kind') in FARM]
    def group(sample):
        return dict(wall=counts(sample, 'wall_colour', PAINT, ALIASES),
                    roof=counts(sample, 'roof_colour', PAINT, ALIASES),
                    roofMaterialKnown=counts(sample, 'roof_material', MATERIALS))
    h, f = group(houses), group(farms)
    h['trim'] = counts(houses, 'trim', PAINT, ALIASES)
    h['entranceKnown'] = counts(houses, 'porch', ENTRANCES)
    pooled_material = counts(houses + farms, 'roof_material', MATERIALS)
    for section in (h, f):
        if not section['roofMaterialKnown']:
            section['roofMaterialKnown'] = pooled_material
    # Do not fill thin samples with Mabou's observations or invented counts.
    for section in (h, f):
        if any(not value for value in section.values()):
            raise ValueError('Insufficient observations for an area palette')
    return dict(about='Derived palette counts from the owner’s 12 November 2026 dash cam catalogue. One resolved game-building match per sample; houses include cottages and mobile homes, farm buildings include sheds and garages. Unknown and mixed colours are excluded. Only spelling aliases are normalized. A group with no known roof materials uses the pooled house and farm roof-material counts from this area. These are area distributions, not per-building paint matches. Existing step 30 detail rates remain estimates.',
                sampleCounts=dict(matched=len(rows), houses=len(houses), farmBuildings=len(farms)),
                houses=h, farmBuildings=f, landmarks=[])


# West Bay: rates pooled from filmed rural areas (Judique, Port Hood, Mabou); no West Bay observation.
# Use only the committed anonymous counts. Keep a separate per-area file so later
# West Bay observations can replace this pool without changing step 30.
WESTBAY_SOURCE = 'West Bay: rates pooled from filmed rural areas (Judique, Port Hood, Mabou); no West Bay observation.'
RURAL_PALETTES = ('judique', 'porthood', 'mabou')
POOL_FIELDS = {'houses': ('wall', 'roof', 'roofMaterialKnown', 'trim', 'entranceKnown'),
               'farmBuildings': ('wall', 'roof', 'roofMaterialKnown')}


def pool_westbay(root):
    sources = {}
    weights = {}
    for area in RURAL_PALETTES:
        name = 'observed_styles.json' if area == 'mabou' else f'observed_styles_{area}.json'
        sources[area] = json.loads((root / 'pipeline' / name).read_text())
        # Mabou predates sampleCounts; these are the building counts in its
        # committed houses/farmBuildings notes, not its per-field known totals.
        weights[area] = (dict(houses=109, farmBuildings=51) if area == 'mabou' else
                         {group: sources[area]['sampleCounts'][group] for group in POOL_FIELDS})
    for group, n in weights['mabou'].items():
        if f'{n} seen' not in sources['mabou'][group]['note']:
            raise ValueError('Mabou sample notes changed; review the borrowed building counts')
    result = dict(about=WESTBAY_SOURCE + ' Separate area slot allows later correction. Each field pools conditional rates weighted by the number of buildings in its house or farm sample. Integer weights are exact relative rates, not West Bay observations. Entrance visibility keeps step 30’s existing 35/109 estimate. Other step 30 detail rates remain estimates.',
                  sourceBuildingCounts=weights, landmarks=[])
    for group, fields in POOL_FIELDS.items():
        result[group] = {}
        for field in fields:
            rates = Counter()
            for area in RURAL_PALETTES:
                counts = sources[area][group][field]
                allowed = MATERIALS if field == 'roofMaterialKnown' else ENTRANCES if field == 'entranceKnown' else PAINT
                if not counts or not set(counts) <= allowed or any(type(n) is not int or n <= 0 for n in counts.values()):
                    raise ValueError(f'Invalid rural counts: {area}/{group}/{field}')
                for name, count in counts.items():
                    rates[name] += Fraction(count * weights[area][group], sum(counts.values()))
            denominator = lcm(*(rate.denominator for rate in rates.values()))
            integers = {name: int(rate * denominator) for name, rate in sorted(rates.items())}
            divisor = reduce(gcd, integers.values())
            result[group][field] = {name: n // divisor for name, n in integers.items()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', required=True, type=Path)
    parser.add_argument('--area', required=True, choices=AREAS)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if platform.system() != 'Darwin':
        parser.error('Private catalogue processing must run on the MacBook')
    with args.catalogue.open(newline='') as source:
        result = derive(list(csv.DictReader(source)), args.area)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(args.area, result['sampleCounts'])


if __name__ == '__main__':
    main()
