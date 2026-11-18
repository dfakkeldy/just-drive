import { MUSIC_CREDIT as ALL_MUSIC_CREDIT, PUBLIC_MUSIC_CREDIT } from './radio-credits.generated';
import { foundEndings } from './ending';
import { PROPERTY_ATTRIBUTION, PROPERTY_LICENSE_URL } from './property-lines-rules';
import { AREAS } from './area';
import { eraAddress, otherGameAddress, readSite } from './site';
import { TODAY, type Era } from './era';
import { HISTORY_AREAS, eraAreaId, eraDoorText, historyArea } from './eras/history-areas';
import { ABOUT_URL, CHANGES_TEXT, CHANGES_URL, COFFEE_TEXT, COFFEE_URL, CONTACT, ENGINE_CREDIT, HELP_URL, LAND_CREDITS, FAR_CREDITS, LISTEN_TEXT, LISTEN_URL } from './credits';
import { KEYS, TOUCH, DRIVING_KEYS, DRIVING_TOUCH } from './controls';
export { CONTACT } from './credits';
import { EXPLORE_TITLE, chooseMode, type GameMode } from './mode';
import { horseKeys, bikeKeys, vehicleButtons, type VehicleChoice } from './vehicle-choice';

// The first thing a visitor sees: the name, how to drive, and whose data this is.
// Built here in script so the test page and the published page cannot drift apart.

const CSS = `
#title{position:fixed;inset:0;z-index:20;display:grid;place-items:center;overflow:auto;
  padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));
  background:linear-gradient(rgba(8,14,20,.55),rgba(8,14,20,.86));color:var(--ink,#eef2f6);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
#title[hidden]{display:none}
#modeChoice{display:flex;gap:6px;margin:0 0 18px}
#modeChoice button{flex:1;min-height:44px;border:1px solid #6b7780;border-radius:6px;background:transparent;color:var(--ink);font:700 13px system-ui,sans-serif;cursor:pointer;padding:8px}
#modeChoice button[aria-pressed="true"]{background:#31463a;border-color:#a7d9bc}
#modeChoice button:focus-visible{outline:3px solid white;outline-offset:2px}
#titleCard{width:min(100%,560px);background:var(--panel-solid,#0c141c);border:1px solid rgba(238,242,246,.18);border-radius:10px;padding:26px 24px 20px}
#title h1{margin:0;font:800 clamp(30px,8vw,46px)/1.02 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em;text-wrap:balance}
#title h1 span{color:var(--maple,#d0632e)}
#title .tag{font:700 11px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim,#b9c3cc);margin:0 0 10px}
#title p{margin:12px 0 0;color:var(--ink-dim,#b9c3cc)}
#titleOtherGame{display:block;font-size:13px;line-height:1.4;margin-top:8px}
#titleOtherGame a{color:inherit;text-underline-offset:3px}
#titleOtherGame a:focus-visible{outline:3px solid #fff;outline-offset:3px}
#title dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:18px 0 0;font-size:14px}
#title dt{font:700 12px ui-monospace,Menlo,Consolas,monospace;color:var(--ink,#eef2f6);white-space:nowrap}
#title dd{margin:0;color:var(--ink-dim,#b9c3cc)}
#titleStart{margin-top:22px;width:100%;min-height:54px;border:0;border-radius:8px;background:var(--maple,#d0632e);color:#fff;font:800 17px system-ui,sans-serif;cursor:pointer}
#titleStart:focus-visible,#titleCredits:focus-visible{outline:3px solid #fff;outline-offset:3px}
#titleCredits{margin-top:12px;background:none;border:0;color:var(--ink-dim,#b9c3cc);font:13px system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:6px 0}
#titleLegal{font-size:12.5px;line-height:1.55}
#titleLegal[hidden]{display:none}
#titleLegal p{margin:9px 0 0}
#titleLegal a{color:inherit}
/* content-box 100% plus padding overflowed narrow screens on cards without a multiplayer control (1884): */
@media(max-width:719px){#titleCard{box-sizing:border-box}}
@media(min-width:760px){
 #titleCard:has(>#vehicleChoice):has(>.mpControl)>dl,#titleCard:has(>#vehicleChoice)>.mpControl{grid-row:7}
 #titleCard:has(>#vehicleChoice):has(>.mpControl)>#titleStart{grid-row:8}
 #titleCard:has(>#vehicleChoice):has(>.mpControl)>#titleCredits{grid-row:9}
 #titleCard:has(>#vehicleChoice):has(>.mpControl)>#titleLegal{grid-row:10}
}
`;

