#!/usr/bin/env node
// Run: node tools/explore-mutations.mjs (owns startup); --validate checks every anchor without a browser.
// Source edits exist only in Vite transforms, never in web/src.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mutationSession, serveMutation } from './mutation-session.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), results = [];
const one=(file,from,to)=>[file,from,to];
const mutations=[
 ['title shown','explore','mode-only query shows title',[one('visit.ts',"  'animal',","  'mode', 'animal',")]],
 ['title text','explore','explore title and start text',[one('title.ts',"<h1>${explore ? name","<h1>${explore ? 'Broken title'")]],
 ['caution','explore','explore caution is visible and mail satire is absent',[one('title.ts','A toy for getting a feel for the place.','A broken note.')]],
 ['mail visibility','explore','explore hides every mail element',[one('explore.ts','{display:none!important}', '{display:block!important}')]],
 ['no mail constructors','explore','explore never creates mail-only UI',[one('main.ts','const interiors = mailMode ?','const interiors = true ?')]],
 ['no shift','explore','explore has no shift or complaints',[one('main.ts','const mail = mailMode ?','const mail = true ?')]],
 ['road start','explore','explore village start is on the main road',[one('places.ts','return start;','return { ...start, x: 0, z: 0 };')]],
 ['mail keys and clock','explore','mail keys do nothing and explore clock stays zero',[one('explore.ts','end = noop;',"end = () => { (this as { ended: boolean }).ended = true; };"),one('main.ts','if (!mailMode && exploreKey(ev.code)) return;','if (false && exploreKey(ev.code)) return;')]],
 ['damage','explore','explore damage never accrues',[one('explore.ts','override hit(): void {}',"override hit(...args: Parameters<Damage['hit']>): void { super.hit(...args); }")]],
 ['beacon','explore','explore beacon is off',[one('main.ts','!mailMode ? 0 : Math.abs','!mailMode ? 2.2 : Math.abs')]],
 ['paper','explore','explore has no paper meshes',[one('main.ts','const mail = mailMode ?','const mail = true ?')]],
 ['arrival enter','explore','arrival card appears at village',[one('places.ts','ARRIVAL_RADIUS = 85','ARRIVAL_RADIUS = 0')]],
 ['open current place','explore','open Places keeps the current village',[one('places-ui.ts','    if (this.busy) return;','')]],
 ['arrival leave','explore','arrival card leaves with player',[one('places.ts','ARRIVAL_RADIUS = 85','ARRIVAL_RADIUS = 100000')]],
 ['map marks','explore','all place marks reach minimap',[one('main.ts','if (placesUI) mapMarks.push(...placesUI.marks);','if (placesUI) mapMarks.push();')]],
 ['map labels','explore','minimap draws a few place labels',[one('main.ts','new MiniMap(roads, !mailMode,','new MiniMap(roads, false,')]],
 ['driving','explore','W drives in explore',[one('main.ts','if (!mailMode && exploreKey(ev.code)) return;',"if (!mailMode && (exploreKey(ev.code) || ev.code === 'KeyW')) return;")]],
 ['list key','explore','L opens all places',[one('places-ui.ts',"ev.code === 'KeyL'","ev.code === 'KeyK'")]],
 ['pause','explore','places panel pauses motion and clears held input',[one('main.ts','canOpen: () => started,\n  pause: paused => { started = !paused; clearEndingInput(); },','canOpen: () => started,\n  pause: paused => { started = true; clearEndingInput(); },')]],
 ['escape','explore','Escape closes places',[one('places-ui.ts',"ev.code === 'Escape'","ev.code === 'BrokenEscape'")]],
 ['road jump','explore','keyboard place choice jumps onto road at rest along road',[one('places-ui.ts','this.jumpTo(hit.x, hit.z, hit.heading);','this.jumpTo(hit.x + 20, hit.z, hit.heading + 1);')]],
 ['click jump','explore','touch/click jump harbour-view rests on road',[one('places-ui.ts','this.jumpTo(hit.x, hit.z, hit.heading);',"this.jumpTo(hit.x + (place.id === 'harbour-view' ? 20 : 0), hit.z, hit.heading);")]],
 ['storage','switch','switch saves explore and reloads consistent query',[one('mode.ts','localStorage.setItem(KEY, mode);',"localStorage.setItem(KEY, 'mail');")]],
 ['query','switch','switch saves mail and reloads consistent query',[one('mode.ts',"query.set('mode', mode)","query.set('mode', 'explore')")]],
 ['saved reload','switch','switch survives a host without a mode query',[one('mode.ts','if (valid(saved)) return saved;','if (valid(saved)) return \'mail\';')]],
 ['phone hidden','phone','phone 844 has no mail controls',[one('explore.ts','{display:none!important}', '{display:block!important}')]],
 ['phone overlap','phone','phone 844 controls and arrival do not overlap',[one('places-ui.ts','body.tcOn #placesButton{position:static;','body.tcOn #placesButton{position:fixed!important;top:0;left:0;width:100%;height:100%;')]],
 ['phone controls','phone','phone 844 keeps driving and places controls',[one('places-ui.ts','body.tcOn #placesButton{position:static;','body.tcOn #placesButton{display:none!important;position:static;')]],
 ['phone touch','phone','phone 844 real touch places jump',[one('places-ui.ts','this.jumpTo(hit.x, hit.z, hit.heading);','this.close(false);')]],
 ['portrait hidden','phone','phone 390 has no mail controls',[one('explore.ts','{display:none!important}', '{display:block!important}')]],
 ['portrait overlap','phone','phone 390 controls and arrival do not overlap',[one('places-ui.ts','body.tcOn #placesButton{position:static;','body.tcOn #placesButton{position:fixed!important;top:0;left:0;width:100%;height:100%;')]],
 ['portrait controls','phone','phone 390 keeps driving and places controls',[one('places-ui.ts','body.tcOn #placesButton{position:static;','body.tcOn #placesButton{display:none!important;position:static;')]],
 ['portrait touch','phone','phone 390 real touch places jump',[one('places-ui.ts','this.jumpTo(hit.x, hit.z, hit.heading);','this.close(false);')]],
 ['village click jump','explore','touch/click jump village rests on road',[one('places-ui.ts','this.jumpTo(hit.x, hit.z, hit.heading);',"this.jumpTo(hit.x + (place.id === 'village' ? 20 : 0), hit.z, hit.heading);")]],
 ['mail title preservation','mail','mail title keeps its own heading, key rows, start button and satire notice',[one('title.ts',"'A route you cannot win'","'Broken mail tagline'")]],
 ['mail visibility preservation','mail','mail visible elements equal base',[one('main.ts','if (!mailMode) prepareExplore();','prepareExplore();')]],
 ['mail places exclusion','mail','mail has no places UI',[one('main.ts','const placesUI = !mailMode && !bare && (placeList.length || (ERA.modern && !!tallKey)) ?','const placesUI = !bare && (placeList.length || (ERA.modern && !!tallKey)) ?')]],
 ['mail session preservation','mail','clean profile still starts mail day one',[one('main.ts','const mail = mailMode ?','const mail = false ?')]],
 ['mail clock preservation','mail','mail clock still runs',[one('main.ts','shift.update(clockRuns ? clockDt : 0, vehicle);','shift.update(0, vehicle);')]],
];
for(const mode of ['mail','explore'])for(const[parameter,probe,from,to]of [
 ['at','at parameter works',"const at = params.get('at')?.split(',').map(Number);",'const at = undefined;'],
 ['road','road parameter works',"const named = params.get('road');",'const named = null;'],
 ['camera','fixed camera parameter works',"if (params.has('cam')) {",'if (false) {'],
 ['shot','shot parameter works',"if (SHOTS.length && params.has('shot')) applyShot",'if (false) applyShot'],
 ['demo','demo parameter works','this.demo = demo !== null ? parseFloat(demo) || 8 : 0;','this.demo = 0;'],
])mutations.push([mode+' '+parameter,'parameters',mode+' '+probe,[one(parameter === 'demo' ? 'dev-hooks.ts' : 'main.ts',from,to)]]);
for(const[family,probe]of [['mail','mail has no runtime exceptions'],['explore','explore has no runtime exceptions'],['phone','phone 844 no runtime exceptions'],['phone','phone 390 no runtime exceptions']])mutations.push(['runtime '+probe,family,probe,[one('main.ts',"document.getElementById('boot')?.remove();","document.getElementById('boot')?.remove(); setTimeout(() => { throw new Error('Explore mutation runtime fault'); }, 1000);")]]);
const documents = mutations.map(([name,,,edits]) => ({name, edits: edits.map(([file,from,to]) => ({file:'web/src/'+file,from,to}))}));
if (!await mutationSession(root, 'explore-mutations.mjs', documents, args, 'mode=explore')) {
 try {
  const selected = mutations.filter(([name]) => !process.env.MUTATION_ONLY || name.includes(process.env.MUTATION_ONLY));
  assert.ok(selected.length, 'MUTATION_ONLY matches no mutations');
  for (const [name,family,probe] of selected) {
   const marker = name + '-' + randomUUID();
   await serveMutation({...documents.find(d => d.name === name),marker}, args[1]);
   const output = await new Promise((resolve,reject) => {
    let log='';
    const p=spawn(process.execPath,[new URL('explore-check.mjs',import.meta.url).pathname,...args],{env:{...process.env,SHOTS:'0',EXPLORE_FAMILY:family,EXPLORE_PROBE:probe,EXPLORE_EXPECT_MUTATION:marker}});
    const int=()=>p.kill('SIGINT'),term=()=>p.kill('SIGTERM');
    process.on('SIGINT',int);process.on('SIGTERM',term);
    p.stdout.on('data',d=>log+=d);p.stderr.on('data',d=>log+=d);p.on('error',reject);
    p.on('close',(code,signal)=>{process.off('SIGINT',int);process.off('SIGTERM',term);resolve({code,signal,log});});
   });
   if (output.signal) throw Error('mutation interrupted: '+output.signal);
   const detected=output.code!==0&&output.log.includes('MUTATION DETECTED: '+probe);
   results.push({name,probe,detected});console.log(`${detected?'PASS':'FAIL'} mutation ${name}`);
   writeFileSync(`${args[0]}/mutation-${name.replaceAll(' ','-')}.log`,output.log);
   if (!detected) console.error(output.log.slice(-2200));
  }
  assert.ok(results.every(r=>r.detected),'mutation not detected: '+results.filter(r=>!r.detected).map(r=>r.name).join(', '));
 } finally {
  await serveMutation({edits:[]},args[1]);
  writeFileSync(`${args[0]}/browser-mutations.json`,JSON.stringify(results,null,2));
 }
 console.log(`PASS ${results.length} real-page source mutations detected without source writes`);
}
