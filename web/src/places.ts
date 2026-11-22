import { CHURCH_ORIGIN, CHURCH_START } from './church-site';
import type { Road, RoadHit, Roads } from './roads';
export { areaPlaces } from './places-areas';

export interface Place {
  /** Exact off-road start supplied by an invented practice course. Coordinates are EPSG:2961. */
  start?: { e:number; n:number; heading:number };
  /** Optional on-road approach, for places reached by a mapped track. */
  trip?: 'quarry'|'quarry-gate';
  track?: boolean;
  spawn?: { e: number; n: number; road: string | null; heading: number; roadId?: number };
  id: string; area: 'mabou' | 'judique' | 'porthood' | 'pointtupper' | 'westbay' | 'cansocauseway'; name: string; e: number; n: number;
  kind: 'village' | 'view' | 'trail' | 'beach' | 'water' | 'site'; note: string; sources: string[]; radius?: number;
  /** Map label order when the kind's own is wrong for this place; see `mapRank`. */
  rank?: number;
}
export const ARRIVAL_RADIUS = 85;
/** Map label order, 0 first: villages; river bridges and crossings, parks, beaches and the main trail; views,
 *  trail bridges and sites; trail access points and cemeteries last. The map shows only the first few that fit. */
const KIND_RANK: Record<Place['kind'], number> = { village: 0, water: 1, beach: 1, view: 2, trail: 2, site: 2 };
export const mapRank = (place: Pick<Place, 'kind' | 'rank'>): number => place.rank ?? KIND_RANK[place.kind];
export type RoadNetwork = Pick<Roads, 'nearest'>;
export const drivable = (road: Road): boolean => road.kind >= 1 && road.kind <= 3;

const GEO = 'https://toponymes.rncan.gc.ca/search-place-names/unique?id=';
const RAIL = 'https://novascotia.com/listing/mabou-rivers-trail-part-of-celtic-shores-coastal-trail/';
const OSM = 'https://www.openstreetmap.org/';
/**
 * Places to visit. Coordinates are EPSG:2961, never world positions. Every note is a fact from the listed public
 * sources (read 11 Nov 2026) or from the game's own data, and says nothing about access, parking or opening.
 * `radius` (metres) is for a place that is not on a road: the arrival note shows from the road that passes it.
 * To add a place, add one line. No business, organisation or people's names.
 */