const JUST_CSS = `
#title.justDrive,#title.justDrive #titleCard{box-sizing:border-box}
@media(max-height:500px) and (min-width:650px){
 #title.justDrive{padding:10px}
 #title.justDrive #titleCard{padding:12px 18px;display:grid;grid-template-columns:1fr 1fr;column-gap:20px;width:min(800px,100%)}
 #title.justDrive #titleCard>*{grid-column:1!important;grid-row:auto!important}
 #title.justDrive #titleCard>dl{grid-column:2!important;grid-row:1/6!important;margin:0;font-size:12px;gap:4px 10px}
 #title.justDrive #titleCard>.mpControl{grid-column:2!important;grid-row:6/9!important;margin:4px 0 0;padding-top:5px}
 #title.justDrive h1{font-size:30px}
 #title.justDrive p{font-size:12px;line-height:1.3;margin:4px 0 0}
 #title.justDrive #titleOtherGame{font-size:12px;line-height:1.3;margin-top:2px}
 #title.justDrive #titleStart{margin-top:6px;min-height:44px}
 #title.justDrive #titleCredits{margin-top:2px;padding:3px}
 #title.justDrive #vehicleChoice{margin-bottom:6px}
 #title.justDrive #titleLegal{grid-column:1/-1!important}
}`;


const CONTACT_LINE = `<p id="titleContact">Something wrong, or you want a place removed? Write to <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`;
const MUSIC_CREDIT = typeof __PUBLIC_APP__ !== 'undefined' && __PUBLIC_APP__ ? PUBLIC_MUSIC_CREDIT : ALL_MUSIC_CREDIT;
const PAVED_CREDIT = `<p id="nsPavedCredit"><a href="https://support.novascotia.ca/services/open-data-portal-licence">Contains information licensed under the Open Government Licence – Nova Scotia</a></p>`;

const LEGAL = `
<p><b>A work of satire.</b> The land, the roads and the mapped buildings are real. The mine site and interiors are fictional. The customers, the complaints, the animals’ opinions and the boss are invented. Not affiliated with any postal service.</p>
${LAND_CREDITS}
${FAR_CREDITS}
${MUSIC_CREDIT}
${ENGINE_CREDIT}
<p>Property lines (optional, online only): ${PROPERTY_ATTRIBUTION} <a href="${PROPERTY_LICENSE_URL}" target="_blank" rel="noopener noreferrer">Licence</a></p>`;

/** Links out to the brand's About and Help pages and to Just Listen (the radio alone), in a new tab, so the game keeps its place. */
const aboutLine = (just: boolean) => `<p id="titleAbout"><a href="${ABOUT_URL[just ? 'just' : 'mail']}" target="_blank" rel="noopener">About ${just ? 'Just Drive' : 'Mabou Mail Madness'}: who made it and how</a> · <a id="titleChanges" href="${CHANGES_URL[just ? 'just' : 'mail']}" target="_blank" rel="noopener">${CHANGES_TEXT}</a> · <a id="titleHelp" href="${HELP_URL[just ? 'just' : 'mail']}" target="_blank" rel="noopener">Help</a> · <a id="titleListen" href="${LISTEN_URL[just ? 'just' : 'mail']}" target="_blank" rel="noopener">${LISTEN_TEXT}</a> · <a id="titleCoffee" href="${COFFEE_URL}" target="_blank" rel="noopener">${COFFEE_TEXT}</a></p>`;

export interface Title { open(): void; setRadio(available: boolean): void }

/**
 * Shows the title card. `onStart` runs each time the player closes it with the button: at the start, and again after
 * reading it mid-shift (a real tap, so sound may begin there later). The caller pauses the game while it is open.
 */
