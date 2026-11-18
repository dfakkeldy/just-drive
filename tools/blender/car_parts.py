"""Everything fitted to the body shell: glass and lamp meshes, wheels, cabin, mirrors, roof kit and small trim.

Parts that lie on the body (shut lines, grille bars, handles, visors, wipers) ask the shell's uncut surface where
the skin is, so they follow it exactly. Symmetric parts are made for the right-hand side and mirrored.
"""
import math

from mathutils import Vector

import car_art as A
import car_body as B
import car_kit as K
from car_cut import FRONT, REAR, RIGHT, TOP, boundary_chain, rounded

srgb = K.srgb
BLACK = srgb(0x0b0c0d)
INK = srgb(0x050607)
TRIM = srgb(0x1b1d1e)
CHROME = srgb(0xdfe2e0)
# Cabin trim. The game lights a face that looks down or sideways with little more than its ground colour, and its
# picture tone curve is dark at the low end. So the lining is far lighter here than it should look: these read as
# mid grey from the driver's seat (measured in the game, noon and dusk), not as the pale colours they are.
HEADLINING = srgb(0xc3c5c0)
DOOR_CARD = srgb(0xa0a3a2)
RUBBER = srgb(0x17191b)
ALLOY = tuple(c * .6 for c in srgb(0xc6cac9))      # bare alloy in the paint material (see metal_colour)
CARD = srgb(0xb58c59)
V = Vector


def add_faces(bucket, faces, colour, normal_of=None, uv_of=None, shade=1.0, lift=0.0):
    """Copies bmesh faces into a bucket, sharing vertices. normal_of: a function of position, or 'vertex'."""
    index, verts, out, normals, uvs = {}, [], [], [], []
    get = (lambda v: v.normal) if normal_of == 'vertex' else (lambda v: normal_of(v.co)) if normal_of else None
    for f in faces:
        face = []
        for v in f.verts:
            if v not in index:
                index[v] = len(verts)
                verts.append(v.co + get(v) * lift if lift else v.co.copy())
            face.append(index[v])
        out.append(tuple(face))
        if get:
            normals.append([get(v) for v in f.verts])
        if uv_of:
            uvs.append([uv_of(v.co) for v in f.verts])
    colours = [colour(f) for f in faces] if callable(colour) else colour
    bucket.add(verts, out, colours, True, normals or None, uvs or None, shade)


def both(bucket, solid, colour, smooth=True, shade=1.0):
    """Adds a right-hand part and its mirror image."""
    bucket.add_solid(solid, colour, smooth, shade)
    bucket.add_solid(K.mirrored(solid), colour, smooth, shade)


def both_flat(bucket, solid, uv):
    """Adds a right-hand part and its mirror image to a textured bucket, all of it at one spot of the texture."""
    for part in (solid, K.mirrored(solid)):
        bucket.add(part[0], part[1], uvs=[[uv] * len(f) for f in part[1]])


def resample(path, step):
    out = [V(path[0])]
    for a, b in zip(path, path[1:]):
        a, b = V(a), V(b)
        n = max(1, round((b - a).length / step))
        out.extend(a.lerp(b, i / n) for i in range(1, n + 1))
    return [tuple(p) for p in out]


def lathe_facing(profile, segments, out_first=True, **kw):
    """A lathe whose first band faces away from the axis (or towards it)."""
    solid = K.lathe(profile, segments, **kw)
    verts, faces = solid
    f = faces[0]
    n = K._newell([V(verts[i]) for i in f])
    centre = sum((V(verts[i]) for i in f), V((0, 0, 0))) / len(f)
    axis = {'x': V((1, 0, 0)), 'y': V((0, 1, 0)), 'z': V((0, 0, 1))}[kw.get('axis', 'x')]
    origin = V(kw.get('centre', (0, 0, 0)))
    radial = (centre - origin) - axis * (centre - origin).dot(axis)
    return K.flipped(solid) if (n.dot(radial) > 0) != out_first else solid


def metal_colour(colour):
    """A bare-metal colour for the paint material. The car once had a `Metal` material: the game has no sky to
    mirror, so that only made the colour darker. This keeps that look with one material (and one draw) fewer."""
    return tuple(c * .6 for c in colour)


def split(solid, test):
    """Two solids from one: the faces whose normal passes the test, and the rest."""
    verts, faces = solid

    def part(chosen):
        index, out_verts, out_faces = {}, [], []
        for f in chosen:
            face = []
            for i in f:
                if i not in index:
                    index[i] = len(out_verts)
                    out_verts.append(verts[i])
                face.append(index[i])
            out_faces.append(tuple(face))
        return out_verts, out_faces
    passes = [test(K._newell([verts[i] for i in f]).normalized()) for f in faces]
    return part([f for f, ok in zip(faces, passes) if ok]), part([f for f, ok in zip(faces, passes) if not ok])


class Lighter:
    """A bucket whose parts take only part of the baked shade (things that must still read in a dark cabin)."""

    def __init__(self, bucket, strength):
        self.bucket, self.strength = bucket, strength

    def add(self, verts, faces, colour=(1, 1, 1), smooth=True, normals=None, uvs=None, shade=1.0):
        self.bucket.add(verts, faces, colour, smooth, normals, uvs, shade * self.strength)

    def add_solid(self, solid, colour=(1, 1, 1), smooth=True, shade=1.0):
        self.bucket.add(solid[0], solid[1], colour, smooth, shade=shade * self.strength)


class Fit:
    """Shared helpers bound to one car and its shell."""

    def __init__(self, car, shell):
        self.car, self.shell, self.low = car, shell, car.low
        self.master = shell.master
        self.matte = car.bucket('Matte')
        self.metal = car.bucket('Body paint')     # bare metal parts: the paint material at a darker colour (see METAL)
        self.paint = car.bucket('Body paint')

    def on(self, frame, q):
        return self.master.drop(frame, q)

    def strip(self, frame, path, width, lift=.0015, step=.045):
        """A band lying on the skin along a drawn path: (verts, faces, vertex normals)."""
        pts = [self.on(frame, q) for q in resample(path, step)]
        pts = [p for p in pts if p]
        verts, normals = [], []
        for i, (p, n) in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)][0] - pts[max(i - 1, 0)][0]).normalized()
            side = n.cross(t).normalized()
            verts += [p + n * lift + side * (width / 2), p + n * lift - side * (width / 2)]
            normals += [n, n]
        faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(pts) - 1)]
        if faces and K._newell([verts[i] for i in faces[0]]).dot(normals[0]) < 0:
            faces = [tuple(reversed(f)) for f in faces]
        return verts, faces, normals

    def lay(self, bucket, frame, path, width, colour, mirror=True, lift=.0015, step=.045, shade=0.0):
        verts, faces, normals = self.strip(frame, path, width, lift, step)
        if not faces:
            return
        bucket.add(verts, faces, colour, True, [[normals[i] for i in f] for f in faces], shade=shade)
        if mirror:
            mv = [V((-v.x, v.y, v.z)) for v in verts]
            mn = [V((-n.x, n.y, n.z)) for n in normals]
            mf = [tuple(reversed(f)) for f in faces]
            bucket.add(mv, mf, colour, True, [[mn[i] for i in f] for f in mf], shade=shade)

    def patch(self, bucket, frame, outline, colour, lift=.003, mirror=False, uv=None, shade=0.3):
        """A flat-drawn shape laid on the skin as one fan of triangles."""
        pts = [self.on(frame, q) for q in outline]
        verts = [p + n * lift for p, n in pts]
        normals = [n for _, n in pts]
        face = tuple(range(len(verts)))
        if K._newell(verts).dot(sum(normals, V((0, 0, 0)))) < 0:
            face = tuple(reversed(face))
        bucket.add(verts, [face], colour, True, [[normals[i] for i in face]], [[uv[i] for i in face]] if uv else None, shade)
        if mirror:
            mv = [V((-v.x, v.y, v.z)) for v in verts]
            mn = [V((-n.x, n.y, n.z)) for n in normals]
            mf = tuple(reversed(face))
            bucket.add(mv, [mf], colour, True, [[mn[i] for i in mf]], [[uv[i] for i in mf]] if uv else None, shade)


