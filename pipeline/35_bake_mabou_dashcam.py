#!/usr/bin/env python3
"""Stage the 18 Nov Mabou correction on a copy of an existing terrain pack: the Harbour Road pavement limit, Weaver
Lane, six hand footprints and the two properties' gravel driveways with their pads (unnamed kind-4 pieces). Trees on
a driveway are dropped from the packed level-8 tree tiles by step 28's road rule (top within half width + 0.7 m of the
line). The other trees keep their packed records; a full step 28 re-bake, which detects afresh, can size a dozen
neighbouring crowns differently and needs a new receipt, like any step-28 re-bake.

Only changed files are emitted. Review them against the source pack before
promotion. The source terrain and its existing roads are read-only.
Check the output with `tools/mabou-dashcam-18nov/receipt.py verify SOURCE OUTPUT`
and promote it with `receipt.py install OUTPUT data/baked` (main thread only),
which sets only the manifest counts this bake owns (buildings, building styles, trees). The paved-lot layer is not
re-baked here: the moved pavement limit leaves terrain/paved stale.
"""
import argparse
import hashlib
import importlib
import json
from pathlib import Path

import numpy as np
from osgeo import gdal

from areas import AREAS
from dashcam_corrections import NOV18, correct_nov18_roads, nov18_driveways, hand_buildings, hand_styles, remap_road_references


