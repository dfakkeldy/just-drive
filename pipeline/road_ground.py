#!/usr/bin/env python3
"""Road-shaped ground: two optional steps of the bake. Both are OFF unless their flag is set, and with the
flags off no script here changes a byte of its output.

  MMM_ROAD_BED=1     (23_bake_roads.py)   move a road line sideways onto the road bed that the LiDAR shows,
                                          where the bed is clearly 1.5 to 8 m beside the mapped line
  MMM_ROAD_GROUND=1  (24_bake_corridor.py) shape the 1 m ground under each road: a smooth height line along the
                                          road, a small crown across it and its shoulder, and the mismatch at the shoulder's edge faded out

Why: the province's centre lines are drawn at 1:10,000 and lie a few metres beside the real bed on a tenth to a
quarter of their length; the game then paints the road on the bank. (The brooks had the same fault: 31_bake_streams.)

Keep boxes (`keep_roads` of an area in areas.py): a hand-built place beside a road. No piece of road line that touches
a box moves, and no ground inside one changes; both come back to full over 30 m outside it.

Junctions stay whole. The ends that meet at one place are one node and take one move (`_nodes`); a side road's end
goes with the through road it lies on, and all those moves are worked out together, in one step (`_settle`). What must
stay (a bridge, an end on the area's edge, a piece of line at a keep box) holds the roads joined to it, easing off over
30 m along them (`_hold`). A junction that one move cannot keep whole does not move at all: one that lies on two
through roads, or on one through road at more than one place, or in a closed circle of short roads. Before a moved
line is written the result is measured (`junctions`), and a move that would tear a junction stops the bake.

The lines before the move are kept (`keep_lines_before`: roads-before-bed.json beside the bake's reports, and its
sha256 as the mark `bed` in roads.json). 29_bake_props.py decides where each mailbox goes on those lines and takes only
the position from the moved line; without them every threshold of its rule can flip and boxes jump. The file belongs
to its roads.json: a land that is copied to another root takes it along, and a bake with a missing or other file stops.

What stays as it is: bridges (no shift, no shaping; the shaping fades out toward an abutment), brooks (the ground
within a metre of a brook line is not touched outside the driving surface), the sea, tracks and driveways (their
lines are too uncertain), levels 5 and 6 (4 m samples cannot hold a 5 m wide bed). Road ids, names, kinds, widths
and the washboard flag never change.

This module needs numpy only. The two samplers at the bottom need GDAL and load it when they are made.
"""
import hashlib
import heapq
import json
import math
import os

import numpy as np

T = 256
NODATA = -32767.0

# ---- the road's bed in the LiDAR ----------------------------------------------------------------
STEP = 5.0            # metres between the cross-sections that look for the bed
REACH = 8.0           # metres searched to each side
OFFSETS = np.arange(-REACH, REACH + 0.25, 0.5)
MIN_SHIFT = 1.5       # a nearer bed is left alone: the line is still on it
BED_SPARE = 3.0       # metres: how far past the best strip the bed may still reach
BED_TOLERANCE = 0.012 # strips this close to the best one count as the same bed
BED_MAX = 0.08        # a strip worse than this (slope plus unevenness) is no bed at all
CLEAR_GAIN = 0.04     # "clearly better": the strip at the line is this much worse (slope plus unevenness)
MIN_RUN = 30.0        # metres: a shorter find is noise
SHIFT_MEDIAN = 45.0   # metres: one odd cross-section does not bend the line
SHIFT_SIGMA = 20.0    # metres: then the shift is smoothed along the road, so the line gets no new wiggles
END_TAPER = 25.0      # metres over which a line's end takes the shift of the road it joins
JOIN = 2.5            # metres: two lines this near at an end are joined there

# ---- the ground under a road ---------------------------------------------------------------------
CROWN = 0.02          # the surface falls this much per metre from the centre line
TILT_LIMIT = 0.05     # the bed's own slope across (a banked bend) is kept up to this
SHOULDER = {1: 2.0, 2: 2.0, 3: 1.5, 5: 1.2, 4: 1.0}   # metres of shoulder past the painted edge, by road kind; it carries the crown's fall on
BLEND = 4.0           # metres over which the mismatch at the shoulder's edge fades out, at least
BLEND_MAX = 10.0      # ... and at most (a wide fade for a large mismatch)
BANK = 0.6            # the fade is widened until it adds no more slope than this
LIMIT = 1.5           # metres: the height line never leaves the LiDAR's centre height by more; such stretches are listed
ALONG_SIGMA = 4.0     # metres: heights along the road are smoothed at the scale of a car's length
TILT_SIGMA = 8.0
NODE_TAPER = 20.0     # metres over which a line's end takes the height of the road it joins
END_FADE = 8.0        # metres over which the shaping fades in from a dead end or a bridge abutment
BROOK_CLEAR = (1.0, 4.0)   # metres from a brook line: no change nearer than the first, full change past the second
SHAPED_KINDS = (1, 2, 3, 5)
PAINT_ORDER = {4: 0, 5: 1, 3: 2, 2: 3, 1: 4}   # the more important road is shaped last and keeps its surface
KEEP_RAMP = 30.0      # metres outside a keep box over which moving and shaping come back to full
ROUNDING = 0.015      # metres: two points that are each written to the centimetre may differ by this much (twice half a centimetre's diagonal)
HALO = 96             # metres of ground round a block that the shaping reads (the bake cuts its tiles from the middle)


def _away(x, y, boxes):
    """Metres from points to the nearest keep box (xmin, ymin, xmax, ymax): 0 inside one, infinite with no box."""
    x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    out = np.full(np.broadcast(x, y).shape, np.inf)
    for x0, y0, x1, y1 in boxes or ():
        out = np.minimum(out, np.hypot(np.maximum(np.maximum(x0 - x, x - x1), 0.0), np.maximum(np.maximum(y0 - y, y - y1), 0.0)))
    return out


