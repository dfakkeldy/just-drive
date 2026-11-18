"""Shared parts for animals built in Blender from numbers alone: no photos, no textures, no downloaded assets.

An animal is a few Parts (one exported mesh each). A Part gets a dark under-body from lofted rings, then a coat of
overlapping strands (ridged ribbons with forked ends) that grow from scattered roots, follow the body and then hang
with gravity. Roots are dark and ridges light, sky occlusion is baked into the vertex colours, and strands are shaded
with the body's normals: the coat is lit as one soft mass and still shows its strands in flat light.

Game animal axes (web/src/animals.ts): +X right, +Y up, forward is -Z. Units are metres. The origin is on the ground.
Every function here is deterministic for a given random.Random.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb_quantize import quantize

X, UP, DOWN, BACK = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))


def srgb(value):
    """0xRRGGBB as a linear colour: glTF vertex colours are linear."""
    def linear(c):
        c /= 255
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return Vector((linear(value >> 16 & 255), linear(value >> 8 & 255), linear(value & 255)))


def sgnpow(value, power):
    return math.copysign(abs(value) ** power, value)


def smooth(lo, hi, x):
    """0 at lo, 1 at hi, with an eased step between. lo may be above hi."""
    t = max(0, min(1, (x - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


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
    """One exported mesh: vertices, linear colours and faces in bind-pose game coordinates.

    `node` names the pivot the mesh hangs from (see emit); `pivot` is that node's place in the bind pose.
    """
    def __init__(self, name, pivot, node=None):
        self.name, self.pivot, self.node = name, Vector(pivot), node
        self.v, self.c, self.f, self.skin = [], [], [], []
        self.shade = {}     # vertex index -> shading normal, where it is not the surface's own

    def loft(self, rings, colours, cap0=None, cap1=None, skin=True):
        """Join rings of equal count. A cap is (point, colour[, outward]). Returns the new faces."""
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
        return faces

    def sweep(self, keys, sides, count, colour, cap0=None, cap1=None, skin=True):
        """A tube along any path: rows (t, x, y, z, radius across, radius up); colour(point, t) per vertex.

        Each ring stands square to the path. A cap is a colour: the tube closes on the path's end point.
        """
        centres, radii, ts = [], [], []
        for i in range(count):
            t = keys[0][0] + (keys[-1][0] - keys[0][0]) * i / (count - 1)
            x, y, z, a, b = spline(keys, t)
            centres.append(Vector((x, y, z))); radii.append((a, b)); ts.append(t)
        rings, colours = [], []
        for i, (centre, (a, b)) in enumerate(zip(centres, radii)):
            tangent = (centres[min(i + 1, count - 1)] - centres[max(i - 1, 0)]).normalized()
            side = tangent.cross(UP)
            side = side.normalized() if side.length > 1e-4 else X.copy()
            up = side.cross(tangent).normalized()
            ring = [centre + side * (a * math.sin(math.tau * k / sides)) + up * (b * math.cos(math.tau * k / sides)) for k in range(sides)]
            rings.append(ring); colours.append([colour(p, ts[i]) for p in ring])
        ends = []
        for cap, i in ((cap0, 0), (cap1, count - 1)):
            if cap is None: ends.append(None); continue
            tangent = (centres[i] - centres[1 if i == 0 else count - 2]).normalized()
            ends.append((centres[i] + tangent * (min(radii[i]) * .6), cap, tangent))
        return self.loft(rings, colours, ends[0], ends[1], skin)

    def blob(self, centre, a, b, c, colours):
        """An octahedron with half-axes a, b, c. colours: +a, -a, +b, -b, +c, -c."""
        base = len(self.v)
        self.v += [centre + a, centre - a, centre + b, centre - b, centre + c, centre - c]; self.c += [x.copy() for x in colours]
        for i in (0, 1):
            for j in (2, 3):
                for k in (4, 5):
                    face = (base + i, base + j, base + k)
                    self.f.append(facing(self.v, face, sum((self.v[x] for x in face), Vector()) / 3 - centre))

    def take(self, other):
        """Merge another part into this one (a LOW model draws fewer meshes)."""
        offset = len(self.v)
        self.v += other.v; self.c += other.c
        self.f += [tuple(i + offset for i in face) for face in other.f]
        self.shade.update({i + offset: n for i, n in other.shade.items()})

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


def strand_mesh(part, rings, width, thick, closed, tint, root, tip, rng, edge=.74):
    """One strand from spine rings [(point, outward, along)]: an off-centre ridge, two tucked edges, a forked end.

    The last ring is where the strand ends. Its two points have different lengths, so the outline reads as
    hair that has clumped, not as a leaf. One edge is darker than the other: each strand has a shadow side
    (`edge` is how dark; 1 gives a smooth coat with no shadow side).
    Its shading normals follow the body under it, not its own facets: the coat is lit as one soft mass,
    and the strands show through colour, occlusion and outline.
    """
    count = len(rings) - 1
    profile = [.86, 1.0, .9, .8]
    ridge_at = rng.uniform(-.45, .45)
    soft = 1 - (1 - edge) * .23
    dark, lit = (edge, soft) if rng.random() < .5 else (soft, edge)
    base = len(part.v)
    for k in range(count):
        p, n, d = rings[k]
        across = d.cross(n).normalized()
        s = k / count
        w, h = width * profile[min(k, 3)] / 2, thick * profile[min(k, 3)]
        shade = root + (1 - root) * min(1, s * 2.2)
        shade = shade + (tip - 1) * max(0, s - .35) / .65
        part.v += [p - across * w - n * h * .35, p + across * (w * ridge_at) + n * h, p + across * w - n * h * .35]
        part.c += [tint * shade * dark, tint * shade, tint * shade * lit]
        for i, tilt in enumerate((-.4, 0, .4)): part.shade[len(part.v) - 3 + i] = (n + across * tilt).normalized()
    p, n, d = rings[-1]
    across = d.cross(n).normalized()
    reach = (p - rings[-2][0])
    w = width * profile[min(count - 1, 3)] / 2
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


def grow(bvh, rng, p, n, d, length, steps, lift0, lift1, hang0, hang1, wiggle=0., curl=0., cling=None, embed=.012, floor=None):
    """Walk a strand's spine: first along the body in direction d, then more and more with gravity, kept outside the skin.

    cling: the most a wet strand may stand off the skin beyond its lift; None lets it hang free.
    floor: a height the strand lies on and never goes below (an animal that lies down); None for none.
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
        if floor is not None and q.y < floor:
            # On the floor a strand runs flat: it keeps its length and turns outward.
            q.y = floor
            flat = Vector((d.x, 0, d.z))
            if flat.length > 1e-4: d = flat.normalized()
            n = (n + UP * 2).normalized()
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


