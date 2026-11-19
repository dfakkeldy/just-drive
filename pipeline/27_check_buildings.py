#!/usr/bin/env python3
"""Validate the building bake and draw 1 m SURFACE hillshade overlays.

Run in the same GDAL/numpy container as 27_bake_buildings.py. Writes only to
data/work/. Colours: house cyan, barn orange, shed yellow, large magenta;
measured solid, second pass long dashes, fallback dots, map-only dash-dot;
rejected seeds red crosses. Sidecar JSON
files record picture bounds and the ids visible in each picture.
"""
import collections
import hashlib
import importlib.util
import json
import math
import random
import sys

import numpy as np
from osgeo import gdal, ogr, osr

sys.dont_write_bytecode = True  # All checker artifacts belong under data/work/.
spec = importlib.util.spec_from_file_location("buildings", __file__.replace("27_check_", "27_bake_"))
bake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bake)
COLOURS = {"house": (0, 238, 255), "barn": (255, 145, 35),
           "shed": (255, 235, 60), "large": (255, 70, 230)}
# Tiny id labels have no font or Pillow dependency.
DIGITS = ("111101101101111", "010110010010111", "111001111100111",
          "111001111001111", "101101111001001", "111100111001111",
          "111100111101111", "111001010010010", "111101111101111",
          "111101111001111")


def line(points):
    geom = ogr.Geometry(ogr.wkbLineString)
    for x, y in points:
        geom.AddPoint_2D(float(x), float(y))
    return geom


def label(rgb, col, row, text, colour):
    width = len(text) * 4
    h, w = rgb.shape[1:]
    col, row = int(col), int(row)
    if row < 1 or col < 1 or row + 6 >= h or col + width + 1 >= w:
        return
    rgb[:, row - 1:row + 6, col - 1:col + width] = 24
    for index, digit in enumerate(text):
        for r in range(5):
            for c in range(3):
                if DIGITS[int(digit)][r * 3 + c] == "1":
                    rgb[:, row + r, col + 4 * index + c] = colour


