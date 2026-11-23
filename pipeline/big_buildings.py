"""Large mapped buildings as solid blocks: the array work, with numpy only.

27_bake_buildings.py measures one rectangle per building and one roof. A mall, a mill or a school is not one
rectangle and has several roof levels, so that measurement fails for them, and the old size gate then dropped
them. Here a mapped outline is covered by rectangles ("blocks") along its own walls (a turned wing gets blocks in
its own direction), a block is cut where the roof steps sharply, and every block gets its own height from the 1 m
heights: the level that most of its cells have. A round outline is a tank: its place and diameter come from the
heights, because mapped tank circles are often copies of one size.

Evidence (14 Nov 2026), from the large outlines that the old gate dropped in Point Tupper, West Bay, Port Hood
and Mabou: the share of the outline more than 2 m above the ground is 0.84 or more for the buildings that stand,
and 0.01 to 0.28 for the four outlines whose building is gone. MIN_STANDING lies in the empty range between.
27_check_big.py holds those cases. The heights cannot tell a roof from tree crowns, so that share does not prove
a building under trees; the bake leaves out an outline that the map itself calls a ruin.

Nothing here reads a file. 27_check_big.py tests these functions on made-up heights.
"""
import math

import numpy as np

MIN_STANDING = .60      # share of an outline (or a tank's rim) that must stand above ABOVE_GROUND
ABOVE_GROUND = 2.0      # m above the ground: "something stands here"
MIN_OUTLINE_AREA = 300  # m2. Smaller outlines are not large buildings; the old rules keep them
MIN_SIDE = 6            # m, shortest side of a block
MIN_COVER = .75         # share of the outline's area that the kept blocks must cover
MAX_BLOCKS = 16
ROOF_STEP = 3.0         # m: a block is cut where its roof steps by at least this much
STEP_SIDE = 10          # m, shortest side of a part made by such a cut (a narrower strip is roof equipment)
STEP_SHARP = 2.4        # m: the roof changes by this much from the 3 m before a step to the 3 m after it
TURN = 8                # degrees: walls that differ by more from the main walls get their own frame
MIN_NEAR = .40          # share of a block's standing cells within 2 m of its stated roof; below it the block is left out
MAX_HEIGHT = 120.0      # m: a guard against a broken height value only, not a limit on buildings
# Points of a tank's footprint, on its circle. 4 divides it and the first point is north, so the box round the points
# is the square round the circle; the area inside them is 0.64 % less than the circle's (a square has 27 % more).
TANK_POINTS = 32
# A stated tank against the heights (stated_tank). The bake leaves a tank out at these limits; the area's check
# uses wider ones (CHECK_*), so a tank that the bake writes is one that the check accepts.
EDGE_FIT, CHECK_EDGE_FIT = .75, 1.0      # m between the stated radius and the place where the wall ends
BEYOND_FIT, CHECK_BEYOND_FIT = .4, .5    # share that still stands 2 to 5 m outside the stated circle
SHELL_FIT, CHECK_SHELL_FIT = 1.0, 1.5    # m between the stated shell height and the ring's median


def wall_directions(points):
    """Directions of the walls of a closed outline, in degrees from north modulo 90: the main one, and a second
    one when walls with at least 15 % of the perimeter are turned by more than TURN from the main walls.
    """
    edges = np.diff(np.asarray(points, dtype=float), axis=0)
    lengths = np.hypot(edges[:, 0], edges[:, 1])
    angles = np.degrees(np.arctan2(edges[:, 0], edges[:, 1])) % 90
    weight = np.zeros(90)
    for angle, length in zip(angles, lengths):
        weight[int(round(angle)) % 90] += length
    near = sum(np.roll(weight, k) for k in range(-2, 3))     # walls within 2 degrees count together

    def mean(peak):
        delta = (angles - peak + 45) % 90 - 45
        take = abs(delta) <= 2.5   # the bins hold rounded angles
        return float((peak + (delta[take] * lengths[take]).sum() / lengths[take].sum()) % 90)

    first = int(np.argmax(near))
    result = [mean(first)]
    away = abs((np.arange(90) - first + 45) % 90 - 45) > TURN
    if away.any():
        second = int(np.argmax(np.where(away, near, -1)))
        if near[second] >= .15 * lengths.sum():
            result.append(mean(second))
    return result


