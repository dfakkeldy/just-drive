/**
 * Preview page for the Blender-built Highland bull: the same lights, tone mapping and camera for today's
 * code-built Highland (stockGeometry in animals.ts) and the new model. Nothing here runs in the game.
 *   ?view=side|front|head|rear|far|rail|rail-close   ?animal=both|code|blender|walk   ?low=1   ?dir=<head turn, degrees>
 *   ?day=overcast (flat grey light; default is the game's sun and sky)   ?still=1 (no idle motion; no page text)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { stockGeometry } from './animals';
import { loadHighlandBull, type HighlandRig } from './highland-model';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'side';
const which = params.get('animal') ?? (view.startsWith('rail') ? 'blender' : 'both');
const low = params.get('low') === '1';
const overcast = params.get('day') === 'overcast';
const still = params.has('still');
const turn = THREE.MathUtils.degToRad(Number(params.get('dir') ?? 0) || 0);
if (still) document.body.dataset.bare = '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
// The game's own output settings (main.ts).
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .55;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// The game's sun and sky formulas (main.ts) at a 28 degree sun; overcast swaps them for a flat grey sky.
const height = .8;
const sunColour = overcast ? new THREE.Color().setRGB(.80, .83, .88).multiplyScalar(1.1)
  : new THREE.Color().setRGB(1, .62 + .3 * height, .36 + .5 * height).multiplyScalar(2.2 + 2.3 * height);
const skyColour = overcast ? new THREE.Color().setRGB(.66, .70, .76).multiplyScalar(1.5)
  : new THREE.Color().setRGB(.30, .44, .72).multiplyScalar(.55 + .5 * height);
const haze = overcast ? 0xc3cad3 : 0xb9cbd6;
scene.background = new THREE.Color(haze);
scene.fog = new THREE.Fog(haze, overcast ? 300 : 60, overcast ? 9000 : 400);
const sun = new THREE.DirectionalLight(sunColour, 1);
sun.position.set(-.55, overcast ? 1.4 : .52, -.67);
scene.add(sun, new THREE.HemisphereLight(skyColour, new THREE.Color(.22, .20, .15), 3.2));

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .05, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * .497;

const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });   // as animals.ts
/** One colour per face with small fixed variations, as the game's own painted() parts. */
function painted(geometry: THREE.BufferGeometry, colour: number, spread = .05): THREE.Mesh {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new THREE.Color(colour), colours: number[] = [];
  for (let i = 0; i < g.getAttribute('position').count; i++) {
    const shade = 1 - spread + ((Math.floor(i / 3) * 7) % 5) * spread * .5;
    colours.push(c.r * shade, c.g * shade, c.b * shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return new THREE.Mesh(g, flat);
}
function slab(colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, spread = .05): THREE.Mesh {
  const m = painted(new THREE.BoxGeometry(sx, sy, sz), colour, spread); m.position.set(x, y, z); return m;
}

// Soft contact shadow, as the car preview: no shadow map.
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
const ctx = canvas.getContext('2d');
if (ctx) {
  const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 63);
  gradient.addColorStop(0, '#10161466'); gradient.addColorStop(.6, '#10161433'); gradient.addColorStop(1, '#10161400');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
}
const shadowMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
function contactShadow(parent: THREE.Object3D): void {
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.9), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .004; parent.add(shadow);
}

const stage = new THREE.Group(); scene.add(stage);     // everything that is not an animal
const animals: THREE.Group[] = [];
let rig: HighlandRig | null = null;
if (which === 'both' || which === 'code') {
  const old = new THREE.Group(); old.name = 'code';
  old.add(new THREE.Mesh(stockGeometry('highland'), flat)); contactShadow(old); animals.push(old);
}
if (which !== 'code') {
  rig = await loadHighlandBull({ low, legs: which === 'walk' });
  const holder = new THREE.Group(); holder.name = 'blender'; holder.add(rig.root); contactShadow(holder); animals.push(holder);
  rig.head.rotation.y = turn;
}
for (const animal of animals) scene.add(animal);

