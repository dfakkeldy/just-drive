"""Canso-only, owner-approved estimate over the small federal coastal-trail gap.

No provincial point cloud is read. Keep original raster samples and source vectors
unchanged. The fetched OSM line corrects a displaced provincial centreline locally.
"""
import json
import numpy as np
from osgeo import gdal, ogr, osr

NODATA = -32767.0
ALIGN_SOUTH, ALIGN_NORTH = 5058700.0, 5059430.0
PATCH_SOUTH, PATCH_NORTH = 5058740.0, 5059025.0
WIDTH = 12.0


def transform(src, dst):
    a, b = osr.SpatialReference(), osr.SpatialReference()
    a.ImportFromEPSG(src); b.ImportFromEPSG(dst)
    for s in (a, b):
        s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(a, b)


def osm_points(area):
    elements = json.loads((area.raw / 'vectors/osm.json').read_text())['elements']
    way = next(e for e in elements if e.get('type') == 'way' and e.get('id') == 648292547)
    tr = transform(4326, 2961)
    pts = np.array([tr.TransformPoint(p['lon'], p['lat'])[:2] for p in way['geometry']])
    pts = pts[(pts[:, 1] >= ALIGN_SOUTH-100) & (pts[:, 1] <= ALIGN_NORTH+100)]
    # This bounded section runs monotonically north. Refuse a changed source.
    if len(pts) < 3 or not np.all(np.diff(pts[:, 1]) < 0):
        raise ValueError('Expected monotonic OSM coastal trail section')
    return pts[::-1]


def aligned_trail(geometry, area):
    """Retain both provincial joins; blend to OSM over 50 m at each end."""
    if geometry.GetGeometryName() != 'LINESTRING':
        raise ValueError('Expected provincial trail LineString')
    osm = osm_points(area)
    dense = geometry.Clone(); dense.Segmentize(5)
    result = ogr.Geometry(ogr.wkbLineString)
    for x, y, *_ in dense.GetPoints():
        w = max(0, min(1, (y-ALIGN_SOUTH)/50, (ALIGN_NORTH-y)/50))
        ox = np.interp(y, osm[:, 1], osm[:, 0])
        result.AddPoint_2D(x + w*(ox-x), y)
    return result


def trail_geometry(area):
    path = area.raw / 'vectors/BASE_NSTDB_10k_Roads_WM84__05_bridges.geojson'
    f = next(f for f in json.loads(path.read_text())['features'] if f['properties'].get('ROADSEGID') == 700024)
    g = ogr.CreateGeometryFromJson(json.dumps(f['geometry'])); g.Transform(transform(4326, 2961))
    return aligned_trail(g, area)


def estimated_heights(north, south_height, north_height):
    return np.interp(north, [PATCH_SOUTH, PATCH_NORTH], [south_height, north_height]).astype(np.float32)


def estimated_surface(east, north, points, south_height, north_height):
    """Flat trail bed, with a sloped shoulder into missing coastal water."""
    centre = np.interp(north, points[:, 1], points[:, 0])
    slope = np.interp(north, points[:, 1], np.gradient(points[:, 0], points[:, 1]))
    distance = np.abs(east-centre) / np.sqrt(1+slope*slope)
    weight = np.clip((WIDTH-distance)/(WIDTH-5), 0, 1)
    return (-4 + (estimated_heights(north, south_height, north_height)+4)*weight).astype(np.float32)


def fill_missing(original, corridor, heights):
    """Only NoData inside the explicit corridor may change; never overwrite a measurement."""
    fill = (original == NODATA) & corridor
    result = original.copy(); result[fill] = heights[fill]
    return result, fill