# ---------------------------------------------------------------- shell regions

def fit_shell(car, shell):
    """Hands each drawn region of the shell to the mesh that will draw it."""
    bm, master = shell.bm, shell.master
    cache = {}

    def normal(co):
        key = (round(co.x, 5), round(co.y, 5), round(co.z, 5))
        if key not in cache:
            cache[key] = master.normal(co)
        return cache[key]
    shell.normal = normal
    by_region = {}
    for f in bm.faces:
        by_region.setdefault(f.material_index, []).append(f)
    shell.by_region = by_region
    right = lambda fs: [f for f in fs if f.calc_center_median().x > 0]
    left = lambda fs: [f for f in fs if f.calc_center_median().x <= 0]
    matte, metal = car.bucket('Matte'), car.bucket('Body paint')

    add_faces(car.bucket('Body paint'), by_region.get(B.PAINT, []), B.PAINT_COLOUR, normal)
    for region in (B.SEAL, B.CLAD, B.ARCH, B.COWL, B.REFLECTOR):
        add_faces(matte, by_region.get(region, []), B.COLOURS[region], normal)
    for region in (B.GRILLE, B.INTAKE):      # recessed: their sloped walls shade as walls, not as skin
        add_faces(matte, by_region.get(region, []), B.COLOURS[region], 'vertex')
    add_faces(metal, by_region.get(B.FOG, []), metal_colour(B.COLOURS[B.FOG]), 'vertex', shade=.5)
    add_faces(car.bucket('Body paint'), by_region.get(B.CHROME, []), B.COLOURS[B.CHROME], normal, shade=.3)   # bright trim
    add_faces(matte, by_region.get(B.CLEAR, []), B.COLOURS[B.CLEAR], normal if car.low else 'vertex', shade=.3)
    doors = by_region.get(B.DOOR_GLASS, [])
    add_faces(car.bucket('Front glass', name='driver_window'), right(doors), (1, 1, 1), normal)
    add_faces(car.bucket('Front glass'), left(doors) + by_region.get(B.WINDSCREEN, []), (1, 1, 1), normal)
    add_faces(car.bucket('Rear tint'), by_region.get(B.TINT, []), (1, 1, 1), normal)
    if car.low:
        warm = A.spot(A.GLOW_WARM)
        add_faces(car.bucket('Head lamp'), by_region.get(B.LENS, []), (1, 1, 1), normal, uv_of=lambda co: warm)
    else:
        add_faces(car.bucket('Lamp lens'), by_region.get(B.LENS, []), (1, 1, 1), normal)
    relief = normal if car.low else 'vertex'      # the desktop lens stands proud of the skin
    for region, part in ((B.RED_UP, 'upper'), (B.RED_LOW, 'brake')):
        faces = by_region.get(region, [])
        add_faces(car.bucket('Brake red', name=f'brake_right_{part}'), right(faces), (1, 1, 1), relief)
        add_faces(car.bucket('Brake red', name=f'brake_left_{part}'), left(faces), (1, 1, 1), relief)


def fit_everything(car, shell):
    fit = Fit(car, shell)
    housings(fit)
    cabin(fit)
    headlamps(fit)
    face_trim(fit)
    mirrors(fit)
    handles(fit)
    shut_lines(fit)
    visors(fit)
    wipers(fit)
    roof_kit(fit)
    tail_trim(fit)
    mud(fit)
    wheel(car)


# ---------------------------------------------------------------- under the body

def housings(fit):
    """Dark wheel housings behind each opening, mud flaps, and a flat under-tray."""
    matte = fit.matte
    steps = 8 if fit.low else 16
    inner_x = .50
    start = math.asin((.285 - B.car_form.WHEEL_Y) / B.ARCH_OPEN)
    for axle in B.AXLES:
        outer, inner = [], []
        for i in range(steps + 1):
            a = start + (math.pi - 2 * start) * i / steps
            z, y = axle + B.ARCH_OPEN * math.cos(a), B.car_form.WHEEL_Y + B.ARCH_OPEN * math.sin(a)
            hit = fit.on(RIGHT, (z, y))
            x = hit[0].x if hit else .88
            outer.append(V((x + .002, y, z)))
            inner.append(V((inner_x, y, z)))
        tunnel = K.facing(K.sheet([outer, inner]), (0, -1, 0))
        wall = K.facing(([V((inner_x, B.car_form.WHEEL_Y, axle))] + inner, [(0, i + 1, i + 2) for i in range(steps)]), (1, 0, 0))
        both(matte, tunnel, srgb(0x060607))
        both(matte, wall, srgb(0x060607))
        if not fit.low:
            both(matte, K.flipped(tunnel), srgb(0x1b1c1d))    # the same housing seen from inside the cabin
            both(matte, K.flipped(wall), srgb(0x1b1c1d))
        flap = K.box((.80, .285, axle + .445), (.18, .15, .016))
        both(matte, flap, srgb(0x0e0f10), smooth=False)
    # under-tray: a flat plate that stays inside the body's plan at every point
    outline = [(0, -2.12), (.30, -2.09), (.50, -1.99), (.50, -.86), (.80, -.86), (.80, .86), (.50, .86), (.50, 2.06), (.30, 2.16), (0, 2.19)]
    points = [V((x, .30, z)) for x, z in outline] + [V((-x, .30, z)) for x, z in reversed(outline[1:-1])]
    matte.add(points, [tuple(range(len(points)))], srgb(0x0a0b0c), smooth=False)
    matte.add(points, [tuple(reversed(range(len(points))))], srgb(0x0a0b0c), smooth=False)


# ---------------------------------------------------------------- cabin

