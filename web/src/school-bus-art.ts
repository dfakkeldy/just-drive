import * as THREE from 'three';
import { Mesher, type RGB } from './yard-kit';

const YELLOW: RGB = [.96, .57, .035], BLACK: RGB = [.025, .028, .032], GLASS: RGB = [.07, .14, .19];
const WHITE: RGB = [.94, .93, .86], RED: RGB = [.65, .015, .012];
function mesh(m: Mesher): THREE.Mesh {
  return new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}
/** Generic yellow bus. No institution, district, maker, registration or route number. Nose is -Z. */
export function schoolBusArt() {
  const m = new Mesher();
  m.box(0, 1.1, .55, 2.4, .8, 7.5, YELLOW);
  m.box(0, 2.12, .55, 2.4, 1.35, 7.5, YELLOW);
  m.box(0, 2.86, .55, 2.26, .16, 7.42, YELLOW);
  m.box(0, 1.18, -3.7, 2.18, .65, 1.2, YELLOW);
  m.box(0, .7, -4.32, 2.5, .22, .16, BLACK);
  m.box(0, .7, 4.32, 2.5, .22, .16, BLACK);
  m.box(0, 2.15, -3.215, 2.05, .86, .025, GLASS);
  m.box(0, 2.12, 4.315, 1.7, .8, .025, GLASS);
  m.box(0, 1.15, -4.31, .85, .35, .02, BLACK);
  for (const side of [-1, 1]) {
    for (const z of [-2.55, -1.52, -.49, .54, 1.57, 2.6, 3.63]) m.box(side * 1.21, 2.18, z, .025, .83, .85, GLASS);
    for (const y of [1.02, 1.32, 1.6]) m.box(side * 1.214, y, .55, .03, .065, 7.5, BLACK);
    m.box(side * .82, 1.25, -4.32, .4, .22, .03, WHITE);
    m.box(side * .92, 1.08, 4.33, .2, .32, .025, RED);
    m.box(side * 1.35, 2.25, -3.4, .12, .35, .25, BLACK);
    for (const z of [-2.6, 2.65]) {
      m.cyl(side * 1.06, .52, z, .52, .34, BLACK, 'x', 12);
      m.cyl(side * 1.24, .52, z, .25, .025, [.35, .36, .36], 'x', 12);
    }
  }
  // Door on the right; plain front/rear header panels remain yellow.
  m.box(1.225, 1.67, -2.53, .026, 1.86, .9, BLACK);
  for (const z of [-2.75, -2.31]) m.box(1.245, 1.97, z, .024, 1.1, .35, GLASS);
  const body = mesh(m), root = new THREE.Group(); root.name = 'School bus'; root.add(body);
  const lamps = [-1, 1].map(side => {
    const lights = new Mesher();
    for (const z of [-3.23, 4.33]) lights.cyl(side * .88, 2.7, z, .15, .035, [1, .015, .005], 'z', 12);
    const lamp = new THREE.Mesh(lights.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    root.add(lamp); return lamp;
  });
  const arm = new THREE.Group(); arm.position.set(-1.23, 1.8, -1.85);
  const sign = new Mesher();
  sign.box(-.4, 0, 0, .8, .07, .06, BLACK);
  sign.cyl(-.76, 0, 0, .41, .06, WHITE, 'z', 8);
  sign.cyl(-.76, 0, 0, .365, .075, RED, 'z', 8);
  // Small block letters are geometry on both faces, with no texture or DOM work.
  const letters = ['111100111001111', '111010010010010', '111101101101111', '110101110100100'];
  for (let l = 0; l < letters.length; l++) for (let i = 0; i < 15; i++) if (letters[l][i] === '1') {
    for (const face of [-1, 1]) {
      const x = -1.02 + l * .14 + (i % 3) * .037;
      sign.box(face < 0 ? -1.52 - x : x, .08 - Math.floor(i / 3) * .04, face * .045, .032, .035, .01, WHITE);
    }
  }
  arm.add(mesh(sign)); root.add(arm); arm.visible = false;
  return { root, body, lamps, arm };
}
