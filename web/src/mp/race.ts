import * as THREE from 'three';
import { mountRoomCard, removeRoomCard, RoomCountdown } from './room-cards';
import { GATE_RADIUS, RACE_LIMIT, type RaceRoute } from './race-wire';
import { raceRoutes } from './race-routes';
import type { MultiplayerHost } from './index';
import type { Net } from './net';

/** UI and road markers exist only after multiplayer consent, and disappear with that connection. */
export class RaceView {
  readonly group = new THREE.Group();
  private readonly panel: HTMLDetailsElement | null;
  private readonly readout: HTMLDivElement | null;
  private readonly status = document.createElement('p');
  private readonly countdown: RoomCountdown;
  private readonly results = document.createElement('ol');
  private readonly select = document.createElement('select');
  private readonly start = document.createElement('button');
  private readonly cancel = document.createElement('button');
  private choices: RaceRoute[] = [];
  private choiceOrigin: {x:number;z:number} | null = null;
  private readonly geometry = new THREE.CylinderGeometry(GATE_RADIUS,GATE_RADIUS,.18,24,1,true);
  private readonly nextMat = new THREE.MeshBasicMaterial({color:0xffca64,side:THREE.DoubleSide,depthWrite:false});
  private readonly otherMat = new THREE.MeshBasicMaterial({color:0x53bfd5,side:THREE.DoubleSide,depthWrite:false});
  private serial = -1; private next = -1; private text = '';
  constructor(private net: Net, private host: MultiplayerHost) {
    host.scene.add(this.group);
    this.countdown = new RoomCountdown('raceCountdown', !!host.bare);
    // Phone race controls belong to the scrollable settings panel, outside the driving surface.
    const settings = host.touch ? document.getElementById('settings') : null;
    this.panel = host.bare ? null : document.createElement('details');
    const phoneStatus = host.touch && !host.bare ? document.getElementById('phoneStatus') : null;
    this.readout = phoneStatus?.appendChild(Object.assign(document.createElement('div'), { id:'raceReadout', hidden:true })) ?? null;
    if (!this.panel) return;
    this.panel.id='racePanel';this.panel.hidden=true;
    mountRoomCard(this.panel, host.touch);
    const summary=document.createElement('summary');summary.textContent='Room race';
    if (settings) summary.style.cssText='min-height:56px;box-sizing:border-box;padding:16px 0;cursor:pointer';
    const label=document.createElement('label');label.textContent='Short road course ';this.select.setAttribute('aria-label','Short road course');label.append(this.select);
    this.start.textContent='Start · 5 seconds';this.cancel.textContent='Clear race';

    if (settings) this.select.style.minHeight='56px';
    this.status.setAttribute('role','status');
    this.panel.append(summary,label,this.start,this.cancel,this.status,this.results);
    this.select.onchange=()=>{ if(this.select.value==='')return; const route=this.choices[Number(this.select.value)];if(route)this.net.raceCommand('select',route); };
    this.start.onclick=()=>this.net.raceCommand('start');this.cancel.onclick=()=>this.net.raceCommand('cancel');
    this.panel.addEventListener('keydown',e=>e.stopPropagation());
    this.panel.addEventListener('toggle',()=>{if(this.panel?.open && !this.net.race?.route)this.choiceOrigin=null;});
  }
  private roadName(route: RaceRoute): string { return this.host.roads?.find(r=>r.id===route.roadId)?.name ?? 'Road course'; }
  update(): void {
    const s=this.net.race,me=this.net.me;
    if(this.panel)this.panel.hidden=!s || this.net.status!=='on';
    if(this.readout)this.readout.hidden=!s?.route || !me || this.net.status!=='on';
    if(!s || !me || this.net.status!=='on'){this.countdown.update(null);this.group.visible=false;return;}
    const now=this.net.serverNow(), racer=s.racers.find(r=>r.id===me.id), host=s.host===me.id;
    const cue=this.countdown.update(s.route && s.startAt ? s.startAt-now : null);
    const active=!!s.startAt && now-s.startAt<RACE_LIMIT && s.racers.some(r=>r.time===null&&!r.out);
    this.group.visible=!!s.route;
    this.select.disabled=!host || active;this.start.disabled=!host || !s.route || !!s.startAt || this.net.game?.phase===1 || this.net.game?.phase===2 || Math.hypot(this.host.vehicle.x-s.route.gates[0].x,this.host.vehicle.z-s.route.gates[0].z)>GATE_RADIUS || Math.abs(this.host.vehicle.speed)>=1;
    this.cancel.disabled=!host || !s.route;
    if(host && !s.route && (!this.choiceOrigin || Math.hypot(this.host.vehicle.x-this.choiceOrigin.x,this.host.vehicle.z-this.choiceOrigin.z)>=50)){
      this.choiceOrigin={x:this.host.vehicle.x,z:this.host.vehicle.z};
      this.choices=raceRoutes(this.host.roads ?? [],this.host.vehicle);
      this.select.replaceChildren(new Option('Pick a short road course',''));
      this.choices.forEach((r,i)=>this.select.add(new Option(`${this.roadName(r)} · ${Math.round(r.gates.reduce((d,p,j)=>j?d+Math.hypot(p.x-r.gates[j-1].x,p.z-r.gates[j-1].z):0,0))} m`,String(i))));
    }
    const next=s.startAt>now?0:racer?.next ?? 0;
    if(this.serial!==s.serial || this.next!==next){
      this.serial=s.serial;this.next=next;this.group.clear();
      if(!s.route)this.select.value='';
      s.route?.gates.forEach((p,i)=>{const marker=new THREE.Mesh(this.geometry,i===next?this.nextMat:this.otherMat);marker.position.set(p.x,(this.host.ground(p.x,p.z)??0)+.5,p.z);marker.visible=i>=next;this.group.add(marker);});
    }
    // Terrain can load after the race message.
    for(const marker of this.group.children){const y=this.host.ground(marker.position.x,marker.position.z);if(y!==null)marker.position.y=y+.5;}
    let say=!s.route ? (host?'':'The room host picks the course.') : `${this.roadName(s.route)} · drive to the gold start ring; stop inside it.`;
    if(s.startAt){
      const left=Math.ceil((s.startAt-now)/1000);
      say=left>0?`Start in ${cue} · stay inside the start ring.`:racer?.out?'Out · left start early, reset or disconnected.':racer?.time!==null&&racer?.time!==undefined?`Finished · ${(racer.time/1000).toFixed(2)} s`:now-s.startAt>=RACE_LIMIT?'Race timed out.':racer?`GO · checkpoint ${Math.min(next+1,s.route?.gates.length??0)}/${s.route?.gates.length} · ${((now-s.startAt)/1000).toFixed(1)} s`:'Spectating · join the next race.';
    }
    const target=s.route?.gates[next];
    if(target && !racer?.out && racer?.time==null){const dx=target.x-this.host.vehicle.x,dz=target.z-this.host.vehicle.z,distance=Math.hypot(dx,dz);const direction=['north','north-east','east','south-east','south','south-west','west','north-west'][Math.round((Math.atan2(dx,-dz)+Math.PI*2)/(Math.PI/4))%8];if(!s.startAt || s.startAt<=now) say+=distance<5?' You are at the gold ring.':` ${Math.round(distance)} m ${direction} to the gold ring.`;}
    if(this.net.game?.phase===1||this.net.game?.phase===2)say+=' A room game is on: races wait for it.';
    if(!host)say+=' Host controls the race.';
    const summary=this.panel?.querySelector('summary');if(summary)summary.textContent=s.startAt&&s.startAt>now?`Race starts in ${Math.ceil((s.startAt-now)/1000)}`:racer?.time!==null&&racer?.time!==undefined?'Race finished · results':active&&racer&&!racer.out?`Race · ${((now-s.startAt)/1000).toFixed(1)} s`:'Room race';
    if(this.readout){
      const text=s.startAt>now?`Race starts in ${Math.ceil((s.startAt-now)/1000)}`
        :racer?.time!==null&&racer?.time!==undefined?`Finished · ${(racer.time/1000).toFixed(2)} s`
        :racer?.out?'Race · out':s.startAt&&now-s.startAt>=RACE_LIMIT?'Race timed out.'
        :s.startAt?`Race · ${((now-s.startAt)/1000).toFixed(1)} s`:'Room race';
      if(this.readout.textContent!==text)this.readout.textContent=text;
    }
    if(cue==='GO' && !racer?.out)say='GO';
    if(say!==this.text){this.status.textContent=this.text=say;}
    const rows=s.racers.map(r=>({r,name:this.host.label?.(this.net.names.get(r.id) ?? `Driver ${r.id}`,r.id) ?? this.net.names.get(r.id) ?? `Driver ${r.id}`})).sort((a,b)=>(a.r.time??Infinity)-(b.r.time??Infinity));
    const text=rows.map(({r,name})=>`${name}: ${r.time!==null?(r.time/1000).toFixed(2)+' s':r.out?'out':now-s.startAt>=RACE_LIMIT?'timed out':s.startAt>now?'on grid':'racing'}`);
    if(this.results.textContent!==text.join(''))this.results.replaceChildren(...text.map(t=>Object.assign(document.createElement('li'),{textContent:t})));
  }
  dispose():void{this.countdown.dispose();removeRoomCard(this.panel);this.readout?.remove();this.host.scene.remove(this.group);this.group.clear();this.geometry.dispose();this.nextMat.dispose();this.otherMat.dispose();}
}
