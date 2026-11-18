import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AnimalSpecies } from './road-animal-rules';

/** Hip height and leg spread (metres) per species; the hoof/paw soles sit at y = 0. Nose is local -Z. */
export const ANIMAL_LOOK = Object.freeze({
  deer: { hip: .95, legX: .19, legZ: .42 },
  fox: { hip: .32, legX: .08, legZ: .2 },
  moose: { hip: 1.55, legX: .3, legZ: .7 },
} satisfies Record<AnimalSpecies, { hip: number; legX: number; legZ: number }>);

/** One vertex-coloured geometry and one draw per species, regardless of animal count. */
export function roadAnimalMesh(species: AnimalSpecies, count: number): THREE.InstancedMesh {
  const parts: THREE.BufferGeometry[] = [];
  function part(colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(sx, sy, sz); g.translate(x, y, z);
    const c = new THREE.Color(colour), values: number[] = [];
    for (let i = 0; i < g.attributes.position.count; i++) { const shade = .91 + (Math.floor(i / 3) % 5) * .025; values.push(c.r * shade, c.g * shade, c.b * shade); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(values, 3)); parts.push(g);
  }
  const { hip, legX, legZ } = ANIMAL_LOOK[species];
  if (species === 'deer') {
    // A white-tailed doe: tan coat, pale belly and throat, white tail.
    const coat = 0x95704c, pale = 0xd9c3a1, dark = 0x352d28;
    part(coat, 0, hip, 0, .28, .35, .67);
    part(pale, 0, hip + .15, -.42, .25, .31, .28);
    part(coat, 0, hip + .48, -.65, .16, .42, .19);
    part(coat, 0, hip + .78, -.82, .19, .2, .26);
    part(dark, 0, hip + .72, -1.02, .12, .09, .09);
    for (const side of [-1, 1]) {
      part(coat, side * .22, hip + .96, -.78, .1, .23, .09);
      part(dark, side * .165, hip + .83, -.93, .027, .027, .027);
      for (const rear of [-1, 1]) {
        part(coat, side * legX, hip * .48, rear * legZ, .065, hip * .5, .07);
        part(dark, side * legX, .07, rear * legZ - .02, .075, .07, .1);
      }
    }
    part(0xe6dccb, 0, hip + .13, .65, .1, .12, .17);
  } else if (species === 'fox') {
    // A red fox: rust coat, black stockings, white chest and tail tip.
    const coat = 0xb4552a, white = 0xe8e0d2, dark = 0x2a221e;
    part(coat, 0, hip, 0, .11, .12, .3);
    part(white, 0, hip - .02, -.24, .08, .1, .09);
    part(coat, 0, hip + .14, -.34, .1, .09, .11);
    part(coat, 0, hip + .12, -.46, .045, .045, .09);
    part(dark, 0, hip + .12, -.55, .02, .02, .02);
    for (const side of [-1, 1]) {
      part(dark, side * .055, hip + .25, -.32, .03, .06, .02);
      part(dark, side * .045, hip + .17, -.43, .012, .012, .012);
      for (const rear of [-1, 1]) {
        part(dark, side * legX, hip * .5, rear * legZ, .025, hip * .5, .028);
        part(dark, side * legX, .02, rear * legZ - .02, .03, .02, .04);
      }
    }
    part(coat, 0, hip + .02, .42, .07, .07, .2);
    part(white, 0, hip - .02, .6, .045, .045, .06);
  } else {
    // A cow moose: dark brown, long pale legs, high shoulder hump, long muzzle, a short bell. No antlers.
    const coat = 0x3f2c20, leg = 0x8a7660, dark = 0x1d1714;
    part(coat, 0, hip + .1, 0, .45, .55, 1.15);
    part(coat, 0, hip + .45, -.55, .4, .45, .45);
    part(coat, 0, hip + .45, -1.15, .2, .3, .25);
    part(coat, 0, hip + .45, -1.5, .17, .2, .34);
    part(dark, 0, hip + .38, -1.82, .12, .14, .1);
    part(dark, 0, hip + .02, -1.32, .05, .16, .05);
    for (const side of [-1, 1]) {
      part(coat, side * .14, hip + .72, -1.35, .06, .15, .04);
      part(dark, side * .14, hip + .52, -1.55, .03, .03, .03);
      for (const rear of [-1, 1]) {
        part(leg, side * legX, hip * .5, rear * legZ, .085, hip * .52, .09);
        part(dark, side * legX, .06, rear * legZ - .03, .09, .06, .12);
      }
    }
  }
  const geometry = mergeGeometries(parts); for (const p of parts) p.dispose();
  if (!geometry) throw new Error('Road animal parts need common attributes');
  const gait: number[] = [];
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) gait.push(positions.getY(i) < hip * .75 ? (positions.getX(i) * positions.getZ(i) > 0 ? 1 : -1) * (1 - positions.getY(i) / hip) : 0);
  geometry.setAttribute('gait', new THREE.Float32BufferAttribute(gait, 1));
  geometry.setAttribute('stride', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  // stride.y is the stride reach in metres (ANIMAL_LOOK hip * .19 while moving, else 0), so all species share one program.
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float gait; attribute vec2 stride;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed.z += gait * sin(stride.x) * stride.y;');
  };
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = `Road ${species}`; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // No shadow pass: the one-draw contract includes shadow rendering.
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.count = 0; mesh.visible = false;
  return mesh;
}
