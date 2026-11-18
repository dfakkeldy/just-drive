import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stockGeometry } from './animals';
import { FISH_COWS } from './road-scene-rules';
import { Mesher, type RGB } from './yard-kit';

const WHITE: RGB = [.84, .85, .81], DARK: RGB = [.035, .044, .05], TRIM: RGB = [.31, .34, .35], GLASS: RGB = [.075, .14, .19];
const DIRT: RGB = [.25, .22, .17], RIM: RGB = [.53, .55, .53], LAMP: RGB = [.97, .91, .73], RED: RGB = [.55, .035, .02];

function disc(m: Mesher, x: number, y: number, z: number, radius: number, colour: RGB, axis: 'x' | 'z', segments = 12): void {
  for (let i = 0; i < segments; i++) {
    const a = i * Math.PI * 2 / segments, b = (i + 1) * Math.PI * 2 / segments;
    if (axis === 'x') m.tri(x,y,z,x,y+Math.cos(a)*radius,z+Math.sin(a)*radius,x,y+Math.cos(b)*radius,z+Math.sin(b)*radius,colour);
    else m.tri(x,y,z,x+Math.cos(a)*radius,y+Math.sin(a)*radius,z,x+Math.cos(b)*radius,y+Math.sin(b)*radius,z,colour);
  }
}

/** A 4.5 m compact crossover. Concave side profiles leave real wheel-arch openings. Local nose is +X. */
function compactCar(m: Mesher): void {
  const body: RGB = [.49, .57, .56];
  const profile: number[][] = [[-2.22,.42],[-1.79,.42]];
  for (const axle of [-1.37,1.37]) {
    if (axle>0) profile.push([.95,.42]);
    for(let i=0;i<=8;i++){const a=Math.PI-i*Math.PI/8;profile.push([axle+.42*Math.cos(a),.34+.42*Math.sin(a)]);}
  }
  profile.push([2.22,.42],[2.21,.76],[2.08,.91],[1.22,1.03],[.57,1.59],[-1.18,1.64],[-1.98,1.39],[-2.22,.91]);
  m.extrude(profile,-.88,.88,body);
  for(const side of [-1,1]) {
    const z=side*.89;
    // Separate panes, pillars, lower window belt and two door seams.
    m.quad([[-1.87,1.16,z],[-1.16,1.55,z],[-.47,1.54,z],[-.47,1.05,z]],GLASS);
    m.quad([[-.39,1.05,z],[-.39,1.54,z],[.51,1.51,z],[1.05,1.05,z]],GLASS);
    m.box(-.41,1.28,z,.055,.55,.025,TRIM);
    m.box(-.42,.83,z,.018,.4,.012,DIRT);
    m.box(-1.19,.84,z,.018,.35,.012,DIRT);
    m.box(-.62,1.0,side*.905,.22,.035,.02,TRIM);
    m.box(.23,1.0,side*.905,.22,.035,.02,TRIM);
    m.box(.88,1.10,side*.96,.22,.13,.16,body);
    m.box(.87,1.11,side*1.047,.16,.085,.014,GLASS);
    m.box(0,.47,side*.885,1.85,.11,.025,DIRT);
    m.box(2.215,.77,side*.64,.035,.17,.37,LAMP);
    m.box(-2.225,1.02,side*.70,.03,.29,.19,RED);
    // Twelve-sided tyres and separate alloy lips/hubs. All remain in the same merged draw.
    for(const axle of [-1.37,1.37]) {
      m.cyl(axle,.34,side*.78,.34,.23,DARK,'z',12);
      disc(m,axle,.34,side*.902,.24,RIM,'z');
      disc(m,axle,.34,side*.916,.11,TRIM,'z',8);
      for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const x=axle+Math.cos(a)*.16,y=.34+Math.sin(a)*.16,z=side*.918;m.quad([[x-.026,y-.026,z],[x+.026,y-.026,z],[x+.026,y+.026,z],[x-.026,y+.026,z]],DARK);}
    }
  }
  m.quad([[1.204,1.055,.75],[1.204,1.055,-.75],[.611,1.565,-.75],[.611,1.565,.75]],GLASS);
  m.quad([[-2.169,1.04,-.75],[-2.169,1.04,.75],[-2.019,1.34,.75],[-2.019,1.34,-.75]],GLASS);
  m.box(2.23,.51,0,.035,.19,1.70,DARK); m.box(-2.23,.51,0,.035,.18,1.70,DARK);
  m.box(2.235,.73,0,.018,.17,.68,DARK);
  for(const y of [.69,.75])m.box(2.25,y,0,.01,.018,.60,TRIM);
  m.box(-2.17,1.49,0,.12,.06,1.48,body); // hatch spoiler
  m.box(-2.23,1.20,0,.025,.025,.85,TRIM);
}

