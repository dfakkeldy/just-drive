"""Loss-bounded KHR_mesh_quantization for the Blender-built game models. No runtime decoder, no compression.

- POSITION: normalized u16 with one uniform decode on the mesh's own leaf node (error at most half a step).
  A mesh that several nodes use (the car's four wheels) is stored once, and each node gets the decode.
- NORMAL: snorm8; the build stops if any normal moves by more than one degree.
- COLOR_0: normalized u16 RGB. Colours are linear, and the dark coat needs more than 8 bits there.
  `colour_bits=8` stores bytes instead (the mail car: its colours are not that dark, and the file is smaller).
- TEXCOORD_0: normalized u16 when every value is inside 0..1; plain floats when a picture repeats.
- `drop_slivers=True` leaves out a triangle that the position grid collapses or turns over (a sliver left where
  an outline was cut into a body), so every stored triangle keeps its facing.
- `textures` puts PNG files into the file and on named materials, so the bytes are exactly the ones given:
  {'Material name': {'png': bytes, 'emissive': True/False, 'repeat': True/False}}
With no options a file comes out as before (the porch dog's files are the proof: tools/porch-dog-model-check.mjs).
Every accessor is repacked with glTF alignment. Runtime needs only three.js's GLTFLoader.
"""
import json, math, struct
from mathutils import Matrix, Quaternion, Vector

TYPES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
FORMATS = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
SCALE = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}


