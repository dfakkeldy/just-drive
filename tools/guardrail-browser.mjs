// Real driver's/chase cameras, real baked areas. Run serially with yard-shots.sh.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {open,sleep} from './cdp.mjs';
const root=resolve(import.meta.dirname,'..');
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
mkdirSync(out,{recursive:true});
const cases=[
 {name:'mines-cliff',area:'mabou',road:55,along:5493.73,rails:true,bull:true},
 {name:'judique-cliff',area:'judique',road:40,along:465.5,rails:true},
 {name:'westbay-cliff',area:'westbay',road:133,along:7972.4,rails:true},
 {name:'porthood-flat',area:'porthood',road:null,along:0,rails:false},
];
if(process.env.RAIL_ONLY) {const selected=cases.filter(s=>s.name===process.env.RAIL_ONLY);assert.ok(selected.length);cases.splice(0,cases.length,...selected);}
const evidence=[];
for(const site of cases){
 const folder=site.area==='mabou'?'terrain':`areas/${site.area}`,m=JSON.parse(readFileSync(resolve(root,`data/baked/${folder}/manifest.json`))),data=JSON.parse(readFileSync(resolve(root,`data/baked/${folder}/roads.json`)));
 const road=site.road===null?data.roads.filter(r=>r.kind<=3&&!r.bridge).sort((a,b)=>Math.hypot(a.pts[0][0]-m.village[0],a.pts[0][1]-m.village[1])-Math.hypot(b.pts[0][0]-m.village[0],b.pts[0][1]-m.village[1]))[0]:data.roads.find(r=>r.id===site.road);
 const station=along=>{let left=along;for(let i=1;i<road.pts.length;i++){const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(left<=len||i===road.pts.length-1){const t=Math.min(1,left/len);return {e:a[0]+dx*t,n:a[1]+dn*t,heading:Math.atan2(dx,dn)*180/Math.PI};}left-=len;}};
 let target=station(site.along),start=station(Math.max(0,site.along+(site.reverse?15:-15)));
 for(const view of ['seat','chase']){
  const query=new URLSearchParams({area:site.area,at:`${start.e},${start.n},${start.heading}`,view,hud:'0',mode:'explore',exag:'1.5',hour:'16.75',radio:'0',q:'high',shadows:'1',}),page=await open(`${origin}/?${query}`);
  try{
   // Brake the real car in its chosen pose; retain the production camera/scene update.
   await page.read(`(()=>{const v=mmm.vehicle,update=v.update.bind(v);v.update=(dt,input,...args)=>update(0,{throttle:0,steer:0,handbrake:true},...args);return true})()`);
   for(let i=0;i<100;i++){
    const ready=await page.read(`(()=>{const g=mmm.roads.guardrails;g.update(mmm.camera.position);return mmm.terrain.pending===0&&!g.audit.pending&&(!${site.bull}||mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig))})()`);
    if(ready)break;await sleep(200);
   }
   await sleep(1000);
   const state=await page.read(`(()=>{const m=mmm,g=m.roads.guardrails,x=${target.e-m.village[0]},z=${m.village[1]-target.n};return {camera:m.camera.position.toArray(),car:{x:m.vehicle.x,z:m.vehicle.z,heading:m.vehicle.heading},fine:m.terrain.surfaceAt(x,z)?.level,near:g.chunks.flatMap(c=>c.spans).filter(s=>Math.hypot(s.a.x-x,s.a.z-z)<35).map(s=>({road:s.road.id,along:s.a.along,side:s.side})),meshes:g.group.children.length,bull:m.animals?.residents.filter(r=>r.kind==='bull').map(r=>({home:r.home,pos:r.rig?.root.position.toArray(),head:r.rig?.head.rotation.y,kind:r.rig?.root.name}))}})()`);
   assert.ok(state.fine>=8,'finest terrain at evidence site');assert.equal(state.near.length>0,site.rails,`${site.name}: expected rail/no rail`);
   if(site.bull){
    const tracking=await page.read(`(()=>{const m=mmm,a=m.animals,r=a.residents.find(r=>r.kind==='bull'),v=m.vehicle,c=m.camera,before=r.rig.root.position.clone();const update=a.update.bind(a),fx=Math.sin(r.spot.heading),fz=-Math.cos(r.spot.heading);const save={x:v.x,z:v.z};v.x=r.spot.x-fx*14;v.z=r.spot.z-fz*14;for(let i=0;i<100;i++)update(.05,v,c);const first=r.rig.head.rotation.y;v.x=r.spot.x+fx*14;v.z=r.spot.z+fz*14;for(let i=0;i<100;i++)update(.05,v,c);const second=r.rig.head.rotation.y;a.honk(v);for(let i=0;i<100;i++)update(.05,v,c);const moved=before.distanceTo(r.rig.root.position);r.rig.root.updateMatrixWorld(true);const feet=r.rig.legs.map((leg,i)=>{const p=leg.localToWorld(r.rig.hoofSoles?.[i]?.clone()??before.clone().set(0,-r.rig.shoulder*.635,0));return {seaSide:-(p.x-r.spot.x)*Math.cos(r.spot.heading)-(p.z-r.spot.z)*Math.sin(r.spot.heading)-r.spot.road.halfWidth-1.2,error:p.y-(m.terrain.meshHeightAt(p.x,p.z,true)??m.terrain.heightAt(p.x,p.z))};});v.x=save.x;v.z=save.z;for(let i=0;i<100;i++)update(.05,v,c);r.rig.root.updateMatrixWorld(true);return {first,second,moved,feet,label:a.photoSubjects.find(s=>s.label.startsWith('Highland bull'))?.label}})()`);
    assert.ok(Math.abs(tracking.first-tracking.second)>.8,'head follows passing car');assert.ok(tracking.moved<.02,'honk leaves bull in place');assert.ok(tracking.feet.every(f=>f.seaSide>0&&Math.abs(f.error)<.025),'four hooves stand beyond rail on visible terrain');assert.ok(tracking.label.startsWith('Highland bull · '));state.tracking=tracking;
   }
   const file=resolve(out,`${site.name}-${view}.png`);await page.shot(file);evidence.push({site:site.name,view,file,state});console.log('PICTURE',file);
  }finally{await page.close();}
 }
}
writeFileSync(resolve(out,process.env.RAIL_ONLY?`browser-${process.env.RAIL_ONLY}-evidence.json`:'browser-evidence.json'),JSON.stringify(evidence,null,2));
console.log(`PASS ${cases.length} matching driver/chase site(s), rail/no-rail assertions and bull checks when present`);
