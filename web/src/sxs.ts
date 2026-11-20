import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SPEC, deepFreeze, type Rig, type VehicleSpec } from './vehicle-spec';

/** Light all-wheel-drive sport buggy. No surface or vehicle-type exceptions in the controller. */
export const SXS_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC, wheelbase: 2.6, track: 1.49, wheelRadius: .405,
  contactPlane: 1, halfLength: 1.71, halfWidth: .915, height: 1.75, mass: 790,
  // One radius, with body rows and wheel-centred circles: covered tyre corners without long centreline caps.
  envelope: { circles: [-1.27,-.92,-.57,-.22,.13,.48,.83,1.18,1.33, -1.27,-.92,-.57,-.22,.13,.48,.83,1.18,1.33, 1.3,1.3,-1.3,-1.3],
    circleSides: [-.2,-.2,-.2,-.2,-.2,-.2,-.2,-.2,-.2, .2,.2,.2,.2,.2,.2,.2,.2,.2, -.745,.745,-.745,.745], radius: .44, reach: 3.3, sweepHalfWidth: 1.14, sweepHalfLength: 1.76, overhead: 1.8, grassHalfWidth: 1.32, grassHalfLength: 2.2, nose: 2.55 },
  // 155 km/h on firm dirt, with the same low-speed acceleration limit.
  engineAcceleration: 6.6, enginePower: 229, tractionShare: 2.2, aeroDrag: .0024,
  brake: 10.2, handbrake: 6.2, cornering: 1.45, maxSteer: .56,
  steerBaseRate: .85, steerSpeedRate: 2.7, steerReturnRate: 4.5, gripLock: 1.12,
  lateralInertia: 1.0, landingForward: .985, landingSideways: .8,
  pitchGain: .004, pitchLimit: .045, rollGain: .006, rollLimit: .065, leanRate: 5,
  shakePitch: .004, shakeRoll: .006, shakeHeight: .008,
  washboardYaw: .002, washboardSideways: .055, hardSteerDrag: 1.8,
  // The drift toy: low speeds to start, wide angles, a quick tail and little speed lost.
  drift: { angle: .55, maxAngle: .95, rotate: 4.5, carve: 1.25, scrub: .42, looseSpeed: 6, firmSpeed: 11, liftSpeed: 11, towed: .5 },
  chase: { back: 6.3, height: 2.35, lookAhead: 3.9, lookHeight: .95, speedBack: .095, maxSpeedBack: 3.5 },
});
type P = [number, number, number];

/** Non-indexed suspension batches: update face normals in existing buffers, with no scratch-object allocation. */
function updateTravelNormals(g:THREE.BufferGeometry):void {
  const p=g.attributes.position,n=g.attributes.normal;
  for(let i=0;i<p.count;i+=3){
    const ax=p.getX(i+1)-p.getX(i),ay=p.getY(i+1)-p.getY(i),az=p.getZ(i+1)-p.getZ(i);
    const bx=p.getX(i+2)-p.getX(i),by=p.getY(i+2)-p.getY(i),bz=p.getZ(i+2)-p.getZ(i);
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,length=Math.hypot(nx,ny,nz)||1;
    n.setXYZ(i,nx/length,ny/length,nz/length);n.setXYZ(i+1,nx/length,ny/length,nz/length);n.setXYZ(i+2,nx/length,ny/length,nz/length);
  }
  n.needsUpdate=true;
}

