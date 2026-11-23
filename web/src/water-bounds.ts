// Shared water and map-boundary rules for land rides (vehicle.ts, bike-ride.ts, towing.ts).
// Keeps every ride aligned with the ocean surface drawn in shaders.ts and stops rolling on void tiles.

/** Default ocean level in world metres (main.ts). */
export const DEFAULT_SEA_LEVEL = -0.2;

/** Ocean surface margin above seaLevel: matches shaders.ts (vGround < seaLevel + 0.02). */
export const SEA_SURFACE_MARGIN = 0.02;

/** Virtual seabed drop used where no land tile is known, so wheels sink instead of rolling flat. */
export const SEA_FLOOR_DROP = 4;

/** Mapped cover class for lakes, harbours and ocean in ground-cover.ts and shaders.ts. */
export const WATER_COVER_CLASS = 4;

/** Maximum terrain slope for flat mapped water (matches shaders.ts). */
export const TIDAL_COVER_SLOPE = 0.07;

/** Seconds a ride sinks in water or off known land before returning to safe ground. */
export const WATER_SINK_SECONDS = 1.4;

/** Ground height assumed off loaded land: deep sea below seaLevel. */
export function unknownGroundHeight(seaLevel: number): number {
  return seaLevel - SEA_FLOOR_DROP;
}

/** True where terrain sits at or below the rendered ocean surface. */
export function isSeaHeight(ground: number, seaLevel: number): boolean {
  return ground < seaLevel + SEA_SURFACE_MARGIN;
}

/** True on flat, open mapped water (cover class 4) at any elevation, matching shaders.ts. */
export function isTidalCoverWater(
  _ground: number,
  _seaLevel: number,
  coverClass: number,
  canopy: number,
  slope: number,
  onRoad: boolean,
  mineral = false,
): boolean {
  return !onRoad
    && !mineral
    && coverClass === WATER_COVER_CLASS
    && canopy < 1.5
    && slope < TIDAL_COVER_SLOPE;
}

export interface SurfaceWetInput {
  onDeck: boolean;
  onRoad: boolean;
  ground: number;
  canopy: number;
  water?: boolean;
  waterLimit?: number;
  mineral?: boolean;
  y: number;
  seaLevel: number;
  coverClass?: number;
  slope?: number;
}

/** True when a land ride is in water (lake/quarry, ocean height or flat mapped water) and not on a bridge or deck. */
export function isSurfaceWet(input: SurfaceWetInput): boolean {
  if (input.onDeck) return false;
  if (input.water && input.y < (input.waterLimit ?? input.ground + 0.25)) return true;
  if (isSeaHeight(input.ground, input.seaLevel)) return true;
  return isTidalCoverWater(
    input.ground,
    input.seaLevel,
    input.coverClass ?? 0,
    input.canopy,
    input.slope ?? 0,
    input.onRoad,
    !!input.mineral,
  );
}

export interface DryGroundInput {
  ground: number | null;
  surface: {
    ground: number;
    canopy: number;
    water?: boolean;
    mineral?: boolean;
    kind?: number;
    roadDist?: number;
    halfWidth?: number;
    deck?: boolean;
  } | null;
  onDeck?: boolean;
  seaLevel: number;
  coverClass?: number;
  slope?: number;
}

/** True when a candidate pose sits on loaded, dry ground (or on a supporting deck over water). */
export function isDryGround(input: DryGroundInput): boolean {
  if (input.ground === null) return false;
  const s = input.surface;
  const onDeck = !!input.onDeck || !!s?.deck;
  if (onDeck) return true;
  if (isSeaHeight(input.ground, input.seaLevel)) return false;
  if (!s) return true;
  if (s.water || isSeaHeight(s.ground, input.seaLevel)) return false;
  const onRoad = (s.kind ?? 0) > 0 && (s.roadDist ?? Infinity) <= (s.halfWidth ?? 0) + 0.4;
  return !isTidalCoverWater(s.ground, input.seaLevel, input.coverClass ?? 0, s.canopy, input.slope ?? 0, onRoad, !!s.mineral);
}

/** Safe inset for clamping inside a bounds interval so small bounds never invert [min + m, max - m]. */
export function safeClampMargin(min: number, max: number, desired: number): number {
  return Math.max(0, Math.min(desired, (max - min) * 0.25));
}

/** Local terrain slope magnitude (rise/run) from 1 m cardinal samples, for flat-water checks. */
export function localGroundSlope(x: number, z: number, sample: (x: number, z: number) => number | null): number {
  const gx0 = sample(x - 1, z), gx1 = sample(x + 1, z);
  const gz0 = sample(x, z - 1), gz1 = sample(x, z + 1);
  if (gx0 === null || gx1 === null || gz0 === null || gz1 === null) return 0;
  return Math.hypot((gx1 - gx0) * 0.5, (gz1 - gz0) * 0.5);
}
