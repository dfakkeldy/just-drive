// Read only encoded height/canopy/category data, never photo pixels.
import {readFileSync} from 'node:fs';
import {png} from './quarry-height-read.mjs';
import {railAccess} from '../web/src/guardrail-access.ts';
import {nearCoast} from '../web/src/guardrail-rules.ts';
import {RAIL_PROP_RADII} from '../web/src/props.ts';
import {Roads} from '../web/src/roads.ts';
export function railLand(area='terrain'){
 const base=`data/baked/${area}`,manifest=JSON.parse(readFileSync(`${base}/manifest.json`)),v=manifest.village;
 const roads=new Roads(JSON.parse(readFileSync(`${base}/roads.json`)),v,{manifest,cartRoads:false});
 const cache=new Map(),exists=Object.fromEntries(Object.entries(manifest.levels).map(([k,v])=>[k,new Set(v)]));let reads=0;
 const sample=(x,z,coarse=false)=>{
  const east=x+v[0]-manifest.origin[0],south=z-v[1]+manifest.origin[1];let level=8,size=manifest.size/256,i=Math.floor(east/size),j=Math.floor(south/size);
  while(!exists[level]?.has(`${i}_${j}`)){if(!coarse||level===0)return null;level--;size=manifest.size/2**level;i=Math.floor(east/size);j=Math.floor(south/size);}
  const key=`${level}/${i}_${j}`;let px=cache.get(key);if(!px){px=png(readFileSync(`${base}/${key}.png`)).pixels;cache.set(key,px);reads++;if(cache.size>128)cache.delete(cache.keys().next().value);}
  const u=(east/size-i)*256,w=(south/size-j)*256,a=Math.min(255,Math.floor(u)),b=Math.min(255,Math.floor(w));
  const h=(xx,zz)=>{const k=(zz*257+xx)*4;return (px[k]*256+px[k+1])*manifest.height.scale+manifest.height.offset;};
  const c=(xx,zz)=>px[(zz*257+xx)*4+2]*manifest.canopy.scale;
  const mix=f=>(f(a,b)*(1-u+a)+f(a+1,b)*(u-a))*(1-w+b)+(f(a,b+1)*(1-u+a)+f(a+1,b+1)*(u-a))*(w-b);
  return {height:mix(h),canopy:mix(c),level};
 };
 const ground=(x,z,coarse=false)=>sample(x,z,coarse)?.height??null;
 const props=JSON.parse(readFileSync(`${base}/${manifest.props.file}`));
 const obstacles=[...props.mailboxes.map(p=>({...p,radius:RAIL_PROP_RADII.mailbox})),...props.communityBoxes.map(p=>({...p,radius:p.modules*RAIL_PROP_RADII.communityModule+RAIL_PROP_RADII.communityClear})),...props.poles.map(p=>({...p,radius:RAIL_PROP_RADII.pole}))].map(p=>({x:p.x-v[0],z:v[1]-p.y,radius:p.radius}));
 const access=railAccess(roads,ground,v,true,obstacles),coastCache=new Map();
 const context={canopy:(x,z)=>sample(x,z,true)?.canopy??0,coast:(r,s,side)=>{const k=`${r.id}/${Math.round(s/30)}/${side}`;if(!coastCache.has(k))coastCache.set(k,nearCoast(r,s,side,ground));return coastCache.get(k);}};
 return {manifest,village:v,roads,sample,ground,access,context,obstacles,get reads(){return reads;}};
}
