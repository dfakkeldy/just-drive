// The About and Help pages of each brand: /about and /help on mmm.fakkeldy.ca and justdrive.fakkeldy.ca.
// Usage: node tools/about-pages.mjs <site folder>. Writes about/{mail,just}/index.html, help/{mail,just}/index.html
// and the pictures in about/img/. The Worker answers /about and /help on each host with its own brand's page
// (server/src/index.ts).
// Static HTML with a small keyboard link handler. The pictures are game screenshots made for the posters (assets/about/).
import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { justIcon } from './site-pages.mjs';

// The game's own credit strings, bundled from its source (property-lines-rules.ts is more than Node can strip).
const { outputFiles } = await build({ stdin: { contents: "export { AREAS } from './area'; export * from './credits'; export * from './controls'; export { bikeKeys } from './vehicle-choice'; export { PUBLIC_MUSIC_CREDIT } from './radio-credits.generated'; export { PROPERTY_ATTRIBUTION, PROPERTY_LICENSE_URL } from './property-lines-rules';", resolveDir: fileURLToPath(new URL('../web/src', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { AREAS, ABOUT_URL, HELP_URL, LISTEN_URL, LISTEN_TEXT, keyCaps, KEYS, TOUCH, DRIVING_KEYS, DRIVING_TOUCH, padKeys, bikeKeys, CONTACT, COFFEE_URL, COFFEE_TEXT, ENGINE_CREDIT, LAND_CREDITS, FAR_CREDITS, PUBLIC_MUSIC_CREDIT, PROPERTY_ATTRIBUTION, PROPERTY_LICENSE_URL } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

const mailIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230b1620'/%3E%3Cpath d='M12 22h40v24H12z' fill='%23eef2f6'/%3E%3Cpath d='M12 22l20 15 20-15' fill='none' stroke='%23d0632e' stroke-width='4'/%3E%3C/svg%3E";
const PICTURES = ['mail.jpg', 'road.jpg', 'village.jpg'];

const CSS = `
:root{color-scheme:dark;--bg:#0b1620;--panel:#122230;--line:#24384a;--ink:#eef2f6;--dim:#b9c3cc;--quiet:#8a99a6;--accent:#edb486;--strong:#d0632e}
.just{--accent:#a7d9bc;--strong:#4f9b74}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;overflow-x:hidden;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-underline-offset:3px}
:is(a,summary):focus-visible{outline:3px solid #fff;outline-offset:3px;border-radius:4px}
h1,h2,.serif{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600;letter-spacing:-.01em}
.page{display:grid;grid-template-columns:minmax(0,1fr);min-height:100vh}
.picture{position:relative;height:62vh;min-height:360px;max-height:640px;overflow:hidden;background:#1b2a36}
.picture img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 70%}
.picture::after{content:"";position:absolute;inset:auto 0 0 0;height:55%;background:linear-gradient(transparent,var(--bg))}
.picture figcaption{position:absolute;z-index:1;right:16px;top:12px;font-size:12px;color:#0b1620;background:rgba(238,242,246,.78);padding:2px 8px;border-radius:99px}
.text{width:100%;max-width:680px;margin:-120px auto 0;padding:0 16px 64px;position:relative;z-index:1}
.kicker{margin:0;color:var(--accent);font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{margin:.15em 0 .3em;font-size:clamp(42px,9vw,68px);line-height:1.02}
h1 span{color:var(--accent)}
.lead{margin:0;font-size:20px;line-height:1.5;color:var(--ink)}
.actionCaption{font-size:13px;color:var(--dim)}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0 8px}
.button{display:inline-flex;align-items:center;min-height:48px;padding:0 20px;border-radius:8px;background:var(--accent);color:#0b1620;font-weight:700;text-decoration:none}
.mail .button:not(.second){background:var(--strong)}
.button.second{background:transparent;color:var(--ink);border:1px solid var(--line)}
section{margin-top:56px}
h2{margin:0 0 12px;font-size:30px;line-height:1.15}
.label{display:block;margin-bottom:4px;color:var(--quiet);font:700 12px/1.4 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}
p{margin:0 0 14px}
.dim{color:var(--dim)}
.features{display:grid;gap:12px;margin:20px 0 0;padding:0;list-style:none}
.features li{padding:8px 0}
.features b{display:block;color:var(--ink)}
.features span{color:var(--dim)}
.places{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:10px;margin:16px 0 0;padding:0;list-style:none}
.places a{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:52px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);text-decoration:none;font-weight:600}
.places a::after{content:"→";color:var(--accent)}
.places a:hover{border-color:var(--accent)}
.steps{margin:20px 0 0;padding:0;list-style:none;counter-reset:step}
.steps li{position:relative;padding:0 0 18px 44px;counter-increment:step}
.steps li::before{content:counter(step);position:absolute;left:0;top:0;width:30px;height:30px;border-radius:50%;border:1px solid var(--accent);color:var(--accent);display:grid;place-items:center;font:700 14px system-ui,sans-serif}
.steps li:not(:last-child)::after{content:"";position:absolute;left:15px;top:34px;bottom:4px;width:1px;background:var(--line)}
.note{padding:14px 16px;border-left:3px solid var(--strong);background:var(--panel);border-radius:0 10px 10px 0;color:var(--dim)}
.inline-picture{margin:20px 0 0;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
.inline-picture img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:50% 45%}
.inline-picture figcaption{padding:8px 14px;font-size:13px;color:var(--quiet);background:var(--panel)}
.maker{display:grid;gap:4px;padding:0}
.maker .serif{font-size:24px}
.credits{font-size:14px;line-height:1.55;color:var(--dim)}
.credits p{margin:0 0 10px}#credits{margin-top:56px}.credits{margin-top:0}.credits summary{cursor:pointer;min-height:44px}.signoff{margin-top:32px;font:22px/1.4 "Iowan Old Style",Palatino,Georgia,serif}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:14px;color:var(--quiet);display:flex;flex-wrap:wrap;gap:8px 20px}
/* Help pages: one column, a contents strip and control tables. */
.page.plain{grid-template-columns:minmax(0,1fr)}
.plain .text{max-width:880px;margin:0 auto;padding-top:40px}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0;padding:0;list-style:none}
.toc a{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:99px;color:var(--ink);text-decoration:none;font-size:15px}
.toc a:is(:hover,:focus-visible){border-color:var(--accent);background:var(--accent);color:#0b1620}
.totop a{display:inline-flex;align-items:center;min-height:44px;font-size:15px}
.controls{display:grid;gap:16px;margin-top:16px}
.controls h3{margin:0 0 6px;font:700 13px/1.4 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.controls dl{margin:0}
.controls div.row{display:grid;grid-template-columns:minmax(96px,38%) 1fr;gap:12px;padding:10px 0;background:none}
.controls div.row+div.row{border-top:1px solid var(--line)}
.controls dt{font:700 14px/1.5 ui-monospace,Menlo,Consolas,monospace;color:var(--ink)}
.controls dt b{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:600}
.controls dd{margin:0;color:var(--dim)}
.qa{margin:16px 0 0;padding:0;list-style:none;display:grid;gap:12px}
.qa li{padding:8px 0}
.qa b{display:block}
.qa span{color:var(--dim)}
.keyJoin{color:var(--dim)}
kbd{font:700 max(12px,.9em) ui-monospace,Menlo,Consolas,monospace;padding:2px 6px;border:1px solid #71818e;border-bottom:2px solid #46566a;border-radius:4px;background:#20303b;color:var(--ink)}
@media (min-width:960px){
 .page.plain .text{padding:64px 16px}
 .controls{grid-template-columns:1fr 1fr}
 .page{grid-template-columns:minmax(0,5fr) minmax(0,6fr)}
 .picture{position:sticky;top:0;height:100vh;max-height:none}
 .picture::after{inset:0 0 0 auto;width:30%;height:auto;background:linear-gradient(90deg,transparent,var(--bg))}
 .picture figcaption{right:auto;left:16px;top:auto;bottom:16px}
 .text{margin:0;padding:72px 48px 64px 32px}
 .features{grid-template-columns:1fr 1fr}
}
@media (max-width:959px){.mail .picture+.text .kicker{color:#ffe0c2}}
@media (prefers-reduced-motion:no-preference){.button,.places a{transition:border-color .15s,transform .15s}.button:hover,.places a:hover{transform:translateY(-1px)}}
`;

const MADE = (brand) => `<section aria-labelledby="made">
<span class="label">How it was made</span>
<h2 id="made">Real land, from public survey data</h2>
<p>Nothing here was drawn by hand from a photo. The ground, the trees and the buildings come from open government data, and the game draws them in your browser.</p>
<ol role="list" class="steps">
<li><b>Measure.</b> <span class="dim">A laser survey flown over Nova Scotia (LiDAR) gives the shape of the ground to about a metre, and the height of each tree and building.</span></li>
<li><b>Map.</b> <span class="dim">Provincial maps add the roads, rivers, lakes and forest types. OpenStreetMap fills some gaps.</span></li>
<li><b>Bake.</b> <span class="dim">A pipeline in Python and GDAL turns the data into small tiles: ground, road surfaces, hundreds of thousands of trees, and the buildings with their real size and roof height.</span></li>
<li><b>Drive.</b> <span class="dim">The game, written in TypeScript with three.js, loads the tiles around you as you drive. It is made to run well on a phone.</span></li>
</ol>
<p>Dan Fakkeldy designed ${brand === 'just' ? 'Just Drive' : 'the game'} and directed a team of AI coding agents (Anthropic’s Claude and OpenAI’s Codex) to build it. The agents wrote the code, baked the land and tested each change. A separate agent reviewed every change before it went live. Dan chose what to make, drove the builds, and made the calls.</p>
</section>
<section aria-labelledby="who">
<span class="label">Who made it</span>
<h2 id="who" class="sr">Dan Fakkeldy</h2>
<div class="maker">
<span class="serif">Dan Fakkeldy</span>
<span class="dim">Cape Breton, Nova Scotia. He finds better ways to solve the problems people have learned to work around.</span>
<span><a href="https://fakkeldy.ca/">See his other work at fakkeldy.ca</a></span>
<span><a id="coffee" href="${COFFEE_URL}" rel="noopener">${COFFEE_TEXT}</a></span>
</div>
</section>
<section aria-labelledby="contact">
<span class="label">Contact</span>
<h2 id="contact">Something wrong?</h2>
<p>A road in the wrong place, or you want a place removed? Write to <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<p class="dim">No ads and no accounts. Your settings stay in your own browser. When you drive with others, the server passes car positions between players. A room retains its current race course, player IDs, checkpoint progress and times until the last driver leaves. It keeps no position history.</p>
${brand === 'mail' ? `<p class="dim" id="boardData">Today’s board keeps only what you post with <b>Post my result</b> at the end of Today’s run: the name you chose, your points, discipline step, time, bingo squares and vehicle, and a number your device makes from its own random secret for that one board, so a device posts once a day. The number for one day cannot be matched to the number for another (the name you choose can, if you keep it). That number stays with the day’s board even if your row drops out of the top 100. No account, no email and no network address. Each day’s board keeps its top 100, and the whole board is deleted after 60 days.</p>\n` : ''}</section>
<h2 id="credits">Credits and data</h2>
<details open class="credits" aria-labelledby="credits"><summary>Sources and licences</summary>
${LAND_CREDITS}
${FAR_CREDITS}
${PUBLIC_MUSIC_CREDIT}
${ENGINE_CREDIT}
<p>Property lines (optional, online only): ${PROPERTY_ATTRIBUTION} <a href="${PROPERTY_LICENSE_URL}" rel="noopener noreferrer">Licence</a></p>
</details>
<p class="signoff">${brand === 'just' ? 'I made these roads for a slow drive. Take your time.' : 'Mail service. More or less.'}</p>`;

const PAGES = {
  mail: {
    title: 'About Mabou Mail Madness',
    description: 'A driving game about a rural mail route around Mabou, Cape Breton, on the real roads. Who made it and how.',
    picture: ['mail.jpg', 'The mail car after a short cut across a lawn. The parcels did not stay on the seat.', '50% 44%'],  // the car sits about 40% of the way down; keep it above the title on wide, short screens
    body: `<p class="kicker">A driving game · Mabou, Cape Breton</p>
<h1>Mabou <span>Mail</span> Madness</h1>
<p class="lead">A rural mail route you cannot win, on the real roads around Mabou. The madness is only a little exaggerated.</p>
<p><b>Two games, one island.</b> Mabou Mail Madness gives you a mail route. <a href="https://justdrive.fakkeldy.ca/">Just Drive</a> has every area, no mail.</p>
<div class="actions"><a class="button" href="/">Start the shift</a><a class="button second" href="https://justdrive.fakkeldy.ca/mabou">Just drive instead</a></div><p class="actionCaption">Free. No download.</p>
<section aria-labelledby="game">
<span class="label">The game</span>
<h2 id="game">Deliver the day’s run</h2>
<p>Washboard gravel, mailboxes at the ends of long lanes, a dog who chases the car and a cat who sleeps in the middle of the road. Stay off the lawns and keep the complaints down. Somebody will phone the post office anyway.</p>
<ul role="list" class="features">
<li><b>Complaints and a camera</b><span>Customers phone in. A photo you took first is your defence.</span></li>
<li><b>A bladder gauge</b><span>There is no washroom on the route. Look for houses first.</span></li>
<li><b>A car radio</b><span>Dan’s own songs, Bach on piano, and songs about the places. <a id="listen" href="${LISTEN_URL.mail}">${LISTEN_TEXT}</a>.</span></li>
<li><b>Ways out</b><span>A few hidden ways to quit the route for a different job. Find them.</span></li>
</ul>
<p class="note" style="margin-top:20px">A work of satire. The land, the roads and the mapped buildings are real. The mine site and the interiors are fictional. The customers, the complaints, the animals’ opinions and the boss are invented. Not affiliated with any postal service.</p>
</section>
${MADE('mail')}`,
  },
  just: {
    title: 'About Just Drive',
    description: 'Drive the real land of Cape Breton, built from public survey data. No missions and no clock. Who made it and how.',
    picture: ['road.jpg', 'The shore road near Mabou, in the game.'],
    body: `<p class="kicker">Real land · Cape Breton, Nova Scotia</p>
<h1>Just Drive</h1>
<p class="lead">Drive the real land of Cape Breton. No missions and no clock: choose a place, choose a car or a dirt bike, and go.</p>
<p><b>Two games, one island.</b> Just Drive has every area, no mail. <a href="https://mmm.fakkeldy.ca/">Mabou Mail Madness</a> is the same land, with a mail route.</p>
<div class="actions"><a class="button" href="/mabou">Start in Mabou</a><a class="button second" href="#places">Choose a place</a></div><p class="actionCaption">Free. No download.</p>
<section aria-labelledby="places">
<span class="label">Places</span>
<h2 id="places">Where you can drive</h2>
<p class="dim">Each place is its own piece of real land, with its own roads, shore and villages.</p>
<ul role="list" class="places">${AREAS.map(a => `<li><a href="/${a.id}">${a.name}</a></li>`).join('')}</ul>
</section>
<section aria-labelledby="inside">
<span class="label">What is in it</span>
<h2 id="inside">The land at your own pace</h2>
<ul role="list" class="features">
<li><b>Real ground</b><span>Hills, valleys, cliffs, rivers and beaches, measured from the air.</span></li>
<li><b>Places to find</b><span>Open PLACES for parks, beaches, bridges and the old rail trail.</span></li>
<li><b>Car or dirt bike</b><span>Take the roads, or take the bike where the roads stop.</span></li>
<li><b>Drive with others</b><span>Share a room link and see your friends’ cars on the same land.</span></li>
<li><b>A car radio</b><span>Several stations, from Bach on piano to songs about the places. <a id="listen" href="${LISTEN_URL.just}">${LISTEN_TEXT}</a>.</span></li>
<li><b>Works offline</b><span>Add Just Drive: Mabou to your home screen, and Mabou plays without a connection.</span></li>
</ul>
<figure class="inline-picture"><img src="/about/img/village.jpg" alt="A white church with a tall spire above a still harbour, with autumn trees on the hills behind." loading="lazy" width="1080" height="1440"><figcaption>Mabou village across the harbour, in the game.</figcaption></figure>
<p class="note" style="margin-top:20px">A toy for getting a feel for the place. It is not a map for navigation or for safety. Roads and trails can differ on the day.</p>
</section>
${MADE('just')}`,
  },
};

// ---- Help ----
const html = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
/** One control table, rows exactly as the title card shows them. */
const table = (heading, rows) => `<div><h3>${heading}</h3><dl>${rows.map(([key, what]) => `<div class="row"><dt>${/touch screen|controller/i.test(heading) ? `<b>${html(key.replace("W A S D", "WASD"))}</b>` : keyCaps(key.replace("W A S D", "WASD"), html)}</dt><dd>${html(what)}</dd></div>`).join('')}</dl></div>`;
const qa = items => `<ul role="list" class="qa">${items.map(([q, a]) => `<li><b>${q}</b><span>${a}</span></li>`).join('')}</ul>`;

const SETTINGS = (brand) => qa([
  ['Picture', 'Sharp, Balanced or Fast. Fast draws fewer pixels, for more frames a second. On a computer, the game measures once at your first visit and picks one. It is not shown when every choice gives the same picture, or with Low detail on.'],
  ['Full detail (phone) or Low detail (computer)', 'Full detail gives a phone or tablet sharper land, shadows and reflections; it needs a fast device. Low detail gives a slow computer a simpler picture. The page loads again.'],
  ['Grass, Shadows, Water reflections', 'On a computer, or a phone with Full detail. Turn these off for more speed.'],
  ['Hill height', '1.0 is true scale; the game starts at 1.5, for drama. Trees and buildings keep their real height.'],
  ...(brand === 'mail' ? [['Throw help', 'On at the start. Aims the throw for you; on a phone it also lights the MAIL button when a box is in reach.'], ['END SHIFT', 'END SHIFT is in the settings and on the pause card; or press Enter.'], ['Start over from day 1', 'Clears your career. Your settings stay.']] : []),
  ['Property lines', 'Optional, online only. Shows the province’s property lines on the small map. The game asks you first.'],
  ['Offline play', 'Download for offline play keeps Mabou on this device, so it works without the internet.'],
]);

const TROUBLE = (brand) => qa([
  ['The game is slow or jumpy', 'Open ⚙ and choose Picture: Fast, if it is there. On a computer, turn off Shadows, Water reflections and Grass; if it is still slow, turn on Low detail. On a phone, leave Full detail off. If the Graphics line says “software drawing”, turn on hardware acceleration in your browser’s settings.'],
  ['I am stuck, upside down or off the map', `Press <kbd>R</kbd>, or tap RESET. You go back on the road.`],
  ['There is no sound', 'Tap the screen or press a key once: browsers start sound only after a tap. Turn the volume up, and check that the phone is not on silent. The radio is <kbd>T</kbd> or RADIO.'],
  ['“A new version of the game is ready”', 'Close the game and open it again to get the new version.'],
  ['The game does not start', 'The game needs WebGL. Use a current Safari, Chrome, Edge or Firefox, and turn on hardware acceleration.'],
  ['A road or a place is wrong', `Write to <a href="mailto:${CONTACT}">${CONTACT}</a>. You can also ask for a place to be taken out.`],
]);

const HELP = {
  mail: {
    title: 'Help: Mabou Mail Madness',
    description: 'How to play Mabou Mail Madness: controls, the shift, settings, offline play and what to do when something goes wrong.',
    body: () => `<p class="kicker">Mabou Mail Madness</p>
<h1>Help</h1>
<p class="lead">How to deliver the day’s run, and what to do when the day goes wrong.</p>
<ul role="list" class="toc" id="contents"><li><a href="#shift">The shift</a></li><li><a href="#controls">Controls</a></li><li><a href="#settings">Settings</a></li><li><a href="#offline">Offline</a></li><li><a href="#others">Drive with others</a></li><li><a href="#trouble">Problems</a></li></ul>
<section aria-labelledby="shift">
<span class="label">How to play</span>
<h2 id="shift">The shift</h2>
<ol role="list" class="steps">
<li><b>Start the shift.</b> <span class="dim">The title card shows the controls. Press the start button.</span></li>
<li><b>Deliver the mail.</b> <span class="dim">Drive to each box and throw the mail from the driver’s window, on the right: <kbd>M</kbd> or <kbd>E</kbd>, or tap MAIL.</span></li>
<li><b>Stay off the lawns.</b> <span class="dim">Customers phone in. A photo taken before the damage is your only defence: <kbd>C</kbd> or CAMERA.</span></li>
<li><b>Mind the gauge.</b> <span class="dim">There is no washroom on the route. When the gauge says so, stop and step out (<kbd>B</kbd> or tap the gauge). Look for houses first.</span></li>
<li><b>End the shift.</b> <span class="dim">END SHIFT is in the settings and on the pause card; or press Enter. Read the calls.</span></li>
</ol>
<p>Prefer no mail at all? Choose <b>Just drive</b> on the title card, or go to <a href="https://justdrive.fakkeldy.ca/mabou">Just Drive</a>.</p>
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
<section aria-labelledby="controls">
<span class="label">Controls</span>
<h2 id="controls">Keys and buttons</h2>
<div class="controls">${table('Keyboard', KEYS)}${table('Touch screen', TOUCH)}${table('Controller', padKeys('car', true))}</div>
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
${COMMON('mail')}`,
  },
  just: {
    title: 'Help: Just Drive',
    description: 'How to play Just Drive: controls for the car and the dirt bike, places, settings, offline play and what to do when something goes wrong.',
    body: () => `<p class="kicker">Just Drive</p>
<h1>Help</h1>
<p class="lead">How to drive, find places and get the best picture from your device.</p>
<ul role="list" class="toc" id="contents"><li><a href="#start">Start</a></li><li><a href="#controls">Controls</a></li><li><a href="#settings">Settings</a></li><li><a href="#offline">Offline</a></li><li><a href="#others">Drive with others</a></li><li><a href="#trouble">Problems</a></li></ul>
<section aria-labelledby="start">
<span class="label">Start</span>
<h2 id="start">Choose a place and go</h2>
<ol role="list" class="steps">
<li><b>Choose a place.</b> <span class="dim">${AREAS.map(a => `<a href="/${a.id}">${a.name}</a>`).join(', ')}.</span></li>
<li><b>Choose a ride.</b> <span class="dim">Car or Dirt bike, on the title card.</span></li>
<li><b>Start driving.</b> <span class="dim">In Mabou, Judique and West Bay, open PLACES (<kbd>L</kbd>) for a list of places to see. Choose one to go straight there. The other places have no list yet: just drive.</span></li>
</ol>
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
<section aria-labelledby="controls">
<span class="label">Controls</span>
<h2 id="controls">Keys and buttons</h2>
<div class="controls">${table('Car · keyboard', DRIVING_KEYS)}${table('Car · touch screen', DRIVING_TOUCH)}${table('Dirt bike · keyboard', bikeKeys(false))}${table('Dirt bike · touch screen', bikeKeys(true))}${table('Car · controller', padKeys('car', false))}${table('Dirt bike · controller', padKeys('bike', false))}</div>
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
${COMMON('just')}`,
  },
};

const COMMON = (brand) => `<section aria-labelledby="settings">
<span class="label">Settings</span>
<h2 id="settings">The ⚙ button</h2>
<p class="dim">Your choices are saved in this browser only.</p>
${SETTINGS(brand)}
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
<section aria-labelledby="offline">
<span class="label">Offline</span>
<h2 id="offline">Play without the internet</h2>
<ol role="list" class="steps">
<li><b>Add it to your home screen.</b> <span class="dim">iPhone: Share, then Add to Home Screen. Android: the browser menu, then Install or Add to Home screen.</span></li>
<li><b>Download.</b> <span class="dim">In ⚙, under Play Mabou without internet, press Download for offline play.</span></li>
<li><b>Play.</b> <span class="dim">Mabou now works without a connection. The other places need the internet.</span></li>
</ol>
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
<section aria-labelledby="others">
<span class="label">Together</span>
<h2 id="others">Drive with others</h2>
<ol role="list" class="steps">
<li>Turn on <b>Drive with others</b>, then start.</li>
<li>Choose <b>Open road</b> or <b>Private room</b>.</li>
<li>For a private room, press <b>Copy invitation link</b> and send the link.</li>
<li>The host opens <b>Room race</b> and picks a course.</li>
<li>Drive to the gold start ring and stop inside it before the host presses <b>Start</b>.</li>
<li>Stay inside until GO, then visit each gold checkpoint in order.</li>
</ol>
<p class="dim">Drive with others is on the title card. Open road meets anyone on the same land; Private room is for friends only. Courses are short road courses. The first driver with race support is the room host. The countdown lasts five seconds. Times use the room clock and include network delay. Late arrivals spectate until the next race. A reset or leaving the start early marks you out. Races time out after ten minutes; the host can clear the race and pick another course. If the host leaves, the race clears and another driver becomes host. The room retains its current race course, player IDs, progress and times until the last driver leaves. It keeps no position history.</p>
<p class="totop"><a href="#contents">Back to top</a></p>
</section>
<section aria-labelledby="trouble">
<span class="label">Problems</span>
<h2 id="trouble">When something goes wrong</h2>
${TROUBLE(brand)}
<p class="totop"><a href="#contents">Back to top</a></p>
</section>`;

export function helpPage(brand) {
  const page = HELP[brand];
  return shell(brand, { ...page, body: page.body(), url: HELP_URL[brand] });
}

/** The frame both page kinds share. `picture` puts a tall game picture beside (desktop) or above (phone) the text; `focus` is the
 * part of it that must stay in view when a wide frame crops it (CSS object-position; default 50% 70%). */
function shell(brand, { title, description, url, picture, caption, focus, body }) {
  const origin = new URL(url).origin, other = url === ABOUT_URL[brand] ? ['Help', '/help'] : ['About', '/about'];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${description}">
<meta name="theme-color" content="#0b1620">
<link rel="icon" href="${brand === 'just' ? justIcon : mailIcon}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/about/img/${picture ?? (brand === 'just' ? 'road.jpg' : 'mail.jpg')}">
<script src="/about/page-links.js" defer></script>
<style>${CSS}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}</style>
</head>
<body class="${brand}">
<div class="page${picture ? '' : ' plain'}">
${picture ? `<figure class="picture" style="margin:0"><img src="/about/img/${picture}" alt="" width="1080" height="1440"${focus ? ` style="object-position:${focus}"` : ''}><figcaption>${caption}</figcaption></figure>\n` : ''}<main class="text">
${body}
<footer><span>© ${new Date().getFullYear()} Dan Fakkeldy</span><a href="${brand === 'just' ? '/mabou' : '/'}">Play</a><a href="${other[1]}">${other[0]}</a><a href="/changes/">What's new</a><a href="${LISTEN_URL[brand]}">Just Listen</a><a href="https://fakkeldy.ca/">fakkeldy.ca</a><a href="mailto:${CONTACT}">${CONTACT}</a></footer>
</main>
</div>
</body>
</html>
`;
}

export function aboutPage(brand) {
  const page = PAGES[brand];
  const [picture, caption, focus] = page.picture;
  return shell(brand, { ...page, url: ABOUT_URL[brand], picture, caption, focus });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const site = resolve(process.argv[2] ?? '');
  if (!process.argv[2]) { console.error('usage: node tools/about-pages.mjs <site folder>'); process.exit(2); }
  mkdirSync(`${site}/about/img`, { recursive: true });
  copyFileSync(new URL('./page-links.js', import.meta.url), `${site}/about/page-links.js`);
  for (const name of PICTURES) copyFileSync(new URL(`../assets/about/${name}`, import.meta.url), `${site}/about/img/${name}`);
  for (const brand of ['mail', 'just']) {
    mkdirSync(`${site}/about/${brand}`, { recursive: true });
    writeFileSync(`${site}/about/${brand}/index.html`, aboutPage(brand));
    mkdirSync(`${site}/help/${brand}`, { recursive: true });
    writeFileSync(`${site}/help/${brand}/index.html`, helpPage(brand));
  }
  console.log('about and help: mail, just');
}
