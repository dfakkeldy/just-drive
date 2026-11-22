// The player's Atlantic clock, the address values and the weather moods (web/src/weather.ts). No browser.
import assert from 'node:assert/strict';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const load = async entry => {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
};
const { atlanticMoment, weatherSettings, weatherMoment, weatherClock, weatherAddress, moodLook, MOODS, CLEAR_HAZE, winterCover, rainAmount } = await load('web/src/weather.ts');
const { winterRoadGrip, weatherTerrainFragment } = await load('web/src/weather-surfaces.ts');
const { TERRAIN_FRAG } = await load('web/src/shaders.ts');
const { isTestVisit } = await load('web/src/visit.ts');
const read = query => weatherSettings(new URLSearchParams(query));
const iso = query => weatherMoment(read(query)).toISOString();

// Winter is AST (UTC-4), summer is ADT (UTC-3); a missing spring hour moves forward, a repeated autumn hour is the first one.
for (const [date, hour, utc] of [
  ['2026-12-21', 12, '2026-12-21T16:00:00.000Z'],
  ['2026-06-21', 12, '2026-06-21T15:00:00.000Z'],
  ['2026-03-07', 12, '2026-03-07T16:00:00.000Z'], ['2026-03-08', 12, '2026-03-08T15:00:00.000Z'],
  ['2026-03-08', 1.5, '2026-03-08T05:30:00.000Z'], ['2026-03-08', 2.5, '2026-03-08T06:30:00.000Z'], ['2026-03-08', 3.5, '2026-03-08T06:30:00.000Z'],
  ['2026-10-31', 12, '2026-10-31T15:00:00.000Z'], ['2026-11-01', 12, '2026-11-01T16:00:00.000Z'],
  ['2026-11-01', 0.5, '2026-11-01T03:30:00.000Z'], ['2026-11-01', 1.5, '2026-11-01T04:30:00.000Z'], ['2026-11-01', 2.5, '2026-11-01T06:30:00.000Z'],
  ['2027-03-14', 12, '2027-03-14T15:00:00.000Z'], ['2027-11-07', 12, '2027-11-07T16:00:00.000Z'],
  ['2026-12-21', 0, '2026-12-21T04:00:00.000Z'], ['2026-12-21', 23.999, '2026-12-22T03:59:56.400Z'],
]) assert.equal(atlanticMoment(date, hour).toISOString(), utc, `${date} ${hour}`);

// On the default date a tool hour gives the instant of the old fixed UTC-3 formula, bit for bit: tool pictures keep their light.
for (const hour of [0, 4, 6.12345, 12, 12.5, 14, 15, 16.5, 16.75, 17.5, 18.2, 18.47375, 22, 23.99999, 1 / 3, Math.PI])
  assert.equal(+atlanticMoment('2026-10-10', hour), +new Date(Date.UTC(2026, 9, 10, 3, 0, 0) + hour * 3600e3), `legacy instant at hour ${hour}`);
assert.equal(iso(''), '2026-10-10T19:45:00.000Z', 'no values: the game\'s own 16:45 on 10 October');
assert.deepEqual(read(''), { date: '2026-10-10', time: '', hour: 16.75, chosen: false, mood: 'clear', season: 'date', rain: 'steady' });
assert.equal(read('hour=22').chosen, false, 'a tool hour alone is not a player clock');

// Address values: every bad value falls back; nothing throws.
for (const bad of ['2026-02-30', '2026-13-01', '1879-12-31', '2201-01-01', '2026-1-1', '', 'tomorrow', '2026-10-10T12:00'])
  assert.deepEqual([read(`playerDate=${bad}`).date, read(`playerDate=${bad}`).chosen], ['2026-10-10', false], `bad date ${bad}`);
assert.deepEqual([read('playerDate=2028-02-29').date, read('playerDate=2028-02-29').chosen], ['2028-02-29', true]);
for (const bad of ['24:00', '12:60', '1:30', '12', '12:00:00', '', 'noon', '-1:00', '12:5'])
  assert.deepEqual([read(`playerTime=${bad}`).time, read(`playerTime=${bad}`).hour], ['', 16.75], `bad time ${bad}`);
for (const bad of ['-2', '24', 'bad', '', 'Infinity', 'NaN', '-0.001']) assert.equal(read(`hour=${bad}`).hour, 16.75, `bad hour ${bad}`);
assert.equal(read('hour=23.99999').hour, 23.99999);
assert.equal(weatherClock(read('hour=23.99999')), '23:59', 'the shown clock never reads 24:00 or HH:60');
assert.equal(weatherClock(read('hour=18.47375')), '18:28');
assert.equal(weatherClock(read('playerTime=07:05&hour=3')), '07:05');
// Every minute of the day: the player's time is exact, wins over the tool hour, and shows unchanged.
for (let minute = 0; minute < 1440; minute++) {
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const settings = read(`playerDate=2026-12-21&playerTime=${time}&hour=3.3`);
  assert.equal(+weatherMoment(settings), Date.UTC(2026, 11, 21, 4) + minute * 60000, `winter instant at ${time}`);
  assert.equal(weatherClock(settings), time); assert.equal(settings.chosen, true);
}
assert.equal(iso('playerDate=2026-06-21&playerTime=12:00'), '2026-06-21T15:00:00.000Z');
assert.equal(iso('playerDate=2026-03-08&playerTime=02:30'), '2026-03-08T06:30:00.000Z');
assert.equal(iso('playerDate=2026-12-21&hour=12'), '2026-12-21T16:00:00.000Z', 'a tool hour on a player date is Atlantic time too');

