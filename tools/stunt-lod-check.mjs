// Actual loaded terrain meshes at each LOD, compared with the unmodified current-main loader.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {makeGround} from './phone-ground.mjs';
import {YardSite} from '../web/src/yard-site.ts';
import {StuntPark,PlacedStunt} from '../web/src/stunt-kit.ts';
import {testParkLayout} from '../web/src/stunt-test-park.ts';
// PR #144: the mirror crown line is the one reviewed difference from main in these programs (tools/coast-programs.mjs).
import {reviewedMirrorCrown} from './mirror-crown.mjs';
// PR #27: ROAD_PAVEMENT (Mabou pavement flags) is new #ifdef text in TERRAIN_FRAG. Without that define, resolve only its
// own #ifdef/#else/#endif lines (keeping the #else side) and compare everything else as written.
export function withoutPavement(source){
  const out=[],stack=[];
  for(const line of source.split('\n')){
    const m=line.match(/^\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b\s*(\w*)/);
    if(m&&['ifdef','ifndef','if'].includes(m[1])){stack.push(m[1]==='ifdef'&&m[2]==='ROAD_PAVEMENT'?'pavement':'other');if(stack.at(-1)==='pavement')continue;}
    else if(m&&m[1]==='else'&&stack.at(-1)==='pavement'){stack[stack.length-1]='kept';continue;}
    else if(m&&m[1]==='elif')assert.ok(!['pavement','kept'].includes(stack.at(-1)),'ROAD_PAVEMENT never takes #elif');
    else if(m&&m[1]==='endif'){if(['pavement','kept'].includes(stack.pop()))continue;}
    if(!stack.includes('pavement'))out.push(line);
  }
  assert.equal(stack.length,0,'balanced #if blocks');
  return out.join('\n');
}
assert.equal(withoutPavement('a\n#ifdef ROAD_PAVEMENT\nb\n#ifdef X\nc\n#endif\n#else\nd\n#endif\n#ifdef ROAD_PAVEMENT\ne\n#endif\nf'),'a\nd\nf');
const compiled=material=>{const source=reviewedMirrorCrown(material.fragmentShader);return material.defines?.ROAD_PAVEMENT?source:withoutPavement(source);};
const main=await import(pathToFileURL(process.env.STUNT_LOD_MAIN));
const hill=Number(process.env.STUNT_LOD_HILL??2.5),low=process.env.STUNT_LOD_LOW==='1';
const identity=process.env.STUNT_LOD_MODE==='identity';
process.env.PHONE_EXAG=String(hill);
const results=[];
function exact(a,b,label){
  if(a==null||b==null){assert.equal(a,b,label);return;}
  assert.equal(Buffer.compare(Buffer.from(a.buffer,a.byteOffset,a.byteLength),Buffer.from(b.buffer,b.byteOffset,b.byteLength)),0,label);
}
function tileKey(t,x,z,level){const m=t.manifest,size=m.size/2**level;return[level,Math.floor((x+m.village[0]-m.origin[0])/size),Math.floor((z-m.village[1]+m.origin[1])/size)];}
async function load(t,points,level){const keys=new Map();for(const p of points){const k=tileKey(t,p.x,p.z,level);if(t.exists.has(`${k[0]}/${k[1]}_${k[2]}`))keys.set(k.join('/'),k);}for(const key of keys.values())await t.loadNow(...key);for(const tile of t.tiles.values())if(tile.mesh){tile.mesh.visible=true;tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);}t.group.updateMatrixWorld(true);return keys;}
function release(t){for(const tile of t.tiles.values())if(tile.mesh){tile.mesh.geometry.deleteAttribute('uv');tile.mesh.geometry.setIndex(null);tile.mesh.geometry.dispose();for(const u of Object.values(tile.mesh.material.uniforms))if(u.value?.isTexture)u.value.dispose();tile.mesh.material.dispose();}t.group.clear();t.tiles.clear();t.sites.length=0;globalThis.gc?.();}
for(let level=0;level<=8;level++){
  const original=main.makeGround().terrain,candidate=makeGround().terrain;original.low=candidate.low=low;
  const layout=testParkLayout(new YardSite(candidate.manifest.village,'invented'));
  const park=identity?{pieces:layout.map(p=>new PlacedStunt(p))}:new StuntPark(candidate,layout,low);
  if(!identity)await park.prepare();
  const perimeter=[];
  for(const p of park.pieces){const b=p.placement.piece.visualFootprint??p.placement.piece.footprint,run=p.placement.piece.runup??10;
    const x0=b[0]-run-18,x1=b[2]+18,z0=b[1]-18,z1=b[3]+18;
    // 3 m clears a fine drawn cell; the original coarse leak reached this band at LOD 6/7.
    for(const gap of [3,5,9])for(let f=0;f<=1;f+=.25)for(const [u,v] of [[x0-gap,z0+(z1-z0)*f],[x1+gap,z0+(z1-z0)*f],[x0+(x1-x0)*f,z0-gap],[x0+(x1-x0)*f,z1+gap]])perimeter.push(p.world(u,v));
  }
  const keys=await load(original,perimeter,level);await load(candidate,perimeter,level);
  let samples=0;
  if(identity)for(const key of keys.values()){
    const name=`${key[0]}/${key[1]}_${key[2]}`,a=original.tiles.get(name),b=candidate.tiles.get(name);
    for(const channel of ['ground','canopy','road'])exact(b[channel],a[channel],`MAIN_PATH_REGRESSION: no-park ${name} ${channel}`);
    for(const attribute of Object.keys(a.mesh.geometry.attributes))exact(b.mesh.geometry.attributes[attribute].array,a.mesh.geometry.attributes[attribute].array,`MAIN_PATH_REGRESSION: no-park ${name} ${attribute}`);
    assert.equal(compiled(b.mesh.material),compiled(a.mesh.material),'ordinary fragment unchanged');
    assert.deepEqual(b.mesh.material.defines,a.mesh.material.defines,'ordinary material flags unchanged');
    for(const uniform of ['tNormal','tRoad','tBrook'])exact(b.mesh.material.uniforms[uniform].value.image?.data,a.mesh.material.uniforms[uniform].value.image?.data,`MAIN_PATH_REGRESSION: ordinary ${uniform} bytes unchanged`);
    samples+=a.mesh.geometry.attributes.position.count;
  }
  else if(level<8){
    for(const key of keys.values()){
      const name=`${key[0]}/${key[1]}_${key[2]}`,a=original.tiles.get(name),b=candidate.tiles.get(name);
      exact(b.ground,a.ground,`LOD ${level}: ground samples exact`);
      exact(b.canopy,a.canopy,`LOD ${level}: canopy samples exact`);
      exact(b.mesh.geometry.attributes.position.array,a.mesh.geometry.attributes.position.array,`LOD ${level}: actual drawn triangles exact`);
      assert.equal(compiled(b.mesh.material),compiled(a.mesh.material),'coarse colour program unchanged');
      assert.deepEqual(b.mesh.material.defines,a.mesh.material.defines,'coarse material flags unchanged');
      if(a.road)exact(b.road,a.road,`LOD ${level}: driving metadata exact`);
      else assert.ok(!b.road||b.road.every(v=>v===0),'empty metadata stays empty');
      samples+=a.mesh.geometry.attributes.position.count;
    }
  }else{
    for(const point of perimeter){
      // A perimeter may lie inside another piece's pad. That point is owned by that other pad.
      const owned=park.pieces.some(p=>{const f=p.placement.piece.visualFootprint??p.placement.piece.footprint,u=p.u(point.x,point.z),v=p.v(point.x,point.z);return u>=f[0]-(p.placement.piece.runup??10)-21&&u<=f[2]+21&&v>=f[1]-21&&v<=f[3]+21;});
      if(owned)continue;
      const a=original.meshHeightAt(point.x,point.z,true),b=candidate.meshHeightAt(point.x,point.z,true);
      if(a===null){assert.equal(b,null);continue;}
      assert.equal(b,a,'fine outside-pad drawn ground exact');samples++;
    }
    assert.ok(samples>0,'fine boundary has independent samples');
  }
  results.push({level,tiles:keys.size,samples});console.log('PASS drawn LOD',results.at(-1));
  release(original);release(candidate);
}
writeFileSync(process.env.OUT+(identity?'/stunt-main-identity.json':'/stunt-lod.json'),JSON.stringify({hill,low,identity,results},null,2)+'\n');
