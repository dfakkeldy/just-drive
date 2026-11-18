import assert from 'node:assert/strict';
import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
const [run,first]=process.argv.slice(2),out=run+'/evidence/sugar-camp-browser',origin=new URL(first).origin.replace('127.0.0.1','localhost');
// Kept by check-all on a pass too: the six pictures and the poses, for a person to judge.
mkdirSync(out,{recursive:true});writeFileSync(out+'/poses.txt','');const note=(label,value)=>{const line=label+' '+JSON.stringify(value);console.log(line);appendFileSync(out+'/poses.txt',line+'\n');};
for(const phone of [false,true]) {
 const p=await open(`${origin}/?radio=0`);
 try {
 if(phone) await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await p.send('Page.navigate',{url:`${origin}/sugar-camp-quarry?site=just&radio=0&view=seat${phone?'&touch=1&q=low':''}`});
 for(let i=0;i<1200;i++){await sleep(250);if(await p.read(`document.documentElement.dataset.mmmReady==='true' && location.pathname==='/westbay' && new URLSearchParams(location.search).get('poster')==='sugar-camp-quarry'`))break;if(i===1199)throw Error('Alias boot timeout');}
 await sleep(8000);
 const start=await p.read(`(()=>{const f=mmm.fleet,v=mmm.vehicle;return {x:v.x,z:v.z,y:v.y,heading:v.heading,era:mmm.era.id,attached:mmm.towing.attached,members:f.members.map(m=>({id:m.id,state:m.state})),queued:f.visitQueued}})()`);
 note('START '+(phone?'phone':'desktop'),start);assert.equal(start.era,'today');assert.equal(start.attached,true);assert.ok(!start.queued);assert.ok(Math.cos(start.heading)<0);assert.ok(Math.hypot(start.x-9724.93,start.z+12398.51)<30,'the poster start is on Marble Mountain Road');assert.ok(start.members.filter(m=>m.state==='STRAPPED').length>=2);
 await p.read(`document.getElementById('titleStart')?.click()`);await sleep(1500);
 await p.shot(`${out}/${phone?'phone':'desktop'}-seat.png`);
 await p.read(`document.querySelector('#begin')?.click(); document.querySelector('#start')?.click()`);
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyV',key:'v'});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyV',key:'v'});await sleep(1500);
 await p.shot(`${out}/${phone?'phone':'desktop'}-chase.png`);
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'ArrowUp',key:'ArrowUp'});await sleep(30000);await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'ArrowUp',key:'ArrowUp'});
 const end=await p.read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,y:mmm.vehicle.y})`);note('END '+(phone?'phone':'desktop'),end);assert.ok(end.z>start.z,'southward drive');await p.shot(`${out}/${phone?'phone':'desktop'}-30s.png`);assert.deepEqual(p.errors,[]);
 }finally{await p.close();}
}
// The plain West Bay link keeps its own start: no poster key, and nowhere near the Marble Mountain pose.
{
 const p=await open(`${origin}/?radio=0`);
 try {
 await p.send('Page.navigate',{url:`${origin}/westbay?site=just&radio=0`});
 for(let i=0;i<1200;i++){await sleep(250);if(await p.read(`document.documentElement.dataset.mmmReady==='true' && location.pathname==='/westbay'`))break;if(i===1199)throw Error('West Bay boot timeout');}
 await sleep(4000);
 const plain=await p.read(`(()=>{const v=mmm.vehicle,q=new URLSearchParams(location.search);return {x:v.x,z:v.z,heading:v.heading,path:location.pathname,poster:q.get('poster'),start:q.get('start')}})()`);
 note('PLAIN WESTBAY',plain);assert.equal(plain.path,'/westbay');assert.equal(plain.poster,null);assert.equal(plain.start,null);
 assert.ok(Math.hypot(plain.x-9724.93,plain.z+12398.51)>1000,'plain West Bay does not start at the poster road');assert.deepEqual(p.errors,[]);
 }finally{await p.close();}
}