def largest_rectangle(mask, min_side=1):
    """Largest all-true rectangle with both sides >= min_side: (area, r0, r1, c0, c1), half open, or None.

    Row by row, `up` holds how many true cells end at this row in each column. Every rectangle that cannot grow
    is found once when its limiting column leaves the stack.
    """
    rows, cols = mask.shape
    up = np.zeros(cols, dtype=int)
    best = None
    for r in range(rows):
        up = np.where(mask[r], up + 1, 0)
        stack = []  # (start column, height), heights rising
        for c in range(cols + 1):
            height = int(up[c]) if c < cols else 0
            start = c
            while stack and stack[-1][1] >= height:
                start, h = stack.pop()
                if h >= min_side and c - start >= min_side:
                    found = (h * (c - start), r - h + 1, r + 1, start, c)
                    if best is None or found[0] > best[0]:
                        best = found
            if height and (not stack or stack[-1][1] < height):
                stack.append((start, height))
    return best


def cover(masks, cells=None, min_side=MIN_SIDE, min_area=None, max_blocks=MAX_BLOCKS, shared=None):
    """Cover an outline with rectangles that do not overlap, largest first: [(frame, r0, r1, c0, c1)].

    masks holds the same outline as a grid in each of its frames (one frame for most buildings), and cells the
    area of a grid cell in each. At every step each frame offers its largest free rectangle and the largest wins,
    so a turned wing gets rectangles along its own walls, not a staircase in the frame of the main walls.
    shared(frame, block, other) gives the cells of frame `other` that the block covers. A piece smaller than
    min_area (default: 60 m2 or 1.5 % of the outline) is left out, not forced in.
    """
    orig = [mask.copy() for mask in masks]
    masks = [mask.copy() for mask in masks]
    cells = [1.] * len(masks) if cells is None else cells
    floor = max(60, .015 * float(masks[0].sum()) * cells[0]) if min_area is None else min_area
    blocks = []
    while len(blocks) < max_blocks:
        best = None
        for frame, mask in enumerate(masks):
            found = largest_rectangle(mask, min_side)
            if found and found[0] * cells[frame] >= floor and (best is None or found[0] * cells[frame] > best[0]):
                best = (found[0] * cells[frame], frame, found[1:])
        if best is None:
            break
        _, frame, block = best
        blocks.append((frame, *block))
        masks[frame][block[0]:block[1], block[2]:block[3]] = False
        for other in range(len(masks)):
            if other != frame:
                masks[other] &= ~shared(frame, block, other)
    # Close narrow interior seams (1-2 cells) where a single notched edge cell kept a wing 1 cell off its neighbour.
    def overlaps_any(skip, frame, r0, r1, c0, c1):
        for k, (f, ar0, ar1, ac0, ac1) in enumerate(blocks):
            if k == skip:
                continue
            if f == frame:
                if r0 < ar1 and ar0 < r1 and c0 < ac1 and ac0 < c1:
                    return True
            elif shared is not None:
                if shared(frame, (r0, r1, c0, c1), f)[ar0:ar1, ac0:ac1].any():
                    return True
        return False

    for i in range(len(blocks)):
        f, r0, r1, c0, c1 = blocks[i]
        m = orig[f]
        for j in range(len(blocks)):
            if i == j or blocks[j][0] != f:
                continue
            _, br0, br1, bc0, bc1 = blocks[j]
            # Vertical gap (i above j, or i below j)
            ov_c0, ov_c1 = max(c0, bc0), min(c1, bc1)
            if ov_c1 - ov_c0 >= min_side:
                if 0 < br0 - r1 <= 2 and m[r1:br0, ov_c0:ov_c1].all() and float(m[r1:br0, c0:c1].mean()) >= .85:
                    if not overlaps_any(i, f, r0, br0, c0, c1):
                        r1 = br0
                elif 0 < r0 - br1 <= 2 and m[br1:r0, ov_c0:ov_c1].all() and float(m[br1:r0, c0:c1].mean()) >= .85:
                    if not overlaps_any(i, f, br1, r1, c0, c1):
                        r0 = br1
            # Horizontal gap (i left of j, or i right of j)
            ov_r0, ov_r1 = max(r0, br0), min(r1, br1)
            if ov_r1 - ov_r0 >= min_side:
                if 0 < bc0 - c1 <= 2 and m[ov_r0:ov_r1, c1:bc0].all() and float(m[r0:r1, c1:bc0].mean()) >= .85:
                    if not overlaps_any(i, f, r0, r1, c0, bc0):
                        c1 = bc0
                elif 0 < c0 - bc1 <= 2 and m[ov_r0:ov_r1, bc1:c0].all() and float(m[r0:r1, bc1:c0].mean()) >= .85:
                    if not overlaps_any(i, f, r0, r1, bc1, c1):
                        c0 = bc1
        blocks[i] = (f, r0, r1, c0, c1)
    return blocks


