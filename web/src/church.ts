/** The owner's church, measured from their phone scan and dash cam stills. No scan transforms or image pixels. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';
import { pushOut, type Pushable } from './parked';
import type { HandBuiltPlace } from './place';
import { CHURCH_GEOM, CHURCH_FEATURES, CHURCH_GROUNDS, CHURCH_SCALE, type ChurchSite } from './church-site';

type Opening = typeof CHURCH_FEATURES.openings[number];
type Point = [number, number];
interface AddOptions { cast?: boolean; receive?: boolean; ry?: number; parent?: THREE.Group }
const COL = {
  wall: 0xf7f7f3, trim: 0xffffff, roof: 0x343d40, cap: 0x1f2526, dome: 0x1b2022,
  glass: 0x34444c, steps: 0x9a968c,
  stone: 0x8e8079, rock: 0x8f9396, sign: 0xffffff, door: 0xf7f7f4,
  granite: 0x5e4440, cross: 0x353230, plinth: 0x9c4a3c, corpus: 0xa29c8e, cloth: 0xb6b0a2, boulder: 0x8d9398,
};
// Shingle courses as a repeating texture; COURSE tiles per metre keep the courses at their old size.
const COURSE = 1 / 0.66;
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

export function buildChurchParts(ground: (x: number, z: number) => number = () => 0) {
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
    granite: new THREE.MeshLambertMaterial({ color: COL.granite }),
    cross: new THREE.MeshLambertMaterial({ color: COL.cross }),
    plinth: new THREE.MeshLambertMaterial({ color: COL.plinth }),
    corpus: new THREE.MeshLambertMaterial({ color: COL.corpus }),
    cloth: new THREE.MeshLambertMaterial({ color: COL.cloth }),
    boulder: new THREE.MeshLambertMaterial({ color: COL.boulder }),
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.MeshLambertMaterial, x = 0, y = 0, z = 0, opts: AddOptions = {}) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = opts.receive ?? true;
    if (opts.ry) mesh.rotation.y = opts.ry;
    (opts.parent || group).add(mesh); return mesh;
  };
  const box = (sx: number, sy: number, sz: number, m: THREE.MeshLambertMaterial, x: number, y: number, z: number, opts: AddOptions = {}) => add(new THREE.BoxGeometry(sx, sy, sz), m, x, y, z, opts);
  // Shingled boxes: scale UVs to metres so the courses keep their real size on every face.
  const shingledBox = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];   // +x -x +y -y +z -z
    for (let i = 0; i < uv.count; i++) { const [du, dv] = dims[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * du * COURSE, uv.getY(i) * dv * COURSE); }
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

  // Shingled wall shells keep the real openings. Interior lining is omitted.
  function wall(outline: Point[], holes: THREE.Path[], place: (mesh: THREE.Mesh, inset: number) => void) {
    const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
    shape.holes = holes;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false }), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * COURSE, uv.getY(i) * COURSE);
    const outer = new THREE.Mesh(geo, mat.wall);
    place(outer, 0); group.add(outer);
  }

  // Long walls: face coordinates u = x.
  // Long walls stop at the inside of the gable walls so the corners don't overlap and flicker.
  const longOutline: Point[] = [[n.x0 + T, 0], [n.x1 - T, 0], [n.x1 - T, n.eave], [n.x0 + T, n.eave]];
  wall(longOutline, openingsOn("nave_s").map(o => archPath(o)), (m, d) => { m.position.z = zS - d; m.scale.z = -1; });
  wall(longOutline, openingsOn("nave_n").map(o => archPath(o)), (m, d) => { m.position.z = zN + d; });

  // Gable ends: face coordinates u = z. The front gable gets its openings.
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

  // Window glass and white frames in each opening, set back into the wall. Vestry openings sit on its face.
  const facePose: Record<Opening['face'], { pos: (u: number, y: number) => THREE.Vector3; ry: number }> = {
    // local +Z points out of the wall; glass sits 0.05 inside the outer face
    nave_s: { pos: (u, y) => new THREE.Vector3(u, y, zS - 0.05), ry: 0 },
    nave_n: { pos: (u, y) => new THREE.Vector3(u, y, zN + 0.05), ry: Math.PI },
    west: { pos: (u, y) => new THREE.Vector3(n.x1 - 0.05, y, u), ry: Math.PI / 2 },
    tower_w: { pos: (u, y) => new THREE.Vector3(t.x1 + 0.01, y, u), ry: Math.PI / 2 },
    tower_n: { pos: (u, y) => new THREE.Vector3(u, y, -t.zn - 0.01), ry: Math.PI },
    tower_s: { pos: (u, y) => new THREE.Vector3(u, y, t.zs + 0.01), ry: 0 },
    vestry_s: { pos: (u, y) => new THREE.Vector3(u, y, v.z1 + 0.01), ry: 0 },
    vestry_n: { pos: (u, y) => new THREE.Vector3(u, y, v.z0 - 0.01), ry: Math.PI },
  };
  for (const o of features.openings) {
    const pose = facePose[o.face];
    const r = o.w / 2, cy = (o.y0 + o.y1) / 2, dark = o.face.startsWith("tower") || o.face.startsWith("vestry");
    const local = new THREE.Group(); local.position.copy(pose.pos(o.u, 0)); local.rotation.y = pose.ry; group.add(local);
    if (o.kind === "sign") {
      add(new THREE.PlaneGeometry(o.w, o.y1 - o.y0), mat.sign, 0, cy, 0.1, { parent: local });
      continue;
    }
    if (o.kind === "door") {
      box(o.w, o.y1 - o.y0, 0.05, mat.door, 0, cy, 0.03, { parent: local });
      for (const yy of [o.y0 + 0.46, o.y0 + 1.25]) box(o.w * 0.7, 0.33, 0.02, mat.trim, 0, yy, 0.07, { parent: local });
      box(o.w + 0.16, 0.08, 0.06, mat.trim, 0, o.y1 + 0.04, 0.04, { parent: local });
      continue;
    }
    // glass
    const glassGeo = new THREE.ShapeGeometry(archShape(o), 16);
    add(glassGeo, dark ? mat.darkGlass : mat.glass, 0, 0, dark ? 0.02 : 0, { parent: local, cast: false });
    // frame: sides, sill, head, and muntins
    const fw = 0.06, top = o.kind === "arch" ? o.y1 + r : o.y1;
    box(fw, o.y1 - o.y0, 0.08, mat.trim, -r, (o.y0 + o.y1) / 2, 0.04, { parent: local });   // side posts up to the spring line
    box(fw, o.y1 - o.y0, 0.08, mat.trim, r, (o.y0 + o.y1) / 2, 0.04, { parent: local });
    box(o.w + 0.16, 0.07, 0.12, mat.trim, 0, o.y0 - 0.02, 0.05, { parent: local });
    box(0.035, top - o.y0 - 0.07, 0.04, mat.trim, 0, (o.y0 + top) / 2, 0.03, { parent: local });
    for (let k = 1; k < 4; k++) box(o.w, 0.035, 0.04, mat.trim, 0, o.y0 + (o.y1 - o.y0) * k / 4, 0.03, { parent: local });
    if (o.kind === "arch") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 20, Math.PI), mat.trim);
      ring.position.set(0, o.y1, 0.04); local.add(ring);
      // The pointed hood moulding over each round head.
      for (const side of [-1, 1]) {
        const hood = box(Math.hypot(r + 0.12, r * 0.8), 0.07, 0.05, mat.trim, side * (r + 0.12) / 2, o.y1 + r + 0.05 + r * 0.4, 0.05, { parent: local });
        hood.rotation.z = -side * Math.atan2(r * 0.8, r + 0.12);
      }
    } else {
      box(o.w + 0.13, 0.07, 0.09, mat.trim, 0, o.y1 + 0.02, 0.05, { parent: local });
    }
  }

  // Roof: two slabs with overhang, ridge cap, white fascia and rake boards.
  const over = 0.3, roofT = 0.15;
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
    const fascia = box(n.x1 - n.x0 + 2 * over, 0.18, 0.05, mat.trim, (n.x0 + n.x1) / 2, 0, 0);
    fascia.position.copy(m.position).addScaledVector(along, len / 2).addScaledVector(out, -0.03);
    // Rake boards: white trim along each gable edge of the slab, hanging just below it.
    for (const x of [n.x0 - over + 0.03, n.x1 + over - 0.03]) {   // outer face 1 cm past the slab end
      const rake = box(0.08, 0.21, len, mat.trim, 0, 0, 0);
      rake.rotation.x = -ang;
      rake.position.copy(m.position).addScaledVector(out, -0.04); rake.position.x = x;
    }
  };
  slope(zN); slope(zS);
  box(n.x1 - n.x0 + 2 * over, 0.12, 0.33, mat.cap, (n.x0 + n.x1) / 2, n.ridge + 0.13, zM);
  for (const [x, z] of [[n.x0, zN], [n.x0, zS], [n.x1, zN], [n.x1, zS]]) box(0.21, n.eave, 0.21, mat.trim, x, n.eave / 2, z);

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
  for (const [x, z] of [[t.x1, -t.zn], [t.x1, t.zs]]) box(0.17, t.top, 0.17, mat.trim, x, t.top / 2, z);
  box(tw + 0.33, 0.26, tz + 0.33, mat.cap, tx0 + tw / 2, c.base - 0.13, tzc);   // cap top meets the drum at c.base
  box(tw + 0.2, 0.15, tz + 0.2, mat.trim, tx0 + tw / 2, t.top - 0.36, tzc);

  // Cupola: white octagonal drum with dark openings between its posts, black onion dome, finial and cross.
  const drumH = c.top - c.base;
  const drum = add(new THREE.CylinderGeometry(c.r, c.r * 1.04, drumH, 8), mat.trim, c.x, c.base + drumH / 2, c.z);
  drum.rotation.y = Math.PI / 8;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, rr = c.r * 1.03 * Math.cos(Math.PI / 8) + 0.02;   // face centres (corners are at odd multiples of pi/8)
    const l = box(c.r * 0.55, drumH * 0.6, 0.03, mat.cap, c.x + rr * Math.cos(a), c.base + drumH / 2, c.z + rr * Math.sin(a));
    l.rotation.y = -a + Math.PI / 2;
  }
  const domeBase = c.top, k = (c.dome - c.top) / 2.4;
  const prof = [[c.r * 1.08, 0], [c.r * 1.18, 0.35], [c.r * 1.12, 0.9], [c.r * 0.8, 1.55], [c.r * 0.35, 2.05], [c.r * 0.1, 2.35], [0, 2.4]]
    .map(([x, y]) => new THREE.Vector2(x, y * k));
  add(new THREE.LatheGeometry(prof, 32), mat.dome, c.x, domeBase, c.z);
  box(c.r * 2.3, 0.1, c.r * 2.3, mat.trim, c.x, domeBase, c.z);
  add(new THREE.SphereGeometry(0.07, 12, 8), mat.trim, c.x, c.dome + 0.03, c.z);
  const crossH = c.cross - c.dome;
  box(0.06, crossH, 0.06, mat.trim, c.x, c.dome + crossH / 2, c.z);
  box(0.06, 0.06, crossH * 0.55, mat.trim, c.x, c.dome + crossH * 0.7, c.z);

  // Vestry: small shingled box on the east end with a low gable roof; its door and windows are openings.
  const vx0 = v.x0, vx1 = n.x0, vzm = (v.z0 + v.z1) / 2, vw = v.z1 - v.z0;
  shingledBox(vx1 - vx0, v.eave, vw, (vx0 + vx1) / 2, v.eave / 2, vzm);
  for (const zE of [v.z0, v.z1]) {
    const dz = vzm - zE, dy = v.ridge - v.eave, len = Math.hypot(dz, dy) + 0.23;
    const ang = Math.atan2(dy, Math.abs(dz)) * Math.sign(dz);
    const b = box(vx1 - vx0 + 0.4, 0.12, len, mat.roof, (vx0 + vx1) / 2 - 0.2, (v.eave + v.ridge) / 2 + 0.07, (zE + vzm) / 2 - Math.sign(dz) * 0.1);
    b.rotation.x = -ang;
  }
  // The vestry's rear gable, above its box.
  const gableGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(v.z0, v.eave), new THREE.Vector2(v.z1, v.eave), new THREE.Vector2(vzm, v.ridge)]));
  for (const x of [vx0 - 0.005]) { const g = add(gableGeo, mat.trim, x, 0, 0, { ry: -Math.PI / 2, cast: false }); g.rotation.y = -Math.PI / 2; }

  // A plain solid base reaches below the lowest sampled land across its footprint.
  // Treads and wall tops stay level; only the hidden bottom follows terrain/exaggeration.
  const lowest = (x0: number, x1: number, z0: number, z1: number) => {
    let bottom = 0;
    const nx = Math.ceil((x1 - x0) / 0.33), nz = Math.ceil((z1 - z0) / 0.33);
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
      bottom = Math.min(bottom, ground(x0 + (x1 - x0) * ix / nx, z0 + (z1 - z0) * iz / nz));
    }
    return bottom - 0.13;
  };
  const groundedBox = (x0: number, x1: number, z0: number, z1: number, top: number, material: THREE.MeshLambertMaterial) => {
    const bottom = lowest(x0, x1, z0, z1);
    box(x1 - x0, top - bottom, z1 - z0, material, (x0 + x1) / 2, (top + bottom) / 2, (z0 + z1) / 2);
  };
  // A white railing: posts at both ends and one rail, `rise` to `fall` above the deck from a to b.
  const railing = (ax: number, az: number, ay: number, bx: number, bz: number, by: number) => {
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]]) box(0.07, 0.9, 0.07, mat.trim, x, y + 0.45, z);
    const len = Math.hypot(bx - ax, by - ay, bz - az), rail = box(len, 0.06, 0.06, mat.trim, (ax + bx) / 2, (ay + by) / 2 + 0.9, (az + bz) / 2);
    rail.rotation.set(0, -Math.atan2(bz - az, bx - ax), Math.atan2(by - ay, Math.hypot(bx - ax, bz - az)), 'YZX');
  };

  // Front steps with railings, rising to the tower door.
  const st = features.steps;
  for (let i = 0; i < st.count; i++) {
    const h = st.rise * (i + 1) / st.count, d = st.run * (st.count - i) / st.count;
    if (i === 0) groundedBox(t.x1, t.x1 + d, st.u - st.width / 2, st.u + st.width / 2, h, mat.steps);
    else box(d, h, st.width, mat.steps, t.x1 + d / 2, h / 2, st.u);
  }
  for (const side of [-1, 1]) {
    const z = st.u + side * (st.width / 2 + 0.04);
    railing(t.x1 + 0.1, z, st.rise, t.x1 + st.run - 0.05, z, st.rise / st.count);
  }

  // The ramp from the tower's side door, down along the front gable, with a railing on each side.
  const rp = features.ramp, rz0 = -t.zn, rz1 = -t.zn - rp.run, rx0 = rp.u - rp.width / 2;
  {
    const bottom = lowest(rx0, rx0 + rp.width, rz1, rz0);
    const shape = new THREE.Shape([new THREE.Vector2(0, bottom), new THREE.Vector2(rp.run, bottom), new THREE.Vector2(rp.run, 0.03), new THREE.Vector2(0, rp.rise)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: rp.width, bevelEnabled: false });
    geo.rotateY(Math.PI / 2); geo.translate(rx0, 0, rz0);   // shape x -> out from the tower (-z), extrusion -> +x
    add(geo, mat.steps);
    for (const x of [rx0 - 0.04, rx0 + rp.width + 0.04]) railing(x, rz0 - 0.1, rp.rise, x, rz1 + 0.1, 0.04);
  }
  // The vestry's side landing, with a railing on its open edge.
  const ld = features.landing;
  groundedBox(ld.u - ld.width / 2, ld.u + ld.width / 2, v.z1, v.z1 + ld.depth, ld.rise, mat.steps);
  railing(ld.u - ld.width / 2, v.z1 + ld.depth - 0.04, ld.rise, ld.u + ld.width / 2 - 0.4, v.z1 + ld.depth - 0.04, ld.rise);

  // The granite monument in front: a plinth, a die, a shaft and a low cap. No plaque text.
  const gm = CHURCH_GROUNDS.monument;
  {
    const g = ground(gm.x, gm.z), base = 0.22, die = 0.55, cap = 0.12, shaft = gm.h - base - die - cap;
    const low = lowest(gm.x - gm.w / 2, gm.x + gm.w / 2, gm.z - gm.w / 2, gm.z + gm.w / 2);
    box(gm.w, g + base - low, gm.w, mat.granite, gm.x, (g + base + low) / 2, gm.z);
    box(gm.w * 0.73, die, gm.w * 0.73, mat.granite, gm.x, g + base + die / 2, gm.z);
    box(gm.w * 0.47, shaft, gm.w * 0.47, mat.granite, gm.x, g + base + die + shaft / 2, gm.z);
    add(new THREE.ConeGeometry(gm.w * 0.34, cap, 4), mat.granite, gm.x, g + gm.h - cap / 2, gm.z, { ry: Math.PI / 4 });
  }
  // The tall wayside crucifix on the lane: a tapered red concrete plinth, steel gussets, dark steel cross,
  // and a weathered metal figure of Christ on the front (+Z) face, turned toward the church and approaching lane.
  const ws = CHURCH_GROUNDS.wayside;
  {
    const g = ground(ws.x, ws.z), low = lowest(ws.x - 0.55, ws.x + 0.55, ws.z - 0.55, ws.z + 0.55);
    const cross = new THREE.Group(); cross.position.set(ws.x, g, ws.z); cross.rotation.y = ws.ry; group.add(cross);
    // Grounded skirt under the tapered red plinth so it sits cleanly on the hillside.
    const plinthGroup = new THREE.Group(); plinthGroup.name = 'waysidePlinth'; cross.add(plinthGroup);
    const skirtH = Math.max(0.15, g - low);
    box(0.96, skirtH, 0.96, mat.plinth, 0, -skirtH / 2, 0, { parent: plinthGroup });
    const plinth = add(new THREE.CylinderGeometry(0.52, 0.68, 0.48, 4), mat.plinth, 0, 0.24, 0, { parent: plinthGroup, ry: Math.PI / 4 });
    plinth.scale.set(1, 1, 1);
    // Steel baseplate and four tapered steel gusset fins clamping the post.
    box(0.58, 0.04, 0.58, mat.cross, 0, 0.5, 0, { parent: plinthGroup });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, fin = add(new THREE.ConeGeometry(0.22, 0.36, 4), mat.cross, Math.cos(a) * 0.11, 0.68, Math.sin(a) * 0.11, { parent: cross, ry: Math.PI / 4 });
      fin.scale.set(i % 2 === 0 ? 1 : 0.25, 1, i % 2 === 0 ? 0.25 : 1);
    }
    // Cross shaft (reaching exact measured height ws.h) and horizontal crossbeam.
    box(0.16, ws.h - 0.48, 0.16, mat.cross, 0, 0.48 + (ws.h - 0.48) / 2, 0, { parent: cross });
    box(ws.arm, 0.16, 0.16, mat.cross, 0, ws.armAt, 0, { parent: cross });
    // Sculpted weathered-metal figure of Christ (corpus) on the +Z front face.
    const zf = 0.125;
    const limb = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, rTop: number, rBot: number, m: THREE.MeshLambertMaterial) => {
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), dir = b.clone().sub(a), len = dir.length();
      const seg = add(new THREE.CylinderGeometry(rTop, rBot, len, 6), m, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, { parent: cross });
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return seg;
    };
    // Head bowed slightly to His right (-X when facing +Z)
    const head = add(new THREE.SphereGeometry(0.105, 8, 6), mat.corpus, -0.025, ws.armAt - 0.06, zf + 0.055, { parent: cross });
    head.scale.set(0.9, 1.15, 0.95);
    // Neck, shoulders and tapered torso
    add(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 6), mat.corpus, -0.01, ws.armAt - 0.16, zf + 0.02, { parent: cross });
    add(new THREE.CylinderGeometry(0.145, 0.10, 0.52, 8), mat.corpus, 0, ws.armAt - 0.44, zf, { parent: cross }).scale.set(1.15, 1, 0.72);
    // Outstretched arms seamlessly joined at shoulders, elbows and nailed hands along the crossbeam
    for (const side of [-1, 1]) {
      const sh: [number, number, number] = [side * 0.13, ws.armAt - 0.21, zf];
      const el: [number, number, number] = [side * 0.48, ws.armAt - 0.10, zf];
      const hd: [number, number, number] = [side * 0.84, ws.armAt + 0.01, zf - 0.02];
      add(new THREE.SphereGeometry(0.058, 6, 5), mat.corpus, sh[0], sh[1], sh[2], { parent: cross });
      limb(sh[0], sh[1], sh[2], el[0], el[1], el[2], 0.048, 0.056, mat.corpus);
      add(new THREE.SphereGeometry(0.048, 6, 5), mat.corpus, el[0], el[1], el[2], { parent: cross });
      limb(el[0], el[1], el[2], hd[0], hd[1], hd[2], 0.038, 0.048, mat.corpus);
      box(0.09, 0.06, 0.04, mat.corpus, hd[0], hd[1], hd[2], { parent: cross });
    }
    // Draped loincloth (perizonium) tied at the right hip
    add(new THREE.CylinderGeometry(0.115, 0.125, 0.34, 8), mat.cloth, 0, ws.armAt - 0.82, zf + 0.01, { parent: cross }).scale.set(1.1, 1, 0.82);
    add(new THREE.SphereGeometry(0.055, 6, 5), mat.cloth, 0.13, ws.armAt - 0.72, zf + 0.02, { parent: cross });
    // Slightly bent thighs, knees, calves and crossed feet nailed to the shaft
    for (const side of [-1, 1]) {
      const hip: [number, number, number] = [side * 0.075, ws.armAt - 0.94, zf + 0.01];
      const kn: [number, number, number] = [side * 0.042, ws.armAt - 1.29, zf + 0.06];
      const ft: [number, number, number] = [side * 0.015, ws.armAt - 1.66, zf - 0.01];
      limb(hip[0], hip[1], hip[2], kn[0], kn[1], kn[2], 0.046, 0.058, mat.corpus);
      add(new THREE.SphereGeometry(0.046, 6, 5), mat.corpus, kn[0], kn[1], kn[2], { parent: cross });
      limb(kn[0], kn[1], kn[2], ft[0], ft[1], ft[2], 0.034, 0.046, mat.corpus);
    }
    box(0.09, 0.08, 0.11, mat.corpus, 0, ws.armAt - 1.66, zf - 0.01, { parent: cross });
  }
  // Rocks at the scan's positions and sizes; large boulders use a normalised sculpted granite dome grounded below the slope.
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
  const boulderGeo = new THREE.IcosahedronGeometry(0.5, 1);
  {
    const pos = boulderGeo.attributes.position;
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const lump = 0.94 + 0.10 * Math.sin(x * 7.3 + z * 5.1) * Math.cos(y * 6.2 - x * 4.1);
      const nx = x * lump, ny = y < 0 ? y * 0.35 : y * (0.96 + 0.06 * Math.cos(x * 4 - z * 5)), nz = z * lump;
      pos.setXYZ(i, nx, ny, nz);
      minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
      maxY = Math.max(maxY, ny);
      minZ = Math.min(minZ, nz); maxZ = Math.max(maxZ, nz);
    }
    // Normalise full min-to-max spans to [-0.5, +0.5] in X/Z and crown 1.0 in Y so scale(w, h, d) gives exact w x h x d.
    const cx = (minX + maxX) / 2, sx = maxX - minX, cz = (minZ + maxZ) / 2, sz = maxZ - minZ;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, (pos.getX(i) - cx) / sx, pos.getY(i) / maxY, (pos.getZ(i) - cz) / sz);
    }
    boulderGeo.computeVertexNormals();
  }
  for (const [x, z, h, w, d, ry] of CHURCH_GROUNDS.rocks) {
    if (w > 1.5) {
      const boulderGroup = new THREE.Group(); boulderGroup.name = 'largeBoulder'; group.add(boulderGroup);
      const g = ground(x, z), low = lowest(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
      const b = add(boulderGeo, mat.boulder, x, g, z, { ry, parent: boulderGroup });
      b.scale.set(w, h, d);
      // Solid lower base so the boulder never floats on sloping grass.
      const baseH = Math.max(0.25, g + h * 0.2 - low);
      const skirt = add(new THREE.CylinderGeometry(0.42, 0.46, baseH, 8), mat.boulder, x, low + baseH / 2, z, { ry, parent: boulderGroup });
      skirt.scale.set(w * 0.92, 1, d * 0.92);
    } else {
      const r = add(rockGeo, mat.rock, x, ground(x, z) + 0.2 * h, z, { ry });
      r.scale.set(w, 1.6 * h, d);
    }
  }

  // Plain foundation skirts cover all three volumes, including the tower, down to sampled land.
  for (const [x0, x1, z0, z1] of [[n.x0, n.x1, zN, zS], [n.x1, t.x1, -t.zn, t.zs], [v.x0, n.x0, v.z0, v.z1]]) {
    groundedBox(x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02, 0.07, mat.stone);
  }
  return group;
}

export function buildChurchModel(ground: (x: number, z: number) => number = () => 0) {
  return mergeChurch(buildChurchParts(ground));
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
export class Church implements HandBuiltPlace {
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
    this.probes = [[0, 0], [-20, -5], [-20, 5], [26, 0], [26, 20], [0, 20], [-42, -40]].map(([x, z]) => site.world(x, z));
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
