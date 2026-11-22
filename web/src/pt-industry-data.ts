/**
 * Point Tupper industrial waterfront survey data (EPSG:2961, metres).
 *
 * Positions come from public open datasets:
 * - NSTDB (Open Government Licence - Nova Scotia): STCH60 stack, STBP60 dolphins, WAWH40 marine wharves, STCV50 conveyors
 * - NRCan HRDEM 1 m DSM/DTM (Open Government Licence - Canada): stack height (101 m), loading-arm/crane peaks, baked ground
 * - OpenStreetMap (ODbL 1.0): pier outlines (ways 163215590, 181365300, 1084321651, 1084321647, 181364913), transformers
 * - Shipped Point Tupper buildings.json footprints: id 85 (boiler/turbine hall blocks), 29, 49, 147, 2116, 2125.
 *
 * No business names, logos or private imagery are used. Ground elevations are sampled from data/baked/areas/pointtupper.
 */

export const PT_INDUSTRY_BOUNDS = [620172, 5045988, 632460, 5058276] as const;

export interface FootprintBlock {
  readonly id: number;
  readonly e: number;
  readonly n: number;
  readonly g: number;
  readonly length: number;
  readonly width: number;
  readonly axisDeg: number;
  readonly eave: number;
  readonly ridge: number;
  readonly role: 'boiler' | 'turbine' | 'annex';
}

export interface ConveyorPoint {
  readonly e: number;
  readonly n: number;
  readonly g: number;
  /** Clearance above ground (or above sea level when g <= sea), in true metres. */
  readonly lift: number;
  /** Place a support bent here (false where an overhead span crosses a road). */
  readonly bent: boolean;
}

export interface ConveyorRun {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly truss: boolean;
  readonly points: readonly ConveyorPoint[];
}

export interface DolphinSpec {
  readonly e: number;
  readonly n: number;
  readonly kind: 'breasting' | 'mooring';
  /** Face azimuth (degrees from north) pointing toward the shipping channel. */
  readonly faceDeg: number;
  readonly navLight?: 'red' | 'green';
}

export interface CoalMoundGrid {
  readonly id: string;
  readonly e0: number;
  readonly n0: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  /** Decimetres above CGVD2013; -999 marks cells outside the raised coal pile. */
  readonly dtmDm: readonly number[];
}

