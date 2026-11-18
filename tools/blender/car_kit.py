"""Plain building blocks for the mail car: buckets of triangles, simple solids, and the baked shade.

A Bucket is one exported mesh (one draw in the game). Parts are added to it as
faces with a colour; when the car is finished each bucket becomes a Blender
mesh with its own shading normals and, where the material uses them, vertex
colours that already hold the soft shade of nearby parts (baked occlusion).

Game axes throughout: +X right, +Y up, -Z forward, metres.
"""
import math

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon


def srgb(hex_or_r, g=None, b=None):
    """A colour written the way a designer writes it (0xRRGGBB or 0-255), as linear RGB."""
    if g is None:
        r, g, b = (hex_or_r >> 16) & 255, (hex_or_r >> 8) & 255, hex_or_r & 255
    else:
        r = hex_or_r

    def lin(c):
        c /= 255
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


class Bucket:
    def __init__(self, name, parent, material, origin=(0, 0, 0), coloured=False, textured=False,
                 occludes=True, shade='car'):
        self.name, self.parent, self.material = name, parent, material
        self.origin = Vector(origin)          # where the parent node sits in the car, for the shade bake
        self.coloured, self.textured = coloured, textured
        self.occludes = occludes              # does it throw shade on other parts?
        self.shade = shade                    # 'car': shaded by the whole car; another word: only by buckets with that word
        self.copies = []                      # (parent node, turned half round): more nodes that draw this same mesh
        self.co = []
        self.tris = []                        # (i, j, k)
        self.tri_colour = []
        self.tri_normals = []                 # three normals, or None for automatic
        self.tri_uv = []                      # three uv pairs, or None
        self.tri_smooth = []
        self.tri_shade = []                   # how strongly the baked shade applies, 0..1

    def add(self, verts, faces, colour=(1, 1, 1), smooth=True, normals=None, uvs=None, shade=1.0):
        """verts: positions. faces: index tuples (any size). normals/uvs: per face, per corner."""
        base = len(self.co)
        self.co.extend(Vector(v) for v in verts)
        for fi, face in enumerate(faces):
            if len(face) == 3:
                local = [(0, 1, 2)]
            elif len(face) == 4:
                a, b, c, d = (Vector(verts[i]) for i in face)
                local = [(0, 1, 2), (0, 2, 3)] if (a - c).length_squared <= (b - d).length_squared else [(0, 1, 3), (1, 2, 3)]
            else:
                local = [tuple(t) for t in tessellate_polygon([[Vector(verts[i]) for i in face]])]
                # tessellate_polygon may turn triangles over: keep the face's own winding
                n = _newell([Vector(verts[i]) for i in face])
                fixed = []
                for t in local:
                    p, q, r = (Vector(verts[face[i]]) for i in t)
                    fixed.append(t if (q - p).cross(r - p).dot(n) >= 0 else (t[0], t[2], t[1]))
                local = fixed
            for t in local:
                p, q, r = (Vector(verts[face[i]]) for i in t)
                if (q - p).cross(r - p).length < 2e-9:
                    continue
                self.tris.append(tuple(base + face[i] for i in t))
                self.tri_colour.append(colour[fi] if isinstance(colour, list) else colour)
                self.tri_normals.append(tuple(Vector(normals[fi][i]) for i in t) if normals and normals[fi] else None)
                self.tri_uv.append(tuple(uvs[fi][i] for i in t) if uvs and uvs[fi] else None)
                self.tri_smooth.append(smooth)
                self.tri_shade.append(shade)

    def add_solid(self, solid, colour=(1, 1, 1), smooth=True, shade=1.0):
        self.add(solid[0], solid[1], colour, smooth, shade=shade)


def _newell(points):
    n = Vector((0, 0, 0))
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        n += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
    return n.normalized() if n.length > 0 else Vector((0, 1, 0))


# ---------------------------------------------------------------- simple solids: each returns (verts, faces)

def transformed(solid, matrix):
    return [matrix @ Vector(v) for v in solid[0]], solid[1]


def flipped(solid):
    return solid[0], [tuple(reversed(f)) for f in solid[1]]


def mirrored(solid):
    """The same solid on the other side of the car."""
    return [Vector((-v[0], v[1], v[2])) for v in solid[0]], [tuple(reversed(f)) for f in solid[1]]


