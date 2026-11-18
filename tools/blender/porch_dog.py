"""The porch dog: an old red golden retriever that lies on a porch with its head up and watches the road.

Built from numbers alone (see animal_kit.py): no photos, no textures, no downloaded assets. Run with Blender:

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/porch_dog.py [-- <folder>]

It writes porch-dog.glb (desktop) and porch-dog-low.glb into web/public/models, or into the folder given.

The pose is fixed: the chest and the forelegs rest on the floor (a sphinx), the rump rolls onto one hip so both
hind feet lie on one side, the tail lies behind in a curve. The game turns only two joints, `neck` and `head`,
about the vertical axis, and may sweep `tail` a little. Axes: +X is the dog's right, +Y up, it faces -Z.

A golden's coat is short and smooth on the back and the head, and long where it feathers: the ruff, the chest,
the belly line, the breeches and the tail. So here the skin itself carries the coat's colour, and strands are
sparse and flat on the back, long and dense where the coat feathers.
"""
import json, math, random, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animal_kit import BACK, DOWN, UP, X, Part, dome, emit, grow, measure, occlude, scatter, sgnpow, skin_tree, smooth, spline, srgb, strand_mesh, swirl, vary

SEED = 20261113
FEET = 1            # the side the hind feet lie on: +1 is the dog's right
TAIL = -1           # the side the tail curls to
FLOOR = .006        # the coat lies this far above the boards

# The game's tone curve deepens dark paint and bleaches pale paint. So the coat is lighter here than a red golden
# looks, and the muzzle is darker: in the game the two come out right beside each other.
RED = srgb(0xc67632)        # the coat of the back and the sides: copper, not crimson
DEEP = srgb(0xa0562a)       # the ears and the saddle
GOLD = srgb(0xdba869)       # the feathering: tail, breeches, chest, belly line
PALE = srgb(0xd6b98a)       # the toes
CROWN = srgb(0xbd7232)      # the head: a little lighter and more golden than the back
CHEEK = srgb(0xcc9556)      # an old dog's cheeks: the red has faded to light gold
MUZZLE = srgb(0xcbb99e)     # its greyed muzzle and the rings round its eyes: cream, not white
CREAM = srgb(0xdacfba)      # the chin, the palest place
NOSE, EYE, RIM, LIP = srgb(0x15110e), srgb(0x1f140c), srgb(0x33261d), srgb(0x57463b)
COLLAR, TAG = srgb(0x2b1f19), srgb(0xc3c6ca)

NECK_AT = Vector((0, .250, -.240))      # the joints, in the bind pose
HEAD_AT = Vector((0, .500, -.392))
TAIL_AT = Vector((0, .100, .430))

# The trunk from the chest to the rump: z, middle height, half width, half height.
TORSO = [(-.360, .170, .080, .120), (-.300, .172, .122, .160), (-.200, .166, .142, .184), (-.060, .158, .146, .178),
         (.100, .142, .136, .158), (.250, .136, .146, .152), (.380, .116, .118, .124), (.450, .100, .070, .080)]
# The neck: place along it, x, y, z, half width, half depth.
NECK = [(0, 0, .215, -.215, .122, .150), (1, 0, .330, -.296, .104, .116), (2, 0, .430, -.356, .086, .094), (3, 0, .512, -.398, .074, .078)]
# The head from the nose to the back of the skull: z, middle height, half width, half height.
# The muzzle is deep and ends blunt; the forehead rises steeply at the eyes (the stop); the skull is broad.
HEAD = [(-.600, .519, .035, .032), (-.584, .519, .043, .038), (-.550, .520, .046, .041), (-.500, .526, .051, .045), (-.482, .540, .064, .058),
        (-.466, .551, .074, .067), (-.445, .557, .079, .071), (-.405, .558, .080, .071), (-.362, .550, .068, .060), (-.336, .542, .044, .044)]
HEAD_POWER = .86
# The lower jaw: z, middle height, half width, half height. The mouth is shut, so the upper lips hang over most of it.
JAW = [(-.590, .493, .025, .012), (-.555, .490, .031, .016), (-.510, .488, .035, .019), (-.465, .490, .039, .022)]


def head_point(z, angle, side=1):
    """A point on the head's skin: `angle` is measured from the top of the section, toward the given side."""
    cy, a, b = spline(HEAD, z)
    return Vector((side * a * sgnpow(math.sin(angle), HEAD_POWER), cy + b * sgnpow(math.cos(angle), HEAD_POWER), z))