export const POWER_PLANT = {
  /** Active reinforced-concrete chimney stack (101 m above ground, HRDEM DSM 111.7 m, NSTDB STCH60). */
  stack: { e: 628901.5, n: 5049449.0, g: 5.23, height: 101, baseR: 4.6, topR: 2.45 },
  /** Electrostatic precipitator & flue-gas breeching between the east boiler wall and the stack. */
  esp: { e: 628890.5, n: 5049458.0, g: 5.43, axisDeg: 19.79 },
  /** Elevated fly-ash storage silo east of the precipitator. */
  ashSilo: { e: 628938.0, n: 5049464.0, g: 7.06 },
  /** Baked footprints of the power plant (building id 85 and its 11 sibling blocks). */
  blocks: [
    { id: 85, e: 628863.31, n: 5049497.69, g: 7.21, length: 52.70, width: 27.97, axisDeg: 19.79, eave: 41.44, ridge: 42.64, role: 'boiler' },
    { id: 3204, e: 628808.42, n: 5049479.41, g: 5.41, length: 40.76, width: 24.98, axisDeg: 19.79, eave: 27.10, ridge: 27.91, role: 'turbine' },
    { id: 3205, e: 628842.40, n: 5049508.92, g: 7.26, length: 45.74, width: 18.98, axisDeg: 19.79, eave: 15.50, ridge: 16.26, role: 'annex' },
    { id: 3206, e: 628869.62, n: 5049447.35, g: 3.87, length: 47.72, width: 17.98, axisDeg: 19.79, eave: 45.08, ridge: 46.28, role: 'boiler' },
    { id: 3207, e: 628828.43, n: 5049470.09, g: 4.84, length: 36.79, width: 18.98, axisDeg: 19.79, eave: 27.46, ridge: 28.25, role: 'turbine' },
    { id: 3208, e: 628842.57, n: 5049438.59, g: 3.91, length: 26.97, width: 12.93, axisDeg: 109.79, eave: 44.76, ridge: 44.83, role: 'boiler' },
    { id: 3209, e: 628845.65, n: 5049541.56, g: 7.38, length: 18.98, width: 17.90, axisDeg: 109.79, eave: 6.16, ridge: 7.36, role: 'annex' },
    { id: 3210, e: 628887.08, n: 5049451.63, g: 4.70, length: 27.84, width: 11.99, axisDeg: 19.79, eave: 26.14, ridge: 26.89, role: 'turbine' },
    { id: 3211, e: 628846.31, n: 5049450.45, g: 3.87, length: 27.97, width: 11.93, axisDeg: 109.79, eave: 44.79, ridge: 45.22, role: 'boiler' },
    { id: 3212, e: 628856.06, n: 5049462.79, g: 4.27, length: 17.98, width: 17.90, axisDeg: 109.79, eave: 48.39, ridge: 48.86, role: 'boiler' },
    { id: 3213, e: 628842.90, n: 5049467.53, g: 4.41, length: 17.90, width: 9.99, axisDeg: 19.79, eave: 44.39, ridge: 45.38, role: 'boiler' },
    { id: 3214, e: 628835.26, n: 5049528.92, g: 7.40, length: 12.93, width: 7.99, axisDeg: 19.79, eave: 10.58, ridge: 10.71, role: 'annex' },
  ] as readonly FootprintBlock[],
  /** Crusher / transfer house east-southeast of the boiler house (building id 29). */
  crusher: { e: 628924.76, n: 5049435.34, g: 5.51, length: 21.38, width: 20.43, axisDeg: 18.70, eave: 15.38 },
  /** North coal yard transfer house (building id 2125). */
  transferNorth: { e: 629040.97, n: 5049361.62, g: 12.95, length: 17.65, width: 17.17, axisDeg: 76.00, eave: 9.88 },
  /** Step-up transformer bays in the switchyard north-west of the turbine hall (OSM nodes 12015830497/8). */
  transformers: [
    { e: 628720.0, n: 5049556.6, g: 12.74 },
    { e: 628716.4, n: 5049546.9, g: 12.76 },
  ] as readonly { e: number; n: number; g: number }[],
  /** Cooling-water intake screenhouse at the mouth of the intake channel (building id 2116). */
  intake: { e: 628689.18, n: 5049323.88, g: 1.62, axisDeg: 16.0 },
} as const;

/**
 * Raised coal piles baked into the Point Tupper terrain heightfield (two mounds beside the shore).
 * Drawn as a dark broken-coal surface only when manifest.stockpiles is absent, so a later stockpiles install wins.
 */
export const COAL_MOUNDS: readonly CoalMoundGrid[] = [
  {
    id: 'coal-north',
    e0: 629036, n0: 5049030, step: 6, cols: 16, rows: 16,
    dtmDm: [
      -999,-999,-999,-999,-999,-999,-999,-999,117,131,140,140,131,130,135,-999,
      -999,-999,-999,-999,-999,-999,-999,121,147,169,183,175,155,134,136,-999,
      -999,-999,-999,-999,-999,-999,117,145,178,212,229,188,170,150,137,-999,
      -999,-999,-999,-999,-999,-999,137,170,208,245,251,206,178,151,-999,-999,
      -999,-999,-999,-999,-999,134,166,200,236,267,268,230,185,142,-999,-999,
      -999,-999,-999,-999,134,166,199,231,262,273,251,211,170,140,-999,-999,
      -999,-999,-999,124,156,195,231,263,283,272,232,189,154,-999,-999,-999,
      -999,-999,-999,143,179,219,259,294,296,260,216,175,145,-999,-999,-999,
      -999,-999,130,165,203,244,282,301,286,249,203,163,144,-999,-999,-999,
      -999,-999,149,188,228,267,295,297,265,224,183,149,-999,-999,-999,-999,
      -999,134,167,209,254,290,300,279,239,199,164,143,-999,-999,-999,-999,
      121,155,191,233,263,288,292,256,215,177,145,-999,-999,-999,-999,-999,
      -999,134,185,231,263,265,257,228,192,157,143,-999,-999,-999,-999,-999,
      -999,119,145,178,212,213,207,200,169,144,144,-999,-999,-999,-999,-999,
      -999,-999,121,136,146,151,158,156,144,143,143,-999,-999,-999,-999,-999,
      -999,117,124,128,132,136,139,141,140,142,-999,-999,-999,-999,-999,-999,
    ],
  },
  {
    id: 'coal-south',
    e0: 629094, n0: 5048892, step: 6, cols: 17, rows: 22,
    dtmDm: [
      -999,-999,-999,-999,-999,-999,-999,-999,-999,-999,-999,-999,117,133,143,148,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,-999,-999,-999,121,146,171,188,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,-999,-999,-999,144,177,211,225,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,-999,-999,134,174,208,244,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,-999,120,156,199,243,279,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,-999,139,180,222,267,295,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,124,162,205,247,285,-999,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,-999,153,190,230,269,293,-999,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,-999,142,183,223,258,286,-999,-999,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,119,162,205,249,288,300,-999,-999,-999,-999,-999,
      -999,-999,-999,-999,-999,-999,142,186,227,267,299,-999,-999,-999,-999,-999,-999,
      -999,-999,-999,-999,-999,124,166,209,252,290,299,-999,-999,-999,-999,-999,-999,
      -999,-999,-999,-999,-999,148,188,232,273,298,279,-999,-999,-999,-999,-999,-999,
      -999,-999,-999,-999,131,174,216,255,291,295,-999,-999,-999,-999,-999,-999,-999,
      -999,-999,-999,117,160,201,238,279,298,268,-999,-999,-999,-999,-999,-999,-999,
      -999,-999,-999,143,185,224,264,295,281,-999,-999,-999,-999,-999,-999,-999,-999,
      -999,-999,129,173,213,253,293,296,261,-999,-999,-999,-999,-999,-999,-999,-999,
      -999,-999,155,198,241,281,302,273,224,-999,-999,-999,-999,-999,-999,-999,-999,
      -999,141,183,222,263,299,300,254,-999,-999,-999,-999,-999,-999,-999,-999,-999,
      129,169,212,244,264,276,268,229,-999,-999,-999,-999,-999,-999,-999,-999,-999,
      141,160,179,202,216,233,244,-999,-999,-999,-999,-999,-999,-999,-999,-999,-999,
      -999,-999,-999,160,173,190,195,-999,-999,-999,-999,-999,-999,-999,-999,-999,-999,
    ],
  },
];

