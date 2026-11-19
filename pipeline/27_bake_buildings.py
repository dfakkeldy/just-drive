#!/usr/bin/env python3
"""Measure simple buildings from map seeds and the 2017-2018 LiDAR.

Run from the project root in the GDAL/numpy container:
  podman run --rm --security-opt label=disable -v "$PWD:/p" -e GDAL_CACHEMAX=768 -e OPENBLAS_NUM_THREADS=1 \
    ghcr.io/osgeo/gdal:ubuntu-small-latest python3 /p/pipeline/27_bake_buildings.py

Only small, integer-aligned 1 m windows are warped. No scipy/shapely/Pillow is
needed. Map elevations are deliberately ignored: ground comes from the DTM.
The mount avoids private :Z relabelling because other stages run concurrently
in this checkout on SELinux hosts. No host SELinux setting is changed.
Use --no-manifest for concurrent rebuild/check runs that need no registration.
Run 27_check_buildings.py afterwards for overlays and independent validation.
The strict first pass keeps its original IDs. Recovered point seeds append
new IDs; audit candidateId links them to the original candidate inventory.
Second-pass confidence is 0.3-0.6; compact-blob size priors use source fallback
and confidence 0.2. Continuous canopy never supplies a fallback footprint.
"""
import argparse
import collections
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from osgeo import gdal, ogr, osr

import big_buildings as big
from areas import current

AREA = current()

gdal.UseExceptions()
osr.UseExceptions()
ROOT = Path(os.path.abspath(__file__)).parents[1]
RAW = AREA.raw
OUT = AREA.output
WORK = Path(os.environ.get("MMM_BUILDING_WORK", AREA.overview))
NODATA = -32767.0
PRIORITY = {"polygon": 0, "osm": 1, "lidar": 2}


def big_switch(value, area_switch):
    """Large buildings as blocks (big_buildings.py): MMM_BIG_BUILDINGS=1 is on, =0 is off, not set is the area's switch."""
    if value not in ("", "0", "1"):
        raise SystemExit(f"MMM_BIG_BUILDINGS must be 1 or 0, not {value!r}")
    return {"1": True, "0": False}.get(value, area_switch)


def guard_big(path, value, on):
    """Stop a bake that would remove a land's large buildings without a word.

    The area's switch stays off until that area's data go, so a bake of this step by another task, with the variable
    not set, would write the land again without its blocks and tanks, and every check would pass.
    """
    if on or value == "0" or not path.is_file():
        return
    large = sum("shape" in b for b in json.loads(path.read_text())["buildings"])
    if large:
        raise SystemExit(f"{path}: this land has {large} large-building items (blocks and tanks), and this bake would "
                         "remove them. Set MMM_BIG_BUILDINGS=1 to keep them (set it for step 27 and for its check), "
                         "or MMM_BIG_BUILDINGS=0 to remove them on purpose.")


BIG_SET = os.environ.get("MMM_BIG_BUILDINGS", "")
BIG = big_switch(BIG_SET, AREA.big_buildings)


def dump(path, value):
    """Atomic replacement, with stable ordering and no NaN JSON values."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".buildings-tmp")
    tmp.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n")
    os.replace(tmp, path)


def polygon(points):
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in points:
        ring.AddPoint_2D(float(x), float(y))
    ring.CloseRings()
    geom = ogr.Geometry(ogr.wkbPolygon)
    geom.AddGeometry(ring)
    return geom


def point(x, y):
    geom = ogr.Geometry(ogr.wkbPoint)
    geom.AddPoint_2D(float(x), float(y))
    return geom


def transform():
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326)
    dst.ImportFromEPSG(2961)
    for srs in (src, dst):
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return osr.CoordinateTransformation(src, dst)


def vertices(geom):
    if geom.GetGeometryName() in ("POLYGON", "MULTIPOLYGON"):
        if geom.GetGeometryName() == "MULTIPOLYGON":
            return np.concatenate([vertices(g) for g in geom])
        return np.array(geom.GetGeometryRef(0).GetPoints())[:, :2]
    raise ValueError("expected a polygon")


def inside(geom, xx, yy):
    """Pixel-centre polygon test, including holes and multipolygons."""
    if geom.GetGeometryName() == "MULTIPOLYGON":
        return np.logical_or.reduce([inside(g, xx, yy) for g in geom])
    result = np.zeros(xx.shape, dtype=bool)
    for ring in geom:
        pts = np.array(ring.GetPoints())[:, :2]
        hit = np.zeros(xx.shape, dtype=bool)
        for a, b in zip(pts[:-1], pts[1:]):
            if a[1] != b[1]:
                hit ^= ((a[1] > yy) != (b[1] > yy)) & (
                    xx < (b[0] - a[0]) * (yy - a[1]) / (b[1] - a[1]) + a[0])
        result ^= hit
    return result


def candidates(mid):
    tr = transform()
    raw = []

    def add(key, source, geom, attributes):
        geom.Transform(tr)
        if geom.IsEmpty():
            return
        if geom.GetGeometryName() != "POINT" and not geom.IsValid():
            geom = geom.MakeValid()
        c = geom.Centroid()
        x, y = c.GetX(), c.GetY()
        if mid[0] <= x <= mid[2] and mid[1] <= y <= mid[3]:
            raw.append(dict(key=key, source=source, geom=geom, x=x, y=y,
                            attributes=attributes, aliases=[]))

    for suffix in ("04_building_polygons", "02_classified", "03_unclassified"):
        path = RAW / f"vectors/BASE_NSTDB_10k_Buildings_WM84__{suffix}.geojson"
        for feature in json.loads(path.read_text())["features"]:
            geom = ogr.CreateGeometryFromJson(json.dumps(feature["geometry"]))
            source = "polygon" if suffix.startswith("04") else "lidar"
            add(f"province:{feature['properties']['OBJECTID']}", source, geom,
                feature["properties"])
    for element in json.loads((RAW / "vectors/osm.json").read_text())["elements"]:
        tags = element.get("tags", {})
        if element["type"] != "way" or tags.get("building", "no") == "no":
            continue
        coords = [(p["lon"], p["lat"]) for p in element.get("geometry", [])]
        if len(coords) >= 4 and coords[0] == coords[-1]:
            add(f"osm:{element['id']}", "osm", polygon(coords), tags)

    raw.sort(key=lambda c: (PRIORITY[c["source"]], c["key"]))
    merged = []
    for candidate in raw:
        matches = []
        geom = candidate["geom"]
        is_point = candidate["source"] == "lidar"
        for old in merged:
            old_point = old["source"] == "lidar"
            distance = geom.Distance(old["geom"])
            if is_point:
                duplicate = distance <= (3.0 if old_point else 4.0)
            elif not old_point and distance == 0:
                intersection = geom.Intersection(old["geom"]).GetArea()
                duplicate = intersection / min(geom.GetArea(), old["geom"].GetArea()) > .30
            else:
                duplicate = False
            if duplicate:
                matches.append((distance, PRIORITY[old["source"]], old["key"], old))
        if matches:
            old = min(matches, key=lambda v: v[:3])[3]
            old["aliases"].append(candidate["key"])
        else:
            merged.append(candidate)
    for i, candidate in enumerate(merged, 1):
        candidate["id"] = i
    return merged, dict(raw=len(raw), rawBySource=dict(collections.Counter(
        c["source"] for c in raw)), merged=len(merged), duplicates=len(raw) - len(merged))


class Heights:
    def __init__(self):
        self.dtm = gdal.Open(str(AREA.elevation("dtm")))
        self.dsm = gdal.Open(str(AREA.elevation("dsm")))

    @staticmethod
    def warp(dataset, bounds):
        ds = gdal.Warp("", dataset, format="MEM", dstSRS="EPSG:2961",
                       xRes=1, yRes=1, outputBounds=bounds, errorThreshold=0,
                       resampleAlg="bilinear", dstNodata=NODATA,
                       warpMemoryLimit=16 * 1024 * 1024, multithread=False)
        return ds.ReadAsArray().astype(np.float32)

    def window(self, candidate):
        if candidate["source"] == "lidar":
            x, y = candidate["x"], candidate["y"]
            bounds = (math.floor(x - 30), math.floor(y - 30),
                      math.ceil(x + 30), math.ceil(y + 30))
        else:
            x0, x1, y0, y1 = candidate["geom"].GetEnvelope()
            bounds = (math.floor(x0 - 9), math.floor(y0 - 9),
                      math.ceil(x1 + 9), math.ceil(y1 + 9))
        ground, surface = self.warp(self.dtm, bounds), self.warp(self.dsm, bounds)
        yy, xx = np.mgrid[:ground.shape[0], :ground.shape[1]].astype(float)
        xx += bounds[0] + .5
        yy = bounds[3] - yy - .5
        return ground, surface, xx, yy


def local_roughness(z, radius):
    """RMS after removing a local plane. A pitched roof is smooth, a crown isn't."""
    size = 2 * radius + 1
    padded = np.pad(z.astype(float), radius, mode="edge")
    total = np.zeros_like(z, dtype=float)
    square, xsum, ysum = total.copy(), total.copy(), total.copy()
    h, w = z.shape
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            a = padded[radius + dy:radius + dy + h, radius + dx:radius + dx + w]
            total += a
            square += a * a
            xsum += dx * a
            ysum += dy * a
    variance_x = radius * (radius + 1) / 3
    count = size * size
    variance = square / count - (total / count) ** 2
    variance -= ((xsum / count) ** 2 + (ysum / count) ** 2) / variance_x
    return np.sqrt(np.maximum(0, variance))


