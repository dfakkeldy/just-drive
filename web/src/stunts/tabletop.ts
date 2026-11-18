import type {StuntPiece,Deck} from '../stunt-kit';
import {rect,board} from './common';
export function tableTop():StuntPiece {
  const ramp=8,flat=8,rise=1.28,end=2*ramp+flat,profile=(u:number)=>u<ramp?rise*u/ramp:u<=ramp+flat?rise:rise*(end-u)/ramp;
  const cap=(a:number,b:number):Deck=>({...rect(a,b,4.8,profile),grounded:true,supports:false});
  return{id:'tabletop',board:board('CONCRETE TABLE'),footprint:[0,-5.4,end,5.4],decks:[cap(0,ramp),cap(ramp,ramp+flat),cap(ramp+flat,end)].map(d=>({...d,fence:'u' as const})),solids:[],
    ground:(u,v)=>u<0||u>end?0:Math.max(0,profile(u)-1.5)*Math.max(0,Math.min(1,(5.4-Math.abs(v))/3)),
    practiceKph:8,marks:[{kind:'start',u:0,v:0,width:4.5},{kind:'gate',u:end,v:0,width:4.5}]};
}
