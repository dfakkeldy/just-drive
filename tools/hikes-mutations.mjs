#!/usr/bin/env node
// Negative controls. Pure bundles substitute one source edit in memory. Browser controls edit one file,
// run the relevant real-page assertion, then restore it in finally. No extra browser or server is started.
// RUN=hikes-mutations.mjs HUD=1 VIEWS="mutations|mode=explore" WEB_PORT=5243 CDP_PORT=9443 tools/yard-shots.sh 1600 1000
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const [out,first]=process.argv.slice(2), root=resolve(new URL('..',import.meta.url).pathname), work=mkdtempSync(tmpdir()+'/mmm-hikes-mutations-');
let previous=[];if(process.env.HIKES_MUTATION_FAMILY||process.env.HIKES_MUTATION_RESUME){try{previous=JSON.parse(readFileSync(out+'/hikes-mutations.json','utf8')).filter(x=>x.pass);}catch{}}
const results=[...previous];
const edit=(file,from,to)=>({file,from,to});
const pure=[
 ['missing trailhead',edit('hikes.ts',"trailhead: 'rail-access'","trailhead: 'missing'")],
 ['line outside box',edit('hikes.ts','Math.min(box[2], Math.max(box[0], a[0] + dx * t))','a[0] + dx * t + 100000')],
 ['clip rejects crossing',edit('hikes.ts','if (!valid || lo > hi)','if (!valid || lo >= 0)')],
 ['rail under 10 km',edit('hikes.ts','line: rail }','line: rail.slice(0,1) }')],
 ['rail kind filter removed',edit('hikes.ts',"r.kind === 5 && RAIL_NAMES",'RAIL_NAMES')],
 ['rail name filter removed',edit('hikes.ts',"r.kind === 5 && RAIL_NAMES.includes(r.name ?? '')","r.kind === 5")],
 ['wrong OSM path',edit('hikes.ts','osm: 117656340','osm: 117647894')],
 ['other areas get hikes',edit('hikes.ts',"if (area !== 'mabou') return [];",'')],
];
try {
 for(const [name,mutation]of ((process.env.HIKES_MUTATION_FAMILY||process.env.HIKES_MUTATION_RESUME)?[]:pure)){
  let applied=false;
  const bundle=await build({entryPoints:[root+'/tools/hikes-rules-check.mjs'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'mutation',setup(b){b.onLoad({filter:/web\/src\/hikes\.ts$/},args=>{let text=readFileSync(args.path,'utf8');if(basename(args.path)===mutation.file){if(!text.includes(mutation.from))throw Error('missing mutation '+name);text=text.replace(mutation.from,mutation.to);applied=true;}return {contents:text,loader:'ts',resolveDir:resolve(args.path,'..')};});}}]});
  const path=work+'/check.mjs';writeFileSync(path,bundle.outputFiles[0].text);
  const run=spawnSync(process.execPath,[path],{encoding:'utf8',env:{...process.env,MMM_ROOT:root}});
  const pass=applied&&run.status!==0&&/AssertionError/.test(run.stderr);
  writeFileSync(`${out}/mutation-pure-${name.replaceAll(' ','-')}.log`,run.stdout+run.stderr);results.push({name,pass,exit:run.status});console.log(`${pass?'PASS':'FAIL'} mutation ${name}`);if(!pass)throw Error('pure mutation escaped '+name);
 }
 if(process.env.HIKES_MUTATION_KIND !== 'pure') {
 const browser=[
  ['map','M opens big map',edit('big-map.ts',"ev.code === 'KeyM'","ev.code === 'KeyZ'")],
  ['map','big map pauses the game',edit('big-map.ts','this.actions.pause(true); this.root.hidden','this.actions.pause(false); this.root.hidden')],
  ['map','map owns focus and makes background inert',edit('big-map.ts','item.node.inert = true','item.node.inert = false')],
  ['map','map canvas is sharp at Retina ratio',edit('big-map.ts','Math.min(devicePixelRatio || 1, 3)','1')],
  ['map','map shows every place and hike',edit('big-map.ts','this.lines = hikes.flatMap(h => h.line ?? []);','this.lines = [];')],
  ['map','map draws road and trail names, heading, scale and north',edit('big-map.ts','private lineLabel(name: string, pts: readonly Point[], colour: string): boolean {','private lineLabel(name: string, pts: readonly Point[], colour: string): boolean { return false;')],
  ['map','idle map keeps static layer',edit('big-map.ts',"this.attachPhone(); this.button.hidden = !enabled && !this.busy || !this.phoneTop && document.body.classList.contains('tcOn');","this.attachPhone(); this.button.hidden = !enabled && !this.busy || !this.phoneTop && document.body.classList.contains('tcOn'); if(this.busy)this.redraw();")],
  ['map','map zoom buttons change scale',edit('big-map.ts','this.zoom(1.5)','this.zoom(1)')],
  ['map','drag pans the map',edit('big-map.ts','this.center = [this.center[0] - (p[0] - old[0]) / this.scale, this.center[1] + (p[1] - old[1]) / this.scale];','this.center = this.center;')],
  ['map','wheel zooms the map',edit('big-map.ts','this.zoom(Math.exp(-Math.max(-120, Math.min(120, ev.deltaY)) * .004)','this.zoom(1')],
  ['map','Escape closes map and restores background',edit('big-map.ts',"ev.code === 'Escape'","ev.code === 'Delete'")],
  ['map','key held before map does not drive after close',edit('main.ts',"canOpen: () => started && mode !== 'fly',   // in flight M is a drone key (DRONE_KEYS), not the map\n  pause: paused => { started = !paused; clearEndingInput(); },","canOpen: () => started && mode !== 'fly',   // in flight M is a drone key (DRONE_KEYS), not the map\n  pause: paused => { started = !paused; },")],
  ['map','Tab reaches every map place',edit('big-map.ts',"const b = document.createElement('button'); b.textContent = place.name;", "const b = document.createElement('button'); b.disabled = true; b.textContent = place.name;")],
  ['map','Enter opens a place card',edit('big-map.ts','if (this.busy) {',"if (this.busy) { if(ev.code==='Enter'){ev.preventDefault();return;}")],
  ['map','hike card carries facts and exact caution',edit('big-map.ts','textContent: hikeFacts(hike), className','textContent: "No facts", className')],
  ['map','map Go here rests on a road',edit('big-map.ts','this.actions.jump(hit.x, hit.z, hit.heading);','this.actions.jump(hit.x+100, hit.z+100, hit.heading);')],
  ['map','trailhead arrival adds hike facts',edit('places-ui.ts','document.createTextNode(hikeFacts(hike))','document.createTextNode("")')],
  ['map','places list has all hikes and facts',edit('places-ui.ts',"textContent: 'Hikes', style", "textContent: 'Walks', style")],
  ['map','places list has all hikes and facts',edit('places-ui.ts',"['span', hikeFacts(hike)]","['span', '']")],
  ['map','places list has all hikes and facts',edit('places-ui.ts',"['small', TRAIL_CAUTION]","['small', '']")],
  ['map','M and L typed into the weather list and time box stay with them',edit('big-map.ts',"!ev.repeat && !typing(ev) && actions.canOpen()","!ev.repeat && actions.canOpen()")],
  ['map','M and L typed into the weather list and time box stay with them',edit('places-ui.ts',"actions.canOpen() && !(ev.target instanceof HTMLElement && ev.target.closest('input,select,textarea,[contenteditable]'))","actions.canOpen()")],
  ['mail','mail M retains mail behavior',edit('main.ts',"(mailRequested || keys.has('KeyM') || keys.has('KeyE') ||","(keys.has('KeyE') ||")],
  ['map','explore corner map receives hike lines',edit('minimap.ts','this.fit();','this.hikeLines = []; this.fit();')],
  ['map','canvas click selects a trailhead',edit('big-map.ts','if (hit?.d < 24) this.showCard(hit.place);','if (hit?.d < 0) this.showCard(hit.place);')],
  ['phone','phone 844 controls do not overlap',edit('places-ui.ts','body.tcOn #placesButton{position:static;','body.tcOn #placesButton{position:fixed;left:0;top:0;')],
  ['phone','phone 844 top row has no MAP button',edit('main.ts','bigMap.phoneTop = false;','')],
  ['phone','phone 844 MAP control is reachable',edit('places-ui.ts','#placesMap{width:100%;','#placesMap{pointer-events:none;width:100%;')],
  ['phone','phone 844 touch opens map',edit('places-ui.ts','this.close(false); open();','this.close(false);')],
  ['phone','phone 844 pinch zooms',edit('big-map.ts','if (prev > 4) this.zoom','if (prev > 40000) this.zoom')],
  ['phone','phone 844 touch Go here rests on road',edit('big-map.ts',"go.addEventListener('click', () => {", "go.addEventListener('click', () => { return;")],
  ['paths','ground footpath is drawn in one mesh',edit('footpaths.ts','this.mesh.visible = pos.length > 0;','this.mesh.visible = false;')],
  ['paths','footpath follows drawn ground at exag 1',edit('footpaths.ts','heights[i]! + .025','heights[i]! + 2')],
  ['paths','footpath follows drawn ground at exag 1.5',edit('footpaths.ts','heights[i]! + .025','heights[i]! + (this.terrain.exag===1.5?2:.025)')],
  ['paths','footpath follows drawn ground at exag 3',edit('footpaths.ts','heights[i]! + .025','heights[i]! + (this.terrain.exag===3?2:.025)')],
  ['area','other area map shows only its own places and no hikes',edit('main.ts',"const placeList = history?.places ?? [...(AREA.id === 'westbay' ? westBayPlaces() : AREA.id === 'mabou' ? placesFor(manifest.village) : [...(homeSite ? homePlaces() : []), ...(churchSite ? churchPlaces() : []), ...areaPlaces(AREA.id)]), ...(cemeteries?.places ?? []), ...stuntPlaces];",'const placeList = placesFor(manifest.village);')],
  ['area','an area with its own places shows them on the map and in the list',edit('main.ts',"new BigMap(terrain, roads, placeList.filter(p => !p.trip), hikes,","new BigMap(terrain, roads, [], hikes,")],
  ['mail','mail corner map receives no hikes or planning UI',edit('main.ts',"hikes = mailMode || !ERA.modern ? [] : hikesFor", "hikes = hikesFor")],
  ['mail','mail M retains mail behavior',edit('main.ts',"if (!mailMode && exploreKey(ev.code)) return;","if (ev.code==='KeyM') { shift.elapsed = 0; shift.ended = true; return; } if (!mailMode && exploreKey(ev.code)) return;")],
 ];
 browser.push(['repeat','map ignores held-key repeat after Escape',edit('big-map.ts','this.suppressed.has(ev.code)','false')]);
 browser.push(['repeat','released key drives again',edit('big-map.ts','this.suppressed.delete(ev.code);','void ev.code;')]);
 for(const family of ['map','phone','paths','area','mail','repeat']) browser.push([family,`${family} ${family==='phone'?844:1600} has no runtime errors`,edit('main.ts',"resize();\ndocument.getElementById('boot')?.remove();","resize();\nsetTimeout(()=>{throw Error('negative runtime control')},500);\ndocument.getElementById('boot')?.remove();")]);
 for(const entry of browser.filter(x=>x[0]==='phone'))browser.push([entry[0],entry[1].replace('844','390'),entry[2]]);
 for(const [family,probe,mutation]of browser){
  if(process.env.HIKES_MUTATION_FAMILY && family!==process.env.HIKES_MUTATION_FAMILY)continue;
  if(process.env.HIKES_MUTATION_RESUME && results.some(r=>r.name===probe&&r.pass))continue;
  const path=root+'/web/src/'+mutation.file, original=readFileSync(path,'utf8');if(!original.includes(mutation.from))throw Error('missing mutation '+probe);
  let run;
  try {writeFileSync(path,original.replace(mutation.from,mutation.to));run=spawnSync(process.execPath,[root+'/tools/hikes-check.mjs',out,first],{encoding:'utf8',env:{...process.env,SHOTS:'0',HIKES_FAMILY:family,HIKES_PROBE:probe,HIKES_WIDTH:family==='phone'?(probe.includes('390')?'390':'844'):''},timeout:600000});}
  finally {writeFileSync(path,original);}
  const log=(run.stdout??'')+(run.stderr??''),pass=run.status===1&&log.includes('MUTATION DETECTED: '+probe);
  writeFileSync(`${out}/mutation-browser-${probe.replaceAll(/[^a-zA-Z0-9]+/g,'-')}.log`,log);results.push({name:probe,pass,exit:run.status});console.log(`${pass?'PASS':'FAIL'} mutation ${probe}`);writeFileSync(out+'/hikes-mutations.json',JSON.stringify(results,null,2));
  if(!pass)throw Error('browser mutation not proved: '+probe+'\n'+log.slice(-2000));
 }
 }
}finally {rmSync(work,{recursive:true,force:true});writeFileSync(out+'/hikes-mutations.json',JSON.stringify(results,null,2));}
