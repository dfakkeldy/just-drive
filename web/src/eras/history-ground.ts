import type { Manifest } from '../terrain';
import { readFile } from '../store';

/** Narrow 4 m height grids serve only timber bridge cuts/approaches. Dwelling and trade placement is precomputed offline. */
export async function historyGround(manifest: Manifest, base: string, extra:readonly [number,number][]=[]): Promise<(x: number,z: number)=>number|null> {
  const level=6,size=manifest.size/2**level,names=new Set(manifest.levels[level]??[]),wanted=new Set<string>();
  for(const t of extra.map(([e,n])=>({e,n})))for(const dx of [-64,0,64])for(const dz of [-64,0,64]){
    const i=Math.floor((t.e+dx-manifest.origin[0])/size),j=Math.floor((manifest.origin[1]-t.n+dz)/size),key=`${i}_${j}`;
    if(names.has(key))wanted.add(key);
  }
  const grids=new Map<string,Uint16Array>();
  // Four at a time, rather than opening every image decoder on a phone at once.
  const keys=[...wanted];
  for(let k=0;k<keys.length;k+=4)await Promise.all(keys.slice(k,k+4).map(async key=>{
    const bmp=await createImageBitmap(await readFile(base,`${level}/${key}.png`),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
    const cv=new OffscreenCanvas(257,257),ctx=cv.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bmp,0,0);bmp.close();
    const p=ctx.getImageData(0,0,257,257).data,g=new Uint16Array(257*257);for(let i=0;i<g.length;i++)g[i]=p[i*4]*256+p[i*4+1];grids.set(key,g);
    cv.width=cv.height=0;
  }));
  return (x,z)=>{
    const e=x+manifest.village[0]-manifest.origin[0],s=z+manifest.origin[1]-manifest.village[1];
    const step=size,i=Math.floor(e/step),j=Math.floor(s/step),g=grids.get(`${i}_${j}`);if(!g)return null;
    const u=(e/step-i)*256,v=(s/step-j)*256,a=Math.min(255,Math.floor(u)),b=Math.min(255,Math.floor(v)),dx=u-a,dz=v-b;
    return ((g[b*257+a]*(1-dx)+g[b*257+a+1]*dx)*(1-dz)+(g[(b+1)*257+a]*(1-dx)+g[(b+1)*257+a+1]*dx)*dz)*manifest.height.scale+manifest.height.offset;
  };
}