def outward(solid, inward=False):
    """Turns a solid's faces to point away from its own middle (or towards it)."""
    verts, faces = solid
    centre = sum((Vector(v) for v in verts), Vector((0, 0, 0))) / len(verts)
    volume = 0.0
    for f in faces:
        a = Vector(verts[f[0]]) - centre
        for i in range(1, len(f) - 1):
            volume += a.dot((Vector(verts[f[i]]) - centre).cross(Vector(verts[f[i + 1]]) - centre))
    return flipped(solid) if (volume < 0) != inward else solid


def facing(solid, toward):
    """Turns an open sheet so that it faces `toward`."""
    verts, faces = solid
    total = Vector((0, 0, 0))
    for f in faces:
        total += _newell([Vector(verts[i]) for i in f])
    return flipped(solid) if total.dot(Vector(toward)) < 0 else solid


def ring_tube(centre, u, v, radius, thickness, segments=20, sides=6):
    """A torus in the plane of u and v."""
    u, v = Vector(u).normalized(), Vector(v).normalized()
    w = u.cross(v)
    rings = []
    for i in range(segments):
        a = math.tau * i / segments
        out = u * math.cos(a) + v * math.sin(a)
        rings.append([Vector(centre) + out * radius + (out * math.cos(math.tau * k / sides) + w * math.sin(math.tau * k / sides)) * thickness
                      for k in range(sides)])
    rings.append(rings[0])
    return outward(loft(rings, False, False))


