import { readBaseline } from './baseline-source.mjs';
// Execute the original PR 70 siting and level-6 bilinear reader from their frozen Git revision.
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export const PR70_REF='883363c';
export async function pr70Sites(base){
 const root=process.env.MMM_ROOT??process.cwd(),temp=mkdtempSync(join(tmpdir(),'mmm-pr70-sites-'));
 try{
  const file=join(temp,'pr70.mjs');
  await build({stdin:{contents:`
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {HistorySiting} from './web/src/eras/history-sites.ts';import {historyGround} from './web/src/eras/history-ground.ts';
import {eraRoadHalf} from './web/src/era.ts';import {decodeDensityPng} from './tools/era-density-ground.mjs';
const base=process.argv[2],reads={};
const read=f=>{const b=readFileSync(base+'/'+f);reads[f]={sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length};return b;};
const m=JSON.parse(read('manifest.json')),o=m.village,cover=decodeDensityPng(read(m.cover.file));
const dry=(x,z)=>{const c=m.cover,u=(x+o[0]-c.xmin)/(c.xmax-c.xmin),v=(c.ymax-o[1]+z)/(c.ymax-c.ymin);if(u<0||v<0||u>=1||v>=1)return false;const cls=cover.data[(Math.floor(v*cover.height)*cover.width+Math.floor(u*cover.width))*cover.channels+2];return cls!==0&&cls!==4;};
const raw=JSON.parse(read('roads.json')),roads=raw.roads.filter(r=>r.kind!==5).map(r=>({...r,halfWidth:eraRoadHalf(r.kind,r.halfWidth),pts:r.pts.map(p=>[p[0]-o[0],o[1]-p[1]])}));
globalThis.fetch=async p=>new Response(read(String(p).slice(base.length+1)));
globalThis.createImageBitmap=async blob=>{const p=decodeDensityPng(Buffer.from(await blob.arrayBuffer())),pixels=new Uint8ClampedArray(p.width*p.height*4);for(let i=0;i<p.width*p.height;i++){pixels[i*4]=p.data[i*p.channels];pixels[i*4+1]=p.data[i*p.channels+1];pixels[i*4+2]=p.data[i*p.channels+2];pixels[i*4+3]=255;}return{pixels,width:p.width,height:p.height,close(){}};};
globalThis.OffscreenCanvas=class{getContext(){let bitmap;return{drawImage(b){bitmap=b;},getImageData(){return{data:bitmap.pixels};}};}};
const ground=await historyGround(m,base,raw.roads.filter(r=>r.bridge&&r.kind!==5).flatMap(r=>r.pts));
const sites=new HistorySiting(roads,JSON.parse(read('streams.json')),o,dry,ground).trades(o);
process.stdout.write(JSON.stringify({sites,reads}));`,resolveDir:root,sourcefile:'pr70-siting-entry.mjs',loader:'js'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'silent',plugins:[{name:'pr70-original-rule',setup(b){b.onLoad({filter:/web\/src\/eras\/history-(sites|ground)\.ts$/},a=>{const path=a.path.slice(root.length+1);return{contents:readBaseline('era-siting',path),loader:'ts',resolveDir:a.path.slice(0,a.path.lastIndexOf('/'))};});}}]});
  return JSON.parse(execFileSync(process.execPath,[file,base],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
 }finally{rmSync(temp,{recursive:true,force:true});}
}
