// Round-three regressions, executed unchanged against QUARRY_REVIEW_REF.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {QuarryWater,quarryLakeMask} from '../web/src/quarry-water';
import {Quarry} from '../web/src/quarry';
import {areaScreen} from '../web/src/area-screen';
import {bootTripParams} from '../web/src/quarry-trip';
export function pass4Tests(test,read){
 test('P4-C every accepted coverage cell is fully inside the actual sheet',()=>{
  const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,12,0,0,0,0,12],3));
  const mesh=new THREE.Mesh(geo);mesh.userData.quarryBoundary=[[0,0,12,0],[12,0,0,12],[0,12,0,0]];
  const m=quarryLakeMask([mesh],[0,0]);let accepted=0;
  for(let j=0;j<m.height;j++)for(let k=0;k<m.width;k++)if([1,2].includes(m.data[j*m.width+k]%4)){accepted++;for(const [dx,dz]of [[0,0],[1,0],[0,1],[1,1],[.5,.5]]){const x=m.x+(k+dx)*m.step,z=m.z+(j+dz)*m.step;assert.ok(x>=0&&z>=0&&x+z<=12,'accepted cell overclaims a triangle at '+x+','+z);}}
  assert.ok(accepted>0,'conservative mask keeps the fully covered cell');
  // Decode the actual packed row, as the shader does; both probes share a partial cell.
  const word=(at,count)=>{let value=0;for(let j=0;j<count;j++)value|=m.boundary[at-m.data.length+j]<<(j*4);return value>>>0;},f32=at=>{const b=new DataView(new ArrayBuffer(4));b.setUint32(0,word(at,8),true);return b.getFloat32(0,true);};
  const inside=(x,z)=>{const head=m.data.length+Math.floor((z-m.z)/m.step)*16,at=word(head,6),count=word(head+6,2);let yes=false;for(let j=0;j<count;j++){const b=at+j*32,az=f32(b+8),bz=f32(b+24);if((az>z)===(bz>z))continue;const ax=f32(b),bx=f32(b+16);if(x<(bx-ax)*(z-az)/(bz-az)+ax)yes=!yes;}return yes;};
  assert.equal(inside(11,.5),true,'partial cell keeps a sheet-backed interior return removable');assert.equal(inside(11,1.5),false,'same cell never covers an exterior ray');
  assert.match(read('web/src/shaders.ts'),/back>2\.5&&quarryLakeBoundaryHit\(hit,i\)/,'partial cells require the actual boundary, never a whole-cell guess');
 });
 test('P4-C a narrow notch between all five probes still requires exact boundary backing',()=>{
  const points=[[0,0],[6,0],[6,6],[0,6],[0,2.6],[3.2,2.5],[0,2.4]],faces=THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(...p)),[]),pos=[];
  for(const face of faces)for(const i of face)pos.push(points[i][0],0,points[i][1]);const mesh=new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pos,3)));
  mesh.userData.quarryBoundary=points.map((p,i)=>[...p,...points[(i+1)%points.length]]);const m=quarryLakeMask([mesh],[0,0]),x=Math.floor((2-m.x)/m.step),z=Math.floor((2-m.z)/m.step);assert.equal(m.data[z*m.width+x]%4,3,'the actual slit crosses this cell even though its four corners and centre are covered');
 });
 test('P4-C overlapping drawn water triangles use their union, not even/odd fill',()=>{
  const triangles=[[0,0,6,0,0,6],[1,1,7,1,1,7]],pos=triangles.flatMap(t=>[t[0],0,t[1],t[2],0,t[3],t[4],0,t[5]]),mesh=new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pos,3)),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.userData.quarryBoundary=triangles.flatMap(t=>[[t[0],t[1],t[2],t[3]],[t[2],t[3],t[4],t[5]],[t[4],t[5],t[0],t[1]]]);mesh.updateMatrixWorld();const ray=new THREE.Raycaster(new THREE.Vector3(2,1,2),new THREE.Vector3(0,-1,0));assert.equal(ray.intersectObject(mesh).length,2,'both drawn triangles cover this overlap');
  const m=quarryLakeMask([mesh],[0,0]),word=(at,n)=>{let v=0;for(let j=0;j<n;j++)v|=m.boundary[at-m.data.length+j]<<(j*4);return v>>>0;},f32=at=>{const b=new DataView(new ArrayBuffer(4));b.setUint32(0,word(at,8),true);return b.getFloat32(0,true);};
  const head=m.data.length+Math.floor((2-m.z)/m.step)*16,at=word(head,6),count=word(head+6,2);let winding=0;for(let j=0;j<count;j++){const p=at+j*32,ax=f32(p),az=f32(p+8),bx=f32(p+16),bz=f32(p+24);if((az>2)!==(bz>2)&&2-ax<(bx-ax)*(2-az)/(bz-az))winding+=bz>az?1:-1;}
  assert.equal(Math.abs(winding),2);assert.match(read('web/src/shaders.ts'),/return winding!=0;/,'the actual shader accepts the union; parity would punch a hole');
 });
 test('P4 exact sheet boundary stays closed across skipped collinear contour points',()=>{
  const canvas={width:2048,height:1024,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(2048*1024*4)}),putImageData(){}})},atlas=new THREE.CanvasTexture(canvas),terrain={manifest:{village:[642342,5063327]},seaLevel:-.2,exag:2.5,low:false,uniforms:{}};
  const water=new QuarryWater(terrain,atlas);for(const mesh of water.meshes){const counts=new Map(),edges=mesh.userData.quarryBoundary;assert.ok(edges?.length>0);for(const e of edges)for(const key of [e.slice(0,2).join(','),e.slice(2).join(',')])counts.set(key,(counts.get(key)??0)+1);assert.ok([...counts.values()].every(n=>n%2===0),'the actual subdivided sheet boundary has no loose endpoint');}
 });
 test('P4 water view lowers only mapped returns; raw heights and every dry vertex stay unchanged',()=>{
  for(const hill of [1,1.5,2,2.5]){
   const sea=-.2,level=h=>sea+(h-sea)*hill,planes=[{position:{y:level(27)+.18}},{position:{y:level(15.4)+.18}}],water={viewed:new WeakSet(),viewport:new THREE.Vector4(),meshes:planes};
   const raw=[level(27.4),level(27.4),level(80),level(27.2),level(15.8),level(26)],positions=raw.flatMap((y,i)=>[i,i===3?y-6:y,0]),g=new THREE.Float32BufferAttribute(raw,1),p=new THREE.Float32BufferAttribute(positions,3),coast=new THREE.Float32BufferAttribute([0,1,.27,0, 0,0,.27,0, 0,0,.27,0, 0,1,.27,0, 0,1,.154,0, 0,1,.27,0],4),geo=new THREE.BufferGeometry().setAttribute('position',p).setAttribute('ground',g).setAttribute('coast',coast),mesh=new THREE.Mesh(geo,new THREE.ShaderMaterial({defines:{QUARRY:1},uniforms:{quarryViewport:{value:new THREE.Vector4()}}})),beforePos=[...p.array],beforeGround=[...g.array];
   QuarryWater.prototype.prepareLand.call(water,mesh);assert.deepEqual([...g.array],beforeGround,'raw ground attributes are preserved');const drop=geo.attributes.quarryWaterDrop;
   for(let i=0;i<p.count;i++){if(coast.getY(i)!==1){assert.equal(p.getY(i),beforePos[i*3+1]);assert.equal(drop.getX(i),0,'dry bank is not lowered');}else{assert.ok(p.getY(i)<=beforePos[i*3+1]);assert.ok(Math.abs(p.getY(i)+drop.getX(i)-beforePos[i*3+1])<.00002,'raw rendered water height can be recovered exactly');}}
   assert.ok(p.getY(0)<g.getX(0));assert.ok(p.getY(4)<g.getX(4));assert.ok(Math.abs(p.getY(3)-(g.getX(3)-drop.getX(3)-6))<.00002,'hanging skirt depth is preserved');assert.equal(p.getY(5),beforePos[16],'already submerged ground is never raised');const once=[...p.array];QuarryWater.prototype.prepareLand.call(water,mesh);assert.deepEqual([...p.array],once,'mesh setup is idempotent');
  }
 });
 test('P4 pixel ray uses the actual draw viewport, including cloned probe materials',()=>{
  const water={viewed:new WeakSet(),viewport:new THREE.Vector4()},uniforms={quarryViewport:{value:new THREE.Vector4(0,0,1392,866)}},material=new THREE.ShaderMaterial({defines:{QUARRY:1},uniforms}),mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);let prior=0;mesh.onBeforeRender=()=>prior++;
  QuarryWater.prototype.prepareLand.call(water,mesh);const callback=mesh.onBeforeRender;QuarryWater.prototype.prepareLand.call(water,mesh);assert.equal(mesh.onBeforeRender,callback,'one callback per streamed mesh');
  const cloneMaterial=material.clone(),clone=new THREE.Mesh(mesh.geometry,cloneMaterial);clone.onBeforeRender=mesh.onBeforeRender;clone.onBeforeRender({getCurrentViewport:v=>v.set(0,0,240,149)},null,null,null,cloneMaterial,null);assert.equal(prior,1);assert.deepEqual(cloneMaterial.uniforms.quarryViewport.value.toArray(),[0,0,240,149]);assert.deepEqual(material.uniforms.quarryViewport.value.toArray(),[0,0,1392,866],'probe does not alter the live viewport');
 });
 test('P4 fleet adapter reads live solids/spec and binding is idempotent',()=>{
  let received=null;const site={guarded:new WeakSet(),revision:1,allowPlacement(pose,spec){received=spec;return this.solids.length===0;},resolveSolids(body){body.x=this.solids.length;},solids:[]};
  const v={spec:{halfWidth:1},placementGuard:()=>true};Quarry.prototype.bindVehicle.call(site,v);const guard=v.placementGuard;Quarry.prototype.bindVehicle.call(site,v);assert.equal(v.placementGuard,guard);
  const provider=Quarry.prototype.contactProvider.call(site),body={x:0,z:0,heading:0,spec:{halfWidth:2}};assert.equal(provider.allows(body),true);assert.equal(received,body.spec);site.solids.push({});site.revision=2;assert.equal(provider.revision(),2);assert.equal(provider.allows(body),false);assert.equal(v.placementGuard(body),false);provider.resolve(body);assert.equal(body.x,1);
 });
 const saved=()=>Object.fromEntries(['location','history','document','sessionStorage'].map(k=>[k,globalThis[k]]));
 const environment=()=>{const values=new Map(),nodes=[];globalThis.location={hostname:'localhost',pathname:'/',search:'?trip=quarry&area=westbay',hash:'',reload(){}};globalThis.history={state:null,replaceState(_s,_t,a){location.search=new URL(a,'http://localhost').search;}};globalThis.document={createElement(tag){const n={tag,style:{},append(...v){nodes.push(...v);}};return n;},body:{replaceChildren(){}},title:''};globalThis.sessionStorage={getItem:k=>values.get(k),removeItem:k=>values.delete(k)};return{values,nodes};};
 test('P4-D failed trip removes only its active saved pose before clearing its address',()=>{const old=saved();try{const {values}=environment();values.set('mmm.trip.quarry','saved mid-route');values.set('mmm.trip.quarry-gate','other trip');void areaScreen('failed',true);assert.equal(values.has('mmm.trip.quarry'),false);assert.equal(values.get('mmm.trip.quarry-gate'),'other trip');assert.equal(new URLSearchParams(location.search).has('trip'),false);location.search='?trip=quarry&area=westbay';sessionStorage.removeItem=()=>{throw Error('private window');};void areaScreen('failed',true);assert.equal(new URLSearchParams(location.search).has('trip'),false,'storage failure still ends the trip');}finally{Object.assign(globalThis,old);}});
 test('P4-E expanded root link preserves the starting trip; only explicit changed area paths cancel',()=>{const old=saved();try{for(const [path,expected,trip]of [['/','/westbay',true],['/westbay/','/westbay',true],['/WESTBAY','/westbay',true],['/judique','/judique',false]]){environment();location.pathname=path;location.search='?site=just&trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1';history.replaceState=(_s,_t,a)=>{const u=new URL(a,'http://localhost');location.pathname=u.pathname;location.search=u.search;};const q=bootTripParams();assert.equal(q.has('trip'),trip,path);assert.equal(location.pathname,expected,path);}}finally{Object.assign(globalThis,old);}});
 test('P4-F area error screen uses inherited readable 44 px touch targets and scrolls',()=>{const old=saved();try{const {nodes}=environment();void areaScreen('failed',true);const button=nodes.find(n=>n.tag==='button');assert.match(button.style.cssText??'',/font:inherit/);for(const n of nodes.filter(n=>n.tag==='button'||n.tag==='a'))assert.match(n.style.cssText??'',/min-height:44px/);}finally{Object.assign(globalThis,old);}});
}