EYES = [head_point(-.487, math.radians(44), s) for s in (-1, 1)]


def oval(cx, cy, cz, a, b, sides, power=.85, floor=None):
    """One section: a rounded shape in the x-y plane. Where it would go under the floor it lies flat and spreads."""
    ring = []
    for k in range(sides):
        t = math.tau * k / sides
        x, y = a * sgnpow(math.sin(t), power), cy + b * sgnpow(math.cos(t), power)
        if floor is not None and y < floor:
            x *= 1 + .35 * min(1, (floor - y) / b); y = floor
        ring.append(Vector((cx + x, y, cz)))
    return ring


def tube(part, keys, count, sides, colour, floor=None, cap0=None, cap1=None, power=.85):
    """Loft sections along z from rows (z, middle height, half width, half height). colour(point) per vertex."""
    rings = []
    for i in range(count):
        z = keys[0][0] + (keys[-1][0] - keys[0][0]) * i / (count - 1)
        cy, a, b = spline(keys, z)
        rings.append(oval(0, cy, z, a, b, sides, power, floor))
    return part.loft(rings, [[colour(p) for p in ring] for ring in rings], cap0, cap1)


def lump(part, centre, rx, ry, rz, count, sides, colour, floor=None):
    """An egg: sections along z whose size follows a half circle."""
    rings = []
    for i in range(count):
        s = -1 + 2 * (i + .5) / count
        k = math.sqrt(1 - s * s)
        rings.append(oval(centre.x, centre.y, centre.z + rz * s, rx * k, ry * k, sides, .9, floor))
    ends = [Vector((centre.x, centre.y, centre.z + rz * s)) for s in (-1, 1)]
    return part.loft(rings, [[colour(p) for p in ring] for ring in rings], (ends[0], colour(ends[0]), -BACK), (ends[1], colour(ends[1]), BACK))


def flap(part, rows, side, sides, colour):
    """An ear: thin sections that hang from rows (x, y, z, half width front to back, half thickness)."""
    rings = []
    for x, y, z, w, t in rows[:-1]:
        rings.append([Vector((side * x + side * t * math.sin(math.tau * k / sides), y, z + w * math.cos(math.tau * k / sides))) for k in range(sides)])
    tip = Vector((side * rows[-1][0], rows[-1][1], rows[-1][2]))
    return part.loft(rings, [[colour(p) for p in ring] for ring in rings], None, (tip, colour(tip), DOWN))


def coat(part, faces, rng, bvh, tries, radius, flow, length, tint, width, thick=.007, steps=2, lift=(.004, .011), hang=(.04, .28),
         wiggle=.08, curl=.1, turn=.13, root=.88, tip=1.06, edge=.9, floor=FLOOR):
    """Grow strands on the given faces. radius, flow, length and tint are functions of a root (point, normal)."""
    for p, n in scatter(part, faces, rng, radius, tries):
        d = flow(p, n)
        d = d - n * d.dot(n)
        if d.length < 1e-4: continue
        size = length(p, n)
        if not size: continue
        rings = grow(bvh, rng, p, n, swirl(d.normalized(), n, rng, turn), size * rng.uniform(.82, 1.18), steps, lift[0], lift[1], hang[0], hang[1],
                     wiggle=wiggle, curl=curl, floor=floor)
        strand_mesh(part, rings, width * rng.uniform(.85, 1.2), thick, False, vary(tint(p), rng, .07, .04), root, tip, rng, edge)


def face_colour(p):
    """An old dog's face. It stays golden: the bridge of the nose, the forehead and the cheeks. Age has greyed only
    the sides of the muzzle, the chin and a thin ring round each eye."""
    cy, a, b = spline(HEAD, p.z)
    h = (p.y - cy) / b                                              # -1 under the jaw, +1 on top
    colour = CROWN.lerp(CHEEK, .6 * smooth(.3, -.5, h))             # golden on top, lighter down the cheeks
    colour = colour.lerp(RED, .55 * smooth(-.40, -.34, p.z))        # the back of the skull joins the neck
    grey = smooth(-.490, -.526, p.z)                                # the muzzle, ahead of the eyes
    bridge = smooth(.2, .85, h)                                     # its top keeps most of its gold
    colour = colour.lerp(MUZZLE, grey * (.92 - .55 * bridge))
    ring = min((p - e).length for e in EYES)
    colour = colour.lerp(MUZZLE, .5 * smooth(.036, .021, ring))     # spectacles
    if p.z < -.47:  # the upper lip is darker along its lower edge
        colour = colour.lerp(LIP, .7 * smooth(-.45, -.85, h) * smooth(.15, .5, abs(p.x) / a))
    return colour


