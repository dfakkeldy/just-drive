import { setHud } from './hud-text';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCar } from './car';
import { createTruck } from './truck';
import { createSxs } from './sxs';

const params = new URLSearchParams(location.search);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7cbd2);
scene.fog = new THREE.Fog(0xb7cbd2, 45, 120);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
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
scene.add(new THREE.HemisphereLight(0xe0f0ff, 0x665d48, 2.1));
const sun = new THREE.DirectionalLight(0xffe2b5, 3.1);
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
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 3.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = .002; scene.add(shadow);
const car = createSxs(); scene.add(car.root);
if (params.get('pair') === '1') { const other = createCar(), truck = createTruck(); other.root.position.x = -2.8; truck.root.position.x = 3.4; scene.add(other.root, truck.root); }
const view = params.get('view') ?? 'front';
document.body.dataset.view = view;
switch (view) {
  case 'rear': camera.position.set(-4, 2.1, 5); break;
  case 'side': camera.position.set(-6.5, 2.0, .0); break;
  case 'top': camera.position.set(0, 8, .01); controls.target.y = .6; break;
  case 'driver':
    car.root.updateMatrixWorld(true); car.driverEye.getWorldPosition(camera.position);
    controls.target.copy(camera.position).add(new THREE.Vector3(-.09, -.10, -2));
    controls.enabled = false; controls.minDistance = .05; camera.fov = 75; camera.updateProjectionMatrix(); break;
  case 'suspension': camera.position.set(-.12, .72, -3.2); controls.target.set(-.58,.63,-1.3); controls.minDistance=.1; break;
  case 'far': camera.position.set(18, 8, -23); break;
  default: camera.position.set(-4.2, 2.7, -5.5);
}
if (params.get('pair') === '1') { controls.target.set(.4, .95, 0); camera.position.set(-8.5, 5.2, -11.5); }
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
Object.assign(window, { sxsPreview: { car, scene, camera, controls, renderer, triangles, materials: materials.size } });
const hud = document.getElementById('hud');
if (triangles > 40000 || materials.size > 8) throw new Error('The side by side exceeds its geometry or material budget.');
if (hud) setHud(hud, `${Math.round(triangles).toLocaleString()} triangles · ${materials.size} materials · left-hand drive`);
const viewLabel = document.getElementById('view'); if (viewLabel) viewLabel.textContent = `${view} view`;
const clock = new THREE.Clock();
let frames = 0;
function animate(): void {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  for (const wheel of [...Object.values(car.wheels), ...car.extraWheels ?? []]) wheel.rotation.x = t * .28;
  controls.update(); renderer.render(scene, camera);
  if (++frames === 8) document.title = 'settled';
}
animate();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
