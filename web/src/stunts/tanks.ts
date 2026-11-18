import type {StuntPiece,LocalSolid} from '../stunt-kit';
import type {RGB} from '../yard-kit';
import {beam,tube,works} from '../stunt-visuals';
import {TANK_DIAMETER,TANK_HEIGHT} from './tank-shape';
export function tankRow(diameter=TANK_DIAMETER,height=TANK_HEIGHT):StuntPiece {
 const radius=diameter/2,half=radius+.1,spacing=diameter+.2,solids:LocalSolid[]=[];
 for(let i=0;i<5;i++)solids.push({u:0,v:(i-2)*spacing,half,halfWidth:half,bottom:0,top:height,groundRadius:radius+.05});
 return{id:'tanks',board:['LOUISBOURG:','TANKS'],boardAt:{u:-2.3,v:2*spacing+radius+1.6},visualFootprint:[-3.5,-2*spacing-radius-.2,half,2*spacing+radius+2],footprint:[-.55,-2.75,.55,2.75],decks:[],solids,
 build(m,low,seat,ground){const seg=low?10:20;for(let i=0;i<5;i++){const v=(i-2)*spacing,y=Math.max(...[-radius-.05,radius+.05].flatMap(u=>[-radius-.05,radius+.05].map(w=>ground(u,v+w)??seat(u,v+w)))),tone:RGB=i%2?[.16,.23,.21]:[.22,.26,.23];
  for(let c=0;c<2;c++)for(const s of [-1,1]){m.at(0,y+.055+c*.11,v,c%2?Math.PI/2:0);m.box(s*.85,0,0,.28,.11,diameter+.12,works.timber);}
  for(const u of [-.85,.85])for(const w of [-radius,radius]){const floor=ground(u,v+w)??y;if(y>floor+.015){m.at(u,(floor+y)/2,v+w);m.box(0,0,0,.28,y-floor,.25,works.timber);}}
  m.at(0,y,v);m.cyl(0,(height+.13)/2,0,radius,height-.31,tone,'y',seg);
  for(const h of [.3,height*.55,height-.19])m.cyl(0,h,0,radius+.018,.055,works.steel,'y',seg);
  m.cyl(0,height-.045,0,.29,.09,works.steel,'y',low?8:16);m.cyl(radius*.55,height-.12,0,.12,.10,works.steel,'y',8);
  if(!low){for(const a of [2,7,12,16]){const t=a*Math.PI*2/seg,e=(a+1)*Math.PI*2/seg,r=radius+.002;m.quad([[r*Math.cos(t),height*.4,r*Math.sin(t)],[r*Math.cos(e),height*.43,r*Math.sin(e)],[r*Math.cos(e),height*.76,r*Math.sin(e)],[r*Math.cos(t),height*.72,r*Math.sin(t)]],i%2?[.30,.20,.14]:[.34,.37,.33]);}
   for(let h=.3;h<height-.16;h+=.27)beam(m,[-.22,y+h,v+radius+.075],[.22,y+h,v+radius+.075],.035,.04,works.steel);
  }
  for(const side of [-1,1])tube(m,[side*.22,y+.22,v+radius+.075],[side*.22,y+height-.13,v+radius+.075],.025,works.steel,low);
 }} };
}
