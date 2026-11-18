/** Map metres, EPSG:2961. The narrow mouth is between the northern bank and the southern sand spit.
 * These points follow the surveyed water corridor, then continue west-north-west into the gulf.
 * The raster records water surfaces, not navigational bathymetry: see tools/fishing-survey.py.
 */
export const FISHING_COURSE: readonly (readonly [number, number])[] = [
  [618679.1,5104749], [618679.1,5104705], [618675,5104670], [618650,5104655],
  [618600,5104680], [618480,5104760], [618280,5104850], [618150,5104910],
  [618090,5104937], [618030,5104943], [617970,5104948], [617900,5104960],
  [617820,5105000], [617650,5105080], [617350,5105200], [616900,5105400], [616500,5105580],
];
export interface BoatCourseSample { e:number; n:number; de:number; dn:number; speed:number; distance:number }
let samples: Float64Array | null = null;
// Catmull-Rom samples, spaced about a metre apart, with accumulated chord lengths. Built once on first use.
function route():Float64Array {
  if(samples)return samples;
  const points:number[]=[];let distance=0,lastE=0,lastN=0;
  for(let i=0;i<FISHING_COURSE.length-1;i++){
    const b=FISHING_COURSE[i],c=FISHING_COURSE[i+1],a=FISHING_COURSE[Math.max(0,i-1)],d=FISHING_COURSE[Math.min(FISHING_COURSE.length-1,i+2)];
    const steps=Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1]));
    for(let j=i===0?0:1;j<=steps;j++){
      const t=j/steps,t2=t*t,t3=t2*t;
      const e=.5*((2*b[0])+(-a[0]+c[0])*t+(2*a[0]-5*b[0]+4*c[0]-d[0])*t2+(-a[0]+3*b[0]-3*c[0]+d[0])*t3);
      const n=.5*((2*b[1])+(-a[1]+c[1])*t+(2*a[1]-5*b[1]+4*c[1]-d[1])*t2+(-a[1]+3*b[1]-3*c[1]+d[1])*t3);
      if(points.length)distance+=Math.hypot(e-lastE,n-lastN);
      points.push(distance,e,n);lastE=e;lastN=n;
    }
  }
  samples=new Float64Array(points);return samples;
}
const CAST_OFF_SECONDS=50,CAST_OFF_SPEED=3.5;
const CAST_OFF_DISTANCE=CAST_OFF_SPEED*(CAST_OFF_SECONDS-6*(1-Math.exp(-CAST_OFF_SECONDS/6)));
const CAST_OFF_END_SPEED=CAST_OFF_SPEED*(1-Math.exp(-CAST_OFF_SECONDS/6));
export function departureDuration():number {const p=route();return Math.ceil(1+CAST_OFF_SECONDS+(p[p.length-3]-CAST_OFF_DISTANCE)/7+(7-CAST_OFF_END_SPEED)*12/7);}
/** Reuses its caller's sample. Cast off and turn at 3.5 m/s, then gently build to a 7 m/s cruise. */
export function sampleDeparture(seconds:number,out:BoatCourseSample):void {
  const p=route(),t=Math.max(0,seconds-1),u=Math.max(0,t-CAST_OFF_SECONDS);
  const distance=t<=CAST_OFF_SECONDS?CAST_OFF_SPEED*(t-6*(1-Math.exp(-t/6))):CAST_OFF_DISTANCE+7*u-(7-CAST_OFF_END_SPEED)*12*(1-Math.exp(-u/12));
  const speed=t<=CAST_OFF_SECONDS?CAST_OFF_SPEED*(1-Math.exp(-t/6)):7-(7-CAST_OFF_END_SPEED)*Math.exp(-u/12);
  let lo=0,hi=p.length/3-1;
  while(lo<hi-1){const m=(lo+hi)>>1;if(p[m*3]<distance)lo=m;else hi=m;}
  const a=lo*3,b=hi*3,length=p[b]-p[a],f=(distance-p[a])/length;
  out.e=p[a+1]+(p[b+1]-p[a+1])*f;out.n=p[a+2]+(p[b+2]-p[a+2])*f;
  const left=Math.max(0,lo-1)*3,right=Math.min(p.length/3-1,hi+1)*3;
  const de0=p[b+1]-p[left+1],dn0=p[b+2]-p[left+2],len0=Math.hypot(de0,dn0);
  const de1=p[right+1]-p[a+1],dn1=p[right+2]-p[a+2],len1=Math.hypot(de1,dn1),turn=Math.min(1,f);
  const de=de0/len0+(de1/len1-de0/len0)*turn,dn=dn0/len0+(dn1/len1-dn0/len0)*turn,norm=Math.hypot(de,dn);
  out.de=de/norm;out.dn=dn/norm;
  out.speed=speed;out.distance=distance;
}
