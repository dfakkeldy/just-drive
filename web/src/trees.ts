import { pavedTreeCell } from './paved-weight';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { readFile } from './store';
import type { Terrain } from './terrain';

/** Set by main.ts before the trees are made. `leafy` is a test (?leaves=1): crowns get light and dark leaf clumps, and a
 * warm glow where the sun is behind them. `oneSample`: the picture has one sample for each pixel (finish-choice.ts).
 * (Not an import of that choice: tools/art-shots.sh --stats runs this file alone.) */
export const treeLook = { leafy: false, oneSample: false };

const TILE = 256;   // metres: tree tiles match the level 8 terrain tiles
const RECORD = 8;

/** A test (?crowns=1): far hardwoods and birches are a few unequal leaf masses on a fork, not one ball on a stick. */
export const crownTest = { lobed: false };

/** Bounds of the populated instances, not of the unit tree at the origin. */
function boundInstances(mesh: THREE.InstancedMesh) {
  // Hill height is already baked into each root's y by terrain.heightAt/meshHeightAt.
  // The slider reloads those tiles at the new height. Tree shaders only shade/fade:
  // there is no vertex sway or other displacement outside the transformed geometry.
  mesh.computeBoundingBox();
  // Include every rotated/scaled crown and trunk, with a centimetre for float rounding.
  mesh.boundingBox!.expandByScalar(0.01);
  mesh.boundingSphere ??= new THREE.Sphere();
  mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere);
  mesh.frustumCulled = true; // three.js tests this bound with each render/shadow camera.
}

// All shapes use measured crown radius and total height as their instance scale.
// Bark is kept out of the seasonal instance tint in the Lambert vertex shader.
function surface(geo: THREE.BufferGeometry, leaf: boolean, pale = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position');
  const colours: number[] = [], tint: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), radius = Math.hypot(p.getX(i), p.getZ(i));
    if (leaf) {
      const shade = 0.61 + 0.30 * y + 0.09 * Math.min(radius, 1);
      colours.push(shade, shade, shade * 0.96);
    } else {
      // Small dark bark marks on the white birch/aspen stems.
      const mark = pale && Math.sin(y * 180) > 0.7 ? 0.46 : 1;
      colours.push(...(pale ? [0.58 * mark, 0.56 * mark, 0.47 * mark] : [0.16, 0.12, 0.085]));
    }
    tint.push(leaf ? 1 : 0);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setAttribute('leafTint', new THREE.Float32BufferAttribute(tint, 1));
  g.deleteAttribute('uv');
  return g;
}

function stem(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number, pale = false) {
  const from = new THREE.Vector3(x0, y0, z0), to = new THREE.Vector3(x1, y1, z1);
  const d = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(radius * 0.45, radius, d.length(), 3, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(...from.add(to).multiplyScalar(0.5).toArray());
  return surface(g, false, pale);
}

// The far match of the near leaf masses: faceted lumps with a flatter underside and soft normals.
// Twenty faces each. Eight-faced lumps were tried: point up they read as spikes, face up as boxes.
function farLobe(x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number, under = 0.55) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position'), normal = g.getAttribute('normal');
  const cos = Math.cos(seed * 1.73), sin = Math.sin(seed * 1.73);
  for (let k = 0; k < p.count; k++) {
    const px = p.getX(k), py = p.getY(k), pz = p.getZ(k);
    const ripple = 1 + 0.17 * Math.sin(px * 6.1 + pz * 8.3 + seed);
    const dx = px * rx * ripple, dz = pz * rz * ripple;
    p.setXYZ(k, x + dx * cos - dz * sin, y + py * ry * (py < 0 ? under : 1) + 0.06 * ry * Math.sin(px * 5 + seed), z + dx * sin + dz * cos);
    // Soft normals keep the faces from reading as boulders; the outline stays angular.
    const n = new THREE.Vector3(px, py * 1.5 + 0.25, pz).normalize();
    normal.setXYZ(k, n.x * cos - n.z * sin, n.y, n.x * sin + n.z * cos);
  }
  const leaf = surface(g, true), colour = leaf.getAttribute('color'), soft = leaf.getAttribute('normal');
  for (let k = 0; k < colour.count; k++) {
    // A darker underside and a small step between lumps separate them without a shader.
    const shade = (0.84 + 0.16 * Math.max(0, soft.getY(k))) * (1 + 0.12 * Math.sin(seed * 4.1));
    colour.setXYZ(k, colour.getX(k) * shade, colour.getY(k) * shade, colour.getZ(k) * shade);
  }
  return leaf;
}

