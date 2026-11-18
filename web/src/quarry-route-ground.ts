import {quarryRoute,routeJunctionSamples, type QuarryRoute, type RouteHeight} from './quarry-route';
import type {Road} from './roads';
import type {Terrain,Manifest} from './terrain';
import {readFile} from './store';
/** Read only the fine baked tiles needed to validate near-miss junctions, once at trip startup. */
export async function routeHeights(roads:readonly Road[],manifest:Manifest,read:(path:string)=>Promise<{data:Uint8ClampedArray;width:number}>):Promise<RouteHeight>{
  const positions=routeJunctionSamples(roads);
  const size=manifest.size/256,tiles=new Map<string,{data:Uint8ClampedArray;width:number}>();
  const key=(x:number,z:number)=>`${Math.floor((x+manifest.village[0]-manifest.origin[0])/size)}_${Math.floor((z-manifest.village[1]+manifest.origin[1])/size)}`;
  await Promise.all([...new Set(positions.map(p=>key(p.x,p.z)))].map(async id=>{
    if(!manifest.levels['8']?.includes(id))throw Error('Fine baked elevation absent at route junction '+id);
    tiles.set(id,await read('8/'+id+'.png'));
  }));
  return(x,z)=>{
    const id=key(x,z),tile=tiles.get(id);if(!tile)return null;const [i,j]=id.split('_').map(Number),scale=(tile.width-1)/size;
    const u=Math.min(tile.width-1,Math.max(0,Math.round((x+manifest.village[0]-manifest.origin[0]-i*size)*scale)));
    const v=Math.min(tile.width-1,Math.max(0,Math.round((z-manifest.village[1]+manifest.origin[1]-j*size)*scale))),k=(v*tile.width+u)*4;
    return (tile.data[k]*256+tile.data[k+1])*manifest.height.scale+manifest.height.offset;
  };
}
export async function loadQuarryRoute(roads:readonly Road[],terrain:Terrain):Promise<QuarryRoute>{
  const heights=await routeHeights(roads,terrain.manifest,async path=>{
    const bmp=await createImageBitmap(await readFile(terrain.base,path),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
    const canvas=new OffscreenCanvas(bmp.width,bmp.height),ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bmp,0,0);bmp.close();
    return {data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width};
  });
  return quarryRoute(roads,terrain.manifest.village,heights);
}
