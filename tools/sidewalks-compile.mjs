// Bake the static GPU buffers and reference tables. Called only by sidewalks_bake.py.
import {gzipSync} from 'node:zlib';
import {bakeLow,assertWorkRoot} from './sidewalks-low-bake.mjs';
import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {build} from '../web/node_modules/esbuild/lib/main.js';
const root=process.cwd(),out=await build({stdin:{contents:"export {Sidewalks,slabProbes} from './web/src/sidewalks.ts'",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'offline-bootstrap',setup(b){b.onResolve({filter:/sidewalks-packed-.*\.json$/},a=>({path:a.path,external:true}));}}],alias:{three:resolve(root,'web/node_modules/three/build/three.module.js')}});
const {Sidewalks,slabProbes}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const workAt=process.argv.indexOf('--work-root');if(workAt<0||!process.argv[workAt+1])throw Error('Explicit --work-root required; data installation is separate');
const workRoot=resolve(process.argv[workAt+1]);assertWorkRoot(workRoot);
const encode=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength).toString('base64');
// One-sided samples bound a mixed-LOD seam even when the two selected grids differ at its edge.
function heightProbes(c,origin,grid,cell){
 const base=slabProbes(c,origin,grid),extra=[],seen=new Set(base.map(p=>p.join(',')));
 const lo=[0,1].map(axis=>Math.floor((Math.min(...c.map(p=>p[axis]))-origin[axis])/cell));
 const hi=[0,1].map(axis=>Math.floor((Math.max(...c.map(p=>p[axis]))-origin[axis])/cell));
 if(lo[0]===hi[0]&&lo[1]===hi[1])return base;
 const clip=(poly,axis,line,sign)=>{const out=[];for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],inside=(p[axis]-line)*sign>=0,next=(q[axis]-line)*sign>=0;
  if(inside)out.push(p);
  if(inside!==next){const t=(line-p[axis])/(q[axis]-p[axis]),r=p.map((v,k)=>v+(q[k]-v)*t);r[axis]=line;out.push(r);}
 }return out;};
 for(const ids of [[0,1,2],[0,2,3]])for(let z=lo[1];z<=hi[1];z++)for(let x=lo[0];x<=hi[0];x++){
  let poly=ids.map(id=>c[id]);for(const [axis,index]of [[0,x],[1,z]]){poly=clip(poly,axis,origin[axis]+index*cell,1);poly=clip(poly,axis,origin[axis]+(index+1)*cell,-1);}
  if(poly.length<3)continue;
  const area=Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p[0]*q[1]-q[0]*p[1];},0));if(area<1e-10)continue;
  const centre=[0,1].map(axis=>poly.reduce((sum,p)=>sum+p[axis],0)/poly.length);
  for(const p of poly){const q=p.map((v,axis)=>v+(centre[axis]-v)*.0001),key=q.join(',');if(!seen.has(key)){seen.add(key);extra.push(q);}}
 }
 return [...base,...extra];
}

for(const area of ['mabou','porthood','pointtupper']){
 const path=resolve(workRoot,`web/src/sidewalks-plan-${area}.json`),data=JSON.parse(readFileSync(path,'utf8')),manifest=JSON.parse(readFileSync(`data/baked/${area==='mabou'?'terrain':`areas/${area}`}/manifest.json`));data.compiled=[];
 for(const low of [false,true]){
  const w=new Sidewalks(data,manifest.village,{manifest},{roads:[],bridgeWalks:new Map()},low,true,true);
  const sampled=w.jobs.map(job=>{const all=job.refs.map(ref=>w.points[ref]);for(const s of job.surfaces){const points=s.refs.map(i=>w.points[i]),probes=heightProbes(points.map(p=>p.map(Math.fround)),w.origin,w.gridStep,manifest.size/512);s.probeBytes=encode(new Float64Array(probes.flat()));all.push(...probes);}return all;});
  const cellSize=manifest.size/512,keys=sampled.map(samples=>new Set(samples.map(p=>`${Math.floor((p[0]+manifest.village[0]-manifest.origin[0])/cellSize)},${Math.floor((p[1]-(manifest.village[1]-manifest.origin[1]))/cellSize)}`)));
  const coords=keys.flatMap(set=>[...set].map(key=>key.split(',').map(Number))),col=Math.min(...coords.map(p=>p[0])),row=Math.min(...coords.map(p=>p[1]));
  const cols=Math.max(...coords.map(p=>p[0]))-col+1,rows=Math.max(...coords.map(p=>p[1]))-row+1,cells=Array.from({length:cols*rows},()=>[]);
  keys.forEach((set,id)=>{for(const key of set){const [x,y]=key.split(',').map(Number);cells[x-col+(y-row)*cols].push(id);}});
  for(const job of w.jobs){job.heightTiles=[];job.drawTiles=[];}
  for(const [key,tile]of Object.entries(data.terrain))for(const [field,member]of [['drawTiles',tile.members],['heightTiles',tile.heightMembers??tile.members]]){const [ids,fs]=member[low?1:0];for(const id of [...ids,...fs.map(f=>data.plans[low?1:0].pieces.length+f)])w.jobs[id][field].push(key);}
  const coverage={col,row,cols,rows,cells};
  data.compiled.push({coverage,points:w.points,bridgeRefs:w.bridgeRefs,topOwners:w.topOwners,topCount:w.topCount,bridgeJobs:w.bridgeJobs,jobs:w.jobs,geometries:[0,1].map(i=>{const mesh=w.meshes[i];if(!mesh)return null;const g=mesh.geometry,s=g.boundingSphere;return {positions:encode(g.attributes.position.array),uv:encode(g.attributes.uv.array),colors:encode(g.attributes.color.array),sphere:[s.center.x,s.center.y,s.center.z,s.radius]};})});
  if(!low)for(const t of data.tiles){const index=t[0]-w.maskE+(t[1]-w.maskN)*w.maskCols;t[6]=encode(w.maskEntries[index].data);}
  w.dispose();
 }
 const payload=gzipSync(Buffer.from(JSON.stringify(data)),{level:9}).toString('base64');writeFileSync(resolve(workRoot,`web/src/sidewalks-packed-${area}.json`),JSON.stringify({version:2,payload})+'\n');console.log('compiled',area,data.compiled.map(p=>p.jobs.length),'packed bytes',payload.length);
}
for(const file of bakeLow(workRoot,workRoot))console.log('compiled LOW',file.path,file.bytes,file.sha256);
