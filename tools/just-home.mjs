// The Just Drive front page: justdrive.fakkeldy.ca/ shows a map of the places, not a game.
// Usage: node tools/just-home.mjs <site folder>. Writes just/home/index.html; the Worker answers the exact root of
// the Just Drive host with it (server/src/index.ts). Static HTML with no script: the pins and cards are plain links.
// The land outline and the pins come from pipeline/just-map.json (pipeline/40_bake_just_map.py), so the build needs
// no data/. Mail mode is a Mabou Mail Madness game on its own host; the Mabou card links there.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AREAS } from '../web/src/area.ts';
import { HISTORY_AREAS } from '../web/src/eras/history-areas.ts';
import { justIcon } from './site-pages.mjs';

export const MAP = JSON.parse(readFileSync(new URL('../pipeline/just-map.json', import.meta.url), 'utf8'));
export const MAIL_URL = 'https://mmm.fakkeldy.ca/';

/** Words and map labels for each public area. `side` puts the map label east or west of its pin. */
export const PLACES = {
  mabou: { blurb: 'The harbour village, its hills and the shore. The mail route starts here.', tags: ['Coal mine', 'Harbour'], label: ['Mabou'], side: 'east' },
  porthood: { blurb: 'A shore village on the Ceilidh Trail, with Port Hood Island off the beach.', tags: ['Beaches'], label: ['Port Hood'], side: 'east' },
  judique: { blurb: 'Farms and back roads above the shore of St. George’s Bay.', tags: ['Church'], label: ['Judique'], side: 'east' },
  westbay: { blurb: 'Quiet roads by the Bras d’Or, and the Sugar Camp Quarry stunt courses.', tags: ['Stunt courses'], label: ['West Bay'], side: 'east' },
  cansocauseway: { blurb: 'The causeway across the Strait of Canso. The canal bridge swings open for boats.', tags: ['Canal bridge'], label: ['Canso Causeway', 'and Troy'], side: 'west' },
  pointtupper: { blurb: 'The town, the deep-water port and the airport on the Strait.', tags: ['Airport', 'Port'], label: ['Point Tupper and', 'Port Hawkesbury'], side: 'east' },
};
// North to south, as the land runs.
const ORDER = ['mabou', 'porthood', 'judique', 'westbay', 'cansocauseway', 'pointtupper'];
const VIEW = [180, 80, 520, 680];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/** The public areas in page order. Every area needs words and a pin, and every pin an area. */
export function places() {
  const areas = AREAS.filter(a => a.id !== 'fixture');
  for (const area of areas) {
    if (!PLACES[area.id] || !ORDER.includes(area.id)) throw Error(`just-home: no words for area ${area.id}`);
    if (!MAP.pins[area.id]) throw Error(`just-home: no map pin for area ${area.id}; rerun pipeline/40_bake_just_map.py`);
  }
  if (ORDER.length !== areas.length) throw Error('just-home: the page order and the areas differ');
  return ORDER.map(id => {
    const area = areas.find(a => a.id === id);
    const era = Object.values(HISTORY_AREAS).find(e => e.id === id) ?? null;
    return { ...area, ...PLACES[id], pin: MAP.pins[id], era };
  });
}

function pin(place) {
  const [x, y] = place.pin, east = place.side === 'east', dx = east ? 16 : -16;
  const lines = place.label.map((line, i) => `<tspan x="${x + dx}" dy="${i ? '1.1em' : `${0.35 - (place.label.length - 1) * 0.55}em`}">${escape(line)}</tspan>`).join('');
  return `<a class="pin${place.mail ? ' mail' : ''}" id="pin-${place.id}" href="/${place.id}" aria-label="Drive in ${escape(place.name)}${place.mail ? ", mail route too" : ""}">`
    + `<circle class="hit" cx="${x}" cy="${y}" r="8"/><circle class="halo" cx="${x}" cy="${y}" r="20"/><circle class="dot" cx="${x}" cy="${y}" r="8"/>${place.mail ? `<circle class="mailCentre" cx="${x}" cy="${y}" r="3"/>` : ''}`
    + `<text x="${x + dx}" y="${y}" text-anchor="${east ? 'start' : 'end'}">${lines}</text></a>`;
}

