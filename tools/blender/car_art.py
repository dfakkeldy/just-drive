"""The mail car's own small pictures: the roof sign and number plates (one atlas) and a tile of road mud.

Everything is drawn here with arithmetic, so the result is the same on every run and uses no outside image.
Letters come from Blender's built-in font, turned to triangles and filled by this file's own rasteriser.
The artwork is invented: a winged envelope and the words MABOU MAIL. It copies no postal service's mark.

Atlas layout, in pixels from the top-left (1024 x 512):
  sign with words      0,0     512 x 128        sign without words  512,0   512 x 128
  sign box (cream)     0,128   1024 x 128
  plate MAIL 19        0,256   256 x 128        plate MABOU         256,256 256 x 128
  lamp glow (white)    512,256 512 x 128
Moving the sign faces half the width to the right picks the wordless sign; moving the plates a quarter to the
right picks the off-duty plate. The game does both by sliding the texture, so the model's own UVs never change.
"""
import struct
import zlib

import bpy
import numpy as np

ATLAS = (1024, 512)
SIGN = (0, 0, 512, 128)
SIGN_BLANK = (0, 128, 1024, 128)
PLATE = (0, 256, 256, 128)
GLOW_HOT = (512, 256, 256, 128)      # a head lamp unit
GLOW_WARM = (768, 256, 256, 128)     # the yellowed reflector round the units
CLEAN_SHIFT = (.5, 0)        # sign without words
OFF_DUTY_SHIFT = (.25, 0)    # plate that says MABOU

CREAM = (0xf5, 0xf2, 0xd9)
BAND = (0x15, 0x3d, 0x75)     # the blue of the owner's roof sign (today's game car has this band in green)
LINE = (0xe7, 0xd6, 0x9f)
WORDS = (0xff, 0xf5, 0xd6)
PLATE_INK = (0x23, 0x3c, 0x34)


def rect(box):
    """A pixel box as glTF texture coordinates: (u0, v0, u1, v1), v measured down from the top."""
    x, y, w, h = box
    return (x / ATLAS[0], y / ATLAS[1], (x + w) / ATLAS[0], (y + h) / ATLAS[1])


def spot(box):
    """The middle of a pixel box, for parts that are one flat colour."""
    u0, v0, u1, v1 = rect(box)
    return ((u0 + u1) / 2, (v0 + v1) / 2)


# ---------------------------------------------------------------- a small rasteriser

class Canvas:
    """RGB picture drawn at 4x and averaged down, for clean edges."""

    def __init__(self, width, height, colour, scale=4):
        self.w, self.h, self.s = width, height, scale
        self.px = np.empty((height * scale, width * scale, 3), np.float32)
        self.px[:] = colour

    def box(self, x, y, w, h, colour):
        s = self.s
        self.px[round(y * s):round((y + h) * s), round(x * s):round((x + w) * s)] = colour

    def triangles(self, points, tris, colour):
        """Fills triangles given in pixel coordinates."""
        s = self.s
        H, W = self.px.shape[:2]
        for a, b, c in tris:
            (ax, ay), (bx, by), (cx, cy) = (points[a][0] * s, points[a][1] * s), (points[b][0] * s, points[b][1] * s), (points[c][0] * s, points[c][1] * s)
            x0, x1 = max(0, int(min(ax, bx, cx))), min(W - 1, int(max(ax, bx, cx)) + 1)
            y0, y1 = max(0, int(min(ay, by, cy))), min(H - 1, int(max(ay, by, cy)) + 1)
            if x1 < x0 or y1 < y0:
                continue
            area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
            if abs(area) < 1e-9:
                continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            xs = xs + .5
            ys = ys + .5
            w0 = ((bx - ax) * (ys - ay) - (by - ay) * (xs - ax)) / area
            w1 = ((cx - bx) * (ys - by) - (cy - by) * (xs - bx)) / area
            w2 = ((ax - cx) * (ys - cy) - (ay - cy) * (xs - cx)) / area
            self.px[y0:y1 + 1, x0:x1 + 1][(w0 >= 0) & (w1 >= 0) & (w2 >= 0)] = colour

    def line(self, a, b, width, colour):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = (dx * dx + dy * dy) ** .5
        nx, ny = -dy / length * width / 2, dx / length * width / 2
        pts = [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)]
        self.triangles(pts, [(0, 1, 2), (0, 2, 3)], colour)

    def frame(self, x, y, w, h, width, colour):
        for a, b in (((x, y), (x + w, y)), ((x + w, y), (x + w, y + h)), ((x + w, y + h), (x, y + h)), ((x, y + h), (x, y))):
            self.line(a, b, width, colour)

    def words(self, text, centre, height, colour, weight=0.0, squeeze=1.0):
        """Draws text centred on `centre`; `height` is the capital height in pixels."""
        points, tris = glyphs(text, weight)
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        cap = max(ys) - min(ys)
        k = height / cap
        mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        placed = [(centre[0] + (x - mx) * k * squeeze, centre[1] - (y - my) * k) for x, y in points]
        self.triangles(placed, tris, colour)

    def bytes8(self):
        s = self.s
        small = self.px.reshape(self.h, s, self.w, s, 3).mean(axis=(1, 3))
        return np.clip(np.rint(small), 0, 255).astype(np.uint8)


_glyph_cache = {}


