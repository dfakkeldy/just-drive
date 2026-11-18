import type { WharfSource } from './wharf-source';
export type WharfPart = 'edge' | 'bollard' | 'ladder' | 'tyre' | 'pole' | 'trap' | 'buoy';
export interface WharfPlacement {
  kind: WharfPart; e: number; n: number; height: number; angle: number; length: number; lift: number; slope: number;
}
export function insideWharf(outline: WharfSource['outline'], e: number, n: number): boolean {
  let inside = false;
  for (let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const [a,b]=outline[j],[c,d]=outline[i];
    if ((b>n)!==(d>n) && e<(c-a)*(n-b)/(d-b)+a) inside=!inside;
  }
  return inside;
}
export type Footprint = readonly (readonly [number,number])[];
/** True within `margin` metres of any building footprint near the outline (east/north metres, either winding). */
export function buildingBlocker(outline: WharfSource['outline'], footprints: readonly Footprint[], margin=.6): (e:number,n:number)=>boolean {
  const es=outline.map(p=>p[0]),ns=outline.map(p=>p[1]),pad=margin+2;
  const [e0,e1,n0,n1]=[Math.min(...es)-pad,Math.max(...es)+pad,Math.min(...ns)-pad,Math.max(...ns)+pad];
  const near=footprints.filter(f=>{
    if(f.length<3)return false;
    const fe=f.map(p=>p[0]),fn=f.map(p=>p[1]);
    return Math.max(...fe)>e0&&Math.min(...fe)<e1&&Math.max(...fn)>n0&&Math.min(...fn)<n1;
  });
  if(!near.length)return ()=>false;
  return (e,n)=>near.some(f=>{
    if(insideWharf(f as WharfSource['outline'],e,n))return true;
    for(let i=0,j=f.length-1;i<f.length;j=i++){
      const [a,b]=f[j],[c,d]=f[i],dx=c-a,dy=d-b,l=dx*dx+dy*dy;
      const t=l?Math.max(0,Math.min(1,((e-a)*dx+(n-b)*dy)/l)):0;
      if(Math.hypot(a+dx*t-e,b+dy*t-n)<margin)return true;
    }
    return false;
  });
}
/** Heights are in drawn game metres. Never fabricate a deck over water or missing terrain, or inside a building on the deck. */
export function planWharf(source: Pick<WharfSource,'outline'>, ground: (e:number,n:number)=>number|null, sea=-.2, blocked:(e:number,n:number)=>boolean=()=>false): WharfPlacement[] {
  const result: WharfPlacement[]=[];
  const safe=(e:number,n:number,radius:number,tolerance=.12):number|null=>{
    const h=ground(e,n);
    if(h===null || h<sea+.3 || !insideWharf(source.outline,e,n) || blocked(e,n))return null;
    for(const [de,dn] of [[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[radius,-radius],[-radius,radius],[-radius,-radius]]){
      if(!insideWharf(source.outline,e+de,n+dn) || blocked(e+de,n+dn))return null;
      const q=ground(e+de,n+dn);if(q===null || Math.abs(q-h)>tolerance)return null;
    }
    return h;
  };
  let distance=0,station=0,lastHardware=-Infinity;
  for(let i=1;i<source.outline.length;i++){
    const [ae,an]=source.outline[i-1],[be,bn]=source.outline[i];
    const length=Math.hypot(be-ae,bn-an);if(length<.1)continue;
    const de=(be-ae)/length,dn=(bn-an)/length,steps=Math.ceil(length/2),step=length/steps;
    for(let j=0;j<steps;j++){
      const e=ae+de*(j+.5)*step,n=an+dn*(j+.5)*step;
      // Select the polygon's inside normal, independent of winding. The edge stays 0.5 m inboard.
      const sign=insideWharf(source.outline,e-dn*.5,n+de*.5)?1:-1;
      const x=e-dn*.5*sign,y=n+de*.5*sign,h=safe(x,y,.12);
      const a=safe(x-de*step/2,y-dn*step/2,.12),b=safe(x+de*step/2,y+dn*step/2,.12);
      if(h!==null&&a!==null&&b!==null&&Math.abs(a-b)<.7&&Math.abs((a+b)/2-h)<.06){
        const angle=Math.atan2(-dn,de)+(sign===1?Math.PI:0);
        result.push({kind:'edge',e:x,n:y,height:h,angle,length:step,lift:0,slope:(b-a)/step*(sign===1?-1:1)});
        if(Math.abs(a-b)<.12&&Math.floor(distance/10)!==Math.floor((distance+step)/10)){
          result.push({kind:'bollard',e:x,n:y,height:h,angle,length:1,lift:0,slope:0});

        }
        // The wet face determines hardware stations, independently of bollard spacing.
        const outside=ground(x+dn*sign,y-de*sign);
        if(Math.abs(a-b)<.3&&outside!==null&&outside<sea+.3&&distance-lastHardware>8){
          result.push({kind:station++%3===0?'tyre':'ladder',e:x,n:y,height:h,angle,length:1,lift:0,slope:0});
          lastHardware=distance;
        }
      }
      distance+=step;
    }
  }
  // A small working group on a flat, supported part of the mapped wharf, clear of the edge.
  for(const edge of result.slice()){
    if(edge.kind!=='edge')continue;
    const de=Math.cos(edge.angle),dn=-Math.sin(edge.angle);
    for(const sign of [-1,1]){
      const e=edge.e-dn*2*sign,n=edge.n+de*2*sign,h=safe(e,n,1.4,.04);
      if(h===null)continue;
      const pieces: Array<[WharfPart,number,number,number]>=[['pole',0,0,0],['trap',1,0,0],['trap',1,0,.72],['buoy',0,1,0]];
      for(const [kind,x,y,lift] of pieces){
        const q=safe(e+x,n+y,.65,.04);if(q===null)continue;
        result.push({kind,e:e+x,n:n+y,height:q,angle:edge.angle,length:1,lift,slope:0});
      }
      return result;
    }
  }
  return result;
}
