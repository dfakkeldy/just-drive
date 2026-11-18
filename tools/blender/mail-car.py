"""The preview mail car, made by Blender from this script alone. No photos, downloads or outside assets.

  Blender -b --factory-startup -P tools/blender/mail-car.py -- [desktop.glb] [--preview DIR] [--only desktop|low]

Writes web/public/models/mail-car.glb and mail-car-low.glb (or the given path and <stem>-low.glb).
`--preview DIR` also renders working pictures of each variant into DIR (keep DIR outside the repository).

How it is made, in order:
  car_form.py   the smooth body, from a control cage read off the owner's car
  car_body.py   glass, lamps, grille, wheel openings and trim cut into that body as flat drawings
  car_parts.py  everything fitted to it: cabin, wheels, mirrors, roof sign and lamp, small trim
  car_kit.py    mesh buckets (one per draw), simple solids, and the baked soft shade in vertex colours
  car_art.py    the car's own sign, plate and mud pictures, drawn with arithmetic
Game axes: +X right, +Y up, -Z forward, 1 unit = 1 metre.
"""
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import car_art       # noqa: E402
import car_body      # noqa: E402
import car_kit       # noqa: E402
import car_parts     # noqa: E402
import car_preview   # noqa: E402
from glb_quantize import quantize    # noqa: E402

# name: (base colour, metal, rough, alpha, emission colour, emission strength, vertex colours, texture coordinates)
MATERIALS = {
    'Body paint': ((1, 1, 1), .30, .36, 1, None, 0, True, False),
    'Matte': ((1, 1, 1), 0, .93, 1, None, 0, True, False),
    'Front glass': (car_kit.srgb(0x9ebbb4), .05, .16, .30, None, 0, False, False),
    'Rear tint': (car_kit.srgb(0x10191c), .1, .14, .80, None, 0, False, False),
    'Lamp lens': (car_kit.srgb(0xf4f1df), .0, .08, .20, None, 0, False, False),
    'Brake red': (car_kit.srgb(0x970b19), 0, .30, 1, car_kit.srgb(0xee1020), .30, False, False),
    'Amber beacon': (car_kit.srgb(0xf5a315), 0, .30, 1, car_kit.srgb(0xff8b00), .8, False, False),
    # These get their pictures (car_art.py) attached after the export: sign and plates lit a little, mud see-through.
    'Sign atlas': ((1, 1, 1), 0, .58, 1, (1, 1, 1), .24, False, True),
    # The head lamps use the same atlas (two flat patches). The game sets their brightness (car-model.ts).
    'Head lamp': ((1, 1, 1), 0, .40, 1, (1, 1, 1), 1.0, False, True),
    'Mud overlay': ((1, 1, 1), 0, 1, .78, None, 0, False, True),
}
EYE, LOW_EYE = (.43, 1.36, -.08), (.43, 1.31, .06)
WHEELS = {'fl': (-.785, -1.31), 'fr': (.785, -1.31), 'rl': (-.785, 1.31), 'rr': (.785, 1.31)}


def make_materials():
    out = {}
    for name, (colour, metal, rough, alpha, glow, strength, coloured, _) in MATERIALS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        shader = m.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value = (*colour, 1)
        shader.inputs['Metallic'].default_value = metal
        shader.inputs['Roughness'].default_value = rough
        shader.inputs['Alpha'].default_value = alpha
        if glow:
            shader.inputs['Emission Color'].default_value = (*glow, 1)
            shader.inputs['Emission Strength'].default_value = strength
        if coloured:
            node = m.node_tree.nodes.new('ShaderNodeVertexColor')
            node.layer_name = 'Col'
            m.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
        if alpha < 1:
            m.surface_render_method = 'BLENDED'
        m.use_backface_culling = True
        out[name] = m
    return out


