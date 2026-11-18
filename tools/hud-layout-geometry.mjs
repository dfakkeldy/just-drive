// Shared browser/Node geometry oracle. Inputs are element rectangles, never planner formulae.
export function layoutFaults(list,w,h,needed=[],safe=null) {
 const out=[],names=new Set(list.map(b=>b[0]));
 const missing=needed.filter(n=>!names.has(n));if(missing.length)out.push('MISSING '+missing.join(' '));
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
  const [a,ax,ay,ar,ab]=list[i],[b,bx,by,br,bb]=list[j],ox=Math.min(ar,br)-Math.max(ax,bx),oy=Math.min(ab,bb)-Math.max(ay,by);
  if(ox>1&&oy>1)out.push(`${a}+${b} (${Math.round(ox)}x${Math.round(oy)})`);
 }
 const off=list.filter(([,x,y,r,b])=>x< -1||y< -1||r>w+1||b>h+1).map(b=>b[0]);
 if(off.length)out.push('OFF SCREEN '+off.join(' '));
 if(safe){const bad=list.filter(([,x,y,r,b])=>x<safe.left-.01||y<safe.top-.01||r>w-safe.right+.01||b>h-safe.bottom+.01).map(b=>b[0]);if(bad.length)out.push('INSIDE SAFE AREA '+bad.join(' '));}
 return out;
}
export function targetFaults(list,ids){return list.filter(([id,x,y,r,b])=>ids.includes(id)&&(r-x<(id==='mailButton'?64:56)-.01||b-y<(id==='mailButton'?64:56)-.01)).map(b=>'SMALL TARGET '+b[0]);}
