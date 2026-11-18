import type { Road } from './roads';
import type { Manifest } from './terrain';

export type Point = readonly [number, number];
export type MapBox = readonly [number, number, number, number]; // EPSG:2961, west/south/east/north
export interface HikeLine { name: string | null; pts: Point[]; osm?: number }
export interface Hike {
  id: string; area: string; name: string; kind: 'rail-trail' | 'park' | 'highlands';
  length: string | null; difficulty: string | null; note: string; trailhead: string; sources: string[];
  line?: HikeLine[];
}
export const TRAIL_COLOUR = '#b04c68';
/** A key typed into a list or a text box belongs to that control (M picks an entry in a Settings list), not to a shortcut. */
export const typing = (ev: KeyboardEvent) => ev.target instanceof HTMLElement && (ev.target.isContentEditable || ['SELECT', 'INPUT', 'TEXTAREA'].includes(ev.target.tagName));
export const TRAIL_CAUTION = 'Trails change. Ask the people who keep a trail before you go. This is not a map for navigation.';
export const RAIL_NAMES = ['Mabou Rivers Trail', 'Chestico Trail', 'Inverness Shean Trail'];
export function playableBox(manifest: Pick<Manifest, 'mid' | 'cover'>): MapBox {
  const b = manifest.mid ?? [manifest.cover.xmin, manifest.cover.ymin, manifest.cover.xmax, manifest.cover.ymax];
  return [b[0] + 120, b[1] + 120, b[2] - 120, b[3] - 120];
}
/** Liang-Barsky clipping keeps crossings, and never joins separate pieces across the edge. */
export function clipLine(points: readonly Point[], box: MapBox): Point[][] {
  const result: Point[][] = [];
  let piece: Point[] = [];
  const finish = () => { if (piece.length > 1) result.push(piece); piece = []; };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1];
    let lo = 0, hi = 1, valid = true;
    for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[2] - a[0]], [-dy, a[1] - box[1]], [dy, box[3] - a[1]]]) {
      if (p === 0) { if (q < 0) valid = false; }
      else if (p < 0) lo = Math.max(lo, q / p);
      else hi = Math.min(hi, q / p);
    }
    if (!valid || lo > hi) { finish(); continue; }
    const at = (t: number): Point => [Math.min(box[2], Math.max(box[0], a[0] + dx * t)), Math.min(box[3], Math.max(box[1], a[1] + dy * t))];
    const start = at(lo), end = at(hi), last = piece.at(-1);
    if (last && Math.hypot(last[0] - start[0], last[1] - start[1]) > .001) finish();
    if (!piece.length) piece.push(start);
    piece.push(end);
    if (hi < 1) finish();
  }
  finish(); return result;
}
export function lineLength(lines: readonly HikeLine[]): number {
  return lines.reduce((sum, line) => sum + line.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line.pts[i][0], p[1] - line.pts[i][1]), 0), 0);
}
export function hikeFacts(hike: Hike): string {
  return [hike.length, hike.difficulty, hike.note].filter(Boolean).join(' · ');
}

