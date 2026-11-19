import { Mesher, type RGB } from './yard-kit';

type Point = [number, number, number];
type Fixture = {
  u: number; v: number; yaw: number; half: number; halfWidth: number;
  art: (m: Mesher, low: boolean) => void;
};

const steel: RGB = [.24, .28, .29];
const zinc: RGB = [.53, .58, .58];
const timber: RGB = [.29, .20, .13];
const rubber: RGB = [.03, .035, .036];
const ivory: RGB = [.76, .75, .67];
const glass: RGB = [.045, .10, .13];

// A beam with four faces. Use the local z axis so the same beam fits a ramp, stay or stand.
function beam(m: Mesher, a: Point, b: Point, width: number, colour: RGB): void {
  const [x, y, z] = b.map((value, i) => value - a[i]);
  const run = Math.hypot(x, z);
  m.at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2,
    Math.atan2(x, z), -Math.atan2(y, run));
  m.box(0, 0, 0, width, width, Math.hypot(run, y), colour);
}

// Mesh bars are flat ribbons. The existing double-sided wharf batch draws both sides.
function grid(m: Mesher, width: number, depth: number, bottom: number, height: number, colour: RGB, low: boolean): void {
  for (const side of [-1, 1]) {
    const x = side * width / 2, z = side * depth / 2;
    const stride = low ? .26 : .15;
    for (let px = -width / 2; px < width / 2; px += stride)
      m.quad([[px, bottom, z], [px + .019, bottom, z], [px + .019, bottom + height, z], [px, bottom + height, z]], colour);
    for (let pz = -depth / 2; pz < depth / 2; pz += stride)
      m.quad([[x, bottom, pz], [x, bottom, pz + .019], [x, bottom + height, pz + .019], [x, bottom + height, pz]], colour);
    for (const y of [bottom + .03, bottom + height * .53, bottom + height - .035]) {
      m.quad([[-width / 2, y, z], [width / 2, y, z], [width / 2, y + .024, z], [-width / 2, y + .024, z]], colour);
      m.quad([[x, y, -depth / 2], [x, y, depth / 2], [x, y + .024, depth / 2], [x, y + .024, -depth / 2]], colour);
    }
  }
}

function wireStack(count: number): Fixture['art'] {
  return (m, low) => {
    for (let i = 0; i < count; i++) {
      const y = i * .44;
      m.box(0, y + .025, 0, 1.07, .05, .67, timber);
      grid(m, 1.05, .65, y, .43, i % 2 ? zinc : [.31, .40, .34], low);
      m.box(0, y + .435, 0, 1.06, .024, .055, timber);
    }
  };
}

function roundStack(height: number): Fixture['art'] {
  return (m, low) => {
    const sides = low ? 7 : 10;
    const orange: RGB = [.78, .21, .038], faded: RGB = [.52, .126, .028];
    for (let y = .05; y < height; y += low ? .19 : .16) {
      m.cyl(0, y, 0, .60 - y * .06, .045, y < .37 ? faded : orange, 'y', sides, .60 - y * .06, null);
    }
    for (let i = 0; i < sides; i++) {
      const a = i * Math.PI * 2 / sides, x = Math.cos(a), z = Math.sin(a);
      m.quad([[x * .60, .02, z * .60], [x * .60 + .024, .02, z * .60],
        [x * .52 + .024, height, z * .52], [x * .52, height, z * .52]], orange);
    }
    m.cyl(0, height - .18, 0, .37, .023, [.16, .083, .042], 'y', sides);
  };
}

function boat(length: number, trim: RGB): Fixture['art'] {
  return (m, low) => {
    const frame = m.frame;
    const shape = [[-.5, .88, 1.55], [-.3, 1.17, 1.60], [.10, 1.18, 1.71], [.38, .73, 2.05], [.50, .02, 2.22]];
    for (let i = 1; i < shape.length; i++) {
      const [a, aw, ar] = shape[i - 1], [b, bw, br] = shape[i];
      for (const sign of [-1, 1]) {
        const x1 = aw * sign, x2 = bw * sign, z1 = a * length, z2 = b * length;
        m.quad([[0, .34, z1], [0, .34, z2], [x2, 1.06, z2], [x1, 1.06, z1]], trim);
        m.quad([[x1, 1.06, z1], [x2, 1.06, z2], [x2, br, z2], [x1, ar, z1]], ivory);
        m.quad([[x1, ar, z1], [x2, br, z2], [x2, br + .065, z2], [x1, ar + .065, z1]], trim);
      }
      m.quad([[-aw, 1.52, a * length], [aw, 1.52, a * length], [bw, 1.52, b * length], [-bw, 1.52, b * length]], timber);
    }
    m.quad([[-.02, 1.06, length * .5], [.02, 1.06, length * .5],
      [.02, 2.22, length * .5], [-.02, 2.22, length * .5]], ivory);
    m.box(0, 1.20, -length * .5, 1.76, .73, .08, ivory);
    m.box(0, 2.17, length * .19, 1.65, 1.30, length * .25, ivory);
    m.box(0, 2.88, length * .19, 1.83, .19, length * .28, trim);
    for (const side of [-1, 1]) m.box(side * .831, 2.43, length * .19, .02, .37, length * .19, glass);
    for (const x of [-.51, 0, .51]) m.box(x, 2.43, length * .317, .45, .37, .02, glass);
    m.cyl(.30, 3.40, length * .16, .027, 1.05, ivory, 'y', 5);
    m.box(.30, 3.65, length * .16, 1.08, .07, .07, ivory);
    for (const z of [-length * .29, length * .24]) {
      m.box(0, .13, z, .75, .48, .41, timber);
      for (const side of [-1, 1]) {
        m.within(frame, side * .79, .45, z, 0, 0, side * .57);
        m.box(0, 0, 0, .16, 1.02, .16, steel);
        m.within(frame, 0, 0, 0);
        m.box(side * 1.04, -.02, z, .45, .1, .40, timber);
      }
    }
    if (!low) m.box(-.52, 1.73, -length * .26, .65, .48, .73, trim);
  };
}

