// Real bridge registration + main's actual placement expression + real yard-dog factory.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {fixture,dispose,root} from './bridges-fixture.mjs';
const source=readFileSync(root+'web/src/main.ts','utf8');
const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);let expression;
function visit(node){
 if(ts.isCallExpression(node)&&node.expression.getText(tree)==='YardDogSite.create'){
  const excluded=node.arguments[0].properties.find(p=>p.name?.getText(tree)==='excluded');
  expression=excluded.initializer.elements[0].expression.getText(tree);
 }
 ts.forEachChild(node,visit);
}
visit(tree);assert.ok(expression,'actual main yard-dog siting expression');
async function probe(mutant=''){
 const replacements={};
 if(mutant==='eager field'){
  const file='web/src/yard-dog-site.ts',text=readFileSync(root+file,'utf8');
  const anchor="readonly roadField='painted';";assert.equal(text.split(anchor).length,2);
  // Main's #150 also keeps the site off tiles coarser than 8 m (maxTexel); drop that too, so this mutant tests the
  // branch's own lazy painted field rather than the texel limit.
  const limit='readonly maxTexel = 8;';assert.equal(text.split(limit).length,2);
  replacements[file]=text.replace(anchor,'readonly roadField=true;').replace(limit,'');
 }
 if(mutant==='unresolved field'||mutant==='no resolved field'){
  const file='web/src/terrain.ts',text=readFileSync(root+file,'utf8');
  const anchor="if(f&&!road&&site.roadField==='painted'&&mpp<=f.half)road=new Uint8ClampedArray(S*S*4);";assert.equal(text.split(anchor).length,2);
  replacements[file]=text.replace(anchor,mutant==='unresolved field'?anchor.replace('&&mpp<=f.half',''):'');
  // As for 'eager field': without #150's texel limit, so the coarse level-4 tile still meets the unresolved paint.
  if(mutant==='unresolved field'){const dog='web/src/yard-dog-site.ts',dogText=readFileSync(root+dog,'utf8'),limit='readonly maxTexel = 8;';assert.equal(dogText.split(limit).length,2);replacements[dog]=dogText.replace(limit,'');}
 }
 if(mutant==='missing footprints'||mutant==='empty footprints'){
  const file='web/src/modern-bridges.ts',text=readFileSync(root+file,'utf8');
  const anchor='sitingBoxes:this.spans.map(r=>[r.x0,r.z0,r.x1,r.z1] as const),';assert.equal(text.split(anchor).length,2);
  replacements[file]=text.replace(anchor,mutant==='missing footprints'?'':'sitingBoxes:[],');
 }
 const f=await fixture('mabou',1,replacements);
 try{
  const regular={box:[100000,100000,100010,100010],height:(_x,_z,h)=>h,surface:()=>null};f.terrain.sites.push(regular);
  const select=Function('terrain','return '+(mutant==='coarse query box'?'terrain.sites.map(s=>s.box)':expression));
  const excluded=select(f.terrain),json=name=>JSON.parse(readFileSync(root+'data/baked/terrain/'+name+'.json'));
  const village=f.manifest.village,props=json('props'),buildings=json('buildings').buildings;
  const mail=[...props.mailboxes,...props.communityBoxes].map(p=>({x:p.x-village[0],z:village[1]-p.y}));
  const houses=buildings.filter(b=>b.kind==='house').map(b=>({x:b.x-village[0],z:village[1]-b.y}));
  const site=f.YardDogSite.create({roads:f.roads.roads,village,mail,houses,excluded});
  assert.ok(site,'a bridge query box must not suppress the real safe dog yard');
  assert.ok(excluded.includes(regular.box),'ordinary site exclusions stay occupied');
  for(const span of f.roads.modern.spans){
   const p=f.roads.modern.at(span,span.length/2);
   assert.ok(excluded.some(b=>p.x>=b[0]&&p.x<=b[2]&&p.z>=b[1]&&p.z<=b[3]),'every actual bridge remains excluded from new siting');
  }
  assert.equal(f.YardDogSite.create({roads:f.roads.roads,village,mail,houses,excluded:[...excluded,site.box]}),null,'an actual occupied yard footprint still blocks siting');
  f.terrain.sites.push(site);
  for(const level of [0,4,8]){
   const size=f.manifest.size/2**level,i=Math.floor((site.x+village[0]-f.manifest.origin[0])/size),j=Math.floor((site.z-village[1]+f.manifest.origin[1])/size);
   if(level===8)f.terrain.hasRoad.delete(level+'/'+i+'_'+j); // A resolved overlay must also work without a baked field.
   await f.terrain.loadNow(level,i,j);
   const tile=[...f.terrain.tiles.values()].find(t=>t.level===level&&t.i===i&&t.j===j);
   if(level===0)assert.ok(tile.road===null,'empty distant dog field allocates no texture');
   else if(level===4)assert.ok(tile.road===null,'unresolved dog paint allocates no texture');
   else {assert.ok(tile.road,'visible dog paint has a road field');assert.ok(tile.road.some((v,k)=>k%4===2&&(v&15)===12),'mown verge paint survives at visible detail');}
  }
  const nearest=Math.min(...excluded.map(b=>Math.hypot(Math.max(b[0]-site.x,0,site.x-b[2]),Math.max(b[1]-site.z,0,site.z-b[3]))));
  console.log('PASS real Mabou yard with',f.roads.modern.spans.length,'protected bridge footprints; nearest',nearest.toFixed(2),'m');
 }finally{dispose(f);}
}
const at=process.argv.indexOf('--case');
if(at>=0)await probe(process.argv[at+1]);
else {
 const cases=['',...(process.argv.includes('--mutations')?['missing footprints','coarse query box','empty footprints','eager field','unresolved field','no resolved field']:[])];
 for(const mutant of cases){
  const r=spawnSync(process.execPath,[process.argv[1],'--case',mutant],{encoding:'utf8'});
  if(!mutant){assert.equal(r.status,0,r.stdout+r.stderr);process.stdout.write(r.stdout);}
  else {assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/bridge query box|every actual bridge|empty distant dog field|unresolved dog paint|visible dog paint/);console.log('KILLED',mutant);}
 }
}