// The five moods and the neutral clear path.
assert.deepEqual(MOODS.map(([mood]) => mood), ['clear', 'overcast', 'fog', 'rain', 'snow']);
for (const [mood] of MOODS) assert.equal(read(`weather=${mood}`).mood, mood);
for (const bad of ['', 'Fog', 'Rain', 'blizzard', 'clear ', 'overcast,fog', '__proto__']) assert.equal(read(`weather=${bad}`).mood, 'clear', `bad mood ${bad}`);
assert.equal(moodLook('clear'), null, 'clear changes no number');
assert.equal(CLEAR_HAZE, 0.000032, 'the clear haze is the game\'s old literal');
for (const mood of ['overcast', 'fog', 'rain', 'snow']) {
  const look = moodLook(mood);
  assert.deepEqual(Object.keys(look).sort(), ['dusk', 'flat', 'glow', 'haze', 'mie', 'rayleigh', 'stars', 'sun', 'turbidity'], `${mood}: numbers only`);
  for (const [key, value] of Object.entries(look)) assert.ok(Number.isFinite(value) && value >= 0, `${mood}.${key}`);
  assert.ok(look.sun > 0 && look.sun < 1 && look.flat <= 1 && look.dusk <= 1 && look.glow < 1 && look.stars <= 1, `${mood}: within range`);
  // Trees, roads and buildings take no haze: past about ten times the clear density they float on whitened ground.
  assert.ok(look.haze >= CLEAR_HAZE && look.haze <= 10 * CLEAR_HAZE, `${mood}: haze stays a haze`);
}

// Apply writes player keys only. A link made by the settings is a plain visit: title card, traffic and page title stay.
const applied = weatherAddress('https://example.test/play/?mode=explore&hour=22&date=2026-12-21&time=16:30&q=low#top', '2026-12-21', '17:30', 'fog');
assert.equal(applied.href, 'https://example.test/play/?mode=explore&q=low&playerDate=2026-12-21&playerTime=17%3A30&weather=fog#top');
assert.equal(isTestVisit(applied.searchParams), false, 'an applied address is a player visit');
assert.equal(isTestVisit(new URLSearchParams('hour=12')), true, 'hour stays a tool key');
assert.deepEqual(read(applied.search), { date: '2026-12-21', time: '17:30', hour: 17.5, chosen: true, mood: 'fog', season: 'date', rain: 'steady' });
// Drive around keeps the player's place; a pose that is not finite is left out.
const placed = weatherAddress('https://example.test/?mode=explore&driveAt=1,2,3', '2026-12-21', '17:30', 'clear', { e: 624321.125, n: 5103210.5, heading: 217.25 });
assert.equal(placed.searchParams.get('driveAt'), '624321.125,5103210.5,217.25'); assert.equal(isTestVisit(placed.searchParams), false);
assert.equal(weatherAddress('https://example.test/?mode=explore', '2026-12-21', '17:30', 'clear', { e: NaN, n: 1, heading: 0 }).searchParams.has('driveAt'), false);
// Only a chosen date, Snow or the Winter switch enables cover. The Autumn switch wins.
for (const [query, winter] of [
  ['', false], ['playerDate=2026-11-30', false], ['playerDate=2026-12-01', true],
  ['playerDate=2027-01-01', true], ['playerDate=2028-02-29', true],
  ['playerDate=2027-03-31', true], ['playerDate=2027-04-01', false],
  ['date=2026-12-21', false], ['playerDate=2026-02-31', false], ['weather=snow', true],
  ['season=winter', true], ['season=off&weather=snow&playerDate=2026-12-21', false],
]) assert.equal(winterCover(read(query)), winter, query);
assert.equal(read('season=bad&rain=bad').season, 'date');
assert.equal(read('season=bad&rain=bad').rain, 'steady');
assert.ok(rainAmount('drizzle') < rainAmount('steady') && rainAmount('steady') < rainAmount('downpour'));
assert.ok(moodLook('rain', 'drizzle').sun > moodLook('rain', 'downpour').sun);
const rainLink = weatherAddress(applied.href, '2026-06-21', '18:30', 'rain', undefined, 'off', 'downpour');
assert.deepEqual([read(rainLink.search).season, read(rainLink.search).rain, isTestVisit(rainLink.searchParams)], ['off', 'downpour', false]);
assert.equal(weatherAddress(rainLink.href, '2026-06-21', '18:30', 'clear').searchParams.has('rain'), false);
assert.equal(weatherAddress(rainLink.href, '2026-06-21', '18:30', 'clear').searchParams.has('season'), false);
assert.equal(weatherTerrainFragment(TERRAIN_FRAG, false, false), TERRAIN_FRAG, 'clear keeps exact terrain source');
assert.match(weatherTerrainFragment(TERRAIN_FRAG, true, true), /uniform float winterCover;/);
assert.match(weatherTerrainFragment(TERRAIN_FRAG, true, true), /uniform float rainWet;/);
assert.equal(winterRoadGrip(undefined, true), 1);
assert.equal(winterRoadGrip({ value: 1 }, false), 1);
assert.ok(winterRoadGrip({ value: 1 }, true) < winterRoadGrip({ value: 1 }, true, true));
assert.ok(winterRoadGrip({ value: 1 }, true, true) < 1);
// A failed light study (a bad date) must not replace a player's own clock: main.ts gives the player's moment then.
const main = (await import('node:fs')).readFileSync('web/src/main.ts', 'utf8');
assert.match(main, /const when = \(weather\.chosen && !lightStudy\.active \? undefined : lightStudy\.when\) \?\? weatherMoment\(weather\);/);
console.log('weather: AST/ADT and both clock changes, exact legacy tool hours, 1440 player minutes, address validation, moods and plain-visit links PASS');
