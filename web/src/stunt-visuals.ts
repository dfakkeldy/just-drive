import {Mesher,type RGB} from './yard-kit';
import type {Deck,StuntDeck,StuntPiece} from './stunt-kit';
type Point=readonly [number,number,number];
export const works={steel:[.075,.13,.14] as RGB,timber:[.29,.19,.09] as RGB,concrete:[.48,.47,.41] as RGB,earth:[.23,.16,.095] as RGB,stone:[.32,.31,.25] as RGB,cream:[.78,.75,.61] as RGB,orange:[.75,.24,.045] as RGB,dark:[.035,.045,.035] as RGB};
export function beam(m:Mesher,a:Point,b:Point,width:number,depth:number,k:RGB):void {
 const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],h=Math.hypot(dx,dz);m.at((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,Math.atan2(-dz,dx),0,Math.atan2(dy,h));m.box(0,0,0,Math.hypot(h,dy),depth,width,k);
}
export function tube(m:Mesher,a:Point,b:Point,r:number,k:RGB,low=false):void {
 const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],h=Math.hypot(dx,dz);m.at((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,Math.atan2(-dz,dx),0,Math.atan2(dy,h));m.cyl(0,0,0,r,Math.hypot(h,dy),k,'x',low?5:8);
}
const shade=(c:RGB,w:number):RGB=>[c[0]*w,c[1]*w,c[2]*w];
export function deckColour(d:Deck,u:number,v:number):RGB {
 const grain=.985+.025*Math.sin(Math.floor(u*2)*7.13+Math.floor(v*2)*3.71);
 if(d.polar){const r=Math.hypot(u,v),packed=r>11&&r<16;return shade(packed?[.20,.145,.08]:[.29,.235,.15],grain);}
 if(d.surface==='timber')return shade([.37,.25,.12],.9+.12*Math.sin(Math.floor(u/.32)*2.7));
 if(d.surface==='gravel'||d.surface==='dirt')return shade([.28,.235,.16],grain);
 if(d.surface==='steel plate')return shade(works.steel,grain);
 return shade([.53,.515,.46],grain);
}
function paint(m:Mesher,points:readonly (readonly [number,number])[],height:(u:number,v:number)=>number|null,k:RGB):void {
 const p=points.map(([u,v])=>{const h=height(u,v);return h===null?null:[u,h+.0007,v];});if(p.some(v=>v===null))return;m.at(0,0,0);
 for(let i=1;i<p.length-1;i++){const a=p[0]!,b=p[i]!,c=p[i+1]!;m.tri(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2],k);}
}
function strip(m:Mesher,a:number,b:number,v:number,width:number,height:(u:number,v:number)=>number|null,k:RGB,step=1):void {
 for(let u=a;u<b-1e-8;u+=step){const e=Math.min(b,u+step);paint(m,[[u,v-width/2],[e,v-width/2],[e,v+width/2],[u,v+width/2]],height,k);}
}
function rock(m:Mesher,u:number,v:number,y:number,r:number,low:boolean):void {m.at(u,y,v,(u*7+v*3)%6);m.cyl(0,r*.35,0,r,r*.7,shade(works.stone,.8+.2*Math.sin(u+v)),'y',low?4:5,r*.55);}
/** Ground seats needed by visual additions; queried before a piece publishes any geometry. */
export function visualGroundSamples(piece:StuntPiece,visit:(u:number,v:number)=>void,low:boolean):void {
 for(const d of piece.decks)if(!d.polar&&d.surface!=='timber'&&d.draw!==false){for(const u of [d.box[0],Math.min(d.box[0]+2,d.box[2])])for(const side of [-1,1])visit(u,side*(Math.max(Math.abs(d.box[1]),Math.abs(d.box[3]))+1.8));}
 const r=piece.route;if(r)for(let u=r.landing[0];u<=r.landing[1];u+=2)for(const v of [-r.halfWidth,r.halfWidth])visit(u,v);
 if(piece.id==='tunnel')for(const side of [-1,1])for(const u of [13.6875,16.5])for(const v of [-6,-4,4,6])visit(u*side,v);
 if(piece.id==='berm'||piece.id.startsWith('wall-'))for(let i=0;i<=32;i++){const t=i*Math.PI/32;visit(17.8*Math.cos(t),17.8*Math.sin(t));}
 if(!low&&piece.id==='footbridge')for(const u of [45,63])for(const v of [-2,2])visit(u,v);
}
export function dressPiece(m:Mesher,low:boolean,piece:StuntPiece,decks:readonly StuntDeck[],seat:(u:number,v:number)=>number,ground:(u:number,v:number)=>number|null):void {
 for(const d of decks){if(d.source.draw===false||!d.ys.every(Number.isFinite))continue;const b=d.source.box,h=(u:number,v:number)=>d.height(u,v),width=b[3]-b[1];
  if(d.source.polar){dressBank(m,low,d,seat,ground);continue;}
  if(d.source.surface==='concrete'||d.source.surface==='steel plate'){
   const panel=low?3.66:1.83;
   for(let u=b[0];u<b[2]-.01;u+=panel){const e=Math.min(b[2],u+panel),a=h(u,0),c=h(e,0);if(a===null||c===null)continue;
    // Real slab depth and chamfered ends live below the unchanged driving face.
    m.at(0,0,0);m.extrude([[u+.014,a-.08],[e-.014,c-.08],[e-.014,c-.28],[e-.07,c-.35],[u+.07,a-.35],[u+.014,a-.28]],b[1]-.004,b[3]+.004,works.concrete);
    if(e<b[2]-.01)paint(m,[[e-.018,b[1]],[e+.018,b[1]],[e+.018,b[3]],[e-.018,b[3]]],h,works.dark);
   }
   if(d.source.supports!==false)for(let u=b[0]+2;u<b[2];u+=4){const vl=b[1]+.35,vr=b[3]-.35,top=h(u,0);if(top===null)continue;
    if(low)beam(m,[u,top-.38,vl-.35],[u,top-.38,vr+.35],.36,.36,works.steel);else{for(const dy of [-.24,-.52])beam(m,[u,top+dy,vl-.35],[u,top+dy,vr+.35],.36,.075,works.steel);beam(m,[u,top-.38,vl-.35],[u,top-.38,vr+.35],.12,.24,works.steel);}
    const gl=ground(u,vl),gr=ground(u,vr);if(gl===null||gr===null)continue;
    if(top-Math.max(gl,gr)>.75){beam(m,[u,gl+.2,vl],[u,top-.55,vr],.10,.12,works.steel);if(!low)beam(m,[u,gr+.2,vr],[u,top-.55,vl],.10,.12,works.steel);}
    for(const v of [vl,vr]){const g=ground(u,v);if(g===null)continue;const courses=top-g<1.05?Math.min(low?2:4,Math.floor((top-g-.25)/.16)):0;for(let i=0;i<courses;i++){m.at(u,g+.08+i*.16,v,i%2?Math.PI/2:0);for(const side of [-1,1])m.box(0,0,side*.3,1,.15,.22,shade(works.timber,.85+i*.05));}if(top-g>.5&&(!low||Math.floor(u/4)%2===0)){m.at(u,g+.06,v);m.box(0,0,0,.65,.12,.65,works.stone);}}
   }
   const toe=h(b[0],0);if(toe!==null&&Math.abs(toe-seat(b[0],0))<.35)for(const side of [-1,1]){
    for(let u=b[0];u<Math.min(b[2],b[0]+3);u+=1){const v=side*(width/2+1.8),g=ground(u,v),top=h(u,side*width/2);if(g===null||top===null)continue;m.at(0,0,0);m.quad([[u,g-.015,v],[u+1,ground(u+1,v)??g,v],[u+1,h(u+1,side*width/2)??top,side*width/2],[u,top,side*width/2]],works.earth);if(!low)rock(m,u+.35,v,ground(u+.35,v)??g,.18,low);}
   }
  }
  if(d.source.surface==='timber')for(let u=b[0];u<b[2];u+=low?.65:.32)paint(m,[[u,b[1]],[u+.018,b[1]],[u+.018,b[3]],[u,b[3]]],h,works.dark);
  if(d.source.kerbs){for(const v of [b[1]+.12,b[3]-.12])strip(m,b[0]+.12,b[2]-.12,v,.055,h,works.cream,low?2:1);}
  if(d.source.surface==='steel plate'||d.source.surface==='concrete'){
   const start=Math.max(b[0]+.1,b[2]-1.4);for(let u=start;u<b[2]-.05;u+=low?.28:.14)paint(m,[[u,b[1]+.22],[u+.035,b[1]+.22],[u+.035,b[3]-.22],[u,b[3]-.22]],h,works.steel);
  }
 }
 const r=piece.route;
 if(r){const d=decks.find(d=>d.height(r.takeoff-.2,0)!==null);if(d){const h=(u:number,v:number)=>d.height(u,v),u=r.takeoff-.23;paint(m,[[u,-r.halfWidth+.1],[u+.18,-r.halfWidth+.1],[u+.18,r.halfWidth-.1],[u,r.halfWidth-.1]],h,works.orange);for(const side of [-1,1])paint(m,[[u-1.7,side*.35],[u-1.3,side*.35],[u-.55,side*(r.halfWidth-.25)],[u-.95,side*(r.halfWidth-.25)]],h,works.cream);}
  const h=(u:number,v:number)=>{for(const d of decks){const y=d.height(u,v);if(y!==null)return y;}return ground(u,v);};
  for(const v of [-r.halfWidth+.16,r.halfWidth-.16])for(let u=r.landing[0];u<r.landing[1]-1;u+=4)strip(m,u,Math.min(u+1.8,r.landing[1]),v,.08,h,works.cream);
  for(const u of [r.landing[0],r.landing[1]-.1])paint(m,[[u,-r.halfWidth+.16],[u+.08,-r.halfWidth+.16],[u+.08,r.halfWidth-.16],[u,r.halfWidth-.16]],h,works.orange);
 }
 if(piece.id==='tunnel')dressTunnel(m,low,decks,seat,ground);
 if(piece.id==='footbridge')dressBridge(m,low,decks,seat);
}
function dressBank(m:Mesher,low:boolean,d:StuntDeck,seat:(u:number,v:number)=>number,ground:(u:number,v:number)=>number|null):void {
 const h=(u:number,v:number)=>d.height(u,v),count=low?16:32;
 for(let i=0;i<=count;i++){const t=i*Math.PI/count,u=19.25*Math.cos(t),v=19.25*Math.sin(t),edge=h(18.49*Math.cos(t),18.49*Math.sin(t));if(edge===null)continue;const g=ground(u,v)??seat(u,v);beam(m,[u,g,v],[u,edge+.35,v],.20,.20,works.timber);m.at(u,edge+.35,v);m.box(0,.15,0,.12,.3,.12,i%2?works.cream:works.orange);
  if(i<count){const b=(i+1)*Math.PI/count,u1=19.25*Math.cos(b),v1=19.25*Math.sin(b),next=h(18.49*Math.cos(b),18.49*Math.sin(b));if(next===null)continue;for(const f of [.35,.75,1])beam(m,[u,g+(edge-g)*f,v],[u1,(ground(u1,v1)??seat(u1,v1))+(next-(ground(u1,v1)??seat(u1,v1)))*f,v1],.16,.18,f===1?works.steel:works.timber);}
 }
 for(const radius of [11.15,11.95,13.3,14.1,15.3,16.1])for(let t=.08;t<Math.PI-.08;t+=low?.09:.035){const e=Math.min(Math.PI-.08,t+(low?.09:.035)),r0=radius-.023,r1=radius+.023;paint(m,[[r0*Math.cos(t),r0*Math.sin(t)],[r0*Math.cos(e),r0*Math.sin(e)],[r1*Math.cos(e),r1*Math.sin(e)],[r1*Math.cos(t),r1*Math.sin(t)]],h,[.105,.082,.045]);}
}
function dressTunnel(m:Mesher,low:boolean,decks:readonly StuntDeck[],seat:(u:number,v:number)=>number,ground:(u:number,v:number)=>number|null):void {
 const outer=4.822,half=13.6875,crown=4.95,n=low?10:20;
 // The shoulders fall onto the barrel, never through its clear opening.
 for(const sign of [-1,1])for(let v=-39;v<39;v+=low?2:1){const e=Math.min(39,v+(low?2:1)),profile=(w:number)=>crown*Math.min(1,(39-Math.abs(w))/34),end=(w:number)=>3+Math.max(0,profile(w))*1.5;
  const floor=(u:number,w:number)=>Math.abs(w)<outer?seat(u,w)+.9+3.45*Math.sqrt(Math.max(0,1-(w/outer)**2)):(ground(u,w)??seat(u,w));
  const a=sign*3,b=sign*end(v),c=sign*end(e);m.at(0,0,0);m.quad([[a,seat(a,v)+profile(v)-.004,v],[a,seat(a,e)+profile(e)-.004,e],[c,floor(c,e),e],[b,floor(b,v),v]],shade(works.earth,.9+.08*Math.sin(v*.7)));
 }
 for(const side of [-1,1]){const u=side*(half+.07),base=seat(u,0),profile:number[][]=[[-5.4,-.25],[-5.4,5.08],[5.4,5.08],[5.4,-.25],[4.572,-.25],[4.572,.9]];for(let i=1;i<=n;i++){const t=i*Math.PI/n;profile.push([4.572*Math.cos(t),.9+3.2*Math.sin(t)]);}profile.push([-4.572,-.25]);m.at(u,base,0,Math.PI/2);m.extrude(profile,-.18,.18,works.concrete);
  for(const v of [-1,1]){const z=v*5.1,g=ground(u+side*2,z)??seat(u,z);beam(m,[u,base+1.3,z],[u+side*3,g+.6,z+v*1.5],.32,1.2,works.concrete);for(let i=0;i<(low?3:7);i++){const x=u+side*(.5+i*.4),w=v*(3.55+(i%2)*.35);rock(m,x,w,ground(x,w)??seat(x,w),.16+.03*(i%3),low);}}
 }
 if(!low)for(let i=0;i<=15;i++){const u=-half+i*1.825;for(const t of (low?[Math.PI/3,Math.PI*2/3]:[.3,.8,1.3,1.84,2.34,2.84])){const v=4.565*Math.cos(t),y=seat(u,v)+.9+3.195*Math.sin(t);m.at(u,y,v);m.cyl(0,0,0,.045,.012,works.dark,'x',6);}}

 for(const v of [-.9,.9])strip(m,-half-2,half+2,v,.19,(u,w)=>ground(u,w),[.14,.12,.08],.5);
}
function dressBridge(m:Mesher,low:boolean,decks:readonly StuntDeck[],seat:(u:number,v:number)=>number):void {
 const b=decks[1].source.box,a=b[0],end=b[2];
 for(const u of [a,end])for(const v of [-2,2]){m.at(u,seat(u,v)+3.35,v);m.box(0,0,0,2.05,.4,1.45,works.concrete);m.box(0,.25,Math.sign(v)*-.3,1.3,.1,.75,works.dark);}
 for(const v of [-1.47,1.47]){const top=(u:number)=>seat(u,v)+3.8;beam(m,[a,top(a)+1.12,v],[end,top(end)+1.12,v],.055,.055,works.steel);
  for(let u=a;u<end;u+=low?3:.6){const e=Math.min(end,u+(low?3:.6));beam(m,[u,top(u)+.2,v],[u,top(u)+1.12,v],.035,.035,works.steel);if(!low){beam(m,[u,top(u)+.24,v],[e,top(e)+1.1,v],.012,.012,works.steel);beam(m,[u,top(u)+1.1,v],[e,top(e)+.24,v],.012,.012,works.steel);}}
 }
 // A wide truck crossed out, without a word, on a small cream plate below the lot board.
 m.at(0,seat(0,0)+.72,2.7);m.box(0,0,0,.76,.65,.04,works.cream);m.box(0,-.02,.032,.5,.19,.015,works.dark);m.box(.16,.11,.032,.18,.17,.015,works.dark);for(const x of [-.16,.16])m.cyl(x,-.14,.05,.065,.015,works.dark,'z',8);beam(m,[-.29,seat(0,0)+.47,2.77],[.29,seat(0,0)+.97,2.77],.065,.065,works.orange);
}
