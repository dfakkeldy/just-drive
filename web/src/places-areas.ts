import type { Place } from './places';

const GEO = 'https://toponymes.rncan.gc.ca/search-place-names/unique?id=';
const OSM = 'https://www.openstreetmap.org/';
const TRAIL = 'https://www.celticshores.ca/maps-info/';
const TRAIL_ABOUT = 'https://www.celticshores.ca/maps-info/about-the-trail/';
const TRAIL_SECTIONS = 'https://celticshores.ca/plan-a-visit/explore-the-trail';
const TOWN = 'https://townofporthawkesbury.ca/residents/';

export type ResearchedArea = 'porthood' | 'pointtupper' | 'cansocauseway' | 'judique';
/**
 * Public places in four areas. Coordinates are EPSG:2961. Each note says only what its public sources say
 * (read 15 Nov 2026), or what the game's own data shows, and says nothing about access, parking, opening or events.
 * No business, house, civic number or person is named.
 * `radius` (metres) is for a place away from the road: the arrival note shows from the road that the list jumps to.
 * tools/places-areas-check.mjs proves sources, bounds, road reach and the distance to every hand-built site.
 */
export function areaPlaces(area: string): Place[] {
  const place = (a: ResearchedArea, id: string, name: string, kind: Place['kind'], e: number, n: number, note: string, sources: string[], radius?: number): Place =>
    ({ id, area: a, name, kind, e, n, note, sources, ...(radius ? { radius } : {}) });
  switch (area) {
    case 'porthood': return [
      place('porthood', 'porthood-village', 'Port Hood village', 'village', 614206.015, 5096202.736, 'Port Hood is the village at the centre of this map.', ['areas/porthood/manifest.json#village', GEO + 'CBELR']),
      place('porthood', 'port-hood-station', 'Port Hood Station Provincial Park', 'beach', 613449.4, 5095264.8, 'A picnic park with a cobble beach, next to a white sand beach. The coastal rail trail has a trailhead at Port Hood Station.', ['https://parks.novascotia.ca/park/port-hood-station', OSM + 'way/480281114', TRAIL], 420),
      place('porthood', 'port-hood-wharf', 'Port Hood wharf', 'water', 613030, 5097010, 'Wharves reach out into Port Hood harbour here.', [OSM + 'way/117552872', OSM + 'way/117552398', GEO + 'CBULE'], 220),
      place('porthood', 'murphys-pond', 'Murphys Pond breakwaters', 'water', 612690, 5098110, 'Two breakwaters and a slipway stand at Murphys Pond, north of the village.', [GEO + 'CBAVM', OSM + 'way/117552509', OSM + 'way/117552922', OSM + 'node/10264417207'], 120),
      { ...place('porthood', 'marble-hill-view', 'Marble Hill Road view', 'view', 612743.51, 5099500.28, 'Look south-west over Port Hood harbour and the island.', ['areas/porthood/roads.json#56']),
        spawn: { e: 612743.51, n: 5099500.28, road: 'Marble Hill Road', heading: 225 * Math.PI / 180 } },
      place('porthood', 'little-judique-harbour', 'Little Judique Harbour', 'water', 614210, 5090495, 'Fishing boats tie up at the harbour wharf. The coastal rail trail crosses the harbour on a causeway.', [GEO + 'CAUJQ', TRAIL_SECTIONS, OSM + 'way/117702817']),
      place('porthood', 'pigs-cove', 'Pigs Cove', 'water', 614203.4, 5088431.8, 'A slipway and a pier, with breakwaters, at Pigs Cove.', [GEO + 'CBDQV', OSM + 'node/10264006008', OSM + 'way/117703005', OSM + 'way/1122197668', OSM + 'way/117702993']),
    ];
    case 'judique': return [
      // On Highway 19 just south of the hand-built village heart (judique-village-site.ts), 150 m clear of it.
      place('judique', 'judique-village', 'Judique village', 'village', 617170.5, 5081049.0, 'Judique is the village at the centre of this map.', ['areas/judique/manifest.json#village', GEO + 'CASLB']),
      place('judique', 'baxters-cove', 'Baxters Cove', 'water', 616237.4, 5079352.5, 'A slipway between two breakwaters, with a small navigation light.', [GEO + 'CBQND', OSM + 'node/10264417201', OSM + 'way/1122224456', OSM + 'way/1122224457', OSM + 'node/1325500623']),
      // Position: the first pair of section 2 on the trail's maps page (as Troy Station is the first pair of section 1).
      place('judique', 'judique-flyer-trailhead', 'Judique Flyer trailhead', 'trail', 617546, 5083790, 'A trailhead with a kiosk on the Judique Flyer section of the coastal rail trail.', [TRAIL, TRAIL_SECTIONS]),
      place('judique', 'creignish-lookoff', 'Look-off above St. Georges Bay', 'view', 618064.5, 5071658.0, 'A look-off with a rest stop and a wide view over St. Georges Bay.', [OSM + 'node/6853504602', TRAIL_ABOUT]),
    ];
    case 'pointtupper': return [
      // On Reeves Street, west of the hand-built stores and lots (port-hawkesbury-site.ts), 150 m clear of them.
      place('pointtupper', 'port-hawkesbury', 'Port Hawkesbury', 'village', 628086.7, 5052826.7, 'Port Hawkesbury is the town at the centre of this map.', ['areas/pointtupper/manifest.json#village', GEO + 'CBELL']),
      place('pointtupper', 'point-tupper', 'Point Tupper', 'village', 627529.5, 5051763.5, 'A community and headland on the Strait of Canso, south of Ship Harbour and Port Hawkesbury.', [GEO + 'CBEBD', GEO + 'CBMMM', GEO + 'CBINX', GEO + 'CBRJU', OSM + 'node/1917913068']),
      place('pointtupper', 'granville-green', 'Granville Green', 'site', 627728, 5052338, 'A green with an outdoor stage on the town waterfront, beside a boardwalk.', [TOWN + 'festivals-events/granville-green/', TOWN + 'walk-port-hawkesbury/', OSM + 'way/581261046', OSM + 'way/580636400']),
      place('pointtupper', 'community-park', 'Port Hawkesbury Community Park', 'site', 628708.4, 5052921.3, 'A town park with a playground, a splash pad, a bicycle pump track and courts.', [TOWN + 'port-hawkesbury-community-park/', OSM + 'way/181364947'], 130),
      { ...place('pointtupper', 'point-tupper-power-station', 'Point Tupper power station view', 'view', 629075.6, 5049570.1, 'Look west-southwest from Industrial Park Road over the power station and the Strait of Canso.', ['areas/pointtupper/roads.json#107', OSM + 'way/1296734919', GEO + 'CBDDZ', GEO + 'CBRJU']),
        spawn: { e: 629075.6, n: 5049570.1, road: 'Industrial Park Road', heading: 245 * Math.PI / 180 } },
      { ...place('pointtupper', 'point-tupper-marine-terminal', 'Point Tupper marine terminal view', 'view', 629574.6, 5048103.7, 'Look west-southwest from Industrial Park Road over the deep-water marine terminal and the Strait of Canso.', ['areas/pointtupper/roads.json#107', OSM + 'way/163215590', GEO + 'CBPGM', GEO + 'CBRJU']),
        spawn: { e: 629574.6, n: 5048103.7, road: 'Industrial Park Road', heading: 254 * Math.PI / 180 } },
      place('pointtupper', 'mcnairs-cove', 'McNairs Cove', 'water', 625258.0, 5052511.4, 'A park beside McNairs Cove, in Mulgrave, on the mainland shore of the strait.', [GEO + 'CAYPT', GEO + 'CBAQK', OSM + 'way/1426459785']),
      place('pointtupper', 'pirate-harbour', 'Pirate Harbour', 'water', 626146.3, 5049443.0, 'A small harbour with a pier, south of Mulgrave on the mainland shore.', [GEO + 'CBDVH', GEO + 'CBDVG', OSM + 'way/880475520']),
    ];
    case 'cansocauseway': return [
      place('cansocauseway', 'port-hastings', 'Port Hastings', 'village', 623862.811, 5056466.743, 'Port Hastings is where the coastal rail trail begins, just across the Canso Causeway on Cape Breton Island.', ['areas/cansocauseway/manifest.json#village', GEO + 'CBELK', TRAIL_ABOUT]),
      place('cansocauseway', 'visitor-centre', 'Port Hastings visitor information centre', 'site', 624263.3, 5056017.8, 'The provincial visitor information centre in Port Hastings.', [TRAIL_ABOUT, OSM + 'way/290780626']),
      place('cansocauseway', 'troy-station', 'Troy Station trailhead', 'trail', 621276, 5060816, 'A trailhead of the coastal rail trail, with a rest stop and a view over St. Georges Bay.', [TRAIL, TRAIL_ABOUT, OSM + 'node/5230860521', GEO + 'CBMKP'], 290),
      // On Highway 19, 150 m clear of the cemetery place to the north.
      place('cansocauseway', 'creignish', 'Creignish', 'village', 619833.0, 5065478.0, 'One of the communities the coastal rail trail passes between Port Hastings and Long Point.', [GEO + 'CAIJX', TRAIL_ABOUT]),
      place('cansocauseway', 'aulds-cove', 'Aulds Cove', 'village', 621666.5, 5056176.4, 'A community and a cove on the mainland, across the strait from Port Hastings.', [GEO + 'CABBG', GEO + 'CABBH']),
    ];
    default: return [];
  }
}
