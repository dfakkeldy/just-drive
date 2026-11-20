#!/usr/bin/env node
import { cdp, cdpFetch, exitCheck } from './cdp.mjs';
// Measures the phone controls at 28 phone/tablet sizes. Both gauge widths run with a photo, a radio,
// map open/folded, a long two-line stop hint, and upright/sideways safe areas. Settings must expose
// END SHIFT on every visit and scroll to their last button. Every phone button keeps its touch size.
// A missing game or required control fails; an opened map gets no overlap exemption.
// RUN=layout-check.mjs VIEWS="layout|x=1" tools/yard-shots.sh 900 900
// SIZES="390x844 844x390" limits the run (add -plain to a size to leave out its safe-area pass); SHOTS=1 saves each state.
import { layoutFaults, targetFaults } from './hud-layout-geometry.mjs';
import { mpLayoutScript } from './mp-layout-fixture.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { raceLayoutCheck, racePropertyScript } from './race-layout-check.mjs';

const [outDir, first] = process.argv.slice(2);
const base = first ? new URL(first).origin : null;
const PORT = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = (process.env.SIZES ?? '320x568 320x640 360x740 375x553 375x667 390x664 390x844 402x874 412x915 414x736 430x932 440x956 568x320 667x375 740x360 781x390 812x375 844x390 874x402 932x430 956x440 768x1024 280x653 344x1000 1024x768 600x400 568x280 320x460-plain')
  .split(/\s+/).map((s) => { const m = /^(\d+)x(\d+)(-plain)?$/.exec(s); if (!m) throw new Error(`bad size: ${s}`); return [Number(m[1]), Number(m[2]), !!m[3]]; });
// `-plain`: without the notch insets. 320x460 is the smallest upright view there is (a 4-inch phone in a browser with
// its bars), and no phone of that size has a notch. With insets of 47 and 34 px it would be 379 px high, under the floor
// that phone-layout.ts states.
// Controls that a finger or an eye needs clear. The steering pad counts by its visible track.
const TRIP_LAYOUT=process.env.TRIP_LAYOUT==='quarry';
const TRIP_IDS=['hud','tripHud','miniMap','radio','gear','placesButton','tcReset','tcView','tcHorn','tcTrack','tcBrake','tcGo'];
const IDS = TRIP_LAYOUT?TRIP_IDS:['phoneLine', 'hud', 'shiftHud', 'stopHint', 'miniMap', 'relief', 'radio', 'gear', 'photoTag', 'endShift', 'tcReset', 'tcView', 'tcHorn',
  'tcTrack', 'tcBrake', 'tcGo', 'cameraButton', 'mailButton', 'droneButton'];
const NEEDED = TRIP_LAYOUT?TRIP_IDS:['miniMap', 'radio', 'phoneLine', 'relief', 'gear', 'tcReset', 'tcView', 'tcHorn', 'tcTrack', 'tcBrake', 'tcGo', 'cameraButton', 'mailButton'];