def overlay(name, centre, buildings, rejected, heights, size=(1400, 1100)):
    width, height = size
    xmin, ymin = math.floor(centre[0] - width / 2), math.floor(centre[1] - height / 2)
    bounds = (xmin, ymin, xmin + width, ymin + height)
    surface = heights.warp(heights.dsm, bounds)
    valid = (surface != bake.NODATA) & np.isfinite(surface)
    z = np.where(valid, surface, 0)
    dy, dx = np.gradient(z)
    # Light from northwest. dy points south in this raster.
    shade = (-.5 * dx + .5 * dy + math.sqrt(.5)) / np.sqrt(1 + dx * dx + dy * dy)
    grey = np.clip(55 + 185 * shade, 30, 240).astype(np.uint8)
    grey[~valid] = 245
    rgb = np.stack([grey] * 3)
    ds = gdal.GetDriverByName("MEM").Create("", width, height, 3, gdal.GDT_Byte)
    ds.SetGeoTransform((xmin, 1, 0, ymin + height, 0, -1))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(2961)
    ds.SetProjection(srs.ExportToWkt())
    for band in range(3):
        ds.GetRasterBand(band + 1).WriteArray(rgb[band])
    vector = ogr.GetDriverByName("MEM").CreateDataSource("")

    def burn(key, geometries, colour):
        layer = vector.CreateLayer(key, srs=srs, geom_type=ogr.wkbLineString)
        for geom in geometries:
            feature = ogr.Feature(layer.GetLayerDefn())
            feature.SetGeometry(geom)
            layer.CreateFeature(feature)
        gdal.RasterizeLayer(ds, [1, 2, 3], layer, burn_values=list(colour), options=["ALL_TOUCHED=TRUE"])

    visible = [b for b in buildings if xmin <= b["x"] <= xmin + width and ymin <= b["y"] <= ymin + height]
    # Dash lengths are metres, so styles remain the same in detail crops.
    styles = {"measured": None, "second_pass": (4., 2.),
              "fallback": (1., 2.), "map_only": (3., 2., 1., 2.)}
    for style, pattern in styles.items():
        for kind, colour in COLOURS.items():
            lines = []
            for building in visible:
                source = building["source"]
                category = source if source in ("second_pass", "fallback") else (
                    "map_only" if building["confidence"] <= .3 else "measured")
                if building["kind"] != kind or category != style:
                    continue
                pts = building["footprint"]
                if pattern is None:
                    lines.append(line(pts + pts[:1]))
                    continue
                for a, b in zip(pts, pts[1:] + pts[:1]):
                    a, b = np.array(a), np.array(b)
                    length = float(np.linalg.norm(b - a))
                    offset, step = 0., 0
                    while offset < length:
                        end = min(length, offset + pattern[step % len(pattern)])
                        if step % 2 == 0:
                            lines.append(line([a + (b - a) * offset / length,
                                               a + (b - a) * end / length]))
                        offset, step = end, step + 1
            burn(style + "_" + kind, lines, colour)
    crosses = []
    visible_rejected = []
    for rejected_item in rejected:
        x, y = rejected_item["x"], rejected_item["y"]
        if xmin <= x <= xmin + width and ymin <= y <= ymin + height:
            crosses += [line([(x - 3, y - 3), (x + 3, y + 3)]),
                        line([(x - 3, y + 3), (x + 3, y - 3)])]
            visible_rejected.append(rejected_item["id"])
    burn("rejected", crosses, (255, 65, 65))
    rgb = ds.ReadAsArray()
    for building in visible:
        label(rgb, building["x"] - xmin + 3, ymin + height - building["y"] + 3,
              str(building["id"]), COLOURS[building["kind"]])
    for band in range(3):
        ds.GetRasterBand(band + 1).WriteArray(rgb[band])
    path = bake.WORK / f"buildings-check-{name}.png"
    gdal.GetDriverByName("PNG").CreateCopy(str(path), ds, options=["ZLEVEL=9"])
    aux = path.with_name(path.name + ".aux.xml")
    if aux.exists():
        aux.unlink()
    bake.dump(path.with_suffix(".json"), dict(bounds=bounds, resolution=1,
              model="DSM surface hillshade", colours=COLOURS,
              lineStyles=dict(measured="solid", second_pass="4m dash / 2m gap",
                              fallback="1m dot / 2m gap", map_only="dash-dot", rejected="red X"),
              keptIds=[b["id"] for b in visible], rejectedIds=visible_rejected))
    print(f"Overlay {path.name}: {len(visible)} buildings, {len(visible_rejected)} rejected", flush=True)