// Only the two authorised OSM ways. EPSG:2961; © OpenStreetMap contributors, ODbL.
export const HIGHLANDS_LINES: readonly HikeLine[] = [
  { osm: 117656340, name: null, pts: [
    [619930.4, 5111043.4], [619930.3, 5111052.4], [619930.1, 5111061.4], [619927.7, 5111079.4], [619920.4, 5111099.3],
    [619918.3, 5111102.2], [619917.3, 5111105.2], [619915.1, 5111111.2], [619914.1, 5111115.1], [619914.0, 5111121.1],
    [619913.9, 5111125.1], [619913.8, 5111128.1], [619915.5, 5111145.2], [619917.4, 5111151.2], [619919.3, 5111157.2],
    [619921.2, 5111163.3], [619922.0, 5111170.3], [619921.9, 5111176.3], [619922.8, 5111183.3], [619921.7, 5111189.3],
    [619920.5, 5111196.3], [619919.4, 5111202.2], [619916.9, 5111232.2], [619914.7, 5111292.2], [619917.7, 5111348.2],
    [619922.9, 5111388.3], [619925.8, 5111392.4], [619930.8, 5111395.5], [619936.7, 5111398.6], [619942.7, 5111399.7],
    [619978.6, 5111404.4], [619987.6, 5111405.5], [619990.6, 5111405.6], [619994.6, 5111406.7], [619997.6, 5111407.7],
    [620001.5, 5111408.8], [620002.5, 5111408.8], [620004.5, 5111409.9], [620007.5, 5111410.9], [620010.5, 5111413.0],
    [620013.4, 5111415.0], [620016.4, 5111417.1], [620067.7, 5111453.1], [620116.5, 5111479.6], [620118.2, 5111481.0],
    [620119.7, 5111483.1], [620120.1, 5111485.0], [620120.0, 5111489.0], [620119.0, 5111492.0], [620117.9, 5111494.0],
    [620113.9, 5111496.9], [620111.9, 5111497.9], [620083.6, 5111510.4], [620062.3, 5111527.0], [620026.7, 5111558.3],
    [620023.7, 5111561.2], [620017.5, 5111570.1], [620016.4, 5111573.1], [620014.4, 5111576.1], [620013.3, 5111580.0],
    [620013.2, 5111585.0], [620012.1, 5111590.0], [620012.0, 5111597.0], [620012.8, 5111604.0], [620014.7, 5111610.1],
    [620016.7, 5111614.1], [620019.5, 5111620.2], [620024.7, 5111627.0], [620028.3, 5111630.3], [620095.3, 5111685.6],
    [620097.3, 5111687.6], [620097.3, 5111688.6], [620098.2, 5111689.6], [620098.2, 5111690.6], [620098.2, 5111692.6],
    [620098.2, 5111693.6], [620098.1, 5111694.6], [620098.1, 5111695.6], [620098.1, 5111696.6], [620083.9, 5111705.4],
    [620081.9, 5111706.3], [620049.6, 5111723.7], [620009.3, 5111737.0], [620003.3, 5111738.8], [619998.3, 5111740.8],
    [619993.2, 5111744.7], [619989.1, 5111749.6], [619985.0, 5111756.5], [619983.9, 5111760.5], [619982.8, 5111764.5],
    [619982.7, 5111768.5], [619983.6, 5111773.5], [619984.6, 5111776.5], [619989.2, 5111796.6], [620010.2, 5111849.0],
    [620012.1, 5111856.0], [620013.0, 5111862.0], [620013.9, 5111867.1], [620014.1, 5111870.0], [620014.7, 5111876.1],
    [620014.6, 5111883.1], [620013.8, 5111887.8], [620013.4, 5111890.1], [620013.4, 5111892.1], [620012.3, 5111896.0],
    [620011.2, 5111903.0], [619992.7, 5111931.7], [619975.2, 5111957.3], [619972.1, 5111961.3], [619970.0, 5111966.2],
    [619966.9, 5111971.2], [619966.9, 5111972.2], [619964.8, 5111976.1], [619962.6, 5111986.1], [619961.5, 5111992.1],
    [619960.4, 5111997.1], [619960.3, 5112003.1], [619960.2, 5112008.1], [619961.1, 5112013.1], [619962.0, 5112019.1],
    [619962.9, 5112024.1], [619964.8, 5112029.1], [619966.7, 5112034.2], [619968.6, 5112039.2], [619992.7, 5112087.7],
    [620014.3, 5112141.4],
  ] },
  { osm: 537781826, name: 'Beaton Trail', pts: [
    [620898.6, 5111247.7], [620865.6, 5111272.3], [620833.1, 5111281.9], [620803.3, 5111289.1], [620787.7, 5111290.0],
    [620772.0, 5111333.2], [620765.8, 5111359.8], [620761.0, 5111389.0], [620781.6, 5111404.5], [620816.2, 5111416.8],
    [620807.5, 5111401.2], [620816.8, 5111387.2], [620835.1, 5111378.5], [620867.3, 5111380.4], [620882.6, 5111394.9],
    [620884.4, 5111433.6], [620895.2, 5111473.7], [620889.5, 5111503.2], [620868.3, 5111529.8], [620842.3, 5111534.5],
    [620811.1, 5111548.0], [620730.8, 5111623.7], [620659.0, 5111660.9], [620637.5, 5111704.2], [620622.4, 5111749.0],
    [620609.2, 5111765.5], [620585.8, 5111774.0], [620579.0, 5111790.6], [620607.4, 5111792.5], [620625.3, 5111799.3],
    [620663.4, 5111767.8], [620671.6, 5111746.1], [620700.3, 5111729.9], [620727.3, 5111736.9], [620750.5, 5111737.4],
    [620766.7, 5111768.6], [620793.3, 5111796.1], [620818.4, 5111830.1], [620841.1, 5111857.6], [620849.4, 5111896.4],
    [620887.0, 5111955.0], [620877.4, 5111981.9], [620894.4, 5112038.9], [620916.0, 5112056.0], [620908.0, 5112070.0],
    [620916.3, 5112105.0], [620922.0, 5112147.6], [620944.3, 5112191.8], [620972.2, 5112218.1], [621036.7, 5112291.4],
    [621032.3, 5112313.2], [621009.5, 5112357.8], [621002.5, 5112384.7], [621018.3, 5112434.0], [621037.4, 5112449.8],
    [621041.7, 5112492.3], [621024.3, 5112524.2], [621023.4, 5112569.2], [621026.4, 5112613.1], [621022.9, 5112660.6],
    [621035.0, 5112700.8], [621036.9, 5112735.5], [621055.4, 5112781.0], [621061.5, 5112801.7], [621040.7, 5112807.7],
    [620999.3, 5112810.7], [620954.4, 5112795.7], [620954.9, 5112835.6], [620955.8, 5112857.5], [620938.9, 5112859.8],
    [620922.9, 5112886.5], [620873.5, 5112903.5], [620872.9, 5112935.7], [620880.2, 5112956.4], [620863.2, 5112969.0],
    [620790.4, 5112926.3], [620779.0, 5112980.2], [620796.6, 5113005.0], [620802.8, 5113019.3], [620829.3, 5113049.4],
    [620838.1, 5113061.1], [620823.7, 5113071.2], [620798.2, 5113053.9], [620778.9, 5113052.3], [620777.2, 5113071.5],
    [620791.2, 5113083.4], [620816.6, 5113101.9], [620835.9, 5113108.7], [620868.1, 5113109.4], [620910.9, 5113102.5],
    [620941.9, 5113100.5], [620979.2, 5113109.0], [621021.5, 5113122.7], [621030.4, 5113164.3],
  ] },
];
export function hikesFor(area: string, roads: readonly Pick<Road, 'kind' | 'name' | 'pts'>[], origin: Point, box: MapBox): Hike[] {
  if (area !== 'mabou') return [];
  const rail = roads.filter(r => r.kind === 5 && RAIL_NAMES.includes(r.name ?? '')).flatMap(r =>
    clipLine(r.pts.map(([x, z]): Point => [x + origin[0], origin[1] - z]), box).map(pts => ({ name: r.name, pts })));
  const highlands = HIGHLANDS_LINES.flatMap(line => clipLine(line.pts, box).map(pts => ({ ...line, pts })));
  return [
    { id: 'rail-trail', area, name: 'Mabou Rivers Trail', kind: 'rail-trail', length: 'About 19.5 km one way for the whole section', difficulty: 'Easy', trailhead: 'rail-access',
      note: 'The old rail line, now a trail. The rail trail continues beyond this map.', sources: ['https://novascotia.com/listing/mabou-rivers-trail-part-of-celtic-shores-coastal-trail/'], line: rail },
    { id: 'west-mabou', area, name: 'West Mabou Beach trails', kind: 'park', length: 'An older provincial brochure lists about 5 km', difficulty: 'Easy (older provincial brochure)', trailhead: 'west-mabou-beach',
      note: 'Walking trails in the provincial park, near the beach and dunes. No trail line is available in this map.', sources: ['https://parks.novascotia.ca/park/west-mabou-beach', 'https://parks.novascotia.ca/sites/default/files/Parks-Trails-Brochure.pdf'] },
    { id: 'highlands', area, name: 'Cape Mabou highlands trails', kind: 'highlands', length: 'About 30 to 35 km in all by published counts', difficulty: null, trailhead: 'highlands-trailhead',
      note: 'A network of steep coastal and forest trails. Most of it is north of this map. Only two mapped paths are shown. Beaton Trail is a ground path about 1 m wide, hiking grade, no bicycles.',
      sources: ['https://novascotia.ca/nse/protectedareas/wa_capemabou.asp', 'https://www.cbisland.com/en/listing/cape-mabou-highlands', 'https://www.openstreetmap.org/way/117656340', 'https://www.openstreetmap.org/way/537781826'], line: highlands },
  ];
}

/** Corner-map lines use world metres; the source table and big map retain EPSG:2961. */
export function worldHikeLines(hikes: readonly Hike[], origin: Point): { pts: Point[] }[] {
  return hikes.flatMap(h => h.line ?? []).map(line => ({ pts: line.pts.map(([e, n]): Point => [e - origin[0], origin[1] - n]) }));
}
