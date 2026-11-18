#!/usr/bin/env python3
"""Stage 1A bake: landmarks that must be visible from far away (first: the Mabou church).

Run inside the GDAL container:
  podman run --rm -v "$PWD:/p:Z" ghcr.io/osgeo/gdal:ubuntu-small-latest python3 /p/pipeline/22_bake_landmarks.py

Terrain tiles lose thin, tall things such as a spire when they are averaged for distance.
A landmark is therefore a separate small model, measured from the 1 m LiDAR:
footprint from the provincial building polygon, heights from surface minus ground.
Output: data/baked/terrain/landmarks.json (EPSG:2961 metres, heights above ground).
"""
import json
import math

import os

import numpy as np
from osgeo import gdal, ogr, osr

from areas import current

AREA = current()

gdal.UseExceptions()
# The project folder: "/p" in the GDAL container, the checkout itself when run with a local GDAL.
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = str(AREA.raw)
# name, approximate position (east, north), search radius for the building polygon
WANTED = AREA.landmarks


def window(path, x, y, half):
    ds = gdal.Warp("", path, format="MEM", dstSRS="EPSG:2961", xRes=1, yRes=1,
                   outputBounds=(x - half, y - half, x + half, y + half), resampleAlg="bilinear", dstNodata=-32767)
    return ds.GetRasterBand(1).ReadAsArray().astype(np.float32)


def main():
    src = gdal.VectorTranslate("/vsimem/b.gpkg", f"{RAW}/vectors/BASE_NSTDB_10k_Buildings_WM84__04_building_polygons.geojson",
                               format="GPKG", dstSRS="EPSG:2961", reproject=True, layerName="b")
    src = None
    ds = ogr.Open("/vsimem/b.gpkg")
    lyr = ds.GetLayer(0)
    out = []
    for name, x, y, radius in WANTED:
        pt = ogr.Geometry(ogr.wkbPoint)
        pt.AddPoint_2D(x, y)
        best, bd = None, 1e9
        lyr.ResetReading()
        for f in lyr:
            g = f.GetGeometryRef()
            d = g.Distance(pt)
            if d < bd:
                best, bd = g.Clone(), d
        if best is None or bd > radius:
            raise RuntimeError(f"no building polygon near {name}")
        ring = best.GetGeometryRef(0) if best.GetGeometryName() == "POLYGON" else best.GetGeometryRef(0).GetGeometryRef(0)
        poly = [(ring.GetX(i), ring.GetY(i)) for i in range(ring.GetPointCount())]
        c = best.Centroid()
        cx, cy = c.GetX(), c.GetY()
        half = 70
        dtm = window(str(AREA.elevation("dtm")), cx, cy, half)
        dsm = window(str(AREA.elevation("dsm")), cx, cy, half)
        h = dsm - dtm
        n = h.shape[0]
        inside = np.zeros_like(h, dtype=bool)
        buf = best.Buffer(2.0)
        for r in range(n):
            for col in range(n):
                p = ogr.Geometry(ogr.wkbPoint)
                p.AddPoint_2D(cx - half + col + 0.5, cy + half - r - 0.5)
                inside[r, col] = buf.Contains(p)
        hi = np.where(inside, h, -1)
        r, col = np.unravel_index(np.argmax(hi), hi.shape)
        vals = h[inside]
        # Principal axis of the footprint gives the direction of the nave.
        pts = np.array(poly[:-1]) - np.array([cx, cy])
        w, v = np.linalg.eigh(np.cov(pts.T))
        axis = v[:, np.argmax(w)]
        item = {
            "name": name, "x": round(cx, 2), "y": round(cy, 2),
            "ground": round(float(np.median(dtm[inside])), 2),
            "footprint": [[round(a, 2), round(b, 2)] for a, b in poly],
            "area": round(best.GetArea(), 1),
            "axisDeg": round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 1),   # from north, clockwise
            "eave": round(float(np.percentile(vals, 35)), 1),
            "ridge": round(float(np.percentile(vals, 92)), 1),
            "spire": {"x": round(cx - half + col + 0.5, 1), "y": round(cy + half - r - 0.5, 1), "height": round(float(hi[r, col]), 1)},
            "percentiles": {str(q): round(float(np.percentile(vals, q)), 1) for q in (10, 25, 50, 75, 90, 97, 99.5)},
        }
        # How wide is the tower at half its height?  Count cells near the spire above that level.
        sr, sc = r, col
        near = h[max(sr - 8, 0):sr + 9, max(sc - 8, 0):sc + 9]
        item["spire"]["widthAt"] = {str(int(f * 100)): int((near > f * hi[r, col]).sum()) for f in (0.5, 0.65, 0.8)}
        out.append(item)
        print(json.dumps(item))
    with open(str(AREA.output / "landmarks.json"), "w") as f:
        json.dump(out, f)


main()