def check_big(buildings, rejected, seeds, counts):
    """Large buildings as blocks and tanks: measure every one again from the raw heights, in world cells.

    The bake measures on a grid in the outline's own frame. Here each stored footprint is tested on the raster
    itself, so a wrong frame, a wrong height or a block beside its building fails. The outlines that were left out
    because nothing stands there are measured again too: they must still be below the threshold.
    """
    big = bake.big
    groups = collections.defaultdict(list)
    for item in buildings:
        if "shape" in item:
            groups[item.get("buildingId", item["id"])].append(item)
    if not bake.BIG:
        assert not groups, "this land has large buildings, but the switch is off: set MMM_BIG_BUILDINGS=1 to check them"
        return None
    heights = bake.Heights()
    starts, ends, _ = bake.road_segments()

    def surfaces(geom):
        ground, surface, xx, yy = heights.window(dict(source="polygon", geom=geom))
        valid = np.isfinite(ground) & np.isfinite(surface) & (ground != bake.NODATA) & (surface != bake.NODATA)
        return np.where(valid, ground, np.nan), np.where(valid, surface - ground, np.nan), xx, yy

    lowest = dict(standing=1., near=1., cover=1., rim=1., tankEdge=0.)
    tanks = blocks = 0
    for bid, items in groups.items():
        seed = seeds[bid]
        outline = seed["geom"]
        assert seed["source"] != "lidar" and outline.GetGeometryName() == "POLYGON"
        assert outline.GetArea() >= big.MIN_OUTLINE_AREA
        assert items[0]["id"] == bid and all(i["id"] > max(seeds) for i in items[1:])
        assert all(("buildingId" in i) == (len(items) > 1) and "site" not in i for i in items)
        for item in items:
            geom = bake.polygon(item["footprint"])
            ground, h, xx, yy = surfaces(geom)
            if item["shape"] == "tank":
                assert len(items) == 1 and item["length"] == item["width"] and item["axisDeg"] == 0
                radius = item["length"] / 2
                assert outline.Buffer(4).Contains(bake.point(item["x"], item["y"]))
                distance = np.hypot(xx - item["x"], yy - item["y"])
                # The same four numbers by which the bake leaves a tank out (big.stated_tank), with wider limits.
                again = big.stated_tank(xx, yy, h, item["x"], item["y"], radius, item["eave"], item["ridge"])
                rim = again["standing"]
                assert rim >= big.MIN_STANDING, (bid, "tank rim", rim)
                # The wall ends at the stated radius: not inside it, not outside it.
                assert abs(again["edge"] - radius) <= big.CHECK_EDGE_FIT, (bid, "tank size: the wall ends at", again["edge"], "stated", radius)
                assert again["beyond"] < big.CHECK_BEYOND_FIT, (bid, "tank is wider than stated")
                assert abs(again["shell"] - item["eave"]) < big.CHECK_SHELL_FIT, (bid, "tank shell height")
                mask = distance < radius
                lowest["rim"] = min(lowest["rim"], rim)
                lowest["tankEdge"] = max(lowest["tankEdge"], abs(again["edge"] - radius))
                tanks += 1
                under = bake.point(item["x"], item["y"]).Buffer(radius)
            else:
                assert geom.Intersection(outline).GetArea() / geom.GetArea() > .9, (item["id"], "block outside its outline")
                mask = bake.inside(geom, xx, yy)
                cells = h[mask]
                standing = float((cells > big.ABOVE_GROUND).mean())
                up = cells[cells > big.ABOVE_GROUND]
                near = float(((up > item["eave"] - 2.5) & (up < item["ridge"] + 2.5)).mean())
                assert standing >= big.MIN_STANDING - .05, (item["id"], "block does not stand", standing)
                assert near >= big.MIN_NEAR - .1, (item["id"], "block height does not fit the heights", near)
                lowest.update(standing=min(lowest["standing"], standing), near=min(lowest["near"], near))
                blocks += 1
                under = geom
            assert abs(float(np.nanmedian(ground[mask])) - item["ground"]) < .5, (item["id"], "ground")
            x0, x1, y0, y1 = under.GetEnvelope()
            close = ((np.maximum(starts[:, 0], ends[:, 0]) > x0) & (np.minimum(starts[:, 0], ends[:, 0]) < x1) &
                     (np.maximum(starts[:, 1], ends[:, 1]) > y0) & (np.minimum(starts[:, 1], ends[:, 1]) < y1)) if len(starts) else []
            road = sum(line([a, b]).Intersection(under).Length() for a, b in zip(starts[close], ends[close])) if len(starts) else 0
            assert road <= 5.01, (item["id"], "public road under a large building", road)
        if items[0]["shape"] == "block":
            cover = sum(i["length"] * i["width"] for i in items) / outline.GetArea()
            assert cover >= big.MIN_COVER - .01, (bid, "cover", cover)
            lowest["cover"] = min(lowest["cover"], cover)
    empty = []
    for row in rejected:
        seed, measured = seeds[row["id"]], row.get("measured")
        if row["reason"] == "big_outline_does_not_stand":
            _, h, xx, yy = surfaces(seed["geom"])
            standing = float((h[bake.inside(seed["geom"], xx, yy)] > big.ABOVE_GROUND).mean())
            assert standing < big.MIN_STANDING, (row["id"], "left out, but it stands", standing)
            empty.append(round(standing, 3))
        # Nothing that should have been measured as a large building is still waiting at the old gate.
        assert not (row["reason"] == "outside_sanity_bounds" and seed["source"] != "lidar" and measured and
                    seed["geom"].GetGeometryName() == "POLYGON" and seed["geom"].GetArea() >= big.MIN_OUTLINE_AREA and
                    bake.too_big(*(measured[k] for k in ("length", "width", "eave", "ridge")))), row["id"]
    stated = counts.get("big", {})
    assert stated.get("blocks", 0) == blocks and stated.get("tanks", 0) == tanks
    assert stated.get("buildings", 0) == len(groups) - tanks
    return dict(buildings=len(groups) - tanks, blocks=blocks, tanks=tanks, emptyOutlines=sorted(empty),
                lowest={k: round(v, 3) for k, v in lowest.items()}, threshold=big.MIN_STANDING)