export const COAL_YARD = {
  /** Shore transfer tower where the offshore coal pier conveyor meets the yard conveyors. */
  shoreTower: { e: 629036.0, n: 5049020.0, g: 2.28 },
  /** North coal yard stacker/reclaimer gantry tower (HRDEM DSM 36.0 m peak at 629028, 5049162). */
  northStacker: { e: 629028.0, n: 5049162.0, g: 15.48, boomAzDeg: 95 },
  /** South coal yard stacker head cantilevered over the south pile. */
  southStacker: { e: 629124.0, n: 5048966.0, g: 15.62, boomAzDeg: 130 },
  /** High-mast floodlight poles around the coal yard perimeter (all clear of roads and #112 lines). */
  lightMasts: [
    { e: 629032.0, n: 5049080.0, g: 8.23 },
    { e: 629005.0, n: 5049210.0, g: 10.33 },
    { e: 629018.0, n: 5049315.0, g: 11.50 },
    { e: 629086.0, n: 5049300.0, g: 17.69 },
    { e: 629076.0, n: 5049004.0, g: 7.41 },
    { e: 629150.0, n: 5048910.0, g: 11.39 },
  ] as readonly { e: number; n: number; g: number }[],
} as const;

export const COAL_CONVEYORS: readonly ConveyorRun[] = [
  // 1. Offshore coal pier collector along the 182 m docking head into the elbow transfer house.
  {
    id: 'coal-pier-head',
    width: 2.6, height: 2.0, truss: false,
    points: [
      { e: 628475.0, n: 5048880.5, g: -0.85, lift: 7.2, bent: false },
      { e: 628545.0, n: 5048861.0, g: -0.83, lift: 7.2, bent: false },
      { e: 628630.5, n: 5048836.5, g: -0.62, lift: 7.5, bent: false },
    ],
  },
  // 2. Offshore trestle conveyor bridge from the coal pier elbow to the shore transfer tower (445 m).
  {
    id: 'coal-pier-trestle',
    width: 3.0, height: 2.4, truss: true,
    points: [
      { e: 628630.5, n: 5048836.5, g: -0.62, lift: 7.5, bent: true },
      { e: 628670.2, n: 5048854.2, g: -0.82, lift: 7.6, bent: true },
      { e: 628709.9, n: 5048871.9, g: -0.83, lift: 7.8, bent: true },
      { e: 628749.7, n: 5048889.7, g: -0.88, lift: 7.9, bent: true },
      { e: 628789.4, n: 5048907.4, g: -0.79, lift: 8.0, bent: true },
      { e: 628829.1, n: 5048925.1, g: -0.82, lift: 8.2, bent: true },
      { e: 628868.8, n: 5048942.8, g: -0.81, lift: 8.4, bent: true },
      { e: 628908.6, n: 5048960.6, g: -0.79, lift: 8.6, bent: true },
      { e: 628948.3, n: 5048978.3, g: -0.79, lift: 9.0, bent: true },
      { e: 628988.0, n: 5048996.0, g: -0.77, lift: 10.2, bent: true },
      { e: 629012.0, n: 5049008.0, g: 0.73, lift: 10.8, bent: true },
      { e: 629036.0, n: 5049020.0, g: 2.28, lift: 11.5, bent: true },
    ],
  },
  // 3. South coal pile stacker conveyor from the shore transfer tower up over the south pile.
  {
    id: 'coal-yard-south',
    width: 2.6, height: 2.1, truss: true,
    points: [
      { e: 629036.0, n: 5049020.0, g: 2.28, lift: 11.5, bent: false },
      { e: 629071.2, n: 5048998.4, g: 4.28, lift: 14.5, bent: true },
      { e: 629106.4, n: 5048976.8, g: 10.06, lift: 12.5, bent: true },
      { e: 629124.0, n: 5048966.0, g: 15.62, lift: 11.0, bent: false },
    ],
  },
  // 4. North coal yard conveyor from the shore transfer tower via the stacker tower to id 2125.
  {
    id: 'coal-yard-north',
    width: 2.8, height: 2.2, truss: true,
    points: [
      { e: 629036.0, n: 5049020.0, g: 2.28, lift: 11.5, bent: false },
      { e: 629032.0, n: 5049091.0, g: 9.96, lift: 10.5, bent: true },
      { e: 629029.3, n: 5049138.3, g: 11.08, lift: 12.5, bent: true },
      { e: 629028.0, n: 5049162.0, g: 15.48, lift: 12.0, bent: false },
      { e: 629030.9, n: 5049206.4, g: 15.74, lift: 9.5, bent: true },
      { e: 629033.8, n: 5049250.7, g: 11.87, lift: 11.5, bent: true },
      { e: 629036.7, n: 5049295.1, g: 12.02, lift: 11.5, bent: true },
      { e: 629039.6, n: 5049339.4, g: 12.57, lift: 11.5, bent: true },
      { e: 629041.0, n: 5049361.6, g: 12.97, lift: 11.5, bent: false },
    ],
  },
  // 5. High inclined boiler-feed conveyor from transfer house id 2125 via crusher id 29 into the boiler bunker bay.
  {
    id: 'coal-boiler-feed',
    width: 3.2, height: 2.6, truss: true,
    points: [
      { e: 629041.0, n: 5049361.6, g: 12.97, lift: 11.5, bent: false },
      { e: 629021.6, n: 5049373.9, g: 10.94, lift: 13.0, bent: true },
      { e: 629002.3, n: 5049386.2, g: 9.90, lift: 13.8, bent: true },
      // Overhead clear span across the yard access road at (628982.9, 5049398.4): bent=false.
      { e: 628982.9, n: 5049398.4, g: 7.73, lift: 15.2, bent: false },
      { e: 628963.5, n: 5049410.7, g: 5.68, lift: 16.5, bent: true },
      { e: 628944.2, n: 5049423.0, g: 5.21, lift: 16.5, bent: true },
      { e: 628924.8, n: 5049435.3, g: 5.54, lift: 16.0, bent: false },
      { e: 628900.4, n: 5049445.7, g: 5.22, lift: 26.5, bent: true },
      { e: 628876.0, n: 5049456.0, g: 4.29, lift: 36.0, bent: false },
    ],
  },
];

