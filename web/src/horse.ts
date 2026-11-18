import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deepFreeze, CAR_SPEC, type Rig, type VehicleSpec } from './vehicle-spec';
import { gaitAt, hoofCycle, strideAdvance, contactTravel } from './horse-motion';

export const HORSE_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC, hitch: undefined, locomotion: 'horse',
  wheelbase: 1.5, track: .52, wheelRadius: .12, contactPlane: 1,
  halfLength: 1.65, halfWidth: .48, height: 2.95, mass: 590,
  envelope: { circles: [-.8, 0, .85], radius: .48, reach: 2.4, sweepHalfWidth: .48, sweepHalfLength: 1.55,
    overhead: 2.85, grassHalfWidth: .5, grassHalfLength: 1.5, nose: 2.1 },
  engineAcceleration: 2.4, enginePower: 34, tractionShare: .95,
  reverseSpeed: 1.2, reverseAcceleration: 1.5, brake: 5.5, handbrake: 6, aeroDrag: .003,
  cornering: 1.1, maxSteer: .85, steerBaseRate: 1.4, steerSpeedRate: 3, steerSpeedScale: 4, steerReturnRate: 4,
  gripLock: .72, pitchGain: 0, rollGain: .003, rollLimit: .035, leanRate: 9,
  shakePitch: 0, shakeRoll: 0, shakeHeight: 0, washboardYaw: 0, washboardSideways: 0,
  chase: { back: 6.2, height: 3.4, lookAhead: 1.8, lookHeight: 1.8, speedBack: .07, maxSpeedBack: 1 },
});

export interface HorseRig extends Rig { onFootfall?: (leg: number) => void; phase: number; resetPose(): void; audit: {groundQueries:number;landings:number} }

