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