export function placesFor(village: readonly [number, number]): Place[] {
  const place = (id: string, name: string, kind: Place['kind'], e: number, n: number, note: string, sources: string[], radius?: number): Place =>
    ({ id, area: 'mabou', name, kind, e, n, note, sources, ...(radius ? { radius } : {}) });
  /** A view on a public road: the jump stops on `road` at e/n facing `look` (degrees from north), toward the view.
   *  `spawn` here is a stop on a road, not an off-road start (`start`). */
  const view = (id: string, name: string, road: string, e: number, n: number, look: number, note: string, sources: string[]): Place =>
    ({ ...place(id, name, 'view', e, n, note, sources), spawn: { e, n, road, heading: look * Math.PI / 180 } });
  return [
    place('village', 'Mabou village', 'village', village[0], village[1], 'Mabou is the village at the centre of this map.', ['terrain/manifest.json#village', GEO + 'CAWCY']),
    { ...place('rail-trail', 'Mabou Rivers Trail', 'trail', 623908.51, 5102996.91, 'The old rail line crosses the main road here. It is now a trail, about 19.5 km long.', ['terrain/roads.json#966', RAIL]), rank: 1 },
    place('harbour-view', 'Mabou Harbour Road view', 'view', 622951.3, 5104332.1, 'Look west from here, down the harbour toward its mouth.', [OSM + 'way/117558430'], 160),
    place('river-bridge', 'Mabou River bridge', 'water', 624095.0, 5103049.8, 'Highway 19 crosses the Mabou River here.', [OSM + 'way/117558858']),
    { ...place('valley-park', 'Mabou Provincial Park', 'view', 625808.4, 5104409.2, 'A small picnic park on the hillside, with a view across the Mabou valley.', ['https://novascotia.com/listing/mabou-provincial-park/', GEO + 'CBUFP'], 150), rank: 1 },
    // The Northeast Mabou Road junction is 34 m away: its view down the river is this place's jump.
    { ...place('northeast-crossing', 'Northeast Mabou river crossing', 'water', 623007.7, 5104627.5, 'Mabou Harbour Road crosses the river here, at the edge of Northeast Mabou. Northeast Mabou Road meets it just north; look south-west down the river.', [GEO + 'CBBWJ', OSM + 'way/117559020', 'terrain/roads.json#88']),
      spawn: { e: 622995.1, n: 5104650.1, road: 'Mabou Harbour Road', heading: 220 * Math.PI / 180 } },
    { ...place('rail-access', 'West Mabou rail-trail access', 'trail', 622583.0, 5101901.1, 'The old rail trail has a rest area near this junction, with views over the harbour.', [RAIL, OSM + 'way/774762503']), rank: 3 },
    place('village-rail-bridge', 'Rail-trail bridge east of the village', 'trail', 625023.1, 5102652.9, 'The old rail trail crosses a bridge here, just east of the village.', [OSM + 'way/647495261'], 480),
    place('glendyer-bridge', 'Glendyer rail-trail bridge', 'trail', 626563.3, 5103465.9, 'A bridge on the old rail trail crosses the river near Glendyer.', [RAIL, OSM + 'way/647495259'], 260),
    { ...place('rail-junction', 'Southwest Mabou rail-trail junction', 'trail', 619664.2, 5097708.5, 'Two sections of the coastal rail trail meet here, near the Southwest Mabou River.', [RAIL, 'https://participaperonline.ca/wp-content/uploads/2023/07/MayJune-2014.pdf']), rank: 3 },
    place('west-mabou-beach', 'West Mabou Beach Provincial Park', 'beach', 617347.3, 5103189.6, 'A large sand beach and dunes lie north of here, at the mouth of Mabou Harbour. The park also has walking trails.', ['https://parks.novascotia.ca/park/west-mabou-beach', 'https://novascotia.com/listing/west-mabou-beach-provincial-park/']),
    place('harbour-lighthouse', 'Mabou Harbour lighthouse', 'site', 618648.1, 5104734.2, 'A square wooden lighthouse stands near the harbour mouth. The tower dates from 1908.', ['https://www.historicplaces.ca/en/rep-reg/place-lieu.aspx?id=4221', 'https://notmar.gc.ca/publications/list-lights/atl/atl70485-en.php'], 450),
    place('coal-mines-beach', 'Mabou Coal Mines beach', 'beach', 618822.1, 5109382.6, 'A beach lies along the coast here, in the Mabou Coal Mines area.', [OSM + 'way/1092765936'], 230),
    place('finlay-point', 'Finlay Point', 'water', 618604.0, 5110352.1, 'A small boat harbour near Finlay Point is sheltered by two breakwaters.', [GEO + 'CALWJ', 'https://waves-vagues.dfo-mpo.gc.ca/library-bibliotheque/chs-shc-ATL108-eng-202408-41254697.pdf'], 400),
    // Views from the owner's dash cam of 18 Nov 2026: each jump faces the view, checked in the game's own pictures.
    view('harbour-inlet-view', 'Mabou Harbour Road above the inlet', 'Mabou Harbour Road', 621520.0, 5104587.4, 215, 'The road runs above the harbour here, where the water opens wide to the south.', ['terrain/roads.json#49']),
    view('glen-view', 'MacDonald Glen Road view', 'MacDonald Glen Road', 623475.2, 5105547.8, 220, 'The glen falls away south-west from here, down to the harbour.', ['terrain/roads.json#59']),
    view('coal-mines-valley', 'Mabou Coal Mines valley', 'Mabou Mines Road', 619193.56, 5110378.41, 270, 'Look west down the valley, past the ponds to the sea.', ['terrain/roads.json#55']),
    { ...place('harbour-wharf-view', 'Mabou Harbour wharf from the lane', 'view', 618732.67, 5104952.35, 'Look down the lane toward the lighthouse and the fishing basin.', ['terrain/roads.json#922']),
      spawn: { e: 618732.67, n: 5104952.35, road: null, roadId: 922, heading: 199 * Math.PI / 180 } },
    view('mines-road-view', 'Mabou Mines Road above the harbour', 'Mabou Mines Road', 620332.5, 5104839.9, 125, 'Mabou Mines Road climbs north from the harbour road here. Look back south-east over the harbour.', ['terrain/roads.json#55']),
    view('shore-bends', 'Mabou Harbour Road shore bends', 'Mabou Harbour Road', 619602.1, 5105013.5, 240, 'The road follows the bends of the harbour shore here.', ['terrain/roads.json#49']),
    // Views from the owner's dash cam of 20 Nov 2026 on Little Mabou Road, checked in the game's own pictures.
    view('little-mabou-marsh', 'Little Mabou Road marsh', 'Little Mabou Road', 622489.94, 5101935.84, 30, 'Look north-east over the marsh and the river.', ['terrain/roads.json#44']),
    view('harbour-mouth-view', 'Harbour mouth from Little Mabou Road', 'Little Mabou Road', 617032.38, 5102935.05, 10, 'Look north across the mouth of Mabou Harbour to the far headland.', ['terrain/roads.json#47']),
    view('little-mabou-gulf', 'Gulf view from Little Mabou Road', 'Little Mabou Road', 616651.76, 5102878.7, 350, 'Look north over open fields to the Gulf and Cape Mabou.', ['terrain/roads.json#47']),
    view('harbour-road-end', 'West end of Mabou Harbour Road', 'Mabou Harbour Road', 617500.4, 5105590.6, 290, 'The road ends on high ground above the shore, looking out to sea.', ['terrain/roads.json#51']),
    place('highlands-trailhead', 'Cape Mabou highlands trailhead', 'trail', 619964.9, 5111008.8, 'The southern way into the Cape Mabou highlands trails. Most of the trails are north of this map. Ask the people who keep a trail before you go.', ['https://www.cbisland.com/en/listing/cape-mabou-highlands', 'https://novascotia.ca/nse/protectedareas/wa_capemabou.asp'], 500),
  ];
}
/** Judique's first place, modelled in home.ts. */
export function homePlaces(): Place[] {
  return [{ id: 'home', area: 'judique', name: 'Red Roof by the Brook', kind: 'site', e: 618687.3, n: 5074423.9, radius: 70,
    note: 'A long house with a red roof at the end of a gravel road, beside Chisholm Brook.', sources: ['src/home-site.ts'] }];
}
export function churchPlaces(): Place[] {
  return [{ id: 'church', area: 'judique', name: 'River Denys Mountain church', kind: 'site', e: CHURCH_ORIGIN[0], n: CHURCH_ORIGIN[1],
    note: 'A wooden church with a tower beside River Denys Road.', sources: ['src/church-site.ts'], spawn: CHURCH_START }];
}
export function placePosition(place: Pick<Place, 'e' | 'n'>, origin: readonly [number, number]): { x: number; z: number } {
  return { x: place.e - origin[0], z: origin[1] - place.n };
}
export function findPlace(places: readonly Place[], id: string): Place | undefined { return places.find(place => place.id === id); }
/** The nearest place whose own radius reaches the traveller. */
export function arrivalAt(places: readonly Place[], origin: readonly [number, number], x: number, z: number): Place | undefined {
  let best: Place | undefined, distance = Infinity;
  for (const place of places) {
    const p = placePosition(place, origin), d = Math.hypot(p.x - x, p.z - z);
    if (d <= (place.radius ?? ARRIVAL_RADIUS) && d < distance) { best = place; distance = d; }
  }
  return best;
}
export function nearestPlacement(roads: RoadNetwork, place: Pick<Place, 'e' | 'n'> & Pick<Partial<Place>, 'spawn'|'track'>, origin: readonly [number, number]): RoadHit | null {
  if (place.spawn) {
    const spawn = place.spawn, p = placePosition(spawn, origin);
    const hit = roads.nearest(p.x, p.z, 2, road => road.name === spawn.road && (spawn.roadId === undefined || road.id === spawn.roadId) && road.kind >= 1 && road.kind <= 4);
    return hit ? { ...hit, heading: spawn.heading } : null;
  }
  const p = placePosition(place, origin);
  return roads.nearest(p.x, p.z, 2000, place.track ? road=>road.kind>=1&&road.kind<=4 : drivable);
}
/** The main road nearest the manifest's village point, away from the other workers' scenes. */
export function villageStart(roads: RoadNetwork, origin: readonly [number, number]): RoadHit {
  const start = roads.nearest(0, 0, 300, road => road.kind === 1 && road.name === 'Highway 19');
  if (!start) throw new Error(`No named main-road start near ${origin.join(',')}`);
  return start;
}

