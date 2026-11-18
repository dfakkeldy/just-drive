"""Opt-in treetop exclusions from the already fetched provincial utility layers.

Power wires and towers produce narrow DSM peaks that are not trees. Buffers are
conservative map allowances, not measured structure footprints. No photo data.
"""
import json
from pathlib import Path
import numpy as np
from osgeo import gdal, ogr, osr


class UtilityMask:
    def __init__(self, vectors):
        source, self.srs = osr.SpatialReference(), osr.SpatialReference()
        source.ImportFromEPSG(4326); self.srs.ImportFromEPSG(2961)
        for s in (source, self.srs):
            s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        transform = osr.CoordinateTransformation(source, self.srs)
        self.shapes = []
        for suffix in ('01_utility_points', '02_utility_lines', '03_utility_polygons'):
            path = Path(vectors) / f'BASE_NSTDB_10k_Utilities_WM84__{suffix}.geojson'
            if not path.is_file():
                raise RuntimeError(f'Utility tree filtering needs fetched vectors: {path}')
            for feature in json.loads(path.read_text())['features']:
                desc = feature['properties'].get('FEAT_DESC', '')
                if suffix == '02_utility_lines':
                    padding = 12 if desc.startswith('TRANSMISSION LINE') else None
                elif suffix == '01_utility_points':
                    padding = 8.5 if desc.startswith('TANK') else 8 if desc.startswith('TOWER') else None
                else:
                    padding = 1 if desc.startswith(('TANK', 'SUBSTATION')) else None
                if padding is None or not feature.get('geometry'):
                    continue
                geom = ogr.CreateGeometryFromJson(json.dumps(feature['geometry']))
                geom.Transform(transform)
                geom = geom.Buffer(padding)
                self.shapes.append((geom.GetEnvelope(), geom))

    def mask(self, shape, x0, y1):
        h, w = shape
        x1, y0 = x0+w-1, y1-h+1
        hits = [g for (lx,hx,ly,hy),g in self.shapes if lx<=x1 and hx>=x0 and ly<=y1 and hy>=y0]
        if not hits:
            return np.zeros(shape, dtype=bool)
        vector = ogr.GetDriverByName('Memory').CreateDataSource('')
        layer = vector.CreateLayer('utilities', self.srs, ogr.wkbUnknown)
        for geom in hits:
            feature = ogr.Feature(layer.GetLayerDefn()); feature.SetGeometry(geom); layer.CreateFeature(feature)
        raster = gdal.GetDriverByName('MEM').Create('', w, h, 1, gdal.GDT_Byte)
        raster.SetGeoTransform((x0-.5, 1, 0, y1+.5, 0, -1)); raster.SetProjection(self.srs.ExportToWkt())
        gdal.RasterizeLayer(raster, [1], layer, burn_values=[1])
        return raster.ReadAsArray() != 0
