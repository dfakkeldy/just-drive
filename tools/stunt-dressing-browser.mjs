// Real-game rigid dressing. Ordinary complete-rig arch crossings have their own row.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep} from './truck-cdp.mjs';
import {tyreContacts} from './tyre-contacts.mjs';
import {stuntStage} from './stunt-browser-stage.mjs';
const[out,url]=process.argv.slice(2),origin=new URL(url).origin,p=await open(`${origin}/?park=test&mode=explore&radio=0&scene=0&hud=1`),report={rigid:[]};
async function navigateVisible(url){const pulse=setInterval(()=>{p.send('Page.bringToFront').catch(()=>{});},200);try{await p.send('Page.bringToFront');await p.navigate(url);}finally{clearInterval(pulse);}}
try{
 for(const vehicle of ['car','truck']){
  await navigateVisible(`${origin}/?park=test&mode=explore&vehicle=${vehicle}&exag=1.5&radio=0&scene=0&hud=1`);await p.read(stuntStage(tyreContacts));
  const ids=await p.read("st.park.dressing.map((d,i)=>({i,id:d.placement.piece.id})).filter(d=>['timing-hut','start-arch','floodlight','line-furniture','pit-area','edge-stacks'].includes(d.id)).filter((d,i,a)=>d.id==='edge-stacks'||a.findIndex(x=>x.id===d.id)===i)");
  for(const{id,i}of ids){let index=i;
   // Edge stacks protect existing structures. Test their unchanged definition in a clear cell between ramps.
   if(id==='edge-stacks')index=await p.read(`(async()=>{const {PlacedDressing}=await import('/src/stunt-dressing.ts'),base=st.park.pieces[0],at=base.world(20,0),piece=st.park.dressing[${i}].placement.piece,d=new PlacedDressing({piece,...at,heading:base.placement.heading});st.park.dressing.push(d);st.park.group.add(d.group);st.fixture=d;return st.park.dressing.length-1;})()`);
   await p.read(`st.focus(st.park.dressing[${index}])`);
   const r=await p.read(`(()=>{const d=st.park.dressing[${index}],solids=d.solids,target=solids.find(s=>s.top-s.bottom>.25),v=st.v,park=st.park;let trials=[];
    const run=(heading,remove)=>{d.solids=remove?[]:solids;const ax=Math.sin(heading),az=-Math.cos(heading),extent=Math.abs(Math.cos(heading-target.heading))*target.half+Math.abs(Math.sin(heading-target.heading))*target.halfWidth,start=extent+v.spec.halfLength+3;v.pitch=v.roll=0;try{st.jumpTo(target.x-ax*start,target.z-az*start,heading,d.placement.piece.id);}catch(error){if(!String(error).includes('game refused park start'))throw error;return{placed:false,refusal:String(error)};}v.assist=0;v.steerAngle=0;v.vx=ax*5;v.vz=az*5;v.speed=5;const contacts=park.contacts;let steps=0;for(;steps<1200;steps++){const along=(v.x-target.x)*ax+(v.z-target.z)*az;if(along>extent+v.spec.halfLength+1||park.contacts>contacts&&Math.abs(v.speed)<.15)break;st.step(Math.max(-1,Math.min(1,(5-v.speed)*2)));}return{placed:true,steps,seconds:steps/120,contacts:park.contacts-contacts,speed:v.speed,along:(v.x-target.x)*ax+(v.z-target.z)*az,far:extent+v.spec.halfLength+1};};
    try{for(const turn of [0,Math.PI,Math.PI/2,-Math.PI/2]){const heading=target.heading+turn,control=run(heading,true),solid=run(heading,false);trials.push({control,solid});if(control.placed&&solid.placed&&control.along>control.far&&control.contacts===0&&solid.contacts>0&&Math.abs(solid.speed)<.15&&solid.along<0)return{passed:true,trials};}return{passed:false,trials};}finally{d.solids=solids;}})()`);
   report.rigid.push({vehicle,kind:id,index:i,isolatedDefinition:id==='edge-stacks',...r});if(id==='edge-stacks')await p.read(`(()=>{const d=st.fixture;st.park.group.remove(d.group);st.park.dressing.splice(st.park.dressing.indexOf(d),1);d.group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});delete st.fixture;})()`);assert.ok(r.passed,JSON.stringify({vehicle,id,r}));
  }
 }
 console.log('PASS rigid dressing proofs',JSON.stringify({rigidCases:report.rigid.length}));
}finally{writeFileSync(`${out}/stunt-dressing-browser.json`,JSON.stringify(report,null,2)+'\n');await p.close();await sleep(2500);}
