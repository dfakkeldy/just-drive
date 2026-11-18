"""The mail car's body shell: the smooth form with every visible region drawn onto it.

Each region below is a flat outline read off the owner's photos (side glass
with its falling top line and thick rear pillar, tall lamps beside the rear
glass, swept headlamps, two-tier grille), cut into the right-hand half of the
body and then mirrored. The outlines are original drawings; no photo is used
by this file.
"""
import math

import bmesh
import bpy
from mathutils import Vector

import car_form
from car_cut import (FRONT, REAR, RIGHT, Master, circle, corner_frame, cut_plane, cut_polygon, mirror_x, offset_path,
                     point_in_polygon, rounded, spline, tilted_frame)
from car_kit import srgb

(PAINT, SEAL, WINDSCREEN, DOOR_GLASS, TINT, CHROME, CLAD, ARCH, LENS, RED_UP, CLEAR, RED_LOW, GRILLE, INTAKE, FOG,
 COWL, REFLECTOR, GONE) = range(18)

PAINT_COLOUR = srgb(0xbfc1be)
COLOURS = {
    SEAL: srgb(0x0c0e0f), CLAD: srgb(0x474b4c), ARCH: srgb(0x232527), COWL: srgb(0x121415),
    GRILLE: srgb(0x08090a), INTAKE: srgb(0x0a0b0c), CHROME: srgb(0xf0f2ef), CLEAR: srgb(0xf3f3ee),
    FOG: srgb(0xf2efdc), REFLECTOR: srgb(0xb81a1e),
}

AXLES = car_form.AXLES
ARCH_OPEN, ARCH_LIP, FLARE_ROOT = car_form.ARCH_OPEN, car_form.ARCH_LIP, car_form.FLARE_ROOT
WINDSCREEN_FRAME = tilted_frame((0, 1.118, -1.20), 36.5)
REAR_GLASS_FRAME = tilted_frame((0, 1.185, 2.245), 67, rear=True)
HEAD_FRAME = corner_frame(42)
TAIL_FRAME = corner_frame(50, rear=True)


# Tail lamp lens: distance in from its edge (m) -> how far it stands out of the body (m).
LENS_PROFILE = [(0, 0), (.007, .009), (.012, .009), (.018, .0035), (9, .0035)]


def edge_distance(q, poly):
    """How far a point is from a closed outline (both flat)."""
    best = 1e9
    for i, a in enumerate(poly):
        b = poly[(i + 1) % len(poly)]
        ax, ay, bx, by = a[0], a[1], b[0], b[1]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy or 1e-12)))
        best = min(best, math.hypot(q[0] - ax - dx * t, q[1] - ay - dy * t))
    return best


def interp(table, t):
    if t <= table[0][0]:
        return table[0][1]
    for (a, ya), (b, yb) in zip(table, table[1:]):
        if t <= b:
            return ya + (yb - ya) * (t - a) / (b - a)
    return table[-1][1]


def belt(z):
    """Bottom edge of the side glass: it climbs towards the rear."""
    return interp([(-1.02, 1.104), (-.4, 1.118), (.12, 1.135), (1.0, 1.186), (1.78, 1.226)], z)


def clip(poly, axis, limit, keep_less):
    """Sutherland-Hodgman against one straight line."""
    out = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        pin = (p[axis] <= limit) == keep_less
        qin = (q[axis] <= limit) == keep_less
        if pin:
            out.append(p)
        if pin != qin:
            t = (limit - p[axis]) / (q[axis] - p[axis])
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def round_sharp(poly, radius, sharp=25):
    """Rounds only the real corners of a finely sampled outline."""
    radii = []
    for i, p in enumerate(poly):
        a = Vector(poly[i - 1]) - Vector(p)
        b = Vector(poly[(i + 1) % len(poly)]) - Vector(p)
        turn = 180 - math.degrees(a.angle(b, math.pi)) if a.length > 1e-9 and b.length > 1e-9 else 0
        radii.append(radius if turn > sharp else 0)
    return rounded(poly, radii)


