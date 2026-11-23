import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
import{program,coastPrograms,preprocess,normalized,checkShaderBaseline,withoutFarBend,reviewedMirrorCrown}from'./coast-programs.mjs';
const raw=readFileSync('web/src/shaders.ts','utf8'),source=reviewedMirrorCrown(raw),base=reviewedMirrorCrown(execFileSync('git',['show','origin/main:web/src/shaders.ts'],{encoding:'utf8'}));

// The shared pin checks the intentional modern cut additions too. Era isolation
// compares all pre-existing programs after removing only those marked modern blocks.
checkShaderBaseline(raw,{report:()=>{}});
const modernOnly=/\/\* MODERN_ROAD_(?:CUT|PAINT)_BEGIN \*\/[\s\S]*?\/\* MODERN_ROAD_(?:CUT|PAINT)_END \*\//g;
const original=(s,n)=>program(withoutFarBend(s),n).replace(modernOnly,'').replaceAll(' * roadPaint','');
const names=[...source.matchAll(/(?:const|export const) (\w+) = \/\* glsl \*\/ `/g)].map(m=>m[1]).filter(n=>!['ROAD_CUT_PARS','ROAD_CUT_FRAG'].includes(n));
for(const name of names){const raw=original(source,name);for(const flags of [[],['LOW'],['COAST_SHORE'],['COAST_SHORE','LOW']])assert.equal(normalized(preprocess(raw,flags)),normalized(preprocess(original(base,name),flags)),name+' unchanged without quarry '+flags);assert(!/ERA_CART|cartMud|cartCrown|cartProgram/.test(raw),name+' contains no era identifier');}
const variants=coastPrograms();// AIRPORT and GROUND_CLASSES variants are new; tools/baseline/programs.json pins them.
for(const p of variants.filter(p=>!p.name.startsWith('CART_')&&!p.flags.includes('AIRPORT')&&!p.flags.includes('ROAD_PAVEMENT')&&!(p.name==='TERRAIN_FRAG'&&p.flags.includes('GROUND_CLASSES'))))assert.equal(normalized(preprocess(original(source,p.name),p.flags)),normalized(preprocess(original(base,p.name),p.flags)),p.name+' original compiled program');
const terrain=program(source,'CART_TERRAIN_FRAG');assert(terrain.includes('cartMud')&&terrain.includes('cartCrown'));assert(!terrain.includes('surface = mix(surface, mix(vec3(0.060'));
assert(variants.some(p=>p.name==='CART_TERRAIN_FRAG')&&variants.some(p=>p.name==='CART_WATER_MASK_FRAG'),'actual constructors select derived programs');
console.log(`PASS original non-bridge shader programs and ${names.length} expanded programs match origin/main compiled bytes outside quarry, airport and ground classes, without era identifiers; constructors select cart variants`);
