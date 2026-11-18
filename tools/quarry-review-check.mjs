// Independent-review regressions. QUARRY_REVIEW_REF runs the same behavioral cases on the reviewed commit.
import assert from 'node:assert/strict';
import {pass4Tests} from './quarry-pass4-check.mjs';
import {pass3Tests} from './quarry-pass3-check.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {areaAddress} from '../web/src/site';
import {chooseMode} from '../web/src/mode';
import {vehicleChoice} from '../web/src/vehicle-choice';
import {tripParams,bootTripParams} from '../web/src/quarry-trip';
import {quarryRoute} from '../web/src/quarry-route';
import {Quarry} from '../web/src/quarry';
import {Terrain} from '../web/src/terrain';
import {Towing} from '../web/src/towing';
import {APRON} from '../web/src/quarry-site';
import {TRUCK_SPEC} from '../web/src/truck';
const root=process.env.QUARRY_ROOT??process.cwd(),ref=process.env.QUARRY_REVIEW_REF;
const read=file=>ref?execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'}):readFileSync(root+'/'+file,'utf8');
const results=[];
const test=(name,fn)=>{try{fn();results.push({name,exit:0});console.log('PASS',name);}catch(e){results.push({name,exit:1,error:e.message});console.log('FAIL',name,e.message);}};
test('R1 explicit player choices cancel a preset',()=>{
 for(const [key,value] of Object.entries({area:'judique',mode:'mail',vehicle:'car',trailer:'empty'})){
  const q=tripParams(new URLSearchParams('trip=quarry&'+key+'='+value));assert.equal(q.get(key),value,key+' explicit choice wins');assert.equal(q.has('trip'),false,key+' cancels trip');
 }
 const unknown=new URLSearchParams('trip=unknown&vehicle=bike');assert.equal(tripParams(unknown),unknown);
 const query=new URLSearchParams('trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1');
 for(const brand of ['mail','just'])assert.equal(new URLSearchParams(areaAddress({brand,area:'westbay'},'judique','/westbay',query).split('?')[1]).has('trip'),false,'area control clears trip on '+brand);
 const saved={location:globalThis.location,history:globalThis.history,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage};
 try{
  let values=new Map();globalThis.localStorage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)};globalThis.sessionStorage={setItem(){}};
  for(const kind of ['car','bike']){globalThis.location={hostname:'localhost',pathname:'/',search:'?'+query,reload(){throw Error('must replace query');}};vehicleChoice('truck',{x:0,z:0,heading:0}).choose(kind);const q=new URLSearchParams(globalThis.location.search);assert.equal(q.has('trip'),false);assert.equal(q.get('vehicle'),kind);}
  globalThis.location={hostname:'localhost',pathname:'/',search:'?'+query,reload(){throw Error('must replace query');}};chooseMode('mail');const q=new URLSearchParams(globalThis.location.search);assert.equal(q.has('trip'),false);assert.equal(q.get('mode'),'mail');
  for(const [extra,path]of [['vehicle=car','/mabou'],['mode=mail','/mabou'],['trailer=empty','/mabou'],['area=judique','/judique']]){
   globalThis.location={hostname:'localhost',pathname:'/mabou',search:'?site=just&trip=quarry&'+extra,hash:''};globalThis.history={state:null,replaceState(_s,_t,address){const url=new URL(address,'http://localhost');globalThis.location.pathname=url.pathname;globalThis.location.search=url.search;}};
   const q=bootTripParams();assert.equal(q.has('trip'),false);assert.equal(globalThis.location.pathname,path,'contradictory Just Drive address preserves its explicit area or current path');
  }
 }finally{Object.assign(globalThis,saved);}
});
test('R2 bridge support stays dry for quarry and complete trailer footprint',()=>{
 const terrain={heightAt:()=>27,sites:[{box:[-100,-100,100,100],waterLevel:()=>27}],seaLevel:0,exag:1,waterAt:Terrain.prototype.waterAt,waterLevelAt:Terrain.prototype.waterLevelAt},roads={deckHeight:()=>32};
 assert.equal(Quarry.prototype.allowPlacement.call({terrain,roads,solids:[]},{x:0,z:0,heading:0},TRUCK_SPEC),true,'quarry guard accepts bridge');
 const body={spec:TRUCK_SPEC,x:0,z:0,heading:0,y:32},trailer={...body,z:10,spec:{...TRUCK_SPEC,halfLength:4.3,halfWidth:1.1}},trial={vehicle:body,buildPlacement(){},pairClear:()=>true,bodies:()=>[body,trailer]};
 const towing={vehicle:{spec:TRUCK_SPEC,y:32,pitch:0,roll:0},terrain,roads,placementTrial:trial,world:{},ground:()=>32};
 assert.equal(Towing.prototype.validPair.call(towing,{x:0,z:0,heading:0}),true,'rig accepts supporting bridge');
 roads.deckHeight=()=>27.3;towing.ground=()=>27.3;
 assert.equal(Quarry.prototype.allowPlacement.call({terrain,roads,solids:[]},{x:0,z:0,heading:0},TRUCK_SPEC),true,'a dry deck thirty centimetres above the lake is not survey noise');
 assert.equal(Towing.prototype.validPair.call(towing,{x:0,z:0,heading:0}),true,'both bodies stay dry on the low supporting deck');
 roads.deckHeight=()=>26;terrain.heightAt=()=>25;towing.ground=()=>26;
 assert.equal(Quarry.prototype.allowPlacement.call({terrain,roads,solids:[]},{x:0,z:0,heading:0},TRUCK_SPEC),false,'a submerged deck still counts as water');
 assert.equal(Towing.prototype.validPair.call(towing,{x:0,z:0,heading:0}),false,'submerged supporting deck cannot accept the rig');
 terrain.heightAt=()=>27;roads.deckHeight=()=>32;
 towing.ground=(_x,z)=>z>5?27:32;assert.equal(Towing.prototype.validPair.call(towing,{x:0,z:0,heading:0}),false,'wet trailer footprint is rejected even with a dry truck');
 towing.ground=()=>27;assert.equal(Towing.prototype.validPair.call(towing,{x:0,z:0,heading:0}),false,'wet land still rejected');
});
const road=(id,pts,extra={})=>({id,pts,name:id===1?'Eagle Creek Road':id===1672?null:'fixture road',kind:3,bridge:false,halfWidth:2,...extra});
test('R3 nearby overpass ends never create a junction',()=>{
 const roads=[road(1,[[0,100],[0,0]]),road(2,[[.2,0],[100,0]],{bridge:true}),road(1672,[[100,0],[200,0]])],village=[APRON.e-150,APRON.n];
 assert.throws(()=>quarryRoute(roads,village,()=>0),/gap|disconnected/i,'bridge/ground mismatch must disconnect');
 roads[1].bridge=false;assert.throws(()=>quarryRoute(roads,village,(_x,_z,r)=>r.id===2?3:0),/gap|disconnected/i,'three metre end-level mismatch must disconnect');
});
test('R4 all intermediate attachments split one segment in order',()=>{
 const roads=[road(1,[[0,100],[0,0]]),road(2,[[-55,0],[300,0]]),road(1672,[[190,0],[190,-100]])];
 const route=quarryRoute(roads,[APRON.e-190,APRON.n],()=>0);assert.ok(Math.abs(route.length-245)<.001,'245 m shortest path, actual '+route.length);assert.ok(route.points.every(p=>p.x>=-1e-6),'no backward detour');
});
test('R5 Mabou startup has no eager quarry implementation dependency',()=>{
 const visited=new Set();
 const visit=file=>{if(visited.has(file))return;visited.add(file);const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 for(const node of ast.statements)if(ts.isImportDeclaration(node)&&!node.importClause?.isTypeOnly){const spec=node.moduleSpecifier.text;if(!spec.startsWith('.'))continue;const parts=file.split('/');parts.pop();for(const p of spec.split('/'))if(p==='..')parts.pop();else if(p!=='.')parts.push(p);const dep=parts.join('/')+'.ts';if(!ref&&!existsSync(root+'/'+dep))continue;visit(dep);}};
 visit('web/src/main.ts');const eager=[...visited].filter(f=>/\/quarry[^/]*\.ts$/.test(f)&&!f.endsWith('/quarry-trip.ts'));assert.deepEqual(eager,[],'only tiny preset parser may be eager');
});
// The reviewed R oracle accepted this disabled-handler observation. Exercise its actual check call.
test('R6 disabled R handler fails the recovery oracle',()=>{
 const source=read('tools/quarry-browser.mjs'),start=source.indexOf("check(reset.same"),end=source.indexOf(';',start),oracle=source.slice(start,end);
 if(start<0){
  const match=source.match(/const assertRecovery=([^;]+);/);assert.ok(match,'observable recovery oracle is wired into browser test');
  const oracle=Function('return ('+match[1]+')')(),before={x:20,z:0,route:100},after={x:0,z:0,road:0,routeOffset:0,attached:true,angle:0,clear:true,behind:8,route:100,remaining:900,saved:JSON.stringify({x:0,z:0}),text:'900 m left',hidden:false};
  assert.equal(oracle(before,{...after,x:20}),false,'disabled handler stays off road');assert.equal(oracle(before,after),true,'real recovery accepted');
  for(const fault of [{road:5},{routeOffset:5},{angle:.3},{clear:false},{behind:-8},{route:0},{remaining:NaN},{saved:null},{hidden:true}])assert.equal(oracle(before,{...after,...fault}),false,'observable recovery fault '+JSON.stringify(fault));return;
 }

 let accepted=false;const check=ok=>{accepted=ok;},reset={same:true,saved:'unchanged pose',text:'unchanged HUD'};
 Function('check','reset',oracle)(check,reset);assert.equal(accepted,false,'disabled handler was accepted by actual reviewed R assertion');
});
pass3Tests(test,read);
pass4Tests(test,read);
console.log(JSON.stringify(results));if(results.some(r=>r.exit))process.exitCode=1;