# ---------------------------------------------------------------- outlines (all original, in metres)

def side_glass():
    """Returns (whole dark glass shape, [front door pane, rear door pane, quarter pane], bright waist strip)."""
    top = spline([(-.415, 1.547), (-.2, 1.566), (.12, 1.573), (.6, 1.563), (1.0, 1.541), (1.25, 1.508),
                  (1.48, 1.445), (1.65, 1.352), (1.745, 1.268), (1.778, 1.229)], samples=5, closed=False)
    waist = [(1.6, belt(1.6)), (1.0, belt(1.0)), (.12, belt(.12)), (-.4, belt(-.4))]
    outline = [(-.915, 1.106), (-.775, 1.24), (-.59, 1.397)] + top + waist
    radii = [.012, 0, 0, .035] + [0] * (len(top) - 2) + [.028] + [0] * len(waist)
    whole = rounded(outline, radii)
    inner = offset_path(whole, -.016, closed=True)
    panes = []
    for front, rear in ((-.80, .03), (.135, .93), (1.02, 9)):
        pane = clip(clip(inner, 0, front, False), 0, rear, True)
        panes.append(round_sharp(pane, .014))
    start = next(i for i, p in enumerate(whole) if p[0] > 1.25)
    path = whole[start:] + [whole[0]]
    strip = path + offset_path(path, .017)[::-1]
    return whole, panes, strip


def windscreen():
    def crease(x):
        return .144 * (x / .815) ** 2
    xs = [0, .2, .4, .6, .72]
    base = [(x, crease(x) + .036) for x in xs]
    glass = base + [(.772, .165), (.662, .888), (.35, .905), (0, .895)]
    glass = rounded(glass, [0] * len(base) + [.04, .05, 0, 0])
    scuttle = [(x, crease(x) - .014) for x in xs + [.80]] + [(.80, crease(.8) + .05)] + [(x, crease(x) + .037) for x in reversed(xs)]
    return glass, scuttle


def rear_glass():
    return rounded([(0, .03), (.585, .03), (.685, .075), (.66, .20), (.565, .402), (0, .414)], [0, .05, .05, 0, .03, 0])


def upper_grille():
    return rounded([(0, .832), (.325, .838), (.375, .868), (.392, .912), (.372, .938), (0, .945)], [0, .03, .02, .015, .012, 0])


def second_grille():
    """The lower deck of the two-tier face: a slim mouth under a body-colour bar."""
    return rounded([(0, .712), (.36, .717), (.435, .752), (.415, .792), (0, .80)], [0, .03, .02, .015, 0])


def lower_intake():
    return rounded([(0, .33), (.40, .33), (.475, .40), (.45, .452), (0, .46)], [0, .03, .03, .02, 0])


# ---------------------------------------------------------------- the shell

class Shell:
    pass


def _flare(bm):
    for v in bm.verts:
        v.co.x += math.copysign(car_form.arch_flare(v.co), v.co.x) if abs(v.co.x) > 1e-6 else 0.0


def _half(level, flare=True):
    mesh = car_form.subdivide(level)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)
    if flare:
        _flare(bm)
    return bm


