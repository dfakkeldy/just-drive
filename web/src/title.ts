import { MUSIC_CREDIT as ALL_MUSIC_CREDIT, PUBLIC_MUSIC_CREDIT } from './radio-credits.generated';
import { foundEndings } from './ending';
import { PROPERTY_ATTRIBUTION, PROPERTY_LICENSE_URL } from './property-lines-rules';
import { AREAS } from './area';
import { eraAddress, otherGameAddress, readSite } from './site';
import { TODAY, type Era } from './era';
import { HISTORY_AREAS, eraAreaId, eraDoorText, historyArea } from './eras/history-areas';
import { ABOUT_URL, CHANGES_TEXT, CHANGES_URL, COFFEE_TEXT, COFFEE_URL, CONTACT, ENGINE_CREDIT, HELP_URL, LAND_CREDITS, FAR_CREDITS, LISTEN_TEXT, LISTEN_URL } from './credits';
import { KEYS, TOUCH, DRIVING_KEYS, DRIVING_TOUCH, padKeys, keyCaps } from './controls';
export { CONTACT } from './credits';
import { EXPLORE_TITLE, chooseDaily, chooseMode, type GameMode } from './mode';
import { CARD_BONUS, LINE_BONUS, shortDate } from './daily-rules';
import { horseKeys, bikeKeys, droneKeys, vehicleButtons, type VehicleChoice } from './vehicle-choice';

// The first thing a visitor sees: the name, how to drive, and whose data this is.
// Built here in script so the test page and the published page cannot drift apart.

