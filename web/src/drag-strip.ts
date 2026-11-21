import { AIRPORT } from './airport-source';
import { runwayFrame } from './airport-site';
import { DRAG_DISTANCE } from './drag-rules';
import type { Place } from './places';

const START = 245; // past the west threshold and the taxiway junction
export const DRAG_LANE = 5;
export const DRAG_HALF_LANE = 4;
export const DRAG_START_KEY = 'airport-drag';
export const DRAG_PAINT = [START, START + DRAG_DISTANCE, DRAG_LANE, DRAG_HALF_LANE] as const;

const [west] = AIRPORT.runway.ends;
const { ux, un, heading } = runwayFrame(AIRPORT.runway);
function survey(along: number, across: number) {
  return { e: west[0] + ux * (START + along) + un * across, n: west[1] + un * (START + along) - ux * across };
}
const start = { ...survey(-4, -DRAG_LANE), heading: heading * Math.PI / 180 };
export function airportDragPlace(): Place {
  return {
    ...survey(0, 0), start, id: DRAG_START_KEY, area: 'pointtupper', kind: 'site',
    name: 'Port Hawkesbury Airport',
    note: 'Quarter-mile drag strip. Stop in the left lane, stage and wait for green.',
    sources: ['https://www.openstreetmap.org/way/' + AIRPORT.runway.osm],
  };
}

export class DragStrip {
  readonly x: number;
  readonly z: number;
  readonly start: { x: number; z: number; heading: number };
  constructor(origin: readonly [number, number]) {
    const beam = survey(0, 0);
    this.x = beam.e - origin[0];
    this.z = origin[1] - beam.n;
    this.start = { x: start.e - origin[0], z: origin[1] - start.n, heading: start.heading };
  }

  along(x: number, z: number): number { return (x - this.x) * ux - (z - this.z) * un; }
  across(x: number, z: number): number { return (x - this.x) * un + (z - this.z) * ux; }
  point(along: number, across: number) {
    return { x: this.x + ux * along + un * across, z: this.z - un * along + ux * across, heading: start.heading };
  }
}