/** Chamfered cab, raked screen, closed refrigerated box. Local nose is -Z. */
function fishTruck(m: Mesher): void {
  const cab: RGB = [.26,.39,.44];
  const ring=(y:number,width:number,front:number,rear:number):number[][]=>[
    [-width+.14,y,rear],[width-.14,y,rear],[width,y,rear-.14],[width,y,front+.22],
    [width-.18,y,front],[-width+.18,y,front],[-width,y,front+.22],[-width,y,rear-.14],
  ];
  const rings=[ring(.78,1.10,-4.12,-1.69),ring(1.55,1.14,-4.10,-1.69),ring(2.65,1.04,-3.38,-1.74)];
  for(let k=0;k<2;k++)for(let i=0;i<8;i++)m.quad([rings[k][i],rings[k][(i+1)%8],rings[k+1][(i+1)%8],rings[k+1][i]],cab);
  for(let i=1;i<7;i++)m.tri(...rings[2][0] as [number,number,number],...rings[2][i] as [number,number,number],...rings[2][i+1] as [number,number,number],cab);
  m.quad([[.88,1.63,-4.060],[-.88,1.63,-4.060],[-.85,2.53,-3.471],[.85,2.53,-3.471]],GLASS);
  m.box(0,2.62,-3.41,2.03,.065,.17,cab); // visor
  for(const side of [-1,1]) {
    m.quad([[side*1.144,1.64,-1.94],[side*1.144,1.64,-3.82],[side*1.066,2.50,-3.24],[side*1.066,2.50,-1.94]],GLASS);
    m.box(side*1.15,1.36,-1.96,.018,.50,.018,DIRT);
    m.box(side*1.15,1.10,-2.87,.018,.018,1.81,DIRT);
    m.box(side*1.16,1.57,-2.13,.03,.04,.24,RIM);
    m.box(side*1.28,1.83,-3.52,.28,.045,.045,TRIM);
    m.box(side*1.36,2.07,-3.53,.18,.43,.15,DARK);
    m.box(side*1.36,2.07,-3.445,.14,.34,.018,RIM);
    m.box(side*.83,1.17,-4.125,.42,.22,.03,LAMP);
    m.box(side*.86,1.39,-4.12,.21,.07,.025,[.9,.36,.04]);
    m.box(side*.89,.94,4.095,.30,.17,.035,RED);
    m.box(side*.67,.94,4.095,.12,.17,.035,LAMP);
    m.box(side*1.10,.69,-1.82,.33,.16,.65,TRIM); // steps
    m.box(side*1.09,.88,-1.82,.27,.10,.48,DARK);
    m.cyl(side*.88,.80,-.77,.29,1.08,RIM,'z',12); // fuel tank
    for(const z of [-1.18,-.40])m.box(side*.88,.80,z,.62,.55,.055,TRIM);
    for(const axle of [-2.84,2.37,3.34]) {
      const dual=axle>0;
      for(let j=0;j<(dual?2:1);j++)m.cyl(side*(dual?.80+j*.28:1.0),.48,axle,.48,dual?.24:.32,DARK,'x',12);
      disc(m,side*1.225,.48,axle,.29,RIM,'x');
      m.cyl(side*1.245,.48,axle,.13,.045,TRIM,'x',8);
    }
    m.box(side*1.0,.40,3.91,.43,.63,.06,DARK); // mud flaps
    m.box(side*1.0,.34,-2.24,.34,.45,.05,DARK);
  }
  m.box(0,.68,.0,2.12,.30,8.1,DARK);
  m.box(0,.86,-4.17,2.38,.22,.10,TRIM);
  m.box(0,1.32,-4.125,1.14,.32,.025,DARK);
  for(let i=0;i<5;i++)m.box(0,1.19+i*.061,-4.15,1.07,.022,.018,RIM);
  m.box(0,2.36,1.08,2.40,2.65,5.90,WHITE);
  for(const x of [-1.205,1.205])for(const z of [-1.87,4.03])m.box(x,2.35,z,.07,2.69,.07,RIM);
  for(const x of [-1.208,1.208]) {
    m.box(x,1.12,1.08,.025,.20,5.82,DIRT);
    m.box(x,3.66,1.08,.03,.045,5.85,RIM);
    for(let i=0;i<8;i++)m.box(x,1.25+(i%3)*.025,-1.4+i*.68,.03,.06,.30,[.53,.52,.45]);
  }
  m.box(0,2.35,4.049,.035,2.49,.025,TRIM);
  for(const x of [-.70,.70]) {
    m.cyl(x,2.31,4.075,.024,2.18,RIM,'y',6);
    for(const y of [1.28,2.1,3.30])m.box(x,y,4.10,.15,.065,.05,TRIM);
    m.box(x-.13,1.97,4.11,.28,.045,.055,DARK);
  }
  m.box(0,3.12,-1.97,1.34,.79,.44,WHITE); // refrigeration unit, high on front of closed box
  m.box(0,3.09,-2.20,1.12,.51,.025,DARK);
  for(let i=0;i<7;i++)m.box(0,2.89+i*.065,-2.22,1.04,.022,.015,RIM);
  for(const side of [-1,1]){m.box(side*.8,.94,-4.126,.42,.07,.035,DIRT);m.box(side*1.145,.96,-2.88,.026,.10,1.5,DIRT);}
}