def cabin(fit):
    """Right-hand-drive cabin: liner, dash, wheel, two seats, and the working load of tubs and parcels."""
    matte, low = fit.matte, fit.low
    lining = matte
    matte = Lighter(matte, .4)        # the cabin takes only part of the baked shade: from the seat it must still read
    # The lining is the body's own shape a little way in, with the window openings cut: one closed inner skin, on
    # the phone car too (with fewer faces). Flat pieces left gaps there, and the sky showed through them.
    liner = B.build_liner(low)
    colours = {B.PAINT: HEADLINING, B.CLAD: DOOR_CARD, B.SEAL: RUBBER}
    add_faces(lining, liner.faces, lambda f: colours[f.material_index], 'vertex', shade=.3)
    liner.free()
    if low:
        phone_header(fit, lining)
    else:
        door_trim(fit, lining)
    # floor: full width between the wheel housings, narrow beside them
    outline = [(0, -.88), (.84, -.88), (.84, .88), (.49, .88), (.49, 1.74), (.80, 1.74), (.80, 2.16), (0, 2.16)]
    points = [V((x, .43, z)) for x, z in outline] + [V((-x, .43, z)) for x, z in reversed(outline[1:-1])]
    matte.add_solid(K.facing((points, [tuple(range(len(points)))]), (0, 1, 0)), srgb(0x191a1b), smooth=False)
    fire = K.facing(K.sheet([[V((-.86, .43, -.88)), V((.86, .43, -.88))], [V((-.86, .82, -.88)), V((.86, .82, -.88))]]), (0, 0, 1))
    matte.add_solid(fire, srgb(0x151617))

    # Dashboard: low, and falling towards the driver, so the bonnet shows over it from the seat.
    profile = [(-1.0, 1.075), (-.80, 1.06), (-.68, 1.02), (-.63, .97), (-.61, .86), (-.68, .78), (-1.0, .78)]
    rings = [[V((x * (1 if 0 < i < 3 else .97), y, z)) for z, y in profile] for i, x in enumerate((-.85, -.83, .83, .85))]
    matte.add_solid(K.outward(K.loft(rings)), srgb(0x555b61))
    if low:
        matte.add_solid(K.box((.43, 1.07, -.74), (.34, .055, .20)), srgb(0x373b3f))
    else:
        matte.add_solid(K.soft_box((.43, 1.075, -.74), (.36, .065, .21), .05), srgb(0x373b3f))   # instrument hood, right-hand side
        matte.add_solid(K.soft_box((0, .93, -.60), (.27, .24, .05), .02, K.rot('X', 90)), srgb(0x2f3335))
        matte.add_solid(K.facing(K.disc((0, .985, -.572), (0, .25, 1), .10, 4, .062), (0, 0, 1)), srgb(0x1b2c35), shade=.4)
        tilt = V((0, .3, 1)).normalized()
        up = V((1, 0, 0)).cross(tilt)                    # up the dial's own face
        if up.y < 0:
            up = -up
        # Needles, hubs and marks are in the sign's lit material: a soft instrument light at dusk and at night.
        lit, spot = fit.car.bucket('Sign atlas'), A.spot(A.GLOW_HOT)

        def glow(part):
            part = K.facing(part, (0, 0, 1))
            lit.add(part[0], part[1], uvs=[[spot] * len(f) for f in part[1]])
        for x, turn in ((.365, 38), (.495, -52)):
            at = V((x, 1.035, -.648))
            matte.add_solid(K.facing(K.disc(at - tilt * .002, tilt, .046, 24), (0, 0, 1)), srgb(0x8c9194), shade=.2)   # bezel
            matte.add_solid(K.facing(K.disc(at, tilt, .040, 24), (0, 0, 1)), srgb(0x0d1512), shade=.2)
            ray = lambda degrees: up * math.cos(math.radians(degrees)) + V((1, 0, 0)) * math.sin(math.radians(degrees))
            side = lambda degrees: V((1, 0, 0)) * math.cos(math.radians(degrees)) - up * math.sin(math.radians(degrees))
            face = at + tilt * .003
            glow(([face - ray(turn) * .006 - side(turn) * .003, face - ray(turn) * .006 + side(turn) * .003,
                   face + ray(turn) * .034 + side(turn) * .0012, face + ray(turn) * .034 - side(turn) * .0012], [(0, 1, 2, 3)]))
            glow(K.disc(at + tilt * .004, tilt, .007, 12))
            for mark in range(-120, 121, 40):
                glow(([face + ray(mark) * .031 - side(mark) * .0014, face + ray(mark) * .031 + side(mark) * .0014,
                       face + ray(mark) * .037 + side(mark) * .0014, face + ray(mark) * .037 - side(mark) * .0014], [(0, 1, 2, 3)]))

    # Steering wheel on the right: it stands clear above the dash, so it shows from outside and from the seat.
    centre = V((.43, 1.06, -.46))
    u, v = V((1, 0, 0)), V((0, math.cos(math.radians(24)), -math.sin(math.radians(24))))
    matte.add_solid(K.ring_tube(centre, u, v, .185, .019, 20 if low else 36, 4 if low else 8), srgb(0x33373a), smooth=80, shade=.6)
    normal = u.cross(v)
    for a in (0, 180, 270):
        d = u * math.cos(math.radians(a)) + v * math.sin(math.radians(a))
        matte.add_solid(K.outward(K.tube([centre + d * .03, centre + d * .172], [.024, .015], 4 if low else 6)), srgb(0x55595c),
                        smooth=80, shade=.5)
    if not low:
        matte.add_solid(K.outward(K.tube([centre - normal * .012, centre + normal * .03], [.055, .045], 16)), srgb(0x3c4043), smooth=80)
        matte.add_solid(K.outward(K.tube([centre - normal * .01, centre - normal * .21 + V((0, -.03, 0))], .03, 6)), srgb(0x1a1c1d))

    # Front seats.
    for x in (-.40, .40):
        if low:
            matte.add_solid(K.box((x, .61, -.04), (.48, .19, .50)), srgb(0x2c2f32))
            matte.add_solid(K.box((x, 1.01, .255), (.44, .62, .13), K.rot('X', 12)), srgb(0x2f3336))
            matte.add_solid(K.box((x, 1.39, .345), (.25, .16, .10), K.rot('X', 12)), srgb(0x2a2d30))
            continue
        matte.add_solid(K.soft_box((x, .61, -.04), (.50, .19, .52), .09), srgb(0x2c2f32))
        matte.add_solid(K.soft_box((x, 1.01, .255), (.48, .64, .15), .07, K.rot('X', 12), taper=.86), srgb(0x2f3336))
        matte.add_solid(K.soft_box((x, 1.39, .345), (.27, .17, .11), .045, K.rot('X', 12)), srgb(0x2a2d30))
        if not low:
            panel = K.box((x, 1.0, .175), (.25, .44, .012), K.rot('X', 12))
            matte.add_solid(panel, srgb(0x42474b), smooth=False, shade=.6)
    if not low:
        matte.add_solid(K.soft_box((0, .64, -.02), (.20, .22, .50), .04), srgb(0x25282a))      # console
    # Inner mirror: a housing with a glass that shows the rear window's light.
    housing = K.box((0, 1.49, -.565), (.22, .06, .035)) if low else K.soft_box((0, 1.49, -.565), (.22, .06, .035), .014)
    matte.add_solid(housing, srgb(0x2b2e31), smooth=not low)
    glass = K.sheet([[V((-.098, 1.467, -.5465)), V((.098, 1.467, -.5465))], [V((-.098, 1.513, -.5465)), V((.098, 1.513, -.5465))]])
    matte.add_solid(K.facing(glass, (0, 0, 1)), srgb(0xaab9bf), smooth=False, shade=0)

    # The load: a tub on the passenger seat, a flat deck behind with more tubs and parcels.
    deck_y = .765                                    # the load floor sits just over the rear wheel housings
    deck = K.facing(K.sheet([[V((-.80, deck_y, .52)), V((.80, deck_y, .52))], [V((-.80, deck_y, 2.14)), V((.80, deck_y, 2.14))]]), (0, 1, 0))
    matte.add_solid(deck, srgb(0x1e2021), smooth=False)
    lip = K.facing(K.sheet([[V((-.80, .43, .52)), V((.80, .43, .52))], [V((-.80, deck_y, .52)), V((.80, deck_y, .52))]]), (0, 0, -1))
    matte.add_solid(lip, srgb(0x1a1c1d), smooth=False)
    tub(matte, (-.40, .705, -.03), low)
    if not low:
        tub(matte, (-.40, deck_y, .80), low)
        tub(matte, (.38, deck_y, .78), low, turn=6)
    parcels = [(-.42, 1.30, .46, .34, .40, 5), (.10, 1.28, .40, .28, .36, -7), (.50, 1.36, .34, .42, .44, 3),
               (-.36, 1.80, .50, .30, .42, -4), (.22, 1.82, .52, .38, .40, 6), (-.40, 1.31, .34, .22, .30, 10),
               (.05, 1.78, .30, .20, .30, -12), (.52, 1.86, .30, .26, .34, 0)]
    under = {5: .34, 6: .38, 7: .42}                 # the last three sit on top of others
    for i, (x, z, w, h, d, turn) in enumerate(parcels[:4] if low else parcels):
        parcel(matte, (x, deck_y + under.get(i, 0) + h / 2, z), (w, h, d), turn, low)


