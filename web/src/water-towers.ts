import * as THREE from 'three';
import { pushOut, type Pushable, type Solid } from './parked';
import { WATER_TOWERS, type WaterTowerSpec } from './water-towers-data';

const CONCRETE_COLOR = 0x9c9b92;
const CONCRETE_DARK = 0x7a7a73;
const DOOR_COLOR = 0x2c333b;
const WHITE_TRIM = 0xdce0e2;

/** Vertical ground stretch matches terrain.ts, buildings.ts and pt-industry.ts. */
export function waterTowerGround(base: number, exag: number, sea: number): number {
  return base > sea ? sea + (base - sea) * exag : base;
}

/** Records active in the given game area (empty for areas without standing water towers or small tanks). */
export function waterTowersForArea(area: string): readonly WaterTowerSpec[] {
  return WATER_TOWERS.filter(t => (t.areas as readonly string[]).includes(area));
}

/**
 * Clears baked HRDEM DSM canopy returns inside every water tower and tank footprint (+ 2 m margin)
 * so trees do not poke through the tank walls or roof domes.
 */
export function waterTowerCanopyExcludes(east: number, north: number, area?: string): boolean {
  for (const t of WATER_TOWERS) {
    if (area && !(t.areas as readonly string[]).includes(area)) continue;
    const r = t.diameter / 2 + 2.0;
    const de = east - t.e;
    const dn = north - t.n;
    if (de * de + dn * dn <= r * r) return true;
    if (t.valveHouse) {
      const a = t.valveHouse.azDeg * Math.PI / 180;
      const ve = t.e + Math.sin(a) * t.valveHouse.dist;
      const vn = t.n + Math.cos(a) * t.valveHouse.dist;
      const vr = Math.hypot(t.valveHouse.width, t.valveHouse.depth) / 2 + 1.5;
      const vde = east - ve;
      const vdn = north - vn;
      if (vde * vde + vdn * vdn <= vr * vr) return true;
    }
  }
  return false;
}

interface MeshBuilder {
  addCylinder(
    cx: number, yBot: number, cz: number,
    rBot: number, rTop: number, height: number,
    segments: number, hex: number, capTop?: boolean, capBottom?: boolean,
  ): void;
  addBox(
    cx: number, yMid: number, cz: number,
    sx: number, sy: number, sz: number,
    yawRad: number, hex: number,
  ): void;
  addStrut(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    radius: number, hex: number,
  ): void;
  build(): THREE.BufferGeometry;
}

