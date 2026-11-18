"""Deterministic Highland bull. No photos, no textures, no downloaded assets: every number is in this file.

  Blender -b --factory-startup -P tools/blender/highland.py -- [output folder]

Writes highland-bull.glb (desktop) and highland-bull-low.glb, by default into web/public/models. Units are metres.
Game animal axes (web/src/animals.ts): +X right, +Y up, forward is -Z. The origin is on the ground between the hooves.
After an intended change, pin the new result: node tools/highland-model-check.mjs --update-snapshot

The coat is geometry, not a texture: a dark under-body, then a few hundred overlapping strands (ridged ribbons with
forked ends) that grow from scattered roots, follow the body, and then hang with gravity. Their roots are dark and
their ridges light, sky occlusion is baked into the vertex colours, and they are shaded with the body's normals.
So the coat is lit as one soft mass and still shows its strands in flat light. See highland-README.md.
"""
import bpy, json, math, random, sys
from pathlib import Path
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb_quantize import quantize

X, UP, DOWN, BACK = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))


def srgb(value):
    """0xRRGGBB as a linear colour: glTF vertex colours are linear."""
    def linear(c):
        c /= 255
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return Vector((linear(value >> 16 & 255), linear(value >> 8 & 255), linear(value & 255)))


# Colours follow reference photos of the real animal in flat grey light. The photos are private and not in git.
# The game's sun and tone mapping show a surface darker than its number, so these are lighter than the look they give.
RUST, RUST_LIGHT, RUST_DARK = srgb(0x914d2b), srgb(0xa9643c), srgb(0x69321b)   # body; bleached tips; wet lower coat
UNDER = srgb(0x432112)                                                         # skin tone seen between strands
FACE, MOP = srgb(0x2e1d17), srgb(0x41231a)                                     # brown-black face; forelock a little redder
LEG, HOOF = srgb(0x573222), srgb(0x36302a)
MUZZLE, NOSTRIL = srgb(0xb48d7d), srgb(0x241714)                               # pinkish tan
HORN_BASE, HORN, HORN_GREY, HORN_TIP = srgb(0xc2af98), srgb(0xe0d3b5), srgb(0x8f8779), srgb(0x33302d)
MUZZLE_HAIR = srgb(0x54372c)
EYE, IRIS = srgb(0x100b09), srgb(0x8a5524)

# The contract numbers (tools/blender/highland-contract.json repeats them; tools/highland-model-check.mjs tests them).
WITHERS = 1.12                               # Rig.shoulder in animals.ts
LEG_PIVOT_Y = round(.63 * WITHERS, 4)        # animals.ts groundRig: leg pivot .63 * shoulder; hoof straight below it
HEAD_PIVOT = Vector((0, 1.06, -.68))         # atlas joint: the head turns here
TAIL_PIVOT = Vector((0, 1.0, .845))
LEGS = {'fl': Vector((-.17, LEG_PIVOT_Y, -.48)), 'fr': Vector((.17, LEG_PIVOT_Y, -.48)),
        'rl': Vector((-.18, LEG_PIVOT_Y, .585)), 'rr': Vector((.18, LEG_PIVOT_Y, .585))}
# Head axis: from the middle of the skull's back (S0) to the middle of the muzzle (S1); U is "out of the forehead".
S0, S1 = Vector((0, 1.08, -.70)), Vector((0, .74, -.99))
HEAD_LENGTH = (S1 - S0).length
AXIS = (S1 - S0).normalized()
U = Vector((0, -AXIS.z, AXIS.y))


def sgnpow(value, power):
    return math.copysign(abs(value) ** power, value)


def spline(keys, x):
    """Cubic Hermite through rows (x, a, b, ...) with Catmull-Rom tangents; x need not be evenly spaced."""
    xs = [k[0] for k in keys]
    x = min(max(x, xs[0]), xs[-1])
    i = max(j for j in range(len(xs) - 1) if xs[j] <= x)
    h = xs[i + 1] - xs[i]
    t = (x - xs[i]) / h
    out = []
    for c in range(1, len(keys[0])):
        p0, p1 = keys[i][c], keys[i + 1][c]
        m0 = (p1 - keys[i - 1][c]) / (xs[i + 1] - xs[i - 1]) if i else (p1 - p0) / h
        m1 = (keys[i + 2][c] - p0) / (xs[i + 2] - xs[i]) if i + 2 < len(keys) else (p1 - p0) / h
        out.append((2 * t ** 3 - 3 * t * t + 1) * p0 + (t ** 3 - 2 * t * t + t) * h * m0 + (3 * t * t - 2 * t ** 3) * p1 + (t ** 3 - t * t) * h * m1)
    return out


def facing(verts, face, outward):
    """Return the face wound so that its normal agrees with the given outward direction."""
    a, b, c = verts[face[0]], verts[face[1]], verts[face[2]]
    normal = (c - a).cross(verts[face[3]] - b) if len(face) == 4 else (b - a).cross(c - a)
    return face if normal.dot(outward) >= 0 else tuple(reversed(face))


