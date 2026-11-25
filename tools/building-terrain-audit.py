#!/usr/bin/env python3
"""Compare installed building footprints with the nearest baked terrain mesh.

This measures the terrain triangles before runtime site grading and road cuts.
Run with Pillow installed and pass the baked land directory.
"""
import argparse
import base64
import hashlib
from collections import Counter, defaultdict
from functools import lru_cache
import json
import math
from pathlib import Path
import struct

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

    spacing = manifest['size'] / (2**levels[0][0] * 128)
    return sample, (west, north, spacing)


def mesh_extents(points, sample, lattice):
    """The extrema of a clipped triangle lie at its corners."""
    west, north, spacing = lattice
    polygon = [((x - west) / spacing, (north - y) / spacing) for x, y in points]
    edges = list(zip(polygon, polygon[1:] + polygon[:1]))
    xs, ys = zip(*polygon)
    candidates = set(polygon)
    for (ax, ay), (bx, by) in edges:
        # Every possible live-tile mesh grid line and diagonal lies on this lattice.
        for start, end in ((ax, bx), (ay, by), (ax + ay, bx + by)):
            for line in range(math.floor(min(start, end)) + 1, math.ceil(max(start, end))):
                t = (line - start) / (end - start)
                candidates.add((ax + t * (bx - ax), ay + t * (by - ay)))
    for y in range(math.ceil(min(ys)), math.ceil(max(ys))):
        crossings = sorted(ax + (y - ay) * (bx - ax) / (by - ay)
                           for (ax, ay), (bx, by) in edges if (ay > y) != (by > y))
        for left, right in zip(crossings[::2], crossings[1::2]):
            candidates.update((x, y) for x in range(math.ceil(left), math.floor(right) + 1))
    heights = [sample(west + x * spacing, north - y * spacing) for x, y in candidates]
    return min(heights), max(heights)


def audit(baked, output=None, verify=False):
    failures = []
    counts = Counter()
    for root in [baked / 'terrain', *sorted((baked / 'areas').iterdir())]:
        if not (root / 'buildings.json').is_file():
            continue
        area = 'mabou' if root.name == 'terrain' else root.name
        sample, lattice = terrain_sampler(root)
        companion = root / 'building-foundations.json'
        installed = json.loads(companion.read_text()) if companion.is_file() else {}
        corrections = {}
        source_bytes = (root / 'buildings.json').read_bytes()
        source_hash = hashlib.sha256(source_bytes).hexdigest()
        buildings = json.loads(source_bytes)['buildings']
        installed_floors = {}
        if installed.get('source') == source_hash:
            building_id = 0
            for delta, raise_cm, depth_cm in struct.iter_unpack('<IHH', base64.b64decode(installed['rows'], validate=True)):
                building_id += delta
                installed_floors[building_id] = raise_cm
        # Wings of a single ordinary building must retain one shared floor.
        # Blocks and tanks represent separately measured structures.
        def group(building):
            return building['id'] if building.get('shape') else building.get('buildingId', building['id'])

        corners = {b['id']: [sample(x, y) for x, y in b['footprint']] for b in buildings}
        raised = set()
        highs = defaultdict(lambda: -math.inf)
        lows = defaultdict(lambda: math.inf)
        for building in buildings:
            low, high = mesh_extents(building['footprint'], sample, lattice)
            key = group(building)
            lows[key] = min(lows[key], low)
            highs[key] = max(highs[key], high, building['ground'])
            if high > building['ground'] + 0.15:
                raised.add(key)
        for building in buildings:
            heights = corners[building['id']]
            key = group(building)
            if key in raised:
                floor_cm = math.ceil(highs[key] * 100)
                low_cm = math.floor(lows[key] * 100)
                corrections[building['id']] = (floor_cm - round(building['ground'] * 100), floor_cm - low_cm)
            raise_cm = corrections.get(building['id'], (0, 0))[0] if output else installed_floors.get(building['id'], 0)
            floor = building['ground'] + raise_cm / 100
            excess = max(heights) - floor
            if excess > 0.5:
                failures.append(dict(area=area, id=building['id'], ground=building['ground'],
                                     heights=heights, excess=excess))
                counts[area] += 1
        rows = bytearray()
        prev_id = 0
        for building_id, (raise_cm, depth_cm) in sorted(corrections.items()):
            rows.extend(struct.pack('<IHH', building_id - prev_id, raise_cm, depth_cm))
            prev_id = building_id
        companion_data = dict(source=source_hash, rows=base64.b64encode(rows).decode('ascii'))
        if verify and installed != companion_data:
            raise ValueError(f'{area}: foundation data is missing or differs from the current mesh')
        if output:
            dest = output / root.relative_to(baked) / companion.name
            if dest.resolve() == companion.resolve():
                raise ValueError('Output must be separate from the installed land')
            dest.parent.mkdir(parents=True, exist_ok=True)
            temporary = dest.with_suffix('.tmp')
            temporary.write_text(json.dumps(companion_data, separators=(',', ':')) + '\n')
            temporary.replace(dest)
        print(f'{area}: {counts[area]} of {len(buildings)}', flush=True)
    return sorted(failures, key=lambda row: -row['excess'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baked', type=Path)
    parser.add_argument('--report', type=Path, help='Write the full list as JSON')
    parser.add_argument('--output', type=Path, help='Write building foundation companions to a separate land directory')
    parser.add_argument('--verify', action='store_true', help='Require installed companions to match the current mesh')
    args = parser.parse_args()
    failures = audit(args.baked, args.output, args.verify)
    print(f'Total: {len(failures)}')
    for row in failures[:20]:
        print(f"{row['area']} {row['id']}: +{row['excess']:.2f} m")
    if args.report:
        args.report.write_text(json.dumps(failures, indent=2) + '\n')