// One full core keeps the wood's body; unequal shoulders at different heights break its outline.
function lobedCrown(parts: THREE.BufferGeometry[], birch: boolean, variant: number, small: boolean) {
  const sparse = variant === 2, phase = variant * 2.17 + (birch ? 1.1 : 0);
  const lean = birch ? 0.08 : -0.06, deep = birch ? 0.82 : 0.94;
  // [ring, height, radius, half height]: the core first, then the shoulders.
  // A sapling is one lump. The second birch crown has two, which pays for the third lump of the first.
  const lumps = small ? [[0.06, 0.69, 0.90, 0.28]]
    : sparse ? [[0.28, 0.84, 0.40, 0.11], [0.50, 0.70, 0.36, 0.09]]
    : birch && variant === 1 ? [[0.08, 0.72, 0.84, 0.26], [0.36, 0.54, 0.70, 0.17]]
    : birch ? [[0.03, 0.68, 0.86, 0.29], [0.48, 0.53, 0.56, 0.16], [0.42, 0.84, 0.52, 0.13]]
    : [[0.04, 0.68, 0.86, 0.29], [0.48, 0.52, 0.58, 0.17], [0.50, 0.78, 0.54, 0.15]];
  parts.push(stem(0, -0.025, 0, lean, sparse ? 0.93 : 0.72, 0.02, birch ? 0.037 : 0.055, birch));
  lumps.forEach(([ring, y, r, t], j) => {
    // The two shoulders sit on nearly opposite sides, so the crown keeps its measured width all round.
    const a = j * 3.5 + phase;
    const x = Math.cos(a) * ring + lean, z = Math.sin(a) * ring * deep;
    parts.push(farLobe(x, y, z, r, t, r * deep, j + phase, j ? 0.55 : 0.9));
    // The fork shows beneath the lower shoulder; a bare tree shows a limb to each lump.
    if (!small && (sparse || j === 1)) parts.push(stem(lean * 0.4, 0.30 + j * 0.08, 0, x, y, z, birch ? 0.020 : 0.026, birch));
  });
}

function farGeometry(kind: number, variant: number, small = false) {
  const parts: THREE.BufferGeometry[] = [];
  const evergreen = kind === 0 || kind === 3, birch = kind === 2, shrub = kind === 4;
  const sparse = !evergreen && !shrub && variant === 2;
  if (crownTest.lobed && !evergreen && !shrub) lobedCrown(parts, birch, variant, small);
  else if (evergreen) {
    const layers = small ? 2 : 3, sides = small ? 4 : 5;
    for (let j = 0; j < layers; j++) {
      const bottom = 0.18 + j * 0.25;
      const top = j === layers - 1 ? 0.97 : kind === 3 ? bottom + 0.37 : bottom + 0.47 - j * 0.06;
      const radius = (j === 0 ? 1 : j === 1 ? 0.63 : 0.30) * (kind === 3 ? 0.83 : 1);
      const cone = new THREE.ConeGeometry(radius, top - bottom, sides, 1, false);
      cone.rotateY(j * 0.7 + variant * 0.4).translate(j * 0.025, (top + bottom) / 2, 0);
      // Uneven skirt tips break the straight party-hat edge.
      const p = cone.getAttribute('position');
      for (let k = 0; k < p.count; k++) if (p.getY(k) < bottom + 0.001) {
        p.setY(k, bottom + 0.025 * Math.sin(p.getX(k) * 17 + p.getZ(k) * 11 + variant));
      }
      cone.computeVertexNormals();
      parts.push(surface(cone, true));
    }
    parts.push(stem(0, -0.025, 0, 0.025, 1, 0, 0.045));
  } else {
    // A single deformed crown avoids disconnected balls. Radial harmonics give it
    // several unequal lobes, while the shared sphere normals keep the leaves soft.
    const lobes = shrub ? 3 : 1;
    for (let j = 0; j < lobes; j++) {
      const sides = shrub ? 6 : small ? 6 : sparse || birch ? 8 : 10;
      const g = new THREE.SphereGeometry(1, sides, shrub || small || sparse ? 3 : 4);
      const p = g.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const angle = Math.atan2(z, x), phase = variant * 2.1;
        const ripple = 1 + 0.18 * Math.sin(angle * 3 + phase + y * 2) + 0.09 * Math.cos(angle * 5 - y * 3 + phase);
        const size = shrub ? 0.61 : 1;
        const scale = sparse ? 0.64 : 1;
        const shrubAngle = j * Math.PI * 2 / 3 + variant;
        p.setXYZ(k,
          x * size * ripple * scale + (shrub ? Math.cos(shrubAngle) * 0.36 : y * (variant - 1) * 0.14),
          shrub ? 0.30 + j * 0.055 + y * 0.29 : 0.70 + y * (birch ? 0.30 : 0.28) + 0.045 * Math.sin(angle * 3 + phase) * (1 - y * y),
          z * size * ripple * scale * (birch ? 0.82 : 0.94) + (shrub ? Math.sin(shrubAngle) * 0.36 : y * 0.09));
      }
      // Sphere normals are intentionally retained: smoothing avoids boulder-like faces.
      parts.push(surface(g, true));
    }
    parts.push(stem(0, -0.025, 0, -0.06, shrub ? 0.48 : sparse ? 0.93 : 0.76, 0.03, birch ? 0.037 : 0.055, birch));
    if (!small || shrub) {
      parts.push(stem(0, shrub ? 0 : 0.32, 0, 0.3, shrub ? 0.5 : 0.68, -0.12, 0.024, birch));
      if (shrub || sparse) parts.push(stem(0, shrub ? 0 : 0.56, 0, -0.35, shrub ? 0.53 : 0.9, 0.14, 0.02, birch));
    }
  }
  // Preserve the measured top height and horizontal radius, despite lobe distortion.
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Tree geometry attributes do not match');
  for (const g of parts) g.dispose();
  merged.computeBoundingBox();
  const box = merged.boundingBox;
  if (box) {
    const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z);
    const width = (sparse ? 0.72 : kind === 3 ? 0.85 : 1) / radius;
    merged.scale(width, 1 / box.max.y, width);
  }
  return merged;
}

