/**
 * Town of Port Hawkesbury no-mailbox boundary and Post Office building site geometry. Pure: no three.js, no DOM.
 *
 * Inside the Town of Port Hawkesbury's legal limits, no roadside mailboxes or mailbox posts stand in the scenery.
 * Outside the town limits (Point Tupper, Port Hastings side, rural roads), rural mailboxes stay as they are.
 * Point Tupper / Port Hawkesbury is Just Drive (no mail route or mail mechanics).
 *
 * Boundary source: Province of Nova Scotia, Service Nova Scotia, BND_Municipal_Village_Boundaries_UT83 MapServer
 * Layer 2 (Municipality, OBJECTID 21, FullName "Town of Port Hawkesbury", CGNDB_KEY CBELL, EPSG:2961),
 * Open Government Licence - Nova Scotia, simplified at 1.0 m tolerance (zero classification changes on all
 * baked Point Tupper mailboxes and houses).
 */
import type { Building } from './buildings';
import type { Solid } from './parked';
import { strips } from './site-solids';
import boundary from './port-hawkesbury-boundary.json';

export type P2 = readonly [number, number];

export const PORT_HAWKESBURY_BOUNDARY_SOURCE: string = boundary.source;
export const PORT_HAWKESBURY_BOUNDS: readonly [number, number, number, number] = Object.freeze([
  boundary.bounds[0], boundary.bounds[1], boundary.bounds[2], boundary.bounds[3],
]);
export const PORT_HAWKESBURY_BOUNDARY: readonly P2[] = Object.freeze(
  boundary.ring.map(([e, n]): P2 => Object.freeze([e, n])),
);