def skin_tree(parts):
    """One search tree over every part's skin, for grow()."""
    offsets, total = [], 0
    for part in parts: offsets.append(total); total += len(part.v)
    return BVHTree.FromPolygons([v for part in parts for v in part.v],
                                [tuple(i + offset for i in face) for part, offset in zip(parts, offsets) for face in part.skin])


def occlude(parts, reach=.32, floor=.55, keep=()):
    """Bake sky occlusion into the colours: 20 fixed rays per vertex against the whole animal and the ground.

    floor is the darkest a fully hidden vertex gets. Vertices in `keep` (part name -> set of indices) stay as painted:
    an eye's catchlight must not go dark because the brow hangs over it.
    """
    verts, faces = [Vector((-9, 0, -9)), Vector((9, 0, -9)), Vector((9, 0, 9)), Vector((-9, 0, 9))], [(0, 1, 2, 3)]
    for part in parts:
        offset = len(verts)
        verts += part.v; faces += [tuple(i + offset for i in face) for face in part.f]
    tree = BVHTree.FromPolygons(verts, faces)
    rays = []
    for i in range(20):     # a cosine-weighted spiral on the hemisphere
        r, phi = math.sqrt((i + .5) / 20), i * 2.399963
        rays.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - r * r)))
    for part in parts:
        fixed = keep.get(part.name, ()) if keep else ()
        for i, (p, n) in enumerate(zip(part.v, part.normals())):
            if i in fixed: continue
            t = n.cross(UP if abs(n.y) < .9 else X).normalized()
            b = n.cross(t)
            blocked = 0
            for x, y, z in rays:
                hit = tree.ray_cast(p + n * .012, t * x + b * y + n * z, reach)
                if hit[0] is not None: blocked += 1 - hit[3] / reach
            sky = .85 + .15 * max(0, n.y)                     # undersides see the ground, not the sky
            part.c[i] = part.c[i] * ((floor + (1 - floor) * (1 - blocked / 20) ** 1.3) * sky)


