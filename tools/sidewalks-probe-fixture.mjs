import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {transform} from '../web/node_modules/esbuild/lib/main.js';
import {instrumentMain,installDetailedProbe,resolveMainResponse} from './sidewalks-probe.mjs';
const current=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8');
// Older main.ts sources are review replays only: a fresh-history clone does not hold those commits.
for(const source of [current,...(process.argv.includes('--review-replays')?['c6df652','2cd5725']:[]).map(ref=>execFileSync('git',['show',ref+':web/src/main.ts'],{encoding:'utf8'}))]){
 const transformed=instrumentMain(source);assert.equal(transformed.strip(transformed.source),source,'only observational calls inserted');
 assert.ok(transformed.markers.includes('bodyStart'));assert.ok(transformed.source.includes('__walkProbe.observeReady(loaded, waiting, quiet'));
 const js=(await transform(source,{loader:'ts',format:'esm'})).code,served=instrumentMain(js);assert.equal(served.strip(served.source),js);await transform(served.source,{loader:'js',format:'esm'});
}
assert.throws(()=>instrumentMain(current.replace('quiet = waiting ? 0 : quiet + 1;','quiet = 0;')),/actual waiting/);
const cached=resolveMainResponse(200,null,current,'same');assert.equal(resolveMainResponse(304,cached,undefined,'same'),cached);
assert.equal(resolveMainResponse(200,cached,instrumentMain(current).source,'same'),cached,'cached probes are not inserted twice');
assert.throws(()=>resolveMainResponse(304,null,undefined,'same'),/without an observed/);assert.throws(()=>resolveMainResponse(200,cached,'changed','other'),/changed during/);
let time=0,reads=0,upload=0,draw=0;
const context={__walkProbe:{methods:{}},performance:{now:()=>++time},Map,Object,Error};
runInNewContext(`(${installDetailedProbe.toString()})()`,context);const p=context.__walkProbe;
let pending=1;
const patch={active:true,cursor:4,side:2,mesh:{}},grass={ready:true,patches:new Map([[0,patch]]),dense:new Map(),clock:{value:3},populate(){},get pending(){reads++;return pending;}};
p.attachWorld({grass,trees:{get pending(){return 0;}}});assert.equal(grass.pending,1);assert.equal(reads,1,'observe the real pending getter once');
p.observeReady(true,true,0,0,0,false,false,false,false,false,0);assert.ok(p.lastNonQuietMask&(1<<3),'completed roots can still wait for grow-in');
patch.cursor=1;assert.equal(grass.pending,1);p.observeReady(true,true,0,0,0,false,false,false,false,false,0);assert.ok(p.lastNonQuietMask&(1<<2),'building separately named');
grass.ready=false;assert.equal(grass.pending,1);p.observeReady(true,true,0,0,0,false,false,false,false,false,0);assert.ok(p.lastNonQuietMask&(1<<1),'cover separately named');
pending=0;assert.equal(grass.pending,0);p.observeReady(true,false,1,0,0,false,false,false,false,false,0);assert.ok(p.quietStartedAt);
const attribute={onUploadCallback(){upload++;}},index={...attribute,version:1},mesh={geometry:{attributes:{position:attribute},index},onAfterRender(){draw++;}};
p.attachWalk({group:{children:[mesh]}});attribute.onUploadCallback();mesh.onAfterRender(null,null,null,mesh.geometry,null,null);assert.equal(upload,1);assert.equal(draw,1);assert.ok(p.mesh.firstUploadAt);assert.ok(p.mesh.firstVisibleDrawAt);
console.log('PASS observation-only main transform, exact getter reads, grass phase attribution, real upload/draw callbacks and missing-hook mutant');