def roof_step(h, block, min_side=MIN_SIDE):
    """Where does the roof of this block step the most? (gain in m, 'r' or 'c', index) or None.

    h holds metres above the ground, NaN where nothing stands. The roof level of a strip is the median of its
    cells. A step is sharp: the 3 m before it and the 3 m after it differ by STEP_SHARP or more. A pitched or a
    curved roof never does that, so it is not cut into terraces. Among the sharp places, the cut is where two
    flat levels describe the whole profile best (least total distance from the two medians), not where the two
    medians differ most: that would cut a thin strip off the end of a long low part. Both parts keep min_side,
    so a parapet or a plant room at the end of a roof is not cut off.
    """
    r0, r1, c0, c1 = block
    part = h[r0:r1, c0:c1]
    best = None
    for axis, name in ((0, 'c'), (1, 'r')):
        if not np.isfinite(part).any():
            continue
        with np.errstate(all='ignore'):
            profile = np.nanmedian(part, axis=axis)
        ok = np.isfinite(profile)
        fit = None
        for k in range(min_side, len(profile) - min_side + 1):
            left, right = profile[:k][ok[:k]], profile[k:][ok[k:]]
            before, after = profile[k - 3:k][ok[k - 3:k]], profile[k:k + 3][ok[k:k + 3]]
            if len(left) < min_side or len(right) < min_side or not len(before) or not len(after) or \
                    abs(float(np.median(after)) - float(np.median(before))) < STEP_SHARP:
                continue
            a, b = float(np.median(left)), float(np.median(right))
            cost = float(abs(left - a).sum() + abs(right - b).sum())
            if fit is None or cost < fit[0]:
                fit = (cost, abs(a - b), k)
        if fit and (best is None or fit[1] > best[0]):
            best = (fit[1], name, (c0 if name == 'c' else r0) + fit[2])
    return best


def split_steps(h, blocks, step=ROOF_STEP, min_side=STEP_SIDE, max_blocks=MAX_BLOCKS):
    """Cut blocks at their largest roof steps until no step is left or max_blocks is reached. Largest step first."""
    blocks = list(blocks)
    while len(blocks) < max_blocks:
        choice = None
        for index, block in enumerate(blocks):
            found = roof_step(h, block, min_side)
            if found and found[0] >= step and (choice is None or found[0] > choice[1][0]):
                choice = index, found
        if choice is None:
            break
        index, (_, name, at) = choice
        r0, r1, c0, c1 = blocks.pop(index)
        blocks += [(r0, r1, c0, at), (r0, r1, at, c1)] if name == 'c' else [(r0, at, c0, c1), (at, r1, c0, c1)]
    return sorted(blocks, key=lambda b: (-(b[1] - b[0]) * (b[3] - b[2]), b))