class Part:
    """One exported mesh: vertices, linear colours and faces in bind-pose game coordinates."""
    def __init__(self, name, pivot):
        self.name, self.pivot = name, Vector(pivot)
        self.v, self.c, self.f, self.skin = [], [], [], []
        self.shade = {}     # vertex index -> shading normal, where it is not the surface's own

    def loft(self, rings, colours, cap0=None, cap1=None, skin=True):
        """Join rings of equal count. A cap is (point, colour[, outward])."""
        n, base = len(rings[0]), len(self.v)
        for ring, cols in zip(rings, colours):
            self.v += [p.copy() for p in ring]; self.c += [c.copy() for c in cols]
        centres = [sum(ring, Vector()) / n for ring in rings]
        faces = []
        for i in range(len(rings) - 1):
            mid = (centres[i] + centres[i + 1]) / 2
            for k in range(n):
                a, b = base + i * n + k, base + i * n + (k + 1) % n
                face = (a, b, b + n, a + n)
                faces.append(facing(self.v, face, sum((self.v[j] for j in face), Vector()) / 4 - mid))
        for cap, i in ((cap0, 0), (cap1, len(rings) - 1)):
            if cap is None: continue
            index = len(self.v)
            self.v.append(cap[0].copy()); self.c.append(cap[1].copy())
            outward = cap[2] if len(cap) > 2 else cap[0] - centres[i]
            for k in range(n):
                faces.append(facing(self.v, (base + i * n + k, base + i * n + (k + 1) % n, index), outward))
        self.f += faces
        if skin: self.skin += faces

    def blob(self, centre, a, b, c, colours):
        """An octahedron with half-axes a, b, c. colours: +a, -a, +b, -b, +c, -c."""
        base = len(self.v)
        self.v += [centre + a, centre - a, centre + b, centre - b, centre + c, centre - c]; self.c += [x.copy() for x in colours]
        for i in (0, 1):
            for j in (2, 3):
                for k in (4, 5):
                    face = (base + i, base + j, base + k)
                    self.f.append(facing(self.v, face, sum((self.v[x] for x in face), Vector()) / 3 - centre))

    def normals(self):
        """Area-weighted vertex normals, as Blender shades smooth faces."""
        out = [Vector() for _ in self.v]
        for face in self.f:
            a, b, c = self.v[face[0]], self.v[face[1]], self.v[face[2]]
            n = (c - a).cross(self.v[face[3]] - b) if len(face) == 4 else (b - a).cross(c - a)
            for i in face: out[i] += n
        return [n.normalized() if n.length > 1e-12 else UP.copy() for n in out]

    def triangles(self):
        return sum(len(face) - 2 for face in self.f)


def strand_mesh(part, rings, width, thick, closed, tint, root, tip, rng):
    """One strand from spine rings [(point, outward, along)]: an off-centre ridge, two tucked edges, a forked end.

    The last ring is where the strand ends. Its two points have different lengths, so the outline reads as
    hair that has clumped, not as a leaf. One edge is darker than the other: each strand has a shadow side.
    Its shading normals follow the body under it, not its own facets: the coat is lit as one soft mass,
    and the strands show through colour, occlusion and outline.
    """
    count = len(rings) - 1
    profile = [.86, 1.0, .9, .8]
    ridge_at = rng.uniform(-.45, .45)
    dark, lit = (.74, .94) if rng.random() < .5 else (.94, .74)
    base = len(part.v)
    for k in range(count):
        p, n, d = rings[k]
        across = d.cross(n).normalized()
        s = k / count
        w, h = width * profile[k] / 2, thick * profile[k]
        shade = root + (1 - root) * min(1, s * 2.2)
        shade = shade + (tip - 1) * max(0, s - .35) / .65
        part.v += [p - across * w - n * h * .35, p + across * (w * ridge_at) + n * h, p + across * w - n * h * .35]
        part.c += [tint * shade * dark, tint * shade, tint * shade * lit]
        for i, tilt in enumerate((-.4, 0, .4)): part.shade[len(part.v) - 3 + i] = (n + across * tilt).normalized()
    p, n, d = rings[-1]
    across = d.cross(n).normalized()
    reach = (p - rings[-2][0])
    w = width * profile[count - 1] / 2
    long_left = rng.random() < .5
    short = reach * -rng.uniform(.3, .6)
    part.v += [p - across * (w * rng.uniform(.3, .75)) + (Vector() if long_left else short),
               p + across * (w * rng.uniform(.3, .75)) + (short if long_left else Vector())]
    part.c += [tint * tip * (.8 + .2 * dark), tint * tip * (.8 + .2 * lit)]
    part.shade[len(part.v) - 2], part.shade[len(part.v) - 1] = (n - across * .3).normalized(), (n + across * .3).normalized()
    tip_left, tip_right = base + count * 3, base + count * 3 + 1
    for k in range(count):
        n = rings[k][1]
        left, ridge, right = base + k * 3, base + k * 3 + 1, base + k * 3 + 2
        if k < count - 1:
            part.f += [facing(part.v, (left, ridge, ridge + 3, left + 3), n), facing(part.v, (ridge, right, right + 3, ridge + 3), n)]
            if closed: part.f.append(facing(part.v, (right, left, left + 3, right + 3), -n))
        else:
            part.f += [facing(part.v, (left, ridge, tip_left), n), facing(part.v, (ridge, right, tip_right), n)]
            if closed: part.f.append(facing(part.v, (right, left, tip_left, tip_right), -n))