/** All art is geometry. The moving leg chains end at individually sampled ground contacts. */
export function createHorse(): HorseRig {
  const root = new THREE.Group(), body = new THREE.Group(); root.name = 'Saddle horse'; root.add(body);
  const coat = new THREE.MeshStandardMaterial({ color: 0x844329, roughness: .94, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x231b18, roughness: 1, flatShading: true });
  const leather = new THREE.MeshStandardMaterial({ color: 0x453024, roughness: 1, flatShading: true });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x777e79, roughness: 1, flatShading: true });
  const pants = new THREE.MeshStandardMaterial({ color: 0x383d44, roughness: 1, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xbb9272, roughness: 1, flatShading: true });
  const cream = new THREE.MeshStandardMaterial({ color: 0xc5b28c, roughness: 1, flatShading: true });
  const ball = new THREE.IcosahedronGeometry(1, 1), box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  }
  const axis = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3();
  function link(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, width: number, depth = width) {
    delta.subVectors(b, a); m.position.copy(a).add(b).multiplyScalar(.5);
    m.scale.set(width, delta.length(), depth); m.quaternion.setFromUnitVectors(axis, delta.normalize());
  }
  mesh(body, ball, coat, 0, 1.35, 0, .39, .48, .98);
  mesh(body, ball, coat, 0, 1.38, -.65, .36, .49, .4);
  mesh(body, ball, coat, 0, 1.36, .65, .4, .47, .43);
  // Saddle blanket, seat, cantle, girth and small saddle bags.
  mesh(body, box, cream, 0, 1.73, .12, .77, .1, .8);
  mesh(body, ball, leather, 0, 1.8, .12, .36, .12, .4);
  mesh(body, box, leather, 0, 1.87, .44, .62, .13, .1);
  mesh(body, box, leather, 0, 1.91, -.19, .55, .13, .1);
  for (const side of [-1, 1]) {
    mesh(body, box, leather, side * .385, 1.32, .07, .035, .7, .12);
    mesh(body, box, leather, side * .42, 1.53, .58, .23, .31, .39);
    mesh(body, box, cream, side * .43, 1.7, .58, .25, .035, .4);
  }
  const neck = new THREE.Group(); neck.position.set(0, 1.46, -.68); body.add(neck);
  const n = mesh(neck, ball, coat, 0, .37, -.27, .27, .66, .29); n.rotation.x = -.48;
  const head = new THREE.Group(); head.position.set(0, .65, -.52); neck.add(head);
  const skull = mesh(head, ball, coat, 0, -.1, -.12, .22, .34, .25); skull.rotation.x = -.48;
  const muzzle = mesh(head, ball, coat, 0, -.34, -.35, .18, .24, .19); muzzle.rotation.x = -.48;
  mesh(head, ball, dark, 0, -.46, -.43, .175, .13, .14);
  mesh(head, box, cream, 0, -.13, -.345, .045, .3, .012); // small blaze
  const ears = [-1, 1].map(side => {
    const ear = new THREE.Group(); ear.position.set(side * .13, .15, .04); head.add(ear);
    const m = mesh(ear, new THREE.ConeGeometry(.075, .29, 5), coat, 0, .10, 0, 1, 1, .65); m.rotation.z = -side * .17;
    mesh(head, ball, dark, side * .195, -.045, -.13, .025, .025, .025);
    mesh(head, box, leather, side * .205, -.12, -.08, .025, .45, .045);
    return ear;
  });
  const mane = new THREE.Group(); neck.add(mane);
  for (let i = 0; i < 7; i++) mesh(mane, ball, dark, 0, .08 + i * .125, .02 - i * .07, .105, .16, .13);
  mesh(head, ball, dark, 0, .13, -.16, .14, .12, .17);
  const tail = new THREE.Group(); tail.position.set(0, 1.52, .95); body.add(tail);
  const tailMesh = mesh(tail, ball, dark, 0, -.42, .19, .12, .55, .14); tailMesh.rotation.x = -.25;
  const rider = new THREE.Group(); rider.name = 'Rider'; rider.position.set(0, 1.84, .08); body.add(rider);
  mesh(rider, ball, pants, 0, .04, .02, .25, .16, .24);
  const torso = mesh(rider, box, cloth, 0, .39, .03, .4, .56, .25); torso.rotation.x = -.08;
  mesh(rider, box, leather, 0, .16, .03, .41, .045, .27);
  mesh(rider, ball, skin, 0, .82, -.02, .14, .18, .14);
  mesh(rider, new THREE.CylinderGeometry(.27, .27, .035, 12), leather, 0, .96, -.02, 1, 1, 1);
  mesh(rider, new THREE.CylinderGeometry(.15, .18, .19, 10), leather, 0, 1.06, -.02, 1, 1, 1);
  const reins: { mesh: THREE.Mesh; side: number; hand: THREE.Vector3; cheek: THREE.Vector3 }[] = [];
  for (const side of [-1, 1]) {
    const thigh = mesh(rider, cylinder, pants, side * .28, -.13, -.1, .12, .47, .13); thigh.rotation.x = -.5; thigh.rotation.z = side * -.2;
    const boot = mesh(rider, cylinder, dark, side * .37, -.48, -.04, .085, .38, .09); boot.rotation.x = .25;
    mesh(rider, box, dark, side * .37, -.67, -.1, .16, .1, .29);
    mesh(body, box, leather, side * .43, 1.35, -.1, .025, .62, .035);
    mesh(body, box, dark, side * .43, 1.02, -.1, .23, .025, .2);
    const arm = mesh(rider, cylinder, cloth, 0, 0, 0, 1, 1, 1);
    link(arm, new THREE.Vector3(side * .23, .59, .02), new THREE.Vector3(side * .27, .29, -.16), .09);
    const forearm = mesh(rider, cylinder, cloth, 0, 0, 0, 1, 1, 1);
    link(forearm, new THREE.Vector3(side * .27, .29, -.16), new THREE.Vector3(side * .16, .3, -.42), .07);
    mesh(rider, ball, skin, side * .16, .3, -.42, .06, .065, .07);
    const rein = mesh(root, cylinder, leather, 0, 0, 0, 1, 1, 1);
    reins.push({ mesh: rein, side, hand: new THREE.Vector3(), cheek: new THREE.Vector3() });
  }
  const legs = [-1, 1, -1, 1].map((side, i) => {
    const front = i < 2, x = side * .26, z = front ? -.75 : .75;
    const upper = mesh(root, cylinder, coat, 0, 0, 0, 1, 1, 1);
    const lower = mesh(root, cylinder, dark, 0, 0, 0, 1, 1, 1);
    upper.name = `Upper leg ${i}`; lower.name = `Lower leg ${i}`;
    const hoof = mesh(root, box, dark, x, .06, z, .17, .12, .23); hoof.name = `Hoof ${i}`;
    hoof.userData.planted = false;
    return { x, z, upper, lower, hoof, hip: new THREE.Vector3(), knee: new THREE.Vector3(), foot: new THREE.Vector3(),
      anchor:new THREE.Vector3(),swingStart:new THREE.Vector3(),target:new THREE.Vector3(),probe:new THREE.Vector3(Infinity,0,0),normal:new THREE.Vector3(0,1,0),orientation:new THREE.Quaternion(),landingRotation:new THREE.Quaternion(),
      cycle:{z:0,lift:0,planted:false,swing:0},planted:false,initialized:false,revision:-1,groundY:0 };
  });
  // Merge static siblings by material; only the articulated joints need separate draw calls.
  for (const group of [body, neck, head, mane, tail, rider, ...ears]) {
    const batches = new Map<THREE.Material, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
    for (const child of [...group.children]) if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
      const batch = batches.get(child.material) ?? []; batch.push(child); batches.set(child.material, batch);
    }
    for (const [material, parts] of batches) {
      const geometries = parts.map(part => { part.updateMatrix(); return (part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone()).applyMatrix4(part.matrix); });
      const geometry = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      const merged = new THREE.Mesh(geometry, material); merged.castShadow = merged.receiveShadow = true;
      group.add(merged); parts.forEach(part => group.remove(part));
    }
  }
  const driverEye = new THREE.Object3D(); driverEye.position.set(0, 2.77, -.26); body.add(driverEye);
  // Empty adapters satisfy the existing wheeled rig contract. They never draw or move the horse's legs.
  const mailOrigin = new THREE.Object3D(); mailOrigin.position.set(.32,.3,-.42); rider.add(mailOrigin);
  const wheels = { fl: new THREE.Object3D(), fr: new THREE.Object3D(), rl: new THREE.Object3D(), rr: new THREE.Object3D() };
  const steer = { fl: new THREE.Object3D(), fr: new THREE.Object3D() };
  let time = 0, previousGait = 'stand';
  const audit = {groundQueries:0,landings:0};
  const resetPose = (): void => { for (let i=0;i<4;i++) { legs[i].initialized=false;legs[i].planted=false;legs[i].revision=-1;legs[i].normal.set(0,1,0);legs[i].probe.set(Infinity,0,0); } };
  const rig: HorseRig = { root, body, wheels, steer, driverEye, brakeLights: [], mailOrigin, phase: 0, resetPose, audit };
  const world = new THREE.Vector3(), lastRoot = new THREE.Vector3(Infinity,0,0), rootPosition = new THREE.Vector3(), scaleScratch=new THREE.Vector3();
  const rootInverse=new THREE.Matrix4(), rootRotation=new THREE.Quaternion(), inverseRotation=new THREE.Quaternion(), yawRotation=new THREE.Quaternion(), normalRotation=new THREE.Quaternion();
  const yawEuler=new THREE.Euler(0,0,0,'YXZ');
  const animatedNodes=[body,neck,head,rider];
  let lastYaw=0, groundQuery: (x:number,z:number)=>number|null = ()=>null;
  function sample(leg: typeof legs[number], at: THREE.Vector3, revision: number): void {
    const y=groundQuery(at.x,at.z);audit.groundQueries++;
    if(y!==null)leg.groundY=y;
    const h0=groundQuery(at.x,at.z-.09),h1=groundQuery(at.x,at.z+.09),l=groundQuery(at.x-.07,at.z),r=groundQuery(at.x+.07,at.z);audit.groundQueries+=4;
    leg.normal.set(l!==null&&r!==null?(l-r)/.14:0,1,h0!==null&&h1!==null?(h0-h1)/.18:0).normalize();
    leg.probe.copy(at);leg.revision=revision;
  }
  const animate: NonNullable<Rig['animate']> = (dt, speed, ground, revision = 0) => {
    groundQuery=ground;time+=dt;
    root.updateMatrix();
    if(root.parent)root.matrixWorld.multiplyMatrices(root.parent.matrixWorld,root.matrix);else root.matrixWorld.copy(root.matrix);
    root.matrixWorld.decompose(rootPosition,rootRotation,scaleScratch);rootInverse.copy(root.matrixWorld).invert();inverseRotation.copy(rootRotation).invert();
    yawEuler.setFromQuaternion(rootRotation,'YXZ');const yaw=yawEuler.y;
    const turn=Number.isFinite(lastRoot.x)?Math.atan2(Math.sin(yaw-lastYaw),Math.cos(yaw-lastYaw)):0;
    if(Number.isFinite(lastRoot.x)&&rootPosition.distanceToSquared(lastRoot)>4)resetPose();
    lastRoot.copy(rootPosition);lastYaw=yaw;
    const pivot=Math.abs(speed)<.12&&dt>0?Math.abs(turn)/dt*3:0;
    const gait=pivot>.12?'walk':gaitAt(speed);
    if(gait!==previousGait){resetPose();previousGait=gait;}
    const phase=rig.phase=(rig.phase+(pivot>.12?strideAdvance(dt,pivot):strideAdvance(dt,speed)))%1;
    const stride=contactTravel(speed),direction=speed<0?-1:speed>.12?1:0;
    const wave = Math.sin(phase * Math.PI * 2), idle = gait === 'stand';
    body.position.y += idle ? Math.sin(time * 1.4) * .008 : gait === 'gallop' || gait === 'canter' ? .065 + Math.sin((phase - .55) * Math.PI * 2) * .065 : gait === 'trot' ? Math.abs(wave) * .055 : wave * .018;
    body.rotation.x += gait === 'gallop' ? Math.sin((phase - .10) * Math.PI * 2) * .075 : gait === 'canter' ? wave * .045 : wave * .012;
    body.rotation.z += idle ? Math.sin(time * .7) * .008 : 0;
    const toss = Math.max(0, Math.sin(time * .43)) ** 24;
    neck.rotation.x = idle ? -.14 * toss : gait === 'gallop' ? -.18 + wave * .07 : gait === 'canter' ? -.09 + wave * .065 : wave * (gait === 'walk' ? .065 : .025);
    head.rotation.x = idle ? -.10 * toss : -wave * .035;
    for(let i=0;i<ears.length;i++)ears[i].rotation.z=Math.sin(time*2.3+i*3)**18*.36;
    mane.rotation.x = -Math.min(1, Math.abs(speed) / 12.5) * .22;
    mane.rotation.z = Math.sin(time * 12) * Math.min(.09, Math.abs(speed) * .009);
    tail.rotation.x = -.15 - Math.min(1, Math.abs(speed) / 12.5) * .85 + Math.sin(time * 9) * .06;
    tail.rotation.z = Math.sin(time * (idle ? 1.1 : 4)) * .16;
    rider.position.y = 1.84 + (gait === 'trot' ? (1 - Math.cos(phase * Math.PI * 2)) * .09 : 0);
    rider.rotation.x = gait === 'gallop' ? -.32 + wave * .035 : gait === 'canter' ? -.17 + wave * .045 : gait === 'trot' ? -.06 - (1 - Math.cos(phase * Math.PI * 2)) * .04 : wave * .015;
    if (gait === 'gallop') rider.position.y += .075;
    driverEye.position.set(0, 2.77 + rider.position.y - 1.84, -.26 + rider.rotation.x * .55);
    for(let i=0;i<animatedNodes.length;i++){const node=animatedNodes[i];node.updateMatrix();node.matrixWorld.multiplyMatrices(node.parent!.matrixWorld,node.matrix);}
    for(let i=0;i<reins.length;i++){
      const rein=reins[i];rein.hand.set(rein.side*.16,.3,-.42).applyMatrix4(rider.matrixWorld).applyMatrix4(rootInverse);
      rein.cheek.set(rein.side*.18,-.22,-.20).applyMatrix4(head.matrixWorld).applyMatrix4(rootInverse);link(rein.mesh,rein.hand,rein.cheek,.012);
    }
    yawRotation.setFromAxisAngle(axis,yaw);
    for(let i=0;i<4;i++){
      const leg=legs[i],cycle=hoofCycle(gait,phase,i,leg.cycle,stride),landing=cycle.planted&&!leg.planted;
      leg.target.set(leg.x,0,leg.z-stride*.5*direction).applyMatrix4(root.matrixWorld);
      if(!leg.initialized){leg.anchor.set(leg.x,0,leg.z+cycle.z*direction).applyMatrix4(root.matrixWorld);leg.anchor.y=rootPosition.y;leg.swingStart.copy(leg.anchor);leg.groundY=rootPosition.y;}
      if(cycle.planted){
        if(landing||!leg.initialized){
          if(leg.initialized)leg.anchor.copy(leg.target);
          sample(leg,leg.anchor,revision);leg.anchor.y=leg.groundY+.006;
          normalRotation.setFromUnitVectors(axis,leg.normal);leg.landingRotation.copy(yawRotation);leg.orientation.copy(normalRotation).multiply(leg.landingRotation);
          if(leg.initialized&&dt>0){audit.landings++;rig.onFootfall?.(i);}
        }else if(leg.revision!==revision){sample(leg,leg.anchor,revision);leg.anchor.y=leg.groundY+.006;normalRotation.setFromUnitVectors(axis,leg.normal);leg.orientation.copy(normalRotation).multiply(leg.landingRotation);}
        world.copy(leg.anchor);
      }else{
        if(leg.planted)leg.swingStart.copy(leg.anchor);
        if(cycle.swing>.9&&(leg.probe.distanceToSquared(leg.target)>.0025||leg.revision!==revision))sample(leg,leg.target,revision);
        leg.target.y=leg.groundY+.006;
        const blend=cycle.swing*cycle.swing*(3-2*cycle.swing);
        world.copy(leg.swingStart).lerp(leg.target,blend);
        // Extrapolate the last measured support plane through flight; no airborne ground reads.
        world.y=(leg.revision>=0?leg.groundY-(leg.normal.x*(world.x-leg.probe.x)+leg.normal.z*(world.z-leg.probe.z))/leg.normal.y:rootPosition.y)+.006+cycle.lift;
        normalRotation.setFromUnitVectors(axis,leg.normal);leg.orientation.copy(normalRotation).multiply(yawRotation);
      }
      leg.foot.copy(world).applyMatrix4(rootInverse);
      leg.hip.set(leg.x,1.29,leg.z).applyMatrix4(body.matrix);
      const dy=leg.foot.y-leg.hip.y,dz=leg.foot.z-leg.hip.z,distance=Math.max(.001,Math.hypot(dy,dz)),bend = i < 2 ? -1 : 1;
      const offset=Math.sqrt(Math.max(.0025,.68*.68-distance*distance/4));leg.knee.copy(leg.hip).lerp(leg.foot,.5);leg.knee.y+=bend*dz/distance*offset;leg.knee.z-=bend*dy/distance*offset;
      link(leg.upper,leg.hip,leg.knee,i<2?.105:.13);link(leg.lower,leg.knee,leg.foot,.055);
      world.addScaledVector(leg.normal,.06);leg.hoof.position.copy(world).applyMatrix4(rootInverse);leg.hoof.quaternion.copy(inverseRotation).multiply(leg.orientation);
      leg.hoof.userData.planted=cycle.planted;leg.planted=cycle.planted;leg.initialized=true;
    }
  };
  rig.animate = animate;
  return rig;
}
