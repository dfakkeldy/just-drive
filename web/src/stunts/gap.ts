import {TANK_HEIGHT,TANK_HALF_ENVELOPE} from './tank-shape';
import type {StuntPiece} from '../stunt-kit';
import {rect,board} from './common';
export function gapPair(gap=8,tanks=false):StuntPiece {
  if(!Number.isFinite(gap)||gap<4||gap>14)throw Error('Gap must be 4 to 14 metres');
  const rise=tanks?3.2:1.9,ramp=tanks?22:16,width=tanks?6:4.8,landingRise=tanks?2.2:1.4,land=ramp+gap,end=land+24,runout=tanks?20:25;
  return{id:tanks?'gap-tanks':`gap-${gap}`,board:board('PRECAST LANDING'),footprint:[0,-width/2,end,width/2],visualFootprint:[0,-width/2,end+runout,width/2],
    decks:[rect(0,1.2,width,u=>rise*u/ramp,'steel plate'),rect(1.2,ramp,width,u=>rise*u/ramp),rect(land,end,width,u=>landingRise*(end-u)/24)].map((d,i)=>({...d,fence:'u' as const,fenceInset:i===0?width/2+.1-2.1:tanks?.4:0})),
    solids:[{u:ramp-.1,v:0,half:.1,halfWidth:width/2,bottom:0,top:rise-.4,underDeck:true},{u:land+.1,v:0,half:.1,halfWidth:width/2,bottom:0,top:landingRise-.4,underDeck:true}],
    route:{takeoff:ramp,halfWidth:width/2,landing:[land,end],runout,obstacle:tanks?{near:ramp+gap/2-TANK_HALF_ENVELOPE,far:ramp+gap/2+TANK_HALF_ENVELOPE,top:TANK_HEIGHT}:undefined},marks:[{kind:'landing',u:land+.5,v:0,width:width-.3}]};
}
