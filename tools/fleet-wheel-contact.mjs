// Test-only contact allowance: the production defect function at the physics wheel station.
// Geometry samples remain rays onto the drawn land; no physics height is used as their support.
export function wheelPothole(member,index,terrain,potholeDepth,potholeDensity){
 if(member.state!=='DRIVEN'||member.id==='trailer')return 0;
 const v=member.vehicle;
 // The bike samples defects at its centre; the four-wheel controller samples each axle station.
 const i=index<4?index:index-2,along=(i<2?1:-1)*v.spec.wheelbase/2,side=(i%2?1:-1)*(i<2?v.spec.track:v.spec.rearTrack??v.spec.track)/2;
 const station=member.id==='bike'?v:{x:v.x+Math.sin(v.heading)*along+Math.cos(v.heading)*side,z:v.z-Math.cos(v.heading)*along+Math.sin(v.heading)*side};
 const s=terrain.surfaceAt(station.x,station.z);
 if(!s||s.kind===0||s.roadDist>(member.id==='bike'?s.halfWidth:s.halfWidth-.2))return 0;
 return potholeDepth(station.x,station.z,potholeDensity(s.kind,s.washboard,s.gravel));
}
