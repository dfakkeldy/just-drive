"""Bounds in metres of the encoded ground in the manifest's final tile list.

Scan the PNGs, including shared edges and sea samples, after a ground bake.
Do not use raw DEM bounds: encoding rounds/clips them, and the corridor bake
replaces only L7/L8. Unlisted files, road fields and canopy are not ground.
"""
from pathlib import Path

import numpy as np
from osgeo import gdal


def update_height_range(manifest, output):
    lo, hi = 65535, 0
    count = 0
    for level, names in manifest['levels'].items():
        for name in names:
            path = Path(output) / level / f'{name}.png'
            ds = gdal.Open(str(path))
            if ds is None or ds.RasterCount != 3:
                raise RuntimeError(f'not an RGB ground tile: {path}')
            red = ds.GetRasterBand(1).ReadAsArray().astype(np.uint16)
            green = ds.GetRasterBand(2).ReadAsArray().astype(np.uint16)
            ground = red * 256 + green
            lo, hi = min(lo, int(ground.min())), max(hi, int(ground.max()))
            count += 1
    if not count:
        raise RuntimeError('cannot bound an empty terrain manifest')
    height = manifest['height']
    height['min'] = lo * height['scale'] + height['offset']
    height['max'] = hi * height['scale'] + height['offset']