def build_shell(level, lite=False):
    """Returns a Shell: .bm (the whole cut body; a face's region is its material_index) and .master (the uncut skin)."""
    full = _half(3)
    master = Master(full)
    full.free()
    bm = _half(level, flare=False)      # the wheel-arch flare goes on after its rings are cut (below)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().x < 0], context='FACES')
    # Flat stretches (doors, roof) need few faces: the shading comes from the smooth master, not from the faces.
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(5.0 if lite else 1.5), verts=bm.verts[:], edges=bm.edges[:])
    bm.normal_update()

    def paint(faces, region, only=None):
        for f in faces:
            if only is None or f.material_index in only:
                f.material_index = region
        bm.normal_update()

    def lower(z_from, z_to):
        return [f for f in bm.faces if z_from < f.calc_center_median().z < z_to and f.calc_center_median().y < .75]

    # Lower cladding: grey plastic along the sills and the lower halves of both bumpers.
    _, below = cut_plane(bm, lower(-9, -1.66), (0, .49, -2.30), (0, 1, -.05))
    paint([f for f in below if f.calc_center_median().z < -1.66], CLAD)
    _, below = cut_plane(bm, lower(1.66, 9), (0, .525, 0), (0, 1, 0))
    paint([f for f in below if f.calc_center_median().z > 1.66], CLAD)
    _, below = cut_plane(bm, lower(-1.0, 1.0), (0, .392, 0), (0, 1, 0))
    paint([f for f in below if -1.0 < f.calc_center_median().z < 1.0], CLAD)

    # Wheel openings with their black lips.
    for axle in AXLES:
        cut_polygon(bm, circle((axle, car_form.WHEEL_Y), FLARE_ROOT, 20 if lite else 40), RIGHT)   # only to give the flare its root edge
        paint(cut_polygon(bm, circle((axle, car_form.WHEEL_Y), ARCH_LIP, 20 if lite else 40), RIGHT), ARCH)
        paint(cut_polygon(bm, circle((axle, car_form.WHEEL_Y), ARCH_OPEN, 20 if lite else 40), RIGHT), GONE)
    _flare(bm)
    bm.normal_update()
    # The floor goes: a flat under-tray and the wheel housings replace it (see car_parts).
    paint([f for f in bm.faces if f.normal.y < -.55 and f.calc_center_median().y < .34], GONE)

    # Side glass: one dark shape, three panes, a bright strip under it and round the back.
    whole, panes, strip = side_glass()
    paint(cut_polygon(bm, whole, RIGHT), SEAL)
    paint(cut_polygon(bm, panes[0], RIGHT), DOOR_GLASS)
    paint(cut_polygon(bm, panes[1], RIGHT), TINT)
    paint(cut_polygon(bm, panes[2], RIGHT), TINT)
    if not lite:
        paint(cut_polygon(bm, strip, RIGHT), CHROME, only=(PAINT,))

    # Windscreen with the black scuttle under it, and the rear glass.
    glass, scuttle = windscreen()
    paint(cut_polygon(bm, scuttle, WINDSCREEN_FRAME, where=lambda f: f.calc_center_median().z < -.3), COWL)
    paint(cut_polygon(bm, glass, WINDSCREEN_FRAME, where=lambda f: f.calc_center_median().z < -.3), WINDSCREEN)
    paint(cut_polygon(bm, rear_glass(), REAR_GLASS_FRAME, where=lambda f: f.calc_center_median().z > 1.7), TINT)

    # Tall rear lamp: up the pillar beside the glass, round the corner onto the body side.
    def on(frame, q):
        hit = master.drop(frame, q)
        return TAIL_FRAME.to2d(hit[0])
    inner = [(.588, 1.558), (.628, 1.45), (.668, 1.33), (.702, 1.21), (.716, 1.10), (.722, .99), (.724, .905)]
    outer = [(2.06, .905), (2.01, .98), (1.985, 1.08), (2.0, 1.18), (1.985, 1.27), (1.945, 1.36), (1.895, 1.46), (1.845, 1.558)]
    lamp = [on(REAR, q) for q in inner] + [on(RIGHT, q) for q in outer]
    lamp = rounded(spline(lamp, samples=3, closed=True), 0)
    lamp_faces = cut_polygon(bm, lamp, TAIL_FRAME, where=lambda f: f.calc_center_median().z > 1.6 and f.calc_center_median().y > .8)
    paint(lamp_faces, RED_UP)
    if not lite:
        # The lens stands proud of the body: a bevelled edge, a rim, then a face set back inside the rim.
        # Rings are cut where the profile turns, and each vertex moves by its distance in from the lamp's edge.
        tail_where = lambda f: f.material_index == RED_UP
        inward = -1 if point_in_polygon(offset_path(lamp, -.01, closed=True)[0], lamp) else 1
        coarse = lamp[::2]                # the rings need fewer points than the lamp's own edge
        for d in LENS_PROFILE[1:-1]:
            cut_polygon(bm, offset_path(coarse, inward * d[0], closed=True), TAIL_FRAME, where=tail_where)
        bm.normal_update()
        moved = {v for f in bm.faces if f.material_index == RED_UP for v in f.verts}
        for v in moved:
            v.co += master.normal(v.co) * interp(LENS_PROFILE, edge_distance(TAIL_FRAME.to2d(v.co), lamp))
        bm.normal_update()
    _, below = cut_plane(bm, [f for f in bm.faces if f.material_index == RED_UP], (0, 1.135, 0), (0, 1, 0))
    above2, below2 = cut_plane(bm, below, (0, .99, 0), (0, 1, 0))
    paint(above2, CLEAR)
    paint(below2, RED_LOW)

    # Swept headlamp: a point by the grille, widening round the corner and running back along the wing.
    def onh(frame, q):
        return HEAD_FRAME.to2d(master.drop(frame, q)[0])
    head = ([onh(FRONT, q) for q in [(.425, .884), (.51, .928), (.60, .953), (.69, .97)]]
            + [onh(RIGHT, q) for q in [(-1.90, .988), (-1.78, 1.0), (-1.66, .994), (-1.70, .935), (-1.82, .865)]]
            + [onh(FRONT, q) for q in [(.75, .808), (.63, .795), (.51, .818)]])
    head = spline(head, samples=4, closed=True)
    paint(cut_polygon(bm, head, HEAD_FRAME, where=lambda f: f.calc_center_median().z < -1.5 and f.calc_center_median().y > .7), LENS)

    # Two-tier face: a slim upper grille between the lamps, a wide intake in the bumper, fog lamps low in the corners.
    nose = lambda f: f.calc_center_median().z < -1.8
    paint(cut_polygon(bm, upper_grille(), FRONT, where=nose), GRILLE)
    paint(cut_polygon(bm, second_grille(), FRONT, where=nose), GRILLE)
    paint(cut_polygon(bm, lower_intake(), FRONT, where=nose), INTAKE)
    if not lite:
        paint(cut_polygon(bm, circle((.675, .412), .048, 14), FRONT, where=nose), FOG)
        # Red reflectors low in the rear bumper.
        paint(cut_polygon(bm, rounded([(.50, .385), (.70, .385), (.70, .425), (.50, .425)], .012, 2), REAR,
                          where=lambda f: f.calc_center_median().z > 1.8), REFLECTOR)

    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == GONE], context='FACES')
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=.0009)
    # The cuts leave edges that no longer separate anything. Take them out again, region by region; glass and
    # lenses are smooth and shade from the master, so they can lose more.
    glassy = {WINDSCREEN, DOOR_GLASS, TINT, LENS}
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(4.0 if lite else 1.5), verts=bm.verts[:], edges=bm.edges[:], delimit={'MATERIAL'})
    inside = [e for e in bm.edges if len(e.link_faces) == 2 and all(f.material_index in glassy for f in e.link_faces)]
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(9.0), verts=list({v for e in inside for v in e.verts}), edges=inside, delimit={'MATERIAL'})
    bm.normal_update()
    # Openings sit back from the skin: the grilles deep, the fog lamps a little.
    for region, depth in ((GRILLE, .028), (INTAKE, .034), (FOG, .014)):
        recess(bm, region, depth)
    mirror_x(bm)
    shell = Shell()
    shell.bm, shell.master = bm, master
    shell.tail_outline, shell.head_outline = lamp, head
    return shell