// Lobes share the measured envelope. The gaps reveal the forks instead of a solid oval.
export function treeGeometry(kind: number, variant: number, small = false, near = false) {
  if (!near || small) return farGeometry(kind, variant, small);
  const parts: THREE.BufferGeometry[] = [];
  const birch = kind === 2, sparse = (kind === 1 || birch) && variant === 2;
  const phase = variant * 2.17;
  const clump = (x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number) => {
    const g = new THREE.SphereGeometry(1, 7, 4);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const ripple = 1 + 0.14 * Math.sin(a * 3 + seed + p.getY(i) * 5);
      p.setXYZ(i, x + p.getX(i) * rx * ripple, y + p.getY(i) * ry,
        z + p.getZ(i) * rz * ripple);
    }
    parts.push(surface(g, true));
  };
  const leafMass = (x: number, y: number, z: number, size: number, seed: number) => {
    // Closed, squat masses keep depth beneath the canopy without inflated sphere outlines.
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.getAttribute('position'), normal = g.getAttribute('normal');
    const turn = seed * 1.73, tiltX = 0.11 * Math.sin(seed * 2.7), tiltZ = 0.10 * Math.cos(seed * 1.9);
    const thickness = size * (0.15 + 0.035 * Math.sin(seed * 3.3));
    for (let k = 0; k < p.count; k++) {
      const px = p.getX(k), py = p.getY(k), pz = p.getZ(k);
      const ripple = 1 + 0.15 * Math.sin(px * 6.1 + pz * 8.3 + seed);
      const dx = px * size * ripple, dz = pz * size * 0.83 * ripple;
      p.setXYZ(k, x + dx * Math.cos(turn) - dz * Math.sin(turn),
        y + py * thickness + dx * tiltX + dz * tiltZ,
        z + dx * Math.sin(turn) + dz * Math.cos(turn));
      // Soft tuft normals remove the large flat panels; the outline stays angular.
      const n = new THREE.Vector3(px, py * 1.7, pz).normalize();
      normal.setXYZ(k, n.x * Math.cos(turn) - n.z * Math.sin(turn), n.y,
        n.x * Math.sin(turn) + n.z * Math.cos(turn));
    }
    const leaf = surface(g, true), colour = leaf.getAttribute('color');
    for (let k = 0; k < colour.count; k++) {
      const shade = (0.80 + 0.20 * Math.max(0, normal.getY(k))) * (0.95 + 0.08 * Math.sin(seed * 4.1));
      colour.setXYZ(k, colour.getX(k) * shade, colour.getY(k) * shade, colour.getZ(k) * shade);
      // 2 marks layered hardwood foliage; both leaf values still receive the full seasonal tint.
      leaf.getAttribute('leafTint').setX(k, 2);
    }
    parts.push(leaf);
  };
  if (kind === 0 || kind === 3) {
    const larch = kind === 3, layers = larch ? 7 : 8, points = larch ? 12 : 16;
    // Narrow shoulders and alternating long tips suggest hanging sprays, not cone skirts.
    for (let j = 0; j < layers; j++) {
      const y = 0.18 + j * 0.10;
      const radius = Math.pow(1 - j / layers, 1.05) * (larch ? 0.82 : 1);
      const vertices: number[] = [];
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k < points; k++) {
        const a = k * Math.PI * 2 / points + phase + j * 1.9;
        const r = radius * (k % 2 ? larch ? 0.26 : 0.48 : 0.85 + 0.15 * Math.sin(k * 7 + j * 4 + phase));
        ring.push(new THREE.Vector3(Math.cos(a) * r, y + (k % 2 ? 0.045 : -0.025 - 0.025 * Math.sin(k + j)), Math.sin(a) * r));
      }
      const top = new THREE.Vector3(0.02 * Math.sin(j + phase), Math.min(1, y + 0.20), 0);
      const bottom = new THREE.Vector3(0, y + 0.015, 0);
      for (let k = 0; k < points; k++) {
        const a = ring[k], b = ring[(k + 1) % points];
        vertices.push(...top.toArray(), ...b.toArray(), ...a.toArray(), ...bottom.toArray(), ...a.toArray(), ...b.toArray());
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      g.computeVertexNormals();
      parts.push(surface(g, true));
      if (larch && j < 4) {
        const a = j * 2.4 + phase;
        parts.push(stem(0, y + 0.09, 0, Math.cos(a) * radius, y - 0.015, Math.sin(a) * radius, 0.009));
      }
    }
    parts.push(stem(0, -0.025, 0, 0, 1, 0, larch ? 0.028 : 0.043));
  } else if (kind === 4) {
    for (let j = 0; j < 5; j++) {
      const a = j * 2.4 + phase;
      clump(Math.cos(a) * 0.45, 0.30 + (j % 3) * 0.10, Math.sin(a) * 0.45, 0.52, 0.29, 0.43, j + phase);
      parts.push(stem(0, -0.025, 0, Math.cos(a) * 0.55, 0.52, Math.sin(a) * 0.55, 0.022));
    }
  } else {
    const lean = birch ? 0.10 : -0.07;
    parts.push(stem(0, -0.025, 0, lean, 0.78, 0.02, birch ? 0.038 : 0.065, birch));
    for (let j = 0; j < 8; j++) {
      const a = j * 2.4 + phase;
      const ring = j < 5 ? 0.56 : 0.34;
      const x = Math.cos(a) * ring + lean, z = Math.sin(a) * ring * (birch ? 0.70 : 1);
      const y = j < 5 ? 0.56 + (j % 3) * 0.055 : 0.81 + (j % 2) * 0.045;
      const start = 0.26 + (j % 4) * 0.09;
      parts.push(stem(lean * start, start, 0, x, y + (sparse ? 0.11 : 0.02), z, birch ? 0.017 : 0.026, birch));
      // Fine exposed forks remain visible on the few trees that have shed their leaves.
      if (sparse || j % 2 === 0) {
        parts.push(stem(x * 0.65, y - 0.10, z * 0.65, x * 1.25, y + 0.14, z * 1.18, 0.010, birch));
      }
    }
    const lobes = sparse ? 10 : birch ? 18 : 20;
    for (let j = 0; j < lobes; j++) {
      const a = j * 2.4 + phase, layer = j % 3;
      const edge = j >= lobes - 3;
      const ring = edge ? 0.85 : [0.47, 0.58, 0.34][layer];
      const size = (edge ? 0.11 : sparse ? 0.15 : 0.35 + 0.09 * Math.sin(j * 4.9 + phase)) * (birch ? 0.88 : 1);
      leafMass(Math.cos(a) * ring + lean,
        0.56 + layer * 0.14 + 0.024 * Math.sin(j * 2.9 + phase),
        Math.sin(a) * ring * (birch ? 0.72 : 1), size, j + phase);
    }
  }
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Tree geometry attributes do not match');
  for (const g of parts) g.dispose();
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  const radius = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z);
  const width = (sparse ? 0.72 : kind === 3 ? 0.85 : 1) / radius;
  merged.scale(width, 1 / box.max.y, width);
  return merged;
}

