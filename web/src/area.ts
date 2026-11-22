/** Land selection. Paths are relative to Vite's BASE_URL, never supplied by the address bar. */
export interface Area {
  readonly id: string;
  readonly name: string;
  readonly base: string;
  readonly mail: boolean;
  readonly worksYard: boolean;
  readonly colliery: boolean;
  readonly animals: boolean;
  readonly roadScene: boolean;
  readonly fishing: boolean;
  readonly coast: boolean;
  readonly landmarks: boolean;
  readonly fixedShots: boolean;
  readonly gulfTint: boolean;
  readonly fixedSun: boolean;
  readonly route: boolean;
  readonly mailTitle: boolean;
  /** the Red Roof by the Brook house and yard stand in this area (home.ts). */
  readonly home: boolean;
  readonly church: boolean;
  readonly quarry: boolean;
  // The hand-built sites and layers main.ts adds. Each stands in the areas named below, in the modern eras only.
  /** Mabou's main street (mabou-main.ts). */
  readonly mabouMain: boolean;
  /** The house with a dog on its porch at the end of Beaton Road (Mabou). */
  readonly porch: boolean;
  /** The yard dog's invented driveway (Mabou). */
  readonly yardDog: boolean;
  /** The school bus on its loop, and its stop as a quiet place in room games (Mabou). */
  readonly schoolBus: boolean;
  /** The November buildings and road details (Mabou and Port Hood). */
  readonly november: boolean;
  /** The November hillside buildings take the place of their surveyed boxes (Mabou). */
  readonly hillside: boolean;
  /** The heart of Judique on Highway 19 (judique-village.ts). */
  readonly judiqueVillage: boolean;
  /** Port Hawkesbury's stores, dealers and gas bars (port-hawkesbury.ts). */
  readonly hawkesbury: boolean;
  /** The tractor dealership at Maryville Station Road (Port Hood). */
  readonly maryville: boolean;
  /** The invented Port Hood Mail Depot on Highway 19 (Port Hood). */
  readonly depot: boolean;
  /** The airfield (airport.ts). */
  readonly airport: boolean;
  /** Point Tupper's dams, conveyors, pipelines and piers (pt-infrastructure.ts). */
  readonly ptInfrastructure: boolean;
  /** The Canso Canal (canal.ts). */
  readonly canal: boolean;
}
const features = (enabled: boolean) => ({ worksYard: enabled, colliery: enabled, animals: enabled, roadScene: enabled, fishing: enabled, coast: enabled,
  landmarks: enabled, fixedShots: enabled, gulfTint: enabled, fixedSun: enabled, route: enabled, mailTitle: enabled });
const mabouSites = (enabled: boolean) => ({ mabouMain: enabled, porch: enabled, yardDog: enabled, schoolBus: enabled, hillside: enabled });
const pointTupperSites = (enabled: boolean) => ({ hawkesbury: enabled, airport: enabled, ptInfrastructure: enabled });
const area = (id: string, name: string): Area => Object.freeze({ id, name, base: id === 'mabou' ? 'terrain' : `areas/${id}`,
  mail: id === 'mabou', ...features(id === 'mabou'), home: id === 'judique', church: id === 'judique', quarry: id === 'westbay',
  ...mabouSites(id === 'mabou'), november: id === 'mabou' || id === 'porthood', judiqueVillage: id === 'judique', maryville: id === 'porthood', depot: id === 'porthood',
  ...pointTupperSites(id === 'pointtupper'), canal: id === 'cansocauseway' });
export const AREAS: readonly Area[] = Object.freeze([
  area('mabou', 'Mabou'), area('judique', 'Judique'), area('porthood', 'Port Hood'),
  area('pointtupper', 'Point Tupper and Port Hawkesbury'),
  area('westbay', 'West Bay'), area('cansocauseway', 'Canso Causeway and Troy'),
  ...((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ? [area('fixture', 'Fixture')] : []),
]);
export function readArea(params: URLSearchParams): Area {
  const id = params.get('area');
  const found = AREAS.find(a => a.id === (id ?? 'mabou'));
  if (found) return found;
  console.warn(`Unknown area "${id}"; loading Mabou.`);
  return AREAS[0];
}

export interface AreaManifest { area?: { id: string; name: string }; village: [number, number] }
export function validateAreaManifest(selected: Area, manifest: AreaManifest): void {
  if (manifest.area && manifest.area.id !== selected.id) {
    throw new Error(`Asked for ${selected.name} (${selected.id}), but this land is ${manifest.area.name} (${manifest.area.id}).`);
  }
  if (!selected.fixedSun && !manifest.area) throw new Error(`${selected.name}'s manifest must identify its area.`);
}
export class AreaNotReady extends Error {}
/** Vite can answer missing files with index.html and status 200. Treat that as absent land too. */
export async function loadAreaManifest<T extends AreaManifest>(selected: Area, base: string): Promise<T> {
  let manifest: T;
  try {
    const response = await fetch(`${base}/manifest.json`);
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.text();
    if (body.trimStart().startsWith('<')) throw new Error('HTML fallback');
    manifest = JSON.parse(body) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'GameUpdateRequired') throw error;
    if (!selected.fixedSun) throw new AreaNotReady(`${selected.name} is not ready yet.`);
    throw error;
  }
  validateAreaManifest(selected, manifest);
  return manifest;
}

/** NAD83(CSRS) / UTM zone 20N (EPSG:2961), inverse Transverse Mercator on GRS80.
 * The series is accurate well below a metre in Cape Breton; angles returned in degrees.
 */
export function utm20ToLatLon(easting: number, northing: number): { lat: number; lon: number } {
  const a = 6378137, f = 1 / 298.257222101, k = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), e4 = e2 * e2, e6 = e4 * e2;
  const mu = northing / k / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + 151 * e1 ** 3 / 96 * Math.sin(6 * mu) + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const n = a / Math.sqrt(1 - e2 * sin * sin), r = a * (1 - e2) / (1 - e2 * sin * sin) ** 1.5;
  const t = tan * tan, c = ep2 * cos * cos, d = (easting - 500000) / (n * k);
  const lat = phi - n * tan / r * (d ** 2 / 2 - (5 + 3 * t + 10 * c - 4 * c * c - 9 * ep2) * d ** 4 / 24
    + (61 + 90 * t + 298 * c + 45 * t * t - 252 * ep2 - 3 * c * c) * d ** 6 / 720);
  const lon = (d - (1 + 2 * t + c) * d ** 3 / 6
    + (5 - 2 * c + 28 * t - 3 * c * c + 8 * ep2 + 24 * t * t) * d ** 5 / 120) / cos;
  return { lat: lat * 180 / Math.PI, lon: -63 + lon * 180 / Math.PI };
}

/** Nearest point on a public road, in world metres from village, with the road's heading.
 * Scan segments once at spawn rather than asking the road grid to search an unbounded radius.
 */
export function roadStart(roads: readonly { kind: number; pts: readonly [number, number][] }[]): { x: number; z: number; heading: number } | null {
  let best: { x: number; z: number; heading: number } | null = null, distance = Infinity;
  for (const road of roads) {
    if (road.kind < 1 || road.kind > 3) continue;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i];
      const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
      if (!length2) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / length2));
      const x = ax + t * dx, z = az + t * dz, d = x * x + z * z;
      if (d < distance) { distance = d; best = { x, z, heading: Math.atan2(dx, -dz) }; }
    }
  }
  return best;
}
