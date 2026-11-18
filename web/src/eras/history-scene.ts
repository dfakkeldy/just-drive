import {historyRoadText} from './history-road-names';
import {historyLayout,type HistoryLayout} from './history-layout';
import {HistoryContacts,type HistoryContact} from './history-contacts';
import{HistoryEffects}from'./history-effects';
import{HistoryLife}from'./history-life';
import {HistoryBoards} from './history-boards';
import * as THREE from 'three';
import { clearBoxes, type Building } from '../buildings';
import type { Roads } from '../roads';
import type { RoadNetwork } from '../places';
import type { StreamFile } from '../streams';
import type { Terrain } from '../terrain';
import type { Vehicle } from '../vehicle';
import { pushOut, type Solid } from '../parked';
import { HistoryGrid, solidRadius } from './history-grid';
import { Mesher } from '../yard-kit';
import { historyPlaces, siteCorners, farmBarn, type PeriodSite } from './history-sites';
import { MAX_EXPOSED_FOUNDATION, periodBaseHeight, createHistoryMaterial, periodBuilding, periodGroundPoints, periodProfile, historyGeometry, waterWheel } from './history-art';

interface Model { profile:ReturnType<typeof periodProfile>; barnEave:number; notify:()=>void; queued:boolean; solidsPublished:boolean; selection:number; fitCount:number; foundationNeedsResiting:boolean; refs:HistoryContact[]; site: PeriodSite; node: THREE.Group; foundation: THREE.Mesh; art: THREE.Mesh; sign?: THREE.Mesh; samples: Float64Array; sources:Float64Array; contacts:Float64Array; ready:boolean; active:boolean; solids: Solid[]; wheel?: THREE.Mesh; barn?: THREE.Mesh }
/** One era's constructed scenery. Terrain data, trees, vehicle art and today's places are not copied. */
export class HistoryScene {
  readonly group = new THREE.Group();
  readonly boards:HistoryBoards;
  readonly life:HistoryLife;private effects:HistoryEffects;
  readonly contacts:HistoryContacts;
  private dirty:Model[]=[];private nextActive:Model[]=[];private selection=0;
  readonly trades: PeriodSite[];
  /** The 1884 area this scene builds. */
  readonly area: string;
  readonly farms: PeriodSite[];
  readonly places;
  readonly farmCounts;
  readonly placeRoads: RoadNetwork;
  readonly models: Model[] = [];
  readonly solids: Solid[] = [];
  readonly audit={heightQueries:0,modelVisits:0,fits:0,collisionCandidatesMax:0,collisionTests:0};
  private modelGrid=new HistoryGrid<Model>(256);
  private solidGrid=new HistoryGrid<{solid:Solid;model:Model}>(32);
  private active:Model[]=[];
  private wheels:Model[]=[];
  private collisionWork:Solid[]=[];
  private cellX=Infinity;private cellZ=Infinity;
  private readonly material = createHistoryMaterial();
  private wheelGeometry = waterWheel();
  constructor(readonly terrain: Terrain, roads: Roads, _streams: StreamFile | null, buildings: readonly Building[], _ground: (x:number,z:number)=>number|null, layout?:HistoryLayout) {
    this.contacts=new HistoryContacts(terrain);
    const origin = terrain.manifest.village;
    this.placeRoads={nearest:(x,z,reach=60)=>roads.nearest(x,z,reach,r=>r.kind>=1&&r.kind<=4)};
    const area=terrain.manifest.area?.id??'mabou';this.area=area;
    const sites=layout??historyLayout(origin,area);
    this.trades=sites.trades;this.farms=sites.farms;
    this.farmCounts=Object.fromEntries((['village','roadside','remote'] as const).map(zone=>{
      const count=this.farms.filter(s=>s.zone===zone).length;return [zone,{candidates:count,target:count,drawn:count}];
    }));
    this.places = historyPlaces(this.trades,origin,area==='judique'?'judique':'mabou').map(p=>({...p,name:historyRoadText(p.name,area),note:historyRoadText(p.note,area)}));
    this.group.name = 'history-1884';
    for (const site of [...this.trades,...this.farms]) {
      const node = new THREE.Group();node.name = site.id;node.visible=false;
      node.position.set(site.x,0,site.z);node.rotation.y=site.yaw;
      const art = new THREE.Mesh(periodBuilding(site),this.material);art.castShadow=art.receiveShadow=true;node.add(art);
      const foundation = new THREE.Mesh(new THREE.BufferGeometry(),this.material);foundation.receiveShadow=true;node.add(foundation);
      const solids: Solid[] = [{x:site.x,z:site.z,heading:Math.PI-site.yaw,half:site.length/2,halfWidth:site.width/2}];
      let barn: THREE.Mesh | undefined;
      const barnSite=farmBarn(site);
      if (barnSite && site.barn) {
        barn=new THREE.Mesh(periodBuilding(barnSite,true),this.material);barn.position.set(site.barn.x,0,site.barn.z);barn.castShadow=true;node.add(barn);
        solids.push({x:barnSite.x,z:barnSite.z,heading:Math.PI-site.yaw,half:6,halfWidth:4});
      }
      const points=[...siteCorners(site),...periodGroundPoints(site).map(([x,z]):[number,number]=>[site.x+x*Math.cos(site.yaw)+z*Math.sin(site.yaw),site.z-x*Math.sin(site.yaw)+z*Math.cos(site.yaw)]),...(barnSite?[...siteCorners(barnSite),...periodGroundPoints(barnSite,true).map(([x,z]):[number,number]=>[barnSite.x+x*Math.cos(site.yaw)+z*Math.sin(site.yaw),barnSite.z-x*Math.sin(site.yaw)+z*Math.cos(site.yaw)])]:[]),...(site.water?(()=>{const dx=site.water.x-site.x,dz=site.water.z-site.z,wx=dx*Math.cos(site.yaw)-dz*Math.sin(site.yaw),wz=dx*Math.sin(site.yaw)+dz*Math.cos(site.yaw);return [[site.water.x,site.water.z] as [number,number],...[-5.4,-1].flatMap(z=>[-.55,.55].map(x=>[site.x+(wx+x)*Math.cos(site.yaw)+(wz+z)*Math.sin(site.yaw),site.z-(wx+x)*Math.sin(site.yaw)+(wz+z)*Math.cos(site.yaw)] as [number,number]))];})():[])];
      const model: Model={profile:periodProfile(site),barnEave:barnSite?periodProfile(barnSite,true).eave:0,notify:()=>{},queued:false,solidsPublished:false,selection:0,fitCount:0,foundationNeedsResiting:false,refs:[],site,node,foundation,samples:new Float64Array(points.length).fill(NaN),sources:new Float64Array(points.length).fill(NaN),contacts:new Float64Array(points.flat()),ready:false,active:false,solids,barn,art,sign:undefined};
      model.notify=()=>this.enqueue(model);
      for(let i=0;i<points.length;i++)model.refs.push(this.contacts.watch(points[i][0],points[i][1],model.notify));
      this.enqueue(model);
      if (site.water) {
        // The wheel turns in a vertical plane along the stream, against the invented mill on a short wooden axle.
        const wheel=new THREE.Mesh(this.wheelGeometry,this.material);wheel.rotation.order='YXZ';wheel.castShadow=true;model.wheel=wheel;
        this.group.add(wheel);wheel.visible=false;
        wheel.position.set(site.water.x,0,site.water.z);wheel.rotation.y=site.water.yaw;
      }
      const corners=[...siteCorners(site,site.kind==='farm'?32:5),...(barnSite?siteCorners(barnSite,32):[]),...(site.water?[[site.water.x-5,site.water.z-5],[site.water.x+5,site.water.z+5]]:[])];
      terrain.clear.push([Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]);
      this.models.push(model);this.group.add(node);
      this.modelGrid.add(model,site.x,site.z,site.x,site.z);
      for(const solid of solids){const r=solidRadius(solid);this.solidGrid.add({solid,model},solid.x-r,solid.z-r,solid.x+r,solid.z+r);}
      if(model.wheel)this.wheels.push(model);
    }
    this.life=new HistoryLife(terrain,roads,this.models,this.contacts);this.group.add(this.life.group);
    this.effects=new HistoryEffects(this.models);this.group.add(this.effects.group);
    this.boards=new HistoryBoards(terrain,roads,this.models,this.material,this.contacts,sites.boards);this.group.add(this.boards.group);
    // Remove canopy impostors of modern roofs too, even when no period farm uses that site.
    // Each block of a large building clears its own cells, not the square round the whole building (roofSites).
    for (const b of buildings) terrain.clear.push(...clearBoxes(b, origin, 2));
  }
  private enqueue(model:Model):void {if(!model.queued){model.queued=true;this.dirty.push(model);}}
  private height(x:number,z:number):number {return this.contacts.height(x,z);}
  update(camera:THREE.Vector3,dt=0):void {
    const x=Math.floor(camera.x/128),z=Math.floor(camera.z/128);
    if(x!==this.cellX||z!==this.cellZ){
      const selection=++this.selection;this.nextActive.length=0;
      const near=this.modelGrid.query(camera.x,camera.z,5300);
      for(let i=0;i<near.length;i++){const m=near[i],radius=m.site.kind==='farm'?2700:5300;if(Math.hypot(m.site.x-camera.x,m.site.z-camera.z)<radius){m.selection=selection;this.nextActive.push(m);if(!m.active){m.active=true;this.enqueue(m);}}}
      for(let i=0;i<this.active.length;i++){const m=this.active[i];if(m.selection!==selection){m.active=false;this.enqueue(m);}}
      const previous=this.active;this.active=this.nextActive;this.nextActive=previous;this.cellX=x;this.cellZ=z;
    }
    this.contacts.update();this.audit.heightQueries=this.contacts.audit.heightQueries;
    for(let i=0;i<this.dirty.length;i++){
      const m=this.dirty[i];m.queued=false;
      if(m.active){
        this.audit.modelVisits++;let changed=!m.ready,known=true;
        for(let j=0;j<m.refs.length;j++){const p=m.refs[j];if(!p.known){known=false;break;}if(Math.abs(p.height-m.samples[j])>.000001)changed=true;m.samples[j]=p.height;m.sources[j]=p.source;}
        if(known){
          let high=-Infinity,low=Infinity;for(let j=0;j<10;j++){high=Math.max(high,m.samples[j]);low=Math.min(low,m.samples[j]);}m.foundationNeedsResiting=high-low>m.profile.eave*.65;m.node.position.y=periodBaseHeight(m.site,high,low,m.profile.eave);
          if(changed){this.audit.fits++;m.fitCount++;this.fit(m);}
          if(!m.solidsPublished){for(let j=0;j<m.solids.length;j++)this.solids.push(m.solids[j]);m.solidsPublished=true;}m.ready=true;
          if(m.wheel&&m.site.water)m.wheel.position.y=this.height(m.site.water.x,m.site.water.z)+2.1;
        }else m.ready=false;
      }
      m.node.visible=m.active&&m.ready;if(m.wheel)m.wheel.visible=m.active&&m.ready;
      this.boards.updateOwner(m);this.life.updateOwner(m);
    }
    this.dirty.length=0;this.effects.update(dt);
    for(let i=0;i<this.wheels.length;i++){const m=this.wheels[i];if(m.active&&m.ready)m.wheel!.rotation.x+=dt*.22;}
  }
  private fit(model:Model):void {
        const s=model.site,p=model.profile,base=model.node.position.y,m=new Mesher(),w=s.width/2,l=s.length/2;
        // Stone plinth meets every drawn corner, while the timber walls and roof stay level.
        const corners=[[-w,-l],[w,-l],[w,l],[-w,l]];
        const height=(x:number,z:number)=>this.height(s.x+x*Math.cos(s.yaw)+z*Math.sin(s.yaw),s.z-x*Math.sin(s.yaw)+z*Math.cos(s.yaw));
        model.art.geometry.dispose();model.art.geometry=periodBuilding(s,false,(x,z)=>height(x,z)-base);
        for(let i=0;i<(s.kind==='quarry'||s.word==='SAW MILL'?0:4);i++){
          const a=corners[i],b=corners[(i+1)%4];
          m.quad([[a[0],height(...a as [number,number])-base-.12,a[1]],[b[0],height(...b as [number,number])-base-.12,b[1]],[b[0],0,b[1]],[a[0],0,a[1]]],[.36,.35,.29]);
        }
        if(s.kind==='quarry'){
          const front=height(0,l+.2)-base,top=front+2.65;
          if(model.sign)model.sign.position.y=front-1;
          for(const side of [-1,1]){const bottom=height(side*2,l+.2)-base-.12;m.box(side*2,(bottom+top)/2,l+.2,.18,top-bottom,.22,[.33,.23,.14]);}
        }
        const front=height(0,p.length/2+1)-base;
        if(s.kind!=='quarry')for(let i=0;i<Math.min(12,Math.floor(-front/.2));i++){
          m.box(0,-(i+1)*.2-.1,p.length/2+.25+i*.32,s.kind==='forge'||s.kind==='stables'?2.8:1.8,.2,.38,[.37,.29,.18]);
        }
        if(model.barn && s.barn){
          const {x:bx,z:bz}=s.barn,corners=[[bx-4,bz-6],[bx+4,bz-6],[bx+4,bz+6],[bx-4,bz+6]];
          const heights=corners.map(([x,z])=>height(x,z)),high=Math.max(...heights),low=Math.min(...heights),by=high-low>model.barnEave*.65?high+.12:Math.min(high+.12,low+MAX_EXPOSED_FOUNDATION-.12);
          model.barn.position.y=by-base;
          model.barn.geometry.dispose();model.barn.geometry=periodBuilding(farmBarn(s)!,true,(x,z)=>height(bx+x,bz+z)-by);
          for(let i=0;i<4;i++){
            const a=corners[i],b=corners[(i+1)%4];
            m.quad([[a[0],height(a[0],a[1])-base-.12,a[1]],[b[0],height(b[0],b[1])-base-.12,b[1]],
              [b[0],by-base,b[1]],[a[0],by-base,a[1]]],[.36,.35,.29]);
          }
        }
        if(s.water){
          const dx=s.water.x-s.x,dz=s.water.z-s.z;
          const wx=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw),wz=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw);
          const wy=this.height(s.water.x,s.water.z)+2.1-base;
          const wall=Math.sign(wx)*p.width/2;
          m.cyl((wall+wx)/2,wy,wz,.14,Math.abs(wx-wall)+1.0,[.32,.23,.14],'x',8);
          // A short sluice brings water to the wheel's upper quarter.
          const flume=wy+1.85;
          m.box(wx,flume,wz-3.1,1.1,.15,5.8,[.32,.27,.19]);
          for(const side of [-1,1])m.box(wx+side*.55,flume+.24,wz-3.1,.12,.55,5.8,[.43,.37,.26]);
          m.box(wx,flume+.09,wz-3.1,.90,.04,5.6,[.055,.085,.07]);
          for(const z of [wz-5.4,wz-1.0])for(const side of [-1,1]){const x=wx+side*.55,bottom=height(x,z)-base-.10;m.box(x,(bottom+flume)/2,z,.16,flume-bottom,.16,[.32,.23,.14]);}

        }
        model.foundation.geometry.dispose();model.foundation.geometry=historyGeometry(m);
  }
  resolve(vehicle:Vehicle):void {
    const candidates=this.solidGrid.query(vehicle.x,vehicle.z,vehicle.spec?.envelope.reach??4);
    this.audit.collisionCandidatesMax=Math.max(this.audit.collisionCandidatesMax,candidates.length);this.collisionWork.length=0;
    for(let i=0;i<candidates.length;i++)if(candidates[i].model.ready)this.collisionWork.push(candidates[i].solid);
    this.audit.collisionTests+=candidates.length;pushOut(vehicle,this.collisionWork);
  }
}
