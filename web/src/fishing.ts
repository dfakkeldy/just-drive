import * as THREE from 'three';
import { Endings } from './ending';
import { buildFishing, type FishingArt } from './fishing-build';
import { sampleDeparture, departureDuration, type BoatCourseSample } from './fishing-course';
import { FishingJudge, type FishingSample } from './fishing-rules';
import { BOARD, FishingSite, PARK, WHARF } from './fishing-site';
import { pushOut, type Solid } from './parked';
import { WHARF_ANCHORS, WHARF_FIXTURES } from './mabou-wharf-props';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';

export const SKIPPER_LINES = [
  'I need a deckhand.',
  'You already work in all weather.',
  'Out here, nobody asks where their parcel is.',
] as const;
export const DECKHAND_LINES = [
  'The route is somebody else’s problem now.',
  'The mail is still in the back seat.',
  'Your forwarding address changes with the tide.',
  'You have an early start.',
] as const;

/** One small site, four draws including both boats, lettering, people and lines. No work out of range. */
export class Fishing {
  readonly group = new THREE.Group();
  readonly judge = new FishingJudge();
  private art: FishingArt | null = null;
  private solids: Solid[] = [];
  private shoreSolids: Array<{ ground: number; bounds: Solid[] }> = [];
  readonly departureDuration = departureDuration;
  private course:BoatCourseSample={e:0,n:0,de:0,dn:-1,speed:0,distance:0};
  private phase = 0;
  private leaving = false;
  private dummy = new THREE.Object3D();
  private eye = new THREE.Vector3(); private look = new THREE.Vector3();
  private from = new THREE.Vector3(); private rotation = new THREE.Quaternion();
  private turn = new THREE.PerspectiveCamera();
  private sample: FishingSample = {distance:0,speed:0,sideways:0,y:0,deck:null,airborne:false,eligible:false,placement:0,x:0,z:0};
  /** Diagnostics use geometry counts, never a frame-rate measurement. */
  triangles = 0;
  updates = 0;
  constructor(readonly site: FishingSite, private terrain: Terrain, private car: Vehicle,
    private camera: THREE.PerspectiveCamera, private endings: Endings, private sea: number, private low: boolean) {
    this.group.name='Mabou Harbour wharf';this.group.position.set(site.x,0,site.z);this.group.visible=false;
  }
  private near(x:number,z:number,range:number):boolean {return Math.abs(x-this.site.x)<range && Math.abs(z-this.site.z-35)<range;}
  private build():void {
    // This harbour's finest baked grid is level 7 (2 m); level 8 exists only nearer the village.
    // Await that actual grid: a coarse hill tile must never choose the deck's bedding.
    const toe=this.terrain.surfaceAt(this.site.x,this.site.z-2);
    const end=this.terrain.surfaceAt(this.site.x+7,this.site.z+60);
    if (!toe || !end || toe.level<7 || end.level<7) return;
    const top=this.site.level;
    // The anchors share the same level-7 tile as the cap; no additional
    // terrain tile has to load before the deck can open.
    const ground: number[] = [];
    for (const { u, v } of WHARF_ANCHORS) {
      const s = this.terrain.surfaceAt(this.site.x + u, this.site.z + v);
      if (!s || s.level < 7) return;
      ground.push(s.ground);
    }
    const art=buildFishing(top,this.sea,this.low,ground);
    this.art=art;this.triangles=art.triangles;this.group.add(art.fixed,art.boat,art.crew,art.lines);
    const solid=(u:number,v:number,half:number,halfWidth:number,heading:number)=>this.solids.push({x:this.site.x+u,z:this.site.z+v,half,halfWidth,heading});
    // The low timber guards are real solids at every physics substep, not a painted edge.
    solid(2,37,27,.145,Math.PI);solid(12,37,27,.145,Math.PI);solid(7,64,5,.145,Math.PI/2);
    this.shoreSolids = WHARF_FIXTURES.map(({u,v,half,halfWidth,yaw}, i) => ({
      ground: ground[i], bounds: [{ x: this.site.x + u, z: this.site.z + v, half, halfWidth, heading: yaw }],
    }));
    this.site.toe=this.site.entrance(-2);this.site.top=top;
    this.pose(0);
  }
  update(dt:number,cam:THREE.Vector3):void {
    const near=this.near(cam.x,cam.z,900)||this.near(this.car.x,this.car.z,900);
    this.group.visible=near && this.art!==null;
    if(!near)return;
    if(!this.art)this.build();
    if(!this.art)return;
    this.group.visible=true;
    if(dt>0 && !this.leaving){this.phase+=dt;this.pose(0);this.updates++;}
  }
  private pose(seconds:number):void {
    const a=this.art;if(!a)return;
    sampleDeparture(seconds,this.course);
    const c=this.course,yaw=Math.atan2(c.de,-c.dn),power=this.leaving?c.speed/7:0;
    a.boat.position.set(c.e-WHARF.e,this.sea+Math.sin(this.phase*.9)*.045,WHARF.n-c.n);
    a.boat.rotation.set(-.035*power+Math.sin(this.phase*.66)*.006,yaw,Math.sin(this.phase*.8)*.012,'YXZ');
    if(this.leaving){
      a.lines.position.set(a.boat.position.x,this.sea,a.boat.position.z);a.lines.rotation.set(0,yaw,0);a.lines.scale.set(power,1,power);
    }
    a.boat.updateMatrix();
    for(let i=0;i<2;i++) {
      if(!this.leaving){
        this.dummy.position.set(BOARD.u-.5,this.site.top!,BOARD.v+1.5);this.dummy.rotation.set(0,Math.PI,0);this.dummy.scale.setScalar(i===0?1:0);
        this.dummy.updateMatrix();
      }else{
        this.dummy.position.set(i===0?-.65:.75,1.12,i===0?-.85:-2.9);this.dummy.rotation.set(0,i===0?0:.35,0);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.dummy.matrix.premultiply(a.boat.matrix);
      }
      a.crew.setMatrixAt(i,this.dummy.matrix);
    }
    a.crew.instanceMatrix.needsUpdate=true;a.crew.computeBoundingSphere();
  }
  step(dt:number,eligible:boolean,placement:number):void {
    if(!this.art || this.endings.busy || !this.near(this.car.x,this.car.z,95))return;
    const c=this.car;
    if(this.site.top!==null && c.y>=this.site.top-.25 && c.y<=this.site.top+1)pushOut(c,this.solids);
    for (const { ground, bounds } of this.shoreSolids) {
      if (c.y >= ground - .45 && c.y <= ground + 1.25) pushOut(c, bounds);
    }
    const s=this.sample;
    s.x=c.x;s.z=c.z;s.y=c.y;s.distance=Math.hypot(c.x-this.site.x-BOARD.u,c.z-this.site.z-BOARD.v);
    s.deck=this.site.deckHeight(c.x,c.z);s.speed=c.speed;s.sideways=c.vx*Math.cos(c.heading)+c.vz*Math.sin(c.heading);
    s.airborne=c.airborne;s.placement=placement;s.eligible=eligible;
    if(this.judge.step(dt,s))this.endings.offer('The skipper','A different sort of delivery',SKIPPER_LINES,[
      {label:'Take the job',action:()=>this.takeJob()}, {label:'Keep the route',action:()=>this.endings.close()},
    ]);
  }
  private takeJob():void {
    const c=this.car;
    c.place(this.site.x+PARK.u,this.site.z+PARK.v,Math.PI);c.speed=c.vx=c.vz=0;
    {const r=c.car;if(r.beacon)r.beacon.visible=false;if(r.signLight)r.signLight.visible=false;r.setWindowDown?.(true);}
    this.leaving=true;this.art!.lines.geometry=this.art!.wake;this.art!.lines.material=this.art!.wakeMaterial;this.art!.lines.renderOrder=3;this.art!.lines.visible=true;this.from.copy(this.camera.position);this.rotation.copy(this.camera.quaternion);this.pose(0);
    this.endings.begin({key:'deckhand',title:'You fish now.',lines:DECKHAND_LINES,camera:seconds=>{
      this.phase=seconds;this.pose(seconds);
      const boat=this.art!.boat.position,c=this.course,t=Math.max(0,Math.min(1,(seconds-7)/22)),ease=t*t*(3-2*t);
      const de=c.de,dz=-c.dn,portrait=this.camera.aspect<1,astern=portrait?22:26;
      // Cast off with the small car in view, then descend behind the stern and look out to the gulf.
      this.eye.set(this.site.x+boat.x+27,this.sea+17,this.site.z+boat.z-36);
      this.eye.x+=(this.site.x+boat.x-de*astern-dz*2-this.eye.x)*ease;
      this.eye.y+=(this.sea+(portrait?3.2:5.6)-this.eye.y)*ease;
      this.eye.z+=(this.site.z+boat.z-dz*astern+de*2-this.eye.z)*ease;
      this.camera.position.copy(this.from).lerp(this.eye,Math.min(1,seconds/2));
      const ahead=(portrait?4:35)*ease;
      this.look.set(this.site.x+boat.x+de*ahead,this.sea+1.3-(portrait?4.7*ease:0),this.site.z+boat.z+dz*ahead);
      this.turn.position.copy(this.camera.position);this.turn.lookAt(this.look);
      this.camera.quaternion.copy(this.rotation).slerp(this.turn.quaternion,Math.min(1,seconds/2));
    }});
  }
  reset():void {
    this.judge.reset();this.leaving=false;this.phase=0;
    {const r=this.car.car;if(r.beacon)r.beacon.visible=true;if(r.signLight)r.signLight.visible=true;r.setWindowDown?.(false);}
    if(this.art){this.art.lines.geometry=this.art.mooring;this.art.lines.material=this.art.mooringMaterial;this.art.lines.renderOrder=0;this.art.lines.visible=true;this.art.lines.position.set(0,0,0);this.art.lines.rotation.set(0,0,0);this.art.lines.scale.set(1,1,1);this.pose(0);}
  }
}