def phone_header(fit, lining):
    """Phone car only: the front edge of the roof lining, tight under the skin, from pillar to pillar.

    A phone's camera draws nothing nearer than 0.45 m, and the roof over the driver is nearer than that. What is
    left of the roof in the seat view is its front 8 cm, right at the top of the picture. The lining's few faces
    cut that corner too low there, and the sky showed over them. This strip follows the true roof, 3 mm inside
    it, so the picture is closed along its top. It looks down, so nothing of it shows from outside.
    """
    glass, _ = B.windscreen()
    edge = sorted((x, v) for x, v in glass if v > .8)             # the top edge of the glass, across the half
    top = lambda x: B.interp(edge, min(abs(x), edge[-1][0]))
    xs = (-.70, -.62, -.45, -.2, 0, .2, .45, .62, .70)
    rows = []
    for at in (lambda x: top(x) - .006, lambda x: .97, lambda x: 1.045):
        row = []
        for x in xs:
            p, n = fit.on(B.WINDSCREEN_FRAME, (x, at(x)))
            row.append(p - n * .003)
        rows.append(row)
    Lighter(lining, .3).add_solid(K.facing(K.sheet(rows), (0, -1, 0)), HEADLINING)


def door_trim(fit, lining):
    """What the driver sees beside them: the roll along the top of each door card, an arm rest, and the door gaps."""
    matte = Lighter(lining, .3)
    inset = B.LINER_INSET

    def ledge(z0, z1, y_of, depth, height, colour, steps=5):
        rings = []
        for i in range(steps + 1):
            z = z0 + (z1 - z0) * i / steps
            p, n = fit.on(RIGHT, (z, y_of(z)))
            inward = V((-n.x, 0, -n.z)).normalized()
            a = p - n * (inset - .006)                    # starts inside the lining, so no gap shows
            b = p - n * inset + inward * depth
            rings.append([a, b, b - V((0, height, 0)), a - V((0, height * 1.25, 0))])
        both(matte, K.outward(K.loft(rings)), colour, smooth=False)

    def gap(z, y0, y1, width=.008):
        rows = []
        for y in (y0, (y0 + y1) / 2, y1):
            p, n = fit.on(RIGHT, (z, y))
            base = p - n * (inset + .008)
            rows.append([base - V((0, 0, width / 2)), base + V((0, 0, width / 2))])
        both(matte, K.facing(K.sheet(rows), (-1, 0, 0)), RUBBER, shade=0)
    for z0, z1 in ((-.80, .03), (.135, .93)):
        ledge(z0, z1, lambda z: B.belt(z) + .012, .034, .04, srgb(0xb4b7b3))
    ledge(-.58, -.08, lambda z: B.belt(z) - .20, .055, .035, srgb(0x8a8e90), steps=3)
    gap(-.84, .46, B.belt(-.84) - .03)
    gap(.085, .46, B.belt(.085) - .03)


