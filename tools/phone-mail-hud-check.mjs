#!/usr/bin/env node
// Adapter contract only. Geometry and painted controls belong to phone-hud-browser.mjs.
import { build } from '../web/node_modules/esbuild/lib/main.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mainSource=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8');
const {outputFiles:coreFiles}=await build({stdin:{contents:"export {Vehicle} from './web/src/vehicle.ts'; export {Object3D} from './web/node_modules/three/build/three.module.js'; export {hudLine} from './web/src/hud-text.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {Vehicle,Object3D,hudLine}=await import('data:text/javascript;base64,'+Buffer.from(coreFiles[0].text).toString('base64'));
async function load(from, to) {
  const source=readFileSync(new URL('../web/src/phone-mail-hud.ts',import.meta.url),'utf8');
  if(from) assert.equal(source.split(from).length,2,'unique adapter mutation site');
  const {outputFiles}=await build({stdin:{contents:"export { PhoneMailHud } from './web/src/phone-mail-hud.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',plugins:[{name:'adapter-fault',setup(b){b.onLoad({filter:/phone-mail-hud\.ts$/},()=>({contents:from?source.replace(from,to):source,loader:'ts'}));}}]});
  return (await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))).PhoneMailHud;
}
function verify(PhoneMailHud, main=mainSource) {
function fixture(saved,blocked=false) {
  const all=[], store=new Map(saved===null?[]:[['mmm.throwHelp',saved]]);
  class Element {
    children=[]; parentElement=null; id=''; textContent=''; style={}; listeners={}; classes=new Set();
    classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};
    constructor(){ all.push(this); }
    appendChild(e){ if(e.parentElement) e.parentElement.children=e.parentElement.children.filter(c=>c!==e); this.children.push(e); e.parentElement=this; return e; }
    append(...elements){ for(const e of elements) this.appendChild(typeof e==='string'?Object.assign(new Element(),{textContent:e}):e); }
    insertBefore(e,before){ this.appendChild(e); this.children.pop(); this.children.splice(this.children.indexOf(before),0,e); }
    addEventListener(event,fn){ this.listeners[event]=fn; }
    click(){ this.listeners.click?.(); }
  }
  globalThis.document={head:new Element(),body:new Element(),createElement:()=>new Element(),getElementById:id=>all.find(e=>e.id===id)??null};
  const make=id=>{const e=new Element();e.id=id;return e;};
  for(const id of ['mailButton','cameraButton','gear','settings','startOver','phoneHud','phoneStatus','phoneActions']) make(id);
  document.getElementById('settings').appendChild(document.getElementById('startOver'));
  globalThis.localStorage={getItem:key=>{if(blocked)throw Error('blocked');return store.get(key)??null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');store.set(key,value);}};
  return {all,store};
}
for(const saved of [null,'0','1','invalid']) for(const phone of [false,true]) for(const blocked of [false,true]) {
  const f=fixture(saved,blocked), mail={throwHelp:true,cue:true}, ui=new PhoneMailHud(mail,phone,false);
  const expected=blocked||saved!=='0';
  assert.equal(mail.throwHelp,expected,'stored/default setting');
  const box=f.all.find(e=>e.type==='checkbox'); assert.ok(box); assert.equal(box.checked,expected);
  box.checked=false; box.listeners.change(); assert.equal(mail.throwHelp,false); if(!blocked)assert.equal(f.store.get('mmm.throwHelp'),'0');
  box.checked=true; box.listeners.change(); assert.equal(mail.throwHelp,true);
  const shift={endsAtSix:true,elapsed:0,career:{day:1},done:2,stops:80,run:{short:'HILL LOOP'}};
  const v={speed:10,activeTouchSpeedLimit:0,roadName:'Hill Road'};
  ui.update(shift,v,true); assert.ok(document.getElementById('mailButton').classList.contains('throwNow'));
  ui.update(shift,v,false); assert.ok(!document.getElementById('mailButton').classList.contains('throwNow'));
  if(!phone) { assert.ok(!document.body.classList.contains('mailPhone')); assert.equal(document.getElementById('phoneLine'),null); continue; }
  assert.match(document.getElementById('phoneLine').textContent,/36 km\/h · D1 2\/80/);
  assert.match(document.getElementById('phoneLine').textContent,/10:00 → 18:00 · Hill Road/);
  shift.endsAtSix=false;ui.update(shift,v,true);assert.ok(!document.getElementById('phoneLine').textContent.includes('→'));shift.endsAtSix=true;
  for(const limit of [90/3.6,0,100/3.6,0]) {
    v.activeTouchSpeedLimit=limit; ui.update(shift,v,true);
    assert.equal(document.getElementById('phoneLine').textContent.includes('LIMIT'),limit>0,'visible phone status follows limiter');
    if(limit)assert.match(document.getElementById('phoneLine').textContent,new RegExp('^36 km/h ▸ LIMIT '+Math.round(limit*3.6)+' · D1'));
    ui.update(shift,v,false); assert.ok(!document.getElementById('phoneLine').textContent.includes('LIMIT'),'no marker outside driving');
  }
  shift.elapsed=399; ui.update(shift,v,true); assert.ok(!document.body.classList.contains('introDone'),'19.95 seconds');
  shift.elapsed=400; ui.update(shift,v,true); assert.ok(document.body.classList.contains('introDone'),'20 seconds');
  shift.elapsed=0; ui.update(shift,v,true); assert.ok(!document.body.classList.contains('introDone'),'same-day restart');
  for(const id of ['cameraButton','gear']) {
    document.getElementById(id).click(); ui.update(shift,v,true); assert.ok(document.body.classList.contains('introDone'),id+' dismisses hint');
    shift.career.day++; shift.elapsed=0; ui.update(shift,v,true); assert.ok(!document.body.classList.contains('introDone'),'new shift');
  }
}
// Execute the production pause predicate, credits callback, physics gate and both HUD adapters.
// A real car retains its cap telemetry while paused; only the actual main expressions may hide it.
fixture(null);
const ui=new PhoneMailHud({throwHelp:true,cue:true},true,false), node=()=>new Object3D();
const rig={root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
const terrain={heightAt:()=>100,withContactHeight:(_,read)=>read(),withGroundContact:(_,read)=>read(),surfaceAt:()=>({ground:100,canopy:0,kind:2,washboard:false,roadDist:0,halfWidth:3,level:8})};
const roads={roads:[],nearest:()=>null,deckHeight:()=>null}, v=new Vehicle(rig,terrain,roads,0);
v.strongHelp=true; v.place(0,0,0);
let updates=0; const update=v.update; v.update=function(...args){updates++;return update.apply(this,args);};
const ctx={started:true,mode:'drive',shift:{ended:false,elapsed:0,career:{day:1},done:0,stops:80,run:{short:'HILL LOOP'}},endings:{busy:false},interiors:{busy:false},document,
  touch:{steer:0,throttle:1},keys:new Set(['KeyW']),roadScene:{setPaused(){}},title:{open(){}},terrain,vehicle:v,ride:{input:input=>input},resolveYardSolids:()=>{},fleet:null,towing:null,aiDriver:null,aiDriverOn:()=>false,boss:null,multiplayer:null,syncRoadScenePause:()=>{},pause:{blocked:false,resume(){}},syncPauseUI:()=>{},phoneMailHud:ui,
  hudState:{mode:'drive',mailMode:true,touchDevice:true,fps:60,speed:90/3.6,roadName:'Paved street',surfaceName:'asphalt',airborne:false,jumpLine:'',atEdge:false,showRuts:false}};
const body=(pattern,label)=>{const match=main.match(pattern);assert.ok(match,'production '+label+' found');return match[1];};
const live=body(/function live\(\): boolean \{ ([^\n]+) \}/,'live predicate');
const paused=body(/function scenePaused\(\): boolean \{ ([^\n]+) \}/,'scene pause predicate');
const drive=body(/function driveVehicle\(dt: number, input: Input\): void \{([\s\S]*?)\n\}/,'drive physics gate');
const more=body(/more.addEventListener\('click', \(\) => \{ ([^\n]+) \}\);/,'credits callback');
const phone=body(/(phoneMailHud\?\.update\([^\n]+\);)/,'phone HUD call');
const cap=body(/(hudState.activeTouchSpeedLimit = [^;]+;)/,'legacy HUD cap adapter');
const expressions=new Function('context',`with(context){function live(){${live}}return {paused:()=>{${paused}},drive:(dt,input)=>{${drive}},more:()=>{${more}},render:()=>{${phone}${cap}}};}`)(ctx);
ctx.scenePaused=expressions.paused;
const driveInput=()=>({touch:true,throttle:ctx.touch.throttle,steer:0,handbrake:false});
const render=expected=>{expressions.render();assert.equal(document.getElementById('phoneLine').textContent.includes('LIMIT'),expected,'paused phone marker');assert.equal(hudLine(ctx.hudState).includes('LIMIT'),expected,'paused legacy HUD marker');};
const hold=()=>{ctx.touch.throttle=1;v.speed=90/3.6;v.vx=0;v.vz=-v.speed;expressions.drive(1/60,driveInput());assert.equal(v.activeTouchSpeedLimit,90/3.6);render(true);};
hold(); const before=updates;
expressions.more(); assert.equal(ctx.touch.throttle,0,'real credits callback clears GO'); assert.equal(ctx.keys.size,0); assert.equal(ctx.scenePaused(),true);
expressions.drive(1/60,driveInput()); assert.equal(updates,before,'credits pauses before Vehicle.update'); assert.equal(v.activeTouchSpeedLimit,90/3.6,'paused telemetry deliberately remains held'); render(false);
ctx.started=true; expressions.drive(1/60,driveInput()); assert.equal(v.activeTouchSpeedLimit,0); render(false);
for(const [target,key] of [[ctx.shift,'ended'],[ctx.endings,'busy'],[document,'hidden'],[ctx.interiors,'busy']]) {
  hold(); const count=updates; target[key]=true; ctx.touch.throttle=0;
  expressions.drive(1/60,driveInput()); assert.equal(updates,count,'scene pause stops physics'); assert.equal(v.activeTouchSpeedLimit,90/3.6); render(false);
  target[key]=false; expressions.drive(1/60,driveInput()); render(false);
}
console.log('PASS real Vehicle cap plus production credits/pause/drive/phone and legacy HUD expressions; resume clears released GO');
fixture(null);new PhoneMailHud({throwHelp:true},false,true);
assert.equal(document.getElementById('settings').children.length,1,'bare page adds no toggle');
}
const awaitedPhone=await load();
verify(awaitedPhone);
console.log('PASS 16 storage/phone combinations, helper persistence, blocked storage, cue, 20 s hint, camera/gear dismissal and restart; desktop adapter placement intact; shared grid geometry belongs to browser rows');

if(process.argv.includes('--mutations')) for(const [name,from,to] of [
  ['end time missing',"${shift.endsAtSix ? ` → ${clock(END_TIME - START_TIME)}` : ''}",''],
  ['phone marker missing','driving ? v.activeTouchSpeedLimit : 0','0'],
  ['phone marker always shown','driving ? v.activeTouchSpeedLimit : 0','90/3.6'],
  ['phone marker outside driving','driving ? v.activeTouchSpeedLimit : 0','v.activeTouchSpeedLimit'],
]) {
  const bad=await load(from,to);
  assert.throws(()=>verify(bad),{name:'AssertionError'},name+' must fail');
  console.log('KILLED '+name);
}

if(process.argv.includes('--mutations')) for(const [name,from,to] of [
  ['phone pause gate removed', "phoneMailHud?.update(shift, vehicle, mode === 'drive' && !scenePaused());", "phoneMailHud?.update(shift, vehicle, mode === 'drive' && !shift.ended);"],
  ['legacy HUD pause gate removed', 'hudState.activeTouchSpeedLimit = scenePaused() ? 0 : vehicle.activeTouchSpeedLimit;', 'hudState.activeTouchSpeedLimit = vehicle.activeTouchSpeedLimit;'],
]) {
  assert.equal(mainSource.split(from).length,2,'unique '+name+' source site');
  assert.throws(()=>verify(awaitedPhone,mainSource.replace(from,to)),{name:'AssertionError',message:/paused.*marker/},name+' must fail the pause assertion');
  console.log('KILLED '+name);
}
