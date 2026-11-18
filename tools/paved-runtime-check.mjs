/** Run the real asynchronous tree loader with a known baked lot root, on and off. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {spawnSync,execFileSync} from 'node:child_process';
const root=process.cwd(),work=execFileSync('python3',['pipeline/paved_work.py'],{encoding:'utf8'}).trim();
const mutation=process.argv.includes('--mutant');
const bundle=await build({stdin:{contents:"export {Trees} from './web/src/trees';export {Paved} from './web/src/paved';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'runtime-tree',setup(b){
 b.onResolve({filter:/^three(?:\/|$)/},a=>({path:pathToFileURL(resolve(root,'web/node_modules',a.path==='three'?'three/build/three.module.js':a.path)).href,external:true}));
 b.onLoad({filter:/\/trees\.ts$/},a=>{let text=readFileSync(a.path,'utf8');if(mutation){assert.ok(text.includes('this.pavedMasks.set(key,mask)'));text=text.replace('this.pavedMasks.set(key,mask)','this.pavedMasks.set(key,null)');}return {contents:text,loader:'ts'};});
}}]});
const {Trees,Paved}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const folder=resolve(work,'pointtupper'),doc=JSON.parse(readFileSync(folder+'/bake.json','utf8')),index=JSON.parse(readFileSync(folder+'/paved/index.json','utf8'));
const dataRoot=resolve('data/baked/areas/pointtupper'),manifest=JSON.parse(readFileSync(dataRoot+'/manifest.json','utf8'));
const lots=JSON.parse(readFileSync(folder+'/lots.geojson','utf8')).features;
const ring=(p,points)=>{let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[c,d]=points[j];if((b>p[1])!==(d>p[1])&&p[0]<(c-a)*(p[1]-b)/(d-b)+a)yes=!yes;}return yes;};
const polygon=(p,rings)=>ring(p,rings[0])&&!rings.slice(1).some(r=>ring(p,r));
const inLot=p=>lots.some(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).some(r=>polygon(p,r)));
const target=doc.tree_cuts.find(c=>{if(!c.paved)return false;const bytes=readFileSync(dataRoot+`/8/${c.tile}.t.bin`),d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),[i,j]=c.tile.split('_').map(Number),o=c.record*8;return inLot([manifest.origin[0]+i*256+d.getUint16(o,true)/65536*256,manifest.origin[1]-j*256-d.getUint16(o+2,true)/65536*256]);});
assert.ok(target,'known retained NSTDB lot tree fixture');
const bytes=readFileSync(dataRoot+`/8/${target.tile}.t.bin`),data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),o=target.record*8;
const [i,j]=target.tile.split('_').map(Number),x0=manifest.origin[0]+i*256-manifest.village[0],z0=manifest.village[1]-manifest.origin[1]+j*256;
const x=x0+data.getUint16(o,true)/65536*256,z=z0+data.getUint16(o+2,true)/65536*256;
const original=globalThis.fetch;
try{
 globalThis.fetch=async url=>new Response(url.endsWith('.t.bin')?bytes:readFileSync(folder+'/paved/'+url.split('/').at(-1)));
 for(const on of [false,true]){
  const paved=on?new Paved(index,'runtime',manifest.village):null;
  const terrain={manifest,low:true,clear:[],coast:null,paved,groundClassAt:()=>0,surfaceAt:()=>({level:8,ground:0}),heightAt:()=>0};
  const trees=new Trees([target.tile],'runtime',terrain,false);await trees.load(target.tile);
  let planted=false;for(const mesh of trees.group.children){const m=mesh.instanceMatrix.array;for(let k=0;k<mesh.count;k++)if(Math.abs(m[k*16+12]-x)<.01&&Math.abs(m[k*16+14]-z)<.01)planted=true;}
  assert.equal(planted,!on,'real tree loader must honour paved mask');
  for(const mesh of trees.group.children)mesh.dispose();paved?.texture.dispose();
 }
}finally{globalThis.fetch=original;}
console.log('PASS runtime tree loader: known lot root',target.tile,target.record,'planted off, absent on');
if(process.argv.includes('--mutations')){
 const r=spawnSync(process.execPath,[process.argv[1],'--mutant'],{encoding:'utf8',env:process.env});
 assert.equal(r.status,1);assert.match(r.stderr,/real tree loader must honour paved mask/);console.log('KILLED loader mask discarded, exit 1');
}