def aimed(solid, origin, direction):
    """Turns a solid built about +Z to point along `direction`, and moves it to `origin`."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix()
    return [q @ Vector(v) + Vector(origin) for v in solid[0]], solid[1]


def box(centre, size, rotation=None):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [Vector((sx * hx, sy * hy, sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    if rotation is not None:
        verts = [rotation @ v for v in verts]
    verts = [v + Vector(centre) for v in verts]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return verts, faces


def loft(rings, cap_start=True, cap_end=True, closed=True):
    """Skin over a row of rings (each the same number of points). Sides and caps always agree; use outward() after."""
    n = len(rings[0])
    verts = [Vector(p) for ring in rings for p in ring]
    faces = []
    span = n if closed else n - 1
    for j in range(len(rings) - 1):
        for i in range(span):
            a, b = j * n + i, j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_start:
        faces.append(tuple(reversed(range(n))))
    if cap_end:
        faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return verts, faces


def soft_box(centre, size, radius, rotation=None, taper=1.0):
    """A box with rounded upright corners and softened top and bottom: cushions, lamps, housings."""
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    r = min(radius, hx * .98, hz * .98)

    def outline(scale, y):
        pts = []
        for cx, cz, start in ((hx - r, hz - r, 0), (-(hx - r), hz - r, 90), (-(hx - r), -(hz - r), 180), (hx - r, -(hz - r), 270)):
            for s in range(3):
                a = math.radians(start + 45 * s)
                pts.append(Vector(((cx + r * math.cos(a)) * scale, y, (cz + r * math.sin(a)) * scale)))
        return pts
    e = min(r, hy * .6)
    rings = [outline(.90, -hy), outline(1.0, -hy + e), outline(taper, hy - e), outline(taper * .90, hy)]
    solid = outward(loft(rings))
    if rotation is not None:
        solid = transformed(solid, rotation.to_4x4())
    return [v + Vector(centre) for v in solid[0]], solid[1]


def lathe(profile, segments, axis='x', centre=(0, 0, 0), cap_start=False, cap_end=False):
    """Turns a profile of (radius, distance along the axis) round the axis."""
    verts = []
    for radius, along in profile:
        for i in range(segments):
            a = math.tau * i / segments
            c, s = radius * math.cos(a), radius * math.sin(a)
            p = Vector((along, c, s)) if axis == 'x' else Vector((s, along, c)) if axis == 'y' else Vector((c, s, along))
            verts.append(p + Vector(centre))
    faces = []
    for j in range(len(profile) - 1):
        for i in range(segments):
            a, b = j * segments + i, j * segments + (i + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    if cap_start:
        faces.append(tuple(range(segments)))
    if cap_end:
        faces.append(tuple(reversed(range((len(profile) - 1) * segments, len(profile) * segments))))
    return verts, faces


def tube(path, radius, sides=6, caps=True):
    """A round bar along a path. `radius` may be one number or one per path point."""
    pts = [Vector(p) for p in path]
    rings = []
    up = Vector((0, 1, 0))
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(up)
        if u.length < .05:
            u = t.cross(Vector((1, 0, 0)))
        u.normalize()
        v = u.cross(t).normalized()
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        rings.append([p + (u * math.cos(math.tau * k / sides) + v * math.sin(math.tau * k / sides)) * r for k in range(sides)])
    return loft(rings, caps, caps)


def sheet(rows, flip=False):
    """A surface through a grid of points (rows of equal length)."""
    n = len(rows[0])
    verts = [Vector(p) for row in rows for p in row]
    faces = []
    for j in range(len(rows) - 1):
        for i in range(n - 1):
            a = j * n + i
            f = (a, a + 1, a + n + 1, a + n)
            faces.append(tuple(reversed(f)) if flip else f)
    return verts, faces


def disc(centre, normal, radius, segments=12, radius_v=None):
    normal = Vector(normal).normalized()
    u = normal.cross(Vector((0, 1, 0)))
    if u.length < .05:
        u = normal.cross(Vector((1, 0, 0)))
    u.normalize()
    v = normal.cross(u)
    verts = [Vector(centre) + u * radius * math.cos(math.tau * i / segments) + v * (radius_v or radius) * math.sin(math.tau * i / segments)
             for i in range(segments)]
    return verts, [tuple(range(segments))]


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


# ---------------------------------------------------------------- baked shade

def _hemisphere(count):
    """Even, cosine-weighted directions about +Z."""
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(count):
        u = (i + .5) / count
        r, a = math.sqrt(u), golden * i
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(1 - u))))
    return out


SMEAR_AREA = .004      # square metres: a triangle larger than this cannot hold a corner much darker than its others


def bake_shade(buckets, rays=40, reach=.6, ground=True):
    """Soft shade from nearby parts, one value per (vertex, facing). Fills bucket.corner_shade."""
    dirs = _hemisphere(rays)
    groups = {}
    for b in buckets:
        groups.setdefault(b.shade if b.shade != 'car' else 'car', []).append(b)
    trees = {}
    for key, members in groups.items():
        co, tris = [], []
        for b in members:
            if not b.occludes:
                continue
            base = len(co)
            origin = b.origin if key == 'car' else Vector((0, 0, 0))
            co.extend(v + origin for v in b.co)
            tris.extend((base + i, base + j, base + k) for i, j, k in b.tris)
        trees[key] = BVHTree.FromPolygons(co, tris) if tris else None
    # Wheels and other spinning groups are shaded by themselves only, so the shade turns with them.
    for b in buckets:
        key = b.shade if b.shade != 'car' else 'car'
        tree = trees[key]
        origin = b.origin if key == 'car' else Vector((0, 0, 0))
        cache = {}
        b.corner_shade = []
        for t, tri in enumerate(b.tris):
            values = []
            for c in range(3):
                n = b.final_normals[t][c]
                k = (tri[c], round(n.x * 8), round(n.y * 8), round(n.z * 8))
                if k not in cache:
                    cache[k] = _occlusion(tree, b.co[tri[c]] + origin, n, dirs, reach, ground and key == 'car') if b.coloured and tree else 0.0
                values.append(cache[k])
            # A corner under a small part (a rail foot, a line laid on the skin) is shaded as if its whole face were
            # covered, and a big face would carry that shade far across a door or the roof. So on a big triangle
            # no corner may be much darker than the lightest one. Small triangles are left as they are.
            area = (b.co[tri[1]] - b.co[tri[0]]).cross(b.co[tri[2]] - b.co[tri[0]]).length / 2
            if area > SMEAR_AREA:
                limit = min(values) + max(.08, .9 * SMEAR_AREA / area)
                values = [min(v, limit) for v in values]
            b.corner_shade.append(values)


def _occlusion(tree, p, n, dirs, reach, ground):
    up = Vector((0, 0, 1))
    q = up.rotation_difference(n).to_matrix()
    start = p + n * .004
    total = 0.0
    for d in dirs:
        w = q @ d
        hit = tree.ray_cast(start, w, reach)
        dist = hit[3] if hit[0] is not None else None
        if ground and w.y < -1e-4:
            g = start.y / -w.y
            if g < reach and (dist is None or g < dist):
                dist = max(g, 0.0)
        if dist is not None:
            total += 1 - dist / reach
    return total / len(dirs)


# ---------------------------------------------------------------- to Blender

def game_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def auto_normals(bucket, angle=42):
    """Shading normals for a bucket's triangles: smooth across gentle edges, crisp across hard ones."""
    co, tris = bucket.co, bucket.tris
    face_n = []
    for i, j, k in tris:
        n = (co[j] - co[i]).cross(co[k] - co[i])
        face_n.append(n.normalized() if n.length > 0 else Vector((0, 1, 0)))
    # weld by position so separate parts that touch still shade as designed within one part only
    by_vertex = {}
    for t, tri in enumerate(tris):
        for c in range(3):
            by_vertex.setdefault(tri[c], []).append(t)
    out = []
    for t, tri in enumerate(tris):
        if bucket.tri_normals[t] is not None:
            out.append(tuple(n.normalized() for n in bucket.tri_normals[t]))
            continue
        if not bucket.tri_smooth[t]:
            out.append((face_n[t],) * 3)
            continue
        # smooth is True (the usual angle) or the part's own angle in degrees
        limit = math.cos(math.radians(angle if bucket.tri_smooth[t] is True else bucket.tri_smooth[t]))
        corner = []
        for c in range(3):
            acc = Vector((0, 0, 0))
            for other in by_vertex[tri[c]]:
                if face_n[other].dot(face_n[t]) >= limit and bucket.tri_normals[other] is None and bucket.tri_smooth[other]:
                    oi = tris[other].index(tri[c])
                    a, b2, c2 = co[tris[other][oi]], co[tris[other][(oi + 1) % 3]], co[tris[other][(oi + 2) % 3]]
                    e1, e2 = (b2 - a), (c2 - a)
                    weight = e1.angle(e2, 0.0) if e1.length > 0 and e2.length > 0 else 0.0
                    acc += face_n[other] * weight
            corner.append(acc.normalized() if acc.length > 0 else face_n[t])
        out.append(tuple(corner))
    bucket.final_normals = out


