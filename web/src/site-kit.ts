/**
 * The kit for hand-built sites (Judique village, Port Hawkesbury): boxes, roofs, wall facets and patterned canvases,
 * placed in a site's local frame and baked into world coordinates, then merged into one mesh per surface pattern.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = THREE.Vector3;
export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- surface patterns: grey-scale, so the vertex colour gives the hue. One repeat is one metre. ----------------------
export function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Site textures need a canvas context');
  draw(g);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function seeded(seed: number) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
export const grey = (l: number, a = 1): string => `rgba(${Math.round(l * 255)},${Math.round(l * 255)},${Math.round(l * 255)},${a})`;
// ---- the kit: everything is placed in a place's local frame and baked into world coordinates ---------------------
export interface Opts<T extends string = string> { tex?: T | null; rx?: number; ry?: number; rz?: number }
/** A local frame: +x along compass azimuth `az`, +z along az + 90 degrees, +y up; anchored at map point (e, n). */
export interface Frame { e: number; n: number; az: number }
export function frameToMap(p: Frame, x: number, z: number): [number, number] {
  const a = p.az * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  return [p.e + x * s + z * c, p.n + x * c - z * s];
}
export class Kit<T extends string = string> {
  readonly parts = new Map<T | null, THREE.BufferGeometry[]>();
  private frame = new THREE.Matrix4();
  base = 0;
  private place: Frame = { e: 0, n: 0, az: 0 };
  constructor(readonly low: boolean, private village: readonly [number, number], private groundAt: (x: number, z: number) => number) {}

