import type {StuntPiece} from '../stunt-kit';
import {rect,concrete} from './common';
export function stepDown(drop:.8|1.6|2.4):StuntPiece {
  const head=drop+.35,ramp=24,edge=32,end=48,runout=drop===.8?20:25;
  return{id:`drop-${drop}`,board:['LOUISBOURG:','VALVE CHAMBER'],footprint:[0,-3,end,3],visualFootprint:[0,-3,end+14+runout,3],
    decks:[{...rect(0,ramp,6,u=>head*u/ramp),grounded:true,supports:false},rect(ramp,edge,6,()=>head),rect(edge,end,6,u=>.35*(end-u)/(end-edge),'concrete',false)].map(d=>({...d,fence:'u' as const})),
    solids:[{u:edge-.1,v:0,half:.1,halfWidth:3,bottom:0,top:head-.3,underDeck:true},...[-1,1].map(s=>({u:(ramp+edge)/2,v:s*2.85,half:(edge-ramp)/2,halfWidth:.15,bottom:0,top:head}))],route:{takeoff:edge,halfWidth:3,landing:[edge,end+14],runout},
    build(m,_low,seat){for(let u=ramp;u<edge;u+=2){m.at(u+1,seat(u+1,0),0);for(const s of [-1,1])m.box(0,head/2,s*2.85,2,head,.3,concrete);} }};
}