def tub(matte, at, low, turn=0):
    """A mail tub: tapered open box with a rim, filled with upright bundles of letters."""
    x, y, z = at
    r = K.rot('Y', turn)

    def ring(w, d, h, inset=0.0):
        return [r @ V((sx * (w / 2 - inset), h, sz * (d / 2 - inset))) + V((x, y, z)) for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    walls = K.outward(K.loft([ring(.40, .30, 0), ring(.46, .36, .22), ring(.49, .39, .225), ring(.49, .39, .245)], True, False))
    matte.add_solid(walls, srgb(0xcfd2c8), smooth=False)
    matte.add_solid(K.facing((ring(.47, .37, .245, .012) + ring(.49, .39, .245), [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]), (0, 1, 0)),
                    srgb(0xe2e4da), smooth=False)
    fill = K.facing((ring(.44, .34, .15), [(0, 1, 2, 3)]), (0, 1, 0))
    matte.add_solid(fill, srgb(0x8d8f86), smooth=False)
    count = 3 if low else 6
    for i in range(count):
        dz = -.13 + .26 * (i + .5) / count
        colour = (srgb(0xf0ede2), srgb(0xd9c9a3), srgb(0xe6e9ee))[i % 3]
        letter = K.box((0, .185, dz), (.34 - .03 * (i % 2), .15, .014), K.rot('X', -10))
        matte.add_solid(([r @ p + V((x, y, z)) for p in letter[0]], letter[1]), colour, smooth=False, shade=.7)


def parcel(matte, at, size, turn, low):
    r = K.rot('Y', turn)
    w, h, d = size
    matte.add_solid(K.box(at, size, r), CARD, smooth=False)
    if low:
        return
    top = V(at) + V((0, h / 2 + .0015, 0))
    tape = [top + r @ V((sx * .028, 0, sz * d / 2)) for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    matte.add_solid(K.facing((tape, [(0, 1, 2, 3)]), (0, 1, 0)), srgb(0xd3b78a), smooth=False, shade=.6)
    side = 1 if at[0] >= 0 else -1
    face = V(at) + r @ V((side * (w / 2 + .0015), .02, 0))
    label = [face + r @ V((0, sy * .045, sz * .07)) for sy, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    matte.add_solid(K.facing((label, [(0, 1, 2, 3)]), r @ V((side, 0, 0))), srgb(0xeeeae0), smooth=False, shade=.6)


# ---------------------------------------------------------------- lamps and the face

def headlamps(fit):
    """Lamp units. Desktop: behind a clear lens, in a lit housing. LOW: the lens itself is the lit lamp.

    The housing floor and the units are the car's `Head lamp` material. They use two flat patches of the atlas (a
    warm reflector, a white unit) for colour and for glow, and the game sets how bright they burn. So the whole
    swept lamp is lit, as on the owner's car, and not only two round units.
    """
    frame = B.HEAD_FRAME
    outline = fit.shell.head_outline
    us = sorted(q[0] for q in outline)
    span = us[-1] - us[0]
    cv = sum(q[1] for q in outline) / len(outline)
    lamp, hot, warm = fit.car.bucket('Head lamp'), A.spot(A.GLOW_HOT), A.spot(A.GLOW_WARM)
    amber = srgb(0xea8f1e)
    # main beam towards the outside, high beam towards the grille, amber turn lamp at the wing end
    units = ((.43, -.006, .058, True), (.20, -.012, .044, True), (.70, .016, .03, False))
    if fit.low:
        round8 = lambda c, r: [(c[0] + r * math.cos(math.tau * i / 8), c[1] + r * math.sin(math.tau * i / 8)) for i in range(8)]
        fit.patch(fit.matte, FRONT, round8((.675, .412), .046), srgb(0xf2efdc), lift=.002, mirror=True, shade=.2)     # fog lamp
        for along, dv, radius, white in units:
            c = (us[0] + span * along, cv + dv)
            if white:
                fit.patch(lamp, frame, round8(c, radius * .9), (1, 1, 1), lift=.003, mirror=True, uv=[hot] * 8)
            else:
                fit.patch(fit.matte, frame, round8(c, radius), amber, lift=.003, mirror=True, shade=.2)
        return
    faces = [f for f in fit.shell.by_region.get(B.LENS, []) if f.calc_center_median().x > 0]
    if not faces:
        return
    verts = list({v for f in faces for v in f.verts})
    flat = {v: frame.to2d(v.co) for v in verts}
    cu = sum(q[0] for q in flat.values()) / len(flat)
    centre3 = sum((v.co for v in verts), V((0, 0, 0))) / len(verts)

    def back(v, depth=.045, shrink=.9):
        q = flat[v]
        return frame.to3d((cu + (q[0] - cu) * shrink, cv + (q[1] - cv) * shrink), frame.depth(v.co) + depth)
    for loop in boundary_chain(faces):
        loop = loop[::3] if len(loop) > 24 else loop
        rim = [v.co.copy() for v in loop]
        deep = [back(v) for v in loop]
        middle = sum(deep, V((0, 0, 0))) / len(deep)
        n = len(loop)
        floor = (deep + [middle], [(i, (i + 1) % n, n) for i in range(n)])
        both_flat(lamp, K.facing(floor, -frame.w), warm)             # the lit reflector, as wide as the lens
        wall = K.sheet([rim + rim[:1], deep + deep[:1]])
        mid = (rim[0] + deep[0] + rim[1] + deep[1]) / 4
        if K._newell([wall[0][i] for i in wall[1][0]]).dot(centre3 - mid) < 0:
            wall = K.flipped(wall)
        both(fit.paint, wall, srgb(0xc6c9c8), shade=.5)
    for along, dv, radius, white in units:
        hit = fit.master.tree.ray_cast(frame.to3d((us[0] + span * along, cv + dv), -6), frame.w)
        if hit[0] is None:
            continue
        at = hit[0] + frame.w * .043
        # built about +Z (towards the viewer), then turned to look out of the lamp
        dome = K.aimed(K.facing(K.lathe([(radius, 0), (radius * .9, .012), (radius * .62, .024), (radius * .3, .031), (0, .033)], 16, axis='z'),
                                (0, 0, 1)), at, -frame.w)
        if white:
            both_flat(lamp, dome, hot)
        else:
            both(fit.matte, dome, amber, shade=.15)


def face_trim(fit):
    """Bright bars across the upper grille, slats in the lower intake, and both number plates."""
    matte, low = fit.matte, fit.low
    bright = fit.paint
    for y in (.868, .908):
        fit.lay(bright, FRONT, [(-.375, y), (-.2, y + .003), (0, y + .004), (.2, y + .003), (.375, y)], .02, CHROME, mirror=False,
                lift=-.006, step=.07, shade=.3)
    if not low:
        outline = B.upper_grille()
        fit.lay(bright, FRONT, outline[1:-1], .011, CHROME, lift=.001, step=.05, shade=.3)
        fit.lay(matte, FRONT, [(-.40, .40), (0, .402), (.40, .40)], .014, srgb(0x2b2e30), mirror=False, lift=-.014, step=.1, shade=.6)
        for y in (.741, .771):                        # slats in the second grille: it reads as a grille, not as a mouth
            fit.lay(matte, FRONT, [(-.37, y), (0, y + .003), (.37, y)], .011, srgb(0x7c8082), mirror=False, lift=-.011, step=.09, shade=.4)
    sign = fit.car.bucket('Sign atlas')
    u0, v0, u1, v1 = A.rect(A.PLATE)
    plate_uv = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]      # as the reader sees it: left-bottom, right-bottom, right-top, left-top
    # rear plate, in the tailgate
    z = fit.on(REAR, (0, .875))[0].z
    rear = [V((-.19, .78, z + .012)), V((.19, .78, z + .012)), V((.19, .97, z + .012)), V((-.19, .97, z + .012))]
    sign.add(rear, [(0, 1, 2, 3)], uvs=[plate_uv])
    matte.add_solid(K.box((0, .875, z + .004), (.40, .21, .014)), BLACK, smooth=False)
    # front plate, on a bracket ahead of the bumper: it is the car's foremost point
    front_z = -2.3390545845
    front = [V((.18, .505, front_z)), V((-.18, .505, front_z)), V((-.18, .675, front_z)), V((.18, .675, front_z))]
    sign.add(front, [(0, 1, 2, 3)], uvs=[plate_uv])
    skin = fit.on(FRONT, (0, .59))[0].z
    matte.add_solid(K.box((0, .59, (front_z + skin) / 2 + .008), (.38, .19, skin - front_z + .004)), BLACK, smooth=False)


def tail_trim(fit):
    """Tailgate garnish, handle recess, high brake lamp, wiper, lamp dividers, exhaust."""
    metal, matte, low = fit.metal, fit.matte, fit.low
    fit.lay(fit.paint, REAR, [(-.345, 1.02), (0, 1.024), (.345, 1.02)], .052, CHROME, mirror=False, lift=.007, step=.12, shade=.3)
    fit.lay(matte, REAR, [(-.30, .985), (0, .987), (.30, .985)], .02, srgb(0x0d0e0f), mirror=False, lift=.002, step=.15)
    if not low:
        tail = B.TAIL_FRAME
        across = lambda y: [tail.to2d(fit.on(REAR, (.722, y))[0]), tail.to2d(fit.on(RIGHT, (2.02, y))[0])]
        for y in (1.135, .99):                        # between the red and clear chambers
            fit.lay(matte, tail, across(y), .006, srgb(0x2a0c0e), lift=.0045, step=.02)
        for y in (1.04, 1.085):                       # ribs in the clear lens
            fit.lay(matte, tail, across(y), .004, srgb(0xa9aba6), lift=.0045, step=.02)
        outline = fit.shell.tail_outline
        fit.lay(matte, tail, outline + outline[:1], .006, INK, lift=.0012, step=.03)      # the gap round the lamp
    # high brake lamp across the top of the rear glass: half in each side's lamp mesh so both light together
    frame = B.REAR_GLASS_FRAME
    for sx, name in ((1, 'brake_right_upper'), (-1, 'brake_left_upper')):
        pts = [fit.on(frame, q) for q in ((0, .386), (sx * .17, .384), (sx * .17, .402), (0, .404))]
        verts = [p + n * .004 for p, n in pts]
        face = (0, 1, 2, 3)
        if K._newell(verts).dot(pts[0][1]) < 0:
            face = (3, 2, 1, 0)
        fit.car.bucket('Brake red', name=name).add(verts, [face], normals=[[pts[i][1] for i in face]])
    # Exhaust: a silencer under the floor and a pipe with a rolled lip and a real bore. Its tip is the car's rearmost point.
    tip = 2.3267202377
    x, y = .52, .30
    seg = 6 if low else 12
    if not low:
        matte.add_solid(K.soft_box((x - .06, .335, 2.0), (.44, .12, .24), .05), srgb(0x1c1d1e))
    outer = lathe_facing([(.027, 2.10), (.029, tip - .035), (.033, tip - .012), (.034, tip - .003), (.0315, tip)], seg, axis='z', centre=(x, y, 0))
    metal.add_solid(outer, metal_colour(srgb(0x9a9d9e)))
    bore = lathe_facing([(.0315, tip), (.027, tip - .008), (.026, tip - .09), (0, tip - .09)], seg, out_first=False, axis='z', centre=(x, y, 0))
    matte.add_solid(bore, srgb(0x070707), shade=0)


def mirrors(fit):
    """Door mirrors: a rounded body-colour cap on a short black foot, glass facing back in a black surround."""
    def ring(x, cy, cz, hy, hz, n=8):
        pts = []
        for k in range(n):
            a = math.tau * k / n
            c, s = math.cos(a), math.sin(a)
            f = 1 / (abs(c) ** 4 + abs(s) ** 4) ** .25
            pts.append(V((x, cy + hy * s * f, cz + hz * c * f)))
        return pts
    tip = 1.1439932585
    xs = [.946, .958, .985, 1.04, 1.095, 1.125, 1.139, tip]
    hy = [.030, .052, .068, .075, .072, .060, .040, .012]
    hz = [.026, .040, .052, .058, .056, .047, .032, .010]
    n = 6 if fit.low else 12
    if fit.low:
        xs, hy, hz = xs[::2] + [tip], hy[::2] + [.012], hz[::2] + [.010]
    cap = K.outward(K.loft([ring(x, 1.176, -.935 + .035 * (x - xs[0]) / (tip - xs[0]), hy[i], hz[i], n) for i, x in enumerate(xs)]))
    surround, shell = split(cap, lambda normal: normal.z > .5)       # what the driver sees round the glass is black
    both(fit.paint, shell, B.PAINT_COLOUR, smooth=75)
    both(fit.matte, surround, srgb(0x141618), smooth=75, shade=.3)
    glass = K.facing(K.disc((1.045, 1.176, -.857), (0, 0, 1), .080, n, .058), (0, 0, 1))
    both(fit.matte, glass, srgb(0x6d7f88), shade=.15)
    hit = fit.on(RIGHT, (-.915, 1.118))
    door = hit[0].x if hit else .9
    foot = K.outward(K.loft([ring(door - .01, 1.118, -.925, .028, .05, 4), ring(.955, 1.135, -.925, .03, .04, 4)]))
    both(fit.matte, foot, BLACK)


def handles(fit):
    """Bright pull handles on the shoulder line, each over a dark finger cup."""
    for z in (-.115, .805):
        hit = fit.on(RIGHT, (z, 1.035))
        if not hit:
            continue
        p, n = hit
        up = V((0, 1, 0))
        along = V((0, 0, 1))
        rings = []
        for dz, out, half in ((-.092, .004, .010), (-.07, .022, .014), (.06, .024, .014), (.086, .004, .010)):
            c = p + along * dz
            rings.append([c + n * out + up * half, c + n * out - up * half, c + n * .002 - up * half, c + n * .002 + up * half])
        both(fit.paint, K.outward(K.loft(rings)), CHROME, shade=.4)
        if not fit.low:
            cup = K.facing(K.disc(p + n * .0018 - up * .004, n, .082, 10, .03), n)
            both(fit.matte, cup, srgb(0x1c1e1f), shade=0)


def shut_lines(fit):
    """Panel gaps, drawn as fine dark lines on the skin."""
    if fit.low:
        return
    matte, w = fit.matte, .006
    arch = lambda axle, a0, a1, r, n=8: [(axle + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), .35 + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    side = [
        [(-.84, .405), (-.90, .62), (-.935, .86), (-.94, 1.0), (-.925, 1.10)],                    # front door, leading edge
        [(-.84, .405), (.085, .405)],                                                               # front door, bottom
        [(.085, .405), (.085, B.belt(.085))],                                                       # between the doors
        [(.085, .405), (.74, .405)] + arch(1.31, 172, 118, .56, 6) + [(1.035, .93), (1.03, B.belt(1.03))],   # rear door
        [(-1.725, .52), (-1.74, .74), (-1.77, .86)],                                                # bumper to wing
        [(1.74, .56), (1.80, .76), (1.93, .885), (2.08, .9)],                                       # rear bumper to body
    ]
    for path in side:
        fit.lay(matte, RIGHT, path, w, INK, step=.05)
    # bonnet: along each wing top and across above the grille
    fit.lay(matte, TOP, [(.60, -2.02), (.715, -1.86), (.775, -1.6), (.795, -1.3), (.795, -1.04)], w, INK, step=.06)
    fit.lay(matte, FRONT, [(0, .952), (.30, .95), (.44, .935)], w, INK, step=.06)
    # tailgate: down from each lamp and across above the bumper
    fit.lay(matte, REAR, [(.728, .90), (.735, .72), (.70, .60), (.60, .575), (0, .57)], w, INK, step=.06)
    # fuel flap, left side only
    flap = rounded([(1.50, .96), (1.66, .96), (1.66, 1.10), (1.50, 1.10)], .03, 3)
    verts, faces, normals = fit.strip(RIGHT, flap + [flap[0]], w * .8, step=.03)
    mv = [V((-v.x, v.y, v.z)) for v in verts]
    mn = [V((-n.x, n.y, n.z)) for n in normals]
    mf = [tuple(reversed(f)) for f in faces]
    matte.add(mv, mf, INK, True, [[mn[i] for i in f] for f in mf], shade=0)


def visors(fit):
    """Smoked rain visors over the door glass, standing off the frame as on the owner's car."""
    tint = fit.car.bucket('Rear tint')
    step = .12 if fit.low else .06
    for path in ([(-.80, 1.262), (-.63, 1.405), (-.49, 1.515), (-.40, 1.557), (-.2, 1.573), (.03, 1.58)],
                 [(.135, 1.58), (.5, 1.573), (.93, 1.553)]):
        pts = [fit.on(RIGHT, q) for q in resample(path, step)]
        top, bottom = [], []
        for i, (p, n) in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)][0] - pts[max(i - 1, 0)][0]).normalized()
            down = n.cross(t).normalized()
            if down.y > 0:
                down = -down
            ease = min(1.0, .35 + i / 3, .35 + (len(pts) - 1 - i) / 3)
            ease = min(ease, max(.12, (p.z + .80) / .42))        # slim down the front pillar, where the driver looks past it
            top.append(p + n * .004 - down * .012)
            bottom.append(p + n * (.006 + .03 * ease) + down * .058 * ease)
        sheet = K.facing(K.sheet([top, bottom]), (1, 0, 0))
        both(tint, sheet, (1, 1, 1))
        if not fit.low:           # the inside face: on a phone the camera cuts it into a dark shard by the pillar
            both(tint, K.flipped(sheet), (1, 1, 1))


