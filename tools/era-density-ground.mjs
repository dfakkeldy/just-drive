import {requireDensityResolution} from './era-density-resolution.mjs';
import {qHeight} from '../web/src/eras/history-precision.ts';
// Offline only. Bounded PNG cache over the finest available baked grid; no source data is copied.
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
export function decodeDensityPng(bytes){
 let width,height,channels;const chunks=[];
 for(let o=8;o<bytes.length;){const n=bytes.readUInt32BE(o),type=bytes.toString('ascii',o+4,o+8),p=bytes.subarray(o+8,o+8+n);o+=n+12;
  if(type==='IHDR'){width=p.readUInt32BE(0);height=p.readUInt32BE(4);if(p[8]!==8||![2,6].includes(p[9]))throw Error('Unsupported baked PNG');channels=p[9]===2?3:4;}if(type==='IDAT')chunks.push(p);
 }
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,data=new Uint8Array(stride*height);
 for(let y=0;y<height;y++)for(let x=0;x<stride;x++){
  const k=y*stride+x,a=x>=channels?data[k-channels]:0,b=y?data[k-stride]:0,c=y&&x>=channels?data[k-stride-channels]:0,f=raw[y*(stride+1)],p=a+b-c;
  const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c),predict=[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][f];
  if(predict===undefined)throw Error('Invalid PNG filter');data[k]=(raw[y*(stride+1)+1+x]+predict)&255;
 }
 return {width,height,channels,data};
}
export function densityGround(base,inputs={read:file=>readFileSync(base+'/'+file)}){
 const manifest=JSON.parse(inputs.read('manifest.json')),sets=new Map(Object.entries(manifest.levels).map(([k,v])=>[+k,new Set(v)])),cache=new Map(),levels={};
 const cover=decodeDensityPng(inputs.read(manifest.cover.file)),origin=manifest.village;
 const tile=(x,z,siteId)=>{
  requireDensityResolution(manifest,x,z,siteId);
  const east=x+origin[0]-manifest.origin[0],south=z+manifest.origin[1]-origin[1];
  for(let level=8;level>=6;level--){const size=manifest.size/2**level,i=Math.floor(east/size),j=Math.floor(south/size),key=`${i}_${j}`;
   if(!sets.get(level)?.has(key))continue;const name=`${level}/${key}`;let grid=cache.get(name);
   if(!grid){if(manifest.roads?.levels?.[level]?.includes(key))inputs.read(name+'.r.png');const p=decodeDensityPng(inputs.read(name+'.png'));grid=new Uint16Array(257*257);for(let k=0;k<grid.length;k++)grid[k]=p.data[k*p.channels]*256+p.data[k*p.channels+1];cache.set(name,grid);if(cache.size>48)cache.delete(cache.keys().next().value);}
   levels[level]=(levels[level]??0)+1;return {grid,level,size,u:(east/size-i)*256,v:(south/size-j)*256};
  }return null;
 };
 const height=(x,z,drawn=false,siteId)=>{
  const t=tile(x,z,siteId);if(!t)return null;const step=drawn?(t.level>=7?2:4):1;
  const a=Math.min(256-step,Math.floor(t.u/step)*step),b=Math.min(256-step,Math.floor(t.v/step)*step),u=(t.u-a)/step,v=(t.v-b)/step;
  const h=(i,j)=>t.grid[j*257+i]*manifest.height.scale+manifest.height.offset,h00=h(a,b),h10=h(a+step,b),h01=h(a,b+step),h11=h(a+step,b+step);
  if(!drawn)return qHeight((h00*(1-u)+h10*u)*(1-v)+(h01*(1-u)+h11*u)*v);
  return qHeight(u+v<=1?h00+(h10-h00)*u+(h01-h00)*v:h11+(h01-h11)*(1-u)+(h10-h11)*(1-v));
 };
 const coverAt=(x,z)=>{const c=manifest.cover,u=(x+origin[0]-c.xmin)/(c.xmax-c.xmin),v=(c.ymax-origin[1]+z)/(c.ymax-c.ymin);return u<0||v<0||u>=1||v>=1?0:cover.data[(Math.floor(v*cover.height)*cover.width+Math.floor(u*cover.width))*cover.channels+2];};
 // Bridge approaches may walk past the play square's edge. There, and only there, a missing fine tile means "no ground" (the
 // approach is counted missing), never a coarse guess. Inside the square the strict rule still throws.
 const [e0,n0,e1,n1]=manifest.mid,outside=(x,z)=>{const e=x+origin[0],n=origin[1]-z;return e<e0||e>=e1||n<n0||n>=n1;};
 const approachHeight=(x,z)=>{if(outside(x,z)){try{requireDensityResolution(manifest,x,z);}catch{return null;}}return height(x,z,false);};
 return {manifest,cover:coverAt,height:(x,z,id)=>height(x,z,false,id),drawn:(x,z,id)=>height(x,z,true,id),approachHeight,levelAt:(x,z)=>tile(x,z)?.level??null,levels};
}
