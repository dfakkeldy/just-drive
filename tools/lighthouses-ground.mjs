import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
function png(b){let w,h,ch,id=[];for(let p=8;p<b.length;){const n=b.readUInt32BE(p),t=b.toString('ascii',p+4,p+8),v=b.subarray(p+8,p+8+n);p+=12+n;if(t==='IHDR'){w=v.readUInt32BE(0);h=v.readUInt32BE(4);ch=v[9]===6?4:3;}if(t==='IDAT')id.push(v);}let src=inflateSync(Buffer.concat(id)),a=new Uint8Array(w*h*ch),stride=w*ch;const pa=(a,b,c)=>{let p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};for(let y=0;y<h;y++)for(let x=0;x<stride;x++){let i=y*stride+x,A=x>=ch?a[i-ch]:0,B=y?a[i-stride]:0,C=y&&x>=ch?a[i-stride-ch]:0,f=src[y*(stride+1)];a[i]=(src[y*(stride+1)+x+1]+[0,A,B,(A+B)>>1,pa(A,B,C)][f])&255;}return {w,h,ch,a};}
export function bakedHeight(area,e,n){
 const base=area==='mabou'?'data/baked/terrain':`data/baked/areas/${area}`,m=JSON.parse(readFileSync(base+'/manifest.json'));
 for(let l=8;l>=0;l--){const size=m.size/2**l,i=Math.floor((e-m.origin[0])/size),j=Math.floor((m.origin[1]-n)/size);
  if(!m.levels[l]?.includes(`${i}_${j}`))continue;
  const p=png(readFileSync(`${base}/${l}/${i}_${j}.png`)),x=(e-m.origin[0]-i*size)/size*(p.w-1),y=(m.origin[1]-n-j*size)/size*(p.h-1),ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const at=(a,b)=>{const k=(Math.min(p.h-1,b)*p.w+Math.min(p.w-1,a))*p.ch;return (p.a[k]*256+p.a[k+1])*m.height.scale+m.height.offset;};
  return {height:(1-fy)*((1-fx)*at(ix,iy)+fx*at(ix+1,iy))+fy*((1-fx)*at(ix,iy+1)+fx*at(ix+1,iy+1)),level:l};
 }
 throw Error(`No baked ground for ${area} ${e} ${n}`);
}
