// Node adapter for the production Terrain loader. Decode only the baked RGB/RGBA PNGs;
// Terrain.loadNow, heightAt, surfaceAt, road interpolation and Vehicle remain production code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Terrain } from '../web/src/terrain.ts';
import { Roads } from '../web/src/roads.ts';
import { Streams } from '../web/src/streams.ts';
const base = '../data/baked/terrain';
export const manifest = JSON.parse(readFileSync(`${base}/manifest.json`));
const defaultManifest = manifest;
export const bakedRoads = JSON.parse(readFileSync(`${base}/roads.json`));
function png(bytes) {
  const chunks=[]; let w,h,channels;
  for(let o=8;o<bytes.length;){const n=bytes.readUInt32BE(o),type=bytes.toString('ascii',o+4,o+8),p=bytes.subarray(o+8,o+8+n);o+=12+n;
    if(type==='IHDR'){w=p.readUInt32BE(0);h=p.readUInt32BE(4);assert.equal(p[8],8);channels=p[9]===2?3:p[9]===6?4:0;assert.ok(channels);assert.equal(p[12],0);}
    if(type==='IDAT')chunks.push(p);
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=w*channels,decoded=new Uint8Array(stride*h),pixels=new Uint8ClampedArray(w*h*4);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++)for(let x=0;x<stride;x++){
    const k=y*stride+x,a=x>=channels?decoded[k-channels]:0,b=y?decoded[k-stride]:0,c=y&&x>=channels?decoded[k-stride-channels]:0,f=raw[y*(stride+1)];
    assert.ok(f<=4);decoded[k]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][f])&255;
  }
  for(let i=0;i<w*h;i++){pixels[i*4]=decoded[i*channels];pixels[i*4+1]=decoded[i*channels+1];pixels[i*4+2]=decoded[i*channels+2];pixels[i*4+3]=channels===4?decoded[i*channels+3]:255;}
  return {pixels,width:w,height:h,close(){}};
}
export function makeGround(groundBase = base) {
  // No browser, renderer, file copies or invented height fields. Another area passes its own baked folder.
  const manifest = groundBase === base ? defaultManifest : JSON.parse(readFileSync(`${groundBase}/manifest.json`));
  const groundRoads = groundBase === base ? bakedRoads : JSON.parse(readFileSync(`${groundBase}/roads.json`));
  globalThis.fetch=async path=>new Response(readFileSync(path));
  globalThis.createImageBitmap=async blob=>png(Buffer.from(await blob.arrayBuffer()));
  globalThis.OffscreenCanvas=class {getContext(){let bmp;return {drawImage(b){bmp=b;},getImageData(){return {data:bmp.pixels};}};}};
  const old=THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
  const terrain=new Terrain(manifest,groundBase,{},Number(process.env.PHONE_EXAG??1.5),-.2);terrain.low=true;
  if(manifest.streams)terrain.streams=new Streams(JSON.parse(readFileSync(`${groundBase}/${manifest.streams.file}`)),manifest.village);
  THREE.TextureLoader.prototype.load=old;
  const find=terrain.find.bind(terrain);
  // Tile reads are async; preload the finest route corridor before driving.
  terrain.missing=0;
  const height=terrain.heightAt.bind(terrain),surface=terrain.surfaceAt.bind(terrain);
  terrain.heightAt=(x,z,referenceY)=>{if(!find(x,z))throw Error(`Missing sampled ground ${x},${z}`);return height(x,z,referenceY);};
  terrain.surfaceAt=(x,z,referenceY)=>{if(!find(x,z))throw Error(`Missing sampled surface ${x},${z}`);return surface(x,z,referenceY);};
  return {terrain,roads:new Roads(groundRoads,manifest.village,terrain)};
}
export async function preload(terrain, points, margin=120, maxLevel=8) {
  const keys=new Set(),manifest=terrain.manifest; // the terrain's own area (Mabou: the same object as the default)
  for(const [x,z]of points)for(let dz=-margin;dz<=margin;dz+=60)for(let dx=-margin;dx<=margin;dx+=60){
    for(let level=maxLevel;level>=0;level--){const size=manifest.size/2**level,i=Math.floor((x+dx+manifest.village[0]-manifest.origin[0])/size),j=Math.floor((z+dz-manifest.village[1]+manifest.origin[1])/size),name=`${i}_${j}`;
      if(manifest.levels[level]?.includes(name)){keys.add(`${level}/${name}`);break;}
    }
  }
  for(const key of keys){const [level,i,j]=key.split(/[\/_]/).map(Number);await terrain.loadNow(level,i,j);}
}
