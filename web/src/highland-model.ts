/**
 * The Blender-built Highland bull (tools/blender/highland.py). Used by the live roadside bull, with the code-built rig kept as fallback.
 * The result has the shape of the animal rig in animals.ts, so the bull's factory can take it as it is.
 * Contract: tools/blender/highland-contract.json. Local forward is -Z; metres; the origin is on the ground.
 */
import * as THREE from 'three';
import { loadGlbScene } from './glb-model';

export interface HighlandRig {
  root: THREE.Group; body: THREE.Group; head: THREE.Group; tail: THREE.Group; neck: null;
  /** Front left, front right, rear left, rear right. Each pivot is .63 × shoulder high, with its hoof straight below. */
  legs: THREE.Group[];
  ears: THREE.Group[]; eyes: THREE.Mesh[]; jaw: null;
  torso: THREE.Mesh;
  /** Height of the withers, in metres. */
  shoulder: number;
  /** Where each hoof meets the ground, in the root's space at rest: same order as legs. */
  hooves: THREE.Vector3[];
}
export interface HighlandOptions {
  /** The LOW model: two draws; the legs and the tail are part of the body. */
  low?: boolean;
  /** Keep the four legs as their own meshes, for a walk. Costs four more draws. Desktop model only. */
  legs?: boolean;
}

export const HIGHLAND_SHOULDER = 1.12;
const LEGS = ['fl', 'fr', 'rl', 'rr'];
// One Lambert material, like the other animals. The file carries smooth normals: soft strands, smooth horns.
const material = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Decode quantized meshes into one plain float geometry in the target's space. */
function bake(meshes: THREE.Mesh[], target: THREE.Object3D): THREE.BufferGeometry {
  // Unlike the shared single-mesh bake, the preview also merges legs into the torso's space.
  const count = meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count ?? 0), 0);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colours = new Float32Array(count * 3), index: number[] = [];
  let first = 0;
  const inverse = new THREE.Matrix4().copy(target.matrixWorld).invert();
  const matrix = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    if (!p || !n || !c || !g.index) throw new Error(`Highland bull: ${mesh.name} needs positions, normals, colours and an index`);
    matrix.multiplyMatrices(inverse, mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); v.toArray(positions, (first + i) * 3);
      v.fromBufferAttribute(n, i).transformDirection(matrix); v.toArray(normals, (first + i) * 3);
      colours.set([c.getX(i), c.getY(i), c.getZ(i)], (first + i) * 3);
    }
    for (let i = 0; i < g.index.count; i++) index.push(first + g.index.getX(i));
    first += p.count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export async function loadHighlandBull(options: HighlandOptions = {}): Promise<HighlandRig> {
  const file = options.low ? 'highland-bull-low.glb' : 'highland-bull.glb';
  const scene = await loadGlbScene(file);
  scene.updateMatrixWorld(true);
  const find = (name: string): THREE.Object3D => {
    const node = scene.getObjectByName(name);
    if (!node) throw new Error(`Highland bull is missing ${name}`);
    return node;
  };
  const meshes = (name: string): THREE.Mesh[] => {
    const node = scene.getObjectByName(name);
    return node instanceof THREE.Mesh ? [node] : [];
  };
  // A fresh group at each named pivot: GLTFLoader makes plain Object3D nodes for Blender's empties.
  const group = (name: string, parent: THREE.Object3D | null, sources: THREE.Mesh[], pivot = find(name)): THREE.Group => {
    const result = new THREE.Group(); result.name = name;
    if (parent) {
      result.position.copy(pivot.getWorldPosition(new THREE.Vector3())).sub(parent.getWorldPosition(new THREE.Vector3()));
      parent.add(result);
    }
    if (sources.length) {
      const mesh = new THREE.Mesh(bake(sources, pivot), material); mesh.name = `${name}_mesh`; result.add(mesh);
    }
    return result;
  };
  let root: THREE.Group | null = null;
  try {
    for (const name of ['torso', 'head_mesh', ...(!options.low ? ['tail_mesh', ...LEGS.map(key => `leg_${key}_mesh`)] : [])]) {
      if (!(find(name) instanceof THREE.Mesh)) throw new Error(`Highland bull is missing mesh ${name}`);
    }
    root = group('highland', null, [], find('highland_bull'));
    root.rotation.order = 'YXZ';
    const legMeshes = LEGS.flatMap(key => meshes(`leg_${key}_mesh`));
    const separateLegs = !!options.legs && legMeshes.length === 4;
    const body = group('body', root, []);
    const torso = new THREE.Mesh(bake([...meshes('torso'), ...(separateLegs ? [] : legMeshes)], find('body')), material);
    torso.name = 'torso'; body.add(torso);
    const head = group('head', body, meshes('head_mesh'));
    const tail = group('tail', body, meshes('tail_mesh'));
    const legs = LEGS.map(key => group(`leg_${key}`, body, separateLegs ? meshes(`leg_${key}_mesh`) : []));
    const hooves = LEGS.map(key => find(`hoof_${key}`).getWorldPosition(new THREE.Vector3()));
    return { root, body, head, tail, neck: null, legs, ears: [], eyes: [], jaw: null, torso, shoulder: HIGHLAND_SHOULDER, hooves };
  } catch (error) {
    root?.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
    throw error;
  } finally {
    scene.traverse(node => { if (node instanceof THREE.Mesh) { node.geometry.dispose(); for (const m of [node.material].flat()) m.dispose(); } });
  }
}
