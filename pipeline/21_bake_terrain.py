#!/usr/bin/env python3
"""Stage 1A bake: turn LiDAR heights into the game's terrain tiles.

Run inside the GDAL container (it has osgeo and numpy):
  podman run --rm -v "$PWD:/p:Z" ghcr.io/osgeo/gdal:ubuntu-small-latest python3 /p/pipeline/21_bake_terrain.py

World frame: NAD83(CSRS) UTM zone 20N (EPSG:2961), metres, heights CGVD2013. Scale 1:1.

Quadtree: the root tile is a 65,536 m square. Level L has 2^L x 2^L tiles; a tile has
257 x 257 samples (edges shared with its neighbours), so the sample spacing is
256 m at L0 and 1 m at L8.
  L0-L4  whole root, from the 16 m wide fetch (horizon)
  L5-L6  the north-loop box, from the 1 m data averaged to 4 m
  L7-L8  the village, at 1 m

Tile PNG (8-bit RGB, lossless):
  R,G  ground height: value = R*256+G, metres = value/100 - 100   (1 cm steps)
  B    canopy and roof height above ground: metres = B/5           (0.2 m steps)
Sea and missing data get ground height SEA_FLOOR, so the water plane covers them.

cover.png (5 m, north-loop box): R = share of red-turning trees (maples), G = share of
yellow-turning trees (birch, aspen, larch), both in 25ths per tenth; B = class
(0 unknown, 1 forest stand, 2 farm field, 3 built-up, 4 water, 5 other open land).
This is the reproducible baseline. The separate ground_classes.py work-root stage
adds approved open classes 6..13 without rebaking or changing any height tile.
"""
import json
import math
import os
import re

from areas import current
from terrain_height_range import update_height_range

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
# The project folder: "/p" in the GDAL container, the checkout itself when run with a local GDAL.
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AREA = current()
RAW = str(AREA.raw)
OUT = str(AREA.output)
OVERVIEW = str(AREA.overview)
X0, Y1 = AREA.origin
SIZE, T = 65536, 256
NODATA = -32767.0
SEA_FLOOR = -4.0
VILLAGE = AREA.bake_anchor
VILLAGE_HALF = AREA.fine_half

RED = {"RM", "SM"}
YELLOW = {"YB", "WB", "TA", "LA", "BE", "AS", "WA", "TL", "EL", "IH", "GB", "PO", "BP", "RO"}
HALF = {"UH"}  # unclassified hardwood: count half red, half yellow


def res(level):
    return SIZE / (T * 2 ** level)


def warp(src, bounds, r, alg):
    """Node-registered raster: pixel centres on multiples of r from the tile grid."""
    xmin, ymin, xmax, ymax = bounds
    ds = gdal.Warp("", src, format="MEM", dstSRS="EPSG:2961", xRes=r, yRes=r,
                   outputBounds=(xmin - r / 2, ymin - r / 2, xmax + r / 2, ymax + r / 2),
                   resampleAlg=alg, dstNodata=NODATA, warpMemoryLimit=768 * 1024 * 1024,
                   multithread=True)
    a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    a[~np.isfinite(a)] = NODATA
    return a


def halve(a):
    """Decimate a node-registered grid by two with a small nodata-aware blur."""
    valid = (a != NODATA).astype(np.float32)
    v = np.where(valid > 0, a, 0).astype(np.float32)

    def blur(x):
        p = np.pad(x, 1, mode="edge")
        k = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4
        return (k[:, :-2] + 2 * k[:, 1:-1] + k[:, 2:]) / 4

    num, den = blur(v), blur(valid)
    out = np.where(den > 0.5, num / np.maximum(den, 1e-6), NODATA)
    return out[::2, ::2].astype(np.float32)


def encode(dtm, dsm):
    sea = dtm == NODATA
    h = np.where(sea, SEA_FLOOR, dtm)
    v = np.clip(np.rint((h + 100.0) * 100.0), 0, 65535).astype(np.uint16)
    canopy = np.where(sea | (dsm == NODATA), 0, dsm - dtm)
    c = np.clip(np.rint(canopy * 5.0), 0, 255).astype(np.uint8)
    return np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), c]), sea