/** Same five merged meshes in desktop and phone mode; no textures or shadow casting. */
export function fishArt() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = (m: Mesher) => new THREE.Mesh(m.geometry(), mat);
  const carBuilder=new Mesher();compactCar(carBuilder);const car=mesh(carBuilder);car.geometry.rotateY(Math.PI/2);
  const m=new Mesher();fishTruck(m);const truck=new THREE.Group();truck.add(mesh(m));
  const skin:RGB=[.70,.46,.30],trousers:RGB=[.13,.20,.28],shirt:RGB=[.64,.38,.21];
  const person=new Mesher();
  for(const side of [-1,1]){person.box(side*.14,.43,0,.18,.78,.21,trousers);person.box(side*.14,.08,-.08,.21,.14,.36,DARK);}
  person.box(0,1.1,0,.48,.62,.3,shirt);person.cyl(0,1.62,0,.16,.3,skin,'y',8);person.box(0,1.79,.01,.37,.08,.34,[.45,.43,.30]);
  for(const side of [-1,1]){person.at(side*.27,1.3,-.10,0,-.9,side*.25);person.box(0,0,-.12,.15,.18,.43,shirt);}
  person.at(0,0,0);person.box(0,1.56,-.33,.32,.20,.17,DARK);person.cyl(0,1.56,-.46,.085,.12,TRIM,'z',12);person.cyl(0,1.56,-.53,.066,.025,GLASS,'z',12);
  for(const side of [-1,1])person.box(side*.14,1.27,-.155,.025,.48,.02,DARK); // camera strap
  const visitor=mesh(person);
  const wave=new Mesher();wave.at(-1.20,2.08,-2.75,0,0,-.45);wave.box(0,.18,0,.15,.55,.15,skin);wave.box(0,.48,0,.22,.22,.12,skin);
  const hand=mesh(wave);truck.add(hand);hand.visible=false;
  // Bake the existing articulated cattle builder's static poses into a single scene draw.
  const geometries=FISH_COWS.map(c=>stockGeometry(c.kind,c.grazing));
  const counts=geometries.map(g=>g.attributes.position.count), offsets=[0];
  for(const count of counts)offsets.push(offsets[offsets.length-1]+count);
  const cows=new THREE.Mesh(mergeGeometries(geometries)!,mat);for(const g of geometries)g.dispose();
  cows.frustumCulled=false; // tiny herd; the scene's 320 m distance gate owns culling
  const group=new THREE.Group();group.name='Mines Road fish truck scene';group.add(car,truck,visitor,cows);group.visible=false;
  return {group,car,truck,visitor,hand,cows,cowOffsets:offsets};
}