function winterTreeGeometry(kind: number, variant: number, small: boolean, near: boolean) {
  if (kind === 0) {
    const geometry = treeGeometry(kind, variant, small, near);
    const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const colour = geometry.getAttribute('color'), leaf = geometry.getAttribute('leafTint');
    for (let i = 0; i < pos.count; i++) {
      if (!leaf.getX(i)) continue;
      const top = THREE.MathUtils.smoothstep(pos.getY(i), 0.40, 0.88);
      const shelf = THREE.MathUtils.smoothstep(normal.getY(i), 0.12, 0.62);
      const snow = Math.min(0.92, top * 0.68 + shelf * 0.30);
      const dark = colour.getX(i);
      colour.setXYZ(i, dark * 0.042 + snow * 0.58, dark * 0.10 + snow * 0.63, dark * 0.065 + snow * 0.67);
      leaf.setX(i, 0);    // Snow and needles are already in linear light.
    }
    return geometry;
  }
  const birch = kind === 2, shrub = kind === 4, larch = kind === 3;
  const top = shrub ? 0.62 : 1;
  const lean = birch ? 0.09 : -0.05, phase = variant * 2.17;
  const parts = [stem(0, -0.025, 0, lean, top, 0, shrub ? 0.031 : 0.055, birch)];
  const branches = small ? 3 : near ? 8 : 5;
  for (let i = 0; i < branches; i++) {
    const t = i / branches, a = phase + i * 2.4;
    const start = (0.24 + 0.50 * t) * top;
    const spread = (1 - t * 0.64) * (shrub ? 0.77 : 0.81);
    const x = Math.cos(a) * spread, z = Math.sin(a) * spread;
    const tip = Math.min(top, start + (larch ? 0.15 : 0.28) * top);
    parts.push(stem(lean * t, start, 0, x, tip, z, 0.021 - t * 0.009, birch));
    if (near && !small) parts.push(stem(x * 0.67, (start + tip) * 0.5, z * 0.67, x * 1.03, tip + 0.08,
      z * 0.80, 0.009, birch));
  }
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return geometry;
}

// Three silhouettes per species, plus a cheaper sapling for trees below 5 m.
function variantFor(kind: number, seed: number, height: number) {
  const crown = kind === 1 || kind === 2 ? (seed % 13 === 0 ? 2 : seed % 2) : seed % 3;
  return kind * 4 + (height < 5 && kind !== 4 ? 3 : crown);
}

interface TreeBatch {
  far: THREE.InstancedMesh; near?: THREE.InstancedMesh;
  matrices: Float32Array; colours: Float32Array;
}
interface TreeTile {
  key: string; meshes: THREE.InstancedMesh[]; batches: TreeBatch[]; lastUsed: number;
  x: number; z: number; splitX: number; splitY: number; splitZ: number; detail: boolean;
}

