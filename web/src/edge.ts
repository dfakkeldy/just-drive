import * as THREE from 'three';
import type { Roads } from './roads';
import type { Terrain } from './terrain';

interface Gate { x: number; z: number; heading: number; half: number; node: THREE.Object3D | null }

/**
 * Where a public road leaves the playable area there is a barricade and a sign, so the edge of the map
 * reads as the end of the carrier's route and not as a fault.
 */
export class Edge {
  readonly group = new THREE.Group();
  private gates: Gate[] = [];
  private board: THREE.MeshLambertMaterial;
  private post = new THREE.MeshLambertMaterial({ color: 0x5b5146 });
  private sign: THREE.MeshLambertMaterial;

  constructor(roads: Roads, private terrain: Terrain, readonly bounds: [number, number, number, number], route = true, nose = 3.2, private plainTimber = false) {
    const [x0, z0, x1, z1] = bounds;
    const inside = (p: [number, number]) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1;
    for (const road of roads.roads) {
      if (road.kind > 3) continue;
      for (let i = 0; i < road.pts.length - 1; i++) {
        const a = road.pts[i], b = road.pts[i + 1];
        if (inside(a) === inside(b)) continue;
        // Walk from the inside point toward the outside point, to where the road meets the wall.
        const [p, q] = inside(a) ? [a, b] : [b, a];
        let t = 1;
        const dx = q[0] - p[0], dz = q[1] - p[1];
        if (dx !== 0) t = Math.min(t, ...[(x0 - p[0]) / dx, (x1 - p[0]) / dx].filter((v) => v > 0));
        if (dz !== 0) t = Math.min(t, ...[(z0 - p[1]) / dz, (z1 - p[1]) / dz].filter((v) => v > 0));
        // The car's middle stops at the wall, so the boards stand a car's nose past it.
        const len = Math.hypot(dx, dz) || 1, back = t + nose / len;
        this.gates.push({ x: p[0] + dx * back, z: p[1] + dz * back, heading: Math.atan2(dx, -dz), half: road.halfWidth, node: null });
      }
    }
    // Red and white stripes for the board; a plain sign with the game's own words.
    const stripes = document.createElement('canvas');
    stripes.width = 256; stripes.height = 32;
    const g = stripes.getContext('2d')!;
    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#c0281c';
    for (let x = -32; x < 256; x += 48) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 24, 32); g.lineTo(x + 56, 0); g.lineTo(x + 32, 0); g.fill(); }
    const stripeTex = new THREE.CanvasTexture(stripes);
    stripeTex.colorSpace = THREE.SRGBColorSpace;
    stripeTex.wrapS = THREE.RepeatWrapping;
    this.board = new THREE.MeshLambertMaterial({ map: stripeTex });
    const plate = document.createElement('canvas');
    plate.width = 512; plate.height = 256;
    const s = plate.getContext('2d')!;
    s.fillStyle = '#e8a21a'; s.fillRect(0, 0, 512, 256);
    s.strokeStyle = '#1b1b1b'; s.lineWidth = 10; s.strokeRect(12, 12, 488, 232);
    s.fillStyle = '#1b1b1b'; s.textAlign = 'center';
    s.font = 'bold 74px sans-serif'; s.fillText(route ? 'ROUTE ENDS' : 'MAP ENDS', 256, 112);
    s.font = 'bold 34px sans-serif'; s.fillText(route ? 'Not your mail past here' : 'More land beyond this map', 256, 180);
    const signTex = new THREE.CanvasTexture(plate);
    signTex.colorSpace = THREE.SRGBColorSpace;
    this.sign = new THREE.MeshLambertMaterial({ map: signTex });
    if (this.plainTimber) { this.board.map = null; this.board.color.setHex(0x887052); }
  }

  /** Stand each barricade on the ground once the ground under it has loaded and the camera is near. */
  update(cam: THREE.Vector3) {
    for (const gate of this.gates) {
      if (Math.hypot(gate.x - cam.x, gate.z - cam.z) > 1200) continue;
      const y = this.plainTimber ? this.terrain.meshHeightAt(gate.x, gate.z, true) ?? this.terrain.meshHeightAt(gate.x, gate.z) : this.terrain.heightAt(gate.x, gate.z);
      if (y === null) continue;
      // Finer ground arrives after the first, coarse answer: keep the boards seated on it.
      if (gate.node) { gate.node.position.y = y; continue; }
      const w = gate.half * 2 + 2.4, node = new THREE.Group();
      const tex = this.board.map?.clone() ?? null;
      if (tex) { tex.repeat.set(w / 1.6, 1); tex.needsUpdate = true; }
      const mat = this.board.clone(); mat.map = tex;
      for (const h of [0.55, 1.0]) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 0.05), mat);
        board.position.y = h;
        node.add(board);
      }
      for (const sx of [-w / 2 + 0.2, 0, w / 2 - 0.2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.25, 0.1), this.post);
        post.position.set(sx, 0.62, 0.08);
        node.add(post);
      }
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), this.sign);
      plate.position.set(0, 1.75, 0);
      plate.rotation.y = Math.PI;   // the boards' near side is local -z
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), this.post);
      pole.position.set(0, 1.3, 0.08);
      // The sign faces back down the road, toward a car that drives up to it.
      const backPlate = plate.clone();
      backPlate.rotation.y = 0;
      backPlate.position.z = 0.14;
      plate.position.z = -0.02;
      if (!this.plainTimber) node.add(plate, backPlate, pole);
      node.position.set(gate.x, y, gate.z);
      node.rotation.y = Math.PI - gate.heading;
      this.group.add(node);
      gate.node = node;
    }
  }
}
