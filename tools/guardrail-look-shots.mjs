// Pictures of the guard rail's look: the nine review views (seat and chase at four sites, the dent close-up)
// plus two views that stand where the dash cam stood. Real cameras, real baked areas, no assertions on the look.
// Run serially through yard-shots.sh:
//   RAIL_TAG=after OUT="$PWD/data/work/threads/guardrails-look" RUN=guardrail-look-shots.mjs tools/yard-shots.sh 1400 950
// RAIL_HOURS="noon=12,dusk=18" picks the times of day; RAIL_ONLY=<site> one site; RAIL_QUALITY=low the phone build.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {open,sleep} from './cdp.mjs';
const root=resolve(import.meta.dirname,'..');
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
mkdirSync(out,{recursive:true});
const tag=process.env.RAIL_TAG??'look',quality=process.env.RAIL_QUALITY==='low'?'low':'high';
const hours=(process.env.RAIL_HOURS??'noon=12,dusk=18').split(',').map(p=>{const [label,hour]=p.split('=');assert.ok(label&&Number.isFinite(Number(hour)),'RAIL_HOURS is label=hour,...');return {label,hour};});
// Same four sites and the same car poses as tools/guardrail-browser.mjs.
const sites=[
 {name:'mines-cliff',area:'mabou',road:55,along:5493.73,bull:true},
 {name:'judique-cliff',area:'judique',road:40,along:465.5},
 {name:'westbay-cliff',area:'westbay',road:133,along:7972.4},
 {name:'porthood-flat',area:'porthood',road:null,along:0},
];
// Fixed cameras on Mabou Mines Road, by road station and metres to the right of the centre line (the sea is on the left).
// eye is metres above the ground; heading is degrees relative to the road's own heading at that station.
const DENT=5484.51;   // the surveyed tear point, projected onto the road: the middle of the one dent
const cameras=[
 {name:'mines-crumple-detail',along:DENT+1.2,right:-1.2,eye:1.5,turn:-112,pitch:-15,fov:62},
 {name:'mines-bull-window',along:5493.73,right:-1.5,eye:1.25,turn:-98,pitch:-4,fov:62},
 {name:'mines-bull-across',along:5492.02,right:2.1,eye:1.2,turn:-84,pitch:-2,fov:50},
 {name:'mines-dent-along',along:DENT-8.5,right:-1.7,eye:1.3,turn:-13,pitch:-9,fov:52},
];
const only=process.env.RAIL_ONLY;
const load=area=>{const folder=area==='mabou'?'terrain':`areas/${area}`;
 return {m:JSON.parse(readFileSync(resolve(root,`data/baked/${folder}/manifest.json`))),data:JSON.parse(readFileSync(resolve(root,`data/baked/${folder}/roads.json`)))};};
const stationOn=road=>along=>{let left=along;for(let i=1;i<road.pts.length;i++){const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(left<=len||i===road.pts.length-1){const t=Math.min(1,left/len);return {e:a[0]+dx*t,n:a[1]+dn*t,heading:Math.atan2(dx,dn)*180/Math.PI};}left-=len;}};
const common={hud:'0',mode:'explore',exag:'1.5',radio:'0',q:quality,shadows:'1'};
const settle=async(page,bull)=>{
 for(let i=0;i<150;i++){
  const ready=await page.read(`(()=>{const g=mmm.roads.guardrails;g?.update(mmm.camera.position);return mmm.terrain.pending===0&&!g.audit.pending&&(!${!!bull}||mmm.animals?.residents.some(r=>r.kind==='bull'&&r.rig))})()`);
  if(ready)break;await sleep(200);
 }
 await sleep(1500);
 // A shader that does not compile draws nothing and throws nothing: a picture without a rail would look like a pass.
 const broken=await page.read(`mmm.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).map(p=>[p.name,p.diagnostics.programLog,p.diagnostics.vertexShader?.log,p.diagnostics.fragmentShader?.log].join(' | '))`);
 assert.deepEqual(broken,[],'every shader program compiles');
 const rails=await page.read(`(()=>{const g=mmm.roads.guardrails;return g?g.group.children.filter(m=>m.visible).length:0})()`);
 return rails;
};
let pictures=0;
for(const {label,hour} of hours){
 for(const site of sites){
  if(only&&only!==site.name)continue;
  const {m,data}=load(site.area);
  const road=site.road===null?data.roads.filter(r=>r.kind<=3&&!r.bridge).sort((a,b)=>Math.hypot(a.pts[0][0]-m.village[0],a.pts[0][1]-m.village[1])-Math.hypot(b.pts[0][0]-m.village[0],b.pts[0][1]-m.village[1]))[0]:data.roads.find(r=>r.id===site.road);
  const start=stationOn(road)(Math.max(0,site.along-15));
  for(const view of ['seat','chase']){
   const query=new URLSearchParams({...common,area:site.area,at:`${start.e},${start.n},${start.heading}`,view,hour:String(hour)}),page=await open(`${origin}/?${query}`);
   try{
    // Brake the real car in its chosen pose; keep the production camera and scene update.
    await page.read(`(()=>{const v=mmm.vehicle,update=v.update.bind(v);v.update=(dt,input,...args)=>update(0,{throttle:0,steer:0,handbrake:true},...args);return true})()`);
    const drawn=await settle(page,site.bull);assert.equal(drawn>0,site.name!=='porthood-flat',`${site.name}: rail drawn only where the rule places one`);
    const file=resolve(out,`${site.name}-${view}-${tag}-${label}.png`);await page.shot(file);pictures++;console.log('PICTURE',file);
   }finally{await page.close();}
  }
 }
 if(only&&only!=='mines-cliff')continue;
 const {data}=load('mabou'),road=data.roads.find(r=>r.id===55),station=stationOn(road),car=station(5482.31+34);
 for(const c of cameras){
  const p=station(c.along),h=p.heading*Math.PI/180,e=p.e+Math.cos(h)*c.right,n=p.n-Math.sin(h)*c.right;
  // The car waits out of the frame, further up the road, so that the bull and the fine land are built.
  const query=new URLSearchParams({...common,area:'mabou',at:`${car.e},${car.n},${car.heading}`,cam:`${e},${n},${c.eye},${p.heading+c.turn},${c.pitch},${c.fov}`,camground:'1',hour:String(hour)}),page=await open(`${origin}/?${query}`);
  try{
   assert.ok(await settle(page,true)>0,`${c.name}: the rail is drawn`);
   const file=resolve(out,`${c.name}-${tag}-${label}.png`);await page.shot(file);pictures++;console.log('PICTURE',file);
  }finally{await page.close();}
 }
}
console.log(`DONE ${pictures} picture(s), tag ${tag}, ${quality} detail, hours ${hours.map(h=>h.label+'='+h.hour).join(' ')}`);