  /** Work in a place's frame, its floor `lift` metres above the ground at its anchor. */
  at(p: Frame, lift: number): void {
    this.place = p;
    const x = p.e - this.village[0], z = this.village[1] - p.n;
    this.base = this.groundAt(x, z) + lift;
    this.frame.compose(v(x, this.base, z), new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), Math.PI / 2 - p.az * Math.PI / 180), v(1, 1, 1));
  }
  /** A small frame of its own: a map point and azimuth, standing on the ground there. */
  point(e: number, n: number, az: number, lift = 0): void { this.at({ e, n, az }, lift); }
  /** Ground height in this frame, at a local point. */
  ground(x: number, z: number): number {
    const [e, n] = frameToMap(this.place, x, z);
    return this.groundAt(e - this.village[0], this.village[1] - n) - this.base;
  }
  add(source: THREE.BufferGeometry, color: number, tex: T | null = null, local?: THREE.Matrix4): void {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (local) g.applyMatrix4(local);
    g.applyMatrix4(this.frame);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!tex) { if (g.attributes.uv) g.deleteAttribute('uv'); }
    else if (!g.attributes.uv) throw new Error('A patterned part needs UVs');
    const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const list = this.parts.get(tex) ?? []; list.push(g); this.parts.set(tex, list);
  }
  matrix(x: number, y: number, z: number, o: Opts<T> = {}): THREE.Matrix4 {
    return new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ')), v(1, 1, 1));
  }
  /** A box by its centre. Patterned faces get one UV unit per metre. */
  box(sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number, o: Opts<T> = {}): void {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (o.tex) {
      const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      for (let i = 0; i < uv.count; i++) { const [du, dv] = dims[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv); }
    }
    this.add(g, color, o.tex ?? null, this.matrix(x, y, z, o));
  }
  /** A box between two corners, x0..x1, y0..y1, z0..z1. */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, tex: T | null = null): void {
    this.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, color, { tex });
  }
  /** A box whose hidden bottom reaches below the sampled ground under it; its top stays level. */
  grounded(x0: number, x1: number, z0: number, z1: number, top: number, color: number, tex: T | null = null): void {
    let bottom = Math.min(top - 0.1, 0);
    const nx = Math.max(1, Math.ceil((x1 - x0) / 1.5)), nz = Math.max(1, Math.ceil((z1 - z0) / 1.5));
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) bottom = Math.min(bottom, this.ground(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * k / nz));
    this.span(x0, x1, bottom - 0.3, top, z0, z1, color, tex);
  }
  cylinder(r0: number, r1: number, h: number, x: number, y: number, z: number, color: number, segments = 12, o: Opts<T> = {}): void {
    const g = new THREE.CylinderGeometry(r1, r0, h, this.low ? Math.max(6, segments / 2) : segments);
    if (o.tex) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * (r0 + r1), uv.getY(i) * h); }
    this.add(g, color, o.tex ?? null, this.matrix(x, y + h / 2, z, o));
  }
  /** A flat convex polygon (points in order). UV: u along `along`, v across it in the plane, in metres. */
  facet(points: V3[], color: number, tex: T | null = null, along = v(1, 0, 0)): void {
    const p0 = points[0], n = new THREE.Vector3().subVectors(points[1], p0).cross(new THREE.Vector3().subVectors(points[2], p0)).normalize();
    const u = along.clone().addScaledVector(n, -along.dot(n)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    const pos: number[] = [], uv: number[] = [];
    for (let i = 1; i + 1 < points.length; i++) for (const p of [p0, points[i], points[i + 1]]) {
      pos.push(p.x, p.y, p.z); const d = p.clone().sub(p0); uv.push(d.dot(u), d.dot(w));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.add(g, color, tex);
  }
  /** A flat shape on a wall: (u, y) in the wall's plane, `d` metres out from it. `face` is the wall's outward normal. */
  shape(shape: THREE.Shape, face: Face, d: number, color: number, segments = 10): void {
    this.add(new THREE.ShapeGeometry(shape, this.low ? Math.max(3, segments / 2) : segments), color, null, face.at(0, 0, d));
  }
  /** A box on a wall: centred at (u, y), `d` metres out, `t` thick. */
  onWall(face: Face, u: number, y: number, w: number, h: number, d: number, t: number, color: number, rz = 0): void {
    this.add(new THREE.BoxGeometry(w, h, t), color, null, face.at(u, y, d + t / 2).multiply(new THREE.Matrix4().makeRotationZ(rz)));
  }

  /**
   * A pitched roof over the rectangle a0..a1 (along the ridge) by -w..w (across), centred at `c` across. alongX: the
   * ridge runs along local x (else along z). A hipped end slopes like the sides. Eaves get a fascia board.
   */
  roof(r: { a0: number; a1: number; c?: number; w: number; eave: number; rise: number; over?: number; endOver?: number;
    hip0?: boolean; hip1?: boolean; alongX: boolean; color: number; tex: T | null; fascia?: number; rake?: boolean }): void {
    const o = r.over ?? 0.4, oe = r.endOver ?? o, c = r.c ?? 0, drop = o * r.rise / r.w, W = r.w + o;
    const A0 = r.a0 - oe, A1 = r.a1 + oe, ey = r.eave - drop, ry = r.eave + r.rise;
    const R0 = r.hip0 ? r.a0 + r.w : A0, R1 = r.hip1 ? r.a1 - r.w : A1;
    const P = (a: number, b: number, y: number) => r.alongX ? v(a, y, c + b) : v(c + b, y, a);
    const dir = r.alongX ? v(1, 0, 0) : v(0, 0, 1);
    this.facet([P(A0, W, ey), P(A1, W, ey), P(R1, 0, ry), P(R0, 0, ry)], r.color, r.tex, dir);
    this.facet([P(A1, -W, ey), P(A0, -W, ey), P(R0, 0, ry), P(R1, 0, ry)], r.color, r.tex, dir);
    const across = r.alongX ? v(0, 0, 1) : v(1, 0, 0);
    if (r.hip0) this.facet([P(A0, -W, ey), P(A0, W, ey), P(R0, 0, ry)], r.color, r.tex, across);
    if (r.hip1) this.facet([P(A1, W, ey), P(A1, -W, ey), P(R1, 0, ry)], r.color, r.tex, across);
    if (r.fascia !== undefined) {
      const f = 0.22;
      for (const s of [-1, 1]) this.facet([P(A0, s * W, ey), P(A1, s * W, ey), P(A1, s * W, ey - f), P(A0, s * W, ey - f)], r.fascia);
      if (r.rake) for (const [a, h] of [[A0, r.hip0], [A1, r.hip1]] as const) if (!h) for (const s of [-1, 1]) {
        this.facet([P(a, s * W, ey), P(a, 0, ry), P(a, 0, ry - f), P(a, s * W, ey - f)], r.fascia);
      }
    }
  }
  /** The triangle of a gable end, in the wall's plane: half width w, from the eave up `rise`. */
  gable(face: Face, uc: number, w: number, eave: number, rise: number, color: number, tex: T | null = null): void {
    const pts = [face.point(uc - w, eave), face.point(uc + w, eave), face.point(uc, eave + rise)];
    this.facet(pts, color, tex, face.uAxis());
  }
}

/** A wall plane: outward normal along ±x or ±z, at a coordinate. Its u axis runs left to right seen from outside. */
export class Face {
  constructor(readonly normal: 'x+' | 'x-' | 'z+' | 'z-', readonly at0: number) {}
  private get ry() { return { 'z+': 0, 'x+': Math.PI / 2, 'z-': Math.PI, 'x-': -Math.PI / 2 }[this.normal]; }
  /** Local frame matrix for a point (u, y) on the wall, d out from it, facing out. */
  at(u: number, y: number, d: number): THREE.Matrix4 {
    const m = new THREE.Matrix4().makeRotationY(this.ry), p = this.point(u, y, d);
    return m.setPosition(p);
  }
  point(u: number, y: number, d = 0): V3 {
    switch (this.normal) {
      case 'z+': return v(u, y, this.at0 + d);
      case 'z-': return v(-u, y, this.at0 - d);
      case 'x+': return v(this.at0 + d, y, -u);
      default: return v(this.at0 - d, y, u);
    }
  }
  uAxis(): V3 { return { 'z+': v(1, 0, 0), 'z-': v(-1, 0, 0), 'x+': v(0, 0, -1), 'x-': v(0, 0, 1) }[this.normal]; }
}


/** Merge a kit's parts into one mesh per surface pattern, with the given materials. The parts are disposed. */
export function mergeKit<T extends string>(kit: Kit<T>, name: string, material: (tex: T | null) => THREE.Material, shadows = true): THREE.Group {
  const group = new THREE.Group(); group.name = name;
  for (const [tex, parts] of kit.parts) {
    const geometry = mergeGeometries(parts);
    if (!geometry) throw new Error(`${name}: geometry could not be merged`);
    for (const p of parts) p.dispose();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material(tex));
    mesh.name = `${name}-${tex ?? 'paint'}`;
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }
  return group;
}