/** Single trees, placed where the LiDAR found tree tops. They are drawn on the fine terrain tiles near the camera. */
export class Trees {
  readonly group = new THREE.Group();
  private have = new Set<string>();
  private tiles = new Map<string, TreeTile | 'loading'>();
  private decoded = new Map<string, DataView>();   // Keep late files until their fine ground is ready; never fetch twice.
  private retry = new Map<string, { at: number; tries: number }>();   // failed tiles and when to ask again
  private shapes: THREE.BufferGeometry[];
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private nearShapes: THREE.BufferGeometry[];
  private eye = { value: new THREE.Vector3() };
  private farMaterial: THREE.MeshLambertMaterial;
  private nearMaterial: THREE.MeshLambertMaterial;
  private farDepth: THREE.MeshDepthMaterial;
  private nearDepth: THREE.MeshDepthMaterial;
  private frame = 0;
  private active = 0;
  count = 0;

  constructor(tiles: string[], private base: string, private terrain: Terrain, private detail = true, private excludes?: (east: number, north: number) => boolean) {
    const shape = terrain.uniforms?.winterCover ? winterTreeGeometry : treeGeometry;
    this.shapes = Array.from({ length: 20 }, (_, i) => shape(Math.floor(i / 4), i % 4, i % 4 === 3, false));
    this.nearShapes = terrain.low || !detail ? [] : Array.from({ length: 20 }, (_, i) => shape(Math.floor(i / 4), i % 4, i % 4 === 3, true));
    for (const t of tiles) this.have.add(t);
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float leafTint;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>',
        THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;',
          'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, leafTint);'));
    };
    this.material.customProgramCacheKey = () => 'tree-bark-tint-r170';
    this.farMaterial = this.material.clone();
    this.nearMaterial = this.material.clone();
    // A camera beneath or inside a leaf mass still sees a solid underside.
    this.nearMaterial.side = THREE.DoubleSide;
    this.farDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.nearDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.prepare(this.farMaterial, false);
    this.prepare(this.nearMaterial, true);
    this.prepare(this.farDepth, false, true);
    this.prepare(this.nearDepth, true, true);
  }

  private prepare(material: THREE.Material, near: boolean, depth = false) {
    // The near and far shapes fade into each other through the picture's edge samples. A picture with one sample for
    // each pixel (finish-choice.ts) has none: there a fine screen pattern drops the pixels, and the edge smoothing softens it.
    const oneSample = treeLook.oneSample;
    if (!depth) (material as THREE.MeshLambertMaterial).alphaToCoverage = !oneSample;
    material.onBeforeCompile = shader => {
      shader.uniforms.treeEye = this.eye;
      const varying = 'varying vec3 vTreeWorld; varying float vTreeFade;';
      shader.vertexShader = 'uniform vec3 treeEye;\n' + varying + '\n' + shader.vertexShader;
      shader.fragmentShader = varying + '\n' + shader.fragmentShader;
      const coverage = near ? '1.0 - smoothstep(0.5, 1.0, vTreeFade)' : 'smoothstep(0.0, 0.5, vTreeFade)';
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec4 treeBase = modelMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0);
        vTreeFade = smoothstep(45.0, 75.0, distance(treeEye, treeBase.xyz));
        vTreeWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
      `);
      // The shadow map has no MSAA. Its fixed world pattern stays attached to the tree.
      if (depth) shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        float treeCoverage = ${coverage};
        if (treeCoverage > 0.0 && treeCoverage < 1.0) {
          vec3 cell = floor(vTreeWorld * 6.0);
          float grain = fract(52.9829189 * fract(dot(cell, vec3(0.06711056, 0.00583715, 0.038171))));
          if (grain >= treeCoverage) discard;
        } else if (treeCoverage <= 0.0) discard;
      `);
      if (!depth) {
        // Overlap the fades: one crown stays opaque, so shared pixels never become see-through.
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', oneSample ? `
          float treeCoverage = ${coverage};
          if (treeCoverage < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= treeCoverage) discard;
          #include <opaque_fragment>
        ` : `
          diffuseColor.a *= ${coverage};
          #include <opaque_fragment>
        `);
        if (treeLook.leafy) {
          shader.fragmentShader = `
            float leafHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
            float leafNoise(vec3 p) {
              vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(mix(leafHash(i), leafHash(i + vec3(1, 0, 0)), f.x), mix(leafHash(i + vec3(0, 1, 0)), leafHash(i + vec3(1, 1, 0)), f.x), f.y),
                mix(mix(leafHash(i + vec3(0, 0, 1)), leafHash(i + vec3(1, 0, 1)), f.x), mix(leafHash(i + vec3(0, 1, 1)), leafHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
            }
          ` + shader.fragmentShader.replace('#include <lights_fragment_begin>', `
            if (vLeaf > 0.5) {
              // Clumps of leaves, fixed to the tree. They fade out far away, where they would only flicker.
              float leafSeen = 1.0 - smoothstep(160.0, 480.0, distance(cameraPosition, vTreeWorld));
              float clump = 0.6 * leafNoise(vTreeWorld * 1.15) + 0.4 * leafNoise(vTreeWorld * 3.3 + 5.0);
              diffuseColor.rgb *= mix(1.0, 0.62 + 0.76 * clump, leafSeen);
            }
            #include <lights_fragment_begin>
          `).replace('#include <lights_fragment_end>', `
            #include <lights_fragment_end>
            #if NUM_DIR_LIGHTS > 0
            if (vLeaf > 0.5) {
              // Leaves let some sun through: the side away from the sun is not dead, it glows a little, and warmer.
              float through = max(dot(-normal, directionalLights[0].direction), 0.0);
              reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * through * 0.15 * vec3(1.15, 1.0, 0.55);
            }
            #endif
          `);
        }
        shader.vertexShader = 'attribute float leafTint; varying float vLeaf; varying vec3 vCrown;\n' + shader.vertexShader;
        shader.fragmentShader = 'varying float vLeaf; varying vec3 vCrown;\n' + shader.fragmentShader;
        shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>',
          'vLeaf = leafTint; vCrown = position * vec3(9.0, 21.0, 9.0);\n' +
          THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;',
            'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, clamp(leafTint, 0.0, 1.0));'));
        if (near) {
          shader.fragmentShader = `
            float treeNoise(vec3 p) {
              vec3 cell = floor(p), f = fract(p);
              f = f * f * (3.0 - 2.0 * f);
              float n = dot(cell, vec3(1.0, 57.0, 113.0));
              vec4 lo = fract(sin(n + vec4(0.0, 1.0, 57.0, 58.0)) * 43758.5453);
              vec4 hi = fract(sin(n + vec4(113.0, 114.0, 170.0, 171.0)) * 43758.5453);
              vec4 s = mix(lo, hi, f.z);
              return mix(mix(s.x, s.y, f.x), mix(s.z, s.w, f.x), f.y);
            }
          ` + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            // Dark gaps and small bright tufts suggest leaves without cutting holes in a mass.
            float tuft = treeNoise(vCrown * 3.2);
            float fine = treeNoise(vCrown * 8.4 + vec3(3.7, 1.4, 8.2));
            float coarseFilter = smoothstep(0.35, 1.1, length(fwidth(vCrown * 3.2)));
            float fineFilter = smoothstep(0.35, 1.1, length(fwidth(vCrown * 8.4)));
            tuft = mix(tuft, 0.5, coarseFilter);
            fine = mix(fine, 0.5, fineFilter);
            float shade = mix(0.90 + 0.20 * tuft, 0.78 + 0.48 * smoothstep(0.20, 0.80, tuft), step(1.5, vLeaf));
            diffuseColor.rgb *= mix(1.0, shade + 0.12 * (fine - 0.5), min(vLeaf, 1.0));
            // Pale bark keeps its dark horizontal flecks, independent of the autumn tint.
            if (vLeaf < 0.5 && vColor.r > 0.4) {
              float mark = smoothstep(0.82, 0.95, sin(vCrown.y * 8.5 + sin(vCrown.x * 21.0)));
              diffuseColor.rgb *= 1.0 - 0.48 * mark;
            }
          `);
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
            #if NUM_DIR_LIGHTS > 0
              float back = pow(max(0.0, dot(-normalize(vViewPosition), directionalLights[0].direction)), 3.0);
              float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
              outgoingLight += min(vLeaf, 1.0) * diffuseColor.rgb * directionalLights[0].color * back * rim * 0.22 * vec3(1.0, 0.78, 0.42);
            #endif
            #include <opaque_fragment>
          `);
        }
      }
    };
    material.customProgramCacheKey = () => `tree-layers-3-${near}-${depth}`;
  }

  // Repack only tiles at the eye, and only after moving. Distant trees keep one cheap draw.
  private split(t: TreeTile, eye: THREE.Vector3) {
    if (Math.hypot(eye.x - t.splitX, eye.y - t.splitY, eye.z - t.splitZ) < 3) return;
    const distance = Math.hypot(Math.max(t.x - eye.x, 0, eye.x - t.x - TILE),
      Math.max(t.z - eye.z, 0, eye.z - t.z - TILE));
    if (distance > 80 && !t.detail) return;
    t.splitX = eye.x; t.splitY = eye.y; t.splitZ = eye.z; t.detail = distance <= 80;
    for (const b of t.batches) {
      // Beyond the dissolve, use the original opaque shader in both passes.
      b.far.material = t.detail ? this.farMaterial : this.material;
      b.far.customDepthMaterial = t.detail ? this.farDepth : undefined;
      let far = 0, near = 0;
      const m = b.matrices, c = b.colours;
      for (let i = 0; i < m.length / 16; i++) {
        const o = i * 16;
        const d = Math.hypot(m[o + 12] - eye.x, m[o + 13] + m[o + 5] * 0.5 - eye.y, m[o + 14] - eye.z);
        if (d >= 42) {
          (b.far.instanceMatrix.array as Float32Array).set(m.subarray(o, o + 16), far * 16);
          (b.far.instanceColor!.array as Float32Array).set(c.subarray(i * 3, i * 3 + 3), far++ * 3);
        }
        if (d <= 78) {
          if (!b.near) {
            const shape = this.shapes.indexOf(b.far.geometry);
            b.near = new THREE.InstancedMesh(this.nearShapes[shape], this.nearMaterial, m.length / 16);
            b.near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c.length), 3);
            b.near.customDepthMaterial = this.nearDepth;
            t.meshes.push(b.near); this.group.add(b.near);
          }
          (b.near.instanceMatrix.array as Float32Array).set(m.subarray(o, o + 16), near * 16);
          (b.near.instanceColor!.array as Float32Array).set(c.subarray(i * 3, i * 3 + 3), near++ * 3);
        }
      }
      b.far.count = far; b.far.instanceMatrix.needsUpdate = true; b.far.instanceColor!.needsUpdate = true;
      boundInstances(b.far);
      if (b.near) {
        b.near.count = near; b.near.instanceMatrix.needsUpdate = true; b.near.instanceColor!.needsUpdate = true;
        boundInstances(b.near);
      }
    }
  }

  has(key: string) { return this.have.has(key); }

  /** Tree tiles still on their way; screenshots wait for this to reach zero. */
  get pending() { return this.active; }

  update(drawn: Set<string>, camera?: THREE.Vector3) {
    if (camera) this.eye.value.copy(camera);
    this.frame++;
    this.count = 0;
    for (const t of this.tiles.values()) if (t !== 'loading') for (const m of t.meshes) m.visible = false;
    for (const key of drawn) {
      if (!this.have.has(key)) continue;
      const t = this.tiles.get(key);
      if (!t) {
        const again = this.retry.get(key);
        if (again && performance.now() < again.at) continue;
        this.tiles.set(key, 'loading');
        this.load(key).then(() => this.retry.delete(key)).catch((e) => {
          const tries = (again?.tries ?? 0) + 1;
          this.retry.set(key, { at: performance.now() + Math.min(60000, 1000 * 2 ** tries), tries });
          console.warn('trees', key, e);
          this.tiles.delete(key);
        });
        continue;
      }
      if (t === 'loading') {
        const data = this.decoded.get(key);
        if (data) this.plant(key, data);
        continue;
      }
      t.lastUsed = this.frame;
      if (!this.terrain.low && this.detail && camera) this.split(t, camera);
      for (const m of t.meshes) m.visible = m.count > 0;
      for (const b of t.batches) this.count += b.matrices.length / 16;
    }
    if (this.frame % 900 === 0 && this.tiles.size > 90) {
      for (const [key, t] of this.tiles) if (t !== 'loading' && this.frame - t.lastUsed > 1800) {
        for (const m of t.meshes) { this.group.remove(m); m.dispose(); }
        this.tiles.delete(key);
      }
    }
  }

  readonly coastAudit = new Map<string,{checked:number;rejected:number;grounded:number}>();

  private readonly pavedMasks = new Map<string,Uint8Array|null>();

  private async load(key: string) {
    this.active++;
    try {
      const [bytes,mask] = await Promise.all([readFile(this.base, `8/${key}.t.bin`).then(b=>b.arrayBuffer()), this.terrain.paved?.treeMask(key) ?? null]);
      const data = new DataView(bytes);
      this.pavedMasks.set(key,mask);
      this.decoded.set(key, data);
      this.plant(key, data);
    } finally { this.active--; }
  }

  private plant(key: string, data: DataView) {
    const n = Math.floor(data.byteLength / RECORD);
    const [i, j] = key.split('_').map(Number);
    const m = this.terrain.manifest;
    const x0 = m.origin[0] + i * TILE - m.village[0], z0 = m.village[1] - (m.origin[1] - j * TILE);
    // All records lie inside this level-8 tile. A coarse sample here would bake a permanent wrong root height.
    if ((this.terrain.surfaceAt(x0 + TILE / 2, z0 + TILE / 2)?.level ?? -1) < 8) return;
    this.decoded.delete(key);
    const pavedMask=this.pavedMasks.get(key) ?? null;
    this.pavedMasks.delete(key);
    const counts = new Array<number>(this.shapes.length).fill(0);
    // Share the terrain's building/landmark exclusions. Roof returns and low bushes
    // otherwise appear through facades when a newly measured building is added.
    const clear = this.terrain.clear.filter(([left, near, right, far]) =>
      right >= x0 && left <= x0 + TILE && far >= z0 && near <= z0 + TILE);
    const records: number[] = [];
    const grounded = new Map<number,number>();
    const audit={checked:0,rejected:0,grounded:0};
    for (let k = 0; k < n; k++) {
      const o = k * RECORD;
      const x = x0 + data.getUint16(o, true) / 65536 * TILE;
      const z = z0 + data.getUint16(o + 2, true) / 65536 * TILE;
      if(this.terrain.groundClassAt(x,z)===6||this.terrain.groundClassAt(x,z)===8)continue;
      if (this.excludes?.(x + m.village[0], m.village[1] - z)) continue;
      if (this.terrain.sidewalks?.vegetationAt(x,z,Math.min(20,data.getUint8(o+5)*.1))) continue;
      if (pavedTreeCell(pavedMask,x-x0,z-z0)) continue;
      if (clear.some(([left, near, right, far]) => x >= left && x <= right && z >= near && z <= far)) continue;
      if(this.terrain.coast?.contains(x,z)){
        audit.checked++;
        const t=this.terrain,sea=t.seaLevel,exag=t.exag;
        const drawn=t.meshHeightAt(x,z),h=t.heightAt(x,z);
        // Quarry faces use the loaded fine tile. A neighbour arriving later must not change which trees survive.
        // Keep the existing coast's sample points and arithmetic exactly as before.
        const quarry=!!t.coast!.quarry;
        const left=quarry?Math.max(x0+.001,x-2):x-2,right=quarry?Math.min(x0+TILE-.001,x+2):x+2;
        const near=quarry?Math.max(z0+.001,z-2):z-2,far=quarry?Math.min(z0+TILE-.001,z+2):z+2;
        const hx0=t.heightAt(left,z),hx1=t.heightAt(right,z),hz0=t.heightAt(x,near),hz1=t.heightAt(x,far);
        const slope=hx0===null||hx1===null||hz0===null||hz1===null?Infinity:quarry
          ?Math.hypot((hx1-hx0)/(right-left),(hz1-hz0)/(far-near))/exag:Math.hypot(hx1-hx0,hz1-hz0)/(4*exag);
        const raw=h===null?-Infinity:h>sea?sea+(h-sea)/exag:h;
        if(drawn===null || !t.coast!.treeAllowed(x,z,raw,slope)){audit.rejected++;continue;}
        grounded.set(k,drawn);audit.grounded++;
      }
      records.push(k);
      counts[variantFor(data.getUint8(o + 6), data.getUint8(o + 7), data.getUint8(o + 4) * 0.2)]++;
    }
    if(audit.checked)this.coastAudit.set(key,audit);
    const meshes = this.shapes.map((g, v) => counts[v] ? new THREE.InstancedMesh(g, this.material, counts[v]) : null);
    const at = new Array<number>(this.shapes.length).fill(0);
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const k of records) {
      const o = k * RECORD;
      const x = x0 + (data.getUint16(o, true) / 65536) * TILE, z = z0 + (data.getUint16(o + 2, true) / 65536) * TILE;
      const h = data.getUint8(o + 4) * 0.2, r = Math.max(data.getUint8(o + 5) * 0.1, 0.6), kind = data.getUint8(o + 6), seed = data.getUint8(o + 7);
      const v = seed / 255, v2 = ((seed * 73) & 255) / 255;
      const y = grounded.get(k) ?? this.terrain.heightAt(x, z) ?? 0;
      const cone = kind === 0 || kind === 3;
      // Species proportions cap over-wide detections but still follow the measured radius.
      const rr = cone ? Math.min(r, 0.14 * h + 0.5) : kind === 2 ? Math.min(r, 0.16 * h + 0.6) : kind === 4 ? r : Math.min(r, 0.29 * h + 0.6);
      q.setFromAxisAngle(up, v * 6.283);
      mat.compose(new THREE.Vector3(x, y - 0.25, z), q, new THREE.Vector3(rr * (0.9 + 0.2 * v2), h, rr * (0.9 + 0.2 * v)));
      // Mid-October: most hardwoods have turned, some are still green, a few are already brown.
      if (kind === 0) col.setRGB(0.045 + 0.03 * v, 0.11 + 0.045 * v, 0.065 + 0.018 * v);
      else if (kind === 3) col.setRGB(0.40 + 0.10 * v, 0.31 + 0.09 * v, 0.075 + 0.025 * v);
      else if (v2 > 0.85) col.setRGB(0.16 + 0.05 * v, 0.20 + 0.045 * v, 0.065);
      else if (v2 < 0.12) col.setRGB(0.25, 0.17, 0.09);
      else if (kind === 1) col.setRGB(0.32 + 0.17 * v, 0.095 + 0.09 * v, 0.055 + 0.025 * v);
      else if (kind === 2) col.setRGB(0.43 + 0.14 * v, 0.31 + 0.12 * v, 0.075 + 0.03 * v);
      else col.setRGB(0.22 + 0.12 * v, 0.20 + 0.07 * v, 0.075);
      const variant = variantFor(kind, seed, h), mesh = meshes[variant];
      if (mesh) {
        mesh.setMatrixAt(at[variant], mat);
        mesh.setColorAt(at[variant]++, col);
      }
    }
    const populated = meshes.filter((mesh): mesh is NonNullable<typeof mesh> => mesh !== null);
    for (const mesh of populated) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      boundInstances(mesh);
      mesh.visible = false;
      this.group.add(mesh);
    }
    const batches: TreeBatch[] = populated.map(far => ({ far,
      matrices: this.terrain.low || !this.detail ? far.instanceMatrix.array as Float32Array : (far.instanceMatrix.array as Float32Array).slice(),
      colours: this.terrain.low || !this.detail ? far.instanceColor!.array as Float32Array : (far.instanceColor!.array as Float32Array).slice() }));
    this.tiles.set(key, { key, meshes: populated, batches, lastUsed: this.frame,
      x: x0, z: z0, splitX: Infinity, splitY: Infinity, splitZ: Infinity, detail: false });
  }
}
