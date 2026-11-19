import * as THREE from 'three';
import {STUNT_GUIDANCE} from './stunt-guidance';
import type { Terrain,Site } from './terrain';
import { Mesher,SignAtlas,letters,type RGB } from './yard-kit';
import type { Pushable } from './parked';
import {placeStuntSolid,resolveHeightSolid,type LocalSolid,type HeightSolid} from './stunt-solids';
export type {LocalSolid} from './stunt-solids';
import type { VehicleSpec } from './vehicle-spec';
import { TrickJudge,type TrickRoute,type TrickReport,type TrickSample } from './stunt-rules';
import {dressPiece,deckColour,works,beam} from './stunt-visuals';
import {PlacedDressing,type DressingPlacement} from './stunt-dressing';

export type StuntSurface='concrete'|'steel plate'|'timber'|'gravel'|'dirt';
export type Footprint=readonly [number,number,number,number];
export interface Deck {
  box:Footprint; surface:StuntSurface; draw?:boolean; grounded?:boolean; groundedAt?(u:number,v:number):boolean; polar?:{inner:number;outer:number};
  /** Height above the seating plane; null is an exact hole. u is along the run, v across. */
  height(u:number,v:number):number|null;
  /** Breaks are explicitly tessellated; curved parts interpolate their drawn triangles. */
  fence?:'u'|'v'; fenceInset?:number; breaks?:readonly number[]; spacing?:number; thickness?:number; kerbs?:boolean; supports?:boolean;
}
export interface StuntPiece {
  id:string; board:readonly string[]; boardAt?:{u:number;v:number}; visualFootprint?:Footprint; footprint:Footprint; decks:readonly Deck[]; solids:readonly LocalSolid[];
  runup?:number;
  /** A rolling practice feature has no jump-scoring route. */
  practiceKph?:number;
  gradingFootprint?:Footprint;
  marks?:readonly {kind:'start'|'landing'|'gate';u:number;v:number;width:number}[];
  route?:Omit<TrickRoute,'id'>;
  ground?(u:number,v:number):number;
  build?(m:Mesher,low:boolean,seat:(u:number,v:number)=>number,ground:(u:number,v:number)=>number|null):void;
}
export interface StuntExclusion {x:number;z:number;radius:number}
export interface StuntPlacement {piece:StuntPiece;x:number;z:number;heading:number}
/** The kit uses this structural contract; a two-wheel controller does not have to inherit Vehicle. */
export interface StuntRide extends Pushable {
  y:number;pitch:number;roll:number;airborne:boolean;spec:VehicleSpec;
  car:{root:THREE.Object3D;extraWheels?:THREE.Object3D[]};
}
const colour:Record<StuntSurface,RGB>={concrete:[.60,.58,.54],'steel plate':[.09,.11,.14],timber:[.5,.37,.20],gravel:[.34,.32,.28],dirt:[.27,.21,.14]};
const kind:Record<StuntSurface,number>={concrete:9,'steel plate':9,timber:9,gravel:8,dirt:10};
const inside=(b:Footprint,u:number,v:number,margin=0)=>u>=b[0]-margin&&u<=b[2]+margin&&v>=b[1]-margin&&v<=b[3]+margin;

