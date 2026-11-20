#!/usr/bin/env python3
"""Stage the 19 Nov Mabou road correction on a separate terrain folder."""
import argparse
import hashlib
import importlib
import json
from pathlib import Path

import numpy as np
from osgeo import gdal

from areas import AREAS
from dashcam_corrections import correct_nov19_roads, remap_road_references
from road_ground import BEFORE_BED


def compact(doc):
    return (json.dumps(doc, separators=(',', ':'), allow_nan=False) + '\n').encode()


def stage(source, output, overview):
    source, output = source.resolve(), output.resolve()
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Use a new staging folder outside the source terrain')
    fields = importlib.import_module('25_bake_road_fields')
    area = AREAS['mabou']
    read = lambda name: json.loads((source / name).read_bytes())
    manifest, network = read('manifest.json'), read('roads.json')
    if manifest['origin'] != list(area.origin) or fields.b.AREA.id != area.id:
        raise ValueError('Expected the Mabou terrain')
    old = network['roads']
    new = correct_nov19_roads(old, area.id)
    if new is old:
        raise ValueError('The source already has the wharf correction')
    old_by_id = {r['id']: r for r in old}
    network['roads'] = new
    # The installed bed bake did not move the split piece. Refuse a source whose saved line needs a split too.
    if 'bed' in network:
        bed_raw = (overview / BEFORE_BED).read_bytes()
        shortened = {r['id'] for r in new if r['id'] in old_by_id and old_by_id[r['id']]['pts'] != r['pts']}
        if hashlib.sha256(bed_raw).hexdigest() != network['bed']['before']:
            raise ValueError('The saved road-bed lines do not match this pack')
        if shortened.intersection(map(int, json.loads(bed_raw)['pts'])):
            raise ValueError('The shortened road has a saved road-bed line that also needs the split')
    before, after = fields.Field(old), fields.Field(new)
    windows = []
    for road in new:
        prior = old_by_id.get(road['id'])
        if prior == road or (prior and prior['pts'] != road['pts']):
            continue  # The new gravel piece alone covers the shortened paved piece.
        xs, ys = np.array(road['pts']).T
        windows.append((xs.min()-13, ys.min()-13, xs.max()+13, ys.max()+13))
    outputs = {'roads.json': compact(network), 'manifest.json': compact(manifest)}
    for kind in ('buildings', 'streams', 'props', 'cemeteries'):
        name = kind + '.json'
        prior = read(name)
        data = remap_road_references(prior, kind, new)
        if kind == 'cemeteries':
            data['roadsSha256'] = hashlib.sha256(outputs['roads.json']).hexdigest()
        if data != prior:
            outputs[name] = compact(data)
    output.mkdir(parents=True)
    gdal.UseExceptions()
    tiles = 0
    for level, names in manifest['roads']['levels'].items():
        level = int(level)
        for name in names:
            i, j = map(int, name.split('_'))
            x0, y0, x1, y1 = fields.corridor.bounds(level, i, j)
            if not any(x1 >= a and x0 <= c and y1 >= b and y0 <= d for a,b,c,d in windows):
                continue
            xs = x0 + np.arange(257) * fields.b.res(level)
            ys = y1 - np.arange(257) * fields.b.res(level)
            old_rgb, new_rgb = before.raster(xs, ys), after.raster(xs, ys)
            if not np.array_equal(old_rgb[:2], new_rgb[:2]):
                raise ValueError('The correction moved or widened a centreline')
            changed = old_rgb[2] != new_rgb[2]
            if not changed.any():
                continue
            path = Path(str(level), f'{name}.r.png')
            installed = gdal.Open(str(source / path)).ReadAsArray()
            if not np.array_equal(installed[:, changed], old_rgb[:, changed]):
                raise ValueError(f'Source road raster disagrees with its road file: {path}')
            installed[2, changed] = new_rgb[2, changed]
            (output / path).parent.mkdir(exist_ok=True)
            fields.b.write_png(str(output / path), installed)
            tiles += 1
    if not tiles:
        raise ValueError('No road fields changed')
    for name, raw in outputs.items():
        (output / name).write_bytes(raw)
    print(f'Staged {tiles} road fields and {len(outputs)} road and reference files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--overview', default=Path(AREAS['mabou'].overview), type=Path)
    args = parser.parse_args()
    stage(args.source, args.output, args.overview)