def kept(x, y, boxes, ramp=None):
    """How much of a change is let through at points: 0 inside a keep box (xmin, ymin, xmax, ymax), rising to 1 at
    `ramp` metres outside it. A keep box holds a hand-built place whose road and ground must stay as they are."""
    return smoothstep(0.0, KEEP_RAMP if ramp is None else ramp, np.minimum(_away(x, y, boxes), KEEP_RAMP if ramp is None else ramp))


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def gauss(values, sigma, valid=None):
    """Gaussian blur along a 1-D array, normalised at the ends and over invalid samples."""
    v = np.asarray(values, dtype=np.float64)
    ok = np.isfinite(v) if valid is None else (np.asarray(valid, dtype=bool) & np.isfinite(v))
    if sigma <= 0.05 or len(v) < 2:
        return np.where(ok, v, np.nan)
    r = max(1, int(math.ceil(3 * sigma)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    num = np.convolve(np.where(ok, v, 0.0), k, mode='same') if len(v) >= len(k) else _convolve_short(np.where(ok, v, 0.0), k)
    den = np.convolve(ok.astype(np.float64), k, mode='same') if len(v) >= len(k) else _convolve_short(ok.astype(np.float64), k)
    return np.where(den > 1e-9, num / np.maximum(den, 1e-9), np.nan)


def _convolve_short(v, k):
    """np.convolve(mode='same') returns the longer length; this keeps the signal's length."""
    full = np.convolve(v, k, mode='full')
    start = (len(k) - 1) // 2
    return full[start:start + len(v)]


class Line:
    """A road's centre line with distances along it."""

    def __init__(self, pts):
        p = np.asarray(pts, dtype=np.float64)
        step = np.linalg.norm(np.diff(p, axis=0), axis=1)
        self.vertex_arc = np.r_[0.0, np.cumsum(step)]          # one per given point, also for repeated points
        p = p[np.r_[True, step > 1e-6]]
        self.p = p
        self.seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        self.cum = np.r_[0.0, np.cumsum(self.seg)]
        self.length = float(self.cum[-1]) if len(self.seg) else 0.0

    def at(self, d):
        d = np.clip(np.atleast_1d(np.asarray(d, dtype=np.float64)), 0.0, self.length)
        k = np.clip(np.searchsorted(self.cum, d, side='right') - 1, 0, len(self.seg) - 1)
        return self.p[k] + (self.p[k + 1] - self.p[k]) * ((d - self.cum[k]) / self.seg[k])[:, None]

    def direction(self, d, span=3.0):
        """Unit direction over 2 x span metres, so that one short kinked piece does not turn a cross-section."""
        d = np.atleast_1d(np.asarray(d, dtype=np.float64))
        v = self.at(d + span) - self.at(d - span)
        return v / np.maximum(np.linalg.norm(v, axis=1), 1e-9)[:, None]

    def left(self, d, span=3.0):
        v = self.direction(d, span)
        return np.column_stack([-v[:, 1], v[:, 0]])

    def nearest(self, x, y):
        """(distance, distance along, signed side: + left) of the point of the line nearest to one point."""
        a, b = self.p[:-1], self.p[1:]
        ab = b - a
        t = np.clip(((x - a[:, 0]) * ab[:, 0] + (y - a[:, 1]) * ab[:, 1]) / np.maximum(self.seg ** 2, 1e-12), 0, 1)
        q = a + ab * t[:, None]
        d = np.hypot(q[:, 0] - x, q[:, 1] - y)
        k = int(d.argmin())
        side = ab[k, 0] * (y - a[k, 1]) - ab[k, 1] * (x - a[k, 0])
        return float(d[k]), float(self.cum[k] + t[k] * self.seg[k]), (1.0 if side >= 0 else -1.0)


# ---- finding the bed -----------------------------------------------------------------------------

def bed_costs(sampler, line, half_width, step=STEP):
    """For a cross-section every `step` metres: how poor a road bed each strip to the side would be.

    Returns (s, cost[n, offsets], slope[n, offsets], ok[n]); None for a line shorter than two steps.
    cost = |slope of the best straight line across the strip| + (distance of the strip from that line) / half width.
    A bed is straight and near level across; a ditch or a bank is neither.
    """
    if line.length < step * 2:
        return None
    s = np.arange(step / 2, line.length, step)
    left = line.left(s)
    span = np.arange(-(REACH + half_width), REACH + half_width + 0.25, 0.5)
    prof = np.zeros((len(s), len(span)))
    for shift in (-2.0, 0.0, 2.0):          # three sections 2 m apart, averaged: less noise from one rut or stone
        c = line.at(s + shift)
        prof += sampler.at(c[:, None, 0] + left[:, None, 0] * span[None], c[:, None, 1] + left[:, None, 1] * span[None])
    prof /= 3
    n = int(round(half_width / 0.5))
    u = np.arange(-n, n + 1) * 0.5
    cost = np.full((len(s), len(OFFSETS)), np.nan)
    slope_at = np.full_like(cost, np.nan)
    for q, o in enumerate(OFFSETS):
        m = int(round((o + REACH + half_width) / 0.5))
        strip = prof[:, m - n:m + n + 1]
        mean = strip.mean(axis=1)
        slope = ((strip - mean[:, None]) * u[None]).sum(axis=1) / (u * u).sum()
        resid = np.sqrt(((strip - mean[:, None] - slope[:, None] * u[None]) ** 2).mean(axis=1))
        slope_at[:, q] = slope
        cost[:, q] = np.abs(slope) + resid / half_width
    ok = np.isfinite(cost).all(axis=1)
    return s, cost, slope_at, ok


def _along_mean(cost, k=5):
    """The bed is continuous: average each strip's cost over k sections along the road."""
    filled = np.where(np.isfinite(cost), cost, 1.0)
    pad = np.pad(filled, ((k // 2, k // 2), (0, 0)), mode='edge')
    return sum(pad[i:i + len(cost)] for i in range(k)) / k + 0.002 * np.abs(OFFSETS)[None]


def _path(cost, jump=0.02):
    """The cheapest sideways path along the road; moving a metre sideways between sections costs `jump`."""
    n, m = cost.shape
    pen = jump * np.abs(OFFSETS[:, None] - OFFSETS[None, :])
    acc = cost[0].copy()
    back = np.zeros((n, m), dtype=np.int64)
    for i in range(1, n):
        total = acc[None, :] + pen
        back[i] = total.argmin(axis=1)
        acc = total.min(axis=1) + cost[i]
    path = np.empty(n, dtype=np.int64)
    path[-1] = int(acc.argmin())
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[i, path[i]]
    return path


def find_bed(sampler, line, half_width):
    """Where the bed lies beside the line. Returns dict(s, offset (m, + left; 0 where no bed is clear), raw, gain,
    ok (the ground has data there), clear (a bed was found and accepted), cross and bedCross (slopes across))."""
    got = bed_costs(sampler, line, half_width)
    if got is None:
        return None
    s, cost, slope_at, ok = got
    smooth = _along_mean(cost)
    path = _path(smooth)
    rows = np.arange(len(s))
    zero = int(np.argmin(np.abs(OFFSETS)))
    gain = smooth[rows, zero] - smooth[rows, path]
    # The cheapest strip may sit at the edge of a wide bed. Take the middle of the strips that are about as good,
    # looking at most BED_SPARE to each side: a bed is seldom much wider than the road painted on it.
    plain = smooth - 0.002 * np.abs(OFFSETS)[None]
    spare = int(round(BED_SPARE / 0.5))
    raw = np.empty(len(s))
    for i, k in enumerate(path):
        good = plain[i] <= plain[i, k] + BED_TOLERANCE
        lo = hi = int(k)
        while lo > max(0, k - spare) and good[lo - 1]:
            lo -= 1
        while hi < min(len(OFFSETS) - 1, k + spare) and good[hi + 1]:
            hi += 1
        raw[i] = (OFFSETS[lo] + OFFSETS[hi]) / 2
    # A find must be a bed: level and straight enough itself, and not merely the best strip at the far end of the search.
    found = ok & (plain[rows, path] <= BED_MAX) & (np.abs(OFFSETS[path]) <= REACH - 1.0)
    strong = found & (gain >= CLEAR_GAIN) & (np.abs(raw) >= MIN_SHIFT)
    # A find is a run of sections that all put the bed on the same side, a metre or more away. It counts when
    # enough of it is clear (MIN_RUN metres). So the mouth of a side road, where every strip looks level, does
    # not pull the line back to the map for a few metres.
    c = np.zeros(len(s), dtype=bool)
    sign = np.where(found & (np.abs(raw) >= 1.0), np.sign(raw), 0.0)
    need = int(math.ceil(MIN_RUN / STEP))
    i = 0
    while i < len(s):
        if sign[i] == 0:
            i += 1
            continue
        j, last, gap = i, i, 0
        while j < len(s) and (sign[j] == sign[i] or (sign[j] == 0 and found[j] and gap < 2)):
            gap = 0 if sign[j] == sign[i] else gap + 1
            if sign[j] == sign[i]:
                last = j
            j += 1
        if strong[i:last + 1].sum() >= need:
            c[i:last + 1] = True
        i = max(j, i + 1)
    return dict(s=s, offset=np.where(c, raw, 0.0), raw=raw, gain=gain, ok=ok, clear=c,
                cross=slope_at[rows, zero], bedCross=slope_at[rows, path])


def smooth_shift(offset):
    """The sideways shift along a road: a running median, then a Gaussian blur."""
    k = max(1, int(round(SHIFT_MEDIAN / STEP)) | 1)
    pad = np.pad(np.asarray(offset, dtype=np.float64), (k // 2, k // 2), mode='edge')
    median = np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1)
    return gauss(median, SHIFT_SIGMA / STEP)


def _segments_grid(lines, cell=64.0):
    grid = {}
    for n, line in enumerate(lines):
        if line is None:
            continue
        lo = np.floor(np.minimum(line.p[:-1], line.p[1:]) / cell).astype(np.int64)
        hi = np.floor(np.maximum(line.p[:-1], line.p[1:]) / cell).astype(np.int64)
        for (x0, y0), (x1, y1) in zip(lo, hi):
            for gx in range(x0, x1 + 1):
                for gy in range(y0, y1 + 1):
                    grid.setdefault((gx, gy), set()).add(n)
    return grid


def joins(roads, lines, cell=64.0):
    """For each end of each line: the other lines within JOIN of it.

    Returns {(road index, end 0|1): [(other index, distance along other, at the other's end: 0|1|None)]}.
    """
    grid = _segments_grid(lines, cell)
    out = {}
    for n, line in enumerate(lines):
        if line is None:
            continue
        for end in (0, 1):
            x, y = line.p[0] if end == 0 else line.p[-1]
            near = set()
            for gx in range(int(math.floor((x - JOIN) / cell)), int(math.floor((x + JOIN) / cell)) + 1):
                for gy in range(int(math.floor((y - JOIN) / cell)), int(math.floor((y + JOIN) / cell)) + 1):
                    near |= grid.get((gx, gy), set())
            found = []
            for m in sorted(near):
                if m == n:
                    continue
                d, arc, _ = lines[m].nearest(x, y)
                if d <= JOIN:
                    at_end = 0 if arc <= JOIN else 1 if arc >= lines[m].length - JOIN else None
                    found.append((m, arc, at_end))
            out[(n, end)] = found
    return out


def _back_gap(points, end, tip=None, pieces=None):
    """The gap between an end of a line and the part of that same line that comes back to it: (metres, piece,
    place on that piece 0..1, the pieces that were looked at). The part that runs away from the end is not looked at:
    only the pieces after the line has left the joining distance. `tip` and `pieces` measure another point against
    pieces found before (the guard: the moved end against the same pieces of the moved line)."""
    p = np.asarray(points, dtype=np.float64)
    a, ab = p[:-1], np.diff(p, axis=0)
    if pieces is None:
        far = np.hypot(*(p - (p[0] if end == 0 else p[-1])).T) > JOIN
        pieces = np.zeros(len(a), dtype=bool)
        if far.any():
            if end == 0:
                pieces[int(np.argmax(far)):] = True
            else:
                pieces[:len(far) - 1 - int(np.argmax(far[::-1]))] = True
    tip = (p[0] if end == 0 else p[-1]) if tip is None else np.asarray(tip, dtype=np.float64)
    if not pieces.any():
        return np.inf, 0, 0.0, pieces
    t = np.clip(((tip - a) * ab).sum(axis=1) / np.maximum((ab * ab).sum(axis=1), 1e-12), 0, 1)
    gap = np.where(pieces, np.hypot(*(a + ab * t[:, None] - tip).T), np.inf)
    k = int(gap.argmin())
    return float(gap[k]), k, float(t[k]), pieces


def _own_side(line, end):
    """Where an end of a line lies on that same line again, as (distance along it, at its end: 0|1|None), or None:
    a road that comes back past its own end (the letter P), or closes on itself. `joins` looks at other lines only."""
    gap, k, t, _ = _back_gap(line.p, end)
    if gap > JOIN:
        return None
    arc = float(line.cum[k] + t * line.seg[k])
    return arc, (0 if arc <= JOIN else 1 if arc >= line.length - JOIN else None)


def meetings(roads, lines):
    """`joins`, and for each end also the place where it lies on its own line again (`_own_side`). The move and its
    guard read the junctions from this, so that no place where an end lies on a line is left out."""
    out = joins(roads, lines)
    for n, line in enumerate(lines):
        if line is None:
            continue
        for end in (0, 1):
            own = _own_side(line, end)
            if own is not None:
                out[(n, end)] = out[(n, end)] + [(n, *own)]
    return out


def _by_place(lines, cell=2048.0):
    """Line indexes in an order that keeps neighbours together: the samplers then read each block of land once."""
    def key(n):
        if lines[n] is None:
            return (0, 0, n)
        mid = lines[n].p[len(lines[n].p) // 2]
        return (int(mid[0] // cell), int(mid[1] // cell), n)
    return sorted(range(len(lines)), key=key)


def _end_weights(arc, length, taper):
    """How much of each end's value a point takes: exactly 1 at that end and 0 at the other, 0 past `taper`.
    On a line shorter than the taper the two weights cross over along its whole length. They never sum above 1."""
    taper = max(min(taper, length), 1e-9)
    k0 = 1 - smoothstep(0, taper, arc)
    k1 = 1 - smoothstep(0, taper, length - arc)
    total = k0 + k1
    scale = np.where(total > 1, 1 / np.maximum(total, 1e-9), 1.0)
    return k0 * scale, k1 * scale


def move_to_bed(roads, sampler, shifted=lambda road: road['kind'] in SHAPED_KINDS, box=None, keep=()):
    """Move road lines onto their beds, in place. Bridges never move; a line's end follows the road it joins.
    An end on the edge of `box` (xmin, ymin, xmax, ymax: where the area's roads are cut off) stays where it is.
    No piece of line that touches a `keep` box moves (see `_hold`). Before anything is written the result is measured
    (`junctions`); a move that would tear a junction raises an error and changes nothing.

    Returns a report (`junctionsHeld` lists the junctions that stay because one move could not keep them whole).
    Only `pts` change: ids, names, kinds, widths and flags stay.
    """
    def on_edge(point):
        return box is not None and (min(abs(point[0] - box[0]), abs(point[0] - box[2])) < 1.0 or
                                    min(abs(point[1] - box[1]), abs(point[1] - box[3])) < 1.0)

    lines = [Line(r['pts']) if len(r['pts']) >= 2 else None for r in roads]
    lines = [line if line is not None and line.length > 0 else None for line in lines]
    own = {}          # road index -> (s, offset) of its own find
    report = []
    for n in _by_place(lines):
        road = roads[n]
        if lines[n] is None or road['bridge'] or not shifted(road):
            continue
        bed = find_bed(sampler, lines[n], road['halfWidth'])
        if bed is None or not bed['clear'].any():
            continue
        own[n] = (bed['s'], smooth_shift(bed['offset']), bed)

    def own_vector(n, arc):
        """The sideways move a line wants at distances along it, as east/north vectors."""
        arc = np.atleast_1d(np.asarray(arc, dtype=np.float64))
        if n not in own:
            return np.zeros((len(arc), 2))
        s, off, _ = own[n]
        return lines[n].left(arc) * np.interp(arc, s, off)[:, None]

    joined = meetings(roads, lines)
    node_of, members = _nodes(lines, joined)
    order = sorted((n for n in range(len(roads)) if lines[n] is not None and not roads[n]['bridge']),
                   key=lambda n: (-PAINT_ORDER.get(roads[n]['kind'], 0), roads[n]['id']))
    here = {n: np.asarray(roads[n]['pts'], dtype=np.float64) for n in order}
    importance = lambda q: (-PAINT_ORDER.get(roads[q[0]]['kind'], 0), roads[q[0]]['id'])

    def piece(m, arc):
        """The piece of road m (its first point's number) that holds the place `arc` metres along it."""
        return int(np.clip(np.searchsorted(lines[m].vertex_arc, arc, side='right') - 1, 0, len(lines[m].vertex_arc) - 2))

    # A junction is decided once, for all the ends that meet there (a node): they take one move, so they still meet.
    vertex_k = {n: _end_weights(lines[n].vertex_arc, lines[n].length, END_TAPER) for n in order}
    # What a line wants at each of its points, less the share that its two ends decide.
    wanted = {n: own_vector(n, lines[n].vertex_arc) * (1 - vertex_k[n][0] - vertex_k[n][1])[:, None] for n in order}
    known = {}        # node -> its move, where nothing else decides it: none, or the mean of what its ends want
    follows = {}      # node -> (through road, distance along it): the node lies on that road's side and goes with it
    under = {}        # node -> the pieces of through road it lies on, as (road, piece)
    odd = {}          # node -> why it stays, where one move could not keep it whole
    stay = set()      # nodes that must not move: at a bridge, on the area's edge, and the odd ones
    ties = []         # groups of points that are held alike: the ends of a node, and the piece of road they end on
    for node, ends_here in members.items():
        relations = [found for end in ends_here for found in joined.get(end, [])]
        inside = {n for n, _ in ends_here}
        through = sorted({(m, arc) for _, m, arc in _sides(ends_here, joined)}, key=lambda q: (*importance(q), q[1]))
        stays = (any(on_edge(lines[n].p[0] if end == 0 else lines[n].p[-1]) for n, end in ends_here)   # the area's box cut a road off here
                 or any(roads[n]['bridge'] for n in inside) or any(roads[m]['bridge'] for m, _, _ in relations))   # a bridge stays, and so does what meets it
        if stays:
            known[node] = np.zeros(2)
            stay.add(node)
        elif not _one_place(through):
            # One move cannot follow two roads, or one road at two places where it moves differently.
            known[node], odd[node] = np.zeros(2), 'on two through roads' if len({m for m, _ in through}) > 1 else 'on one through road at two places'
            stay.add(node)
        elif through:
            follows[node] = through[0]                     # side roads end on the through road, wherever that goes
        else:
            # Ends that meet, and a free end: the mean of what the shifted roads among them want there.
            wants = [own_vector(n, [0.0 if end == 0 else lines[n].length])[0] for n, end in ends_here if n in own]
            known[node] = np.mean(wants, axis=0) if wants else np.zeros(2)
        under[node] = [(m, piece(m, arc)) for m, arc in through if m in here]
        points = [(n, 0 if end == 0 else len(here[n]) - 1) for n, end in ends_here if n in here]
        points += [(m, k + step) for m, k in under[node] for step in (0, 1)]
        if len(points) > 1:
            ties.append(points)

    def share(m, arc):
        """The move of road m's line at a distance along it, in parts: (what the line itself wants there, the share
        of its first end's move, the share of its last end's). Between two points it is as the moved line runs."""
        at, k = lines[m].vertex_arc, piece(m, arc)
        t = float(np.clip((arc - at[k]) / (at[k + 1] - at[k]), 0.0, 1.0)) if at[k + 1] > at[k] else 0.0
        mix = lambda values: values[k] * (1 - t) + values[k + 1] * t
        return mix(wanted[m]), float(mix(vertex_k[m][0])), float(mix(vertex_k[m][1]))

    # A side road's end takes the through road's move, which hangs on that road's own ends, which may lie on other
    # roads in turn (a chain), on the first road again (a circle), or in this very node. So all the moves are one set of equations:
    # move of node i = constant_i + sum over j of weight_ij * move of node j. It is solved in one step (`_settle`).
    while True:
        index = {node: i for i, node in enumerate(sorted(follows))}
        weight, constant = np.zeros((len(index), len(index))), np.zeros((len(index), 2))
        for node, i in index.items():
            m, arc = follows[node]
            constant[i], *parts = share(m, arc)
            for end, part in enumerate(parts):
                other = node_of[(m, end)]
                if other in known:
                    constant[i] += known[other] * part
                else:
                    weight[i, index[other]] += part
        # A node needs something to settle on: a share of a road's own wish (or of a node that is known), directly
        # or through the nodes it hangs on. A closed circle of short roads has none: its nodes stay.
        settled = weight.sum(axis=1) < 1 - 1e-6
        while True:
            more = settled | (weight[:, settled] > 1e-6).any(axis=1)
            if (more == settled).all():
                break
            settled = more
        if settled.all():
            break
        for node, i in index.items():
            if not settled[i]:
                known[node], odd[node] = np.zeros(2), 'in a closed circle of short roads'
                stay.add(node)
                del follows[node]
    solved = _settle(weight, constant)
    largest = max([float(np.abs(off).max()) for _, off, _ in own.values()], default=0.0)
    if len(index) and (not np.isfinite(solved).all() or np.abs(solved - (weight @ solved + constant)).max() > 1e-9
                       or np.hypot(solved[:, 0], solved[:, 1]).max() > largest + 1e-6):
        raise RuntimeError('road_ground: the moves of joined roads could not be worked out')
    for node, i in index.items():
        known[node] = solved[i]

    # What must stay holds the roads round it. The piece of through road under a node that stays, stays with it.
    pins = [at for node in sorted(stay) for at in under[node]]
    hold = _hold(roads, lines, order, keep, ties, pins)
    # The hold is taken once, at the end, from each point's own weight: the ends of a node and the piece of road
    # under them have one weight (`ties`), so they still take one move.
    moves = {n: (wanted[n] + known[node_of[(n, 0)]][None] * vertex_k[n][0][:, None] +
                 known[node_of[(n, 1)]][None] * vertex_k[n][1][:, None]) * hold[n][:, None] for n in order}

    # A point that moves is written to the centimetre, however little its road moves as a whole: the road it meets
    # was written to match it. A point that stays on its centimetre keeps its numbers exactly as they were.
    after = [dict(road) for road in roads]
    for n in order:
        there = np.round(here[n] + moves[n], 2)
        moved = np.abs(there - np.round(here[n], 2)).max(axis=1) > 0.004
        if moved.any():
            after[n]['pts'] = [[round(float(x), 2), round(float(y), 2)] if go else was
                               for (x, y), go, was in zip(there, moved, roads[n]['pts'])]
    whole = junctions(roads, after, box, keep)
    if not whole['whole']:
        raise RuntimeError(f'road_ground: this move would tear a junction or move what must stay; nothing is written: {whole}')

    moved_m = 0.0
    for n in order:
        line, road = lines[n], roads[n]
        vec = np.asarray(after[n]['pts'], dtype=np.float64) - here[n]
        road['pts'] = after[n]['pts']
        size = np.hypot(vec[:, 0], vec[:, 1])
        if size.max() < 0.05:
            continue                                       # too little to list
        seg = np.diff(line.vertex_arc)
        length = float((seg * (np.maximum(size[:-1], size[1:]) >= MIN_SHIFT / 2)).sum())
        moved_m += length
        report.append(dict(id=road['id'], name=road['name'], kind=road['kind'], metresMoved=round(length),
                           maxShift=round(float(size.max()), 2)))
    report.sort(key=lambda r: -r['metresMoved'])
    held = [dict(east=round(float(lines[node[0]].p[0 if node[1] == 0 else -1][0]), 1), north=round(float(lines[node[0]].p[0 if node[1] == 0 else -1][1]), 1), why=why)
            for node, why in sorted(odd.items())]
    return dict(roadsMoved=len(report), metresMoved=round(moved_m), junctions=whole, junctionsHeld=held, roads=report)


BEFORE_BED = 'roads-before-bed.json'


def keep_lines_before(folder, before, roads):
    """Write the lines of the moved roads as they were before `move_to_bed` ({road id: pts}), and return the mark
    that roads.json carries: the sha256 of the file. The file lies beside the bake's reports, not in the baked folder:
    the game does not read it. 29_bake_props.py does (`lines_before`), because a place that is decided on the moved
    lines jumps at every threshold of its rule."""
    now = {road['id']: road['pts'] for road in roads}
    if set(before) != set(now) or any(len(before[rid]) != len(now[rid]) for rid in now):
        raise RuntimeError('road_ground: the move changed a road id or a point count; the lines before it cannot be kept')
    moved = {str(rid): [[float(x), float(y)] for x, y in pts] for rid, pts in before.items()
             if [list(map(float, p)) for p in pts] != [list(map(float, p)) for p in now[rid]]}
    raw = json.dumps(dict(crs='EPSG:2961', pts=moved), separators=(',', ':')).encode()
    os.makedirs(folder, exist_ok=True)               # a new area or a new work root has no report folder yet
    path = os.path.join(folder, BEFORE_BED)
    with open(path + '.tmp', 'wb') as f:
        f.write(raw)
    os.replace(path + '.tmp', path)
    return dict(before=hashlib.sha256(raw).hexdigest())


def lines_before(road_file, folder):
    """The lines of the moved roads before the bed move, {road id: pts}, for the roads.json given (already read).
    Empty when that file has no mark `bed`: its roads never moved. With a mark, of any kind, the file of
    `keep_lines_before` must be there and must be the one the mark names; anything else stops the bake, and so do a
    mark that names no file and a line that does not fit its road."""
    if 'bed' not in road_file:
        return {}
    mark = road_file['bed']
    if not isinstance(mark, dict) or not isinstance(mark.get('before'), str) or len(mark['before']) != 64:
        raise RuntimeError('road_ground: roads.json has a mark `bed` that does not name the lines before the move')
    path = os.path.join(folder, BEFORE_BED)
    if not os.path.isfile(path):
        raise RuntimeError(f'road_ground: roads.json was moved onto the road bed, but the lines before the move are missing ({path}). '
                           'Bake the roads again (the same switches give the same roads.json), or bring the file with the land.')
    raw = open(path, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != mark['before']:
        raise RuntimeError(f'road_ground: {path} does not belong to this roads.json (it is from another bake of the roads)')
    before = {int(rid): pts for rid, pts in json.loads(raw)['pts'].items()}
    now = {road['id']: road['pts'] for road in road_file['roads']}
    for rid, pts in before.items():
        if rid not in now or len(pts) != len(now[rid]):
            raise RuntimeError(f'road_ground: the line before the move of road {rid} does not fit the road in roads.json')
    return before


def _sides(ends_here, joined):
    """Where the ends of a node lie on the side of a road, as [(end, road, distance along it)]. Every such place
    counts, for the move and for the guard: also on a road that has an end of its own in the node (a road that
    comes back past its own start, with a side road ending there), and on the end's own road (`_own_side`)."""
    return [(end, m, arc) for end in ends_here for m, arc, at_end in joined.get(end, []) if at_end is None]


def _one_place(through):
    """True when a node lies on at most one through road, at one place: `through` holds (road, distance along it) for
    each end of the node that lies on the side of a road. One move can follow one place only."""
    return len({m for m, _ in through}) <= 1 and (not through or max(arc for _, arc in through) - min(arc for _, arc in through) <= 1e-4)


def _settle(weight, constant):
    """The moves of the nodes that follow a through road, all at once: move = constant + weight @ move, solved for
    move. (Working it out road after road until nothing changes took thousands of rounds on a circle of long roads.)"""
    if not len(constant):
        return constant
    return np.linalg.solve(np.eye(len(constant)) - weight, constant)


def _ring(line):
    """True when a line ends where it starts (within JOIN): its two ends are one junction."""
    return math.hypot(*(line.p[0] - line.p[-1])) <= JOIN


def _nodes(lines, joined):
    """The junction nodes: ends of lines that meet, grouped. Returns ({(line index, end 0|1): node}, {node: its ends}).

    Two ends meet when `joins` finds one at the other's end, in either direction, or by way of other ends. The two
    ends of one line meet when they lie within JOIN of each other (a ring). What happens at a junction is decided once
    per node, never once per end: ends that each decided for themselves chose differently on a ring.
    """
    parent = {(n, end): (n, end) for n, line in enumerate(lines) if line is not None for end in (0, 1)}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[max(a, b)] = min(a, b)

    for n, line in enumerate(lines):
        if line is not None and _ring(line):
            union((n, 0), (n, 1))
    for end, others in joined.items():
        for m, _, at_end in others:
            if at_end is not None:
                union(end, (m, at_end))
    node_of = {k: find(k) for k in sorted(parent)}
    members = {}
    for k, node in node_of.items():
        members.setdefault(node, []).append(k)
    return node_of, members


def _touches(a, b, box):
    """True when the straight piece of line from a to b touches the box (xmin, ymin, xmax, ymax), exactly."""
    x0, y0, x1, y1 = box
    dx, dy = b[0] - a[0], b[1] - a[1]
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def _piece_away(a, b, boxes):
    """Metres from the straight piece of line a-b to the nearest keep box: exactly 0 when the piece touches one."""
    if any(_touches(a, b, box) for box in boxes):
        return 0.0
    steps = max(2, int(math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]))) + 1)
    along = a + (b - a) * np.linspace(0.0, 1.0, steps)[:, None]
    return float(_away(along[:, 0], along[:, 1], boxes).min())


def _hold(roads, lines, order, keep, ties, pins):
    """How much of its move each point of each road is let through, {road index: weights}: 0 where the road must stay,
    rising to 1 at KEEP_RAMP metres from there, measured along the roads.

    What must stay: a piece of line that touches a keep box (an exact test, so also when neither of its points is
    inside the box), and each piece in `pins` (a piece of through road under a junction that stays, such as the end
    of a bridge). Beside a keep box a point starts from the distance of its two pieces to the box.

    The distance is then carried along every line and through every junction: the points of one group in `ties` (the
    ends that meet at a node, and the two points of the piece of through road they end on) take one distance. So the
    weight never rises faster along a road than it does beside a keep box, a junction moves as one, and what is held
    stays whole along any chain of junctions. The points are settled once each, nearest first (Dijkstra's method):
    there is no round to repeat and nothing that could fail to settle.
    """
    away = {}
    for n in order:
        pts = np.asarray(roads[n]['pts'], dtype=np.float64)
        d = np.full(len(pts), np.inf)
        if keep:
            point_away = _away(pts[:, 0], pts[:, 1], keep)
            step = np.hypot(*np.diff(pts, axis=0).T)
            for i in np.flatnonzero(np.minimum(point_away[:-1], point_away[1:]) - step < KEEP_RAMP):
                far = _piece_away(pts[i], pts[i + 1], keep)
                d[i], d[i + 1] = min(d[i], far), min(d[i + 1], far)
        away[n] = d
    for m, k in pins:
        away[m][k] = away[m][k + 1] = 0.0
    tied = {}
    for group, points in enumerate(ties):
        for point in points:
            tied.setdefault(point, []).append(group)
    heap = [(float(d), n, i) for n in order for i, d in enumerate(away[n]) if d < KEEP_RAMP]
    heapq.heapify(heap)
    while heap:
        d, n, i = heapq.heappop(heap)
        if d > away[n][i]:
            continue                                       # a nearer way to this point was found since
        arc = lines[n].vertex_arc
        reach = [(n, j, d + abs(float(arc[j] - arc[i]))) for j in (i - 1, i + 1) if 0 <= j < len(arc)]
        reach += [(m, j, d) for group in tied.get((n, i), ()) for m, j in ties[group]]
        for m, j, far in reach:
            if far < away[m][j] and far < KEEP_RAMP:
                away[m][j] = far
                heapq.heappush(heap, (far, m, j))
    return {n: smoothstep(0.0, KEEP_RAMP, np.minimum(away[n], KEEP_RAMP)) for n in order}


def junctions(before, after, box=None, keep=()):
    """How whole the junctions are after a move, measured on the points as they are written. `before` and `after`
    are the same roads in the same order. Returns the numbers, and `whole`: True when all of this holds.

      - endsApart: the ends of one node took one move (the largest distance between the moves of two of them, in metres);
      - sideEndGrowth: an end that lay on or beside the side of a through road is no farther from it than before
        (the largest growth of that gap, in metres, over every end and every through road it lay on);
      - nothing that must stay has moved: bridges, ends on the edge of the area, pieces of line that touch a keep box;
      - only `pts` changed, and no road gained or lost a point.
    """
    def lined(roads):
        lines = [Line(r['pts']) if len(r['pts']) >= 2 else None for r in roads]
        return [line if line is not None and line.length > 0 else None for line in lines]

    def tip(roads, n, end):
        return np.asarray(roads[n]['pts'][0 if end == 0 else -1], dtype=np.float64)

    was, now = lined(before), lined(after)
    joined = meetings(before, was)
    _, members = _nodes(was, joined)
    apart = growth = 0.0
    on_side = on_two = edge_moved = 0
    for ends_here in members.values():
        shift = np.array([tip(after, n, end) - tip(before, n, end) for n, end in ends_here])
        apart = max(apart, float(np.hypot(*(shift[:, None] - shift[None]).reshape(-1, 2).T).max()))
        if box is not None and any(min(abs(tip(before, n, end)[0] - box[0]), abs(tip(before, n, end)[0] - box[2])) < 1.0 or
                                   min(abs(tip(before, n, end)[1] - box[1]), abs(tip(before, n, end)[1] - box[3])) < 1.0 for n, end in ends_here):
            edge_moved += int(np.abs(shift).max() > 0)
        gaps = {}         # through road -> how much farther from it the node's ends are now
        for (n, end), m, _ in _sides(ends_here, joined):
            if m == n and len(before[n]['pts']) == len(after[n]['pts']):
                # On its own road: the gap to the part of the line that comes back, not to the end's own piece.
                gap, _, _, pieces = _back_gap(before[n]['pts'], end)
                more = _back_gap(after[n]['pts'], end, tip(after, n, end), pieces)[0] - gap
            elif m != n and now[m] is not None:
                more = now[m].nearest(*tip(after, n, end))[0] - was[m].nearest(*tip(before, n, end))[0]
            else:
                continue
            gaps[m] = max(gaps.get(m, -np.inf), more)
        if gaps:
            on_side += 1
            growth = max(growth, _side_growth(gaps))
            on_two += int(len(gaps) > 1)
    bridges = sum(1 for a, b in zip(before, after) if a['bridge'] and a['pts'] != b['pts'])
    fields = sum(1 for a, b in zip(before, after) if len(a['pts']) != len(b['pts']) or
                 {k: v for k, v in a.items() if k != 'pts'} != {k: v for k, v in b.items() if k != 'pts'})
    held = 0
    for a, b in zip(before, after):
        if keep and a['pts'] != b['pts'] and len(a['pts']) == len(b['pts']):
            p = np.asarray(a['pts'], dtype=np.float64)
            for i in range(len(p) - 1):
                if (a['pts'][i] != b['pts'][i] or a['pts'][i + 1] != b['pts'][i + 1]) and any(_touches(p[i], p[i + 1], k) for k in keep):
                    held += 1
    out = dict(nodes=len(members), endsApart=round(apart, 3), sideEnds=on_side, sideEndGrowth=round(growth, 3),
               nodesOnTwoThroughRoads=on_two, bridgesMoved=bridges, edgeEndsMoved=edge_moved, heldPiecesMoved=held,
               roadsWithOtherChanges=fields)
    out['whole'] = bool(len(before) == len(after) and apart <= ROUNDING and growth <= ROUNDING and not (bridges or edge_moved or held or fields))
    return out


def _side_growth(gaps):
    """How much farther a node's ends lie from the through roads they lay on, from {through road: growth of the gap}.
    Every one of those roads counts: an end that stays on one road and leaves another has left a road."""
    return max(gaps.values())


# ---- the height line along a road ----------------------------------------------------------------

def _seen(joined, lines, n, end):
    """What an end of a line meets, as `joins` lists it. The two ends of a ring are one junction, also when they lie
    a metre or two apart: both ends see one and the same list of what either of them meets."""
    if not _ring(lines[n]):
        return list(joined.get((n, end), []))
    # One list for both ends (the first end's, then what only the last end meets): so both are judged alike.
    first = list(joined.get((n, 0), []))
    return first + [other for other in joined.get((n, 1), []) if other[0] not in {m for m, _, _ in first}]


def profiles(sampler, roads, shaped=lambda road: road['kind'] in SHAPED_KINDS):
    """For each road that gets shaped ground: heights and cross tilt at every metre along it.

    Returns ({road id: profile}, flagged stretches). A profile holds line, s, z, tilt, valid, half, shoulder,
    kind, centre (the LiDAR's own centre heights), fade (0 at a dead end or an abutment, rising to 1) and the node
    heights that were applied.
    """
    lines = [Line(r['pts']) if len(r['pts']) >= 2 else None for r in roads]
    lines = [line if line is not None and line.length >= 2.0 else None for line in lines]
    prof = {}
    for n in _by_place(lines):
        road, line = roads[n], lines[n]
        if line is None or road['bridge'] or not shaped(road):
            continue
        count = max(3, int(round(line.length)) + 1)
        s = np.linspace(0.0, line.length, count)
        ds = line.length / (count - 1)
        xy, left = line.at(s), line.left(s)
        half = road['halfWidth']
        u = np.linspace(-half, half, 5)
        h = sampler.at(xy[:, None, 0] + left[:, None, 0] * u[None], xy[:, None, 1] + left[:, None, 1] * u[None])
        valid = np.isfinite(h).all(axis=1)
        mean = np.where(valid, np.where(np.isfinite(h), h, 0).mean(axis=1), np.nan)
        tilt = np.where(valid, ((np.where(np.isfinite(h), h, 0) - np.nan_to_num(mean)[:, None]) * u[None]).sum(axis=1) / (u * u).sum(), np.nan)
        prof[n] = dict(index=n, id=road['id'], name=road['name'], kind=road['kind'], line=line, s=s, ds=ds, half=half,
                       shoulder=SHOULDER.get(road['kind'], 1.0), valid=valid,
                       centre=np.where(valid, h[:, 2], np.nan), z=gauss(mean, ALONG_SIGMA / ds, valid),
                       tilt=np.clip(np.nan_to_num(gauss(tilt, TILT_SIGMA / ds, valid)), -TILT_LIMIT, TILT_LIMIT))

    def surface(p, arc, side_dist=0.0):
        z = np.interp(arc, p['s'], np.nan_to_num(p['z'], nan=0.0))
        return float(z + np.interp(arc, p['s'], p['tilt']) * side_dist - CROWN * abs(side_dist))

    joined = joins(roads, lines)
    order = sorted(prof, key=lambda n: (-PAINT_ORDER.get(roads[n]['kind'], 0), roads[n]['id']))
    for n in order:
        prof[n]['open'] = [False, False]           # an end with nothing to meet: the shaping fades out there
        prof[n]['tees'] = [False, False]           # an end that runs out on the side of another shaped road

    def met(n, end):
        """The ends that this end meets, as (road, end). A ring (a line that ends where it starts) meets its own
        other end, and what meets one end of a ring meets both: so a ring takes one height where it closes."""
        found = [(n, 1 - end)] if _ring(lines[n]) else []
        for m, _, at_end in _seen(joined, lines, n, end):
            if at_end is not None:
                found += [(m, at_end), (m, 1 - at_end)] if _ring(lines[m]) else [(m, at_end)]
        return found

    # Ends that meet take one height: the mean of their own heights, read before any of them is changed.
    own_end = {n: (prof[n]['z'][0], prof[n]['z'][-1]) for n in order}
    for _ in (0, 1):
        for n in order:
            p, line = prof[n], prof[n]['line']
            target = [None, None]
            for end in (0, 1):
                others = _seen(joined, lines, n, end)
                here = p['z'][0 if end == 0 else -1]
                if not np.isfinite(here):
                    p['open'][end] = True
                    continue
                if any(roads[m]['bridge'] for m, _, _ in others) or not (any(m in prof for m, _, _ in others) or _ring(line)):
                    p['open'][end] = True          # an abutment, a dead end, or only an unshaped track
                    continue
                through = [(m, arc) for m, arc, at_end in others if at_end is None and m in prof]
                if through:
                    m, arc = min(through, key=lambda q: (-PAINT_ORDER.get(roads[q[0]]['kind'], 0), roads[q[0]]['id']))
                    x, y = line.p[0] if end == 0 else line.p[-1]
                    d, arc, side = prof[m]['line'].nearest(x, y)
                    target[end] = surface(prof[m], arc, d * side)
                    p['tees'][end] = True
                    continue
                heights = [own_end[n][end]]
                for m, at_end in met(n, end):
                    if m in prof and np.isfinite(own_end[m][at_end]):
                        heights.append(own_end[m][at_end])
                target[end] = float(np.mean(heights))
            k0, k1 = _end_weights(p['s'], line.length, NODE_TAPER)
            if target[0] is not None:
                p['z'] = p['z'] + (target[0] - p['z'][0]) * k0
            if target[1] is not None:
                p['z'] = p['z'] + (target[1] - p['z'][-1]) * k1
            p['nodes'] = target

    flagged = []
    for n in order:
        p = prof[n]
        # The limit is measured from the LiDAR's own height on the centre line, sample by sample.
        delta = p['z'] - p['centre']
        over = np.isfinite(delta) & (np.abs(delta) > LIMIT)
        if over.any():
            # Hold those places at the limit and ease the corners, but only near them: a held place far along the
            # road must not change the height line here.
            near = smoothstep(0.0, 0.05, np.nan_to_num(gauss(over.astype(np.float64), 3.0 / p['ds'])))
            eased = gauss(p['centre'] + np.clip(delta, -LIMIT, LIMIT), 2.0 / p['ds'], p['valid'])
            again = np.isfinite(eased) & (np.abs(eased - p['centre']) > LIMIT) & (near > 0)
            held = p['centre'] + np.clip(eased - p['centre'], -LIMIT, LIMIT)        # the limit holds after the easing too
            p['z'] = np.where(np.isfinite(held), p['z'] + (held - p['z']) * near, p['z'])
            over = over | again                                                    # ... and those stretches are listed as well
            i = 0
            while i < len(over):
                if over[i]:
                    j = i
                    while j < len(over) and over[j]:
                        j += 1
                    mid = p['line'].at([p['s'][(i + j) // 2]])[0]
                    flagged.append(dict(id=p['id'], name=p['name'], fromM=round(float(p['s'][i])), toM=round(float(p['s'][j - 1])),
                                        maxDelta=round(float(np.abs(delta[i:j]).max()), 2),
                                        east=round(float(mid[0]), 1), north=round(float(mid[1]), 1)))
                    i = j
                else:
                    i += 1
        fade = np.ones(len(p['s']))
        if p['open'][0]:
            fade *= smoothstep(0, END_FADE, p['s'])
        if p['open'][1]:
            fade *= smoothstep(0, END_FADE, p['line'].length - p['s'])
        p['fade'] = fade * p['valid']
        p['z'] = np.nan_to_num(p['z'], nan=0.0)
    return {p['id']: p for p in prof.values()}, flagged


# ---- shaping a block of ground --------------------------------------------------------------------

def _nearest_on_line(pts, cum, segments, x0, ytop, shape, reach):
    """Per cell of a north-up 1 m grid: distance to the nearest of the line's given segments (indexes into
    pts[k], pts[k + 1]), the distance along the line there, and the side.

    All the segments are answered together, so a road that leaves a block and comes back gets one answer per cell,
    the same answer as in a block that holds the road whole.
    Returns (row slice, column slice, d, s, side, zone) or None. zone 1/2: the nearest point is the line's own
    start/end (the cell lies beyond it); 0 otherwise.
    """
    height, width = shape
    segments = np.asarray(segments, dtype=np.int64)
    a_all, b_all = pts[segments], pts[segments + 1]
    c0 = max(0, int(math.floor(min(a_all[:, 0].min(), b_all[:, 0].min()) - reach - x0)))
    c1 = min(width, int(math.ceil(max(a_all[:, 0].max(), b_all[:, 0].max()) + reach - x0)) + 1)
    r0 = max(0, int(math.floor(ytop - max(a_all[:, 1].max(), b_all[:, 1].max()) - reach)))
    r1 = min(height, int(math.ceil(ytop - min(a_all[:, 1].min(), b_all[:, 1].min()) + reach)) + 1)
    if c1 <= c0 or r1 <= r0:
        return None
    d2 = np.full((r1 - r0, c1 - c0), np.inf)
    arc = np.zeros(d2.shape)
    side = np.ones(d2.shape, dtype=np.int8)
    zone = np.zeros(d2.shape, dtype=np.int8)
    last_segment = len(pts) - 2
    for k in segments.tolist():
        ax, ay = pts[k]
        bx, by = pts[k + 1]
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        if length2 < 1e-12:
            continue
        cc0 = max(c0, int(math.floor(min(ax, bx) - reach - x0)))
        cc1 = min(c1, int(math.ceil(max(ax, bx) + reach - x0)) + 1)
        rr0 = max(r0, int(math.floor(ytop - max(ay, by) - reach)))
        rr1 = min(r1, int(math.ceil(ytop - min(ay, by) + reach)) + 1)
        if cc1 <= cc0 or rr1 <= rr0:
            continue
        gx = (x0 + np.arange(cc0, cc1))[None, :] - ax
        gy = (ytop - np.arange(rr0, rr1))[:, None] - ay
        t = (gx * dx + gy * dy) / length2
        tc = np.clip(t, 0.0, 1.0)
        ex, ey = gx - tc * dx, gy - tc * dy
        dd = ex * ex + ey * ey
        view = (slice(rr0 - r0, rr1 - r0), slice(cc0 - c0, cc1 - c0))
        better = dd < d2[view]
        if not better.any():
            continue
        d2[view][better] = dd[better]
        arc[view][better] = (cum[k] + tc * math.sqrt(length2))[better]
        side[view][better] = np.where(dx * gy - dy * gx >= 0, 1, -1)[better].astype(np.int8)
        z = np.zeros(t.shape, dtype=np.int8)
        if k == 0:
            z[t < 0] = 1
        if k == last_segment:
            z[t > 1] = 2
        zone[view][better] = z[better]
    return slice(r0, r1), slice(c0, c1), np.sqrt(d2), arc, side, zone


def _bilinear(grid, x0, ytop, x, y):
    """Heights of a north-up 1 m grid at points; NaN outside it or on nodata."""
    fx, fy = np.asarray(x) - x0, ytop - np.asarray(y)
    height, width = grid.shape
    inside = (fx >= 0) & (fy >= 0) & (fx <= width - 1) & (fy <= height - 1)
    a = np.clip(np.floor(fx).astype(np.int64), 0, width - 2)
    b = np.clip(np.floor(fy).astype(np.int64), 0, height - 2)
    u, v = fx - a, fy - b
    q = np.stack([grid[b, a], grid[b, a + 1], grid[b + 1, a], grid[b + 1, a + 1]])
    out = (q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v
    return np.where(inside & (q != NODATA).all(axis=0), out, np.nan)


def brook_distance(streams, x0, ytop, shape, reach=BROOK_CLEAR[1] + 1):
    """Distance from each cell to the nearest brook line (inf past `reach`)."""
    out = np.full(shape, np.inf)
    x1, ybottom = x0 + shape[1], ytop - shape[0]
    for stream in streams or ():
        pts = np.asarray(stream['pts'], dtype=np.float64)
        if len(pts) < 2 or pts[:, 0].max() < x0 - reach or pts[:, 0].min() > x1 + reach or \
                pts[:, 1].max() < ybottom - reach or pts[:, 1].min() > ytop + reach:
            continue
        keep = np.flatnonzero((np.maximum(pts[:-1, 0], pts[1:, 0]) >= x0 - reach) & (np.minimum(pts[:-1, 0], pts[1:, 0]) <= x1 + reach) &
                              (np.maximum(pts[:-1, 1], pts[1:, 1]) >= ybottom - reach) & (np.minimum(pts[:-1, 1], pts[1:, 1]) <= ytop + reach))
        if not len(keep):
            continue
        got = _nearest_on_line(pts, np.zeros(len(pts)), keep, x0, ytop, shape, reach)
        if got is None:
            continue
        rows, cols, d, _, _, _ = got
        out[rows, cols] = np.minimum(out[rows, cols], np.where(d <= reach, d, np.inf))
    return out


def baked_brooks(path):
    """The brook lines that the shaping must respect. They come from a bake of the brooks (31_bake_streams.py), so
    an area needs one normal bake before its ground can be shaped; without them nothing is shaped at all."""
    import json
    import os
    if not os.path.exists(path):
        raise RuntimeError(f'MMM_ROAD_GROUND needs the baked brooks ({path}): bake the area once without the switch first')
    return json.load(open(path))['streams']


def shape_block(dtm, x0, ytop, profs, streams=None, keep=()):
    """Shape the ground of one block under its roads. `dtm` is a north-up 1 m grid whose cell [0, 0] is at
    (x0, ytop); NODATA cells (the sea) are never changed. Returns (new grid, statistics).

    Roads are shaped in order of importance. A road's fade starts from the ground that the earlier roads left, so
    that a side road runs out smoothly on the shoulder of the road it joins. If that ground were the finished one,
    a change could travel from road to road across a whole block, and two blocks would then disagree on their shared
    edge. So it is a first draft of it (`draft`): in the draft every road's fade starts from the bare ground plus
    the earlier roads' own surfaces only (`stamped`), which no fade has touched. A cell's result therefore depends
    on ground and roads within two reaches of it, well inside HALO, however many roads lie side by side.

    Every change is scaled by the cell's own keep weight (`kept`), on all three surfaces alike, so inside a keep box
    each cell stays the LiDAR's own and there is no step at the box's edge.

    Last, the limit is held on the grid itself: no cell on a centre line ends more than LIMIT from the LiDAR, and
    the statistics list the stretches of road where that held (`held`).
    """
    base = dtm.astype(np.float64)
    work, draft, stamped = base.copy(), base.copy(), base.copy()
    on_centre = np.zeros(dtm.shape, dtype=bool)          # cells on a centre line, with the road and the distance along
    centre_road = np.full(dtm.shape, -1, dtype=np.int64)
    centre_arc = np.zeros(dtm.shape, dtype=np.float32)
    sea = dtm == NODATA
    height, width = dtm.shape
    x1, ybottom = x0 + width - 1, ytop - (height - 1)
    brook = brook_distance(streams, x0, ytop, dtm.shape) if streams else None
    # A cell's own place decides how much of a change it takes: none inside a keep box, all of it KEEP_RAMP away.
    reach_all = max(SHOULDER.values()) + 4.0 + BLEND_MAX + KEEP_RAMP
    near_box = [b for b in keep or () if b[0] - reach_all <= x1 and b[2] + reach_all >= x0 and b[1] - reach_all <= ytop and b[3] + reach_all >= ybottom]
    let = kept(x0 + np.arange(width)[None, :], ytop - np.arange(height)[:, None], near_box) if near_box else None
    # Least important first. Among roads of one kind, a road that ends on the side of another comes before it,
    # so the through road keeps its crown across the junction.
    for p in sorted(profs.values(), key=lambda q: (PAINT_ORDER.get(q['kind'], 0), -sum(q['tees']), q['id'])):
        line = p['line']
        d0 = p['half'] + p['shoulder']
        reach = d0 + BLEND_MAX
        pts = line.p
        if pts[:, 0].max() < x0 - reach or pts[:, 0].min() > x1 + reach or pts[:, 1].max() < ybottom - reach or pts[:, 1].min() > ytop + reach:
            continue
        keep = np.flatnonzero((np.maximum(pts[:-1, 0], pts[1:, 0]) >= x0 - reach) & (np.minimum(pts[:-1, 0], pts[1:, 0]) <= x1 + reach) &
                              (np.maximum(pts[:-1, 1], pts[1:, 1]) >= ybottom - reach) & (np.minimum(pts[:-1, 1], pts[1:, 1]) <= ytop + reach))
        if not len(keep):
            continue
        got = _nearest_on_line(pts, line.cum, keep, x0, ytop, dtm.shape, reach)
        if got is None:
            continue
        rows, cols, d, arc, side, zone = got
        cell = (zone == 0) & (d <= reach) & ~sea[rows, cols]
        if not cell.any():
            continue
        # The road's height line at every metre along each unbroken run of kept segments. A run is handled by
        # itself: its neighbours in the list may be far away along the road.
        runs = []
        for run in np.split(keep, np.flatnonzero(np.diff(keep) > 1) + 1):
            lo, hi = max(0.0, line.cum[run[0]] - 2), min(line.length, line.cum[run[-1] + 1] + 2)
            arcs = np.arange(math.floor(lo), math.ceil(hi) + 1.0)
            arcs = arcs[(arcs >= 0) & (arcs <= line.length)]
            if len(arcs) < 2:
                arcs = np.array([lo, max(hi, lo + 0.01)])
            if runs and arcs[0] <= runs[-1]['arcs'][-1]:
                arcs = arcs[arcs > runs[-1]['arcs'][-1]]
                if not len(arcs):
                    continue
            runs.append(dict(arcs=arcs, centre=line.at(arcs), left=line.left(arcs), z=np.interp(arcs, p['s'], p['z']),
                             tilt=np.interp(arcs, p['s'], p['tilt']), fade=np.interp(arcs, p['s'], p['fade'])))
        if not runs:
            continue
        sa, z, tilt, fade = (np.concatenate([r[k] for r in runs]) for k in ('arcs', 'z', 'tilt', 'fade'))
        s_c, d_c, side_c = arc[cell], d[cell], side[cell].astype(np.float64)
        z_c, tilt_c, fade_c = np.interp(s_c, sa, z), np.interp(s_c, sa, tilt), np.interp(s_c, sa, fade)
        plane_c = z_c + tilt_c * side_c * d_c - CROWN * d_c
        inside = d_c <= d0
        beside_brook = None
        if brook is not None:
            beside_brook = np.where(d_c > p['half'], smoothstep(BROOK_CLEAR[0], BROOK_CLEAR[1], brook[rows, cols][cell]), 1.0)

        def mismatch(surface):
            """How far the road's shoulder edge lies from `surface`, per side, and the width to fade it out over."""
            delta, blend = {1: [], -1: []}, {1: [], -1: []}
            for r in runs:
                for sign in (1, -1):
                    edge = r['centre'] + r['left'] * (sign * d0)
                    now = _bilinear(surface, x0, ytop, edge[:, 0], edge[:, 1])
                    plane = r['z'] + r['tilt'] * sign * d0 - CROWN * d0
                    dz = np.nan_to_num(gauss(np.where(np.isfinite(now), plane - now, 0.0) * r['fade'], 1.5))
                    delta[sign].append(dz)
                    blend[sign].append(np.nan_to_num(gauss(np.clip(np.abs(dz) * 1.5 / BANK, BLEND, BLEND_MAX), 3.0), nan=BLEND))
            return ({sign: np.concatenate(v) for sign, v in delta.items()}, {sign: np.concatenate(v) for sign, v in blend.items()})

        def paint(surface, edges=None):
            """Lay the road on `surface`: its own surface out to the shoulder's edge and, with `edges`, the fade beyond."""
            current = surface[rows, cols][cell]
            change = np.where(inside, (plane_c - current) * fade_c, 0.0)
            if edges is not None:
                delta, blend = edges
                dz_c = np.where(side_c > 0, np.interp(s_c, sa, delta[1]), np.interp(s_c, sa, delta[-1]))
                width_c = np.where(side_c > 0, np.interp(s_c, sa, blend[1]), np.interp(s_c, sa, blend[-1]))
                change = np.where(inside, change, dz_c * (1 - smoothstep(0, 1, (d_c - d0) / np.maximum(width_c, 1e-6))))
            if beside_brook is not None:
                change = change * beside_brook
            if let is not None:
                change = change * let[rows, cols][cell]
            block = surface[rows, cols]
            block[cell] = current + change

        from_stamped, from_draft = mismatch(stamped), mismatch(draft)      # both read before this road is laid
        paint(draft, from_stamped)
        paint(work, from_draft)
        paint(stamped)
        middle = d_c <= 0.75
        for grid_, values in ((on_centre, True), (centre_road, p['id']), (centre_arc, s_c[middle])):
            view = grid_[rows, cols]
            picked = np.zeros(cell.shape, dtype=bool)
            picked[cell] = middle
            view[picked] = values
    held = on_centre & ~sea & (np.abs(work - base) > LIMIT)
    wanted = np.abs(work - base)[held]
    work[held] = base[held] + np.clip(work[held] - base[held], -LIMIT, LIMIT)
    stats = dict(cells=0, raised=0.0, lowered=0.0, maxChange=0.0, heldAtLimit=int(held.sum()),
                 held=_stretches(centre_road[held], centre_arc[held], wanted))
    changed = (~sea) & (np.abs(work - base) > 0.005)
    diff = (work - base)[changed]
    if len(diff):
        stats.update(cells=int(changed.sum()), raised=round(float(diff[diff > 0].sum()), 1),
                     lowered=round(float(-diff[diff < 0].sum()), 1), maxChange=round(float(np.abs(diff).max()), 2))
    out = work.astype(np.float32)
    out[sea] = NODATA
    return out, stats


def _stretches(road_ids, arcs, wanted, gap=3.0):
    """The cells that the grid held at the limit, as stretches of road: [{id, fromM, toM, maxDelta}]."""
    out = []
    for rid in np.unique(road_ids):
        pick = road_ids == rid
        order = np.argsort(arcs[pick])
        a, w = arcs[pick][order], wanted[pick][order]
        start = 0
        for i in range(1, len(a) + 1):
            if i == len(a) or a[i] - a[i - 1] > gap:
                out.append(dict(id=int(rid), fromM=round(float(a[start])), toM=round(float(a[i - 1])),
                                maxDelta=round(float(w[start:i].max()), 2)))
                start = i
    return out


# ---- samplers (GDAL) -----------------------------------------------------------------------------

def _grouped_bilinear(x, y, key_of, load):
    """Bilinear heights for points, read one block at a time. load(key) -> (grid, x0, ytop) or None."""
    x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    out = np.full(x.shape, np.nan)
    flat, fx, fy = out.reshape(-1), x.reshape(-1), y.reshape(-1)
    ki, kj = key_of(fx, fy)
    keys = ki * 1000003 + kj
    order = np.argsort(keys, kind='stable')
    for group in np.split(order, np.flatnonzero(np.diff(keys[order])) + 1):
        got = load(int(ki[group[0]]), int(kj[group[0]]))
        if got is None:
            continue
        grid, gx0, gytop = got
        flat[group] = _bilinear(grid, gx0, gytop, fx[group], fy[group])
    return out


class TileGround:
    """Heights from the level-8 tiles of a baked folder (true metres, as the game reads them before exaggeration)."""

    def __init__(self, baked, level=8):
        import json
        from osgeo import gdal
        gdal.UseExceptions()
        self.gdal, self.baked, self.level = gdal, baked, level
        m = json.load(open(f'{baked}/manifest.json'))
        self.x0, self.y1 = m['origin']
        self.size = m['size'] / 2 ** level
        if self.size != T:
            raise ValueError('TileGround reads 1 m tiles only')
        self.scale, self.offset = m['height']['scale'], m['height']['offset']
        self.names = set(m['levels'][str(level)])
        self.cache = {}

    def _load(self, i, j):
        if (i, j) not in self.cache:
            if f'{i}_{j}' not in self.names:
                self.cache[(i, j)] = None
            else:
                a = self.gdal.Open(f'{self.baked}/{self.level}/{i}_{j}.png').ReadAsArray()
                grid = (a[0].astype(np.float64) * 256 + a[1]) * self.scale + self.offset
                self.cache[(i, j)] = (grid, self.x0 + i * T, self.y1 - j * T)
        return self.cache[(i, j)]

    def at(self, x, y):
        def key(fx, fy):
            return np.floor((fx - self.x0) / T).astype(np.int64), np.floor((self.y1 - fy) / T).astype(np.int64)
        return _grouped_bilinear(x, y, key, self._load)


class DemSampler:
    """Heights from the 1 m source model, warped block by block onto the game's own 1 m nodes (whole metres)."""

    def __init__(self, path, block=1024, margin=2, keep=48):
        from osgeo import gdal
        gdal.UseExceptions()
        self.gdal, self.path, self.block, self.margin, self.keep = gdal, path, block, margin, keep
        self.cache = {}
        self.loads = 0

    def _load(self, i, j):
        if (i, j) in self.cache:
            self.cache[(i, j)] = self.cache.pop((i, j))          # most recently used last
        else:
            if len(self.cache) >= self.keep:
                self.cache.pop(next(iter(self.cache)))
            x0, y0 = i * self.block - self.margin, j * self.block - self.margin
            x1, y1 = (i + 1) * self.block + self.margin, (j + 1) * self.block + self.margin
            try:
                ds = self.gdal.Warp('', self.path, format='MEM', dstSRS='EPSG:2961', xRes=1, yRes=1,
                                    outputBounds=(x0 - .5, y0 - .5, x1 + .5, y1 + .5), resampleAlg='bilinear',
                                    dstNodata=NODATA, errorThreshold=0, warpMemoryLimit=128 * 1024 * 1024, multithread=False)
                a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
                a[~np.isfinite(a)] = NODATA
                self.cache[(i, j)] = (a, x0, y1)
            except RuntimeError:
                self.cache[(i, j)] = None
            self.loads += 1
        return self.cache[(i, j)]

    def at(self, x, y):
        def key(fx, fy):
            return np.floor(fx / self.block).astype(np.int64), np.floor(fy / self.block).astype(np.int64)
        return _grouped_bilinear(x, y, key, self._load)
