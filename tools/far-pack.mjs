import {existsSync,readFileSync,realpathSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
/** Validate what ships after promotion; otherwise use an explicit/rehearsal pack. */
export function farPack(root,override=process.env.FAR_VIEWS_BAKE){
 const baked=root+'/data/baked';
 if(override)return existsSync(override+'/terrain/far-land.json')?override:null;
 if(existsSync(baked+'/terrain/far-land.json')&&JSON.parse(readFileSync(baked+'/terrain/tall.json')).version===2)return baked;
 if(!existsSync(baked))return null;
 const work=dirname(realpathSync(baked))+'/work/bakes/far-views';
 return existsSync(work+'/terrain/far-land.json')?work:null;
}

// The phone's "Coarse" far views (Settings > Advanced): a third far-land level, re-meshed from the pack's own
// desktop level (cell 240), so it needs no raw DEM and stays the same surface as the other two levels. It uses the
// bake's rules (pipeline/34_bake_far_views.py mesh()): independent cells aligned to the root, the coast interpolated on
// the zero contour, and root-edge samples (128 m here, 64 m in the bake) tying the seam to the near land. Where a cell
// edge crosses the coast, the crossing is found on the desktop surface itself (bisection), not interpolated between a
// -0.5 m sea corner and a land corner, which on 1920 m cells would push headlands up to a cell out to sea. Every 1920 m
// block is one cell. Measured on the terrain pack: cell 1920 = 9,754 triangles; cell 960 (40 m relief) = 22,512, most
// of them coast fans, which leaves no room on works-yard/phone-explore-truck (19,942 triangles under the phone cap).
export const COARSE=Object.freeze({name:'coarse',file:'far-land-coarse.bin',cell:1920,block:1920,tolerance:40,edge:128});
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Exact height on the desktop level's triangles (piecewise linear). Sea, and the near root, are -0.5. */
export function desktopSurface(meta,bytes){
 const level=meta.levels.desktop,[oe,on]=meta.origin;
 if(bytes.length!==level.bytes||sha256(bytes)!==level.sha256)throw Error('desktop level bytes differ from far-land.json');
 const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length);
 const p=new Float32Array(buffer,0,level.vertices*3),index=new Uint32Array(buffer,level.vertices*12,level.indices);
 const bucket=960,cells=new Map(),key=(i,j)=>i*100000+j;
 const tri=[];
 for(let t=0;t<index.length;t+=3){
  const v=[0,1,2].map(k=>{const i=index[t+k]*3;return [p[i]+oe,on-p[i+2],p[i+1]];});
  const id=tri.length;tri.push(v);
  const i0=Math.floor(Math.min(v[0][0],v[1][0],v[2][0])/bucket),i1=Math.floor(Math.max(v[0][0],v[1][0],v[2][0])/bucket);
  const j0=Math.floor(Math.min(v[0][1],v[1][1],v[2][1])/bucket),j1=Math.floor(Math.max(v[0][1],v[1][1],v[2][1])/bucket);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const k=key(i,j);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(id);}
 }
 return (e,n)=>{
  const list=cells.get(key(Math.floor(e/bucket),Math.floor(n/bucket)));if(!list)return -.5;
  for(const id of list){
   const [a,b,c]=tri[id],d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(!d)continue;
   const u=((b[1]-c[1])*(e-c[0])+(c[0]-b[0])*(n-c[1]))/d,v=((c[1]-a[1])*(e-c[0])+(a[0]-c[0])*(n-c[1]))/d,w=1-u-v,eps=-1e-6;
   if(u>=eps&&v>=eps&&w>=eps)return u*a[2]+v*b[2]+w*c[2]-.5;
  }
  return -.5;
 };
}

