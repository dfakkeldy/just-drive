import * as THREE from 'three';
import { CAR_SPEC, deepFreeze, type Rig, type VehicleSpec } from './vehicle-spec';
import { TruckSurfaces, path, reverseTriangles, type Point, type Profile } from './truck-surfaces';
import { truckReflections } from './truck-reflections';

export const TRUCK_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC,
  wheelbase: 4.45, track: 1.74, rearTrack: 2.08, wheelRadius: 0.43,
  contactPlane: 1, halfLength: 3.4, halfWidth: 1.22, height: 2.08, mass: 3650,
  // Circles 0.727 m apart cover the cab (1.015 m half width) with room to spare. Over the rear axle, where the dual
  // fenders reach 1.22 m, they stand 0.24 m apart, so a post that enters the fender by 2 cm already touches. Both
  // ends are rounded, as on the car: behind the axle the cover falls to 1.14 m at the fender's tail (8 cm inside
  // its widest point), which keeps the tail of the envelope at the bumper and not past it.
  envelope: { circles: [-2.18, -1.938, -1.695, -1.453, -0.727, 0, 0.727, 1.453, 2.18], radius: 1.22, reach: 4.5, sweepHalfWidth: 1.23, sweepHalfLength: 3.41, overhead: 1.425, grassHalfWidth: 1.62, grassHalfLength: 3.9, nose: 4.3 },
  engineAcceleration: 4.2, enginePower: 122, tractionShare: 0.78,
  brake: 7.1, handbrake: 5.8, aeroDrag: 0.00115,
  maxSteer: 0.59, cornering: 1.65,
  steerBaseRate: 0.45, steerSpeedRate: 1.8, steerReturnRate: 2.6,
  pitchGain: 0.003, pitchLimit: 0.022, rollGain: 0.0035, rollLimit: 0.035,
  shakePitch: 0.008, shakeRoll: 0.011, shakeHeight: 0.016,
  washboardYaw: 0.004, washboardSideways: 0.12,
  // Heavy: slow to rotate, a narrow angle and much speed lost; a hitched trailer halves it again (towed).
  drift: { angle: .3, maxAngle: .5, rotate: 1.5, carve: 1.0, scrub: .7, looseSpeed: 10, firmSpeed: 16, liftSpeed: 17, towed: .45 },
  chase: { back: 10.8, height: 3.7, lookAhead: 4.1, lookHeight: 1.45, speedBack: 0.06, maxSpeedBack: 2.5 },
  hitch: { back: 3.4, height: 0.43 },
});


const mix = THREE.MathUtils.lerp;
const bump = (x:number,w:number) => Math.exp(-((x/w)**2));