def grow(bvh, rng, p, n, d, length, steps, lift0, lift1, hang0, hang1, wiggle=0., curl=0., cling=None, embed=.012):
    """Walk a strand's spine: first along the body in direction d, then more and more with gravity, kept outside the skin.

    cling: the most a wet strand may stand off the skin beyond its lift; None lets it hang free.
    """
    rings = [(p - n * embed, n.copy(), d.copy())]
    q, phase, step = p + n * lift0 * .3, rng.uniform(0, math.tau), length / steps
    for k in range(1, steps + 1):
        s = k / steps
        hang = hang0 + (hang1 - hang0) * s
        across = d.cross(n)
        d = d * (1 - hang) + DOWN * hang + across * wiggle * math.sin(phase + k * 2.1)
        if k == steps: d = d + n * curl
        d.normalize()
        q = q + d * step
        near = bvh.find_nearest(q, .5)
        if near[0] is not None:
            loc, normal, _, _ = near
            want = lift0 + (lift1 - lift0) * s
            if (q - loc).dot(normal) < want: q = loc + normal * want
            elif cling is not None and (q - loc).length > want + cling: q = loc + (q - loc).normalized() * (want + cling)
            if (q - loc).length < .07: n = (n + normal).normalized()
        n = (n - d * n.dot(d))
        n = n.normalized() if n.length > 1e-6 else rings[-1][1]
        rings.append((q.copy(), n.copy(), d.copy()))
    return rings


def scatter(part, faces, rng, radius, tries):
    """Blue-noise roots on the given faces: area-weighted darts, rejected when closer than the local radius."""
    normals = part.normals()
    tris = []
    for face in faces:
        tris.append((face[0], face[1], face[2]))
        if len(face) == 4: tris.append((face[0], face[2], face[3]))
    areas = [((part.v[b] - part.v[a]).cross(part.v[c] - part.v[a])).length / 2 for a, b, c in tris]
    total, running, cumulative = sum(areas), 0, []
    for area in areas: running += area; cumulative.append(running)
    grid, roots, cell = {}, [], .12
    for _ in range(tries):
        target, lo, hi = rng.random() * total, 0, len(tris) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cumulative[mid] < target: lo = mid + 1
            else: hi = mid
        a, b, c = tris[lo]
        u, v = rng.random(), rng.random()
        if u + v > 1: u, v = 1 - u, 1 - v
        p = part.v[a] * (1 - u - v) + part.v[b] * u + part.v[c] * v
        n = (normals[a] * (1 - u - v) + normals[b] * u + normals[c] * v).normalized()
        r = radius(p, n)
        if r is None: continue
        key = (math.floor(p.x / cell), math.floor(p.y / cell), math.floor(p.z / cell))
        near = False
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    for q, rq in grid.get((key[0] + i, key[1] + j, key[2] + k), ()):
                        if (p - q).length < (r + rq) / 2: near = True; break
        if near: continue
        grid.setdefault(key, []).append((p, r)); roots.append((p, n))
    return roots


def swirl(d, n, rng, sigma):
    """Turn a flow direction about the surface normal by a random angle."""
    angle = rng.gauss(0, sigma)
    return (d * math.cos(angle) + n.cross(d) * math.sin(angle)).normalized()


def vary(colour, rng, value=.11, warm=.05):
    """A strand's own tint: a little lighter or darker, a little redder or browner."""
    k, w = 1 + rng.uniform(-value, value), rng.uniform(-warm, warm)
    return Vector((colour.x * k * (1 + w), colour.y * k, colour.z * k * (1 - w)))


