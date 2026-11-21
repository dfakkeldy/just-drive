// The Canso canal span (#123's swing bridge, road 35 on Highway 104) on real baked land: ModernBridges.setHidden takes
// its deck out of the merged mesh and keeps its approaches, which stand over road cuts that stay in force.
// - build() marks as approach exactly the surface triangles off the deck (triangleDeck 0 or 2), and every other
//   approach vertex (stripes, fill) lies past a deck end;
// - hidden, the merged mesh holds the other spans whole plus this span's approach vertices, byte for byte;
// - shown again, the mesh is as before.
// --mutations: marking nothing (the deck and its approaches both vanish) and marking everything (nothing hides) fail.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,dispose,root} from './bridges-fixture.mjs';

const file='web/src/modern-bridges.ts',source=readFileSync(root+file,'utf8');
const anchor='if(part===1)draw();else approach(draw);';
assert.equal(source.split(anchor).length,2,'approach marking anchor');
const mutants={
  'no approach marked':source.replace(anchor,'draw();').replace('approach(()=>{for(let i=0;i<rows;i++){\n      const s0','(()=>{for(let i=0;i<rows;i++){\n      const s0').replace('approach(()=>{for(let i=0;i<rows;i++){\n      const s=(','(()=>{for(let i=0;i<rows;i++){\n      const s=('),
  'stripes and fill unmarked':source.replace('approach(()=>{for(let i=0;i<rows;i++){\n      const s0','(()=>{for(let i=0;i<rows;i++){\n      const s0').replace('approach(()=>{for(let i=0;i<rows;i++){\n      const s=(','(()=>{for(let i=0;i<rows;i++){\n      const s=('),
  'everything marked':source.replace('    r.approachRanges=new Int32Array(approachRanges);','    r.approachRanges=new Int32Array([0,m.pos.length/3]);'),
};

async function check(replacements={}){
  const f=await fixture('cansocauseway',1.5,replacements),m=f.roads.modern;
  try{
    const span=m.spans.find(r=>r.members.has(35)||r.road.sourceRoad===35);assert.ok(span,'a modern span carries road 35');
    await f.load([...span.pts,[span.x0,span.z0],[span.x1,span.z1]]);
    f.roads.update(new THREE.Vector3(span.pts[0][0],10,span.pts[0][1]));
    assert.ok(span.geometry,'the canal span is built');
    const pos=span.geometry.getAttribute('position').array,count=pos.length/3,ranges=span.approachRanges;
    const kept=new Uint8Array(count);for(let i=0;i<ranges.length;i+=2)kept.fill(1,ranges[i],ranges[i+1]);
    // Surface triangles come first, in triangleDeck order.
    const surface=span.triangleDeck.length;
    for(let t=0;t<surface;t++){const deck=span.triangleDeck[t]===1;
      for(let k=0;k<3;k++)assert.equal(kept[t*3+k],deck?0:1,`surface triangle ${t} (${deck?'deck':'approach'}) is ${deck?'not ':''}an approach`);}
    // Every other approach vertex lies past a deck end (along the centre line), within a 0.6 m seam tolerance.
    const pts=span.pts,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
    const along=(x,z)=>{let best=Infinity,s=0;for(let i=1;i<pts.length;i++){const ax=pts[i-1][0],az=pts[i-1][1],dx=pts[i][0]-ax,dz=pts[i][1]-az,n=dx*dx+dz*dz||1;
      let t=((x-ax)*dx+(z-az)*dz)/n;if(i>1)t=Math.max(0,t);if(i<pts.length-1)t=Math.min(1,t);const d=Math.hypot(x-ax-dx*t,z-az-dz*t);if(d<best){best=d;s=cum[i-1]+t*Math.sqrt(n);}}return s;};
    // And the converse: every other vertex more than 0.6 m past a deck end (stripes, fill) is an approach. Deck parts
    // (rails, underside, abutments) reach at most 0.55 m past an end.
    let extra=0;
    for(let v=surface*3;v<count;v++){const s=along(pos[v*3],pos[v*3+2]),past=s<-.6||s>span.length+.6;
      if(kept[v]){extra++;assert.ok(s<.6||s>span.length-.6,`approach vertex ${v} past a deck end (along ${s.toFixed(2)} of ${span.length.toFixed(2)})`);}
      else assert.ok(!past,`vertex ${v} ${s<0?-s:s-span.length} m past a deck end is marked as an approach`);}
    assert.ok(extra>0,'the canal span has approach stripes or fill');
    const deckVertices=count-kept.reduce((a,b)=>a+b,0);
    assert.ok(deckVertices>0&&kept.some(Boolean),'the span has deck and approach geometry');
    const NAMES=['position','normal','color'],attribute=name=>m.mesh.geometry.getAttribute(name).array;
    const before=Object.fromEntries(NAMES.map(name=>[name,Float32Array.from(attribute(name))]));
    m.setHidden(35,true);
    for(const name of NAMES){
      // Expected: every span whole in order, this one only at its approach ranges.
      const expected=[];for(const r of m.spans){const a=r.geometry?.getAttribute(name).array;if(!a)continue;
        if(r!==span)expected.push(a);else for(let i=0;i<ranges.length;i+=2)expected.push(a.subarray(ranges[i]*3,ranges[i+1]*3));}
      const joined=new Float32Array(expected.reduce((n,a)=>n+a.length,0));let at=0;for(const a of expected){joined.set(a,at);at+=a.length;}
      assert.deepEqual(attribute(name),joined,`hidden ${name}: the canal deck leaves the mesh, its approaches stay`);
      assert.equal(before[name].length-attribute(name).length,deckVertices*3);
    }
    m.setHidden(35,false);
    for(const name of NAMES)assert.deepEqual(attribute(name),before[name],`shown again: ${name}`);
    return {span:span.road.id,length:+span.length.toFixed(1),vertices:count,deckVertices,approachVertices:count-deckVertices,stripesAndFill:extra};
  }finally{dispose(f);}
}

const result=await check();
console.log('PASS canal span hides its deck only, on real Canso land',JSON.stringify(result));
if(process.argv.includes('--mutations'))for(const [name,mutant] of Object.entries(mutants)){
  assert.notEqual(mutant,source,name+' applies');
  await assert.rejects(()=>check({[file]:mutant}),assert.AssertionError,name+' must fail');console.log('KILLED',name);
}
