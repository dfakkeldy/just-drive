"""The mail car's body form: one closed control cage, read off the owner's car by eye.

The cage is a box: stations run front to rear, eight rows run up each side, and
K columns run from the centre line to each side across the bonnet, roof, floor
and both ends. Catmull-Clark subdivision turns it into the smooth body. Nothing
here knows about glass, lamps or doors: those are drawn on the finished surface
(see car_cut.py), the way a studio tapes lines on a clay model.

Everything is modelled in game axes: +X right, +Y up, -Z forward, metres. The
exporter turns it to Blender's Z-up at the very end. The car is symmetric here.
"""
import math

import bmesh
import bpy
from mathutils import Vector

K = 4                               # columns from the centre line to the side
G = [0.0, 0.28, 0.56, 0.82, 1.0]    # where those columns sit across the half width
ROWS = 8
# Row meaning, bottom to top:
# 0 floor edge, 1 sill, 2 lower door crease, 3 mid door, 4 shoulder line,
# 5 waist (glass base), 6 half way up the glass, 7 top edge (bonnet edge, pillar, roof rail)

AXLES = (-1.31, 1.31)
WHEEL_Y = 0.35


def _st(z, y, x, yc, dzc=0.0, bulge=None, crown=None):
    """One station. z may be one number or eight (the two ends lean)."""
    zs = [z] * ROWS if isinstance(z, (int, float)) else list(z)
    return {'z': zs, 'y': list(y), 'x': list(x), 'yc': yc, 'dzc': dzc, 'bulge': bulge, 'crown': crown}


LOW_Y = [.275, .31, .47, .74]       # floor edge, sill, lower crease, mid door (cabin stations)
LOW_X = [.80, .876, .893, .905]

STATIONS = [
    # Front ring: where the face meets the wings. The face itself bows forward by `bulge`.
    _st([-1.96, -1.99, -2.0, -2.0, -1.985, -1.975, -1.965, -1.955],
        [.30, .36, .50, .68, .85, .92, .96, .985],
        [.68, .76, .79, .795, .785, .77, .745, .70], None,
        bulge=[.20, .295, .325, .305, .27, .255, .235, .17],
        crown=[0, 0, 0, 0, .01, .02, .025, .025]),
    _st(-1.84, [.285, .33, .49, .70, .90, .962, .99, 1.0],
        [.77, .85, .872, .88, .878, .86, .825, .765], 1.048, dzc=-.04),
    _st(-1.66, [.28, .32, .48, .72, .945, .995, 1.016, 1.024],
        [.79, .87, .89, .90, .905, .888, .85, .79], 1.068, dzc=-.04),
    _st(-1.31, LOW_Y + [.985, 1.025, 1.042, 1.048],
        LOW_X + [.918, .90, .86, .80], 1.108, dzc=-.04),
    # Cowl: the bonnet ends, the windscreen and front pillar begin. Kept low, so the driver sees bonnet over it.
    _st(-1.0, LOW_Y + [1.00, 1.078, 1.086, 1.09],
        LOW_X + [.924, .905, .87, .815], 1.118, dzc=-.20),
    # Header: top of the windscreen.
    _st(-.40, LOW_Y + [1.00, 1.10, 1.36, 1.595],
        LOW_X + [.925, .906, .825, .705], 1.66, dzc=-.07),
    _st(-.22, LOW_Y + [1.00, 1.105, 1.365, 1.612],
        LOW_X + [.925, .906, .826, .71], 1.682, dzc=-.03),
    _st(.12, LOW_Y + [1.005, 1.115, 1.37, 1.62],
        LOW_X + [.926, .907, .828, .712], 1.688),
    _st(1.0, LOW_Y + [1.01, 1.165, 1.39, 1.608],
        LOW_X + [.926, .905, .822, .705], 1.675),
    _st(1.31, LOW_Y + [1.015, 1.185, 1.395, 1.596],
        LOW_X + [.925, .90, .815, .70], 1.662),
    _st(1.72, [.29, .33, .49, .74, 1.01, 1.205, 1.40, 1.578],
        [.78, .86, .885, .898, .908, .88, .79, .68], 1.638),
    # Rear corner: the pillar leans forward with the glass.
    _st([1.97, 2.02, 2.04, 2.03, 2.02, 1.99, 1.92, 1.83],
        [.30, .35, .52, .74, .99, 1.19, 1.39, 1.562],
        [.76, .84, .865, .88, .885, .855, .765, .655], 1.618, dzc=.04),
    # Rear ring: where the tailgate meets the sides.
    _st([2.15, 2.22, 2.245, 2.24, 2.225, 2.19, 2.10, 2.01],
        [.31, .37, .53, .74, .98, 1.17, 1.38, 1.555],
        [.70, .78, .81, .815, .815, .785, .70, .60], None,
        bulge=[.04, .07, .066, .058, .05, .055, .055, .06],
        crown=[0, 0, 0, 0, .01, .015, .02, .04]),
]
N = len(STATIONS) - 1
PLAN_POWER = 2.2                    # how square the nose and tail are seen from above

for _end, _sign in ((0, -1), (N, 1)):
    _s = STATIONS[_end]
    _s['yc'] = _s['y'][7] + _s['crown'][7]
    _s['dzc'] = _sign * _s['bulge'][7]


def _side(i, r, sign):
    s = STATIONS[i]
    return Vector((sign * s['x'][r], s['y'][r], s['z'][r]))