def wipers(fit):
    if fit.low:
        return
    matte = fit.matte

    def blade(frame, a, b, pivot):
        pa, pb, pp = fit.on(frame, a), fit.on(frame, b), fit.on(frame, pivot)
        if not (pa and pb and pp):
            return
        lift = .012
        matte.add_solid(K.outward(K.tube([pa[0] + pa[1] * lift, pb[0] + pb[1] * lift], .007, 4)), BLACK, shade=0)
        mid = (pa[0] + pa[1] * lift).lerp(pb[0] + pb[1] * lift, .45)
        matte.add_solid(K.outward(K.tube([pp[0] + pp[1] * .012, mid + pa[1] * .01], .006, 4)), srgb(0x141516), shade=0)
    blade(B.WINDSCREEN_FRAME, (.60, .075), (.03, .112), (.64, .012))
    blade(B.WINDSCREEN_FRAME, (.0, .06), (-.52, .078), (.06, .0))
    blade(B.REAR_GLASS_FRAME, (.05, .065), (-.34, .11), (.02, .028))


def roof_kit(fit):
    """Low roof rails, the mail sign, the amber lamp on its magnet foot, and the aerial."""
    matte, low = fit.matte, fit.low
    # rails
    path = [(.628, -.24), (.636, .2), (.632, .9), (.618, 1.45), (.60, 1.74)]
    pts = [fit.on(TOP, q) for q in resample(path, .25 if low else .12)]
    rings = []
    for i, (p, n) in enumerate(pts):
        end = min(i, len(pts) - 1 - i)
        h = .004 if end == 0 else .03
        w = .016 if end == 0 else .021
        out = V((1, 0, 0))
        rings.append([p + out * w + n * .002, p + out * w * .7 + n * h, p - out * w * .7 + n * h, p - out * w + n * .002])
    both(matte, K.outward(K.loft(rings)), srgb(0x101213))

    # sign: a wedge-sided box, wide faces to the road ahead and behind
    cx, cz = .18, .48
    roof = max(fit.on(TOP, (cx + dx, cz))[0].y for dx in (-.3, 0, .3))
    y0 = roof + .03
    section = [(-.172, 0), (-.178, .014), (-.106, .214), (-.094, .224), (.094, .224), (.106, .214), (.178, .014), (.172, 0)]
    rings = []
    for x, scale in ((cx - .382, .93), (cx - .37, 1), (cx + .37, 1), (cx + .382, .93)):
        rings.append([V((x, y0 + y * scale + (.224 * (1 - scale) / 2), cz + z * scale)) for z, y in section])
    box = K.outward(K.loft(rings))
    sign = fit.car.bucket('Sign atlas', name='sign_light')
    kit = fit.car.bucket('Matte', name='roof_kit')       # sign feet and lamp foot: hidden with the mail trim
    blank = A.spot(A.SIGN_BLANK)
    sign.add(box[0], box[1], uvs=[[blank] * len(f) for f in box[1]])
    u0, v0, u1, v1 = A.rect(A.SIGN)
    for end in (-1, 1):
        normal = V((0, .072, end * .2)).normalized()
        quad = []
        for sx, sy in ((1, 0), (-1, 0), (-1, 1), (1, 1)):
            z = end * (.178 - .072 * (.06 + .88 * sy))
            quad.append(V((cx + sx * end * -.36, y0 + .014 + .2 * (.06 + .88 * sy), cz + z)) + normal * .0025)
        face = (0, 1, 2, 3)
        if K._newell(quad).dot(normal) < 0:
            face = (3, 2, 1, 0)
        uv = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
        sign.add(quad, [face], uvs=[[uv[i] for i in face]])
    for dx in (-.26, .26):
        foot_y = fit.on(TOP, (cx + dx, cz))[0].y
        kit.add_solid(K.box((cx + dx, (foot_y + y0) / 2, cz), (.09, y0 - foot_y + .02, .24)), srgb(0x0e0f10))

    # amber lamp
    bx, bz = -.39, 1.15
    by = fit.on(TOP, (bx, bz))[0].y
    seg = 8 if low else 14
    base = lathe_facing([(.118, by - .006), (.118, by + .028), (.106, by + .04), (.0, by + .04)], seg, axis='y', centre=(bx, 0, bz))
    kit.add_solid(base, srgb(0x0d0e0f))
    top = 1.9550010
    ribs = [(.102, by + .04), (.105, by + .06)]
    h = top - (by + .06) - .03
    for i in range(1, 5):
        y = by + .06 + h * i / 4
        ribs += [(.099 - .012 * i / 4, y - .008), (.103 - .013 * i / 4, y)]
    ribs += [(.07, top - .008), (.0, top)]
    lens = lathe_facing(ribs if not low else [(.102, by + .04), (.104, by + .07), (.088, top - .03), (.06, top - .006), (0, top)],
                        seg, axis='y', centre=(bx, 0, bz))
    fit.car.bucket('Amber beacon', name='beacon').add_solid(lens)

    # aerial, at the back of the roof on the centre line
    ay = fit.on(TOP, (0, 1.80))[0].y
    matte.add_solid(K.outward(K.tube([(0, ay - .004, 1.80), (0, ay + .03, 1.812), (0, ay + .19, 1.885)], [.022, .012, .004], 5)), srgb(0x0c0d0e))


