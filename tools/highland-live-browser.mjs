// Real driver's/chase cameras, real baked areas. Run serially with yard-shots.sh.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {open,sleep} from './cdp.mjs';
import {damageHighland} from './highland-damaged-model.mjs';
const root=resolve(import.meta.dirname,'..');
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
mkdirSync(out,{recursive:true});
const site={name:'mines-cliff',area:'mabou',road:55,along:5493.73,rails:true,bull:true};
const damagedModel=kind=>damageHighland(readFileSync(resolve(root,'web/public/models/highland-bull.glb')),kind).toString('base64');
const evidence=[];
for(const variant of ['before','after','low','missing-node','missing-colour']) {
 const failed=variant==='before'||variant.startsWith('missing-');
 const folder=site.area==='mabou'?'terrain':`areas/${site.area}`,m=JSON.parse(readFileSync(resolve(root,`data/baked/${folder}/manifest.json`))),data=JSON.parse(readFileSync(resolve(root,`data/baked/${folder}/roads.json`)));
 const road=site.road===null?data.roads.filter(r=>r.kind<=3&&!r.bridge).sort((a,b)=>Math.hypot(a.pts[0][0]-m.village[0],a.pts[0][1]-m.village[1])-Math.hypot(b.pts[0][0]-m.village[0],b.pts[0][1]-m.village[1]))[0]:data.roads.find(r=>r.id===site.road);
 const station=along=>{let left=along;for(let i=1;i<road.pts.length;i++){const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(left<=len||i===road.pts.length-1){const t=Math.min(1,left/len);return {e:a[0]+dx*t,n:a[1]+dn*t,heading:Math.atan2(dx,dn)*180/Math.PI};}left-=len;}};
 let target=station(site.along),start=station(Math.max(0,site.along+(site.reverse?15:-15)));
 for(const view of (variant.startsWith('missing-')?['seat']:['seat','chase'])){
  const query=new URLSearchParams({area:site.area,at:`${start.e},${start.n},${start.heading}`,view,hud:'0',mode:'explore',exag:'1.5',hour:'16.75',radio:'0',q:variant==='low'?'low':'high',shadows:'1',}),page=await open(`${origin}/?${query}`);
  try{
   if(failed) {
    let source=`window.highlandWarnings=[];const warn=console.warn.bind(console);console.warn=(...args)=>{if(String(args[0]).startsWith('The Blender Highland bull did not load.'))window.highlandWarnings.push(args.map(String).join(' '));warn(...args);};`;
    if(variant==='before') {
      await page.send('Network.enable');await page.send('Network.setCacheDisabled',{cacheDisabled:true});
      await page.send('Network.setBlockedURLs',{urls:['*highland-bull*.glb']});
    } else {
      source+=`const fetchOriginal=window.fetch.bind(window);window.fetch=(input,init)=>String(input.url??input).includes('/models/highland-bull')?Promise.resolve(new Response(Uint8Array.from(atob(${JSON.stringify(damagedModel(variant))}),c=>c.charCodeAt(0)),{status:200,headers:{'Content-Type':'model/gltf-binary'}})):fetchOriginal(input,init);`;
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source});
    await page.navigate(`${origin}/?${query}`);
   }
   // Brake the real car in its chosen pose; retain the production camera/scene update.
   await page.read(`(()=>{const v=mmm.vehicle,update=v.update.bind(v);v.update=(dt,input,...args)=>update(0,{throttle:0,steer:0,handbrake:true},...args);return true})()`);
   for(let i=0;i<100;i++){
    const ready=await page.read(`(()=>{const g=mmm.roads.guardrails;g.update(mmm.camera.position);return mmm.terrain.pending===0&&!g.audit.pending&&(!${site.bull}||mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig))})()`);
    if(ready)break;await sleep(200);
   }
   for(let i=0;i<150;i++) {
    if(await page.read(`mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig&&${failed?'r.rig.shoulder!==1.12&&window.highlandWarnings?.length===1':'r.rig.shoulder===1.12'})`)) break;
    await sleep(200);
   }
   await sleep(1500);
   const model=await page.read(`(()=>{const r=mmm.animals.residents.find(r=>r.kind==='bull');let triangles=0,draws=0;r.rig.root.traverse(n=>{if(n.isMesh){draws++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3}});return {triangles,draws,blender:!!r.rig.hoofSoles&&r.rig.shoulder===1.12}})()`);
   assert.equal(model.blender,!failed,'loaded model or forced-failure fallback');
   if(!failed) { assert.equal(model.triangles,variant==='low'?1478:7600);assert.equal(model.draws,variant==='low'?2:7); }
   if(failed) {
    const warnings=await page.read('window.highlandWarnings');assert.equal(warnings.length,1,'one warning, no retry, built-in bull remains');
    if(variant==='missing-node') assert.match(warnings[0],/Highland bull is missing head/);
    if(variant==='missing-colour') assert.match(warnings[0],/needs positions, normals, colours and an index/);
    console.log('FALLBACK',variant,warnings[0]);
   }
   console.log('MODEL',variant,model);
   const state=await page.read(`(()=>{const m=mmm,g=m.roads.guardrails,x=${target.e-m.village[0]},z=${m.village[1]-target.n};return {camera:m.camera.position.toArray(),car:{x:m.vehicle.x,z:m.vehicle.z,heading:m.vehicle.heading},fine:m.terrain.surfaceAt(x,z)?.level,near:g.chunks.flatMap(c=>c.spans).filter(s=>Math.hypot(s.a.x-x,s.a.z-z)<35).map(s=>({road:s.road.id,along:s.a.along,side:s.side})),meshes:g.group.children.length,bull:m.animals?.residents.filter(r=>r.kind==='bull').map(r=>({home:r.home,pos:r.rig?.root.position.toArray(),head:r.rig?.head.rotation.y,kind:r.rig?.root.name}))}})()`);
   assert.ok(state.fine>=8,'finest terrain at evidence site');assert.equal(state.near.length>0,site.rails,`${site.name}: expected rail/no rail`);
   if(site.bull){
    const tracking=await page.read(`(()=>{const m=mmm,a=m.animals,r=a.residents.find(r=>r.kind==='bull'),v=m.vehicle,c=m.camera,before=r.rig.root.position.clone();const update=a.update.bind(a),fx=Math.sin(r.spot.heading),fz=-Math.cos(r.spot.heading);const save={x:v.x,z:v.z};v.x=r.spot.x-fx*14;v.z=r.spot.z-fz*14;for(let i=0;i<100;i++)update(.05,v,c);const first=r.rig.head.rotation.y;v.x=r.spot.x+fx*14;v.z=r.spot.z+fz*14;for(let i=0;i<100;i++)update(.05,v,c);const second=r.rig.head.rotation.y;a.honk(v);for(let i=0;i<100;i++)update(.05,v,c);const moved=before.distanceTo(r.rig.root.position);r.rig.root.updateMatrixWorld(true);const feet=r.rig.legs.map((leg,i)=>{const p=${variant==='low'?"r.rig.root.localToWorld(r.rig.hooves[i].clone())":"leg.localToWorld(r.rig.hoofSoles?.[i]?.clone()??before.clone().set(0,-r.rig.shoulder*.635,0))"};return {seaSide:-(p.x-r.spot.x)*Math.cos(r.spot.heading)-(p.z-r.spot.z)*Math.sin(r.spot.heading)-r.spot.road.halfWidth-1.2,error:p.y-(m.terrain.meshHeightAt(p.x,p.z,true)??m.terrain.heightAt(p.x,p.z))};});v.x=save.x;v.z=save.z;for(let i=0;i<100;i++)update(.05,v,c);r.rig.root.updateMatrixWorld(true);return {first,second,moved,feet,label:a.photoSubjects.find(s=>s.label.startsWith('Highland bull'))?.label}})()`);
    assert.ok(Math.abs(tracking.first-tracking.second)>.8,'head follows passing car');assert.ok(tracking.moved<.02,'honk leaves bull in place');console.log('FEET',variant,tracking.feet);assert.ok(tracking.feet.every(f=>f.seaSide>0&&Math.abs(f.error)<.025),'four hooves stand beyond rail on visible terrain');assert.ok(tracking.label.startsWith('Highland bull · '));state.tracking=tracking;
    const contact=await page.read(`(()=>{const a=mmm.animals,r=a.residents.find(r=>r.kind==='bull'),v=mmm.vehicle,p=r.rig.root.position,save={x:v.x,z:v.z,heading:v.heading};v.place(p.x,p.z,r.spot.heading);a.protect(v);const gap=Math.hypot(v.x-p.x,v.z-p.z);v.place(save.x,save.z,save.heading);return gap})()`);
    assert.ok(contact>=2.24,'existing contact rule pushes overlapping car clear');
   }
   const file=resolve(out,`${variant}-${site.name}-${view}.png`);await page.shot(file);evidence.push({variant,model,site:site.name,view,file,state});console.log('PICTURE',file);
  }finally{await page.close();}
 }
}
writeFileSync(resolve(out,'highland-live-evidence.json'),JSON.stringify(evidence,null,2));
console.log(`PASS 1 matching driver/chase site(s), rail/no-rail assertions and bull checks when present`);
