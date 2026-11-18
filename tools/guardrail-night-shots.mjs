// The guard rail and the bull in the head lamps at night, from the seat and from the chase camera.
// The game's own night (the light study at 21:30, night.ts): two real three.js spot lights at the head lamps light
// everything drawn with a standard material (the rail, the posts, the bull, the car, poles) through its production
// shader, and the land and the grass take the same two cones through their night shader function.
// The check: every program compiles, the rail is drawn, the lamp branch of the rail shader is in use, the bull is there.
// Run serially through yard-shots.sh:
//   RAIL_TAG=after OUT="$PWD/data/work/threads/guardrails-look" RUN=guardrail-night-shots.mjs tools/yard-shots.sh 1400 950
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {open,sleep} from './cdp.mjs';
import {assertMailCar} from './mail-car-body.mjs';
const root=resolve(import.meta.dirname,'..');
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
mkdirSync(out,{recursive:true});
const tag=process.env.RAIL_TAG??'look',quality=process.env.RAIL_QUALITY==='low'?'low':'high';
// Mabou Mines Road, heading north on the washboard: the run end, the dent and the bull are all ahead on the left.
const BULL=5493.73,BACK=Number(process.env.RAIL_NIGHT_BACK??14);
const data=JSON.parse(readFileSync(resolve(root,'data/baked/terrain/roads.json'))),road=data.roads.find(r=>r.id===55);
const station=along=>{let left=along;for(let i=1;i<road.pts.length;i++){const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(left<=len||i===road.pts.length-1){const t=Math.min(1,left/len);return {e:a[0]+dx*t,n:a[1]+dn*t,heading:Math.atan2(dx,dn)*180/Math.PI};}left-=len;}};
const start=station(BULL-BACK);
let pictures=0;
for(const view of ['seat','chase']){
  // 10 October, 21:30 Atlantic Daylight Time: the sun is 32° below the horizon.
  const query=new URLSearchParams({hud:'0',mode:'explore',exag:'1.5',radio:'0',q:quality,area:'mabou',at:`${start.e},${start.n},${start.heading}`,view,date:'2026-10-10',time:'21:30'}),page=await open(`${origin}/?${query}`);
  try{
    await page.read(`(()=>{const v=mmm.vehicle,update=v.update.bind(v);v.update=(dt,input,...args)=>update(0,{throttle:0,steer:0,handbrake:true},...args);return true})()`);
    for(let i=0;i<150;i++){
      if(await page.read(`(()=>{mmm.roads.guardrails?.update(mmm.camera.position);return mmm.terrain.pending===0&&!mmm.roads.guardrails.audit.pending&&mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig)})()`))break;
      await sleep(200);
    }
    await sleep(3000);
    await assertMailCar(page.read,'blender','guard rail night');      // the head lamps below are the Blender car's (the default)
    const night=await page.read(`(()=>{const n=mmm.night;return n?{beams:n.beams.length,lampsOn:mmm.terrain.uniforms.nightLamp.value.w,bull:mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig)??false}:null})()`);
    assert.ok(night&&night.beams===(quality==='low'?1:2)&&night.lampsOn===night.beams&&night.bull,'the game night is on, with its head lamps and the bull: '+JSON.stringify(night));
    const broken=await page.read(`mmm.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>[p.name,p.diagnostics.programLog,p.diagnostics.vertexShader?.log,p.diagnostics.fragmentShader?.log].join(' | '))`);
    assert.deepEqual(broken,[],'every shader program compiles, the night ones too');
    assert.ok(await page.read(`mmm.roads.guardrails.group.children.filter(m=>m.visible).length`)>0,'the rail is drawn');
    // The rail's own shader has a lamp branch (guardrail-look.ts); with the spot lights in the scene it is compiled in.
    assert.ok(await page.read(`mmm.renderer.info.programs.some(p=>p.cacheKey.includes('mmm-rail'))`),'the rail program is in use');
    const file=resolve(out,`mines-headlights-${view}-${tag}.png`);await page.shot(file);pictures++;console.log('PICTURE',file,JSON.stringify(night));
  }finally{await page.close();}
}
console.log(`DONE ${pictures} night picture(s), tag ${tag}, ${quality} detail, car ${BACK} m before the bull`);