/** Point Tupper Coal Marine Terminal (OSM way/181365300 + HRDEM DSM). */
export const COAL_PIER = {
  /** Offshore concrete-crib/pile docking pier head (182 m long x 14 m wide, deck +4.8 m above sea). */
  headStart: [628455.0, 5048886.0] as const,
  headEnd: [628630.5, 5048836.5] as const,
  headWidth: 14.0,
  deckY: 4.8,
  /** Approach trestle from elbow to shore (parallel service walkway under the offshore conveyor). */
  trestleEnd: [629012.0, 5049008.0] as const,
  trestleWidth: 5.0,
  /** Rail-mounted equilibrium ship unloader (E-Crane, HRDEM DSM 24.9 m peak). */
  crane: { e: 628603.0, n: 5048844.5 },
  /** Receiving hopper tower (HRDEM DSM 16.7 m peak). */
  hopper: { e: 628545.0, n: 5048861.0 },
  /** Elbow transfer house linking head belt to offshore trestle belt. */
  elbowTower: { e: 628630.5, n: 5048836.5 },
  /** Flanking offshore mooring dolphins along the berth line. */
  dolphins: [
    { e: 628420.0, n: 5048896.0, kind: 'mooring', faceDeg: 196, navLight: 'red' },
    { e: 628664.0, n: 5048827.0, kind: 'mooring', faceDeg: 196, navLight: 'green' },
  ] as readonly DolphinSpec[],
} as const;

