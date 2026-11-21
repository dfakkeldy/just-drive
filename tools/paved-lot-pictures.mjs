/** Default-on lot pictures from the road (initial paving delta): Judique, Port Hood, Point Tupper; desktop and LOW; on and paved=0.
 * node tools/paved-lot-pictures.mjs OUT WEB_PORT [WORK]
 * "on" uses NO paved flag. On installed land (manifest key present) it must load tiles: the default; on land
 * without the key it must make no request. paved=0 never requests.
 * WORK (a six-area paved bake) only chooses poses: the largest painted lots and the nearest road point to each.
 * Run under tools/browser.sh (CDP_PORT). hud=0 makes the visit bare (no title card), so the credit is pinned by site-title,
 * not here. Once the land check expects 'after', all three areas must be installed: no vacuous pass on old land.
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {open} from './cdp.mjs';
const [out,port,work]=process.argv.slice(2);mkdirSync(out,{recursive:true});
const AREAS={judique:'areas/judique',porthood:'areas/porthood',pointtupper:'areas/pointtupper'};
const ring=g=>g.type==='Polygon'?[g.coordinates[0]]:g.coordinates.map(p=>p[0]);
const shoelace=r=>{let a=0,x=0,y=0;for(let i=0;i<r.length-1;i++){const [x0,y0]=r[i],[x1,y1]=r[i+1],c=x0*y1-x1*y0;a+=c;x+=(x0+x1)*c;y+=(y0+y1)*c;}return {a:Math.abs(a/2),c:[x/(3*a),y/(3*a)]};};
function nearest(roads,p){
 let best=null;
 for(const r of roads){if(r.kind>3||r.bridge||r.pts.length<2)continue;
  for(let i=0;i<r.pts.length-1;i++){const [ax,ay]=r.pts[i],[bx,by]=r.pts[i+1],dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy||1,t=Math.max(0,Math.min(1,((p[0]-ax)*dx+(p[1]-ay)*dy)/l));
   const q=[ax+t*dx,ay+t*dy],d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(!best||d<best.d)best={d,q,name:r.name??'',kind:r.kind};}}
 return best;
}
function poses(){
 if(!work)return JSON.parse(readFileSync(new URL('./paved-lot-poses.json',import.meta.url),'utf8'));
 const list=[];
 for(const [area,folder] of Object.entries(AREAS)){
  const roads=JSON.parse(readFileSync(`${process.cwd()}/public/${folder}/roads.json`,'utf8')).roads;
  const lots=JSON.parse(readFileSync(`${work}/${area}/lots.geojson`,'utf8')).features.map(f=>({id:f.properties.id,...ring(f.geometry).map(shoelace).sort((a,b)=>b.a-a.a)[0]})).sort((a,b)=>b.a-a.a).slice(0,3);
  for(const lot of lots){const n=nearest(roads,lot.c);if(!n||n.d>90)continue;
   const bearing=(Math.atan2(lot.c[0]-n.q[0],lot.c[1]-n.q[1])*180/Math.PI+360)%360;
   list.push({area,lot:lot.id,m2:Math.round(lot.a),road:n.name,roadKind:n.kind,metres:Math.round(n.d),at:[Math.round(n.q[0]*10)/10,Math.round(n.q[1]*10)/10,Math.round(bearing)]});}
 }
 return list;
}
const installed=Object.fromEntries(Object.entries(AREAS).map(([a,f])=>[a,!!JSON.parse(readFileSync(`${process.cwd()}/public/${f}/manifest.json`,'utf8')).paved]));
// The land check's EXPECT moves to 'after' in the install PR: then every pictured area must have its lots.
const expect=readFileSync(new URL('./paved-open-land-check.py',import.meta.url),'utf8').match(/^EXPECT = (None|'before'|'after')$/m)?.[1];
assert.ok(expect,'land check EXPECT not found');
if(expect==="'after'")assert.ok(Object.values(installed).every(Boolean),'land check expects after, but an area has no paved key: '+JSON.stringify(installed));
const chosen=poses();writeFileSync(out+'/poses.json',JSON.stringify(chosen,null,1)+'\n');
const base='mode=explore&hud=0&radio=0&shadows=1&exag=1&sun=original';
const shots=[];
for(const pose of chosen)for(const q of ['desktop','low'])for(const on of [true,false]){
 const url=`http://127.0.0.1:${port}/?area=${pose.area}&at=${pose.at.join(',')}&${base}${q==='low'?'&q=low':''}${on?'':'&paved=0'}`;
 const page=await open(url);
 try{
  // A dev page loads more modules than the default 250-entry resource timing buffer holds, so the paved fetch can drop
  // out of it (it does with the bridge cut worker and atlas). Reload with a larger buffer, as paved-capture does.
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'performance.setResourceTimingBufferSize(100000)'});
  await page.navigate(url+'&timingBuffer=1');
  assert.equal(await page.read(`document.getElementById('gameError')?.hidden`),true,'game error');
  assert.ok(await page.read(`performance.getEntriesByType('resource').length`)<100000,'resource timing buffer holds every request');
  const requests=await page.read(`performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.includes('/paved/'))`);
  // Default on exactly where the land is installed; paved=0 never requests; uninstalled land never requests.
  assert.equal(requests.length>0,on&&installed[pose.area],on?(installed[pose.area]?'default must load the installed paved layer':'uninstalled land must make no paved request'):'paved=0 must make no paved request');
  const file=`${out}/${pose.area}-${pose.lot}-${q}-${on?'on':'off'}.png`;
  await page.shot(file);shots.push({...pose,q,on,installed:installed[pose.area],url,file,pavedRequests:requests.length});console.log('CAPTURE',file,'requests',requests.length);
  assert.equal(page.errors.length,0,page.errors.join('\n'));
 }finally{await page.close();}
}
writeFileSync(out+'/pictures.json',JSON.stringify(shots,null,1)+'\n');
console.log('PASS lot pictures:',shots.length,'installed',JSON.stringify(installed),'(on = no flag, off = paved=0; desktop and LOW)');
