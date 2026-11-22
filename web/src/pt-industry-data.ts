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
  /** Compact row spans [row, colStart, ...dtmDecimetres] on the 2 m baked terrain lattice. */
  readonly spans: readonly (readonly number[])[];
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
    id: 'coal-north', e0: 629036, n0: 5049028, step: 2, cols: 48, rows: 48,
    spans: [
      [0,26,117,122,128,130,132,131,131,131,129,129,127,128,129,130,131,133,135,136,137],
      [1,22,115,117,117,120,125,131,135,137,140,140,141,140,138,135,131,129,129,130,132,134,135,136,137],
      [2,22,119,125,126,130,137,143,147,150,153,152,151,151,149,147,143,134,130,131,133,134,135,137],
      [3,21,115,121,130,135,141,149,156,161,165,167,165,164,163,162,161,157,143,135,133,133,135,136,137],
      [4,20,116,121,129,138,147,154,162,169,175,181,183,182,180,175,171,164,155,149,139,134,134,135,136,137],
      [5,19,116,120,128,138,148,158,167,176,184,191,195,198,198,191,184,173,161,159,154,145,138,135,135,136],
      [6,19,119,127,136,147,158,168,179,190,199,206,211,214,211,198,187,172,161,165,160,152,144,137,136,137],
      [7,18,117,124,134,145,156,167,178,190,202,212,220,226,229,219,203,188,175,166,170,169,162,150,140,137,137],
      [8,18,122,131,142,153,165,177,189,201,212,224,234,242,239,222,206,193,180,170,172,172,169,154,142,137],
      [9,17,120,129,139,150,162,174,186,199,212,224,235,246,252,244,227,212,198,187,176,173,174,168,154,142,138],
      [10,16,119,128,137,147,158,170,182,195,208,220,234,245,256,259,251,237,219,206,194,183,178,177,166,151,140,139],
      [11,15,119,128,137,146,156,167,179,191,205,217,230,242,254,262,264,261,247,228,215,202,190,181,174,161,148,140],
      [12,14,117,126,135,146,156,166,177,189,201,214,227,239,250,261,266,269,268,254,238,225,211,198,185,169,155,144,140],
      [13,13,119,126,134,145,155,166,176,188,200,211,223,236,248,259,267,269,272,268,257,245,230,214,199,185,168,153,142,141],
      [14,12,117,127,136,145,154,164,176,187,199,211,222,233,244,255,265,269,273,272,263,251,239,225,209,194,181,166,153,142],
      [15,12,126,136,145,155,165,176,187,198,210,221,232,243,253,262,269,272,274,269,258,245,231,217,203,189,175,162,151,142],
      [16,11,122,134,144,155,166,177,188,199,209,220,231,242,253,262,269,272,273,271,263,251,238,225,211,197,183,170,158,147,140],
      [17,10,118,130,141,152,165,178,190,199,209,221,232,242,253,262,270,273,276,277,269,256,243,230,217,204,190,177,165,153,142],
      [18,9,116,127,137,149,160,174,187,199,210,221,231,242,253,263,273,277,279,280,275,265,253,239,223,209,195,183,171,159,148,141],
      [19,9,124,134,145,156,168,181,195,208,220,231,241,252,263,273,282,283,284,282,272,260,246,232,217,203,189,177,165,154,144,141],
      [20,8,119,130,141,153,164,176,190,202,215,228,240,252,263,273,282,287,288,288,282,269,255,242,226,211,197,184,171,160,150,142],
      [21,8,125,136,147,159,171,184,198,211,224,237,250,263,274,285,291,291,292,290,279,265,250,236,221,205,192,179,166,155,146,143],
      [22,7,120,132,143,154,165,179,192,205,219,233,246,259,271,283,294,297,297,296,287,274,260,246,231,216,201,188,175,162,152,145,144],
      [23,6,117,127,138,149,161,173,187,201,214,227,240,254,268,279,289,294,297,298,296,285,271,257,242,226,211,197,184,170,159,149,145],
      [24,6,124,134,145,157,169,181,194,210,223,236,248,262,275,288,296,295,295,296,293,283,269,255,239,224,208,193,179,166,155,147,145],
      [25,5,118,130,141,153,165,177,191,203,216,231,244,256,269,282,293,300,301,300,295,286,276,263,249,233,218,203,189,175,163,151,145,144],
      [26,5,125,136,148,160,172,185,199,213,225,238,250,263,275,286,295,299,301,301,292,280,267,253,239,225,211,197,183,172,159,148,144],
      [27,4,119,131,142,154,167,180,193,206,220,234,247,259,270,282,292,296,299,300,295,285,274,260,247,231,217,202,189,175,166,154,145,144],
      [28,4,125,137,149,162,175,188,201,215,228,242,255,267,278,288,295,297,299,297,288,277,265,251,238,224,210,196,183,169,159,149,143,143],
      [29,3,120,131,143,155,169,182,197,211,225,238,251,263,275,286,293,296,298,298,291,281,269,255,241,228,216,203,190,177,165,155,145,143],
      [30,3,126,138,149,162,175,189,204,220,234,247,260,272,283,292,297,298,299,294,285,273,261,248,233,220,208,195,183,171,160,150,144,143],
      [31,2,122,134,146,156,167,180,194,209,225,239,254,267,279,290,297,298,300,299,290,279,265,253,239,225,212,199,187,175,164,154,145,143],
      [32,1,117,129,141,153,164,175,187,200,214,228,243,259,272,284,293,297,300,300,293,283,270,259,245,230,216,204,191,179,168,157,148,143,143],
      [33,1,123,135,149,161,172,183,197,210,223,235,246,261,276,288,294,297,299,297,288,275,261,248,236,223,209,196,183,172,160,151,144,143,143],
      [34,0,121,131,143,155,168,179,191,205,219,233,244,253,263,274,284,288,292,296,292,282,269,256,241,227,215,202,189,177,165,154,145,143,143],
      [35,0,125,132,143,159,174,186,200,214,227,241,254,264,272,276,277,281,286,287,280,270,259,248,234,220,207,195,182,170,158,148,143,143,143],
      [36,1,125,133,147,168,186,199,211,227,244,258,268,274,274,273,275,278,276,268,259,249,238,226,212,199,187,176,164,152,144,143,143,143],
      [37,1,115,122,134,155,171,185,197,215,231,243,255,263,265,265,265,264,263,257,248,239,228,217,204,192,179,168,157,147,143,143,143,143],
      [38,3,127,144,160,173,183,200,213,223,238,247,252,253,247,243,243,245,238,228,218,208,196,184,172,160,149,144,144,143,143],
      [39,3,124,138,151,162,170,182,196,205,220,230,237,237,230,226,223,226,224,219,209,198,188,177,166,154,145,144,144,144,144],
      [40,3,119,130,138,145,158,165,178,189,202,212,217,215,213,212,209,207,205,206,200,189,179,169,159,148,144,144,144,144,144],
      [41,4,122,126,131,142,152,163,172,180,189,188,185,189,193,194,190,186,187,188,181,171,161,151,144,143,144,144,144],
      [42,4,116,120,124,132,139,148,156,160,159,155,156,165,173,176,173,169,169,171,170,162,152,144,143,143,143,144,144],
      [43,4,117,119,121,124,129,136,143,147,146,143,144,151,157,160,158,155,154,156,156,152,144,142,142,143,143,144,143],
      [44,4,117,120,122,123,125,129,134,137,136,135,136,140,145,148,146,144,144,145,144,142,141,141,142,142,143,143],
      [45,3,116,119,121,123,124,126,127,129,130,132,133,134,136,138,139,140,140,141,141,140,140,140,141,142,142,143,143],
      [46,3,117,120,122,124,125,127,128,129,130,132,133,134,136,137,138,139,140,141,141,141,140,140,141,142,142,143],
      [47,2,115,118,121,124,125,126,127,128,130,131,132,133,134,135,137,138,139,140,141,142,141,141,141,141,142,142,143],
    ],
  },
  {
    id: 'coal-south', e0: 629092, n0: 5048892, step: 2, cols: 52, rows: 66,
    spans: [
      [0,37,117,122,127,133,135,138,143,149,148,148],
      [1,36,118,124,130,135,143,146,153,158,164,163,161],
      [2,35,119,125,134,142,147,154,159,168,173,179,178],
      [3,34,121,128,137,146,156,164,171,175,182,188,192,194],
      [4,33,118,127,137,145,158,169,178,185,191,191,201,208],
      [5,32,117,125,134,145,155,167,180,190,199,207,205,214,221],
      [6,32,122,134,144,154,165,177,190,201,211,220,219,225,232],
      [7,31,119,129,141,152,163,176,188,199,212,223,232,231,237],
      [8,30,118,125,138,150,161,174,186,198,209,221,234,245,246,246],
      [9,30,123,134,146,160,174,186,198,208,220,231,244,257,261],
      [10,29,118,129,142,155,168,183,197,209,221,232,243,253,266,271],
      [11,29,124,136,148,163,176,191,205,220,233,245,255,266,275],
      [12,28,120,131,144,156,170,184,199,213,229,243,257,268,279,286],
      [13,27,116,126,139,150,163,177,193,207,222,236,251,266,278,290,293],
      [14,27,122,133,145,159,173,186,200,215,231,245,260,273,285,294],
      [15,26,117,127,139,153,167,180,193,207,222,237,252,267,280,290,295],
      [16,26,122,133,145,159,173,188,201,215,230,244,258,272,285,293],
      [17,25,120,129,140,153,166,182,196,211,225,238,252,266,279,288,293],
      [18,25,124,135,148,162,176,191,205,219,233,247,261,274,285,291],
      [19,24,120,132,144,157,171,185,199,213,227,240,254,268,281,289,292],
      [20,23,117,130,142,155,167,180,193,208,221,235,248,262,275,286,292,295],
      [21,23,128,140,153,166,177,190,202,216,230,244,257,269,282,289,293],
      [22,22,123,137,150,163,177,188,200,212,225,238,251,265,277,286,291,295],
      [23,21,118,132,146,160,173,187,199,211,223,235,248,260,271,283,289,293],
      [24,21,128,142,156,169,183,197,209,223,235,247,258,271,281,286,290,295],
      [25,20,120,134,149,164,177,190,205,218,233,247,259,269,280,291,292,292,294],
      [26,20,126,141,156,171,185,199,213,226,240,254,270,282,289,295,297,297],
      [27,19,119,132,147,162,176,191,205,220,235,249,261,275,288,295,298,300,298],
      [28,19,126,140,155,168,182,197,212,227,241,255,268,282,293,298,300,302],
      [29,18,120,135,149,163,177,191,204,219,233,247,261,275,289,298,300,304,301],
      [30,18,127,142,157,171,186,201,213,227,241,255,267,280,292,299,303,304],
      [31,17,121,135,150,164,179,194,208,220,235,250,263,276,286,292,297,302,299],
      [32,16,116,131,145,158,173,186,201,215,229,243,256,270,284,293,295,296,296,289],
      [33,16,124,138,152,166,180,195,209,223,238,252,264,277,290,295,298,299,292],
      [34,15,116,130,145,160,174,188,202,216,231,247,260,272,285,294,297,300,296,286],
      [35,15,125,138,153,166,181,196,210,223,237,253,269,282,293,296,298,300,289],
      [36,14,120,133,148,162,175,188,203,217,232,245,258,273,288,296,298,299,293,279],
      [37,13,116,130,143,156,170,185,198,210,225,240,254,268,281,292,297,302,298,285],
      [38,13,124,138,152,166,180,194,207,219,234,247,260,276,288,295,299,301,289,274],
      [39,12,119,131,144,159,174,188,203,216,229,243,255,269,281,291,296,299,295,280,262],
      [40,11,117,129,143,154,166,179,195,210,223,235,251,266,278,288,293,298,297,286,271],
      [41,11,124,138,152,166,177,190,202,216,230,244,258,274,288,292,295,297,289,277,263],
      [42,10,117,131,146,160,175,187,201,212,224,238,251,264,279,291,297,298,295,282,268],
      [43,10,126,140,154,168,181,196,210,223,235,248,260,272,283,290,297,299,290,275,260],
      [44,9,121,135,149,163,176,189,203,217,230,243,256,272,283,288,292,296,290,280,267],
      [45,8,116,129,143,156,171,185,198,211,224,237,250,264,278,291,295,297,294,281,269,258],
      [46,8,126,140,153,165,179,193,208,222,235,248,260,272,284,292,298,299,289,274,260,247],
      [47,7,120,135,150,164,177,190,203,217,231,244,258,272,285,291,293,297,294,283,269,253],
      [48,6,116,129,143,158,173,187,199,213,227,240,253,267,282,293,297,298,296,284,272,261,246],
      [49,6,124,137,151,165,180,195,208,221,235,249,263,277,290,297,300,303,293,276,261,249],
      [50,5,119,133,145,159,174,189,203,217,231,244,257,272,286,296,300,303,299,285,268,251,234],
      [51,5,128,142,155,168,183,198,212,227,241,255,267,281,293,300,302,302,290,273,255,240,224],
      [52,4,122,138,152,166,179,192,206,221,236,250,263,277,291,298,302,305,298,282,262,242,224],
      [53,3,119,131,145,161,175,187,201,214,228,242,256,269,285,298,302,305,305,291,275,256,235,212],
      [54,2,116,128,141,155,169,183,195,208,222,236,249,263,276,291,299,304,307,300,285,269,254,235,211],
      [55,2,124,138,151,165,178,192,204,217,231,245,258,271,281,290,298,303,302,291,277,261,246,231],
      [56,1,120,132,147,161,175,188,201,215,227,242,256,267,276,278,282,289,299,293,279,268,252,236,220],
      [57,0,115,129,142,155,169,183,197,212,224,233,244,253,258,264,268,273,276,282,281,268,256,243,229],
      [58,0,124,138,153,165,177,192,206,218,222,227,233,238,245,251,257,262,265,268,266,257,244,232,220],
      [59,0,133,146,160,169,179,186,199,201,202,208,215,221,225,233,240,246,249,257,258,252,237,223,208],
      [60,1,141,145,155,160,163,171,179,184,193,202,207,211,216,221,229,233,240,245,244,230,215],
      [61,4,145,148,153,162,171,179,187,194,199,203,206,212,218,223,226,230,222,210],
      [62,6,143,150,158,166,174,181,185,188,192,197,205,210,210,213,211],
      [63,0,115],
      [63,8,147,155,160,167,170,173,177,182,190,196,197,195,195],
      [64,2,116,117],
      [64,10,147,149,151,158,162,168,173,181,182,180,178],
      [65,1,115,116,117,118,120],
      [65,12,139,146,149,154,160,169,172,170],
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
      { e: 629034.0, n: 5049055.5, g: 8.60, lift: 11.2, bent: false },
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
  /** Rail-mounted equilibrium balance-boom ship unloader (HRDEM DSM 24.9 m peak). */
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
    { e: 629485.0, n: 5048168.0, g: 6.85, lift: 7.2, bent: true },
    { e: 629460.0, n: 5048158.0, g: 4.66, lift: 7.2, bent: false },
    { e: 629435.0, n: 5048148.0, g: 3.38, lift: 7.2, bent: true },
    { e: 629398.0, n: 5048131.5, g: 4.31, lift: 7.2, bent: false },
    { e: 629384.0, n: 5048124.0, g: 4.38, lift: 7.2, bent: false },
    { e: 629368.0, n: 5048118.0, g: 2.89, lift: 7.2, bent: true },
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
    start: [629198.5, 5048010.2] as const,
    end: [629226.5, 5047972.2] as const,
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
  start: [627647.8, 5050417.9] as const,
  end: [627754.8, 5050350.9] as const,
  width: 14.0,
  /** Anchored to the shoreline grade (max 1.37 m across apron) so the deck stays clear at every exaggeration. */
  baseG: 1.45,
  deckLift: 1.75,
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
      { e: 627709.7, n: 5050391.9, g: 1.79, lift: 10.5, bent: false },
    ],
  } satisfies ConveyorRun,
  loader: { e: 627709.7, n: 5050391.9, faceDeg: 212.0 },
} as const;

/** North Bulk / Gypsum Marine Terminal Pier (OSM way/181364913). */
export const NORTH_BULK_PIER = {
  berthStart: [626874.0, 5051418.0] as const,
  berthEnd: [626912.0, 5051358.0] as const,
  berthWidth: 16.0,
  /** Anchored to the peninsula bulkhead grade (max 2.05 m across berth) so the deck stays clear at every exaggeration. */
  baseG: 2.10,
  deckLift: 1.85,
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