def main():
    payload = json.loads((bake.OUT / "buildings.json").read_text())
    assert payload["crs"] == "EPSG:2961"
    buildings = payload["buildings"]
    rejected = json.loads((bake.WORK / "buildings-rejected.json").read_text())
    candidates = json.loads((bake.WORK / "buildings-candidates.json").read_text())
    counts = json.loads((bake.WORK / "buildings-counts.json").read_text())
    mid = json.loads((bake.OUT / "manifest.json").read_text())["mid"]
    landmarks = [bake.polygon(b["footprint"]) for b in json.loads((bake.OUT / "landmarks.json").read_text())]
    road_kinds = {b["id"]: b["kind"] for b in json.loads((bake.OUT / "roads.json").read_text())["roads"]}
    roads = bake.road_segments()
    ids = [b["id"] for b in buildings]
    assert len(ids) == len(set(ids)) and ids == sorted(ids)
    assert not set(ids).intersection(b["id"] for b in rejected)
    audit = json.loads((bake.WORK / "buildings-audit.json").read_text())
    accepted = {a["id"]: a for a in audit}
    assert set(accepted) == set(ids)
    roots = [b for b in buildings if b.get("buildingId", b["id"]) == b["id"]]
    root_ids = [b["id"] for b in roots]
    from dashcam_corrections import measured_root_id_limit
    wing_id_floor = measured_root_id_limit(roots)
    if "preservedSiteSha256" in counts:
        assert counts["preservedSiteSha256"] == hashlib.sha256(json.dumps(
            sorted((b.get("site", b) for b in roots if "shape" not in b and b.get("source") != "hand"), key=lambda b: b["id"]),
            separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    candidate_ids = [accepted[i].get("candidateId", i) for i in root_ids]
    assert len(candidate_ids) == len(set(candidate_ids))
    assert not set(candidate_ids).intersection(b["id"] for b in rejected)
    assert set(candidate_ids).union(b["id"] for b in rejected) == set(b["id"] for b in candidates)
    candidate_keys = {c["id"]: c["key"] for c in candidates}
    assert all(a["key"] == candidate_keys[a.get("candidateId", a["id"])] for a in audit if "buildingId" not in a)
    first_pass_ids = [b["id"] for b in roots if b["source"] in bake.PRIORITY]
    assert all(i > max(first_pass_ids) for i in root_ids if i not in first_pass_ids)
    assert counts["sha256"] == hashlib.sha256((bake.OUT / "buildings.json").read_bytes()).hexdigest()
    raw_seeds, _ = bake.candidates(mid)
    raw_seed_by_id = {c["id"]: c for c in raw_seeds}
    by_id = {b["id"]: b for b in buildings}
    groups = collections.defaultdict(list)
    for item in buildings:
        if "buildingId" in item:
            groups[item["buildingId"]].append(item)
    assert counts["originalBuildings"] == len(roots)
    # Wings only: a large building drawn as blocks is a group too, and check_big counts those.
    wing_groups = [wings for bid, wings in groups.items() if "shape" not in by_id[bid]]
    assert counts["splitBuildings"] == len(wing_groups)
    assert counts["wings"] == sum(map(len, wing_groups))
    # Owner corrections (the project brief): measured blocks of their own heights, not a split of the map outline. The
    # whole land must be a fixed point of the corrections, which also proves every corrected block is the stated one.
    from mabou_main import correct_buildings, is_corrected
    assert correct_buildings(buildings, bake.AREA.id) == buildings, "the Mabou village delta corrections are not applied exactly"
    for bid, wings in groups.items():
        primary = by_id[bid]
        if "shape" in primary:
            continue    # blocks of a large building: check_big below
        if any(is_corrected(w) for w in wings):
            assert all(is_corrected(w) for w in wings) and primary["site"]["id"] == bid and "buildingId" not in primary["site"]
            assert all(w["id"] == bid or (w["id"] > wing_id_floor and "site" not in w) for w in wings)
            continue
        assert 2 <= len(wings) <= 4 and primary["buildingId"] == bid
        assert primary["site"]["id"] == bid and "buildingId" not in primary["site"]
        assert primary["length"] * primary["width"] >= max(w["length"] * w["width"] for w in wings) - .1
        source = raw_seed_by_id[bid]["geom"]
        union = None
        for wing in wings:
            assert wing["id"] == bid or wing["id"] > wing_id_floor
            assert wing["id"] == bid or "site" not in wing
            assert (wing["ground"], wing["eave"], wing["ridge"], wing["kind"]) == tuple(
                primary[k] for k in ("ground", "eave", "ridge", "kind"))
            assert wing["width"] >= 3 and wing["length"] * wing["width"] >= max(20, source.GetArea() * .08) - .2
            geom = bake.polygon(wing["footprint"])
            union = geom if union is None else union.Union(geom)
        overlap = union.Intersection(source).GetArea()
        assert overlap / source.GetArea() >= .899
        assert overlap / (source.GetArea() + union.GetArea() - overlap) >= .879
        # A group is connected, allowing only the centimetre rounding in stored corners.
        assert union.Buffer(.02).GetGeometryName() == "POLYGON", (bid, "disconnected wings")
    fallback_heights = bake.Heights()
    geometries = []
    for item in buildings:
        assert item["source"] in (*bake.PRIORITY, "second_pass", "fallback", "hand")
        assert item["kind"] in COLOURS
        assert item["roof"] in ("gable", "flat", "shed")
        assert mid[0] <= item["x"] <= mid[2] and mid[1] <= item["y"] <= mid[3]
        assert all(math.isfinite(item[k]) for k in (
            "x", "y", "ground", "axisDeg", "length", "width", "eave", "ridge", "confidence"))
        if "shape" in item:
            # A block or a tank has its own limits; check_big measures each one again from the raw heights.
            assert item["shape"] in ("block", "tank") and item["kind"] == "large" and item["source"] in bake.PRIORITY
            assert item["width"] >= bake.big.MIN_SIDE - .5
            assert 1.8 <= item["eave"] <= item["ridge"] <= bake.big.MAX_HEIGHT
        else:
            assert 2.5 <= item["width"] <= 40 and 3 <= item["length"] <= 120
            assert 1.8 <= item["eave"] <= 14 and item["eave"] <= item["ridge"] <= 22
        assert item["length"] >= item["width"]
        assert 0 <= item["axisDeg"] < 180 and 0 <= item["confidence"] <= 1
        if item["source"] == "second_pass":
            assert .3 <= item["confidence"] <= .6
        elif item["source"] == "fallback":
            assert item["confidence"] == .2 and item["kind"] in ("house", "shed")
            assert (item["length"], item["width"], item["eave"], item["ridge"]) == (
                (5, 4, 2.3, 3.3) if item["kind"] == "shed" else (11, 8, 2.9, 5.4))
            evidence = accepted[item["id"]]
            assert 20 <= evidence["blobArea"] <= 400
            # Re-read raw surfaces to prove the fallback is backed by a blob.
            seed = raw_seed_by_id[evidence["candidateId"]]
            ground, surface, xx, yy = fallback_heights.window(seed)
            valid = np.isfinite(ground) & np.isfinite(surface) & (ground != bake.NODATA) & (surface != bake.NODATA)
            blob_matches = [(rr, cc) for rr, cc in bake.components(valid & (surface - ground > 2))
                            if len(rr) == evidence["blobArea"] and
                            np.hypot(xx[rr, cc] - seed["x"], yy[rr, cc] - seed["y"]).min() <= 8 and
                            np.linalg.norm([xx[rr, cc].mean() - item["x"], yy[rr, cc].mean() - item["y"]]) < .02]
            assert blob_matches, (item["id"], "fallback blob missing")
            _, road_distance, road_angle = bake.nearest_road(item["x"], item["y"], roads)
            # Preserved envelopes predate the current road smoothing. Their original
            # orientation is protected by the property snapshot hash above instead.
            if "preservedSiteSha256" not in counts and road_distance is not None and road_distance <= 79.98:
                assert abs((item["axisDeg"] - road_angle + 90) % 180 - 90) < .02
        elif item["confidence"] <= .3:
            assert item["source"] != "lidar" and item["eave"] == 3 and item["ridge"] == 5
        assert item["nearRoad"] is None or road_kinds[item["nearRoad"]] in (1, 2, 3)
        if item.get("source") == "hand":
            from dashcam_corrections import hand_building_specs
            stated, provenance = next((b, p) for b, p in hand_building_specs() if b["id"] == item["id"])
            assert item["provenance"] == provenance
            for field in ('x','y','length','width','axisDeg','eave','ridge','kind'):
                assert item[field] == stated[field], (item['id'],field,'hand input changed')
            assert item['roof'] == 'gable' and item['confidence'] == .4
        if item["nearRoad"] is not None:
            assert item["roadDist"] >= 0 and math.isfinite(item["roadDist"])
        pts = np.array(item["footprint"])
        round_tank = item.get("shape") == "tank"
        assert pts.shape == ((bake.big.TANK_POINTS if round_tank else 4), 2) and np.isfinite(pts).all()
        assert all(mid[0] <= x <= mid[2] and mid[1] <= y <= mid[3] for x, y in pts)
        assert np.max(abs(pts.mean(axis=0) - [item["x"], item["y"]])) <= .011
        edges = np.roll(pts, -1, axis=0) - pts
        assert edges[0, 0] * edges[1, 1] - edges[0, 1] * edges[1, 0] > 0  # counter-clockwise
        if round_tank:
            # Every point on the stated circle (written to 0.01 m), the first one north; the box round them is the
            # square round the circle, and the area inside them is the circle's to 1 %.
            radius = item["length"] / 2
            assert np.max(abs(np.hypot(*(pts - [item["x"], item["y"]]).T) - radius)) <= .025, (item["id"], "tank footprint")
            assert np.all(edges[:-1, 0] * edges[1:, 1] - edges[:-1, 1] * edges[1:, 0] > 0), (item["id"], "tank footprint turns")
            assert abs(pts[0, 0] - item["x"]) <= .011 and pts[0, 1] > item["y"]
            assert np.max(abs(np.ptp(pts, axis=0) - item["length"])) <= .025
            assert .99 < bake.polygon(pts).GetArea() / (math.pi * radius ** 2) <= 1.0005, (item["id"], "tank footprint area")
        else:
            assert abs(np.dot(edges[0], edges[1])) / (item["length"] * item["width"]) < .012
            assert abs(np.linalg.norm(edges[0]) - item["length"]) < .025
            assert abs(np.linalg.norm(edges[1]) - item["width"]) < .025
            angle = math.degrees(math.atan2(edges[0, 0], edges[0, 1])) % 180
            assert abs((angle - item["axisDeg"] + 90) % 180 - 90) < .3
        geom = bake.polygon(pts)
        assert geom.IsValid() and not any(geom.Intersects(g) for g in landmarks)
        geometries.append((item, geom))
    max_overlap, pair = 0, None
    for i, (a, ga) in enumerate(geometries):
        for b, gb in geometries[i + 1:]:
            if ga.Intersects(gb):
                fraction = ga.Intersection(gb).GetArea() / min(ga.GetArea(), gb.GetArea())
                if fraction > max_overlap:
                    max_overlap, pair = fraction, (a["id"], b["id"])
                assert fraction <= .30, (a["id"], b["id"], fraction)

    big_report = check_big(buildings, rejected, raw_seed_by_id, counts)
    distributions = {}
    for kind in COLOURS:
        group = [b for b in buildings if b["kind"] == kind]
        distributions[kind] = {key: [round(float(f(values)), 2) for f in (np.min, np.median, np.max)]
            for key in ("length", "width", "eave", "ridge")
            if (values := [b[key] for b in group])}
    recovered = [b for b in buildings if b["source"] in ("second_pass", "fallback")]
    samples = random.Random(27).sample(recovered, min(20, len(recovered)))
    print("Random recovered IDs:", [b["id"] for b in samples], flush=True)
    # Re-read raw DTM windows for the random sample. This also tests the on-disk
    # centres and rounded footprints, independent of the bake's in-memory boxes.
    heights = bake.Heights()
    ground_error = 0
    for item in samples:
        seed = dict(source="polygon", geom=bake.polygon(item["footprint"]))
        ground, _, xx, yy = heights.window(seed)
        mask = bake.inside(seed["geom"], xx, yy) & np.isfinite(ground) & (ground != bake.NODATA)
        error = abs(float(np.median(ground[mask])) - item["ground"])
        assert error < .20, (item["id"], "ground median", error)
        ground_error = max(ground_error, error)

    report = dict(counts=counts, distributionOrder=["min", "median", "max"],
                  distributions=distributions, roofCounts=dict(collections.Counter(b["roof"] for b in buildings)),
                  randomSeed=27, sampleIds=[b["id"] for b in samples],
                  maxOverlap=round(max_overlap, 6), maxOverlapIds=pair,
                  sampleMaxGroundError=round(ground_error, 4), big=big_report, validation="passed")
    bake.dump(bake.WORK / "buildings-check.json", report)
    bake.dump(bake.WORK / "buildings-sample.json", samples)
    print(json.dumps(report, indent=2), flush=True)
    overlay("village", bake.AREA.bake_anchor, buildings, rejected, heights)
    farms = [b for b in buildings if b["kind"] == "barn" and b["confidence"] > .3
             and b["source"] in bake.PRIORITY
             and math.hypot(b["x"] - bake.AREA.bake_anchor[0], b["y"] - bake.AREA.bake_anchor[1]) > 2000]
    if not farms and bake.AREA.require_farm_sample:
        raise RuntimeError("No measured farm area for the second overlay")
    if farms:
        farm = max(farms, key=lambda a: (sum(
            abs(b["x"] - a["x"]) < 600 and abs(b["y"] - a["y"]) < 450 for b in farms), -a["id"]))
        overlay("farm", (farm["x"], farm["y"]), buildings, rejected, heights)
    # Fixed-seed contact sheet. Keep full 1 m crops and metadata for review.
    sheet = np.full((3, 5 * 320, 4 * 320), 245, dtype=np.uint8)
    for index, item in enumerate(samples):
        name = f"recovered-{item['id']}"
        overlay(name, (item["x"], item["y"]), buildings, rejected, heights, (80, 72))
        crop = gdal.Open(str(bake.WORK / f"buildings-check-{name}.png")).ReadAsArray()
        enlarged = np.repeat(np.repeat(crop, 4, axis=1), 4, axis=2)
        row, col = (index // 4) * 320, (index % 4) * 320
        sheet[:, row + 32:row + 320, col:col + 320] = enlarged
        title = np.full((3, 8, 80), 24, dtype=np.uint8)
        label(title, 2, 1, str(item["id"]), COLOURS[item["kind"]])
        sheet[:, row:row + 32, col:col + 320] = np.repeat(np.repeat(title, 4, axis=1), 4, axis=2)
    ds = gdal.GetDriverByName("MEM").Create("", 1280, 1600, 3, gdal.GDT_Byte)
    for band in range(3):
        ds.GetRasterBand(band + 1).WriteArray(sheet[band])
    gdal.GetDriverByName("PNG").CreateCopy(str(bake.WORK / "buildings-recovered-montage.png"), ds)



if __name__ == "__main__":
    main()