def write_png(path, rgb):
    mem = gdal.GetDriverByName("MEM").Create("", rgb.shape[2], rgb.shape[1], 3, gdal.GDT_Byte)
    for b in range(3):
        mem.GetRasterBand(b + 1).WriteArray(rgb[b])
    gdal.GetDriverByName("PNG").CreateCopy(path, mem, options=["ZLEVEL=9"])
    aux = path + ".aux.xml"
    if os.path.exists(aux):
        os.remove(aux)


def cut(level, dtm, dsm, bounds, manifest):
    """Write every tile of `level` that lies fully inside `bounds` and has land."""
    xmin, ymin, xmax, ymax = bounds
    r, size = res(level), SIZE / 2 ** level
    i0, i1 = round((xmin - X0) / size), round((xmax - X0) / size)
    j0, j1 = round((Y1 - ymax) / size), round((Y1 - ymin) / size)
    os.makedirs(f"{OUT}/{level}", exist_ok=True)
    names = []
    for j in range(j0, j1):
        for i in range(i0, i1):
            c, rr = (i - i0) * T, (j - j0) * T
            d = dtm[rr:rr + T + 1, c:c + T + 1]
            if d.shape != (T + 1, T + 1):
                raise RuntimeError(f"short tile {level}/{i}_{j}: {d.shape}")
            rgb, sea = encode(d, dsm[rr:rr + T + 1, c:c + T + 1])
            if sea.all():
                continue
            write_png(f"{OUT}/{level}/{i}_{j}.png", rgb)
            names.append(f"{i}_{j}")
    manifest["levels"][str(level)] = names
    print(f"L{level}: {len(names)} tiles at {r:g} m", flush=True)


def snap_in(lo, hi, origin, step):
    return origin + math.ceil((lo - origin) / step) * step, origin + math.floor((hi - origin) / step) * step


def mid_bounds():
    """The registry's half-open L5 tile box."""
    return AREA.mid


def species_shares(code):
    red = yellow = 0.0
    for sp, tenths in re.findall(r"([A-Z]{2})(\d{2})", code or ""):
        t = int(tenths)
        if sp in RED:
            red += t
        elif sp in YELLOW:
            yellow += t
        elif sp in HALF:
            red += t / 2
            yellow += t / 2
    return min(10, red), min(10, yellow)


