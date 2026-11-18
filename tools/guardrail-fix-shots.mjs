// Extra review pictures: the mapped mailbox opening and the restored four-cattle pasture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {open,sleep} from './cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const root=resolve(import.meta.dirname,'..');
const village=JSON.parse(readFileSync(resolve(root,'data/baked/terrain/manifest.json'))).village;
const roads=JSON.parse(readFileSync(resolve(root,'data/baked/terrain/roads.json'))).roads;
const road=roads.find(r=>r.id===55);
function station(along){for(let i=1;i<road.pts.length;i++){const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(along<=len)return {e:a[0]+dx*along/len,n:a[1]+dn*along/len,heading:Math.atan2(dx,dn)*180/Math.PI};along-=len;}throw Error('station');}
const p=station(5359.42),car=station(5349.42),r=p.heading*Math.PI/180;
const mailbox=JSON.parse(readFileSync(resolve(root,'data/baked/terrain/props.json'))).mailboxes.sort((a,b)=>Math.hypot(a.x-p.e,a.y-p.n)-Math.hypot(b.x-p.e,b.y-p.n))[0];
const queries=[
 ['mailbox-opening',new URLSearchParams({mode:'explore',area:'mabou',at:`${car.e},${car.n},${car.heading}`,cam:`${p.e+Math.cos(r)*1.5},${p.n-Math.sin(r)*1.5},2,${p.heading-75},-13,62`,camground:'1',exag:'1.5',hour:'12',hud:'0',radio:'0'})],
 ['restored-herd',new URLSearchParams({mode:'explore',animal:'cow',demo:'8',exag:'1.5',hour:'12',hud:'0',radio:'0'})],
];
const evidence=[];
for(const [name,query]of queries){const page=await open(`${origin}/?${query}`);try{
 for(let i=0;i<180;i++){
  const ready=await page.read(`(()=>{const m=mmm,g=m.roads.guardrails;g.update(m.camera.position);return m.terrain.pending===0&&!g.audit.pending&&m.animals?.residents.some(r=>r.kind==='bull'&&r.rig)&&(${JSON.stringify(name)}!=='restored-herd'||m.animals.residents.some(r=>r.kind==='cow'&&r.rig&&r.herd.length===4))})()`);
  if(ready)break;await sleep(250);
 }
 const state=await page.read(`(()=>{const m=mmm,a=m.animals,cow=a.residents.find(r=>r.kind==='cow'),bull=a.residents.find(r=>r.kind==='bull');return {mailboxRailClear:m.roads.guardrails.chunks.flatMap(c=>c.spans).every(s=>{const x=${mailbox.x-village[0]},z=${village[1]-mailbox.y},dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,t=Math.max(0,Math.min(1,((x-s.a.x)*dx+(z-s.a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(s.a.x+t*dx-x,s.a.z+t*dz-z)>.95}),cow:{home:cow.home,position:cow.rig?.root.position,herd:cow.herd.map(g=>({kind:g.kind,home:g.home,position:g.rig.root.position}))},bull:{home:bull.home,position:bull.rig?.root.position},terminalGround:(()=>{const g=m.roads.guardrails,out=[];for(const c of g.chunks){if(!c.mesh?.visible)continue;const pos=c.mesh.geometry.attributes.position,rail=c.mesh.geometry.attributes.rail;for(const s of c.spans)for(const p of [s.a.along===s.runStart?s.a:null,s.b.along===s.runEnd?s.b:null]){if(!p)continue;for(let i=0;i<pos.count;i++){if(Math.abs(rail.getY(i)+.156)>.0001||Math.hypot(pos.getX(i)-p.x,pos.getZ(i)-p.z)>.001)continue;const ground=m.terrain.meshHeightAt(p.x,p.z,true);if(ground!==null)out.push({road:s.road.id,along:p.along,error:pos.getY(i)-ground,sampled:pos.getY(i)-m.terrain.heightAt(p.x,p.z)});}}}return out})(),nearestCattleToBull:Math.min(...[cow.rig,...cow.herd.map(g=>g.rig)].filter(Boolean).map(r=>r.root.position.distanceTo(bull.rig.root.position)))}})()`);
 assert.ok(state.mailboxRailClear,'production main/Props hook opens rail at the surveyed mailbox');assert.ok(state.terminalGround.length>0&&state.terminalGround.every(e=>e.error>=0&&e.error<.04),'rail ends meet visible terrain within 4cm');assert.equal(state.cow.herd.length,4,'restored herd');assert.ok(state.nearestCattleToBull>3,'bull and main cattle do not overlap');
 if(name==='restored-herd')await page.read(`(()=>{const m=mmm,r=m.animals.residents.find(r=>r.kind==='cow'),p=r.herd.reduce((p,g)=>({x:p.x+g.home.x/4,z:p.z+g.home.z/4}),{x:0,z:0}),h=m.terrain.heightAt(p.x,p.z);m.vehicle.update=()=>{};m.vehicle.car.root.parent.onBeforeRender=(_r,_s,c)=>{c.fov=52;c.updateProjectionMatrix();c.position.set(p.x+10,h+16,p.z+12);c.lookAt(p.x,h+.8,p.z);c.updateMatrixWorld();};return true})()`);
 await sleep(1200);const file=resolve(out,`${name}-fix-noon.png`);await page.shot(file);evidence.push({name,file,state});console.log('PICTURE',file);
}finally{await page.close();}}
writeFileSync(resolve(out,'extra-evidence.json'),JSON.stringify(evidence,null,2));