def build(low):
    rng = random.Random(20261113)
    body, head, tail = Part('torso', (0, 0, 0)), Part('head_mesh', HEAD_PIVOT), Part('tail_mesh', TAIL_PIVOT)
    legs = {key: Part(f'leg_{key}_mesh', pivot) for key, pivot in LEGS.items()}

    # --- Under-body: lofted rings. Hair adds about 4 cm on top of these skins. ---
    # z, centre height, half width, half height up, half height down, squareness
    torso_keys = [(-.77, 1.02, .10, .085, .12, 2.0), (-.66, .955, .165, .155, .215, 2.1), (-.54, .85, .245, .24, .33, 2.3),
                  (-.40, .79, .305, .295, .31, 2.6), (-.15, .78, .33, .29, .30, 2.7), (.10, .78, .335, .29, .30, 2.7),
                  (.35, .785, .325, .285, .275, 2.7), (.58, .795, .31, .275, .255, 2.5), (.76, .80, .25, .235, .22, 2.2),
                  (.87, .80, .13, .12, .12, 2.0)]
    sides, count = (12, 9) if low else (16, 15)
    rings, colours = [], []
    for i in range(count):
        z = torso_keys[0][0] + (torso_keys[-1][0] - torso_keys[0][0]) * i / (count - 1)
        cy, rx, top, bot, e = spline(torso_keys, z)
        if low: rx, top = rx + .03, top + .055    # LOW has no strands on its back: its skin stands at the hair's height
        ring = []
        for k in range(sides):
            a = math.tau * k / sides
            p = Vector((rx * sgnpow(math.sin(a), 2 / e), cy + (top if math.cos(a) >= 0 else bot) * sgnpow(math.cos(a), 2 / e), z))
            # A slow lumpy displacement, so the outline is not a turned shape.
            ring.append(p + Vector((p.x, p.y - cy, 0)).normalized() * .018 * noise.noise(p * 3.1))
        rings.append(ring)
        # On LOW the skin is seen, so it carries the coat colours; on desktop it is the shadow between strands.
        colours.append([(vary(RUST_DARK.lerp(RUST, max(0, min(1, (p.y - .5) / .45))).lerp(RUST_LIGHT, .5 * max(0, min(1, (p.y - .95) / .1))), rng, .16)
                         .lerp(MOP, .85 * max(0, min(1, (-.40 - z) / .3))) * .74) if low else UNDER for p in ring])
    body.loft(rings, colours, (Vector((0, 1.03, -.80)), UNDER), (Vector((0, .80, .90)), colours[-1][0]))

    def tube(part, keys, sides, count, colour, cap0=None, cap1=None):
        """A leg-like tube: rows (t, x, y, z, radius across, radius fore-aft); colour(point) per vertex."""
        rings, colours = [], []
        for i in range(count):
            x, y, z, rx, rz = spline(keys, i / (count - 1))
            ring = [Vector((x + rx * math.sin(math.tau * k / sides), y, z + rz * math.cos(math.tau * k / sides))) for k in range(sides)]
            rings.append(ring); colours.append([colour(p) for p in ring])
        part.loft(rings, colours, cap0, cap1)

    def leg_colour(p):
        if p.y < .052: return HOOF
        return (LEG.lerp(RUST_DARK, max(0, min(1, (p.y - .32) / .3))) * (.75 if low else .6))
    for key, pivot in LEGS.items():
        x, front = pivot.x, key[0] == 'f'
        if front:
            keys = [(0, x, .80, -.47, .095, .125), (.3, x, .56, -.47, .08, .10), (.55, x, .36, -.475, .058, .066), (.78, x, .17, -.47, .05, .056),
                    (.9, x, .085, -.475, .056, .064), (.95, x, .05, -.48, .06, .074), (1, x, 0, -.48, .064, .084)]
        else:
            keys = [(0, x * .9, .88, .50, .11, .19), (.24, x, .66, .535, .108, .17), (.42, x, .50, .60, .08, .115), (.56, x, .38, .665, .056, .072),
                    (.78, x, .20, .63, .048, .056), (.9, x, .085, .605, .056, .064), (.95, x, .05, .59, .06, .074), (1, x, 0, .585, .064, .084)]
        tube(legs[key], keys, 5 if low else 7, 5 if low else 8, leg_colour,
             (Vector((keys[0][1], keys[0][2] + .03, keys[0][3])), UNDER), (Vector((x, 0, keys[-1][3])), HOOF, DOWN))

    tail_keys = [(0, 0, 1.0, .84, .042, .042), (.2, 0, .93, .915, .036, .036), (.6, 0, .72, .945, .028, .028), (1, 0, .50, .94, .024, .024)]
    tube(tail, tail_keys, 4 if low else 6, 4 if low else 6, lambda p: RUST_DARK * .8,
         (Vector((0, 1.02, .82)), UNDER), (Vector((0, .47, .94)), RUST_DARK * .6))

    # --- Head skin: skull to muzzle along the head axis. ---
    def head_point(s, lateral, up):
        return S0 + AXIS * (s * HEAD_LENGTH) + X * lateral + U * up
    head_keys = [(-.12, .076, .065, .065), (0, .135, .124, .119), (.22, .146, .132, .13), (.45, .124, .11, .121), (.70, .10, .09, .104),
                 (.90, .086, .074, .088), (1.0, .08, .066, .076), (1.06, .058, .044, .052)]
    sides, count = (8, 7) if low else (12, 10)
    rings, colours = [], []
    for i in range(count):
        s = head_keys[0][0] + (head_keys[-1][0] - head_keys[0][0]) * i / (count - 1)
        hw, hu, hd = spline(head_keys, s)
        ring, cols = [], []
        for k in range(sides):
            a = math.tau * k / sides
            ring.append(head_point(s, hw * sgnpow(math.sin(a), 2 / 2.4), (hu if math.cos(a) >= 0 else hd) * sgnpow(math.cos(a), 2 / 2.4)))
            # The nose pad and upper lip are pinkish tan; the chin stays dark.
            pink = max(0, min(1, (s - .92) / .07)) * max(0, min(1, (math.cos(a) + .3) / .5))
            cols.append((FACE * (.95 if low else .8)).lerp(MUZZLE_HAIR, .7 * max(0, min(1, (s - .7) / .2))).lerp(MUZZLE, pink))
        rings.append(ring); colours.append(cols)
    head.loft(rings, colours, (head_point(-.16, 0, 0), UNDER), (head_point(1.09, 0, -.004), MUZZLE))
    for side in (-1, 1):
        head.blob(head_point(1.064, side * .029, .016), X * .014, U * .011, AXIS * .012, [NOSTRIL] * 6)
        if not low:   # Eyes sit under the fringe: seen from the side and from below, hidden from the front.
            head.blob(head_point(.30, side * .137, .036), AXIS * .022, U * .017, X * (side * .014), [EYE, EYE, IRIS * .6, EYE, IRIS * .45, EYE])

    # The forelock's core: a dark mound on the poll and forehead for the curls to sit on.
    sides, count = (6, 4) if low else (9, 6)
    centre = head_point(.14, 0, .105)
    rings, colours = [], []
    for i in range(count):
        t = -.86 + 1.72 * i / (count - 1)
        scale = math.sqrt(1 - t * t)
        rings.append([centre + AXIS * (t * .145) + X * (.137 * scale * math.sin(math.tau * k / sides)) + U * (.092 * scale * math.cos(math.tau * k / sides)) for k in range(sides)])
        colours.append([MOP * (.85 if low else .6)] * sides)
    start = len(head.f)
    head.loft(rings, colours, (centre - AXIS * .152, MOP * .6), (centre + AXIS * .152, MOP * .6))
    mop_skin = head.f[start:]

    # --- Horns: smooth swept tubes. Out level, then up and a little forward. Span tip to tip 0.90 m. ---
    def catmull(points, t):
        i = min(int(t), len(points) - 2)
        f = t - i
        p0, p1, p2, p3 = points[max(i - 1, 0)], points[i], points[i + 1], points[min(i + 2, len(points) - 1)]
        return .5 * ((2 * p1) + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f ** 3)
    for side in (-1, 1):
        root = head_point(.02, side * .07, .07)
        path = [root + Vector((side * x, y, z)) for x, y, z in ((0, 0, 0), (.12, -.004, -.008), (.235, .004, -.026), (.322, .05, -.05), (.364, .125, -.072), (.38, .21, -.09))]
        sides, count = (5, 6) if low else (8, 11)
        centres = [catmull(path, (len(path) - 1) * i / count) for i in range(count + 1)]
        rings, colours, normal = [], [], UP.copy()
        for i in range(count):
            u = i / count
            tangent = (centres[i + 1] - centres[max(i - 1, 0)]).normalized()
            normal = (normal - tangent * normal.dot(tangent)).normalized()
            binormal = tangent.cross(normal)
            radius = .004 + .033 * (1 - u) ** .85
            rings.append([centres[i] + (normal * math.cos(math.tau * k / sides) + binormal * math.sin(math.tau * k / sides)) * radius for k in range(sides)])
            colour = HORN_BASE.lerp(HORN, min(1, u / .12)) if u < .45 else HORN.lerp(HORN_GREY, (u - .45) / .3) if u < .75 else HORN_GREY.lerp(HORN_TIP, min(1, (u - .75) / .15))
            colours.append([colour * (1 - .05 * (i % 2) * (u < .35))] * sides)   # faint growth rings near the base
        head.loft(rings, colours, None, (centres[-1], HORN_TIP), skin=False)

    # --- The coat. ---
    order = (body, head, tail, *legs.values())
    offsets, total = [], 0
    for part in order: offsets.append(total); total += len(part.v)
    skins = BVHTree.FromPolygons([v for part in order for v in part.v],
                                 [tuple(i + offset for i in face) for part, offset in zip(order, offsets) for face in part.skin])
    big = 1.6 if low else 1.0     # LOW: fewer, larger strands, each one straight segment and a fork
    tally = {}

    def strand(part, where, p, n, d, length, lifts, hangs, wiggle, curl, width, thick, closed, tint, root, tip, cling=.025, steps=None):
        tally[where] = tally.get(where, 0) + 1
        # LOW strands are one straight piece, so they start and end a little higher: the body's curve stays under them.
        raise_ = .02 if low and not steps else 0
        rings = grow(skins, rng, p, n, d, length, steps or (1 if low else 2), lifts[0] + raise_, lifts[1] + raise_, hangs[0], hangs[1], wiggle, curl,
                     None if closed else cling, -raise_ if raise_ else .012)
        strand_mesh(part, rings, width, thick, closed, tint, root, tip, rng)

    def torso_radius(p, n):
        if p.z < -.71 or (n.y < -.55 and abs(p.x) < .19 and p.z > -.42): return None   # inside the head; hidden under the belly
        return (.052 if p.z < -.5 else .06) * (1.4 if low else 1)
    for p, n in scatter(body, body.skin, rng, torso_radius, 900 if low else 30000):
        side = 1 if p.x >= 0 else -1
        down = DOWN - n * DOWN.dot(n)
        out = X * side - n * (X * side).dot(n)
        back = BACK - n * BACK.dot(n)
        top, neck, rump, skirt = n.y > .7, p.z < -.47, n.z > .5, p.y < .64 and n.y < .2
        chest = (n.z < -.45 and p.z < -.4) or (neck and n.y < -.2)             # brisket and dewlap: long hanging hair
        d = down + out * (.8 * max(0, n.y)) + back * (0 if chest or rump else rng.uniform(.3, .6))
        if d.length < 1e-4: d = back
        d = swirl(d.normalized(), n, rng, .45 if neck else .3 if top else .16)
        dark = max(0, min(1, (-.32 - p.z) / .34))                             # towards the head the coat goes brown-black
        bleach = max(0, min(1, (p.y - .8) / .3))                              # the tips are lighter along the back
        tint = vary(RUST.lerp(RUST_LIGHT, bleach * rng.uniform(.3, .9)).lerp(RUST_DARK, (.55 if skirt else 0) + rng.uniform(0, .25)), rng)
        tint = tint.lerp(vary(MOP, rng, .2), dark * .85)
        if neck and not chest:      # short curls
            strand(body, 'neck', p, n, d, rng.uniform(.13, .2) * big ** .5, (.014, .034), (.1, .6), .5, .5, rng.uniform(.05, .068) * big, .026 * big ** .5, False, tint, .5, 1.2)
        elif chest or skirt:        # the hanging fringe: seen from both sides
            # The fringe ends above the knee: about 0.36 m from the ground.
            strand(body, 'fringe', p, n, d, max(.09, min(rng.uniform(.22, .34) * big ** .4, p.y - rng.uniform(.36, .42))), (.014, .03), (.5, 1), .2, .1, rng.uniform(.055, .075) * big, .026 * big ** .5, True, tint, .5, .92)
        elif top and low:
            continue                # LOW: the lumpy skin carries the back; one-segment strands would stand off it
        elif top:
            strand(body, 'back', p, n, d, rng.uniform(.16, .24) * big ** .5, (.012, .028), (0, .3), .2, .06, rng.uniform(.055, .075) * big, .024 * big ** .5, False, tint, .55, 1.14)
        else:                       # long wet strands down the sides, swept a little to the rear
            strand(body, 'flank', p, n, d, rng.uniform(.26, .4) * big ** .4, (.012, .036), (.1 if rump else .15, .9), .14, .08, rng.uniform(.055, .078) * big, .026 * big ** .5, False, tint, .5, 1.1 if p.y > .85 else .98)

    for key, part in legs.items():
        def leg_radius(p, n):
            return None if p.y < .07 or p.y > .7 else .07 * (1.9 if low else 1)
        for p, n in scatter(part, part.skin, rng, leg_radius, 300 if low else 4000):
            d = swirl((DOWN - n * DOWN.dot(n)).normalized(), n, rng, .2)
            tint = vary(LEG.lerp(RUST_DARK, max(0, min(1, (p.y - .3) / .32))), rng, .16)
            strand(part, 'leg', p, n, d, min(rng.uniform(.13, .22) * big ** .4, p.y - .015), (.008, .03), (.5, .9), .12, .3, rng.uniform(.045, .06) * big ** .7, .02, p.y < .3, tint, .55, 1.05)

    # Tail switch: long dark strands from the last third, a little lighter at the tips.
    for i in range(4 if low else 11):
        a = math.tau * (i + rng.random() * .5) / (4 if low else 11)
        n = Vector((math.sin(a), 0, math.cos(a)))
        p = Vector((0, rng.uniform(.5, .62), .942)) + n * .022
        strand(tail, 'tail', p, n, DOWN.copy(), rng.uniform(.24, .34), (0, .02), (1, 1), .12, .2, rng.uniform(.04, .055) * (1.6 if low else 1), .02, True, vary(LEG.lerp(RUST_DARK, .4), rng), .7, 1.25)

    # Head hair. Position on the head as (s along the axis, height out of the forehead).
    def on_head(p):
        s = (p - S0).dot(AXIS) / HEAD_LENGTH
        return s, (p - S0 - AXIS * (s * HEAD_LENGTH)).dot(U)
    wide = 1.6 if low else 1

    def skull_radius(p, n):
        s, up = on_head(p)
        if s > .8 or s < -.1 or (up > .05 and s < .34): return None       # muzzle, neck socket, under the mop
        return .047 * (1.7 if low else 1)
    mop_faces = set(mop_skin)
    for p, n in scatter(head, [face for face in head.skin if face not in mop_faces], rng, skull_radius, 250 if low else 6000):
        s, up = on_head(p)
        if s < .04:        # ruff: back over the neck joint, so a turned head shows hair and not a gap
            d = swirl((BACK * 1.0 + DOWN * (.25 + .5 * abs(n.x))).normalized(), n, rng, .3)
            strand(head, 'ruff', p, n, (d - n * d.dot(n)).normalized(), rng.uniform(.13, .19), (.016, .04), (.1, .45), .3, .3, rng.uniform(.055, .075) * wide, .026, False, vary(MOP.lerp(RUST_DARK, .35), rng, .2), .5, 1.2)
        elif n.dot(U) < -.45:   # beard and jaw
            d = swirl((DOWN - n * DOWN.dot(n) + AXIS * .2).normalized(), n, rng, .3)
            strand(head, 'beard', p, n, d, rng.uniform(.09, .15) + .1 * max(0, .6 - s), (.01, .02), (.7, 1), .35, .35, rng.uniform(.04, .055) * wide, .022, True, vary(FACE.lerp(MOP, .4), rng, .2), .6, 1.15)
        elif up > .02:     # the face below the fringe: short curls down the nose
            d = swirl((AXIS - n * AXIS.dot(n)).normalized(), n, rng, .5)
            strand(head, 'face', p, n, d, rng.uniform(.05, .08), (.008, .02), (0, .3), .5, .6, rng.uniform(.04, .052) * wide, .02, False, vary(FACE.lerp(MOP, .3), rng, .22), .6, 1.25)
        else:              # cheeks: short curls
            d = swirl((DOWN - n * DOWN.dot(n) + AXIS * .35).normalized(), n, rng, .5)
            strand(head, 'cheek', p, n, d, rng.uniform(.07, .12), (.01, .026), (.2, .6), .5, .6, rng.uniform(.045, .06) * wide, .024, False, vary(FACE.lerp(MOP, .5), rng, .22), .55, 1.25)

    def mop_radius(p, n):
        return None if n.dot(U) < -.35 else .037 * (1.75 if low else 1)
    for p, n in scatter(head, mop_skin, rng, mop_radius, 300 if low else 6000):
        forward = n.dot(AXIS) > -.35
        fall = AXIS if forward else -AXIS * .8 + DOWN * .3              # forward over the eyes; the back of the mop falls to the neck
        d = fall + DOWN * .35 + X * (p.x * 6.5)
        d = swirl((d - n * d.dot(n)).normalized(), n, rng, .45)
        fringe, crown = n.dot(AXIS) > .3, n.dot(U) > .55                 # the front row hangs free over the eyes; the crown stands up and flops
        tint = vary(MOP.lerp(RUST, rng.uniform(0, .16)), rng, .22, .1)
        if crown and not fringe:
            strand(head, 'crown', p, n, d, rng.uniform(.08, .12), (rng.uniform(.015, .03), rng.uniform(.015, .03)), (0, .5), .6, .3, rng.uniform(.042, .058) * wide, .03, False, tint, .5, 1.3, .03, 2)
        else:
            rings = grow(skins, rng, p, n, d, rng.uniform(.15, .26) * (1.15 if fringe else .8), 2, rng.uniform(.02, .04), rng.uniform(.014, .03), .12, .8, .55, .75, .035)
            tally['fringe-mop' if fringe else 'mop'] = tally.get('fringe-mop' if fringe else 'mop', 0) + 1
            strand_mesh(head, rings, rng.uniform(.042, .058) * wide, .028, fringe, tint, .45, 1.3, rng)

    # Ears: hairy leaves below and behind the horns, with a fringe.
    for side in (-1, 1):
        root = head_point(.10, side * .125, -.01)
        along = Vector((side * .9, -.22, .3)).normalized()
        flat = Vector((0, .5, .85))
        flat = (flat - along * flat.dot(along)).normalized()
        strand_mesh(head, [(root + along * (.18 * t), flat, along) for t in (0, .45, 1)], .095, .03, True, MOP * .9, .7, 1.1, rng)
        for t in ((.6,) if low else (.3, .6, .9)):
            p = root + along * (.18 * t) - UP * .01
            strand_mesh(head, [(p, -BACK, DOWN), (p + DOWN * .06 + along * .01, -BACK, DOWN), (p + DOWN * rng.uniform(.11, .15) + along * .02, -BACK, DOWN)],
                      .05, .02, True, vary(MOP, rng, .2), .6, 1.2, rng)
    print('STRANDS', 'low' if low else 'desktop', json.dumps(tally))

    parts = [body, head, tail, *legs.values()]
    if low:   # LOW is two meshes: the legs and the tail are part of the body; their pivots stay as empty nodes.
        for part in (tail, *legs.values()):
            offset = len(body.v)
            body.v += part.v; body.c += part.c; body.f += [tuple(i + offset for i in face) for face in part.f]
            body.shade.update({i + offset: n for i, n in part.shade.items()})
        parts = [body, head]
    occlude(parts)
    return parts


