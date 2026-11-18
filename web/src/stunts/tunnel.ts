import type {StuntPiece,Deck,LocalSolid} from '../stunt-kit';
import {rect,concrete} from './common';
import type {RGB} from '../yard-kit';
export function archTunnel():StuntPiece {
  const length=15*1.825,half=length/2,span=9.144,inner=span/2,outer=4.822,crown=4.95;
  // The tunnel axis is u. The crossing road runs across v, with 34 m approaches either side.
  const floor={...rect(-half-3,half+3,span,()=>0,'gravel',false),draw:false};
  const crossing:Deck={fence:'v',groundedAt:(_u,v)=>Math.abs(v)>5,box:[-3,-39,3,39],surface:'gravel',kerbs:false,supports:false,spacing:.5,height:(_u,v)=>crown*Math.min(1,(39-Math.abs(v))/34),breaks:[-3,3]};
  const solids:LocalSolid[]=[];
  for(const v of [-1,1])solids.push({u:0,v:v*(inner+outer)/2,half,halfWidth:(outer-inner)/2,bottom:-.3,top:1.1});
  // The barrel keeps its own faceted outer roof; only the crossing carries the higher cover.
  // Use the coarser visible arch as the lower bound shared by desktop and LOW.
  const outerHeight=(v:number)=>{const x=Math.abs(v),points=Array.from({length:9},(_,i)=>[outer*Math.cos(i*Math.PI/8),.9+3.45*Math.sin(i*Math.PI/8)]);for(let i=0;i<8;i++)if(x<=points[i][0]&&x>=points[i+1][0]){const t=(x-points[i+1][0])/(points[i][0]-points[i+1][0]);return points[i+1][1]*(1-t)+points[i][1]*t;}return .9;};
  const strips=Math.ceil(span/.08);
  for(let i=0;i<strips;i++){
    const lo=-inner+i*span/strips,hi=-inner+(i+1)*span/strips,v=(lo+hi)/2,edge=Math.max(0,Math.abs(v)-(hi-lo)/2),bottom=.9+3.2*Math.sqrt(Math.max(0,1-(edge/inner)**2));
    const top=Math.min(outerHeight(lo),outerHeight(hi));
    if(top>bottom)for(const side of [-1,1])solids.push({u:side*(half+3)/2,v,half:(half-3)/2,halfWidth:(hi-lo)/2,bottom,top});
    solids.push({u:0,v,half:3,halfWidth:(hi-lo)/2,bottom,top:crown});
  }
  // The cover has solid flanks outside the tunnel mouth; only the arch opening is a through route.
  for(const side of [-1,1])for(let v=outer;v<39;v+=2){const end=Math.min(39,v+2),mid=(v+end)/2,top=crown*Math.min(1,(39-end)/34);if(top>.005)for(const u of [-2.96,2.96])solids.push({u,v:side*mid,half:(end-v)/2,halfWidth:.04,bottom:0,top,yaw:Math.PI/2});}
  return{id:'tunnel',runup:0,board:['BLACK R.:','ARCH CULVERT'],footprint:[-half-3,-39,half+3,39],decks:[floor,crossing],solids,
    build(m,low,seat){
      const n=low?8:16,out:number[][]=[[outer,-.5],[outer,.9]],inn:number[][]=[];
      for(let i=1;i<n;i++){const t=i*Math.PI/n;out.push([outer*Math.cos(t),.9+3.45*Math.sin(t)]);inn.push([inner*Math.cos(Math.PI-t),.9+3.2*Math.sin(t)]);}
      const profile=[...out,[-outer,.9],[-outer,-.5],[-inner,-.5],[-inner,.9],...inn,[inner,.9],[inner,-.5]];
      for(let i=0;i<15;i++){const u=-half+i*1.825+.9125;m.at(u,seat(u,0),0,Math.PI/2);m.extrude(profile,-.9,.9,concrete);}
      const earth:RGB=[.27,.21,.14];
      m.at(0,seat(0,0),0,Math.PI/2);
      for(const side of [-1,1])m.extrude([[side*outer,-.2],[side*39,-.2],[side*39,-.03],[side*5,crown-.03],[side*outer,crown-.03]],-3,3,earth);
      const cover:number[][]=[[-outer,crown-.03],[outer,crown-.03],[outer,.9]];
      for(let i=1;i<=n;i++){const t=i*Math.PI/n;cover.push([outer*Math.cos(t),.9+3.45*Math.sin(t)]);}
      m.extrude(cover,-3,3,earth);
    }};
}