/** A regular cross-grid, with extra longitudinal joints. Queries interpolate exactly the triangles that are drawn. */
export class StuntDeck {
  readonly us:number[]=[];readonly vs:number[]=[];readonly ys:Float64Array;readonly xs:Float64Array;readonly zs:Float64Array;
  constructor(readonly source:Deck,seat:(u:number,v:number)=>number,readonly low:boolean){
    const bounds=source.box,polar=source.polar,b=polar?[0,polar.inner,Math.PI,polar.outer]:bounds,step=(source.spacing??.5)*(low?2:1);
    const du=polar?step/polar.outer:step;
    const nu=Math.ceil((b[2]-b[0])/du);for(let i=0;i<=nu;i++)this.us.push(b[0]+(b[2]-b[0])*i/nu);
    if(!polar){this.us.push(...source.breaks??[]);this.us.sort((a,b)=>a-b);for(let i=this.us.length-1;i>0;i--)if(Math.abs(this.us[i]-this.us[i-1])<1e-8)this.us.splice(i,1);}
    const nv=Math.ceil((b[3]-b[1])/step);for(let i=0;i<=nv;i++)this.vs.push(b[1]+(b[3]-b[1])*i/nv);
    const count=this.us.length*this.vs.length;this.ys=new Float64Array(count);this.xs=new Float64Array(count);this.zs=new Float64Array(count);
    for(let j=0;j<this.vs.length;j++)for(let i=0;i<this.us.length;i++){
      const u=polar?Math.cos(this.us[i])*this.vs[j]:this.us[i],v=polar?Math.sin(this.us[i])*this.vs[j]:this.vs[j],h=source.height(u,v),k=j*this.us.length+i;
      this.xs[k]=u;this.zs[k]=v;this.ys[k]=h===null?NaN:seat(u,v)+h;
    }
  }
  private interval(values:readonly number[],value:number):number {
    let lo=0,hi=values.length-1;while(hi-lo>1){const mid=(lo+hi)>>>1;if(value>values[mid])lo=mid;else hi=mid;}return Math.min(lo,values.length-2);
  }
  private validTriangle(a:number,b:number,c:number):boolean{return Number.isFinite(this.ys[a])&&Number.isFinite(this.ys[b])&&Number.isFinite(this.ys[c]);}
  private triangle(u:number,v:number,a:number,b:number,c:number):number|null {
    if(!this.validTriangle(a,b,c))return null;
    const x=this.xs,z=this.zs,h=this.ys,den=(z[b]-z[c])*(x[a]-x[c])+(x[c]-x[b])*(z[a]-z[c]);
    const A=((z[b]-z[c])*(u-x[c])+(x[c]-x[b])*(v-z[c]))/den,B=((z[c]-z[a])*(u-x[c])+(x[a]-x[c])*(v-z[c]))/den,C=1-A-B;
    if(A< -1e-8||B< -1e-8||C< -1e-8)return null;const y=A*h[a]+B*h[b]+C*h[c];return Number.isFinite(y)?y:null;
  }
  height(u:number,v:number):number|null {
    if(!inside(this.source.box,u,v))return null;
    const polar=this.source.polar,U=polar?Math.atan2(v,u):u,V=polar?Math.hypot(u,v):v;
    if(polar&&(V<polar.inner-1e-8||V>polar.outer+1e-8))return null;
    const a=this.interval(this.us,U),b=this.interval(this.vs,V);
    const n=this.us.length;
    for(let j=Math.max(0,b-1);j<=Math.min(this.vs.length-2,b+1);j++){
      const i=j*n+a,h=this.triangle(u,v,i,i+n,i+1)??this.triangle(u,v,i+1,i+n,i+n+1);if(h!==null)return h;
    }
    return null;
  }
  draw(m:Mesher):void {
    const n=this.us.length,rows=this.vs.length,t=this.source.thickness??.2;m.at(0,0,0);
    const tri=(a:number,b:number,c:number,k:RGB)=>{if(this.validTriangle(a,b,c))m.tri(this.xs[a],this.ys[a],this.zs[a],this.xs[b],this.ys[b],this.zs[b],this.xs[c],this.ys[c],this.zs[c],k);};
    const side=(a:number,b:number,k:RGB)=>{if(Number.isFinite(this.ys[a])&&Number.isFinite(this.ys[b]))m.quad([[this.xs[a],this.ys[a],this.zs[a]],[this.xs[b],this.ys[b],this.zs[b]],[this.xs[b],this.ys[b]-t,this.zs[b]],[this.xs[a],this.ys[a]-t,this.zs[a]]],k);};
    const cell=(i:number,j:number)=>{const a=j*n+i,k=deckColour(this.source,(this.xs[a]+this.xs[a+n+1])/2,(this.zs[a]+this.zs[a+n+1])/2);tri(a,a+n,a+1,k);tri(a+1,a+n,a+n+1,k);if(!this.source.polar){if(j===0)side(a,a+1,k);if(j===rows-2)side(a+n+1,a+n,k);}};
    const planar=(a:number,b:number)=>{const c=(rows-1)*n+a,dx=this.xs[b]-this.xs[a],dz=this.zs[c]-this.zs[a];if(dx<=0||dz<=0)return false;for(let j=0;j<rows;j++)for(let i=a;i<=b;i++){const k=j*n+i,expected=this.ys[a]+(this.ys[b]-this.ys[a])*(this.xs[k]-this.xs[a])/dx+(this.ys[c]-this.ys[a])*(this.zs[k]-this.zs[a])/dz;if(!Number.isFinite(this.ys[k])||Math.abs(this.ys[k]-expected)>1e-10)return false;}return true;};
    if(this.low&&!this.source.polar){
      for(let a=0;a<n-1;){if(!planar(a,a+1)){for(let j=0;j<rows-1;j++)cell(a,j);a++;continue;}let b=a+1;while(b<n-1&&planar(a,b+1))b++;const c=(rows-1)*n+a,d=(rows-1)*n+b,k=deckColour(this.source,(this.xs[a]+this.xs[d])/2,(this.zs[a]+this.zs[d])/2);tri(a,c,b,k);tri(b,c,d,k);side(a,b,k);side(d,c,k);a=b;}return;
    }
    for(let j=0;j<rows-1;j++)for(let i=0;i<n-1;i++)cell(i,j);
  }
}
export class PlacedStunt {
  readonly supportCorners:{x:number;z:number}[];
  readonly group=new THREE.Group();readonly decks:StuntDeck[]=[];readonly solids:HeightSolid[]=[];
  readonly box:[number,number,number,number];readonly sin:number;readonly cos:number;
  readonly sample:TrickSample={u:0,v:0,y:0,deck:null,airborne:false,speed:0,sideways:0,pitch:0,roll:0,yaw:0,contacts:0,placement:0,eligible:false};
  pad:number|null=null;judge:TrickJudge|null=null;judgeRide:StuntRide|null=null;judgeContacts=0;ready=false;triangles=0;queries=0;
  private g00=0;private gu=0;private gv=0;
  constructor(readonly placement:StuntPlacement){
    this.sin=Math.sin(placement.heading);this.cos=Math.cos(placement.heading);
    const f=placement.piece.footprint;this.supportCorners=[this.world(f[0],f[1]),this.world(f[2],f[1]),this.world(f[0],f[3]),this.world(f[2],f[3])];
    const a=placement.piece.footprint,v=placement.piece.visualFootprint,b=v?[Math.min(a[0],v[0]),Math.min(a[1],v[1]),Math.max(a[2],v[2]),Math.max(a[3],v[3])]:a,corners=[this.world(b[0],b[1]),this.world(b[2],b[1]),this.world(b[0],b[3]),this.world(b[2],b[3])];
    this.box=[Math.min(...corners.map(p=>p.x)),Math.min(...corners.map(p=>p.z)),Math.max(...corners.map(p=>p.x)),Math.max(...corners.map(p=>p.z))];
    this.group.position.set(placement.x,0,placement.z);this.group.rotation.y=Math.PI/2-placement.heading;this.group.name=placement.piece.id;
  }
  world(u:number,v:number):{x:number;z:number}{return{x:this.placement.x+u*this.sin+v*this.cos,z:this.placement.z-u*this.cos+v*this.sin};}
  u(x:number,z:number):number{return(x-this.placement.x)*this.sin-(z-this.placement.z)*this.cos;}
  v(x:number,z:number):number{return(x-this.placement.x)*this.cos+(z-this.placement.z)*this.sin;}
  near(x:number,z:number,margin=0):boolean{return inside(this.box,x,z,margin);}
  seat=(u:number,v:number):number=>this.g00+this.gu*u+this.gv*v;
  build(terrain:Terrain,low:boolean,atlas:SignAtlas|null,material:THREE.Material,signMaterial:THREE.Material|null):boolean {
    if(this.ready)return true;
    const b=this.placement.piece.gradingFootprint??this.placement.piece.footprint;let missing=false;
    const ground=(u:number,v:number)=>{const p=this.world(u,v),h=terrain.surfaceAt(p.x,p.z)?.level===8&&(!terrain.drawnLevelAt||terrain.drawnLevelAt(p.x,p.z)===8)?terrain.meshHeightAt(p.x,p.z):null;if(h===null||!Number.isFinite(h)){missing=true;return null;}return h;};
    const a=ground(b[0],b[1]),c=ground(b[2],b[1]),d=ground(b[0],b[3]),fourth=ground(b[2],b[3]);
    if(a===null||c===null||d===null||fourth===null)return false;
    this.gu=(c-a)/(b[2]-b[0]);this.gv=(d-a)/(b[3]-b[1]);this.g00=a-this.gu*b[0]-this.gv*b[1];
    const piece=this.placement.piece;
    // Stage every seat sample before publishing any deck, solid, model or atlas cell.
    const staged=piece.decks.map(deck=>new StuntDeck(deck,(u,v)=>{
      const h=deck.height(u,v),g=ground(u,v);if(g===null){missing=true;return this.seat(u,v);}
      const w=Math.min(1,Math.max(0,(h??0)/.3));return g*(1-w)+this.seat(u,v)*w;
    },low));
    for(const deck of piece.decks)if(deck.supports!==false)for(let u=deck.box[0]+2;u<deck.box[2];u+=4)for(const v of [deck.box[1]+.35,deck.box[3]-.35])if(ground(u,v)===null)missing=true;
    const boardU=piece.boardAt?.u??b[0],boardV=piece.boardAt?.v??b[3]+1.5;for(const u of [boardU-1.05,boardU,boardU+1.05])if(ground(u,boardV)===null)missing=true;
    for(const s of piece.solids)if(s.groundRadius)for(const u of [s.u-s.groundRadius,s.u+s.groundRadius])for(const v of [s.v-s.groundRadius,s.v+s.groundRadius])if(ground(u,v)===null)missing=true;

    if(missing)return false;
    const styling=new Mesher();dressPiece(styling,low,piece,staged,this.seat,(u,v)=>{const h=ground(u,v);if(h===null)missing=true;return h;});
    if(missing)return false;
    const m=new Mesher(),s=new Mesher();
    for(let index=0;index<piece.decks.length;index++){
      const deck=piece.decks[index],drawn=staged[index];this.decks.push(drawn);if(deck.draw!==false)drawn.draw(m);
      if(deck.grounded)for(let u=deck.box[0];u<deck.box[2]-1e-8;u+=1){
        const end=Math.min(u+1,deck.box[2]);for(const v of [deck.box[1],deck.box[3]]){
          const a=drawn.height(u,v),b=drawn.height(end,v),ga=ground(u,v),gb=ground(end,v);if(a===null||b===null||ga===null||gb===null)continue;
          m.at(0,0,0);m.quad([[u,ga-.05,v],[end,gb-.05,v],[end,b,v],[u,a,v]],colour[deck.surface]);
          if(Math.min(a-ga,b-gb)>.05)this.addSolid({u:(u+end)/2,v,half:(end-u)/2,halfWidth:.08,bottom:Math.min(ga,gb),top:Math.max(a,b),underDeck:true},false);
        }
      }
      // Individual pile legs meet drawn ground, even across a sloping or uneven pad.
      if(deck.supports!==false)for(let u=deck.box[0]+2;u<deck.box[2];u+=4)for(const v of [deck.box[1]+.35,deck.box[3]-.35]){
        const top=drawn.height(u,v),floor=ground(u,v);if(top===null||floor===null||top-floor<.28)continue;
        m.at(0,0,0);m.box(u,(floor+top-.2)/2,v,.22,top-.2-floor,.22,works.steel);
        this.addSolid({u,v,half:.11,halfWidth:.11,bottom:floor,top:top-.2},false,true);
      }
      if(deck.kerbs)for(const v of [deck.box[1]-.15,deck.box[3]+.15])for(let u=deck.box[0];u<deck.box[2]-1e-8;u+=2){
        const end=Math.min(u+2,deck.box[2]),mid=(u+end)/2,y=drawn.height(mid,Math.max(deck.box[1],Math.min(deck.box[3],v)));if(y===null)continue;
        m.at(mid,y+.12,v,0,0,Math.atan((drawn.height(end,Math.max(deck.box[1],Math.min(deck.box[3],v)))??y)-(drawn.height(u,Math.max(deck.box[1],Math.min(deck.box[3],v)))??y))/(end-u));
        m.box(0,0,0,Math.hypot(end-u,(drawn.height(end,Math.max(deck.box[1],Math.min(deck.box[3],v)))??y)-(drawn.height(u,Math.max(deck.box[1],Math.min(deck.box[3],v)))??y)),.24,.28,works.timber);
        this.addSolid({u:mid,v,half:(end-u)/2,halfWidth:.14,bottom:y,top:y+.24},false);
      }
    }
    // Full rigid side rails leave the take-off and landing ends open.
    for(const d of this.decks)if(d.source.fence){const b=d.source.box,swap=d.source.fence==='v',start=swap?b[1]:b[0],end=swap?b[3]:b[2],inset=d.source.fenceInset??0,sides=swap?[b[0]-.15+inset,b[2]+.15-inset]:[b[1]-.15+inset,b[3]+.15-inset];
      for(const side of sides){const h=(a:number)=>d.height(swap?Math.max(b[0],Math.min(b[2],side)):a,swap?a:Math.max(b[1],Math.min(b[3],side)));
        for(let a=start;a<end-1e-8;a+=2){const e=Math.min(end,a+2),y0=h(a),y1=h(e);if(y0===null||y1===null)continue;
          this.addSolid({u:swap?side:(a+e)/2,v:swap?(a+e)/2:side,half:(e-a)/2,halfWidth:.05,bottom:Math.min(y0,y1),top:Math.max(y0,y1)+1.1,yaw:swap?Math.PI/2:0},false);
        }
        for(let a=start;a<end-1e-8;){let e=Math.min(end,a+(low?8:4)),y0=h(a),y1=h(e);if(y0===null||y1===null){a=e;continue;}
          if(low){let planar=true;for(let q=a+.5;q<e;q+=.5){const y=h(q);if(y===null||Math.abs(y-(y0+(y1-y0)*(q-a)/(e-a)))>1e-8)planar=false;}if(!planar){e=Math.min(end,a+2);y1=h(e)!;}}
          const x0=swap?side:a,z0=swap?a:side,x1=swap?side:e,z1=swap?e:side;
          if(low){m.at(0,0,0);const nx=swap?.04:0,nz=swap?0:.04;
            m.quad([[x0,y0+1,z0],[x1,y1+1,z1],[x1,y1+1.1,z1],[x0,y0+1.1,z0]],works.steel);
            m.quad([[x0-nx,y0+1.05,z0-nz],[x1-nx,y1+1.05,z1-nz],[x1+nx,y1+1.05,z1+nz],[x0+nx,y0+1.05,z0+nz]],works.steel);
            m.quad([[x0-.04,y0,z0],[x0+.04,y0,z0],[x0+.04,y0+1.1,z0],[x0-.04,y0+1.1,z0]],works.steel);
            m.quad([[x0,y0,z0-.04],[x0,y0,z0+.04],[x0,y0+1.1,z0+.04],[x0,y0+1.1,z0-.04]],works.steel);
          }else{for(const lift of [.45,1.05])beam(m,[x0,y0+lift,z0],[x1,y1+lift,z1],.08,.10,works.steel);m.at(x0,y0+.55,z0);m.box(0,0,0,.08,1.1,.08,works.steel);}a=e;
        }
      }
    }
    piece.build?.(m,low,this.seat,ground);
    for(const value of styling.pos)m.pos.push(value);for(const value of styling.col)m.col.push(value);
    for(const solid of piece.solids){let base:number|undefined;if(solid.groundRadius){base=-Infinity;for(const u of [solid.u-solid.groundRadius,solid.u+solid.groundRadius])for(const v of [solid.v-solid.groundRadius,solid.v+solid.groundRadius])base=Math.max(base,ground(u,v)??this.seat(u,v));}this.addSolid(solid,true,false,base);}
    // Keep supports outside the lettered panel. Its two faces remain readable from either side.
    const bu=boardU,bv=boardV,by=ground(bu,bv)??this.seat(bu,bv);
    for(const side of [-1,1]){const u=bu+side*1.05,floor=ground(u,bv)??this.seat(u,bv),top=by+2.3;m.at(0,0,0);m.box(u,(floor+top)/2,bv,.09,top-floor,.09,[.27,.17,.09]);this.addSolid({u,v:bv,half:.045,halfWidth:.045,bottom:floor,top},false);}
    m.at(bu,by,bv);
    for(const y of [1.27,2.23]){m.box(0,y,0,2.18,.06,.06,[.27,.17,.09]);this.addSolid({u:bu,v:bv,half:1.09,halfWidth:.03,bottom:by+y-.03,top:by+y+.03},false);}
    m.box(0,1.75,0,1.9,.9,.05,[.74,.74,.71]);this.addSolid({u:bu,v:bv,half:.95,halfWidth:.025,bottom:by+1.3,top:by+2.2},false);
    if(missing){this.decks.length=0;this.solids.length=0;return false;}
    if(atlas&&signMaterial){
      const cell=atlas.add(low?256:384,low?96:128,(g,w,h)=>letters(g,w,h,[...piece.board,...(piece.route?['SPEEDS AT HILL 1.5']:[]),...(STUNT_GUIDANCE[piece.id]?.lines??[])],'#171b18','#e4dfce',{border:'#373d32'}));
      s.at(bu,by+1.75,bv+.03);s.plate(1.85,.85,cell.cell,.06);
      const mesh=new THREE.Mesh(s.geometry(),signMaterial);mesh.name=piece.id+' board';this.group.add(mesh);
    }
    for(const mark of piece.marks??[]){const y=this.deckHeight(mark.u,mark.v,Infinity);if(y!==null){m.at(mark.u,y+.004,mark.v);m.box(0,0,0,.12,.003,mark.width,[.72,.45,.04]);}}
    const mesh=new THREE.Mesh(m.geometry(),material);mesh.name=piece.id+' structure';mesh.castShadow=mesh.receiveShadow=true;this.group.add(mesh);
    this.triangles=m.triangles+s.triangles;this.ready=true;return true;
  }
  private addSolid(s:LocalSolid,relative:boolean,underDeck=false,groundBase?:number):void {
    const base=groundBase??(relative?this.seat(s.u,s.v):0),solid=placeStuntSolid(s,this.placement,base);solid.underDeck ||= underDeck;this.solids.push(solid);
  }
  deckHeight(u:number,v:number,ceiling:number):number|null {
    this.queries++;let best:number|null=null;
    for(const deck of this.decks){const h=deck.height(u,v);if(h!==null&&h<=ceiling&&(best===null||h>best))best=h;}return best;
  }
}

