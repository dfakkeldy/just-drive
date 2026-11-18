// Shared Node/browser witnesses. sampleGameRide is serialized into the parent-run page.
export function sampleGameRide(m) {
  const mp=m.mp.current;if(!mp)return null;
  const local=mp.host.vehicle,ride=mp.host.ride?.(),told=mp.net.told;
  const own={local:{x:local.x,z:local.z,heading:local.heading},localRide:ride,sentRide:mp.net.sentRide,
    sentPose:told&&{x:told.x,z:told.z,heading:told.heading}};
  // A sender can report before its backgrounded partner draws. Do not make source progress depend on peer readiness.
  if(mp.net.count!==1||mp.ghosts.drawn!==1)return {ready:false,...own};
  const peer=mp.net.views(performance.now())[0],body=mp.ghosts.group.children[0],labels=mp.ghosts.group.children[1];
  if(!peer||body.count!==1||labels.count!==1)return {ready:false,...own};
  const mat=body.instanceMatrix.array;
  return {ready:true,...own,peer:{x:peer.x,z:peer.z,heading:peer.heading},
    distance:Math.hypot(peer.x-local.x,peer.z-local.z),drawnDistance:Math.hypot(mat[12]-local.x,mat[14]-local.z),
    cameraDistance:Math.hypot(peer.x-m.camera.position.x,peer.z-m.camera.position.z),
    ride:peer.ride,alpha:peer.alpha,fade:body.geometry.attributes.fade.getX(0),labelFade:labels.geometry.attributes.fade.getX(0),
    influences:Array.from(body.morphTexture.image.data).slice(0,6),label:peer.name,
  };
}
export function rideWasReported(sample, expectedRide) {
  return !!sample?.sentPose && Math.hypot(sample.sentPose.x-sample.local.x,sample.sentPose.z-sample.local.z)<.02
    && Math.abs(Math.atan2(Math.sin(sample.sentPose.heading-sample.local.heading),Math.cos(sample.sentPose.heading-sample.local.heading)))<.001
    && sample.sentRide?.kind===expectedRide.kind && sample.sentRide?.trailer===expectedRide.trailer;
}
export function rideHasSettled(sample, expected) {
  const morph={car:1,truck:expected.ride.trailer?3:2,sxs:4,bike:5}[expected.ride.kind];
  return !!sample?.ready && sample.ride?.kind===expected.ride.kind && sample.ride?.trailer===expected.ride.trailer
    && sample.influences?.[morph]===1
    && Math.abs(sample.distance-expected.distance)<.1 && Math.abs(sample.drawnDistance-expected.distance)<.1
    && Math.abs(sample.fade - expected.fade) <= .005 && sample.alpha>.999 && sample.labelFade>.99;
}
