// Conservative acceptance of an unflagged trail gap. Source-flagged bridges do not use this rule.
// Sample the same 2 m bare-earth profile used by the survey. A 100% face is the pit/gully boundary.
export function classifyGap(candidate,roads,height){
 const pts=candidate.pts,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
 const len=cum.at(-1),samples=[];let grade=0;
 for(let s=0;s<len+2;s+=2){const d=Math.min(len,s);let i=0;while(i<pts.length-2&&d>cum[i+1])i++;const a=pts[i],b=pts[i+1],t=(d-cum[i])/(cum[i+1]-cum[i]||1),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,h=height(x,z);if(h===null)throw Error('unloaded inferred-gap profile');if(samples.length)grade=Math.max(grade,Math.abs(h-samples.at(-1).h)/(d-samples.at(-1).s||1));samples.push({s:d,x,z,h});if(d===len)break;}
 let underRoad=null;
 const footprint=[...samples];
 for(const end of[false,true]){const a=end?pts.at(-1):pts[0],b=end?pts.at(-2):pts[1],n=Math.hypot(a[0]-b[0],a[1]-b[1])||1;for(let d=2;d<=16;d+=2)footprint.push({s:end?len+d:-d,x:a[0]+(a[0]-b[0])*d/n,z:a[1]+(a[1]-b[1])*d/n});}
 for(const p of footprint){const plane=samples[0].h+(samples.at(-1).h-samples[0].h)*p.s/len;
  for(const r of roads){if(r.id===candidate.road)continue;
   for(let j=1;j<r.pts.length;j++){const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/n)),x=a[0]+dx*t,z=a[1]+dz*t;
    if(Math.hypot(x-p.x,z-p.z)>r.halfWidth+1)continue;
    // A same-grade side trail or a coincident continuation is not an underpass.
    const i=Math.min(pts.length-2,Math.max(0,p.s>=len?pts.length-2:cum.findIndex(v=>v>p.s)-1)),sx=pts[i+1][0]-pts[i][0],sz=pts[i+1][1]-pts[i][1];
    if((r.kind<=2||plane-(height(x,z)??plane)>1)&&Math.abs(dx*sz-dz*sx)>.2*Math.hypot(dx,dz)*Math.hypot(sx,sz)){underRoad=r.id;break;}
   }if(underRoad!==null)break;
  }if(underRoad!==null)break;
 }
 return{accept:grade<=1&&underRoad===null,grade,underRoad,reason:underRoad!==null?'mapped road beneath span':grade>1?'gap face exceeds 100%':'two banks, no road underneath, faces at most 100%'};
}
