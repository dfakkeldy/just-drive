import type {StuntPiece} from '../stunt-kit';
import {rect,concrete,steel} from './common';
export function footbridge(span=18):StuntPiece {
  if(span<14||span>24)throw Error('Footbridge span must be 14 to 24 metres');
  const approach=45,rise=3.8,end=approach*2+span;
  return{id:'footbridge',board:['BLACK R.:','FOOTBRIDGE'],footprint:[0,-1.2,end,1.2],
    decks:[rect(0,approach,2.4,u=>rise*u/approach,'timber'),{...rect(approach,approach+span,2.4,()=>rise,'timber'),supports:false},rect(approach+span,end,2.4,u=>rise*(end-u)/approach,'timber')].map(d=>({...d,fence:'u' as const})),
    solids:[...[-1,1].map(s=>({u:approach+span/2,v:s*1.45,half:span/2,halfWidth:.1,bottom:rise,top:rise+2.25})),...[approach,approach+span].flatMap(u=>[-1,1].map(s=>({u,v:s*2,half:.7,halfWidth:.6,bottom:0,top:rise})))],build(m,_low,seat){
      for(const u of [approach,approach+span]){const y=seat(u,0);m.at(u,y,0);for(const v of [-2,2])m.box(0,rise/2,v,1.4,rise,1.2,concrete);}
      for(const side of [-1,1]){
        const v=side*1.45,y=seat(approach+span/2,v)+rise;m.at(approach+span/2,y,v);m.box(0,.1,0,span,.2,.2,steel);m.box(0,2.1,0,span,.2,.2,steel);
        for(let i=0;i<6;i++){const u=approach+span*(i+.5)/6,ang=Math.atan2(2.1,span/6)*(i%2?1:-1);m.at(u,seat(u,v)+rise+1.05,v,0,0,ang);m.box(0,0,0,Math.hypot(span/6,2.1),.14,.14,steel);}
      }
    }};
}