const rail = view.startsWith('rail');
if (rail) {
  // A mock-up of the place, from plain game geometry: the rail runs along X, the road is on +Z, the sea is beyond -Z.
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(90, 9.5, 60, 6), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const gp = grass.geometry.getAttribute('position'), gc: number[] = [];
  for (let i = 0; i < gp.count; i++) {
    const n = Math.sin(gp.getX(i) * 12.9898 + gp.getY(i) * 78.233) * 43758.5453, r = n - Math.floor(n);
    const c = new THREE.Color(0x57633a).lerp(new THREE.Color(0x7a7446), r * .8); gc.push(c.r, c.g, c.b);
  }
  grass.geometry.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  grass.rotation.x = -Math.PI / 2; grass.position.set(0, 0, -1.55); stage.add(grass);
  stage.add(slab(0x6f5a4c, 0, -.02, 6.5, 90, .04, 7, .04));                        // wet red-brown gravel road
  const cliff = slab(0x5d5a46, 0, -30, -6.4, 90, 60, .3); cliff.rotation.x = .12; stage.add(cliff);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(16000, 9000), new THREE.MeshBasicMaterial({ color: 0x7f909c }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -62, -4500 - 6); stage.add(sea);
  // A wooded headland that runs away from us down to a point, with pale cliff faces on its sea side.
  {
    const steps = 16, rows: number[][] = [], colours: number[] = [], positions: number[] = [], index: number[] = [];
    const tones = [0x6f6a58, 0xcbc4aa, 0x2c4630, 0x243a29];          // shore rock, cliff face, forest edge, forest crest
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, z = -220 - 880 * t;                          // the point is at t = 1, about a kilometre off
      const wobble = Math.sin(i * 2.7) * .12 + Math.sin(i * 1.3 + 1) * .1;
      const top = (160 - 128 * Math.pow(t, 1.4)) * (1 + wobble * .5) * (i === steps ? .2 : 1);
      const cliff = top * (.25 + .35 * t + wobble * .4), x = -330 + 270 * t + wobble * 50;
      rows.push([x + 34, 0, z], [x + 20, cliff * .12, z], [x, cliff, z], [x - 70 - 40 * (1 - t), top * .82, z], [x - 260 - 220 * (1 - t), top, z]);
    }
    rows.forEach(([x, y, z], k) => {
      positions.push(x, y - 62, z);
      const row = k % 5, n = Math.sin(k * 12.9898) * 43758.5453, r = (n - Math.floor(n)) * .16 - .08;
      const c = new THREE.Color(tones[Math.min(row, 3)]).multiplyScalar(1 + r); if (row === 2) c.lerp(new THREE.Color(tones[2]), .3);
      colours.push(c.r, c.g, c.b);
    });
    for (let i = 0; i < steps; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 5; index.push(a, a + 1, b, a + 1, b + 1, b); }
    const land = new THREE.BufferGeometry();
    land.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    land.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3)); land.setIndex(index);
    stage.add(new THREE.Mesh(land, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));
  }
  // W-beam: two ridges and a centre web, top .70 m above the ground, face .31 m deep; crumpled by a fixed wobble.
  const profile = [[.70, 0], [.665, .05], [.60, .012], [.545, .05], [.50, .012], [.445, .05], [.39, 0]];
  const segments = 80, length = 36, positions: number[] = [], index: number[] = [], colours: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const x = -length / 2 + length * i / segments;
    const sag = Math.sin(x * .9) * .018 + Math.sin(x * 2.3 + 1.2) * .012, dent = Math.sin(x * 1.7 + .4) * .02;
    profile.forEach(([y, z], j) => {
      positions.push(x, y + sag + (j < 2 ? Math.sin(x * 5.1) * .012 : 0), z + dent);
      const n = Math.sin((i * 31 + j * 17) * 12.9898) * 43758.5453, r = n - Math.floor(n);
      const c = new THREE.Color(0x7d858b).lerp(new THREE.Color(0xaeb5b9), r); colours.push(c.r, c.g, c.b);
    });
    if (i < segments) for (let j = 0; j < profile.length - 1; j++) {
      const a = i * profile.length + j, b = a + profile.length;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const beam = new THREE.BufferGeometry();
  beam.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  beam.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  beam.setIndex(index);
  stage.add(new THREE.Mesh(beam, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));
  for (let x = -17.1; x < 18; x += 1.905) stage.add(slab(0x8b8068, x, .3, -.1, .15, .62, .15, .06));   // square timber posts
  // He stands on the sea side, about 1.2 m beyond the rail, left side to the road.
  for (const animal of animals) { animal.position.set(.6, 0, -1.35); animal.rotation.y = Math.PI / 2; }
} else {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x77805c }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.004; stage.add(ground);
}