function createMeshBuilder(): MeshBuilder {
  const pos: number[] = [];
  const norm: number[] = [];
  const col: number[] = [];
  const tmpColor = new THREE.Color();

  const pushTri = (
    ax: number, ay: number, az: number, anx: number, any: number, anz: number,
    bx: number, by: number, bz: number, bnx: number, bny: number, bnz: number,
    cx: number, cy: number, cz: number, cnx: number, cny: number, cnz: number,
    r: number, g: number, b: number,
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    norm.push(anx, any, anz, bnx, bny, bnz, cnx, cny, cnz);
    col.push(r, g, b, r, g, b, r, g, b);
  };

  const pushQuadFlat = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    r: number, g: number, b: number,
  ) => {
    pushTri(ax, ay, az, nx, ny, nz, bx, by, bz, nx, ny, nz, cx, cy, cz, nx, ny, nz, r, g, b);
    pushTri(ax, ay, az, nx, ny, nz, cx, cy, cz, nx, ny, nz, dx, dy, dz, nx, ny, nz, r, g, b);
  };

  return {
    addCylinder(cx, yBot, cz, rBot, rTop, height, segments, hex, capTop = true, capBottom = false) {
      if (height <= 0 || segments < 3) return;
      tmpColor.setHex(hex);
      const { r, g, b } = tmpColor;
      const yTop = yBot + height;
      const dr = rBot - rTop;
      const slopeLen = Math.hypot(height, dr) || 1;
      const nrScale = height / slopeLen;
      const nyVal = dr / slopeLen;

      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);

        const bx0 = cx + c0 * rBot, bz0 = cz + s0 * rBot;
        const bx1 = cx + c1 * rBot, bz1 = cz + s1 * rBot;
        const tx0 = cx + c0 * rTop, tz0 = cz + s0 * rTop;
        const tx1 = cx + c1 * rTop, tz1 = cz + s1 * rTop;

        const nx0 = c0 * nrScale, nz0 = s0 * nrScale;
        const nx1 = c1 * nrScale, nz1 = s1 * nrScale;

        // Outward-facing CCW winding around +Y (seen from outside: a0 -> a1 moves clockwise in XZ, so b0 -> t0 -> t1 is outward).
        if (rBot > 1e-4) {
          pushTri(bx0, yBot, bz0, nx0, nyVal, nz0, tx0, yTop, tz0, nx0, nyVal, nz0, bx1, yBot, bz1, nx1, nyVal, nz1, r, g, b);
        }
        if (rTop > 1e-4) {
          pushTri(tx0, yTop, tz0, nx0, nyVal, nz0, tx1, yTop, tz1, nx1, nyVal, nz1, bx1, yBot, bz1, nx1, nyVal, nz1, r, g, b);
        }
        if (capTop && rTop > 1e-4) {
          pushTri(cx, yTop, cz, 0, 1, 0, tx1, yTop, tz1, 0, 1, 0, tx0, yTop, tz0, 0, 1, 0, r, g, b);
        }
        if (capBottom && rBot > 1e-4) {
          pushTri(cx, yBot, cz, 0, -1, 0, bx0, yBot, bz0, 0, -1, 0, bx1, yBot, bz1, 0, -1, 0, r, g, b);
        }
      }
    },

    addBox(cx, yMid, cz, sx, sy, sz, yawRad, hex) {
      tmpColor.setHex(hex);
      const { r, g, b } = tmpColor;
      const c = Math.cos(yawRad), s = Math.sin(yawRad);
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
        cx + lx * c + lz * s,
        yMid + ly,
        cz - lx * s + lz * c,
      ];
      const nrm = (lx: number, ly: number, lz: number): [number, number, number] => [
        lx * c + lz * s, ly, -lx * s + lz * c,
      ];
      const p000 = pt(-hx, -hy, -hz), p100 = pt(hx, -hy, -hz), p110 = pt(hx, hy, -hz), p010 = pt(-hx, hy, -hz);
      const p001 = pt(-hx, -hy, hz), p101 = pt(hx, -hy, hz), p111 = pt(hx, hy, hz), p011 = pt(-hx, hy, hz);
      const faces: readonly [[number, number, number], [number, number, number], [number, number, number], [number, number, number], [number, number, number]][] = [
        [p001, p101, p111, p011, nrm(0, 0, 1)],
        [p100, p000, p010, p110, nrm(0, 0, -1)],
        [p101, p100, p110, p111, nrm(1, 0, 0)],
        [p000, p001, p011, p010, nrm(-1, 0, 0)],
        [p011, p111, p110, p010, [0, 1, 0]],
        [p000, p100, p101, p001, [0, -1, 0]],
      ];
      for (const [a, b0, c0, d, n] of faces) {
        pushQuadFlat(a[0], a[1], a[2], b0[0], b0[1], b0[2], c0[0], c0[1], c0[2], d[0], d[1], d[2], n[0], n[1], n[2], r, g, b);
      }
    },

    addStrut(ax, ay, az, bx, by, bz, radius, hex) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) return;
      tmpColor.setHex(hex);
      const { r, g, b } = tmpColor;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      // Pick perpendicular basis (px,py,pz) and (qx,qy,qz).
      const refX = Math.abs(uy) > 0.9 ? 1 : 0, refY = Math.abs(uy) > 0.9 ? 0 : 1, refZ = 0;
      let px = uy * refZ - uz * refY, py = uz * refX - ux * refZ, pz = ux * refY - uy * refX;
      const pl = Math.hypot(px, py, pz) || 1;
      px /= pl; py /= pl; pz /= pl;
      const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
      const segs = 4;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const nx0 = px * c0 + qx * s0, ny0 = py * c0 + qy * s0, nz0 = pz * c0 + qz * s0;
        const nx1 = px * c1 + qx * s1, ny1 = py * c1 + qy * s1, nz1 = pz * c1 + qz * s1;
        const a0x = ax + nx0 * radius, a0y = ay + ny0 * radius, a0z = az + nz0 * radius;
        const a1x = ax + nx1 * radius, a1y = ay + ny1 * radius, a1z = az + nz1 * radius;
        const b0x = bx + nx0 * radius, b0y = by + ny0 * radius, b0z = bz + nz0 * radius;
        const b1x = bx + nx1 * radius, b1y = by + ny1 * radius, b1z = bz + nz1 * radius;
        pushTri(a0x, a0y, a0z, nx0, ny0, nz0, a1x, a1y, a1z, nx1, ny1, nz1, b1x, b1y, b1z, nx1, ny1, nz1, r, g, b);
        pushTri(a0x, a0y, a0z, nx0, ny0, nz0, b1x, b1y, b1z, nx1, ny1, nz1, b0x, b0y, b0z, nx0, ny0, nz0, r, g, b);
      }
    },

    build() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      return geo;
    },
  };
}