function trailer(boxed: boolean): Fixture['art'] {
  return (m, low) => {
    m.box(0, .59, 0, 2.18, .18, 5.25, timber);
    m.box(0, .46, 0, 1.98, .15, 5.3, steel);
    const frame = m.frame;
    m.within(frame, 0, .43, 2.54, 0, Math.PI / 2);
    m.extrude([[-.72, 0], [.72, 0], [0, 1.16]], -.045, .045, steel);
    m.within(frame, 0, 0, 0);
    m.box(0, .43, 3.65, .16, .095, .22, steel);
    m.box(0, .25, 2.91, .10, .5, .12, steel);
    for (const side of [-1, 1]) {
      for (const z of [-1.03, -.26]) {
        m.cyl(side * 1.02, .34, z, .34, .24, rubber, 'x', low ? 6 : 9);
        m.cyl(side * 1.15, .34, z, .16, .026, zinc, 'x', 6);
      }
      m.box(side * .85, .63, -2.63, .19, .10, .03, [.61, .048, .031]);
    }
    if (boxed) {
      m.box(0, 1.79, -.05, 2.12, 2.27, 5.12, ivory);
      for (const x of [-.98, 0, .98]) m.box(x, 1.77, -2.62, .045, 2.19, .04, zinc);
    } else {
      for (const x of [-1.05, 1.05]) m.box(x, .71, 0, .07, .14, 5.2, steel);
      m.box(0, .68, -1.55, 1.96, .024, .04, steel);
      m.box(0, .68, .60, 1.96, .024, .04, steel);
    }
  };
}

function lamp(height: number): Fixture['art'] {
  return (m, low) => {
    m.cyl(0, height / 2 - .11, 0, .15, height + .22, timber, 'y', low ? 5 : 7, .085);
    m.box(0, height - .18, 0, .73, .065, .075, steel);
    for (const x of [-.34, .34]) {
      m.box(x, height - .16, .03, .22, .15, .16, steel);
      m.box(x, height - .225, .09, .18, .035, .14, ivory);
    }
  };
}

function tote(m: Mesher, w: number, d: number, h: number, colour: RGB): void {
  m.box(0, .07, 0, w, .15, d, colour);
  for (const s of [-1, 1]) {
    m.box(s * (w / 2 - .035), h / 2, 0, .07, h, d, colour);
    m.box(0, h / 2, s * (d / 2 - .035), w, h, .07, colour);
  }
}

const bin: Fixture['art'] = m => {
  const green: RGB = [.30, .68, .048];
  m.box(0, .62, 0, 2, 1.13, 1.50, green);
  m.box(0, 1.27, 0, 2.08, .16, 1.56, [.24, .47, .057]);
  for (const x of [-.70, .70]) m.box(x, .65, .76, .18, .75, .08, [.23, .48, .029]);
};
const tank: Fixture['art'] = (m, low) => {
  m.box(0, .07, 0, 1.15, .16, .98, rubber);
  m.box(0, .60, 0, 1.06, .91, .90, ivory);
  m.cyl(0, 1.08, 0, .11, .10, rubber, 'y', 6);
  grid(m, 1.15, .98, .15, .94, steel, low);
};
const tub: Fixture['art'] = m => tote(m, 1.15, .86, .72, [.045, .27, .60]);
const crates: Fixture['art'] = m => {
  const frame = m.frame;
  for (const x of [-.46, .46]) for (const y of [0, .30]) {
    m.within(frame, x, y, 0);
    tote(m, .82, .57, .31, [.76, .55, .027]);
  }
};

function fixture(u: number, v: number, half: number, halfWidth: number, art: Fixture['art'], yaw = 0): Fixture {
  return { u, v, half, halfWidth, art, yaw };
}