const CSS = `
#title{--title-accent:var(--maple,#d0632e);box-sizing:border-box;align-items:safe center}
body.exploreMode #title,#title.justDrive{--title-accent:#a7d9bc;--title-overline:#a7d9bc}
#title #titleCard{display:block!important;box-sizing:border-box;width:min(680px,100%);max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain}
#title #titleCard h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600}
#title .tag{font:700 13px/1.4 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--title-overline,#edb486)}
body.exploreMode #title #titleStart,#title.justDrive #titleStart{background:#a7d9bc;color:#0b1620}
#title :is(#modeChoice,#dailyChoice,#vehicleChoice) button[aria-pressed="true"]{border:2px solid var(--title-accent)!important}
#title :is(#modeChoice,#dailyChoice,#vehicleChoice) button[aria-pressed="true"]::before{content:'✓ ';font-weight:800}
#titleControls summary{min-height:44px;display:list-item;align-content:center;cursor:pointer}
#titleControls kbd{display:inline-block;background:#20303b;border:1px solid #71818e;border-radius:4px;padding:2px 6px;border-bottom:2px solid #46566a;font:700 12px ui-monospace,Menlo,Consolas,monospace;white-space:normal}
#titleControls .keyJoin{color:var(--ink-dim)}
#titleControls dl{grid-template-columns:minmax(90px,auto) minmax(0,1fr)}
#title .titleFooter{display:flex;flex-wrap:wrap;align-items:center;gap:0 4px;margin-top:16px;font-size:13px}
#title .titleFooter>span{white-space:nowrap}
#title .titleFooter>span+span::before{content:'· '}
@media(max-width:759px){#title .titleFooter>span:last-child{flex-basis:100%}#title .titleFooter>span:last-child::before{content:none}}
#titleScrollFade{position:fixed;z-index:3;height:24px;pointer-events:none;font:12px/24px system-ui,sans-serif;text-align:center;color:var(--ink-dim,#b9c3cc);background:var(--panel-solid,#0c141c);border-radius:0 0 10px 10px}
#titleScrollFade::before{content:'';position:absolute;left:0;right:0;bottom:100%;height:20px;background:linear-gradient(transparent,var(--panel-solid,#0c141c))}
#titleScrollFade[hidden]{display:none}
#title .titleFooter #titleCredits{margin:0;min-height:44px}
#title :is(#titleOtherGame,#exploreCaution,.titleFooter){font:13px/1.4 system-ui,sans-serif;color:var(--ink-dim,#b9c3cc)}
#title :is(#modeChoice,#vehicleChoice){margin-top:18px!important}
@media(max-width:759px){#title #titleStart{position:sticky;bottom:-8px;z-index:2;padding:12px;box-shadow:0 -10px 14px var(--panel-solid,#0c141c)}#title #titleCard{scroll-padding-block:80px;padding-bottom:80px!important}}

#title{position:fixed;inset:0;z-index:20;display:grid;place-items:center;overflow:auto;
  padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));
  background:linear-gradient(rgba(8,14,20,.55),rgba(8,14,20,.86));color:var(--ink,#eef2f6);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
#title[hidden]{display:none}
#modeChoice{display:flex;gap:6px;margin:0 0 18px}
#modeChoice button{flex:1;min-height:44px;border:1px solid #6b7780;border-radius:6px;background:transparent;color:var(--ink);font:700 13px system-ui,sans-serif;cursor:pointer;padding:8px}
#modeChoice button[aria-pressed="true"]{background:#493124;border-color:var(--title-accent)}
body.exploreMode #modeChoice button[aria-pressed="true"],#title.justDrive #modeChoice button[aria-pressed="true"]{background:#31463a}
#modeChoice button:focus-visible{outline:3px solid white;outline-offset:2px}
#titleCard{width:min(100%,560px);background:var(--panel-solid,#0c141c);border:1px solid rgba(238,242,246,.18);border-radius:10px;padding:26px 24px 20px}
#title h1{margin:0;font:800 clamp(30px,8vw,46px)/1.02 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em;text-wrap:balance}
#title h1 span{color:var(--maple,#d0632e)}
#title .tag{margin:0 0 10px}
#title p{margin:12px 0 0;color:var(--ink-dim,#b9c3cc)}
#titleOtherGame{display:block;font-size:13px;line-height:1.4;margin-top:8px}
#titleOtherGame a{color:inherit;text-underline-offset:3px}
#titleOtherGame a:focus-visible{outline:3px solid #fff;outline-offset:3px}
#title dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:18px 0 0;font-size:14px}
#title dt{font:700 12px ui-monospace,Menlo,Consolas,monospace;color:var(--ink,#eef2f6);white-space:nowrap}
#title dt b{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:600}
#title dd{margin:0;color:var(--ink-dim,#b9c3cc)}
#titleStart{margin-top:22px;width:100%;min-height:54px;border:0;border-radius:8px;background:var(--maple,#d0632e);color:#0b1620;font:800 17px system-ui,sans-serif;cursor:pointer}
#titleStart:focus-visible,#titleCredits:focus-visible{outline:3px solid #fff;outline-offset:3px}
#titleCredits{margin-top:12px;background:none;border:0;color:var(--ink-dim,#b9c3cc);font:13px system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:6px 0}
#titleLegal{font-size:12.5px;line-height:1.55}
#titleLegal[hidden]{display:none}
#titleLegal p{margin:9px 0 0}
#titleLegal a{color:inherit}
/* content-box 100% plus padding overflowed narrow screens on cards without a multiplayer control (1884): */
@media(max-width:719px){#titleCard{box-sizing:border-box}}
@media(max-width:759px),(max-height:500px){#title .mpControl{scroll-margin-block:80px}}
@media(max-height:500px){
 #title{padding:10px}
 #title #titleCard{padding:12px 18px;max-height:calc(100dvh - 20px);scroll-padding-block:64px;padding-bottom:64px!important}
 #title h1{font-size:30px}
 #title p{font-size:12px;line-height:1.3;margin:4px 0 0}
 #title #titleOtherGame{font-size:12px;line-height:1.3;margin-top:2px}
 #title #titleStart{position:sticky;bottom:-8px;z-index:2;padding:12px;box-shadow:0 -10px 14px var(--panel-solid,#0c141c);margin-top:6px;min-height:44px}
 #title #titleCredits{margin-top:2px;padding:3px}
 #title #vehicleChoice{margin-top:6px!important;margin-bottom:6px}
 #title #modeChoice{margin-top:6px!important}
 #title dl{font-size:12px;gap:4px 10px;margin-top:8px}
}

`;