/** Sculpted crew cab and long box. The contact coordinates and all drive parameters are independent of this skin. */
export function createTruck(_mailTrim = true, low = false): Rig {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  root.name = 'Heavy crew pickup, metres, forward -Z'; body.name = 'Suspended pickup body';
  const env = truckReflections();
  const material = (name:string,color:number,roughness:number,metalness=0) => {
    const m = new THREE.MeshStandardMaterial({color,roughness,metalness});m.name=name;return m;
  };
  const paint = new THREE.MeshPhysicalMaterial({color:0x11151a,metalness:.42,roughness:.23,clearcoat:1,clearcoatRoughness:.10,envMap:env,envMapIntensity:.90});paint.name='Black enamel';
  const trim=material('Satin graphite',0x20262b,.46,.25);
  const rubber=material('All-terrain rubber and liner',0x15191c,.94);
  const alloy=material('Dark polished alloy',0x343e48,.23,.86);alloy.envMap=env;alloy.envMapIntensity=.85;
  const cabin=material('Interior leather',0x353b40,.78);
  const glass=new THREE.MeshPhysicalMaterial({color:0x8ba3ae,roughness:.08,metalness:.08,transparent:true,opacity:.29,depthWrite:false,side:THREE.DoubleSide,envMap:env,envMapIntensity:.75,clearcoat:1});glass.name='Front glazing';glass.forceSinglePass=true;
  const privacy=glass.clone();privacy.name='Rear privacy glazing';privacy.color.setHex(0x142831);privacy.opacity=.82;privacy.envMapIntensity=1;
  const white=material('LED lenses',0xf0f6ff,.18);white.emissive.setHex(0xd9edff);white.emissiveIntensity=1.35;
  const red=material('LED tail guides',0x9b1223,.20);red.emissive.setHex(0xff1832);red.emissiveIntensity=.65;
  const amber=material('Amber markers',0xe79116,.26);amber.emissive.setHex(0xff9c12);amber.emissiveIntensity=.65;
  const mirror=material('Reflective mirrors',0x9db7c3,.07,.96);mirror.envMap=env;
  const s=new TruckSurfaces(body,low);
  const box=(at:Point,size:Point,m:THREE.Material,parent:THREE.Object3D=body,rx=0)=>s.box(at,size,m,parent,rx);
  const round=(at:Point,size:Point,m:THREE.Material,r=.035,parent:THREE.Object3D=body,rx=0)=>s.round(at,size,m,r,parent,rx);
  const tube=(points:Point[],r:number,m:THREE.Material,parent:THREE.Object3D=body,sides=6,steps=points.length*3)=>s.tube(points,r,m,parent,sides,steps);

  // Continuous side field: a strong shoulder, concave lower door crease, and fenders pressed out of the same skin.
  const belt=(z:number)=>z< -1.65?mix(1.38,1.48,THREE.MathUtils.clamp((z+3.24)/1.59,0,1)):1.49;
  const sideX=(y:number,z:number)=>{
    const door=THREE.MathUtils.smoothstep(z,-1.65,-1.45)*(1-THREE.MathUtils.smoothstep(z,.75,1.0));
    let x=.995+.027*bump(y-1.35,.16)-.052*door*bump(y-.66,.10)-.018*((y-.98)/.60)**2;
    for(const axle of [-2.225,2.225]){
      const r=Math.hypot((z-axle)/1.04,(y-.43)/1.17);
      x+=(axle>0?.29:.075)*Math.pow(Math.max(0,1-r*r),1.5);
    }
    return x;
  };
  const bottom=(z:number)=>{
    let y=.43;for(const axle of [-2.225,2.225]){const d=z-axle;if(Math.abs(d)<.50)y=Math.max(y,.43+Math.sqrt(.50**2-d*d));}return y;
  };
  for(const sign of [-1,1]){
    for(const [z0,z1,cols]of [[-3.21,.89,64],[.98,3.27,36]])s.patch((u,v)=>{const z=mix(z0,z1,u),y=mix(bottom(z),belt(z),v);return [sign*sideX(y,z),y,z];},cols,14,paint,sign<0);
    // The wheel-opening return rolls into the well; the narrow lip follows the sculpted side field.
    for(const axle of [-2.225,2.225]){
      s.patch((u,v)=>{const a=Math.PI*u,z=axle+.50*Math.cos(a),y=.43+.50*Math.sin(a);return [sign*(sideX(y,z)-v*.13),y-.018*Math.sin(v*Math.PI/2),z];},40,3,trim,sign<0);
      const lip:Point[]=Array.from({length:33},(_,i)=>{const a=Math.PI*i/32,z=axle+.515*Math.cos(a),y=.43+.515*Math.sin(a);return [sign*(sideX(y,z)+.003),y,z];});
      tube(lip,.011,paint,body,5,48);
    }
    // Fine shut lines and recessed handles sit on the curved skin, rather than on a flat side slab.
    for(const z of [-1.58,-.25,.88])tube(Array.from({length:9},(_,i)=>{const y=mix(.51,1.47,i/8);return [sign*(sideX(y,z)+.002),y,z];}),.005,rubber,body,4,12);
    for(const z of [-.48,.66]){
      round([sign*(sideX(1.35,z)+.009),1.35,z],[.024,.075,.22],trim,.018);
      round([sign*(sideX(1.36,z)+.025),1.36,z-.01],[.035,.027,.145],alloy,.011);
    }
    // Running boards have an exposed metal rail and a broad, dark non-slip tread.
    round([sign*1.025,.325,-.25],[.27,.075,2.78],alloy,.025);
    round([sign*1.035,.369,-.25],[.225,.022,2.68],rubber,.008);
    for(const z of [-1.26,.69])box([sign*.91,.42,z],[.18,.16,.075],trim);
    // A crisp shoulder catch-light follows the upper edge without becoming a bright trim stripe.
    tube(Array.from({length:18},(_,i)=>{const z=mix(-1.59,.85,i/17);return [sign*(sideX(1.46,z)+.002),1.46,z];}),.008,paint,body,4,24);
  }

  // Tall bonnet: transverse crown, a raised centre, and a smooth power blister between the two vents.
  const bonnetY=(x:number,t:number)=>1.365+.080*t+.060*(1-(x/.98)**2)+.065*Math.exp(-((x/.32)**4))*Math.sin(Math.PI*t)**2;
  const bonnetZ=(x:number,t:number)=>mix(-3.18+.12*(x/.98)**4,-1.64,t);
  s.patch((u,v)=>{const x=(u*2-1)*.98;return [x,bonnetY(x,v),bonnetZ(x,v)];},26,18,paint);
  for(const sign of [-1,1])tube(Array.from({length:13},(_,i)=>{const t=mix(.16,.90,i/12),x=sign*.36;return [x,bonnetY(x,t)+.003,bonnetZ(x,t)];}),.007,paint,body,4,24);
  const noseZ=(x:number,y:number)=>-3.32+.17*((y-.61)/.85)+.10*(Math.abs(x)/1.03)**4;
  // This casting leans back at the top and wraps behind both lamp corners.
  s.patch((u,v)=>{const x=(u*2-1)*1.025,y=mix(.63,bonnetY(x,0),v);return [x,y,mix(noseZ(x,.63),bonnetZ(x,0),v)];},28,12,paint);
  for(const sign of [-1,1]){
    const ventZ=-2.00,t=(ventZ+3.18)/1.54,ventY=bonnetY(sign*.59,t);
    round([sign*.59,ventY+.005,ventZ],[.22,.025,.43],rubber,.01);
    for(let i=0;i<6;i++)round([sign*.59,ventY+.023,ventZ-.16+i*.062],[.18,.018,.024],trim,.005);
    // Bonnet edge: a shallow folded return joins the crown to the fender shoulder.
    s.patch((u,v)=>{const z=mix(-3.07,-1.64,u),t=(z+3.18)/1.54,y=mix(belt(z),bonnetY(.98,t),v);return [sign*mix(sideX(belt(z),z),.98,v),y,z];},28,4,paint,sign<0);
  }

  // Rounded greenhouse with a raked windscreen, substantial rear pillars and an actual rear cab wall.
  const cabX=(y:number,z:number)=>1.015-.115*THREE.MathUtils.clamp((y-1.46)/.55,0,1)-.014*bump(z-.87,.15);
  const frontWindow:Profile[]=[[-1.53,1.51],[-.26,1.51],[-.26,1.95],[-.89,1.95]];
  const rearWindow:Profile[]=[[-.13,1.51],[.80,1.51],[.77,1.95],[-.13,1.95]];
  s.cab([[-1.68,1.46],[-1.015,1.96],[-.985,1.991],[-.94,2.005],[.74,2.005],[.795,1.992],[.835,1.96],[.98,1.46]],[frontWindow,rearWindow],cabX,paint);
  for(const sign of [-1,1]){s.window(frontWindow,sign,cabX,glass);s.window(rearWindow,sign,cabX,privacy);}
  // Front glazing is lightly tinted; the rear glazing is set inside an opaque surround and lower wall.
  s.patch((u,v)=>[(u*2-1)*mix(.94,.845,v),mix(1.48,1.982,v),mix(-1.65,-.965,v)+.025*(u*2-1)**2],28,14,glass);
  const rearCabZ=(x:number,y:number)=>.966-.045*((y-1.46)/.57)+.012*(1-(x/.96)**2);
  s.frame([[-.98,.62],[-.98,1.48],[-.90,2.01],[.90,2.01],[.98,1.48],[.98,.62]],[[[-.73,1.58],[.73,1.58],[.71,1.94],[-.71,1.94]]],rearCabZ,.045,paint,true);
  s.patch((u,v)=>{const x=mix(-.72,.72,u),y=mix(1.59,1.93,v);return [x,y,rearCabZ(x,y)-.013];},20,8,privacy,true);
  // The roof is crowned in both axes and rolls into the edge rails rather than ending at square box corners.
  s.patch((u,v)=>{const x=(u*2-1)*(.90-.02*(v*2-1)**2);return [x,2.008+.030*Math.sin(u*Math.PI)*Math.sin(v*Math.PI),mix(-.985,.89,v)+.045*(1-Math.sin(u*Math.PI))*(1-2*v)];},22,16,paint);
  for(const sign of [-1,1]){
    s.patch((u,v)=>{const a=v*Math.PI/2,z=mix(-.94,.84,u);return [sign*(.878+.040*Math.sin(a)),2.008-.065*(1-Math.cos(a)),z];},24,6,paint,sign>0);
    tube([[sign*.90,1.49,-1.62],[sign*.91,1.50,-.5],[sign*.91,1.50,.85]],.013,rubber,body,5,14);
  }
  for(const z of [-.97,.89])tube([[-.86,1.993,z],[0,2.016,z],[.86,1.993,z]],.023,paint,body,6,16);
  for(const x of [-.48,.38])tube([[x-.25,1.494,-1.646],[x+.08,1.513,-1.62]],.009,trim,body,5,6);

  // Five fine clearance lamps have dark sculpted bases, small amber lenses and no lettering.
  for(const x of [-.65,-.325,0,.325,.65]){
    round([x,2.028,-.82],[.087,.028,.145],trim,.011);
    round([x,2.049,-.845],[.066,.020,.075],amber,.009);
  }
  for(const sign of [-1,1]){
    for(const y of [1.49,1.61])tube([[sign*.98,y,y>1.55?-1.46:-1.50],[sign*1.20,y+.035,-1.46]],.019,trim,body,6,7);
    round([sign*1.265,1.65,-1.46],[.19,.31,.15],trim,.035);
    round([sign*1.265,1.66,-1.379],[.151,.235,.013],mirror,.012);
    round([sign*1.265,1.65,-1.541],[.13,.025,.014],amber,.008);
  }

  // Long box. The flares above are part of the continuous outer skin; these are its inner tubs and rail caps.
  box([0,.82,2.10],[1.88,.10,2.25],rubber);
  for(let i=0;i<15;i++)round([-.84+i*.12,.877,2.10],[.031,.016,2.10],trim,.005);
  for(const sign of [-1,1]){
    round([sign*.80,1.01,2.225],[.31,.28,1.02],rubber,.055);
    box([sign*.94,1.17,2.12],[.075,.61,2.28],rubber);
    tube(Array.from({length:26},(_,i)=>{const z=mix(1.0,3.28,i/25);return [sign*sideX(1.49,z),1.50,z];}),.028,trim,body,6,36);
  }
  round([0,1.18,1.02],[1.88,.60,.085],paint,.025);
  const tailZ=(x:number,y:number)=>3.275-.045*(x/1.02)**4+.022*bump(y-1.42,.16);
  s.patch((u,v)=>{const x=(u*2-1)*1.01,y=mix(.69,1.49,v);return [x,y,tailZ(x,y)];},24,14,paint,true);
  // Rolled tailgate crown and a shallow spoiler lip make a controlled, wide rear highlight.
  s.patch((u,v)=>{const x=(u*2-1)*1.01,a=v*Math.PI/2;return [x,1.49+.050*Math.sin(a)+.012*(1-(x/1.01)**2),3.247+.068*(1-Math.cos(a))];},28,6,paint,true);
  round([0,1.55,3.29],[1.98,.028,.105],trim,.013);
  round([0,1.38,3.306],[.245,.075,.026],rubber,.02);
  round([0,1.387,3.324],[.15,.026,.025],alloy,.01);
  for(const sign of [-1,1]){
    round([sign*.89,1.18,3.29],[.25,.64,.075],trim,.035);
    for(const dx of [-.073,.073])round([sign*.89+dx,1.18,3.335],[.021,.51,.018],red,.010);
    for(const y of [.94,1.42])round([sign*.89,y,3.337],[.13,.021,.018],red,.010);
    for(let j=0;j<3;j++)round([sign*.89-.047+j*.047,1.09,3.346],[.025,.035,.014],white,.006);
    round([sign*.99,.79,3.25],[.025,.047,.105],amber,.009);
  }
  round([0,1.98,.94],[.37,.032,.027],red,.012);

  // Wraparound front bumper, a separate lower intake, fog LEDs, two tow eyes and a recessed skid plate.
  s.patch((u,v)=>{const x=(u*2-1)*1.06;return [x,mix(.34,.70,v)+.025*(x/1.06)**2,-3.36+.10*(x/1.06)**4+.025*Math.sin(v*Math.PI)];},36,8,trim);
  round([0,.53,-3.378],[1.20,.215,.028],rubber,.035);
  for(const y of [.49,.56])round([0,y,-3.397],[1.08,.015,.022],alloy,.006);
  for(const sign of [-1,1]){
    round([sign*.84,.565,-3.335],[.29,.092,.065],rubber,.025);
    for(let i=0;i<3;i++)round([sign*.84-.075+i*.075,.573,-3.373],[.048,.027,.016],white,.007);
    tube([[sign*.59,.47,-3.36],[sign*.59,.41,-3.43],[sign*.47,.41,-3.43],[sign*.47,.47,-3.36]],.024,alloy,body,7,12);
  }
  round([0,.333,-3.09],[1.04,.045,.46],alloy,.015,body,-.13);
  // Rear steps wrap around the corners, with a lower centre for the blank plate and receiver.
  s.patch((u,v)=>{const x=(u*2-1)*1.08;return [x,mix(.43,.67,v),3.36-.065*(x/1.08)**4+.026*Math.sin(v*Math.PI)];},36,8,trim,true);
  for(const sign of [-1,1]){
    round([sign*.83,.695,3.29],[.39,.045,.27],trim,.018);
    round([sign*.83,.723,3.29],[.32,.012,.21],rubber,.006);
    round([sign*.95,.50,3.371],[.14,.035,.018],red,.008);
  }
  round([0,.64,3.394],[.41,.145,.018],alloy,.008);
  const receiver=path([[-.061,-.061],[-.061,.061],[.061,.061],[.061,-.061]]);
  receiver.holes.push(new THREE.Path([new THREE.Vector2(-.041,-.041),new THREE.Vector2(.041,-.041),new THREE.Vector2(.041,.041),new THREE.Vector2(-.041,.041)]));
  const rg=new THREE.ExtrudeGeometry(receiver,{depth:.16,bevelEnabled:false});rg.translate(0,.43,3.285);s.add(rg,alloy);
  box([0,.429,3.36],[.070,.060,.18],trim);
  round([0,.457,3.455],[.115,.025,.12],alloy,.008);
  const ball=new THREE.SphereGeometry(.052,16,10);ball.translate(0,.515,3.46);s.add(ball,alloy);
  for(const sign of [-1,1])tube([[sign*.22,.40,3.27],[sign*.22,.34,3.40],[sign*.12,.34,3.43],[sign*.12,.40,3.30]],.021,alloy,body,7,12);

  // A broad, slightly swept hexagonal grille. Every shared hex edge is emitted once.
  const grille:Profile[]=[[-.60,.81],[-.71,.91],[-.71,1.27],[-.61,1.355],[.61,1.355],[.71,1.27],[.71,.91],[.60,.81]];
  const opening:Profile[]=grille.map(([x,y])=>[x*.92,1.085+(y-1.085)*.90]);
  s.frame(grille,[opening],(x,y)=>noseZ(x,y)-.047,.035,trim);
  s.patch((u,v)=>{const x=mix(-.655,.655,u),y=mix(.84,1.32,v);return [x,y,noseZ(x,y)-.040];},24,12,rubber);
  const edges=new Set<string>(),R=.057;
  for(let col=-7;col<=7;col++)for(let row=-3;row<=3;row++){
    const cx=col*1.5*R,cy=1.08+(row+(Math.abs(col)%2)*.5)*Math.sqrt(3)*R;
    const vertices=Array.from({length:6},(_,i)=>[cx+R*Math.cos(i*Math.PI/3),cy+R*Math.sin(i*Math.PI/3)]);
    if(vertices.some(([x,y])=>Math.abs(x)>.648||y<.85||y>1.315))continue;
    for(let i=0;i<6;i++){
      const [ax,ay]=vertices[i],[bx,by]=vertices[(i+1)%6],keys=[[ax,ay],[bx,by]].map(p=>p.map(n=>Math.round(n*1e5)).join(',')).sort(),key=keys.join('|');if(edges.has(key))continue;edges.add(key);
      const dx=bx-ax,dy=by-ay,l=Math.hypot(dx,dy),w=.0045;
      s.patch((u,v)=>{const x=mix(ax,bx,u)-(v-.5)*dy/l*w,y=mix(ay,by,u)+(v-.5)*dx/l*w;return [x,y,noseZ(x,y)-.050];},1,1,alloy);
    }
  }
  for(const sign of [-1,1]){
    const z=noseZ(sign*.86,1.32)-.035;
    round([sign*.86,1.318,z],[.335,.175,.065],trim,.028);
    // Original signature: a single swept blade over three small rectangular LED optics, with a detached marker.
    tube([[sign*.71,1.389,z-.038],[sign*.91,1.389,z-.035],[sign*.995,1.367,z-.025]],.013,white,body,6,12);
    for(let i=0;i<3;i++)round([sign*.86-.09+i*.09,1.302,z-.039],[.060,.034,.020],white,.007);
    round([sign*1.012,1.318,z-.010],[.018,.064,.027],amber,.007);
  }

  // Chassis has a genuine 28 cm low point; only the tyres extend to the contact plane.
  for(const x of [-.48,.48])round([x,.40,.1],[.11,.22,5.92],trim,.022);
  box([0,.58,.15],[1.48,.18,5.9],trim);
  for(const z of [-2.225,2.225]){
    round([0,.43,z],[2.08,.14,.14],alloy,.025);
    const diff=new THREE.SphereGeometry(.14,16,8);diff.scale(1.45,1,1);diff.translate(0,.43,z);s.add(diff,trim);
    for(const x of [-.57,.57])for(let leaf=0;leaf<3;leaf++)box([x,.32-leaf*.014,z],[.075,.012,.96-leaf*.13],alloy);
  }
  // Visible front seats and a rear bench sit behind the front tint and dark rear glass.
  if(!low){
  round([0,.81,-.20],[1.78,.12,2.18],cabin,.04);
  // Seal the cowl and the front bulkhead: the driver's view cannot see road through the back of the bonnet.
  box([0,1.25,-1.56],[1.84,.54,.09],trim);
  s.patch((u,v)=>{const x=(u*2-1)*.94;return [x,mix(bonnetY(x,1),1.50,v),mix(-1.64,-1.44,v)];},20,4,trim);
  round([0,1.41,-1.33],[1.76,.20,.34],trim,.055);
  round([-.52,1.46,-1.14],[.39,.12,.10],rubber,.025);
  round([0,1.47,-1.165],[.30,.25,.06],alloy,.02);
  round([0,1.48,-1.126],[.25,.16,.012],rubber,.01);
  for(const x of [-.52,.52])for(const z of [-.60,.48]){
    round([x,.99,z],[.59,.18,.55],cabin,.055);
    round([x,1.30,z+.23],[.58,.56,.16],cabin,.06,body,-.10);
    round([x,1.68,z+.26],[.30,.20,.14],cabin,.04);
  }
  round([0,.99,.48],[.35,.18,.55],cabin,.04);round([0,1.30,.71],[.35,.56,.16],cabin,.04);round([0,1.68,.74],[.25,.20,.14],cabin,.035);
  round([0,1.05,-.45],[.28,.29,.67],trim,.03);
  tube([[-.52,1.31,-1.27],[-.52,1.44,-1.00]],.030,trim,body,6,8);
  const steering=new THREE.TorusGeometry(.172,.020,8,32);steering.rotateX(-.34);steering.translate(-.52,1.46,-1.00);s.add(steering,trim);
  box([-.52,1.46,-.995],[.23,.035,.035],alloy);
  }
  const driverEye=new THREE.Object3D();driverEye.name='Left driver eye';driverEye.position.set(-.52,1.72,-.64);body.add(driverEye);

  const wheel=(x:number,z:number,front:boolean)=>{
    const pivot=new THREE.Group();pivot.position.set(x,0,z);root.add(pivot);
    const spin=new THREE.Group();spin.position.y=.43;pivot.add(spin);pivot.name=front?'Front steering pivot':'Rear axle pivot';spin.name='Tyre spin local X';
    const profile=[[.252,-.134],[.31,-.148],[.383,-.140],[.410,-.107],[.414,-.067],[.414,.067],[.410,.107],[.383,.140],[.31,.148],[.252,.134],[.252,-.134]].map(p=>new THREE.Vector2(...p as [number,number]));
    if(low)for(const p of profile)p.x*=.43/.414;
    const tyre=new THREE.LatheGeometry(profile,low?24:48);tyre.rotateZ(Math.PI/2);s.add(tyre,rubber,spin);
    // Three interlocking rows of full-height shoulder blocks, including the visible outer shoulder.
    if(!low)for(let row=0;row<3;row++)for(let i=0;i<36;i++){
      const a=(i+(row%2)*.38)*Math.PI/18,h=.046,lo=.412,hi=.43,xc=(row-1)*.09,hw=.035;
      const verts:number[]=[];for(const r of [lo,hi])for(const t of [a-h,a+h])for(const xx of [xc-hw,xc+hw])verts.push(xx,r*Math.cos(t),r*Math.sin(t));
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex([0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5]);reverseTriangles(g);g.computeVertexNormals();s.add(g,rubber,spin);
    }
    const sign=x<0?-1:1,faceSign=!front&&Math.abs(x)<.8?-sign:sign,deep=front?.025:-.095;
    // Outer dually centres sit well inboard of their rims; the inner tyres remain separate and visible.
    const barrel=new THREE.LatheGeometry([[.250,-.12],[.273,-.12],[.278,.132],[.268,.146],[.250,.132],[.250,-.12]].map(p=>new THREE.Vector2(...p as [number,number])),low?12:32);barrel.rotateZ(Math.PI/2);if(faceSign>0){barrel.scale(-1,1,1);reverseTriangles(barrel);}s.add(barrel,alloy,spin);
    const rim=new THREE.TorusGeometry(.264,.014,6,32);rim.rotateY(Math.PI/2);rim.translate(faceSign*.138,0,0);s.add(rim,alloy,spin);
    const hub=new THREE.CylinderGeometry(.084,.084,.048,20);hub.rotateZ(Math.PI/2);hub.translate(faceSign*deep,0,0);s.add(hub,alloy,spin);
    for(let i=0;i<(low?4:8);i++){
      const a=i*Math.PI/(low?2:4),c=Math.cos(a),sn=Math.sin(a);
      tube([[faceSign*deep,.08*c,.08*sn],[faceSign*.07,.17*c,.17*sn],[faceSign*.132,.25*Math.cos(a+.09),.25*Math.sin(a+.09)]],.019,alloy,spin,5,4);
      if(!low){const lug=new THREE.CylinderGeometry(.012,.012,.020,6);lug.rotateZ(Math.PI/2);lug.translate(faceSign*(deep+.03),.059*c,.059*sn);s.add(lug,alloy,spin);}
    }
    return {spin,pivot};
  };
  const fl=wheel(-.87,-2.225,true),fr=wheel(.87,-2.225,true),rl=wheel(-1.04,2.225,false),rr=wheel(1.04,2.225,false);
  const innerL=wheel(-.70,2.225,false),innerR=wheel(.70,2.225,false);
  const brakeLights=s.finish(red);
  return {root,body,wheels:{fl:fl.spin,fr:fr.spin,rl:rl.spin,rr:rr.spin},extraWheels:[innerL.spin,innerR.spin],steer:{fl:fl.pivot,fr:fr.pivot},driverEye,brakeLights};
}
