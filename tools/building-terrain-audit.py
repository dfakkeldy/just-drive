#!/usr/bin/env python3
"""Compare installed building footprints with the nearest baked terrain mesh.

This measures the terrain triangles before runtime site grading and road cuts.
Run with Pillow installed and pass the baked land directory.
"""
import argparse
from collections import Counter, defaultdict
from functools import lru_cache
import json
import math
from pathlib import Path

from PIL import Image


def terrain_sampler(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    levels = sorted(((int(level), set(keys)) for level, keys in manifest['levels'].items()),
                    reverse=True)
    west, north = manifest['origin']
    scale, offset = (manifest['height'][key] for key in ('scale', 'offset'))

    @lru_cache(maxsize=64)
    def tile(level, key):
        with Image.open(root / str(level) / f'{key}.png') as image:
            return image.convert('RGB').tobytes()

    def sample(x, y):
        for level, keys in levels:
            size = manifest['size'] / 2**level
            i, j = math.floor((x - west) / size), math.floor((north - y) / size)
            key = f'{i}_{j}'
            if key not in keys:
                continue
            segments = 128 if level >= 7 else 64
            a, b = ((x - west) / size - i) * segments, ((north - y) / size - j) * segments
            col, row = min(int(a), segments - 1), min(int(b), segments - 1)
            u, v = a - col, b - row
            step = 256 // segments
            pixels = tile(level, key)

            def height(dx, dy):
                k = 3 * step * ((row + dy) * 257 + col + dx)
                return (256 * pixels[k] + pixels[k + 1]) * scale + offset

            if u + v <= 1:
                h = height(0, 0)
                return h + (height(1, 0) - h) * u + (height(0, 1) - h) * v
            h = height(1, 1)
            return h + (height(0, 1) - h) * (1 - u) + (height(1, 0) - h) * (1 - v)
        raise ValueError(f'No baked tile covers {x}, {y}')

    return sample


def audit(baked, output=None):
    failures = []
    counts = Counter()
    for root in [baked / 'terrain', *sorted((baked / 'areas').iterdir())]:
        if not (root / 'buildings.json').is_file():
            continue
        area = 'mabou' if root.name == 'terrain' else root.name
        sample = terrain_sampler(root)
        buildings = json.loads((root / 'buildings.json').read_text())['buildings']
        # Wings of a single ordinary building must retain one shared floor.
        # Blocks and tanks represent separately measured structures.
        def group(building):
            return building['id'] if building.get('shape') else building.get('buildingId', building['id'])

        corners = {b['id']: [sample(x, y) for x, y in b['footprint']] for b in buildings}
        raised = {}
        lows = defaultdict(lambda: math.inf)
        for building in buildings:
            heights = corners[building['id']]
            key = group(building)
            lows[key] = min(lows[key], *heights)
            if max(heights) > building['ground'] + 0.5:
                raised[key] = max(raised.get(key, -math.inf), max(heights))
        for building in buildings:
            heights = corners[building['id']]
            key = group(building)
            if output:
                building.pop('floorGround', None)
                building.pop('foundationGround', None)
                if key in raised:
                    building['floorGround'] = math.ceil(raised[key] * 100) / 100
                    building['foundationGround'] = math.floor(lows[key] * 100) / 100
            excess = max(heights) - building.get('floorGround', building['ground'])
            if excess > 0.5:
                failures.append(dict(area=area, id=building['id'], ground=building['ground'],
                                     heights=heights, excess=excess))
                counts[area] += 1
        if output:
            dest = output / root.relative_to(baked) / 'buildings.json'
            if dest.resolve() == (root / 'buildings.json').resolve():
                raise ValueError('Output must be separate from the installed land')
            dest.parent.mkdir(parents=True, exist_ok=True)
            data = json.loads((root / 'buildings.json').read_text())
            data['buildings'] = buildings
            dest.write_text(json.dumps(data, separators=(',', ':')) + '\n')
        print(f'{area}: {counts[area]} of {len(buildings)}', flush=True)
    return sorted(failures, key=lambda row: -row['excess'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baked', type=Path)
    parser.add_argument('--report', type=Path, help='Write the full list as JSON')
    parser.add_argument('--output', type=Path, help='Write corrected building files to a separate land directory')
    args = parser.parse_args()
    failures = audit(args.baked, args.output)
    print(f'Total: {len(failures)}')
    for row in failures[:20]:
        print(f"{row['area']} {row['id']}: +{row['excess']:.2f} m")
    if args.report:
        args.report.write_text(json.dumps(failures, indent=2) + '\n')
