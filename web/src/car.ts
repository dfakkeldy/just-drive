import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { Rig } from './vehicle-spec';

export interface Car extends Rig {
  root: THREE.Group;
  body: THREE.Group;
  wheels: { fl: THREE.Object3D; fr: THREE.Object3D; rl: THREE.Object3D; rr: THREE.Object3D };
  steer: { fl: THREE.Object3D; fr: THREE.Object3D };
  beacon: THREE.Mesh;
  signLight: THREE.Mesh;
  brakeLights: THREE.Mesh[];
  driverEye: THREE.Object3D;
  driverWindow: THREE.Mesh;
  setWindowDown(down: boolean): void;
  setDirt(amount: number): void;
}

type Point = [number, number, number];
type Profile = [number, number]; // z, y
const v = (p: Point) => new THREE.Vector3(...p);

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The car textures need a 2D canvas context.');
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Shared curved panels. Outward winding keeps sun-shadow normal bias outside the skin. */
function surface(rows: number, columns: number, point: (u: number, t: number) => Point, flip = false): THREE.BufferGeometry {
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const u = i / columns, t = j / rows;
    positions.push(...point(u, t));
    uv.push(u, t);
    if (j < rows && i < columns) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      if (flip) indices.push(a, a + 1, b, a + 1, b + 1, b);
      else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Where two rows of points fall together (a strip that narrows to nothing), the triangles between them have no
  // area: they are left out.
  const kept: number[] = [];
  const at = (k: number) => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]];
  for (let k = 0; k < indices.length; k += 3) {
    const [ax, ay, az] = at(indices[k]), [bx, by, bz] = at(indices[k + 1]), [cx, cy, cz] = at(indices[k + 2]);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-9) kept.push(indices[k], indices[k + 1], indices[k + 2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(kept);
  geo.computeVertexNormals();
  return geo;
}

/** Turns every triangle of a geometry to face the other way (for a part that is made as a mirror image). */
function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a); }
    index.needsUpdate = true;
    return;
  }
  const order: number[] = [];
  for (let i = 0; i < geo.getAttribute('position').count; i += 3) order.push(i + 2, i + 1, i);
  geo.setIndex(order);
}

function shape(points: Profile[]): THREE.Shape {
  const result = new THREE.Shape();
  points.forEach(([z, y], i) => i ? result.lineTo(z, y) : result.moveTo(z, y));
  result.closePath();
  return result;
}

// Split long surround triangles before projecting them onto the curved side.
// This keeps a chord from cutting through the inset glass or exposing the cabin.
function refineSurround(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = source.getAttribute('position'), uv = source.getAttribute('uv'), normal = source.getAttribute('normal');
  const positions: number[] = [], uvs: number[] = [], normals: number[] = [];
  type Vertex = number[];
  const vertex = (i: number): Vertex => [p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i), normal.getX(i), normal.getY(i), normal.getZ(i)];
  function triangle(a: Vertex, b: Vertex, c: Vertex, depth = 0): void {
    const length = (v: Vertex, w: Vertex) => Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]);
    const ab = length(a, b), bc = length(b, c), ca = length(c, a);
    if (Math.max(ab, bc, ca) > .48 && depth < 6) {
      if (bc > ab && bc >= ca) {
        triangle(b, c, a, depth);
        return;
      }
      if (ca > ab && ca > bc) {
        triangle(c, a, b, depth);
        return;
      }
      const mid = a.map((n, i) => (n + b[i]) * .5);
      triangle(a, mid, c, depth + 1);
      triangle(mid, b, c, depth + 1);
      return;
    }
    for (const v of [a, b, c]) {
      positions.push(...v.slice(0, 3));
      uvs.push(...v.slice(3, 5));
      normals.push(...v.slice(5, 8));
    }
  }
  const index = source.getIndex();
  for (let i = 0; i < (index?.count ?? p.count); i += 3)
    triangle(vertex(index ? index.getX(i) : i), vertex(index ? index.getX(i + 1) : i + 1), vertex(index ? index.getX(i + 2) : i + 2));
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  source.dispose();
  return result;
}

type TailBand = { y0: number; y1: number; inner0: number; inner1: number; outer0: number; outer1: number; front0: number; front1: number; back0?: number; back1?: number };
type TailWork = { scanned: number; candidates: number; visits: number; planeTests: number };

// Keep the bounded polygon cutter separate from the rest of the car constructor.
function cutTailSockets(tailBodyParts: THREE.Mesh[], bands: TailBand[], minFront: number, tailWork: TailWork): void {
  const minInner = Math.min(...bands.flatMap(b => [b.inner0, b.inner1]));
  const maxOuter = Math.max(...bands.flatMap(b => [b.outer0, b.outer1]));
  const minY = bands[0].y0, maxY = bands[bands.length - 1].y1;
  // Sub-millimetre simplification is inside the closed socket, beneath the lens.
  const cutPlanes = [-1, 1].map(side => bands.map(band => {
    const dy = band.y1 - band.y0, inner = (band.inner1 - band.inner0) / dy;
    const outer = (band.outer1 - band.outer0) / dy, front = (band.front1 - band.front0) / dy;
    const planes = [[0, 1, 0, -band.y0], [0, -1, 0, band.y1],
      [side, -inner, 0, inner * band.y0 - band.inner0], [-side, outer, 0, band.outer0 - outer * band.y0],
      [0, -front, 1, front * band.y0 - band.front0]];
    if (band.back0 !== undefined && band.back1 !== undefined) {
      const back = (band.back1 - band.back0) / dy;
      planes.push([0, back, -1, band.back0 - back * band.y0]);
    }
    return planes;
  }));
  const distance = (plane: number[], v: number[]) => {
    tailWork.planeTests++;
    return plane[0] * v[0] + plane[1] * v[1] + plane[2] * v[2] + plane[3];
  };
  for (const part of tailBodyParts) {
    const g = part.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bounds = g.boundingBox!.clone().applyMatrix4(part.matrixWorld);
    const sides = [-1, 1].filter(side => bounds.max.z >= minFront && bounds.max.y >= minY && bounds.min.y <= maxY
      && (side > 0 ? bounds.max.x >= minInner && bounds.min.x <= maxOuter : -bounds.min.x >= minInner && -bounds.max.x <= maxOuter));
    if (!sides.length) continue;
    const attributes = Object.entries(g.attributes).sort(([a], [b]) => a === 'position' ? -1 : b === 'position' ? 1 : 0);
    const p = g.getAttribute('position'), ix = g.getIndex();
    const offsets: number[] = []; let stride = 0;
    for (const [, attr] of attributes) { offsets.push(stride); stride += attr.itemSize; }
    const positionAt = offsets[attributes.findIndex(([key]) => key === 'position')];
    const normalAt = offsets[attributes.findIndex(([key]) => key === 'normal')];
    type Polygon = number[][];
    const untouched: number[] = [], polygons: Polygon[] = [], originals = new Map<Polygon, number>();
    const at = (i: number) => ix ? ix.getX(i) : i;
    // Reject untouched triangles before copying their attributes. Most of the
    // surround and rear skin never enters either small lamp footprint.
    for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
      tailWork.scanned++;
      const a = at(i), b = at(i + 1), c = at(i + 2);
      const y0 = Math.min(p.getY(a), p.getY(b), p.getY(c)), y1 = Math.max(p.getY(a), p.getY(b), p.getY(c));
      const x0 = Math.min(p.getX(a), p.getX(b), p.getX(c)), x1 = Math.max(p.getX(a), p.getX(b), p.getX(c));
      if (y1 <= minY || y0 >= maxY || Math.max(p.getZ(a), p.getZ(b), p.getZ(c)) <= minFront
        || !sides.some(side => (side > 0 ? x1 : -x0) >= minInner && (side > 0 ? x0 : -x1) <= maxOuter)) {
        untouched.push(i); continue;
      }
      tailWork.candidates++;
      const tri: Polygon = [];
      for (const index of [a, b, c]) {
        const vertex: number[] = [];
        for (const [, attr] of attributes) for (let k = 0; k < attr.itemSize; k++) vertex.push(attr.array[index * attr.itemSize + k]);
        tri.push(vertex);
      }
      polygons.push(tri); originals.set(tri, i);
    }
    if (!polygons.length) continue;
    let fragments = polygons, changed = false;
    for (const side of sides) {
      const queues: Polygon[][] = bands.map(() => []), finished: Polygon[] = [];
      const bucket = (poly: Polygon, after = 0) => {
        let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const v of poly) {
          y0 = Math.min(y0, v[positionAt + 1]); y1 = Math.max(y1, v[positionAt + 1]);
          x0 = Math.min(x0, side * v[positionAt]); x1 = Math.max(x1, side * v[positionAt]); z1 = Math.max(z1, v[positionAt + 2]);
        }
        let lo = after, hi = bands.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (bands[mid].y1 <= y0 + 1e-9) lo = mid + 1; else hi = mid; }
        while (lo < bands.length && y1 > bands[lo].y0 + 1e-9 && x1 >= minInner && x0 <= maxOuter && z1 >= minFront) {
          const band = bands[lo];
          if (x1 >= Math.min(band.inner0, band.inner1) && x0 <= Math.max(band.outer0, band.outer1)
            && z1 >= Math.min(band.front0, band.front1)) {
            let excluded = false;
            for (const plane of cutPlanes[side > 0 ? 1 : 0][lo]) {
              let outside = true;
              for (const v of poly) if (distance(plane, v) > 1e-9) { outside = false; break; }
              if (outside) { excluded = true; break; }
            }
            if (!excluded) { queues[lo].push(poly); return; }
          }
          lo++;
        }
        finished.push(poly);
      };
      for (const poly of fragments) bucket(poly);
      for (let bi = 0; bi < bands.length; bi++) {
        const planes = cutPlanes[side > 0 ? 1 : 0][bi];
        for (const poly of queues[bi]) {
          tailWork.visits++;
          let inside = poly;
          for (const plane of planes) {
            if (!inside.length) break;
            const kept: Polygon = [], outside: Polygon = [], d: number[] = [];
            for (const v of inside) d.push(distance(plane, v));
            for (let j = 0; j < inside.length; j++) {
              const ai = (j + inside.length - 1) % inside.length, a = inside[ai], b = inside[j], da = d[ai], db = d[j];
              if ((da > 0) !== (db > 0)) {
                const t = da / (da - db), edge: number[] = [];
                for (let k = 0; k < stride; k++) edge.push(a[k] + (b[k] - a[k]) * t);
                kept.push(edge); outside.push(edge);
              }
              (db > 0 ? kept : outside).push(b);
            }
            if (outside.length >= 3) bucket(outside, bi + 1);
            inside = kept;
          }
          if (inside.length >= 3) changed = true;
        }
      }
      fragments = finished;
    }
    if (!changed) continue;
    const cutFragments: Polygon[] = [];
    for (const poly of fragments) { const i = originals.get(poly); if (i === undefined) cutFragments.push(poly); else untouched.push(i); }
    const samePoint = (a: number[], b: number[]) => Math.round(a[positionAt] * 1e4) === Math.round(b[positionAt] * 1e4)
      && Math.round(a[positionAt + 1] * 1e4) === Math.round(b[positionAt + 1] * 1e4)
      && Math.round(a[positionAt + 2] * 1e4) === Math.round(b[positionAt + 2] * 1e4);
    const keptVertices: number[][] = [];
    for (const polygon of cutFragments) for (let fan = 1; fan < polygon.length - 1; fan++) {
      const a = polygon[0], b = polygon[fan], c = polygon[fan + 1];
      const ux = b[positionAt] - a[positionAt], uy = b[positionAt + 1] - a[positionAt + 1], uz = b[positionAt + 2] - a[positionAt + 2];
      const vx = c[positionAt] - a[positionAt], vy = c[positionAt + 1] - a[positionAt + 1], vz = c[positionAt + 2] - a[positionAt + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9
        || samePoint(a, b) || samePoint(b, c) || samePoint(c, a)) continue;
      keptVertices.push(a, b, c);
    }
    const vertices = untouched.length * 3 + keptVertices.length;
    if (!vertices) { part.removeFromParent(); g.dispose(); continue; }
    for (const v of keptVertices) {
      const length = Math.hypot(v[normalAt], v[normalAt + 1], v[normalAt + 2]);
      if (Math.abs(length - 1) > 1e-6) for (let j = 0; j < 3; j++) v[normalAt + j] /= length;
    }
    // Copy consecutive untouched runs directly; only cut vertices need decoding.
    untouched.sort((a, b) => a - b);
    const cut = new THREE.BufferGeometry();
    for (let k = 0; k < attributes.length; k++) {
      const [key, attr] = attributes[k], data = attr.array, size = attr.itemSize;
      const result = new Float32Array(vertices * size); let cursor = 0;
      if (!ix) {
        for (let j = 0; j < untouched.length;) {
          const start = untouched[j]; let end = start + 3; j++;
          while (j < untouched.length && untouched[j] === end) { end += 3; j++; }
          result.set(data.subarray(start * size, end * size), cursor); cursor += (end - start) * size;
        }
      } else for (const i of untouched) for (let j = 0; j < 3; j++) {
        const start = at(i + j) * size;
        for (let c = 0; c < size; c++) result[cursor++] = data[start + c];
      }
      for (const v of keptVertices) for (let c = 0; c < size; c++) result[cursor++] = v[offsets[k] + c];
      cut.setAttribute(key, new THREE.BufferAttribute(result, size));
    }
    part.geometry = cut; g.dispose();
  }
}

