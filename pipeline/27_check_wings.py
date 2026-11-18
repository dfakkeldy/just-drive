#!/usr/bin/env python3
"""Synthetic shape regressions for the mapped wing rule. No bake or source writes."""
import importlib.util
import math
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('buildings', Path(__file__).with_name('27_bake_buildings.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def check(points, count):
    for angle in (0, 17, 38, 90, 128):
        a = math.radians(angle)
        rotation = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        geom = b.polygon(np.array(points) @ rotation.T + b.AREA.anchor)
        wings = b.split_outline(geom)
        assert len(wings) == count, (angle, count, len(wings))
        if wings:
            union = b.polygon(wings[0][5])
            for wing in wings[1:]:
                union = union.Union(b.polygon(wing[5]))
            assert union.Buffer(.02).GetGeometryName() == 'POLYGON'
            assert union.Intersection(geom).GetArea() / geom.GetArea() > .95


check([(0, 0), (30, 0), (30, 8), (0, 8)], 0)
# A porch-sized bump and an almost rectangular notch stay unchanged.
check([(0, 0), (20, 0), (20, 10), (12, 10), (12, 12), (9, 12), (9, 10), (0, 10)], 0)
check([(0, 0), (20, 0), (20, 10), (15, 10), (15, 9), (0, 9)], 0)
check([(0, 0), (30, 0), (30, 8), (8, 8), (8, 25), (0, 25)], 2)
check([(0, 0), (30, 0), (30, 25), (22, 25), (22, 8), (8, 8), (8, 25), (0, 25)], 3)
check([(0, 0), (30, 0), (30, 8), (19, 8), (19, 25), (11, 25), (11, 8), (0, 8)], 2)
print('PASS: rectangles and small bumps stay unchanged; rotated L, U and T outlines use connected wings.')
