"""Blender-side look at the car before it goes to the game: the game's own preview cameras, plus flat elevations.

Used while shaping the car (`mail-car.py -- --preview DIR`). The pictures are working files: they are written
outside the repository and never committed.
"""
import math

import bpy
from mathutils import Vector

# name: (camera position, target, orthographic width or None) in game axes; the first four match car-preview.ts
VIEWS = {
    'front': ((5.1, 2.7, -6.5), (0, .94, 0), None),
    'rear': ((5.1, 2.8, 6.5), (0, .94, 0), None),
    'side': ((8.8, 2.0, 0), (0, .94, 0), None),
    'driver-side': ((3.3, 1.85, -2.4), (.3, 1.16, -.2), None),
    'left-rear': ((-4.6, 1.9, 6.2), (0, .9, 0), None),
    'low-front': ((3.4, 1.0, -5.6), (0, .8, 0), None),
    'nose': ((1.6, 1.15, -4.6), (0, .75, -1.6), None),
    'tail': ((1.9, 1.5, 4.9), (0, .95, 1.7), None),
    'flat-side': ((14, .95, 0), (0, .95, 0), 5.2),
    'flat-front': ((0, .95, -14), (0, .95, 0), 3.0),
    'flat-rear': ((0, .95, 14), (0, .95, 0), 3.0),
    'flat-top': ((0, 14, 0), (0, 0, 0), 5.2),
    'cabin': ((.43, 1.36, -.08), (.34, 1.26, -2.08), None),
}


def render(folder, tag, views, size=(1440, 1000)):
    scene = bpy.context.scene
    extra = []
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 24
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('preview sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.60, .72, .80, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .8
    scene.world = world
    sun = bpy.data.objects.new('preview sun', bpy.data.lights.new('preview sun', 'SUN'))
    sun.data.energy = 2.2
    sun.data.color = (1, .89, .71)
    sun.data.angle = math.radians(3)
    # the game's preview sun sits at (-6, 4, 5): behind the car, on its left
    direction = Vector((-6, -5, 4))
    sun.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    bpy.context.collection.objects.link(sun)
    extra.append(sun)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.008))
    ground = bpy.context.object
    material = bpy.data.materials.new('preview ground')
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (.27, .29, .24, 1)
    shader.inputs['Roughness'].default_value = 1
    ground.data.materials.append(material)
    extra.append(ground)
    data = bpy.data.cameras.new('preview camera')
    camera = bpy.data.objects.new('preview camera', data)
    bpy.context.collection.objects.link(camera)
    extra.append(camera)
    scene.camera = camera
    data.clip_start, data.clip_end = .05, 300
    hidden = [o for o in bpy.data.objects if 'Mud' in o.name]     # the mud film needs the game's texture to look right
    for o in hidden:
        o.hide_render = True
    for name in views:
        position, target, ortho = VIEWS[name]
        p = Vector((position[0], -position[2], position[1]))
        t = Vector((target[0], -target[2], target[1]))
        camera.location = p
        camera.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
        if name == 'flat-top':
            camera.rotation_euler = (0, 0, math.pi / 2)
        if ortho:
            data.type, data.ortho_scale = 'ORTHO', ortho
        else:
            data.type, data.sensor_fit = 'PERSP', 'VERTICAL'
            data.angle_y = math.radians(75 if name == 'cabin' else 36)
        scene.render.filepath = str(folder / f'{tag}-{name}.png')
        bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    for obj in extra:
        bpy.data.objects.remove(obj)
