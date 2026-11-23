#!/usr/bin/env python3
"""Synthetic regressions for large buildings as blocks and tanks. Made-up heights; no bake, and no file of the project
is read or written (the guard test at the end uses a made-up land in a temporary folder).

The heights come from a function of the place, through the same window that the bake reads from the surface files,
so the whole measurement runs: frames, cover, roof steps, roof levels, tanks, and the guards of add_big.
"""
import copy
import importlib.util
import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location('buildings', Path(__file__).with_name('27_bake_buildings.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
big = b.big
ANCHOR = np.array(b.AREA.anchor, dtype=float)

# The evidence behind MIN_STANDING: the share of a mapped outline that stands more than 2 m above the ground,
# measured by the bake on every large outline of four areas (14 Nov 2026). An outline whose building is gone
# keeps a low share; the threshold lies in the empty range between the two groups.
GONE = dict(mabou_74=.014, pointtupper_97=.035, pointtupper_13=.114, pointtupper_54=.282)
LOWEST_STANDING_BUILDING = .84
assert big.ABOVE_GROUND == 2.0 and big.MIN_STANDING == .60
assert max(GONE.values()) + .25 < big.MIN_STANDING < LOWEST_STANDING_BUILDING - .2, 'threshold lies well inside the gap'


def turn(angle):
    a = math.radians(angle)
    return np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])


def spread_out(z, sigma):
    """Heights as a 1 m surface model shows them: every edge spread over a few cells (a Gaussian of `sigma` m)."""
    kernel = np.exp(-.5 * (np.arange(-5, 6) / sigma) ** 2)
    kernel /= kernel.sum()
    for axis in (0, 1):
        z = np.apply_along_axis(lambda line: np.convolve(np.pad(line, 5, mode='edge'), kernel, 'valid'), axis, z)
    return z


class Fake:
    """In place of the surface files: roof(u, v) is metres above the ground, in the building's own frame.

    `spread` spreads the edges of the roof as the real 1 m heights do (see spread_out); 0 leaves them sharp.
    """

    def __init__(self, roof, angle=0, spread=0):
        self.roof, self.rotation, self.spread = roof, turn(angle), spread

    def window(self, candidate):
        x0, x1, y0, y1 = candidate["geom"].GetEnvelope()
        bounds = (math.floor(x0 - 9), math.floor(y0 - 9), math.ceil(x1 + 9), math.ceil(y1 + 9))
        yy, xx = np.mgrid[:bounds[3] - bounds[1], :bounds[2] - bounds[0]].astype(float)
        xx += bounds[0] + .5
        yy = bounds[3] - yy - .5
        ground = 30 + .02 * (xx - ANCHOR[0]) + .01 * (yy - ANCHOR[1])      # sloped: a block's ground is its own
        local = np.stack((xx - ANCHOR[0], yy - ANCHOR[1]), axis=-1) @ self.rotation
        above = np.asarray(self.roof(local[..., 0], local[..., 1]), dtype=float)
        if self.spread:
            above = spread_out(above, self.spread)
        return ground.astype(np.float32), (ground + above).astype(np.float32), xx, yy


def seed(points, angle=0, source='osm'):
    return dict(id=1, key='test', aliases=[], source=source, geom=b.polygon(np.array(points, dtype=float) @ turn(angle).T + ANCHOR))


def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def measure(points, roof, angle=0, spread=0):
    return b.measure_big(seed(points, angle), Fake(roof, angle, spread))


def sizes(blocks):
    return sorted((round(block[0][3]), round(block[0][4]), round(block[2])) for block in blocks)


ANGLES = (0, 17, 38, 90, 128)

# 1. One flat hall. One block of its size and height, at any direction.
for angle in ANGLES:
    blocks, d, reason = measure(box(0, 0, 100, 50), lambda u, v: np.where((u > 0) & (u < 100) & (v > 0) & (v < 50), 8., 0.), angle)
    assert reason is None and len(blocks) == 1, (angle, reason)
    (centre, axis, cross, length, width, footprint), ground, eave, ridge, roof, confidence, is_round = blocks[0]
    assert abs(length - 100) < 1.5 and abs(width - 50) < 1.5 and abs(eave - 8) < .2 and roof == 'flat' and not is_round
    assert d["standing"] > .95 and d["cover"] > .95 and ridge - eave <= 1.2
    middle = np.array([50, 25]) @ turn(angle).T + ANCHOR
    assert np.hypot(*(centre - middle)) < 1.5 and abs(ground - (30 + .02 * (middle[0] - ANCHOR[0]) + .01 * (middle[1] - ANCHOR[1]))) < .3

# 2. An L with a low wing and a high wing. The largest rectangle lies over both levels: it must be cut at the step.
L = [(0, 0), (120, 0), (120, 40), (50, 40), (50, 100), (0, 100)]
for angle in ANGLES:
    blocks, d, reason = measure(L, lambda u, v: np.where((u > 0) & (v > 0) & (v < 40) & (u < 120), 6.,
                                                           np.where((u > 0) & (u < 50) & (v >= 40) & (v < 100), 14., 0.)), angle)
    assert reason is None and len(blocks) == 3 and d["cover"] > .93, (angle, reason, d)
    for block in blocks:
        local = (block[0][0] - ANCHOR) @ turn(angle)
        assert abs(block[2] - (6 if local[1] < 40 else 14)) < .5, (angle, local, block[2])

# 3. A long hall with one roof step. Two blocks, cut at the step: not thin strips off the end of the low part.
blocks, d, reason = measure(box(0, 0, 200, 40), lambda u, v: np.where((u > 0) & (u < 200) & (v > 0) & (v < 40),
                            np.where(u < 150, 5., 12.) + np.where((abs(u - 60) < 2) & (abs(v - 20) < 2), 3., 0.), 0.))
