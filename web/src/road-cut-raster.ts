/** Sparse, exact triangle index for the terrain cut shader. Pure loading work. */
export const CUT_BLOCK = 16;
export interface CutRaster { data:Float32Array;x0:number;z0:number;width:number;height:number;triangles:number;maxCandidates:number }
interface Block { counts:Uint16Array; offsets:Uint32Array; written:Uint16Array; pixel:number }
export function* rasterCuts(sources:readonly Float32Array[],x0:number,z0:number,x1:number,z1:number):Generator<void,CutRaster|null> {
  const tri:number[]=[];let xmin=Infinity,zmin=Infinity,xmax=-Infinity,zmax=-Infinity,work=0;
  for(const a of sources)for(let k=0;k<a.length;k+=9){
    const loX=Math.min(a[k],a[k+3],a[k+6]),hiX=Math.max(a[k],a[k+3],a[k+6]),loZ=Math.min(a[k+2],a[k+5],a[k+8]),hiZ=Math.max(a[k+2],a[k+5],a[k+8]);
    if(hiX>=x0&&loX<=x1&&hiZ>=z0&&loZ<=z1){tri.push(...a.subarray(k,k+9));xmin=Math.min(xmin,loX);xmax=Math.max(xmax,hiX);zmin=Math.min(zmin,loZ);zmax=Math.max(zmax,hiZ);}
    if(++work%64===0)yield;
  }
  if(!tri.length)return null;
  x0=Math.floor(Math.max(x0,xmin));z0=Math.floor(Math.max(z0,zmin));x1=Math.ceil(Math.min(x1,xmax));z1=Math.ceil(Math.min(z1,zmax));
  const width=Math.max(1,x1-x0+1),height=Math.max(1,z1-z0+1),cols=Math.ceil(width/CUT_BLOCK),rows=Math.ceil(height/CUT_BLOCK),blocks=new Map<number,Block>();
  let references=0,maxCandidates=0;
  const box=(k:number)=>[Math.max(0,Math.floor(Math.min(tri[k],tri[k+3],tri[k+6])-x0)),Math.min(width-1,Math.floor(Math.max(tri[k],tri[k+3],tri[k+6])-x0)),Math.max(0,Math.floor(Math.min(tri[k+2],tri[k+5],tri[k+8])-z0)),Math.min(height-1,Math.floor(Math.max(tri[k+2],tri[k+5],tri[k+8])-z0))];
  for(let k=0;k<tri.length;k+=9){const [ax,bx,az,bz]=box(k);
    for(let z=az;z<=bz;z++)for(let x=ax;x<=bx;x++){
      const key=Math.floor(z/CUT_BLOCK)*cols+Math.floor(x/CUT_BLOCK);let b=blocks.get(key);
      if(!b){b={counts:new Uint16Array(256),offsets:new Uint32Array(256),written:new Uint16Array(256),pixel:0};blocks.set(key,b);}
      const i=(z%CUT_BLOCK)*CUT_BLOCK+x%CUT_BLOCK,n=++b.counts[i];if(n===65535)throw Error('Cut index cell overflow');maxCandidates=Math.max(maxCandidates,n);references++;
      if(++work%64===0)yield;
    }
  }
  const header=cols*rows,lists=header+blocks.size*256,triBase=lists+Math.ceil(references/4),data=new Float32Array((triBase+tri.length/3)*4);
  let pixel=header,offset=lists*4;
  for(let i=0;i<header;i++){data[i*4]=-1;if(++work%64===0)yield;}
  for(const [key,b]of blocks){b.pixel=pixel;data[key*4]=pixel;pixel+=256;
    for(let i=0;i<256;i++){b.offsets[i]=offset;data[(b.pixel+i)*4]=offset;data[(b.pixel+i)*4+1]=b.counts[i];offset+=b.counts[i];if(++work%64===0)yield;}
  }
  for(let k=0;k<tri.length;k+=9){const [ax,bx,az,bz]=box(k),record=triBase+k/3;
    for(let n=0;n<3;n++){data[(record+n)*4]=tri[k+n*3];data[(record+n)*4+1]=tri[k+n*3+1];data[(record+n)*4+2]=tri[k+n*3+2];}
    for(let z=az;z<=bz;z++)for(let x=ax;x<=bx;x++){
      const b=blocks.get(Math.floor(z/CUT_BLOCK)*cols+Math.floor(x/CUT_BLOCK))!,i=(z%CUT_BLOCK)*CUT_BLOCK+x%CUT_BLOCK;
      data[b.offsets[i]+b.written[i]++]=record;if(++work%64===0)yield;
    }
  }
  return{data,x0,z0,width,height,triangles:tri.length/9,maxCandidates};
}
/** Same exact footprint/height predicate as the shader; no interpolation between strips. */
export function cutRasterHeight(r:CutRaster,x:number,z:number,contains?:(u:number,v:number)=>boolean):number|null {
  const ix=Math.floor(x-r.x0),iz=Math.floor(z-r.z0);if(ix<0||iz<0||ix>=r.width||iz>=r.height)return null;
  const d=r.data,cols=Math.ceil(r.width/CUT_BLOCK),block=d[(Math.floor(iz/CUT_BLOCK)*cols+Math.floor(ix/CUT_BLOCK))*4];if(block<0)return null;
  const cell=(block+(iz%CUT_BLOCK)*CUT_BLOCK+ix%CUT_BLOCK)*4,start=d[cell],count=d[cell+1];let best:number|null=null;
  for(let i=0;i<count;i++){const p=d[start+i]*4,ax=d[p],az=d[p+2],bx=d[p+4]-ax,bz=d[p+6]-az,cx=d[p+8]-ax,cz=d[p+10]-az,det=bx*cz-bz*cx;if(Math.abs(det)<1e-8)continue;
    const dx=x-ax,dz=z-az,u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;if(contains?!contains(u,v):u<0||v<0||u+v>1)continue;
    const h=d[p+1]+u*(d[p+5]-d[p+1])+v*(d[p+9]-d[p+1]);if(best===null||h<best)best=h;
  }return best;
}
