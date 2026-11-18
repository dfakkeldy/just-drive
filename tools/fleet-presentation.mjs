// Refresh the real HUD, minimap, vegetation and feature consumers while the picture is stopped.
export function syncPresentation(){
 const f=window.qf;const frame=f.frame??window.combinedFrame;if(typeof frame!=='function')return;
 dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true}));
 const now=performance.now();for(let i=0;i<4;i++){
  frame(now+i*100);
  f.depthMember=f.f.driven;f.depths=f.terrain.withGroundContact({y:f.f.driven.vehicle.y},()=>f.f.driven.support.wheels.map((_,n)=>f.wheelPothole(f.f.driven,n,f.terrain,f.potholeDepth,f.potholeDensity)));
  f.visual();
 }
 dispatchEvent(new KeyboardEvent('keyup',{code:'Space',key:' ',bubbles:true}));
}
