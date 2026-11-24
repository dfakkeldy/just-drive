/**
 * Verified municipal water towers, standpipes, reservoirs and standing small vertical tanks
 * for Point Tupper, Canso Causeway and Port Hood (EPSG:2961, metres).
 *
 * Public open-data sources:
 * - Province of Nova Scotia NSTDB 10k Utilities (OGL-NS): UTTK60 (TANK 6-15 m) and UTTO60 (TOWER) points.
 * - NRCan HRDEM 1 m DSM/DTM (OGL-Canada): structure heights above ground, diameters and baked ground elevations.
 * - © OpenStreetMap contributors (ODbL 1.0): Port Hastings standpipe (way/586672590) and water-tower tags
 *   (node/1917776887, node/1917774389, node/1324058724).
 *
 * Ground elevations are sampled from data/baked/areas/{pointtupper,cansocauseway,porthood}.
 * Generic parametric models only: no painted lettering, logos, civic numbers or private imagery.
 * None of the standing structures in these areas carry a red night obstruction light.
 */

export type WaterTowerArea = 'pointtupper' | 'cansocauseway' | 'porthood';
export type WaterTowerKind = 'standpipe' | 'reservoir' | 'elevated' | 'tank' | 'silo' | 'bin';

export interface ValveHouseSpec {
  /** Compass azimuth (degrees from north) from tank centre to valve house centre. */
  readonly azDeg: number;
  /** Centre-to-centre offset (metres). */
  readonly dist: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly yawDeg: number;
}

export interface WaterTowerSpec {
  readonly id: string;
  readonly areas: readonly WaterTowerArea[];
  readonly kind: WaterTowerKind;
  readonly e: number;
  readonly n: number;
  /** Baked terrain elevation (metres CGVD2013) at (e, n). */
  readonly g: number;
  /** Outer cylinder diameter (metres). */
  readonly diameter: number;
  /** Cylindrical wall height above base (metres), or total tank-top height for elevated tanks. */
  readonly shellHeight: number;
  /** Roof dome or cone rise above wall top (metres). */
  readonly roofHeight: number;
  /** Primary wall colour (hex sRGB). */
  readonly color: number;
  /** Roof colour (hex sRGB); defaults to wall colour. */
  readonly roofColor?: number;
  /** Steel trim colour (wind-girder stiffener rings, ladder, roof guardrail). */
  readonly trimColor?: number;
  /** Number of evenly spaced horizontal wind-girder stiffener rings along the shell. */
  readonly rings?: number;
  /** Compass azimuth (degrees from north) for exterior vertical access ladder. */
  readonly ladderDeg?: number;
  /** Top perimeter roof guardrail / balcony around the landing. */
  readonly balcony?: boolean;
  /** Optional small valve/pump house beside the tank base. */
  readonly valveHouse?: ValveHouseSpec;
  /** For 'elevated' kind: leg height from ground to tank bottom (metres). */
  readonly legHeight?: number;
  /** For 'elevated' kind: number of angled support legs. */
  readonly legCount?: number;
  /** Red aviation obstruction light on top: only when verified on the real structure (none here). */
  readonly nightLight?: boolean;
  /** Public open-data source reference. */
  readonly source: string;
}

