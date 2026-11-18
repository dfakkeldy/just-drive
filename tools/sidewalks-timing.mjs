import assert from 'node:assert/strict';
export function timingStats(values){
 assert.ok(values.length,'timing samples must be nonempty');
 assert.ok(values.every(Number.isFinite),'finite timing samples');
 const xs=[...values].sort((a,b)=>a-b),n=xs.length;
 return {samples:n,min:xs[0],median:xs[Math.floor(n/2)],p95:xs[Math.ceil(n*.95)-1],max:xs[n-1]};
}
export function replaySchedule(pairs,diagnostic=false){
 assert.ok(Number.isInteger(pairs)&&pairs>0);
 const result=[];
 for(let round=0;round<pairs;round++){
  const blocks=[['noise-a','noise-b'],['base-a32','a32'],['base-fixed','fixed']];
  if(diagnostic)blocks.push(['base-counts','fixed-counts']);
  if(round%2)blocks.reverse();
  for(const block of blocks)for(const label of block)result.push({round,label,variant:label==='a32'?'a32':label==='fixed'?'fixed':label==='fixed-counts'?'fixed-counts':'main'});
 }return result;
}
export function compareReplay(loads,{area,low,startupReference,diagnostic=false}){
 const pairs=low?3:7,measured=loads.filter(r=>!r.warmup),allFixed=loads.filter(r=>r.variant==='fixed');
 assert.equal(measured.length,pairs*(diagnostic?8:6),'complete seven desktop or three LOW pairs');
 const at=(round,label)=>{const rows=measured.filter(r=>r.round===round&&r.label===label);assert.equal(rows.length,1,`${round}/${label}: exactly one load`);return rows[0];};
 const differences=(a,b,key=r=>r.ms)=>timingStats(Array.from({length:pairs},(_,i)=>key(at(i,a))-key(at(i,b))));
 const fixed=Array.from({length:pairs},(_,i)=>at(i,'fixed')),prior=Array.from({length:pairs},(_,i)=>at(i,'a32'));
 const noise=differences('noise-b','noise-a'),current=differences('fixed','base-fixed'),old=differences('a32','base-a32');
 const noiseByPid={};for(let i=0;i<pairs;i++){const state=at(i,'noise-a').roundMetadata?.pid70423Alive,key=state===undefined?'unrecorded':state?'alive':'absent';(noiseByPid[key]??=[]).push(at(i,'noise-b').ms-at(i,'noise-a').ms);}for(const key of Object.keys(noiseByPid))noiseByPid[key]=timingStats(noiseByPid[key]);
 const corrected=timingStats(Array.from({length:pairs},(_,i)=>(at(i,'fixed').ms-at(i,'base-fixed').ms)-(at(i,'a32').ms-at(i,'base-a32').ms)));
 const readiness=(variant,base)=>{
  const segment=(r,k)=>{const m=r.milestones;return k==='exposure'?m.exposed:k==='terrain'?m.lastTerrainBusy-m.exposed:m.ready-m.lastTerrainBusy;};
  return Object.fromEntries(['exposure','terrain','afterTerrain'].map(k=>[k,differences(variant,base,r=>segment(r,k))]));
 };
 const startup=timingStats(fixed.map(r=>r.audit.startupMs));
 return {area,low,pairs,noise,noiseByPid,currentVsMain:current,a32VsMain:old,currentVsA32:differences('fixed','a32'),correctedCurrentVsA32:corrected,
  settle:current.median<noise.min?'faster-than-noise':current.median<=noise.max?'within-noise':'outside-noise',
  startup,allStartup:timingStats(allFixed.map(r=>r.audit.startupMs)),startupReference:low?startupReference:null,
  startupMedianDelta:low?startup.median-startupReference.median:null,startupMaxDelta:low?startup.max-startupReference.max:null,
  frameWorst:Math.max(...allFixed.map(r=>r.maxFrame)),frameP95:Math.max(...fixed.map(r=>r.frameStats.sidewalk.p95)),
  a32FrameWorst:Math.max(...prior.map(r=>r.maxFrame)),readiness:{fixed:readiness('fixed','base-fixed'),a32:readiness('a32','base-a32')},
  diagnostic:diagnostic?{countsOnlyVsMain:differences('fixed-counts','base-counts'),clockedVsCountsOnly:differences('fixed','fixed-counts'),adjustedClockCost:timingStats(Array.from({length:pairs},(_,i)=>(at(i,'fixed').ms-at(i,'base-fixed').ms)-(at(i,'fixed-counts').ms-at(i,'base-counts').ms))),readiness:readiness('fixed-counts','base-counts'),note:'counts-only query cost is not timed; diagnostic never substitutes for the primary frame gate'}:null};
}
export function assertReplayTargets(row){
 const name=`${row.area}/${row.low}`;
 assert.notEqual(row.settle,'outside-noise',`${name}: paired median ${row.currentVsMain.median} outside main/main [${row.noise.min},${row.noise.max}] ms`);
 assert.ok(row.frameWorst<=2,`${name}: sidewalk frame ${row.frameWorst} ms > 2`);
 assert.ok(row.allStartup.max<=20,`${name}: startup ${row.allStartup.max} ms > 20`);
 if(row.low){assert.ok(row.startupMedianDelta<=1,`${name}: LOW median startup increase ${row.startupMedianDelta} ms > 1`);assert.ok(row.startupMaxDelta<=1,`${name}: LOW max startup increase ${row.startupMaxDelta} ms > 1`);}
}