/** Point Tupper Liquid Bulk Marine Terminal (NSTDB WAWH40 + STBP60 + OSM way/163215590 + HRDEM DSM). */
export const OIL_TERMINAL = {
  /** Onshore multi-pipe rack from the shore abutment up past shore building id 22 (clear of roads). */
  onshorePipe: [
    { e: 629485.0, n: 5048168.0, g: 6.85, lift: 6.5, bent: true },
    { e: 629435.0, n: 5048148.0, g: 3.38, lift: 6.5, bent: true },
    { e: 629368.0, n: 5048118.0, g: 2.89, lift: 5.5, bent: true },
  ] as readonly ConveyorPoint[],
  /** Offshore approach trestle carrying roadway + 6-pipe rack to the main loading head. */
  approachStart: [629368.0, 5048118.0] as const,
  approachEnd: [629224.0, 5048016.0] as const,
  approachWidth: 12.5,
  deckY: 5.4,
  /** Main Berth 1 outer loading head (around platform control house id 49). */
  berth1Center: [629220.0, 5048002.0] as const,
  berth1Length: 74.0,
  berth1Width: 32.0,
  berth1AxisDeg: 324.0,
  /** North Berth 2 pier arm extending NW along the channel. */
  berth2Start: [629218.0, 5048036.0] as const,
  berth2End: [629096.0, 5048189.0] as const,
  berth2Width: 15.0,
  /** Control / equipment house footprint already in buildings.json (id 49). */
  controlHouse: { e: 629242.46, n: 5048028.17, length: 20.02, width: 16.26, axisDeg: 52.79, eave: 15.81 },
  /** Tall gangway & hose-crane / fire-monitor tower on Berth 1 (HRDEM DSM 31.5 m peak). */
  gangwayTower: { e: 629211.0, n: 5047977.0, height: 26.0 },
  /** Berth 1 outer bank: 5 large articulated marine loading arms facing SW (azimuth 234 deg). */
  berth1Arms: {
    start: [629194.0, 5048007.0] as const,
    end: [629222.0, 5047969.0] as const,
    count: 5,
    faceDeg: 234.0,
    scale: 1.0,
  },
  /** Berth 2 inner bank: 4 medium articulated marine loading arms facing SW on the north arm. */
  berth2Arms: {
    start: [629124.0, 5048155.0] as const,
    end: [629150.0, 5048120.0] as const,
    count: 4,
    faceDeg: 234.0,
    scale: 0.72,
  },
  /** Small shore service / launch wharf south of the approach (NSTDB WAWH40). */
  launchWharf: { start: [629446.0, 5047993.0] as const, end: [629407.0, 5048035.0] as const, width: 14.0, deckY: 2.6 },
  /**
   * All 11 NSTDB STBP60 mooring & breasting dolphins along the 585 m deepwater berth line,
   * ordered SE to NW so adjacent dolphins connect cleanly by steel truss catwalks.
   */
  dolphins: [
    { e: 629354.3, n: 5047820.8, kind: 'mooring', faceDeg: 234, navLight: 'green' },
    { e: 629317.3, n: 5047871.1, kind: 'mooring', faceDeg: 234 },
    { e: 629279.4, n: 5047921.4, kind: 'mooring', faceDeg: 234 },
    { e: 629235.0, n: 5047942.6, kind: 'breasting', faceDeg: 234 },
    { e: 629245.8, n: 5047949.8, kind: 'breasting', faceDeg: 234 },
    { e: 629252.7, n: 5047958.9, kind: 'breasting', faceDeg: 234 },
    { e: 629167.3, n: 5048032.3, kind: 'breasting', faceDeg: 234 },
    { e: 629176.1, n: 5048040.5, kind: 'breasting', faceDeg: 234 },
    { e: 629064.8, n: 5048220.4, kind: 'mooring', faceDeg: 234 },
    { e: 629037.1, n: 5048256.9, kind: 'mooring', faceDeg: 234 },
    { e: 629008.4, n: 5048292.4, kind: 'mooring', faceDeg: 234, navLight: 'red' },
  ] as readonly DolphinSpec[],
  /** Catwalk spans [e0, n0, e1, n1] linking dolphins to each other and to the main pier decks. */
  catwalks: [
    [629354.3, 5047820.8, 629317.3, 5047871.1],
    [629317.3, 5047871.1, 629279.4, 5047921.4],
    [629279.4, 5047921.4, 629252.7, 5047958.9],
    [629252.7, 5047958.9, 629245.8, 5047949.8],
    [629245.8, 5047949.8, 629235.0, 5047942.6],
    [629245.8, 5047949.8, 629235.0, 5047980.0],
    [629167.3, 5048032.3, 629176.1, 5048040.5],
    [629176.1, 5048040.5, 629194.0, 5048024.0],
    [629096.0, 5048189.0, 629064.8, 5048220.4],
    [629064.8, 5048220.4, 629037.1, 5048256.9],
    [629037.1, 5048256.9, 629008.4, 5048292.4],
  ] as readonly (readonly [number, number, number, number])[],
} as const;

