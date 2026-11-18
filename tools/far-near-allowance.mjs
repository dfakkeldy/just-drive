// Owner-approved exception: at most four fully covered sea pixels, one byte
// level per channel. Land, larger differences and temporal faults stay exact.
export function nearQuantisationAllowed({changed,seaChanges,maxDelta}) {
  if (![changed,seaChanges,maxDelta].every(Number.isInteger) || changed<0 || seaChanges<0 || seaChanges>changed) return false;
  return changed===0 ? seaChanges===0 && maxDelta===0
    : changed<=4 && seaChanges===changed && maxDelta===1;
}

// Shared by the synthetic boundary cases and the browser's frozen masks.
export function nearPixelDiff(a,b,mask,coverage) {
  if (a.length!==b.length || a.length!==mask.length*4 || coverage.length!==a.length) throw new RangeError('near pixel buffers differ');
  let changed=0,seaChanges=0,maxDelta=0;
  for(let i=0;i<mask.length;i++) {
    if(!mask[i])continue;
    let delta=0;
    for(let k=0;k<4;k++)delta=Math.max(delta,Math.abs(a[i*4+k]-b[i*4+k]));
    if(delta){changed++;if(coverage[i*4+1]===255)seaChanges++;maxDelta=Math.max(maxDelta,delta);}
  }
  return {changed,seaChanges,maxDelta};
}
