import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';
import { YardDogRules } from './yard-dog-rules';
import type { YardDogSite } from './yard-dog-site';

/** One unnamed tan yard dog. No downloaded model, image or recording. Local forward is -Z. */
export class YardDog {
  readonly group=new THREE.Group();
  readonly rules:YardDogRules;
  private rig:THREE.Group|null=null;
  private head=new THREE.Group();private jaw=new THREE.Group();private tail=new THREE.Group();
  private legs:THREE.Group[]=[];private posts:THREE.Group[]=[];private time=0;private barkPose=0;
  private audio:AudioContext|null=null;private voice:GainNode|null=null;
  private readonly material=new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true});
  private readonly unlock=()=>{
    try {this.audio??=new AudioContext();void this.audio.resume().catch(()=>{});}catch { /* Sound is optional. */ }
  };
  constructor(readonly site:YardDogSite,private readonly terrain:Terrain) {
    this.rules=new YardDogRules(site.edge);
    addEventListener('pointerup',this.unlock,{once:true});addEventListener('keydown',this.unlock,{once:true});
  }
  private shape(parent:THREE.Group,colour:number,x:number,y:number,z:number,sx:number,sy:number,sz:number):void {
    const geometry=new THREE.IcosahedronGeometry(1,1),c=new THREE.Color(colour),colours=[];
    for(let i=0;i<geometry.attributes.position.count;i++){const shade=.91+(Math.floor(i/3)%5)*.035;colours.push(c.r*shade,c.g*shade,c.b*shade);}
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
    const mesh=new THREE.Mesh(geometry,this.material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);
  }
  private build():void {
    const dog=new THREE.Group();dog.rotation.order='YXZ';this.rig=dog;this.group.add(dog);
    const tan=0xb88b54,cream=0xe4cf9b,dark=0x302a24;
    this.shape(dog,tan,0,.49,.04,.22,.25,.48);
    this.shape(dog,cream,0,.48,-.25,.19,.26,.2);
    for(let i=0;i<4;i++){
      const leg=new THREE.Group();leg.position.set((i%2?1:-1)*.15,.48,i<2?-.3:.34);dog.add(leg);
      this.shape(leg,tan,0,-.21,0,.067,.23,.075);this.shape(leg,cream,0,-.43,-.035,.078,.055,.11);this.legs.push(leg);
    }
    dog.add(this.head);this.head.position.set(0,.79,-.36);
    this.shape(this.head,tan,0,0,0,.18,.18,.19);this.shape(this.head,cream,0,-.055,-.18,.115,.085,.19);
    this.shape(this.head,dark,0,-.02,-.35,.065,.048,.04);
    for(const side of [-1,1]){
      this.shape(this.head,dark,side*.19,-.1,.015,.065,.20,.105);
      this.shape(this.head,0x171d19,side*.10,.04,-.15,.027,.027,.021);
    }
    this.head.add(this.jaw);this.jaw.position.set(0,-.11,-.13);this.shape(this.jaw,dark,0,0,-.1,.10,.032,.14);
    this.shape(this.jaw,0xc77977,0,-.015,-.17,.044,.025,.07);
    dog.add(this.tail);this.tail.position.set(0,.59,.46);this.tail.rotation.x=-.45;
    this.shape(this.tail,tan,0,.04,.19,.065,.065,.27);this.shape(this.tail,cream,0,.08,.39,.05,.05,.09);
    // Keep the articulated pivots, merge the rigid parts under each one.
    for(const parent of [dog,this.head,this.jaw,this.tail,...this.legs]){
      const meshes=parent.children.filter((o):o is THREE.Mesh=>o instanceof THREE.Mesh);
      if(meshes.length<2)continue;
      const pieces=meshes.map(m=>{m.updateMatrix();return m.geometry.clone().applyMatrix4(m.matrix);});
      const merged=mergeGeometries(pieces);for(const p of pieces)p.dispose();
      if(merged){for(const m of meshes){parent.remove(m);m.geometry.dispose();}parent.add(new THREE.Mesh(merged,this.material));}
    }
    // A pair of plain timber posts marks the invented property edge, with no sign or address.
    for(const u of [-20,20]) for(const v of [this.site.edge,14]){
      const p=this.site.world(u,v);
      const post=new THREE.Group();post.position.set(p.x,0,p.z);post.visible=false;this.posts.push(post);this.shape(post,0x8a7960,0,.43,0,.11,.43,.11);this.group.add(post);
    }
  }
  private bark(distance:number):void {
    const a=this.audio;if(!a||a.state!=='running'||distance>65)return;
    const now=a.currentTime,osc=a.createOscillator(),filter=a.createBiquadFilter(),gain=a.createGain();
    osc.type='sawtooth';osc.frequency.setValueAtTime(230,now);osc.frequency.exponentialRampToValueAtTime(95,now+.13);
    filter.type='lowpass';filter.frequency.value=1100;
    gain.gain.setValueAtTime(.001,now);gain.gain.linearRampToValueAtTime(.18*Math.max(0,1-distance/65),now+.015);gain.gain.exponentialRampToValueAtTime(.001,now+.16);
    osc.connect(filter).connect(gain).connect(a.destination);osc.start();osc.stop(now+.18);this.voice=gain;
    osc.onended=()=>{osc.disconnect();filter.disconnect();gain.disconnect();if(this.voice===gain)this.voice=null;};
  }
  update(dt:number,vehicle:Pick<Vehicle,'x'|'z'|'vx'|'vz'>):void {
    if(dt<=0){this.voice?.disconnect();this.voice=null;return;}
    const distance=Math.hypot(vehicle.x-this.site.x,vehicle.z-this.site.z);
    if(distance>200){this.group.visible=false;this.rules.reset();this.voice?.disconnect();this.voice=null;return;}
    this.group.visible=distance<180;
    if(!this.rig){
      if(distance>180)return;
      const home=this.site.world(0,14);
      if((this.terrain.surfaceAt(home.x,home.z)?.level??0)<8)return;
      this.build();
    }
    for(const post of this.posts){const ground=this.terrain.surfaceAt(post.position.x,post.position.z);post.visible=!!ground&&ground.level>=8;if(post.visible&&ground)post.position.y=ground.ground;}
    const local=this.site.local(vehicle),velocity=vehicle.vx*Math.sin(this.site.heading)-vehicle.vz*Math.cos(this.site.heading);
    const before=this.site.world(this.rules.along,this.rules.across);
    this.rules.update(dt,local.along,local.across,velocity);this.time+=dt;
    const p=this.site.world(this.rules.along,this.rules.across),y=this.terrain.heightAt(p.x,p.z);
    if(y===null||!this.rig)return;
    this.rig.position.set(p.x,y,p.z);
    const dx=p.x-before.x,dz=p.z-before.z;
    this.rig.rotation.y=this.rules.moving?-Math.atan2(dx,-dz):-Math.atan2(vehicle.x-p.x,-(vehicle.z-p.z));
    const heading=-this.rig.rotation.y,fx=Math.sin(heading)*.3,fz=-Math.cos(heading)*.3,rx=Math.cos(heading)*.15,rz=Math.sin(heading)*.15;
    const front=this.terrain.heightAt(p.x+fx,p.z+fz)??y,back=this.terrain.heightAt(p.x-fx,p.z-fz)??y;
    const right=this.terrain.heightAt(p.x+rx,p.z+rz)??y,left=this.terrain.heightAt(p.x-rx,p.z-rz)??y;
    this.rig.rotation.x=Math.atan2(front-back,.6);this.rig.rotation.z=Math.atan2(right-left,.3);
    for(let i=0;i<this.legs.length;i++)this.legs[i].rotation.x=this.rules.moving?Math.sin(this.time*17+(i===0||i===3?0:Math.PI))*.55:0;
    this.tail.rotation.y=Math.sin(this.time*8)*.28;
    if(this.rules.bark){this.barkPose=.18;this.bark(distance);}
    this.barkPose=Math.max(0,this.barkPose-dt);this.jaw.rotation.x=this.barkPose>0?.5:0;this.head.rotation.x=this.barkPose>0?-.12:0;
  }
  dispose():void {
    removeEventListener('pointerup',this.unlock);removeEventListener('keydown',this.unlock);
    this.group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});this.material.dispose();void this.audio?.close();
  }
}
