// Preserve the R3 judgement for inferred West Bay1618 beside the real quarry site.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,dispose,root} from './bridges-fixture.mjs';

const file='web/src/bridge-crossings.ts',source=readFileSync(root+file,'utf8');
const anchor='crossings as BridgeCrossing[]';
assert.equal(source.split(anchor).length,2,'runtime inventory mutation anchor');
const without={[file]:source.replace(anchor,"(crossings as BridgeCrossing[]).filter(c=>!(c.area==='westbay'&&c.road===1618))")};

async function sample(replacements={}){
 const f=await fixture('westbay',1.5,replacements),q=new f.QuarrySite(f.manifest.village);
 f.terrain.sites.push(q);
 const cx=631979-f.manifest.village[0],cz=f.manifest.village[1]-5063414;
 await f.load([[cx,cz],[cx-80,cz],[cx+80,cz],[cx,cz-80],[cx,cz+80]]);
 f.roads.update(new THREE.Vector3(cx,10,cz));
 const rows=[];
 for(let dz=-100;dz<=100;dz+=2)for(let dx=-100;dx<=100;dx+=2){
  const x=cx+dx,z=cz+dz,survey=f.terrain.constructionHeightAt(x,z);
  assert.equal(q.surface(x,z),null,'no quarry-painted cell inside the reviewed 100m neighbourhood');
  assert.equal(q.waterLevel(x,z),null,'no quarry lake inside the reviewed neighbourhood');
  assert.equal(q.height(x,z,survey),survey,'the quarry remains authoritative and leaves this survey unchanged');
  // No-reference heightAt also supplies the engineered approach road. Compare LAND
  // here, as the authority question requires, rather than that added driving skin.
  rows.push({land:f.terrain.landHeightAt(x,z),kind:f.terrain.surfaceAt(x,z)?.kind??-1});
 }
 const span=f.roads.modern.spans.find(r=>r.road.sourceRoad===1618);
 let summary=null;
 if(span){
  const p=f.roads.modern.at(span,span.length/2),deck=f.roads.modern.ownHeight(span,p.x,p.z);
  summary={inferred:span.road.inferred,timber:span.timber,length:span.length,gap:deck-f.terrain.landHeightAt(p.x,p.z)};
 }
 dispose(f);return{rows,span:summary};
}

function retained(result){
 assert.ok(result.span,'reviewed West Bay1618 span is retained');
 assert.equal(result.span.inferred,true,'West Bay1618 stays explicitly inferred');
 assert.equal(result.span.timber,true,'inferred West Bay1618 remains a timber deck');
 assert.ok(result.span.length>=35&&result.span.length<=45,'reviewed span is about40m long');
 assert.ok(result.span.gap>=5,'removing the inferred span would expose a deep track gap');
}

const withDeck=await sample(),withoutDeck=await sample(without);retained(withDeck);
assert.equal(withoutDeck.span,null,'comparison actually removes West Bay1618');
assert.equal(withDeck.rows.length,10201,'complete200m square sampled at2m');
let changedHeight=0,maxHeightDelta=0;
for(let i=0;i<withDeck.rows.length;i++){
 const a=withDeck.rows[i],b=withoutDeck.rows[i],delta=Math.abs(a.land-b.land);
 assert.equal(a.kind,b.kind,'adding the inferred span does not change ground surface kinds');
 if(delta>.005)changedHeight++;
 maxHeightDelta=Math.max(maxHeightDelta,delta);
}
assert.ok(changedHeight<=16,'only the small approach footprint may change land: '+changedHeight);
assert.ok(maxHeightDelta<=.05,'approach land differences stay within5cm: '+maxHeightDelta);
assert.throws(()=>retained(withoutDeck),/span is retained/,'removing the accepted crossing must fail');
const result={...withDeck.span,cells:withDeck.rows.length,changedHeight,maxHeightDelta,changedKind:0,quarryPaintedCells:0,quarryPaintedCellsChanged:0};
console.log('PASS West Bay1618 authority',JSON.stringify(result));
console.log('KILLED accepted West Bay1618 crossing removed');
if(process.env.OUT)writeFileSync(process.env.OUT+'/westbay1618-authority.json',JSON.stringify(result,null,2)+'\n');
