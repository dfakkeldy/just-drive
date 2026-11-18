/** CPU reference for categorical R8's hardware-linear edge, used by spatial/GPU checks. */
export const smooth=(a:number,b:number,x:number):number=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const fract=(v:number)=>v-Math.floor(v);
export function pavedNoise(x:number,y:number):number {
  const hash=(a:number,b:number)=>{let x=fract(a*.1031),y=fract(b*.1031),z=x;const d=x*(y+33.33)+y*(z+33.33)+z*(x+33.33);x+=d;y+=d;z+=d;return fract((x+y)*z);};
  const ix=Math.floor(x),iy=Math.floor(y),fx=fract(x),fy=fract(y),ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);
  return (hash(ix,iy)*(1-ux)+hash(ix+1,iy)*ux)*(1-uy)+(hash(ix,iy+1)*(1-ux)+hash(ix+1,iy+1)*ux)*uy;
}
export function pavedWeight(data:Uint8Array,width:number,height:number,x:number,z:number,cls=3,carX=0,carZ=0,noise=pavedNoise(x*.6,z*.6)):number {
  if(cls===4||x<0||z<0||x>=width*2||z>=height*2)return 0;
  const qx=x*.5-.5,qz=z*.5-.5,ix=Math.floor(qx),iz=Math.floor(qz),f={x:fract(qx),y:fract(qz)};
  const cell=(a:number,b:number)=>data[Math.max(0,Math.min(height-1,b))*width+Math.max(0,Math.min(width-1,a))];
  const v=(cell(ix,iz)*(1-f.x)+cell(ix+1,iz)*f.x)*(1-f.y)+(cell(ix,iz+1)*(1-f.x)+cell(ix+1,iz+1)*f.x)*f.y;
  return smooth(.25,.75,v+.3*(noise-.5)*4*v*(1-v))*(1-smooth(380,480,Math.hypot(x-carX,z-carZ)));
}

/** Tree roots use the class cell plus one cell of margin over the blended edge. */
export function pavedTreeCell(data:Uint8Array|null,x:number,z:number):boolean {
  if(!data)return false;
  const col=Math.floor(x/2),row=Math.floor(z/2);
  for(let r=Math.max(0,row-1);r<=Math.min(127,row+1);r++)
    for(let c=Math.max(0,col-1);c<=Math.min(127,col+1);c++)if(data[r*128+c])return true;
  return false;
}