/** Original faceted nose, open cockpit and exposed long-travel running gear. Forward is -Z. */
export function createSxs(_mailTrim = true, options?: { low?: boolean; removableRider?: boolean; display?: boolean }): Rig {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  root.name = 'Sport side by side'; body.name = 'Sprung cage and cockpit';
  const low = options?.low ?? false;
  const display = options?.display ?? false;
  const mat = (name: string, color: number, roughness: number, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); m.name = name; return m;
  };
  const paint = mat('Obsidian enamel', 0x171e24, .23, .48);
  const rubber = mat('Graphite rubber and upholstery', 0x20262a, .88);
  const accent = mat('Hot orange', 0xff5e08, .31, .3);
  const alloy = mat('Machined graphite', 0x3e4b54, .27, .8);
  const white = mat('Ice LED', 0xd7efff, .18); white.emissive.setHex(0xc4eaff); white.emissiveIntensity = 1.8;
  const red = mat('Tail lamp', 0xb20817, .22); red.emissive.setHex(0xff1523); red.emissiveIntensity = .35;
  const visor = mat('Smoke visor', 0x142c39, .12, .85);
  // A tiny generated sky/ground reflection also works in the isolated preview. No downloaded art.
  const env = new THREE.CubeTexture(); env.images = Array.from({ length: 6 }, (_, face) => {
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const sky = face === 2 || (face !== 3 && y < 18), stripe = sky && x > 18 && x < 25;
      const c = stripe ? [235, 241, 237] : sky ? [116, 155, 180] : [65, 72, 56];
      data.set([...c, 255], (y * 32 + x) * 4);
    }
    const t = new THREE.DataTexture(data, 32, 32); t.needsUpdate = true; return t;
  }); env.needsUpdate = true; env.colorSpace = THREE.SRGBColorSpace;
  for (const m of [paint, alloy, visor, accent]) { m.envMap = env; m.envMapIntensity = 1.1; }
  const batches = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  function add(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = body, weight?: (x: number, y: number, z: number) => number) {
    let bucket = batches.get(parent); if (!bucket) { bucket = new Map(); batches.set(parent, bucket); }
    const list = bucket.get(m) ?? []; bucket.set(m, list);
    const geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose(); geo.deleteAttribute('uv');
    if(parent.name.includes('coil-over')) {
      const p=geo.attributes.position,weights=new Float32Array(p.count);
      for(let i=0;i<p.count;i++)weights[i]=weight?weight(p.getX(i),p.getY(i),p.getZ(i)):THREE.MathUtils.clamp((Math.abs(p.getX(i))-.30)/.445,0,1);
      geo.setAttribute('travelWeight',new THREE.BufferAttribute(weights,1));
    }
    list.push(geo);
  }
  function box(at: P, size: P, m: THREE.Material, parent = body, rx = 0) {
    const g = new THREE.BoxGeometry(...size); g.rotateX(rx).translate(...at); add(g, m, parent);
  }
  function rod(a: P, b: P, r: number, m: THREE.Material, parent = body, sides = 8, weight?: (x: number, y: number, z: number) => number) {
    if(display)sides=Math.min(4,sides);
    const v = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const g = new THREE.CylinderGeometry(r, r, v.length(), sides);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
    g.translate((a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2); add(g, m, parent, weight);
  }
  function ball(at: P, scale: P, m: THREE.Material, parent = body) {
    const g = new THREE.SphereGeometry(1, display ? 6 : low ? 8 : 16, display ? 4 : low ? 5 : 10); g.scale(...scale).translate(...at); add(g, m, parent);
  }
  // Closed crown panel from cross sections: x across, y up, z along. Side bevels catch sunlight.
  function shell(sections: { z: number; w: number; y: number; crown: number; bottom: number }[], m: THREE.Material, offsetX = 0) {
    const vertices: number[] = [], index: number[] = [];
    for (const s of sections) for (const [x,y] of [[-s.w,s.y],[0,s.y+s.crown],[s.w,s.y],[s.w*.85,s.bottom],[-s.w*.85,s.bottom]]) vertices.push(x+offsetX,y,s.z);
    for (let j=0;j<sections.length-1;j++) for(let i=0;i<5;i++) { const a=j*5+i,b=j*5+(i+1)%5; index.push(a,b,a+5,b,b+5,a+5); }
    for(let i=1;i<4;i++) { index.push(0,i+1,i); const a=(sections.length-1)*5; index.push(a,a+i,a+i+1); }
    // Cross sections run clockwise in XY. Reverse their joined skin and caps so all faces point out.
    for(let i=0;i<index.length;i+=3){const a=index[i];index[i]=index[i+2];index[i+2]=a;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(index);const flat=g.toNonIndexed();g.dispose();flat.computeVertexNormals();add(flat,m);
  }
  shell([{z:-1.64,w:.46,y:.72,crown:.045,bottom:.56},{z:-1.33,w:.59,y:.87,crown:.085,bottom:.57},{z:-.65,w:.53,y:.91,crown:.06,bottom:.56}],paint);
  shell([{z:-.68,w:.52,y:.54,crown:.015,bottom:.38},{z:.72,w:.58,y:.59,crown:.02,bottom:.38},{z:1.56,w:.48,y:.68,crown:.045,bottom:.48}],paint);
  // Skid pan, rear power unit and short ribbed cargo tray.
  box([0,.395,0],[.86,.03,1.70],alloy);
  box([0,.70,1.12],[.84,.055,.72],rubber);
  for(let i=0;i<7;i++)box([-.36+i*.12,.738,1.10],[.025,.025,.65],alloy);
  for(const s of [-1,1]) {
    rod([s*.48,.45,-1.1],[s*.55,.5,1.4],.037,paint);
    rod([s*.55,.56,-.76],[s*.59,.53,.6],.03,accent);
    // Sculpted half doors have a rising shoulder and an inset accent spear, never a flat rectangle.
    const sh=new THREE.Shape(); sh.moveTo(-.66,.57);sh.lineTo(-.53,.88);sh.lineTo(.48,.97);sh.lineTo(.72,.65);sh.lineTo(.47,.52);sh.closePath();
    const g=new THREE.ExtrudeGeometry(sh,{depth:.035,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.018,bevelThickness:.012});
    g.rotateY(-Math.PI/2).translate(.57,0,0);
    if(s<0){g.scale(-1,1,1);const ix=g.index;if(ix)for(let i=0;i<ix.count;i+=3){const a=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,a);}else {const n=g.attributes.position.count;g.setIndex(Array.from({length:n},(_,i)=>Math.floor(i/3)*3+2-i%3));}}
    add(g,paint);
    rod([s*.611,.66,-.49],[s*.611,.81,.40],.018,accent);
    rod([s*.62,.88,.28],[s*.62,.89,.43],.012,alloy);
    // Open tubular cage: swept front pillars, roof rails, rear stays and triangulation.
    rod([s*.54,.53,-.73],[s*.57,1.13,-.68],.028,paint);
    rod([s*.57,1.13,-.68],[s*.49,1.69,-.34],.03,paint);
    rod([s*.49,1.69,-.34],[s*.49,1.69,.61],.03,paint);
    rod([s*.49,1.69,.61],[s*.58,.55,.83],.032,paint);
    rod([s*.49,1.5,.67],[s*.49,.75,1.48],.028,paint);
    rod([s*.49,1.52,.65],[-s*.51,.62,.83],.022,paint);
    // Floating front fender blades leave the suspension fully visible below.
    shell([{z:-1.62,w:.06,y:.90,crown:.02,bottom:.86},{z:-1.20,w:.075,y:.99,crown:.025,bottom:.94},{z:-.88,w:.05,y:.93,crown:.01,bottom:.89}],paint,s*.78);
  }
  // Thin crowned roof, inset centre ridge and light bar socket.
  shell([{z:-.40,w:.51,y:1.70,crown:.035,bottom:1.675},{z:.12,w:.535,y:1.715,crown:.035,bottom:1.68},{z:.67,w:.51,y:1.70,crown:.03,bottom:1.675}],paint);
  for(const z of [-.34,.61])rod([-.49,1.69,z],[.49,1.69,z],.028,paint);
  rod([-.43,1.64,-.39],[.43,1.64,-.39],.041,rubber);
  for(let i=0;i<12;i++)box([-.385+i*.07,1.65,-.43],[.047,.032,.016],white);
  // Original stepped LED signature: three tilted lozenges under each hood edge.
  for(const s of [-1,1]) {
    rod([s*.29,.77,-1.64],[s*.51,.82,-1.52],.05,rubber);
    for(let i=0;i<3;i++)rod([s*(.30+i*.075),.785+i*.015,-1.682+i*.035],[s*(.345+i*.075),.802+i*.015,-1.66+i*.035],.015,white,body,6);
    rod([s*.56,.5,-1.56],[s*.46,.59,-1.68],.034,paint);


  }
  rod([-.46,.59,-1.68],[.46,.59,-1.68],.034,paint);
  rod([-.48,.53,1.58],[.48,.53,1.58],.03,paint);
  box([0,.49,-1.60],[.54,.23,.045],alloy,body,-.36);
  for(let i=0;i<5;i++)box([-.20+i*.10,.68,-1.651],[.05,.065,.014],rubber);
  box([0,.80,1.52],[.83,.055,.055],rubber);box([0,.807,1.553],[.76,.021,.012],red);
  // Deep bucket seats, shoulder bolsters, harness slots and bright four-point belts.
  for(const x of [-.29,.29]) {
    ball([x,.58,.17],[.23,.075,.28],rubber);
    ball([x,.88,.42],[.22,.36,.10],rubber);
    for(const dx of [-.18,.18]) {ball([x+dx,.77,.30],[.07,.21,.11],rubber);rod([x+dx*.5,1.08,.32],[x+dx*.25,.63,.07],.017,accent);}
    ball([x,1.18,.46],[.145,.14,.085],rubber);
    box([x,.65,.08],[.08,.036,.05],alloy);
    for(const dx of [-.07,.07])box([x+dx,1.14,.364],[.06,.025,.015],alloy);
  }
  shell([{z:-.69,w:.50,y:.97,crown:.02,bottom:.85},{z:-.48,w:.48,y:.91,crown:.02,bottom:.82}],rubber);
  box([.04,.949,-.468],[.17,.095,.015],visor,body,-.15);
  box([.04,.947,-.455],[.11,.012,.005],white);
  rod([-.29,.78,-.59],[-.29,.94,-.30],.025,alloy);
  const steering=new THREE.TorusGeometry(.135,.014,6,28);steering.rotateX(-.4).translate(-.29,.96,-.27);add(steering,rubber);
  rod([-.41,.96,-.27],[-.17,.96,-.27],.012,alloy);
  rod([-.29,.96,-.27],[-.29,.85,-.224],.012,alloy);
  // Generic helmeted driver, no face or text. Keep the eyes' forward view clear of the helmet shell.
  const rider = options?.removableRider ? new THREE.Group() : body;
  if (rider !== body) { rider.name = 'Removable driver'; body.add(rider); }
  ball([-.29,.84,.19],[.15,.23,.105],rubber,rider);
  for(const s of [-1,1]) {rod([-.29+s*.10,.93,.16],[-.29+s*.16,.84,-.08],.045,rubber,rider);rod([-.29+s*.16,.84,-.08],[-.29+s*.10,.95,-.26],.035,rubber,rider);}
  for(const dx of [-.075,.075]) {
    rod([-.29+dx,.65,.12],[-.29+dx,.56,-.24],.052,rubber,rider);
    rod([-.29+dx,.56,-.24],[-.29+dx,.44,-.52],.043,rubber,rider);
  }
  ball([-.29,1.20,.18],[.14,.165,.145],accent,rider);
  ball([-.29,1.23,.055],[.12,.067,.035],visor,rider);
  const driverEye=new THREE.Object3D();driverEye.name='Left helmet eye';driverEye.position.set(-.29,1.24,.002);body.add(driverEye);
  // Helmet is behind the eye so the driver camera never sees its inside surface.
  const wheelParents: THREE.Group[]=[];
  function wheel(x:number,z:number,spare=false) {
    const pivot=new THREE.Group(),spin=new THREE.Group();root.add(pivot);pivot.position.set(x,0,z);spin.position.y=.405;pivot.add(spin);
    const profile=[[.205,-.145],[.29,-.165],[.366,-.148],[.39,-.105],[.39,.105],[.366,.148],[.29,.165],[.205,.145]].map(p=>new THREE.Vector2(...p as [number,number]));
    const tyre=new THREE.LatheGeometry(profile,display?12:low?16:32);tyre.rotateZ(Math.PI/2);add(tyre,rubber,spin);
    // Display tyres keep the same tread footprint as the controller at every wheel phase.
    for(let i=0;i<28;i++)for(const side of [-1,1]) {
      const a=i*Math.PI*2/28+(side>0?.04:0),g=new THREE.BoxGeometry(.135,.028,.068);
      g.rotateY(side*.32).translate(side*.071,.39,0).rotateX(a);add(g,rubber,spin);
    }
    const sign=Math.sign(x)||1,face=sign*.157;
    const ring=new THREE.TorusGeometry(.219,.015,6,32);ring.rotateY(Math.PI/2).translate(face,0,0);add(ring,alloy,spin);
    const hub=new THREE.CylinderGeometry(.065,.065,.24,12);hub.rotateZ(Math.PI/2);add(hub,alloy,spin);
    for(let i=0;i<(display?4:8);i++) { const a=i*Math.PI/(display?2:4);
      rod([face,.055*Math.cos(a),.055*Math.sin(a)],[face,.205*Math.cos(a+.12),.205*Math.sin(a+.12)],.025,alloy,spin,6);
      if(!low)ball([face+sign*.009,.219*Math.cos(a),.219*Math.sin(a)],[.009,.009,.009],alloy,spin);
    }
    if(!spare)wheelParents.push(pivot);return {pivot,spin};
  }
  const fl=wheel(-.745,-1.3),fr=wheel(.745,-1.3),rl=wheel(-.745,1.3),rr=wheel(.745,1.3);
  const spare=wheel(0,0,true);root.remove(spare.pivot);body.add(spare.pivot);spare.pivot.position.set(0,.93,1.08);spare.spin.position.y=0;spare.pivot.rotation.z=Math.PI/2;
  // Suspension geometry has its own two merged draws per corner. Link endpoints deform with wheel travel.
  const suspension: THREE.Group[]=[];
  for(let i=0;i<4;i++) {
    const s=i%2?1:-1,z=i<2?-1.3:1.3,parent=new THREE.Group();parent.name=i<2?'Double A arms and coil-over':'Trailing links and coil-over';root.add(parent);suspension.push(parent);
    if(i<2)for(const y of [.37,.59])for(const dz of [-.23,.23])rod([s*.28,y,z+dz],[s*.745,y-.045,z],.019,accent,parent);
    else for(const dx of [.25,.43])rod([s*dx,.44,.45],[s*.745,.37,z],.028,accent,parent);
    rod([s*.745,.33,z],[s*.745,.60,z],.029,alloy,parent);
    const a=i<2?new THREE.Vector3(s*.57,1.18,z-.05):new THREE.Vector3(s*.37,1.02,z+.13),b=new THREE.Vector3(s*.72,.43,z),axis=b.clone().sub(a),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.clone().normalize());
    if(i<2){rod([s*.48,.58,z+.22],a.toArray() as P,.027,paint);rod([s*.40,.56,z-.15],a.toArray() as P,.024,paint);}
    const shockWeight=(_x:number,y:number,_z:number)=>THREE.MathUtils.clamp((a.y-y)/(a.y-b.y),0,1);
    rod(a.toArray() as P,b.toArray() as P,.031,alloy,parent,8,shockWeight);
    const path=Array.from({length:137},(_,j)=>{const t=j/136,angle=t*9*Math.PI*2;return new THREE.Vector3(.055*Math.cos(angle),axis.length()*(.1+t*.75),.055*Math.sin(angle)).applyQuaternion(q).add(a);});
    if(!display)add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),low?48:136,.009,low?4:5,false),accent,parent,shockWeight);
  }
  const whip=new THREE.Group();whip.position.set(.44,.77,1.42);body.add(whip);
  rod([0,0,0],[0,.94,.01],.007,alloy,whip,5);
  const flag=new THREE.Shape();flag.moveTo(0,.74);flag.lineTo(.23,.83);flag.lineTo(0,.93);flag.closePath();
  const flagGeo=new THREE.ExtrudeGeometry(flag,{depth:.005,bevelEnabled:false});add(flagGeo,accent,whip);
  // Flush one geometry per material under each animated parent.
  const brakeLights: THREE.Mesh[]=[];
  for(const [parent,bucket]of batches)for(const [m,parts]of bucket){
    const g=mergeGeometries(parts);if(!g)throw Error('Side by side material batch failed');g.normalizeNormals();
    const mesh=new THREE.Mesh(g,m);mesh.name=m.name;mesh.castShadow=true;parent.add(mesh);if(m===red)brakeLights.push(mesh);for(const p of parts)p.dispose();
  }
  for(const parent of suspension)for(const mesh of parent.children){if(mesh instanceof THREE.Mesh){mesh.geometry.computeBoundingSphere();mesh.geometry.boundingSphere!.radius+=.7;}}
  const deform=suspension.map(parent=>parent.children.filter((n):n is THREE.Mesh=>n instanceof THREE.Mesh).map(mesh=>({mesh,base:Float32Array.from(mesh.geometry.attributes.position.array),weights:mesh.geometry.attributes.travelWeight})));
  const bodyPoint=new THREE.Vector3();
  let compression=0,lastSpin=0,phase=0;
  const rig:Rig={root,body,wheels:{fl:fl.spin,fr:fr.spin,rl:rl.spin,rr:rr.spin},steer:{fl:fl.pivot,fr:fr.pivot},driverEye,brakeLights,
    ...(rider !== body ? { setRiderVisible(visible:boolean) { rider.visible=visible; } } : {}),
    checkpointPose(){const c=compression,s=lastSpin,p=phase;return()=>{compression=c;lastSpin=s;phase=p;};},
    // Hot path: no arrays, closures or new objects. Geometry, normals, bounds and scratch vectors are preallocated.
    setTravel(a,b,c,d){
      for(let i=0;i<4;i++) {
        const travel=THREE.MathUtils.clamp(i===0?a:i===1?b:i===2?c:d,-.22,.24);
        const bodyOffset=body.position.y + bodyPoint.set((i%2?1:-1)*.745,0,(i<2?-1:1)*1.3).applyEuler(body.rotation).y;
        wheelParents[i].position.y=travel+bodyOffset;
        for(let part=0;part<deform[i].length;part++){
          const {mesh,base,weights}=deform[i][part];
          const p=mesh.geometry.attributes.position;
          for(let j=0;j<p.count;j++){const weight=weights.getX(j);p.setXYZ(j,base[j*3],base[j*3+1]+bodyOffset+travel*weight,base[j*3+2]);}
          p.needsUpdate=true;mesh.geometry.boundingBox=null;updateTravelNormals(mesh.geometry);
        }
      }
      compression=(a+b+c+d)/4;
      const spin=fl.spin.rotation.x,delta=Math.abs(spin-lastSpin);lastSpin=spin;phase+=Math.min(delta,.5);
      whip.rotation.z=Math.sin(phase*.65)*Math.min(.13,delta*.65)+compression*.12;whip.rotation.x=Math.min(.18,delta*.8);
    },
  };
  return rig;
}