document.body.dataset.view = view;
controls.target.set(0, .72, -.05);
switch (view) {
  case 'front': camera.position.set(-2.7, 1.25, -3.3); controls.target.set(0, .74, -.12); break;
  case 'head': camera.position.set(-1.5, 1.2, -2.6); controls.target.set(0, 1.0, -.84); camera.fov = 30; break;
  case 'rear': camera.position.set(2.8, 1.45, 3.4); break;
  case 'far': camera.position.set(-9.5, 1.6, -10.5); camera.fov = 51; break;                   // the game's own lens, 14 m away
  case 'rail': camera.position.set(-.4, 1.25, 8.2); controls.target.set(.3, .95, -1.35); camera.fov = 26; break;
  case 'rail-close': camera.position.set(-2.0, 1.3, 1.9); controls.target.set(-1.35, 1.02, -1.35); camera.fov = 44; break;
  default: camera.position.set(-5.2, 1.05, -.05);
}
if (animals.length === 2) {
  // Code-built on the left, Blender on the right, across the camera's view.
  const across = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize().cross(camera.up);
  const gap = Math.abs(across.z) > .6 ? 1.5 : 1.0;
  animals.forEach((animal, i) => { animal.position.copy(across).multiplyScalar(i ? gap : -gap); });
  camera.position.sub(controls.target).multiplyScalar(1.5).add(controls.target);
}
camera.updateProjectionMatrix();
camera.lookAt(controls.target);

function cost(root: THREE.Object3D): { triangles: number; draws: number } {
  let triangles = 0, draws = 0;
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || node.material === shadowMaterial) return;
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3; draws++;
  });
  return { triangles, draws };
}
const costs = Object.fromEntries(animals.map(animal => [animal.name, cost(animal)]));
const hud = document.getElementById('hud');
if (hud) hud.textContent = animals.map(a => `${a.name}: ${costs[a.name].triangles.toLocaleString()} triangles, ${costs[a.name].draws} draws`).join(' · ');
const label = document.getElementById('view');
if (label) label.textContent = `${view} view${animals.length === 2 ? ' · code-built left / Blender right' : ''}${low ? ' · LOW' : ''}${overcast ? ' · overcast' : ''}`;
// Preview-only inspection handle for the picture and budget job.
Object.assign(window, { highlandPreview: { scene, stage, camera, controls, renderer, animals, rig, costs, low, which, view } });

const clock = new THREE.Clock();
let frames = 0;
function animate(): void {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  if (rig && !still) {
    // The same moves the game makes: the head follows, the tail swings, the legs step.
    rig.head.rotation.y = turn + Math.sin(t * .6) * .9;
    rig.tail.rotation.z = Math.sin(t) * .12;
    if (which === 'walk') rig.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 3 + (i % 3 ? Math.PI : 0)) * .18; });
  }
  controls.update(); renderer.render(scene, camera);
  if (++frames === 8) document.title = 'settled';
}
animate();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
