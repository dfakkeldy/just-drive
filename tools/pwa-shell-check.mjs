import { readBaseline } from './baseline-source.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const baseline=process.argv.includes('--baseline'),source=readFileSync(new URL('./pwa-shell.mjs',import.meta.url),'utf8');
function implementation(source){return vm.runInNewContext(source.replace('export function','function')+';normalizedPage');}
const old=baseline?readBaseline('pwa-opt-in','tools/build-pwa.mjs'):'';
const oldExpression=baseline?old.split('let page = ')[1].split('\nconst pageKey')[0]:'';
async function test(normalize){const target='/offline/app.'+'b'.repeat(64)+'.js';for(const src of ['app.js','./app.js','/app.js','/offline/app.'+'a'.repeat(64)+'.js']){
 const initial=`<html><head><meta name="mmm-page" content="old"></head><script src="${src}" integrity="sha256-old"></script></html>`;
 const first=normalize(initial,target);assert.ok(first.includes(`src="${target}"`),'saved shell pins '+src);assert.doesNotMatch(first,/integrity=/,'old integrity is stripped');
 assert.equal(normalize(first,target),first,'normalization is idempotent');
}}
try{await test(baseline?(page,appUrl)=>vm.runInNewContext(oldExpression,{read:()=>page,site:'',appUrl}):implementation(source));console.log('PASS relative, root alias and hashed script normalization; stale integrity; repeated rebuild');}catch(e){console.log('FAIL',e.message);process.exitCode=1;}
if(!process.exitCode&&process.argv.includes('--mutations'))for(const[name,from,to]of[
 ['root alias omitted','(?:\\/|\\.\\/)?','(?:\\.\\/)?'],
 ['stale integrity retained',"page.replace(/\\s+integrity=\"[^\"]*\"/g,'')",'page']
]){assert.ok(source.includes(from),name+' applies');let caught=false;try{await test(implementation(source.replace(from,to)));}catch{caught=true;}assert.ok(caught,'escaped '+name);console.log('caught mutation:',name);}
