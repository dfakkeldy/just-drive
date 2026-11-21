// CPU-only: actual production parser/Intl/solar solver; NOAA is an independent test oracle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, transform } from '../web/node_modules/esbuild/lib/main.js';
import { weatherMoment, weatherSettings } from '../web/src/weather.ts';
import * as study from '../web/src/light-study.ts';
import * as visit from '../web/src/visit.ts';
import { areaAddress } from '../web/src/site.ts';
import { tripParams } from '../web/src/quarry-trip.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { BikeRide } from '../web/src/bike-ride.ts';
import { placeUrlPose, safePlacement, PLACEMENT_MARGIN } from '../web/src/placement-pose.ts';
const root = process.env.MMM_ROOT ?? process.cwd();
const source = readFileSync(resolve(root, 'web/src/light-study.ts'), 'utf8');
const main = readFileSync(resolve(root, 'web/src/main.ts'), 'utf8');
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (±${tolerance})`);
const iso = (api, date, time, expected, adjustment = 'exact') => {
  const result = api.halifaxTime(date, time);
  assert.equal(result.when.toISOString(), expected, `${date} ${time}`);
  assert.equal(result.adjustment, adjustment, `${date} ${time} policy`);
};
function timezone(api) {
  iso(api, '2026-12-21', '16:30', '2026-12-21T20:30:00.000Z');
  iso(api, '2027-06-21', '13:07', '2027-06-21T16:07:00.000Z');
  for (const [year, spring, autumn] of [[2026, '03-08', '11-01'], [2027, '03-14', '11-07']]) {
    iso(api, `${year}-${spring}`, '01:30', `${year}-${spring}T05:30:00.000Z`);
    iso(api, `${year}-${spring}`, '01:59', `${year}-${spring}T05:59:00.000Z`);
    iso(api, `${year}-${spring}`, '02:30', `${year}-${spring}T06:30:00.000Z`, 'gap');
    iso(api, `${year}-${spring}`, '03:00', `${year}-${spring}T06:00:00.000Z`);
    iso(api, `${year}-${autumn}`, '00:59', `${year}-${autumn}T03:59:00.000Z`);
    iso(api, `${year}-${autumn}`, '01:30', `${year}-${autumn}T04:30:00.000Z`, 'fold');
    iso(api, `${year}-${autumn}`, '02:00', `${year}-${autumn}T06:00:00.000Z`);
  }
  // Sunday before each change is still in the old offset.
  iso(api, '2026-03-01', '03:00', '2026-03-01T07:00:00.000Z');
  iso(api, '2026-10-25', '03:00', '2026-10-25T06:00:00.000Z');
  iso(api, '2027-03-07', '03:00', '2027-03-07T07:00:00.000Z');
  iso(api, '2027-10-31', '03:00', '2027-10-31T06:00:00.000Z');
}
function scale(api) {
  const saved = () => { throw Error('Study read saved mmm.exag'); };
  assert.equal(api.studyScale(new URLSearchParams(), true, saved), 1, 'study true scale');
  assert.equal(api.studyScale(new URLSearchParams('exag=2'), true, saved), 2);
  assert.equal(api.studyScale(new URLSearchParams('exag=bad'), true, saved), 1);
  assert.equal(api.studyScale(new URLSearchParams(), false, () => '1.8'), 1.8);
}
function lighting(api) {
  for(const el of [-90,-.01,0,20]) {
    assert.equal(api.studyLightingElevation(el,false),el,'legacy lighting unchanged');
    assert.equal(api.studyLightingElevation(el,true),el<0?.5:el,'study lighting never comes from below');
  }
}
function playerLink(api, policy) {
  const pose={e:622951.3,n:5104332.1,heading:270};
  const query=api.studyQuery(new URLSearchParams('mode=explore&date=2026-12-21&time=16:30&at=old&road=old&title=1'),pose);
  assert.equal(policy.isTestVisit(query),false,'study link must preserve PLAYER title/credits/radio policy');
  assert.equal(query.get('driveAt'),'622951.3,5104332.1,270');
  assert.deepEqual(api.readDrivePosition(query),[622951.3,5104332.1,270]);
  const leave=api.studyQuery(query,pose,true);
  assert.equal(policy.isTestVisit(leave),false,'Leave study remains a player link');
  assert.equal(leave.get('driveAt'),query.get('driveAt'));
  for(const key of ['at','date','time','hour','exag'])assert.equal(leave.has(key),false,`Leave removes ${key}`);
  const restored=api.studyQuery(new URLSearchParams('date=2026-12-21&exag=1.7'),pose,true);assert.equal(api.studyScale(restored,false,()=> '2.3'),2.3,'Leave restores saved hill height');
  assert.equal(policy.isTestVisit(new URLSearchParams('at=622951,5104332,292')),true,'legacy at test meaning unchanged');
}
function placementRead(api) {
  const origin=[624000,5104000], bounds=[-5000,-5000,5000,5000];
  for(const text of ['1e20,1e20,0','Infinity,5104000,0','NaN,5104000,0','1e12,1e12,0'])assert.equal(api.readDrivePosition(new URLSearchParams({driveAt:text})),undefined,'unsafe numeric driveAt rejected');
  for(const text of ['640000,5104000,0','635000,5070000,0'])assert.equal(api.readDrivePosition(new URLSearchParams({driveAt:text}),origin,bounds),undefined,'outside current area rejected');
  assert.deepEqual(api.readDrivePosition(new URLSearchParams('driveAt=622951,5104332,292'),origin,bounds),[622951,5104332,292]);
}
function leaveVisibility(api) {
  class Element {
    children=[];hidden=false;value='';style={};open=false;
    append(...nodes){this.children.push(...nodes);}appendChild(node){this.append(node);return node;}
    insertBefore(node){this.children.unshift(node);}get firstChild(){return this.children[0]??null;}
    addEventListener(){} replaceChildren(...nodes){this.children=nodes;}
    set innerHTML(_html){this.nodes={'[type=date]':new Element(),'[type=time]':new Element(),button:new Element(),'.lightLeave':new Element(),output:new Element(),'.lightClock':new Element()};}
    querySelector(key){return this.nodes[key];}
  }
  const names=['document','HTMLInputElement'],old=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  try{
    const panel=new Element();globalThis.document={head:new Element(),createElement:()=>new Element(),getElementById:id=>id==='settings'?panel:null};globalThis.HTMLInputElement=Element;
    api.lightStudyUI(api.readLightStudy(new URLSearchParams(),true),new Date('2026-10-10T19:45:00Z'),46.07,-61.39);
    assert.equal(panel.firstChild.querySelector('.lightLeave').hidden,true,'Leave must be hidden in plain play');
  }finally{names.forEach((name,i)=>{if(old[i])Object.defineProperty(globalThis,name,old[i]);else delete globalThis[name];});}
}
const ZONES = ['UTC', 'America/Halifax', 'Europe/Berlin'];
async function moduleUrl(contents) {
  const result = await build({stdin:{contents,loader:'ts',resolveDir:resolve(root,'web/src')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
  return 'data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64');
}
const visitUrl = await moduleUrl(readFileSync(resolve(root,'web/src/visit.ts'),'utf8'));
function zoneRun(url, zone) {
  const script = `import assert from 'node:assert/strict';
    const savedIntl=globalThis.Intl; globalThis.Intl=undefined;
    let api; try { api=await import(${JSON.stringify(url)}); } catch(error) { assert.fail('module import must work without Intl: '+error.message); }
    const params=new URLSearchParams('date=2026-12-21&time=16:30');
    for(const unavailable of [undefined,{DateTimeFormat:class {constructor(){throw new RangeError('missing Halifax zone');}}}]) {
      globalThis.Intl=unavailable;const notes=[];
      const result=api.readLightStudy(params,true,note=>notes.push(note));
      assert.equal(result.active,false,'missing Intl deactivates study');assert.match(result.message,/Halifax time-zone data/);assert.equal(notes.length,1);
      assert.equal(api.readLightStudy(new URLSearchParams(),true).active,false,'no-date boot needs no Intl');
    }
    globalThis.Intl=savedIntl;
    const iso=${iso};const timezone=${timezone};const scale=${scale};const lighting=${lighting};timezone(api);scale(api);lighting(api); const policy=await import(${JSON.stringify(visitUrl)}); const playerLink=${playerLink};playerLink(api,policy);`;
  const probes = `import assert from 'node:assert/strict'; const api=await import(${JSON.stringify(url)});const policy=await import(${JSON.stringify(visitUrl)});const iso=${iso},timezone=${timezone},scale=${scale},lighting=${lighting},playerLink=${playerLink},placementRead=${placementRead},leaveVisibility=${leaveVisibility};timezone(api);scale(api);lighting(api);playerLink(api,policy);placementRead(api);leaveVisibility(api);`;
  const combined = script + `