assert reason is None and sizes(blocks) == [(50, 40, 12), (150, 40, 5)], sizes(blocks)
# Roof equipment narrower than STEP_SIDE is no roof step.
blocks, d, reason = measure(box(0, 0, 90, 40), lambda u, v: np.where((u > 0) & (u < 90) & (v > 0) & (v < 40),
                            np.where(abs(u - 30) < 3, 12., 6.), 0.))
assert reason is None and sizes(blocks) == [(90, 40, 6)], sizes(blocks)
# A strip narrower than STEP_SIDE at the end of a roof (a parapet, a plant room) is not cut off as its own block.
blocks, d, reason = measure(box(0, 0, 90, 40), lambda u, v: np.where((u > 0) & (u < 90) & (v > 0) & (v < 40), np.where(u > 84, 12., 6.), 0.))
assert reason is None and sizes(blocks) == [(90, 40, 6)], sizes(blocks)
# A step lower than ROOF_STEP is one roof.
blocks, d, reason = measure(box(0, 0, 90, 40), lambda u, v: np.where((u > 0) & (u < 90) & (v > 0) & (v < 40), np.where(u < 45, 6., 8.), 0.))
assert reason is None and len(blocks) == 1, sizes(blocks)

# 4. A pitched roof is one block: both sides of the ridge have the same median, so the ridge is no step.
for angle in ANGLES:
    blocks, d, reason = measure(box(0, 0, 60, 30), lambda u, v: np.where((u > 0) & (u < 60) & (v > 0) & (v < 30), 6 + 6 * (1 - abs(v - 15) / 15), 0.), angle)
    assert reason is None and len(blocks) == 1, (angle, reason)
    assert blocks[0][4] == 'gable' and 5.5 < blocks[0][2] < 7.8 and 10.4 < blocks[0][3] <= 12.3, (angle, blocks[0][2:5])

# A steep or a curved roof is a slope, not steps: no terraces. A roof with one slope is one block too.
for name, width, roof in (('steep gable', 40, lambda v: 6 + 14 * (1 - abs(v - 20) / 20)), ('wide gable', 60, lambda v: 6 + 18 * (1 - abs(v - 30) / 30)),
                          ('barrel', 50, lambda v: 5 + 12 * np.sqrt(np.clip(1 - ((v - 25) / 25) ** 2, 0, 1))), ('one slope', 40, lambda v: 5 + 8 * v / 40)):
    blocks, d, reason = measure(box(0, 0, 90, width), lambda u, v: np.where((u > 0) & (u < 90) & (v > 0) & (v < width), roof(v), 0.), 17)
    assert reason is None and len(blocks) == 1 and abs(blocks[0][0][4] - width) < 1.5, (name, reason, sizes(blocks or []))
    assert (blocks[0][4] == 'gable') == (name != 'one slope'), (name, blocks[0][2:5])
# A high part beside a low part in one narrow block is two levels, not a ridge.
h = np.full((40, 10), 12.); h[:, :4] = 6.
roof = big.block_roof(h, (0, 40, 0, 10))
assert roof["roof"] == 'flat' and abs(roof["eave"] - 12) < .1, roof

