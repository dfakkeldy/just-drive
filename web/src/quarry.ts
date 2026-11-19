import { AreaContacts } from './world-contacts';
import * as THREE from 'three';
import { Coast, type RockBlock } from './coast';
import { QuarrySite, GATE, LOOKOFFS, PARK_HUT, onCoursePad, onApron, lakeAt } from './quarry-site';
import { TALUS_TOES } from './quarry-talus';
import { QUARRY_LAKES } from './quarry-lakes';
import { QuarryWater } from './quarry-water';
import { Mesher, SignAtlas, type RGB } from './yard-kit';
import { pushOut, type Solid, type Pushable, type ContactBody } from './parked';
import { touchesPlayer } from './road-scene-rules';
import type { Vehicle, VehiclePlacement } from './vehicle';
import type { VehicleSpec } from './vehicle-spec';
import type { Terrain } from './terrain';
import type { Roads } from './roads';
import type { WaterReflections } from './water';
const TIMBER:RGB=[.31,.23,.145],STEEL:RGB=[.32,.38,.37],PALE:RGB=[.7,.68,.61],HUT:RGB=[.29,.34,.29];
interface Board {e:number;n:number;width:number;height:number;yaw:number;lines:string[];map?:boolean;portal?:boolean;lift?:number}
export const PARK_BOARDS:Board[]=[
      {e:GATE.e,n:GATE.n,width:16,height:2.2,yaw:.467,lines:['SUGAR CAMP OFF-ROAD PARK'],portal:true,lift:7.2},
      {e:631948,n:5062094,width:3.8,height:2.7,yaw:.467,lines:['PARK MAP','Helmets on.','Stay off the water.','Easy lines are green.'],map:true},
      {e:631800,n:5062299,width:3.2,height:1.4,yaw:.467,lines:['LAKE LOOP  →','EAST TOP  →','SOUTH PIT  ←']},
      {e:631687,n:5063478,width:3.2,height:1.1,yaw:Math.PI,lines:['WEST WALL LOOKOFF  ↑','LAKE LOOP  →']},
      {e:632124,n:5064100,width:3,height:1.1,yaw:Math.PI/2,lines:['EAST TOP  ↑','SOUTH PIT  ↓']},
    ];