def block_roof(h, block):
    """Roof of one block from its cells: dict(standing, eave, ridge, roof, near) or None when too little stands.

    rows of h run across the block (v), columns along it (u) when the block is longer in columns; the ridge of a
    pitched roof follows the long side. `near` is the share of standing cells within 2 m of the stated roof.
    """
    r0, r1, c0, c1 = block
    part = h[r0:r1, c0:c1]
    standing = np.isfinite(part) & (part > ABOVE_GROUND)
    share = float(standing.sum() / part.size)
    if standing.sum() < 12:
        return dict(standing=round(share, 3))
    values = part[standing]
    p25, p50, p90 = (float(v) for v in np.percentile(values, [25, 50, 90]))
    across = 0 if part.shape[0] <= part.shape[1] else 1     # the short side
    with np.errstate(all='ignore'):
        profile = np.nanmedian(np.where(standing, part, np.nan), axis=1 - across)
    profile = profile[np.isfinite(profile)]
    third = max(1, len(profile) // 3)
    sides = (profile[:third], profile[-third:]) if len(profile) >= 3 else (np.array([p50]), np.array([p50]))
    edges = float(np.median(np.concatenate(sides)))
    middle = float(np.median(profile[third:len(profile) - third])) if len(profile) > 2 * third else p50
    short = min(part.shape)
    # A pitched roof rises in the middle, by no more than half its width (45 degrees). A larger "rise" is two
    # levels side by side that were too narrow to cut apart.
    # The eave is the roof at the walls: the outer tenth of the profile on both sides, not the outer thirds, which
    # lie a sixth of the rise higher.
    tenth = max(1, len(profile) // 10)
    walls = min(float(np.median(np.concatenate((profile[:tenth], profile[-tenth:])))), p50)
    # Both sides must lie below the middle: a high part beside a low part is two levels, not a ridge.
    if middle - edges > .8 and middle - max(float(np.median(side)) for side in sides) > .4 and p90 - p25 >= 1.2 and \
            max(p90, middle) - walls <= .5 * short:
        roof, eave, ridge = 'gable', walls, max(p90, middle)
        near = float(((values > eave - 2) & (values < ridge + 2)).mean())
    else:
        # The flat level that the most cells are near. For one level this is the median; for two levels in one
        # block it is the larger one, not a height between them where nothing stands.
        levels = np.percentile(values, np.arange(10, 91, 5))
        counts = [(abs(values - level) < 2).sum() for level in levels]
        band = values[abs(values - levels[int(np.argmax(counts))]) < 2]
        roof, eave = 'flat', float(np.median(band))
        ridge = max(eave, min(float(np.percentile(band, 90)), eave + 1.2))
        near = float((abs(values - eave) < 2).mean())
    return dict(standing=round(share, 3), eave=eave, ridge=ridge, roof=roof, near=round(near, 3))


def is_round(area, perimeter, corners):
    """A mapped circle: at least 10 corners and an area close to the circle with the same perimeter."""
    return corners >= 10 and 4 * math.pi * area / (perimeter * perimeter) > .95


def closed(mask):
    """The mask with every gap closed that has cells of the mask on all four sides (its rows and its columns).

    A disc stays a disc, and a ring becomes a disc: a tank whose roof lies low inside its wall is measured as a whole.
    A cell beside the body is not added: it has no cell of the mask on its far side.
    """
    rows = np.maximum.accumulate(mask, axis=1) & np.maximum.accumulate(mask[:, ::-1], axis=1)[:, ::-1]
    columns = np.maximum.accumulate(mask, axis=0) & np.maximum.accumulate(mask[::-1], axis=0)[::-1]
    return rows & columns


def stated_tank(xx, yy, h, x, y, radius, eave, ridge):
    """A stated tank measured again from the heights: dict(edge, standing, beyond, shell).

    The bake (tank() below) and the area's check (27_check_buildings.py) both judge a tank by these four numbers, so
    the bake cannot write a tank that the check then refuses.
    edge: the radius where the wall ends. In rings of 0.5 m, outward from 3 m inside the stated circle, it is where
          the share of cells above half of the top falls through one half, after a ring that stands (nan: no such
          place in the window). Low rings at the start are passed over: the inside of a tank with an open top or a
          floating roof lies low, and its wall is further out.
    standing: the share of the ring from 3 to 0.5 m inside the circle that stands above half of the shell.
    beyond: the same share from 2 to 5 m outside the circle.
    shell: the median height of what stands in that inner ring.
    """
    distance = np.hypot(xx - x, yy - y)
    known = np.isfinite(h)
    edge, before = float('nan'), None
    for inner in np.arange(max(0., radius - 3), radius + 12, .5):
        ring = known & (distance >= inner) & (distance < inner + .5)
        if not ring.sum():
            break
        share = float((h[ring] > .5 * ridge).mean())
        if share >= .5:
            before = share
        elif before is not None:
            # Between the middle of the ring before and the middle of this one.
            edge = float(inner - .25 + .5 * (before - .5) / max(1e-9, before - share))
            break
    ring = known & (distance < radius - .5) & (distance > radius - 3)
    up = ring & (h > .5 * eave)
    outside = known & (distance > radius + 2) & (distance < radius + 5)
    return dict(edge=edge, standing=float(up.sum() / max(1, ring.sum())),
                beyond=float((h[outside] > .5 * eave).mean()) if outside.sum() else 0.,
                shell=float(np.median(h[up])) if up.sum() else float('nan'))


def tank(xx, yy, h, near):
    """A round tank from the heights: dict(x, y, diameter, eave, ridge, rim, roundness) or a dict with `reason`.

    `near` marks the cells where the tank may be (the mapped circle, a little wider). The body is what stands
    higher than half of the top there, with its inside closed. The diameter is that of the circle with the body's
    area: exact for a disc at every size. (The spans below leave out 1 % at each end against stray cells. On a disc
    that cuts 6.5 % off the diameter, so they give the place and the roundness, where it cancels, not the size.)

    A tank has a wall: from 3 to 0.5 m inside its circle it stands at nearly its full height (`rim`). A heap of
    chips or gravel is round too, but low at its edge; trees on an empty pad leave gaps (`rim_does_not_stand`). The
    test is the wall and not the inside, so a roof that lies low inside the wall does not hide a tank, when the wall
    with its walkway fills that ring. A wall that stands all round in some 0.5 m of the ring and is too narrow to
    fill it (less than about 2 m in the heights: an open top, a floating roof) is left out by its own name,
    `thin_wall`. Every real tank here has a fixed roof that fills the ring (rim 0.79 or more against 0.60), so none
    is one.

    A tank that is wider than the cells of `near` is cut off there, and its area would state it too small. So the
    place where the wall ends is found again in the whole window (stated_tank), and it must lie within EDGE_FIT of
    the stated circle; if not, the tank is left out (`wider_than_mapped`, or `edge_does_not_fit` when the wall ends
    inside the circle or nowhere).

    Measured in Point Tupper (14 Nov 2026, 31 tanks of 35 to 75 m across): the diameter agrees to 0.2 m with the
    place where the wall ends; the real tank is at most 2.9 m wider than its mapped circle; every roof is a fixed
    low cone, 1.5 to 3.2 m above a shell of 14 to 18 m (at most 0.18 of the shell), and the rim is 0.79 or more.
    `rim` compares the wall with the top of the roof, so a cone that rises more than about 0.4 of its shell fails
    it (6 m on a 15 m shell passes, 7 m does not); there is none.
    """
    cells = near & np.isfinite(h) & (h > ABOVE_GROUND)
    if cells.sum() < 50:
        return dict(reason='nothing_stands', standing=round(float(cells.sum() / max(1, near.sum())), 3))
    top = float(np.percentile(h[cells], 98))
    body = closed(cells & (h > max(ABOVE_GROUND, .5 * top)))
    x, y = xx[body], yy[body]
    spans = []
    for a, b in ((1, 0), (0, 1), (math.sqrt(.5), math.sqrt(.5)), (math.sqrt(.5), -math.sqrt(.5))):
        lo, hi = np.percentile(a * x + b * y, [1, 99])
        spans.append((float(hi - lo), float((lo + hi) / 2)))
    diameter = 2 * math.sqrt(float(body.sum()) / math.pi)
    roundness = min(s[0] for s in spans) / max(s[0] for s in spans)
    cx, cy = spans[0][1], spans[1][1]
    distance = np.hypot(xx - cx, yy - cy)
    radius = diameter / 2
    high = np.isfinite(h) & (h > .75 * top)
    # Just inside the edge, where a cell is not half wall and half air.
    ring = (distance < radius - .5) & (distance > radius - 3)
    rim = float((ring & high).sum() / max(1, ring.sum()))
    result = dict(x=float(cx), y=float(cy), diameter=diameter, roundness=round(roundness, 3), rim=round(rim, 3))
    if roundness < .9:
        return dict(result, reason='not_round')
    if rim < MIN_STANDING:
        def stands(inner):
            narrow = (distance >= inner) & (distance < inner + .5)
            return (narrow & high).sum() >= MIN_STANDING * max(1, narrow.sum())
        # A wall stands all round in one ring of 0.5 m near the edge, but it does not fill the 2.5 m.
        thin = any(stands(radius - inside) for inside in (.5, 1, 1.5, 2, 2.5, 3))
        return dict(result, reason='thin_wall' if thin else 'rim_does_not_stand')
    eave = float(np.median(h[ring & high]))
    inner = (distance < max(1, radius - 4)) & np.isfinite(h)
    inside = float(np.percentile(h[inner], 90)) if inner.sum() >= 12 else eave
    # A fixed roof is a low cone or dome above the shell. A roof below the rim: a flat top at the rim.
    ridge = min(inside, eave + .15 * diameter) if inside > eave + .3 else eave
    again = stated_tank(xx, yy, h, cx, cy, radius, eave, ridge)
    result.update(beyond=round(again["beyond"], 3), **(dict(edge=round(again["edge"], 2)) if math.isfinite(again["edge"]) else {}))
    if not abs(again["edge"] - radius) <= EDGE_FIT or again["beyond"] >= BEYOND_FIT:
        return dict(result, reason='wider_than_mapped' if again["edge"] > radius + EDGE_FIT or again["beyond"] >= BEYOND_FIT
                    else 'edge_does_not_fit')
    if not abs(again["shell"] - eave) <= SHELL_FIT:
        return dict(result, reason='shell_height_not_clear')
    return dict(result, eave=eave, ridge=ridge)
