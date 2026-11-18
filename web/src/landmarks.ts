import * as THREE from 'three';

interface Landmark {
  name: string; x: number; y: number; ground: number; footprint: [number, number][];
  axisDeg: number; eave: number; ridge: number;
  spire: { x: number; y: number; height: number };
}

/**
 * Landmarks are small models measured from the LiDAR. They stay visible at any distance,
 * because the terrain tiles lose thin, tall things when they are averaged.
 */
export class Landmarks {
  readonly group = new THREE.Group();
  private towers: { node: THREE.Object3D; at: THREE.Vector3 }[] = [];

  constructor(list: Landmark[], village: [number, number], exag: number, seaLevel: number) {
    const white = new THREE.MeshLambertMaterial({ color: 0xe9e6dc });
    const roof = new THREE.MeshLambertMaterial({ color: 0x7d8790 });
    const spire = new THREE.MeshLambertMaterial({ color: 0xcfd3d6 });   // pale metal: it reads as a white tick from far away
    for (const lm of list) {
      const base = seaLevel + (lm.ground - seaLevel) * exag;
      const node = new THREE.Group();
      node.name = lm.name;
      // Box of the footprint along the nave axis. Axis angle is from north, clockwise; north is -z.
      const a = THREE.MathUtils.degToRad(lm.axisDeg);
      const along = new THREE.Vector2(Math.sin(a), -Math.cos(a)), across = new THREE.Vector2(Math.cos(a), Math.sin(a));
      let lo = Infinity, hi = -Infinity, wl = Infinity, wh = -Infinity;
      const pts = lm.footprint.map(([e, n]) => new THREE.Vector2(e - lm.x, lm.y - n));
      for (const p of pts) {
        const u = p.dot(along), v = p.dot(across);
        lo = Math.min(lo, u); hi = Math.max(hi, u); wl = Math.min(wl, v); wh = Math.max(wh, v);
      }
      const len = hi - lo, wid = wh - wl;
      const mid = along.clone().multiplyScalar((lo + hi) / 2).add(across.clone().multiplyScalar((wl + wh) / 2));
      const body = new THREE.Group();
      body.position.set(mid.x, 0, mid.y);
      body.rotation.y = -a;   // local +z runs along the nave
      const walls = new THREE.Mesh(new THREE.BoxGeometry(wid, lm.eave, len), white);
      walls.position.y = lm.eave / 2;
      // Gable roof: a triangle across the nave, pushed along its length.
      const tri = new THREE.Shape([new THREE.Vector2(-wid / 2 - 0.4, 0), new THREE.Vector2(wid / 2 + 0.4, 0), new THREE.Vector2(0, lm.ridge - lm.eave)]);
      const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: len + 0.6, bevelEnabled: false }), roof);
      gable.position.set(0, lm.eave, -len / 2 - 0.3);
      body.add(walls, gable);
      node.add(body);

      // Tower and spire, at the highest LiDAR return.
      const tower = new THREE.Group();
      const sx = lm.spire.x - lm.x, sz = lm.y - lm.spire.y;
      tower.position.set(sx, 0, sz);
      tower.rotation.y = -a;
      const shaftH = lm.spire.height * 0.58, side = 6.6;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(side, shaftH, side), white);
      shaft.position.y = shaftH / 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(side * 0.72, lm.spire.height - shaftH, 4, 1), spire);
      cone.rotation.y = Math.PI / 4;
      cone.position.y = shaftH + (lm.spire.height - shaftH) / 2;
      tower.add(shaft, cone);
      node.add(tower);

      node.position.set(lm.x - village[0], base, village[1] - lm.y);
      this.group.add(node);
      this.towers.push({ node: tower, at: new THREE.Vector3(lm.spire.x - village[0], base + lm.spire.height * 0.7, village[1] - lm.spire.y) });
    }
  }

  /** Far away, a spire is thinner than one pixel. Widen it a little so it does not flicker out of sight. */
  update(camera: THREE.Camera) {
    for (const t of this.towers) {
      const k = THREE.MathUtils.clamp(t.at.distanceTo(camera.position) / 1500, 1, 2.2);
      t.node.scale.set(k, 1, k);
    }
  }
}
