/** The owner's hand-built church, ported from his own model. No scan transforms or image pixels. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';
import { pushOut, type Pushable } from './parked';
import { CHURCH_GEOM, CHURCH_FEATURES, CHURCH_SCALE, type ChurchSite } from './church-site';

type Opening = typeof CHURCH_FEATURES.openings[number];
type Point = [number, number];
interface AddOptions { cast?: boolean; receive?: boolean; ry?: number; parent?: THREE.Group }
const COL = {
  wall: 0xf7f7f3, trim: 0xffffff, roof: 0x343d40, cap: 0x1f2526, dome: 0x1b2022,
  glass: 0x34444c, steps: 0x8d3d2b,
  stone: 0x8e8079, rock: 0x8f9396, sign: 0xffffff, door: 0xf7f7f4,
};

// Shingle courses as a repeating texture, one tile = 1 x 1 scene unit.
function shingleTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("Church texture needs a canvas context");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 128);
  const rows = 4, h = 128 / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = "rgba(60,70,75,0.10)"; g.fillRect(0, r * h + h - 3, 128, 3);       // course shadow line
    const off = (r % 2) * 16;
    for (let x = -off; x < 128; x += 32) { g.fillStyle = "rgba(60,70,75,0.05)"; g.fillRect(x, r * h, 2, h); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function signTexture() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 220;
  const g = c.getContext("2d");
  if (!g) throw new Error("Church texture needs a canvas context");
  g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, 512, 220);
  g.strokeStyle = "#22282b"; g.lineWidth = 14; g.strokeRect(10, 10, 492, 200);
  g.fillStyle = "#2a3134";                 // lettering shown as bars: the real text isn't legible in the footage
  for (const [y, w] of [[62, 360], [104, 300], [146, 220]]) g.fillRect(256 - w / 2, y, w, 18);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildChurchModel(ground: (x: number, z: number) => number = () => 0) {
  const geom = CHURCH_GEOM, features = CHURCH_FEATURES;
  const { nave: n, tower: t, cupola: c, vestry: v } = geom;
  const zN = -n.zn, zS = n.zs, zM = (zN + zS) / 2;
  const T = 0.25;                               // wall thickness
  const group = new THREE.Group(); group.name = "church-model";

  const shingle = shingleTexture();
  const mat = {
    wall: new THREE.MeshLambertMaterial({ color: COL.wall, map: shingle }),
    trim: new THREE.MeshLambertMaterial({ color: COL.trim }),
    roof: new THREE.MeshLambertMaterial({ color: COL.roof }),
    cap: new THREE.MeshLambertMaterial({ color: COL.cap }),
    dome: new THREE.MeshLambertMaterial({ color: COL.dome }),
    glass: new THREE.MeshLambertMaterial({ color: COL.glass, side: THREE.DoubleSide }),
    darkGlass: new THREE.MeshLambertMaterial({ color: 0x2c383d }),
    steps: new THREE.MeshLambertMaterial({ color: COL.steps }),
    stone: new THREE.MeshLambertMaterial({ color: COL.stone }),
    rock: new THREE.MeshLambertMaterial({ color: COL.rock }),
    sign: new THREE.MeshLambertMaterial({ map: signTexture() }),
    door: new THREE.MeshLambertMaterial({ color: COL.door }),
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.MeshLambertMaterial, x = 0, y = 0, z = 0, opts: AddOptions = {}) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = opts.receive ?? true;
    if (opts.ry) mesh.rotation.y = opts.ry;
    (opts.parent || group).add(mesh); return mesh;
  };
  const box = (sx: number, sy: number, sz: number, m: THREE.MeshLambertMaterial, x: number, y: number, z: number, opts: AddOptions = {}) => add(new THREE.BoxGeometry(sx, sy, sz), m, x, y, z, opts);
  // Shingled boxes: scale UVs to scene units so the courses keep their real size on every face.
  const shingledBox = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];   // +x -x +y -y +z -z
    for (let i = 0; i < uv.count; i++) { const [du, dv] = dims[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv); }
    return add(g, mat.wall, x, y, z);
  };

  const openingsOn = (face: Opening['face']) => features.openings.filter(o => o.face === face);
  const archPath = (o: Opening, flip = 1) => {               // opening outline in face coordinates (u, y)
    const p = new THREE.Path(), r = o.w / 2, u = o.u * flip;
    p.moveTo(u - r, o.y0); p.lineTo(u + r, o.y0);
    if (o.kind === "arch") { p.lineTo(u + r, o.y1); p.absarc(u, o.y1, r, 0, Math.PI, false); }
    else { p.lineTo(u + r, o.y1); p.lineTo(u - r, o.y1); }
    p.closePath(); return p;
  };
  const archShape = (o: Opening) => {                          // the same outline as a filled shape, centred
    const sh = new THREE.Shape(), r = o.w / 2;
    sh.moveTo(-r, o.y0); sh.lineTo(r, o.y0);
    if (o.kind === "arch") { sh.lineTo(r, o.y1); sh.absarc(0, o.y1, r, 0, Math.PI, false); }
    else { sh.lineTo(r, o.y1); sh.lineTo(-r, o.y1); }
    sh.closePath(); return sh;
  };
  const isHole = (o: Opening) => o.kind === "arch" || o.kind === "rect";

  // Shingled wall shells retain the source's actual openings. Interior lining is omitted.
  function wall(outline: Point[], holes: THREE.Path[], place: (mesh: THREE.Mesh, inset: number) => void) {
    const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
    shape.holes = holes;
    const outer = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false }), mat.wall);
    place(outer, 0); group.add(outer);
  }

  // Long walls: face coordinates u = x.
  // Long walls stop at the inside of the gable walls so the corners don't overlap and flicker.
  const longOutline: Point[] = [[n.x0 + T, 0], [n.x1 - T, 0], [n.x1 - T, n.eave], [n.x0 + T, n.eave]];
  wall(longOutline, openingsOn("nave_s").map(o => archPath(o)), (m, d) => { m.position.z = zS - d; m.scale.z = -1; });
  wall(longOutline, openingsOn("nave_n").map(o => archPath(o)), (m, d) => { m.position.z = zN + d; });

  // Gable ends: face coordinates u = z. The source's west front gets its openings.
  const gable = (flip: number): Point[] => {
    const a = zN, b = zS;
    return [[a * flip, 0], [b * flip, 0], [b * flip, n.eave], [zM * flip, n.ridge], [a * flip, n.eave]];
  };
  wall(gable(1), openingsOn("west").filter(isHole).map(o => archPath(o)), (m, d) => {
    m.rotation.y = -Math.PI / 2; m.position.x = n.x1 - d;      // local +Z -> world -X (inward)
  });
  wall(gable(-1), [], (m, d) => {
    m.rotation.y = Math.PI / 2; m.position.x = n.x0 + d;       // local +Z -> world +X; local x -> world -z
  });

  // Window glass and white frames in each opening, set back into the wall.
  const facePose: Record<Opening['face'], { pos: (u: number, y: number) => THREE.Vector3; ry: number }> = {
    // local +Z points out of the wall; glass sits 0.08 inside the outer face
    nave_s: { pos: (u, y) => new THREE.Vector3(u, y, zS - 0.08), ry: 0 },
    nave_n: { pos: (u, y) => new THREE.Vector3(u, y, zN + 0.08), ry: Math.PI },
    west: { pos: (u, y) => new THREE.Vector3(n.x1 - 0.08, y, u), ry: Math.PI / 2 },
    tower_w: { pos: (u, y) => new THREE.Vector3(t.x1 + 0.02, y, u), ry: Math.PI / 2 },
    tower_n: { pos: (u, y) => new THREE.Vector3(u, y, -t.zn - 0.02), ry: Math.PI },
    tower_s: { pos: (u, y) => new THREE.Vector3(u, y, t.zs + 0.02), ry: 0 },
  };
  for (const o of features.openings) {
    const pose = facePose[o.face]; if (!pose) continue;
    const r = o.w / 2, cy = (o.y0 + o.y1) / 2, onTower = o.face.startsWith("tower");
    const local = new THREE.Group(); local.position.copy(pose.pos(o.u, 0)); local.rotation.y = pose.ry; group.add(local);
    if (o.kind === "sign") {
      add(new THREE.PlaneGeometry(o.w, o.y1 - o.y0), mat.sign, 0, cy, 0.16, { parent: local });
      continue;
    }
    if (o.kind === "door") {
      box(o.w, o.y1 - o.y0, 0.08, mat.door, 0, cy, 0.04, { parent: local });
      for (const yy of [o.y0 + 0.7, o.y0 + 1.9]) box(o.w * 0.7, 0.5, 0.03, mat.trim, 0, yy, 0.1, { parent: local });
      continue;
    }
    // glass
    const glassGeo = new THREE.ShapeGeometry(archShape(o), 16);
    add(glassGeo, onTower ? mat.darkGlass : mat.glass, 0, 0, onTower ? 0.03 : 0, { parent: local, cast: false });
    // frame: sides, sill, head, and muntins
    const fw = 0.09, top = o.kind === "arch" ? o.y1 + r : o.y1;
    box(fw, o.y1 - o.y0, 0.12, mat.trim, -r, (o.y0 + o.y1) / 2, 0.06, { parent: local });   // side posts up to the spring line
    box(fw, o.y1 - o.y0, 0.12, mat.trim, r, (o.y0 + o.y1) / 2, 0.06, { parent: local });
    box(o.w + 0.25, 0.1, 0.18, mat.trim, 0, o.y0 - 0.03, 0.08, { parent: local });
    box(0.05, top - o.y0 - 0.1, 0.06, mat.trim, 0, (o.y0 + top) / 2, 0.04, { parent: local });
    for (let k = 1; k < 4; k++) box(o.w, 0.05, 0.06, mat.trim, 0, o.y0 + (o.y1 - o.y0) * k / 4, 0.04, { parent: local });
    if (o.kind === "arch") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 20, Math.PI), mat.trim);
      ring.position.set(0, o.y1, 0.06); local.add(ring);
    } else {
      box(o.w + 0.2, 0.1, 0.14, mat.trim, 0, o.y1 + 0.03, 0.07, { parent: local });
    }
  }

  // Roof: two slabs with overhang, ridge cap, white fascia and rake boards.
  const over = 0.45, roofT = 0.22;
  const slope = (zEave: number) => {
    const dz = zM - zEave, dy = n.ridge - n.eave, len = Math.hypot(dz, dy) + over;
    const ang = Math.atan2(dy, Math.abs(dz)) * Math.sign(dz);
    const geo = new THREE.BoxGeometry(n.x1 - n.x0 + 2 * over, roofT, len);
    const m = add(geo, mat.roof, 0, 0, 0);
    const mid = new THREE.Vector3((n.x0 + n.x1) / 2, (n.eave + n.ridge) / 2, (zEave + zM) / 2);
    const out = new THREE.Vector3(0, Math.abs(dz), -Math.sign(dz) * dy).normalize();   // outward normal
    const along = new THREE.Vector3(0, -dy, -dz).normalize();                          // down-slope
    m.position.copy(mid).addScaledVector(out, roofT / 2).addScaledVector(along, over / 2);
    m.rotation.x = -ang;
    const fascia = box(n.x1 - n.x0 + 2 * over, 0.28, 0.08, mat.trim, (n.x0 + n.x1) / 2, 0, 0);
    fascia.position.copy(m.position).addScaledVector(along, len / 2).addScaledVector(out, -0.05);
    // Rake boards: white trim along each gable edge of the slab, hanging just below it.
    for (const x of [n.x0 - over + 0.05, n.x1 + over - 0.05]) {   // outer face 1 cm past the slab end
      const rake = box(0.12, 0.32, len, mat.trim, 0, 0, 0);
      rake.rotation.x = -ang;
      rake.position.copy(m.position).addScaledVector(out, -0.06); rake.position.x = x;
    }
  };
  slope(zN); slope(zS);
  box(n.x1 - n.x0 + 2 * over, 0.18, 0.5, mat.cap, (n.x0 + n.x1) / 2, n.ridge + 0.2, zM);
  for (const [x, z] of [[n.x0, zN], [n.x0, zS], [n.x1, zN], [n.x1, zS]]) box(0.32, n.eave, 0.32, mat.trim, x, n.eave / 2, z);

  // Tower: shingled shaft, corner boards, dark cap, cornice band.
  const tx0 = n.x1, tw = t.x1 - tx0, tz = t.zn + t.zs, tzc = (t.zs - t.zn) / 2;
  const towerSide: Point[] = [[tx0, 0], [t.x1, 0], [t.x1, t.top], [tx0, t.top]];
  wall(towerSide, openingsOn('tower_s').map(o => archPath(o)), (m, d) => { m.position.z = t.zs - d; m.scale.z = -1; });
  wall(towerSide, openingsOn('tower_n').map(o => archPath(o)), (m, d) => { m.position.z = -t.zn + d; });
  wall([[-t.zn, 0], [t.zs, 0], [t.zs, t.top], [-t.zn, t.top]], openingsOn('tower_w').map(o => archPath(o)),
    (m, d) => { m.rotation.y = -Math.PI / 2; m.position.x = t.x1 - d; });
  // Close the rear of the shaft above the nave roof, without a coplanar wall over the front gable.
  const roofAt = (z: number) => n.ridge - (n.ridge - n.eave) * Math.abs(z - zM) / (z < zM ? zM - zN : zS - zM);
  wall([[-t.zs, roofAt(t.zs)], [-zM, n.ridge], [t.zn, roofAt(-t.zn)], [t.zn, t.top], [-t.zs, t.top]], [],
    (m, d) => { m.rotation.y = Math.PI / 2; m.position.x = tx0 + d; });
  for (const [x, z] of [[t.x1, -t.zn], [t.x1, t.zs]]) box(0.26, t.top, 0.26, mat.trim, x, t.top / 2, z);
  box(tw + 0.5, 0.4, tz + 0.5, mat.cap, tx0 + tw / 2, c.base - 0.2, tzc);   // cap top meets the drum at c.base
  box(tw + 0.3, 0.22, tz + 0.3, mat.trim, tx0 + tw / 2, t.top - 0.55, tzc);

  // Cupola: white octagonal drum with dark louvres, onion dome, finial and cross.
  const drumH = c.top - c.base;
  const drum = add(new THREE.CylinderGeometry(c.r, c.r * 1.04, drumH, 8), mat.trim, c.x, c.base + drumH / 2, c.z);
  drum.rotation.y = Math.PI / 8;
  for (let i = 0; i < 8; i += 2) {
    const a = i * Math.PI / 4, rr = c.r * 1.03 * Math.cos(Math.PI / 8) + 0.03;   // face centres (corners are at odd multiples of pi/8)
    const l = box(0.45, drumH * 0.6, 0.04, mat.cap, c.x + rr * Math.cos(a), c.base + drumH / 2, c.z + rr * Math.sin(a));
    l.rotation.y = -a + Math.PI / 2;
  }
  const domeBase = c.top;
  const prof = [[c.r * 1.08, 0], [c.r * 1.18, 0.35], [c.r * 1.12, 0.9], [c.r * 0.8, 1.55], [c.r * 0.35, 2.05], [0.08, 2.35], [0, 2.4]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  add(new THREE.LatheGeometry(prof, 32), mat.dome, c.x, domeBase, c.z);
  box(c.r * 2.3, 0.15, c.r * 2.3, mat.trim, c.x, domeBase, c.z);
  add(new THREE.SphereGeometry(0.14, 12, 8), mat.trim, c.x, domeBase + 2.45, c.z);
  box(0.11, 2.4, 0.11, mat.trim, c.x, domeBase + 3.6, c.z);
  box(0.11, 0.11, 1.1, mat.trim, c.x, domeBase + 4.1, c.z);

  // Vestry: small shingled box on the east end with a low gable roof, a window and a back door.
  const vx0 = v.x0, vx1 = n.x0, vzm = (v.z0 + v.z1) / 2, vw = v.z1 - v.z0;
  shingledBox(vx1 - vx0, v.eave, vw, (vx0 + vx1) / 2, v.eave / 2, vzm);
  for (const zE of [v.z0, v.z1]) {
    const dz = vzm - zE, dy = v.ridge - v.eave, len = Math.hypot(dz, dy) + 0.35;
    const ang = Math.atan2(dy, Math.abs(dz)) * Math.sign(dz);
    const b = box(vx1 - vx0 + 0.6, 0.18, len, mat.roof, (vx0 + vx1) / 2 - 0.3, (v.eave + v.ridge) / 2 + 0.1, (zE + vzm) / 2 - Math.sign(dz) * 0.15);
    b.rotation.x = -ang;
  }
  box(0.08, 2.2, 1.0, mat.door, vx0 - 0.04, 1.1 + 0.3, vzm);
  box(1.0, 0.25, 1.6, mat.steps, vx0 - 0.6, 0.15, vzm);
  box(0.9, 0.9, 0.06, mat.darkGlass, (vx0 + vx1) / 2, v.eave * 0.62, v.z1 + 0.03);
  box(1.05, 1.05, 0.04, mat.trim, (vx0 + vx1) / 2, v.eave * 0.62, v.z1 + 0.01);

  // A plain solid base reaches below the lowest sampled land across its footprint.
  // Treads and wall tops stay level; only the hidden bottom follows terrain/exaggeration.
  const groundedBox = (x0: number, x1: number, z0: number, z1: number, top: number, material: THREE.MeshLambertMaterial) => {
    let bottom = 0;
    const nx = Math.ceil((x1 - x0) / 0.5), nz = Math.ceil((z1 - z0) / 0.5);
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
      bottom = Math.min(bottom, ground(x0 + (x1 - x0) * ix / nx, z0 + (z1 - z0) * iz / nz));
    }
    bottom -= 0.2;
    box(x1 - x0, top - bottom, z1 - z0, material, (x0 + x1) / 2, (top + bottom) / 2, (z0 + z1) / 2);
  };

  // Front steps with railings, rising to the tower door.
  const st = features.steps;
  for (let i = 0; i < st.count; i++) {
    const h = st.rise * (i + 1) / st.count, d = st.run * (st.count - i) / st.count;
    if (i === 0) groundedBox(t.x1, t.x1 + d, st.u - st.width / 2, st.u + st.width / 2, h, mat.steps);
    else box(d, h, st.width, mat.steps, t.x1 + d / 2, h / 2, st.u);
  }
  for (const side of [-1, 1]) {
    const z = st.u + side * (st.width / 2 + 0.05);
    for (const k of [0, 1]) box(0.1, 1.1, 0.1, mat.steps, t.x1 + 0.2 + k * (st.run - 0.4), (k ? 0.2 : st.rise) + 0.55, z);
    const rail = box(Math.hypot(st.run, st.rise), 0.08, 0.08, mat.steps, t.x1 + st.run / 2, st.rise / 2 + 1.1, z);
    rail.rotation.z = -Math.atan2(st.rise, st.run);
  }

  // Unmarked stone monument and generic boulders at the source model positions.
  const mon = new THREE.Group(); mon.position.set(20.3, ground(20.3, 1), 1); group.add(mon);
  box(1.4, 0.5, 1.4, mat.stone, 0, 0.25, 0, { parent: mon });
  box(1.0, 0.8, 1.0, mat.stone, 0, 0.9, 0, { parent: mon });
  add(new THREE.CylinderGeometry(0.32, 0.42, 2.6, 4), mat.stone, 0, 2.6, 0, { parent: mon, ry: Math.PI / 4 });
  add(new THREE.ConeGeometry(0.34, 0.5, 4), mat.stone, 0, 4.15, 0, { parent: mon, ry: Math.PI / 4 });
  const BOULDERS = [[4.2, 9.0], [6.7, 9.4], [9.4, 10.2], [13.0, 10.0], [16.1, 10.4], [19.1, 11.4], [24.3, 11.8],
    [28.3, 12.1], [31.6, 12.6], [34.0, 13.0], [37.7, 13.8],
    [8.8, 27.8], [14.1, 26.2], [17.4, 25.6], [22.8, 24.3], [25.4, 23.2], [28.5, 22.5], [31.5, 21.8], [34.5, 20.4], [37.4, 19.2]];
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [x, z] of BOULDERS) {
    const r = add(rockGeo, mat.rock, x, ground(x, z) + 0.2, z, { ry: rnd() * Math.PI });
    r.scale.set(1.1 + rnd() * 0.5, 0.75 + rnd() * 0.3, 0.9 + rnd() * 0.4); r.rotation.x = (rnd() - 0.5) * 0.4;
  }

  // Plain foundation skirts cover all three volumes, including the tower, down to sampled land.
  for (const [x0, x1, z0, z1] of [[n.x0, n.x1, zN, zS], [n.x1, t.x1, -t.zn, t.zs], [v.x0, n.x0, v.z0, v.z1]]) {
    groundedBox(x0 - 0.03, x1 + 0.03, z0 - 0.03, z1 + 0.03, 0.1, mat.stone);
  }
  return mergeChurch(group);
}

/** Bake all static transforms and merge compatible materials. Colour differences become vertex colours.
 * The only three draw groups are untextured paint, shingle courses, and the sign's plain bars. */