def occlude(parts):
    """Bake sky occlusion into the colours: 20 fixed rays per vertex against the whole animal and the ground."""
    verts, faces = [Vector((-9, 0, -9)), Vector((9, 0, -9)), Vector((9, 0, 9)), Vector((-9, 0, 9))], [(0, 1, 2, 3)]
    for part in parts:
        offset = len(verts)
        verts += part.v; faces += [tuple(i + offset for i in face) for face in part.f]
    tree = BVHTree.FromPolygons(verts, faces)
    rays = []
    for i in range(20):     # a cosine-weighted spiral on the hemisphere
        r, phi = math.sqrt((i + .5) / 20), i * 2.399963
        rays.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - r * r)))
    reach = .32
    for part in parts:
        for i, (p, n) in enumerate(zip(part.v, part.normals())):
            t = n.cross(UP if abs(n.y) < .9 else X).normalized()
            b = n.cross(t)
            blocked = 0
            for x, y, z in rays:
                hit = tree.ray_cast(p + n * .012, t * x + b * y + n * z, reach)
                if hit[0] is not None: blocked += 1 - hit[3] / reach
            sky = .85 + .15 * max(0, n.y)                     # undersides see the ground, not the sky
            part.c[i] = part.c[i] * ((.55 + .45 * (1 - blocked / 20) ** 1.3) * sky)