async function open(w, h, query) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  const read = async (expression) => {
    await send('Page.bringToFront');
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
    return result.result?.result?.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: Number(process.env.DPR ?? 1), mobile: true });
  await send('Page.enable'); await send('Runtime.enable');
  // Each size starts as a first visit: a map left open by the size before must not carry over.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try { if (!sessionStorage.getItem("layoutCheck")) { localStorage.clear(); sessionStorage.setItem("layoutCheck", "1"); } } catch {}' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mpLayoutScript + (process.env.MP_LAYOUT === '1' ? '' : `\nlocalStorage.setItem('mmm.mp','0');`) });
  if (process.env.RACE_LAYOUT === '1') {
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:racePropertyScript});
  }
  await send('Page.navigate', { url: `${base}/?${query}&touch=1&q=${process.env.DETAIL ?? 'low'}&hud=1&title=1` });
  for (let t = 0; t < 120; t++) {
    if (await read(TRIP_LAYOUT?`!!document.getElementById('titleStart')`:`!!document.querySelector('#titleCard .mpControl') && !!document.getElementById('modeChoice')`)) {
      const faults = await read(`(${openSections})('#title')`);
      if (faults.length) throw new Error('title controls: ' + faults.join('; '));
      await read(`document.getElementById('titleStart').click()`); break;
    }
    await sleep(500);
  }
  let settled = false;
  for (let t = 0; t < 120 && !settled; t++) { await sleep(1500); settled = String(await read('document.title')).startsWith('settled'); }
  if (process.env.MP_LAYOUT === '1') {
    if (!await read(`mmm.mp.current?.status === 'Muddy Culvert 88 · 23 other drivers' && !document.getElementById('mpChip')`))
      throw new Error('phone multiplayer status fixture did not start, or floated over the grid');
  }
  const boxesExpression = `${JSON.stringify(IDS)}.map((id) => {
    const e = document.getElementById(id);
    if (!e || e.hidden) return null;
    const s = getComputedStyle(e), b = e.getBoundingClientRect();
    if (s.display === 'none' || s.visibility === 'hidden' || b.width < 2 || b.height < 2) return null;
    // A control inside a closed panel is not on screen.
    for (let p = e.parentElement; p; p = p.parentElement) if (getComputedStyle(p).display === 'none') return null;
    return [id, Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
  }).filter(Boolean)`;
  const boxes = async () => JSON.parse(await read(`JSON.stringify(${boxesExpression})`) ?? '[]');
  // The boxes and the readouts-menu state from one evaluation after two frames. The phone layout follows a
  // safe-area or hint-height change through observers, a frame or more later, and it moves the map and radio into
  // (or out of) the settings menu together with that class: two separate reads could straddle such a pass.
  const layoutState = async () => {
    await send('Page.bringToFront');
    const result = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression:
      `new Promise(done => {
        const give = (via) => { try { done(JSON.stringify({ via, menu: document.body.classList.contains('phoneReadoutsMenu'), boxes: ${boxesExpression} })); }
          catch (error) { done(JSON.stringify({ error: String(error?.stack ?? error) })); } };
        setTimeout(() => give('timer'), 1000); requestAnimationFrame(() => requestAnimationFrame(() => give('frame')));   // a throttled tab still answers
      })` });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
    const state = JSON.parse(result.result.result.value);
    if (state.error) throw new Error(state.error);
    readings[state.via]++;
    return state;
  };
  const shot = async (name) => { if (process.env.SHOTS === '1') writeFileSync(`${outDir}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  return { send, read, boxes, layoutState, shot, settled, close: async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); ws.close(); } };
}

/** The faults in one set of boxes. */
function faults(list,w,h,menu=false,safe=null){
  return layoutFaults(list,w,h,NEEDED.filter(n=>!(menu&&['miniMap','radio','relief'].includes(n))),safe);
}

// Both carriers share the same control rules; script owns the phone structure and styling.
const style = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').match(/<style\b[^>]*>[\s\S]*?<\/style>/g)?.map(block => block.trim()) ?? [];
if (style('../web/index.html').length < 2) throw new Error('expected both carrier style blocks');
if (JSON.stringify(style('../web/index.html')) !== JSON.stringify(style('../artifact/page.html'))) throw new Error('dev and published page CSS differ');

for (const path of ['../web/index.html', '../artifact/page.html']) {
  const html = readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const id of ['hud', 'shiftHud', 'stopHint', 'gear', 'settings', 'cameraButton', 'mailButton', 'photoTag', 'endShift'])
    if (html.split(`id="${id}"`).length !== 2) throw new Error(`${path}: expected exactly one #${id}`);
}

if (!first) { console.log('PASS all dev/published style blocks and stable carrier ids'); process.exit(0); }

if (process.env.FLEET_LAYOUT === '1') { await import('./fleet-layout-check.mjs'); process.exit(0); }
const openSections = `(selector) => {
  const root = document.querySelector(selector), out = [];
  // A closed <details> keeps boxes for its hidden controls, so boxes alone do not mean visible.
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]') && !(el.tagName !== 'DETAILS' && el.closest('details:not([open])'));
  const reach = () => {
    for (const el of root.querySelectorAll('button,input')) {
      if (!visible(el)) continue;
      el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect(), p=root.getBoundingClientRect();
      const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      if (r.left<p.left-1 || r.right>p.right+1 || r.top<Math.max(0,p.top)-1 || r.bottom>Math.min(innerHeight,p.bottom)+1 || !(at===el || el.contains(at)))
        out.push('unreachable control: '+(el.id || el.textContent || el.getAttribute('aria-label')));
    }
  };
  // A closed section (the date, time and weather one) is opened for the first reach test and closed again.
  const closed = [...root.querySelectorAll('details:not([open])')].filter(visible);
  for (const section of closed) section.open = true;
  reach();
  for (const section of closed) section.open = false;
  const group=root.querySelector('.mpControl');
  if (!group) { out.push('missing multiplayer section'); return out; }
  const toggle=group.querySelector('.mpToggle'), wasOn=toggle.getAttribute('aria-checked')==='true';
  if (!wasOn) toggle.click();
  group.querySelector('.mpPrivate').click();
  for (const selector of ['.mpNew','.mpJoin input','.mpUse','.mpCopy'])
    if (!visible(group.querySelector(selector))) out.push('private section did not expose '+selector);
  reach();
  group.querySelector('.mpOpen').click();
  if (!wasOn) toggle.click();
  return out;
}`;

const BUTTONS = ['gear', 'tcReset', 'tcView', 'tcHorn', 'tcBrake', 'tcGo', 'cameraButton', 'mailButton', 'miniMapHead', 'radio', 'relief'];
async function panelCheck(p, name) {
  await p.read(`document.getElementById('gear').click()`);
  const result = await p.read(`(() => {
    const end = document.getElementById('endShift');
    const b = end?.getBoundingClientRect(), at = b && document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);
    const out = [];
    if (!end || end.hidden || !(at === end || end.contains(at))) out.push('END SHIFT is not on top in the settings panel');
    for (const button of document.querySelectorAll('#settings button')) {
      if (!button.getClientRects().length) continue;
      const r = button.getBoundingClientRect();
      if (r.width < 56 || r.height < 56) out.push('small settings button: ' + button.textContent);
    }
    if(document.body.classList.contains('phoneReadoutsMenu')) for(const id of ['miniMapHead','radio','relief']) {
      const e=document.getElementById(id);if(!e||!e.closest('#settings')||e.hidden){out.push('missing readout in settings: '+id);continue;}
      e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      if(r.width<56||r.height<56||!(at===e||e.contains(at)))out.push('unreachable readout: '+id);
    }
    if(document.body.classList.contains('phoneReadoutsMenu')&&!document.getElementById('photoTag')?.closest('#settings'))out.push('photo feedback not retained in settings');
    return out;
  })()`);
  await p.shot(`${name}-settings`);
  const last = await p.read(`(() => {
    const last = [...document.querySelectorAll('#settings button')].filter(el=>el.getClientRects().length && !el.closest('[hidden]')).at(-1);
    if (!last) return false;
    last.scrollIntoView({block:'nearest'});
    const b = last.getBoundingClientRect(), at = document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);
    return b.bottom <= innerHeight+1 && b.top >= -1 && (at === last || last.contains(at));
  })()`);
  if (!last) result.push('the last settings button cannot be reached');
  const controls = await p.read(`(${openSections})('#settings')`);
  result.push(...controls);
  await p.shot(`${name}-settings-last`);
  await p.read(`document.getElementById('gear').click()`);
  return result ?? ['the settings panel could not be read'];
}
let safeMethodReported = false;
// How the settled readings were answered: after two frames, or by the 1 s timer (frames not running).
const readings = { frame: 0, timer: 0 };
async function safeArea(p, w, h, enabled) {
  const insets = !enabled ? { top: 0, bottom: 0, left: 0, right: 0 } : h >= w
    ? { top: 47, bottom: 34, left: 0, right: 0 } : { top: 0, bottom: 21, left: 47, right: 47 };
  const result = process.env.SAFE_AREA_FALLBACK === '1' ? { error:true } : await p.send('Emulation.setSafeAreaInsetsOverride', { insets });
  if (enabled && !safeMethodReported) {
    console.log(`Safe areas: ${result.error ? 'CSS-variable fallback' : 'CDP Emulation.setSafeAreaInsetsOverride'}`);
    safeMethodReported = true;
  }
  // Older Chromium has no override. These variables feed the exact same grid padding in that case.
  if (result.error) await p.read(`Object.entries(${JSON.stringify(insets)}).forEach(([side, px]) => document.documentElement.style.setProperty('--test-safe-' + side, px + 'px'))`);
  return insets;
}
if(process.env.RACE_LAYOUT==='1'){
 await raceLayoutCheck({open,safeArea,sizes:SIZES,outDir});
 exitCheck(0);
}else if(TRIP_LAYOUT){
 let bad=0;
 for(const[w,h,plain]of SIZES){const p=await open(w,h,'trip=quarry-gate');try{
  const found=[];if(!p.settled)found.push('trip did not settle');
  for(const safe of plain?[false]:[false,true]){
   const insets=await safeArea(p,w,h,safe);
   for(const folded of [false,true]){
    await p.read(`(()=>{const map=document.getElementById('miniMap');if(map.classList.contains('folded')!==${folded})document.getElementById('miniMapHead').click();})()`);await sleep(200);
    const boxes=await p.boxes();found.push(...faults(boxes,w,h));
    for(const[id,x0,y0,x1,y1]of boxes)if(x0<insets.left||y0<insets.top||x1>w-insets.right||y1>h-insets.bottom)found.push('safe-area inset: '+id);
    for(const box of boxes)if(['gear','placesButton','tcReset','tcView','tcHorn','tcBrake','tcGo','radio'].includes(box[0])&&(box[3]-box[1]<56||box[4]-box[2]<56))found.push('small target: '+box[0]);
    if(!await p.read(`document.getElementById('tripHud').textContent.length>0&&!document.getElementById('tripHud').hidden`))found.push('trip HUD missing');
    await p.shot(`quarry-trip-layout-${w}x${h}-${safe?'safe':'plain'}-${folded?'folded':'map'}`);
   }
  }
  const css=await p.read(`(()=>{const e=document.getElementById('tripHud'),old=e.style.cssText;e.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:99';return old;})()`);
  if(!faults(await p.boxes(),w,h).length)found.push('overlap mutation escaped');else console.log('REJECTED actual trip HUD covering phone controls');
  await p.read(`document.getElementById('tripHud').style.cssText=${JSON.stringify(css)}`);
  console.log(w+'x'+h+(found.length?' FAIL '+found.join('; '):' PASS quarry trip line, route map, controls and safe areas'));if(found.length)bad++;
 }finally{await p.close();}}
 exitCheck(bad?1:0);
}else{
let bad = 0;
for (const [w, h, plain] of SIZES) {
  const found = [];
  // Wide and narrow gauges both run at every size, including upright map open/fold cycles.
  for (const [kind, level] of [['wide', 0.5], ['narrow', 0.2]]) {
    const p = await open(w, h, `demo=2&relief=${level}`);
    if (!p.settled) found.push(`${kind}: the game did not settle`);
    await p.read(`document.getElementById('cameraButton')?.click()`);
    await sleep(700);
    const photo = await p.layoutState();   // menu state and boxes from one reading
    if (!photo.menu && !photo.boxes.some((b) => b[0] === 'photoTag')) found.push(`${kind}: the photo note did not appear`);
    const parity = await p.read(`(() => {
      const root = document.documentElement, previous = root.className;
      const measure = () => JSON.stringify(${JSON.stringify(IDS)}.map(id => {
        const e = document.getElementById(id); if (!e) return null;
        const b = e.getBoundingClientRect(), s = getComputedStyle(e);
        return [id,b.x,b.y,b.width,b.height,s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.padding,s.display];
      }));
      root.className = 'devPage'; const dev = measure();
      root.className = ''; const published = measure();
      root.className = previous;
      return dev === published;
    })()`);
    if (!parity) found.push(`${kind}: dev and published phone boxes or paint differ`);
    for (const safe of plain ? [false] : [false, true]) {
      const insets = await safeArea(p, w, h, safe);
      const name = `layout-${w}x${h}-${kind}${safe ? '-safe' : ''}`;
      const inspect = async (state) => {
        // Judge a settled layout: the same menu state and the same elements on screen twice in a row (positions may
        // still move: the live stop hint changes its text as the car drives). The first reading waits 150 ms as the
        // single read did before; every reading waits two frames (1 s at most). A layout that never repeats in 16
        // readings is a fault itself. A state seen only on the way (one frame of a layout pass) is not judged: the
        // player sees the settled layout, and judging transitions is what made the old two-read check intermittent.
        let now, last = '', settledLayout = false;
        await sleep(150);
        for (let t = 0; t < 16 && !settledLayout; t++) {
          now = await p.layoutState();
          const shape = JSON.stringify([now.menu, now.boxes.map((b) => b[0])]);
          settledLayout = shape === last;
          last = shape;
        }
        if (!settledLayout) found.push(`${kind}${safe ? ' safe' : ''} ${state}: layout did not settle (16 readings)`);
        found.push(...faults(now.boxes, w, h, now.menu, insets).map((f) => `${kind}${safe ? ' safe' : ''} ${state}: ${f}`));
        const targets = await p.read(`JSON.stringify(${JSON.stringify(BUTTONS)}.flatMap(id => {
          const e=document.getElementById(id);if(!e||e.hidden||!e.getClientRects().length)return [];
          const b=e.getBoundingClientRect();return [[id,b.left,b.top,b.right,b.bottom]];
        }))`);
        found.push(...targetFaults(JSON.parse(targets),BUTTONS).map(f=>`${state}: ${f}`));
      };
      await inspect('initial');
      await p.shot(name);
      // Keep the test text in place while the game updates its normal roadside hint.
      await p.read(`(() => { const route = document.getElementById('shiftHud'); route.textContent = 'DAY 8 · 0/130 STOPS · 16:58\\nNORTHEAST / MINES / VILLAGE · DOUBLE MAIL'; Object.defineProperty(route, 'textContent', { configurable:true, get:() => route.innerText, set:() => {} }); const e = document.getElementById('stopHint'); e.classList.remove('intro'); e.textContent = ${JSON.stringify('Next: rural box by the long driveway.\nHold MAIL beside the roadside box.')}; Object.defineProperty(e, 'textContent', { configurable:true, get:() => e.innerText, set:() => {} }); })()`);
      // The mail dashboard keeps the full two-line hint in both orientations.
      // One reading: the phone layout's observers can move the hint into the menu between
      // separate reads, so a height read before the move would be judged as a dashboard hint.
      const hint = await p.read(`(() => {
        const e = document.getElementById('stopHint');
        return { height: e.innerText.includes('long driveway') ? e.getBoundingClientRect().height : -1,
          inMenu: document.body.classList.contains('phoneReadoutsMenu') && !!e.closest('#settings'),
          retained: e.textContent.includes('long driveway') };
      })()`);
      if (!hint.inMenu && hint.height !== 36) found.push(`long two-line hint did not appear (height ${hint.height})`);
      if (hint.inMenu && !hint.retained) found.push('full hint not retained in the narrow-view menu');
      for (const folded of [false, true]) {
        await p.read(`(() => { const m = document.getElementById('miniMap'); if (m.classList.contains('folded') !== ${folded}) document.getElementById('miniMapHead').click(); })()`);
        await inspect(folded ? 'folded again + long hint' : 'map open + long hint');
        await p.shot(`${name}-${folded ? 'folded' : 'map'}`);
      }
      for (const help of ['strong', 'light']) {
        await p.read(`document.querySelector('[data-help="${help}"]').click()`);
        await inspect(`${help} help`);
        found.push(...(await panelCheck(p, `${name}-${help}`)).map((f) => `${kind}${safe ? ' safe' : ''} ${help}: ${f}`));
      }
      await p.read(`['stopHint','shiftHud'].forEach(id => delete document.getElementById(id).textContent)`);
    }
    await p.close();
  }
  if (found.length) bad++;
  console.log(`${w}x${h} ${found.length ? found.join('; ') : 'clear (wide/narrow; map open/folded; long hint; safe areas; settings; touch sizes)'}`);
}
console.log(`layout readings: ${readings.frame} after two frames, ${readings.timer} by the 1 s timer`);
console.log(bad ? `FAIL: ${bad} of ${SIZES.length} sizes have a layout fault` : `PASS: no layout fault at ${SIZES.length} sizes`);
exitCheck(bad ? 1 : 0);

}