/** Paper Mill Marine Wharf (NSTDB WAWH40 + OSM ways 1084321651 & 1084321647 + STCV50 row-z4qj~ipw8_554x). */
export const PAPER_WHARF = {
  start: [627651.0, 5050423.0] as const,
  end: [627758.0, 5050356.0] as const,
  width: 14.0,
  deckY: 3.2,
  faceDeg: 212.0,
  /** Circular concrete mooring dolphin (OSM way 1084321647 / NSTDB STBP60). */
  dolphin: { e: 627612.0, n: 5050448.4, radius: 7.2, deckY: 3.0 },
  /** Marine wharf conveyor gallery excluded from pt-infrastructure (row-z4qj~ipw8_554x). */
  conveyor: {
    id: 'paper-wharf-conveyor',
    width: 2.6, height: 2.0, truss: true,
    points: [
      { e: 627804.5, n: 5050514.8, g: 7.94, lift: 7.0, bent: false },
      { e: 627778.3, n: 5050481.1, g: 4.34, lift: 8.5, bent: true },
      { e: 627752.2, n: 5050447.5, g: 2.08, lift: 9.5, bent: true },
      { e: 627726.0, n: 5050413.8, g: -0.57, lift: 11.0, bent: true },
      { e: 627712.9, n: 5050397.0, g: 1.94, lift: 10.5, bent: false },
    ],
  } satisfies ConveyorRun,
  loader: { e: 627712.9, n: 5050397.0, faceDeg: 212.0 },
} as const;

/** North Bulk / Gypsum Marine Terminal Pier (OSM way/181364913). */
export const NORTH_BULK_PIER = {
  approachStart: [627083.0, 5051512.0] as const,
  approachElbow: [626972.0, 5051445.0] as const,
  berthStart: [626874.0, 5051418.0] as const,
  berthEnd: [626912.0, 5051358.0] as const,
  berthWidth: 16.0,
  deckY: 4.6,
  faceDeg: 237.0,
  loader: { e: 626894.0, n: 5051392.0, faceDeg: 237.0 },
  conveyor: {
    id: 'north-bulk-conveyor',
    width: 2.6, height: 2.0, truss: true,
    points: [
      { e: 627083.0, n: 5051512.0, g: 6.16, lift: 6.0, bent: true },
      { e: 627046.0, n: 5051489.7, g: 4.65, lift: 6.8, bent: true },
      { e: 627009.0, n: 5051467.3, g: 3.07, lift: 7.5, bent: true },
      { e: 626972.0, n: 5051445.0, g: 2.30, lift: 8.2, bent: true },
      { e: 626934.0, n: 5051418.0, g: 2.30, lift: 9.2, bent: true },
      { e: 626894.0, n: 5051392.0, g: 1.83, lift: 10.5, bent: false },
    ],
  } satisfies ConveyorRun,
  dolphins: [
    { e: 626854.0, n: 5051448.0, kind: 'mooring', faceDeg: 237, navLight: 'red' },
    { e: 626930.0, n: 5051328.0, kind: 'mooring', faceDeg: 237, navLight: 'green' },
  ] as readonly DolphinSpec[],
} as const;