/** The coarse level's indexed mesh: little-endian float32 positions, then uint32 indices (the game's .bin layout). */
export function coarseMesh(meta,height,o=COARSE){
 const root=meta.root,anchor=meta.anchor,origin=meta.origin,radius=meta.radius,step=o.cell;
 const inside=(e,n)=>root[0]<=e&&e<=root[2]&&root[1]<=n&&n<=root[3];
 const away=(b)=>Math.hypot(Math.max(b[0]-anchor[0],0,anchor[0]-b[2]),Math.max(b[1]-anchor[1],0,anchor[1]-b[3]));
 const cache=new Map(),h=(e,n)=>{const k=e.toFixed(3)+','+n.toFixed(3);if(!cache.has(k))cache.set(k,height(e,n));return cache.get(k);};
 const leaves=[],horizontal=new Map(),vertical=new Map(),add=(m,k,vals)=>{if(!m.has(k))m.set(k,new Set());for(const v of vals)m.get(k).add(v);};
 const space=(a,b)=>{const count=Math.max(2,Math.ceil((b-a)/step-1e-9)+1);return Array.from({length:count},(_,i)=>a+(b-a)*i/(count-1));};
 const divide=(a,c,b,d)=>{
  if(away([a,c,b,d])>radius)return;
  const xs=space(a,b),ys=space(c,d),s=ys.map(y=>xs.map(x=>h(x,y)));
  const wet=s.flat().map(v=>v<0);if(wet.every(Boolean))return;
  let error=0;
  ys.forEach((_,j)=>xs.forEach((_,i)=>{const ta=i/(xs.length-1),tb=j/(ys.length-1),Y=ys.length-1,X=xs.length-1;
   const approx=s[0][0]*(1-ta)*(1-tb)+s[0][X]*ta*(1-tb)+s[Y][0]*(1-ta)*tb+s[Y][X]*ta*tb;error=Math.max(error,Math.abs(s[j][i]-approx));}));
  if(Math.max(b-a,d-c)>step+1e-6&&(wet.some(Boolean)||error>o.tolerance)){
   const x=(a+b)/2,y=(c+d)/2;for(const box of [[a,c,x,y],[x,c,b,y],[a,y,x,d],[x,y,b,d]])divide(...box);
  }else{leaves.push([a,c,b,d]);for(const y of [c,d])add(horizontal,y,[a,b]);for(const x of [a,b])add(vertical,x,[c,d]);}
 };
 const block=o.block,x0=Math.floor((anchor[0]-radius-root[0])/block)*block+root[0],n0=Math.floor((anchor[1]-radius-root[1])/block)*block+root[1];
 for(let n=n0;n<anchor[1]+radius;n+=block)for(let e=x0;e<anchor[0]+radius;e+=block){
  const xs=[...new Set([e,e+block,...[root[0],root[2]].filter(v=>e<v&&v<e+block)])].sort((p,q)=>p-q);
  const ns=[...new Set([n,n+block,...[root[1],root[3]].filter(v=>n<v&&v<n+block)])].sort((p,q)=>p-q);
  for(let i=0;i+1<xs.length;i++)for(let j=0;j+1<ns.length;j++)if(!inside((xs[i]+xs[i+1])/2,(ns[j]+ns[j+1])/2))divide(xs[i],ns[j],xs[i+1],ns[j+1]);
 }
 const edgeSamples=(from,to)=>{const out=[];for(let v=from;v<=to+1e-6;v+=o.edge)out.push(v);return out;};
 for(const y of [root[1],root[3]])if(horizontal.has(y))add(horizontal,y,edgeSamples(root[0],root[2]));
 for(const x of [root[0],root[2]])if(vertical.has(x))add(vertical,x,edgeSamples(root[1],root[3]));
 const sorted=(m,k,reverse)=>[...m.get(k)].sort((p,q)=>reverse?q-p:p-q);
 const positions=[];
 // The zero crossing between a dry and a wet point, on the surface: 1 m along the edge is enough for 1920 m cells.
 const coast=(a,b)=>{
  let dry=a[2]>=0?a:b,wet=dry===a?b:a,lo=0,hi=1;const at=t=>[dry[0]+t*(wet[0]-dry[0]),dry[1]+t*(wet[1]-dry[1])];
  const length=Math.hypot(wet[0]-dry[0],wet[1]-dry[1]);
  while((hi-lo)*length>1){const mid=(lo+hi)/2,[e,n]=at(mid);if(height(e,n)>=0)lo=mid;else hi=mid;}
  const [e,n]=at(lo);return [e,n,0];
 };
 const emit=poly=>{
  const clipped=[];
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(a[2]>=0)clipped.push(a);if((a[2]>=0)!==(b[2]>=0))clipped.push(coast(a,b));}
  for(let k=1;k+1<clipped.length;k++)for(const [e,n,z] of [clipped[0],clipped[k],clipped[k+1]])positions.push(e-origin[0],z+.5,origin[1]-n);
 };
 for(const [a,c,b,d] of leaves){
  const edge=[...sorted(horizontal,c).filter(x=>a<=x&&x<b).map(x=>[x,c]),...sorted(vertical,b).filter(y=>c<=y&&y<d).map(y=>[b,y]),
   ...sorted(horizontal,d,true).filter(x=>a<x&&x<=b).map(x=>[x,d]),...sorted(vertical,a,true).filter(y=>c<y&&y<=d).map(y=>[a,y])];
  const p=edge.map(([e,n])=>[e,n,h(e,n)]);
  if(p.length===4&&p.every(v=>v[2]>=0)){emit([p[0],p[1],p[2]]);emit([p[0],p[2],p[3]]);continue;}
  const centre=[(a+b)/2,(c+d)/2,h((a+b)/2,(c+d)/2)];
  for(let i=0;i<p.length;i++)emit([centre,p[i],p[(i+1)%p.length]]);
 }
 const f=new Float32Array(positions),seen=new Map(),vertices=[],indices=new Uint32Array(f.length/3);
 for(let i=0;i<f.length;i+=3){const k=f[i]+','+f[i+1]+','+f[i+2];let id=seen.get(k);if(id===undefined){id=vertices.length/3;seen.set(k,id);vertices.push(f[i],f[i+1],f[i+2]);}indices[i/3]=id;}
 // Drop triangles that collapsed to a line on the coast (two equal float32 corners).
 const kept=[];for(let t=0;t<indices.length;t+=3){const [x,y,z]=[indices[t],indices[t+1],indices[t+2]];if(x!==y&&y!==z&&x!==z)kept.push(x,y,z);}
 return {vertices:new Float32Array(vertices),indices:new Uint32Array(kept)};
}