/** Foundation skirt depth below centre ground scales with exag so sloping hill pads never show a gap up to exag=3. */
export function foundationSkirt(exag: number): number {
  return Math.max(0.75, 0.75 * exag);
}

/** Add one water tower, standpipe, reservoir, elevated tank or small vertical tank to the merged mesh builder. */
function appendStructure(b: MeshBuilder, t: WaterTowerSpec, cx: number, baseY: number, cz: number, skirt: number, low: boolean): void {
  const rad = t.diameter / 2;
  const roofHex = t.roofColor ?? t.color;
  const trimHex = t.trimColor ?? 0x8a9198;
  const segs = low
    ? (t.diameter >= 9 ? 12 : 6)
    : (t.diameter >= 9 ? 16 : t.diameter >= 5 ? 12 : 8);

  if (t.kind === 'elevated') {
    const legH = t.legHeight ?? Math.max(10, t.shellHeight * 0.65);
    const bellyH = Math.max(4, t.shellHeight - legH);
    const legCount = t.legCount ?? 6;
    const topR = rad * 0.86;
    const botR = rad * 1.18;
    const legRad = Math.max(0.22, rad * 0.048);

    // Central steel riser pipe from below ground into tank belly.
    b.addCylinder(cx, baseY - skirt, cz, Math.max(0.55, rad * 0.17), Math.max(0.55, rad * 0.17), legH + skirt + 0.3, low ? 8 : 12, t.color, false, false);
    // Concrete pad around riser.
    b.addCylinder(cx, baseY - skirt, cz, Math.max(0.9, rad * 0.24), Math.max(0.85, rad * 0.22), skirt + 0.4, low ? 8 : 10, CONCRETE_COLOR, true, false);

    // Angled outer steel legs, concrete footings and horizontal/diagonal cross-bracing tiers.
    const tiers = low ? 1 : 2;
    const legs: [number, number, number, number][] = [];
    for (let i = 0; i < legCount; i++) {
      const a = (i / legCount) * Math.PI * 2;
      const bx = cx + Math.cos(a) * botR, bz = cz + Math.sin(a) * botR;
      const tx = cx + Math.cos(a) * topR, tz = cz + Math.sin(a) * topR;
      legs.push([bx, bz, tx, tz]);
      b.addCylinder(bx, baseY - skirt, bz, legRad * 2.2, legRad * 1.8, skirt + 0.5, 6, CONCRETE_COLOR, true, false);
      b.addStrut(bx, baseY + 0.3, bz, tx, baseY + legH + 0.5, tz, legRad, trimHex);
    }
    for (let tier = 1; tier <= tiers; tier++) {
      const f = tier / (tiers + 1);
      const fPrev = (tier - 1) / (tiers + 1);
      const y = baseY + legH * f;
      const yPrev = baseY + legH * fPrev;
      for (let i = 0; i < legCount; i++) {
        const cur = legs[i], nxt = legs[(i + 1) % legCount];
        const x0 = cur[0] + (cur[2] - cur[0]) * f, z0 = cur[1] + (cur[3] - cur[1]) * f;
        const x1 = nxt[0] + (nxt[2] - nxt[0]) * f, z1 = nxt[1] + (nxt[3] - nxt[1]) * f;
        b.addStrut(x0, y, z0, x1, y, z1, legRad * 0.45, trimHex);
        if (!low) {
          const px0 = cur[0] + (cur[2] - cur[0]) * fPrev, pz0 = cur[1] + (cur[3] - cur[1]) * fPrev;
          const px1 = nxt[0] + (nxt[2] - nxt[0]) * fPrev, pz1 = nxt[1] + (nxt[3] - nxt[1]) * fPrev;
          b.addStrut(px0, yPrev, pz0, x1, y, z1, legRad * 0.28, trimHex);
          b.addStrut(px1, yPrev, pz1, x0, y, z0, legRad * 0.28, trimHex);
        }
      }
    }

    // Ellipsoidal lower tank bowl, cylindrical belly, catwalk balcony and domed roof.
    const bowlH = Math.min(2.6, bellyH * 0.35);
    b.addCylinder(cx, baseY + legH - bowlH, cz, rad * 0.55, rad, bowlH, segs, t.color, false, true);
    b.addCylinder(cx, baseY + legH, cz, rad, rad, bellyH, segs, t.color, false, false);
    // Catwalk balcony ring + handrail at tank bottom.
    b.addCylinder(cx, baseY + legH - 0.12, cz, rad + 0.8, rad + 0.8, 0.18, segs, trimHex, true, true);
    b.addCylinder(cx, baseY + legH + 0.95, cz, rad + 0.78, rad + 0.78, 0.1, segs, trimHex, false, false);
    // Domed roof + central vent cap.
    const yRoof = baseY + legH + bellyH;
    b.addCylinder(cx, yRoof, cz, rad + 0.08, rad * 0.58, t.roofHeight * 0.6, segs, roofHex, false, false);
    b.addCylinder(cx, yRoof + t.roofHeight * 0.6, cz, rad * 0.58, 0.12, t.roofHeight * 0.4, segs, roofHex, true, false);
    b.addCylinder(cx, yRoof + t.roofHeight, cz, 0.35, 0.38, 0.45, 8, trimHex, true, false);
    return;
  }

  // Ground-seated concrete ring foundation plinth (skirt scales with exag so slopes never expose a gap).
  const plinthH = t.kind === 'bin' ? 0.3 : 0.55;
  const plinthPad = t.diameter >= 9 ? 0.38 : 0.22;
  b.addCylinder(cx, baseY - skirt, cz, rad + plinthPad, rad + plinthPad * 0.85, skirt + plinthH, segs, CONCRETE_COLOR, true, false);

  // Main cylindrical steel or concrete shell.
  const shellBot = baseY + plinthH;
  const shellLen = Math.max(0.5, t.shellHeight - plinthH);
  b.addCylinder(cx, shellBot, cz, rad, rad, shellLen, segs, t.color, false, false);

  // Horizontal wind-girder stiffener rings (prominent silver-grey rings on Pitt St blue standpipe; subtle bands on others).
  const ringCount = t.rings ?? 0;
  if (ringCount > 0) {
    const ringOut = t.id === 'ph-pitt-street' ? 0.24 : 0.14;
    const ringH = t.id === 'ph-pitt-street' ? 0.30 : 0.18;
    for (let i = 1; i <= ringCount; i++) {
      const frac = i / (ringCount + 1);
      const yRing = baseY + t.shellHeight * frac;
      b.addCylinder(cx, yRing - ringH / 2, cz, rad + ringOut, rad + ringOut, ringH, segs, trimHex, true, true);
    }
  }

  // Top cornice / eaves ring (omit on small LOW tanks to stay lean on phones).
  const yEave = baseY + t.shellHeight;
  if (!low || t.diameter >= 8) {
    const eaveOut = t.kind === 'reservoir' ? 0.18 : 0.14;
    const eaveH = t.kind === 'reservoir' ? 0.30 : 0.20;
    b.addCylinder(cx, yEave - eaveH * 0.6, cz, rad + eaveOut, rad + eaveOut, eaveH, segs, t.kind === 'reservoir' ? CONCRETE_DARK : trimHex, true, true);
  }

  // Roof dome (standpipe/reservoir) or conical roof (tank/silo/bin).
  const isDome = t.kind === 'standpipe' || t.kind === 'reservoir';
  if (isDome && !low) {
    const rMid = rad * 0.64;
    const h1 = t.roofHeight * 0.62;
    const h2 = t.roofHeight - h1;
    b.addCylinder(cx, yEave, cz, rad + 0.08, rMid, h1, segs, roofHex, false, false);
    b.addCylinder(cx, yEave + h1, cz, rMid, Math.max(0.15, rad * 0.06), h2, segs, roofHex, true, false);
  } else {
    b.addCylinder(cx, yEave, cz, rad + 0.08, Math.max(0.12, rad * 0.05), t.roofHeight, segs, roofHex, true, false);
  }

  // Central roof vent / manhole cap (plus small top penthouse on tall industrial silos).
  if (!low || t.diameter >= 8) {
    const ventR = Math.max(0.28, Math.min(0.65, rad * 0.085));
    const ventH = t.kind === 'silo' ? 0.85 : 0.42;
    b.addCylinder(cx, yEave + t.roofHeight - 0.05, cz, ventR * 0.85, ventR * 0.85, ventH, low ? 6 : 8, trimHex, false, false);
    b.addCylinder(cx, yEave + t.roofHeight + ventH - 0.05, cz, ventR * 1.18, ventR * 0.4, 0.22, low ? 6 : 8, trimHex, true, true);
  }

  // Exterior vertical steel access ladder (with safety cage hoops on tall desktop standpipes/silos).
  if (t.ladderDeg !== undefined) {
    const a = t.ladderDeg * Math.PI / 180;
    const dx = Math.sin(a), dz = -Math.cos(a);   // world +x is East, -z is North
    const tx = Math.cos(a), tz = Math.sin(a);    // tangent along shell circumference
    const ladStart = baseY + Math.min(2.6, t.shellHeight * 0.28);
    const ladTop = yEave + (t.balcony ? 1.15 : 0.45);
    const ladH = ladTop - ladStart;
    const ladMid = (ladStart + ladTop) / 2;
    const dist = rad + 0.28;
    const railHalf = 0.24;
    const yaw = -a;

    if (low) {
      // Lean twin vertical rails on LOW phones (keeps open ladder look with minimal triangles).
      for (const s of [-1, 1]) {
        b.addBox(cx + dx * dist + tx * railHalf * s, ladMid, cz + dz * dist + tz * railHalf * s, 0.08, ladH, 0.10, yaw, trimHex);
      }
    } else {
      for (const s of [-1, 1]) {
        b.addBox(cx + dx * dist + tx * railHalf * s, ladMid, cz + dz * dist + tz * railHalf * s, 0.07, ladH, 0.09, yaw, trimHex);
      }
      // Ladder stand-off brackets and horizontal rungs (spaced cleanly so vertex count stays low).
      const rungStep = t.shellHeight >= 15 ? 2.2 : 1.5;
      for (let y = ladStart + 0.5; y < ladTop - 0.2; y += rungStep) {
        b.addBox(cx + dx * dist, y, cz + dz * dist, railHalf * 2.0, 0.05, 0.05, yaw, trimHex);
      }
      // Safety cage hoops + vertical spine bar on tall towers (>= 10 m).
      if (t.shellHeight >= 10) {
        const cageBot = baseY + 3.4;
        const cageTop = yEave + 0.9;
        const cageCenterD = rad + 0.62;
        const cageR = 0.38;
        b.addBox(cx + dx * (cageCenterD + cageR), (cageBot + cageTop) / 2, cz + dz * (cageCenterD + cageR), 0.06, cageTop - cageBot, 0.06, yaw, trimHex);
        for (let y = cageBot; y <= cageTop; y += 3.6) {
          b.addBox(cx + dx * (cageCenterD + cageR), y, cz + dz * (cageCenterD + cageR), cageR * 1.9, 0.06, 0.06, yaw, trimHex);
          for (const s of [-1, 1]) {
            b.addBox(cx + dx * cageCenterD + tx * cageR * s, y, cz + dz * cageCenterD + tz * cageR * s, 0.06, 0.06, cageR * 1.8, yaw, trimHex);
          }
        }
      }
    }
  }

  // Top roof perimeter guardrail / balcony (on municipal standpipes and tall tanks/silos).
  if (t.balcony) {
    const railR = Math.max(1.2, rad - 0.18);
    const railH = 1.08;
    const postCount = low ? 8 : Math.min(12, Math.max(8, Math.round(rad * 1.8)));
    for (let i = 0; i < postCount; i++) {
      const a0 = (i / postCount) * Math.PI * 2;
      const a1 = ((i + 1) / postCount) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * railR, z0 = cz + Math.sin(a0) * railR;
      const x1 = cx + Math.cos(a1) * railR, z1 = cz + Math.sin(a1) * railR;
      if (!low) {
        b.addBox(x0, yEave + railH / 2, z0, 0.07, railH, 0.07, 0, trimHex);
        b.addStrut(x0, yEave + railH * 0.52, z0, x1, yEave + railH * 0.52, z1, 0.03, trimHex);
      }
      b.addStrut(x0, yEave + railH, z0, x1, yEave + railH, z1, 0.04, trimHex);
    }
  }

  // Optional small valve / control house beside base (e.g. Pitt Street standpipe's blue-walled white-trimmed shed).
  if (t.valveHouse) {
    const vh = t.valveHouse;
    const a = vh.azDeg * Math.PI / 180;
    const vx = cx + Math.sin(a) * vh.dist;
    const vz = cz - Math.cos(a) * vh.dist;
    const yaw = -vh.yawDeg * Math.PI / 180;
    // Concrete foundation slab (extends down by skirt so slopes never expose a gap).
    const slabH = skirt + 0.2;
    b.addBox(vx, baseY + 0.2 - slabH / 2, vz, vh.width + 0.35, slabH, vh.depth + 0.35, yaw, CONCRETE_COLOR);
    // Painted steel walls matching the standpipe.
    b.addBox(vx, baseY + 0.2 + vh.height / 2, vz, vh.width, vh.height, vh.depth, yaw, t.color);
    // White roof fascia & flat roof cap.
    b.addBox(vx, baseY + 0.2 + vh.height + 0.16, vz, vh.width + 0.3, 0.32, vh.depth + 0.3, yaw, WHITE_TRIM);
    // Dark utility steel door on the outward face (no lettering or numbers).
    if (!low) {
      const doorOff = vh.depth / 2 + 0.04;
      const dx = Math.sin(yaw) * doorOff, dz = Math.cos(yaw) * doorOff;
      b.addBox(vx + dx, baseY + 0.2 + 1.05, vz + dz, 1.05, 2.1, 0.08, yaw, DOOR_COLOR);
    }
  }
}