/** True when EPSG:2961 point (east, north) lies inside the Town of Port Hawkesbury's legal limits. */
export function inPortHawkesbury(east: number, north: number): boolean {
  const [e0, n0, e1, n1] = PORT_HAWKESBURY_BOUNDS;
  if (east < e0 || east > e1 || north < n0 || north > n1) return false;
  let inside = false;
  const ring = PORT_HAWKESBURY_BOUNDARY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > north) !== (yj > north) && east < ((xj - xi) * (north - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface PostOfficeFrame { readonly e: number; readonly n: number; readonly az: number }

/** Local frame (+x along compass az 47 deg NE parallel to Pitt Street, +z SE toward Pitt Street) -> EPSG:2961. */
export function poToMap(x: number, z: number): [number, number] {
  const a = (PH_POST_OFFICE.frame.az * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a);
  return [PH_POST_OFFICE.frame.e + x * s + z * c, PH_POST_OFFICE.frame.n + x * c - z * s];
}

export function poToLocal(e: number, n: number): [number, number] {
  const a = (PH_POST_OFFICE.frame.az * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a);
  const de = e - PH_POST_OFFICE.frame.e, dn = n - PH_POST_OFFICE.frame.n;
  return [de * s + dn * c, de * c - dn * s];
}

/**
 * Port Hawkesbury Post Office building on Pitt Street (replacing baked building 149 and its wings 3081 and 3082).
 * Built by eye from public aerial imagery, public street-level photography and the provincial 1 m LiDAR DSM/DTM.
 * Scenery only (no mail mechanics). Generic "POST OFFICE" sign; no Canada Post logo and no civic number.
 */
export const PH_POST_OFFICE = Object.freeze({
  frame: Object.freeze({ e: 627806.27, n: 5052413.92, az: 47 }) as PostOfficeFrame,
  /** Surveyed building centres (largest wing and envelope site) replaced by the hand-built post office. */
  replaces: Object.freeze([
    Object.freeze([627806.27, 5052413.92] as P2),
    Object.freeze([627803.98, 5052423.21] as P2),
  ]),
  /** Local building footprint rectangles [x0, x1, z0, z1]: main front block, NE entrance vestibule, rear NW wing, rear NE wing. */
  rects: Object.freeze([
    Object.freeze([-10.98, 10.97, -8.43, 8.43] as const),
    Object.freeze([10.97, 13.8, 4.0, 8.8] as const),
    Object.freeze([4.05, 14.08, -25.32, -8.43] as const),
    Object.freeze([14.08, 20.29, -15.8, -6.91] as const),
  ]),
  /** Raised exterior structures that must also block vehicles: rear 0.85 m concrete loading dock and SW lobby landing/rail. */
  solidExtras: Object.freeze([
    Object.freeze([2.25, 4.05, -16.2, -10.6] as const),
    Object.freeze([-10.8, -2.2, 8.43, 10.43] as const),
  ]),
  /** Concrete customer entrance walkway and SW paved parking / loading driveway (local [x0, x1, z0, z1]). */
  pads: Object.freeze([
    Object.freeze([10.2, 14.2, 8.8, 20.4] as const),
    Object.freeze([-20.0, -11.0, -18.0, 20.4] as const),
    Object.freeze([-11.0, 4.05, -24.0, -8.43] as const),
  ]),
  /** Front flagpole (SW corner by the glazed lobby, matching street view) and red street letter box by the postal entrance. */
  flagpole: Object.freeze([-10.2, 13.0] as P2),
  letterBox: Object.freeze([13.25, 9.45] as P2),
  signText: 'POST OFFICE',
  /** Service drop attachment on the SE front brick wall, below the flat-roof cornice (for baked building 149). */
  serviceDrop: Object.freeze({ building: 149, x: -8.75, z: 8.43, height: 5.2 }),
});

/** World-space tree/prop clearing boxes for the Port Hawkesbury Post Office building and entrance walkway. */
export function postOfficeClear(village: readonly [number, number]): [number, number, number, number][] {
  const world = (e: number, n: number) => ({ x: e - village[0], z: village[1] - n });
  const box = (r: readonly [number, number, number, number], pad: number): [number, number, number, number] => {
    const corners = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([x, z]) => world(...poToMap(x, z)));
    const xs = corners.map(c => c.x), zs = corners.map(c => c.z);
    return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
  };
  return [
    ...PH_POST_OFFICE.rects.map(r => box(r, 1.5)),
    ...PH_POST_OFFICE.pads.map(r => box(r, 0.8)),
  ];
}

/** Strip-cut collision solids for the Port Hawkesbury Post Office building, loading dock, landing, flagpole and street letter box. */
export function postOfficeSolids(village: readonly [number, number]): Solid[] {
  const world = (e: number, n: number) => ({ x: e - village[0], z: village[1] - n });
  const heading = (PH_POST_OFFICE.frame.az * Math.PI) / 180;
  const raw: Solid[] = [...PH_POST_OFFICE.rects, ...PH_POST_OFFICE.solidExtras].map(([x0, x1, z0, z1]) => {
    const [e, n] = poToMap((x0 + x1) / 2, (z0 + z1) / 2);
    return { ...world(e, n), half: (x1 - x0) / 2, halfWidth: (z1 - z0) / 2, heading };
  });
  const [fe, fn] = poToMap(PH_POST_OFFICE.flagpole[0], PH_POST_OFFICE.flagpole[1]);
  raw.push({ ...world(fe, fn), half: 0.28, halfWidth: 0.28, heading });
  const [le, ln] = poToMap(PH_POST_OFFICE.letterBox[0], PH_POST_OFFICE.letterBox[1]);
  raw.push({ ...world(le, ln), half: 0.36, halfWidth: 0.36, heading });
  return raw.flatMap(strips);
}

/** Remove the surveyed building (and all of its wings) replaced by the hand-built Port Hawkesbury Post Office. */
export function postOfficeReplaceBuildings(list: Building[]): Building[] {
  const onSpot = (b: Building) => {
    const c = b.site ?? b;
    return PH_POST_OFFICE.replaces.some(([e, n]) => (c.x - e) ** 2 + (c.y - n) ** 2 <= 6 ** 2);
  };
  const groups = new Set(list.filter(onSpot).map(b => b.buildingId ?? b.id));
  return list.filter(b => !onSpot(b) && !groups.has(b.buildingId ?? b.id));
}

/** Re-aim the replaced post office building's service drop onto the hand-built SE brick front wall. */
export function aimPostOfficeDrops<T extends { building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }>(drops: T[]): T[] {
  const target = PH_POST_OFFICE.serviceDrop;
  const [x, y] = poToMap(target.x, target.z);
  return drops.map(d => d.building === target.building
    ? { ...d, x, y, height: target.height, ground: null, groundX: x, groundY: y }
    : d);
}

interface RawMailbox { x: number; y: number; heading: number; style: number; tilt: number; group: number | null; parcelBox: boolean }
interface RawCommunity { x: number; y: number; heading: number; modules: number }
interface RawPropsFile {
  crs?: unknown;
  mailboxes?: RawMailbox[];
  communityBoxes?: RawCommunity[];
  poles?: unknown[];
  serviceDrops?: { building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }[];
  [key: string]: unknown;
}

/**
 * Filter Point Tupper props.json at load time:
 * - Removes every roadside mailbox and post inside the Town of Port Hawkesbury's legal limits.
 * - Normalizes any remaining shared mailbox frame reduced to one outside box back to a single post.
 * - Removes any community mailbox cabinet inside the town limits.
 * - Leaves all mailboxes outside town limits (Point Tupper, Port Hastings side, rural roads) untouched.
 * - Leaves all utility poles and service drops intact (re-aiming the post office building's drop when active).
 */
export function filterPointTupperProps<T extends RawPropsFile>(
  data: T,
  areaId: string,
  reaimPostOfficeDrop = true,
): T {
  if (areaId !== 'pointtupper' || !data || typeof data !== 'object') return data;
  const rawBoxes = Array.isArray(data.mailboxes) ? data.mailboxes : [];
  const keptBoxes = rawBoxes.filter(m => !inPortHawkesbury(m.x, m.y));
  // If a shared wooden frame straddled the town line and only one box stays outside, draw it on a single post.
  const groupCounts = new Map<number, number>();
  for (const m of keptBoxes) if (m.group !== null) groupCounts.set(m.group, (groupCounts.get(m.group) ?? 0) + 1);
  const mailboxes = keptBoxes.map(m => m.group !== null && (groupCounts.get(m.group) ?? 0) < 2 ? { ...m, group: null } : m);
  const communityBoxes = Array.isArray(data.communityBoxes)
    ? data.communityBoxes.filter(c => !inPortHawkesbury(c.x, c.y))
    : [];
  const serviceDrops = reaimPostOfficeDrop && Array.isArray(data.serviceDrops)
    ? aimPostOfficeDrops(data.serviceDrops)
    : data.serviceDrops;
  return { ...data, mailboxes, communityBoxes, ...(serviceDrops !== undefined ? { serviceDrops } : {}) };
}
