// The researched places of Port Hood, Point Tupper, Canso Causeway and Judique (web/src/places-areas.ts).
// node tools/run-node-check.mjs tools/places-areas-check.mjs [--mutations]
// Every place: public sources, a plain note, inside the area's drive bounds, a road jump that is a real road (not a
// rail line) inside the bounds and inside the arrival radius, and at least 150 m from every hand-built site and
// from every place of the other lists. --mutations breaks each rule on purpose; each break must be found.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AREAS } from '../web/src/area.ts';
import { areaPlaces } from '../web/src/places-areas.ts';
import { ARRIVAL_RADIUS, arrivalAt, churchPlaces, homePlaces, nearestPlacement, placesFor, westBayPlaces } from '../web/src/places.ts';
import { railwayRoad } from '../web/src/railway-road.ts';
import { Roads } from '../web/src/roads.ts';
import { AirportSite } from '../web/src/airport-site.ts';
import { CANAL_ROUTE } from '../web/src/canal-route.ts';
import { cemeteryPlaces } from '../web/src/cemetery-rules.ts';
import { ChurchSite } from '../web/src/church-site.ts';
import { COAST_BOX } from '../web/src/coast-site.ts';
import { DECKHAND } from '../web/src/deckhand.ts';
import { FishingSite } from '../web/src/fishing-site.ts';
import { HomeSite } from '../web/src/home-site.ts';
import { JudiqueVillageSite, VILLAGE_ITEMS } from '../web/src/judique-village-site.ts';
import { FESTOONS, MAIN_ITEMS, MabouMainSite, SIDEWALK, STREET_LAMPS } from '../web/src/mabou-main-site.ts';
import { MaryvilleStoreSite } from '../web/src/maryville-store-site.ts';
import { DepotSite } from '../web/src/depot-site.ts';
import { mineRoadEnd } from '../web/src/mine-site.ts';
import { PorchSite } from '../web/src/porch-site.ts';
import { DrLaneSite } from '../web/src/drlane-site.ts';
import { PrinceSite } from '../web/src/prince-site.ts';
import { BlackstoneSite } from '../web/src/blackstone-site.ts';
import { BrookVillageSite } from '../web/src/brook-village-site.ts';
import { PortHoodGasSite } from '../web/src/porthood-gas-site.ts';
import { PH_ITEMS, PortHawkesburySite } from '../web/src/port-hawkesbury-site.ts';
import { QuarrySite } from '../web/src/quarry-site.ts';
import { YardSite } from '../web/src/yard-site.ts';
import { YARD_DOG } from '../web/src/yard-dog-site.ts';

const root = process.env.MMM_ROOT ?? '.', baked = `${root}/data/baked`;
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const AREA_IDS = ['porthood', 'pointtupper', 'cansocauseway', 'judique'];
// Public sources only: OpenStreetMap, NRCan names, Nova Scotia government, the official trail and the town.
const PUBLIC = /^https:\/\/(www\.openstreetmap\.org|toponymes\.rncan\.gc\.ca|parks\.novascotia\.ca|(www\.)?celticshores\.ca|townofporthawkesbury\.ca)\/\S*$/;
// web/src/places.ts: a note says nothing about access, parking or opening; nor about events, which go out of date.
const NOT_SAID = /\b(open(s|ing)?|clos(ed|es|ing)|hours?|parking|admission|fees?|free|tickets?|private|no entry|daily|weekdays?|weekends?|(mon|tues|wednes|thurs|fri|satur|sun)days?|evenings?|concerts?|festivals?|events?)\b/i;
const MIN_SITE = 150, MIN_PLACE = 150, EDGE = 120, START_EDGE = 12;