def recess(bm, region, depth):
    """Pushes a region's inner vertices into the body. Its outer ring of faces becomes the sloped wall."""
    centre = lambda v: abs(v.co.x) < 1e-6     # before the mirror, the centre line looks like an edge: it is not one
    inside = [v for v in bm.verts if v.link_faces and all(f.material_index == region for f in v.link_faces)
              and (not v.is_boundary or centre(v))]
    for v in inside:
        v.co -= (Vector((0, v.normal.y, v.normal.z)).normalized() if centre(v) else v.normal) * depth
    bm.normal_update()


LINER_INSET = .016      # how far inside the skin the cabin lining sits
LITE_LINER_FLAT = 16.0  # degrees: edges flatter than this are taken out of the phone car's lining
LINER_LEVEL_LITE = 2      # the phone car's lining starts from a finer body than the desktop's, and loses more edges


def build_liner(lite):
    """The cabin's inner skin: the body's own shape a little way in, facing inwards, with the window openings cut.

    A face's material_index is PAINT (headlining and pillars), CLAD (door cards, below the glass) or SEAL (the dark
    rubber round an opening).
    """
    bm = _half(LINER_LEVEL_LITE if lite else 1)
    bm.normal_update()
    for v in bm.verts:        # move in first, so the openings cut below line up with the glass seen from outside
        v.co -= (Vector((0, v.normal.y, v.normal.z)).normalized() if abs(v.co.x) < 1e-6 else v.normal) * LINER_INSET

    def keep(f):
        c = f.calc_center_median()
        if c.x < 0 or c.y < .40 or f.normal.y < -.5:
            return False
        if any(math.hypot(c.z - axle, c.y - car_form.WHEEL_Y) < ARCH_OPEN + .03 for axle in AXLES):
            return False                      # the wheel housing takes this space
        return c.z > -1.0 or (c.y > 1.13 and c.z > -1.3)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f)], context='FACES')
    flat = math.radians(LITE_LINER_FLAT if lite else 6.0)      # the phone car's lining has far fewer faces
    bmesh.ops.dissolve_limit(bm, angle_limit=flat, verts=bm.verts[:], edges=bm.edges[:])
    bm.normal_update()
    seal = 0 if lite else .006

    def area(poly):
        return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2

    def grown(poly, d):
        """The outline moved outwards by d, whichever way round it was drawn."""
        out = offset_path(poly, d, closed=True)
        return out if area(out) > area(poly) else offset_path(poly, -d, closed=True)

    def open_up(outline, frame, where=None, half=False):
        """Cuts one window opening, as large as its glass, with a dark rubber seal round it.

        A half outline (windscreen, rear glass) still reaches the centre line, so no strip of lining is left there.
        """
        for d, region in ((seal, SEAL), (0, GONE)):
            if region == SEAL and not d:
                continue
            moved = grown(outline, d) if d else outline
            if half:
                moved = [(-.002, q[1]) if abs(p[0]) < 1e-6 else q for p, q in zip(outline, moved)]
            for f in cut_polygon(bm, moved, frame, where=where):
                f.material_index = region
    for f in bm.faces:
        f.material_index = PAINT
    _, panes, _ = side_glass()
    for pane in panes:
        open_up(pane, RIGHT)
    glass, _ = windscreen()
    open_up(glass, WINDSCREEN_FRAME, lambda f: f.calc_center_median().z < -.3, half=True)
    open_up(rear_glass(), REAR_GLASS_FRAME, lambda f: f.calc_center_median().z > 1.7, half=True)
    # Below the glass the lining is door card and load-area trim: a plane that climbs with the belt line parts them.
    _, below = cut_plane(bm, [f for f in bm.faces if f.material_index == PAINT], (0, 1.097, -.8), (0, 1, -.0458))
    for f in below:
        if f.material_index == PAINT:
            f.material_index = CLAD
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == GONE], context='FACES')
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=.0009)
    # The cuts leave edges that part nothing: take them out again, colour by colour.
    bmesh.ops.dissolve_limit(bm, angle_limit=flat, verts=bm.verts[:], edges=bm.edges[:], delimit={'MATERIAL'})
    mirror_x(bm)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update()
    return bm
