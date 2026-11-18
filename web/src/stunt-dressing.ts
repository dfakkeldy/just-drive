import * as THREE from 'three';
import {Mesher,SignAtlas,letters,type RGB} from './yard-kit';
import type {Terrain} from './terrain';
import {placeStuntSolid,type LocalSolid,type HeightSolid} from './stunt-solids';
import {beam,tube,works} from './stunt-visuals';
export interface DressingContext {m:Mesher;low:boolean;solid(s:LocalSolid):void;ground(u:number,v:number):number;banner(name:string,u:number,y:number,v:number,width:number,height:number,fabric?:boolean):void}
export interface DressingPiece {id:string;archRise?:number;footprint:readonly[number,number,number,number];build(c:DressingContext):void}
export interface DressingPlacement {piece:DressingPiece;x:number;z:number;heading:number}
const green:RGB=[.05,.30,.13],black:RGB=[.025,.033,.027],white:RGB=[.80,.79,.69];
function marker(m:Mesher,u:number,y:number,v:number,easy:boolean):void {m.at(u,y,v);m.box(0,.7,0,.065,1.4,.065,works.timber);if(easy)m.cyl(0,1.4,.03,.24,.035,green,'x',12);else{m.at(u,y+1.4,v,Math.PI/2,0,Math.PI/4);m.box(0,0,.03,.39,.39,.04,black);}}
export function startArch(name='TEST PARK',rise=5.8):DressingPiece {
 const title=name.replace(/[\x00-\x1f]/g,'').slice(0,36)||'TEST PARK';
 return{id:'start-arch',archRise:rise,footprint:[-1,-4.8,1,4.8],build({m,low,ground,banner,solid}){const floors=[ground(-.35,-4.3),ground(.35,-4.3),ground(-.35,4.3),ground(.35,4.3)],top=Math.max(...floors)+rise;
  for(const v of [-4.3,4.3])for(const u of [-.35,.35]){const g=ground(u,v);solid({u,v,half:.4,halfWidth:.4,bottom:g,top:g+.14});solid({u,v,half:.035,halfWidth:.035,bottom:g+.14,top});m.at(u,g+.07,v);m.box(0,0,0,.8,.14,.8,works.concrete);tube(m,[u,g,v],[u,top,v],.055,works.steel,low);for(let y=g+.6;!low&&y<top-.4;y+=1.2)tube(m,[u,y,v-.35],[u,y,v+.35],.035,works.steel,low);}
  for(const u of [-.35,.35]){
   // The steel stays solid. LOW's five-sided tubes have a flat lower face at cos(pi/5).
   for(const [offset,r]of [[0,.065],[.65,.055]]){const y=top-offset;solid({u,v:0,half:r,halfWidth:4.3,bottom:y-r*(low?Math.cos(Math.PI/5):1),top:y+r});tube(m,[u,y,-4.3],[u,y,4.3],r,works.steel,low);}
   for(let v=-4;v<4;v+=1.2){const end=Math.min(4.3,v+1.2);solid({u,v:(v+end)/2,half:.028,halfWidth:(end-v)/2+.028,bottom:top-.678,top:top+.028});tube(m,[u,top,v],[u,top-.65,end],.028,works.steel,low);}
  }
  for(const v of [-4.3,4.3]){const g=ground(0,v);tube(m,[-.35,g+.3,v],[.35,top-.7,v],.04,works.steel,low);tube(m,[.35,g+.3,v],[-.35,top-.7,v],.04,works.steel,low);}
  // Fabric has no backing panel and no collider.
  banner(title,.042,top-.85,0,7.9,1.02,true);
 }};
}
export function lineFurniture(length:number,width:number,easy:boolean):DressingPiece {return{id:'line-furniture',footprint:[0,-width/2-3,length,width/2+3],build({m,low,ground,solid}){
 const tone=easy?green:works.orange,side=width/2+.75;
 for(let u=1;u<length;u+=low?12:6)for(const sign of [-1,1]){const v=sign*side,g=ground(u,v);m.at(u,g+.035,v);m.box(0,0,0,.48,.07,.48,black);m.cyl(0,.27,0,.20,.48,tone,'y',low?5:8,.045);if(!low)m.cyl(0,.27,0,.13,.095,white,'y',8,.11);}
 for(let u=8;u<length;u+=18)for(const sign of [-1,1]){const v=sign*(width/2+1.25),g=ground(u,v);solid({u,v,half:.85,halfWidth:.27,bottom:g,top:g+.75});m.at(u,g,v);m.extrude([[-1,0],[1,0],[.85,.75],[-.85,.75]],-.27,.27,u%36<18?works.cream:tone);if(!low)for(const x of [-.5,.5]){m.at(u+x,g+.3,v+.278);m.box(0,0,0,.12,.32,.012,tone);}}
 for(const sign of [-1,1]){const v=sign*(width/2+2.5);let top=-Infinity;for(let u=0;u<length;u+=12)top=Math.max(top,ground(u,v)+3.6);top=Math.max(top,ground(length,v)+3.6);
  for(let u=0;u<=length;u=Math.min(length,u+12)){const g=ground(u,v);if(low)beam(m,[u,g,v],[u,top,v],.07,.07,works.timber);else tube(m,[u,g,v],[u,top,v],.035,works.timber);if(u===length)break;const e=Math.min(length,u+12);if(low)beam(m,[u,top,v],[e,top,v],.025,.025,works.dark);else tube(m,[u,top,v],[e,top,v],.012,works.dark);
   for(let x=u+.8;x<e;x+=low?3:1.5){m.at(0,0,0);m.tri(x,top,v,x+.65,top,v,x+.32,top-.65,v,x%3<1.5?tone:white);}
  }
 }
}};}
export function lineMarker(easy:boolean):DressingPiece{return{id:'line-marker',footprint:[-.3,-.2,.3,.2],build({m,ground}){marker(m,0,ground(0,0),0,easy);}};}
export function laneArrow(easy:boolean):DressingPiece{return{id:'lane-arrow',footprint:[-1.6,-.8,1.6,.8],build({m,ground}){const p=[[-1.4,-.18],[.35,-.18],[.35,-.65],[1.4,0],[.35,.65],[.35,.18],[-1.4,.18]];m.at(0,0,0);const y=p.map(([u,v])=>ground(u,v)+.0007);for(let i=1;i<p.length-1;i++)m.tri(p[0][0],y[0],p[0][1],p[i][0],y[i],p[i][1],p[i+1][0],y[i+1],p[i+1][1],easy?green:white);}};}
export function timingHut():DressingPiece{return{id:'timing-hut',footprint:[-1.8,-1.7,1.8,1.7],build({m,low,ground,solid}){const y=Math.max(ground(-1.5,-1.4),ground(1.5,1.4))+.35;
 for(const u of [-1.3,1.3])for(const v of [-1.1,1.1]){const g=ground(u,v);solid({u,v,half:.09,halfWidth:.09,bottom:g,top:y});m.at(u,(g+y)/2,v);m.box(0,0,0,.18,y-g,.18,works.timber);}
 solid({u:0,v:0,half:1.55,halfWidth:1.35,bottom:y-.05,top:y+.15});solid({u:0,v:0,half:1.4,halfWidth:1.175,bottom:y+.1,top:y+2.2});solid({u:0,v:0,half:1.625,halfWidth:1.4,bottom:y+2.19,top:y+2.37});
 m.at(0,y,0);m.box(0,.05,0,3.1,.2,2.7,works.timber);m.box(0,1.15,0,2.8,2.1,2.35,works.steel);m.box(0,2.28,0,3.25,.18,2.8,works.orange);
 for(const v of [-1.18,1.18]){m.at(0,y+1.48,v);m.box(0,0,0,2.25,.8,.025,[.08,.15,.17]);if(!low)for(const u of [-.75,0,.75])m.box(u,0,0,.045,.85,.04,works.cream);}
 m.at(-1.42,y+.95,0);m.box(0,0,0,.035,1.75,.72,works.timber);for(let i=0;i<3;i++){const u=-1.72-i*.18,g=ground(u,0),top=y+.075-.08*i;m.at(u,(g+top)/2,0);m.box(0,0,0,.42,top-g,.95,works.concrete);}
 m.at(1.43,y+1.45,0,Math.PI/2);m.cyl(0,0,0,.32,.045,white,'z',16);m.cyl(0,0,.03,.025,.015,black,'z',8);beam(m,[1.47,y+1.45,0],[1.47,y+1.65,.13],.02,.025,black);
 if(!low)for(let u=-1.5;u<=1.5;u+=.25){m.at(u,y+2.4,0);m.box(0,0,0,.025,.04,2.8,works.steel);}
}};}
export function pitArea():DressingPiece{return{id:'pit-area',footprint:[-3.8,-3.7,3,4.2],build({m,low,ground,solid}){const y=Math.max(ground(-2,-1.4),ground(-2,1.4),ground(2,-1.4),ground(2,1.4))+.36;
 solid({u:0,v:0,half:2.15,halfWidth:1.075,bottom:y-.11,top:y+.11});solid({u:0,v:0,half:1.95,halfWidth:.975,bottom:y+.11,top:y+2.19});solid({u:0,v:0,half:2.075,halfWidth:1.09,bottom:y+2.165,top:y+2.315});
 m.at(0,y,0);m.box(0,0,0,4.3,.22,2.15,works.steel);m.box(0,1.15,0,3.9,2.08,1.95,works.cream);m.box(0,2.24,0,4.15,.15,2.18,works.steel);
 for(const u of [-.55,.55])for(const sign of [-1,1]){const v=sign*1.13,g=ground(u,v);m.at(u,g+.34,v);m.cyl(0,0,0,.34,.20,black,'z',low?8:16);m.cyl(0,0,sign*.108,.19,.025,works.steel,'z',8);beam(m,[u,g+.34,v],[u,y-.11,v],.07,.09,works.steel);}
 // The level storage frame rests on stands; each sole follows the actual sloping land at all four corners.
 for(const u of [-1.65,1.65])for(const v of [-.9,.9]){const q=[[-.24,-.24],[.24,-.24],[.24,.24],[-.24,.24]].map(([a,b])=>[u+a,ground(u+a,v+b)-.02,v+b] as [number,number,number]),top=Math.max(...q.map(p=>p[1]))+.08;m.at(0,0,0);m.quad(q,works.timber);m.quad(q.map(p=>[p[0],top,p[2]] as [number,number,number]),works.timber);for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4];m.quad([a,b,[b[0],top,b[2]],[a[0],top,a[2]]],works.timber);}if(y-.11>top){m.at(u,(top+y-.11)/2,v);m.box(0,0,0,.13,y-.11-top,.13,works.steel);}}
 beam(m,[-2.15,y,1],[-3.6,y-.05,0],.09,.10,works.steel);beam(m,[-2.15,y,-1],[-3.6,y-.05,0],.09,.10,works.steel);const g=ground(-3.35,0);beam(m,[-3.35,g,0],[-3.35,y,0],.09,.09,works.steel);
 m.at(2.02,y+1.12,0);for(const v of [-.85,.85])m.box(0,0,v,.03,1.9,.045,works.steel);m.box(.02,0,0,.04,.055,1.7,works.steel);
 for(let i=0;i<(low?2:5);i++){const u=-1.7+i*.5,v=2.1,z=ground(u,v);m.at(u,z+.27,v);m.box(0,0,0,.32,.49,.22,i%2?works.orange:works.steel);m.box(0,.28,0,.20,.07,.10,black);if(!low){m.box(0,0,.116,.22,.028,.012,works.cream);m.box(0,0,-.116,.22,.028,.012,works.cream);}}
 for(const u of [-1.7,1.7])for(const v of [2.7,4]){const floor=ground(u,v);tube(m,[u,floor,v],[u,y+2.65,v],.035,works.steel,low);}m.at(0,y+2.67,3.35);m.box(0,0,0,3.6,.07,1.55,works.orange);
}};}
export function floodMast():DressingPiece{return{id:'floodlight',footprint:[-1.2,-1.2,1.2,1.2],build({m,low,ground,solid}){const y=ground(0,0);solid({u:0,v:0,half:.45,halfWidth:.45,bottom:y,top:y+.25});solid({u:0,v:0,half:.05,halfWidth:.05,bottom:y+.25,top:y+6.5});m.at(0,y+.125,0);m.box(0,0,0,.9,.25,.9,works.concrete);tube(m,[0,y,0],[0,y+6.5,0],.075,works.steel,low);for(const a of [0,Math.PI*2/3,Math.PI*4/3]){const u=Math.cos(a),v=Math.sin(a);beam(m,[0,y+1,0],[u,ground(u,v),v],.08,.08,works.steel);}beam(m,[-.85,y+6.3,0],[.85,y+6.3,0],.06,.08,works.steel);for(const u of [-.6,.6]){m.at(u,y+6.3,0);m.box(0,0,0,.8,.42,.20,works.steel);m.box(0,0,.11,.68,.31,.018,white);}}};}
export function edgeStacks(length:number,tyres=false):DressingPiece{return{id:'edge-stacks',footprint:[0,-.55,length,.55],build({m,low,ground,solid}){for(let u=.5;u<length;u+=1.8){const y=ground(u,0);solid({u,v:0,half:tyres?.25:.725,halfWidth:tyres?.25:.425,bottom:y,top:y+(tyres?.715:.6)});if(tyres){m.at(u,y,0);for(let i=0;i<3;i++){m.cyl(0,.13+i*.24,0,.36,.21,black,'y',low?6:12);if(!low)m.cyl(0,.243+i*.24,0,.18,.015,works.dark,'y',10);}}else{m.at(u,y+.3,0);m.box(0,0,0,1.45,.6,.85,[.48,.35,.105]);if(!low)for(const x of [-.45,.45])m.box(x,0,0,.025,.61,.86,works.timber);}}}};}
interface Banner {name:string;u:number;y:number;v:number;width:number;height:number;fabric?:boolean}
export class PlacedDressing {
 readonly group=new THREE.Group();readonly solids:HeightSolid[]=[];ready=false;triangles=0;readonly box:[number,number,number,number];private sin:number;private cos:number;
 constructor(readonly placement:DressingPlacement){this.sin=Math.sin(placement.heading);this.cos=Math.cos(placement.heading);const b=placement.piece.footprint,p=[this.world(b[0],b[1]),this.world(b[2],b[1]),this.world(b[2],b[3]),this.world(b[0],b[3])];this.box=[Math.min(...p.map(p=>p.x)),Math.min(...p.map(p=>p.z)),Math.max(...p.map(p=>p.x)),Math.max(...p.map(p=>p.z))];this.group.position.set(placement.x,0,placement.z);this.group.rotation.y=Math.PI/2-placement.heading;this.group.name=placement.piece.id;}
 world(u:number,v:number):{x:number;z:number}{return{x:this.placement.x+u*this.sin+v*this.cos,z:this.placement.z-u*this.cos+v*this.sin};}
 contains(x:number,z:number,margin=0):boolean{const u=(x-this.placement.x)*this.sin-(z-this.placement.z)*this.cos,v=(x-this.placement.x)*this.cos+(z-this.placement.z)*this.sin,b=this.placement.piece.footprint;return u>b[0]-margin&&u<b[2]+margin&&v>b[1]-margin&&v<b[3]+margin;}
 build(terrain:Terrain,low:boolean,material:THREE.Material,atlas:SignAtlas|null,signMaterial:THREE.Material|null):boolean {
  if(this.ready)return true;let missing=false;const ground=(u:number,v:number)=>{const p=this.world(u,v);if(terrain.surfaceAt(p.x,p.z)?.level!==8||(terrain.drawnLevelAt&&terrain.drawnLevelAt(p.x,p.z)!==8)){missing=true;return 0;}const h=terrain.meshHeightAt(p.x,p.z);if(h===null||!Number.isFinite(h))missing=true;return h??0;},b=this.placement.piece.footprint;
  for(let u=b[0];u<=b[2];u+=2)for(let v=b[1];v<=b[3];v+=2)ground(u,v);if(missing)return false;
  const m=new Mesher(),signs=new Mesher(),banners:Banner[]=[],solids:HeightSolid[]=[];this.placement.piece.build({m,low,ground,solid:s=>solids.push(placeStuntSolid(s,this.placement)),banner:(name,u,y,v,width,height,fabric)=>banners.push({name,u,y,v,width,height,fabric})});if(missing)return false;
  if(atlas&&signMaterial)for(const b of banners){const cell=atlas.add(low?384:768,low?64:128,(g,w,h)=>{letters(g,w,h,[b.name],'#f6efd8','#16464a',{border:'#d07634'});});signs.at(b.u,b.y,b.v,Math.PI/2);signs.plate(b.width,b.height,cell.cell,b.fabric?0:.06);}
  const mesh=new THREE.Mesh(m.geometry(),material);mesh.name=this.placement.piece.id+' dressing';mesh.castShadow=mesh.receiveShadow=true;this.group.add(mesh);if(signs.triangles&&signMaterial){const text=new THREE.Mesh(signs.geometry(),signMaterial);text.name='park banner';this.group.add(text);}this.triangles=m.triangles+signs.triangles;this.solids.push(...solids);this.ready=true;return true;
 }
}
