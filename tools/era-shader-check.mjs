import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
import{program,coastPrograms,preprocess,normalized,withoutFarBend,reviewedMirrorCrown}from'./coast-programs.mjs';
const source=reviewedMirrorCrown(readFileSync('web/src/shaders.ts','utf8')),base=reviewedMirrorCrown(execFileSync('git',['show','origin/main:web/src/shaders.ts'],{encoding:'utf8'}));

const names=[...source.matchAll(/(?:const|export const) (\w+) = \/\* glsl \*\/ `/g)].map(m=>m[1]);
for(const name of names){const raw=program(withoutFarBend(source),name);for(const flags of [[],['LOW'],['COAST_SHORE'],['COAST_SHORE','LOW']])assert.equal(normalized(preprocess(raw,flags)),normalized(preprocess(program(withoutFarBend(base),name),flags)),name+' unchanged without quarry '+flags);assert(!/ERA_CART|cartMud|cartCrown|cartProgram/.test(raw),name+' contains no era identifier');}
const variants=coastPrograms();// AIRPORT and GROUND_CLASSES variants are new; tools/baseline/programs.json pins them.
for(const p of variants.filter(p=>!p.name.startsWith('CART_')&&!p.flags.includes('AIRPORT')&&!p.flags.includes('ROAD_PAVEMENT')&&!(p.name==='TERRAIN_FRAG'&&p.flags.includes('GROUND_CLASSES'))))assert.equal(normalized(preprocess(program(withoutFarBend(source),p.name),p.flags)),normalized(preprocess(program(withoutFarBend(base),p.name),p.flags)),p.name+' original compiled program');
const terrain=program(source,'CART_TERRAIN_FRAG');assert(terrain.includes('cartMud')&&terrain.includes('cartCrown'));assert(!terrain.includes('surface = mix(surface, mix(vec3(0.060'));
assert(variants.some(p=>p.name==='CART_TERRAIN_FRAG')&&variants.some(p=>p.name==='CART_WATER_MASK_FRAG'),'actual constructors select derived programs');
console.log(`PASS original shader file and ${names.length} expanded programs match origin/main compiled bytes outside quarry, airport and ground classes, without era identifiers; constructors select cart variants`);