def bake(source, output):
    source, output = source.resolve(), output.resolve()
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Output must be a new folder separate from the source terrain')
    area = AREAS['mabou']
    fields = importlib.import_module('25_bake_road_fields')
    if fields.b.AREA.id != area.id:
        raise ValueError('This correction is only for Mabou')
    gdal.UseExceptions()

    def read(name):
        return json.loads((source/name).read_bytes())

    def write(name, doc):
        raw = (json.dumps(doc, separators=(',', ':'), allow_nan=False) + '\n').encode()
        (output/name).write_bytes(raw)
        return raw

    network = read('roads.json')
    manifest = read('manifest.json')
    if manifest['origin'] != list(area.origin):
        raise ValueError('Source terrain is not on the Mabou lattice')
    old = network['roads']
    new = correct_nov18_roads(old, area.id)
    old_by_id = {r['id']: r for r in old}
    changed = [r for r in new if r != old_by_id.get(r['id'])]
    if not changed:
        raise ValueError('Source already has the 18 Nov road correction')
    if 'bed' in network:
        # Step 29 reads the lines before the road-bed move and stops on a road that no longer fits them. The split
        # shortens Harbour Road, so refuse here rather than leave that failure for a later bake.
        road_ground = importlib.import_module('road_ground')
        if (Path(area.overview)/road_ground.BEFORE_BED).is_file():
            try:
                road_ground.lines_before(dict(network, roads=new), area.overview)
            except RuntimeError as error:
                raise ValueError(f'The split no longer fits the lines before the road-bed move: {error}') from None
        else:
            print(f'NOTE: roads.json is marked bed-moved but {road_ground.BEFORE_BED} is not here; a later step 29 needs it')

    buildings = remap_road_references(read('buildings.json'), 'buildings', new)
    buildings_step = importlib.import_module('27_bake_buildings')
    dtm = gdal.Open(str(area.elevation('dtm')))

    def ground(x, y):
        cells = buildings_step.Heights.warp(dtm, (x-1, y-1, x+1, y+1))
        return np.median(cells[cells != buildings_step.NODATA])

    buildings['buildings'] = hand_buildings(buildings['buildings'], area.id, ground, new, observations=NOV18)
    styles = hand_styles(read('building-styles.json'), buildings['buildings'], observations=NOV18)
    manifest['buildings']['count'] = len(buildings['buildings'])
    manifest['buildingStyles']['count'] = len(styles['styles'])
    drives = nov18_driveways(new, area.id)
    added = drives[len(new):]
    if drives[:len(new)] != new or not added:
        raise ValueError('The driveways must come after every other road')
    clear_of_buildings(added, buildings['buildings'])

    prior, split, current = fields.Field(old), fields.Field(new), fields.Field(drives)
    windows, drive_windows = [], []
    for road in changed + added:
        xs, ys = np.array(road['pts']).T
        (drive_windows if road in added else windows).append((xs.min()-13, ys.min()-13, xs.max()+13, ys.max()+13))
    windows += drive_windows

    # Validate each modified sample against the existing pack. Keep the
    # installed height, vegetation and unmodified road samples byte-for-byte.
    tiles = {}
    for level in (5, 6, 7, 8):
        listed = set(manifest['roads']['levels'][str(level)])
        # A driveway field must land on a tile that already has one: the bake never adds a road tile to the manifest.
        size = fields.b.res(level) * 256
        for left, bottom, right, top in drive_windows:
            for i in range(int((left - area.origin[0]) // size), int((right - area.origin[0]) // size) + 1):
                for j in range(int((area.origin[1] - top) // size), int((area.origin[1] - bottom) // size) + 1):
                    x0, y0, x1, y1 = fields.corridor.bounds(level, i, j)
                    if f'{i}_{j}' not in listed and current.near((x0, y0, x1, y1)):
                        raise ValueError(f'A driveway needs road field L{level} {i}_{j}, which the pack does not list')
        for name in manifest['roads']['levels'][str(level)]:
            i, j = map(int, name.split('_'))
            x0, y0, x1, y1 = fields.corridor.bounds(level, i, j)
            if not any(x1 >= left and x0 <= right and y1 >= bottom and y0 <= top
                       for left, bottom, right, top in windows):
                continue
            xs = x0 + np.arange(257) * fields.b.res(level)
            ys = y1 - np.arange(257) * fields.b.res(level)
            before, middle, after = prior.raster(xs, ys), split.raster(xs, ys), current.raster(xs, ys)
            if not np.array_equal(before[0], middle[0]):
                raise ValueError(f'Road distances changed on L{level} {name}')
            # The driveways only take samples that lie nearer to them; every other sample stays the split network's.
            moved = np.any(after != middle, axis=0)
            gap = lambda rgb: np.abs(rgb[0].astype(int) - 128)
            taken = (after[2] == 4 | fields.PAVEMENT_FLAGS['gravel']) & ((middle[2] == 0) | (gap(after) <= gap(middle)))
            if (moved & ~taken).any():
                raise ValueError(f'A driveway changed a sample it is not nearest to on L{level} {name}')
            mask = np.any(before != after, axis=0)
            if not mask.any():
                continue
            path = Path(str(level), f'{name}.r.png')
            installed = gdal.Open(str(source/path)).ReadAsArray()
            if not np.array_equal(installed[:, mask], before[:, mask]):
                raise ValueError(f'Existing road field disagrees with roads.json: {path}')
            installed[:, mask] = after[:, mask]
            tiles[path] = installed

    trees, dropped = drop_trees(source, manifest, current, len(split.a), drive_windows, fields.corridor.bounds)
    manifest['trees']['count'] -= dropped

    output.mkdir(parents=True)
    for path, rgb in tiles.items():
        (output/path).parent.mkdir(exist_ok=True)
        fields.b.write_png(str(output/path), rgb)
    for path, records in trees.items():
        (output/path).parent.mkdir(exist_ok=True)
        records.tofile(output/path)
    network['roads'] = drives
    roads = write('roads.json', network)
    for kind in ('streams', 'props', 'cemeteries'):
        name = kind + '.json'
        prior_data = read(name)
        data = remap_road_references(prior_data, kind, new)
        if kind == 'cemeteries':
            data['roadsSha256'] = hashlib.sha256(roads).hexdigest()
        if data != prior_data:
            write(name, data)
    write('buildings.json', buildings)
    write('building-styles.json', styles)
    write('manifest.json', manifest)
    print(f'Staged {len(tiles)} road field tiles, {len(NOV18["buildings"])} hand footprints and {len(added)} driveway '
          f'pieces; dropped {dropped} trees on them from {len(trees)} tree tiles; in {output}')


def clear_of_buildings(added, buildings, gap=1.0):
    """Every driveway piece keeps `gap` metres between its gravel edge and every footprint, hand ones included."""
    from osgeo import ogr
    for road in added:
        line = ogr.Geometry(ogr.wkbLineString)
        for x, y in road['pts']:
            line.AddPoint_2D(x, y)
        xs, ys = np.array(road['pts']).T
        for b in buildings:
            if not (xs.min()-60 <= b['x'] <= xs.max()+60 and ys.min()-60 <= b['y'] <= ys.max()+60) or 'footprint' not in b:
                continue
            ring = ogr.Geometry(ogr.wkbLinearRing)
            for x, y in b['footprint'] + b['footprint'][:1]:
                ring.AddPoint_2D(x, y)
            polygon = ogr.Geometry(ogr.wkbPolygon)
            polygon.AddGeometry(ring)
            if line.Distance(polygon) < road['halfWidth'] + gap:
                raise ValueError(f'Driveway piece {road["id"]} comes within {line.Distance(polygon):.1f} m of building {b["id"]}')


RECORD = np.dtype([('x', '<u2'), ('y', '<u2'), ('height', 'u1'), ('crown', 'u1'), ('kind', 'u1'), ('seed', 'u1')])


def drop_trees(source, manifest, field, first, windows, bounds):
    """Step 28's road rule on the driveway segments (field segment rows from `first` on): a tree whose top lies within the half
    width + 0.7 m is dropped from the packed tile; the kept records stay byte for byte. Returns {path: kept records} for the tiles that change, and how many were dropped."""
    info = manifest['trees']
    if info['level'] != 8 or info['record'] != RECORD.itemsize:
        raise ValueError('Unexpected tree tiles')
    changed, dropped = {}, 0
    for name in info['tiles']:
        i, j = map(int, name.split('_'))
        x0, y0, x1, y1 = bounds(8, i, j)
        if not any(x1 >= left and x0 <= right and y1 >= bottom and y0 <= top for left, bottom, right, top in windows):
            continue
        path = Path('8', f'{name}.t.bin')
        records = np.fromfile(source/path, dtype=RECORD)
        xs, ys = x0 + records['x'].astype(float)/256, y1 - records['y'].astype(float)/256
        drop = np.zeros(len(records), dtype=bool)
        for n in range(first, len(field.a)):
            drop |= field.d2(xs, ys, n) <= (field.a[n, 4] + .7)**2
        if drop.any():
            if drop.all():
                raise ValueError(f'A driveway would empty tree tile {name}')
            changed[path] = records[~drop]
            dropped += int(drop.sum())
    return changed, dropped


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='existing Mabou terrain pack')
    parser.add_argument('--output', type=Path, required=True, help='new directory for changed files')
    args = parser.parse_args()
    bake(args.source, args.output)