export function createTitle(touch: boolean, onStart: () => void, mode: GameMode = 'mail', areaName?: string, ride?: VehicleChoice, just = false, radio = true, era: Era = TODAY, paved = false): Title {
  // Three cards: the mail game; an area that has no mail game yet (areaName, mail mode); and the driving mode of any area.
  const historical = era.id !== 'today';
  const explore = mode === 'explore', name = era.title ?? (just ? `Just Drive: ${areaName ?? 'Mabou'}` : explore ? (areaName ? `Driving ${areaName}` : EXPLORE_TITLE) : areaName ? `Drive around ${areaName}` : 'Mabou Mail Madness');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS + (just && !historical ? JUST_CSS : '') }));
  const root = document.createElement('div');
  root.id = 'title';
  if (just) root.classList.add('justDrive');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', name);
  const drivingKeys = DRIVING_KEYS, drivingTouch = DRIVING_TOUCH;
  const areaRows = (touch ? TOUCH : KEYS).filter(([key]) => touch ? !['MAIL', 'CAMERA', 'BLADDER', '\u2699'].includes(key) : !['M or E', 'P', 'B', 'Enter'].includes(key)).map(([k, v]): [string, string] => [k, k === 'H' ? 'Horn.' : v]);
  let radioAvailable = radio;
  const rows = (available: boolean) => {
    radioAvailable = available;
  let keys = explore ? (ride?.kind === 'bike' ? bikeKeys(touch) : touch ? drivingTouch : drivingKeys) : areaName ? areaRows : touch ? TOUCH : KEYS;
  if (ride?.kind === 'horse') { keys = horseKeys(touch, !explore && !areaName); available = false; }
  if(historical&&ride?.kind !== 'horse'&&touch&&!keys.some(([key])=>key.includes('HORN')))keys=keys.concat([['HORN','Honk.']]);
    return keys.filter(([k]) => available || !['T', 'RADIO'].includes(k)).map(([k, v]) => {
    if (!available && k === 'HORN / RADIO') [k, v] = ['HORN', 'Honk.'];
    if (!available && k === 'H / T') [k, v] = ['H', historical ? 'Horn.' : 'Small horn.'];
    if(!available&&historical&&k==='H'&&ride?.kind !== 'horse')v='Horn.';
    // Just Drive says no "shift" (a mail word): the key column already shows ⇧; the drone row (#219) names it in its text.
    return `<dt>${just ? k.replace('Shift', '⇧') : k}</dt><dd>${just ? v.replaceAll('Shift', '⇧') : v}</dd>`;
  }).join('');
  };
  const place = areaName ?? 'Mabou';
  const addressSite = just && typeof location !== 'undefined' ? readSite(location.hostname, location.pathname, new URLSearchParams(location.search)) : null;
  const cardArea = historical ? era.area ?? (areaName ? AREAS.find(a => a.name === areaName)?.id : eraAreaId(era))
    : areaName ? AREAS.find(a => a.name === areaName)?.id : undefined;
  const otherAddress = otherGameAddress({ brand: just ? 'just' : 'mail', area: cardArea ?? null, ...(historical ? { era: '1884' } : {}) });
  const otherHref = otherAddress.replaceAll('&', '&amp;');
  const otherLine = `<span id="titleOtherGame">${just
    ? `Want a job with your drive? <a href="${otherHref}">Mabou Mail Madness: the same land, with a mail route.</a>`
    : `Just want to drive? <a href="${otherHref}">Just Drive has every area, no mail.</a>`}</span>`;
  const eraWords = historyArea(addressSite?.area);
  const door = addressSite?.brand === 'just' && eraWords && areaName === eraWords.name
    ? eraAddress(addressSite, !historical, location.pathname, new URLSearchParams(location.search)) : null;
  // Keep the shared mail markup and styles byte-identical. Only this card gets the extra line.
  if (door) document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
