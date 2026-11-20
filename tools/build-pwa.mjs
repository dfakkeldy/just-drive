import { mkdirSync } from 'node:fs';
import { justPage } from './site-pages.mjs';
import { AREAS } from '../web/src/area.ts';
import { HISTORY_AREAS } from '../web/src/eras/history-areas.ts';
// Finish one immutable shell and the content inventory. Never modifies hard-linked inputs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync as read, writeFileSync as write, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkPreloads, normalizedPage } from './pwa-shell.mjs';
import { offlineModel } from './offline-models.mjs';
const site = resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const file = url => { const b = read(site + url); return { url, bytes: b.length, hash: hash(b) }; };
function build(just = false) {
const files = [];
function walk(dir, keep = () => true) { for (const e of readdirSync(site + dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (statSync(site+p).isDirectory()) walk(p, keep); else if (keep(e.name)) files.push(file(p)); } }
// Approved first release: Mabou terrain/coast and models plus the shared radio. Other areas remain online-only.
walk('/terrain');
// The models belong to the same game: offline, a place must not lose what stands on it. A model that is an
// option and is off (the mail car's, see offline-models.mjs) stays on the network: offline, the game uses its fallback.
const carSwitch = read(new URL('../web/src/car-switch.ts', import.meta.url), 'utf8');
try { walk('/models', name => offlineModel(name, carSwitch)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
try {
  if (!just) walk('/audio');
  else {
    // Same catalogue as mail, separate start dial and saved settings. Cache every listed track.
    const list = JSON.parse(read(site + '/audio/radio-just.json', 'utf8'));
    files.push(file('/audio/radio-just.json'));
    for (const name of new Set((list.stations ?? []).flatMap(station => (station.tracks ?? []).map(track => track.file)))) {
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+\.mp3$/.test(name)) throw Error('Invalid Just Drive song file.');
      files.push(file('/audio/' + name));
    }
  }
} catch (e) { if (e.code !== 'ENOENT') throw e; }
files.sort((a,b) => a.url.localeCompare(b.url));
const dataRevision = hash(JSON.stringify(files));
const builtAt = Date.now(); // Included in immutable addresses: an old tab cannot make an older build newest.
const app = read(site + '/app.js');
const appUrl = `/offline/app.${hash(app)}.js`; write(site + appUrl, app);
// The code each import() loads (web/area-chunks-build.ts). Their names carry a content hash, and app.js imports them by
// a relative name, so the offline copy of app.js finds the same files in /offline/chunks/. All of them go into the
// offline shell: an offline start may take any branch the online one can.
const chunks = existsSync(site + '/chunks') ? readdirSync(site + '/chunks').filter(name => name.endsWith('.js')).sort() : [];
const chunkUrls = chunks.map(name => `/offline/chunks/${name}`);
if (chunks.length) mkdirSync(site + '/offline/chunks', { recursive: true });
for (const name of chunks) write(site + `/offline/chunks/${name}`, read(site + `/chunks/${name}`));
const preloads = chunkPreloads(app.toString('utf8'), name => read(site + `/chunks/${name}`));
const manifestUrl = just ? '/manifest-just.webmanifest' : '/manifest.webmanifest';
const manifest = { id: '/', name: just ? 'Just Drive: Mabou' : 'Mabou Mail Madness', short_name: just ? 'Just Drive' : 'Mabou Mail', start_url: just ? '/mabou' : '/', scope: '/', display: 'standalone', orientation: 'any', theme_color: '#0b1620', background_color: '#0b1620', description: 'Drive the October hills.', icons: [ { src:'/offline/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'}, {src:'/offline/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/offline/icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}] };
write(site + manifestUrl, JSON.stringify(manifest));
let page = normalizedPage(just ? justPage(originalPage, AREAS[0]) : originalPage,appUrl);
// The chunks app.js imports at its top start with it: the page names them, so they do not wait for app.js to arrive.
page = page.replace('</head>', preloads.map(p => `<link rel="modulepreload" href="/offline/chunks/${p.name}" integrity="${p.integrity}">\n`).join('') + '</head>');
const pageKey = hash(JSON.stringify({ builtAt, page, dataRevision, app:hash(app), chunks:chunkUrls.map(url => file(url).hash), manifest, icons:shellIconHashes() }));
function shellIconHashes() { return ['180','192','512'].map(n=>file(`/offline/icons/icon-${n}.png`).hash).concat(file('/offline/icons/maskable-512.png').hash); }
page = page.replace('</head>', `<link rel="manifest" href="${manifestUrl}">\n<link rel="apple-touch-icon" sizes="180x180" href="/offline/icons/icon-180.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="apple-mobile-web-app-title" content="${just ? 'Just Drive: Mabou' : 'Mabou Mail'}">\n<meta name="mmm-offline-bytes" content="${files.reduce((n,f)=>n+f.bytes,0)}">\n<meta name="mmm-page" content="${pageKey}">\n<meta name="mmm-build" content="${hash(app).slice(0,16)}">\n</head>`);
// The preview includes the saved page, app, manifest and icons as well as terrain and radio.
const dataBytes=files.reduce((n,f)=>n+f.bytes,0);
const iconUrls=[...['180','192','512'].map(n=>`/offline/icons/icon-${n}.png`),'/offline/icons/maskable-512.png'];
const fixedShellBytes=app.length+chunkUrls.reduce((n,url)=>n+file(url).bytes,0)+file(manifestUrl).bytes+iconUrls.reduce((n,url)=>n+file(url).bytes,0);
let previewBytes=0;
for(let pass=0;pass<4;pass++) {
  const next=dataBytes+fixedShellBytes+Buffer.byteLength(page);if(next===previewBytes)break;
  previewBytes=next;page=page.replace(/(<meta name="mmm-offline-bytes" content=")[0-9]+("[>])/,`$1${previewBytes}$2`);
}
const pageUrl = `/offline/page.${hash(page)}.html`; write(site + pageUrl,page); if (!just) write(site + '/index.html',page.replace(`src="${appUrl}"`,`src="/app.js" integrity="sha256-${createHash('sha256').update(app).digest('base64')}"`).replaceAll('<link rel="modulepreload" href="/offline/chunks/','<link rel="modulepreload" href="/chunks/'));
const connectionMeta = Object.fromEntries([...AREAS, null].map(area => [area?.id ?? 'unknown', { title: area ? `Just Drive: ${area.name}` : 'Just Drive', head: justPage('<html><head></head><body></body></html>', area).match(/<head>([\s\S]*?)<\/head>/)[1] }]));
write(site+'/sw.js', `const JUST_AREAS = ${JSON.stringify(['sugar-camp-quarry', ...AREAS.map(area => area.id), ...Object.values(HISTORY_AREAS).map(a => a.address)])};\nconst JUST_ALIASES = ${JSON.stringify({...Object.fromEntries(Object.values(HISTORY_AREAS).map(a => [a.address, a.id])), 'sugar-camp-quarry':'westbay'})};\nconst JUST_META = ${JSON.stringify(connectionMeta)};\n` + read(new URL('../web/pwa/sw.js',import.meta.url), 'utf8'));
const shell = [pageUrl,appUrl,...chunkUrls,manifestUrl,...['180','192','512'].map(s=>`/offline/icons/icon-${s}.png`),'/offline/icons/maskable-512.png'].map(file);
const inventory = { schema:1, offlineArea:'mabou', builtAt, pageKey, page:pageUrl, shell, files, totalBytes: [...shell,...files].reduce((n,f)=>n+f.bytes,0) };
if(inventory.totalBytes!==previewBytes)throw Error('Offline size preview did not settle.');
const encoded = JSON.stringify(inventory), revision = hash(encoded), indexUrl = `/offline/files.${revision}.json`;
write(site+indexUrl, encoded);
const version = { schema:1, revision, dataRevision, pageKey, index:indexUrl, disabled:process.env.OFFLINE_DISABLED==='1' };
write(site+(just ? '/version-just.json' : '/version.json'),JSON.stringify(version));
// This address describes an immutable build; only version.json carries the live kill switch.
write(site+`/offline/start.${pageKey}.json`,JSON.stringify({...version,disabled:false}));
console.log(`offline: ${files.length} data files; ${inventory.totalBytes} bytes; shell ${shell.reduce((n,f)=>n+f.bytes,0)} bytes; inventory ${encoded.length} bytes; worker ${statSync(site+'/sw.js').size} bytes`);

return { pageKey, bytes: previewBytes };
}
const originalPage = read(site + '/index.html', 'utf8');
build();
const just = build(true);
// The root page remains byte-identical across hosts. Each brand binds its own immutable offline shell.
write(site + '/index.html', read(site + '/index.html', 'utf8').replace('</head>', `<meta name="mmm-just-page" content="${just.pageKey}"><meta name="mmm-just-offline-bytes" content="${just.bytes}"></head>`));

// Explicit HTML files for each public place, plus an honest no-script 404 page.
const publicPage = read(site + '/index.html', 'utf8');
for (const area of [...AREAS, null]) {
  const folder = site + '/just/' + (area?.id ?? 'unknown'); mkdirSync(folder, { recursive: true });
  let page = justPage(publicPage, area);
  page = page.replace(/(<meta name="mmm-page" content=")[^"]+("[>])/, `$1${just.pageKey}$2`).replace(/(<meta name="mmm-offline-bytes" content=")[0-9]+("[>])/, `$1${just.bytes}$2`);
  write(folder + '/index.html', page);
}

for (const era of Object.values(HISTORY_AREAS)) {
  const eraFolder = site + '/just/' + era.address; mkdirSync(eraFolder, { recursive: true });
  // Derive it from the finished area shell, retaining the exact same offline binding.
  write(eraFolder + '/index.html', justPage(read(site + '/just/' + era.id + '/index.html', 'utf8'), AREAS.find(a => a.id === era.id), true));
}