const PHONE_CSS = `
body:has(#phoneTop) #title{padding-top:calc(76px + env(safe-area-inset-top,0px));align-items:safe center;box-sizing:border-box}
body:has(#phoneTop) #title #titleCard{max-height:calc(100dvh - 92px - env(safe-area-inset-top,0px));height:auto;padding-bottom:52px!important}
`;
const JUST_CSS = `
#title.justDrive,#title.justDrive #titleCard{box-sizing:border-box}
@media(max-height:500px) and (min-width:650px){
 #title.justDrive{padding:10px}
 #title.justDrive #titleCard{padding:12px 18px;max-height:calc(100dvh - 20px)}
 #title.justDrive h1{font-size:30px}
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

/** Today's run on the title card (daily-rules.ts): the date, the card and what the seed fixed. */
export interface TitleDaily { date: string; squares: readonly { label: string }[]; vehicle: string; mood: string }
const DAILY_CSS = `
#dailyChoice{margin:-10px 0 18px}
#dailyChoice button{width:100%;min-height:44px;border:1px solid #6b7780;border-radius:6px;background:transparent;color:var(--ink);font:700 13px system-ui,sans-serif;cursor:pointer;padding:8px}
#dailyChoice button[aria-pressed="true"]{background:#4a2f22;border-color:#e5a16c}
#dailyChoice button:focus-visible{outline:3px solid white;outline-offset:2px}
#titleBingo{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:14px 0 0}
#titleBingo span{display:flex;align-items:center;justify-content:center;min-height:38px;padding:3px;box-sizing:border-box;border:1px solid #ffffff2e;border-radius:4px;
 background:#ffffff0d;font:12px/1.2 system-ui,sans-serif;text-align:center;color:var(--ink,#eef2f6)}
