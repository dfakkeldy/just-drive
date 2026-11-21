import * as THREE from 'three';
import type { Kit } from './site-kit';

export type Flag = 'canada' | 'nova-scotia';

const RED = 0xd52b1e;
const WHITE = 0xffffff;
const BLUE = 0x23458f;
const GOLD = 0xe2b52b;

type Point = readonly [number, number];
type Outline = readonly Point[];

// Maple leaf from Wikimedia Commons' public-domain Flag of Canada (Pantone).svg.
// https://commons.wikimedia.org/wiki/File:Flag_of_Canada_(Pantone).svg
// The path uses a 4800-unit white square. Centre it, flip y, and use a single
// point between the endpoints of each small rounding arc at this scale.
const MAPLE_LEAF: Outline = [
  [90, -2030], [100.5, -1118], [1015, -1220], [909, -863.5],
  [1860, -65], [1631, 73.5], [1800, 685], [1221.5, 589],
  [1080, 855], [601.5, 429.5], [750, 1510], [377.5, 1334.5],
  [0, 2000], [-377.5, 1334.5], [-750, 1510], [-601.5, 429.5],
  [-1080, 855], [-1221.5, 589], [-1800, 685], [-1631, 73.5],
  [-1860, -65], [-909, -863.5], [-1015, -1220], [-100.5, -1118], [-90, -2030],
].map(([x, y]) => [x / 4800, y / 4800]);

const rect = (left: number, right: number): Outline => [
  [left, -0.5], [right, -0.5], [right, 0.5], [left, 0.5],
];

// The bottom edge of the shield meets the saltire at this point.
const JOIN_Y = -0.0327 / 0.23;
const JOIN_X = -2 * (JOIN_Y + 0.105);
const SHIELD: Outline = [
  [-0.15, 0.18], [0.15, 0.18], [0.14, -0.03], [0.09, -0.13],
  [0, -0.20], [-0.09, -0.13], [-0.14, -0.03],
];
const SHIELD_EDGE: Outline = [
  ...SHIELD.slice(0, 4), [JOIN_X, JOIN_Y], SHIELD[4], [-JOIN_X, JOIN_Y], ...SHIELD.slice(5),
];
const SHIELD_INSET: Outline = SHIELD.map(([x, y]) => [x * 0.83, y * 0.86]);
// Simplified lion rampant, with raised paws and a curled tail.
const LION: Outline = [
  [-0.068, 0.119], [-0.018, 0.126], [0.020, 0.068], [0.065, 0.040],
  [0.085, 0.080], [0.067, 0.118], [0.094, 0.107], [0.106, 0.075],
  [0.087, 0.014], [0.043, -0.015], [0.060, -0.062], [0.036, -0.101],
  [0.009, -0.092], [0.027, -0.057], [-0.002, -0.034], [-0.041, -0.078],
  [-0.072, -0.064], [-0.040, -0.016], [-0.037, 0.028], [-0.093, 0.012],
  [-0.102, 0.042], [-0.054, 0.056], [-0.099, 0.070], [-0.085, 0.092],
  [-0.044, 0.079], [-0.036, 0.098], [-0.074, 0.099],
];

function polygon(path: THREE.Path, points: Outline, height: number): void {
  const [[x, y], ...rest] = points;
  path.moveTo(x * height, y * height);
  for (const [x, y] of rest) path.lineTo(x * height, y * height);
  path.closePath();
}

/** Add cloth to the kit's existing two-sided plain mesh. The cloth flies along local +z. */
export function addFlag<T extends string>(
  k: Kit<T>, flag: Flag, x: number, y: number, hoist: number, height: number,
): void {
  const piece = (outline: Outline, color: number, cutout?: Outline) => {
    const shape = new THREE.Shape();
    polygon(shape, outline, height);
    if (cutout) {
      const hole = new THREE.Path();
      polygon(hole, cutout, height);
      shape.holes.push(hole);
    }
    k.add(new THREE.ShapeGeometry(shape), color, null,
      k.matrix(x, y, hoist + height, { ry: -Math.PI / 2 }));
  };

  if (flag === 'canada') {
    piece(rect(-1, -0.5), RED);
    piece(rect(-0.5, 0.5), WHITE, MAPLE_LEAF);
    piece(MAPLE_LEAF, RED);
    piece(rect(0.5, 1), RED);
    return;
  }

  // Split the saltire at the shield. Every colour shares edges in the same plane.
  piece([[-0.79, 0.5], [0.79, 0.5], SHIELD[1], SHIELD[0]], WHITE);
  piece([[-0.79, -0.5], [0.79, -0.5], [JOIN_X, JOIN_Y], SHIELD[4], [-JOIN_X, JOIN_Y]], WHITE);
  const sideWhite: Outline = [[1, -0.395], [1, 0.395], [0.21, 0]];
  const sideBlue: Outline = [
    SHIELD[1], [0.79, 0.5], [1, 0.5], [1, 0.395], [0.21, 0],
    [1, -0.395], [1, -0.5], [0.79, -0.5], [JOIN_X, JOIN_Y], SHIELD[3], SHIELD[2],
  ];
  for (const sign of [-1, 1]) {
    piece(sideWhite.map(([x, y]) => [x * sign, y]), WHITE);
    piece(sideBlue.map(([x, y]) => [x * sign, y]), BLUE);
  }
  piece(SHIELD_EDGE, RED, SHIELD_INSET);
  piece(SHIELD_INSET, GOLD, LION);
  piece(LION, RED);
}