// Every site file the game has is one that this check knows. A new hand-built site must be added below.
{
  const known = ['airport-site.ts', 'blackstone-site.ts', 'brook-village-site.ts', 'church-site.ts', 'coast-site.ts', 'depot-site.ts', 'drlane-site.ts', 'fishing-site.ts', 'home-site.ts', 'judique-village-site.ts', 'mabou-main-site.ts', 'maryville-store-site.ts', 'mine-site.ts', 'porch-site.ts',
    'port-hawkesbury-site.ts', 'porthood-gas-site.ts', 'prince-site.ts', 'quarry-site.ts', 'yard-dog-site.ts', 'yard-site.ts'];
  assert.deepEqual(readdirSync(`${root}/web/src`).filter(n => /-site\.ts$/.test(n)).sort(), known, 'a hand-built site was added or removed: teach tools/places-areas-check.mjs its position');
}

/** Hand-built sites as EPSG:2961 boxes [e0, n0, e1, n1]. A point is a box of size zero. */
function handBuiltSites() {
  const sites = [];
  const fromGame = (name, v, boxes) => { for (const [x0, z0, x1, z1] of boxes) sites.push({ name, box: [v[0] + Math.min(x0, x1), v[1] - Math.max(z0, z1), v[0] + Math.max(x0, x1), v[1] - Math.min(z0, z1)] }); };
  const point = (name, e, n, half = 0) => sites.push({ name, box: [e - half, n - half, e + half, n + half] });
  const mabou = read(`${baked}/terrain/manifest.json`), mv = mabou.village;
  const judique = read(`${baked}/areas/judique/manifest.json`).village, westbay = read(`${baked}/areas/westbay/manifest.json`).village;
  const tupper = read(`${baked}/areas/pointtupper/manifest.json`).village;
  const porthood = read(`${baked}/areas/porthood/manifest.json`).village;
  fromGame('Maryville tractor dealership', porthood, [new MaryvilleStoreSite(porthood).box]);
  fromGame('Port Hood Mail Depot', porthood, [new DepotSite(porthood).box]);
  const home = new HomeSite(judique), church = new ChurchSite(judique), wharf = new FishingSite(mv), yard = new YardSite(mv, 'invented'), quarry = new QuarrySite(westbay);
  fromGame('home', judique, [home.box, ...home.clear]);
  fromGame('church', judique, [church.box, ...church.clear]);
  fromGame('fishing wharf', mv, [wharf.box, ...wharf.clear]);
  fromGame('works yard', mv, [yard.box, ...yard.clear]);
  fromGame('quarry gate', westbay, [quarry.box, ...quarry.clear]);
  // Judique village on Highway 19 (Judique lots delta: church, music centre, hall, store, garage and their small items).
  fromGame('Judique village buildings', judique, new JudiqueVillageSite(judique).clear);
  for (const [name, at] of Object.entries(VILLAGE_ITEMS)) for (const [e, n] of typeof at[0] === 'number' ? [at] : at) point(`Judique village ${name}`, e, n);
  // Mabou main street (#230: the stores, the hall, the plaza, the lamps, the string lights and the north sidewalk).
  fromGame('Mabou main street buildings', mv, new MabouMainSite(mv).clear);
  for (const at of Object.values(MAIN_ITEMS)) for (const [e, n] of typeof at[0] === 'number' ? [at] : at) point('Mabou main street items', e, n);
  for (const [e, n] of [...STREET_LAMPS, ...FESTOONS.flat()]) point('Mabou main street lamps', e, n);
  for (let t = 0; t <= 1; t += 1 / 32) point('Mabou main street sidewalk', SIDEWALK.from[0] + (SIDEWALK.to[0] - SIDEWALK.from[0]) * t, SIDEWALK.from[1] + (SIDEWALK.to[1] - SIDEWALK.from[1]) * t, SIDEWALK.outer);
  // Port Hawkesbury (#214: the hardware store, the dealers, the gas bars, the corner garage) and the Point Tupper airport.
  fromGame('Port Hawkesbury buildings', tupper, new PortHawkesburySite(tupper).clear);
  for (const [e, n] of [PH_ITEMS.hardwareHydrant, ...PH_ITEMS.garageLamps]) point('Port Hawkesbury items', e, n);
  fromGame('airport', tupper, [new AirportSite(tupper).box]);
  sites.push({ name: 'coast', box: [...COAST_BOX] });
  const porch = PorchSite.find(read(`${baked}/terrain/buildings.json`).buildings);
  if (porch) { const site = new PorchSite(porch, mv); fromGame('porch', mv, [site.box, ...site.clear]); }
  const blackstone = BlackstoneSite.find(read(`${baked}/terrain/buildings.json`).buildings);
  if (blackstone) { const site = new BlackstoneSite(blackstone, mv); fromGame('house on Blackstone Road', mv, [site.box, ...site.clear]); }
  const brookVillage = BrookVillageSite.find(read(`${baked}/terrain/buildings.json`).buildings);
  if (brookVillage) { const site = new BrookVillageSite(brookVillage, mv); fromGame('Brook Village', mv, [site.box, ...site.clear]); }
  const drLane = DrLaneSite.find(read(`${baked}/areas/judique/buildings.json`).buildings);
  if (drLane) { const site = new DrLaneSite(drLane, judique); fromGame('house on D.R.\'s Lane', judique, [site.box, ...site.clear]); }
  const prince = PrinceSite.find(read(`${baked}/areas/pointtupper/buildings.json`).buildings);
  if (prince) { const site = new PrinceSite(prince, tupper); fromGame('house on Prince Street', tupper, [site.box, ...site.clear]); }
  const portHoodGas = PortHoodGasSite.find(read(`${baked}/areas/porthood/buildings.json`).buildings);
  if (portHoodGas) { const site = new PortHoodGasSite(portHoodGas, porthood); fromGame('Port Hood gas station', porthood, [site.box, ...site.clear]); }
  const m = mabou.mid, roads = read(`${baked}/terrain/roads.json`).roads;
  const mine = mineRoadEnd({ roads: roads.map(r => ({ ...r, pts: r.pts.map(([e, n]) => [e - mv[0], mv[1] - n]) })) },
    [m[0] - mv[0] + EDGE, mv[1] - m[3] + EDGE, m[2] - mv[0] - EDGE, mv[1] - m[1] - EDGE]);
  if (mine) point('mine road end', mv[0] + mine.x, mv[1] - mine.z, 60);
  point('yard dog', YARD_DOG.east, YARD_DOG.north, 60);
  point('road scene', 618982.72, 5109266.90, 60);
  // The deckhand at the Finlay Point wharf (web/src/deckhand.ts): where it stands and where it stops.
  point('deckhand', DECKHAND.e, DECKHAND.n, DECKHAND.range); point('deckhand', DECKHAND.stopE, DECKHAND.stopN, DECKHAND.range);
  // The canal boats run halfLength each way along this line (web/src/canal-route.ts); the trail kiosk is beside it.
  const canal = CANAL_ROUTE;
  for (let t = -canal.halfLength - 12; t <= canal.halfLength + 12; t += 8) point('canal boats', canal.east + canal.eastward * t, canal.north + canal.northward * t, 4);
  point('canal trail kiosk', 623718, 5056156);
  return sites;
}
const boxDistance = (e, n, [e0, n0, e1, n1]) => Math.hypot(Math.max(e0 - e, 0, e - e1), Math.max(n0 - n, 0, n - n1));

