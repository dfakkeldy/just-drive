// The Just Drive front page (tools/just-home.mjs): built from the real builder into a temporary folder, then read as a
// visitor would. Every area has a card, a pin and a Drive link; mail and 1884 links go only where they belong.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AREAS } from '../web/src/area.ts';
import { HISTORY_AREAS } from '../web/src/eras/history-areas.ts';
import { MAIL_URL, MAP, places } from './just-home.mjs';
process.on('uncaughtException', e => { console.error(e.name + ': ' + e.message); process.exit(1); });

const out = mkdtempSync(join(tmpdir(), 'mmm-just-home-'));
try {
  execFileSync('node', ['tools/just-home.mjs', out], { stdio: 'pipe' });
  const html = readFileSync(`${out}/just/home/index.html`, 'utf8');
  const areas = AREAS.filter(a => a.id !== 'fixture');
  assert.equal([...html.matchAll(/<title>/g)].length, 1, 'one title');
  assert.match(html, /<title>Just Drive<\/title>/);
  assert.match(html, /<meta name="viewport"/);
  for (const tag of ['title', 'description', 'type', 'url']) assert.match(html, new RegExp(`property="og:${tag}"`), 'og:' + tag);
  assert.match(html, /property="og:url" content="https:\/\/justdrive\.fakkeldy\.ca\/"/);
  assert.match(html, /rel="manifest" href="\/manifest-just\.webmanifest"/);
  assert.doesNotMatch(html, /<script\b/i, 'a static page: pins and cards are plain links');
  assert.match(html, /Open Government Licence/, 'the land outline credit');

  // Every public area: one card, one pin, and both link to its own address.
  assert.equal(places().length, areas.length);
  for (const area of areas) {
    const cardHtml = html.match(new RegExp(`<li class="place" id="place-${area.id}">([\\s\\S]*?)</div></li>`))?.[1];
    assert.ok(cardHtml, area.id + ' card');
    assert.ok(cardHtml.includes(`<a class="button" href="/${area.id}">Drive</a>`), area.id + ' Drive link');
    assert.match(html, new RegExp(`<a class="pin[^"]*" id="pin-${area.id}" href="/${area.id}"`), area.id + ' pin');
    assert.equal(cardHtml.includes(`href="${MAIL_URL}"`), !!area.mail, area.id + ': mail link only where the mail route is');
    const era = Object.values(HISTORY_AREAS).find(e => e.id === area.id);
    assert.equal(cardHtml.includes('href="/' + (era?.address ?? '-') + '"'), !!era, area.id + ': 1884 link only for era areas');
    const [x, y] = MAP.pins[area.id];
    assert.ok(x > 180 && x < 700 && y > 80 && y < 720, area.id + ' pin inside the map view');
  }
  // Every same-site link is an address the Worker serves; nothing names a home, a civic number or a private path.
  const known = new Set(['/about', '/help', '/listen/', '/manifest-just.webmanifest', ...areas.map(a => '/' + a.id), ...Object.values(HISTORY_AREAS).map(e => '/' + e.address)]);
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) assert.ok(known.has(href), 'unknown link ' + href);
  assert.doesNotMatch(html, /red roof|\/Users\/|\b\d{3,5} [A-Z][a-z]+ (Road|Rd|Street|St)\b/i);
  console.log(`PASS Just Drive front page: ${areas.length} areas with card, pin and Drive link; mail link on ${areas.filter(a => a.mail).map(a => a.id)}; 1884 links on ${Object.keys(HISTORY_AREAS)}; no script; known links only`);
} finally { rmSync(out, { recursive: true, force: true }); }
