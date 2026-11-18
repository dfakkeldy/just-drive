// Real baked heights, production Terrain.build, no renderer and no source copies.
import assert from 'node:assert/strict';
import {makeGround,manifest} from './phone-ground.mjs';
import {GroundCover} from '../web/src/ground-cover.ts';
function mask(){const b=new ArrayBuffer(24),d=new DataView(b);d.setUint32(0,0x31304347,true);d.setUint32(4,2,true);d.setUint32(8,1,true);d.setUint32(12,1,true);d.setUint32(16,0,true);d.setUint16(20,1,true);d.setUint8(22,6);return new GroundCover(b,2,1);}
const key=manifest.levels['6'].includes('32_30')?'32_30':manifest.levels['6'][10], [i,j]=key.split('_').map(Number),id='6/'+key;
const baseline=makeGround().terrain;await baseline.loadNow(6,i,j);const before=baseline.tiles.get(id);
assert(before.canopy.some(v=>v>2),'real fixture must contain measured crowns');
const terrain=makeGround().terrain;
// The mask's boundary cuts through the averaging window of the last cleared mesh vertex.
const size=1024,x0=manifest.origin[0]+i*size-manifest.village[0],z0=manifest.village[1]-(manifest.origin[1]-j*size);
terrain.uniforms.coverRect.value.set(x0,z0,1/(size-16),1/size);terrain.groundCover=mask();
await terrain.loadNow(6,i,j);const after=terrain.tiles.get(id);
let cleared=0,kept=0;
for(let r=0;r<257;r++)for(let c=0;c<257;c++){
 const idx=r*257+c,cls=terrain.groundClassAt(x0+c*4,z0+r*4);
 if(cls===6){assert.equal(after.canopy[idx],0,'cleared canopy node');cleared++;}
 else{assert.equal(after.canopy[idx],before.canopy[idx],'unconfirmed canopy unchanged');if(before.canopy[idx]>2)kept++;}
}
assert(cleared>0&&kept>0,'mixed real-tree control');
const pos=after.mesh.geometry.getAttribute('position'),ground=after.mesh.geometry.getAttribute('ground');
let checked=0,control=0;
for(let k=0;k<pos.count;k++){
 const row=Math.floor(k/67),col=k%67;if(row===0||col===0||row===66||col===66)continue;
 if(terrain.groundClassAt(pos.getX(k),pos.getZ(k))===6){assert(Math.abs(pos.getY(k)-ground.getX(k))<.0002,'averaged canopy regrew over a cleared vertex');checked++;}
 else if(pos.getY(k)>ground.getX(k)+1)control++;
}
assert(checked>0&&control>0,'cleared hull and unchanged wooded hull both checked');
console.log('PASS production Terrain.build:',cleared,'cleared nodes;',kept,'unchanged wooded nodes;',checked,'cleared hull vertices;',control,'wooded hull control vertices');
