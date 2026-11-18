// Read only encoded baked height tiles. No photo pixels or intensity data.
import {readFileSync} from 'node:fs';
import {png} from './quarry-height-read.mjs';
const root='data/baked/areas/cansocauseway',m=JSON.parse(readFileSync(root+'/manifest.json')),cache=new Map();
const exists=Object.fromEntries(Object.entries(m.levels).map(([k,v])=>[k,new Set(v)]));
export function height(e,n){const east=e-m.origin[0],south=m.origin[1]-n;let level=8,size=m.size/256,i=Math.floor(east/size),j=Math.floor(south/size);while(!exists[level]?.has(`${i}_${j}`)){if(level===0)return null;level--;size=m.size/2**level;i=Math.floor(east/size);j=Math.floor(south/size);}const key=`${level}/${i}_${j}`;let px=cache.get(key);if(!px){px=png(readFileSync(`${root}/${key}.png`)).pixels;cache.set(key,px);}const u=(east/size-i)*256,w=(south/size-j)*256,a=Math.min(255,Math.floor(u)),b=Math.min(255,Math.floor(w));const h=(x,z)=>{let k=(z*257+x)*4;return(px[k]*256+px[k+1])*m.height.scale+m.height.offset;};return(h(a,b)*(1-u+a)+h(a+1,b)*(u-a))*(1-w+b)+(h(a,b+1)*(1-u+a)+h(a+1,b+1)*(u-a))*(w-b);}
