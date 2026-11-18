#!/usr/bin/env node
// Execute the real preprocessed shader's scalar LOD rule. No copy of the distance constants.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {program,preprocess,checkShaderBaseline} from './coast-programs.mjs';
const source=readFileSync(new URL('../web/src/shaders.ts',import.meta.url),'utf8');
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function lod(text,flags){
 const shader=preprocess(program(text,'TERRAIN_FRAG'),flags);
 const tree=shader.slice(shader.indexOf('vec3 treeColor('));
 const expr=tree.match(/float far = ([^;]+);/)[1];
 return new Function('dist','texel','smoothstep','step','clamp',`return ${expr}`);
}
function verify(text){
 const mirror=lod(text,['MIRROR']),main=lod(text,[]);
 for(const texel of [1,2,3,4,5.9])for(const dist of [600,330,420,900,1200]){
  const args=[dist,texel,smoothstep,(a,x)=>Number(x>=a),(x,a,b)=>Math.max(a,Math.min(b,x))];
  const actual=mirror(...args);
  assert(actual<0.999,`mirror became flat average at ${dist} m, texel ${texel}: ${actual}`);
  assert.equal(actual,main(...args),'mirror crown blend differs from main');
 }

}
verify(source);
checkShaderBaseline(source);
console.log('PASS mirror crown cells through 1200 m, fade ends at 1400 m as in main; canonical shader pins pass');
if(process.argv.includes('--mutations')){
 const expression='smoothstep(200.0, 1400.0, dist) + step(6.0, texel)';
 for(const [name,replacement] of [['early-distance','smoothstep(280.0, 420.0, dist) + step(6.0, texel)'],['coarse-flat','smoothstep(200.0, 1400.0, dist) + step(3.0, texel)']]){
  const mutant=source.replace(expression,replacement);
  assert.notEqual(mutant,source,`mutant ${name} was not applied`);
  assert.throws(()=>verify(mutant),/mirror became flat average/,`mutant ${name} survived`);
  console.log(`PASS rejected mutant ${name}`);
 }
}