def glyphs(text, weight):
    """Blender's built-in font as flat triangles: (points, triangles), y up."""
    key = (text, weight)
    if key in _glyph_cache:
        return _glyph_cache[key]
    curve = bpy.data.curves.new('art text', 'FONT')
    curve.body = text
    curve.offset = weight          # a little extra thickness reads as bold
    curve.fill_mode = 'FRONT'
    curve.resolution_u = 6
    obj = bpy.data.objects.new('art text', curve)
    bpy.context.collection.objects.link(obj)
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    mesh.calc_loop_triangles()
    points = [(v.co.x, v.co.y) for v in mesh.vertices]
    tris = [tuple(t.vertices) for t in mesh.loop_triangles]
    bpy.data.meshes.remove(mesh)
    bpy.data.objects.remove(obj)
    bpy.data.curves.remove(curve)
    _glyph_cache[key] = (points, tris)
    return points, tris


def png(pixels, palette=None, alpha=None):
    """Encodes 8-bit pixels as a PNG: RGB or RGBA (H x W x 3 or 4), or palette indices (H x W) with optional alpha."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    h, w = pixels.shape[:2]
    if palette is not None:
        head = struct.pack('>IIBBBBB', w, h, 8, 3, 0, 0, 0)
        extra = chunk(b'PLTE', bytes(int(c) for rgb in palette for c in rgb)) + (chunk(b'tRNS', bytes(int(a) for a in alpha)) if alpha is not None else b'')
        rows = pixels.astype(np.uint8)
    else:
        head = struct.pack('>IIBBBBB', w, h, 8, 6 if pixels.shape[2] == 4 else 2, 0, 0, 0)
        extra = b''
        rows = pixels.astype(np.uint8).reshape(h, -1)
    raw = b''.join(b'\x00' + rows[y].tobytes() for y in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head) + extra + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


# ---------------------------------------------------------------- the atlas

def _sign(c, x0, y0, words):
    c.box(x0 + 12, y0 + 12, 488, 104, BAND)
    c.frame(x0 + 19, y0 + 19, 474, 90, 3, LINE)
    # an invented winged envelope: a letter with two speed lines trailing it
    ex, ey, ew, eh = x0 + 40, y0 + 42, 62, 44
    c.frame(ex, ey, ew, eh, 5, WORDS)
    c.line((ex, ey), (ex + ew / 2, ey + eh * .58), 5, WORDS)
    c.line((ex + ew / 2, ey + eh * .58), (ex + ew, ey), 5, WORDS)
    c.line((ex - 6, ey + 12), (ex - 24, ey + 4), 5, WORDS)
    c.line((ex - 6, ey + 28), (ex - 28, ey + 22), 5, WORDS)
    if words:
        c.words('MABOU MAIL', (x0 + 300, y0 + 64), 46, WORDS, weight=.022, squeeze=.92)


def _plate(c, x0, y0, big, small):
    c.frame(x0 + 5, y0 + 5, 246, 118, 3, (0xc9, 0xc4, 0xa6))
    c.words(big, (x0 + 128, y0 + 76 if small else y0 + 66), 46, PLATE_INK, weight=.02, squeeze=.9)
    if small:
        c.words(small, (x0 + 128, y0 + 28), 11, PLATE_INK, weight=.006)


def atlas():
    """The sign and plate atlas as PNG bytes."""
    c = Canvas(ATLAS[0], ATLAS[1], CREAM)
    _sign(c, 0, 0, True)
    _sign(c, 512, 0, False)
    _plate(c, 0, 256, 'MAIL 19', 'MABOU RURAL ROUTE')
    _plate(c, 256, 256, 'MABOU', None)
    c.box(*GLOW_HOT, (255, 250, 232))
    c.box(*GLOW_WARM, (204, 188, 134))
    return png(c.bytes8())


def mud(size=256):
    """A tile of thrown mud that repeats sideways: thick and dark at the bottom, thin streaks towards the top.

    Returned as a palette PNG with transparency, which keeps it small.
    """
    seed = [19]

    def random():
        seed[0] = (seed[0] * 1664525 + 1013904223) & 0xffffffff
        return seed[0] / 4294967296
    ys = np.arange(size, dtype=np.float32)[:, None] / (size - 1)        # 0 at the top of the tile, 1 at the sill
    up = 1 - ys                                                          # height up the body
    base = np.where(up < .38, .94 - (.94 - .75) * up / .38, np.clip(.75 * (.88 - up) / .5, 0, 1))
    alpha = np.repeat(base, size, axis=1).astype(np.float32)
    shade = np.full((size, size), .5, np.float32)
    xs = np.arange(size, dtype=np.float32)[None, :]
    rows = np.arange(size, dtype=np.float32)[:, None]
    for _ in range(620):
        x, h = random() * size, random() ** 1.9 * .96
        y = (1 - h) * (size - 1)
        rx, ry = .5 + random() * 1.6, 1.2 + random() * 9
        tone, strength = random(), .16 + random() * .42
        dx = (xs - x + size / 2) % size - size / 2                       # wrap sideways so the tile repeats
        inside = ((dx + .3 * (rows - y)) / rx) ** 2 + ((rows - y) / ry) ** 2 < 1
        alpha = np.where(inside, alpha + (1 - alpha) * strength, alpha)
        shade = np.where(inside, shade + (tone - shade) * strength, shade)
    # 8 tones of brown x 32 steps of cover: 256 palette entries. A fixed grain hides the steps.
    grain = ((xs * 12.9898 + rows * 78.233) % 1.0 * 43758.5453) % 1.0 - .5
    tones = np.clip((shade * 8).astype(np.int32), 0, 7)
    steps = np.clip(np.rint(alpha * 31 + grain * .9).astype(np.int32), 0, 31)
    steps = np.where(alpha <= 0, 0, steps)
    palette, cover = [], []
    for a in range(32):
        for t in range(8):
            k = t / 7
            palette.append((round(0x6a + (0x8e - 0x6a) * k), round(0x58 + (0x78 - 0x58) * k), round(0x3d + (0x5a - 0x3d) * k)))
            cover.append(round(255 * a / 31))
    return png((steps * 8 + tones).astype(np.uint8), palette, cover)
