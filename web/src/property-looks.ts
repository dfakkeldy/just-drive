import type { Building, BuildingStyle } from './buildings';
import mabouLooks from './property-looks/mabou.json';

/**
 * Per-building look overrides observed from dash-cam passes, keyed by surveyed building ID
 * and anchored by map position (EPSG:2961) so a rebake cannot attach an override to the wrong house.
 * Public data only: road names, game building IDs and map coordinates; no civic numbers or personal names.
 */
export interface PropertyLookOverride extends Partial<BuildingStyle> {
  /** Road group name (e.g. 'mabou-village'). */
  group: string;
  /** Public road name for coverage reporting. */
  road: string;
  /** Surveyed property centre [east, north] in EPSG:2961 metres. */
  at: [number, number];
  /** Optional envelope classification fix when LiDAR guessed the wrong kind. */
  kind?: Building['kind'];
  /** Optional eave height correction (metres above ground) when LiDAR misread storeys. */
  eave?: number;
  /** Optional ridge height correction (metres above ground). */
  ridge?: number;
}

export interface AreaPropertyLooks {
  version: 1;
  area: string;
  groups: Record<string, { label: string; roads: string[] }>;
  overrides: Record<string, PropertyLookOverride>;
}

export type PropertyLookRoofBox = Pick<Building, 'x' | 'y' | 'ground' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge' | 'shape'>;

const AREA_LOOKS: Partial<Record<string, AreaPropertyLooks>> = {
  mabou: mabouLooks as unknown as AreaPropertyLooks,
};

const DEFAULT_STYLE: BuildingStyle = {
  wall: '#d9d6cc',
  roof: '#474a4d',
  trim: '#eceae2',
  roofMaterial: 'shingle',
  entrance: 'none',
  chimney: false,
  dormer: false,
  shutters: false,
  satelliteDish: false,
  skirting: false,
  silo: false,
};

const MATCH_RADIUS_M = 4;

export function areaPropertyLooks(areaId: string): AreaPropertyLooks | null {
  return AREA_LOOKS[areaId] ?? null;
}

/**
 * Apply dash-cam look overrides to an area's drawn buildings and styles.
 * Verifies each override against its anchored survey position so a rebake never paints the wrong building.
 * Never alters property IDs, footprints, positions, or un-overridden buildings.
 */
export function applyPropertyLooks(
  areaId: string,
  list: Building[],
  baseStyles?: Record<string, BuildingStyle>,
): { buildings: Building[]; styles: Record<string, BuildingStyle>; roofBoxes: PropertyLookRoofBox[] } | null {
  const pack = AREA_LOOKS[areaId];
  if (!pack) return null;
  const entries = Object.entries(pack.overrides);
  if (!entries.length) return null;

  // Index primary property records by identity ID so position verification works for both plain and winged buildings.
  const primaryById = new Map<string, Building>();
  for (const b of list) {
    if (b.shape !== undefined) continue;
    const id = String(b.buildingId ?? b.id);
    if ((b.buildingId ?? b.id) === b.id) primaryById.set(id, b);
  }

  // Match each override unambiguously and order-independently by its anchored survey position.
  // A unique candidate within MATCH_RADIUS_M wins, or the strictly closest candidate (at least 1 m
  // closer than any runner-up) so a reused ID farther away never beats the building at the anchor.
  const matched = new Map<string, PropertyLookOverride>();
  const claimed = new Set<string>();
  const primaryList = [...primaryById.entries()];
  for (const [, ov] of entries) {
    const [oe, on] = ov.at;
    const nearby: { id: string; dist: number }[] = [];
    for (const [candId, cand] of primaryList) {
      const site = cand.site ?? cand;
      const dist = Math.hypot(site.x - oe, site.y - on);
      if (dist <= MATCH_RADIUS_M) nearby.push({ id: candId, dist });
    }
    if (!nearby.length) continue;
    nearby.sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
    if (nearby.length > 1 && nearby[1].dist - nearby[0].dist <= 1) continue;
    const winner = nearby[0].id;
    if (claimed.has(winner)) continue;
    claimed.add(winner);
    matched.set(winner, ov);
  }
  if (!matched.size) return null;

  let changedBuildings = false;
  const roofBoxes: PropertyLookRoofBox[] = [];
  const buildings = list.map((b) => {
    const id = String(b.buildingId ?? b.id);
    const ov = matched.get(id);
    if (!ov) return b;
    const isPrimary = (b.buildingId ?? b.id) === b.id;
    const nextKind = ov.kind ?? b.kind;
    const nextEave = isPrimary && ov.eave !== undefined ? ov.eave : b.eave;
    const nextRidge = isPrimary && ov.ridge !== undefined
      ? ov.ridge
      : isPrimary && ov.eave !== undefined ? Math.max(b.ridge, nextEave + 0.6) : b.ridge;
    if (nextKind === b.kind && nextEave === b.eave && nextRidge === b.ridge) return b;
    changedBuildings = true;
    const updated = { ...b, kind: nextKind, eave: nextEave, ridge: nextRidge };
    if (nextRidge > b.ridge) {
      roofBoxes.push({
        x: updated.x, y: updated.y, ground: updated.floorGround ?? updated.ground,
        axisDeg: updated.axisDeg, length: updated.length, width: updated.width,
        eave: updated.eave, ridge: updated.ridge, shape: updated.shape,
      });
    }
    return updated;
  });

  const styles: Record<string, BuildingStyle> = {};
  for (const [id, ov] of matched) {
    const base = baseStyles?.[id] ?? DEFAULT_STYLE;
    const { group: _g, road: _r, at: _a, kind: _k, eave: _e, ridge: _ri, ...styleFields } = ov;
    styles[id] = { ...base, ...styleFields };
  }

  return { buildings: changedBuildings ? buildings : list, styles, roofBoxes };
}