function mergeChurch(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  const buckets = new Map<THREE.Texture | null, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.MeshLambertMaterial;
    originals.add(object.geometry); materials.add(material);
    const geometry: THREE.BufferGeometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    // Some source wall shells reverse their depth. Preserve outward winding when baking that transform.
    if (object.matrixWorld.determinant() < 0) {
      for (const attribute of Object.values(geometry.attributes)) {
        for (let i = 0; i < attribute.count; i += 3) for (let k = 0; k < attribute.itemSize; k++) {
          const a = (i + 1) * attribute.itemSize + k, b = (i + 2) * attribute.itemSize + k;
          const value = attribute.array[a]; attribute.array[a] = attribute.array[b]; attribute.array[b] = value;
        }
      }
    }
    const colour = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colour.length; i += 3) { colour[i] = material.color.r; colour[i + 1] = material.color.g; colour[i + 2] = material.color.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
    const key = material.map;
    const bucket = buckets.get(key) ?? []; bucket.push(geometry); buckets.set(key, bucket);
  });
  const group = new THREE.Group(); group.name = 'church';
  for (const [map, parts] of buckets) {
    const geometry = mergeGeometries(parts);
    if (!geometry) throw new Error('Church geometry could not be merged');
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    for (const part of parts) part.dispose();
  }
  for (const geometry of originals) geometry.dispose();
  for (const material of materials) material.dispose();
  return group;
}

