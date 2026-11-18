import * as THREE from 'three';
import { Mesher, type RGB } from './yard-kit';

/** One invented, faceless artist and kit, in one vertex-colour draw. Local view is -Z. */
export function painterArt(): THREE.Mesh {
  const m = new Mesher();
  const wood: RGB = [.42,.28,.15], cloth: RGB = [.23,.36,.42], skin: RGB = [.65,.44,.30];
  const dark: RGB = [.12,.15,.16], canvas: RGB = [.88,.84,.69];
  const bar = (a: number[], b: number[], width: number, colour: RGB) => {
    const d = new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const g = new THREE.BoxGeometry(width,d.length(),width).toNonIndexed();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));
    g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    const p=g.getAttribute('position');
    for(let i=0;i<p.count;i+=3)m.tri(p.getX(i),p.getY(i),p.getZ(i),p.getX(i+1),p.getY(i+1),p.getZ(i+1),p.getX(i+2),p.getY(i+2),p.getZ(i+2),colour);
    g.dispose();
  };
  // Tripod easel, lower ledge, canvas with an invented sea study on its working face.
  for(const x of [-.43,.43])bar([x,0,-.9],[x*.4,1.85,-1.12],.055,wood);
  bar([0,0,-1.65],[0,1.75,-1.12],.055,wood);
  m.box(0,.86,-1.05,1,.06,.22,wood,false);
  m.box(0,1.31,-1.08,.86,.78,.055,canvas,false);
  m.box(0,1.45,-1.045,.76,.37,.012,[.48,.65,.70],false);
  m.box(0,1.16,-1.04,.76,.20,.012,[.21,.43,.48],false);
  m.box(-.19,1.12,-1.025,.38,.12,.014,[.35,.44,.24],false);
  // Folding stool, with two crossed supports at each side.
  for(const x of [-.24,.24])for(const s of [-1,1])bar([x,0,s*.24],[x,.49,-s*.24],.035,wood);
  m.box(0,.5,0,.58,.06,.5,dark,false);
  // Seated painter, knees and boots towards the view, brush hand beside canvas.
  m.box(0,.84,0,.47,.62,.29,cloth,false);
  m.box(0,1.34,-.02,.24,.29,.23,skin,false);
  m.box(0,1.5,-.02,.38,.045,.34,dark,false);
  m.box(0,1.54,0,.25,.09,.23,dark,false);
  for(const x of [-.17,.17]) {
    bar([x,.58,0],[x,.53,-.42],.15,dark);
    bar([x,.53,-.42],[x,.1,-.42],.12,dark);
    m.box(x,.07,-.49,.16,.12,.3,dark,false);
  }
  bar([.25,1.06,0],[.42,.94,-.36],.11,cloth);
  bar([.42,.94,-.36],[.32,1.21,-.8],.08,skin);
  bar([.32,1.21,-.8],[.26,1.32,-1.04],.018,wood);
  bar([-.25,1.05,0],[-.37,.78,-.3],.11,cloth);
  // Small open paint box with coloured pans.
  m.box(.85,.12,-.15,.46,.24,.34,wood,false);
  m.box(.85,.25,-.3,.46,.025,.32,wood,false);
  const paints: RGB[] = [[.65,.20,.12],[.22,.43,.59],[.75,.62,.25]];
  for(let i=0;i<3;i++)m.box(.71+i*.13,.25,-.12,.09,.025,.12,paints[i],false);
  const mesh = new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({vertexColors:true}));
  mesh.name = 'Roadside painter, easel, folding stool and paint box';
  return mesh;
}