def torso_colour(p):
    colour = RED.lerp(DEEP, .28 * smooth(.24, .33, p.y))                                # a darker saddle
    colour = colour.lerp(GOLD, .65 * smooth(.13, .03, p.y))                             # pale where the coat meets the floor
    colour = colour.lerp(GOLD, .7 * smooth(.30, .44, p.z) * smooth(.27, .12, p.y))      # the breeches
    return colour.lerp(GOLD, .55 * smooth(-.30, -.38, p.z) * smooth(.34, .2, p.y))      # the front of the chest


def neck_colour(p):
    front = smooth(-.02, -.1, p.z - (-.215 - (p.y - .215) * .64))                       # ahead of the neck's middle line
    colour = RED.lerp(GOLD, .6 * front * smooth(.47, .3, p.y))                          # the paler ruff on the chest
    return colour.lerp(MUZZLE, .35 * front * smooth(.43, .5, p.y))                      # under the pale chin


def build(low):
    rng = random.Random(SEED + (1 if low else 0))
    coarse = 2.2 if low else 1
    body = Part('body-mesh', (0, 0, 0), 'root')
    neck = Part('neck-mesh', NECK_AT, 'neck')
    head = Part('head-mesh', HEAD_AT, 'head')
    tail = Part('tail-mesh', TAIL_AT, 'tail')

    # ---- skin -------------------------------------------------------------------------------------------------
    front, rear = Vector((0, .166, -.392)), Vector((0, .096, .476))
    torso = tube(body, TORSO, 8 if low else 15, 8 if low else 14, torso_colour, floor=0,
                 cap0=(front, torso_colour(front), -BACK), cap1=(rear, torso_colour(rear), BACK))
    # The upper thigh lies over the flank on the side of the feet.
    thigh_colour = lambda p: RED.lerp(GOLD, .7 * smooth(.2, .05, p.y) + .45 * smooth(.3, .41, p.z))
    thigh = lump(body, Vector((FEET * .116, .124, .262)), .074, .120, .146, 5 if low else 8, 7 if low else 10, thigh_colour, floor=0)

    def limb_colour(p, t=0):    # red at the elbow, gold down the leg, paler toes
        return RED.lerp(GOLD, .8 * smooth(-.24, -.42, p.z)).lerp(PALE, .4 * smooth(-.45, -.53, p.z))
    limbs = []
    for s in (-1, 1):
        ahead, toe = (.022, -.014) if s < 0 else (0, 0)     # the left paw lies a little ahead and turned in
        keys = [(0, s * .112, .085, -.215, .050, .075), (1, s * .108, .054, -.315 - ahead * .5, .041, .050), (2, s * .106, .040, -.405 - ahead, .035, .037),
                (3, s * (.106 + toe), .036, -.470 - ahead, .047, .034), (4, s * (.106 + toe * 1.6), .027, -.520 - ahead, .041, .025)]
        limbs += body.sweep(keys, 6 if low else 8, 5 if low else 8, limb_colour, cap1=GOLD.lerp(PALE, .5))

    foot_colour = lambda p, t=0: RED.lerp(GOLD, .75).lerp(PALE, .45 * smooth(.5, 1, t))
    feet = body.sweep([(0, FEET * .186, .058, .372, .034, .042), (.5, FEET * .212, .040, .290, .031, .032), (1, FEET * .226, .029, .198, .041, .027)],
                      6 if low else 8, 4 if low else 6, foot_colour, cap1=PALE * .85)
    feet += body.sweep([(0, FEET * .130, .050, .205, .034, .040), (.5, FEET * .176, .036, .125, .031, .031), (1, FEET * .206, .028, .045, .041, .026)],
                       6 if low else 8, 4 if low else 6, foot_colour, cap1=PALE * .85)

    neck_skin = neck.sweep(NECK, 8 if low else 12, 5 if low else 8, lambda p, t: neck_colour(p))

    nose_end, occiput = Vector((0, .517, -.608)), Vector((0, .541, -.324))
    head_skin = tube(head, HEAD, 9 if low else 18, 8 if low else 16, face_colour, power=HEAD_POWER,
                     cap0=(nose_end, MUZZLE * .97, -BACK), cap1=(occiput, RED.copy(), BACK))
    chin, throat = Vector((0, .494, -.598)), Vector((0, .49, -.44))
    jaw_colour = lambda p: MUZZLE.lerp(CREAM, .5 * smooth(-.54, -.59, p.z)).lerp(LIP, .7 * smooth(.480, .494, p.y))
    tube(head, JAW, 4 if low else 6, 6 if low else 8, jaw_colour, cap0=(chin, CREAM * .95, -BACK), cap1=(throat, MUZZLE * .9, BACK))
    fixed = set()
    # The nose is big and black: it covers the upper half of the muzzle's blunt end.
    fixed.update(dome(head, Vector((0, .532, -.6045)), Vector((0, .34, -1)).normalized(), .0235, .0175, .0150, 6 if low else 10, NOSE, NOSE * 2.0))
    for eye in EYES:    # dark brown eyes in a dark rim, with a small gleam
        cy = spline(HEAD, eye.z)[0]
        out = ((eye - Vector((0, cy, eye.z))).normalized() * .5 - BACK * .85).normalized()
        fixed.update(dome(head, eye - out * .001, out, .0172, .0130, .0034, 6 if low else 10, RIM, RIM * .85))
        if not low:
            fixed.update(dome(head, eye + out * .0016, out, .0136, .0102, .0054, 10, EYE, EYE * 1.6))
            fixed.update(dome(head, eye + out * .0064 + UP * .0034 + X * .0032, out, .0034, .0030, .0012, 4, CREAM * 1.05, CREAM * 1.05))
    ear_colour = lambda p: DEEP.lerp(RED, .35 * smooth(.50, .45, p.y))     # darker than the head, redder at the feathered tip
    ears = []
    for s in (-1, 1):
        ears += flap(head, [(.068, .600, -.420, .030, .012), (.087, .579, -.426, .046, .012), (.097, .537, -.433, .053, .010),
                            (.098, .493, -.441, .045, .008), (.093, .452, -.449)], s, 6 if low else 8,
                     ear_colour)

    tail_keys = [(0, 0, .100, .430, .048, .046), (1, TAIL * .035, .066, .560, .040, .038), (2, TAIL * .120, .044, .690, .032, .030),
                 (3, TAIL * .235, .034, .790, .024, .023), (4, TAIL * .350, .028, .850, .013, .013)]
    tail_skin = tail.sweep(tail_keys, 6 if low else 8, 6 if low else 10, lambda p, t: RED.lerp(GOLD, .5), cap1=GOLD * .9)

    # The collar: a dark leather band high on the neck, with a small silver tag at the throat.
    centre, along = Vector((0, .462, -.374)), Vector((0, .78, -.62)).normalized()
    nape = X.cross(along)
    band = [[centre + along * offset + X * (.091 * math.sin(math.tau * k / 12)) + nape * (.097 * math.cos(math.tau * k / 12)) for k in range(12)]
            for offset in (-.012, .012)]
    neck.loft(band, [[COLLAR] * 12, [COLLAR * 1.5] * 12], skin=False)
    neck.blob(centre - nape * .106 + DOWN * .02, X * .012, UP * .015, nape * .006, [TAG, TAG, TAG * 1.2, TAG * .8, TAG, TAG])

    # ---- coat -------------------------------------------------------------------------------------------------
    bvh = skin_tree([body, neck, head, tail])
    tries = 2600 if low else 9000
    long = 2 if low else 3

    feather = lambda p: smooth(.2, .07, p.y) + smooth(.28, .42, p.z) * smooth(.3, .16, p.y)     # 0 on the back, 1 where the coat is long
    coat(body, torso, rng, bvh, tries,
         lambda p, n: None if p.y < .012 else (.036 - .011 * min(1, feather(p))) * coarse,
         lambda p, n: BACK + DOWN * (.2 + .75 * abs(n.x)) + (DOWN * .9 if p.z < -.32 else Vector()),
         lambda p, n: .062 + .035 * min(1, feather(p)) + .008 * smooth(-.3, -.37, p.z),
         torso_colour, .023 * coarse, steps=long)
    coat(body, thigh, rng, bvh, tries // 3,
         lambda p, n: None if p.y < .012 else .028 * coarse,
         lambda p, n: BACK * .8 + DOWN * .9,
         lambda p, n: .07 + .045 * smooth(.2, .38, p.z),
         thigh_colour, .022 * coarse, hang=(.1, .45), steps=long)
    coat(body, limbs, rng, bvh, tries // 3,
         lambda p, n: None if p.y < .012 or p.z < -.44 else .025 * coarse,
         lambda p, n: -BACK + DOWN * .5 + X * (n.x * .7),
         lambda p, n: .032 + .03 * smooth(.3, .9, abs(n.x)),
         limb_colour, .018 * coarse, thick=.005, hang=(.1, .4))
    coat(body, feet, rng, bvh, tries // 6,
         lambda p, n: None if p.y < .012 or n.y < .1 else .028 * coarse,
         lambda p, n: -BACK + DOWN * .4,
         lambda p, n: .028, lambda p: RED.lerp(GOLD, .75), .018 * coarse, thick=.005)

    coat(neck, neck_skin, rng, bvh, tries // 2,
         lambda p, n: None if p.y < .2 else (.024 + .008 * smooth(.5, .3, p.y)) * coarse,
         lambda p, n: DOWN + BACK * (.5 * max(0, n.z + .3)) + X * (n.x * .25),
         lambda p, n: .026 + .042 * smooth(.5, .32, p.y),
         neck_colour, .023 * coarse, steps=long, lift=(.004, .012), hang=(.15, .5), wiggle=.12, curl=.14)

    coat(head, [f for f in head_skin if all(head.v[i].z > -.395 for i in f)], rng, bvh, tries // 6,
         lambda p, n: .024 * coarse,
         lambda p, n: BACK + DOWN * (.5 + .6 * abs(n.x)),
         lambda p, n: .024 + .010 * abs(n.x),
         face_colour, .019 * coarse, thick=.004, lift=(.002, .005), hang=(.05, .3), root=.9, edge=.95, floor=None)
    coat(head, ears, rng, bvh, tries // 4,
         lambda p, n: None if abs(n.x) < .3 or p.y > .53 else .024 * coarse,
         lambda p, n: DOWN + BACK * .15,
         lambda p, n: .020 + .016 * smooth(.53, .47, p.y),
         ear_colour, .020 * coarse, thick=.005, lift=(.002, .006), hang=(.5, .9), wiggle=.16, curl=.16, root=.86, edge=.9, floor=None)

    def plume(p, n):    # the hair of the tail falls away from it on both sides and lies on the boards
        t = smooth(.43, .85, p.z)
        along, out = Vector((TAIL * (.25 + .9 * t), 0, 1)).normalized(), Vector((n.x, 0, n.z))
        return along * .55 + (out.normalized() if out.length > .05 else along) * 1.0 + DOWN * .25
    coat(tail, tail_skin, rng, bvh, tries // 2,
         lambda p, n: None if p.y < .008 else .017 * coarse,
         plume, lambda p, n: .16 - .06 * smooth(.6, .85, p.z),
         lambda p: GOLD.lerp(RED, .3 * smooth(.04, .09, p.y)), .026 * coarse, steps=long, lift=(.003, .01), hang=(.12, .55), wiggle=.1, curl=.08, edge=.8)

    for part in (body, neck, tail):     # nothing reaches under the boards
        for v in part.v: v.y = max(v.y, .001)
    parts = [body, neck, head, tail]
    occlude(parts, floor=.72, keep={'head-mesh': fixed})
    if low:     # one mesh for all that does not turn; the head keeps its own
        body.take(neck); body.take(tail)
        parts = [body, head]
    nodes = [('root', (0, 0, 0), None), ('neck', NECK_AT, 'root'), ('head', HEAD_AT, 'neck'), ('tail', TAIL_AT, 'root')]
    return parts, nodes


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    folder = Path(args[0]) if args else Path(__file__).resolve().parents[2] / 'web' / 'public' / 'models'
    folder.mkdir(parents=True, exist_ok=True)
    report = {}
    for low in (False, True):
        parts, nodes = build(low)
        path = folder / ('porch-dog-low.glb' if low else 'porch-dog.glb')
        emit(parts, nodes, path)
        report[path.name] = {**measure(parts), 'bytes': path.stat().st_size}
    print('PORCH_DOG ' + json.dumps(report))


main()
