import assert from 'node:assert/strict';
import { JumpJudge, JUMP_LOAD } from '../web/src/jump-rules.ts';
const DT=1/120;
function jump(judge, change=s=>s, steps=720, times=null) {
  let offered=0;
  // A continuous approach, launch, full clearance, wheel landing, and controlled stop.
  for(let i=0;i<steps;i++) {
    const t=i*DT, along=t<2?2+t*7.4:t<2.8?16.8+(t-2)*20:32.8;
    const air=t>=2&&t<2.8;
    const sample={along,across:0,y:air?1.9:0,ground:0,obstacleTop:JUMP_LOAD.height,
      deck:air?null:0,airborne:air,pitch:0,roll:0,speed:air?20:0,sideways:0,contacts:0,placement:0,eligible:true};
    if(judge.step(DT,change(sample,t))){offered++;times?.push(t);}
  }
  return offered;
}
// Launch begins at 18; the final grounded observation is within the high-end wheel footprint.
for(const [name,change]of [
  ['clean',s=>s],
  ['clipped',(s,t)=>({...s,contacts:t>2.3?1:0})],
  // Only the speed differs from the clean run: the height stays full, so nothing else can reject it.
  ['too slow',s=>({...s,speed:s.airborne?2:s.speed})],
  ['too low over the load',(s,t)=>({...s,y:s.airborne&&t>2.2?0.3:s.y})],
  ['no deck',s=>({...s,deck:null})],
  ['under the deck',s=>({...s,deck:4})],
  ['round the side',s=>({...s,across:4})],
  ['placed by a hook',s=>({...s,eligible:false})],
  ['placed mid-air',(s,t)=>({...s,placement:t>2.3?1:0})],
  ['airborne side exit',(s,t)=>({...s,across:t>2.01&&t<2.5?2:0})],
  ['push after landing',(s,t)=>({...s,contacts:t>3.5?1:0})],
  ['unknown ground',s=>({...s,ground:null})],
  ['not on wheels',(s,t)=>({...s,roll:t>2.7?0.7:0})],
]) {
  const j=new JumpJudge(),offers=jump(j,change);
  assert.equal(offers,name==='clean'?1:0,name);assert.equal(j.jumps,name==='clean'?1:0,`${name}: count`);console.log(`PASS ${name}`);
}
const j=new JumpJudge();assert.equal(jump(j),1);assert.equal(jump(j),0,'second clean after keep the route never offers');assert.equal(j.jumps,2,'further clean jumps still count');
j.reset();assert.equal(jump(j),1,'new shift can offer again');
console.log('PASS keep the route and next shift');
// A slide after the landing is not control. The two seconds start when the slide ends (t = 4.8), in one piece.
{
  const slide=new JumpJudge(),times=[];
  assert.equal(jump(slide,(s,t)=>({...s,sideways:t>=2.8&&t<4.8?8:0}),960,times),1,'a slide delays the offer, it does not cancel it');
  assert.ok(times[0]>=6.8-DT&&times[0]<6.9,`offer two seconds after the slide ends, not before (${times[0]})`);
  const twice=new JumpJudge(),second=[];
  assert.equal(jump(twice,(s,t)=>({...s,sideways:t>=2.8&&t<3.8||t>=5&&t<5.2?8:0}),1080,second),1);
  assert.ok(second[0]>=7.2-DT,`a second slide starts the count again (${second[0]})`);
  console.log('PASS slide after landing');
}

