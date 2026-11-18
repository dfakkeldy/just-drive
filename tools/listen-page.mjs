// Just Listen: the radio-only page of the public site, at /listen/ on both hosts. Its script is web/src/listen.ts.
// Usage: node tools/listen-page.mjs <site folder>. Writes listen/index.html and listen/icon-{180,192,512}.png.
// The page is one file: its style and its script are inside it, so a phone paints it after one request. It then asks
// for the station list (audio/radio.json, the car radio's own) and for one song. It loads no land and no game.
// The pictures are copies of the site's own icons (tools/pwa-icons.py): the lock screen shows one beside the title.
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const SRC = fileURLToPath(new URL('../web/src', import.meta.url));
export const LISTEN_ICONS = [180, 192, 512];

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230b1014'/%3E%3Crect x='9' y='20' width='46' height='26' rx='5' fill='%2316191d' stroke='%23ffb23f' stroke-width='3'/%3E%3Cpath d='M16 33h22' stroke='%23ffb23f' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M30 26v14' stroke='%23ff5a36' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='46' cy='33' r='5' fill='%23ffb23f'/%3E%3C/svg%3E";

const CSS = `
:root{color-scheme:dark;--dash:#0b1014;--plate:#171b20;--edge:#2c323a;--key:#1f242a;--key-top:#2a3038;--ink:#ece8de;--dim:#9aa3ab;--quiet:#8e979f;
 --amber:#ffb23f;--amber-soft:#ffd89a;--amber-low:#c58a2e;--amber-dim:#9a6a1e;--glass:#130e06;--needle:#ff5a36;--line:#262c33;--card:#11161b;
 --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--dash)}
body{margin:0;min-height:100vh;min-height:100dvh;background:radial-gradient(120% 70% at 50% 0,#1b252e 0,var(--dash) 62%) no-repeat var(--dash);color:var(--ink);
 font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
 padding:max(14px,env(safe-area-inset-top,0px)) max(14px,env(safe-area-inset-right,0px)) max(28px,env(safe-area-inset-bottom,0px)) max(14px,env(safe-area-inset-left,0px))}
[hidden]{display:none!important}
button{font:inherit;color:inherit;margin:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
a{color:var(--amber-soft);text-underline-offset:3px}
:focus-visible{outline:2px solid #fff;outline-offset:2px;border-radius:6px}
.dash{display:grid;gap:16px;max-width:560px;margin:0 auto}
.side{display:grid;gap:16px;min-width:0}

/* The head unit. */
.unit{min-width:0;padding:12px 14px 14px;border:1px solid var(--edge);border-radius:18px;
 background:linear-gradient(180deg,#1d2228 0,var(--plate) 22%,#12161a 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 40px rgba(0,0,0,.45)}
.brand{display:flex;align-items:center;gap:10px;margin:0 2px 10px;font:700 12px/1 var(--mono);letter-spacing:.24em;color:var(--dim)}
.brand h1{margin:0;font:inherit;color:var(--ink)}
.brand span{margin-left:auto;letter-spacing:.14em;font-weight:500;color:var(--quiet)}
.lamp{flex:none;width:8px;height:8px;border-radius:50%;background:#3a2a10;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
[data-state=sound] .lamp{background:var(--amber);box-shadow:0 0 10px var(--amber)}
[data-state=tuning] .lamp{background:var(--amber);animation:blink .7s steps(2,start) infinite}
@keyframes blink{to{visibility:hidden}}

.glass{position:relative;padding:12px 12px 8px;border:1px solid #000;border-radius:12px;color:var(--amber);
 background:linear-gradient(180deg,#1c1407 0,var(--glass) 55%,#0c0803 100%);box-shadow:inset 0 2px 14px rgba(0,0,0,.8),inset 0 0 0 1px rgba(255,178,63,.06);
 text-shadow:0 0 14px rgba(255,178,63,.32)}
.tuned{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;row-gap:2px}
.dial{font:700 clamp(46px,16vw,72px)/.95 var(--mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.fm{font:700 13px/1 var(--mono);letter-spacing:.14em;color:var(--amber-low);text-shadow:none}
.name{flex:1 1 100%;min-width:0;font:700 clamp(15px,4.4vw,19px)/1.25 var(--mono);letter-spacing:.09em;overflow-wrap:anywhere}
.now{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:4px 10px;margin:10px 0 0}
.state{grid-column:1;font:700 11px/1.3 var(--mono);letter-spacing:.16em;color:var(--amber-low);text-shadow:none}
.title{grid-column:1/-1;margin:0;min-height:2.6em;font:600 18px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--amber-soft);
 display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
#live{grid-column:2;grid-row:1;min-height:24px;padding:0 8px;border:1px solid var(--amber-dim);border-radius:99px;background:transparent;
 font:700 11px/1 var(--mono);letter-spacing:.12em;color:var(--amber-low);cursor:pointer;position:relative}
#live::after{content:"";position:absolute;inset:-12px -8px}
#live[aria-pressed=true]{color:#1a1206;background:var(--amber);border-color:var(--amber);text-shadow:none}
[data-state=silent] #live[aria-pressed=true]{color:var(--amber-low);background:transparent;border-color:var(--amber-dim)}
.progress{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;margin-top:8px;font:500 11px/1 var(--mono);color:var(--amber-low);text-shadow:none}
.progress div{height:3px;border-radius:2px;background:rgba(255,178,63,.16);overflow:hidden}
.progress i{display:block;height:100%;width:0;background:var(--amber)}
.next{display:flex;gap:8px;margin:8px 0 0;font:500 13px/1.3 system-ui,sans-serif;color:var(--amber-low);text-shadow:none}
.next b{flex:none;font:700 11px/1.5 var(--mono);letter-spacing:.16em}
.next span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#c99445}

/* The dial's scale: a tick at each megahertz, a mark at each station, and the needle. */
.band{position:relative;height:44px;margin:10px 4px 0;cursor:pointer;text-shadow:none}
.band svg{position:absolute;inset:0 0 auto 0;width:100%;height:18px;overflow:visible}
.band line{stroke:var(--amber-dim);stroke-width:1;vector-effect:non-scaling-stroke}
.band .num{position:absolute;top:21px;transform:translateX(-50%);font:500 10px/1 var(--mono);color:var(--amber-low)}
.band .mark{position:absolute;top:0;width:7px;height:7px;margin:-1px 0 0 -3.5px;border-radius:50%;background:var(--amber-dim)}
.band .mark.on{background:var(--amber);box-shadow:0 0 8px var(--amber)}
.needle{position:absolute;top:-4px;bottom:6px;left:50%;width:2px;margin-left:-1px;border-radius:1px;background:var(--needle);box-shadow:0 0 8px var(--needle);transition:left .38s cubic-bezier(.3,1.3,.5,1)}

.keys{display:flex;align-items:center;justify-content:center;gap:18px;margin:14px 0 12px}
.key,.preset{border:1px solid #0a0c0e;border-radius:10px;background:linear-gradient(180deg,var(--key-top),var(--key));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 0 #06080a;cursor:pointer;user-select:none;-webkit-user-select:none}
.key:active,.preset:active{transform:translateY(1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 1px 0 #06080a}
.key{display:grid;place-items:center;width:60px;height:52px}
.key svg{width:20px;height:20px;fill:var(--ink)}
#play{width:76px;height:76px;border-radius:50%;border-color:#07090b;background:radial-gradient(circle at 50% 30%,#3a424c 0,#20262c 62%,#161a1f 100%);
 box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 0 0 4px #0e1114,0 0 0 5px var(--edge),0 6px 14px rgba(0,0,0,.5)}
#play svg{width:28px;height:28px;fill:var(--amber)}
#play .pause,#play[aria-pressed=true] .go{display:none}
#play[aria-pressed=true] .pause{display:block}
.presets{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px}
.preset{display:grid;align-content:center;gap:2px;min-height:54px;padding:6px 10px;text-align:left;position:relative}
.preset b{font:700 16px/1.1 var(--mono);color:var(--ink);font-variant-numeric:tabular-nums}
.preset span{font:600 10.5px/1.25 var(--mono);letter-spacing:.06em;color:var(--dim);overflow-wrap:anywhere}
.preset[aria-pressed=true]{border-color:var(--amber-dim);box-shadow:inset 0 0 0 1px rgba(255,178,63,.35),inset 0 0 18px rgba(255,178,63,.12),0 2px 0 #06080a}
.preset[aria-pressed=true] b{color:var(--amber)}
.volume{display:flex;align-items:center;gap:12px;margin:12px 2px 0;font:700 11px/1 var(--mono);letter-spacing:.16em;color:var(--dim)}
.volume input{flex:1;min-width:0;accent-color:var(--amber)}

/* Below the unit: the programme, the credits and the ways on. */
.card{min-width:0;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.card h2,summary{margin:0;font:700 12px/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
summary{display:flex;align-items:center;gap:8px;min-height:44px;margin:-10px 0;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";margin-left:auto;font-size:18px;color:var(--amber)}
details[open] summary::after{content:"−"}
summary span{color:var(--amber-soft);letter-spacing:.06em;text-transform:none;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hint{margin:14px 0 6px;font-size:14px;color:var(--dim)}
#programme{margin:0;padding:0;list-style:none;max-height:min(62vh,440px);overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--line)}
#programme button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:44px;padding:8px 2px;border:0;border-bottom:1px solid var(--line);
 background:none;text-align:left;font-size:15px;line-height:1.3;cursor:pointer}
#programme span{min-width:0;overflow-wrap:anywhere}
#programme time{flex:none;font:500 12px/1 var(--mono);color:var(--quiet)}
#programme [aria-current] span{color:var(--amber)}
#programme [aria-current] span::before{content:"▸ "}
.credits p{margin:8px 0 0;font-size:14px;line-height:1.55;color:var(--dim)}
.ways{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:10px}
.way{display:grid;gap:2px;min-height:64px;align-content:center;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);text-decoration:none;font-weight:700}
.way span{font-weight:400;font-size:14px;color:var(--dim)}
.way:hover{border-color:var(--amber-dim)}
.foot{display:flex;flex-wrap:wrap;gap:6px 20px;margin:0;font-size:15px}
.foot a{display:inline-flex;align-items:center;min-height:44px}

/* A phone on its side: the display on the left, the keys on the right. */
@media (orientation:landscape) and (max-height:520px){
 .dash{max-width:920px}
 .unit{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);column-gap:14px;align-items:start;padding:10px 12px 12px}
 .brand{grid-column:1/-1;margin-bottom:8px}
 .glass{grid-row:2/span 3;padding:10px 12px 6px}
 .dial{font-size:clamp(38px,14vh,54px)}
 .name{font-size:15px}
 .now{margin-top:6px}.title{font-size:16px}
 .band{height:36px;margin-top:8px}
 .keys{margin:0 0 10px;gap:12px}.key{height:46px}#play{width:62px;height:62px}
 .preset{min-height:44px;padding:4px 10px}
 .presets{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px}
 .volume{margin-top:8px}
}
/* A wide window: the unit stays in view beside the lists. */
@media (min-width:980px) and (min-height:521px){
 .dash{max-width:1010px;grid-template-columns:minmax(0,540px) minmax(0,420px);gap:28px;justify-content:center;align-items:start;padding-top:24px}
 .unit{position:sticky;top:24px}
}
@media (prefers-reduced-motion:reduce){.needle{transition:none}[data-state=tuning] .lamp{animation:none}}
`;