// Local metres east and south of the wharf origin. The centre aisle and its turning space stay open.
export const WHARF_FIXTURES: readonly Fixture[] = [
  fixture(44, -3.5, 4.4, 1.18, boat(8.8, [.075, .22, .41])),
  fixture(50, -3.5, 4.1, 1.18, boat(8.2, [.14, .26, .19]), .09),
  fixture(56, -3.4, 4.35, 1.18, boat(8.7, [.36, .14, .10]), -.05),
  fixture(62, -3.8, 3.9, 1.18, boat(7.8, [.09, .25, .41])),
  fixture(53, -17, 3.8, 1.18, trailer(true), Math.PI / 2),
  fixture(62, -16, 3.8, 1.18, trailer(false), Math.PI / 2),
  ...[13.5, 14.8, 16.1, 17.4, 18.7].map((u, i) => fixture(u, -3.1, .60, .60, roundStack(1.04 + (i % 3) * .17))),
  ...[22.5, 24.9, 27.3, 29.7].flatMap((u, i) => [
    fixture(u, -3.05, .36, .55, wireStack(i % 2 ? 2 : 3)),
    fixture(u + .45, -4.45, .36, .55, wireStack(i % 2 ? 3 : 2)),
  ]),
  fixture(-12.4, 10.8, .8, 1.04, bin),
  fixture(-8.2, 17.7, .51, .59, tank),
  fixture(-9.6, 17.4, .45, .60, tub),
  fixture(-7.9, 8.6, .45, .60, tub, .28),
  fixture(20.4, -3.6, .31, .89, crates),
  fixture(65, 14, .16, .16, lamp(7.1)),
  fixture(73, 32, .16, .16, lamp(6.5)),
  fixture(76, 59, .16, .16, lamp(7.4)),
  fixture(7, -6, .16, .16, lamp(7.7)),
];

const gangways = [{ u: 71, v: 27 }, { u: 71, v: 47 }];
export const WHARF_ANCHORS = [...WHARF_FIXTURES, ...gangways];

export function addWharfProps(m: Mesher, ground: readonly number[], deck: number, sea: number, low: boolean): void {
  for (const [i, prop] of WHARF_FIXTURES.entries()) {
    m.at(prop.u, ground[i], prop.v, prop.yaw);
    prop.art(m, low);
  }

  // Hoist on the inner edge of the working pier. The hook hangs clear over the basin.
  const u = 11.55, v = 16.0, mast = deck + 5.6;
  const head: Point = [u + 4.5, deck + 4.5, v + 1.65];
  m.at(u, deck, v);
  m.box(0, .09, 0, .71, .18, .62, steel);
  m.cyl(0, 2.8, 0, .14, 5.6, steel, 'y', 7, .10);
  beam(m, [u, deck + .74, v], head, .15, steel);
  for (const side of [-1, 1]) beam(m, [u, mast - .18, v + side * .18], [head[0], head[1], head[2] + side * .08], .029, steel);
  beam(m, head, [head[0], deck + 1.22, head[2]], .024, rubber);
  m.at(head[0], deck + 1.22, head[2]);
  m.extrude([[-.14, 0], [.04, 0], [.04, -.17], [-.08, -.26], [-.25, -.20], [-.27, -.04], [-.19, -.08], [-.17, -.14], [-.09, -.15]], -.04, .04, steel);

  for (const [i, { u, v }] of gangways.entries()) {
    const land = ground[WHARF_FIXTURES.length + i] + .10, float = sea + .33;
    const near = u - 6.2, deckWidth = 1.13;
    m.at(near - .13, sea + .135, v + 2.2);
    m.box(0, .04, 0, 2.04, .31, 9.2, timber);
    m.box(0, -.14, 0, 1.98, .20, 9.0, rubber);
    for (const z of [-3.9, -1.9, .1, 2.1, 4.1]) m.box(0, .202, z, 1.98, .012, .045, [.47, .37, .26]);
    const slope = (land - float) / (u - near);
    m.at((near + u) / 2, (float + land) / 2, v, 0, 0, Math.atan(slope));
    m.box(0, -.04, 0, Math.hypot(u - near, land - float), .08, deckWidth, zinc);
    for (const side of [-1, 1]) {
      const z = v + side * deckWidth / 2;
      beam(m, [near, float + .83, z], [u, land + .83, z], .056, zinc);
      for (let j = 0; j < 5; j++) {
        const x = near + (u - near) * j / 5, h = float + (land - float) * j / 5;
        const nx = near + (u - near) * (j + 1) / 5, nh = float + (land - float) * (j + 1) / 5;
        beam(m, [x, h, z], [nx, nh + .83, z], .045, zinc);
        if (j === 0) beam(m, [x, h, z], [x, h + .83, z], .056, zinc);
      }
      beam(m, [u, land, z], [u, land + .83, z], .056, zinc);
    }
  }
  m.at(0, 0, 0);
}
