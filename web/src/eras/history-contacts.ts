import type {Terrain} from '../terrain';
import {HistoryGrid} from './history-grid';
export interface HistoryContact {x:number;z:number;height:number;known:boolean;source:number;version:number;land:boolean;checked:number;listeners:(()=>void)[]}
/** Persistent point samples. Visibility is not a source; only changed tiles can request another height read. */
export class HistoryContacts {
  readonly audit={sourceQueries:0,heightQueries:0,changed:0};
  private points:HistoryContact[]=[];private index=new HistoryGrid<HistoryContact>(256);
  private byPoint=new Map<string,HistoryContact>();private initial=true;private revision=-1;private previous=-1;
  private probe={height:0,source:0,drawn:false};
  private key(x:number,z:number,land:boolean):string{return (land?'l:':'m:')+Math.round(x*100000)+','+Math.round(z*100000);}
  constructor(private terrain:Terrain){}
  watch(x:number,z:number,notify:()=>void,land=false):HistoryContact {
    const key=this.key(x,z,land);let p=this.byPoint.get(key);
    if(!p){p={x,z,height:NaN,known:false,source:NaN,version:0,land,checked:-2,listeners:[]};this.byPoint.set(key,p);this.points.push(p);this.index.add(p,x,z,x,z);this.initial=true;}
    if(!p.listeners.includes(notify))p.listeners.push(notify);return p;
  }
  read(x:number,z:number,land=false):number|null {const p=this.byPoint.get(this.key(x,z,land));return p?.known?p.height:null;}
  height(x:number,z:number):number {
    const p=this.byPoint.get(this.key(x,z,false));
    if(!p?.known)throw Error('unregistered or missing history ground contact '+x+','+z);
    return p.height;
  }
  private refresh(p:HistoryContact):void {
    if(p.checked===this.revision)return;p.checked=this.revision;this.audit.sourceQueries++;
    const source=this.terrain.meshContactSource?.(p.x,p.z,p.land)??this.revision;
    if(source===p.source)return;p.source=source;
    let height=NaN,known=false;
    if(source>=0){
      this.audit.heightQueries++;
      if(p.land){const h=this.terrain.constructionHeightAt?this.terrain.constructionHeightAt(p.x,p.z):this.terrain.heightAt(p.x,p.z);known=h!==null;height=h??NaN;}
      else if(this.terrain.meshContactAt){known=this.terrain.meshContactAt(p.x,p.z,this.probe);height=this.probe.height;}
      else{const h=this.terrain.meshHeightAt(p.x,p.z,true)??this.terrain.heightAt(p.x,p.z);known=h!==null;height=h??NaN;}
    }
    if(known!==p.known||known&&Math.abs(height-p.height)>.000001){
      p.known=known;p.height=height;p.version++;this.audit.changed++;
      for(let i=0;i<p.listeners.length;i++)p.listeners[i]();
    }
  }
  private changed=(x0:number,z0:number,x1:number,z1:number):void=>{
    const a=this.index.queryBox(x0,z0,x1,z1);
    for(let i=0;i<a.length;i++){const p=a[i];if(p.x>=x0&&p.x<=x1&&p.z>=z0&&p.z<=z1)this.refresh(p);}
  };
  update():void {
    const revision=this.terrain.contactRevision??this.terrain.dataRevision??0;
    if(!this.initial&&revision===this.previous)return;this.revision=revision;
    if(this.initial||!this.terrain.meshContactChanges?.(this.previous,this.changed))for(let i=0;i<this.points.length;i++)this.refresh(this.points[i]);
    this.initial=false;this.previous=revision;
  }
}
