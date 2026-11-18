#!/usr/bin/env node
// In-memory source faults: bundle the same pure checks, require failure, remove every bundle.
import { validateMutations } from './mutation-source.mjs';
import {build}from'../web/node_modules/esbuild/lib/main.js';
import{readFileSync,mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{spawnSync}from'node:child_process';import assert from'node:assert/strict';import{resolve}from'node:path';
const root=resolve(new URL('..',import.meta.url).pathname);
const mutations=[
 ['query precedence','mode.ts',"if (valid(query)) return query;",'if (false) return query;'],
 ['saved choice','mode.ts','if (valid(saved)) return saved;','if (valid(saved)) return \'mail\';'],
 ['blocked storage default','mode.ts',"return 'mail';","return 'explore';"],
 ['choice persistence','mode.ts','localStorage.setItem(KEY, mode);',"localStorage.setItem(KEY, 'mail');"],
 ['query consistency','mode.ts',"query.set('mode', mode)","query.set('mode', 'explore')"],
 ['query fallback','mode.ts',"query.has('mode') || !saved","query.has('mode')"],
 ['unique ids','places.ts',"place('village',","place('rail-trail',"],
 ['coordinate signs','places.ts','z: origin[1] - place.n','z: place.n - origin[1]'],
 ['arrival threshold','places.ts','d <= (place.radius ?? ARRIVAL_RADIUS)','d < (place.radius ?? ARRIVAL_RADIUS)'],
 ['own radius','places.ts','place.radius ?? ARRIVAL_RADIUS) && d < distance','ARRIVAL_RADIUS) && d < distance'],
 ['nearest wins','places.ts','&& d < distance','&& d > -1'],
 ['trail point','places.ts','623908.51, 5102996.91','623998.51, 5102996.91'],
 ['view point','places.ts','622951.3, 5104332.1','622961.3, 5104332.1'],
 ['road filter','places.ts','road.kind <= 3','road.kind <= 5'],
 ['road heading','places.ts','return roads.nearest(p.x, p.z, 2000, place.track ? road=>road.kind>=1&&road.kind<=4 : drivable);','const h = roads.nearest(p.x, p.z, 2000, place.track ? road=>road.kind>=1&&road.kind<=4 : drivable); return h ? {...h, heading: 0} : null;'],
 ['village named start','places.ts',"road.name === 'Highway 19'","road.name === 'Missing road'"],
 ['no clock','explore.ts',"update: DriveSession['update'] = noop;","update: DriveSession['update'] = dt => { this.elapsed += dt; };"],
 ['no endings','explore.ts','end = noop;','end = () => { this.ended = true; };'],
 ['no damage','explore.ts','override hit(): void {}','override hit(...args) { super.hit(...args); }'],
 ['swept contacts','explore.ts','Number.isFinite(this.oldX) ? this.oldX : vehicle.x','vehicle.x'],
 ['contact reset','explore.ts','this.oldX = this.oldZ = NaN;',''],
 ['contact width','props.ts','spec.envelope.sweepHalfWidth','.96'],
 ['old fall speed','mailbox-rules.ts','speed >= 20 / 3.6 ? 3','speed >= 8 / 3.6 ? 3'],
 ['quiet interiors','explore.ts','register: noop, enter: noop','register: noop, enter() { this.busy = true; }'],
 ['quiet relief','explore.ts','breaks: 0, reset: noop, request: noop','breaks: 1, reset: noop, request: noop'],
 ['quiet endings','explore.ts','({ busy: false, update: noop })','({ busy: true, update: noop })'],
 ['mail keys','explore.ts',"'KeyG', 'Enter'","'KeyG'"],
 ['driving keys','explore.ts',"['KeyM', 'KeyE'","['KeyW', 'KeyM', 'KeyE'"],
];
validateMutations(root, mutations.map(([name,file,from,to])=>({name,edits:[{file:'web/src/'+file,from,to}]})));
const scratch=mkdtempSync(tmpdir()+'/mmm-explore-mutations-');
try{
const baseline=scratch+'/baseline.mjs';await build({entryPoints:[root+'/tools/explore-rules-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:baseline,logLevel:'silent'});
const control=spawnSync(process.execPath,[baseline],{env:{...process.env,MMM_ROOT:root},encoding:'utf8'});
assert.equal(control.status,0,'unmodified Explore rules must pass before testing mutations: '+control.stderr);
for(const[name,file,from,to]of mutations){const outfile=scratch+'/check.mjs';await build({entryPoints:[root+'/tools/explore-rules-check.mjs'],bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent',plugins:[{name:'fault',setup(b){b.onLoad({filter:new RegExp('/'+file.replace('.','\\.')+'$')},args=>{const s=readFileSync(args.path,'utf8');assert.ok(s.includes(from),'missing '+name);return{contents:s.replace(from,to),loader:'ts'};});}}]});const p=spawnSync(process.execPath,[outfile],{env:{...process.env,MMM_ROOT:root},encoding:'utf8'});assert.ok(p.status!==0,'MISSED '+name);assert.match(p.stderr,/AssertionError|No named main-road start/,'not an assertion failure: '+name+' '+p.stderr);console.log('PASS detected pure source mutation: '+name);}}finally{rmSync(scratch,{recursive:true,force:true});}
console.log('PASS '+mutations.length+' in-memory pure source mutations; source files unchanged');
