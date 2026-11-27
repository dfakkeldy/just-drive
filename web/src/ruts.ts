import * as THREE from 'three';
import { buildingSites, type Building } from './buildings';
import type { Surface, Terrain } from './terrain';
import type { Vehicle } from './vehicle';
interface House { id: number; x: number; z: number }
export const MOWN_LAWN = 12;
export const LAWN_REACH = 35;
export const MOWN_LAWN_REACH = 60;
/** House search radius (metres) for a lawn sample: ordinary grass stays at 35 m, hand-built mown lawns reach 60 m. */
export const lawnReach = (kind?: number): number => kind === MOWN_LAWN ? MOWN_LAWN_REACH : LAWN_REACH;
/** True when this ground sample is grass that counts as a lawn: ordinary off-road grass or a hand-built mown lawn. */
export function isLawnSurface(
  s: Pick<Surface, 'level' | 'canopy' | 'roadDist' | 'halfWidth' | 'kind' | 'deck' | 'water' | 'mineral' | 'lotAsphalt'>,
  pavedLot = false,
  roadMargin = .6,
): boolean {
  if (s.level < 6 || s.canopy >= 1.6 || s.deck || s.water || s.mineral || s.lotAsphalt || pavedLot) return false;
  return s.kind === MOWN_LAWN || s.roadDist > s.halfWidth + roadMargin;
}
/** True when terrain at (x, z) is lawn grass (paved and gravel lot exclusions apply before kind 12). */
export function isTerrainLawn(
  terrain: Pick<Terrain, 'paved'>,
  s: Pick<Surface, 'level' | 'canopy' | 'roadDist' | 'halfWidth' | 'kind' | 'deck' | 'water' | 'mineral' | 'lotAsphalt'> | null,
  x: number,
  z: number,
  roadMargin = .6,
): boolean {
  if (!s) return false;
  return isLawnSurface(s, (terrain.paved?.lotClassAt?.(x, z) ?? 0) !== 0, roadMargin);
}
/** One bounded draw call. House queries use a fixed 64 m grid. */
export class Ruts {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  get lawns(): number { return this.damaged.size; }
  private cursor = 0;
  private readonly damaged = new Set<number>();
  private readonly dummy = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly cells = new Map<number, House[]>();
  private oldX = NaN; private oldZ = NaN;
  private distance = 0; private property = -1; private began = 0; private spacing = 0;
  constructor(private readonly terrain: Terrain, buildings: Building[], village: [number, number], low: boolean,
    private readonly damage: (id: number, x: number, z: number, at: number) => void) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(.24, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x32291c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), low ? 320 : 960);
    this.mesh.name = 'Two tyre ruts per lawn crossing'; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One property for each building, also when it is drawn from wings: a lawn has one owner and one complaint.
    for (const b of buildingSites(buildings)) if (b.kind === 'house') {
      const p = { id: b.id, x: b.x - village[0], z: village[1] - b.y }, key = Math.floor(p.x / 64) * 65536 + Math.floor(p.z / 64);
      const cell = this.cells.get(key); if (cell) cell.push(p); else this.cells.set(key, [p]);
    }
    this.reset();
  }
  reset(): void {
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true; this.oldX = this.oldZ = NaN;
    this.damaged.clear();
    this.property = -1; this.distance = this.spacing = this.cursor = this.count = 0;
  }
  update(v: Vehicle, at: number): void {
    if (v.spec?.locomotion === 'horse') return;
    const travel = Math.hypot(v.x - this.oldX, v.z - this.oldZ);
    this.oldX = v.x; this.oldZ = v.z;
    const s = this.terrain.surfaceAt(v.x, v.z,v.y);
    let house: House | undefined, best = Infinity;
    const limit = lawnReach(s?.kind) ** 2;
    if (!v.airborne && Math.hypot(v.vx, v.vz) > 1.4 && travel < 5 && isTerrainLawn(this.terrain, s, v.x, v.z)) {
      const cx = Math.floor(v.x / 64), cz = Math.floor(v.z / 64);
      for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) {
        const cell = this.cells.get(x * 65536 + z); if (!cell) continue;
        for (const h of cell) { const d = (h.x - v.x) ** 2 + (h.z - v.z) ** 2; if (d <= limit && d < best) { best = d; house = h; } }
      }
    }
    if (!house) { this.property = -1; this.distance = this.spacing = 0; return; }
    const rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    const ux = Math.sin(v.heading), uz = -Math.cos(v.heading);
    const lawnPoint = (px: number, pz: number) => isTerrainLawn(this.terrain, this.terrain.surfaceAt(px, pz, v.y), px, pz);
    // Projected XZ half-width of a 0.24 m strip at (px, pz) after terrain roll.
    const rolledHalfWidth = (px: number, pz: number): number => {
      const y = this.terrain.heightAt(px, pz, v.y);
      if (y === null) return .12;
      const l = this.terrain.heightAt(px - rx * .12, pz - rz * .12, v.y) ?? y;
      const r = this.terrain.heightAt(px + rx * .12, pz + rz * .12, v.y) ?? y;
      return .12 / Math.hypot(1, (r - l) / .24);
    };
    const wheelOnLawn = (side: -1 | 1) => {
      const wx = v.x + rx * .785 * side, wz = v.z + rz * .785 * side;
      const hw = rolledHalfWidth(wx, wz);
      return lawnPoint(wx, wz) && lawnPoint(wx - rx * hw, wz - rz * hw) && lawnPoint(wx + rx * hw, wz + rz * hw);
    };
    const leftOn = wheelOnLawn(-1), rightOn = leftOn ? undefined : wheelOnLawn(1);
    if (!leftOn && !rightOn) { this.property = -1; this.distance = this.spacing = 0; return; }
    if (house.id !== this.property) { this.property = house.id; this.distance = 0; this.began = at; }
    this.distance += travel; this.spacing += travel;
    if (this.distance > 3 && !this.damaged.has(house.id)) {
      this.damaged.add(house.id); this.damage(house.id, v.x, v.z, this.began);
    }
    if (this.spacing < .65) return;
    const length = Math.min(2, this.spacing + .15); this.spacing = 0;
    const m = this.terrain.manifest;
    const ox = m ? m.origin[0] - m.village[0] : 0, oz = m ? m.village[1] - m.origin[1] : 0;
    const lotGrid = this.terrain.paved?.lotGrid?.() ?? null;
    // Half of the finest terrain texel touching a box aligns with every tile, bilinear-cell, and nearest-texel boundary at all coarser levels.
    const subCellSize = (x0: number, z0: number, x1: number, z1: number): number => {
      if (!m || !s) return 0;
      let maxL = s.level;
      for (const cx of [x0, x1]) for (const cz of [z0, z1]) {
        const ts = this.terrain.surfaceAt(cx, cz, v.y);
        if (ts && ts.level > maxL) maxL = ts.level;
      }
      return m.size / (2 ** maxL * 256) * .5;
    };
    // Grid-aligned blockers constant across each hm x hm sub-cell. Road/gravel/concrete distance boundaries use exact
    // bilinear band clipping, and arbitrary-boundary overlays (water, deck, mineral, lotAsphalt) scan the rendered footprint.
    const isGridSolid = (ts: Surface | null): boolean => !ts || ts.level < 6;
    const isOverlayBlocked = (ts: Surface | null): boolean =>
      !ts || !!ts.deck || !!ts.water || !!ts.mineral || !!ts.lotAsphalt;
    const polyHitBox = (poly0: readonly [number, number][], x0: number, z0: number, x1: number, z1: number): [number, number][] | null => {
      let poly = poly0 as [number, number][];
      for (let edge = 0; edge < 4; edge++) {
        const next: [number, number][] = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const da = edge === 0 ? x0 - a[0] : edge === 1 ? a[0] - x1 : edge === 2 ? z0 - a[1] : a[1] - z1;
          const db = edge === 0 ? x0 - b[0] : edge === 1 ? b[0] - x1 : edge === 2 ? z0 - b[1] : b[1] - z1;
          if (da <= 0) next.push(a);
          if ((da <= 0) !== (db <= 0)) {
            const t = da / (da - db);
            next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        poly = next;
        if (!poly.length) return null;
      }
      let area = 0;
      for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
      return Math.abs(area) * .5 > 1e-12 ? poly : null;
    };
    const pointInPoly = (poly: readonly [number, number][], px: number, pz: number): boolean => {
      let pos = 0, neg = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const cr = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
        if (cr > 1e-12) pos++; else if (cr < -1e-12) neg++;
      }
      return !(pos && neg);
    };
    const corner = new THREE.Vector3();
    let drew = false;
    for (let side = -1; side <= 1; side += 2) {
      const wx = v.x + rx * .785 * side, wz = v.z + rz * .785 * side;
      let clipSawOverlay = false;
      const sliceLawn = (along: number) => {
        const px = wx + ux * along, pz = wz + uz * along, hw = rolledHalfWidth(px, pz);
        for (const off of [0, -hw, hw]) {
          const sx = px + rx * off, sz = pz + rz * off;
          if (!lawnPoint(sx, sz)) {
            if (isOverlayBlocked(this.terrain.surfaceAt(sx, sz, v.y))) clipSawOverlay = true;
            return false;
          }
        }
        return true;
      };
      if (!(side < 0 ? leftOn : (rightOn ?? sliceLawn(0)))) continue;
      const half = length / 2, rollHw = rolledHalfWidth(wx, wz) + 2e-3;
      const clipBox = (x0: number, z0: number, x1: number, z1: number, dx: number, dz: number): [number, number] | null => {
        let poly: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        for (const signA of [1, -1] as const) {
          const next: [number, number][] = [];
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const da = signA * ((a[0] - wx) * rx + (a[1] - wz) * rz) - rollHw;
            const db = signA * ((b[0] - wx) * rx + (b[1] - wz) * rz) - rollHw;
            if (da <= 0) next.push(a);
            if ((da <= 0) !== (db <= 0)) {
              const t = da / (da - db);
              next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
          }
          poly = next;
          if (!poly.length) return null;
        }
        let loA = Infinity, hiA = -Infinity;
        for (const [px, pz] of poly) {
          const a = (px - wx) * dx + (pz - wz) * dz;
          if (a < loA) loA = a;
          if (a > hiA) hiA = a;
        }
        return [loA, hiA];
      };
      const clipEnd = (sign: -1 | 1): number => {
        const dx = sign * ux, dz = sign * uz;
        let limit = half;
        const padX = Math.abs(rx) * .122, padZ = Math.abs(rz) * .122;
        const minX = Math.min(wx, wx + dx * half) - padX, maxX = Math.max(wx, wx + dx * half) + padX;
        const minZ = Math.min(wz, wz + dz * half) - padZ, maxZ = Math.max(wz, wz + dz * half) + padZ;
        if (lotGrid) {
          // Exact strip-slab vs paved-atlas 2 m cell intersection on the lot grid's own cell boundaries.
          const st = lotGrid.step;
          const px0 = Math.floor((minX - lotGrid.ox) / st), px1 = Math.floor((maxX - lotGrid.ox) / st);
          const pz0 = Math.floor((minZ - lotGrid.oz) / st), pz1 = Math.floor((maxZ - lotGrid.oz) / st);
          for (let px = px0; px <= px1; px++) for (let pz = pz0; pz <= pz1; pz++) {
            const x0 = lotGrid.ox + px * st, z0 = lotGrid.oz + pz * st;
            if ((this.terrain.paved!.lotClassAt(x0 + st * .5, z0 + st * .5)) === 0) continue;
            const span = clipBox(x0, z0, x0 + st, z0 + st, dx, dz);
            if (span && span[1] >= -1e-4 && span[0] < limit) limit = Math.max(0, span[0] - 2e-3);
          }
        }
        let prev = 0;
        for (let t = .16; t < limit; t += .16) {
          if (sliceLawn(sign * t)) prev = t;
          else {
            let a = prev, b = t;
            for (let k = 0; k < 8; k++) { const c = (a + b) / 2; if (sliceLawn(sign * c)) a = c; else b = c; }
            return sign * Math.max(0, a - 1e-3);
          }
        }
        if (limit > 0 && !sliceLawn(sign * limit)) {
          let a = prev, b = limit;
          for (let k = 0; k < 8; k++) { const c = (a + b) / 2; if (sliceLawn(sign * c)) a = c; else b = c; }
          return sign * Math.max(0, a - 1e-3);
        }
        return sign * limit;
      };
      let lo = clipEnd(-1), hi = clipEnd(1), ok = false, endTrimmedNeg = false, endTrimmedPos = false;
      // Place and recheck the actual pitched/rolled XZ footprint against terrain sub-cells and paved lot cells.
      for (let iter = 0; iter < 5; iter++) {
        const clipped = hi - lo;
        if (clipped < .05) break;
        const mid = (lo + hi) / 2, x = wx + ux * mid, z = wz + uz * mid;
        const y = this.terrain.heightAt(x, z,v.y); if (y === null) break;
        const fx = ux * clipped / 2, fz = uz * clipped / 2;
        const front = this.terrain.heightAt(x + fx, z + fz,v.y) ?? y, back = this.terrain.heightAt(x - fx, z - fz,v.y) ?? y;
        const left = this.terrain.heightAt(x - rx * .12, z - rz * .12,v.y) ?? y;
        const right = this.terrain.heightAt(x + rx * .12, z + rz * .12,v.y) ?? y;
        this.dummy.position.set(x, y + .045, z);
        this.dummy.rotation.set(Math.atan2(front - back, clipped), -v.heading, Math.atan2(right - left, .24), 'YXZ');
        this.dummy.scale.set(1, 1, clipped); this.dummy.updateMatrix();
        if ((!m || !s) && !lotGrid) { ok = true; break; }
        // Pad the rendered XZ quad by 1.5 mm on all sides so Float32 quantization in InstancedMesh.setMatrixAt
        // cannot push any point of the stored strip across a discrete texel, lot cell, canopy, or road-shoulder boundary.
        const pad = 1.5e-3, lp = pad / clipped;
        const quad: [number, number][] = [[-.12 - pad, -.5 - lp], [.12 + pad, -.5 - lp], [.12 + pad, .5 + lp], [-.12 - pad, .5 + lp]].map(([lx, lz]) => {
          corner.set(lx, 0, lz).applyMatrix4(this.dummy.matrix); return [corner.x, corner.z];
        });
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [qx, qz] of quad) {
          if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
          if (qz < minZ) minZ = qz; if (qz > maxZ) maxZ = qz;
        }
        let nextLo = lo, nextHi = hi, hit = false;
        const trim = (poly: [number, number][]) => {
          hit = true;
          let pLo = Infinity, pHi = -Infinity;
          for (const [px, pz] of poly) { const a = (px - wx) * ux + (pz - wz) * uz; if (a < pLo) pLo = a; if (a > pHi) pHi = a; }
          if (pLo > 0) nextHi = Math.min(nextHi, Math.max(0, Math.min(hi - 4e-3, pLo - 2e-3)));
          else if (pHi < 0) nextLo = Math.max(nextLo, Math.min(0, Math.max(lo + 4e-3, pHi + 2e-3)));
          else { nextLo = 0; nextHi = 0; }
        };
        // Exact analytical intersection of poly with the bilinear band loVal <= d(x, z) <= hiVal inside one aligned sub-cell.
        const checkBilinearBand = (
          poly: [number, number][],
          gx: number, gz: number, cw: number, ch: number,
          d00: number, d10: number, d01: number, d11: number,
          loVal: number, hiVal: number,
        ) => {
          if (Math.max(d00, d10, d01, d11) < loVal || Math.min(d00, d10, d01, d11) > hiVal) return;
          const c0 = d00, c1 = d10 - d00, c2 = d01 - d00, c3 = d00 - d10 - d01 + d11;
          const evalD = (px: number, pz: number) => {
            const u = (px - gx) / cw, v = (pz - gz) / ch;
            return c0 + c1 * u + c2 * v + c3 * u * v;
          };
          const inBand = (val: number) => val >= loVal && val <= hiVal;
          const bad: [number, number][] = [];
          const levels: number[] = [];
          if (Number.isFinite(loVal)) levels.push(loVal);
          if (Number.isFinite(hiVal) && hiVal !== loVal) levels.push(hiVal);
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const f0 = evalD(a[0], a[1]), f1 = evalD(b[0], b[1]);
            const fm = evalD((a[0] + b[0]) * .5, (a[1] + b[1]) * .5);
            if (inBand(f0)) bad.push(a);
            const A = 2 * (f0 - 2 * fm + f1), B = -3 * f0 + 4 * fm - f1;
            const pushT = (t: number) => { if (t > 0 && t < 1) bad.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); };
            if (Math.abs(A) > 1e-12) {
              const tm = -B / (2 * A);
              if (tm > 0 && tm < 1 && inBand((A * tm + B) * tm + f0)) pushT(tm);
            }
            for (const thr of levels) {
              const C = f0 - thr;
              if (Math.abs(A) > 1e-12) {
                const disc = B * B - 4 * A * C;
                if (disc >= 0) { const sq = Math.sqrt(disc); pushT((-B - sq) / (2 * A)); pushT((-B + sq) / (2 * A)); }
              } else if (Math.abs(B) > 1e-12) pushT(-C / B);
            }
          }
          if (Math.abs(c3) > 1e-12) {
            const au = ux * cw, av = uz * ch;
            const testUV = (u: number, v: number) => {
              if (u > 0 && u < 1 && v > 0 && v < 1) {
                const px = gx + u * cw, pz = gz + v * ch;
                if (pointInPoly(poly, px, pz)) bad.push([px, pz]);
              }
            };
            for (const thr of levels) {
              const c0t = c0 - thr;
              if (Math.abs(au) >= Math.abs(av)) {
                const p = (c1 * av - c2 * au) / (c3 * au), q = av / au;
                const A = c3 * q, B = c1 * q + c2 + c3 * p, C = c0t + c1 * p, disc = B * B - 4 * A * C;
                if (Math.abs(A) > 1e-12 && disc >= 0) {
                  const sq = Math.sqrt(disc);
                  for (const vv of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) testUV(p + q * vv, vv);
                } else if (Math.abs(B) > 1e-12) { const vv = -C / B; testUV(p + q * vv, vv); }
              } else {
                const p = (c2 * au - c1 * av) / (c3 * av), q = au / av;
                const A = c3 * q, B = c2 * q + c1 + c3 * p, C = c0t + c2 * p, disc = B * B - 4 * A * C;
                if (Math.abs(A) > 1e-12 && disc >= 0) {
                  const sq = Math.sqrt(disc);
                  for (const uu of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) testUV(uu, p + q * uu);
                } else if (Math.abs(B) > 1e-12) { const uu = -C / B; testUV(uu, p + q * uu); }
              }
            }
          }
          if (bad.length) trim(bad);
        };
        const hm = subCellSize(minX, minZ, maxX, maxZ);
        const hasSites = Array.isArray(this.terrain.sites);
        const overlaySites = hasSites
          ? this.terrain.sites.filter((st) => (st.waterLevel || st.deckHeight || st.deckContactHeight)
            && maxX >= st.box[0] && minX <= st.box[2] && maxZ >= st.box[1] && minZ <= st.box[3])
          : [];
        const quarryNear = !!(this.terrain.coast?.quarry && this.terrain.coast.contains(x, z));
        let subCellOverlay = clipSawOverlay, minGround = Infinity;
        if (hm > 0) {
          const qx0 = Math.floor((minX - ox) / hm), qx1 = Math.floor((maxX - ox) / hm);
          const qz0 = Math.floor((minZ - oz) / hm), qz1 = Math.floor((maxZ - oz) / hm);
          const eps = hm * 1e-6;
          for (let qx = qx0; qx <= qx1; qx++) for (let qz = qz0; qz <= qz1; qz++) {
            const xq = ox + qx * hm, zq = oz + qz * hm;
            const poly = polyHitBox(quad, xq, zq, xq + hm, zq + hm);
            if (!poly) continue;
            const cs = this.terrain.surfaceAt(xq + hm * .5, zq + hm * .5, v.y);
            if (isGridSolid(cs)) { trim(poly); continue; }
            const s00 = this.terrain.surfaceAt(xq + eps, zq + eps, v.y);
            const s10 = this.terrain.surfaceAt(xq + hm - eps, zq + eps, v.y);
            const s01 = this.terrain.surfaceAt(xq + eps, zq + hm - eps, v.y);
            const s11 = this.terrain.surfaceAt(xq + hm - eps, zq + hm - eps, v.y);
            if (isGridSolid(s00) || isGridSolid(s10) || isGridSolid(s01) || isGridSolid(s11)) { trim(poly); continue; }
            minGround = Math.min(minGround, cs!.ground, s00!.ground, s10!.ground, s01!.ground, s11!.ground);
            const anyDeck = !!(cs!.deck || s00!.deck || s10!.deck || s01!.deck || s11!.deck);
            if (anyDeck || isOverlayBlocked(cs) || isOverlayBlocked(s00) || isOverlayBlocked(s10) || isOverlayBlocked(s01) || isOverlayBlocked(s11)) subCellOverlay = true;
            if (!anyDeck) {
              checkBilinearBand(poly, xq, zq, hm, hm, s00!.canopy, s10!.canopy, s01!.canopy, s11!.canopy, 1.5999, Infinity);
              if (cs!.kind > 0 && cs!.kind !== MOWN_LAWN) {
                const lim = cs!.halfWidth + .6001;
                const rd = (ts: Surface) => ts.roadSigned ?? ts.roadDist;
                checkBilinearBand(poly, xq, zq, hm, hm, rd(s00!), rd(s10!), rd(s01!), rd(s11!), -lim, lim);
              }
            }
          }
        }
        if (!hasSites || subCellOverlay || quarryNear || overlaySites.length > 0) {
          // Outward perimeter + coarse-interior gate on the exact Float32-quantized rendered strip (7.5 mm long & short
          // edges, 60 mm x 60 mm interior lines catching >= 5 cm radius patches, 2 mm short end after a short-end trim),
          // followed by binary search on [lz0, hitLz] trimming back to the verified-dry slice so one pass converges.
          const fastSiteOnly = hasSites && !subCellOverlay && !quarryNear && overlaySites.every((st) => !st.deckHeight);
          const exag = this.terrain.exag ?? 1, seaLevel = this.terrain.seaLevel ?? 0;
          const me = this.dummy.matrix.elements;
          const e0 = Math.fround(me[0]), e2 = Math.fround(me[2]), e8 = Math.fround(me[8]);
          const e10 = Math.fround(me[10]), e12 = Math.fround(me[12]), e14 = Math.fround(me[14]);
          const probe = (lx: number, lz: number): [number, number] | null => {
            const px = e0 * lx + e8 * lz + e12, pz = e2 * lx + e10 * lz + e14;
            if (fastSiteOnly) {
              let mayHit = false;
              for (let i = 0; i < overlaySites.length; i++) {
                const st = overlaySites[i];
                if (px < st.box[0] || px > st.box[2] || pz < st.box[1] || pz > st.box[3]) continue;
                const rawW = st.waterLevel?.(px, pz);
                if (rawW != null) {
                  const maxWet = seaLevel + (rawW - seaLevel) * exag + .6 * exag + 1e-6;
                  if (minGround <= maxWet) {
                    const g = this.terrain.heightAt(px, pz, v.y);
                    if (g === null || g <= maxWet) { mayHit = true; break; }
                  }
                }
                if (st.deckContactHeight?.(px, pz, v.y) != null) { mayHit = true; break; }
              }
              if (!mayHit) return null;
            }
            return lawnPoint(px, pz) ? null : [px, pz];
          };
          const lz0 = Math.max(-.5, Math.min(.5, mid / clipped));
          const spanW = .24;
          const fineW = Math.max(16, Math.ceil(spanW / 2e-3));
          const endW = Math.max(16, Math.ceil(spanW / 7.5e-3));
          const scanHalf = (targetLz: number, skipZero: boolean, isPosHalf: boolean) => {
            const distM = Math.abs(targetLz - lz0) * clipped;
            const edgeL = Math.max(1, Math.ceil(distM / 7.5e-3));
            const endFine = isPosHalf ? endTrimmedPos : endTrimmedNeg;
            const halfEndW = endFine ? fineW : endW;
            let hitLz = NaN, hitLx = 0, hitPt: [number, number] | null = null;
            for (let j = skipZero ? 1 : 0; j <= edgeL; j++) {
              const lz = lz0 + (targetLz - lz0) * (j / edgeL);
              const lHit = probe(-.12, lz);
              if (lHit) { hitLz = lz; hitLx = -.12; hitPt = lHit; break; }
              const rHit = probe(.12, lz);
              if (rHit) { hitLz = lz; hitLx = .12; hitPt = rHit; break; }
              if (j % 8 === 0 && j < edgeL) {
                for (const ix of [-.06, 0, .06]) {
                  const iHit = probe(ix, lz);
                  if (iHit) { hitLz = lz; hitLx = ix; hitPt = iHit; break; }
                }
                if (hitPt) break;
              }
            }
            if (!hitPt) {
              for (let k = 1; k < halfEndW; k++) {
                const lx = -.12 + spanW * (k / halfEndW);
                const p = probe(lx, targetLz);
                if (p) {
                  hitLz = targetLz; hitLx = lx; hitPt = p;
                  if (isPosHalf) endTrimmedPos = true; else endTrimmedNeg = true;
                  break;
                }
              }
            }
            if (!hitPt) return;
            // Refine the first blocked slice inside [lz0, hitLz] by binary search (9 steps -> <1 mm precision),
            // testing bestLx first, then endW, then a 1 mm local scan around bestLx so narrow slanted tips clear on iter 0.
            let a = lz0, b = hitLz, bestLx = hitLx;
            const localFineW = Math.max(16, Math.ceil(spanW / 1e-3));
            for (let bi = 0; bi < 9; bi++) {
              const c = (a + b) * .5;
              let found = probe(bestLx, c) !== null;
              if (!found) {
                for (let k = 0; k <= endW; k++) {
                  const lx = -.12 + spanW * (k / endW);
                  if (probe(lx, c)) { bestLx = lx; found = true; break; }
                }
              }
              if (!found) {
                const loK = Math.max(0, Math.floor((bestLx - .032 + .12) / spanW * localFineW));
                const hiK = Math.min(localFineW, Math.ceil((bestLx + .032 + .12) / spanW * localFineW));
                for (let k = loK; k <= hiK; k++) {
                  const lx = -.12 + spanW * (k / localFineW);
                  if (probe(lx, c)) { bestLx = lx; found = true; break; }
                }
              }
              if (found) b = c; else a = c;
            }
            hit = true;
            const a1 = (e0 * -.12 + e8 * a + e12 - wx) * ux + (e2 * -.12 + e10 * a + e14 - wz) * uz;
            const a2 = (e0 * .12 + e8 * a + e12 - wx) * ux + (e2 * .12 + e10 * a + e14 - wz) * uz;
            const hitAlong = (hitPt[0] - wx) * ux + (hitPt[1] - wz) * uz;
            if (hitAlong > 0) nextHi = Math.min(nextHi, Math.max(0, Math.min(hi - 4e-3, Math.min(a1, a2) - 1.5e-3)));
            else if (hitAlong < 0) nextLo = Math.max(nextLo, Math.min(0, Math.max(lo + 4e-3, Math.max(a1, a2) + 1.5e-3)));
            else { nextLo = 0; nextHi = 0; }
          };
          scanHalf(-.5, false, false);
          scanHalf(.5, true, true);
        }
        if (lotGrid) {
          const st = lotGrid.step;
          const px0 = Math.floor((minX - lotGrid.ox) / st), px1 = Math.floor((maxX - lotGrid.ox) / st);
          const pz0 = Math.floor((minZ - lotGrid.oz) / st), pz1 = Math.floor((maxZ - lotGrid.oz) / st);
          for (let px = px0; px <= px1; px++) for (let pz = pz0; pz <= pz1; pz++) {
            const x0 = lotGrid.ox + px * st, z0 = lotGrid.oz + pz * st;
            if ((this.terrain.paved!.lotClassAt(x0 + st * .5, z0 + st * .5)) === 0) continue;
            const poly = polyHitBox(quad, x0, z0, x0 + st, z0 + st);
            if (poly) trim(poly);
          }
        }
        if (!hit) { ok = true; break; }
        if (nextLo === lo && nextHi === hi) break;
        lo = nextLo; hi = nextHi;
      }
      if (!ok) continue;
      this.mesh.setMatrixAt(this.cursor, this.dummy.matrix); this.cursor = (this.cursor + 1) % this.mesh.count; this.count++;
      drew = true;
    }
    if (drew) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
