import assert from 'node:assert/strict';
import { initialQuality, qualityStart, qualityTransition as step } from '../web/src/touch-quality-policy.ts';
import { phonePictureChoices, phonePictureRatio } from '../web/src/picture.ts';

const marks=[null,'try','ok','left-try','left-ok'];
// An independent, exhaustive table: every mark x event pair has an explicit result.
const table={
 start:   [['try','write'],[null,'fallback'],['try','write'],['try','write'],['try','write']],
 hide:    [[null,'none'],['left-try','write'],['left-ok','write'],['left-try','write'],['left-ok','write']],
 leave:   [[null,'none'],['left-try','write'],['left-ok','write'],['left-try','write'],['left-ok','write']],
 show:    [[null,'none'],['try','write'],['ok','write'],['try','write'],['ok','write']],
 healthy: [[null,'none'],['ok','write'],['ok','write'],['left-try','none'],['left-ok','none']],
 lost:    [[null,'none'],[null,'fallback'],[null,'fallback'],[null,'fallback'],[null,'fallback']],
 crawl:   [[null,'none'],[null,'fallback'],[null,'fallback'],[null,'fallback'],[null,'fallback']],
 reset:   [[null,'write'],[null,'write'],[null,'write'],[null,'write'],[null,'write']],
 frame:   [[null,'none'],['try','none'],['ok','none'],['left-try','none'],['left-ok','none']],
};
for(const [type,row] of Object.entries(table))for(const [i,mark]of marks.entries()){
 const before=initialQuality(mark), snapshot=structuredClone(before);
 const result=step(before,type==='frame'?{type,dt:.01,settled:true,visible:true}:{type});
 assert.deepEqual(before,snapshot,'input is immutable');
 assert.deepEqual([result.state.mark,result.action],row[i],`${mark} x ${type}`);
 assert.equal(result.state.reason,result.action==='fallback'?'device':null);
}
console.log('PASS all 45 mark x event pairs');
const start=(state=initialQuality(),saved='high')=>qualityStart(true,null,saved,true,state);
const feed=(state,count,dt,settled=true,visible=true)=>{
 for(let i=0;i<count;i++)state=step(state,{type:'frame',dt,settled,visible}).state;
 return state;
};
const healthy=s=>feed(step(s,{type:'frame',dt:0,settled:false,visible:false}).state,1200,1/60);
const checkFallback=(result,reason)=>{
 assert.equal(result.action,'fallback');assert.equal(result.low,true);assert.equal(result.guarded,false);
 assert.deepEqual([result.state.mark,result.state.unfinished,result.state.deaths,result.state.reason],[null,0,0,reason]);
 assert.equal(start(result.state,'low').guarded,false,'next saved low start cannot loop');
};
for(const touch of [true,false])for(const saved of [null,'low','high'])for(const mark of marks)for(const writable of [true,false]){
 const state=initialQuality(mark,1,1);
 for(const q of ['low','high']){
  const r=qualityStart(touch,q,saved,writable,state);
  assert.equal(r.low,q==='low');assert.equal(r.guarded,false);assert.equal(r.action,'none');assert.deepEqual(r.state,state);
 }
 const r=qualityStart(touch,null,saved,writable,state);
 if(!touch)assert.equal(r.low,saved==='low');
 if(touch&&!writable)assert.equal(r.low,true);
}
{
 let s=start().state;
 for(let n=1;n<=3;n++){
  s=step(s,{type:'leave'}).state;assert.equal(s.mark,'left-try');
  const next=start(s);
  if(n<3){assert.equal(next.low,false);assert.equal(next.state.unfinished,n);s=next.state;}
  else checkFallback(next,'unfinished');
 }
 console.log('PASS reload during loading: two guarded restarts, third unfinished leave recovers without a death diagnosis');
}
{
 let s=start().state;s=step(s,{type:'hide'}).state;assert.equal(s.mark,'left-try');
 s=step(s,{type:'show'}).state;s=feed(s,1,3600);
 assert.equal(s.mark,'try');assert.equal(s.reason,null);assert.equal(s.deaths,0);
 s=healthy(s);assert.equal(s.mark,'ok');
 s=step(s,{type:'hide'}).state;assert.equal(s.mark,'left-ok');s=step(s,{type:'show'}).state;
 assert.equal(s.mark,'ok');assert.equal(feed(s,1,3600).reason,null);
 s=step(s,{type:'leave'}).state;const next=start(s);
 assert.equal(next.low,false);assert.deepEqual([next.state.mark,next.state.unfinished,next.state.deaths],['try',0,0]);
 console.log('PASS lock without discard: hide/show retain health, skip the returned gap and do not create a death');
}
{
 let s=step(start().state,{type:'hide'}).state;s=feed(s,1,3600,false,false);
 const next=start(s);assert.equal(next.low,false);assert.equal(next.state.unfinished,1);assert.equal(next.state.deaths,0);
 console.log('PASS hours in background then discard: next start is guarded, not blamed on the device');
}
{
 checkFallback(start(start().state),'device');
 console.log('PASS silent kill before health: visible try recovers immediately and next load stays low');
}
{
 let s=healthy(initialQuality('try',2,1));assert.equal(s.mark,'ok');assert.equal(s.unfinished,0);assert.equal(s.deaths,1);
 s=step(s,{type:'leave'}).state;assert.equal(s.mark,'left-ok');assert.equal(s.deaths,1);
 const next=start(s);assert.deepEqual([next.state.mark,next.state.unfinished,next.state.deaths],['try',0,0]);
 console.log('PASS normal leave after health: only next clean start clears both counters');
}
{
 let s=healthy(start().state);let next=start(s);assert.equal(next.low,false);assert.equal(next.state.deaths,1);
 s=healthy(next.state);assert.equal(s.mark,'ok');assert.equal(s.deaths,1);
 checkFallback(start(s),'device');
 console.log('PASS silent kill after health twice: second visible healthy death restores phone detail');
}
{
 for(const mark of ['try','ok'])for(const type of ['lost','crawl']){
  const r=step(initialQuality(mark,2,1),{type});assert.equal(r.action,'fallback');
  assert.deepEqual([r.state.mark,r.state.unfinished,r.state.deaths,r.state.reason],[null,0,0,'device']);
  assert.deepEqual(step(r.state,{type:'show'}).state,r.state,'fallback is terminal until reset');
  assert.deepEqual(step(r.state,{type:'reset'}).state,initialQuality());
 }
 let s=feed(start().state,1199,1/60);assert.equal(s.mark,'try');s=feed(s,1,1/60);assert.equal(s.mark,'ok');
 s=feed(s,59,.2);assert.equal(s.mark,'ok');s=feed(s,1,.2);assert.equal(s.reason,'device');
 console.log('PASS guarded context loss or crawl: immediate fallback before and after health, with counters cleared');
}
{
 let s=feed(start().state,120,1/60);assert.ok(Math.abs(s.good-2)<1e-6);assert.equal(s.time,0,'two-second window closes at two seconds');
 s=feed(start().state,600,1/60);s=feed(s,34,1/17);s=feed(s,600,1/60);
 assert.equal(s.mark,'try','10 healthy + 2 at 17 fps + 10 healthy cannot become healthy');
 assert.ok(Math.abs(s.good-10)<1e-6);
 for(const [ready,visible]of [[false,true],[true,false]]){
  let s=feed(start().state,1199,1/60);s=feed(s,1,1/60,ready,visible);assert.equal(feed(s,1,1/60).mark,'try');
  s=feed(start().state,59,.2);s=feed(s,1,.2,ready,visible);assert.equal(feed(s,1,.2).reason,null);
 }
 assert.equal(feed(start().state,400,.05).mark,'ok');
 assert.equal(feed(start().state,1000,1/19).mark,'try');
 assert.equal(feed(start().state,1000,1/15).reason,null);
 for(const dt of [0,-1,NaN,Infinity])assert.equal(feed(start().state,1,dt).reason,null);
 let jitter=start().state;for(let i=0;i<60;i++)jitter=feed(jitter,1,i%2?.02:.38);assert.equal(jitter.reason,'device');
 assert.equal(feed(start().state,1,12).reason,'device');
 let slow=feed(start().state,50,.2);slow=feed(slow,120,1/60);slow=feed(slow,50,.2);
 assert.equal(slow.reason,null,'a healthy window must break accumulated slow time');
 assert.equal(feed(slow,10,.2).reason,'device');
 console.log('PASS mixed health windows, exact two-second boundary, pauses, rate boundaries, jitter and visible stalls');
}
for(const [screen,want]of [[3,['sharp','balanced','fast']],[2,['sharp','balanced','fast']],[1.35,['balanced','fast']],[1.25,['balanced','fast']],[1,['balanced']]]){
 assert.deepEqual(phonePictureChoices(screen),want);assert.equal(phonePictureRatio('balanced',screen),Math.min(screen,1.35));
 assert.equal(phonePictureRatio('sharp',screen),Math.min(screen,2));assert.equal(phonePictureRatio('fast',screen),1);
}
