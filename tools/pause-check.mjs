import assert from 'node:assert/strict';
import { PauseGate } from '../web/src/pause.ts';
import { readFileSync } from 'node:fs';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
const gate = new PauseGate();
let updates = 0;
const frame = (now, room = false) => { const f = gate.frame(now, room); if (!f.paused) updates++; return f; };
frame(0); assert.equal(frame(16).dt, .016);
gate.setSettings(true);
const before = updates, time = gate.time;
for (const now of [32, 1000, 10000]) assert.equal(frame(now).paused, true);
assert.equal(updates, before); assert.equal(gate.time, time);
gate.setSettings(false); assert.equal(frame(20000).dt, 0); assert.equal(frame(20016).dt, .016);
gate.toggle(); assert.equal(gate.screen, true); gate.setSettings(true); assert.equal(gate.screen, false);
gate.setSettings(false); assert.equal(gate.screen, true); assert.equal(frame(21000).paused, true);
gate.toggle(); assert.equal(gate.blocked, false); assert.equal(frame(22000).dt, 0);
gate.setHidden(true); frame(23000); gate.setHidden(false); assert.equal(gate.screen, true);
assert.equal(frame(30000).paused, true); gate.resume(); assert.equal(frame(40000).dt, 0);
gate.toggle(); assert.equal(frame(41000, true).paused, false); assert.equal(gate.blocked, true);
assert.equal(frame(41016, true).dt, .016); assert.equal(frame(51000, true).dt, 9.984);
console.log('PASS pause gate: Settings, explicit pause, hidden latch, no catch-up, room world continues');

// Run the live capture handler. A later Settings listener cannot repair its focus.
const main=readFileSync('web/src/main.ts','utf8');
// Sun Seeker's branch comes first in the same handler; find the handler that holds the replay rule.
const start=main.lastIndexOf("addEventListener('keydown', ev => {",main.indexOf("  // The replay owns"));
const finish="}, { capture: true });";
const end=main.indexOf(finish,start);
assert.ok(start>=0&&end>start,'pause capture handler found');
const capture=transformSync(main.slice(start,end+finish.length),{loader:'ts'}).code;
for (const nested of [false,true]) {
 const pause=new PauseGate();
 if(nested)pause.toggle();
 pause.setSettings(true);
 let handler,focused='settingsClose',open=true;
 class Element { closest(){return null;} }
 const context={pause,replay:{active:false},sunSeeker:null,HTMLInputElement:Element,HTMLElement:Element,interiors:{busy:false},pauseAllowed:()=>true,
  settingsPanel:{classList:{contains:()=>open}},
  document:{getElementById:id=>({focus:()=>{focused=id;}})},
  syncPauseUI:()=>{open=pause.blocked&&!pause.screen;},
  addEventListener:(name,callback,options)=>{assert.equal(name,'keydown');assert.equal(options.capture,true);handler=callback;}};
 new Function('context',`with(context){${capture}}`)(context);
 let prevented=false,stopped=false;
 handler({code:'Escape',target:new Element(),repeat:false,preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{stopped=true;}});
 assert.equal(open,false,'Escape closes Settings');
 assert.equal(focused,'gear','Escape returns focus to the gear');
 assert.ok(prevented&&stopped,'capture owns Escape');
}
{
 // While Sun Seeker is open it owns every key outside its inputs, and Escape everywhere.
 let handler,keys=[],stopped=0;
 class Element { closest(){return null;} }
 class Input extends Element {}
 const context={pause:new PauseGate(),replay:{active:false},sunSeeker:{key:ev=>keys.push(ev.code)},HTMLInputElement:Input,HTMLElement:Element,
  interiors:{busy:false},pauseAllowed:()=>true,settingsPanel:{classList:{contains:()=>false}},document:{getElementById:()=>({focus(){}})},
  syncPauseUI(){},addEventListener:(name,callback)=>{handler=callback;}};
 new Function('context',`with(context){${capture}}`)(context);
 const press=(code,target)=>handler({code,target,repeat:false,preventDefault(){},stopImmediatePropagation(){stopped++;}});
 press('ArrowLeft',new Element());press('Escape',new Input());press('KeyP',new Input());
 assert.deepEqual(keys,['ArrowLeft','Escape'],'Sun Seeker takes arrows and Escape, not typing in its fields');
 assert.equal(stopped,2);assert.equal(context.pause.blocked,false,'P typed in a Sun Seeker field does not pause');
}
const title=main.match(/document\.getElementById\('pauseTitle'\)!\.textContent = ([\s\S]*?);/);
assert.ok(title,'pause title expression found');
const pauseTitle=new Function('mode','interiors','ride','vehicle','room',`return ${title[1]};`);
// In a room the car keeps rolling while the pause card shows, so it is never "Pulled over" there.
for (const kind of ['car','bike','truck','sxs','horse']) for (const mode of ['drive','fly']) for (const busy of [false,true]) for (const room of [false,true]) {
 const expected=kind==='car'&&mode==='drive'&&!busy&&!room?'Pulled over on Track':'Paused';
 assert.equal(pauseTitle(mode,{busy},{kind},{roadName:'Track'},room),expected);
}
assert.equal(pauseTitle('drive',{busy:false},{kind:'car'},{},false),'Pulled over');
console.log('PASS live Settings capture restores gear focus; pause title follows ride and foot/free-camera mode');