def neighbourhood(mask):
    p = np.pad(mask.astype(np.uint8), 1)
    h, w = mask.shape
    return sum(p[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3))


def components(mask):
    """Eight-connected components, in fixed row/column order."""
    remaining = mask.copy()
    h, w = mask.shape
    result = []
    for row, col in zip(*np.nonzero(mask)):
        if not remaining[row, col]:
            continue
        remaining[row, col] = False
        pending, pixels = [(row, col)], []
        while pending:
            r, c = pending.pop()
            pixels.append((r, c))
            for rr in range(max(0, r - 1), min(h, r + 2)):
                for cc in range(max(0, c - 1), min(w, c + 2)):
                    if remaining[rr, cc]:
                        remaining[rr, cc] = False
                        pending.append((rr, cc))
        if len(pixels) >= 8:
            a = np.array(pixels)
            result.append((a[:, 0], a[:, 1]))
    return result


def rectangle(points, padding=0.0, preferred=None):
    """Minimum-area box on a 1 degree grid; road angle only breaks close ties.

    Robust 1/99 percentiles suppress isolated roof/tree boundary pixels. Padding
    restores the half pixel omitted by using pixel centres, never a size clamp.
    Coordinates are centred before rotation to keep numeric precision.
    """
    origin = np.mean(points, axis=0)
    p = points - origin
    best = None
    for degrees in range(180):
        theta = math.radians(degrees)
        axis = np.array([math.sin(theta), math.cos(theta)])
        cross = np.array([-axis[1], axis[0]])
        u, v = p @ axis, p @ cross
        if padding:
            lo, hi = np.percentile(u, [1, 99])
            bottom, top = np.percentile(v, [1, 99])
        else:
            lo, hi, bottom, top = u.min(), u.max(), v.min(), v.max()
        length, width = hi - lo + 2 * padding, top - bottom + 2 * padding
        score = length * width
        if preferred is not None:
            delta = abs((degrees - preferred + 45) % 90 - 45)
            score *= 1 + .002 * delta / 45
        if best is None or score < best[0] - 1e-8:
            best = score, axis, cross, lo, hi, bottom, top, length, width
    _, axis, cross, lo, hi, bottom, top, length, width = best
    centre = origin + axis * (lo + hi) / 2 + cross * (bottom + top) / 2
    if width > length:
        length, width = width, length
        axis, cross = cross, -axis
    footprint = [centre + a * length / 2 * axis + b * width / 2 * cross
                 for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return centre, axis, cross, length, width, np.array(footprint)


def split_outline(geom):
    """Conservative rectilinear cover of a mapped outline, never LiDAR guesses.

    Snap nearly parallel map edges within 1.25 m on the outline's own axes.
    Cover occupied grid cells largest-rectangle first. Reject complicated shapes
    instead of making slivers or silently filling their missing arms/courtyards.
    """
    if geom.GetGeometryName() != "POLYGON":
        return []
    centre, axis, cross, length, width, _ = rectangle(vertices(geom))
    area = geom.GetArea()
    if area / (length * width) >= .82:
        return []
    pts = vertices(geom.SimplifyPreserveTopology(.6))[:-1] - centre
    local = np.column_stack((pts @ axis, pts @ cross))

    def snap(values):
        groups = []
        for value in sorted(values):
            if groups and value - groups[-1][0] <= 1.25:
                groups[-1].append(value)
            else:
                groups.append([value])
        return np.array([np.mean(group) for group in groups])

    us, vs = snap(local[:, 0]), snap(local[:, 1])
    if not (2 <= len(us) <= 20 and 2 <= len(vs) <= 20):
        return []
    uu, vv = np.meshgrid((us[:-1] + us[1:]) / 2, (vs[:-1] + vs[1:]) / 2)
    world = centre + uu[..., None] * axis + vv[..., None] * cross
    remaining = inside(geom, world[..., 0], world[..., 1])
    boxes = []
    while remaining.any() and len(boxes) < 4:
        best = None
        for y0 in range(len(vs) - 1):
            for y1 in range(y0 + 1, len(vs)):
                columns = remaining[y0:y1].all(axis=0)
                start = None
                for x in range(len(us)):
                    if x < len(columns) and columns[x]:
                        if start is None:
                            start = x
                    elif start is not None:
                        score = (us[x] - us[start]) * (vs[y1] - vs[y0])
                        candidate = (score, start, x, y0, y1)
                        if best is None or candidate > best:
                            best = candidate
                        start = None
        if best is None:
            return []
        _, x0, x1, y0, y1 = best
        boxes.append((us[x0], us[x1], vs[y0], vs[y1]))
        remaining[y0:y1, x0:x1] = False
    if len(boxes) < 2:
        return []
    result, union = [], None
    for u0, u1, v0, v1 in boxes:
        l, w = u1 - u0, v1 - v0
        if min(l, w) < 3 or l * w < max(20, area * .08):
            continue
        c = centre + (u0 + u1) / 2 * axis + (v0 + v1) / 2 * cross
        a, b = axis, cross
        if w > l:
            l, w, a, b = w, l, cross, -axis
        footprint = np.array([c + i * l / 2 * a + j * w / 2 * b
                              for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        g = polygon(footprint)
        union = g if union is None else union.Union(g)
        result.append((c, a, b, l, w, footprint))
    if len(result) < 2:
        return []
    if union.Buffer(.02).GetGeometryName() != "POLYGON":
        return []
    intersection = union.Intersection(geom).GetArea()
    # At least 90% of the mapped walls survive, with at least 88% IoU.
    if intersection / area < .90 or intersection / (area + union.GetArea() - intersection) < .88:
        return []
    return sorted(result, key=lambda box: -box[3] * box[4])


def add_wings(buildings, seeds, audit, avoid_overlaps=False):
    """Append wing ids only after the original two-pass inventory is complete."""
    next_id = max(b["id"] for b in buildings) + 1
    seed_by_id = {c["id"]: c for c in seeds}
    audit_by_id = {a["id"]: a for a in audit}
    output, splits = [], []
    originals = {b['id']: polygon(b['footprint']) for b in buildings} if avoid_overlaps else {}
    for original in sorted(buildings, key=lambda b: b["id"]):
        seed = seed_by_id.get(original["id"])
        boxes = split_outline(seed["geom"]) if seed and seed["source"] != "lidar" else []
        if boxes and avoid_overlaps:
            # A split can extend outside the accepted simple envelope. Check the
            # rounded wings against every other original and any earlier wings.
            blockers = [g for bid, g in originals.items() if bid != original['id']]
            blockers += [polygon(b['footprint']) for b in output
                         if b.get('buildingId', b['id']) != original['id']]
            for box in boxes:
                wing = polygon(np.round(box[-1], 2))
                if any(wing.Intersects(other) and wing.Intersection(other).GetArea() /
                       min(wing.GetArea(), other.GetArea()) > .30 for other in blockers):
                    boxes = []
                    break
        if not boxes:
            output.append(original)
            continue
        ids = []
        for index, (centre, axis, cross, length, width, footprint) in enumerate(boxes):
            bid = original["id"] if index == 0 else next_id
            if index:
                next_id += 1
            item = dict(original, id=bid, buildingId=original["id"],
                        x=round(float(centre[0]), 2), y=round(float(centre[1]), 2),
                        axisDeg=round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 2) % 180,
                        length=round(length, 2), width=round(width, 2),
                        footprint=np.round(footprint, 2).tolist())
            if index == 0:
                item["site"] = original
            else:
                audit.append(dict(audit_by_id[original["id"]], id=bid, buildingId=original["id"]))
            output.append(item)
            ids.append(bid)
        splits.append(dict(buildingId=original["id"], wingIds=ids,
                           mappedArea=round(seed["geom"].GetArea(), 2)))
    return sorted(output, key=lambda b: b["id"]), splits


def robust_fit(matrix, values):
    weights = np.ones(len(values))
    for _ in range(5):
        root = np.sqrt(weights)
        coeff = np.linalg.lstsq(matrix * root[:, None], values * root, rcond=None)[0]
        residual = values - matrix @ coeff
        weights = np.minimum(1.0, .55 / np.maximum(np.abs(residual), 1e-6))
    return coeff, residual


def road_segments():
    starts, ends, ids = [], [], []
    for road in json.loads((OUT / "roads.json").read_text())["roads"]:
        if road["kind"] not in (1, 2, 3):
            continue
        for a, b in zip(road["pts"][:-1], road["pts"][1:]):
            starts.append(a)
            ends.append(b)
            ids.append(road["id"])
    return np.array(starts), np.array(ends), np.array(ids)


def nearest_road(x, y, roads):
    a, b, ids = roads
    if not len(a):
        return None, None, None
    ab = b - a
    t = np.clip(np.sum((np.array([x, y]) - a) * ab, axis=1) /
                np.maximum(np.sum(ab * ab, axis=1), 1e-9), 0, 1)
    squared = np.sum((np.array([x, y]) - a - t[:, None] * ab) ** 2, axis=1)
    index = int(np.argmin(squared))
    angle = math.degrees(math.atan2(ab[index, 0], ab[index, 1])) % 180
    return int(ids[index]), float(np.sqrt(squared[index])), angle


def kind(length, width, ridge, distance, x, y):
    area = length * width
    village = AREA.in_village(x, y)
    if area < 40 or ridge < 4.5:
        return "shed"
    if not village and ((area > 150 and ridge > 7 and distance > 45) or length > 22):
        return "barn"
    if area > 300:
        return "large"
    # Tall small buildings do not become farm buildings from height alone.
    return "house"


def measure(candidate, heights, roads):
    ground, surface, xx, yy = heights.window(candidate)
    valid = np.isfinite(ground) & np.isfinite(surface) & (ground != NODATA) & (surface != NODATA)
    h = surface - ground
    r3 = local_roughness(np.where(valid, surface, 0), 1)
    r5 = local_roughness(np.where(valid, surface, 0), 2)
    dy, dx = np.gradient(np.where(valid, surface, 0))
    # Detrended roughness alone also admits steep, smooth crown flanks. Cut
    # those connections before region labelling so a tree cannot absorb a roof.
    smooth = valid & (h > 2) & (h < 24) & (r3 < .65) & (r5 < 1.15) & (np.hypot(dx, dy) < 1.25)
    smooth &= neighbourhood(smooth) >= 4
    outline = candidate["source"] != "lidar"
    seed = inside(candidate["geom"], xx, yy) if outline else None
    if outline:
        smooth &= inside(candidate["geom"].Buffer(2.5), xx, yy)
    choices = []
    for rr, cc in components(smooth):
        distances = np.hypot(xx[rr, cc] - candidate["x"], yy[rr, cc] - candidate["y"])
        if outline:
            overlap = int(seed[rr, cc].sum())
            if overlap < 6:
                continue
            score = -overlap
        else:
            if distances.min() > 8:
                continue
            score = float(distances.min() + .10 * np.median(distances) - .03 * np.sqrt(len(rr)))
        choices.append((score, rr, cc))
    reason, diagnostics = "no_smooth_roof_near_seed", {}
    _, _, road_angle = nearest_road(candidate["x"], candidate["y"], roads)
    for _, rr, cc in sorted(choices, key=lambda c: c[0]):
        diagnostics = {}
        core = np.zeros_like(valid)
        core[rr, cc] = True
        # Recover one roof-edge pixel, but do not grow through a rough crown.
        roof = (neighbourhood(core) > 0) & valid & (h > 2) & (h < 24) & (r3 < 1.5)
        if outline:
            roof &= inside(candidate["geom"].Buffer(2.5), xx, yy)
        pts = np.column_stack((xx[roof], yy[roof]))
        box = rectangle(pts, padding=.5, preferred=road_angle)
        centre, axis, cross, length, width, footprint = box
        u = (xx - centre[0]) * axis[0] + (yy - centre[1]) * axis[1]
        v = (xx - centre[0]) * cross[0] + (yy - centre[1]) * cross[1]
        inner = valid & (abs(u) < max(.5, length / 2 - 1)) & (abs(v) < max(.5, width / 2 - 1))
        elevated = inner & (h > 2)
        fill = float(roof.sum() / max(length * width, 1))
        if len(rr) < 12 or elevated.sum() < 12 or fill < .55:
            reason = "roof_too_small_or_fragmented"
            continue
        if outline and seed[roof].sum() < .35 * seed.sum():
            # A smooth scrap of canopy inside a large map outline is not
            # evidence for replacing that building with a tiny rectangle.
            reason = "insufficient_outline_roof_support"
            continue
        z = surface[elevated].astype(float)
        z -= np.median(z)
        pu, pv = u[elevated], v[elevated]
        plane, ep = robust_fit(np.column_stack((np.ones(len(z)), pu, pv)), z)
        # Allow a modest ridge offset. The ridge still follows the long axis.
        best_gable = None
        for offset in (-width * .15, 0, width * .15):
            coeff, error = robust_fit(np.column_stack((np.ones(len(z)), pu, abs(pv - offset))), z)
            loss = float(np.median(abs(error)))
            if best_gable is None or loss < best_gable[0]:
                best_gable = loss, coeff, error
        plane_loss = float(np.median(abs(ep)))
        gable_loss, gable, eg = best_gable
        error = eg if gable_loss < plane_loss and gable[2] < 0 else ep
        inliers = float((abs(error) < 1.1).mean())
        smooth_fraction = float(((r3 < .8) & elevated).sum() / elevated.sum())
        diagnostics = dict(coreCells=len(rr), fill=round(fill, 3),
                           planeError=round(plane_loss, 3), gableError=round(gable_loss, 3),
                           inliers=round(inliers, 3), smoothFraction=round(smooth_fraction, 3))
        # With no footprint evidence, demand a cleaner fit. Smooth small tree
        # crowns can resemble a noisy two-plane roof at this raster resolution.
        minimum_inliers, maximum_error = (.78, .6) if outline else (.85, .45)
        if inliers < minimum_inliers or smooth_fraction < .72 or np.median(abs(error)) > maximum_error:
            reason = "rough_or_nonplanar_canopy"
            continue
        if not outline:
            a, b = length / 2, width / 2
            bands = ((u > a + 1) & (u < a + 4) & (abs(v) < b * .8),
                     (u < -a - 1) & (u > -a - 4) & (abs(v) < b * .8),
                     (v > b + 1) & (v < b + 4) & (abs(u) < a * .8),
                     (v < -b - 1) & (v > -b - 4) & (abs(u) < a * .8))
            fractions = [float((valid & (h < 2) & band).sum() / max(1, band.sum())) for band in bands]
            diagnostics["openEdgeFractions"] = [round(f, 3) for f in fractions]
            if sum(f > .4 for f in fractions) < 2:
                reason = "canopy_without_clear_roof_edges"
                continue
        footprint_mask = (abs(u) <= length / 2) & (abs(v) <= width / 2)
        good_ground = footprint_mask & np.isfinite(ground) & (ground != NODATA)
        if good_ground.sum() < max(4, .7 * footprint_mask.sum()):
            reason = "missing_ground"
            continue
        base = float(np.median(ground[good_ground]))
        roof_mask = footprint_mask & valid & (h > 2) & (r3 < 1.5)
        edge = roof_mask & (abs(v) > width * .28) & (abs(u) < length * .43)
        centreline = roof_mask & (abs(v) < width * .18) & (abs(u) < length * .43)
        vals = surface[roof_mask] - base
        low, high = np.percentile(vals, [20, 90])
        if high - low < .8:
            roof_type = "flat"
            eave, ridge = float(np.median(vals)), float(high)
        elif gable[2] < -.10 and gable_loss < plane_loss * .8:
            roof_type = "gable"
            eave = float(np.percentile(surface[edge] - base, 25)) if edge.sum() >= 4 else float(low)
            ridge = float(np.percentile(surface[centreline] - base, 90)) if centreline.sum() >= 4 else float(high)
        elif plane_loss < .55 and np.hypot(plane[1], plane[2]) > .08:
            roof_type = "shed"
            eave, ridge = float(low), float(high)
        else:
            roof_type = "gable"
            eave = float(np.percentile(surface[edge] - base, 25)) if edge.sum() >= 4 else float(low)
            ridge = float(np.percentile(surface[centreline] - base, 90)) if centreline.sum() >= 4 else float(high)
        ridge = max(eave, ridge)
        if not outline and roof_type == "shed" and np.hypot(plane[1], plane[2]) > .75:
            reason = "steep_single_plane_patch"
            continue
        if not outline and ((length * width < 150 and eave > 8) or
                            (length * width < 40 and ridge > 7)):
            reason = "implausibly_tall_small_roof"
            continue
        confidence = min(.96, .50 + .22 * inliers + .14 * smooth_fraction + .10 * min(fill, 1))
        if outline:
            confidence = min(.98, confidence + .03)
        return (box, base, eave, ridge, roof_type, confidence), diagnostics, None

    if not outline:
        return None, diagnostics, reason
    # Explicit map-only exception. No synthetic sizes or DTM feature elevations.
    box = rectangle(vertices(candidate["geom"]))
    centre, axis, cross, length, width, _ = box
    u = (xx - centre[0]) * axis[0] + (yy - centre[1]) * axis[1]
    v = (xx - centre[0]) * cross[0] + (yy - centre[1]) * cross[1]
    mask = (abs(u) <= length / 2) & (abs(v) <= width / 2)
    valid_ground = mask & np.isfinite(ground) & (ground != NODATA)
    if valid_ground.sum() < max(4, .7 * mask.sum()):
        return None, diagnostics, "missing_ground"
    diagnostics["fallbackReason"] = reason
    return (box, float(np.median(ground[valid_ground])), 3.0, 5.0, "gable", .25), diagnostics, None


def box_coordinates(box, xx, yy):
    centre, axis, cross, length, width, _ = box
    return ((xx - centre[0]) * axis[0] + (yy - centre[1]) * axis[1],
            (xx - centre[0]) * cross[0] + (yy - centre[1]) * cross[1])


def open_edges(box, xx, yy, valid, h):
    u, v = box_coordinates(box, xx, yy)
    a, b = box[3] / 2, box[4] / 2
    bands = ((u > a) & (u < a + 4) & (abs(v) < b * .85),
             (u < -a) & (u > -a - 4) & (abs(v) < b * .85),
             (v > b) & (v < b + 4) & (abs(u) < a * .85),
             (v < -b) & (v > -b - 4) & (abs(u) < a * .85))
    return [float((band & valid & (h < 2)).sum() / max(1, band.sum())) for band in bands]


def recover(candidate, heights, roads):
    """Try lower smooth roof layers, then a compact-blob size prior.

    Height slices disconnect a low roof from adjacent high crowns. They are
    evidence only when there are two open walls and enough smooth roof cells.
    The fallback uses an *unclipped* elevated component, never a circle cut
    out of continuous forest. No random RANSAC or intensity calibration.
    """
    ground, surface, xx, yy = heights.window(candidate)
    valid = np.isfinite(ground) & np.isfinite(surface) & (ground != NODATA) & (surface != NODATA)
    h = surface - ground
    distance = np.hypot(xx - candidate["x"], yy - candidate["y"])
    elevated = valid & (h > 2)
    if not np.any(elevated & (distance <= 8)):
        return None, {}, "no_surface_above_2m_near_seed"
    r3 = local_roughness(np.where(valid, surface, 0), 1)
    r5 = local_roughness(np.where(valid, surface, 0), 2)
    dy, dx = np.gradient(np.where(valid, surface, 0))
    smooth = elevated & (h < 18) & (r3 < 1.1) & (r5 < 2.0) & (np.hypot(dx, dy) < 1.8)
    smooth &= neighbourhood(smooth) >= 4
    _, _, road_angle = nearest_road(candidate["x"], candidate["y"], roads)
    choices = []
    seen = set()
    for cap in (4., 6., 8., 10., 13., 18.):
        for rr, cc in components(smooth & (h < cap)):
            if len(rr) < 12 or distance[rr, cc].min() > 8:
                continue
            core = np.zeros_like(valid)
            core[rr, cc] = True
            # Restore roof margins without following the high canopy.
            roof = (neighbourhood(core) > 0) & elevated & (h < cap + .75) & (r3 < 1.8)
            signature = roof.tobytes()
            if signature in seen:
                continue
            seen.add(signature)
            box = rectangle(np.column_stack((xx[roof], yy[roof])), .5, road_angle)
            centre, axis, cross, length, width, footprint = box
            if not (3.5 <= width <= 30 and 5 <= length <= 60 and 22 <= length * width <= 650):
                continue
            u, v = box_coordinates(box, xx, yy)
            mask = (abs(u) <= length / 2) & (abs(v) <= width / 2)
            inner = mask & (abs(u) < length / 2 - .5) & (abs(v) < width / 2 - .5)
            support = inner & elevated & (h < cap + .75)
            fill = float(support.sum() / max(1, inner.sum()))
            edges = open_edges(box, xx, yy, valid, h)
            if fill < .65 or sum(f > .3 for f in edges) < 2 or support.sum() < 18:
                continue
            # Fit only the lower roof layer. Complex roofs may have several
            # planes; a robust main plane or gable is enough for a game box.
            z = surface[support].astype(float)
            z -= np.median(z)
            pu, pv = u[support], v[support]
            plane, ep = robust_fit(np.column_stack((np.ones(len(z)), pu, pv)), z)
            gable, eg = robust_fit(np.column_stack((np.ones(len(z)), pu, abs(pv))), z)
            loss_p, loss_g = float(np.median(abs(ep))), float(np.median(abs(eg)))
            error = eg if gable[2] < -.08 and loss_g < loss_p else ep
            loss = float(np.median(abs(error)))
            inliers = float((abs(error) < 1.4).mean())
            smooth_fraction = float((r3[support] < 1.1).mean())
            if loss > 1.05 or inliers < .64 or smooth_fraction < .40:
                continue
            good_ground = mask & np.isfinite(ground) & (ground != NODATA)
            if good_ground.sum() < max(4, .7 * mask.sum()):
                continue
            base = float(np.median(ground[good_ground]))
            low, high = np.percentile(surface[support] - base, [15, 90])
            eave, ridge = max(1.8, float(low)), max(1.8, float(high))
            if eave > 8 or ridge > 11:
                continue
            roof_type = "flat" if ridge - eave < .8 else "gable"
            confidence = float(np.clip(.3 + .15 * inliers + .15 * smooth_fraction - .12 * loss, .3, .6))
            diagnostic = dict(recovery="lower_smooth_layer", heightCap=cap,
                              coreCells=len(rr), fill=round(fill, 3), fitError=round(loss, 3),
                              inliers=round(inliers, 3), smoothFraction=round(smooth_fraction, 3),
                              openEdgeFractions=[round(f, 3) for f in edges])
            # Prefer the main roof over an exceptionally smooth porch. A
            # low height slice must not win merely by discarding the ridge.
            score = (.35 * loss + .04 * np.linalg.norm(centre - [candidate["x"], candidate["y"]])
                     - .04 * math.sqrt(len(rr)) - .15 * fill)
            choices.append((score, (box, base, eave, ridge, roof_type, confidence), diagnostic))
    if choices:
        _, measured, diagnostic = min(choices, key=lambda c: c[0])
        return measured, diagnostic, None

    blobs = []
    for rr, cc in components(elevated):
        area = len(rr)
        if not (20 <= area <= 400) or distance[rr, cc].min() > 8:
            continue
        # A component touching the window edge may continue into forest.
        if np.any((rr == 0) | (cc == 0) | (rr == h.shape[0] - 1) | (cc == h.shape[1] - 1)):
            continue
        pts = np.column_stack((xx[rr, cc], yy[rr, cc]))
        blob_box = rectangle(pts, .5)
        fill = area / (blob_box[3] * blob_box[4])
        edges = open_edges(blob_box, xx, yy, valid, h)
        smooth_fraction = float((r3[rr, cc] < 1.1).mean())
        # Compact isolated crowns remain a known ambiguity. Exclude tall
        # crowns, long hedges and blobs with almost no planar evidence.
        if (fill < .45 or blob_box[3] / blob_box[4] > 4 or
                np.percentile(h[rr, cc], 75) > 11 or smooth_fraction < .18 or
                sum(f > .3 for f in edges) < 2):
            continue
        centre = pts.mean(axis=0)
        _, road_distance, angle = nearest_road(*centre, roads)
        if road_distance is not None and road_distance <= 80:
            axis = np.array([math.sin(math.radians(angle)), math.cos(math.radians(angle))])
        else:
            _, vectors = np.linalg.eigh(np.cov((pts - centre).T))
            axis = vectors[:, -1]
        cross = np.array([-axis[1], axis[0]])
        length, width, eave, ridge = (5., 4., 2.3, 3.3) if area < 35 else (11., 8., 2.9, 5.4)
        footprint = np.array([centre + a * length / 2 * axis + b * width / 2 * cross
                             for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        box = centre, axis, cross, length, width, footprint
        u, v = box_coordinates(box, xx, yy)
        mask = (abs(u) <= length / 2) & (abs(v) <= width / 2)
        good_ground = mask & np.isfinite(ground) & (ground != NODATA)
        if good_ground.sum() < max(4, .7 * mask.sum()):
            continue
        diagnostic = dict(recovery="compact_blob_prior", blobArea=area, blobFill=round(fill, 3),
                          smoothFraction=round(smooth_fraction, 3),
                          openEdgeFractions=[round(f, 3) for f in edges])
        score = float(distance[rr, cc].min() + .1 * np.linalg.norm(centre - [candidate["x"], candidate["y"]]))
        blobs.append((score, (box, float(np.median(ground[good_ground])), eave, ridge, "gable", .2), diagnostic))
    if blobs:
        _, measured, diagnostic = min(blobs, key=lambda c: c[0])
        return measured, diagnostic, None
    return None, {}, "no_compact_built_like_blob"


def too_big(length, width, eave, ridge):
    """The upper limits of one measured rectangle and one roof. Above them the building is measured as blocks."""
    return width > 40 or length > 120 or eave > 14 or ridge > 22


def measure_big(seed, heights):
    """A large mapped outline as blocks, or a round one as a tank (big_buildings.py): (blocks, diagnostics, reason).

    Each block is (box, ground, eave, ridge, roof, confidence, round) with the box of rectangle(). Blocks lie
    inside the mapped outline, on a 1 m grid in the outline's own frame; a tank's box is its bounding square.
    """
    geom = seed["geom"]
    ground, surface, xx, yy = heights.window(seed)
    valid = np.isfinite(ground) & np.isfinite(surface) & (ground != NODATA) & (surface != NODATA)
    h = np.where(valid, surface - ground, np.nan)
    h[h > big.MAX_HEIGHT] = np.nan
    x_left, y_top = xx[0, 0] - .5, yy[0, 0] + .5

    def sample(grid, x, y):
        col, row = np.floor(x - x_left).astype(int), np.floor(y_top - y).astype(int)
        ok = (row >= 0) & (row < grid.shape[0]) & (col >= 0) & (col < grid.shape[1])
        return np.where(ok, grid[np.clip(row, 0, grid.shape[0] - 1), np.clip(col, 0, grid.shape[1] - 1)], np.nan)

    corners = len(vertices(geom)) - 1
    if big.is_round(geom.GetArea(), geom.Boundary().Length(), corners):
        found = big.tank(xx, yy, h, inside(geom.Buffer(4), xx, yy))
        diagnostics = dict(big="tank", **{k: round(v, 3) for k, v in found.items() if k != "reason"})
        if "reason" in found:
            return None, diagnostics, "tank_" + found["reason"]
        d, centre = found["diameter"], np.array([found["x"], found["y"]])
        axis, cross = np.array([0., 1.]), np.array([-1., 0.])
        turns = np.arange(big.TANK_POINTS) * 2 * math.pi / big.TANK_POINTS  # north, then west: counter-clockwise
        footprint = centre + d / 2 * (np.cos(turns)[:, None] * axis + np.sin(turns)[:, None] * cross)
        disc = np.hypot(xx - centre[0], yy - centre[1]) < d / 2
        good = disc & np.isfinite(ground) & (ground != NODATA)
        if good.sum() < .7 * disc.sum():
            return None, diagnostics, "missing_ground"
        confidence = round(min(.95, .5 + .25 * found["rim"] + .2 * found["roundness"]), 2)
        roof = "flat" if found["ridge"] - found["eave"] < .8 else "gable"
        return [((centre, axis, cross, d, d, footprint), float(np.median(ground[good])), found["eave"],
                 found["ridge"], roof, confidence, True)], diagnostics, None

    points = vertices(geom)
    area = geom.GetArea()
    frames = []
    for angle in big.wall_directions(points):
        # A 1 m grid in the frame of these walls, over the whole outline.
        theta = math.radians(angle)
        axis, cross = np.array([math.sin(theta), math.cos(theta)]), np.array([-math.cos(theta), math.sin(theta)])
        pu, pv = points @ axis, points @ cross
        nu, nv = math.ceil(pu.max() - pu.min()), math.ceil(pv.max() - pv.min())
        du, dv = (pu.max() - pu.min()) / nu, (pv.max() - pv.min()) / nv
        uu, vv = np.meshgrid(pu.min() + (np.arange(nu) + .5) * du, pv.min() + (np.arange(nv) + .5) * dv)
        wx, wy = uu * axis[0] + vv * cross[0], uu * axis[1] + vv * cross[1]
        free = inside(geom, wx, wy)
        frames.append(dict(angle=angle, axis=axis, cross=cross, u0=pu.min(), v0=pv.min(), du=du, dv=dv, wx=wx, wy=wy,
                           free=free, h=np.where(free, sample(h, wx, wy), np.nan),
                           ground=sample(np.where(np.isfinite(ground) & (ground != NODATA), ground, np.nan), wx, wy)))
    first = frames[0]
    standing = float((first["h"] > big.ABOVE_GROUND).sum() / max(1, first["free"].sum()))
    if standing < big.MIN_STANDING:
        return None, dict(big="blocks", standing=round(standing, 3)), "big_outline_does_not_stand"

    def shared(frame, block, other):
        """The cells of frame `other` that lie in this block of `frame`."""
        f, g = frames[frame], frames[other]
        u, v = g["wx"] * f["axis"][0] + g["wy"] * f["axis"][1], g["wx"] * f["cross"][0] + g["wy"] * f["cross"][1]
        r0, r1, c0, c1 = block
        return ((u >= f["u0"] + c0 * f["du"]) & (u <= f["u0"] + c1 * f["du"]) &
                (v >= f["v0"] + r0 * f["dv"]) & (v <= f["v0"] + r1 * f["dv"]))

    found = big.cover([f["free"] for f in frames], cells=[f["du"] * f["dv"] for f in frames],
                      min_area=max(60, .015 * area), shared=shared)
    blocks, rows, covered, count = [], [], 0., len(found)
    for index, f in enumerate(frames):
        mine = [block[1:] for block in found if block[0] == index]
        cut = big.split_steps(f["h"], mine, max_blocks=big.MAX_BLOCKS - (count - len(mine))) if mine else []
        count += len(cut) - len(mine)
        for r0, r1, c0, c1 in cut:
            roof = big.block_roof(f["h"], (r0, r1, c0, c1))
            cells = f["ground"][r0:r1, c0:c1]
            u0, u1, v0, v1 = f["u0"] + c0 * f["du"], f["u0"] + c1 * f["du"], f["v0"] + r0 * f["dv"], f["v0"] + r1 * f["dv"]
            l, w, a, b = u1 - u0, v1 - v0, f["axis"], f["cross"]
            c = (u0 + u1) / 2 * a + (v0 + v1) / 2 * b
            if w > l:
                l, w, a, b = w, l, b, -a
            footprint = np.array([c + i * l / 2 * a + j * w / 2 * b for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            row = dict(length=round(float(l), 2), width=round(float(w), 2), frame=round(f["angle"], 1),
                       **{k: round(val, 3) if isinstance(val, float) else val for k, val in roof.items()})
            rows.append(row)
            if roof["standing"] < big.MIN_STANDING or "eave" not in roof or roof["eave"] < 1.8:
                row["left"] = "does_not_stand"
                continue
            if np.isfinite(cells).sum() < .7 * cells.size:
                row["left"] = "missing_ground"
                continue
            if roof["near"] < big.MIN_NEAR:
                row["left"] = "no_roof_level"
                continue
            confidence = round(min(.95, .5 + .25 * roof["standing"] + .2 * roof["near"]), 2)
            blocks.append(((c, a, b, float(l), float(w), footprint), float(np.nanmedian(cells)), roof["eave"],
                           roof["ridge"], roof["roof"], confidence, False))
            covered += float(l * w)
    blocks.sort(key=lambda block: -block[0][3] * block[0][4])
    diagnostics = dict(big="blocks", standing=round(standing, 3), cover=round(float(covered / area), 3), blocks=rows)
    if not blocks or diagnostics["cover"] < big.MIN_COVER:
        return None, diagnostics, "big_outline_not_covered_by_blocks"
    return blocks, diagnostics, None


def add_big(kept, rejected, seed_by_id, heights, roads, landmarks, mid, audit):
    """Measure the large outlines that the size gate dropped, as blocks or tanks: (kept, rejected, counts).

    Only an outline seed of at least big.MIN_OUTLINE_AREA that failed an upper limit comes here. The first (largest)
    block keeps the seed's id; further blocks get new ids above every id in use. A block is left out when it is not
    inside the area, touches a hand-modelled landmark, overlaps a building that is already kept, or lies over a
    public road line. A building whose remaining blocks cover too little is left out as a whole. So is an outline
    that a hand-built site of the game replaces (AREA.big_buildings_skip) or that the map calls a ruin.
    """
    starts, ends, _ = roads
    geometries = [(b, polygon(b["footprint"])) for b in kept]
    next_id = max([b["id"] for b in kept] + list(seed_by_id)) + 1
    still, counts = [], collections.Counter()
    for old in rejected:
        seed = seed_by_id[old["id"]]
        m = old.get("measured")
        if (old["reason"] != "outside_sanity_bounds" or seed["source"] == "lidar" or not m or
                seed["geom"].GetGeometryName() != "POLYGON" or seed["geom"].GetArea() < big.MIN_OUTLINE_AREA or
                not too_big(m["length"], m["width"], m["eave"], m["ridge"])):
            still.append(old)
            continue
        area = seed["geom"].GetArea()
        if any(seed["geom"].Contains(point(x, y)) for x, y in AREA.big_buildings_skip):
            blocks, diagnostics, reason = None, {}, "hand_built_site"
        elif "ruin" in str(seed.get("attributes", {}).get("FEAT_DESC", "")).lower():
            # The province's class "ruin/inactive/abandoned". What stands in such an outline can be trees: the
            # heights cannot tell a crown from a broken roof, so the map's word decides.
            blocks, diagnostics, reason = None, {}, "mapped_as_ruin"
        else:
            blocks, diagnostics, reason = measure_big(seed, heights)
        chosen = []
        for box, base, eave, ridge, roof, confidence, is_round in blocks or []:
            centre, axis, cross, length, width, footprint = box
            footprint = np.round(footprint, 2)
            geometry = point(*centre).Buffer(length / 2) if is_round else polygon(footprint)
            left = None
            if not all(mid[0] <= x <= mid[2] and mid[1] <= y <= mid[3] for x, y in footprint):
                left = "outside_mid"
            elif any(geometry.Intersects(g) for g in landmarks):
                left = "hand_modelled_landmark"
            elif any(geometry.Intersects(g) and geometry.Intersection(g).GetArea() / min(geometry.GetArea(), g.GetArea()) > .30
                     for _, g in geometries):
                left = "overlaps_kept_building"
            elif len(starts):
                near = ((np.maximum(starts[:, 0], ends[:, 0]) > footprint[:, 0].min()) &
                        (np.minimum(starts[:, 0], ends[:, 0]) < footprint[:, 0].max()) &
                        (np.maximum(starts[:, 1], ends[:, 1]) > footprint[:, 1].min()) &
                        (np.minimum(starts[:, 1], ends[:, 1]) < footprint[:, 1].max()))
                under = 0.
                for a, b in zip(starts[near], ends[near]):
                    line = ogr.Geometry(ogr.wkbLineString)
                    line.AddPoint_2D(float(a[0]), float(a[1]))
                    line.AddPoint_2D(float(b[0]), float(b[1]))
                    under += line.Intersection(geometry).Length()
                if under > 5:
                    left = "public_road_under_block"
            if left:
                diagnostics.setdefault("leftBlocks", []).append(dict(reason=left, length=round(length, 2), width=round(width, 2)))
            else:
                chosen.append((box, footprint, base, eave, ridge, roof, confidence, is_round, geometry))
        if not reason and sum(c[0][3] * c[0][4] for c in chosen) < big.MIN_COVER * (
                sum(b[0][3] * b[0][4] for b in blocks) if blocks[0][6] else area):
            reason = diagnostics.get("leftBlocks", [dict(reason="big_outline_not_covered_by_blocks")])[0]["reason"]
        if reason:
            counts["leftOut:" + reason] += 1
            still.append(dict(old, firstPassReason=old["reason"], reason=reason, bigDiagnostics=diagnostics))
            continue
        ids = []
        for index, (box, footprint, base, eave, ridge, roof, confidence, is_round, geometry) in enumerate(chosen):
            centre, axis, cross, length, width, _ = box
            bid = seed["id"] if index == 0 else next_id
            next_id += index > 0
            road_id, distance, _ = nearest_road(*centre, roads)
            item = dict(id=bid, x=round(float(centre[0]), 2), y=round(float(centre[1]), 2), ground=round(base, 2),
                        footprint=footprint.tolist(),
                        axisDeg=round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 2) % 180,
                        length=round(length, 2), width=round(width, 2), eave=round(eave, 2),
                        ridge=round(max(eave, ridge), 2), roof=roof, kind="large", source=seed["source"],
                        confidence=confidence, nearRoad=road_id,
                        roadDist=round(distance, 2) if distance is not None else None,
                        shape="tank" if is_round else "block")
            if len(chosen) > 1:
                item["buildingId"] = seed["id"]
            kept.append(item)
            geometries.append((item, geometry))
            row = dict(id=bid, key=seed["key"], aliases=seed["aliases"], firstPassReason=old["reason"])
            audit.append(dict(row, **diagnostics) if index == 0 else dict(row, buildingId=seed["id"], big=diagnostics["big"]))
            ids.append(bid)
        if chosen[0][7]:
            counts["tanks"] += 1
        else:
            counts["buildings"] += 1
            counts["blocks"] += len(chosen)
    return sorted(kept, key=lambda b: b["id"]), sorted(still, key=lambda r: r["id"]), dict(sorted(counts.items()))


def preserved_sites(items):
    """The property records that --preserve-sites keeps: one for each building, by its first item.

    Large buildings measured as blocks or tanks carry "shape". They are measured again on every bake, never preserved.
    """
    return [b.get("site", b) for b in items if b.get("buildingId", b["id"]) == b["id"] and "shape" not in b]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-manifest", action="store_true")
    parser.add_argument("--preserve-sites", action="store_true",
                        help="Keep the existing property records exactly while adding/rebuilding wings; fail if inventory IDs change")
    args = parser.parse_args()
    guard_big(OUT / "buildings.json", BIG_SET, BIG)  # before anything is read or written
    existing = preserved_sites([b for b in json.loads((OUT / "buildings.json").read_text())["buildings"] if b.get("source") != "hand"]) if args.preserve_sites else None
    WORK.mkdir(parents=True, exist_ok=True)
    mid = json.loads((OUT / "manifest.json").read_text())["mid"]
    seeds, counts = candidates(mid)
    roads, heights = road_segments(), Heights()
    landmarks = [polygon(item["footprint"]) for item in json.loads((OUT / "landmarks.json").read_text())]
    rejected, provisional, audit = [], [], []

    def reject(seed, reason, **extra):
        rejected.append(dict(id=seed["id"], key=seed["key"], source=seed["source"],
                             x=round(seed["x"], 2), y=round(seed["y"], 2), reason=reason, **extra))

    print("Candidates", counts, flush=True)
    for number, seed in enumerate(seeds, 1):
        if any(seed["geom"].Intersects(g) for g in landmarks):
            reject(seed, "hand_modelled_landmark")
            continue
        measured, diagnostic, reason = measure(seed, heights, roads)
        if reason:
            reject(seed, reason, diagnostics=diagnostic)
            continue
        box, base, eave, ridge, roof, confidence = measured
        centre, axis, cross, length, width, footprint = box
        if not all(mid[0] <= x <= mid[2] and mid[1] <= y <= mid[3] for x, y in footprint):
            reject(seed, "measured_footprint_outside_mid")
            continue
        if not (2.5 <= width <= 40 and 3 <= length <= 120 and 1.8 <= eave <= 14 and eave <= ridge <= 22):
            reject(seed, "outside_sanity_bounds", measured=dict(length=round(length, 2),
                   width=round(width, 2), eave=round(eave, 2), ridge=round(ridge, 2)))
            continue
        geometry = polygon(footprint)
        if any(geometry.Intersects(g) for g in landmarks):
            reject(seed, "hand_modelled_landmark")
            continue
        road_id, distance, _ = nearest_road(*centre, roads)
        building_kind = kind(length, width, ridge, distance if distance is not None else math.inf, *centre)
        if building_kind == "house" and ridge > 11 and seed["source"] == "lidar":
            reject(seed, "implausibly_tall_small_roof", ridge=round(ridge, 2))
            continue
        item = dict(id=seed["id"], x=round(float(centre[0]), 2), y=round(float(centre[1]), 2),
                    ground=round(base, 2), footprint=np.round(footprint, 2).tolist(),
                    axisDeg=round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 2) % 180,
                    length=round(length, 2), width=round(width, 2), eave=round(eave, 2),
                    ridge=round(ridge, 2), roof=roof,
                    kind=building_kind,
                    source=seed["source"], confidence=round(confidence, 2),
                    nearRoad=road_id, roadDist=round(distance, 2) if distance is not None else None)
        provisional.append((seed, item, polygon(item["footprint"])))
        audit.append(dict(id=seed["id"], key=seed["key"], aliases=seed["aliases"], **diagnostic))
        if number % 100 == 0:
            print(f"Measured {number}/{len(seeds)}", flush=True)

    kept, geometries = [], []
    # Resolve both mismatched map sources and nearby point seeds that found the
    # same roof. Prefer source rank, then measured confidence, then stable id.
    for seed, item, geom in sorted(provisional, key=lambda row: (
            PRIORITY[row[1]["source"]], -row[1]["confidence"], row[1]["id"])):
        overlap = None
        for old, other in geometries:
            if geom.Intersects(other):
                share = geom.Intersection(other).GetArea() / min(geom.GetArea(), other.GetArea())
                if share > .30:
                    overlap = old["id"]
                    break
        if overlap is not None:
            reject(seed, "overlap_duplicate", keptId=overlap)
        else:
            kept.append(item)
            geometries.append((item, geom))
    first_pass_counts = dict(kept=len(kept),
        keptByKind=dict(collections.Counter(c["kind"] for c in kept)),
        keptBySource=dict(collections.Counter(c["source"] for c in kept)))
    # Above every candidate id, kept or rejected, so a recovered building can never reuse a rejected one's id.
    next_id = max([b["id"] for b in kept] + [s["id"] for s in seeds], default=0) + 1
    recovery_start_id = next_id
    seed_by_id = {s["id"]: s for s in seeds}
    still_rejected = []
    for number, old in enumerate(sorted(rejected, key=lambda r: r["id"]), 1):
        if number % 100 == 0:
            print(f"Recovery {number}/{len(rejected)}: {next_id - recovery_start_id} added", flush=True)
        seed = seed_by_id[old["id"]]
        if seed["source"] != "lidar" or old["reason"] in (
                "hand_modelled_landmark", "overlap_duplicate", "measured_footprint_outside_mid"):
            still_rejected.append(old)
            continue
        measured, diagnostic, reason = recover(seed, heights, roads)
        if reason:
            still_rejected.append(dict(old, firstPassReason=old["reason"], reason=reason))
            continue
        box, base, eave, ridge, roof, confidence = measured
        centre, axis, cross, length, width, footprint = box
        reason = None
        if not all(mid[0] <= x <= mid[2] and mid[1] <= y <= mid[3] for x, y in footprint):
            reason = "measured_footprint_outside_mid"
        elif not (2.5 <= width <= 40 and 3 <= length <= 120 and 1.8 <= eave <= 14 and eave <= ridge <= 22):
            reason = "outside_sanity_bounds"
        # Test the rounded footprint, exactly as written and checked on disk.
        geometry = polygon(np.round(footprint, 2))
        if any(geometry.Intersects(g) for g in landmarks):
            reason = "hand_modelled_landmark"
        overlap = None
        for other, geom in geometries:
            if geometry.Intersects(geom) and geometry.Intersection(geom).GetArea() / min(geometry.GetArea(), geom.GetArea()) > .30:
                reason, overlap = "overlap_duplicate", other["id"]
                break
        if reason:
            still_rejected.append(dict(old, firstPassReason=old["reason"], reason=reason,
                                       recoveryDiagnostics=diagnostic, keptId=overlap))
            continue
        road_id, distance, _ = nearest_road(*centre, roads)
        source = "fallback" if confidence == .2 else "second_pass"
        item = dict(id=next_id, x=round(float(centre[0]), 2), y=round(float(centre[1]), 2),
                    ground=round(base, 2), footprint=np.round(footprint, 2).tolist(),
                    axisDeg=round(math.degrees(math.atan2(axis[0], axis[1])) % 180, 2) % 180,
                    length=round(length, 2), width=round(width, 2), eave=round(eave, 2),
                    ridge=round(ridge, 2), roof=roof,
                    kind=kind(length, width, ridge, distance if distance is not None else math.inf, *centre),
                    source=source, confidence=round(confidence, 2), nearRoad=road_id,
                    roadDist=round(distance, 2) if distance is not None else None)
        kept.append(item)
        geometries.append((item, geometry))
        audit.append(dict(id=next_id, candidateId=seed["id"], key=seed["key"], aliases=seed["aliases"],
                          firstPassReason=old["reason"], **diagnostic))
        next_id += 1
    rejected = still_rejected
    kept.sort(key=lambda item: item["id"])
    rejected.sort(key=lambda item: item["id"])
    if existing is not None:
        if {b["id"] for b in kept} != {b["id"] for b in existing}:
            raise RuntimeError("Building inventory changed; cannot preserve sites")
        kept = existing
    kept, splits = add_wings(kept, seeds, audit, avoid_overlaps=AREA.avoid_wing_overlaps)
    dump(WORK / "buildings-wings.json", splits)
    big_counts = None
    if BIG:
        # Everything above is as it was: the same records and the same ids. The large buildings come last.
        kept, rejected, big_counts = add_big(kept, rejected, seed_by_id, heights, roads, landmarks, mid, audit)
    from dashcam_corrections import NOV18, hand_buildings
    def hand_ground(x, y):
        cells = heights.warp(heights.dtm, (x-1, y-1, x+1, y+1))
        return float(np.median(cells[cells != NODATA]))
    hand_roads = json.loads((OUT / "roads.json").read_text())["roads"] if AREA.id == 'mabou' else []
    kept = hand_buildings(kept, AREA.id, hand_ground, hand_roads)
    kept = hand_buildings(kept, AREA.id, hand_ground, hand_roads, observations=NOV18)
    # Mabou main street (the project brief): two kinds and the hall's measured blocks, on exact ids. Idempotent.
    from mabou_main import correct_buildings
    kept = correct_buildings(kept, AREA.id, audit)
    for item in kept:
        if item.get("source") != "hand":
            continue
        key = f"hand:{item['id']}"
        audit.append(dict(id=item["id"], key=key, provenance=item["provenance"]))
        seeds.append(dict(id=item["id"], key=key, source="hand", x=item["x"], y=item["y"], aliases=[], attributes={}))
    dump(OUT / "buildings.json", dict(crs="EPSG:2961", buildings=kept))
    dump(WORK / "buildings-rejected.json", rejected)
    accepted_ids = {item["id"] for item in kept}
    dump(WORK / "buildings-audit.json", [row for row in audit if row["id"] in accepted_ids])
    dump(WORK / "buildings-candidates.json", [dict(id=c["id"], key=c["key"], source=c["source"],
         x=round(c["x"], 2), y=round(c["y"], 2), aliases=c["aliases"], attributes=c["attributes"])
         for c in seeds])
    if existing is not None:
        counts["preservedSiteSha256"] = hashlib.sha256(json.dumps(
            sorted(existing, key=lambda b: b["id"]), separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    if big_counts is not None:
        counts["big"] = big_counts
    counts.update(originalBuildings=sum(b.get("buildingId", b["id"]) == b["id"] for b in kept),
                  splitBuildings=len({b["buildingId"] for b in kept if "buildingId" in b and "shape" not in b}),
                  wings=sum("buildingId" in b and "shape" not in b for b in kept), kept=len(kept), keptByKind=dict(collections.Counter(c["kind"] for c in kept)),
                  keptBySource=dict(collections.Counter(c["source"] for c in kept)),
                  fallback=sum(c["source"] == "fallback" for c in kept),
                  mapOnly=sum(c["source"] in PRIORITY and c["confidence"] <= .3 for c in kept),
                  firstPass=first_pass_counts,
                  rejected=len(rejected), rejectedByReason=dict(collections.Counter(c["reason"] for c in rejected)),
                  sha256=hashlib.sha256((OUT / "buildings.json").read_bytes()).hexdigest())
    dump(WORK / "buildings-counts.json", counts)
    if not args.no_manifest:
        # Other stages write this file too. Read NOW, change only our own key.
        manifest = json.loads((OUT / "manifest.json").read_text())
        manifest["buildings"] = dict(file="buildings.json", count=len(kept))
        dump(OUT / "manifest.json", manifest)
    print(json.dumps(counts, indent=2), flush=True)


if __name__ == "__main__":
    main()