const SITES = handBuiltSites();
// The PR sites lie outside these four lands (the deckhand) or are covered by a mutant (the canal), so prove them here.
const sitesNear = (e, n) => SITES.filter(site => boxDistance(e, n, site.box) < MIN_SITE).map(site => site.name);
assert.ok(sitesNear(DECKHAND.stopE + 120, DECKHAND.stopN).includes('deckhand'), 'the Finlay Point deckhand is a site');
assert.ok(sitesNear(CANAL_ROUTE.east + CANAL_ROUTE.eastward * 100, CANAL_ROUTE.north + CANAL_ROUTE.northward * 100 - 140).includes('canal boats'), 'the far end of the canal line is a site');
assert.ok(sitesNear(630835.5, 5080641.6 + 140).includes('church'), 'the church is a site');
assert.ok(sitesNear(617107.2 + 140, 5081472.6).includes('Judique village buildings'), 'the Judique store is a site');
assert.ok(sitesNear(STREET_LAMPS[0][0] - 140, STREET_LAMPS[0][1]).includes('Mabou main street lamps'), 'the Mabou main street is a site');
assert.ok(sitesNear(628217.94, 5052158.02 - 140).includes('Port Hawkesbury buildings'), 'the Port Hawkesbury corner garage is a site');
/** Each area's cemetery gates (web/src/cemetery-rules.ts). Cemeteries stay out of the Places list, and researched places keep clear of them. */
const CEMETERIES = Object.fromEntries(['mabou', 'westbay', ...AREA_IDS].map(id => {
  const dir = id === 'mabou' ? `${baked}/terrain` : `${baked}/areas/${id}`, entry = read(`${dir}/manifest.json`).cemeteries;
  return [id, entry ? cemeteryPlaces(read(`${dir}/${entry.file}`).cemeteries, id) : []];
}));
assert.ok(AREA_IDS.every(id => CEMETERIES[id].length > 0), 'each of the four areas has baked cemeteries');
const OTHER = [...placesFor(read(`${baked}/terrain/manifest.json`).village), ...westBayPlaces(), ...homePlaces(), ...churchPlaces(), ...Object.values(CEMETERIES).flat()];
const LAND = Object.fromEntries(AREA_IDS.map(id => {
  const manifest = read(`${baked}/areas/${id}/manifest.json`);
  return [id, { manifest, roads: new Roads(read(`${baked}/areas/${id}/${manifest.roads.file}`), manifest.village, {}) }];
}));