const endVisibility=main.match(/document\.getElementById\('pauseEndShift'\)!\.hidden = ([^;]+);/);
assert.ok(endVisibility);
const hiddenEnd=new Function('mailMode','document','interiors','bare',`return ${endVisibility[1].replaceAll('!.', '.')};`);
for(const mail of [false,true])for(const endHidden of [false,true])for(const busy of [false,true])for(const bare of [false,true]) {
 assert.equal(hiddenEnd(mail,{getElementById:()=>({hidden:endHidden})},{busy},bare),!mail||endHidden||busy||bare);
}
const endHandler=main.match(/document\.getElementById\('pauseEndShift'\)!\.addEventListener\('click', \(\) => \{ ([^}]+) \}\);/);
assert.ok(endHandler);
const actions=[];new Function('pause','syncPauseUI','shift',endHandler[1])({resume:()=>actions.push('resume')},()=>actions.push('sync'),{end:()=>actions.push('end')});
assert.deepEqual(actions,['resume','sync','end']);
const pauseMarkup = main.match(/pauseScreen.innerHTML = '([^']+)';/)[1];
assert.match(pauseMarkup, /<details id="pauseKeys"><summary>Keys<\/summary>/);
assert.doesNotMatch(pauseMarkup, /<pre|<details[^>]* open/);
assert.match(pauseMarkup, /id="resumeGame">Resume · Esc/);
assert.match(main, /pauseButton.hidden = !started \|\| bare/);
assert.match(main, /querySelectorAll<HTMLElement>\('button:not\(\[disabled\]\):not\(\[hidden\]\), a\[href\], summary'\)/);
console.log('PASS pause card: closed Keys, Resume key, no HUD dump, start gate and disclosure in the Tab trap');