function card(place) {
  const actions = [`<a class="button" href="/${place.id}" aria-label="Drive in ${escape(place.name)}">Drive</a>`];
  if (place.mail) actions.push(`<a class="button mail" href="${MAIL_URL}">Deliver the mail</a>`);
  if (place.era) actions.push(`<a class="button second" href="/${place.era.address}" aria-label="Drive in ${escape(place.name)}, 1884">Drive in 1884</a>`);
  return `<li class="place" id="place-${place.id}"><h2>${escape(place.name)}</h2><p>${escape(place.blurb)}</p>${place.mail ? '<p class="mailCaption">Mabou Mail Madness: the same roads, with a mail route you cannot win.</p>' : ''}`
    + `<ul class="tags">${place.tags.map(t => `<li>${escape(t)}</li>`).join('')}</ul><div class="actions">${actions.join('')}</div></li>`;
}

const CSS = `
:root{color-scheme:dark;--bg:#0b1620;--sea:#0e1d29;--land:#1d3140;--shore:#3a5468;--panel:#122230;--line:#24384a;--ink:#eef2f6;--dim:#b9c3cc;--quiet:#8a99a6;--accent:#a7d9bc;--strong:#4f9b74;--maple:#d0632e}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;overflow-x:hidden;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-underline-offset:3px}
a:focus-visible{outline:3px solid #fff;outline-offset:3px;border-radius:4px}
h1,h2{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600;letter-spacing:-.01em}
.page{max-width:1180px;margin:0 auto;padding:max(28px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
header{max-width:640px}
.kicker{margin:0;color:var(--accent);font:700 13px/1.4 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}
h1{margin:.1em 0 .25em;font-size:clamp(44px,9vw,72px);line-height:1}
.lead{margin:0;font-size:19px;color:var(--dim)}
.layout{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;margin-top:24px}
.map{margin:0;position:relative;border-radius:14px;overflow:hidden;background:var(--sea)}
.map svg{display:block;width:100%;height:auto;max-height:72vh}
.land{fill:var(--land);stroke:var(--shore);stroke-width:1.2;stroke-linejoin:round}
.water-label{fill:#9fb3c3;font:italic 15px Georgia,serif;letter-spacing:.18em;text-transform:uppercase}
.pin{cursor:pointer;text-decoration:none}
.pin .hit{fill:transparent;stroke:transparent;stroke-width:44px;vector-effect:non-scaling-stroke;pointer-events:all}
.pin .halo{fill:var(--accent);opacity:0;transition:opacity .15s}
.pin .dot{fill:var(--bg);stroke:var(--accent);stroke-width:4}
.pin.mail .dot{stroke:var(--maple)}.pin .mailCentre{fill:var(--maple)}
.pin text{fill:var(--ink);font:600 19px/1 system-ui,sans-serif;paint-order:stroke;stroke:var(--sea);stroke-width:5px;stroke-linejoin:round}
.pin:hover .halo,.pin:focus-visible .halo{opacity:.28}
.pin:hover .dot,.pin:focus-visible .dot{fill:var(--accent)}
.pin.mail:hover .dot,.pin.mail:focus-visible .dot{fill:var(--maple)}
.pin:focus-visible{outline:none}.pin:focus-visible .halo{stroke:#fff;stroke-width:3;opacity:1;fill:transparent;vector-effect:non-scaling-stroke}
.pin:is(:hover,:focus-visible) text{fill:var(--accent);text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:4px}
.legend{position:absolute;left:12px;bottom:12px;display:flex;gap:16px;margin:0;padding:0;white-space:nowrap;pointer-events:none;color:var(--dim);font-size:13px}
.legend i{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:50%;border:3px solid var(--accent);vertical-align:-1px}
.legend i.mail{border-color:var(--maple);background:var(--maple)}
.places{display:grid;gap:12px;margin:0;padding:0;list-style:none}
.place{padding:16px 18px;border-radius:12px;background:var(--panel);transition:border-color .15s}
.place h2{margin:0 0 4px;font-size:26px;line-height:1.15}
.place p{margin:0;color:var(--dim)}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}
.tags li{color:var(--dim);font-size:13px}.tags li+li::before{content:"·";margin-right:6px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.button{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:8px;background:var(--accent);color:#0b1620;font-weight:700;text-decoration:none}
.button.mail{background:var(--maple);color:#0b1620}
.button.second{background:transparent;border:1px solid #e9d2ad;color:#e9d2ad}
.button:hover{filter:brightness(1.08)}
${ORDER.map(id => `body:has(#place-${id}:is(:hover,:focus-within)) #pin-${id} .halo{opacity:.28}body:has(#pin-${id}:hover) #place-${id},body:has(#pin-${id}:focus-visible) #place-${id}{box-shadow:inset 3px 0 var(--accent)}`).join('\n')}
.signoff{margin:32px 0 0;color:var(--dim);font:22px/1.4 "Iowan Old Style",Palatino,Georgia,serif}
header>p:last-of-type{margin:25px 0}
.roadPicture{margin:0;border-radius:8px;overflow:hidden}.roadPicture img{display:block;width:100%;height:auto;max-height:240px;object-fit:cover;object-position:50% 70%}.roadPicture figcaption{font-size:13px;color:var(--dim);padding:6px 0}
.place .mailCaption{margin-top:8px}
footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--quiet);font-size:14px}
footer nav{display:flex;flex-wrap:wrap;gap:6px 20px;margin-bottom:12px}
footer nav a{display:inline-flex;align-items:center;min-height:44px}
footer p{margin:0 0 6px}
@media(max-width:599px){footer nav{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;margin-bottom:32px}.button.second{width:100%;justify-content:center}}
@media(min-width:600px){.roadPicture img{object-position:50% 52%}}
@media (min-width:900px){.layout{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start}.map{position:sticky;top:20px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (min-width:1000px){header{max-width:none;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:40px;align-items:start}header>*{grid-column:1}header>.roadPicture{grid-column:2;grid-row:1/span 4;align-self:center}}
@media print{header{display:block}.legend{position:static}body{background:#fff;color:#000}.map{position:static}.button{border:1px solid #000}}
`;

export function justHome() {
  const list = places();
  const title = 'Just Drive: a free 3D driving game on the real roads of Cape Breton';
  const description = 'A free 3D driving game on the real roads of Cape Breton, built from the province’s LiDAR laser survey. No missions and no clock. Play in your browser, on a phone too. No download.';
  const [vx, vy, vw, vh] = VIEW;
  const svg = `<svg viewBox="${VIEW.join(' ')}" role="group" aria-labelledby="mapTitle" xmlns="http://www.w3.org/2000/svg">`
    + `<title id="mapTitle">Map of western Cape Breton with the places you can drive</title>`
    + `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="var(--sea)"/>`
    + `<path class="land" fill-rule="evenodd" d="${MAP.land}"/>`
    + `<text class="water-label" x="214" y="420" transform="rotate(-82 214 420)">Gulf of St. Lawrence</text>`
    + `<text class="water-label" x="692" y="462" text-anchor="end">Bras d’Or</text>`
    + list.map(pin).join('') + '</svg>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${escape(description)}">
<link rel="icon" href="${justIcon}">
<link rel="manifest" href="/manifest-just.webmanifest">
<meta name="theme-color" content="#0b1620">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="https://justdrive.fakkeldy.ca/about/img/road.jpg">
<meta property="og:url" content="https://justdrive.fakkeldy.ca/">
<style>${CSS}</style>
</head>
<body>
<div class="page">
<header><p class="kicker">Cape Breton, Nova Scotia</p><h1>Just Drive</h1><p class="lead">A free 3D driving game on the real roads of Cape Breton, <a href="/about">built from the province’s LiDAR laser survey</a>. No missions and no clock. Play in your browser, on a phone too. No download.</p><p><a class="button" href="/mabou">Start in Mabou</a></p><figure class="roadPicture"><img src="/about/img/road.jpg" alt="The shore road near Mabou, in the game." width="1080" height="1440"><figcaption>The shore road near Mabou, in the game.</figcaption></figure></header>
<main class="layout">
<figure class="map">${svg}<figcaption class="legend"><span><i></i>Choose a pin to drive</span><span><i class="mail"></i>Mail route too</span></figcaption></figure>
<ul class="places" aria-label="Places">${list.map(card).join('')}</ul>
</main>
<p class="signoff">I made these roads for a slow drive. Take your time.</p>
<footer>
<nav aria-label="More"><a href="/about">About</a><a href="/changes/">What's new</a><a href="/help">Help and controls</a><a href="/listen/">Just Listen (the radio)</a><a href="${MAIL_URL}">Mabou Mail Madness</a></nav>
<p>Map: coastline from Natural Resources Canada, Medium Resolution Digital Elevation Model (MRDEM-30 DTM). Contains information licensed under the Open Government Licence – Canada.</p>
</footer>
</div>
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const site = process.argv[2];
  if (!site) { console.error('usage: node tools/just-home.mjs <site folder>'); process.exit(2); }
  const folder = resolve(site, 'just/home');
  mkdirSync(folder, { recursive: true });
  writeFileSync(folder + '/index.html', justHome());
  console.log(`just-home: ${fileURLToPath(pathToFileURL(folder + '/index.html'))}`);
}
