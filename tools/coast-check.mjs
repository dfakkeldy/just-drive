import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {CoastSite,coastWeights,RECESSES} from '../web/src/coast-site.ts';
import {Coast} from '../web/src/coast.ts';
import {coastPixelScale,updateCoastView} from '../web/src/coast-view.ts';
import {Terrain} from '../web/src/terrain.ts';
const white=coastWeights(618840,5109300,2.66,1.315);assert.ok(white[0]>.7,'gypsum face');
assert.deepEqual(coastWeights(618862,5109300,18.55,.125),[0,0,0,0],'green bench');
assert.ok(coastWeights(618700,5109080,1.97,.124)[3]>.8,'dry beach');
assert.ok(coastWeights(618602,5110261,8.255,1.435)[1]>.8,'Finlay beds');
assert.ok(coastWeights(618914,5109400,24.48,.651)[2]>.3,'broken slopes');
assert.deepEqual(coastWeights(624000,5103000,20,1),[0,0,0,0],'away');
assert.deepEqual(coastWeights(618840,5109300,80,1),[0,0,0,0],'high inland land');
const s=new CoastSite([624271,5103301]);
const allowed=(e,n,h,slope)=>s.treeAllowed(e-624271,5103301-n,h,slope);
assert.equal(allowed(618810,5109300,-.4,0),false,'sea trees');
assert.equal(allowed(618966,5110457,-.15,.228),false,'low marsh return beyond the beach band');
assert.equal(allowed(618820,5109300,.6,.1),false,'high water trees');
assert.equal(allowed(618830,5109300,1.6,.1),false,'beach bushes');
assert.equal(allowed(618840,5109300,12,1.1),false,'cliff trees');
assert.equal(allowed(618862,5109300,18.55,.125),true,'bench trees');
assert.equal(allowed(624000,5103000,-1,2),true,'unrelated vegetation');
assert.ok(RECESSES.length>=4&&RECESSES.every(p=>p.width<5&&p.rise<2.5&&p.h>1&&p.h<32),'small restrained recesses');
let reads=0;
const anchor=new Float32Array(20);
const t={exag:1.5,seaLevel:-.2,tiles:new Map([['cliff',{mesh:{material:{uniforms:{coastRecessAnchor:{value:anchor}}}}}]]),drawnRevision:'one',meshHeightAt:(_x,_z,drawn)=>{reads++;assert.equal(drawn,true,'must sample drawn mesh');return 2},heightAt:()=>{throw Error('sampled raster instead of mesh')}};
t.coast=s;t.fitCoastRecesses=()=>Terrain.prototype.fitCoastRecesses.call(t);
const c=new Coast(s,t),cam=new THREE.Vector3(s.box[0]+200,50,(s.box[1]+s.box[3])/2);
c.update(cam);assert.equal(c.mesh.count,44,'few dozen blocks');assert.equal(c.group.children.length,1,'one draw');assert.equal(c.mesh.material.clipping,true,'mirror clip uniforms enabled');assert.ok(c.mesh.userData.shadowSet&&!c.mesh.castShadow&&c.mesh.receiveShadow,'no third shadow draw');assert.ok(c.mesh.frustumCulled&&c.mesh.boundingSphere?.radius>0,'offscreen batch culled with fresh bounds');assert.equal(c.mesh.geometry.index?.count??c.mesh.geometry.attributes.position.count,60,'20 triangles per block');
assert.ok(c.blocks.every(b=>Math.abs(b.y+b.burial-1.8)<1e-6),'embedded base');assert.ok(c.blocks.some(b=>b.burial>.1),'some half buried blocks');
assert.ok(RECESSES.every((_,i)=>Math.abs(anchor[i*4+2]-(-.2+2.2/1.5))<1e-6),'recess anchors fitted to drawn triangles');
const first=reads;c.update(cam);assert.equal(reads,first,'no repeated static mesh queries');
t.drawnRevision="two";c.update(new THREE.Vector3(0,0,0));assert.equal(c.group.visible,false,'distant culling');assert.equal(reads,first,'zero away queries');
c.enabled=false;c.update(cam);assert.equal(c.group.visible,false,'A/B switch');
console.log('PASS coast zones, bench/highland/away guards, sea/beach/cliff vegetation, shallow recesses, one instanced draw, drawn-mesh placement and local CPU gate');

// `use` marks a tile as used for the tile cache (terrain.ts); this stand-in has no cache, so it is a no-op.
// The drawn tile is found by its key, so the stand-in has a map grid with one level-8 tile at the origin.
const hide=new THREE.Vector4(1,0,0,0),fake={use(){},find:()=>null,drawnBoundsTile:Terrain.prototype.drawnBoundsTile,shownAt:Terrain.prototype.shownAt,triangleHeight:Terrain.prototype.triangleHeight,maxLevel:8,manifest:{village:[0,0],origin:[0,0],size:256*2**8},tiles:new Map([['8/0_0',{level:8,x0:0,z0:0,size:256,mesh:{visible:true,material:{uniforms:{hideQuad:{value:hide}}},geometry:{getAttribute:()=>({getY:()=>10})}}}]])};
assert.equal(Terrain.prototype.meshHeightAt.call(fake,32,32,true),null,'discarded parent quadrant is not drawn land');assert.equal(Terrain.prototype.meshHeightAt.call(fake,192,192,true),10,'retained parent quadrant is drawn land');

const perspective=new THREE.PerspectiveCamera(55,390/844,.3,10000),material={uniforms:{coastPixelScale:{value:0}}};
const expected=2*Math.tan(55*Math.PI/360)/844;assert.ok(Math.abs(coastPixelScale(perspective,844)-expected)<1e-12);
updateCoastView({getDrawingBufferSize:v=>v.set(390,844)},perspective,material);assert.equal(material.uniforms.coastPixelScale.value,coastPixelScale(perspective,844));
updateCoastView({getDrawingBufferSize:v=>v.set(780,1688)},perspective,material);assert.equal(material.uniforms.coastPixelScale.value,expected/2);
console.log('PASS coast pixel footprint follows the real camera projection and drawing buffer');
