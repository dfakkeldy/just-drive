import type { Building, BuildingStyle } from './buildings';
import mabouLooks from './property-looks/mabou.json';

/**
 * Per-building look overrides observed from dash-cam passes, keyed by surveyed building ID.
 * Public data only: road names and game building IDs, no civic numbers or personal names.
 */
export interface PropertyLookOverride extends Partial<BuildingStyle> {
  /** Road group name (e.g. 'mabou-village'). */
  group: string;
  /** Public road name for coverage reporting. */
  road: string;
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

const AREA_LOOKS: Partial<Record<string, AreaPropertyLooks>> = {
  mabou: mabouLooks as AreaPropertyLooks,
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

export function areaPropertyLooks(areaId: string): AreaPropertyLooks | null {
  return AREA_LOOKS[areaId] ?? null;
}

/**
 * Apply dash-cam look overrides to an area's drawn buildings and styles.
 * Never alters property IDs, footprints, positions, or un-overridden buildings.
 */
export function applyPropertyLooks(
  areaId: string,
  list: Building[],
  baseStyles?: Record<string, BuildingStyle>,
): { buildings: Building[]; styles: Record<string, BuildingStyle> } | null {
  const pack = AREA_LOOKS[areaId];
  if (!pack) return null;
  const overrides = pack.overrides;
  const keys = Object.keys(overrides);
  if (!keys.length) return null;

  let changedBuildings = false;
  const buildings = list.map((b) => {
    const id = String(b.buildingId ?? b.id);
    const ov = overrides[id];
    if (!ov) return b;
    const isPrimary = (b.buildingId ?? b.id) === b.id;
    const nextKind = ov.kind ?? b.kind;
    const nextEave = isPrimary && ov.eave !== undefined ? ov.eave : b.eave;
    const nextRidge = isPrimary && ov.ridge !== undefined
      ? ov.ridge
      : isPrimary && ov.eave !== undefined ? Math.max(b.ridge, nextEave + 0.6) : b.ridge;
    if (nextKind === b.kind && nextEave === b.eave && nextRidge === b.ridge) return b;
    changedBuildings = true;
    return { ...b, kind: nextKind, eave: nextEave, ridge: nextRidge };
  });

  const styles: Record<string, BuildingStyle> = {};
  for (const id of keys) {
    const ov = overrides[id];
    const base = baseStyles?.[id] ?? DEFAULT_STYLE;
    const { group: _g, road: _r, kind: _k, eave: _e, ridge: _ri, ...styleFields } = ov;
    styles[id] = { ...base, ...styleFields };
  }

  return { buildings: changedBuildings ? buildings : list, styles };
}
