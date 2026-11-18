#!/usr/bin/env python3
"""Stage 0 gate: draw roads, water and buildings over the LiDAR hillshade.

If the vectors sit on the roads and roofs that the hillshade shows, the elevation
data, the vector data and the map projection agree. Usage:
  10_gate_picture.py <hillshade.png> <xmin> <ymax> <metres per pixel> <out.png> [scale]
"""
import json
import pathlib
import sys

from PIL import Image, ImageDraw

png, xmin, ymax, mpp, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
scale = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
D = pathlib.Path(png).parent
Image.MAX_IMAGE_PIXELS = None
img = Image.open(png).convert("RGB")
if scale != 1.0:
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
draw = ImageDraw.Draw(img, "RGBA")
k = scale / mpp


def px(c):
    return ((c[0] - xmin) * k, (ymax - c[1]) * k)


def lines(g):
    t, c = g["type"], g["coordinates"]
    if t == "LineString":
        yield c
    elif t == "MultiLineString":
        yield from c
    elif t == "Polygon":
        yield from c
    elif t == "MultiPolygon":
        for p in c:
            yield from p


def layer(name, colour, width, fill=None, point=0):
    n = 0
    for f in json.load(open(D / f"{name}.utm.geojson"))["features"]:
        g = f.get("geometry")
        if not g:
            continue
        if g["type"] == "Point":
            x, y = px(g["coordinates"])
            draw.ellipse((x - point, y - point, x + point, y + point), outline=colour, width=max(1, width))
        else:
            for ring in lines(g):
                pts = [px(c) for c in ring]
                if fill and g["type"].endswith("Polygon"):
                    draw.polygon(pts, fill=fill, outline=colour)
                else:
                    draw.line(pts, fill=colour, width=width)
        n += 1
    return n


w = max(1, round(2 * scale / mpp * 1.5)) if mpp <= 1 else 2
print("water", layer("BASE_NSTDB_10k_Water_WM84__08_wet_features", (40, 120, 200, 200), 1, (60, 140, 220, 70)))
print("roads", layer("BASE_NSTDB_10k_Roads_WM84__08_roads", (230, 60, 40, 220), w))
print("highways", layer("BASE_NSTDB_10k_Roads_WM84__07_highways", (255, 170, 0, 230), w + 1))
print("bldg polys", layer("BASE_NSTDB_10k_Buildings_WM84__04_building_polygons", (0, 230, 120, 255), 2))
print("bldg points", layer("BASE_NSTDB_10k_Buildings_WM84__03_unclassified", (0, 230, 120, 255), 2, point=max(3, 6 / mpp * scale)))
img.save(out)
print(out, img.size)
