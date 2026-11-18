import * as THREE from 'three';
import { Mesher } from './yard-kit';
import type { Terrain } from './terrain';

/** Finlay Point: second wharf in pipeline/areas.py's ordered wharf keep boxes.
 * The church-only baked landmarks.json has no wharf records. EPSG:2961 metres.
 * On the existing harbour apron, just inland of its southern water edge. No grading.
 */
export const DECKHAND = { e:618838, n:5110132, stopE:618856, stopN:5110138, range:40 } as const;

/** Faceless work figure, following fishing-build's box-built crew. Two merged draws, no textures. */
export class Deckhand {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly arm = new THREE.Group();
  pointing = false;
  private readonly material = new THREE.MeshLambertMaterial({vertexColors:true});
  constructor(village: readonly [number,number], private terrain: Pick<Terrain,'surfaceAt'|'meshHeightAt'>) {
    this.group.name='Wharf guide';
    this.group.position.set(DECKHAND.e-village[0],0,village[1]-DECKHAND.n);
    const m=new Mesher(),cloth: [number,number,number]=[.18,.30,.34],boots: [number,number,number]=[.035,.045,.05];
    for(const s of [-1,1]){
      m.box(s*.12,.43,0,.18,.74,.22,boots);
      m.box(s*.12,.06,.05,.21,.12,.34,boots);
    }
    m.box(0,1.13,0,.46,.66,.29,cloth);
    m.box(0,1.59,0,.24,.26,.24,[.55,.37,.25]);
    m.box(0,1.76,0,.29,.12,.29,cloth);
    m.box(-.29,1.06,0,.13,.62,.19,cloth);
    m.box(-.29,.72,0,.12,.12,.14,[.55,.37,.25]);
    this.body.add(new THREE.Mesh(m.geometry(),this.material));
    const a=new Mesher();
    // +z is the pointing direction, shoulder at local origin.
    a.box(0,0,.25,.14,.15,.50,cloth);
    a.box(0,0,.54,.12,.12,.10,[.55,.37,.25]);
    a.box(0,0,.64,.055,.06,.10,[.55,.37,.25]);
    const limb=new THREE.Mesh(a.geometry(),this.material);limb.position.z=.001;
    this.arm.add(limb);
    this.arm.position.set(.29,1.35,0);this.arm.rotation.x=Math.PI/2;
    this.group.add(this.body,this.arm);this.group.visible=false;
  }
  update(dt:number,car:{x:number;z:number},camera:THREE.Vector3):void {
    const p=this.group.position;
    this.group.visible=false;
    if(Math.hypot(camera.x-p.x,camera.z-p.z)>350)return;
    const surface=this.terrain.surfaceAt(p.x,p.z),height=this.terrain.meshHeightAt(p.x,p.z,true);
    if(!surface||surface.level<7||height===null||height<.5)return;
    p.y=height;this.group.visible=true;
    if(dt<=0)return;
    const dx=car.x-p.x,dz=car.z-p.z;
    this.pointing=Math.hypot(dx,dz)<=DECKHAND.range;
    this.body.rotation.y=this.pointing?Math.atan2(dx,dz):0;
    // Keep the arm aimed at the stopping spot even as the torso turns toward the car.
    const yaw=this.body.rotation.y;
    const aim=Math.atan2(DECKHAND.stopE-DECKHAND.e,DECKHAND.n-DECKHAND.stopN);
    const side=this.pointing && Math.sin(aim-yaw)<0 ? -1 : 1;
    // Mirror the resting arm to the opposite shoulder. The body itself is symmetric.
    this.body.scale.x=side;
    this.arm.position.set(side*.29*Math.cos(yaw),1.35,-side*.29*Math.sin(yaw));
    this.arm.rotation.set(this.pointing ? .28 : Math.PI/2,
      this.pointing?aim:yaw,0,'YXZ');
  }
}
