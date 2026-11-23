// Read-only real-road/real-rendered-face audit. No renderer, bake or physics changes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture,dispose,root} from './bridges-fixture.mjs';
const cases=JSON.parse(readFileSync(root+'tools/fixtures/bridge-underpasses.json')),file='web/src/shaders.ts';
const threshold=Math.tan(35*Math.PI/180),mix=(a,b,t)=>a+(b-a)*t;
function face(t,x,z){
 const p=t.mesh.geometry.getAttribute('position'),n=Math.round(Math.sqrt(p.count)),seg=n-3,fx=(x-t.x0)*seg/t.size,fz=(z-t.z0)*seg/t.size,a=Math.max(0,Math.min(seg-1,Math.floor(fx))),b=Math.max(0,Math.min(seg-1,Math.floor(fz))),i=(b+1)*n+a+1,tri=fx-a+fz-b<=1?[i,i+1,i+n]:[i+1,i+n,i+n+1],u=tri[0],v=tri[1],w=tri[2],dx=p.getX(v)-p.getX(u),dz=p.getZ(v)-p.getZ(u),ex=p.getX(w)-p.getX(u),ez=p.getZ(w)-p.getZ(u),dy=p.getY(v)-p.getY(u),ey=p.getY(w)-p.getY(u),det=dx*ez-dz*ex;
 return {grade:Math.hypot((dy*ez-ey*dz)/det,(dx*ey-ex*dy)/det),tri};
}
function paint(im,a,b,zero,mpp){
 const offsets=[0,4,257*4,258*4].map(d=>(b*257+a)*4+d),q=offsets.map(k=>[im[k],im[k+1],im[k+2]]),sd=q.map(v=>v[2]>0?(v[0]-zero)*.1:13);
 const same=q[0][2]>0&&q.every(v=>v[2]===q[0][2]&&v[1]===q[0][1])&&Math.max(Math.abs(sd[0]-sd[1]),Math.abs(sd[0]-sd[2]),Math.abs(sd[3]-sd[1]),Math.abs(sd[3]-sd[2]))<1.6*mpp+.2;
 const blended=v=>mix(mix(v[0],v[1],.2),mix(v[2],v[3],.2),.2),distance=same?Math.abs(blended(sd)):blended(sd.map(Math.abs)),kind=q[0][2]&15,halfWidth=q[0][1]*.05,shoulder=kind<=2?1.9:1.1;
 return {kind,distance,halfWidth,bytes:q[0],onRoad:kind>0&&distance<Math.min(11.5,halfWidth),painted:kind>0&&distance<Math.min(11.5,halfWidth+shoulder)};
}
async function verify(index,mutant=false){
 const c=cases[index],replacements={};if(mutant){const source=readFileSync(root+file,'utf8'),from='return grade <= 0.70020754;';assert.equal(source.split(from).length,2);replacements[file]=source.replace(from,'return true;');}
 const f=await fixture(c.area,1.5,replacements),M=f.roads.modern,span=M.spans.find(r=>r.road.id===c.span);assert.ok(span);await f.load([[c.x,c.z],...span.pts]);f.roads.update(new THREE.Vector3(c.x,30,c.z));
 try{
  const source=f.TERRAIN_FRAG,expression=source.match(/bool roadPaintOnGrade\(float grade\) \{ return ([^;]+); \}/)?.[1];assert.ok(expression,'production road-paint predicate');
  assert.match(source,/cross\(dFdx\(vWorld\), dFdy\(vWorld\)\)/,'uses rendered face derivatives');assert.ok(source.indexOf('vec3 roadFace')<source.indexOf('if ((quarter'),'derivatives before discard');
  assert.match(source,/albedo = mix\(albedo, surface, onRoad \* roadPaint\);/);assert.match(source,/shoulder \* 0.85 \* step\(rkind, 11.5\) \* roadPaint/);assert.match(source,/shoulder\*\.9 \* roadPaint/);assert.doesNotMatch(source,/onRoad \*= roadPaint|shoulder \*= roadPaint/,'colour guard leaves occupancy and water logic unchanged');
  const allowed=Function('grade','return '+expression);if(!mutant){assert.equal(allowed(Math.tan(34.9*Math.PI/180)),true);assert.equal(allowed(Math.tan(35.1*Math.PI/180)),false);}
  let before=0,after=0,insideBefore=0,flatRoad=0,flatShoulder=0,scanned=0;const examples=[],texels=[];
  for(const t of f.terrain.tiles.values())if(t.ready&&t.road&&t.mesh&&t.x0<c.x+40&&t.x0+t.size>c.x-40&&t.z0<c.z+40&&t.z0+t.size>c.z-40){
   const im=t.mesh.material.uniforms.tRoad.value.image.data,mpp=t.size/256;
   for(let b=0;b<256;b++)for(let a=0;a<256;a++){
    const x=t.x0+(a+.2)*mpp,z=t.z0+(b+.2)*mpp;if(Math.abs(x-c.x)>35||Math.abs(z-c.z)>35||f.terrain.find(x,z)!==t)continue;
    const near=f.roads.nearest(x,z,50,r=>r.id===c.road);if(!near)continue;scanned++;const field=paint(im,a,b,f.terrain.zero,mpp);if(!field.painted)continue;
    const actual=face(t,x,z),isFlat=actual.grade<=threshold,visible=allowed(actual.grade);
    if(isFlat){assert.equal(visible,true,'flat road and normal shoulder keep their paint');if(field.onRoad)flatRoad++;else flatShoulder++;continue;}
    if(near.dist<=near.road.halfWidth){insideBefore++;continue;}
    before++;if(visible)after++;
    const row={tile:`${t.level}/${t.i}_${t.j}`,texel:[a,b],world:[x,z],epsg2961:[x+f.manifest.village[0],f.manifest.village[1]-z],degrees:Math.atan(actual.grade)*180/Math.PI,lowerDistance:near.dist,lowerHalfWidth:near.road.halfWidth,...field,upperFootprint:M.isSpan(x,z,field.kind),d3Masks:M.maskPaint(x,z,field.kind),triangle:actual.tri};texels.push(row);
   }
  }
  texels.sort((a,b)=>a.lowerDistance-b.lowerDistance);examples.push(...texels.slice(0,8));assert.ok(before>0,'real steep-bank paint reproduction');assert.ok(flatRoad>100&&flatShoulder>0,'real normal road/shoulder controls');assert.equal(after,0,'painted steep texels outside mapped road width');
  const row={area:c.area,name:c.name,road:c.road,span:c.span,scanned,before,after,insideSteepBefore:insideBefore,flatRoad,flatShoulder,examples};
  console.log('PASS bank-paint '+JSON.stringify(row));if(process.env.BANK_EVIDENCE){mkdirSync(process.env.BANK_EVIDENCE,{recursive:true});writeFileSync(`${process.env.BANK_EVIDENCE}/case-${index}.json`,JSON.stringify({...row,texels},null,2)+'\n');}return row;
 }finally{dispose(f);}
}
if(process.env.BANK_CASE!==undefined){try{await verify(Number(process.env.BANK_CASE),process.env.BANK_MUTANT==='1');}catch(e){console.error(e.name+': '+e.message);process.exitCode=1;}}
else{
 const rows=[];for(let i=0;i<cases.length;i++){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,BANK_CASE:String(i)},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});assert.equal(child.status,0,cases[i].name+': '+child.stderr);process.stdout.write(child.stdout);rows.push(JSON.parse(child.stdout.split('\n').find(l=>l.startsWith('PASS bank-paint ')).slice(16)));}
 if(process.argv.includes('--mutations')){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,BANK_CASE:'0',BANK_MUTANT:'1',BANK_EVIDENCE:''},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});assert.equal(child.status,1,child.error+' '+child.stderr);assert.match(child.stderr,/painted steep texels outside mapped road width/);console.log('KILLED steep-bank paint gate removed');}
 if(process.env.OUT)writeFileSync(process.env.OUT+'/bank-paint-summary.json',JSON.stringify(rows,null,2)+'\n');
}
