"""Drawing on the body.

A feature (a window, a lamp, a wheel opening) is a flat outline seen from one
direction. `cut_polygon` cuts that outline into the smooth body and returns the
faces inside it, so the feature becomes a real region with a clean edge instead
of a part laid on top. The body's shading normals come from the uncut surface
(`Master`), so a cut never leaves a mark in the paint.

All of it is plain bmesh and arithmetic: no view, no operators, the same result
on every run.
"""
import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc


class Frame:
    """A drawing board: origin, the two drawing axes, and the direction the viewer looks (w)."""

    def __init__(self, origin, u, v, w):
        self.o = Vector(origin)
        self.u = Vector(u).normalized()
        self.v = Vector(v).normalized()
        self.w = Vector(w).normalized()

    def to2d(self, p):
        d = p - self.o
        return (d.dot(self.u), d.dot(self.v))

    def to3d(self, q, depth=0.0):
        return self.o + self.u * q[0] + self.v * q[1] + self.w * depth

    def depth(self, p):
        return (p - self.o).dot(self.w)


RIGHT = Frame((0, 0, 0), (0, 0, 1), (0, 1, 0), (-1, 0, 0))     # drawn as (z, y)
FRONT = Frame((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1))      # drawn as (x, y), viewer ahead of the car
REAR = Frame((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, -1))      # drawn as (x, y), viewer behind
TOP = Frame((0, 0, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))       # drawn as (x, z)


def corner_frame(degrees, rear=False):
    """A board facing the right-hand front (or rear) corner. 0 is straight ahead (or behind), 90 is side on."""
    a = math.radians(degrees)
    end = -1 if rear else 1
    return Frame((0, 0, 0), (math.cos(a), 0, end * math.sin(a)), (0, 1, 0), (-math.sin(a), 0, end * math.cos(a)))


def tilted_frame(origin, slope_degrees, rear=False):
    """A board lying on a raked screen. Drawn as (x, distance up the glass from `origin`)."""
    a = math.radians(slope_degrees)
    end = -1 if rear else 1
    return Frame(origin, (1, 0, 0), (0, math.sin(a), end * math.cos(a)), (0, -math.cos(a), end * math.sin(a)))


# ---------------------------------------------------------------- flat geometry

def point_in_polygon(q, poly):
    x, y = q
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _segments_touch(a, b, c, d):
    def side(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1, d2, d3, d4 = side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def spline(points, samples=6, closed=True):
    """A smooth curve through the points (Catmull-Rom), as a list of 2D points."""
    pts = [tuple(p) for p in points]
    n = len(pts)
    out = []
    spans = n if closed else n - 1
    for i in range(spans):
        p0 = pts[(i - 1) % n] if closed or i > 0 else pts[0]
        p1, p2 = pts[i], pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if closed or i + 2 < n else pts[n - 1]
        for s in range(samples):
            t = s / samples
            out.append(tuple(.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
                                   + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in (0, 1)))
    if not closed:
        out.append(pts[-1])
    return out


def rounded(points, radius, steps=4):
    """A polygon with its corners rounded. `radius` is one number or one per corner (0 keeps a corner sharp)."""
    n = len(points)
    radii = [radius] * n if isinstance(radius, (int, float)) else list(radius)
    out = []
    for i in range(n):
        p = Vector(points[i]).to_2d() if len(points[i]) > 2 else Vector(points[i])
        a = Vector(points[i - 1]) - p
        b = Vector(points[(i + 1) % n]) - p
        r = radii[i]
        if r <= 0:
            out.append(tuple(p))
            continue
        la, lb = a.length, b.length
        half = a.normalized().angle(b.normalized()) / 2
        reach = min(r / math.tan(half), la * .49, lb * .49)
        start, end = p + a.normalized() * reach, p + b.normalized() * reach
        for s in range(steps + 1):
            t = s / steps
            q = start.lerp(p, t).lerp(p.lerp(end, t), t)     # quadratic blend: close to a circular arc
            out.append(tuple(q))
    return out


def offset_path(path, distance, closed=False):
    """The path moved sideways (to its left) by `distance`."""
    n = len(path)
    out = []
    for i in range(n):
        a = Vector(path[i - 1]) if (closed or i > 0) else Vector(path[i])
        b = Vector(path[(i + 1) % n]) if (closed or i < n - 1) else Vector(path[i])
        t = b - a
        if t.length < 1e-9:
            out.append(tuple(path[i]))
            continue
        t.normalize()
        out.append((path[i][0] - t.y * distance, path[i][1] + t.x * distance))
    return out


def circle(centre, radius, steps=32, start=0.0, sweep=math.tau):
    count = steps if abs(sweep - math.tau) < 1e-9 else steps + 1
    return [(centre[0] + radius * math.cos(start + sweep * i / steps), centre[1] + radius * math.sin(start + sweep * i / steps))
            for i in range(count)]


# ---------------------------------------------------------------- cutting

def _flat(face, frame):
    return [frame.to2d(v.co) for v in face.verts]


def _crosses(poly2, a, b):
    xs = [p[0] for p in poly2]
    ys = [p[1] for p in poly2]
    if max(a[0], b[0]) < min(xs) or min(a[0], b[0]) > max(xs) or max(a[1], b[1]) < min(ys) or min(a[1], b[1]) > max(ys):
        return False
    j = len(poly2) - 1
    for i in range(len(poly2)):
        if _segments_touch(a, b, poly2[j], poly2[i]):
            return True
        j = i
    return point_in_polygon(a, poly2)


def _inside(face, frame, poly):
    verts = [frame.to2d(v.co) for v in face.verts]
    if len(verts) <= 4:
        return point_in_polygon((sum(p[0] for p in verts) / len(verts), sum(p[1] for p in verts) / len(verts)), poly)
    # A cut face can be a long odd shape: ask each fan triangle and let the larger area win.
    score = 0.0
    a = verts[0]
    for b, c in zip(verts[1:], verts[2:]):
        area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        centre = ((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)
        score += area if point_in_polygon(centre, poly) else -area
    return score > 0


def cut_polygon(bm, poly, frame, faces=None, facing=.05, where=None):
    """Cuts the closed outline `poly` (drawn on `frame`) into the faces that look at the viewer.

    Returns the faces inside the outline. `where(face)` can narrow which faces may be cut.
    """
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    lo, hi = (min(xs), min(ys)), (max(xs), max(ys))
    live = set()
    for f in (faces if faces is not None else bm.faces):
        if f.normal.dot(frame.w) > -facing or (where and not where(f)):
            continue
        flat = _flat(f, frame)
        if max(p[0] for p in flat) < lo[0] or min(p[0] for p in flat) > hi[0] or max(p[1] for p in flat) < lo[1] or min(p[1] for p in flat) > hi[1]:
            continue
        live.add(f)
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 1e-12:
            continue
        hit = [f for f in live if _crosses(_flat(f, frame), a, b)]
        if not hit:
            continue
        geom = set(hit)
        for f in hit:
            geom.update(f.edges)
            geom.update(f.verts)
        normal = frame.u * -(b[1] - a[1]) + frame.v * (b[0] - a[0])
        result = bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-6, plane_co=frame.to3d(a), plane_no=normal,
                                        clear_inner=False, clear_outer=False)
        live.difference_update(hit)
        live.update(g for g in result['geom'] if isinstance(g, bmesh.types.BMFace))
    return [f for f in live if f.is_valid and _inside(f, frame, poly)]


def cut_plane(bm, faces, point, normal):
    """Cuts `faces` with a plane. Returns (faces on the normal's side, faces on the other side)."""
    faces = [f for f in faces if f.is_valid]
    geom = set(faces)
    for f in faces:
        geom.update(f.edges)
        geom.update(f.verts)
    point, normal = Vector(point), Vector(normal).normalized()
    result = bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-6, plane_co=point, plane_no=normal,
                                    clear_inner=False, clear_outer=False)
    out = [g for g in result['geom'] if isinstance(g, bmesh.types.BMFace)]
    above = [f for f in out if (f.calc_center_median() - point).dot(normal) > 0]
    below = [f for f in out if (f.calc_center_median() - point).dot(normal) <= 0]
    return above, below


