#!/usr/bin/env python3
"""Stage the 18 Nov Mabou correction on a copy of an existing terrain pack.

Only changed files are emitted. Review them against the source pack before
promotion. The source terrain and its existing roads are read-only.
"""
import argparse
import hashlib
import importlib
import json
from pathlib import Path

import numpy as np
from osgeo import gdal

from areas import AREAS
from dashcam_corrections import NOV18, correct_nov18_roads, hand_buildings, hand_styles, remap_road_references


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

    prior, current = fields.Field(old), fields.Field(new)
    windows = []
    for road in changed:
        xs, ys = np.array(road['pts']).T
        windows.append((xs.min()-13, ys.min()-13, xs.max()+13, ys.max()+13))

    # Validate each modified sample against the existing pack. Keep the
    # installed height, vegetation and unmodified road samples byte-for-byte.
    tiles = {}
    for level in (5, 6, 7, 8):
        for name in manifest['roads']['levels'][str(level)]:
            i, j = map(int, name.split('_'))
            x0, y0, x1, y1 = fields.corridor.bounds(level, i, j)
            if not any(x1 >= left and x0 <= right and y1 >= bottom and y0 <= top
                       for left, bottom, right, top in windows):
                continue
            xs = x0 + np.arange(257) * fields.b.res(level)
            ys = y1 - np.arange(257) * fields.b.res(level)
            before, after = prior.raster(xs, ys), current.raster(xs, ys)
            if not np.array_equal(before[0], after[0]):
                raise ValueError(f'Road distances changed on L{level} {name}')
            mask = np.any(before != after, axis=0)
            if not mask.any():
                continue
            path = Path(str(level), f'{name}.r.png')
            installed = gdal.Open(str(source/path)).ReadAsArray()
            if not np.array_equal(installed[:, mask], before[:, mask]):
                raise ValueError(f'Existing road field disagrees with roads.json: {path}')
            installed[:, mask] = after[:, mask]
            tiles[path] = installed

    output.mkdir(parents=True)
    for path, rgb in tiles.items():
        (output/path).parent.mkdir(exist_ok=True)
        fields.b.write_png(str(output/path), rgb)
    network['roads'] = new
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
    print(f'Staged {len(tiles)} road field tiles and {len(NOV18["buildings"])} hand footprints in {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='existing Mabou terrain pack')
    parser.add_argument('--output', type=Path, required=True, help='new directory for changed files')
    args = parser.parse_args()
    bake(args.source, args.output)