def emit(parts, nodes, path, material_name='Coat'):
    """Blender objects with the game's node names, then one quantized GLB.

    nodes: rows (name, place in the bind pose, parent name or None), parents first. Each is an empty, unrotated pivot.
    Each part becomes a mesh leaf under the node it names.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def bl(p): return (p.x, -p.z, p.y)                        # game +Y up/-Z forward -> Blender +Z up/+Y forward
    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    attribute = material.node_tree.nodes.new('ShaderNodeVertexColor'); attribute.layer_name = 'Color'
    material.node_tree.links.new(attribute.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = 1; shader.inputs['Metallic'].default_value = 0
    objects, places = {}, {}
    for name, at, parent in nodes:
        o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o)
        places[name] = Vector(at)
        o.location = bl(places[name] - (places[parent] if parent else Vector())); o.parent = objects.get(parent)
        objects[name] = o
    for part in parts:
        mesh = bpy.data.meshes.new(part.name)
        mesh.from_pydata([bl(v - places[part.node]) for v in part.v], [], part.f)
        mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
        mesh.update()
        normals = part.normals()
        mesh.normals_split_custom_set_from_vertices([bl(part.shade.get(i, normals[i])) for i in range(len(part.v))])
        colour = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
        colour.data.foreach_set('color', [x for c in part.c for x in (min(1, c.x), min(1, c.y), min(1, c.z), 1)])
        mesh.color_attributes.active_color = colour
        mesh.materials.append(material); mesh.update()
        o = bpy.data.objects.new(part.name, mesh); bpy.context.collection.objects.link(o); o.parent = objects[part.node]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True, export_normals=True, export_texcoords=False,
                              export_materials='EXPORT', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_cameras=False, export_lights=False, export_extras=False, export_animations=False)
    quantize(path)


def dome(part, centre, out, rx, ry, bulge, sides, rim, top):
    """A low mound on the skin (an eye, a nose): a fan of triangles from its top to its rim. Returns its vertices."""
    across = UP.cross(out)
    across = across.normalized() if across.length > 1e-4 else X.copy()
    up = out.cross(across).normalized()
    base = len(part.v)
    for k in range(sides):
        t = math.tau * k / sides
        part.v.append(centre + across * (rx * math.cos(t)) + up * (ry * math.sin(t))); part.c.append(rim.copy())
    part.v.append(centre + out * bulge); part.c.append(top.copy())
    for k in range(sides):
        part.f.append(facing(part.v, (base + k, base + (k + 1) % sides, base + sides), out))
    return range(base, len(part.v))


def measure(parts):
    lo = [min(v[i] for part in parts for v in part.v) for i in range(3)]
    hi = [max(v[i] for part in parts for v in part.v) for i in range(3)]
    return {'triangles': sum(part.triangles() for part in parts), 'meshes': {part.name: part.triangles() for part in parts},
            'min': [round(x, 4) for x in lo], 'max': [round(x, 4) for x in hi]}