{
 // Run the live #settings pause wiring (syncPauseUI, capture Escape, MutationObserver) from implementation-independent anchors.
 const blockStart = main.indexOf("const settingsPanel = document.getElementById('settings')!;");
 const blockEndToken = "}).observe(settingsPanel, { attributes: true, attributeFilter: ['class'] });";
 const blockEnd = main.indexOf(blockEndToken, blockStart);
 assert.ok(blockStart >= 0 && blockEnd > blockStart, 'settings pause wiring block found');
 const blockCode = transformSync(main.slice(blockStart, blockEnd + blockEndToken.length), { loader: 'ts' }).code;
 const flush = () => new Promise(resolve => setImmediate(resolve));
 const mount = (initialClasses) => {
  const classes = new Set(initialClasses);
  const pause = new PauseGate();
  let callback, keyHandler, queued = false, focused = 'settingsClose';
  const schedule = () => { if (!queued && callback) { queued = true; queueMicrotask(() => { queued = false; callback(); }); } };
  const settingsPanel = {
   querySelector: () => ({ after() {} }),
   classList: {
    contains: k => classes.has(k),
    add(k) { if (!classes.has(k)) { classes.add(k); schedule(); } },
    remove(k) { if (classes.has(k)) { classes.delete(k); schedule(); } },
    toggle(k, force) { const want = force === undefined ? !classes.has(k) : Boolean(force); if (want) this.add(k); else this.remove(k); return want; },
   },
  };
  const node = () => ({ hidden: false, disabled: false, textContent: '', open: false, focus() {}, replaceChildren() {}, after() {} });
  const nodes = {
   settings: settingsPanel,
   gear: { ...node(), focus: () => { focused = 'gear'; } },
   resumeGame: { ...node(), focus: () => { focused = 'resumeGame'; } },
   pauseEndShift: node(), endShift: node(), pauseReplay: node(), pauseTitle: node(), pauseState: node(), pauseRadio: node(), pauseRace: node(),
  };
  const pauseScreen = { hidden: true, querySelector: () => node(), querySelectorAll: () => [] };
  const pauseButton = { addEventListener() {} };
  const sunButton = node();
  class Element { closest() { return null; } }
  const doc = {
   hidden: false, body: {}, activeElement: null,
   getElementById: id => nodes[id] ?? node(),
   querySelector: sel => sel === '#pauseKeys' || sel === '#pauseKeys dl' ? node() : null,
   createElement: () => node(),
  };
  const context = {
   pause, pauseScreen, pauseButton, sunButton, document: doc,
   touchDevice: true, mailMode: true, bare: false, DAILY: false, firedMode: false, mode: 'drive',
   keys: new Set(), pointers: new Set(), mailPointers: new Set(),
   mailRequested: false, photoRequested: false, pictureRequested: false,
   touch: { steer: 0, throttle: 0 }, flyTouch: 0,
   multiplayer: null, replay: { active: false, available: false }, sunSeeker: null,
   interiors: { busy: false }, radio: null, vehicle: { roadName: 'Mabou Harbour Road' },
   ride: { kind: 'car' }, drone: { active: false }, droneVehicle: false, gamepad: { device: 'keyboard' },
   TOUCH: [], DRIVING_TOUCH: [], KEYS: [], DRIVING_KEYS: [], DRONE_TOUCH_HELP: [], DRONE_HELP: [], DRONE_FREE_TOUCH_HELP: [], DRONE_FREE_HELP: [],
   padKeys: () => [], horseKeys: () => [], bikeKeys: () => [],
   scrollMore() {}, syncRoadScenePause() {}, openReplay: () => false, pauseAllowed: () => true,
   HTMLInputElement: Element, HTMLElement: Element,
   addEventListener: (name, fn) => { if (name === 'keydown') keyHandler = fn; },
   MutationObserver: class { constructor(fn) { callback = fn; } observe(target, options) { assert.equal(target, settingsPanel); assert.deepEqual(options, { attributes: true, attributeFilter: ['class'] }); } },
  };
  const api = new Function('context', `with(context){${blockCode}; return { syncPauseUI };}`)(context);
  return {
   pause, settingsPanel, pauseScreen, doc,
   focus: () => focused,
   gear: () => { pause.setSettings(!settingsPanel.classList.contains('open')); api.syncPauseUI(); },
   escape: () => {
    let prevented = false, stopped = false;
    keyHandler({ code: 'Escape', target: new Element(), repeat: false, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
    return { prevented, stopped };
   },
  };
 };

 // 1. Phone Full-detail crash recovery opens #settings at boot before the observer attaches.
 const boot = mount(['open']);
 boot.settingsPanel.classList.add('moreRoom'); await flush();
 assert.equal(boot.pause.blocked, false, 'moreRoom on an already-open boot notice does not pause');
 assert.equal(boot.settingsPanel.classList.contains('open'), true, 'boot notice stays open after moreRoom');
 boot.settingsPanel.classList.remove('moreRoom'); await flush();
 assert.equal(boot.pause.blocked, false, 'removing moreRoom does not pause');
 // Escape dismisses the unpaused boot notice instead of opening the Pause screen.
 const esc = boot.escape(); await flush();
 assert.ok(esc.prevented && esc.stopped, 'Escape owns boot notice dismissal');
 assert.equal(boot.settingsPanel.classList.contains('open'), false, 'Escape closes boot notice');
 assert.equal(boot.pause.blocked, false, 'Escape on boot notice keeps game running');
 assert.equal(boot.pause.screen, false, 'Escape on boot notice does not open Pause screen');
 assert.equal(boot.pauseScreen.hidden, true, 'Pause screen stays hidden');
 assert.equal(boot.focus(), 'gear', 'Escape returns focus to gear');
 // Reopening after dismissal pauses, and direct close unpauses.
 boot.settingsPanel.classList.add('open'); await flush();
 assert.equal(boot.pause.blocked, true, 'reopening #settings after dismissing boot notice pauses');
 boot.settingsPanel.classList.remove('open'); await flush();
 assert.equal(boot.pause.blocked, false, 'direct panel close unpauses');

 // 2. Same-task open via #gear followed by direct close must not leave the game frozen unseen.
 const batched = mount([]);
 batched.gear();
 batched.settingsPanel.classList.remove('open');
 await flush();
 assert.equal(batched.settingsPanel.classList.contains('open'), false);
 assert.equal(batched.pause.blocked, false, 'same-task gear open + direct close does not leave game frozen');
 assert.equal(batched.pauseScreen.hidden, true);

 // 3. Normal boot: panel starts closed, slow-picture nudge opens it and pauses, direct close unpauses.
 const normal = mount([]);
 normal.settingsPanel.classList.add('moreRoom'); await flush();
 assert.equal(normal.pause.blocked, false);
 normal.settingsPanel.classList.add('open'); await flush();
 assert.equal(normal.pause.blocked, true, 'nudge opening #settings pauses');
 normal.settingsPanel.classList.remove('open'); await flush();
 assert.equal(normal.pause.blocked, false, 'direct close after nudge unpauses');
 console.log('PASS settings observer: boot recovery ignores moreRoom, Escape dismisses without pausing, batched open+close unpauses, and nudge still pauses');
}