# Many levels in a row (a process plant): every sharp step is cut, however many there are.
levels = (8, 20, 12, 45, 26)
blocks, d, reason = measure(box(0, 0, 150, 30), lambda u, v: np.where((u > 0) & (u < 150) & (v > 0) & (v < 30), np.choose(np.clip(u // 30, 0, 4).astype(int), levels), 0.), 17)
assert reason is None and sizes(blocks) == sorted((30, 30, level) for level in levels), sizes(blocks or [])

# 5. Outlines whose building is gone: the measured shares of the real cases, then the threshold from both sides.
def partly(share, scattered=False):
    rng = np.random.default_rng(7)

    def roof(u, v):
        if scattered:
            return np.where((u > 0) & (u < 80) & (v > 0) & (v < 50) & (rng.random(u.shape) < share), 6., 0.)
        return np.where((u > 0) & (u < 80 * share) & (v > 0) & (v < 50), 6., 0.)
    return measure(box(0, 0, 80, 50), roof)


for name, share in GONE.items():
    blocks, d, reason = partly(share)
    assert blocks is None and reason == 'big_outline_does_not_stand' and abs(d["standing"] - share) < .03, (name, reason, d)
    blocks, d, reason = partly(share, scattered=True)
    assert blocks is None and reason == 'big_outline_does_not_stand', (name, reason, d)
assert partly(big.MIN_STANDING - .05)[2] == 'big_outline_does_not_stand'
# Above the threshold a half-standing outline is still no building: the part that stands must cover MIN_COVER.
blocks, d, reason = partly(big.MIN_STANDING + .05)
assert blocks is None and reason == 'big_outline_not_covered_by_blocks' and d["cover"] < big.MIN_COVER, (reason, d)
blocks, d, reason = partly(.85)
assert reason is None and sizes(blocks) == [(68, 50, 6)] and big.MIN_COVER <= d["cover"] < .9, (reason, sizes(blocks or []), d)
blocks, d, reason = partly(LOWEST_STANDING_BUILDING, scattered=True)
assert reason is None and len(blocks) == 1 and abs(blocks[0][2] - 6) < .2, (reason, d)

# 6. Two levels side by side in a block too narrow to cut (the mill case that the median got wrong: it stated a
# height between the levels, where no roof is). The stated roof is the level that more cells have.
h = np.full((10, 28), 27.); h[:4] = 10.
roof = big.block_roof(h, (0, 10, 0, 28))
assert roof["roof"] == 'flat' and abs(roof["eave"] - 27) < .1 and abs(roof["near"] - .6) < .01, roof
h = np.full((10, 28), 27.); h[:6] = 10.
assert abs(big.block_roof(h, (0, 10, 0, 28))["eave"] - 10) < .1
# The real case had a few cells between the levels too, and the median of all cells fell on those: 45 % at 10 m,
# 10 % at 18 m, 45 % at 27 m. The stated roof must be one of the two real levels.
h = np.full((10, 40), 27.); h[:, :18] = 10.; h[:, 18:22] = 18.
roof = big.block_roof(h, (0, 10, 0, 40))
assert float(np.median(h)) == 18 and min(abs(roof["eave"] - 10), abs(roof["eave"] - 27)) < .1 and roof["near"] >= big.MIN_NEAR, roof
# A tower between two low sides in a narrow block is no pitched roof: a roof rises by half its width at most.
h = np.full((40, 10), 6.); h[:, 3:7] = 27.
roof = big.block_roof(h, (0, 40, 0, 10))
assert roof["roof"] == 'flat' and abs(roof["eave"] - 6) < .1 and roof["ridge"] < 8, roof
# No level at all (pipes and stacks at every height): the block is left out, not given an invented roof.
h = np.repeat(np.linspace(4, 40, 28)[None], 10, axis=0)
assert big.block_roof(h, (0, 10, 0, 28))["near"] < big.MIN_NEAR
blocks, d, reason = measure(box(0, 0, 60, 30), lambda u, v: np.where((u > 0) & (u < 60) & (v > 0) & (v < 30), 4 + .9 * ((u * 7 + v * 13) % 40), 0.))
assert blocks is None and reason == 'big_outline_not_covered_by_blocks' and all(row["left"] == 'no_roof_level' for row in d["blocks"]), (reason, d)

# 7. A bent building: the wing turned by 25 degrees gets blocks in its own frame.
bent = b.polygon(np.array(box(0, 0, 100, 30), dtype=float) + ANCHOR).Union(
    b.polygon((np.array(box(0, 0, 90, 30), dtype=float) @ turn(25).T) + np.array([95, 0]) + ANCHOR))
assert bent.GetGeometryName() == 'POLYGON'
directions = big.wall_directions(b.vertices(bent))
assert len(directions) == 2 and abs(directions[0] % 90) < .5 and abs(directions[1] - 65) < .5, directions
inside_bent = lambda u, v: b.inside(bent, u + ANCHOR[0], v + ANCHOR[1])
blocks, d, reason = b.measure_big(dict(id=1, source='osm', geom=bent), Fake(lambda u, v: np.where(inside_bent(u, v), 9., 0.)))
assert reason is None and d["cover"] > .85 and len({row["frame"] for row in d["blocks"] if "left" not in row}) == 2, (reason, d)
for block in blocks:
    footprint = b.polygon(block[0][5])
    assert footprint.Intersection(bent).GetArea() / footprint.GetArea() > .97 and abs(block[2] - 9) < .3
for i, first in enumerate(blocks):
    for second in blocks[i + 1:]:
        assert b.polygon(first[0][5]).Intersection(b.polygon(second[0][5])).GetArea() < 1, 'blocks do not overlap'
assert len(big.wall_directions(np.array(box(0, 0, 100, 30) + [(0, 0)], dtype=float))) == 1

# 8. Tanks. The mapped circle is a copy of one size: the place and the diameter come from the heights.
circle = [(20 * math.cos(t), 20 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 24, endpoint=False)]
assert big.is_round(b.polygon(np.array(circle)).GetArea(), b.polygon(np.array(circle)).Boundary().Length(), 24)
assert not big.is_round(2500, 200, 4) and not big.is_round(1250, 150, 10)


def cone(u, v, cx=4, cy=-3, radius=15, shell=12, rise=2):
    r = np.hypot(u - cx, v - cy)
    return np.where(r < radius, shell + rise * (1 - r / radius), 0.)


blocks, d, reason = measure(circle, cone)
assert reason is None and len(blocks) == 1 and blocks[0][6] is True, (reason, d)
(centre, _, _, diameter, width, _), ground, eave, ridge, roof, _, _ = blocks[0]
assert abs(diameter - 30) < .3 and diameter == width and np.hypot(*(centre - ANCHOR - [4, -3])) < .5, (diameter, centre - ANCHOR)
assert abs(eave - 12.2) < .4 and eave < ridge <= 14 and roof == 'gable', (eave, ridge, roof)


# A height above big.MAX_HEIGHT is a broken value, not a height: a hall of such values does not stand.
assert measure(box(0, 0, 100, 40), lambda u, v: np.where((u > 0) & (u < 100) & (v > 0) & (v < 40), 500., 0.))[2] == 'big_outline_does_not_stand'


def ring_of(radius, cx=0, cy=0):
    return [(cx + radius * math.cos(t), cy + radius * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 36, endpoint=False)]


# The diameter is exact at the sizes of real tanks (33 to 75 m), not only at 30 m. A span between the 1st and the 99th
# percentile cuts 6.5 % off a disc: 2 m at 33 m and 3.7 m at 71 m (measured in Point Tupper before this test).
for true in (33, 45, 71):
    for cx, cy in ((0, 0), (.37, -.21), (-5.4, 3.3)):
        found = measure(ring_of(true / 2 + 1.5), lambda u, v: cone(u, v, cx, cy, true / 2, 15, 2))
        assert found[2] is None and abs(found[0][0][0][3] - true) < .3 and np.hypot(*(found[0][0][0][0] - ANCHOR - [cx, cy])) < .5, (true, cx, cy, found[1])
# A flat-topped tank, and a roof that lies low inside the wall (4 m of 12): a flat top at the height of the wall.
assert measure(circle, lambda u, v: cone(u, v, rise=0))[0][0][4] == 'flat'


def hollow(u, v, radius, wall, cx=4, cy=-3):
    r = np.hypot(u - cx, v - cy)
    return np.where(r < radius, np.where(r > radius - wall, 12., 4.), 0.)


low = measure(circle, lambda u, v: hollow(u, v, 15, 3))
assert low[2] is None and low[0][0][2] == low[0][0][3] and abs(low[0][0][2] - 12) < .3 and abs(low[0][0][0][3] - 30) < .3, low
assert all(abs(measure(ring_of(true / 2), lambda u, v: hollow(u, v, true / 2, 3, 0, 0))[0][0][0][3] - true) < .3 for true in (45, 71))
# The limit of that: the wall must fill the ring from 3 to 0.5 m inside the circle. A wall of 2.5 m does. A wall of 1
# or 1.5 m does not, and the tank is left out by its true name, thin_wall: not as a tank whose edge does not fit,
# because the wall ends at the circle. At 2 m the share is 0.59 to 0.63 against the limit of 0.60, so a cell
# decides. The same holds with the edges spread over 0.7 m, as real heights have them. (With a spread of 1.2 m a
# wall of 1 m shows as a low rim 4 m wide, and the tank is kept at that low height: the bake states what the
# heights show.)
for true in (33, 50, 71):
    for spread in (0, .7):
        walled = lambda wall: measure(ring_of(true / 2 + 1), lambda u, v: hollow(u, v, true / 2, wall, 0, 0), spread=spread)
        assert walled(1)[2] == walled(1.5)[2] == 'tank_thin_wall', (true, spread, walled(1)[1], walled(1.5)[1])
        assert walled(2)[2] in (None, 'tank_thin_wall')
        for wall in (2.5, 3, 4):
            found = walled(wall)
            assert found[2] is None and abs(found[0][0][0][3] - true) < .3 and found[0][0][2] == found[0][0][3], (true, spread, wall, found[1])
# A heap is round too, and low at its edge. No ring near its edge stands, so it is not a thin wall.
heap = lambda u, v: np.clip(15 * (1 - np.hypot(u, v) / 25), 0, None)
assert measure(ring_of(26), heap)[2] == measure(ring_of(26), heap, spread=.7)[2] == 'tank_rim_does_not_stand'
# A real tank that is wider than its mapped circle. The body is cut off where the measured cells end (the circle and
# 4 m), so its area would state the tank too small. Up to there it is exact; just past there it is at most 1.5 m short;
# wider than that, it is left out and not written too small. (The mapped circle here: 20 m radius.)
for real, exact in ((21, True), (23, True), (24.5, False)):
    found = measure(circle, lambda u, v: cone(u, v, 0, 0, real, 15, 2))
    assert found[2] is None and (abs(found[0][0][0][3] - 2 * real) < .3 if exact else 0 < 2 * real - found[0][0][0][3] <= 2 * big.EDGE_FIT), (real, found[1])
for real in (25, 26, 27, 30, 40):
    assert measure(circle, lambda u, v: cone(u, v, 0, 0, real, 15, 2))[2] == 'tank_wider_than_mapped', real
# The wall can end at the stated circle and something as tall can still stand round the tank, outside the measured
# cells. Round nearly half of it: left out. Round a third of it: a tank with a building at its side, and it stays.


def skirt(u, v, share, radius=25, reach=6):
    r, part = np.hypot(u, v), (np.arctan2(v, u) % (2 * math.pi)) / (2 * math.pi)
    return np.where(r < radius, cone(u, v, 0, 0, radius, 15, 2), np.where((r < radius + reach) & (part < share), 15., 0.))


half = measure(ring_of(22), lambda u, v: skirt(u, v, .49))
assert half[2] == 'tank_wider_than_mapped' and abs(half[1]["edge"] - half[1]["diameter"] / 2) < big.EDGE_FIT and half[1]["beyond"] >= big.BEYOND_FIT, half[1]
assert measure(ring_of(22), lambda u, v: skirt(u, v, .3))[2] is None
# The bake and the area's check judge a stated tank by the same four numbers (big.stated_tank), the check with wider
# limits. A tank stated 1.8 m short in radius (the old estimator at 71 m) is refused by the check's limit.
assert big.EDGE_FIT < big.CHECK_EDGE_FIT and big.BEYOND_FIT < big.CHECK_BEYOND_FIT and big.SHELL_FIT < big.CHECK_SHELL_FIT
window = Fake(lambda u, v: cone(u, v, 0, 0, 35.5, 15, 2)).window(seed(ring_of(37)))
height = window[1].astype(float) - window[0]
again = big.stated_tank(window[2], window[3], height, ANCHOR[0], ANCHOR[1], 35.5, 15, 17)
assert abs(again["edge"] - 35.5) < .3 and again["standing"] == 1 and again["beyond"] == 0 and abs(again["shell"] - 15.1) < .2, again
short = big.stated_tank(window[2], window[3], height, ANCHOR[0], ANCHOR[1], 35.5 - 1.83, 15, 17)
assert short["edge"] - (35.5 - 1.83) > big.CHECK_EDGE_FIT, short
# Roofs. Every real roof is a low cone: at most 3.2 m above a shell of 14 to 18 m. Twice as steep is still a tank. The
# rim is compared with the top of the roof, so a cone above about 0.4 of its shell fails it: a known limit, none exists.
for rise, verdict in ((3, None), (6, None), (8, 'tank_rim_does_not_stand')):
    assert measure(ring_of(25), lambda u, v: cone(u, v, 0, 0, 25, 15, rise))[2] == verdict, rise
# The rim is the share of the ring from 3 to 0.5 m inside the circle that stands above 0.75 of the top, and the
# confidence is made from it. With sharp edges every ring near the edge gives 1. With the edges spread over 0.7 m
# the ring counts: this one gives 0.81 to 0.84 (the real tanks: 0.79 to 0.93); the ring from 2 to 0 m gives less.
for radius in (17, 25, 35.5):
    found = measure(ring_of(radius + 1.5), lambda u, v: cone(u, v, 0, 0, radius, 15, 2), spread=.7)
    assert found[2] is None and .78 <= found[1]["rim"] <= .88 and abs(found[0][0][0][3] - 2 * radius) < .3, (radius, found[1:])
    rim, confidence = found[1]["rim"], found[0][0][5]
    assert confidence == round(min(.95, .5 + .25 * rim + .2 * found[1]["roundness"]), 2) and .89 <= confidence <= .92, (radius, confidence)
# The body is closed where it has cells on all four sides: a ring becomes a disc, two bodies side by side stay two.
pair = np.zeros((7, 12), bool)
pair[2:5, 1:3] = pair[2:5, 9:11] = True
hole = np.ones((7, 7), bool)
hole[2:5, 2:5] = False
assert (big.closed(pair) == pair).all() and (big.closed(pair.T) == pair.T).all() and big.closed(hole).all()
# The place where the wall ends is found to 0.2 m, also when it lies between two of the rings of 0.5 m.
for true in (35.2, 35.5, 35.7, 35.8, 36.0, 36.2):
    window = Fake(lambda u, v: cone(u, v, 0, 0, true, 15, 2)).window(seed(ring_of(37)))
    height = window[1].astype(float) - window[0]
    assert abs(big.stated_tank(window[2], window[3], height, ANCHOR[0], ANCHOR[1], 35.5, 15, 17)["edge"] - true) < .2, true
# The wall is what stands above half of the top, as the body is. A lower thing against the tank (here 9 m high and
# 3 m wide, round a tank of 15 m with a roof up to 21 m) is not its wall: the tank keeps its size.
low_beside = lambda u, v: np.where((np.hypot(u, v) >= 25) & (np.hypot(u, v) < 28), 9., cone(u, v, 0, 0, 25, 15, 6))
found = measure(ring_of(26.5), low_beside)
assert found[2] is None and abs(found[0][0][0][3] - 50) < .3 and abs(found[1]["edge"] - 25) < .2, found[1:]
# A wall of two heights and a low third. The shell's height is that of the highest part (20 m), but the median of
# what stands in the ring is 15.1 m: the area's check would refuse this tank, so the bake leaves it out.
parts = lambda u, v: np.where(np.hypot(u, v) < 25, np.select([(np.arctan2(v, u) % (2 * math.pi)) < .45 * 2 * math.pi,
                                                              (np.arctan2(v, u) % (2 * math.pi)) < .65 * 2 * math.pi], [20., 15.1], 10.5), 0.)
assert measure(ring_of(26.5), parts)[2] == 'tank_shell_height_not_clear', measure(ring_of(26.5), parts)[1:]
# The tank is gone (a bare pad), half of it stands, or a box stands in the circle: no tank.
assert measure(circle, lambda u, v: 0 * u + .3)[2] == 'tank_nothing_stands'
assert measure(circle, lambda u, v: np.where(u < 4, cone(u, v), 0.))[2] == 'tank_not_round'
assert measure(circle, lambda u, v: np.where((abs(u) < 16) & (abs(v) < 5), 9., 0.))[2] == 'tank_not_round'
# A round heap has no wall, and scattered trees on an empty pad have no rim: only the rim test finds these.
assert measure(circle, lambda u, v: np.clip(12 * (1 - np.hypot(u, v) / 16), 0, None))[2] == 'tank_rim_does_not_stand'
rng = np.random.default_rng(3)
assert measure(circle, lambda u, v: np.where((np.hypot(u, v) < 15) & (rng.random(u.shape) < .5), 12., 0.))[2] == 'tank_rim_does_not_stand'
# Only a low ring wall round a pad (a dyke): too little of the rim stands at the height of the top.
dyke = measure(circle, lambda u, v: np.where((np.hypot(u, v) < 15) & (np.hypot(u, v) > 12) & (u > -4), 12., np.where(np.hypot(u, v) < 15, 2.5, 0.)))
assert dyke[2] in ('tank_rim_does_not_stand', 'tank_not_round'), dyke

# 9. add_big: only an outline that the size gate dropped for being too large comes here, and each guard leaves out.
hall, hall_roof = box(0, 0, 100, 50), lambda u, v: np.where((u > 0) & (u < 100) & (v > 0) & (v < 50), 8., 0.)
measured = dict(length=100, width=50, eave=3, ridge=5)
no_roads = (np.zeros((0, 2)), np.zeros((0, 2)), np.zeros(0, dtype=int))
mid = (ANCHOR[0] - 500, ANCHOR[1] - 500, ANCHOR[0] + 500, ANCHOR[1] + 500)
b.nearest_road = lambda x, y, roads: (None, None, None)


def add(rejected=None, kept=(), roads=no_roads, landmarks=(), mid=mid, points=hall, roof=hall_roof, source='osm'):
    rejected = [dict(id=1, source=source, reason='outside_sanity_bounds', measured=measured)] if rejected is None else rejected
    return b.add_big(list(copy.deepcopy(kept)), rejected, {1: dict(seed(points, source=source), id=1)}, Fake(roof), roads, list(landmarks), mid, [])


def other(bid, points):
    p = np.array(points, dtype=float) + ANCHOR
    return dict(id=bid, x=float(p[:, 0].mean()), y=float(p[:, 1].mean()), footprint=p.tolist(), kind='house', source='osm')


kept, still, counts = add()
assert counts == dict(blocks=1, buildings=1) and still == [] and len(kept) == 1, counts
item = kept[0]
assert item["id"] == 1 and item["kind"] == 'large' and item["shape"] == 'block' and "site" not in item and "buildingId" not in item
assert (item["length"], item["width"], item["roof"]) == (100, 50, 'flat') and abs(item["eave"] - 8) < .2
# Several blocks: the largest keeps the seed's id, the others get ids above every id in use, and all share buildingId.
kept, still, counts = add(points=L, roof=lambda u, v: np.where((u > 0) & (v > 0) & (v < 40) & (u < 120), 6., np.where((u > 0) & (u < 50) & (v >= 40) & (v < 100), 14., 0.)),
                          kept=[other(40, box(300, 300, 310, 308))])
new = [x for x in kept if "shape" in x]
assert counts == dict(blocks=3, buildings=1) and sorted(x["id"] for x in new) == [1, 41, 42] and {x["buildingId"] for x in new} == {1}
assert max(new, key=lambda x: x["length"] * x["width"])["id"] == 1 and kept[1] == other(40, box(300, 300, 310, 308)), 'a kept building is not changed'
# New ids lie above the seed ids too, not only above the kept ids. Here the kept id (3) is BELOW both seed ids (5, 9):
# counted from the kept ids alone, the L's second block would take 4 and its third 5, the id of its own first block.
two_roofs = lambda u, v: np.where((u > 0) & (v > 0) & (v < 40) & (u < 120), 6., np.where((u > 0) & (u < 50) & (v >= 40) & (v < 100), 14.,
                                  np.where((u > 300) & (u < 400) & (v > 0) & (v < 50), 8., 0.)))
kept, still, counts = b.add_big([other(3, box(300, 300, 310, 308))],
                                [dict(id=i, source='osm', reason='outside_sanity_bounds', measured=measured) for i in (5, 9)],
                                {5: dict(seed(L), id=5), 9: dict(seed(box(300, 0, 400, 50)), id=9)}, Fake(two_roofs), no_roads, [], mid, [])
new = [x for x in kept if "shape" in x]
assert counts == dict(blocks=4, buildings=2) and still == [] and sorted(x["id"] for x in new) == [5, 9, 10, 11], sorted(x["id"] for x in new)
assert {x["id"]: x.get("buildingId") for x in new} == {5: 5, 10: 5, 11: 5, 9: None} and len({x["id"] for x in kept}) == len(kept)
# Not from this path: other reasons, point seeds, outlines that failed only a lower limit, small outlines.
for change in (dict(reason='no_roof'), dict(measured=None), dict(measured=dict(length=30, width=20, eave=1.2, ridge=3))):
    row = dict(dict(id=1, source='osm', reason='outside_sanity_bounds', measured=measured), **change)
    assert add(rejected=[row]) == ([], [row], {}), change
assert add(source='lidar')[2] == {} and add(points=box(0, 0, 20, 14))[2] == {}
assert b.too_big(121, 30, 5, 6) and b.too_big(60, 41, 5, 6) and b.too_big(30, 20, 15, 16) and b.too_big(30, 20, 5, 23)
assert not b.too_big(120, 40, 14, 22) and not b.too_big(2, 2, 1, 1)
# The guards.
left = lambda result: (result[2], result[1][0]["reason"], result[1][0]["firstPassReason"], [x for x in result[0] if "shape" in x])
assert left(add(mid=(ANCHOR[0] + 10, ANCHOR[1] - 500, ANCHOR[0] + 500, ANCHOR[1] + 500))) == ({'leftOut:outside_mid': 1}, 'outside_mid', 'outside_sanity_bounds', [])
assert left(add(landmarks=[b.polygon(np.array(box(40, 20, 50, 30), dtype=float) + ANCHOR)]))[1] == 'hand_modelled_landmark'
assert left(add(kept=[other(7, box(10, 10, 30, 30))]))[1] == 'overlaps_kept_building'
assert add(kept=[other(7, box(-15, 10, 4, 30))])[2] == dict(blocks=1, buildings=1), 'a neighbour that only touches the wall is no overlap'
road = lambda *ends: (np.array([ends[0]], dtype=float) + ANCHOR, np.array([ends[1]], dtype=float) + ANCHOR, np.array([2]))
assert left(add(roads=road((-20, 25), (120, 25))))[1] == 'public_road_under_block'
assert add(roads=road((-20, -3), (120, -3)))[2] == dict(blocks=1, buildings=1), 'a road beside the wall'
assert add(roads=road((-20, 25), (4, 25)))[2] == dict(blocks=1, buildings=1), 'a road line that ends less than 5 m inside (a mapped driveway end)'
# A hand-built site of the game replaces this outline: the area names a point inside it.
real = b.AREA
try:
    b.AREA = type('Area', (), dict(big_buildings_skip=((ANCHOR[0] + 50, ANCHOR[1] + 25),)))()
    assert left(add())[1] == 'hand_built_site'
    b.AREA = type('Area', (), dict(big_buildings_skip=((ANCHOR[0] + 150, ANCHOR[1] + 25),)))()
    assert add()[2] == dict(blocks=1, buildings=1)
finally:
    b.AREA = real
# The province's class for a ruin: trees can stand in such an outline, so it is not measured.
ruin = {1: dict(seed(hall), id=1, attributes=dict(FEAT_DESC='BUILDING ruin/inactive/abandoned polygon'))}
result = b.add_big([], [dict(id=1, source='polygon', reason='outside_sanity_bounds', measured=measured)], ruin, Fake(hall_roof), no_roads, [], mid, [])
assert left(result)[:2] == ({'leftOut:mapped_as_ruin': 1}, 'mapped_as_ruin'), result[2]
ruin[1]["attributes"] = dict(FEAT_DESC='BUILDING polygon')
assert b.add_big([], [dict(id=1, source='polygon', reason='outside_sanity_bounds', measured=measured)], ruin, Fake(hall_roof), no_roads, [], mid, [])[2] == dict(blocks=1, buildings=1)
# A tank through the same door.
kept, still, counts = add(points=circle, roof=cone, rejected=[dict(id=1, source='osm', reason='outside_sanity_bounds', measured=dict(length=42, width=42, eave=3, ridge=5))])
assert counts == dict(tanks=1) and kept[0]["shape"] == 'tank' and kept[0]["kind"] == 'large' and abs(kept[0]["length"] - 30) < .3 and "buildingId" not in kept[0]
# The area's check (27_check_buildings.check_big) measures a stated tank again from the heights. Here it runs on the
# same made-up heights: it accepts the tank that the bake wrote, and it refuses a tank stated wrongly.
spec = importlib.util.spec_from_file_location('area_check', Path(__file__).with_name('27_check_buildings.py'))
area = importlib.util.module_from_spec(spec)
spec.loader.exec_module(area)


def area_check(item, roof, spread=0):
    """check_big on a made-up land with this one tank: its report, or the words of the assertion that refuses it."""
    saved = area.bake.Heights, area.bake.road_segments, area.bake.BIG
    area.bake.Heights, area.bake.road_segments, area.bake.BIG = (lambda: Fake(roof, spread=spread)), (lambda: no_roads), True
    try:
        return area.check_big([item], [], {1: dict(seed(circle), id=1)}, dict(big=dict(tanks=1)))
    except AssertionError as refused:
        return str(refused)
    finally:
        area.bake.Heights, area.bake.road_segments, area.bake.BIG = saved


stated = kept[0]
report = area_check(stated, cone)
assert isinstance(report, dict) and report["tanks"] == 1 and report["lowest"]["rim"] == 1 and report["lowest"]["tankEdge"] < .1, report
spread_tank = b.add_big([], [dict(id=1, source='osm', reason='outside_sanity_bounds', measured=measured)], {1: dict(seed(circle), id=1)},
                        Fake(cone, spread=.7), no_roads, [], mid, [])[0][0]
assert isinstance(area_check(spread_tank, cone, spread=.7), dict), 'the bake and the check agree on heights with spread edges too'
resized = lambda metres: dict(stated, length=round(stated["length"] + metres, 2), width=round(stated["width"] + metres, 2))
# Its size: the wall must end within 1.0 m of the stated radius (big.CHECK_EDGE_FIT). 1.6 m short in diameter passes;
# 2.6 m short (the old measure at 55 m) does not; too wide does not.
assert isinstance(area_check(resized(-1.6), cone), dict)
refused = area_check(resized(-2.6), cone)
assert isinstance(refused, str) and 'tank size' in refused, refused
assert isinstance(area_check(resized(3), cone), str)
# Nothing as high stands round it from 2 to 5 m outside (big.CHECK_BEYOND_FIT: half of that ring). The wall still
# ends at the circle here, so only this test sees it.
around = lambda share: lambda u, v: np.where((np.hypot(u - 4, v + 3) > 17.5) & (np.hypot(u - 4, v + 3) < 21) &
                                             ((np.arctan2(v + 3, u - 4) % (2 * math.pi)) < share * 2 * math.pi), 12., cone(u, v))
assert isinstance(area_check(stated, around(.3)), dict)
refused = area_check(stated, around(.6))
assert isinstance(refused, str) and 'wider than stated' in refused, refused
left_out = add(points=circle, roof=around(.6))
assert left_out[0] == [] and left_out[1][0]["reason"] in ('tank_wider_than_mapped', 'tank_not_round'), 'and the bake leaves such a tank out'
# Its shell: the stated height within 1.5 m of what stands in the ring (big.CHECK_SHELL_FIT).
raised = lambda metres: dict(stated, eave=stated["eave"] + metres, ridge=stated["ridge"] + metres)
assert isinstance(area_check(raised(1.2), cone), dict)
refused = area_check(raised(2), cone)
assert isinstance(refused, str) and 'tank shell height' in refused, refused
# Its rim: a heap where the tank is stated.
refused = area_check(stated, lambda u, v: np.clip(12 * (1 - np.hypot(u - 4, v + 3) / 15), 0, None))
assert isinstance(refused, str) and 'tank rim' in refused, refused
# Its footprint is its circle, not a square: points on the circle, counter-clockwise from north. Whoever reads only
# the box round them gets the square round the circle; whoever reads the area gets the circle's to 1 %.
ring = np.array(kept[0]["footprint"])
radius, middle = kept[0]["length"] / 2, np.array([kept[0]["x"], kept[0]["y"]])
assert ring.shape == (big.TANK_POINTS, 2) and big.TANK_POINTS % 4 == 0
assert np.max(abs(np.hypot(*(ring - middle).T) - radius)) < .02
assert abs(ring[0, 0] - middle[0]) < .011 and ring[0, 1] > middle[1] and ring[1, 0] < middle[0], 'north first, then west'
assert np.max(abs(ring.min(axis=0) - (middle - radius))) < .02 and np.max(abs(ring.max(axis=0) - (middle + radius))) < .02
share = b.polygon(ring).GetArea() / (math.pi * radius ** 2)
assert .99 < share < 1 and 4 * radius ** 2 / (math.pi * radius ** 2) > 1.27, share

# 10. Invented roadside props (29_bake_props.py) stay out of a block or a tank by its true shape, not its square box.
spec = importlib.util.spec_from_file_location('props', Path(__file__).with_name('29_bake_props.py'))
props = importlib.util.module_from_spec(spec)
spec.loader.exec_module(props)
long_hall = add(points=box(0, 0, 300, 40), roof=lambda u, v: np.where((u > 0) & (u < 300) & (v > 0) & (v < 40), 8., 0.),
                rejected=[dict(id=1, source='osm', reason='outside_sanity_bounds', measured=dict(length=300, width=40, eave=3, ridge=5))])[0][0]
turned = b.add_big([], [dict(id=1, source='osm', reason='outside_sanity_bounds', measured=dict(length=300, width=40, eave=3, ridge=5))],
                   {1: dict(seed(box(0, 0, 300, 40), 37), id=1)}, Fake(lambda u, v: np.where((u > 0) & (u < 300) & (v > 0) & (v < 40), 8., 0.), 37), no_roads, [], mid, [])[0][0]
assert long_hall["length"] == 300 and abs(turned["length"] - 300) < 1.5 and abs(turned["axisDeg"] - 53) < .5, (turned["length"], turned["axisDeg"])
house = other(9, box(400, 0, 410, 8))
boxes, in_large = props.building_exclusions([turned, house, kept[0]])
place = lambda u, v: tuple(np.array([u, v]) @ turn(37).T + ANCHOR)
assert len(boxes) == 1 and boxes[0][0] == ANCHOR[0] + 399.5, 'a house keeps its square box'
assert in_large(*place(150, 20)) and in_large(*place(1, 1)) and in_large(*place(299, 39)) and in_large(*place(-.3, 20))
assert not in_large(*place(150, -6)) and not in_large(*place(150, 46)) and not in_large(*place(-3, 20)), 'the road side beside a turned hall is free'
xs = [p[0] for p in turned["footprint"]]; ys = [p[1] for p in turned["footprint"]]
corner = (min(xs) + 5, max(ys) - 5)
assert not in_large(*corner), 'a corner of the square box, 100 m from the hall'
tank_item = kept[0]
assert tank_item["shape"] == 'tank' and in_large(tank_item["x"] + 10, tank_item["y"] + 10) and not in_large(tank_item["x"] + 14, tank_item["y"] + 14)

# 11. The parts alone.
mask = np.zeros((40, 60), dtype=bool); mask[6:36, 10:50] = True; mask[0:6, 20:26] = True; mask[36:40, 20:40] = True
assert big.largest_rectangle(mask)[1:] == (6, 36, 10, 50) and big.largest_rectangle(mask, min_side=31) is None
# The 6 x 6 piece is found when the floor allows it; the strip of 4 x 20 is narrower than MIN_SIDE and never is.
assert big.cover([mask], min_area=20) == [(0, 6, 36, 10, 50), (0, 0, 6, 20, 26)] and big.cover([mask]) == [(0, 6, 36, 10, 50)]
assert big.cover([np.ones((30, 30), dtype=bool)], max_blocks=0) == [] and mask[6:36, 10:50].all(), 'the mask is not changed'
flat = np.full((40, 100), 6.)
assert big.roof_step(flat, (0, 40, 0, 100)) is None and big.split_steps(flat, [(0, 40, 0, 100)]) == [(0, 40, 0, 100)]
stepped = flat.copy(); stepped[:, 70:] = 11.
assert big.roof_step(stepped, (0, 40, 0, 100)) == (5.0, 'c', 70) and big.roof_step(stepped, (0, 40, 0, 76), big.STEP_SIDE) is None
assert big.split_steps(stepped, [(0, 40, 0, 100)]) == [(0, 40, 0, 70), (0, 40, 70, 100)]

# 12. The switch, and the guard of the bake. The switch is off in every area until that area's data go. After the go
# the land has blocks and tanks; a bake by another task, with the variable not set, would write the land without them.
assert [b.big_switch(v, d) for v, d in (('', False), ('', True), ('1', False), ('0', True))] == [False, True, True, False]
for wrong in ('yes', 'true', '2', ' 1', 'on'):
    try:
        b.big_switch(wrong, True)
        raise AssertionError(wrong)
    except SystemExit as stop:
        assert 'must be 1 or 0' in str(stop)


def bake_main(items, value, area_switch=False, guard=True):
    """What main() does on a made-up land: 'runs' (it went on to read the map), or the text it stopped with."""
    class Runs(Exception):
        pass

    def went_on(mid):
        raise Runs
    with tempfile.TemporaryDirectory() as folder:
        land = Path(folder)
        (land / 'buildings.json').write_text(json.dumps(dict(crs='EPSG:2961', buildings=items)))
        (land / 'manifest.json').write_text(json.dumps(dict(mid=[0, 0, 1, 1])))
        saved = b.OUT, b.WORK, b.BIG_SET, b.BIG, b.candidates, b.guard_big, sys.argv
        b.OUT, b.WORK, b.BIG_SET, b.BIG, b.candidates, sys.argv = land, land / 'work', value, b.big_switch(value, area_switch), went_on, ['27_bake_buildings.py']
        if not guard:
            b.guard_big = lambda *a: None
        try:
            b.main()
            raise AssertionError('main() must not finish on a made-up land')
        except Runs:
            result = 'runs'
        except SystemExit as stop:
            result = str(stop)
            assert not (land / 'work').exists(), 'the guard stops the bake before it writes'
        finally:
            b.OUT, b.WORK, b.BIG_SET, b.BIG, b.candidates, b.guard_big, sys.argv = saved
        assert json.loads((land / 'buildings.json').read_text())['buildings'] == items
    return result


plain = [dict(id=1), dict(id=2, buildingId=1)]
with_large = plain + [dict(id=3, shape='block', buildingId=3), dict(id=4, shape='block', buildingId=3), dict(id=5, shape='tank')]
# --preserve-sites keeps the property records of the buildings, never those of blocks and tanks: they are measured again.
assert b.preserved_sites(with_large + [dict(id=6, site=dict(id=6, lot=1))]) == [dict(id=1), dict(id=6, lot=1)]
stopped = bake_main(with_large, '')
assert '3 large-building items' in stopped and 'MMM_BIG_BUILDINGS=1 to keep' in stopped and 'MMM_BIG_BUILDINGS=0 to remove' in stopped, stopped
assert bake_main(with_large, '1') == 'runs', 'set to 1: the bake measures them again'
assert bake_main(with_large, '0') == 'runs', 'set to 0: removed on purpose'
assert bake_main(with_large, '', area_switch=True) == 'runs', "after the go the area's switch is on: no variable is needed"
assert bake_main(plain, '') == 'runs', 'a land without large buildings: the bake of another task is not stopped'
assert bake_main(with_large, '', guard=False) == 'runs', 'this test tells a bake with the guard from one without it'
assert b.guard_big(Path(tempfile.gettempdir()) / 'mmm-no-such-land/buildings.json', '', False) is None, 'a first bake has no file yet'
# A single notched edge cell beside a wing must not leave a 1-cell interior roof seam between touching blocks.
notched = np.zeros((45, 70), dtype=bool)
notched[20:40, 5:60] = True
notched[8:20, 30:64] = True
notched[19, 60] = False  # one missing cell near the far corner used to keep the wing 1 row off the main hall
closed_blocks = big.cover([notched], cells=[1.], min_area=60)
assert len(closed_blocks) == 2, closed_blocks
spans = sorted((r0, r1, c0, c1) for _, r0, r1, c0, c1 in closed_blocks)
assert spans[0][1] == spans[1][0], f'expected zero seam between wing and main block, got {spans}'
print('PASS: halls, L with two levels, roof step (no strips), gable, gone buildings at the measured shares, the '
      'threshold from both sides, two levels in a narrow block, a bent building, tanks, every guard of add_big, '
      'and the switch with its guard (not set, 1, 0).')