export function levelBytes(mesh){
 const bytes=Buffer.alloc(mesh.vertices.length*4+mesh.indices.length*4);
 mesh.vertices.forEach((v,i)=>bytes.writeFloatLE(v,i*4));const at=mesh.vertices.length*4;mesh.indices.forEach((v,i)=>bytes.writeUInt32LE(v,at+i*4));
 return bytes;
}

/** Adds (or remakes) levels.coarse in one pack folder. Writes only inside data/work/bakes. */
export function addCoarseLevel(folder,dataRoot){
 const dir=resolve(folder),work=resolve(dataRoot,'work/bakes')+sep;
 if(!dir.startsWith(work))throw Error('The coarse level is written only into a task folder under data/work/bakes: '+dir);
 const metaPath=dir+'/far-land.json',meta=JSON.parse(readFileSync(metaPath,'utf8'));
 const mesh=coarseMesh(meta,desktopSurface(meta,readFileSync(dir+'/'+meta.levels.desktop.file))),bytes=levelBytes(mesh);
 const level={file:COARSE.file,cell:COARSE.cell,vertices:mesh.vertices.length/3,indices:mesh.indices.length,triangles:mesh.indices.length/3,bytes:bytes.length,sha256:sha256(bytes)};
 const write=(path,data)=>{writeFileSync(path+'.tmp',data);renameSync(path+'.tmp',path);};
 write(dir+'/'+COARSE.file,bytes);
 write(metaPath,JSON.stringify({...meta,levels:{desktop:meta.levels.desktop,low:meta.levels.low,coarse:level}})+'\n');
 return level;
}

// node tools/far-pack.mjs --coarse [BAKE_ROOT]: every pack (terrain, areas/*) of the staged far views bake.
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const args=process.argv.slice(2);if(args[0]!=='--coarse')throw Error('usage: node tools/far-pack.mjs --coarse [BAKE_ROOT]');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dataRoot=dirname(realpathSync(root+'/data/baked'));
 const bake=resolve(args[1]??dataRoot+'/work/bakes/far-views');
 const packs=['terrain',...(existsSync(bake+'/areas')?readdirSync(bake+'/areas').sort().map(a=>'areas/'+a):[])].filter(p=>existsSync(bake+'/'+p+'/far-land.json'));
 for(const pack of packs){const level=addCoarseLevel(bake+'/'+pack,dataRoot);console.log(pack,JSON.stringify(level));}
}
