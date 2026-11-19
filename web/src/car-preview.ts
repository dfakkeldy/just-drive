import { setHud } from './hud-text';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCar } from './car';
import { BOSS_PAINTS, makeBossCar } from './boss-car';

const params = new URLSearchParams(location.search);
const scene = new THREE.Scene();
// ?night=1: a dark evening, lit only a little (the Boss car's colour study).
const night = params.get('night') === '1', sky = night ? 0x0c1118 : 0xb7cbd2;
scene.background = new THREE.Color(sky);
scene.fog = new THREE.Fog(sky, 45, 120);
const low = params.get('detail') === 'low';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, .025, 160);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .94, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * .495;
controls.minDistance = 2.7;
controls.maxDistance = 40;
scene.add(new THREE.HemisphereLight(night ? 0x34465e : 0xe0f0ff, night ? 0x16130e : 0x665d48, night ? .45 : 2.1));
const sun = new THREE.DirectionalLight(night ? 0xffd9a0 : 0xffe2b5, night ? .9 : 3.1);
sun.position.set(-6, 4, 5); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x8d9387, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; scene.add(ground);
// A small procedural contact shadow avoids a shadow-map cost in the game model.
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = 128; shadowCanvas.height = 128;
const ctx = shadowCanvas.getContext('2d');
if (ctx) {
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 63);
  gradient.addColorStop(0, '#18222280'); gradient.addColorStop(.65, '#18222244'); gradient.addColorStop(1, '#18222200');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
}
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = .002; scene.add(shadow);
const model = params.get('model');
// ?trim=off shows the car off duty; ?clean=1 leaves the words off the sign (the two things a build can ask for).
const makeBlender = async () => (await (await import('./car-model')).loadBlenderCar(low)).create(params.get('trim') !== 'off', params.has('clean'));
const car = model === 'blender' ? await makeBlender() : createCar(); scene.add(car.root);
const cars = [car];
const shadows = [shadow];
// ?boss=oxblood|bottle|mustard: the left car is the Boss's car in that colour, the right one the mail car beside it.
const bossPaint = BOSS_PAINTS[params.get('boss') ?? ''], boss = bossPaint !== undefined ? makeBossCar(car, bossPaint) : null;
const pair = model === 'both' || !!boss;
if (pair) {
  const second = model === 'blender' || model === 'both' ? await makeBlender() : createCar(); cars.push(second); scene.add(second.root);
  const secondShadow = shadow.clone(); shadows.push(secondShadow); scene.add(secondShadow);
}
if (pair && params.get('view') === 'driver') { cars[1].root.position.x = 3.5; shadows[1].position.x = 3.5; }
// Preserve pilot selection and dirt when changing views through the existing navigation.
if (model === 'blender' || model === 'both') for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a')) {
  const url = new URL(link.href); url.searchParams.set('model', model);
  for (const key of ['dirt', 'detail']) if (params.has(key)) url.searchParams.set(key, params.get(key)!);
  link.href = url.href;
}

const dirtParam = Number(params.get('dirt') ?? .75);
cars.forEach(c => c.setDirt(Number.isFinite(dirtParam) ? dirtParam : .75));
const view = params.get('view') ?? 'front';
document.body.dataset.view = view;
switch (view) {
  case 'rear': camera.position.set(5.1, 2.8, 6.5); break;
  case 'side': camera.position.set(8.8, 2.0, .0); break;
  case 'driver-side': camera.position.set(3.3, 1.85, -2.4); controls.target.set(.3, 1.16, -.2); break;
  case 'top': camera.position.set(4.2, 8.8, 4.3); controls.target.y = .6; break;
  case 'driver':
    car.root.updateMatrixWorld(true); car.driverEye.getWorldPosition(camera.position);
    controls.target.copy(camera.position).add(new THREE.Vector3(-.09, -.10, -2));
    controls.enabled = false; controls.minDistance = .05; camera.fov = 75; camera.updateProjectionMatrix(); break;
  case 'far': camera.position.set(18, 8, -23); break;
  default: camera.position.set(5.1, 2.7, -6.5);
}
if (pair && view !== 'driver') {
  const across = camera.position.clone().sub(controls.target).cross(camera.up).normalize().negate();
  cars.forEach((c, i) => {
    c.root.position.copy(across).multiplyScalar(i === 0 ? -2.5 : 2.5);
    shadows[i].position.x = c.root.position.x; shadows[i].position.z = c.root.position.z;
  });
  camera.position.sub(controls.target).multiplyScalar(1.75).add(controls.target);
}
// Study views: ?eye=x,y,z&look=x,y,z places the camera anywhere (preview only).
const triple = (key: string): THREE.Vector3 | null => {
  const parts = (params.get(key) ?? '').split(',').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? new THREE.Vector3(parts[0], parts[1], parts[2]) : null;
};
const eye = triple('eye'), look = triple('look');
if (eye && look && view !== 'driver') { camera.position.copy(eye); controls.target.copy(look); controls.minDistance = .2; }
camera.lookAt(controls.target);
const materials = new Set<THREE.Material>();
let triangles = 0;
car.root.traverse(node => {
  if (node instanceof THREE.Mesh) {
    const count = node.geometry.index?.count ?? node.geometry.getAttribute('position').count;
    triangles += count / 3 * (node instanceof THREE.InstancedMesh ? node.count : 1);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  }
});
// Preview-only inspection handle for repeatable geometry and motion checks.
Object.assign(window, { carPreview: { car, scene, camera, controls, renderer, cars, low, model: model ?? 'original', triangles, materials: materials.size } });
const hud = document.getElementById('hud');
if (!boss && (triangles >= 40000 || materials.size >= 12)) throw new Error('The car exceeds its geometry or material budget.');
if (hud) setHud(hud, `${Math.round(triangles).toLocaleString()} triangles · ${materials.size} materials · right-hand drive`);
const viewLabel = document.getElementById('view'); if (viewLabel) viewLabel.textContent = `${view} view${model === 'both' ? ' · original left / Blender right' : model === 'blender' ? ' · Blender pilot' : ''}`;
const dirt = document.querySelector('input');
if (dirt) {
  dirt.value = String(THREE.MathUtils.clamp(dirtParam, 0, 1));
  dirt.addEventListener('input', () => cars.forEach(c => c.setDirt(Number(dirt.value))));
}

const clock = new THREE.Clock();
let frames = 0;
function animate(): void {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  for (const c of cars) {
    for (const wheel of Object.values(c.wheels)) wheel.rotation.x = params.has('still') ? 0 : t * .28;
    const beaconMaterial = c.beacon.material;
    if (beaconMaterial instanceof THREE.MeshStandardMaterial) beaconMaterial.emissiveIntensity = params.has('still') ? .8 : Math.sin(t * 9) > .45 ? 3.2 : .25;
  }
  // ?flash=1 holds the Boss's roof box in the bright half of its amber flash.
  boss?.flash(params.get('flash') === '1', params.get('flash') === '1' ? 0 : t);
  controls.update(); renderer.render(scene, camera);
  if (++frames === 8) document.title = 'settled';
}
animate();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
