import type {StuntPiece} from '../stunt-kit';
import {rect,board} from './common';
export function slipKicker(size:'small'|'medium'|'large'):StuntPiece {
  const [rise,length,width]=size==='small'?[.6,8,4.8]:size==='medium'?[1.9,16,4.8]:[3.2,22,6];
  const toe=1.2,lift=(u:number)=>rise*u/length;
  return{id:`slip-${size}`,board:board('SLIP'),footprint:[0,-width/2,length,width/2],visualFootprint:[0,-width/2,length+65,width/2],
    decks:[rect(0,toe,width,u=>lift(u),'steel plate'),rect(toe,length,width,u=>lift(u))].map((d,i)=>({...d,fence:'u' as const,fenceInset:i===0?width/2+.1-2.1:size==='large'?.4:0})),solids:[{u:length-.1,v:0,half:.1,halfWidth:width/2,bottom:0,top:rise-.4,underDeck:true}],
    route:{takeoff:length,halfWidth:width/2,landing:[length+3,length+45],runout:20},marks:[{kind:'start',u:.4,v:0,width:width-.3}]};
}