/**
 * Pure geometry builder: turns a list of WaterTowerSpec records into one merged BufferGeometry
 * (position, normal, vertex color) and matching collision solids. Exported for Node checks.
 */
export function buildWaterTowers(
  specs: readonly WaterTowerSpec[],
  village: readonly [number, number],
  exag: number,
  sea: number,
  low: boolean,
): { geometry: THREE.BufferGeometry; solids: Solid[]; lights: number } {
  const builder = createMeshBuilder();
  const solids: Solid[] = [];
  const [VE, VN] = village;
  let lights = 0;

  const skirt = foundationSkirt(exag);
  for (const t of specs) {
    const cx = t.e - VE;
    const cz = VN - t.n;
    const baseY = waterTowerGround(t.g, exag, sea);
    appendStructure(builder, t, cx, baseY, cz, skirt, low);
    const half = t.diameter / 2 + 0.15;
    solids.push({ x: cx, z: cz, half, halfWidth: half, heading: 0 });
    if (t.valveHouse) {
      const vh = t.valveHouse;
      const a = vh.azDeg * Math.PI / 180;
      const yaw = -vh.yawDeg * Math.PI / 180;
      // Match addBox axes in pushOut (which places `half` along (sin(heading), -cos(heading)) and uses `half` for broadphase).
      // addBox local +X (width) is (cos(yaw), -sin(yaw)) -> heading = PI/2 - yaw; local +Z (depth) is (sin(yaw), cos(yaw)) -> heading = PI - yaw.
      const wide = vh.width >= vh.depth;
      solids.push({
        x: cx + Math.sin(a) * vh.dist,
        z: cz - Math.cos(a) * vh.dist,
        half: (wide ? vh.width : vh.depth) / 2 + 0.15,
        halfWidth: (wide ? vh.depth : vh.width) / 2 + 0.15,
        heading: wide ? Math.PI / 2 - yaw : Math.PI - yaw,
      });
    }
    if (t.nightLight) lights++;
  }

  return { geometry: builder.build(), solids, lights };
}