class Car:
    """Collects the car's parts into buckets: one bucket is one exported mesh."""

    def __init__(self, low):
        self.low = low
        self.buckets = {}
        # The seat camera sits at driver_eye. A phone's camera cannot draw anything nearer than 0.45 m (main.ts), so
        # the phone car's eye is 14 cm further back and 5 cm lower. From there the steering wheel, the whole front
        # pillar and the roof's front edge are beyond that distance, and the lining closes the top of the view.
        self.nodes = {'car_root': (None, (0, 0, 0)), 'body': ('car_root', (0, 0, 0)), 'driver_eye': ('body', LOW_EYE if low else EYE)}
        for key, (x, z) in WHEELS.items():
            pivot = ('steer_' if key[0] == 'f' else 'axle_') + key
            self.nodes[pivot] = ('car_root', (x, 0, z))
            self.nodes['wheel_' + key] = (pivot, (0, .35, 0))

    def origin(self, node):
        total = Vector((0, 0, 0))
        while node:
            parent, at = self.nodes[node]
            total += Vector(at)
            node = parent
        return total

    def bucket(self, material, parent='body', name=None, shade='car', occludes=None):
        """The shared bucket for a material under a node, or a named one for a mesh the game drives."""
        name = name or f"{parent}_{material.replace(' ', '_')}"
        if name not in self.buckets:
            spec = MATERIALS[material]
            solid = spec[3] >= 1 and material != 'Mud overlay'
            self.buckets[name] = car_kit.Bucket(name, parent, material, self.origin(parent), coloured=spec[6],
                                                textured=spec[7], occludes=solid if occludes is None else occludes, shade=shade)
        return self.buckets[name]


def build(output, low, preview=None):
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    car = Car(low)
    shell = car_body.build_shell(1 if low else 2, lite=low)
    car_parts.fit_shell(car, shell)
    car_parts.fit_everything(car, shell)
    shell.bm.free()

    buckets = [b for b in car.buckets.values() if b.tris]
    for b in buckets:
        car_kit.auto_normals(b)
    car_kit.bake_shade(buckets, rays=24 if low else 48)
    materials = make_materials()
    parents = {}
    for name, (parent, at) in car.nodes.items():
        obj = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(obj)
        obj.location = car_kit.game_to_blender(at)
        parents[name] = obj
    for name, (parent, _) in car.nodes.items():
        if parent:
            parents[name].parent = parents[parent]
    for b in buckets:
        car_kit.to_object(b, materials, parents)
    triangles = sum(len(b.tris) * (1 + len(b.copies)) for b in buckets)
    print(f"BUILT {'LOW' if low else 'desktop'}: {triangles} triangles in {len(buckets)} meshes, {time.time() - started:.1f} s")
    for b in sorted(buckets, key=lambda b: -len(b.tris)):
        print(f'  {b.name:34s} {len(b.tris):6d}')
    if preview:
        car_preview.render(preview[0], 'low' if low else 'desktop', preview[1])
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_yup=True, export_normals=True,
                                  export_texcoords=True, export_materials='EXPORT', export_vertex_color='ACTIVE',
                                  export_active_vertex_color_when_no_material=True, export_all_vertex_colors=False,
                                  export_cameras=False, export_lights=False, export_extras=False, export_animations=False,
                                  export_apply=False)
        if '--raw' not in sys.argv:
            atlas = car_art.atlas()
            quantize(output, colour_bits=8, drop_slivers=True,
                     textures={'Sign atlas': {'png': atlas, 'emissive': True}, 'Head lamp': {'png': atlas, 'emissive': True},
                                       'Mud overlay': {'png': car_art.mud(), 'repeat': True}})
        print('EXPORTED', 'LOW' if low else 'desktop', output, output.stat().st_size, 'bytes', triangles, 'triangles')


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = None
    only = None
    output = Path(__file__).resolve().parents[2] / 'web/public/models/mail-car.glb'
    export = True
    i = 0
    while i < len(args):
        if args[i] == '--preview':
            preview = (Path(args[i + 1]), args[i + 2].split(','))
            i += 3
        elif args[i] == '--only':
            only = args[i + 1]
            i += 2
        elif args[i] == '--no-export':
            export = False
            i += 1
        elif args[i] == '--raw':          # skip the quantizer, to inspect what Blender itself writes
            i += 1
        else:
            output = Path(args[i])
            i += 1
    if only != 'low':
        build(output if export else None, False, preview)
    if only != 'desktop':
        build(output.with_name(output.stem + '-low.glb') if export else None, True, preview)
