// Read site reservations in EPSG:2961 without loading land or reference media.
import { AirportSite } from '../web/src/airport-site.ts';
import { Canal } from '../web/src/canal.ts';
import { CANAL_ROUTE } from '../web/src/canal-route.ts';
import { HarbourLights } from '../web/src/harbour-lights.ts';
import { LIGHTS } from '../web/src/harbour-lights-data.ts';
import { MaryvilleStoreSite } from '../web/src/maryville-store-site.ts';
import { NovemberBuildings } from '../web/src/november-buildings.ts';
import { groupPoints } from '../web/src/port-hawkesbury.ts';
import { PH_GROUPS, PortHawkesburySite } from '../web/src/port-hawkesbury-site.ts';
import { infrastructureParts } from '../web/src/pt-infrastructure.ts';
import { PT_FEATURES } from '../web/src/pt-infrastructure-source.ts';
import { Roads } from '../web/src/roads.ts';
import { TrafficSignals } from '../web/src/traffic-signals.ts';
import { PublicWharves } from '../web/src/wharves.ts';

const origin = [0, 0];
const areas = ['pointtupper', 'porthood', 'cansocauseway'];
const sites = [];
const fromWorld = ([x0, z0, x1, z1]) => [x0, -z1, x1, -z0];
const add = (area, name, box) => sites.push({ area, name, box });
function bounds(points, pad = 0) {
  const e = points.map(p => p[0]), n = points.map(p => p[1]);
  return [Math.min(...e) - pad, Math.min(...n) - pad, Math.max(...e) + pad, Math.max(...n) + pad];
}
function union(boxes) {
  return bounds(boxes.flatMap(([e0, n0, e1, n1]) => [[e0, n0], [e1, n1]]));
}

for (const name of Object.keys(PH_GROUPS)) {
  add('pointtupper', 'Port Hawkesbury ' + name, bounds(groupPoints(name), 3));
}
for (const [i, box] of new PortHawkesburySite(origin).clear.entries()) {
  add('pointtupper', 'Port Hawkesbury clearing ' + (i + 1), fromWorld(box));
}
add('pointtupper', 'airport', fromWorld(new AirportSite(origin).box));
add('porthood', 'Maryville tractor dealership', fromWorld(new MaryvilleStoreSite(origin).box));
add('porthood', 'Dunmore shop', union(new NovemberBuildings('porthood', [], origin, 1, 0, true).clear.map(fromWorld)));

// Use the full snap range of the real signal code. A baked road can be up to
// 3.6 m wide on either side of its centre. Cover both the stops and the heads.
const snapRanges = [];
const signals = new TrafficSignals('pointtupper', origin, {
  nearest(x, z, range) {
    snapRanges.push(range);
    return { x, z, road: { halfWidth: 3.6 } };
  },
}, {}, false);
const signalBoxes = new Map();
signals.stops.forEach((stop, i) => {
  const head = signals.heads[i], radius = snapRanges[i];
  const boxes = signalBoxes.get(stop.junction.id) ?? [];
  boxes.push(bounds([[stop.x, -stop.z]], radius + stop.halfWidth + 1),
    bounds([[head.x, -head.z]], radius + 0.5));
  signalBoxes.set(stop.junction.id, boxes);
});
for (const [name, boxes] of signalBoxes) add('pointtupper', 'signals ' + name, union(boxes));

// Include each surveyed footprint and the actual parts (for example, a point
// gate has posts either side of its surveyed point). Existing culverts are not
// drawn by this layer.
const partBoxes = new Map();
for (const part of infrastructureParts(PT_FEATURES)) {
  const boxes = partBoxes.get(part.id) ?? [];
  boxes.push(bounds([part.a, part.b], part.width / 2));
  partBoxes.set(part.id, boxes);
}
for (const feature of PT_FEATURES.filter(f => !f.existing)) {
  add('pointtupper', 'infrastructure ' + feature.kind + ' ' + feature.id,
    union([bounds(feature.outline), ...partBoxes.get(feature.id)]));
}

// Both packs use the same surveyed movable span. The endpoints are from step
// 23. tools/bridge-source-check.py checks only that one Highway 104 span of
// 85 to 100 m exists; it does not check these ends. The 10 m margin of the
// box takes up a small move; a new snap of the span needs these ends again.
// Run the production snap and use the 35 m approaches used by causeway-browser.
const span = { id: 1, pts: [[623624.81, 5056078.34], [623711.31, 5056108.04]],
  name: 'Highway 104', bridge: true, kind: 1, halfWidth: 3.6 };
const terrain = { surfaceAt: () => null, heightAt: () => 0 };
const canal = new Canal(new Roads({ roads: [span] }, origin, terrain), terrain, origin, -0.2);
const crossing = [];
for (const side of [-1, 1]) {
  for (const across of [-6, 6]) {
    const p = canal.point(side * (canal.halfLength + 35), across);
    crossing.push([p.x, -p.y]);
  }
}
const boatPath = [];
const route = CANAL_ROUTE;
// Allow for the entire largest boat, as in tools/canal-check.mjs.
for (const t of [-route.halfLength - 12, route.halfLength + 12]) {
  for (const w of [-4, 4]) {
    boatPath.push([route.east + route.eastward * t - route.northward * w,
      route.north + route.northward * t + route.eastward * w]);
  }
}
for (const area of ['pointtupper', 'cansocauseway']) {
  add(area, 'Canso Causeway span and approaches', bounds(crossing));
  add(area, 'Canso Canal boat corridor', bounds(boatPath));
}

for (const area of areas) {
  const wharves = new PublicWharves(area, {}, origin, -0.2);
  for (const { source, box } of wharves.state) add(area, 'wharf ' + source.name + ' ' + source.id, fromWorld(box));
  const lights = new HarbourLights(area, origin, 1, false, -0.2);
  for (const light of lights.sites) {
    const record = LIGHTS.find(r => r.number === light.number);
    const radius = record.kind === 'wood' || record.kind === 'octagon' ? record.height * 0.2 : 1.25;
    add(area, 'harbour light ' + light.number, bounds([[light.x, -light.z]], radius));
  }
}

console.log(JSON.stringify(sites));