# ---------------------------------------------------------------- mud

def mud_top(z):
    """How high the dirt climbs: thrown up the doors behind the front wheels, and again behind the rear ones."""
    return B.interp([(-2.3, .60), (-1.75, .66), (-1.31, .74), (-.86, 1.0), (-.45, .96), (.15, .84), (.86, .78),
                     (1.31, .80), (1.76, .96), (2.3, .82)], z)


def mud(fit):
    """A film just proud of the lower body, with the car's own mud tile repeating along it. setDirt() fades it."""
    shell = fit.shell
    bucket = fit.car.bucket('Mud overlay')

    def v_of(co):
        return max(0.0, min(1.0, (co.y - .27) / (mud_top(co.z) - .27)))
    faces = []
    for region in (B.PAINT, B.CLAD, B.ARCH):
        for f in shell.by_region.get(region, []):
            if not f.is_valid or abs(shell.normal(f.calc_center_median()).x) < .30:
                continue
            if min(v_of(v.co) for v in f.verts) < (.6 if fit.low else .85):
                faces.append(f)
    # one tile per metre of car; the tile's top row is clean and its bottom row is thick mud
    add_faces(bucket, faces, (1, 1, 1), shell.normal, lambda co: (co.z + 2.4, max(.012, min(.985, 1 - v_of(co)))), lift=.0022)