def quantize(path, colour_bits=16, textures=None, drop_slivers=False):
    assert colour_bits in (8, 16), 'colour_bits is 8 or 16'
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + length])
    offset = 20 + length
    data = raw[offset + 8:offset + 8 + struct.unpack_from('<I', raw, offset)[0]]
    old_accessors, old_views = doc['accessors'], doc['bufferViews']
    views, accessors, binary = [], [], bytearray()

    def read(index):
        a = old_accessors[index]
        view = old_views[a['bufferView']]
        n, fmt = TYPES[a['type']], FORMATS[a['componentType']]
        size = struct.calcsize('<' + fmt * n)
        stride = view.get('byteStride', size)
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        rows = [struct.unpack_from('<' + fmt * n, data, start + i * stride) for i in range(a['count'])]
        if a.get('normalized'):
            rows = [tuple(c / SCALE[a['componentType']] for c in row) for row in rows]
        return rows

    def append(values, kind, component=5126, normalized=False, target=34962, bounds=False):
        fmt, n = FORMATS[component], TYPES[kind]
        size = struct.calcsize('<' + fmt * n)
        stride = (size + 3) // 4 * 4 if target == 34962 else size
        while len(binary) % 4: binary.append(0)
        start = len(binary)
        for value in values:
            binary.extend(struct.pack('<' + fmt * n, *value))
            binary.extend(bytes(stride - size))
        view = {'buffer': 0, 'byteOffset': start, 'byteLength': len(binary) - start, 'target': target}
        if target == 34962: view['byteStride'] = stride
        views.append(view)
        a = {'bufferView': len(views) - 1, 'componentType': component, 'count': len(values), 'type': kind}
        if normalized: a['normalized'] = True
        if bounds:
            a['min'] = [min(v[i] for v in values) for i in range(n)]
            a['max'] = [max(v[i] for v in values) for i in range(n)]
        accessors.append(a)
        return len(accessors) - 1

    decodes = {}
    for mi, mesh in enumerate(doc['meshes']):
        assert len(mesh['primitives']) == 1, 'Author one material per mesh'
        prim = mesh['primitives'][0]
        attrs = prim['attributes']
        p = read(attrs['POSITION'])
        minimum = Vector(min(v[i] for v in p) for i in range(3))
        extent = max(max(v[i] for v in p) - minimum[i] for i in range(3))
        extent = max(extent, 1e-4)
        decodes[mi] = Matrix.Translation(minimum) @ Matrix.Diagonal((extent, extent, extent, 1))
        q = [tuple(round(max(0, min(1, (v[i] - minimum[i]) / extent)) * 65535) for i in range(3)) for v in p]
        new = {'POSITION': append(q, 'VEC3', 5123, True, bounds=True)}
        normals = None
        if 'NORMAL' in attrs:
            normals = []
            for value in read(attrs['NORMAL']):
                v = Vector(value); v.normalize()
                encoded = tuple(round(max(-1, min(1, c)) * 127) for c in v)
                assert v.dot(Vector(encoded).normalized()) > math.cos(math.radians(1)), 'Normal quantization error'
                normals.append(encoded)
            new['NORMAL'] = append(normals, 'VEC3', 5120, True)
        if 'TEXCOORD_0' in attrs:
            uv = read(attrs['TEXCOORD_0'])
            if all(-1e-5 <= c <= 1 + 1e-5 for v in uv for c in v):
                new['TEXCOORD_0'] = append([tuple(round(max(0, min(1, c)) * 65535) for c in v) for v in uv], 'VEC2', 5123, True)
            else:
                new['TEXCOORD_0'] = append([tuple(v) for v in uv], 'VEC2', 5126)
        if 'COLOR_0' in attrs:
            colours = read(attrs['COLOR_0'])
            assert all(len(c) < 4 or c[3] > .999 for c in colours), 'Vertex alpha is not used; it would be dropped'
            top = 255 if colour_bits == 8 else 65535
            new['COLOR_0'] = append([tuple(round(max(0, min(1, c)) * top) for c in row[:3]) for row in colours], 'VEC3',
                                    5121 if colour_bits == 8 else 5123, True)
        assert set(attrs) <= set(new), f'No vertex attribute may be removed silently: {sorted(set(attrs) - set(new))}'
        prim['attributes'] = new
        indices = read(prim['indices'])
        if drop_slivers:
            decoded = [Vector(minimum[i] + c[i] / 65535 * extent for i in range(3)) for c in q]
            kept = []
            for k in range(0, len(indices), 3):
                a, b, c = (v[0] for v in indices[k:k + 3])
                face = (decoded[b] - decoded[a]).cross(decoded[c] - decoded[a])
                if face.length <= 1e-9:
                    continue
                if normals and face.dot(Vector(normals[a]).normalized() + Vector(normals[b]).normalized() + Vector(normals[c]).normalized()) <= 1e-9 * face.length:
                    continue
                kept.extend(((a,), (b,), (c,)))
            indices = kept
        prim['indices'] = append(indices, 'SCALAR', 5123 if max(v[0] for v in indices) < 65536 else 5125, target=34963)
    for node in doc['nodes']:
        if 'mesh' not in node: continue
        assert not node.get('children'), 'Decode transforms belong only to mesh leaves'
        if 'matrix' in node:
            old = Matrix([node['matrix'][i::4] for i in range(4)])
        else:
            r = node.get('rotation', [0, 0, 0, 1])
            old = Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((r[3], *r[:3])), Vector(node.get('scale', [1, 1, 1])))
        t, r, s = (old @ decodes[node['mesh']]).decompose()
        node.pop('matrix', None)
        node['translation'] = list(t); node['rotation'] = [r.x, r.y, r.z, r.w]; node['scale'] = list(s)
    if textures:
        doc['images'], doc['textures'], doc['samplers'] = [], [], []
        seen = {}
        for name, spec in textures.items():
            material = next(m for m in doc['materials'] if m['name'] == name)
            key = (spec['png'], bool(spec.get('repeat')))
            if key not in seen:        # one picture, used by two materials, is stored once
                while len(binary) % 4: binary.append(0)
                views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(spec['png'])})
                binary.extend(spec['png'])
                doc['images'].append({'bufferView': len(views) - 1, 'mimeType': 'image/png', 'name': name})
                wrap = 10497 if spec.get('repeat') else 33071
                doc['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': wrap, 'wrapT': 33071})
                doc['textures'].append({'source': len(doc['images']) - 1, 'sampler': len(doc['samplers']) - 1})
                seen[key] = len(doc['textures']) - 1
            material.setdefault('pbrMetallicRoughness', {})['baseColorTexture'] = {'index': seen[key]}
            if spec.get('emissive'):
                material['emissiveTexture'] = {'index': seen[key]}
    doc['accessors'] = accessors; doc['bufferViews'] = views; doc['buffers'] = [{'byteLength': len(binary)}]
    doc['extensionsUsed'] = sorted(set(doc.get('extensionsUsed', []) + ['KHR_mesh_quantization']))
    doc['extensionsRequired'] = sorted(set(doc.get('extensionsRequired', []) + ['KHR_mesh_quantization']))
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    binary += bytes((-len(binary)) % 4)
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, total) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
                     + struct.pack('<II', len(binary), 0x004e4942) + binary)
