import * as THREE from 'three';

export type RGB = [number, number, number];

/**
 * Collects flat-shaded, vertex-coloured triangles for one merged mesh. Shapes are given in the local frame set by
 * `at()`; everything a hand-built place needs is a box, a cylinder or a profile pushed along an axis.
 */
export class Mesher {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  private m = new THREE.Matrix4();
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);

  /** Place the shapes that follow: a position, a turn about the vertical axis, then a pitch and a roll. */
  at(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): this {
    this.m.compose(this.a.set(x, y, z), this.q.setFromEuler(this.e.set(pitch, yaw, roll)), this.one);
    return this;
  }
  /** Place relative to another frame (for parts of a model that is itself placed). */
  within(parent: THREE.Matrix4, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): this {
    this.at(x, y, z, yaw, pitch, roll);
    this.m.premultiply(parent);
    return this;
  }
  get frame(): THREE.Matrix4 { return this.m.clone(); }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, k: RGB): void {
    this.a.set(ax, ay, az).applyMatrix4(this.m); this.b.set(bx, by, bz).applyMatrix4(this.m); this.c.set(cx, cy, cz).applyMatrix4(this.m);
    this.pos.push(this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z, this.c.x, this.c.y, this.c.z);
    this.col.push(k[0], k[1], k[2], k[0], k[1], k[2], k[0], k[1], k[2]);
  }
  /** Four corners, counter-clockwise seen from outside. */
  quad(p: number[][], k: RGB): void {
    this.tri(p[0][0], p[0][1], p[0][2], p[1][0], p[1][1], p[1][2], p[2][0], p[2][1], p[2][2], k);
    this.tri(p[0][0], p[0][1], p[0][2], p[2][0], p[2][1], p[2][2], p[3][0], p[3][1], p[3][2], k);
  }
  /** A textured rectangle in the local x-y plane, facing +z, centred, with its picture taken from an atlas cell. */
  plate(w: number, h: number, cell: [number, number, number, number], backAt: number | null = null): void {
    const [u0, v0, u1, v1] = cell, x = w / 2, y = h / 2, f = 0.006;
    const k: RGB = [1, 1, 1];
    this.quad([[-x, -y, f], [x, -y, f], [x, y, f], [-x, y, f]], k);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    if (backAt !== null) {
      // The same face again on the far side of a board that is `backAt` thick behind the front.
      const b = -backAt - f;
      this.quad([[x, -y, b], [-x, -y, b], [-x, y, b], [x, y, b]], k);
      this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  }

  /** A box by its centre and full sizes. `open` leaves out the bottom, which nobody sees on the ground. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, k: RGB, open = true): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], k);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], k);
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], k);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], k);
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], k);
    if (!open) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], k);
  }

  /** A cylinder or cone frustum by its centre, along the given axis. r1 is the radius at the far (positive) end. */
  cyl(cx: number, cy: number, cz: number, r: number, len: number, k: RGB, axis: 'x' | 'y' | 'z' = 'y', seg = 10, r1 = r, capK: RGB | null = k): void {
    const p = (ang: number, rad: number, t: number): number[] => {
      const s = Math.sin(ang) * rad, c = Math.cos(ang) * rad;
      return axis === 'y' ? [cx + c, cy + t, cz + s] : axis === 'x' ? [cx + t, cy + c, cz - s] : [cx + s, cy + c, cz + t];
    };
    const h = len / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.quad([p(a1, r, -h), p(a0, r, -h), p(a0, r1, h), p(a1, r1, h)], k);
      if (capK) {
        const top = p(0, 0, h), bot = p(0, 0, -h), t0 = p(a0, r1, h), t1 = p(a1, r1, h), b0 = p(a0, r, -h), b1 = p(a1, r, -h);
        if (r1 > 0.001) this.tri(top[0], top[1], top[2], t1[0], t1[1], t1[2], t0[0], t0[1], t0[2], capK);
        this.tri(bot[0], bot[1], bot[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], capK);
      }
    }
  }

  /**
   * A profile in the local x-y plane (counter-clockwise), pushed along z from z0 to z1. Caps are triangulated, so
   * the profile may be concave: a car's side view, an arch, a Z sheet pile.
   */
  extrude(profile: number[][], z0: number, z1: number, k: RGB, capK: RGB | null = k): void {
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = profile[i], [bx, by] = profile[(i + 1) % n];
      this.quad([[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], k);
    }
    if (!capK) return;
    const faces = THREE.ShapeUtils.triangulateShape(profile.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [i, j, l] of faces) {
      const a = profile[i], b = profile[j], c = profile[l];
      this.tri(a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1, capK);
      this.tri(a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0, capK);
    }
  }

  get triangles(): number { return this.pos.length / 9; }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

/** One canvas that holds every sign of a place, so all of them are a single texture and a single draw. */
export class SignAtlas {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private x = 0; private y = 0; private row = 0;

  /** `size` is the width in pixels. The yard's signs need more rows than a square holds, so the height is its own number. */
  constructor(readonly size = 1024, readonly height = size) {
    this.canvas.width = size; this.canvas.height = height;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** Reserve a cell and paint it. Returns the cell as [u0, v0, u1, v1] and a function that paints it again. */
  add(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): { cell: [number, number, number, number]; repaint: (p: (g: CanvasRenderingContext2D, w: number, h: number) => void) => void } {
    if (this.x + w > this.size) { this.x = 0; this.y += this.row + 2; this.row = 0; }
    const x = this.x, y = this.y;
    if (y + h > this.height) console.warn(`sign atlas: a ${w} x ${h} sign does not fit (row ${y} of ${this.height})`);
    this.x += w + 2; this.row = Math.max(this.row, h);
    const draw = (p: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
      this.g.save(); this.g.translate(x, y); this.g.beginPath(); this.g.rect(0, 0, w, h); this.g.clip();
      p(this.g, w, h);
      this.g.restore(); this.texture.needsUpdate = true;
    };
    draw(paint);
    const s = this.size, t = this.height;
    return { cell: [x / s, 1 - (y + h) / t, (x + w) / s, 1 - y / t], repaint: draw };
  }
}

/** Plain painted lettering, centred, that shrinks to fit its board. */
export function letters(g: CanvasRenderingContext2D, w: number, h: number, lines: string[], ink: string, ground: string, opts: { font?: string; border?: string; weights?: number[] } = {}): void {
  g.fillStyle = ground; g.fillRect(0, 0, w, h);
  if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = Math.max(3, h * 0.035); g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth); }
  const weights = opts.weights ?? lines.map(() => 1), total = weights.reduce((a, b) => a + b, 0);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  let y = h * 0.1;
  lines.forEach((text, i) => {
    const band = (h * 0.8 * weights[i]) / total;
    let px = band * 0.78;
    g.font = `bold ${px}px ${opts.font ?? 'sans-serif'}`;
    const wide = g.measureText(text).width;
    if (wide > w * 0.86) { px *= (w * 0.86) / wide; g.font = `bold ${px}px ${opts.font ?? 'sans-serif'}`; }
    g.fillText(text, w / 2, y + band / 2);
    y += band;
  });
}

/** A small repeatable random number source, so a place looks the same on every visit. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
