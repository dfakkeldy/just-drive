export const MAX_DENSITY_RAW_SPACING_M=4;
export function requireDensityResolution(manifest,x,z,siteId='unidentified site'){
 const e=x+manifest.village[0]-manifest.origin[0],s=z+manifest.origin[1]-manifest.village[1];
 for(let level=8;level>=0;level--){const size=manifest.size/2**level,i=Math.floor(e/size),j=Math.floor(s/size),key=`${i}_${j}`;
  if(!manifest.levels[level]?.includes(key))continue;const spacing=size/256;if(spacing<=MAX_DENSITY_RAW_SPACING_M)return {level,i,j,key:`${level}/${key}.png`,spacing};
  break;
 }
 const size=manifest.size/64,key=`6/${Math.floor(e/size)}_${Math.floor(s/size)}.png`;
 throw Error(`${siteId}: missing fine tile ${key}; require raw sample spacing <= ${MAX_DENSITY_RAW_SPACING_M} m`);
}
export function densityCoverage(manifest){
 const [e0,n0,e1,n1]=manifest.mid,bins={};let max=0;const step=manifest.size/256;
 for(let e=e0;e<e1;e+=step)for(let n=n0;n<n1;n+=step){
  const x=e+step/2-manifest.village[0],z=manifest.village[1]-n-step/2,E=x+manifest.village[0]-manifest.origin[0],S=z+manifest.origin[1]-manifest.village[1];
  let spacing=null;for(let l=8;l>=0;l--){const t=manifest.size/2**l;if(manifest.levels[l]?.includes(`${Math.floor(E/t)}_${Math.floor(S/t)}`)){spacing=t/256;break;}}
  const width=Math.max(0,Math.min(e+step,e1-120)-Math.max(e,e0+120)),height=Math.max(0,Math.min(n+step,n1-120)-Math.max(n,n0+120));if(!width||!height)continue;
  if(spacing===null)throw Error('Playable square has no baked coverage');bins[spacing]=(bins[spacing]??0)+width*height;max=Math.max(max,spacing);
 }
 return {maxRawSpacingM:max,areaM2ByRawSpacing:bins,maxFootprintRawSpacingM:MAX_DENSITY_RAW_SPACING_M};
}