def _top(i, k):
    s = STATIONS[i]
    g = G[abs(k)]
    return Vector((math.copysign(s['x'][7] * g, k) if k else 0.0,
                   s['y'][7] + (s['yc'] - s['y'][7]) * (1 - g ** 2.2),
                   s['z'][7] + s['dzc'] * (1 - g * g)))


def _bottom(i, k):
    s = STATIONS[i]
    g = G[abs(k)]
    dz = 0.0
    if s['bulge']:
        dz = (-1 if i == 0 else 1) * s['bulge'][0] * (1 - g ** PLAN_POWER)
    return Vector((math.copysign(s['x'][0] * g, k) if k else 0.0, s['y'][0], s['z'][0] + dz))


def _cap(i, k, r):
    s = STATIONS[i]
    g = G[abs(k)]
    return Vector((math.copysign(s['x'][r] * g, k) if k else 0.0,
                   s['y'][r] + s['crown'][r] * (1 - g * g),
                   s['z'][r] + (-1 if i == 0 else 1) * s['bulge'][r] * (1 - g ** PLAN_POWER)))


def build_cage():
    """Returns (bmesh, crease layer). The caller frees the bmesh."""
    bm = bmesh.new()
    ring = 4 * K + 2 * (ROWS - 1)
    tube = {}
    for i in range(N + 1):
        for j in range(ring):
            if j <= K:
                p = _bottom(i, j)
            elif j <= K + ROWS - 1:
                p = _side(i, j - K, 1)
            elif j <= 3 * K + ROWS - 1:
                p = _top(i, 2 * K + ROWS - 1 - j)
            elif j <= 3 * K + 2 * (ROWS - 1):
                p = _side(i, 3 * K + 2 * (ROWS - 1) - j, -1)
            else:
                p = _bottom(i, j - ring)
            tube[i, j] = bm.verts.new(p)
    for i in range(N):
        for j in range(ring):
            bm.faces.new((tube[i, j], tube[i, (j + 1) % ring], tube[i + 1, (j + 1) % ring], tube[i + 1, j]))

    def ring_vertex(i, k, r):
        if r == 0:
            return tube[i, k % ring]
        if r == ROWS - 1:
            return tube[i, 2 * K + ROWS - 1 - k]
        if k == K:
            return tube[i, K + r]
        if k == -K:
            return tube[i, 3 * K + 2 * (ROWS - 1) - r]
        return None

    for i in (0, N):
        grid = {}
        for k in range(-K, K + 1):
            for r in range(ROWS):
                v = ring_vertex(i, k, r)
                if v is None:
                    p = _cap(i, k, r)
                    v = bm.verts.new(p)
                grid[k, r] = v
        for k in range(-K, K):
            for r in range(ROWS - 1):
                bm.faces.new((grid[k, r], grid[k + 1, r], grid[k + 1, r + 1], grid[k, r + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    crease = bm.edges.layers.float.new('crease_edge')

    def mark(a, b, value):
        edge = bm.edges.get((a, b))
        if edge is not None:
            edge[crease] = max(edge[crease], value)

    top_j = range(K + ROWS - 1, 3 * K + ROWS - 1)
    for j in top_j:                      # cowl: the bonnet breaks into the windscreen
        mark(tube[4, j], tube[4, j + 1], .75)
        mark(tube[5, j], tube[5, j + 1], .35)       # header
    for i in range(0, 4):                # two soft lines down the bonnet
        for j in (2 * K + ROWS - 1 - 2, 2 * K + ROWS - 1 + 2):
            mark(tube[i, j], tube[i + 1, j], .3)
    for i in range(N):
        for row, value in ((0, .6), (4, .8)):    # floor edge, and a crisp shoulder line
            for j in (K + row, 3 * K + 2 * (ROWS - 1) - row):
                mark(tube[i, j], tube[i + 1, j], value)
    for i in range(0, 4):                # bonnet edge on the wing tops
        for j in (K + ROWS - 1, 3 * K + ROWS - 1):
            mark(tube[i, j], tube[i + 1, j], .25)
    for j in top_j:                      # roof ends in a small lip over the rear glass
        mark(tube[N, j], tube[N, j + 1], .7)
    return bm, crease


def subdivide(levels, name='form'):
    """The smooth body at `levels` of subdivision, as a new mesh datablock (quads)."""
    bm, _ = build_cage()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mod = obj.modifiers.new('subdivision', 'SUBSURF')
    mod.subdivision_type = 'CATMULL_CLARK'
    mod.levels = mod.render_levels = levels
    mod.use_limit_surface = True
    mod.quality = 4
    result = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)
    result.name = name
    return result


ARCH_OPEN, ARCH_LIP, FLARE_ROOT = .402, .447, .535     # wheel opening, outer edge of its black lip, where the flare starts


def arch_flare(p):
    """Outward swell round each wheel opening, metres. p is in game axes.

    The black lip stands proud by a constant amount; the paint ramps up to it in a straight line from the flare's
    root, which leaves a crisp edge at the root and another where the lip begins.
    """
    best = 0.0
    for axle in AXLES:
        r = math.hypot(p.z - axle, p.y - WHEEL_Y)
        if r <= ARCH_LIP + 1e-4:            # a vertex cut on the lip ring belongs to the lip
            best = max(best, .024)
        elif r < FLARE_ROOT:
            best = max(best, .024 * (FLARE_ROOT - r) / (FLARE_ROOT - ARCH_LIP))
    return best * min(1.0, max(0.0, (abs(p.x) - .55) / .2))
