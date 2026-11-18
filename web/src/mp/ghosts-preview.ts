import { setHud } from '../hud-text';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCar } from '../car';
import { Ghosts } from './ghosts';
import { FLAG, type PeerView } from './wire';

const params = new URLSearchParams(location.search), low = params.get('low') === '1';
const n = Math.max(0, Math.min(48, Number(params.get('n') ?? (low ? 6 : 16))));
const view = params.get('view') ?? 'all', still = params.get('still') === '1';
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc4d6df);
const renderer = new THREE.WebGLRenderer({ antialias: !low, logarithmicDepthBuffer: !low });
renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(view === 'far' ? 40 : 48, innerWidth / innerHeight, .3, 2000);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true;
if (view === 'far') { camera.position.set(0, 5, 15); controls.target.set(0, 1, -85); }
else if (view === 'near' || view === 'fade') { camera.position.set(25, 10, 22); controls.target.set(0, .9, -9); }
else { camera.position.set(42, 65, 52); controls.target.set(0, 0, -5); }
camera.lookAt(controls.target);
scene.add(new THREE.HemisphereLight(0xe0f0ff, 0x665d48, 2.1));
const sun = new THREE.DirectionalLight(0xffe2b5, 3.1); sun.position.set(-6, 8, 5); scene.add(sun);
function ground(x: number, z: number): number {
  const slope = Math.max(0, Math.min(4, (x - 10) * .14));
  return slope + 1.8 * Math.exp(-((x + 16) ** 2 + (z + 10) ** 2) / 45);
}
const landGeometry = new THREE.PlaneGeometry(360, 360, 180, 180).rotateX(-Math.PI / 2);
const positions = landGeometry.getAttribute('position');
for (let i = 0; i < positions.count; i++) positions.setY(i, ground(positions.getX(i), positions.getZ(i)) - .012);
landGeometry.computeVertexNormals();
const land = new THREE.Mesh(landGeometry, new THREE.MeshStandardMaterial({ color: 0x8d9887, roughness: 1 })); scene.add(land);
const grid = new THREE.GridHelper(360, 72, 0x647268, 0x839080); grid.position.y = .006; scene.add(grid);
const car = createCar(); car.setDirt(.15); scene.add(car.root);
const ghosts = new Ghosts({ ground, low, cap: params.has('cap') ? Number(params.get('cap')) : undefined }); scene.add(ghosts.group);
const peers: PeerView[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Loose Gravel ${i + 1}`, hue: i % 8,
  x: 0, z: 0, heading: 0, speed: 7, steer: .15, air: 0, flags: 0, alpha: 1 }));
function drive(t: number): void {
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i], a = t * .12 + i * Math.PI * 2 / Math.max(1, n), r = 14 + i % 3 * 10;
    if (view === 'near' || view === 'fade') {
      p.x = [-10, 0, 11][i % 3]; p.z = [-8, -17, -26][i % 3]; p.heading = [.4, -1.1, 2.1][i % 3];
    } else if (view === 'far') {
      p.z = -60 - i * 16; p.x = (i - 2.5) * .22 * (15 - p.z) * Math.tan(Math.PI / 9) * camera.aspect; p.heading = i * .7;
    } else {
      p.x = r * Math.cos(a); p.z = (i % 2 ? Math.sin(a * 2) : Math.sin(a)) * r - 6;
      p.heading = Math.atan2(-Math.sin(a), -(i % 2 ? 2 * Math.cos(2 * a) : Math.cos(a)));
    }
    p.flags = i % 3 === 0 ? FLAG.brake : 0;
    p.air = i === 4 ? Math.max(0, Math.sin(t * 1.8)) * 2 : 0;
    p.alpha = i === 1 ? (view === 'fade' ? .5 : Math.max(0, Math.min(1, .5 + .7 * Math.sin(t)))) : 1;
  }
}
const stats = { calls: 0, triangles: 0, drawn: 0, perCar: 0, logDepth: renderer.capabilities.logarithmicDepthBuffer };
function measure(): void {
  land.visible = grid.visible = car.root.visible = false;
  renderer.render(scene, camera);
  stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles; stats.drawn = ghosts.drawn;
  land.visible = grid.visible = car.root.visible = true;
  const mesh = ghosts.group.children[0] as THREE.InstancedMesh;
  stats.perCar = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
}
let frozen = false, frame = 0;
const clock = new THREE.Clock();
function animate(): void {
  requestAnimationFrame(animate); if (frozen) return;
  const dt = Math.min(.05, clock.getDelta()), t = still ? .8 : clock.elapsedTime;
  drive(t); controls.update(); ghosts.update(dt, peers, camera); measure(); renderer.render(scene, camera);
  setHud(document.getElementById('hud')!, `${low ? 'Phone' : 'Desktop'} · log depth ${!low ? 'on' : 'off'} · ${ghosts.drawn}/${n} cars\nGhosts + labels: ${stats.calls} draw calls · ${stats.triangles} triangles\n${stats.perCar} triangles per car · slope at right · bump at left`);
  if (++frame === 8) document.title = 'settled';
}
Object.assign(window, { ghostsPreview: { THREE, Ghosts, FLAG, ghosts, peers, camera, renderer, scene, stats, measure,
  freeze: () => { frozen = true; }, render: () => { ghosts.update(1 / 60, peers, camera); measure(); renderer.render(scene, camera); } } });
animate();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
