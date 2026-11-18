import { tripId, tripStorageKey } from './quarry-trip';
import { routeProgress, type QuarryRoute, type TripPose } from './quarry-route';
import { onApron, PARK_NOTICE } from './quarry-site';
import type { Roads } from './roads';
import type { Vehicle } from './vehicle';
import type { MiniMap } from './minimap';
export function quarryCard():void {
  const card=document.getElementById('titleCard');
  if(card&&!document.getElementById('quarryNotice')){const p=document.createElement('p');p.id='quarryNotice';p.textContent=PARK_NOTICE;card.querySelector('h1')?.after(p);}
}
/** A trip owns its route, HUD and reload pose. It never changes a session with no recognised trip. */
export class QuarryJourney {
  readonly route:QuarryRoute;
  readonly start:TripPose;
  readonly hud=document.createElement('div');
  remaining=0;
  arrived=false;
  private timer=1;
  private saveTimer=0;
  private readonly key:string;
  constructor(params:URLSearchParams,roads:Roads,private village:readonly [number,number],private driven:()=>Vehicle,private miniMap:MiniMap|null,route:QuarryRoute){
    const id=tripId(params)!;this.key=tripStorageKey(id);this.route=route;this.start=id==='quarry'?this.route.start:this.route.near;
    this.remaining=this.route.length-routeProgress(this.route,this.start.x,this.start.z);
    this.hud.id='tripHud';this.hud.setAttribute('role','status');this.hud.title=this.route.joins.length?this.route.joins.map(g=>`Mapped junction offset ${g.metres.toFixed(2)} m at E${(g.a.x+village[0]).toFixed(2)} N${(village[1]-g.a.z).toFixed(2)}`).join('; '):'Connected mapped road graph';
    const css=document.createElement('style');css.textContent=`#tripHud{position:fixed;left:12px;bottom:22px;z-index:4;max-width:calc(100% - 30px);box-sizing:border-box;padding:9px 12px;border:1px solid #8cc9bc;border-radius:5px;background:#112723e8;color:#ecf1e8;font:700 13px/1.35 system-ui;pointer-events:none}#tripHud[hidden]{display:none}body.tcOn #tripHud{position:static;padding:2px 6px;max-width:100%;font-size:10px;line-height:12px}body.tcOn #phoneStatus:has(#tripHud){gap:2px}@media(orientation:portrait){body.tcOn #phoneStatus:has(#tripHud){max-height:none;overflow:visible}}@media(orientation:landscape) and (max-width:650px){body.tcOn #tripHud{font-size:9px;line-height:10px;padding:0 4px}}`;document.head.append(css);document.body.append(this.hud);
    miniMap?.setRoute(this.route.points,this.route.destination);
    if(import.meta.env.DEV&&this.route.joins.length)console.info('Quarry graph joins: <=0.35 m, matching bridge status, baked elevations within 1 m',this.hud.title);
  }
  place(place?:(x:number,z:number,heading:number)=>void):void {
    const vehicle=this.driven();let pose=this.start,resumeComplete=false;
    try{const saved=JSON.parse(sessionStorage.getItem(this.key)??'null') as (TripPose&{arrived?:boolean})|null;
      resumeComplete=saved?.arrived===true;
      if(resumeComplete)pose={...this.route.destination,heading:this.route.near.heading};
      if(saved&&[saved.x,saved.z,saved.heading].every(Number.isFinite)&&Math.hypot(saved.x-this.start.x,saved.z-this.start.z)<40000&&vehicle.placementGuard?.(saved)!==false)pose=saved;
    }catch{/* no saved trip */}
    if(place)place(pose.x,pose.z,pose.heading);else vehicle.restart(pose.x,pose.z,pose.heading);
    if(resumeComplete)this.completeArrival();
  }
  /** An explicit new approach; driving out of the park does not undo a completed trip. */
  restart():void {
    this.arrived=false;this.timer=1;this.saveTimer=2;
    const v=this.driven();this.remaining=Math.max(0,this.route.length-routeProgress(this.route,v.x,v.z));
    this.miniMap?.setRoute(this.route.points,this.route.destination);
    try{sessionStorage.removeItem(this.key);}catch{/* storage blocked */}
  }
  private completeArrival():void {
    if(this.arrived)return;
    this.arrived=true;this.remaining=0;this.saveTimer=2;
    this.miniMap?.setRoute([],this.route.destination);
  }
  update(dt:number,enabled:boolean):void {
    const v=this.driven(),host=document.body.classList?.contains('tcOn')?document.getElementById('phoneStatus'):null;
    if(host&&this.hud.parentElement!==host)host.append(this.hud);
    else if(!host&&this.hud.parentElement!==document.body)document.body.append(this.hud);
    this.hud.hidden=!enabled;this.timer+=dt;this.saveTimer+=dt;if(this.timer<.25)return;this.timer=0;
    const atApron=onApron(v.x+this.village[0],this.village[1]-v.z);
    if(atApron&&Math.abs(v.speed)<.3)this.completeArrival();
    const at=this.arrived?this.route.length:routeProgress(this.route,v.x,v.z);this.remaining=Math.max(0,this.route.length-at);
    const next=this.route.turns.find(t=>t.at>at+8),left=next?Math.max(0,next.at-at):this.remaining;
    const distance=this.remaining>=1000?`${(this.remaining/1000).toFixed(1)} km`:`${Math.round(this.remaining)} m`;
    this.hud.textContent=this.arrived?(atApron?'Arrived · Sugar Camp unloading apron':'Trip complete · Free driving'):next?`${next.side} onto ${next.name} in ${Math.round(left/10)*10} m · ${distance} left`:`Sugar Camp unloading apron · ${distance} left`;
    this.hud.dataset.remaining=String(Math.round(this.remaining));
    if(enabled&&this.saveTimer>1){this.saveTimer=0;try{sessionStorage.setItem(this.key,JSON.stringify({x:v.x,z:v.z,heading:v.heading,...(this.arrived?{arrived:true}:{})}));}catch{/* storage blocked */}}
  }
}
