// Full one-metre site scan, including corridor shoulders and a collar outside the actual site box.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {QuarrySite} from '../web/src/quarry-site.ts';
import {png} from './quarry-height-read.mjs';
const base=process.cwd()+'/data/baked/areas/westbay',manifest=JSON.parse(readFileSync(base+'/manifest.json')),site=new QuarrySite(manifest.village),cache=new Map(),size=manifest.size/256;
const raw=(e,n)=>{const i=Math.floor((e-manifest.origin[0])/size),j=Math.floor((manifest.origin[1]-n)/size),id=i+'_'+j;let tile=cache.get(id);if(!tile){assert.ok(manifest.levels['8'].includes(id),'fine survey tile exists '+id);const image=png(readFileSync(base+'/8/'+id+'.png')),ground=new Float32Array(image.width*image.height);for(let k=0;k<ground.length;k++)ground[k]=(image.pixels[k*4]*256+image.pixels[k*4+1])*manifest.height.scale+manifest.height.offset;tile={width:image.width,ground};cache.set(id,tile);}const x=Math.round((e-manifest.origin[0]-i*size)*(tile.width-1)/size),z=Math.round((manifest.origin[1]-n-j*size)*(tile.width-1)/size);return tile.ground[z*tile.width+x];};
const [ve,vn]=manifest.village,[x0,z0,x1,z1]=site.box,e0=Math.floor(x0+ve)-4,e1=Math.ceil(x1+ve)+4,n0=Math.floor(vn-z1)-4,n1=Math.ceil(vn-z0)+4;
const result={spacing:1,bounds:{e0,e1,n0,n1},samples:0,changed:0,outsideSamples:0,outsideChanged:0,fill:{value:0},cut:{value:0}};
for(let e=e0;e<=e1;e++)for(let n=n0;n<=n1;n++){const x=e-ve,z=vn-n,h=raw(e,n),next=site.height(x,z,h),delta=next-h;result.samples++;if(!site.contains(x,z)){result.outsideSamples++;if(Math.abs(delta)>1e-8)result.outsideChanged++;}if(Math.abs(delta)>1e-8)result.changed++;if(delta>result.fill.value)result.fill={value:delta,e,n,h,next};if(delta<result.cut.value)result.cut={value:delta,e,n,h,next};}
assert.ok(result.outsideSamples>0);assert.equal(result.outsideChanged,0,'no grading may escape the actual site box');
assert.ok(result.fill.value<=4,'whole-corridor fill stays below the stated 4 m bound');assert.ok(-result.cut.value<=3,'whole-corridor cut stays below the stated 3 m bound');
assert.ok(Math.abs(result.fill.value-3.735892848968099)<1e-6,'full scan retains the measured fill maximum');assert.deepEqual([result.fill.e,result.fill.n],[632072,5061778]);
assert.ok(Math.abs(result.cut.value+2.6064183659596267)<1e-6,'full scan retains the measured cut maximum');assert.deepEqual([result.cut.e,result.cut.n],[632253,5061806]);
if(process.env.QUARRY_GRADE_RECEIPT)writeFileSync(process.env.QUARRY_GRADE_RECEIPT,JSON.stringify(result,null,2)+'\n');
console.log('PASS full site/corridor/shoulder scan',JSON.stringify(result));
