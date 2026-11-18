/** Renderer-free observations and reports, in metres and seconds. A placement or solid contact cancels a pass. */
export interface TrickSample {
  u:number; v:number; y:number; deck:number|null; airborne:boolean; speed:number; sideways:number;
  pitch:number; roll:number; yaw:number; extent?:number; forwardExtent?:number; contacts:number; placement:number; eligible:boolean;
}
export interface TrickRoute {
  id:string; takeoff:number; takeoffEnd?:number; halfWidth:number; landing:[number,number];
  /** Metres of tested braking clearance beyond the admissible landing zone. */
  runout?:number;
  obstacle?:{near:number;far:number;top:number};
}
export interface TrickReport {
  piece:string; takeoffSpeed:number; airTime:number; distance:number; height:number; heightAboveObstacle:number|null;
  obstacleCleared:boolean; landing:{straight:boolean;onLanding:boolean;speedKept:boolean};
}
export class TrickJudge {
  private previous:TrickSample|null=null;
  private armed=false; private flying=false; private settle=0;
  private startU=0; private startY=0; private speed=0; private seconds=0; private peak=0;
  private clearance=Infinity; private cleared=true; private crossed=false; private landingU=0; private landingSpeed=0; private straight=true; private landingExtent=0; private landingLane=false;
  constructor(readonly route:TrickRoute,readonly halfLength:number,readonly halfWidth:number){}
  reset():void{this.previous=null;this.armed=false;this.flying=false;this.settle=0;}
  get active():boolean{return this.flying||this.settle>0;}
  step(dt:number,s:TrickSample):TrickReport|null {
    try{return this.observe(dt,s);}finally{if(!this.previous)this.previous={...s};else Object.assign(this.previous,s);}
  }
  private observe(dt:number,s:TrickSample):TrickReport|null {
    const p=this.previous;
    if(dt<=0)return null;
    if(!s.eligible||p&&(s.placement!==p.placement||s.contacts!==p.contacts||Math.hypot(s.u-p.u,s.v-p.v)>.6+dt*60)){
      this.armed=this.flying=false;this.settle=0;return null;
    }
    const extent=s.extent??(Math.abs(Math.cos(s.yaw))*this.halfWidth+Math.abs(Math.sin(s.yaw))*this.halfLength);
    const along=s.forwardExtent??(Math.abs(Math.cos(s.yaw))*this.halfLength+Math.abs(Math.sin(s.yaw))*this.halfWidth);
    const lane=Math.abs(s.v)+extent<=this.route.halfWidth;
    if(!this.flying&&this.settle===0){
      if(!s.airborne&&s.deck!==null&&Math.abs(s.y-s.deck)<.2&&s.u<(this.route.takeoffEnd??this.route.takeoff)&&lane)this.armed=true;
      if(this.armed&&s.airborne&&p&&!p.airborne&&s.u>this.route.takeoff-along-1&&s.u<(this.route.takeoffEnd??this.route.takeoff)+along&&s.u>p.u&&s.speed>2){
        this.flying=true;this.startU=s.u;this.startY=s.y;this.speed=s.speed;this.seconds=this.peak=0;this.cleared=true;this.crossed=false;this.clearance=Infinity;
      }else if(!lane||s.u>(this.route.takeoffEnd??this.route.takeoff)+along)this.armed=false;
      return null;
    }
    if(this.flying){
      this.seconds+=dt;this.peak=Math.max(this.peak,s.y-this.startY);
      const o=this.route.obstacle;
      if(o&&s.u+along>=o.near&&s.u-along<=o.far){this.crossed=true;this.clearance=Math.min(this.clearance,s.y-.12-o.top);if(s.y-.12<=o.top||!lane)this.cleared=false;}
      if(!s.airborne){this.flying=false;this.armed=false;this.settle=dt;this.landingU=s.u;this.landingExtent=along;this.landingLane=lane;this.landingSpeed=s.speed;this.straight=lane&&Math.abs(s.yaw)<.25&&Math.abs(s.pitch)<.35&&Math.abs(s.roll)<.35&&Math.abs(s.sideways)<3;}
    }else if(this.settle>0){
      if(s.airborne){this.reset();return null;}
      this.settle+=dt;this.straight&&=Math.abs(s.yaw)<.25&&Math.abs(s.sideways)<3&&Math.abs(s.roll)<.35;
      if(this.settle>=.5){
        const report:TrickReport={piece:this.route.id,takeoffSpeed:this.speed,airTime:this.seconds,distance:this.landingU-this.startU,height:this.peak,heightAboveObstacle:Number.isFinite(this.clearance)?this.clearance:null,
          obstacleCleared:!this.route.obstacle||this.crossed&&this.cleared&&this.landingU-this.landingExtent>this.route.obstacle.far,
          landing:{straight:this.straight,onLanding:this.landingLane&&this.landingU-this.landingExtent>=this.route.landing[0]&&this.landingU+this.landingExtent<=this.route.landing[1],speedKept:this.landingSpeed>=this.speed*.75}};
        this.settle=0;return report;
      }
    }
    return null;
  }
}
