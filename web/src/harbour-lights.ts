import * as THREE from 'three';
import { LIGHTS, type HarbourLight } from './harbour-lights-data';

export function beaconOn(record: HarbourLight, seconds: number, night: boolean): boolean {
  if (!night) return false;
  if (record.character === 'F') return true;
  const phase = ((seconds % record.period) + record.period) % record.period;
  return phase < record.on;
}

/** Small shared batches, without text, textures or real-time lights. Dimensions remain in metres. */
export class HarbourLights {
  readonly group = new THREE.Group();
  readonly sites: { number: string; x: number; z: number; y: number; height: number; beaconY: number }[] = [];
  /** Game seconds (paused wall time excluded), so beacons hold their phase while the game is paused. */
  seconds = 0;
  update(seconds: number): void { this.seconds = seconds; }
  constructor(area: string, village: readonly number[], exag: number, night: boolean, seaLevel: number) {
    const records = LIGHTS.filter(r => r.areas.includes(area));
    this.group.name = 'harbour lights';
    const parts = new Map<string, { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; colours: THREE.Color[] }>();
    const white = new THREE.Color('#e4e1d5'), red = new THREE.Color('#9c2926'), dark = new THREE.Color('#303c3b');
    const add = (key: string, geometry: () => THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: THREE.Color, rotation = 0) => {
      let part = parts.get(key);
      if (!part) { part = { geometry: geometry(), matrices: [], colours: [] }; parts.set(key, part); }
      part.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(sx, sy, sz)));
      part.colours.push(colour);
    };
    const box = () => new THREE.BoxGeometry(1, 1, 1);
    const beam = (a: THREE.Vector3, b: THREE.Vector3) => {
      const mid = a.clone().add(b).multiplyScalar(.5), delta = b.clone().sub(a), length = delta.length();
      const part = parts.get('box');
      if (!part) return;
      part.matrices.push(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()), new THREE.Vector3(.06, length, .06)));
      part.colours.push(dark);
    };
    for (const r of records) {
      const site = { number: r.number, x: r.e - village[0], z: village[1] - r.n, y: seaLevel + (r.ground - seaLevel) * exag, height: r.height, beaconY: seaLevel + (r.ground - seaLevel) * exag + (r.kind === 'wood' || r.kind === 'octagon' ? r.height * .87 : r.height - .22) };
      this.sites.push(site);
      const { x, y, z } = site, h = r.height;
      if (r.kind === 'wood' || r.kind === 'octagon') {
        const sides = r.kind === 'wood' ? 4 : 8, width = h * .20, body = h * .78;
        add(`taper${sides}`, () => {
          const geo = new THREE.CylinderGeometry(.62, 1, 1, sides).toNonIndexed();
          if (sides === 8) {
            const p = geo.getAttribute('position'), colours: number[] = [];
            for (let i = 0; i < p.count; i += 3) {
              const angle = Math.atan2(p.getX(i) + p.getX(i + 1) + p.getX(i + 2), p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2));
              const colour = Math.floor((angle + Math.PI) / (Math.PI / 4)) % 2 ? red : white;
              for (let k = 0; k < 3; k++) colours.push(colour.r, colour.g, colour.b);
            }
            geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
          }
          return geo;
        }, x, y + body / 2, z, width, body, width, white, sides === 4 ? Math.PI / 4 : 0);
        add('box', box, x, y + body, z, width * 1.6, .18, width * 1.6, white);
        // Open lantern: the beacon must not sit inside an opaque box.
        for (const dx of [-1, 1]) for (const dz of [-1, 1])
          add('box', box, x + dx * width * .46, y + h * .87, z + dz * width * .46, .07, h * .15, .07, red);
        if (r.number === '702') add('box', box, x, y + h * .4, z + width * .9, width * .12, h * .6, .1, red);
        if (r.number === '876') add('box', box, x, y + h * .795, z, width * 1.05, h * .04, width * 1.05, red);
        add('box', box, x, y + h * .12, z + width * .9, width * .25, h * .22, .08, dark);
        add('roof', () => new THREE.ConeGeometry(1, 1, 4), x, y + h * .97, z, width, h * .06, width, red, Math.PI / 4);
        // Gallery rails and four lantern corner posts share the cube batch.
        for (const sign of [-1, 1]) {
          add('box', box, x + sign * width * .65, y + body + .5, z, .05, .05, width * 1.3, dark);
          add('box', box, x, y + body + .5, z + sign * width * .65, width * 1.3, .05, .05, dark);
        }
      } else if (r.kind === 'round') {
        add('pole', () => new THREE.CylinderGeometry(.12, .16, 1, 8), x, y + (h - .44) / 2, z, 1, h - .44, 1, white);
        if (r.number === '881.1') {
          add('box', box, x, y + h * .6, z, .7, .7, .08, dark);
          add('box', box, x, y + h * .6, z - .05, .58, .58, .02, white);
          add('box', box, x, y + h * .6, z - .07, .4, .4, .02, new THREE.Color('#236846'));
        }
      } else {
        const half = Math.min(1.2, h * .12);
        const corners = r.kind === 'triangle'
          ? [[0, -half], [-half, half], [half, half]]
          : [[-half, -half], [-half, half], [half, half], [half, -half]];
        for (const [dx, dz] of corners) add('box', box, x + dx, y + (h - .44) / 2, z + dz, .09, h - .44, .09, white);
        for (let k = 0; k + 1.2 < h - .5; k += 1.2) {
          for (let edge = 0; edge < corners.length; edge++) {
            const a = corners[edge], b = corners[(edge + 1) % corners.length];
            beam(new THREE.Vector3(x + a[0], y + k, z + a[1]), new THREE.Vector3(x + b[0], y + k + 1.2, z + b[1]));
          }
        }
        for (let k = 1; k < h - .5; k += 1.2) {
          for (let edge = 0; edge < corners.length; edge++) {
            const a = corners[edge], b = corners[(edge + 1) % corners.length];
            beam(new THREE.Vector3(x + a[0], y + k, z + a[1]), new THREE.Vector3(x + b[0], y + k, z + b[1]));
          }
        }
        add('box', box, x, y + h * .68, z, .9, h * .3, .12, white);
        add('box', box, x, y + h * .68, z - .07, .16, h * .3, .02, red);
      }
    }
    const material = new THREE.MeshStandardMaterial({ roughness: .88, vertexColors: true });
    for (const [key, part] of parts) {
      if (!part.geometry.hasAttribute('color')) part.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(part.geometry.getAttribute('position').count * 3).fill(1), 3));
      const mesh = new THREE.InstancedMesh(part.geometry, material, part.matrices.length);
      mesh.name = `harbour ${key}`;
      part.matrices.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, part.colours[i]); });
      mesh.computeBoundingSphere(); this.group.add(mesh);
    }
    if (!records.length || !night) return;
    const geometry = new THREE.SphereGeometry(.22, 8, 6);
    geometry.setAttribute('cycle', new THREE.InstancedBufferAttribute(new Float32Array(records.flatMap(r => [r.period, r.on])), 2));
    geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(new Float32Array(records.flatMap(r => r.colour === 'R' ? [4, .05, .01] : r.colour === 'G' ? [.03, 3, .15] : [3, 3, 3])), 3));
    const beacon = new THREE.ShaderMaterial({ uniforms: { seconds: { value: 0 }, viewportHeight: { value: 720 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec2 cycle;attribute vec3 tint;uniform float viewportHeight;
        varying vec2 timing;varying vec3 colour;
        void main(){timing=cycle;colour=tint;
          vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
          mvPosition.xyz+=position*max(1.,-mvPosition.z*4./(viewportHeight*projectionMatrix[1][1]*.22));
          gl_Position=projectionMatrix*mvPosition;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform float seconds;varying vec2 timing;varying vec3 colour;
        void main(){if(timing.x>0.&&mod(seconds,timing.x)>=timing.y)discard;
          #include <logdepthbuf_fragment>
          gl_FragColor=vec4(colour,1.);
        }`, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, beacon, records.length);
    mesh.name = 'harbour beacons';
    this.sites.forEach((s, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(s.x, s.beaconY, s.z)));
    const viewport = new THREE.Vector2();
    mesh.onBeforeRender = renderer => { beacon.uniforms.seconds.value = this.seconds; beacon.uniforms.viewportHeight.value = renderer.getDrawingBufferSize(viewport).y; };
    mesh.computeBoundingSphere(); this.group.add(mesh);
  }
}