/**
 * Standing water towers, standpipes, reservoirs and small vertical tanks.
 * One merged vertex-coloured Lambert mesh per area with standing structures:
 * +1 draw call, +1 geometry, +0 textures, +0 shader programs (shares the buildings Lambert program).
 */
export class WaterTowers {
  readonly group = new THREE.Group();
  readonly solids: Solid[];
  readonly specs: readonly WaterTowerSpec[];
  readonly area: string;
  readonly excludesCanopy: (east: number, north: number) => boolean;
  private readonly mesh: THREE.Mesh;

  private constructor(
    area: string,
    specs: readonly WaterTowerSpec[],
    village: readonly [number, number],
    exag: number,
    sea: number,
    low: boolean,
  ) {
    this.area = area;
    this.specs = specs;
    this.group.name = 'water towers';
    const { geometry, solids } = buildWaterTowers(specs, village, exag, sea, low);
    this.solids = solids;
    this.excludesCanopy = (e: number, n: number) => waterTowerCanopyExcludes(e, n, area);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'water-towers-merged';
    this.group.add(this.mesh);
  }

  static forArea(
    area: string,
    village: readonly [number, number],
    exag: number,
    sea: number,
    low: boolean,
  ): WaterTowers | null {
    const specs = waterTowersForArea(area);
    if (!specs.length) return null;
    return new WaterTowers(area, specs, village, exag, sea, low);
  }

  resolveSolids(body: Pushable): void {
    // Pass coupled=true so pushOut's broadphase reach covers rotated rectangular valve-house corners.
    pushOut(body, this.solids, true);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
