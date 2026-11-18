import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep,exitCheck} from './cdp.mjs';
const[out,first]=process.argv.slice(2),origin=new URL(first).origin,records=[];
for(const low of[false,true])for(const trip of['quarry','quarry-gate']){
 const p=await open(`${origin}/?trip=${trip}&area=westbay&mode=explore&vehicle=truck&trailer=1&q=${low?'low':'high'}&exag=1&radio=0&mp=0&hud=1&res=1${low?'&touch=1':''}`);
 try{await p.read("document.getElementById('titleStart')?.click()");let value;for(let i=0;i<100;i++){value=await p.read(`(()=>{const f=mmm.fleet,t=f?.tow;if(!f?.spawned||f.busy)return null;f.assertDriven();t.trailer.root.updateWorldMatrix(true,true);const e=t.trailer.root.matrixWorld.elements,h=t.hitch(),x=e[12]+e[4]*.43-e[8]*5.6,y=e[13]+e[5]*.43-e[9]*5.6,z=e[14]+e[6]*.43-e[10]*5.6;return{driver:f.driven.id,attached:t.attached,states:f.members.map(m=>({id:m.id,state:m.state})),coupler:Math.hypot(x-h.x,y-h.y,z-h.z),x:f.truck.x,z:f.truck.z}})()`);if(value)break;await sleep(100)}assert.ok(value,'preset settles a fleet');assert.equal(value.driver,'truck');assert.equal(value.attached,true);assert.ok(value.coupler<.03);assert.ok(value.states.filter(m=>m.id!=='truck').every(m=>m.state==='STRAPPED'));records.push({low,trip,...value});console.log('PASS loaded and hitched preset',low,trip,JSON.stringify(value));}finally{await p.close()}
}
writeFileSync(out+'/preset-results.json',JSON.stringify(records,null,2));exitCheck(0);
