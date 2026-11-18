// Game-only placement pictures. Never reads the private drive or any image source.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { open, sleep } from './cdp.mjs';
const [, first] = process.argv.slice(2), origin = new URL(first).origin;
const head = execFileSync('git',['rev-parse','--short=12','HEAD'],{encoding:'utf8'}).trim();
// check-all removes successful scratch folders. Keep these explicitly requested pictures separately.
const out = fileURLToPath(new URL(`../data/work/traffic-signals-1175/${head}/`,import.meta.url)); mkdirSync(out,{recursive:true});
let page;
const receipts=[];
try {
  page = await open(`${origin}/?mode=explore&site=just&area=pointtupper&mp=0&radio=0&hud=0&at=628146.721,5052750.914,0`);
  const poses = await page.read(`(()=>{
    const found=new Set(),v=mmm.terrain.manifest.village;
    return mmm.trafficSignals.stops.filter(s=>s.phase===0&&!found.has(s.junction.id)&&found.add(s.junction.id)).map(s=>{
      const a=s.junction.approaches.find(a=>a.phase===0),r=mmm.roads.nearest(s.x+s.dx*20,s.z+s.dz*20,20,r=>r.name===a.road);
      if(!r)throw Error('no approach road');
      let h=r.heading;if(Math.sin(h)*s.dx-Math.cos(h)*s.dz>0)h+=Math.PI;
      const x=r.x+Math.cos(h)*r.road.halfWidth*.45,z=r.z+Math.sin(h)*r.road.halfWidth*.45;
      return {id:s.junction.id,at:[v[0]+x,v[1]-z,h*180/Math.PI]};
    });
  })()`);
  assert.equal(poses.length,4);
  for(const pose of poses) for(const light of ['day','night']) for(const view of ['seat','chase']) {
    const query = new URLSearchParams({site:'just',mode:'explore',area:'pointtupper',mp:'0',radio:'0',hud:'0',exag:'1',q:'high',shadows:'1',date:'2026-11-15',time:light==='day'?'12:00':'22:00',at:pose.at.join(','),view});
    await page.navigate(`${origin}/?${query}`);
    await page.read(`(()=>{const v=mmm.vehicle;v.update=()=>{};return true})()`);
    await sleep(2500);
    const state=await page.read(`(()=>{
      const g=mmm.trafficSignals.group,m=mmm.camera.matrix.clone(),p=mmm.camera.position.clone(),visible=[];
      for(let i=0;i<mmm.trafficSignals.stops.length;i++){
        if(mmm.trafficSignals.stops[i].junction.id!==${JSON.stringify(pose.id)})continue;
        g.children[1].getMatrixAt(i,m);if(m.elements[13]===0)continue;
        p.setFromMatrixPosition(m).project(mmm.camera);
        if(p.z<1&&Math.abs(p.x)<1&&Math.abs(p.y)<1)visible.push(i);
      }
      return {visible,night:!!mmm.night,vehicle:{x:mmm.vehicle.x,z:mmm.vehicle.z},calls:mmm.renderer.info.render.calls,triangles:mmm.renderer.info.render.triangles};
    })()`);
    assert.ok(state.visible.length,`${pose.id}/${light}/${view}: at least one head in frame`);
    assert.equal(state.night,light==='night');
    const file=resolve(out,`${pose.id}-${light}-${view}.png`);await page.shot(file);
    receipts.push({junction:pose.id,light,view,file: file.split('/').pop(),query:query.toString(),...state});
    console.log('PICTURE',file,JSON.stringify(state));
  }
  assert.equal(receipts.length,16);
} finally {
  writeFileSync(resolve(out,'receipts.json'),JSON.stringify({head,receipts},null,2)+'\n');
  await page?.close();
}
console.log('PASS 16 signal placement pictures',out);
