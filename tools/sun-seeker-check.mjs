import assert from 'node:assert/strict';
import { ephemeris, halifaxTime, localDate, localTime, localZone } from '../web/src/light-study.ts';
import { directionFromAngles } from '../web/src/sun.ts';
import { apparentUpperLimb, hillElevation, hillSunEvents, sampleHillLine, sunArc, trueEyeHeight } from '../web/src/sun-seeker-rules.ts';

const lat = 45.867, lon = -61.315, date = '2026-11-21';
const flat = ephemeris(date, lat, lon);
assert.ok(Math.abs(+flat.highest.when - +halifaxTime(date, '11:50').when) < 5 * 60_000);
assert.ok(Math.abs(flat.highest.el - 24) < 1);
assert.ok(Math.abs(flat.sunrise.az - 118) < 3);
assert.equal(localZone(flat.highest.when), 'AST');
assert.equal(localDate(new Date('2026-11-22T02:00:00Z')), date);
const peak = day => Math.max(...sunArc(day, lat, lon).map(p => p.el));
assert.ok(peak('2026-12-21') < peak(date));
assert.ok(peak(date) < peak('2026-03-20'));
assert.ok(peak('2026-03-20') < peak('2026-06-21'));
const arc = sunArc(date, lat, lon);
assert.ok(Math.abs(+arc[0].when - +flat.sunrise.when) < 1);
assert.ok(Math.abs(+arc.at(-1).when - +flat.sunset.when) < 1);
assert.ok(arc.every((p, i) => i === 0 || +p.when > +arc[i - 1].when));
assert.ok(directionFromAngles(arc[0].az, arc[0].el).x > 0);
assert.ok(directionFromAngles(arc.at(-1).az, arc.at(-1).el).x < 0);

const eps = (actual, expected, tol = 0.000001) => assert.ok(Math.abs(actual - expected) < tol, `${actual} ≈ ${expected}`);
const eye = { x: 10, y: 12, z: 20 };
const sample = (eye, height, exag = 1) => sampleHillLine(eye, 0, () => height, exag);
const plain = sample(eye, () => 10);
assert.equal(plain.length, 360);
eps(hillElevation(plain, 145.23), -.04234, .001);
const ridgeGround = (x, z) => {
  const dx = x - eye.x, dz = z - eye.z, range = Math.hypot(dx, dz);
  if (range > 160 && range < 240 && dx > 0 && dz > 35) return eye.y + range * Math.tan(6 * Math.PI / 180);
  return 10;
};
const ridge = sample(eye, ridgeGround);
eps(hillElevation(ridge, 120), 6, .002);
eps(hillElevation(ridge, 240), hillElevation(plain, 240));
const aroundNorth = Array(360).fill(0);
aroundNorth[359] = 4;
eps(hillElevation(aroundNorth, -0.5), 2);
aroundNorth[0] = null;
assert.equal(hillElevation(aroundNorth, 359.5), null);
assert.equal(hillElevation(aroundNorth, 359), 4);

const overPlain = hillSunEvents(date, lat, lon, plain);
const overRidge = hillSunEvents(date, lat, lon, ridge);
assert.ok(+overRidge.sunrise.when > +overPlain.sunrise.when + 30 * 60_000);
assert.equal(+overRidge.sunset.when, +overPlain.sunset.when);
eps(apparentUpperLimb(overRidge.sunrise.el), hillElevation(ridge, overRidge.sunrise.az), 0.001);
for (const exag of [1, 1.5, 3]) {
  const eyeAboveStretchedLand = { ...eye, y: 10 * exag + 2 };
  const corrected = trueEyeHeight(eyeAboveStretchedLand.y, 10 * exag, exag, 0);
  const actual = sample({ ...eye, y: corrected }, ridgeGround);
  assert.deepEqual(hillSunEvents(date, lat, lon, actual), overRidge, `events at EXAG ${exag}`);
  if (exag > 1) assert.ok(hillElevation(sample(eyeAboveStretchedLand, ridgeGround, exag), 120) > 8);
}
const flatSea = sample({ ...eye, y: 0 }, () => 0);
for (const key of ['sunrise', 'sunset']) {
  const seaEvent = hillSunEvents(date, lat, lon, flatSea)[key];
  assert.ok(Math.abs(+seaEvent.when - +flat[key].when) < 60_000, `flat sea ${key} converges within one minute`);
}
const highEye = { ...eye, y: 200 };
const highSea = sample(highEye, () => 0);
eps(hillElevation(highSea, 90), -.423, .005);
assert.deepEqual(sample(highEye, () => null), highSea, 'unmapped rays use the same curved sea horizon');
// A point 6 km away at eye height would be level on a flat world. Curvature drops it about 2.46 m.
const distantRidge = sample(highEye, (_x, _z, distance) => distance === 6000 ? 200 : 0);
eps(hillElevation(distantRidge, 90), -.02347, .0001);
const west = hillSunEvents(date, lat, lon, ridge.map((_, az) => ridge[(360 - az) % 360]));
assert.ok(+west.sunset.when < +overPlain.sunset.when - 30 * 60_000);
const midDayRidge = plain.map((el, az) => az >= 175 && az <= 185 ? 40 : el);
const split = hillSunEvents(date, lat, lon, midDayRidge);
assert.equal(+split.sunrise.when, +overPlain.sunrise.when);
assert.equal(+split.sunset.when, +overPlain.sunset.when);
const covered = hillSunEvents(date, lat, lon, plain.map(() => 80));
assert.deepEqual(covered, { sunrise: undefined, sunset: undefined });
// River Denys Mountain church: a ridge about 38 m above the eye, 455-475 m to the WSW, sets the sun near 15:54 AST.
// The baked survey gives 15:53-15:54 by an independent sight-line script; the flat horizon gives 16:28.
const churchEye = { x: 0, y: 207, z: 0 };
const churchGround = (x, z) => {
  const range = Math.hypot(x, z), bearing = (Math.atan2(x, -z) * 180 / Math.PI + 360) % 360;
  return bearing > 220 && bearing < 260 && range > 455 && range < 475 ? 245.5 : 205;
};
const church = hillSunEvents(date, lat, lon, sample(churchEye, churchGround));
const churchSet = localTime(church.sunset.when);
assert.ok(churchSet >= '15:51' && churchSet <= '15:57', `church ridge sunset ${churchSet}`);
assert.ok(Math.abs(+church.sunrise.when - +flat.sunrise.when) < 3 * 60_000, 'no ridge to the ESE');
eps(hillElevation(sample(churchEye, churchGround), 240), Math.atan((245.5 - 207 - 455 * 455 * 0.87 / 12_742_000) / 455) * 180 / Math.PI, .25);
console.log(`PASS Sun Seeker arcs and terrain crossings: flat noon ${localTime(flat.highest.when)} AST at ${flat.highest.el.toFixed(1)}°, sunrise azimuth ${flat.sunrise.az.toFixed(1)}°`);
console.log(`PASS exaggeration invariance, flat-sea rise and set within one minute, 200 m dip and curvature drop, church ridge sunset ${churchSet} AST`);