/** Invented park fixtures. Course pads sit clear of the quarry fixtures. */
export class Quarry {
  readonly group=new THREE.Group();
  readonly fixtures=new THREE.Group();
  readonly solids:Solid[]=[];
  readonly portalBeamVertices:number[]=[];
  readonly feet:{x:number;z:number;y:number;kind:string;vertices:number[]}[]=[];
  readonly rocks:Coast;
  readonly water:QuarryWater;
  readonly boards:Board[];
  private placementContacts:AreaContacts|null=null;
  private provider:ReturnType<Quarry['contactProvider']>|null=null;
  private signature=-1;
  private revision=0;
  private readonly runout=Array.from({length:60},()=>({x:0,z:0,y:0,size:0,height:0,turn:0,burial:0}));
  private readonly rockMatrix=new THREE.Matrix4();
  private readonly rockScale=new THREE.Vector3();
  private staticSolids:Solid[]=[];
  private readonly plain=new THREE.MeshLambertMaterial({vertexColors:true});
  private readonly atlas=new SignAtlas(2048,1024);
  private readonly signMaterial:THREE.MeshBasicMaterial;
  private signCells:[number,number,number,number][]=[];
  private boundWater:WaterReflections|null=null;
  constructor(readonly site:QuarrySite,private terrain:Terrain,private roads:Roads){
    this.group.name='Sugar Camp Off-Road Park';this.fixtures.name='Park fixtures';this.group.add(this.fixtures);
    this.boards=PARK_BOARDS;
    for(const board of this.boards)this.signCells.push(this.atlas.add(board.portal?2040:768,board.portal?200:board.map?320:160,(g,w,h)=>{
      g.fillStyle='#253c32';g.fillRect(0,0,w,h);g.strokeStyle='#d7d8c9';g.lineWidth=5;g.strokeRect(8,8,w-16,h-16);g.fillStyle='#f0eee5';g.textAlign='center';
      if(board.map){
        g.font='bold 25px sans-serif';g.fillText(board.lines[0],w/2,38);
        const map=(e:number,n:number):[number,number]=>[120+(e-630200)*.044,245-(n-5062000)*.044];
        g.fillStyle='#72bcb4';for(const lake of QUARRY_LAKES){g.beginPath();lake.points.forEach(([e,n],i)=>{const [x,y]=map(e,n);if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.closePath();g.fill();}
        g.strokeStyle='#e2d7b7';g.lineWidth=3;for(const r of roads.roads)if(r.kind===4){let pen=false;g.beginPath();for(const [x,z] of r.pts){const e=x+site.village[0],n=site.village[1]-z;if(e<630200||e>633200||n<5061600||n>5066500){pen=false;continue;}const [u,v]=map(e,n);if(pen)g.lineTo(u,v);else g.moveTo(u,v);pen=true;}g.stroke();}
        g.fillStyle='#f0eee5';g.textAlign='left';g.font='26px sans-serif';board.lines.slice(1).forEach((line,i)=>g.fillText(line,440,100+i*56));
      }else{g.font=`bold ${board.portal?150:board.lines.length>2?32:43}px sans-serif`;board.lines.forEach((line,i)=>g.fillText(line,w/2,(i+.7)*h/board.lines.length,board.portal?w*.86:w-40));}
    }).cell);
    this.signMaterial=new THREE.MeshBasicMaterial({map:this.atlas.texture,side:THREE.DoubleSide});
    const candidates:RockBlock[]=[];let seed=129;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(const [e,n] of TALUS_TOES)for(let j=0;j<7;j++){
      const size=j===0?.65+random()*1.2:.20+random()**2*.70;
      candidates.push({x:e-site.village[0]+random()*9-2,z:site.village[1]-n+(random()-.5)*7,size,height:size*(.55+random()*.38),turn:random()*Math.PI,y:0,burial:0});
    }
    // Boulders line the last sixty metres of the approach, outside the vehicle and trailer corridor.
    for(let d=-60;d<=-10;d+=5)for(const side of [-1,1]){
      const e=GATE.e+Math.sin(GATE.heading)*d+Math.cos(GATE.heading)*side*6.8,n=GATE.n+Math.cos(GATE.heading)*d-Math.sin(GATE.heading)*side*6.8,size=1.35+random()*.35;
      candidates.push({x:e-site.village[0],z:site.village[1]-n,size,height:size*1.5,turn:random()*Math.PI,y:0,burial:0});
    }
    // Shuffle once, so capacity does not favour one end of the kilometre-long face.
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
    this.rocks=new Coast(site,terrain,terrain.low,{candidates,capacity:terrain.low?1000:2000,bedding:.85,minHeight:15.65,maxHeight:90,revision:()=>this.revision,accept:b=>{
      const e=b.x+site.village[0],n=site.village[1]-b.z;
      if(onCoursePad(e,n,12)||onApron(e,n,3)||lakeAt(e,n))return false;
      const hit=roads.nearest(b.x,b.z,12);return !hit||hit.dist>hit.road.halfWidth+b.size+2.5;
    }});
    this.rocks.group.name='Quarry fallen gypsum';this.group.add(this.rocks.group);
    this.water=new QuarryWater(terrain,this.atlas.texture);
    // Bounds are fixed even before the land loads. Every placement guard sees the complete static scene.
    this.staticSolids=this.fixtureSolids();this.solids.push(...this.staticSolids);
  }
  attach(scene:THREE.Scene,water:WaterReflections|null):void {scene.add(this.group,this.water.group);this.bindWater(water);}
  bindWater(water:WaterReflections|null):void {this.boundWater=water;this.water.bind(water);water?.include(this.group);}
  private world(e:number,n:number):{x:number;z:number}{return{x:e-this.site.village[0],z:this.site.village[1]-n};}
  private solid(e:number,n:number,length:number,width:number,heading=0):Solid{return{...this.world(e,n),half:length/2,halfWidth:width/2,heading};}
  private fixtureSolids():Solid[]{
    const s:Solid[]=[];
    for(const b of this.boards){for(const side of [-1,1])s.push(this.solid(b.e+Math.cos(b.yaw)*side*(b.width/2-.5),b.n+Math.sin(b.yaw)*side*(b.width/2-.5),b.portal?.5:.25,b.portal?.5:.25));if(!b.portal)s.push(this.solid(b.e,b.n,b.width+.16,.18,Math.PI/2-b.yaw));}
    // Both leaves stand open beside the ten-metre opening, parallel to the access lane.
    for(const side of [-1,1]){const e=GATE.e+Math.cos(GATE.heading)*side*5.4,n=GATE.n-Math.sin(GATE.heading)*side*5.4;s.push(this.solid(e,n,.32,.32),this.solid(e+Math.sin(GATE.heading)*3,n+Math.cos(GATE.heading)*3,6,.15,GATE.heading));}
    s.push(this.solid(PARK_HUT.e,PARK_HUT.n,4.2,3.4));
    for(const p of LOOKOFFS)s.push(this.solid(p.e+8,p.n,17,.18,0));
    for(let i=0;i<11;i++){const d=i*10;for(const side of [-1,1])s.push(this.solid(GATE.e+Math.sin(GATE.heading)*d+Math.cos(GATE.heading)*side*5.8,GATE.n+Math.cos(GATE.heading)*d-Math.sin(GATE.heading)*side*5.8,.2,.2));}
    for(const [e,n] of [[632008,5061922],[632012,5061935]])s.push(this.solid(e,n,.16,.16));
    return s;
  }
  bindVehicle(vehicle:Vehicle,contacts?:AreaContacts):void{
    const registry=contacts??(this.placementContacts??=new AreaContacts());
    registry.add(Quarry.prototype.contactProvider.call(this));registry.bindVehicle(vehicle);
  }
  /** Register once; guards, driving, trailer and fleet sweeps share this same live provider. */
  contactProvider():{revision:()=>number;resolve:(body:Pushable)=>void;allows:(body:ContactBody)=>boolean}{
    return this.provider??={revision:()=>this.revision,resolve:body=>this.resolveSolids(body),allows:body=>this.allowPlacement(body,body.spec)};
  }
  allowPlacement(pose:VehiclePlacement,spec:VehicleSpec):boolean{
    const land=this.terrain.heightAt(pose.x,pose.z),deck=this.roads.deckHeight(pose.x,pose.z);
    const support=deck===null?land:land===null?deck:Math.max(land,deck);
    const surface=this.terrain.surfaceAt?.(pose.x,pose.z);
    const onDeck=(deck!==null&&support===deck)||(surface?.deck===true&&support!==null&&Math.abs(surface.ground-support)<.02);
    if(this.terrain.waterAt(pose.x,pose.z,support??undefined,onDeck))return false;
    for(const s of this.solids)if(touchesPlayer(s,pose,.15,spec))return false;
    return true;
  }
  /** Reuse accepted chunks on the lower runout bench and its wall-toe apron. No candidates or instances are added. */
  private bedRunout():void {
    const mesh=this.rocks.mesh,p=mesh.geometry.getAttribute('position');let source=0,moved=0;
    for(let slot=0;slot<this.runout.length;slot++){
      const large=slot<20,j=large?slot:slot-20;
      const e=large?631758+(j%5)*4.5+Math.sin(j*17)*1.4:631762+(j%8)*2+Math.sin(j*17)*.7;
      const n=large?5064444+Math.floor(j/5)*9+Math.cos(j*13)*2+(j%2)*2:5064442+Math.floor(j/8)*3+Math.cos(j*13)*.75;
      const x=e-this.site.village[0],z=this.site.village[1]-n;
      while(source<this.rocks.blocks.length){const b=this.rocks.blocks[source],en=b.x+this.site.village[0],nn=this.site.village[1]-b.z;if((large?b.size>.65:b.size<=.65)&&en<631850&&nn>5063900&&nn<5065000)break;source++;}
      if(source>=this.rocks.blocks.length)break;
      const original=this.rocks.blocks[source],b=this.runout[slot];
      b.x=x;b.z=z;b.size=large?Math.max(original.size,1.5+j*.025):.45+(j%7)*.13;b.height=Math.max(original.height,large?b.size*(.55+.08*(j%3)):Math.max(.3,b.size*(.5+.07*(j%3))));b.turn=original.turn;b.burial=0;
      const road=this.roads.nearest(x,z,12);if(road&&road.dist<=road.road.halfWidth+b.size+2.5)continue;
      if(onCoursePad(e,n,12)||onApron(e,n,3)||lakeAt(e,n))continue;
      const c=Math.cos(b.turn),s=Math.sin(b.turn);let lo=Infinity,hi=-Infinity,complete=true;
      for(let i=0;i<p.count;i++){
        const u=p.getX(i)*b.size,v=p.getZ(i)*b.size,ground=this.terrain.meshHeightAt(x+u*c+v*s,z-u*s+v*c,true);
        if(ground===null){complete=false;break;}
        if(p.getY(i)===0){lo=Math.min(lo,ground);hi=Math.max(hi,ground);}
      }
      if(!complete||hi-lo>Math.min(.85,b.height*.45))continue;
      b.y=lo-Math.min(.10,b.height*.08);
      this.rockMatrix.makeRotationY(b.turn).scale(this.rockScale.set(b.size,b.height,b.size)).setPosition(x,b.y,z);
      mesh.setMatrixAt(source,this.rockMatrix);(mesh.geometry.getAttribute('coastFoot') as THREE.InstancedBufferAttribute).setX(source,hi);
      this.rocks.blocks[source]=b;source++;moved++;
    }
    if(moved){mesh.instanceMatrix.needsUpdate=true;mesh.geometry.getAttribute('coastFoot').needsUpdate=true;mesh.computeBoundingSphere();}
  }
  resolveSolids(car:Pushable):void {pushOut(car,this.solids);}
  update(camera:THREE.Vector3,vehicle?:Pick<Vehicle,'x'|'z'|'roadName'|'surfaceName'>):void{
    this.water.update(camera,this.boundWater);
    if(vehicle && vehicle.roadName===null && this.site.contains(vehicle.x,vehicle.z)){const e=vehicle.x+this.site.village[0],n=this.site.village[1]-vehicle.z;vehicle.roadName=onApron(e,n)?'Sugar Camp unloading apron':vehicle.surfaceName==='dirt track'?'Sugar Camp tracks':null;}
    const box=this.site.box,dx=Math.max(box[0]-camera.x,0,camera.x-box[2]),dz=Math.max(box[1]-camera.z,0,camera.z-box[3]);
    this.fixtures.visible=Math.hypot(dx,dz)<2200;
    if(!this.fixtures.visible){this.rocks.update(camera);return;}
    let hash=0;
    for(const child of this.terrain.group.children)if(child.visible){const hide=(child as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>).material?.uniforms?.hideQuad?.value as THREE.Vector4|undefined;hash=(Math.imul(hash,31)+child.id+(hide?hide.x+hide.y*2+hide.z*4+hide.w*8:0))|0;}
    const changed=hash!==this.signature;
    if(changed){this.signature=hash;this.revision++;this.build();}
    this.rocks.update(camera);
    if(changed){
    this.bedRunout();
    this.solids.length=this.staticSolids.length;for(let i=0;i<this.staticSolids.length;i++)this.solids[i]=this.staticSolids[i];
    for(const b of this.rocks.blocks)if(b.size>.4)this.solids.push({x:b.x,z:b.z,half:b.size*.9,halfWidth:b.size*1.1,heading:Math.PI-b.turn});
    }

  }
  private build():void{
    this.feet.length=0;this.portalBeamVertices.length=0;
    const m=new Mesher(),signs=new Mesher();
    const h=(e:number,n:number)=>{const p=this.world(e,n);return this.terrain.meshHeightAt(p.x,p.z,true);};
    const foot=(x:number,z:number,y:number,kind:string,first:number,last:number)=>{
      const vertices:number[]=[],seen=new Set<string>();
      for(let i=first;i<last;i++){const k=i*3;if(Math.abs(m.pos[k+1]-y)>.00001)continue;const key=m.pos[k]+','+m.pos[k+2];if(!seen.has(key)){seen.add(key);vertices.push(i);}}
      this.feet.push({x,z,y,kind,vertices});
    };
    const post=(e:number,n:number,height:number,width:number,colour:RGB,kind='post')=>{const y=h(e,n);if(y===null)return;const p=this.world(e,n),first=m.pos.length/3;m.at(p.x,y-.2,p.z).box(0,height/2,0,width,height,width,colour);foot(p.x,p.z,y-.2,kind,first,m.pos.length/3);};
    this.boards.forEach((b,i)=>{
      const y=h(b.e,b.n);if(y===null)return;const p=this.world(b.e,b.n);
      for(const side of [-1,1]){const e=b.e+Math.cos(b.yaw)*side*(b.width/2-.5),n=b.n+Math.sin(b.yaw)*side*(b.width/2-.5),ground=h(e,n);
        post(e,n,b.portal&&ground!==null?y+8.2-ground:3.4,b.portal?.5:.22,TIMBER,b.portal?'portal':'board');}
      const lift=b.lift??2.4;
      const beamFirst=m.pos.length/3;
      m.at(p.x,y+lift,p.z,b.yaw).box(0,0,-.07,b.width+.16,b.height+.16,.14,TIMBER,!b.portal);
      if(b.portal)for(let v=beamFirst;v<m.pos.length/3;v++)this.portalBeamVertices.push(v);
      if(b.portal)for(const side of [-1,1])m.box(side*(b.width/2-.5),.25,-.16,.8,1.0,.25,STEEL);
      signs.at(p.x,y+lift,p.z,b.yaw).plate(b.width,b.height,this.signCells[i],.14);
    });
    for(const side of [-1,1]){
      const e=GATE.e+Math.cos(GATE.heading)*side*5.4,n=GATE.n-Math.sin(GATE.heading)*side*5.4;post(e,n,1.8,.32,STEEL,'gate');
      const a=this.world(e,n),b=this.world(e+Math.sin(GATE.heading)*6,n+Math.cos(GATE.heading)*6),ha=h(e,n),hb=h(e+Math.sin(GATE.heading)*6,n+Math.cos(GATE.heading)*6);
      if(ha!==null&&hb!==null){m.at((a.x+b.x)/2,(ha+hb)/2+.9,(a.z+b.z)/2,Math.atan2(b.x-a.x,b.z-a.z),Math.atan2(ha-hb,6));for(const y of [-.45,.45])m.box(0,y,0,.09,.09,6,STEEL);for(let i=-3;i<=3;i++)m.box(0,0,i,.06,.9,.06,STEEL);}
    }
    for(let d=-7;d< -2;d+=.25){
      const e=GATE.e+Math.sin(GATE.heading)*d,n=GATE.n+Math.cos(GATE.heading)*d,y=h(e,n);if(y===null)continue;
      const p=this.world(e,n);m.at(p.x,y+.025,p.z,-GATE.heading).box(0,0,0,4.8,.045,.065,STEEL);
    }
    // A small hut with a broad eave, one door and a dark window. Its base is set into the visible land.
    const hut=this.world(PARK_HUT.e,PARK_HUT.n),hy=h(PARK_HUT.e,PARK_HUT.n);
    if(hy!==null){const corners=[h(PARK_HUT.e-1.7,PARK_HUT.n-2.1),h(PARK_HUT.e+1.7,PARK_HUT.n-2.1),h(PARK_HUT.e-1.7,PARK_HUT.n+2.1),h(PARK_HUT.e+1.7,PARK_HUT.n+2.1)];
      if(corners.every((y):y is number=>y!==null)){const base=Math.min(...corners)-.2,first=m.pos.length/3;m.at(hut.x,base,hut.z).box(0,1.5,0,3.4,3,4.2,HUT);foot(hut.x,hut.z,base,'hut',first,m.pos.length/3);m.box(0,3.1,0,3.9,.2,4.7,STEEL);m.box(-.6,1.2,2.12,1,2.3,.04,TIMBER);m.box(.9,1.9,2.13,.9,.7,.04,[.06,.12,.13]);}
    }
    for(const p of LOOKOFFS){
      for(let d=-8;d<=8;d+=2){post(p.e+8,p.n+d,1.35,.16,STEEL,'rail');}
      for(let d=-8;d<8;d+=2){const e=p.e+8,n=p.n+d,a=h(e,n),b=h(e,n+2);if(a===null||b===null)continue;const q=this.world(e,n+1);for(const y of [.65,1.15])m.at(q.x,(a+b)/2+y,q.z,0,Math.atan2(b-a,2)).box(0,0,0,.09,.09,Math.hypot(2,b-a)+.12,STEEL);}
    }
    for(let i=0;i<11;i++)for(const side of [-1,1]){const d=i*10;post(GATE.e+Math.sin(GATE.heading)*d+Math.cos(GATE.heading)*side*5.8,GATE.n+Math.cos(GATE.heading)*d-Math.sin(GATE.heading)*side*5.8,1,.16,i%2?PALE:TIMBER,'marker');}
    [[632008,5061922],[632012,5061935]].forEach(([e,n],i)=>{post(e,n,6,.14,STEEL,'flag');const y=h(e,n);if(y===null)return;const p=this.world(e,n);m.at(p.x,y+5,p.z).quad([[0,0,0],[1.9,-.2,.1],[1.9,.8,.1],[0,1,0]],i?[.85,.53,.12]:[.18,.50,.32]);});
    for(const old of [...this.fixtures.children]){this.fixtures.remove(old);(old as THREE.Mesh).geometry.dispose();}
    for(const [mesher,material] of [[m,this.plain],[signs,this.signMaterial]] as const){const mesh=new THREE.Mesh(mesher.geometry(),material);mesh.userData.shadowSet=true;mesh.castShadow=false;this.fixtures.add(mesh);}
  }
}