def prepare(area):
    import hashlib, math, os
    from pathlib import Path
    from areas import AREAS
    if area.id != 'cansocauseway' or not area.interpolate_coastal_trail:
        raise ValueError('This estimate is authorized only for cansocauseway')
    # A disconnected external drive must never turn into a directory on the Mac.
    if not any(parent.parent == Path('/Volumes') and parent.is_mount()
               for parent in area.raw.resolve().parents):
        raise ValueError('Expected external area sources')
    folder = area.raw / 'elevation'
    originals = {}
    for kind in ('dtm', 'dsm'):
        base = folder / f'land-{kind}-1m-epsg3979-federal.vrt'
        target = area.elevation(kind)
        if not base.exists():
            # Tiny VRT description only: retain the original strips in place.
            if 'trail-' in target.read_text():
                raise ValueError('Missing original VRT; refusing recursive supplement')
            base.write_text(target.read_text())
        originals[kind] = base
    osm = osm_points(area)
    join_x = np.interp([PATCH_SOUTH, PATCH_NORTH], osm[:, 1], osm[:, 0])
    ground = gdal.Open(str(originals['dtm']))
    to_native = transform(2961, 3979)
    gt = ground.GetGeoTransform()
    def measured_join(x, y):
        east, north, *_ = to_native.TransformPoint(float(x), float(y))
        col, row = math.floor((east-gt[0])/gt[1]), math.floor((north-gt[3])/gt[5])
        a = ground.ReadAsArray(col-2, row-2, 5, 5)
        valid = a[a != NODATA]
        if len(valid) != 25 or not 0 < float(np.median(valid)) < 5:
            raise ValueError('Interpolation needs complete, low dry ground at both joins')
        return float(np.median(valid))
    joins = [measured_join(join_x[0], PATCH_SOUTH), measured_join(join_x[1], PATCH_NORTH)]
    line = trail_geometry(area)
    region = line.Buffer(WIDTH).Intersection(rectangle(621750, PATCH_SOUTH, 622100, PATCH_NORTH))
    region.Transform(to_native)
    xmin, xmax, ymin, ymax = region.GetEnvelope()
    c0, c1 = math.floor(xmin-gt[0])-2, math.ceil(xmax-gt[0])+2
    r0, r1 = math.floor(gt[3]-ymax)-2, math.ceil(gt[3]-ymin)+2
    bounds = (gt[0]+c0, gt[3]-r1, gt[0]+c1, gt[3]-r0)
    shape = (r1-r0, c1-c0)
    grid = (bounds[0], 1, 0, bounds[3], 0, -1)
    srs = osr.SpatialReference(); srs.ImportFromEPSG(3979)
    mask = gdal.GetDriverByName('MEM').Create('', shape[1], shape[0], 1, gdal.GDT_Byte)
    mask.SetGeoTransform(grid); mask.SetProjection(srs.ExportToWkt())
    vectors = ogr.GetDriverByName('Memory').CreateDataSource('')
    layer = vectors.CreateLayer('patch', srs, ogr.wkbPolygon)
    feat = ogr.Feature(layer.GetLayerDefn()); feat.SetGeometry(region); layer.CreateFeature(feat)
    gdal.RasterizeLayer(mask, [1], layer, burn_values=[1])
    corridor = mask.ReadAsArray().astype(bool)
    ys, xs = np.indices(shape)
    native = np.c_[grid[0]+xs.ravel()+.5, grid[3]-ys.ravel()-.5]
    utm = np.array(transform(3979, 2961).TransformPoints(native))
    points = np.array(line.GetPoints())[:, :2]
    if not np.all(np.diff(points[:, 1]) > 0):
        raise ValueError('Expected monotonic estimated trail bed')
    heights = estimated_surface(utm[:, 0].reshape(shape), utm[:, 1].reshape(shape), points, *joins)
    evidence = dict(method='Linear federal ground joins; flat 5 m half-width bed, shoulders taper to -4 m at 12 m; estimated open surface equals ground',
                    source='Existing federal HRDEM only; no provincial LAZ', northingJoins=[PATCH_SOUTH, PATCH_NORTH],
                    groundJoins=joins, halfWidthMetres=WIDTH, alignment='OSM way 648292547, bounded blend into provincial segment 700024',
                    estimated=True, files={})
    for kind in ('dtm', 'dsm'):
        src = gdal.Open(str(originals[kind]))
        if src.GetGeoTransform() != gt:
            raise ValueError('Ground/surface source grids differ')
        old = src.ReadAsArray(c0, r0, shape[1], shape[0])
        _, filled = fill_missing(old, corridor, heights)
        if not 0 < int(filled.sum()) <= 8000:
            raise ValueError('Expected the reviewed small source gap; inspect changed source coverage')
        supplement = np.where(filled, heights, NODATA).astype(np.float32)
        path = folder / f'trail-{kind}-1m-epsg3979.tif'
        write_raster(path, supplement, grid, srs.ExportToWkt())
        temp = area.elevation(kind).with_suffix('.interpolating.vrt')
        ds = gdal.BuildVRT(str(temp), [str(originals[kind]), str(path)], resolution='highest'); ds = None
        os.replace(temp, area.elevation(kind))
        patched = gdal.Open(str(area.elevation(kind))).ReadAsArray(c0, r0, shape[1], shape[0])
        assert np.array_equal(patched[~filled], old[~filled])
        assert np.array_equal(patched[filled], heights[filled])
        wide_base = AREAS[area.wide_source].wide(kind)
        w = gdal.Open(str(wide_base)); wg = w.GetGeoTransform()
        # Warp only the tiny supplement, on the original node-registered 16 m grid.
        wb = (wg[0], wg[3]+wg[5]*w.RasterYSize, wg[0]+wg[1]*w.RasterXSize, wg[3])
        wide_patch = gdal.Warp('', str(path), format='MEM', dstSRS='EPSG:2961', outputBounds=wb,
                              width=w.RasterXSize, height=w.RasterYSize, resampleAlg='average', dstNodata=NODATA)
        vals = wide_patch.ReadAsArray(); vals[w.ReadAsArray() != NODATA] = NODATA
        # Trim the mostly empty grid; the shared coarse raster is only referenced.
        rows, cols = np.where(vals != NODATA)
        if not len(rows):
            raise ValueError('No coarse estimate generated')
        top, bottom, left, right = rows.min(), rows.max()+1, cols.min(), cols.max()+1
        wp = folder / f'trail-{kind}-16m-utm20.tif'
        write_raster(wp, vals[top:bottom,left:right], (wg[0]+left*16,16,0,wg[3]-top*16,0,-16), w.GetProjection())
        ds = gdal.BuildVRT(str(area.bake_wide(kind)), [str(wide_base), str(wp)], resolution='highest'); ds = None
        evidence['files'][kind] = dict(filledCells=int(filled.sum()), bytes=path.stat().st_size,
                                      sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                      validSourceSamplesChanged=0)
    (folder/'trail-interpolation.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps(evidence, indent=2), flush=True)
    return evidence


def rectangle(x0, y0, x1, y1):
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1),(x0,y0)]: ring.AddPoint_2D(x,y)
    g = ogr.Geometry(ogr.wkbPolygon); g.AddGeometry(ring)
    return g


def write_raster(path, values, grid, projection):
    import os
    temporary = str(path)+'.part'
    ds = gdal.GetDriverByName('GTiff').Create(temporary, values.shape[1], values.shape[0], 1, gdal.GDT_Float32,
        options=['COMPRESS=DEFLATE', 'PREDICTOR=3'])
    ds.SetGeoTransform(grid); ds.SetProjection(projection)
    ds.GetRasterBand(1).SetNoDataValue(NODATA); ds.GetRasterBand(1).WriteArray(values); ds = None
    os.replace(temporary, path)