/** Throws on the first broken rule. `lists` maps area id to the list that main.ts shows there. */
function check(lists) {
  const ids = new Set(), report = [];
  for (const id of AREA_IDS) {
    assert.ok(AREAS.some(a => a.id === id), `${id} is an area`);
    const { manifest, roads } = LAND[id], v = manifest.village, list = lists[id];
    const own = list.filter(p => p.area === id && !['home', 'church'].includes(p.id));
    assert.ok(own.length >= 4 && own.length <= 8, `${id}: 4 to 8 researched places, found ${own.length}`);
    const [m0, n0, m1, n1] = manifest.mid, inside = (e, n) => e > m0 + EDGE + START_EDGE && e < m1 - EDGE - START_EDGE && n > n0 + EDGE + START_EDGE && n < n1 - EDGE - START_EDGE;
    for (const p of list) {
      if (p.id === 'home' || p.id === 'church') continue;
      const where = `${id} ${p.id}`;
      assert.equal(p.area, id, `${where}: area tag`);
      assert.ok(!ids.has(p.id) && !OTHER.some(o => o.id === p.id), `${where}: id is unique`); ids.add(p.id);
      assert.ok(Array.isArray(p.sources) && p.sources.length > 0, `${where}: lists its sources`);
      const roadSource = new RegExp(`^areas/${id}/roads\\.json#(\\d+)$`);
      const roadSources = p.sources.map(s => roadSource.exec(s)).filter(Boolean);
      for (const s of p.sources) assert.ok(PUBLIC.test(s) || s === `areas/${id}/manifest.json#village` || roadSource.test(s), `${where}: public source ${s}`);
      assert.ok(p.sources.some(s => s.startsWith('https://')) || p.spawn && roadSources.length, `${where}: a public source or a mapped view`);
      const sentences = p.note.replace(/\bSt\. /g, 'St ').split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.ok(sentences.length >= 1 && sentences.length <= 2 && /[.!?]$/.test(p.note), `${where}: one or two plain sentences`);
      assert.ok(!/\d/.test((p.name + ' ' + p.note).replace(/\bHighway \d+\b/g, '')), `${where}: no numbers but highway numbers (no civic numbers)`);
      assert.ok(!NOT_SAID.test(p.note), `${where}: says nothing about access, parking, opening or events (${p.note.match(NOT_SAID)?.[0]})`);
      assert.ok(['village', 'view', 'trail', 'beach', 'water', 'site'].includes(p.kind) && !p.trip && (!p.spawn || p.kind === 'view' && Number.isFinite(p.spawn.heading) && roadSources.length === 1), `${where}: plain place or sourced view`);
      assert.ok(inside(p.e, p.n), `${where}: inside the drive bounds`);
      for (const site of SITES) { const d = boxDistance(p.e, p.n, site.box); assert.ok(d >= MIN_SITE, `${where}: ${d.toFixed(0)} m from the ${site.name}`); }
      for (const o of [...OTHER, ...AREA_IDS.flatMap(a => lists[a])]) {
        if (o === p) continue;
        const d = Math.hypot(o.e - p.e, o.n - p.n); assert.ok(d >= MIN_PLACE, `${where}: ${d.toFixed(0)} m from place ${o.area} ${o.id}`);
      }
      const hit = nearestPlacement(roads, p, v);
      assert.ok(hit, `${where}: a road to jump to`);
      if (p.spawn) assert.equal(hit.road.id, Number(roadSources[0][1]), `${where}: the jump matches its road source`);
      assert.ok(!railwayRoad(hit.road) && hit.road.kind >= 1 && hit.road.kind <= (p.track ? 4 : 3), `${where}: jumps to a road, not ${hit.road.name}/${hit.road.kind}`);
      const radius = p.radius ?? ARRIVAL_RADIUS;
      assert.ok(hit.dist + 5 <= radius, `${where}: road ${hit.dist.toFixed(0)} m away, arrival radius ${radius} m`);
      const he = v[0] + hit.x, hn = v[1] - hit.z;
      assert.ok(inside(he, hn), `${where}: jump point inside the drive bounds`);
      for (const site of SITES) assert.ok(boxDistance(he, hn, site.box) >= MIN_SITE, `${where}: jump point near the ${site.name}`);
      assert.equal(arrivalAt(list, v, hit.x, hit.z), p, `${where}: its own note shows at the jump point`);
      report.push(`${where} ${hit.road.name ?? '(unnamed)'} ${hit.dist.toFixed(0)}m`);
    }
  }
  return report;
}