/** Surface and vegetation only. A run-up never grades or supplies a raised contact deck. */
export interface StuntRunup {x:number;z:number;heading:number;from:number;to:number;halfWidth:number;canopyMargin:number}
/** Optional shared grade for neighboring lanes on a reserved course bench. */
interface CourseGround {
  contains(x:number,z:number,margin:number):boolean;
  intersectsTile(x:number,z:number,size:number):boolean;
  height(x:number,z:number,surveyed:number):number;
}
export class StuntPark implements Site {
  readonly visualStyleLevels=[8];
  readonly group=new THREE.Group();readonly preserveRoads=true;readonly exclusions:readonly StuntExclusion[];readonly dressing:PlacedDressing[];readonly pieces:PlacedStunt[];readonly box:[number,number,number,number];
  readonly events:TrickReport[]=[];lastLine='';contacts=0;private lineTime=0;
  private atlas:SignAtlas|null=null;private material:THREE.Material|null=null;private signMaterial:THREE.Material|null=null;
  private selected:StuntDeck|null=null;private loading=false;
  private readonly runups:readonly (StuntRunup&{sin:number;cos:number})[];
  get hudLine():string{return this.loading?'Park: loading ground':this.lastLine;}
  contains(x:number,z:number,margin=0):boolean{return inside(this.box,x,z,margin)&&(this.courseGround?.contains(x,z,margin)??true);}
  affectsTile(x:number,z:number,size:number,level:number):boolean {
    return !this.courseGround || level===8 && this.courseGround.intersectsTile(x,z,size);
  }
  constructor(readonly terrain:Terrain,placements:readonly StuntPlacement[],readonly low=false,exclusions:readonly StuntExclusion[]=[],dressing:readonly DressingPlacement[]=[],runups:readonly StuntRunup[]=[],private readonly courseGround?:CourseGround){
    if(!placements.length)throw Error('A park needs at least one piece');
    if(placements.some(p=>'bank' in p.piece||p.piece.decks.some(d=>d.polar)))throw Error('Banked turns are not supported by this kit');
    this.runups=runups.map(p=>({...p,sin:Math.sin(p.heading),cos:Math.cos(p.heading)}));
    this.pieces=placements.map(p=>new PlacedStunt(p));this.dressing=dressing.map(p=>new PlacedDressing(p));this.owners=[this.pieces,this.dressing];
    this.box=[Math.min(...this.pieces.map(p=>p.box[0]))-30,Math.min(...this.pieces.map(p=>p.box[1]))-30,Math.max(...this.pieces.map(p=>p.box[2]))+30,Math.max(...this.pieces.map(p=>p.box[3]))+30];
    for(const p of this.dressing){this.box[0]=Math.min(this.box[0],p.box[0]-3);this.box[1]=Math.min(this.box[1],p.box[1]-3);this.box[2]=Math.max(this.box[2],p.box[2]+3);this.box[3]=Math.max(this.box[3],p.box[3]+3);}
    for(const p of this.runups)for(const u of[p.from-p.canopyMargin,p.to+p.canopyMargin])for(const v of[-p.halfWidth-p.canopyMargin,p.halfWidth+p.canopyMargin]){
      const x=p.x+u*p.sin+v*p.cos,z=p.z-u*p.cos+v*p.sin;
      this.box[0]=Math.min(this.box[0],x);this.box[1]=Math.min(this.box[1],z);this.box[2]=Math.max(this.box[2],x);this.box[3]=Math.max(this.box[3],z);
    }
    this.exclusions=exclusions.filter(e=>inside(this.box,e.x,e.z,e.radius+8));
    this.group.name='Stunt park';for(const p of this.pieces)this.group.add(p.group);for(const p of this.dressing)this.group.add(p.group);terrain.sites.push(this);
  }
  /** Call before the first terrain update. The survey sets pad datums; structures later read drawn triangles. */
  async prepare():Promise<void> {
    if(!this.courseGround)for(const p of this.pieces){const b=p.placement.piece.gradingFootprint??p.placement.piece.footprint,w=p.world((b[0]+b[2])/2,(b[1]+b[3])/2);p.pad=await this.terrain.surveyHeightAt(w.x,w.z);}
    // Fine oriented cells remove real trees without clearing terrain samples outside their own footprint.
    const step=2,x0=Math.floor(this.box[0]/step)*step,x1=Math.ceil(this.box[2]/step)*step;
    for(let z=Math.floor(this.box[1]/step)*step;z<this.box[3];z+=step){let start:number|null=null;
      for(let x=x0;x<=x1;x+=step){const inside=x<x1&&this.clearCanopy(x,z)&&this.clearCanopy(x+step,z)&&this.clearCanopy(x,z+step)&&this.clearCanopy(x+step,z+step);if(inside&&start===null)start=x;if(!inside&&start!==null){this.terrain.addTreeClear([start,z,x,z+step]);start=null;}}
    }


  }
  private runupAt(x:number,z:number,canopy=false):boolean {
    for(const p of this.runups){const dx=x-p.x,dz=z-p.z,u=dx*p.sin-dz*p.cos,v=dx*p.cos+dz*p.sin,m=canopy?p.canopyMargin:0;
      if(u>=p.from-m&&u<=p.to+m&&Math.abs(v)<=p.halfWidth+m)return true;}
    return false;
  }
  clearCanopy(x:number,z:number,level=8):boolean {
    if(level!==8)return false;
    if(this.protection(x,z)===0)return false;
    if(this.runupAt(x,z,true))return true;
    for(const p of this.pieces){const piece=p.placement.piece,u=p.u(x,z),v=p.v(x,z);const polar=piece.decks[0]?.polar;if(piece.id==='footbridge'){const b=piece.decks[1].box,mid=(b[0]+b[2])/2;if(Math.abs(u-mid)<3&&Math.abs(v)<13)return true;}if(polar){const r=Math.hypot(u,v);if(v>=-32&&r>=polar.inner-3&&r<=polar.outer+4)return true;}else{const b=piece.visualFootprint??piece.footprint;if(u>=b[0]-(piece.runup??10)-8&&u<=b[2]+8&&v>=b[1]-8&&v<=b[3]+8)return true;}}
    for(const p of this.dressing)if(p.contains(x,z,1))return true;return false;
  }

