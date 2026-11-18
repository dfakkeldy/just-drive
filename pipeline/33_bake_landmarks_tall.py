#!/usr/bin/env python3
"""Local DTM sampler; the optional landmark CLI produces guarded v2 work packs.

Step 33 is excluded from routine bakes. It delegates to step 34 and requires
--data-root and --output-root, so it cannot overwrite promoted tall data.
"""
import math
from collections import OrderedDict
from pathlib import Path
import runpy
from osgeo import gdal, osr

gdal.UseExceptions()

class Ground:
    """Small local raster windows, fine first then wide. Never open a network source."""
    def __init__(self, area):
        self.sources, self.cache = [], OrderedDict()
        for path in (area.elevation('dtm'), area.bake_wide('dtm')):
            if not path.is_file(): continue
            ds = gdal.Open(str(path))
            dst = osr.SpatialReference(); dst.ImportFromWkt(ds.GetProjection())
            dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            src = osr.SpatialReference(); src.ImportFromEPSG(2961)
            src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            self.sources.append((ds, gdal.InvGeoTransform(ds.GetGeoTransform()), osr.CoordinateTransformation(src, dst)))

    def at(self, e, n):
        for k, (ds, inv, tr) in enumerate(self.sources):
            x, y, _ = tr.TransformPoint(e, n)
            c, r = gdal.ApplyGeoTransform(inv, x, y); c, r = math.floor(c), math.floor(r)
            if not (0 <= c < ds.RasterXSize and 0 <= r < ds.RasterYSize): continue
            cx, ry = c//128*128, r//128*128
            key = (k, cx, ry)
            if key not in self.cache:
                self.cache[key] = ds.GetRasterBand(1).ReadAsArray(cx, ry, min(128, ds.RasterXSize-cx), min(128, ds.RasterYSize-ry))
                if len(self.cache) > 128: self.cache.popitem(last=False)
            self.cache.move_to_end(key)
            h = float(self.cache[key][r-ry, c-cx]); no = ds.GetRasterBand(1).GetNoDataValue()
            if math.isfinite(h) and h != no and h > -1000: return round(h, 2)
        return None


if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('34_bake_far_views.py')), run_name='__main__')