def to_object(bucket, materials, parents, shade_strength=.82, shade_floor=.16):
    """Makes the Blender mesh object for a bucket (triangles, custom normals, colours, UVs)."""
    index, co = {}, []
    faces = []
    for tri in bucket.tris:
        face = []
        for i in tri:
            if i not in index:
                index[i] = len(co)
                co.append(game_to_blender(bucket.co[i]))
            face.append(index[i])
        faces.append(face)
    mesh = bpy.data.meshes.new(bucket.name)
    mesh.from_pydata(co, [], faces, shade_flat=False)
    mesh.materials.append(materials[bucket.material])
    normals = [game_to_blender(n) for tri in bucket.final_normals for n in tri]
    mesh.normals_split_custom_set(normals)
    if bucket.coloured:
        layer = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        values = []
        for t in range(len(bucket.tris)):
            r, g, b = bucket.tri_colour[t]
            for c in range(3):
                s = 1 - shade_strength * bucket.tri_shade[t] * min(1.0, bucket.corner_shade[t][c] * 1.15) ** .85
                s = max(shade_floor, s)
                values.extend((r * s, g * s, b * s, 1.0))
        layer.data.foreach_set('color', values)
        mesh.color_attributes.active_color = layer
        mesh.color_attributes.render_color_index = 0
    if bucket.textured:
        # Bucket UVs are the file's UVs: (0, 0) is the picture's top-left. The exporter turns v over, so store it turned.
        uv = mesh.uv_layers.new(name='UVMap')
        flat = []
        for t in range(len(bucket.tris)):
            for c in range(3):
                pair = bucket.tri_uv[t][c] if bucket.tri_uv[t] else (0.0, 0.0)
                flat.extend((pair[0], 1 - pair[1]))
        uv.data.foreach_set('uv', flat)
    mesh.update()
    obj = bpy.data.objects.new(bucket.name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parents[bucket.parent]
    for parent, turned in bucket.copies:          # the same mesh data again: the file stores it once
        copy = bpy.data.objects.new(f'{bucket.name}_{parent}', mesh)
        bpy.context.collection.objects.link(copy)
        copy.parent = parents[parent]
        if turned:
            copy.rotation_euler = (0, 0, math.pi)
    return obj
