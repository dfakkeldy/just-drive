/**
 * Loads a model made by the Blender tools (tools/blender/animal_kit.py): named pivots that are not turned or
 * scaled, and mesh leaves with vertex colours and smooth normals. The file is quantized
 * (KHR_mesh_quantization, tools/blender/glb_quantize.py) and has no textures and no skeleton.
 *
 * The result is plain three.js: one fresh Group for each pivot, in the file's own tree, and each mesh decoded to
 * float geometry in its pivot's space. All meshes share the material given. The loader's own scene is disposed.
 * Local forward is -Z, units are metres, and the origin is on the ground.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface GlbModel {
  /** The top pivot. */
  root: THREE.Group;
  /** Every pivot by its name in the file, the top one included. */
  pivots: Record<string, THREE.Group>;
  meshes: THREE.Mesh[];
  triangles: number;
  /** Free the geometry. The material belongs to the caller. */
  dispose(): void;
}

/** Models are site files beside the land (see main.ts `base`): `models/<file>` from the page's own folder. */
export const modelUrl = (file: string): string => `${import.meta.env.BASE_URL}models/${file}`;

/** Decode one quantized mesh into plain float geometry in the target's space. */
function bake(mesh: THREE.Mesh, target: THREE.Object3D): THREE.BufferGeometry {
  const g = mesh.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
  if (!p || !n || !c || !g.index) throw new Error(`model mesh ${mesh.name} needs positions, normals, colours and an index`);
  const matrix = new THREE.Matrix4().copy(target.matrixWorld).invert().multiply(mesh.matrixWorld), v = new THREE.Vector3();
  const positions = new Float32Array(p.count * 3), normals = new Float32Array(p.count * 3), colours = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix).toArray(positions, i * 3);
    v.fromBufferAttribute(n, i).transformDirection(matrix).toArray(normals, i * 3);
    colours[i * 3] = c.getX(i); colours[i * 3 + 1] = c.getY(i); colours[i * 3 + 2] = c.getZ(i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(Array.from(g.index.array));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Load `models/<file>`. It rejects when the file is missing, is not a model, or does not have every pivot in
 * `needs`: the caller then goes on without the model. (A dev server answers a missing file with the page itself;
 * the loader rejects that too.)
 */
export async function loadGlbModel(file: string, material: THREE.Material, needs: readonly string[] = []): Promise<GlbModel> {
  const gltf = await new GLTFLoader().loadAsync(modelUrl(file));
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const pivots: Record<string, THREE.Group> = {}, meshes: THREE.Mesh[] = [];
  const dispose = () => { for (const mesh of meshes) mesh.geometry.dispose(); };
  const release = () => scene.traverse((node) => {
    if (node instanceof THREE.Mesh) { node.geometry.dispose(); for (const m of [node.material].flat()) m.dispose(); }
  });
  let triangles = 0;
  const place = new THREE.Vector3(), from = new THREE.Vector3();
  try {
    // A fresh group at each pivot. Meshes hang from the nearest pivot above them.
    const copy = (node: THREE.Object3D, parent: THREE.Group | null, parentNode: THREE.Object3D | null): void => {
      if (node instanceof THREE.Mesh) {
        if (!parent || !parentNode) throw new Error(`model mesh ${node.name} has no pivot`);
        const mesh = new THREE.Mesh(bake(node, parentNode), material); mesh.name = node.name;
        triangles += mesh.geometry.index!.count / 3;
        parent.add(mesh); meshes.push(mesh);
        return;
      }
      const group = new THREE.Group(); group.name = node.name;
      group.rotation.order = 'YXZ';
      if (parent && parentNode) { group.position.copy(node.getWorldPosition(place)).sub(parentNode.getWorldPosition(from)); parent.add(group); }
      pivots[node.name] = group;
      for (const child of node.children) copy(child, group, node);
    };
    const tops = scene.children.filter((node) => !(node instanceof THREE.Mesh));
    if (tops.length !== 1) throw new Error(`model ${file} needs one top pivot, and has ${tops.length}`);
    copy(tops[0], null, null);
    for (const name of needs) if (!pivots[name]) throw new Error(`model ${file} has no pivot named ${name}`);
    return { root: pivots[tops[0].name], pivots, meshes, triangles, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    release();
  }
}

/**
 * Load `models/<file>` as it is: the file's own tree, materials and pictures, for a model that has more than one
 * material (the mail car). It rejects when the file is missing, is not a whole model file, or is not here after
 * `timeoutMs`; a request that is still open then is cancelled. The caller owns the scene and frees it.
 *
 * The file's own header is checked before it is read: a download that was cut short must not give half a model
 * (GLTFLoader would build the car without the pictures that were cut off, and only log an error).
 */
export async function loadGlbScene(file: string, timeoutMs = 15000): Promise<THREE.Group> {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const response = await fetch(modelUrl(file), { signal: stop.signal });
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    const bytes = await response.arrayBuffer(), head = new DataView(bytes);
    // glTF binary: 'glTF', version 2, the whole length; then chunks (length, type, data) that end where the file ends.
    if (bytes.byteLength < 20 || head.getUint32(0, true) !== 0x46546c67 || head.getUint32(4, true) !== 2) throw new Error(`${file} is not a glTF 2 binary file`);
    if (head.getUint32(8, true) !== bytes.byteLength) throw new Error(`${file} is cut short or damaged: ${bytes.byteLength} bytes, and its header says ${head.getUint32(8, true)}`);
    let at = 12;
    while (at < bytes.byteLength) {
      if (at + 8 > bytes.byteLength || (at === 12 && head.getUint32(at + 4, true) !== 0x4e4f534a)) throw new Error(`${file} is damaged: its parts do not fit the file`);
      at += 8 + head.getUint32(at, true);
    }
    if (at !== bytes.byteLength) throw new Error(`${file} is damaged: its parts do not fit the file`);
    return (await new GLTFLoader().parseAsync(bytes, '')).scene;
  } finally { clearTimeout(timer); }
}