// main.ts: the list for each area. Only Judique has the two hand-built places; cemeteries stay out of the list.
const main = readFileSync(`${root}/web/src/main.ts`, 'utf8');
assert.ok(main.includes("...(homeSite ? homePlaces() : []), ...(churchSite ? churchPlaces() : []), ...areaPlaces(AREA.id)]), ...dragPlaces, ...stuntPlaces];"), 'main.ts shows researched places, the airport and stunt places, without cemeteries');
assert.ok(!/const placeList =[^\n]*cemeteries\?\.places/.test(main), 'main.ts leaves cemeteries out of placeList');
const lists = () => Object.fromEntries(AREA_IDS.map(id => [id, [...(id === 'judique' ? [...homePlaces(), ...churchPlaces()] : []), ...areaPlaces(id)]]));
assert.deepEqual(['mabou', 'westbay', 'fixture'].map(id => areaPlaces(id).length), [0, 0, 0], 'other areas keep their own lists');
const report = check(lists());
for (const line of report) console.log('  ' + line);
console.log(`PASS ${report.length} researched places: sources, bounds, road jump and arrival, ${MIN_SITE} m from ${SITES.length} hand-built site boxes and from every other place`);

if (process.argv.includes('--mutations')) {
  const pick = (all, area, id) => all[area].find(p => p.id === id);
  const homeE = 618687.3, homeN = 5074423.9;
  // name: [mutation, the rule that must catch it]
  const mutants = {
    'a place without sources': [all => { pick(all, 'porthood', 'pigs-cove').sources = []; }, 'lists its sources'],
    'a private source path': [all => { pick(all, 'judique', 'baxters-cove').sources = ['reference/notes.txt']; }, 'public source'],
    'a business web page as source': [all => { pick(all, 'judique', 'baxters-cove').sources.push('https://www.example-tearoom.ca/'); }, 'public source'],
    'a place outside its area': [all => { pick(all, 'pointtupper', 'pirate-harbour').e = LAND.pointtupper.manifest.mid[2] - 60; }, 'inside the drive bounds'],
    'a place 100 m from the home site': [all => Object.assign(pick(all, 'judique', 'baxters-cove'), { e: homeE + 100, n: homeN + 120 }), 'from the home'],
    'a place beside the Judique store (#235)': [all => Object.assign(pick(all, 'judique', 'judique-village'), { e: 617107.2 + 60, n: 5081472.6 }), 'from the Judique village buildings'],
    'a place beside the Port Hawkesbury corner garage (#214)': [all => Object.assign(pick(all, 'pointtupper', 'port-hawkesbury'), { e: 628217.94 - 40, n: 5052158.02 - 60 }), 'from the Port Hawkesbury buildings'],
    'a place on a cemetery place': [all => Object.assign(pick(all, 'cansocauseway', 'creignish'), { e: 619826.7, n: 5065640.7 - 100 }), 'from place cansocauseway cemetery-'],
    'a place beside the canal boat line': [all => Object.assign(pick(all, 'cansocauseway', 'visitor-centre'), { e: 623681.953 + 30, n: 5056107.577 + 30 }), 'from the canal boats'],
    'a place on a Mabou place (second marker)': [all => Object.assign(pick(all, 'porthood', 'murphys-pond'), { e: 619664.2 + 40, n: 5097708.5 }), 'from place mabou rail-junction'],
    'a place far from any road': [all => Object.assign(pick(all, 'porthood', 'murphys-pond'), { e: 611200, n: 5099200 }), 'arrival radius'],
    'a jump onto a rail line': [all => Object.assign(pick(all, 'pointtupper', 'granville-green'), { e: 627716.4, n: 5052328.0 }), 'jumps to a road, not Railroad'],
    'arrival note missing at the jump point': [all => { delete pick(all, 'cansocauseway', 'troy-station').radius; }, 'arrival radius'],
    'a civic number in a note': [all => { pick(all, 'pointtupper', 'community-park').note = 'A town park at 12 Example Drive.'; }, 'no numbers'],
    'an opening time in a note': [all => { pick(all, 'cansocauseway', 'visitor-centre').note = 'The visitor information centre. It is open in summer.'; }, 'says nothing about access'],
    'parking in a note': [all => { pick(all, 'judique', 'judique-flyer-trailhead').note = 'A trailhead with parking on the coastal rail trail.'; }, 'says nothing about access'],
    // Another place 150 m or more from Troy Station but nearer its far jump point (253 m away) takes its arrival note.
    'another place nearer the jump point': [all => { const at = nearestPlacement(LAND.cansocauseway.roads, pick(all, 'cansocauseway', 'troy-station'), LAND.cansocauseway.manifest.village), v = LAND.cansocauseway.manifest.village;
      Object.assign(pick(all, 'cansocauseway', 'creignish'), { e: v[0] + at.x + 40, n: v[1] - at.z }); }, 'its own note shows at the jump point'],
    'a three-sentence note': [all => { pick(all, 'judique', 'creignish-lookoff').note += ' It is windy. Bring a coat.'; }, 'one or two plain sentences'],
    'a wrong area tag': [all => { pick(all, 'cansocauseway', 'creignish').area = 'judique'; }, 'area tag'],
    'too few places in an area': [all => { all.pointtupper.splice(1, 5); }, '4 to 8 researched places'],
  };
  let killed = 0;
  for (const [name, [mutate, rule]] of Object.entries(mutants)) {
    const all = lists(); mutate(all);
    let caught = null; try { check(all); } catch (error) { caught = error; }
    assert.ok(caught instanceof assert.AssertionError, `mutation survived: ${name}`);
    assert.ok(caught.message.includes(rule), `mutation ${name} was caught by another rule: ${caught.message}`);
    console.log(`KILLED ${name}: ${caught.message.split('\n')[0]}`); killed++;
  }
  console.log(`PASS ${killed} mutations found`);
}