/** Builds once, after the finest land is loaded. Later updates do no terrain or geometry work. */
export class Church {
  readonly group = new THREE.Group();
  triangles = 0;
  private built = false;
  private nextProbe = 0;
  private probes: { x: number; z: number }[];
  constructor(readonly site: ChurchSite, private terrain: Terrain) {
    this.group.name = 'church-site';
    this.group.position.set(site.origin.x, 0, site.origin.z);
    this.group.rotation.y = site.yaw;
    this.group.scale.setScalar(CHURCH_SCALE);
    this.probes = [[0, 0], [-30, -8], [-30, 8], [40, 0], [40, 30], [0, 30]].map(([x, z]) => site.world(x, z));
  }
  update(view: { x: number; z: number }, now: number): void {
    if (this.built) return;
    const dx = view.x - this.site.origin.x, dz = view.z - this.site.origin.z;
    if (dx * dx + dz * dz > 250 * 250 || now < this.nextProbe) return;
    this.nextProbe = now + 500;
    for (const p of this.probes) if ((this.terrain.surfaceAt(p.x, p.z)?.level ?? 0) < 8) return;
    const height = this.terrain.heightAt(this.site.origin.x, this.site.origin.z);
    if (height === null) return;
    const model = buildChurchModel((x, z) => {
      const p = this.site.world(x, z);
      return ((this.terrain.heightAt(p.x, p.z) ?? height) - height) / CHURCH_SCALE;
    });
    model.traverse(object => { if (object instanceof THREE.Mesh) this.triangles += object.geometry.attributes.position.count / 3; });
    this.group.position.y = height;
    this.group.add(model); this.built = true;
  }
  resolveSolids(car: Pushable): void { pushOut(car, this.site.solids); }
}