/** `mailTrim` false leaves off the roof sign, the lamp and the mail words on the plates: the same car, off duty. */
export function createCar(mailTrim = true, cleanText = false): Car {
  const root = new THREE.Group();
  root.name = 'Mabou mail carrier, metres, forward -Z';
  const body = new THREE.Group();
  body.name = 'Suspended body';
  root.add(body);
  // Eleven materials. No environment map is required for the paint.
  const paint = new THREE.MeshStandardMaterial({ color: 0xc7c4b9, metalness: 0.28, roughness: 0.36, side: THREE.DoubleSide });
  paint.name = 'Body paint';
  const trim = new THREE.MeshStandardMaterial({ color: 0x555957, roughness: 0.88, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x181d1d, roughness: 0.94, side: THREE.DoubleSide });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xd9dbd6, metalness: 0.58, roughness: 0.28, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.02, roughness: 0.62, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
  const red = new THREE.MeshStandardMaterial({ color: 0x970b19, emissive: 0xee1020, emissiveIntensity: 0.30, roughness: 0.32, side: THREE.DoubleSide });
  const amber = new THREE.MeshStandardMaterial({ color: 0xf5a315, emissive: 0xff8b00, emissiveIntensity: 0.8, roughness: 0.30 });
  const signTexture = canvasTexture(1024, 512, ctx => {
    ctx.fillStyle = '#f5f2d9'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#153e36'; ctx.fillRect(28, 26, 968, 204);
    ctx.strokeStyle = '#e7d69f'; ctx.lineWidth = 5; ctx.strokeRect(40, 38, 944, 180);
    // An invented winged envelope, distinct from postal service marks.
    ctx.strokeStyle = '#f5edcf'; ctx.lineWidth = 9;
    ctx.strokeRect(67, 91, 112, 72);
    ctx.beginPath(); ctx.moveTo(67, 91); ctx.lineTo(123, 133); ctx.lineTo(179, 91);
    ctx.moveTo(58, 108); ctx.lineTo(24, 92); ctx.moveTo(58, 133); ctx.lineTo(18, 121); ctx.stroke();
    ctx.fillStyle = '#fff5d6'; ctx.font = 'bold 96px sans-serif'; ctx.textAlign = 'center';
    if (!cleanText) ctx.fillText('MABOU MAIL', 577, 165, 762);
    ctx.fillStyle = '#233c34'; ctx.font = 'bold 78px monospace'; ctx.fillText(mailTrim ? 'MAIL 19' : 'MABOU', 280, 420);
    if (mailTrim) { ctx.font = '22px sans-serif'; ctx.fillText('MABOU • RURAL ROUTE', 280, 326); }
    ctx.fillStyle = '#dcd3a9'; ctx.fillRect(600, 300, 400, 200);
    const silver = ctx.createLinearGradient(600, 258, 600, 293);
    silver.addColorStop(0, '#f5f5ed'); silver.addColorStop(.45, '#a6afab'); silver.addColorStop(.7, '#edf0e9'); silver.addColorStop(1, '#bbc3bf');
    ctx.fillStyle = silver; ctx.fillRect(600, 258, 400, 35);
    ctx.strokeStyle = '#f2f7f4'; ctx.lineWidth = 2;
    for (let x = 604; x < 1000; x += 9) { ctx.beginPath(); ctx.moveTo(x, 260); ctx.lineTo(x, 290); ctx.stroke(); }
    ctx.strokeStyle = '#f6edcc'; ctx.lineWidth = 3;
    for (const x of [700, 880]) { ctx.beginPath(); ctx.ellipse(x, 400, 62, 78, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = '#a69f83'; ctx.lineWidth = 1;
    for (let x = 610; x < 1000; x += 8) { ctx.beginPath(); ctx.moveTo(x, 305); ctx.lineTo(x, 495); ctx.stroke(); }
  });
  const signMaterial = new THREE.MeshStandardMaterial({ map: signTexture, emissiveMap: signTexture, emissive: 0xffffff, emissiveIntensity: 0.24, roughness: 0.58, side: THREE.DoubleSide });
  const interior = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.93, side: THREE.DoubleSide });
  const parcelTexture = canvasTexture(512, 512, ctx => {
    ctx.fillStyle = '#b58c59'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#cba979'; ctx.fillRect(238, 0, 38, 512);
    ctx.strokeStyle = '#795f40'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, 500, 500);
    ctx.fillStyle = '#eee9d9'; ctx.fillRect(52, 70, 165, 118);
    ctx.fillStyle = '#343832'; ctx.font = 'bold 17px sans-serif'; if (!cleanText) ctx.fillText('RURAL ROUTE', 61, 96);
    for (let i = 0; i < 40; i++) ctx.fillRect(65 + i * 3.4, 120, i % 3 === 0 ? 2 : 1, 40);
    ctx.font = '16px sans-serif'; ctx.fillText('THIS WAY UP ↑', 290, 440);
  });
  const parcel = new THREE.MeshStandardMaterial({ map: parcelTexture, roughness: 0.96 });
  let seed = 19;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const mudTexture = canvasTexture(1024, 256, ctx => {
    const fade = ctx.createLinearGradient(0, 256, 0, 0);
    fade.addColorStop(0, '#736044f0'); fade.addColorStop(0.38, '#817051c0'); fade.addColorStop(0.88, '#88775c00');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 2400; i++) {
      const x = random() * 1024, y = 256 - Math.pow(random(), 1.9) * 245;
      ctx.fillStyle = `rgba(${100 + Math.floor(random() * 45)},${87 + Math.floor(random() * 30)},65,${0.16 + random() * 0.42})`;
      ctx.beginPath(); ctx.ellipse(x, y, 0.4 + random() * 1.5, 1 + random() * 10, -0.3, 0, Math.PI * 2); ctx.fill();
    }
  });
  const mud = new THREE.MeshStandardMaterial({ map: mudTexture, transparent: true, opacity: 0.78, depthWrite: false, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });

  function mesh(geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, parent: THREE.Object3D = body): THREE.Mesh {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = true;
    parent.add(result);
    return result;
  }
  function colour(geometry: THREE.BufferGeometry, hex: number, alpha?: number): THREE.BufferGeometry {
    const c = new THREE.Color(hex), values: number[] = [];
    for (let i = 0; i < geometry.getAttribute('position').count; i++) { values.push(c.r, c.g, c.b); if (alpha !== undefined) values.push(alpha); }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, alpha === undefined ? 3 : 4));
    return geometry;
  }
  function box(size: Point, at: Point, material: THREE.MeshStandardMaterial, parent: THREE.Object3D = body, tint?: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(...size);
    if (tint !== undefined) colour(geo, tint);
    const result = mesh(geo, material, parent);
    result.position.set(...at);
    return result;
  }
  function line(points: Point[], radius: number, material: THREE.MeshStandardMaterial, parent: THREE.Object3D = body): THREE.Mesh {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v)), Math.min(40, Math.max(4, points.length * 2)), radius, 4, false), material, parent);
  }
  function decal(geometry: THREE.BufferGeometry, region: [number, number, number, number]): THREE.Mesh {
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, region[0] + uv.getX(i) * region[2], region[1] + uv.getY(i) * region[3]);
    return mesh(geometry, signMaterial);
  }
  // 2007 · Japanese-market compact SUV. Each station shares its shoulder with
  // the bonnet, door skins and greenhouse; the wheel openings trim those skins.
  const stations = [
    [-2.15, .835, .925], [-1.94, .887, .965], [-1.35, .910, 1.075],
    [-.65, .912, 1.112], [.30, .912, 1.125], [1.25, .901, 1.145],
    [1.90, .862, 1.160], [2.15, .817, 1.150],
  ];
  function station(z: number, field: number): number {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0])
      i++;
    const a = stations[i], b = stations[i + 1], prev = stations[Math.max(0, i - 1)], next = stations[Math.min(stations.length - 1, i + 2)];
    const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1), d = b[0] - a[0];
    const m0 = (b[field] - prev[field]) / (b[0] - prev[0]), m1 = (next[field] - a[field]) / (next[0] - a[0]);
    return (2 * t * t * t - 3 * t * t + 1) * a[field] + (t * t * t - 2 * t * t + t) * d * m0 + (-2 * t * t * t + 3 * t * t) * b[field] + (t * t * t - t * t) * d * m1;
  }
  const halfWidth = (z: number) => station(z, 1);
  const belt = (z: number) => station(z, 2);
  function sideX(y: number, z: number): number {
    const waist = Math.min(y, belt(z));
    return halfWidth(z) - .100 * ((waist - .80) / .56) ** 2
      + .012 * Math.exp(-(((waist - .88) / .18) ** 2))
      - Math.max(0, y - belt(z)) * .32;
  }
  function bottom(z: number): number {
    let y = .275;
    for (const axle of [-1.31, 1.31]) {
      const d = z - axle;
      if (Math.abs(d) < .385)
        y = Math.max(y, .35 + Math.sqrt(.385 ** 2 - d ** 2));
    }
    return y;
  }
  // A shared radial field forms the fender shoulder. Its lip rolls back into
  // the wheel well; the tyre is inside the flare rather than pasted onto it.
  function flare(y: number, z: number): number {
    return Math.max(...[-1.31, 1.31].map(axle => {
      const r = Math.hypot(z - axle, y - .35);
      return .038 * Math.exp(-(((r - .417) / .090) ** 2));
    }));
  }
  const skinX = (y: number, z: number) => sideX(y, z) + flare(y, z);
  for (const s of [-1, 1]) {
    mesh(surface(10, 96, (u, t) => {
      const z = -1.98 + u * 3.96, y = THREE.MathUtils.lerp(Math.max(bottom(z), .44), belt(z), t);
      return [s * skinX(y, z), y, z];
    }, s < 0), paint);
    mesh(surface(2, 96, (u, t) => {
      const z = -1.98 + u * 3.96, y = THREE.MathUtils.lerp(bottom(z), Math.max(bottom(z), .44), t);
      return [s * (skinX(y, z) + .002), y, z];
    }, s < 0), trim);
    mesh(surface(4, 96, (u, t) => {
      const z = -1.98 + u * 3.96, y = THREE.MathUtils.lerp(bottom(z), Math.max(bottom(z), .92), t);
      return [s * (skinX(y, z) + .003), y, z];
    }, s < 0), mud);
    for (const axle of [-1.31, 1.31]) {
      mesh(surface(3, 32, (u, t) => {
        const a = u * Math.PI, r = .385 + t * .061, y = .35 + Math.sin(a) * r, z = axle + Math.cos(a) * r;
        return [s * (skinX(y, z) + .008 + .014 * Math.sin(t * Math.PI)), y, z];
      }, s > 0), trim);
      mesh(surface(2, 32, (u, t) => {
        const a = u * Math.PI, y = .35 + Math.sin(a) * .385, z = axle + Math.cos(a) * .385;
        return [s * THREE.MathUtils.lerp(.68, skinX(y, z) + .008, t), y, z];
      }), rubber);
      box([.19, .16, .025], [s * .785, .27, axle + .36], rubber);
    }
    line([[s * .86, .30, -.84], [s * .88, .30, .15], [s * .86, .30, .86]], .024, trim);
  }
  box([1.45, .06, 3.90], [0, .215, 0], rubber);
  box([1.65, .06, 3.15], [0, .48, .25], interior, body, 0x333a39);
  // The end caps are full-width curved sections, tangent to the side skins.
  // Their plan curvature also carries the lamps and bumper round the corners.
  function endPoint(end: number, u: number, y: number, offset = 0): Point {
    const q = u * 2 - 1, sideZ = end * 1.98;
    const z = end * (1.98 + .285 * Math.sqrt(Math.max(0, 1 - q ** 4)));
    const top = belt(sideZ), blend = THREE.MathUtils.smoothstep(y, .65, top);
    const crown = (belt(z) - top + (end < 0 ? .065 : .0442) * (1 - q * q)) * blend;
    const bumper = .018 * Math.sin(THREE.MathUtils.clamp((y - (end > 0 ? .46 : .49)) / (end > 0 ? .19 : .16), 0, 1) * Math.PI);
    const hatch = end > 0 ? .018 * Math.sin(THREE.MathUtils.clamp((y - .49) / .684, 0, 1) * Math.PI) : 0;
    const x = q * sideX(y, z), py = y + crown;
    const recess = end > 0 ? .034 * (1 - THREE.MathUtils.smoothstep(Math.abs(x), .23, .33))
      * (1 - THREE.MathUtils.smoothstep(Math.abs(py - .875), .102, .152)) : 0;
    return [x, py, z + end * ((.022 * Math.sin((y - .28) / .9 * Math.PI) + bumper + hatch + offset) * (1 - q * q) - recess)];
  }
  for (const end of [-1, 1]) {
    mesh(surface(14, 32, (u, t) => endPoint(end, u, THREE.MathUtils.lerp(end > 0 ? .46 : .49, belt(end * 1.98), t)), end > 0), paint);
    mesh(surface(3, 32, (u, t) => {
      const y = .27 + t * (end > 0 ? .19 : .22);
      const p = endPoint(end, u, y, .009 + .020 * Math.sin(t * Math.PI));
      return p;
    }, end > 0), trim);
  }
  mesh(surface(14, 28, (u, t) => {
    const q = u * 2 - 1, front = endPoint(-1, u, belt(-1.98)), z = THREE.MathUtils.lerp(front[2], -1.12, t);
    return [q * sideX(belt(z), z), belt(z) + .065 * (1 - q * q), z];
  }), paint);
  mesh(surface(3, 24, (u, t) => {
    const q = u * 2 - 1, x = q * sideX(belt(-1.12), -1.12);
    return [x, THREE.MathUtils.lerp(belt(-1.12) + .065 * (1 - q * q), 1.114 + .037 * (1 - q * q), t), -1.12 - t * .035 - .034 * (1 - q * q) * t];
  }), rubber);
  // Bonnet shut line and rolled cowl edge remain actual panel breaks.
  for (const s of [-1, 1])
    line(Array.from({ length: 16 }, (_, i) => {
      const z = -2.10 + i / 15 * .95, q = s * .81;
      return [q * sideX(belt(z), z), belt(z) + .065 * (1 - q * q) + .002, z];
    }), .003, trim);
  const frontWindow = new THREE.Shape();
  frontWindow.moveTo(-1.035, 1.15);
  frontWindow.quadraticCurveTo(-.75, 1.39, -.435, 1.573);
  frontWindow.quadraticCurveTo(-.22, 1.611, .008, 1.608);
  frontWindow.lineTo(.008, 1.155);
  frontWindow.closePath();
  const rearWindow = new THREE.Shape();
  rearWindow.moveTo(.11, 1.158);
  rearWindow.lineTo(.11, 1.612);
  rearWindow.quadraticCurveTo(.57, 1.615, .92, 1.585);
  rearWindow.lineTo(.92, 1.184);
  rearWindow.quadraticCurveTo(.50, 1.169, .11, 1.158);
  rearWindow.closePath();
  const quarter = new THREE.Shape();
  quarter.moveTo(1.025, 1.19);
  quarter.lineTo(1.025, 1.572);
  quarter.lineTo(1.27, 1.568);
  quarter.bezierCurveTo(1.53, 1.566, 1.72, 1.43, 1.755, 1.255);
  quarter.quadraticCurveTo(1.765, 1.22, 1.715, 1.215);
  quarter.quadraticCurveTo(1.40, 1.198, 1.025, 1.19);
  quarter.closePath();
  let driverWindow!: THREE.Mesh;
  const windowShapes = [frontWindow, rearWindow, quarter];
  const roofEdge = (z: number) => 1.607 + .022 * Math.sin((z + .51) / 2.4 * Math.PI) - .025 * ((z + .51) / 2.4) ** 2;
  for (const s of [-1, 1]) {
    const outline = new THREE.Shape();
    outline.moveTo(-1.17, 1.084);
    outline.quadraticCurveTo(-.88, 1.36, -.51, roofEdge(-.51));
    for (let i = 1; i <= 24; i++) {
      const z = -.51 + i / 24 * 2.40;
      outline.lineTo(z, roofEdge(z));
    }
    outline.lineTo(2.15, 1.15);
    outline.closePath();
    // three.js wants the outline one way round and its holes the other. It turns the holes only when it had to turn
    // the outline, and this outline is already the right way: so the holes are turned here, or their walls face in.
    for (const win of windowShapes) {
      const points = win.getPoints(16);
      if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
      outline.holes.push(new THREE.Path(points));
    }
    function sideShape(sh: THREE.Shape, offset: number, depth = 0): THREE.BufferGeometry {
      let geo: THREE.BufferGeometry = depth ? new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 18 }) : new THREE.ShapeGeometry(sh, 18);
      if (depth) geo = refineSurround(geo);
      const oldNormal = geo.getAttribute('normal').clone();
      const p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const z = p.getX(i), y = p.getY(i), d = p.getZ(i);
        p.setXYZ(i, s * (sideX(y, z) + offset - d), y, z);
      }
      // The side is laid out flat and folded onto the body; on one side of the car that fold is a mirror image.
      // (The flat glass and the extruded surround are made facing opposite ways, so they flip on opposite sides.)
      if (depth ? s < 0 : s > 0) flipWinding(geo);
      geo.computeVertexNormals();
      const normals = geo.getAttribute('normal');
      for (let i = 0; i < p.count; i++) if (!depth || Math.abs(oldNormal.getZ(i)) > .99) {
        const y = p.getY(i), z = p.getZ(i), out = !depth || oldNormal.getZ(i) < 0 ? 1 : -1;
        const dy = (sideX(y+.001,z)-sideX(y-.001,z))/.002;
        const dz = (sideX(y,z+.001)-sideX(y,z-.001))/.002;
        const n = new THREE.Vector3(s*out,-dy*out,-dz*out).normalize();
        normals.setXYZ(i,n.x,n.y,n.z);
      }
      return geo;
    }
    mesh(sideShape(outline, 0, .045), paint);
    windowShapes.forEach((win, i) => {
      const pane = mesh(colour(sideShape(win, -.018), i === 0 ? 0x89aaa8 : 0x172b30, i === 0 ? .39 : .92), glass);
      if (s === 1 && i === 0) { driverWindow = pane; pane.name = 'Right driver window'; }
      const points: Point[] = win.getPoints(20).map(p => [s * (sideX(p.y, p.x) - .003), p.y, p.x]);
      line(points, .010, rubber);
      // Recess side walls connect each seal to the glass, including the thick rear pillar.
      const edge = win.getPoints(20);
      mesh(surface(1, edge.length - 1, (u, t) => {
        const p = edge[Math.round(u * (edge.length - 1))];
        return [s * (sideX(p.y, p.x) - t * .018), p.y, p.x];
      }), rubber);
    });
    for (const z of [.055, .975]) {
      mesh(surface(5, 2, (u, t) => { const y = 1.15 + t * .46, pz = z + (u - .5) * .075; return [s * (sideX(y, pz) + .002), y, pz]; }), rubber);
    }
    // Projecting window visors follow the upper frame instead of floating above it.
    for (const [za, zb] of [[-.77, .015], [.10, .93]])
      mesh(surface(3, 20, (u, t) => {
        const z = THREE.MathUtils.lerp(za, zb, u), y = z < -.44 ? 1.57 + (z + .44) * .66 : roofEdge(z) - .003;
        return [s * (sideX(y, z) + .008 + t * .052), y - .018 * Math.sin(t * Math.PI * .5), z];
      }), rubber);
    for (const z of [-1.08, .055, 1.04])
      line([[s * (skinX(.44, z) + .004), .44, z], [s * (skinX(.75, z) + .004), .75, z - .015], [s * (sideX(belt(z), z) + .004), belt(z), z]], .0035, rubber);
    line([[-1.98, .95], [-.95, 1.04], [.0, 1.075], [1.85, 1.12]].map(([z, y]) => [s * (sideX(y, z) + .004), y, z]), .004, trim);
    for (const z of [-.12, .83]) {
      line([[s * (sideX(1.085, z) + .009), 1.085, z - .10], [s * (sideX(1.085, z) + .024), 1.085, z], [s * (sideX(1.085, z) + .009), 1.085, z + .10]], .014, alloy);
    }
    const mirror = mesh(new THREE.SphereGeometry(1, 16, 10), paint);
    mirror.scale.set(.14, .09, .13);
    mirror.position.set(s * 1.005, 1.14, -.94);
    mirror.rotation.y = s * -.12;
    box([.18, .105, .012], [s * 1.005, 1.15, -.805], alloy);
    line([[s * .84, 1.10, -.99], [s * .97, 1.12, -.94]], .025, rubber);
  }
  // Arched in both directions. The roof's rolled edges meet the same side sections.
  mesh(surface(18, 24, (u, t) => {
    const z = -.51 + t * 2.40, q = u * 2 - 1, y = roofEdge(z), w = sideX(y, z);
    return [q * w, y + .078 * (1 - q * q), z];
  }), paint);
  function wind(u: number, t: number, inset = 0): Point {
    const q = u * 2 - 1, z = -1.14 + t * .63, y = 1.114 + t * .493;
    return [q * THREE.MathUtils.lerp(.834, sideX(roofEdge(-.51), -.51), t), y + .037 * (1 - q * q) - inset, z - .034 * (1 - q * q) + inset];
  }
  mesh(colour(surface(12, 24, (u, t) => wind(u, t, .012)), 0x9ebbb4, .30), glass);
  for (const s of [-1, 1]) {
    const edge = [wind(s < 0 ? 0 : 1, 0), wind(s < 0 ? 0 : 1, .5), wind(s < 0 ? 0 : 1, 1)];
    line(edge, .031, paint);
    line(edge.map(([x, y, z]) => [x - s * .018, y, z]), .008, rubber);
  }
  for (const t of [0, 1])
    line(Array.from({ length: 13 }, (_, i) => wind(i / 12, t)), .013, rubber);
  for (const x of [-.43, .35])
    line([[x + .14, 1.14, -1.155], [x - .20, 1.17, -1.10]], .008, rubber);
  function back(u: number, t: number, offset = 0): Point {
    const q = u * 2 - 1, y = 1.172 + t * .405, w = THREE.MathUtils.lerp(.735, .615, t);
    return [q * w, y + .019 * (1 - q * q), 2.157 - t * .267 + .032 * (1 - q * q) + offset];
  }
  mesh(colour(surface(12, 24, (u, t) => back(u, t, -.018), true), 0x142529, .94), glass);
  for (const t of [0, 1])
    line(Array.from({ length: 17 }, (_, i) => back(i / 16, t)), .015, rubber);
  for (const u of [0, 1])
    line([back(u, 0), back(u, .5), back(u, 1)], .018, rubber);
  line([back(.18, .10, .018), back(.35, .08, .018), back(.53, .09, .018)], .011, rubber);
  mesh(surface(4, 24, (u, t) => {
    const p = back(u, 0), q = u * 2 - 1, end = endPoint(1, (q * .777 / sideX(belt(2.15), 2.15) + 1) / 2, belt(2.15), .006);
    return [THREE.MathUtils.lerp(end[0], p[0], t), THREE.MathUtils.lerp(end[1], p[1], t), THREE.MathUtils.lerp(end[2], p[2], t)];
  }, true), paint);
  for (const s of [-1, 1])
    mesh(surface(14, 4, (u, t) => {
      const edge = back(s < 0 ? 0 : 1, t), y = edge[1];
      const z = 2.15 - (y - 1.15) / .432 * .26, x = sideX(y, z);
      return [s * THREE.MathUtils.lerp(Math.abs(edge[0]) + .014, x, u), y, THREE.MathUtils.lerp(edge[2] - .012, z, u)];
    }, s > 0), paint);
  // Rounded spoiler with rolled ends, not a rectangular plank across the roof.
  mesh(surface(8, 32, (u, t) => {
    const q = u * 2 - 1;
    return [q * .738, 1.584 + .032 * Math.sin(t * Math.PI) + .030 * (1 - q * q), 1.84 + t * .17 - .042 * q * q];
  }), paint);
  box([.36, .024, .025], [0, 1.606, 2.005], red);
  line([[-.86, 1.12], [-.87, .72], [-.76, .57], [0, .545], [.76, .57], [.87, .72], [.86, 1.12]].map(([q, y]) => endPoint(1, (q + 1) / 2, y, .012)), .0035, rubber);
  line(Array.from({ length: 13 }, (_, i) => {
    const x = (i / 12 * 2 - 1) * .40;
    return endPoint(1, (x / sideX(1.04, 1.98) + 1) / 2, 1.04, .017);
  }), .024, paint);
  // Two-bar grille and a wide lower intake follow the bowed face exactly.
  function nose(x: number, y: number, out = .016): Point {
    return endPoint(-1, (x / sideX(y, -1.98) + 1) / 2, y, out);
  }
  mesh(surface(5, 24, (u, t) => {
    const q = u * 2 - 1, x = q * (.405 + .035 * t), y = .745 + t * .172 - .035 * (1 - q * q);
    return nose(x, y);
  }), rubber);
  for (const y of [.785, .866])
    mesh(surface(2, 24, (u, t) => {
      const q = u * 2 - 1;
      return nose(q * .424, y + t * .022 - .032 * (1 - q * q), .025);
    }), alloy);
  mesh(surface(5, 24, (u, t) => { const q = u * 2 - 1; return nose(q * (.52 - .035 * t), .515 + t * .12, .028); }), rubber);
  for (const y of [.545, .590])
    line(Array.from({ length: 13 }, (_, i) => nose((i / 12 * 2 - 1) * .48, y, .033)), .005, trim);
  for (const s of [-1, 1]) {
    // Lens and reflector share one convex skin across the front corner and wing.
    const headlight = decal(surface(8, 28, (u, t) => {
      const y = .754 + .075 * u + t * (.17 - .025 * u);
      if (u < .76) {
        const q = THREE.MathUtils.lerp(.54, 1, u / .76), p = endPoint(-1, (s * q + 1) / 2, y, .013);
        return p;
      }
      const z = -1.98 + (u - .76) / .24 * .19;
      return [s * (sideX(y, z) + .014), y, z];
    }, s < 0), [.60, .03, .37, .38]);
    headlight.name = 'Yellowed headlamp';
    const fog = mesh(new THREE.SphereGeometry(1, 16, 8), alloy);
    fog.scale.set(.058, .058, .018);
    const at = nose(s * .66, .415, .029);
    fog.position.set(...at);
  }
  // Query only the nearby drawn triangles once during construction. The two lamps
  // and their lens/backing layers share the fitted sections; driving does no queries.
  root.updateMatrixWorld(true);
  const tailIdentity = new THREE.Matrix4();
  const tailPositions: number[] = [], tailVertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const node of body.children) {
    if (!(node instanceof THREE.Mesh) || ![paint, glass, rubber].includes(node.material as THREE.MeshStandardMaterial)) continue;
    const g = node.geometry, p = g.getAttribute('position'), index = g.getIndex();
    if (!g.boundingBox) g.computeBoundingBox();
    const bounds = g.boundingBox!.clone().applyMatrix4(node.matrixWorld);
    if (bounds.max.z < 1.5 || bounds.max.x < .5 || bounds.max.y < .68 || bounds.min.y > 1.62) continue;
    const identity = node.matrixWorld.equals(tailIdentity);
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      for (let j = 0; j < 3; j++) {
        tailVertices[j].fromBufferAttribute(p, index ? index.getX(i + j) : i + j);
        if (!identity) tailVertices[j].applyMatrix4(node.matrixWorld);
      }
      const [a, b, c] = tailVertices;
      if (Math.max(a.z, b.z, c.z) < 1.5 || Math.max(a.x, b.x, c.x) < .5
        || Math.max(a.y, b.y, c.y) < .68 || Math.min(a.y, b.y, c.y) > 1.62) continue;
      for (const v of tailVertices) tailPositions.push(v.x, v.y, v.z);
    }
  }
  // The queries are axis-aligned. Project each drawn triangle once and bucket
  // it by height, rather than asking Raycaster to decode every triangle per ray.
  const tailSkinPositions = new Float32Array(tailPositions);
  const tailWork = { scanned: 0, candidates: 0, visits: 0, planeTests: 0, skinTests: 0, bands: 0 };
  const skinBands = [0, 2].map(axis => {
    const bins: number[][][] = Array.from({ length: 40 }, () => []);
    const other = axis === 0 ? 2 : 0;
    for (let i = 0; i < tailSkinPositions.length; i += 9) {
      const p = tailSkinPositions, ay = p[i + 1], az = p[i + other];
      const by = p[i + 4] - ay, bz = p[i + 3 + other] - az, cy = p[i + 7] - ay, cz = p[i + 6 + other] - az;
      const determinant = by * cz - bz * cy;
      if (Math.abs(determinant) < 1e-12) continue;
      const y0 = Math.min(ay, p[i + 4], p[i + 7]), y1 = Math.max(ay, p[i + 4], p[i + 7]);
      const row = [y0, y1, Math.min(az, p[i + 3 + other], p[i + 6 + other]), Math.max(az, p[i + 3 + other], p[i + 6 + other]),
        ay, az, by, bz, cy, cz, 1 / determinant, p[i + axis], p[i + 3 + axis] - p[i + axis], p[i + 6 + axis] - p[i + axis]];
      const lo = THREE.MathUtils.clamp(Math.floor((y0 - .68) / .025), 0, 39), hi = THREE.MathUtils.clamp(Math.floor((y1 - .68) / .025), 0, 39);
      for (let bin = lo; bin <= hi; bin++) bins[bin].push(row);
    }
    return bins;
  });
  const tailSkin = (y: number, cross: number, rear = false): number | undefined => {
    const bin = THREE.MathUtils.clamp(Math.floor((y - .68) / .025), 0, 39);
    let nearest = -Infinity;
    for (const p of skinBands[rear ? 1 : 0][bin]) {
      tailWork.skinTests++;
      if (y < p[0] || y > p[1] || cross < p[2] || cross > p[3]) continue;
      const dy = y - p[4], dz = cross - p[5], u = (dy * p[9] - dz * p[8]) * p[10], w = (p[6] * dz - p[7] * dy) * p[10];
      if (u < -1e-9 || w < -1e-9 || u + w > 1 + 1e-9) continue;
      const hit = p[11] + u * p[12] + w * p[13];
      if (hit >= (rear ? 1.5 : .5) && hit <= (rear ? 3 : 2)) nearest = Math.max(nearest, hit);
    }
    return Number.isFinite(nearest) ? nearest : undefined;
  };
  const tailBodyParts = body.children.filter((n): n is THREE.Mesh => n instanceof THREE.Mesh);
  const tailFits = new Map<number, { outside: number; rear: number }>();
  function tailFit(t: number): { outside: number; rear: number } {
    let fit = tailFits.get(t);
    if (fit) return fit;
    const y = .70 + t * .89, rise = THREE.MathUtils.clamp((y - 1.15) / .44, 0, 1), sideZ = 1.965 - rise * .24;
    const width = (.10 + .115 * (1 - t) ** 2) * (1 - .22 * Math.exp(-(((t - 1) / .045) ** 2)));
    let low = Infinity, high = -Infinity;
    for (const u of [.9, 1]) {
      const py = y + .006 * Math.sin(u * Math.PI) * Math.cos(t * Math.PI);
      const side = tailSkin(py, sideZ + (1 - u) * .03 + .009);
      if (side === undefined) throw new Error('Rear lamp side panel could not be fitted.');
      const at = side + width * (1 - Math.sin(u * 1.68)); low = Math.min(low, at); high = Math.max(high, at);
    }
    const outside = (low + high) / 2 - .0020, inner = outside - width;
    const h = THREE.MathUtils.clamp((y - 1.172) / .405, 0, 1), w = THREE.MathUtils.lerp(.735, .615, h);
    const upper = back((inner / w + 1) / 2, h, -.018)[2];
    let lower = upper;
    if (y < 1.20) {
      lower = tailSkin(Math.min(y, 1.13), inner, true) ?? upper;
    }
    fit = { outside, rear: THREE.MathUtils.lerp(lower, upper, THREE.MathUtils.smoothstep(y, 1.13, 1.20)) - .005 };
    tailFits.set(t, fit); return fit;
  }
  let tailOutline!: (u: number, t: number, offset?: number) => Point;
  const lowerRows = Array.from({ length: 7 }, (_, i) => i / 6 * .25);
  const clearRows = [...Array.from({ length: 10 }, (_, i) => .25 + i / 9 * .35), (1.172 - .70) / .89, .54].sort((a, b) => a - b);
  const upperRows = [...Array.from({ length: 11 }, (_, i) => .60 + i * .04), .65].sort((a, b) => a - b);
  const colourRows = [...new Set([...lowerRows, ...clearRows, ...upperRows])].sort((a, b) => a - b);
  // These panel-transition knots are guarded by car-construction-check's 16,000
  // height samples: the drawn gasket must stay within 0.65 mm of the live contour.
  const gasketRows = [0, 0.041666666666666664, 0.08333333333333333, 0.111625, 0.125, 0.16666666666666666, 0.192375, 0.20833333333333334, 0.25, 0.273125, 0.28888888888888886, 0.3277777777777778, 0.36666666666666664, 0.40555555555555556, 0.4444444444444444, 0.4833333333333333, 0.5155625, 0.515625, 0.5222222222222221, 0.5303370786516853, 0.530625, 0.5325, 0.5365625, 0.54, 0.5611111111111111, 0.6, 0.613, 0.634625, 0.64, 0.6415, 0.65, 0.672125, 0.677625, 0.678125, 0.6799999999999999, 0.72, 0.76, 0.8, 0.84, 0.88, 0.9199999999999999, 0.96, 0.9995, 1];
  const rimFits = new Map<number, number>();
  const colourPoint = (u: number, t: number): Point => {
    const rows = t <= .25 ? lowerRows : t <= .60 ? clearRows : upperRows;
    let i = 0; while (i < rows.length - 2 && rows[i + 1] < t) i++;
    const a = tailOutline(u, rows[i], .009), b = tailOutline(u, rows[i + 1], .009);
    const f = (t - rows[i]) / (rows[i + 1] - rows[i]);
    return a.map((v, j) => THREE.MathUtils.lerp(v, b[j], f)) as Point;
  };
  const gasketPoint = (u: number, t: number): Point => {
    const p = colourPoint(u, t), blend = THREE.MathUtils.smoothstep(u, .75, 1);
    if (!blend) return p;
    let delta = rimFits.get(t);
    if (delta === undefined) {
      const fore = colourPoint(1, t);
      const skin = tailSkin(fore[1], fore[2]);
      if (skin === undefined) throw new Error('Rear lamp gasket could not be fitted.');
      delta = Math.max(0, skin + .001 - Math.abs(fore[0]));
      if (delta < .0002) delta = 0;
      rimFits.set(t, delta);
    }
    return [p[0] + Math.sign(p[0]) * delta * blend, p[1], p[2]];
  };
  type RimPoint = { u: number; t: number; k: number };
  const rimPoints = (rows: number[]): RimPoint[] => [
    ...Array.from({ length: 10 }, (_, i) => ({ u: i / 10, t: 0, k: i / 10 })),
    ...rows.slice(0, -1).map(t => ({ u: 1, t, k: 1 + t })),
    ...Array.from({ length: 10 }, (_, i) => ({ u: 1 - i / 10, t: 1, k: 2 + i / 10 })),
    ...rows.slice(1).reverse().map(t => ({ u: 0, t, k: 4 - t })),
  ];
  let gasketEdge: Point[] = [];
  const brakeLights: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    // One wrapped pillar housing: red upper 40%, silver-clear middle 35%, red boot 25%.
    function tailPoint(u: number, t: number, offset = 0): Point {
      const y = .70 + t * .89, rise = THREE.MathUtils.clamp((y - 1.15) / .44, 0, 1), fit = tailFit(t);
      const width = (.10 + .115 * (1 - t) ** 2) * (1 - .22 * Math.exp(-(((t - 1) / .045) ** 2)));
      const angle = u * 1.68, sideZ = 1.965 - rise * .24;
      const depth = (fit.rear - sideZ) / (1 - Math.cos(1.68));
      const turn = THREE.MathUtils.smoothstep(u, .72, .90);
      const roofInset = .004 * THREE.MathUtils.smoothstep(t, .96, 1) * (1 - THREE.MathUtils.smoothstep(u, .75, .85));
      return [s * (fit.outside - width + width * Math.sin(angle) + (offset - .009) * turn),
        y + .006 * Math.sin(u * Math.PI) * Math.cos(t * Math.PI) - roofInset,
        THREE.MathUtils.lerp(fit.rear - depth * (1 - Math.cos(angle)), sideZ + (1 - u) * .03, turn) + offset];
    }
    tailOutline = tailPoint;
    const lower = surface(6, 10, (u, t) => tailPoint(u, t * .25, .009), s > 0);
    const upper = surface(11, 10, (u, t) => tailPoint(u, upperRows[Math.round(t * 11)], .009), s > 0);
    const redLens = mergeGeometries([lower, upper]);
    if (!redLens) throw new Error('Rear lamp red chambers could not be joined.');
    const lamp = mesh(redLens, red); lamp.name = 'Rear pillar red brake chambers';
    brakeLights.push(lamp); lower.dispose(); upper.dispose();
    decal(surface(clearRows.length - 1, 10, (u, t) => tailPoint(u, clearRows[Math.round(t * (clearRows.length - 1))], .009), s > 0), [.60, .435, .37, .055]);
    const dividerOffset = .001;
    for (const split of [.25, .60]) mesh(surface(1, 10, (u, t) => {
      const p = colourPoint(u, split + (t - .5) * .005 / .89);
      return [p[0] + s * dividerOffset * THREE.MathUtils.smoothstep(u, .72, .90), p[1], p[2] + dividerOffset];
    }, s > 0), trim);
    // A thin gasket bridges only local panel irregularities; the coloured lens
    // keeps its smooth outline. The deep wall and back form a closed socket.
    const a = rimPoints(colourRows), b = rimPoints(gasketRows).filter((p, i, all) => {
      if (!i || Math.floor(p.k) !== Math.floor(all[i - 1].k)) return true;
      return v(gasketPoint(p.u, p.t)).distanceTo(v(gasketPoint(all[i - 1].u, all[i - 1].t))) > .00012;
    });
    const front = a.map(p => colourPoint(p.u, p.t)), rim = b.map(p => gasketPoint(p.u, p.t));
    const backRim = b.filter(p => Number.isInteger(p.k) || ((p.u === 0 || p.u === 1) && ([.25, .54, .76].includes(p.t) || (p.t >= .60 && p.t <= .65))));
    const back = backRim.map(q => { const p = gasketPoint(q.u, q.t); return [p[0] - s * .018, p[1] - .012 * q.t, p[2] - .025] as Point; });
    const centre = tailPoint(.5, .5, -.003); centre[2] = Math.min(...back.map(p => p[2])) - .06;
    const points = [...front, ...rim, ...back, centre].map(p => p.map(Math.fround) as Point), indices: number[] = [];
    const add = (a: number, b: number, c: number) => {
      const p = points[a], q = points[b], r = points[c];
      if (v(q).sub(v(p)).cross(v(r).sub(v(p))).length() < 1e-8) return;
      if (new Set([p, q, r].map(p => p.map(n => Math.round(n * 1e4)).join(','))).size < 3) return;
      indices.push(...(s > 0 ? [a, b, c] : [a, c, b]));
    };
    let ia = 0, ib = 0;
    while (ia < a.length || ib < b.length) {
      const nextA = ia + 1 < a.length ? a[ia + 1].k : 4, nextB = ib + 1 < b.length ? b[ib + 1].k : 4;
      if (ia < a.length && (ib >= b.length || nextA <= nextB)) {
        add(ia % a.length, a.length + ib % b.length, (ia + 1) % a.length); ia++;
      } else {
        add(ia % a.length, a.length + ib % b.length, a.length + (ib + 1) % b.length); ib++;
      }
    }
    let ir = 0, rearAt = 0;
    const f = a.length, rear = a.length + b.length;
    while (ir < b.length || rearAt < backRim.length) {
      const nr = ir + 1 < b.length ? b[ir + 1].k : 4;
      const nb = rearAt + 1 < backRim.length ? backRim[rearAt + 1].k : 4;
      if (ir < b.length && (rearAt >= backRim.length || nr <= nb)) {
        add(f + ir % b.length, rear + rearAt % backRim.length, f + (ir + 1) % b.length); ir++;
      } else {
        add(f + ir % b.length, rear + rearAt % backRim.length, rear + (rearAt + 1) % backRim.length); rearAt++;
      }
    }
    for (let i = 0; i < backRim.length; i++) add(points.length - 1, rear + (i + 1) % backRim.length, rear + i);
    const socket = new THREE.BufferGeometry();
    socket.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    socket.setAttribute('uv', new THREE.Float32BufferAttribute(points.flatMap(p => [p[0], p[1]]), 2));
    socket.setIndex(indices);
    const walls = socket.toNonIndexed(); walls.computeVertexNormals(); socket.dispose(); mesh(walls, rubber);
    gasketEdge = b.map((p, i) => ({ p, v: points[a.length + i] })).filter(p => p.p.u === 1).map(p => p.v);
    mesh(colour(surface(2, 10, (u, t) => {
      const x = s * (.57 + u * .19), y = .345 + t * .038;
      return endPoint(1, (x / sideX(y, 1.98) + 1) / 2, y, .027);
    }, true), 0xb42224), interior);
  }
  // Cut the covered mounting recess from the old skin, glazing and seals. Only
  // triangles inside the lamp footprint and behind its front edge are removed.
  const rowStops = colourRows;
  const simplify = (points: Point[], tolerance = .00005, depth = false): Point[] => {
    if (points.length < 3) return points;
    const a = points[0], b = points[points.length - 1]; let at = 0, error = tolerance;
    for (let i = 1; i < points.length - 1; i++) {
      const f = (points[i][1] - a[1]) / (b[1] - a[1]);
      const delta = Math.max(Math.abs(points[i][0] - THREE.MathUtils.lerp(a[0], b[0], f)),
        depth ? Math.abs(points[i][2] - THREE.MathUtils.lerp(a[2], b[2], f)) : 0);
      if (delta > error) { error = delta; at = i; }
    }
    return at ? [...simplify(points.slice(0, at + 1), tolerance, depth).slice(0, -1), ...simplify(points.slice(at), tolerance, depth)] : [a, b];
  };
  const innerEdge = simplify(rowStops.map(t => colourPoint(0, t)), .0005);
  const outerEdge = simplify(rowStops.map(t => colourPoint(.9, t)), .0006);
  const foreEdge = simplify(gasketEdge, .0006, true);
  const edgeValue = (edge: Point[], y: number, axis: number): number => {
    let i = 0; while (i < edge.length - 2 && edge[i + 1][1] < y) i++;
    return THREE.MathUtils.lerp(edge[i][axis], edge[i + 1][axis], (y - edge[i][1]) / (edge[i + 1][1] - edge[i][1]));
  };
  const outerX = (y: number) => Math.max(edgeValue(outerEdge, y, 0), edgeValue(foreEdge, y, 0));
  let stops = [...new Set([.706, 1.584, ...innerEdge.map(p => p[1]), ...outerEdge.map(p => p[1]), ...foreEdge.map(p => p[1])])]
    .filter(y => y >= .706 && y <= 1.584).sort((a, b) => a - b);
  const crossings: number[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = edgeValue(outerEdge, stops[i], 0) - edgeValue(foreEdge, stops[i], 0);
    const b = edgeValue(outerEdge, stops[i + 1], 0) - edgeValue(foreEdge, stops[i + 1], 0);
    if (a * b < 0) crossings.push(THREE.MathUtils.lerp(stops[i], stops[i + 1], a / (a - b)));
  }
  stops = [...new Set([...stops, ...crossings])].sort((a, b) => a - b);
  const bandRows = stops.slice(0, -1).map((y, i) => ({ y0: y, y1: stops[i + 1],
    inner0: edgeValue(innerEdge, y, 0) + .00005, inner1: edgeValue(innerEdge, stops[i + 1], 0) + .00005,
    outer0: outerX(y) - .00015, outer1: outerX(stops[i + 1]) - .00015,
    front0: edgeValue(foreEdge, y, 2) - .0001, front1: edgeValue(foreEdge, stops[i + 1], 2) - .0001 }));
  // Knot unions contain stops where the active envelope never changes slope.
  // Coalesce those planes instead of clipping the same face twice.
  const bands: typeof bandRows = [];
  for (const next of bandRows) {
    const previous = bands[bands.length - 1];
    if (previous) {
      const t = (previous.y1 - previous.y0) / (next.y1 - previous.y0);
      if (Math.abs(previous.inner1 - THREE.MathUtils.lerp(previous.inner0, next.inner1, t)) < 1e-7
        && Math.abs(previous.outer1 - THREE.MathUtils.lerp(previous.outer0, next.outer1, t)) < 1e-7
        && Math.abs(previous.front1 - THREE.MathUtils.lerp(previous.front0, next.front1, t)) < 1e-7) {
        previous.y1 = next.y1; previous.inner1 = next.inner1; previous.outer1 = next.outer1; previous.front1 = next.front1; continue;
      }
    }
    bands.push({ ...next });
  }
  tailWork.bands = bands.length;
  const minFront = Math.min(...foreEdge.map(p => p[2])) - .0001;
  // The first upper-red strips cross a short outward bulge in the old skin.
  // Remove only that skin, including its seal, outward from the seated recess.
  // Atlas/sign panels and every part of the lamp foot are outside this pass.
  const joint0 = .70 + upperRows[0] * .89, joint1 = .70 + upperRows[2] * .89;
  const jointFore0 = edgeValue(foreEdge, joint0, 2) - .0001, jointFore1 = edgeValue(foreEdge, joint1, 2) - .0001;
  // At the top mounting edge, constrain the mask by the actual cap in YZ.
  const roofCap = [.7, .8, .9, 1].map(u => colourPoint(u, 1));
  const roofRows = [1.584, ...roofCap.map(p => p[1]).filter(y => y > 1.584)];
  const roof = roofRows.map(y => ({ y, back: edgeValue(roofCap, y, 2), inner: edgeValue(roofCap, y, 0) - .001,
    front: edgeValue(foreEdge, y, 2) - .0001 }));
  const roofBands = roof.slice(0, -1).map((a, i) => ({ y0: a.y, y1: roof[i + 1].y,
    inner0: a.inner, inner1: roof[i + 1].inner, outer0: 2, outer1: 2,
    front0: a.front, front1: roof[i + 1].front, back0: a.back, back1: roof[i + 1].back }));
  // Union the local mask with the ordinary socket before cutting. Each mesh
  // is decoded and rebuilt once, avoiding repeated scans and Float32 rounding.
  const skinStops = [...new Set([...bands.flatMap(b => [b.y0, b.y1]), joint0, joint1])].sort((a, b) => a - b);
  const socketSkin: TailBand[] = skinStops.slice(0, -1).map((y0, i) => {
    const y1 = skinStops[i + 1], mid = (y0 + y1) / 2;
    const base = bands.find(b => mid >= b.y0 && mid <= b.y1)!;
    const value = (a: number, b: number, y: number) => THREE.MathUtils.lerp(a, b, (y - base.y0) / (base.y1 - base.y0));
    const jointActive = mid >= joint0 && mid <= joint1;
    const fore = (y: number) => THREE.MathUtils.lerp(jointFore0, jointFore1, (y - joint0) / (joint1 - joint0));
    return { y0, y1, inner0: value(base.inner0, base.inner1, y0), inner1: value(base.inner0, base.inner1, y1),
      outer0: jointActive ? 2 : value(base.outer0, base.outer1, y0), outer1: jointActive ? 2 : value(base.outer0, base.outer1, y1),
      front0: jointActive ? Math.min(value(base.front0, base.front1, y0), fore(y0)) : value(base.front0, base.front1, y0),
      front1: jointActive ? Math.min(value(base.front0, base.front1, y1), fore(y1)) : value(base.front0, base.front1, y1) };
  });
  socketSkin.push(...roofBands); tailWork.bands = socketSkin.length;
  const skinPart = (p: THREE.Mesh) => p.material === paint || p.material === rubber;
  cutTailSockets(tailBodyParts.filter(p => !skinPart(p)), bands, minFront, tailWork);
  cutTailSockets(tailBodyParts.filter(skinPart), socketSkin, Math.min(minFront, ...roof.map(p => p.front)), tailWork);
  root.userData.tailLampFit = { ...tailWork };
  // Release the construction-only skin and fitting caches.
  tailFits.clear(); rimFits.clear(); skinBands.length = 0; tailPositions.length = 0; tailBodyParts.length = 0;
  const plate = decal(new THREE.PlaneGeometry(.38, .19), [.015, .08, .51, .33]);
  plate.position.set(0, .875, 2.278);
  const frontPlate = decal(new THREE.PlaneGeometry(.36, .17), [.015, .08, .51, .33]);
  frontPlate.rotation.y = Math.PI;
  frontPlate.position.set(...nose(0, .43, .040));
  const exhaust = mesh(new THREE.CylinderGeometry(.037, .037, .18, 12, 1, true), alloy);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(.61, .22, 2.19);
  // Roof rails, rear crossbar, ribbed amber beacon, and a two-sided illuminated sign.
  for (const s of [-1, 1]) {
    line([[s * .64, 1.64, -.34], [s * .66, 1.705, .1], [s * .65, 1.70, 1.05], [s * .62, 1.65, 1.82]], .026, rubber);
    for (const z of [-.21, 1.45]) box([.09, .065, .17], [s * .65, 1.65, z], trim);
  }
  box([1.33, .035, .065], [0, 1.72, 1.15], rubber);
  const roofKit: THREE.Object3D[] = [];
  const base = mesh(new THREE.CylinderGeometry(.112, .112, .035, 24), rubber); base.position.set(-.39, 1.76, 1.15); roofKit.push(base);
  const beacon = mesh(new THREE.CylinderGeometry(.090, .106, .18, 32), amber);
  beacon.name = 'Flashable amber lens'; beacon.position.set(-.39, 1.865, 1.15);
  for (const y of [1.80, 1.84, 1.88, 1.92]) {
    const ring = mesh(new THREE.TorusGeometry(.098 - (y - 1.8) * .075, .003, 4, 32), amber);
    ring.rotation.x = Math.PI / 2; ring.position.set(-.39, y, 1.15); roofKit.push(ring);
  }
  line([[.17, 1.64, 1.56], [.17, 1.91, 1.67]], .008, rubber);
  for (const x of [-.26, .26]) roofKit.push(box([.08, .035, .22], [x, 1.69, .48], rubber));
  // Trapezoidal sign: broad front/rear faces point along the road.
  const signGeo = new THREE.ExtrudeGeometry(shape([[-.17, 0], [-.10, .22], [.10, .22], [.17, 0]]), { depth: .76, bevelEnabled: false, steps: 1 });
  const sp = signGeo.getAttribute('position');
  for (let i = 0; i < sp.count; i++) { const z = sp.getX(i), y = sp.getY(i), x = sp.getZ(i) - .38; sp.setXYZ(i, x, y, z); }
  const suv = signGeo.getAttribute('uv'); for (let i = 0; i < suv.count; i++) suv.setXY(i, .8, .2);
  signGeo.computeVertexNormals();
  const signLight = mesh(signGeo, signMaterial); signLight.position.set(.18, 1.72, .48); signLight.name = 'MABOU MAIL illuminated roof box';
  for (const s of [-1, 1]) {
    const face = decal(surface(1, 1, (u, t) => [(u - .5) * .735 + .18, 1.725 + t * .205, .48 + s * (.169 - t * .065)], s > 0), [0, .5, 1, .5]);
    if (s < 0) { const uv = face.geometry.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    roofKit.push(face);
  }
  if (!mailTrim) { for (const part of roofKit) part.removeFromParent(); beacon.visible = signLight.visible = false; }

  // Cockpit: right-hand wheel, instrument hood, seats and working mail tubs.
  mesh(colour(surface(8,24,(u,t)=>{
    const q=u*2-1,z=-1.14+t*.47;return [q*(.80-.04*t),1.13-.105*t+.025*Math.sin(t*Math.PI)-.015*q*q,z];
  }),0x373f3d),interior);
  mesh(colour(surface(4,24,(u,t)=>[(u*2-1)*.76,.91+t*.115,-.67]),0x373f3d),interior);
  mesh(colour(surface(8,16,(u,t)=>{
    const q=u*2-1;return [.44+q*.205,1.095+.070*Math.sqrt(Math.max(0,1-q*q)), -.90+t*.24];
  }),0x242b29),interior);
  box([.36,.035,.245],[.44,1.085,-.78],interior,body,0x242b29);
  box([.27,.11,.012],[.44,1.10,-.662],interior,body,0x333d38);
  for (const x of [.37, .51]) {
    const gauge = mesh(colour(new THREE.CircleGeometry(.043, 16), 0x142722), interior);
    gauge.position.set(x, 1.11, -.652);
    line([[x, 1.11, -.646], [x + .018, 1.135, -.646]], .003, alloy);
  }
  const wheel = new THREE.Group(); wheel.position.set(.44, 1.02, -.54); wheel.rotation.x = -.34; body.add(wheel);
  mesh(new THREE.TorusGeometry(.17, .018, 8, 32), rubber, wheel);
  box([.13, .10, .055], [0, 0, 0], interior, wheel, 0x454e49);
  for (const angle of [0, Math.PI, -Math.PI / 2]) line([[0, 0, 0], [Math.cos(angle) * .155, Math.sin(angle) * .155, 0]], .019, trim, wheel);
  for (const x of [-.43, .43]) {
    box([.47, .13, .50], [x, .64, -.05], interior, body, 0x293332);
    const back = box([.46, .49, .12], [x, .91, .21], interior, body, 0x303a38); back.rotation.x = -.10;
    box([.29, .19, .12], [x, 1.24, .24], interior, body, 0x293331);
    for (const dx of [-.21, .21]) box([.055, .09, .44], [x + dx, .72, -.04], interior, body, 0x414a46);
  }
  box([.20, .28, .36], [0, .66, -.24], interior, body, 0x535d57);
  box([.25, .035, .06], [0, 1.44, -.61], rubber);
  function tub(x: number, y: number, z: number): void {
    box([.48, .025, .35], [x, y, z], interior, body, 0x959e8e);
    for (const s of [-1, 1]) {
      box([.022, .22, .35], [x + s * .235, y + .11, z], interior, body, 0xaeb6a1);
      box([.48, .22, .022], [x, y + .11, z + s * .165], interior, body, 0xaeb6a1);
      box([.51, .025, .028], [x, y + .22, z + s * .17], interior, body, 0xd0d4bd);
    }
    for (let i = 0; i < 9; i++) {
      const mail = box([.33, .17, .012], [x, y + .15, z - .13 + i * .031], interior, body, i % 3 ? 0xe9e4d4 : 0xb3bdab); mail.rotation.x = -.18;
    }
  }
  tub(-.43, .74, -.12); tub(-.18, .51, .77);
  for (let i = 0; i < 13; i++) {
    const x = (i % 3 - 1) * .43, z = .65 + Math.floor(i / 3) % 3 * .43;
    const y = .57 + Math.floor(i / 9) * .43;
    const p = box([.34 + random() * .13, .29 + random() * .15, .32 + random() * .10], [x, y + .16, z], parcel);
    p.rotation.y = (random() - .5) * .20;
  }
  const driverEye = new THREE.Object3D(); driverEye.name = 'Right-hand driver eye'; driverEye.position.set(.43, 1.36, -.08); body.add(driverEye);

  // Independent wheel pivots keep suspension lean out of steering and spin transforms.
  function makeWheel(x: number, z: number, front: boolean): { spin: THREE.Object3D; pivot: THREE.Object3D } {
    const pivot = new THREE.Group(); pivot.position.set(x, 0, z); root.add(pivot);
    pivot.name = front ? 'Front steering pivot' : 'Rear axle pivot';
    const spin = new THREE.Group(); spin.name = 'Wheel, spin local X'; spin.position.set(0, .35, 0); pivot.add(spin);
    const tyreProfile = [[.225, -.108], [.285, -.112], [.329, -.100], [.35, -.065], [.35, .065], [.329, .100], [.285, .112], [.225, .108]].map(([r, a]) => new THREE.Vector2(r, a));
    const tyre = mesh(new THREE.LatheGeometry(tyreProfile, 32), rubber, spin); tyre.rotation.z = Math.PI / 2;
    const faceX = Math.sign(x) * .115;
    const rim = mesh(new THREE.TorusGeometry(.228, .014, 6, 40), alloy, spin); rim.rotation.y = Math.PI / 2; rim.position.x = faceX;
    const barrel = mesh(new THREE.CylinderGeometry(.222, .222, .14, 32, 1, true), trim, spin); barrel.rotation.z = Math.PI / 2;
    const hub = mesh(new THREE.CylinderGeometry(.070, .070, .055, 20), alloy, spin); hub.rotation.z = Math.PI / 2; hub.position.x = faceX * .82;
    for (let i = 0; i < 5; i++) for (const split of [-1, 1]) {
      const angle = i * Math.PI * 2 / 5 + split * .17;
      const spoke = box([.035, .17, .033], [faceX, Math.cos(angle) * .143, Math.sin(angle) * .143], alloy, spin);
      spoke.rotation.x = angle;
    }
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const lug = mesh(new THREE.SphereGeometry(.009, 6, 4), trim, spin); lug.position.set(faceX * 1.15, Math.cos(a) * .047, Math.sin(a) * .047);
    }
    const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(.060, .002, .012), rubber, 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const angle = Math.floor(i / 2) / 16 * Math.PI * 2;
      dummy.position.set(i % 2 ? .051 : -.051, .349 * Math.cos(angle), .349 * Math.sin(angle));
      dummy.rotation.set(angle, i % 2 ? .23 : -.23, 0); dummy.updateMatrix(); tread.setMatrixAt(i, dummy.matrix);
    }
    spin.add(tread);
    return { spin, pivot };
  }
  const fl = makeWheel(-.785, -1.31, true), fr = makeWheel(.785, -1.31, true);
  const rl = makeWheel(-.785, 1.31, false), rr = makeWheel(.785, 1.31, false);
  // Static parts share a draw per material under each animated parent. Retain the
  // public lamp/sign meshes so callers can still change their light materials.
  function batch(parent: THREE.Object3D, keep: THREE.Mesh[] = []): void {
    const buckets = new Map<THREE.MeshStandardMaterial, THREE.Mesh[]>();
    for (const child of [...parent.children]) {
      if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || keep.includes(child) || !(child.material instanceof THREE.MeshStandardMaterial))
        continue;
      const list = buckets.get(child.material) ?? [];
      list.push(child);
      buckets.set(child.material, list);
    }
    for (const [material, parts] of buckets) {
      const geometries = parts.map(part => {
        part.updateMatrix();
        let geo = part.geometry.clone().applyMatrix4(part.matrix);
        if (geo.index) {
          const indexed = geo;
          geo = indexed.toNonIndexed();
          indexed.dispose();
        }
        geo.normalizeNormals();
        // All parts in a bucket have the same attribute layout, including tint alpha.
        if (!material.vertexColors)
          geo.deleteAttribute('color');
        return geo;
      });
      const geometry = mergeGeometries(geometries);
      if (!geometry)
        throw new Error('Car material batch has incompatible geometry.');
      const result = new THREE.Mesh(geometry, material);
      result.castShadow = true;
      result.name = 'Static car material batch';
      parent.add(result);
      for (const part of parts) {
        parent.remove(part);
        part.geometry.dispose();
      }
      for (const geo of geometries)
        geo.dispose();
    }
  }
  batch(body, [beacon, signLight, driverWindow, ...brakeLights]);
  for (const wheel of [fl, fr, rl, rr])
    batch(wheel.spin);
  return {
    root, body,
    wheels: { fl: fl.spin, fr: fr.spin, rl: rl.spin, rr: rr.spin },
    steer: { fl: fl.pivot, fr: fr.pivot }, beacon, signLight, brakeLights, driverEye, driverWindow,
    setWindowDown(down: boolean): void { driverWindow.position.y = down ? -.52 : 0; driverWindow.visible = !down; },
    setDirt(amount: number): void { mud.opacity = Number.isFinite(amount) ? THREE.MathUtils.clamp(amount, 0, 1) : 0; mud.visible = mud.opacity > 0; },
  };
}
