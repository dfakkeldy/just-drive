// Park grading and completed-arrival behaviour, on real land and the production journey class.
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import{Terrain}from'../web/src/terrain.ts';
import{QuarrySite,APRON,LOOKOFFS}from'../web/src/quarry-site.ts';
import{QuarryJourney}from'../web/src/quarry-journey.ts';
import{createTrailer}from'../web/src/trailer.ts';
import{FleetSurface}from'../web/src/fleet-surface.ts';
import{deckContact}from'./fleet-deck-contact.mjs';
import{wheelVertices}from'./fleet-wheel-vertices.mjs';
import{png}from'./quarry-height-read.mjs';
const root=process.cwd(),base=root+'/data/baked/areas/westbay',manifest=JSON.parse(readFileSync(base+'/manifest.json')),world=(e,n)=>({x:e-manifest.village[0],z:manifest.village[1]-n});
const element=()=>({dataset:{},setAttribute(){},parentElement:null,append(n){n.parentElement=this;},classList:{contains:()=>false}}),body=element();globalThis.document={body,head:element(),createElement:element,getElementById:()=>null};
if(!process.env.QUARRY_FLEET_CASE||process.env.QUARRY_FLEET_CASE==='grade'){
 THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
 globalThis.fetch=async path=>new Response(readFileSync(path));globalThis.createImageBitmap=async blob=>png(Buffer.from(await blob.arrayBuffer()));globalThis.OffscreenCanvas=class{getContext(){let image;return{drawImage(b){image=b},getImageData(){return{data:image.pixels}}}}};
 const measured=[];
 for(const hill of[1,1.5,2,2.5]){
  const terrain=new Terrain(manifest,base,{},hill,-.2),site=new QuarrySite(manifest.village);terrain.sites.push(site);terrain.coast=site;
  const locations=[{e:APRON.e,n:APRON.n},{e:632054.018,n:5061791.653}];
  for(const p of locations)for(let e=p.e-70;e<=p.e+70;e+=35)for(let n=p.n-70;n<=p.n+70;n+=35){const size=manifest.size/256,i=Math.floor((e-manifest.origin[0])/size),j=Math.floor((manifest.origin[1]-n)/size);if(!terrain.tiles.get('8/'+i+'_'+j)?.ready)await terrain.loadNow(8,i,j)}
  terrain.group.traverse(m=>{if(m.isMesh)m.visible=true});terrain.group.updateMatrixWorld(true);
  const vertices=Array.from({length:4},()=>new THREE.Vector3()),ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0)),hit=new THREE.Vector3();
  const drawn=(e,n)=>{const{x,z}=world(e,n),tile=terrain.drawnTile(x,z);assert.ok(tile?.mesh,'drawn apron support loaded');const p=tile.mesh.geometry.getAttribute('position'),width=Math.round(Math.sqrt(p.count)),seg=width-3,a=Math.min(seg-1,Math.max(0,Math.floor((x-tile.x0)*seg/tile.size))),b=Math.min(seg-1,Math.max(0,Math.floor((z-tile.z0)*seg/tile.size))),k=(b+1)*width+a+1;for(const[i,at]of[k,k+1,k+width,k+width+1].entries())vertices[i].fromBufferAttribute(p,at).applyMatrix4(tile.mesh.matrixWorld);ray.origin.set(x,3000,z);let h=-Infinity;if(ray.intersectTriangle(vertices[0],vertices[1],vertices[2],false,hit))h=hit.y;if(ray.intersectTriangle(vertices[1],vertices[3],vertices[2],false,hit))h=Math.max(h,hit.y);assert.ok(Number.isFinite(h));assert.ok(Math.abs(h-terrain.meshHeightAt(x,z,true))<1e-5);return h;};
  const slope=(e,n,heading)=>{const f=[Math.sin(heading),Math.cos(heading)],r=[Math.cos(heading),-Math.sin(heading)];return{along:Math.atan(Math.abs(drawn(e+f[0],n+f[1])-drawn(e-f[0],n-f[1]))/2)*180/Math.PI,cross:Math.atan(Math.abs(drawn(e+r[0],n+r[1])-drawn(e-r[0],n-r[1]))/2)*180/Math.PI};};
  let along=0,cross=0;for(let e=APRON.e-18;e<=APRON.e+18;e+=2)for(let n=APRON.n-28;n<=APRON.n+28;n+=2){const s=slope(e,n,-.467);along=Math.max(along,s.along);cross=Math.max(cross,s.cross)}
  const approach=slope(632054.018,5061791.653,-.4733);measured.push({hill,apron:{along,cross},approach});
  for(const[e,n,h]of[[631609,5064398,57.56],[631182.9,5062647,27.204]]){const p=world(e,n);assert.equal(site.height(p.x,p.z,h),h,'grading preserves remote survey contact spikes');}
 }
 console.log('GRADE',JSON.stringify(measured));
 for(const row of measured){assert.ok(row.apron.along<=12&&row.apron.cross<=8,'graded apron meets unchanged 12/8 degree unload limits at Hill '+row.hill);assert.ok(row.approach.along<=12&&row.approach.cross<=8,'graded approach remains driveable at Hill '+row.hill)}
 console.log('PASS real drawn apron/approach grades at four Hill heights');
}
if(!process.env.QUARRY_FLEET_CASE||process.env.QUARRY_FLEET_CASE==='hud'){
 const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const p=world(APRON.e,APRON.n),a={x:p.x+200,z:p.z+200,heading:0},destination={...p},length=Math.hypot(200,200),route={points:[a,destination],cumulative:[0,length],length,start:a,near:a,destination,turns:[{at:200,side:'Right',name:'park access road'}],joins:[]};
 const machine=pose=>({...pose,heading:0,speed:0,restart(x,z,heading){Object.assign(this,{x,z,heading})}});let driven=machine(p);const map={route:[],setRoute(points){this.route=points;}};
 const j=new QuarryJourney(new URLSearchParams('trip=quarry-gate'),{},manifest.village,()=>driven,map,route);j.update(1.2,true);assert.equal(j.arrived,true);assert.match(j.hud.textContent,/Arrived/);
 const lookoff=world(LOOKOFFS[0].e,LOOKOFFS[0].n);driven=machine(lookoff);driven.speed=2;j.update(1.2,true);
 assert.equal(j.arrived,true,'arrival state survives a switch inside the park');assert.equal(j.remaining,0,'completed route has no remaining approach');assert.doesNotMatch(j.hud.textContent,/onto|left|unloading apron/,'park riding cannot send the selected machine back to the access road');assert.equal(map.route.length,0,'completed approach is hidden on the map');
 const saved=JSON.parse([...values.values()][0]);assert.equal(saved.x,driven.x);assert.equal(saved.z,driven.z);assert.equal(saved.arrived,true,'save keeps completed arrival for the selected machine');
 const reload=new QuarryJourney(new URLSearchParams('trip=quarry-gate'),{},manifest.village,()=>driven,map,route);reload.place();reload.update(1.2,true);assert.equal(reload.arrived,true,'reload inside park preserves completion');
 driven=machine(a);reload.update(1.2,true);assert.equal(reload.arrived,true,'completed arrival remains complete when a riding road passes outside the park');assert.equal(reload.remaining,0);reload.restart();reload.update(1.2,true);assert.equal(reload.arrived,false,'an explicit new approach resets completion');assert.ok(reload.remaining>0);assert.equal(map.route,route.points,'new approach restores its route');console.log('PASS arrival, switch, park riding, reload and explicit new approach');
}
if(!process.env.QUARRY_FLEET_CASE||process.env.QUARRY_FLEET_CASE==='deck'){
 const ctx=new Proxy({measureText:t=>({width:String(t).length*8}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)}),make=document.createElement;
 document.createElement=tag=>tag==='canvas'?{width:0,height:0,getContext:()=>ctx}:make();THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
 const trailer=createTrailer(true,false),bike=trailer.cargo.bike,wheels=[...new Set(Object.values(bike.wheels))];trailer.root.updateMatrixWorld(true);bike.bikeMesh.skeleton.update();const treads=wheels.map(w=>wheelVertices(THREE,bike,w)),deck=deckContact(THREE,FleetSurface,trailer),point=new THREE.Vector3(),centre=new THREE.Vector3(),inverse=new THREE.Matrix4();
 let frontHalf=0;for(const p of treads[0]){point.copy(p).applyMatrix4(wheels[0].matrixWorld);frontHalf=Math.max(frontHalf,Math.abs(point.x))}
 const frontZ=wheels[0].getWorldPosition(centre).z,chocks=[new THREE.Box3(),new THREE.Box3()];for(const mesh of trailer.root.children.filter(n=>n.isMesh)){const g=mesh.geometry,p=g.getAttribute('position'),count=g.index?.count??p.count;for(let i=0;i<count;i+=3){const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,g.index?.getX(i+j)??i+j));if(points.every(p=>Math.abs(p.x)<.2&&Math.abs(p.z-frontZ)<.4&&p.y>trailer.deckHeight-.02&&p.y<trailer.deckHeight+.3)&&points.every(p=>p.x*points[0].x>0))for(const p of points)chocks[points[0].x<0?0:1].expandByPoint(p);}}
 assert.ok(chocks.every(b=>!b.isEmpty()),'chock boxes are read from their actual triangles');const mesh=bike.bikeMesh,g=mesh.geometry,count=g.index?.count??g.attributes.position.count,triangle=new THREE.Triangle();let overlaps=0;for(let i=0;i<count;i+=3){for(const[p,j]of[[triangle.a,0],[triangle.b,1],[triangle.c,2]])mesh.getVertexPosition(g.index?.getX(i+j)??i+j,p).applyMatrix4(mesh.matrixWorld);if(chocks.some(box=>box.intersectsTriangle(triangle)))overlaps++;}assert.equal(overlaps,0,'the actual bike triangles do not intersect either exact chock box');
 const audit=()=>{trailer.root.updateMatrixWorld(true);bike.bikeMesh.skeleton.update();inverse.copy(trailer.root.matrixWorld).invert();deck.update(false);let penetration=0,half=0;for(let i=0;i<wheels.length;i++){wheels[i].getWorldPosition(centre);for(const tread of treads[i]){point.copy(tread).applyMatrix4(wheels[i].matrixWorld);if(i===0)half=Math.max(half,Math.abs(point.clone().applyMatrix4(inverse).x));if(point.y<=centre.y+.001)penetration=Math.max(penetration,deck.height(point.x,point.z,point.y)-point.y)}}assert.ok(Math.abs(half-frontHalf)<1e-7,'rigid rotation cannot change the chock separating gap');return penetration;};
 const flat=audit();trailer.root.rotation.set(.26,0,.15,'YXZ');const tilted=audit();console.log('RIGID_DECK',JSON.stringify({flat,tilted,overlaps,chocks:chocks.map(b=>({min:b.min.toArray(),max:b.max.toArray()}))}));assert.ok(flat<=.04&&tilted<=.04,'a non-intersecting strapped tyre stands on the deck, not an overhanging chock top');
 trailer.root.rotation.set(0,0,0);bike.root.position.y-=.06;const sunk=audit();assert.ok(sunk>.055);assert.throws(()=>assert.ok(sunk<=.04),'real sixty-millimetre deck penetration still fails');document.createElement=make;console.log('PASS rigid support classification and real deck-penetration negative');
}

if(!process.env.QUARRY_FLEET_CASE||process.env.QUARRY_FLEET_CASE==='grade-scan')await import('./quarry-grade-scan.mjs');