def mirror_x(bm):
    """Completes a right-hand half into the whole symmetric body, welded on the centre line."""
    copy = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])['geom']
    for g in copy:
        if isinstance(g, bmesh.types.BMVert):
            g.co.x = -g.co.x
    bmesh.ops.reverse_faces(bm, faces=[g for g in copy if isinstance(g, bmesh.types.BMFace)])
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if abs(v.co.x) < 2e-5], dist=4e-5)
    bm.normal_update()


def boundary_chain(faces):
    """The outer edge of a face region as ordered vertex loops."""
    region = set(faces)
    edges = [e for f in region for e in f.edges if sum(1 for g in e.link_faces if g in region) == 1]
    edges = list(dict.fromkeys(edges))
    links = {}
    for e in edges:
        a, b = e.verts
        links.setdefault(a, []).append(b)
        links.setdefault(b, []).append(a)
    loops, seen = [], set()
    for start in links:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [v for v in links[cur] if v is not prev and v not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    return loops


# ---------------------------------------------------------------- the uncut surface

class Master:
    """The smooth body before any cut: answers "where is the skin here, and which way does it face?"."""

    def __init__(self, bm):
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        bm.verts.ensure_lookup_table()
        self.co = [v.co.copy() for v in bm.verts]
        self.no = [v.normal.copy() for v in bm.verts]
        self.tris = [tuple(v.index for v in f.verts) for f in bm.faces]
        self.tree = BVHTree.FromPolygons(self.co, self.tris)

    def _blend(self, index, location):
        i, j, k = self.tris[index]
        wa, wb, wc = poly_3d_calc([self.co[i], self.co[j], self.co[k]], location)
        n = self.no[i] * wa + self.no[j] * wb + self.no[k] * wc
        return n.normalized()

    def normal(self, p):
        location, _, index, _ = self.tree.find_nearest(p)
        return self._blend(index, location)

    def snap(self, p):
        """The nearest point of the skin and its normal."""
        location, _, index, _ = self.tree.find_nearest(p)
        return location, self._blend(index, location)

    def drop(self, frame, q, start=-6.0):
        """Where a point drawn on `frame` lands on the skin: (position, normal), or None."""
        location, _, index, _ = self.tree.ray_cast(frame.to3d(q, start), frame.w)
        if location is None:
            return None
        return location, self._blend(index, location)