def emit(parts, low, path):
    """Blender objects with the game's node names, then one GLB."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def bl(p): return (p.x, -p.z, p.y)                        # game +Y up/-Z forward -> Blender +Z up/+Y forward
    material = bpy.data.materials.new('Highland coat')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    attribute = material.node_tree.nodes.new('ShaderNodeVertexColor'); attribute.layer_name = 'Color'
    material.node_tree.links.new(attribute.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = 1; shader.inputs['Metallic'].default_value = 0

    def empty(name, at, parent=None, parent_at=Vector()):
        o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o)
        o.location = bl(Vector(at) - parent_at); o.parent = parent
        return o
    root = empty('highland_bull', (0, 0, 0))
    body = empty('body', (0, 0, 0), root)
    pivots = {'torso': body, 'head_mesh': empty('head', HEAD_PIVOT, body), 'tail_mesh': empty('tail', TAIL_PIVOT, body)}
    for key, pivot in LEGS.items():
        pivots[f'leg_{key}_mesh'] = leg = empty(f'leg_{key}', pivot, body)
        empty(f'hoof_{key}', (pivot.x, 0, pivot.z), leg, pivot)   # contact point: straight below the pivot, on the ground
    for part in parts:
        mesh = bpy.data.meshes.new(part.name)
        mesh.from_pydata([bl(v - part.pivot) for v in part.v], [], part.f)
        mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
        mesh.update()
        normals = part.normals()
        mesh.normals_split_custom_set_from_vertices([bl(part.shade.get(i, normals[i])) for i in range(len(part.v))])
        colour = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
        colour.data.foreach_set('color', [x for c in part.c for x in (min(1, c.x), min(1, c.y), min(1, c.z), 1)])
        mesh.color_attributes.active_color = colour
        mesh.materials.append(material); mesh.update()
        o = bpy.data.objects.new(part.name, mesh); bpy.context.collection.objects.link(o); o.parent = pivots[part.name]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True, export_normals=True, export_texcoords=False,
                              export_materials='EXPORT', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_cameras=False, export_lights=False, export_extras=False, export_animations=False)
    quantize(path)


def measure(parts):
    lo = [min(v[i] for part in parts for v in part.v) for i in range(3)]
    hi = [max(v[i] for part in parts for v in part.v) for i in range(3)]
    return {'triangles': sum(part.triangles() for part in parts), 'meshes': {part.name: part.triangles() for part in parts},
            'min': [round(x, 4) for x in lo], 'max': [round(x, 4) for x in hi]}


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    folder = Path(next((a for a in args if not a.startswith('--')), Path(__file__).resolve().parents[2] / 'web/public/models'))
    folder.mkdir(parents=True, exist_ok=True)
    report = {}
    for low in (False, True):
        parts = build(low)
        path = folder / ('highland-bull-low.glb' if low else 'highland-bull.glb')
        emit(parts, low, path)
        report['low' if low else 'desktop'] = {**measure(parts), 'bytes': path.stat().st_size}
    print('HIGHLAND ' + json.dumps(report))


main()