`;

export interface Title { open(): void; setRadio(available: boolean): void; /** Controller rows while a controller is the device used last. */ setDevice(pad: boolean): void }

/**
 * Shows the title card. `onStart` runs each time the player closes it with the button: at the start, and again after
 * reading it mid-shift (a real tap, so sound may begin there later). The caller pauses the game while it is open.
 */
export function createTitle(touch: boolean, onStart: () => void, mode: GameMode = 'mail', areaName?: string, ride?: VehicleChoice, just = false, radio = true, era: Era = TODAY, paved = false, daily?: TitleDaily, areaMail = false): Title {
  // Four cards: the Mabou mail game; an area with its own mail route (areaName, areaMail); an area without mail yet; and driving mode.
  const historical = era.id !== 'today';
  const explore = mode === 'explore', fired = mode === 'fired', areaMailRoute = !explore && !just && !historical && !!areaName && areaMail;
  const name = era.title ?? (just ? `Just Drive: ${areaName ?? 'Mabou'}` : explore ? (areaName ? `Driving ${areaName}` : EXPLORE_TITLE) : areaMailRoute ? `${areaName} Mail` : areaName ? `Drive around ${areaName}` : 'Mabou Mail Madness');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS + PHONE_CSS + (just && !historical ? JUST_CSS : '') }));
  const root = document.createElement('div');
  root.id = 'title';
  if (just) root.classList.add('justDrive');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', name);
  const drivingKeys = DRIVING_KEYS, drivingTouch = DRIVING_TOUCH;
  const areaRows = (touch ? TOUCH : KEYS).filter(([key]) => touch ? !['MAIL', 'CAMERA', 'BLADDER', '\u2699'].includes(key) : !['M or E', 'P', 'B', 'Enter'].includes(key)).map(([k, v]): [string, string] => [k, k === 'H' ? 'Horn.' : v]);
  let radioAvailable = radio, padRows = false;
  const mailControls = !explore && (!areaName || areaMailRoute);
  const rows = (available: boolean) => {
    radioAvailable = available;
    if (padRows && ride?.kind !== 'drone') return padKeys(ride?.kind, mailControls, available).map(([k, v]) => `<dt><b>${k}</b></dt><dd>${v}</dd>`).join('');
  let keys = explore ? (ride?.kind === 'drone' ? droneKeys(touch) : ride?.kind === 'bike' ? bikeKeys(touch) : touch ? drivingTouch : drivingKeys) : mailControls ? (touch ? TOUCH : KEYS) : areaRows;
  if (ride?.kind === 'horse') { keys = horseKeys(touch, mailControls); available = false; }
  if (ride?.kind === 'drone') available = false;
  if(historical&&ride?.kind !== 'horse'&&ride?.kind !== 'drone'&&touch&&!keys.some(([key])=>key.includes('HORN')))keys=keys.concat([['HORN','Honk.']]);
    return keys.filter(([k]) => available || !['T', 'RADIO'].includes(k)).map(([k, v]) => {
    if (!available && k === 'HORN / RADIO') [k, v] = ['HORN', 'Honk.'];
    if (!available && k === 'H / T') [k, v] = ['H', historical ? 'Horn.' : 'Small horn.'];
    if(!available&&historical&&k==='H'&&ride?.kind !== 'horse')v='Horn.';
    // Just Drive says no "shift" (a mail word): the key column already shows ⇧; the drone row (#219) names it in its text.
    return `<dt>${touch ? `<b>${(just ? k.replace('Shift', '⇧') : k).replace('W A S D', 'WASD')}</b>` : keyCaps((just ? k.replace('Shift', '⇧') : k).replace('W A S D', 'WASD'))}</dt><dd>${just ? v.replaceAll('Shift', '⇧') : v}</dd>`;
  }).join('');
  };
  const controls = () => {
    const all = rows(radioAvailable).match(/<dt>[\s\S]*?<\/dd>/g) ?? [];
    const open = root.querySelector<HTMLDetailsElement>('#titleControls details')?.open;
    return `<dl>${all.slice(0, 4).join('')}</dl><details${open ? ' open' : ''}><summary>All controls</summary><dl>${all.slice(4).join('')}</dl></details>`;
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
#titleEra{display:block;color:var(--ink-dim,#b9c3cc);font:13px/1.4 system-ui,sans-serif;text-align:left;padding:10px 0;min-height:24px;box-sizing:content-box}
#titleEra:focus-visible{outline:3px solid #fff;outline-offset:2px}

` }));
  const mailCard = !(historical || just || areaName);
  if (mailCard) document.head.appendChild(Object.assign(document.createElement('style'), { textContent: DAILY_CSS }));
  const dailyText = daily ? `One Get Fired run a day, the same for everybody: the start, the ${daily.vehicle.toLowerCase()} and the ${daily.mood.toLowerCase()} weather. Five minutes on the clock. Fill the complaint bingo card: a line pays ${LINE_BONUS}, the full card ${CARD_BONUS}. Your first finished try is today’s card; later tries are practice.` : '';
  root.innerHTML = `<div id="titleCard">

    <p class="tag">${historical ? 'A fictional journey · Cape Breton' : explore ? 'The land at your own pace' : areaMailRoute ? 'Mail route · real land and roads' : areaName ? 'Real land and roads' : daily ? `Today’s run · ${shortDate(daily.date)} · the same for everybody` : fired ? 'Get Fired · a job you cannot lose' : 'A route you cannot win'}</p>
    <h1>${explore ? name : areaMailRoute ? `${areaName} <span>Mail</span>` : areaName ? `Drive around <span>${areaName}</span>` : 'Mabou <span>Mail</span> Madness'}</h1>
    <p id="titleLede">${historical ? "A work of fiction, based on an 1884 survey sheet. Places are approximate. It shows no person's land." : explore ? `Drive around the real land near ${place}, Cape Breton, and find its places.` : daily ? dailyText : fired ? 'Same route, same clock. Today every complaint counts for you. Climb the discipline ladder to Fired before 18:00. The union grieves every step.' : areaMailRoute ? `Deliver the mail around ${areaName}, Cape Breton. Town mail goes to the post office on Pitt Street; rural boxes stand outside the town line.` : areaName ? `Explore the real land and roads around ${areaName}, Cape Breton.` : 'Deliver the day’s run around Mabou, Cape Breton. Stay off the lawns. Somebody will phone the post office anyway.'}</p>
    ${mailCard ? `<div id="modeChoice" role="group" aria-label="How to play" aria-describedby="titleLede"><button id="modeMail" aria-pressed="${!explore && !fired}">Deliver the mail</button><button id="modeExplore" aria-pressed="${explore}">Just drive</button><button id="modeFired" aria-pressed="${fired && !daily}">Get fired</button></div><div id="dailyChoice"><button id="modeDaily" aria-pressed="${!!daily}">Today’s run: five minutes, complaint bingo</button></div>` : ''}
    ${daily ? `<div id="titleBingo" role="list" aria-label="Today’s complaint bingo card">${daily.squares.map(s => `<span role="listitem">${s.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</span>`).join('')}</div>
    ` : ''}<p id="waysOut" hidden></p>
    <div id="titleControls">${controls()}</div>

    <button id="titleStart">${ride?.kind === 'drone' ? 'Start flying' : ride?.kind === 'horse' ? 'Start riding' : areaMailRoute ? 'Start the shift' : explore || areaName ? 'Start driving' : daily ? 'Start today’s run' : 'Start the shift'}</button>
    ${door ? `<a id="titleEra" href="${door.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${historical ? 'Back to today →' : eraDoorText(eraWords!.name)}</a>
    ` : ''}${otherLine}
    ${explore ? '<p id="exploreCaution">A toy for getting a feel for the place. It is not a map for navigation or for safety. Roads and trails can differ on the day.</p>' : ''}
    <p class="titleFooter"><span>Preview build</span><span>Cape Breton, Nova Scotia</span><span><button id="titleCredits" aria-expanded="false">Credits and data</button></span></p>
    <div id="titleLegal" hidden>${CONTACT_LINE}${aboutLine(just)}${historical ? `${(historyArea(eraAreaId(era)) ?? HISTORY_AREAS.mabou).credits}${LAND_CREDITS}${FAR_CREDITS}${MUSIC_CREDIT}${ENGINE_CREDIT}` : just ? LEGAL.replace(/<p><b>A work of satire[\s\S]*?<\/p>/, '<p>The land, the roads and the mapped buildings are real. The mine site and interiors are fictional.</p>') : areaName ? LEGAL.replace(/<p>.*?<\/p>/, '<p>The land, roads and mapped building shapes are real.</p>') : explore ? LEGAL.replace(/<p><b>A work of satire[\s\S]*?<\/p>/, '<p>The land, the roads and the mapped buildings are real. The mine site and interiors are fictional.</p>') : LEGAL}${paved ? PAVED_CREDIT : ''}</div>
  </div>`;
  if (explore && ride) { const buttons = vehicleButtons(ride); const modeChoice = root.querySelector('#modeChoice'); if (modeChoice) modeChoice.after(buttons); else root.querySelector('#titleControls')!.before(buttons); }
  document.body.appendChild(root);
  const card = root.querySelector<HTMLElement>('#titleCard')!;
  const fade = Object.assign(document.createElement('div'), { id: 'titleScrollFade', hidden: true, textContent: 'More below ▾' });
  fade.setAttribute('aria-hidden', 'true'); root.append(fade);
  const refreshFade = () => {
    const more = !root.hidden && card.scrollTop + card.clientHeight < card.scrollHeight - 1;
    if (fade.hidden === more) fade.hidden = !more;
    if (!more) return;
    const box = card.getBoundingClientRect();
    fade.style.left = `${box.left + 1}px`; fade.style.width = `${box.width - 2}px`; fade.style.top = `${box.bottom - 25}px`;
  };
  card.addEventListener('scroll', refreshFade);
  root.addEventListener('toggle', refreshFade, true);
  addEventListener('resize', refreshFade);
  if (typeof ResizeObserver === 'function') new ResizeObserver(refreshFade).observe(card);
  if (typeof MutationObserver === 'function') new MutationObserver(refreshFade).observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden','open'] });
  refreshFade();
  for (const [id, choice] of [['modeMail', 'mail'], ['modeExplore', 'explore'], ['modeFired', 'fired']] as const) root.querySelector('#' + id)?.addEventListener('click', () => { if (choice !== mode || daily) chooseMode(choice); });
  root.querySelector('#modeDaily')?.addEventListener('click', () => { if (!daily) chooseDaily(); });
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
  start.focus({ preventScroll: true });
  root.scrollTop = 0; root.querySelector('#titleCard')!.scrollTop = 0;
  return {
    setRadio(available) { radioAvailable = available; root.querySelector('#titleControls')!.innerHTML = controls(); },
    setDevice(pad) { if (pad !== padRows) { padRows = pad; root.querySelector('#titleControls')!.innerHTML = controls(); } },
    open() {
      if (explore) root.querySelector('#titleControls')!.innerHTML = controls();
      refreshWays();
      start.textContent = ride?.kind === 'drone' ? (started ? 'Back to flying' : 'Start flying') : ride?.kind === 'horse' ? (started ? 'Back to riding' : 'Start riding') : explore || areaName ? (started ? 'Back to driving' : 'Start driving') : daily ? (started ? 'Back to today’s run' : 'Start today’s run') : started ? 'Back to the shift' : 'Start the shift';
      legal.hidden = false;
      credits.setAttribute('aria-expanded', 'true');
      root.hidden = false;
      start.focus({ preventScroll: true });
      root.scrollTop = 0; root.querySelector('#titleCard')!.scrollTop = 0;
    },
  };
}