const escapeScript = (code) => code.replaceAll('</script', '<\\/script');

/** The page, as one HTML file. */
export async function listenPage() {
  // The credit strings come from the game's own source, as on the About pages.
  const text = await build({ stdin: { contents: "export * from './credits'; export { PUBLIC_MUSIC_CREDIT } from './radio-credits.generated';", resolveDir: SRC, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  const { ABOUT_URL, COFFEE_URL, COFFEE_TEXT, LISTEN_URL, PUBLIC_MUSIC_CREDIT } = await import('data:text/javascript;base64,' + Buffer.from(text.outputFiles[0].text).toString('base64'));
  const script = await build({ entryPoints: [resolve(SRC, 'listen.ts')], bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', legalComments: 'none' });
  const title = 'Just Listen: the radio from Mabou Mail Madness', description = 'The car radio from Mabou Mail Madness and Just Drive, alone. Choose a station and listen. There is no game to load.';
  const tri = (points) => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${points}"/></svg>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${description}">
<meta name="theme-color" content="#0b1014">
<link rel="icon" href="${ICON}">
<link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">
<link rel="canonical" href="${LISTEN_URL.mail}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${LISTEN_URL.mail}">
<meta property="og:image" content="${new URL('icon-512.png', LISTEN_URL.mail).href}">
<style>${CSS}</style>
</head>
<body>
<div class="dash">
<main id="unit" class="unit" data-state="silent">
<div class="brand"><i class="lamp" aria-hidden="true"></i><h1>JUST LISTEN</h1><span>FM · MABOU</span></div>
<section class="glass" aria-label="Now on the radio">
<div class="tuned"><span id="dial" class="dial">--.-</span><span class="fm">FM</span><span id="name" class="name">&nbsp;</span></div>
<div class="now"><span id="state" class="state">TUNING…</span><button id="live" type="button" aria-pressed="true">LIVE</button><p id="title" class="title" aria-live="polite">Finding the stations…</p></div>
<div class="progress"><time id="timeNow">0:00</time><div><i id="bar"></i></div><time id="timeAll">0:00</time></div>
<p class="next"><b>NEXT</b><span id="next"></span></p>
<div id="band" class="band" aria-hidden="true"><i id="needle" class="needle"></i></div>
</section>
<div class="keys">
<button id="down" class="key" type="button" aria-label="Station down">${tri('M13 3 5 10l8 7z')}</button>
<button id="play" class="key" type="button" aria-label="Play the radio" aria-pressed="false"><svg class="go" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg><svg class="pause" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 3.5h4v13h-4zM11.5 3.5h4v13h-4z"/></svg></button>
<button id="up" class="key" type="button" aria-label="Station up">${tri('M7 3l8 7-8 7z')}</button>
</div>
<div id="presets" class="presets" role="group" aria-label="Stations"></div>
<label id="volumeRow" class="volume">VOLUME <input id="volume" type="range" min="0" max="1" step="0.05" value="0.7"></label>
</main>
<div class="side">
<details class="card">
<summary>Programme <span id="programmeName"></span></summary>
<p class="hint">Choose a piece to hear it from its start. LIVE goes back to what is on the air now.</p>
<ol id="programme"></ol>
</details>
<section class="card credits" aria-labelledby="creditsHead">
<h2 id="creditsHead">Credits</h2>
${PUBLIC_MUSIC_CREDIT.replace(' id="titleMusic"', ' id="listenMusic"')}
<p>This is the car radio from two driving games on the real land of Cape Breton. The page and a car in the game play the same thing at the same moment.</p>
</section>
<nav class="ways" aria-label="The games">
<a class="way" href="https://mmm.fakkeldy.ca/">Mabou Mail Madness<span>A rural mail route you cannot win.</span></a>
<a class="way" href="https://justdrive.fakkeldy.ca/mabou">Just Drive<span>The same land, no mail and no clock.</span></a>
</nav>
<p class="foot"><a id="coffee" href="${COFFEE_URL}" rel="noopener">${COFFEE_TEXT}</a><a href="${ABOUT_URL.mail}">About: who made it and how</a></p>
</div>
</div>
<noscript><p style="max-width:560px;margin:16px auto;color:#ece8de">The radio needs JavaScript to play.</p></noscript>
<script type="module">${escapeScript(script.outputFiles[0].text)}</script>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (!process.argv[2]) { console.error('usage: node tools/listen-page.mjs <site folder>'); process.exit(2); }
  const site = resolve(process.argv[2]);
  const missing = LISTEN_ICONS.map(size => `${site}/offline/icons/icon-${size}.png`).filter(file => !existsSync(file));
  if (missing.length) { console.error(`listen: the site has no icons yet (${missing[0]}); run tools/pwa-icons.py first`); process.exit(1); }
  const page = await listenPage();
  mkdirSync(`${site}/listen`, { recursive: true });
  for (const size of LISTEN_ICONS) copyFileSync(`${site}/offline/icons/icon-${size}.png`, `${site}/listen/icon-${size}.png`);
  writeFileSync(`${site}/listen/index.html`, page);
  console.log(`listen: ${Buffer.byteLength(page)} bytes`);
}