#titleEra{display:block;color:var(--ink-dim,#b9c3cc);font:13px/1.4 system-ui,sans-serif;text-align:center;padding:10px 0;min-height:24px;box-sizing:content-box}
#titleEra:focus-visible{outline:3px solid #fff;outline-offset:2px}
@media(min-width:760px){
 #title.justDrive #titleCard:has(>#titleEra):has(>.mpControl)>#titleEra{grid-row:9}
 #title.justDrive #titleCard:has(>#titleEra):has(>.mpControl)>#titleCredits{grid-row:10}
 #title.justDrive #titleCard:has(>#titleEra):has(>.mpControl)>#titleLegal{grid-row:11}
 #title.justDrive #titleCard:has(>#titleEra):has(>.mpControl):has(>#startHere)>#titleEra{grid-row:10}
 #title.justDrive #titleCard:has(>#titleEra):has(>.mpControl):has(>#startHere)>#titleCredits{grid-row:11}
 #title.justDrive #titleCard:has(>#titleEra):has(>.mpControl):has(>#startHere)>#titleLegal{grid-row:12}
}
@media(max-height:500px) and (min-width:650px){
 #title.justDrive #titleCard:has(>#titleEra):has(>#startHere)>#titleEra{grid-column:1/3!important;grid-row:8!important}
 #title.justDrive #titleCard:has(>#titleEra):has(>#startHere)>#titleCredits{grid-row:9!important}
 #title.justDrive #titleCard:has(>#titleEra):has(>#startHere)>#titleLegal{grid-row:10!important}
}` }));
  root.innerHTML = `<div id="titleCard">
    ${historical || just || areaName ? '' : `<div id="modeChoice" role="group" aria-label="How to play"><button id="modeMail" aria-pressed="${!explore}">Deliver the mail</button><button id="modeExplore" aria-pressed="${explore}">Just drive</button></div>`}
    <p class="tag">${historical ? 'A fictional journey · Cape Breton' : explore ? 'Preview build · the land at your own pace' : areaName ? 'Preview build · real land and roads' : 'Preview build · a route you cannot win'}</p>
    <h1>${explore ? name : areaName ? `Drive around <span>${areaName}</span>` : 'Mabou <span>Mail</span> Madness'}</h1>
    <p>${historical ? "A work of fiction, based on an 1884 survey sheet. Places are approximate. It shows no person's land." : explore ? `Drive around the real land near ${place}, Cape Breton, and find places at your own pace.` : areaName ? `Explore the real land and roads around ${areaName}, Cape Breton.` : 'Deliver the day’s run around Mabou, Cape Breton. Stay off the lawns. Somebody will phone the post office anyway.'}${otherLine}</p>
    ${explore ? '<p id="exploreCaution">A toy for getting a feel for the place. It is not a map for navigation or for safety. Roads and trails can differ on the day.</p>' : ''}
    <p id="waysOut" hidden></p>
    <dl>${rows(radio)}</dl>
    <button id="titleStart">${ride?.kind === 'horse' ? 'Start riding' : explore || areaName ? 'Start driving' : 'Start the shift'}</button>
    ${door ? `<a id="titleEra" href="${door.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${historical ? 'Back to today →' : eraDoorText(eraWords!.name)}</a>
    ` : ''}<button id="titleCredits" aria-expanded="false">Credits and data</button>
    <div id="titleLegal" hidden>${CONTACT_LINE}${aboutLine(just)}${historical ? `${(historyArea(eraAreaId(era)) ?? HISTORY_AREAS.mabou).credits}${LAND_CREDITS}${FAR_CREDITS}${MUSIC_CREDIT}${ENGINE_CREDIT}` : just ? LEGAL.replace(/<p><b>A work of satire[\s\S]*?<\/p>/, '<p>The land, the roads and the mapped buildings are real. The mine site and interiors are fictional.</p>') : areaName ? LEGAL.replace(/<p>.*?<\/p>/, '<p>The land, roads and mapped building shapes are real.</p>') : explore ? LEGAL.replace(/<p><b>A work of satire[\s\S]*?<\/p>/, '<p>The land, the roads and the mapped buildings are real. The mine site and interiors are fictional.</p>') : LEGAL}${paved ? PAVED_CREDIT : ''}</div>
  </div>`;
  if (explore && ride) { const buttons = vehicleButtons(ride); const modeChoice = root.querySelector('#modeChoice'); if (modeChoice) modeChoice.after(buttons); else root.querySelector('#titleCard')!.prepend(buttons); }
  document.body.appendChild(root);
  for (const [id, choice] of [['modeMail', 'mail'], ['modeExplore', 'explore']] as const) root.querySelector('#' + id)?.addEventListener('click', () => { if (choice !== mode) chooseMode(choice); });
  const start = root.querySelector<HTMLButtonElement>('#titleStart')!;
  const credits = root.querySelector<HTMLButtonElement>('#titleCredits')!;
  const legal = root.querySelector<HTMLElement>('#titleLegal')!;
  const ways = root.querySelector<HTMLElement>('#waysOut')!;
  const refreshWays = () => { const n = explore || areaName ? 0 : foundEndings().length; ways.hidden = n === 0; ways.textContent = `Ways out found: ${n}`; };
  refreshWays();
  let started = false;
  start.addEventListener('click', () => {
    root.hidden = true;
    started = true;
    onStart();
  });
  credits.addEventListener('click', () => {
    legal.hidden = !legal.hidden;
    credits.setAttribute('aria-expanded', String(!legal.hidden));
  });
  // Keys must not drive the car while the card is up.
  root.addEventListener('keydown', (ev) => ev.stopPropagation());
  start.focus();
  return {
    setRadio(available) { root.querySelector('dl')!.innerHTML = rows(available); },
    open() {
      if (explore) root.querySelector('dl')!.innerHTML = rows(radioAvailable);
      refreshWays();
      start.textContent = ride?.kind === 'horse' ? (started ? 'Back to riding' : 'Start riding') : explore || areaName ? (started ? 'Back to driving' : 'Start driving') : started ? 'Back to the shift' : 'Start the shift';
      legal.hidden = false;
      credits.setAttribute('aria-expanded', 'true');
      root.hidden = false;
      start.focus();
    },
  };
}