  height(x:number,z:number,surveyed:number,level=8):number {
    if(level!==8)return surveyed;
    if(this.courseGround){
      const protection=this.protection(x,z);
      if(!protection)return surveyed;
      let height=this.courseGround.height(x,z,surveyed);
      for(const p of this.pieces)if(p.placement.piece.ground&&p.near(x,z)){
        height+=p.placement.piece.ground(p.u(x,z),p.v(x,z))/this.terrain.exag;
      }
      return surveyed+(height-surveyed)*protection;
    }
    let weight=0,total=0,weighted=0,chosen:PlacedStunt|null=null;
    for(const p of this.pieces){if(p.pad===null||!p.near(x,z,28))continue;const b=p.placement.piece.gradingFootprint??p.placement.piece.footprint,u=p.u(x,z),v=p.v(x,z);
      const outside=Math.max(b[0]-(p.placement.piece.runup??10)-u,u-b[2],b[1]-v,v-b[3],0),t=Math.max(0,Math.min(1,(18-outside)/17));let w=t*t*(3-2*t);
      if(w>=1){chosen=p;weight=1;weighted=p.pad;total=1;break;}
      if(w>0){const a=w/Math.max(1e-8,1-w);total+=a;weighted+=p.pad*a;if(w>weight){weight=w;chosen=p;}}
    }
    let raw=total?surveyed+(weighted/total-surveyed)*weight:surveyed;
    if(chosen){const f=chosen.placement.piece.ground;if(f)raw+=f(chosen.u(x,z),chosen.v(x,z))/this.terrain.exag;}
    const protection=this.protection(x,z);return surveyed+(raw-surveyed)*protection;
  }
  private protection(x:number,z:number):number {
    if(this.courseGround&&!this.courseGround.contains(x,z,0))return 0;
    let weight=1;for(const e of this.exclusions){const t=Math.max(0,Math.min(1,(Math.hypot(x-e.x,z-e.z)-e.radius)/8));weight=Math.min(weight,t*t*(3-2*t));if(!weight)break;}return weight;
  }
  visualStyle(x:number,z:number,out:Uint8Array,k:number,level=8):void {
    if(level!==8)return;
    if(this.protection(x,z)===0)return;
    if(this.runupAt(x,z)&&!this.terrain.protectedRoadAt?.(x,z)){out[k]=0;out[k+1]=255;out[k+2]=0;out[k+3]=255;return;}
    let edge=Infinity,radial=Infinity,lane=0,island=0,coverage=0;
    const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
    for(const p of this.pieces){const b=p.placement.piece.gradingFootprint??p.placement.piece.footprint,u=p.u(x,z),v=p.v(x,z),dx=Math.max(b[0]-(p.placement.piece.runup??10)-u,u-b[2],0),dv=Math.max(b[1]-v,v-b[3],0);if(Math.max(dx,dv)<=29)coverage=1;edge=Math.min(edge,Math.max(dx,dv));radial=Math.min(radial,Math.hypot(dx,dv));
      const polar=p.placement.piece.decks[0]?.polar;
      if(polar){const r=v<0?Math.abs(u):Math.hypot(u,v);if(v>0&&r<9)island=Math.max(island,1-smooth(7,9,r));lane=Math.max(lane,(1-smooth(2.8,4,Math.abs(r-14)))*(1-smooth(18,22,Math.max(-v,0))));}
      else{const along=1-smooth(2,8,Math.max(b[0]-10-u,u-b[2]-4,0));lane=Math.max(lane,along*(1-smooth(1.3,3.6,Math.abs(v))));if(p.placement.piece.id==='footbridge'){const b=p.placement.piece.decks[1].box;lane=Math.max(lane,(1-smooth(1.5,3,Math.abs(u-(b[0]+b[2])/2)))*(1-smooth(10,14,Math.abs(v))));}if(p.placement.piece.id==='tunnel')lane=Math.max(lane,(1-smooth(1.5,3.5,Math.abs(u)))*(1-smooth(38,43,Math.abs(v))));}
    }
    if(edge>29)return;
    const ripple=Math.sin(x*.09+Math.sin(z*.04))*1.4+Math.cos(z*.075)*.8;
    const grass=Math.max(island*(1-lane),smooth(6,17,radial+ripple)*(1-lane),smooth(1.25,1.7,Math.sin(x*.031)+Math.cos(z*.043))*(1-lane)*smooth(0,5,radial));
    const gravel=(1-lane)*(.6+.35*(1-smooth(8,15,radial)))*(1-grass);
    out[k]=Math.round(lane*255);out[k+1]=Math.round(gravel*255);out[k+2]=Math.round(grass*255);out[k+3]=Math.round((1-smooth(22,29,edge))*255*this.protection(x,z)*coverage);
  }
  surface(x:number,z:number,_ground?:number,level=8):{dist:number;half:number;kind:number}|null {
    if(level!==8)return null;
    if(this.protection(x,z)===0)return null;
    if(this.runupAt(x,z)&&!this.terrain.protectedRoadAt?.(x,z))return this.gravel;
    for(const p of this.pieces)if(p.near(x,z,18)){
      const piece=p.placement.piece,b=piece.gradingFootprint??piece.footprint,u=p.u(x,z),v=p.v(x,z);if(inside(b,u,v,18))return this.gravel;
    }return null;
  }
  private gravel={dist:0,half:10,kind:8};
  contactMesh(x:number,z:number):number{return inside(this.box,x,z)&&this.protection(x,z)>0&&!this.terrain.protectedRoadAt(x,z)&&this.terrain.siteGroundChangedAt(this,x,z)?1:0;}
  groundHeight(x:number,z:number):number|null {
    if(!inside(this.box,x,z)||this.protection(x,z)===0)return null;let best:number|null=null;
    for(const p of this.pieces)if(p.ready&&p.group.visible&&p.near(x,z))for(const d of p.decks)if(d.source.grounded||d.source.groundedAt?.(p.u(x,z),p.v(x,z))){const h=d.height(p.u(x,z),p.v(x,z));if(h!==null&&(best===null||h>best))best=h;}
    return best;
  }
  deckHeight(x:number,z:number,_ground?:unknown,ceiling=Infinity):number|null {
    if(!inside(this.box,x,z)||this.protection(x,z)===0)return null;let best:number|null=null;this.selected=null;
    for(const p of this.pieces){if(!p.ready||!p.group.visible||!p.near(x,z))continue;const u=p.u(x,z),v=p.v(x,z);
      for(const d of p.decks){const h=d.height(u,v);if(h!==null&&h<=ceiling&&(best===null||h>best)){best=h;this.selected=d;}}
    }return best;
  }
  deckDriving=():{kind:number;halfWidth:number}=>this.selected?this.driving.get(this.selected.source)!:this.fallback;
  private driving=new Map<Deck,{kind:number;halfWidth:number}>();private fallback={kind:8,halfWidth:3.5};
  update(dt:number,ride:StuntRide,cam:THREE.Vector3):void {
    if(this.lineTime>0){this.lineTime-=dt;if(this.lineTime<=0)this.lastLine='';}
    if(!this.contains(ride.x,ride.z,250)&&!this.contains(cam.x,cam.z,250)){this.group.visible=false;this.loading=false;return;}
    this.group.visible=true;this.loading=false;
    if(!this.material){this.material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});if(typeof document!=='undefined'){this.atlas=new SignAtlas(this.low?1024:2048,1024);this.signMaterial=new THREE.MeshBasicMaterial({map:this.atlas.texture,side:THREE.DoubleSide});}}
    for(const p of this.pieces){
      if(!p.ready&&p.build(this.terrain,this.low,this.atlas,this.material,this.signMaterial)){
        this.epoch++;for(const d of p.decks)this.driving.set(d.source,{kind:kind[d.source.surface],halfWidth:(d.source.box[3]-d.source.box[1])/2});
      }
      if(p.ready&&this.terrain.drawnLevelAt){let visible=true;for(const q of p.supportCorners){
        // Culled corners keep their built seat only while the contact tile remains fine.
        const drawn=this.terrain.drawnLevelAt(q.x,q.z);
        if(this.terrain.surfaceAt(q.x,q.z)?.level!==8||drawn!==null&&drawn!==8)visible=false;
      }if(p.group.visible!==visible){p.group.visible=visible;this.epoch++;}}
      if((!p.ready||!p.group.visible)&&p.near(ride.x,ride.z,80))this.loading=true;
    }
    for(const p of this.dressing){if(!p.ready&&p.build(this.terrain,this.low,this.material,this.atlas,this.signMaterial))this.epoch++;if(!p.ready&&p.contains(ride.x,ride.z,50))this.loading=true;}
  }
  private fencePoses=new WeakMap<StuntRide,{piece:PlacedStunt;x:number;z:number;y:number;heading:number;pitch:number;roll:number}>();
  private fenceFits(p:PlacedStunt,d:StuntDeck,pose:{x:number;z:number;heading:number},spec:VehicleSpec):boolean {
    const b=d.source.box,swap=d.source.fence==='v',yaw=pose.heading-p.placement.heading-(swap?Math.PI/2:0),sin=Math.sin(yaw),cos=Math.cos(yaw),env=spec.envelope;
    let extent=0;for(let i=0;i<env.circles.length;i++)extent=Math.max(extent,Math.abs(env.circles[i]*sin+(env.circleSides?.[i]??0)*cos)+env.radius);
    const half=(swap?b[2]-b[0]:b[3]-b[1])/2+.10-(d.source.fenceInset??0),side=swap?p.u(pose.x,pose.z):p.v(pose.x,pose.z);
    return Math.abs(side)+extent<=half+1e-8;
  }
  private readonly probe = {x:0,z:0,y:0,heading:0,pitch:0,roll:0,vx:0,vz:0,speed:0,spec:null as unknown as VehicleSpec};
  private epoch=0;
  private owners:readonly (readonly (PlacedStunt|PlacedDressing)[])[]=[];
  contactProvider(){return {revision:()=>this.epoch,resolve:(body:import('./parked').Pushable & import('./parked').ContactBody)=>{
    const ride=body as StuntRide; ride.pitch??=0;ride.roll??=0; this.resolveSolids(ride);
  },allows:(body:import('./parked').ContactBody)=>this.allowsBody(body)};}
  allowsBody(body:import('./parked').ContactBody):boolean {
    if(!this.contains(body.x,body.z,body.spec.envelope.reach))return true;
    const probe=this.probe;probe.x=body.x;probe.z=body.z;probe.y=body.y;probe.heading=body.heading;probe.spec=body.spec;probe.pitch=probe.roll=probe.vx=probe.vz=probe.speed=0;
    for(const owners of this.owners)for(const owner of owners)if(owner.ready&&owner.group.visible)for(const solid of owner.solids){
      probe.x=body.x;probe.z=body.z;
      if(resolveHeightSolid(probe,solid))return false;
    }
    return true;
  }
  placementAllowed(pose:{x:number;z:number;heading:number},spec:VehicleSpec):boolean {
    const y=this.terrain.heightAt(pose.x,pose.z);return y!==null&&this.allowsBody({...pose,y,spec});
  }
  resolveSolids(ride:StuntRide):void {
    if(!inside(this.box,ride.x,ride.z,ride.spec.envelope.reach))return;
    for(const d of this.dressing)if(d.ready&&d.contains(ride.x,ride.z,ride.spec.envelope.reach))for(const solid of d.solids)if(resolveHeightSolid(ride,solid))this.contacts++;
    for(const p of this.pieces){if(!p.ready||!p.group.visible||!p.near(ride.x,ride.z,ride.spec.envelope.reach+30))continue;
      const localU=p.u(ride.x,ride.z),localV=p.v(ride.x,ride.z);let support:StuntDeck|null=null;
      // Side-rail collision includes angular motion. Roll back the physical pose, not individual model nodes.
      for(const d of p.decks)if(d.source.fence){const h=d.height(localU,localV),old=this.fencePoses.get(ride);if(h===null||ride.y>h+1.1||ride.y<h-.3&&!(old?.piece===p&&Math.abs(ride.y-old.y)<.5))continue;
        if(!this.fenceFits(p,d,ride,ride.spec)){
          if(old?.piece===p&&Math.abs(ride.y-old.y)<.5&&Math.hypot(ride.x-old.x,ride.z-old.z)<1){const impact=Math.abs(ride.speed);ride.x=old.x;ride.z=old.z;ride.y=old.y;ride.heading=old.heading;ride.pitch=old.pitch;ride.roll=old.roll;ride.vx=ride.vz=ride.speed=0;this.contacts++;ride.onSolidImpact?.(impact);}
        }else if(old){old.piece=p;old.x=ride.x;old.z=ride.z;old.y=ride.y;old.heading=ride.heading;old.pitch=ride.pitch;old.roll=ride.roll;}
        else this.fencePoses.set(ride,{piece:p,x:ride.x,z:ride.z,y:ride.y,heading:ride.heading,pitch:ride.pitch,roll:ride.roll});
      }
      // The same 25 cm level gate as Terrain: upper-route users do not strike its supporting mass.
      if(ride.spec.track!==0||Math.cos(ride.pitch)*Math.cos(ride.roll)>.5)for(const d of p.decks){if(d.source.draw===false)continue;const h=d.height(localU,localV);if(h!==null&&h<=ride.y+.25&&ride.y<=h+.25)support=d;}
      for(const s of p.solids){
        const reach=Math.hypot(s.half,s.halfWidth)+ride.spec.envelope.reach;if(Math.abs(s.x-ride.x)>reach||Math.abs(s.z-ride.z)>reach)continue;
        if(support){const b=support.source.box,h=support.height(Math.max(b[0],Math.min(b[2],p.u(s.x,s.z))),Math.max(b[1],Math.min(b[3],p.v(s.x,s.z))));if(h!==null&&s.top<=h+.005)continue;}
        if(s.underDeck&&(ride.spec.track!==0||Math.cos(ride.pitch)*Math.cos(ride.roll)>.5)){const deck=p.deckHeight(p.u(ride.x,ride.z),p.v(ride.x,ride.z),ride.y+.25);if(deck!==null&&Math.abs(deck-ride.y)<.12)continue;}// Test the body plane where the solid meets it, including a long rear axle still on a drop.
        if(resolveHeightSolid(ride,s))this.contacts++;
      }
      // A face resolver may translate the envelope after the angular test. Keep the final pose on its valid side.
      for(const d of p.decks)if(d.source.fence){const h=d.height(p.u(ride.x,ride.z),p.v(ride.x,ride.z)),old=this.fencePoses.get(ride);
        if(h!==null&&ride.y<=h+1.1&&old?.piece===p&&Math.abs(ride.y-old.y)<.5&&Math.hypot(ride.x-old.x,ride.z-old.z)<1&&!this.fenceFits(p,d,ride,ride.spec)){
          const impact=Math.abs(ride.speed);ride.x=old.x;ride.z=old.z;ride.y=old.y;ride.heading=old.heading;ride.pitch=old.pitch;ride.roll=old.roll;ride.vx=ride.vz=ride.speed=0;this.contacts++;ride.onSolidImpact?.(impact);
        }
      }
    }
    if(ride.car){ride.car.root.position.x=ride.x;ride.car.root.position.z=ride.z;}
  }
  step(dt:number,ride:StuntRide,eligible=true,placement=0,resolve=true):void {
    if(resolve)this.resolveSolids(ride);
    if(!inside(this.box,ride.x,ride.z,ride.spec.envelope.reach))return;
    for(const p of this.pieces){if(!p.ready||!p.group.visible||!p.near(ride.x,ride.z,ride.spec.envelope.reach+30)&&!p.judge?.active)continue;
      const r=p.placement.piece.route;if(!r)continue;
      if(!eligible){if(p.judgeRide===ride)p.judge?.reset();continue;}
      if(!p.judge||p.judgeRide!==ride){p.judgeRide=ride;p.judgeContacts=this.contacts;let top=r.obstacle?p.seat((r.obstacle.near+r.obstacle.far)/2,0)+r.obstacle.top:0;
        if(r.obstacle)for(const q of this.pieces)for(const box of q.solids){const u=p.u(box.x,box.z),v=p.v(box.x,box.z),angle=box.heading-p.placement.heading,du=Math.abs(Math.cos(angle))*box.half+Math.abs(Math.sin(angle))*box.halfWidth,dv=Math.abs(Math.sin(angle))*box.half+Math.abs(Math.cos(angle))*box.halfWidth;if(u+du>=r.obstacle.near&&u-du<=r.obstacle.far&&Math.abs(v)-dv<=r.halfWidth)top=Math.max(top,box.top);}
        p.judge=new TrickJudge({id:p.placement.piece.id,...r,obstacle:r.obstacle?{...r.obstacle,top}:undefined},ride.spec.halfLength,ride.spec.halfWidth);
      }
      const s=p.sample;s.u=p.u(ride.x,ride.z);s.v=p.v(ride.x,ride.z);s.y=ride.y;s.deck=p.deckHeight(s.u,s.v,ride.y+.25);s.speed=ride.speed;s.sideways=ride.vx*Math.cos(ride.heading)+ride.vz*Math.sin(ride.heading);s.pitch=ride.pitch;s.roll=ride.roll;s.yaw=Math.atan2(Math.sin(ride.heading-p.placement.heading),Math.cos(ride.heading-p.placement.heading));s.airborne=ride.airborne;const env=ride.spec.envelope;let extent=0,forwardExtent=0;const sin=Math.sin(s.yaw),cos=Math.cos(s.yaw);for(let i=0;i<env.circles.length;i++){extent=Math.max(extent,Math.abs(env.circles[i]*sin+(env.circleSides?.[i]??0)*cos)+env.radius);forwardExtent=Math.max(forwardExtent,Math.abs(env.circles[i]*cos-(env.circleSides?.[i]??0)*sin)+env.radius);}s.extent=extent;s.forwardExtent=forwardExtent;s.contacts=this.contacts;s.placement=placement;s.eligible=eligible;
      const collided=p.judge.active&&s.contacts!==p.judgeContacts,event=p.judge.step(dt,s);p.judgeContacts=s.contacts;if(collided){this.lastLine=`${p.placement.piece.id}: FAILED · contact`;this.lineTime=5;}if(event){this.events.push(event);if(this.events.length>32)this.events.shift();this.lastLine=`${event.piece}: ${event.obstacleCleared&&Object.values(event.landing).every(Boolean)?'CLEAN':'FAILED'} · ${event.distance.toFixed(1)} m · ${event.airTime.toFixed(2)} s`;this.lineTime=5;}
    }
    if(ride.car){ride.car.root.position.x=ride.x;ride.car.root.position.z=ride.z;}
  }
  reset():void{for(const p of this.pieces)p.judge?.reset();this.events.length=0;this.lastLine='';this.lineTime=0;}
  get triangles():number{return this.pieces.reduce((n,p)=>n+p.triangles,0)+this.dressing.reduce((n,p)=>n+p.triangles,0);}
  get drawCalls():number {let n=0;this.group.traverse(o=>{if(o instanceof THREE.Mesh)n++;});return n;}
}
