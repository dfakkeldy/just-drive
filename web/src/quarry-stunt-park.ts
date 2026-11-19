import { smooth } from './coast-site';
import type { Place } from './places';
import { COURSE_PADS, onCoursePad } from './quarry-site';
import { StuntPark, type StuntPiece, type StuntRunup } from './stunt-kit';
import { edgeStacks, floodMast, laneArrow, lineFurniture, lineMarker, pitArea, startArch, timingHut, type DressingPiece } from './stunt-dressing';
import { archTunnel, footbridge, gapPair, slipKicker, stepDown, tableTop, tankRow, whoops } from './stunt-pieces';
import type { Terrain } from './terrain';

const [upper, lower] = COURSE_PADS;
const north = 0, east = Math.PI / 2;
const parkName = 'Sugar Camp';
const upperStart = { e: upper.e - 31, n: upper.n - 72, heading: north };
const lowerStart = { e: lower.e - 43, n: lower.n - 46, heading: east };

export function quarryCoursePlaces(): Place[] {
  return [
    { id: 'sugar-camp-upper', name: 'Sugar Camp upper course', start: upperStart },
    { id: 'sugar-camp-lower', name: 'Sugar Camp lower course', start: lowerStart },
  ].map(({ id, name, start }) => ({
    id, name, start, e: start.e, n: start.n, area: 'westbay', kind: 'site',
    note: 'Start on the practice run-up at the invented off-road park.',
    sources: ['src/quarry-stunt-park.ts'],
  }));
}

export function createQuarryStuntPark(terrain: Terrain, low: boolean): StuntPark {
  const [originE, originN] = terrain.manifest.village;
  const world = (pad: typeof COURSE_PADS[number], e: number, n: number) => ({
    x: pad.e + e - originE, z: originN - pad.n - n,
  });
  const put = <T extends StuntPiece | DressingPiece>(
    piece: T, pad: typeof COURSE_PADS[number], e: number, n: number, heading: number,
  ) => ({ ...world(pad, e, n), piece, heading });

  const pieces = [
    // The rolling practice line has a braking zone before the whoops and a return beside it.
    put(tableTop(), upper, -31, -48, north),
    put(whoops(), upper, -31, 4, north),
    put(whoops(true), upper, -55, -52, north),
    put(archTunnel(), upper, -55, 27, east),
    // Independent lanes. The tank row sits under the eight-metre gap.
    put(slipKicker('medium'), upper, -9, -48, north),
    put(slipKicker('large'), upper, 13, -48, north),
    put(gapPair(8, true), upper, 35, -48, north),
    put(tankRow(), upper, 35, -22, north),
    put(stepDown(2.4), upper, 57, -48, north),
    // The lower bench is level. The narrow footbridge has its own bike line.
    put(slipKicker('small'), lower, -19, -46, east),
    put(stepDown(.8), lower, -24, -24, east),
    put(gapPair(4), lower, -24, -2, east),
    put(stepDown(1.6), lower, -24, 20, east),
    put(footbridge(), lower, -54, 44, east),
  ];

  const dressing = [
    put(startArch(parkName, 8.05), upper, -31, -62, north),
    put(startArch(parkName, 8.05), lower, -34, -46, east),
    put(timingHut(), upper, -42, -72, north),
    put(pitArea(), upper, -17, -69, north),
    put(floodMast(), upper, -43, -58, north),
    put(floodMast(), lower, -40, -34, east),
    put(lineFurniture(21, 12, true), upper, -31, -79, north),
    put(lineFurniture(23, 12, true), lower, -46, -46, east),
    put(lineFurniture(22, 12, false), upper, 35, -81, north),
    put(lineMarker(true), upper, -23, -55, north),
    put(lineMarker(false), upper, 43, -58, north),
    put(lineMarker(true), lower, -27, -38, east),
    put(lineMarker(false), lower, -34, 28, east),
    put(laneArrow(true), upper, -31, -56, north),
    put(laneArrow(false), upper, 35, -57, north),
    put(laneArrow(true), lower, -26, -46, east),
    put(laneArrow(false), lower, -36, 20, east),
    put(edgeStacks(8), upper, 45, 6, north),
    put(edgeStacks(8, true), lower, 31, -35, east),
  ];

  const runups: StuntRunup[] = [];
  for (const e of [-55, -31, -9, 13, 35, 57]) {
    runups.push({
      ...world(upper, e, 0), heading: north, from: -88,
      to: e === -55 ? -27 : 56, halfWidth: 5.5, canopyMargin: 16,
    });
  }
  for (const n of [-46, -24, -2, 20]) {
    runups.push({
      ...world(lower, 0, n), heading: east, from: -65, to: 62,
      halfWidth: 5.5, canopyMargin: 16,
    });
  }

  const park = new StuntPark(terrain, pieces, low, [], dressing, runups, {
    contains: (x, z, margin) => onCoursePad(x + originE, originN - z, margin),
    intersectsTile(x, z, size) {
      const west = x + originE, north = originN - z;
      return COURSE_PADS.some(pad => west < pad.e + pad.halfE && west + size > pad.e - pad.halfE
        && north > pad.n - pad.halfN && north - size < pad.n + pad.halfN);
    },
    height(x, z, surveyed) {
      const e = x + originE, n = originN - z;
      // Follow the upper bench's fall across the park. The lower bench needs only a light skim.
      for (const pad of COURSE_PADS) {
        const offset = n - pad.n;
        const side = e - pad.e;
        const insetE = pad.halfE - Math.abs(side), insetN = pad.halfN - Math.abs(offset);
        if (insetE <= 0 || insetN <= 0) continue;
        const grade = pad === upper ? 72.4 - .034 * offset : 60.05;
        // The ground rises beyond the tunnel. Taper the grade before the north-west bank.
        const blendE = pad === upper && side < 0 ? 30 : 15;
        const blendN = pad === upper && offset > 0 ? 39 : 15;
        const blend = pad === upper
          ? smooth(0, blendE, insetE) * smooth(0, blendN, insetN)
          : smooth(0, 15, Math.min(insetE, insetN));
        return surveyed + (grade - surveyed) * blend;
      }
      return surveyed;
    },
  });
  park.group.name = 'Sugar Camp stunt courses';
  return park;
}
