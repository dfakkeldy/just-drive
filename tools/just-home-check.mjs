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
  assert.match(html,/\.legend\{position:absolute;[^}]*pointer-events:none/);
  assert.doesNotMatch(html.match(/\.legend\{[^}]*\}/)[0],/background/);
  assert.match(html,/<figure class="map">[\s\S]*?<figcaption class="legend">[\s\S]*?<\/figcaption><\/figure>/);
  assert.ok(html.includes('viewBox="180 80 520 680"'));
  assert.match(html,/@media\(max-width:599px\)\{footer nav\{display:grid;grid-template-columns:1fr 1fr/);
  assert.match(html,/@media\(min-width:600px\)\{\.roadPicture img\{object-position:50% 52%\}/);
  const areas = AREAS.filter(a => a.id !== 'fixture');
  assert.equal([...html.matchAll(/<title>/g)].length, 1, 'one title');
  assert.match(html, /<title>Just Drive: a free 3D driving game on the real roads of Cape Breton<\/title>/);
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
    assert.ok(cardHtml.includes(`<a class="button" href="/${area.id}" aria-label="Drive in ${area.name}">Drive</a>`), area.id + ' Drive link');
    assert.match(html, new RegExp(`<a class="pin[^"]*" id="pin-${area.id}" href="/${area.id}"`), area.id + ' pin');
    assert.equal(cardHtml.includes(`href="${MAIL_URL}"`), !!area.mail, area.id + ': mail link only where the mail route is');
    const era = Object.values(HISTORY_AREAS).find(e => e.id === area.id);
    assert.equal(cardHtml.includes('href="/' + (era?.address ?? '-') + '"'), !!era, area.id + ': 1884 link only for era areas');
    const [x, y] = MAP.pins[area.id];
    assert.ok(x > 180 && x < 700 && y > 80 && y < 720, area.id + ' pin inside the map view');
  }
  assert.match(html, /Start in Mabou<\/a>/);
  assert.match(html, /<a href="\/about">built from the province’s LiDAR laser survey<\/a>/);
  assert.match(html, /No missions and no clock\./);
  assert.match(html, /property="og:image" content="https:\/\/justdrive\.fakkeldy\.ca\/about\/img\/road\.jpg"/);
  assert.match(html, /<figure class="roadPicture"><img src="\/about\/img\/road\.jpg"[^>]+><figcaption>The shore road near Mabou, in the game\.<\/figcaption>/);
  assert.equal((html.match(/class="mailCentre"/g)??[]).length,1,'only the mail pin has a filled centre');
  assert.doesNotMatch(html, /<li>Mail route<\/li>/,'mail caption and action keep the meaning');
  assert.match(html, /free 3D driving game/);
  assert.match(html, /\.pin \.hit\{[^}]*stroke-width:44px;vector-effect:non-scaling-stroke/);
  const luminance=hex=>hex.match(/../g).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  assert.ok((luminance(html.match(/--maple:#([0-9a-f]{6})/)[1])+.05)/(luminance('0b1620')+.05)>=4.5,'mail action text contrast');
  assert.match(html, /aria-label="Drive in Mabou, mail route too"/);
  assert.match(html, /\.pin:focus-visible \.halo\{[^}]*stroke:#fff;stroke-width:3/);
  assert.match(html, /\.button.mail\{background:var\(--maple\);color:#0b1620/);
  assert.equal((html.match(/>Drive in 1884<\/a>/g) ?? []).length, Object.keys(HISTORY_AREAS).length);
  for (const place of ['Mabou', 'Judique']) assert.ok(html.includes(`aria-label="Drive in ${place}, 1884"`));
  assert.match(html, /Mabou Mail Madness: the same roads, with a mail route you cannot win\./);
  assert.match(html, /Choose a pin to drive/);
  assert.match(html, /\.button.second\{background:transparent;border:1px solid #e9d2ad/);
  const colour = pattern => {
    const match = html.match(pattern);
    assert.ok(match, `built page colour: ${pattern}`);
    return match[1];
  };
  const waterLabel = colour(/\.water-label\{fill:#([0-9a-f]{6})\b/i);
  for (const name of ['sea', 'land']) {
    const background = colour(new RegExp(`--${name}:#([0-9a-f]{6})\\b`, 'i'));
    const values = [luminance(waterLabel), luminance(background)];
    assert.ok((Math.max(...values)+.05)/(Math.min(...values)+.05)>=4.5, `water labels contrast on ${name}`);
  }
  const lead = html.match(/<p class="lead">([\s\S]*?)<\/p>/)[1].replace(/<[^>]*>/g,'');
  for (const tag of ['name="description"', 'property="og:description"']) assert.ok(html.includes(`<meta ${tag} content="${lead}">`));
  // Every same-site link is an address the Worker serves; nothing names a home, a civic number or a private path.
  const known = new Set(['/changes/', '/about', '/help', '/listen/', '/manifest-just.webmanifest', ...areas.map(a => '/' + a.id), ...Object.values(HISTORY_AREAS).map(e => '/' + e.address)]);
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) assert.ok(known.has(href), 'unknown link ' + href);
  assert.doesNotMatch(html, /red roof|\/Users\/|\b\d{3,5} [A-Z][a-z]+ (Road|Rd|Street|St)\b/i);
  console.log(`PASS Just Drive front page: ${areas.length} areas with card, pin and Drive link; mail link on ${areas.filter(a => a.mail).map(a => a.id)}; 1884 links on ${Object.keys(HISTORY_AREAS)}; no script; known links only`);
} finally { rmSync(out, { recursive: true, force: true }); }