export const WATER_TOWERS: readonly WaterTowerSpec[] = [
  // --- Municipal water standpipes & reservoirs (5 standing structures) ---
  {
    // Port Hawkesbury Pitt St / Embree St / Hiram St steel water standpipe (2024-2025 blue replacement on same pad).
    id: 'ph-pitt-street',
    areas: ['pointtupper'],
    kind: 'standpipe',
    e: 628035.4,
    n: 5052689.2,
    g: 45.04,
    diameter: 10.5,
    shellHeight: 25.0,
    roofHeight: 1.5,
    color: 0x284e8c,
    roofColor: 0xc9ced3,
    trimColor: 0xb8c0c8,
    rings: 3,
    ladderDeg: 155,
    balcony: true,
    valveHouse: { azDeg: 215, dist: 7.4, width: 4.5, depth: 3.4, height: 3.0, yawDeg: 25 },
    source: 'nstdb:UTTO60:1572',
  },
  {
    // Port Hastings light-grey painted steel water standpipe (shared across pointtupper & cansocauseway).
    id: 'port-hastings',
    areas: ['pointtupper', 'cansocauseway'],
    kind: 'standpipe',
    e: 624319.1,
    n: 5056590.7,
    g: 66.64,
    diameter: 9.6,
    shellHeight: 15.2,
    roofHeight: 1.5,
    color: 0xcfd3d6,
    roofColor: 0xd8dce0,
    trimColor: 0x8b9299,
    rings: 2,
    ladderDeg: 210,
    balcony: true,
    source: 'osm:w586672590',
  },
  {
    // Mulgrave North weathered off-white steel water standpipe.
    id: 'mulgrave-north',
    areas: ['pointtupper'],
    kind: 'standpipe',
    e: 624283.5,
    n: 5052676.2,
    g: 70.82,
    diameter: 14.2,
    shellHeight: 13.8,
    roofHeight: 1.5,
    color: 0xc7cac7,
    roofColor: 0xd2d5d2,
    trimColor: 0x7d8388,
    rings: 2,
    ladderDeg: 110,
    balcony: true,
    source: 'nstdb:UTTO60:1571+osm:n1917776887',
  },
  {
    // Mulgrave South low weathered grey concrete municipal water reservoir.
    id: 'mulgrave-south',
    areas: ['pointtupper'],
    kind: 'reservoir',
    e: 624088.4,
    n: 5052187.7,
    g: 98.06,
    diameter: 15.5,
    shellHeight: 6.3,
    roofHeight: 0.8,
    color: 0x8e908c,
    roofColor: 0x9b9d99,
    trimColor: 0x626564,
    ladderDeg: 85,
    balcony: false,
    source: 'nstdb:UTTO60:1551+osm:n1917774389',
  },
  {
    // Port Hood municipal domed water storage tank.
    id: 'port-hood-water',
    areas: ['porthood'],
    kind: 'reservoir',
    e: 613850.5,
    n: 5097469.5,
    g: 67.14,
    diameter: 15.0,
    shellHeight: 6.5,
    roofHeight: 1.7,
    color: 0xc8cccb,
    roofColor: 0xe4e7e8,
    trimColor: 0x7c8285,
    ladderDeg: 250,
    balcony: false,
    source: 'nstdb:UTTK60:2190+osm:n1324058724',
  },

  // --- Standing small vertical tanks, industrial silos & farm bin (NSTDB UTTK60) ---
  {
    // Port Hood East small galvanized farm grain bin.
    id: 'port-hood-bin',
    areas: ['porthood'],
    kind: 'bin',
    e: 614781.9,
    n: 5097181.3,
    g: 51.51,
    diameter: 4.5,
    shellHeight: 3.4,
    roofHeight: 1.3,
    color: 0xafb5b8,
    roofColor: 0xbfc5c8,
    trimColor: 0x7e8589,
    source: 'nstdb:UTTK60:2189',
  },
  {
    // Point Tupper Oil Terminal small vertical tank (east pad, omitted from large-tank bake).
    id: 'pt-oil-1893',
    areas: ['pointtupper'],
    kind: 'tank',
    e: 630036.3,
    n: 5048535.6,
    g: 30.85,
    diameter: 12.6,
    shellHeight: 12.1,
    roofHeight: 1.6,
    color: 0xb6b2a6,
    roofColor: 0xc4c0b5,
    trimColor: 0x7a7973,
    ladderDeg: 280,
    balcony: true,
    source: 'nstdb:UTTK60:1893',
  },
  {
    // Point Tupper Oil Terminal small vertical tank (north-west pad, omitted from large-tank bake).
    id: 'pt-oil-1897',
    areas: ['pointtupper'],
    kind: 'tank',
    e: 629742.6,
    n: 5048782.3,
    g: 22.91,
    diameter: 11.4,
    shellHeight: 9.9,
    roofHeight: 1.5,
    color: 0xb8bbb8,
    roofColor: 0xc5c8c5,
    trimColor: 0x7c8080,
    ladderDeg: 260,
    balcony: true,
    source: 'nstdb:UTTK60:1897',
  },
  {
    // Point Tupper Power Plant east storage silo (HRDEM 25.9 m peak, clear of pt-industry ashSilo).
    id: 'pt-power-1906',
    areas: ['pointtupper'],
    kind: 'silo',
    e: 629014.7,
    n: 5049438.4,
    g: 13.10,
    diameter: 13.0,
    shellHeight: 23.2,
    roofHeight: 2.7,
    color: 0xa6a8a5,
    roofColor: 0x7e8387,
    trimColor: 0x676c70,
    rings: 2,
    ladderDeg: 200,
    balcony: true,
    source: 'nstdb:UTTK60:1906',
  },
  {
    // Port Hawkesbury waterfront industrial plant twin silos (NE of building 3218).
    id: 'ph-wallboard-silo-1',
    areas: ['pointtupper'],
    kind: 'silo',
    e: 627568.5,
    n: 5051630.5,
    g: 16.18,
    diameter: 8.4,
    shellHeight: 28.8,
    roofHeight: 2.2,
    color: 0x6f7f8c,
    roofColor: 0x8c97a0,
    trimColor: 0x56626c,
    rings: 2,
    ladderDeg: 40,
    balcony: true,
    source: 'nstdb:UTTK60:1545',
  },
  {
    id: 'ph-wallboard-silo-2',
    areas: ['pointtupper'],
    kind: 'silo',
    e: 627574.8,
    n: 5051624.5,
    g: 16.15,
    diameter: 6.8,
    shellHeight: 22.2,
    roofHeight: 1.8,
    color: 0x6f7f8c,
    roofColor: 0x8c97a0,
    trimColor: 0x56626c,
    rings: 1,
    ladderDeg: 40,
    balcony: false,
    source: 'nstdb:UTTK60:1544',
  },

  // Paint Street West bulk fuel depot: 8 white vertical cylindrical steel tanks in 2 rows of 4.
  { id: 'paint-w-1', areas: ['pointtupper'], kind: 'tank', e: 629711.7, n: 5052509.2, g: 49.85, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, ladderDeg: 130, source: 'nstdb:UTTK60:1566' },
  { id: 'paint-w-2', areas: ['pointtupper'], kind: 'tank', e: 629715.1, n: 5052506.0, g: 49.80, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1563' },
  { id: 'paint-w-3', areas: ['pointtupper'], kind: 'tank', e: 629718.5, n: 5052502.8, g: 49.81, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1561' },
  { id: 'paint-w-4', areas: ['pointtupper'], kind: 'tank', e: 629721.9, n: 5052499.6, g: 49.82, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1559' },
  { id: 'paint-w-5', areas: ['pointtupper'], kind: 'tank', e: 629708.5, n: 5052505.8, g: 49.73, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1565' },
  { id: 'paint-w-6', areas: ['pointtupper'], kind: 'tank', e: 629711.9, n: 5052502.6, g: 49.73, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1562' },
  { id: 'paint-w-7', areas: ['pointtupper'], kind: 'tank', e: 629715.3, n: 5052499.4, g: 49.80, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1560' },
  { id: 'paint-w-8', areas: ['pointtupper'], kind: 'tank', e: 629718.7, n: 5052496.2, g: 49.80, diameter: 3.2, shellHeight: 9.4, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, ladderDeg: 130, source: 'nstdb:UTTK60:1557' },

  // Paint Street East bulk fuel depot: 3 white vertical cylindrical steel tanks.
  { id: 'paint-e-1', areas: ['pointtupper'], kind: 'tank', e: 629985.5, n: 5052516.2, g: 46.98, diameter: 5.2, shellHeight: 7.8, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, ladderDeg: 220, source: 'nstdb:UTTK60:1568' },
  { id: 'paint-e-2', areas: ['pointtupper'], kind: 'tank', e: 629991.0, n: 5052521.0, g: 47.08, diameter: 4.6, shellHeight: 9.5, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, ladderDeg: 140, source: 'nstdb:UTTK60:1570' },
  { id: 'paint-e-3', areas: ['pointtupper'], kind: 'tank', e: 629993.0, n: 5052513.0, g: 47.13, diameter: 5.4, shellHeight: 7.8, roofHeight: 0.7, color: 0xdce0e2, roofColor: 0xe6e9eb, trimColor: 0x8e959b, source: 'nstdb:UTTK60:1564' },

  // Mulgrave industrial park vertical bulk tanks (6 standing tanks measured from 1 m HRDEM).
  { id: 'mulgrave-dock-1', areas: ['pointtupper'], kind: 'tank', e: 625156.0, n: 5052760.7, g: 39.61, diameter: 5.2, shellHeight: 12.1, roofHeight: 0.9, color: 0xbcc1c4, roofColor: 0xcbd0d3, trimColor: 0x7b8287, ladderDeg: 90, source: 'nstdb:UTTK60:1576' },
  { id: 'mulgrave-dock-2', areas: ['pointtupper'], kind: 'tank', e: 625143.3, n: 5052772.1, g: 39.63, diameter: 4.8, shellHeight: 8.7, roofHeight: 0.8, color: 0xbcc1c4, roofColor: 0xcbd0d3, trimColor: 0x7b8287, source: 'nstdb:UTTK60:1580' },
  { id: 'mulgrave-dock-3', areas: ['pointtupper'], kind: 'tank', e: 625144.1, n: 5052764.2, g: 39.64, diameter: 4.8, shellHeight: 8.2, roofHeight: 0.8, color: 0xbcc1c4, roofColor: 0xcbd0d3, trimColor: 0x7b8287, source: 'nstdb:UTTK60:1578' },
  { id: 'mulgrave-dock-4', areas: ['pointtupper'], kind: 'tank', e: 625158.7, n: 5052772.8, g: 39.61, diameter: 4.0, shellHeight: 4.5, roofHeight: 0.6, color: 0xb4b9bc, roofColor: 0xc4c9cc, trimColor: 0x7b8287, source: 'nstdb:UTTK60:1582' },
  { id: 'mulgrave-dock-5', areas: ['pointtupper'], kind: 'tank', e: 625135.1, n: 5052772.4, g: 39.65, diameter: 4.2, shellHeight: 4.5, roofHeight: 0.6, color: 0xb4b9bc, roofColor: 0xc4c9cc, trimColor: 0x7b8287, source: 'nstdb:UTTK60:1579' },
  { id: 'mulgrave-dock-6', areas: ['pointtupper'], kind: 'tank', e: 625135.4, n: 5052763.2, g: 39.63, diameter: 4.2, shellHeight: 4.5, roofHeight: 0.6, color: 0xb4b9bc, roofColor: 0xc4c9cc, trimColor: 0x7b8287, source: 'nstdb:UTTK60:1577' },
];