/** Names and shapes from the area road data; quarry history comes from the park brief. */
export function westBayPlaces():Place[]{
  const p=(id:string,name:string,e:number,n:number,note:string,kind:Place['kind']='site',track=false):Place=>({id,area:'westbay',name,e,n,note,kind,track,sources:['areas/westbay/roads.json','src/quarry-site.ts']});
  return [
    p('sugar-camp','Sugar Camp Off-Road Park',631996.45,5061904.73,'An old gypsum quarry, idle since about 2011, partly reclaimed, with two pit lakes. The park is made up.', 'site',true),
    p('quarry-west-lookoff','West Wall Lookoff',631708,5064500,'Stepped quarry benches fall toward the long pit lake.', 'view',true),
    p('quarry-east-lookoff','East Top Lookoff',632208,5064505,'A flat top stands above the east bank of the long pit lake.', 'view',true),
    p('westbay-village','West Bay village',642342,5063327,'The shore road meets the road west at this crossroads.','village'),
    // Ninety metres before the clipped end leaves room for the full rig inside the area.
    p('marble-shore','Shore road toward Marble Mountain',654898.3,5077551.38,'The shore road continues north-east to the edge of this area.','view'),
    p('dundee','Dundee',649137,5062536,'Small lanes leave the main road near the shore.','village'),
    {...p('haul-sugar-camp','Haul to Sugar Camp',643837,5067914,'Start the loaded rig at the end of Eagle Creek Road.'),trip:'quarry'},
    {...p('near-sugar-camp','Start near the gate',632400,5062000,'Start the loaded rig 600 m before the gate, on Long Stretch Road.'),trip:'quarry-gate'},
  ];
}

/** Neutral locations from the federal turbine database, with no project or owner identity. */
export function tallPlaces(area: string): Place[] {
  const source = 'https://open.canada.ca/data/en/dataset/79fdad93-9025-49ad-ba16-c26d718cc070';
  if (area === 'mabou') return [{ id: 'mabou-high-turbines', area: 'mabou', name: 'Wind turbine above Mabou', kind: 'view',
    e: 625021.44, n: 5112048.40, radius: 1500, note: 'A wind turbine stands on the high ground north of Mabou.', sources: [source] }];
  if (area === 'pointtupper') return [{ id: 'point-tupper-turbines', area: 'pointtupper', name: 'Wind turbines, Point Tupper', kind: 'view',
    e: 631372.62, n: 5048039.64, radius: 1000, note: 'Wind turbines stand on the high ground at Point Tupper.', sources: [source] }];
  return [];
}