const placementRead=${placementRead},leaveVisibility=${leaveVisibility};placementRead(api);leaveVisibility(api);
const {spawnSync}=await import('node:child_process');for(const zone of ['UTC','Europe/Berlin']){const run=spawnSync(process.execPath,['--input-type=module'],{input:${JSON.stringify(probes)},encoding:'utf8',env:{...process.env,TZ:zone}});assert.equal(run.status,0,'cross-zone probe '+zone+': '+run.stderr);}`;
  return spawnSync(process.execPath,['--input-type=module'],{input:combined,encoding:'utf8',env:{...process.env,TZ:zone},maxBuffer:4*1024*1024});
}
const baselineUrl = await moduleUrl(source);
for (const zone of ZONES) { const run=zoneRun(baselineUrl,zone);assert.equal(run.status,0,`baseline ${zone}: ${run.stderr}`);console.log(`ZONE baseline | ${zone} | exit ${run.status}`); }
timezone(study); scale(study); playerLink(study,visit);
const nextArea=new URL(areaAddress({brand:'mail',area:null},'judique','/',new URLSearchParams('mode=explore&date=2026-12-21&driveAt=622951,5104332,292')),'https://example.test');
assert.equal(nextArea.searchParams.has('driveAt'),false,'area changes cannot reuse another area’s projected position');assert.equal(nextArea.searchParams.get('date'),'2026-12-21');
console.log('PASS Halifax: both 2026/2027 switch nights; spring 01:30 exists, 02:30 → 03:30; autumn 01:30 chooses earlier ADT.');
const bootSource = main.slice(main.indexOf('const weather ='), main.indexOf('// Fixed views'));
assert.match(bootSource, /lightStudy\.active \? null/);
const bootImpl = new Function('params', 'mailMode', 'localStorage', 'readLightStudy', 'studyScale', 'weatherMoment', 'weatherSettings', `${bootSource}\nreturn { when, EXAG, lightStudy };`);
const boot = (...args) => bootImpl(...args, weatherMoment, weatherSettings);
for (const hour of ['16.75', '0', '-2', '24', '6.12345']) {
  for (const saved of [null, '2.1', 'bad']) {
    const result = boot(new URLSearchParams({hour}), false, {getItem: () => saved}, study.readLightStudy, study.studyScale);
    // A tool hour in the day keeps the instant of the old fixed UTC-3 formula, to the millisecond; any other value gives the game's own 16:45.
    assert.equal(+result.when, Date.UTC(2026, 9, 10, 3) + (+hour >= 0 && +hour < 24 ? parseFloat(hour) : 16.75) * 3600e3, 'exact legacy hour');
    assert.equal(result.EXAG, saved === '2.1' ? 2.1 : 1.5);
  }
}
assert.equal(boot(new URLSearchParams(), false, {getItem: () => null}, study.readLightStudy, study.studyScale).when.toISOString(), '2026-10-10T19:45:00.000Z');
const query = new URLSearchParams('date=2026-12-21&time=16:30');
const active = boot(query, false, {getItem: () => { throw Error('saved scale read'); }}, study.readLightStudy, study.studyScale);
assert.equal(active.EXAG, 1); assert.equal(active.when.toISOString(), '2026-12-21T20:30:00.000Z');
const mail = boot(query, true, {getItem: () => '2'}, study.readLightStudy, study.studyScale);
assert.equal(mail.EXAG, 2); assert.equal(mail.when.toISOString(), '2026-10-10T19:45:00.000Z');
assert.match(main, /if \(!mailMode && !bare\) lightStudyUI\(lightStudy, when, lat, lon, \(\) =>/);
assert.match(main, /AREA\.fixedSun \? \{ lat: LAT, lon: LON \} : utm20ToLatLon\(\.\.\.manifest\.village\)/);
assert.equal(study.readLightStudy(new URLSearchParams('time=12:00'), true).active, false);
for (const date of ['', '2026-02-30', '2026-2-03', 'not-a-date', '2026-13-01', '0000-01-01', '2027-02-29', '1879-12-31', '2201-01-01', '9999-12-31']) {
  const notes = [];
  assert.equal(study.readLightStudy(new URLSearchParams({date}), true, note => notes.push(note)).active, false);
  assert.equal(notes.length, 1, 'invalid date notes fallback');
}
assert.equal(study.validStudyDate('2028-02-29'), true);
assert.equal(study.validStudyDate('1880-01-01'),true);assert.equal(study.validStudyDate('2200-12-31'),true);
assert.equal(study.readLightStudy(new URLSearchParams('date=2026-12-21&hour=16.5'),true).time,'16:30');
assert.equal(study.readLightStudy(new URLSearchParams('date=2026-12-21&hour=22'),true).time,'22:00');
const badHour=study.readLightStudy(new URLSearchParams('date=2026-12-21&hour=-2'),true,()=>{});
assert.equal(badHour.date,'2026-12-21');assert.equal(badHour.time,'16:45');assert.match(badHour.message,/invalid hour/);
for(const hour of ['-2','bad','Infinity','24']){const result=study.readLightStudy(new URLSearchParams({date:'2026-12-21',hour}),true,()=>{});assert.equal(result.date,'2026-12-21');assert.equal(result.when.toISOString(),'2026-10-10T19:45:00.000Z','invalid hour has a safe game fallback');}
for(const value of ['bad','1,2',',,','1,2,Infinity','1,2,3,4'])assert.equal(study.readDrivePosition(new URLSearchParams({driveAt:value})),undefined);
assert.match(main,/const at = params.get\('at'\)\?\.split\(','\)\.map\(Number\);/);
assert.match(main,/!mailMode && !params.has\('at'\) \? readDrivePosition\(params, manifest.village, vehicle.bounds\) : undefined/);
lighting(study);
assert.match(main,/const chosenClock = lightStudy\.active \|\| weather\.chosen;/);
assert.match(main,/directionFromAngles\(sun.az, studyLightingElevation\(sun.el, chosenClock\)\)/);
for (const time of ['', '24:00', '12:60', '1:30']) assert.equal(study.readLightStudy(new URLSearchParams({date:'2026-12-21',time}), true, () => {}).active, false);
assert.equal(study.readLightStudy(new URLSearchParams('date=2026-12-21'), true).time, '16:45');
assert.equal(study.readLightStudy(new URLSearchParams('date=2026-03-08&time=02:30'), true).time, '03:30');
// Mount the real UI in a tiny event-capable document, with the original main.ts slider listener.
// This checks the observable storage/reload contract without a renderer or copied UI implementation.
{
  class Element {
    listeners = []; children = []; textContent = ''; value = ''; open = false;
    constructor(tag) { this.tag = tag; }
    addEventListener(name, callback, capture = false) { this.listeners.push({name,callback,capture}); }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); return node; }
    insertBefore(node, before) { this.children.splice(before ? this.children.indexOf(before) : 0, 0, node); }
    get firstChild() { return this.children[0] ?? null; }
    replaceChildren(...nodes) { this.children = nodes; }
    reportValidity() { return true; }
    set innerHTML(_html) {
      this.nodes = {'[type=date]':new Input('date'),'[type=time]':new Input('time'),button:new Element('button'),'.lightLeave':new Element('button'),output:new Element('output'),'.lightClock':new Element('small')};
    }
    querySelector(selector) { return this.nodes[selector]; }
  }
  class Input extends Element {}
  const names = ['document','HTMLInputElement','location','localStorage','Intl'];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis,name));
  try {
    for (const scenario of ['active','hour-only','plain','invalid','bad-hour','unavailable']) {
      const active=scenario==='active'||scenario==='hour-only';
      const api=scenario==='unavailable'?await import(await moduleUrl(source+'\n// unavailable UI fixture')):study;
      if(scenario==='unavailable')Object.defineProperty(globalThis,'Intl',{configurable:true,value:undefined});
      const panel = new Element('div'), slider = new Input('range'); slider.id='exag';
      const nodes = {settings:panel,exag:slider,exagValue:new Element('span'),gear:new Element('button')};
      let search=scenario==='hour-only'?'?date=2026-12-21&hour=22&radio=off':'?date=2026-12-21&time=16:30&hour=4&radio=off&road=old&cam=old&shot=1&title=1', saved='2.3', writes=0;
      const doc = {head:new Element('head'),createElement:tag=>new Element(tag),getElementById:id=>nodes[id]??null};
      Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
      Object.defineProperty(globalThis,'HTMLInputElement',{configurable:true,value:Input});
      Object.defineProperty(globalThis,'location',{configurable:true,value:{get search(){return search;},set search(value){search='?'+value;},reload(){}}});
      Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;writes++;}}});
      const state=api.readLightStudy(new URLSearchParams(scenario==='hour-only'?'date=2026-12-21&hour=22':scenario==='invalid'?'date=9999-12-31':scenario==='bad-hour'?'date=2026-12-21&hour=-2':scenario==='plain'?'':'date=2026-12-21&time=16:30'),true,()=>{});
      api.lightStudyUI(state, active?state.when:new Date('2026-10-10T19:45:00Z'),46.07,-61.39,()=>({e:624321.125,n:5103210.5,heading:217.25}));
      const mounted=panel.firstChild;assert.equal(mounted.open,active||!!state.message,'active studies and boot errors open the section');
      assert.match(mounted.querySelector('.lightClock').textContent,/24-hour/);
      assert.equal(mounted.querySelector('.lightLeave').hidden,!state.active&&!state.message,'Leave visibility follows study state');
      if(scenario==='bad-hour') {assert.equal(mounted.querySelector('[type=date]').value,'2026-12-21');assert.match(state.message,/invalid hour/);}
      if(scenario==='invalid'||scenario==='bad-hour'||scenario==='unavailable') {
        const output=mounted.querySelector('output');assert.ok((output.textContent+output.children.map(p=>p.textContent).join(' ')).includes(state.message),'fallback message visible in output');
        continue;
      }
      const legacy=(await transform(main.slice(main.indexOf('// ---- settings '),main.indexOf('// ---- loop ')),{loader:'ts'})).code;
      new Function('EXAG','stored',legacy)(active?1:2.3, active?null:saved);
      const fire=(target,name,ancestors=[])=>{
        const event={target,stopped:false,stopImmediatePropagation(){this.stopped=true;},stopPropagation(){this.stopped=true;}};
        for(const ancestor of ancestors) for(const entry of ancestor.listeners.filter(l=>l.name===name&&l.capture)) { entry.callback(event); if(event.stopped)return event; }
        for(const entry of target.listeners.filter(l=>l.name===name)) { entry.callback(event); if(event.stopped)break; }
        return event;
      };
      slider.value='1.7'; fire(slider,'change',[panel]);
      assert.equal(writes,active?0:1,'study slider never saves; ordinary slider still saves');
      assert.equal(saved,active?'2.3':'1.7');
      if(scenario==='hour-only')assert.equal(new URLSearchParams(search).get('time'),'22:00','slider canonicalizes legacy hour without changing study time');
      if(active) { assert.equal(new URLSearchParams(search).get('exag'),'1.7'); assert.equal(new URLSearchParams(search).get('mode'),'explore'); }
      const control=panel.firstChild; control.open=true; fire(control,'toggle');
      control.querySelector('[type=date]').value='1884-06-21';fire(control.querySelector('[type=date]'),'change');
      assert.ok(control.querySelector('output').children.some(p=>p.textContent==='Before 15 June 1902 Halifax kept local mean time (GMT−4:14:24).'));
      for(const [dateValue,shown] of [['1902-06-14',true],['1902-06-15',false]]){control.querySelector('[type=date]').value=dateValue;fire(control.querySelector('[type=date]'),'change');assert.equal(control.querySelector('output').children.some(p=>p.textContent.startsWith('Before 15 June 1902')),shown);}
      control.querySelector('[type=date]').value=state.date;fire(control.querySelector('[type=date]'),'change');
      assert.equal(control.querySelector('output').children.some(p=>p.textContent.startsWith('Before 15 June 1902')),false);
      if(active) assert.ok(control.querySelector('output').children.some(p=>p.textContent==='Night look: head lamps, lamp light and stars. No moon.'));
      assert.equal(fire(control,'keydown').stopped,true,'field keys cannot steer or change shot');
      assert.equal(fire(control,'keyup').stopped,false,'key releases still clear previously held driving keys');
      control.querySelector('[type=date]').value='2027-06-21'; control.querySelector('[type=time]').value='13:07';
      fire(control.querySelector('[type=time]'),'change');
      assert.ok(control.querySelector('output').children.some(p=>p.textContent==='Apply to see it.'));
      assert.ok(control.querySelector('output').children.some(p=>p.textContent.startsWith('At this time ')));
      fire(control.querySelector('button'),'click');
      const applied=new URLSearchParams(search);
      assert.equal(applied.get('date'),'2027-06-21'); assert.equal(applied.get('time'),'13:07');
      assert.equal(applied.has('hour'),false); assert.equal(applied.get('radio'),'off'); assert.equal(applied.get('mode'),'explore','shared mail-site link retains explore without saved preferences');
      assert.equal(applied.get('driveAt'),'624321.125,5103210.5,217.25','Apply keeps actual vehicle pose in a PLAYER key');
      assert.equal(applied.has('at'),false);
      fire(control.querySelector('.lightLeave'),'click');
      const left=new URLSearchParams(search);assert.equal(left.get('driveAt'),applied.get('driveAt'));
      for(const key of ['date','time','hour','at','exag'])assert.equal(left.has(key),false,`Leave removes ${key}`);
      assert.equal(api.studyScale(left,false,()=>saved),Number(saved),'Leave restores saved exag');
      for(const key of ['road','cam','shot','title'])assert.equal(applied.has(key),false,`${key} cannot override saved position`);
      assert.equal(writes,active?0:1,'Apply never saves hill height');
    }
  } finally { names.forEach((name,i)=>{if(originals[i])Object.defineProperty(globalThis,name,originals[i]);else delete globalThis[name];}); }
  console.log('PASS real UI + original slider: study leaves saved scale intact, Apply shares/reloads, night notice, field keys isolated.');
}
// Execute main's actual startup block against refusal-aware placement, with no grid work for unsafe inputs.
const startup = (await transform(main.slice(main.indexOf('const placeVisit ='),main.indexOf('scene.add(shift.group)')),{loader:'ts',define:{'import.meta.env.DEV':'false'}})).code;
const bootPose = new Function('params','mailMode','vehicle','manifest','roads','journey','placeFirstStop','readDrivePosition','placeUrlPose','startKey','placeAtStart','const fleet=null, airportDrag=null;\n'+startup);
// The block also reads the ?start= key (web/src/start-key.ts). These addresses have none, so no start place may be used.
const noStartKey=()=>null, noStartPlace=()=>{throw Error('a start place was used with no start key');};
const origin=[624000,5104000], bounds=[-5000,-5000,5000,5000];
for(const key of ['driveAt','at'])for(const text of ['1e20,1e20,0','1e12,1e12,0','Infinity,5104000,0','NaN,5104000,0','640000,5104000,0','635000,5070000,0'])for(const hasJourney of [false,true]) {
  let placements=0,normal=0,trips=0;const vehicle={bounds,place(){placements++;throw Error('unsafe placement reached sampling');}};
  bootPose(new URLSearchParams({[key]:text}),false,vehicle,{village:origin},{roads:[]},hasJourney?{place(){trips++;}}:null,()=>normal++,study.readDrivePosition,placeUrlPose,noStartKey,noStartPlace);
  assert.equal(placements,0,`${key} ${text} never samples unsafe point`);assert.equal(normal,hasJourney?0:1);assert.equal(trips,hasJourney?1:0);
}
for(const refusal of [false,undefined,true]){
  let normal=0,placements=0;bootPose(new URLSearchParams('driveAt=622951,5104332,292'),false,{bounds,place(){placements++;return refusal;}},{village:origin},{roads:[]},null,()=>normal++,study.readDrivePosition,placeUrlPose,noStartKey,noStartPlace);
  assert.equal(placements,1);assert.equal(normal,refusal===true?0:1,'refused or void placement falls through');
}
for(const Type of [Vehicle,BikeRide]) {
  for(const values of [[1e20,1e20,0],[Infinity,0,0],[NaN,0,0],[0,0,Infinity],[6000,0,0]]) {
    let guards=0;const fake={bounds,placementGuard(){guards++;throw Error('guard touched unsafe pose');},get placementPose(){throw Error('unsafe scratch accessed');}};
    assert.equal(Type.prototype.place.call(fake,...values),false);assert.equal(guards,0,'root check precedes guard and terrain/grid access');
  }
  const fake={bounds,placementPose:{},placementGuard(pose){pose.x=1e20;return true;}};
  assert.equal(Type.prototype.place.call(fake,0,0,0),false,'guard-modified unsafe pose is refused too');
}
assert.equal(safePlacement(5000+PLACEMENT_MARGIN,0,0,bounds),true);assert.equal(safePlacement(5001+PLACEMENT_MARGIN,0,0,bounds),false);
assert.equal(tripParams(new URLSearchParams('trip=quarry&driveAt=622951,5104332,292')).has('driveAt'),false,'new trip clears carried position');
console.log('PASS hostile/refused driveAt and legacy at startup fallback; both ride roots reject before grid access; trip drops driveAt.');
// Highest sun is not fixed at 12:00. Sunrise/sunset are level-horizon crossings, not terrain occlusion.
const minute = date => { const [h,m] = study.localTime(date).split(':').map(Number); return h*60+m+date.getUTCSeconds()/60; };
const expected = [
  {date:'2026-12-21',rise:465,riseAz:124,set:983,setAz:236,noon:724,el:20.5},
  {date:'2027-06-21',rise:315,riseAz:54,set:1261,setAz:306,noon:787,el:67.4},
];
// NOAA GML General Solar Position Calculations, fractional-year equations, independently coded.
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF (read 2026-11-13); horizon explicitly -0.83° here.
function noaa(date, lat, lon, offset) {
  const rad = Math.PI/180, midnight = +new Date(date+'T00:00:00Z');
  const year = +date.slice(0,4), day = Math.round((midnight-Date.UTC(year,0,1))/864e5)+1;
  const days = (Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/864e5;
  function terms(minutes) {
    const g = 2*Math.PI/days*(day-1+(minutes/60-12)/24);
    return {eq:229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g)),
      dec:.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g)};
  }
  const event = sign => {
    let t = 720-4*lon;
    for(let i=0;i<6;i++) {
      const {eq,dec} = terms(t);
      const ha = Math.acos((Math.cos(90.83*rad)-Math.sin(lat*rad)*Math.sin(dec))/(Math.cos(lat*rad)*Math.cos(dec)))/rad;
      t = 720-4*lon-eq+sign*4*ha;
    }
    const {eq,dec} = terms(t), ha = (t+eq+4*lon)/4-180;
    const az = ((Math.atan2(Math.sin(ha*rad), Math.cos(ha*rad)*Math.sin(lat*rad)-Math.tan(dec)*Math.cos(lat*rad))/rad+180)%360+360)%360;
    return {time:t+offset*60,az};
  };
  let t=720-4*lon; for(let i=0;i<6;i++) t=720-4*lon-terms(t).eq;
  return {rise:event(-1),set:event(1),noon:t+offset*60,el:90-lat+terms(t).dec/rad};
}
for (const row of expected) {
  const day = study.ephemeris(row.date, 46.07, -61.39), oracle = noaa(row.date,46.07,-61.39,row.date.startsWith('2026')?-4:-3);
  assert.ok(day.sunrise && day.sunset);
  near(day.sunrise.el, study.HORIZON, 0.00001, 'sunrise horizon');
  near(day.sunset.el, study.HORIZON, 0.00001, 'sunset horizon');
  const actual = {rise:minute(day.sunrise.when),riseAz:day.sunrise.az,set:minute(day.sunset.when),setAz:day.sunset.az,noon:minute(day.highest.when),el:day.highest.el};
  for (const key of ['rise','set','noon']) near(actual[key],row[key],1,`${row.date} expected ${key}`);
  for (const key of ['riseAz','setAz','el']) near(actual[key],row[key],1,`${row.date} expected ${key}`);
  near(actual.rise,oracle.rise.time,2,'NOAA sunrise'); near(actual.set,oracle.set.time,2,'NOAA sunset'); near(actual.noon,oracle.noon,2,'NOAA noon');
  near(actual.riseAz,oracle.rise.az,1,'NOAA rise azimuth'); near(actual.setAz,oracle.set.az,1,'NOAA set azimuth'); near(actual.el,oracle.el,1,'NOAA height');
  console.log(JSON.stringify({date:row.date,actual,expected:row,noaa:oracle,differenceMinutes:{rise:actual.rise-oracle.rise.time,set:actual.set-oracle.set.time,noon:actual.noon-oracle.noon}}));
}
// Clock-change local days still produce ordered, local-date events.
for (const date of ['2026-03-08','2026-11-01']) {
  const day = study.ephemeris(date,46.07,-61.39);
  assert.ok(+day.sunrise.when < +day.highest.when && +day.highest.when < +day.sunset.when);
}
console.log('PASS ephemeris, expected numbers, NOAA, URL fallback, mail unchanged and exact original boot moment/scale.');

if (process.argv.includes('--mutations')) {
  const wall = 'const wall = +new Date(`${date}T${time}:00Z`);';
  const mutants = [
    ['M1 parse without Z',source.replace(wall,'const wall = +new Date(`${date}T${time}:00`);'),[1,1,1]],
    ['M2 fixed UTC-3',source.replace(wall,'return {when:new Date(+new Date(`${date}T${time}:00Z`)+3*3600e3),adjustment:"exact"}; '+wall),[1,1,1]],
    ['M3 scale not forced',source.replace("active ? '1' : saved() ?? '1.5'","active ? '1.5' : saved() ?? '1.5'"),[1,1,1]],
    ['M4 DST wrong Sunday',source.replace(wall,wall+" if(date >= '2026-03-08' && date < '2026-03-15') return {when:new Date(wall+4*3600e3),adjustment:'exact'};"),[1,1,1]],
    ['M5 eager Intl',source.replace('let cachedFormats:',"new Intl.DateTimeFormat('en-CA',{timeZone:HALIFAX});\nlet cachedFormats:"),[1,1,1]],
    ['M6 viewer time zone',source.replaceAll('timeZone: HALIFAX, ',''),[1,1,1]],
    ['M7 light below ground',source.replace('active && elevation < 0 ? 0.5 : elevation','elevation'),[1,1,1]],
    ['M8 study uses at',source.replace("query.set('driveAt',","query.set('at',"),[1,1,1]],
    ['R7 Leave visible in plain play',source.replace('leave.hidden = !study.active && !study.message','leave.hidden = false'),[1,1,1]],
    ['M9 unsafe driveAt parser',source.replace('if (!finitePose(values[0], values[1], values[2])) return undefined;',''),[1,1,1]],
  ];
  console.log('MUTATION | UTC | America/Halifax | Europe/Berlin');
  for(const [name,changed,expected] of mutants) {
    assert.notEqual(changed,source,`${name} source mutation exists`);
    const url=await moduleUrl(changed),codes=[];
    for(const [i,zone] of ZONES.entries()) {
      const run=zoneRun(url,zone);codes.push(run.status);assert.equal(run.status,expected[i],`${name} ${zone}: ${run.stderr}`);
      if(run.status===1)assert.match(run.stderr,/AssertionError/,`${name} behavioral rejection`);
    }
    assert.ok(codes.includes(1),`${name} must be killed by the combined zones`);
    console.log(`${name} | ${codes.join(' | ')}`);
  }
}