def bake_cover(bounds, manifest):
    xmin, ymin, xmax, ymax = bounds
    r = 5.0
    w, h = int((xmax - xmin) / r), int((ymax - ymin) / r)
    dst = gdal.GetDriverByName("MEM").Create("", w, h, 3, gdal.GDT_Byte)
    dst.SetGeoTransform((xmin, r, 0, ymax, 0, -r))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(2961)
    dst.SetProjection(srs.ExportToWkt())

    forest = gdal.VectorTranslate("/vsimem/forest.gpkg",
                                  f"{RAW}/vectors/FOR_Forest_WM84__01_leading_forest_species.geojson",
                                  format="GPKG", dstSRS="EPSG:2961", reproject=True, layerName="f")
    forest = None
    ds = ogr.Open("/vsimem/forest.gpkg", 1)
    lyr = ds.GetLayer(0)
    for name in ("g_red", "g_yel", "g_cls"):
        lyr.CreateField(ogr.FieldDefn(name, ogr.OFTInteger))
    lyr.StartTransaction()
    for f in lyr:
        code = (f.GetField("SPECIES") or "").strip()
        fornon = f.GetField("FORNON") or 0
        red, yel = species_shares(code)
        cls = 1 if code else {86: 2, 87: 3, 77: 4, 78: 4}.get(fornon, 5)
        f.SetField("g_red", int(round(red * 25)))
        f.SetField("g_yel", int(round(yel * 25)))
        f.SetField("g_cls", cls)
        lyr.SetFeature(f)
    lyr.CommitTransaction()
    for band, field in ((1, "g_red"), (2, "g_yel"), (3, "g_cls")):
        lyr.ResetReading()
        gdal.RasterizeLayer(dst, [band], lyr, options=[f"ATTRIBUTE={field}"])

    water = gdal.VectorTranslate("/vsimem/water.gpkg",
                                 f"{RAW}/vectors/BASE_NSTDB_10k_Water_WM84__08_wet_features.geojson",
                                 format="GPKG", dstSRS="EPSG:2961", reproject=True, layerName="w")
    water = None
    wds = ogr.Open("/vsimem/water.gpkg")
    gdal.RasterizeLayer(dst, [3], wds.GetLayer(0), burn_values=[4])

    gdal.GetDriverByName("PNG").CreateCopy(f"{OUT}/cover.png", dst, options=["ZLEVEL=9"])
    if os.path.exists(f"{OUT}/cover.png.aux.xml"):
        os.remove(f"{OUT}/cover.png.aux.xml")
    manifest["cover"] = {"file": "cover.png", "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "res": r}
    cls = dst.GetRasterBand(3).ReadAsArray()
    print("cover classes:", {int(k): int(v) for k, v in zip(*np.unique(cls, return_counts=True))}, flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {
        "crs": "EPSG:2961", "origin": [X0, Y1], "size": SIZE, "tile": T,
        "height": {"scale": 0.01, "offset": -100.0}, "canopy": {"scale": 0.2},
        "seaFloor": SEA_FLOOR, "village": list(VILLAGE), "levels": {},
    }
    if not AREA.legacy_manifest:
        manifest["area"] = {"id": AREA.id, "name": AREA.name}
    if AREA.interpolate_coastal_trail:
        manifest["estimatedTerrain"] = json.loads((AREA.raw / 'elevation/trail-interpolation.json').read_text())
    root = (X0, Y1 - SIZE, X0 + SIZE, Y1)

    # L4..L0 from the wide fetch (already node-registered at 16 m).
    def read(path):
        ds = gdal.Open(path)  # keep the dataset alive while the band is read
        a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
        a[~np.isfinite(a)] = NODATA
        return a

    dtm = read(str(AREA.bake_wide("dtm")))
    dsm = read(str(AREA.bake_wide("dsm")))
    for level in (4, 3, 2, 1, 0):
        cut(level, dtm, dsm, root, manifest)
        dtm, dsm = halve(dtm), halve(dsm)

    # L6, L5 from the 1 m download, averaged to 4 m.
    mb = mid_bounds()
    manifest["mid"] = list(mb)
    print("mid box", mb, flush=True)
    dtm = warp(str(AREA.elevation("dtm")), mb, res(6), "average")
    dsm = warp(str(AREA.elevation("dsm")), mb, res(6), "average")
    cut(6, dtm, dsm, mb, manifest)
    cut(5, halve(dtm), halve(dsm), mb, manifest)

    # L8, L7 for the village at 1 m.
    step = SIZE / 2 ** 7
    vx0, vx1 = snap_in(VILLAGE[0] - VILLAGE_HALF, VILLAGE[0] + VILLAGE_HALF, X0, step)
    vy0, vy1 = snap_in(VILLAGE[1] - VILLAGE_HALF, VILLAGE[1] + VILLAGE_HALF, Y1, step)
    vb = (vx0, vy0, vx1, vy1)
    manifest["fine"] = list(vb)
    dtm = warp(str(AREA.elevation("dtm")), vb, res(8), "bilinear")
    dsm = warp(str(AREA.elevation("dsm")), vb, res(8), "bilinear")
    cut(8, dtm, dsm, vb, manifest)
    cut(7, halve(dtm), halve(dsm), vb, manifest)

    bake_cover(mb, manifest)
    update_height_range(manifest, OUT)
    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump(manifest, f)
    print("tiles:", sum(len(v) for v in manifest["levels"].values()), flush=True)


if __name__ == "__main__":
    main()