# ---------------------------------------------------------------- wheels

def wheel(car):
    """Five twin spokes, as on the owner's alloys. Local X is the axle; the outer face looks along +X.

    One wheel is modelled. The file stores it once and the other three wheels reuse it; the left ones are turned
    half a turn about the upright axis, which puts the outer face outwards again.
    """
    s = 1
    low = car.low
    seg = 12 if low else 24
    matte = car.bucket('Matte', parent='wheel_fr', name='wheel_Matte', shade='wheel')
    metal = car.bucket('Body paint', parent='wheel_fr', name='wheel_Alloy', shade='wheel')
    for bucket in (matte, metal):
        bucket.copies = [('wheel_rr', False), ('wheel_fl', True), ('wheel_rl', True)]
    wall, tread, groove = srgb(0x1b1d1e), srgb(0x151617), srgb(0x08090a)
    if low:
        profile = [(.232, -.104), (.31, -.116), (.35, -.076), (.35, .076), (.31, .116), (.232, .104)]
        colours = [wall, tread, tread, tread, wall]
    else:
        profile = [(.230, -.104), (.262, -.114), (.306, -.116), (.336, -.104), (.35, -.078), (.35, -.036), (.35, -.022),
                   (.35, .022), (.35, .036), (.35, .078), (.336, .104), (.306, .116), (.262, .114), (.230, .104)]
        colours = [wall, wall, wall, None, tread, groove, tread, groove, tread, None, wall, wall, wall]
    tyre = K.outward(K.lathe(profile, seg))
    face_colours = []
    for band in colours:
        for i in range(seg):
            face_colours.append(band if band else (tread if i % 2 else srgb(0x1e2022)))
    matte.add(tyre[0], tyre[1], face_colours)

    face_x = .104
    if low:
        matte.add_solid(K.facing(K.disc((s * (face_x - .012), 0, 0), (s, 0, 0), .232, seg), (s, 0, 0)), srgb(0x1a1b1c))
        ring = ([V((s * face_x, r * math.cos(math.tau * i / seg), r * math.sin(math.tau * i / seg))) for r in (.236, .205) for i in range(seg)],
                [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)])
        metal.add_solid(K.facing(ring, (s, 0, 0)), ALLOY)
        metal.add_solid(K.facing(K.disc((s * face_x, 0, 0), (s, 0, 0), .07, 8), (s, 0, 0)), ALLOY)
    else:
        rim = lathe_facing([(.231, s * .100), (.238, s * .115), (.229, s * .122), (.215, s * .110), (.208, s * -.03)], seg)
        metal.add_solid(rim, ALLOY)
        matte.add_solid(K.facing(K.disc((s * -.03, 0, 0), (s, 0, 0), .209, seg), (s, 0, 0)), srgb(0x0e0f10))
        matte.add_solid(K.facing(K.disc((s * .03, 0, 0), (s, 0, 0), .158, seg), (s, 0, 0)), srgb(0x6e6259))
        hub = lathe_facing([(.076, s * .078), (.071, s * .098), (.052, s * .107), (.0, s * .109)], 12)
        metal.add_solid(hub, ALLOY)
    for i in range(5):
        base = math.pi / 2 + math.tau * i / 5
        for twin in (-1, 1):
            if low:
                a0, a1 = base + twin * math.radians(9), base + twin * math.radians(19)
                quad = []
                for a, r, half in ((a0, .06, .017), (a1, .21, .014)):
                    d = V((0, math.cos(a), math.sin(a)))
                    t = V((0, -math.sin(a), math.cos(a)))
                    quad += [V((s * (face_x + .001), 0, 0)) + d * r + t * half, V((s * (face_x + .001), 0, 0)) + d * r - t * half]
                metal.add_solid(K.facing((quad, [(0, 1, 3, 2)]), (s, 0, 0)), ALLOY)
                continue
            rings = []
            for r, spread, width, thick, x in ((.06, 9, .030, .030, .088), (.13, 13, .026, .020, .100), (.214, 20, .031, .016, .112)):
                a = base + twin * math.radians(spread)
                d = V((0, math.cos(a), math.sin(a)))
                t = V((0, -math.sin(a), math.cos(a)))
                c = d * r
                rings.append([c + t * width / 2 + V((s * x, 0, 0)), c - t * width / 2 + V((s * x, 0, 0)),
                              c - t * width / 2 + V((s * (x - thick), 0, 0)), c + t * width / 2 + V((s * (x - thick), 0, 0))])
            metal.add_solid(K.outward(K.loft(rings)), ALLOY, smooth=False)
        if not low:
            a = base + math.tau / 10
            c = V((0, math.cos(a) * .05, math.sin(a) * .05))
            nut = lathe_facing([(.011, s * .09), (.011, s * .106), (.0, s * .106)], 5, centre=tuple(c))
            matte.add_solid(nut, srgb(0x3c3f41))
