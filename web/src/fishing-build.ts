import * as THREE from 'three';
import { Mesher, SignAtlas, letters, type RGB } from './yard-kit';
import { BERTH, BOARD } from './fishing-site';
import { addWharfProps } from './mabou-wharf-props';

const WHITE: RGB = [.76,.77,.72], WOOD: RGB = [.25,.17,.10], DARK: RGB = [.025,.032,.037];
const METAL: RGB = [.24,.28,.28], GLASS: RGB = [.035,.09,.12], ROPE: RGB = [.49,.36,.17];
const GREEN: RGB = [.035,.19,.15], BLUE: RGB = [.045,.14,.30], GREY: RGB = [.32,.36,.37];
/** White texel for ordinary vertex-coloured faces; signs share their mesh/material and draw call. */
function fillUV(m: Mesher): void { while (m.uv.length < m.pos.length / 3 * 2) m.uv.push(.004,.996); }
function stamp(m: Mesher, w: number, h: number, cell: [number,number,number,number]): void { fillUV(m); m.plate(w,h,cell); }

function ring(m: Mesher, x: number,y: number,z: number,r: number,t: number,colour: RGB,low: boolean,vertical=false): void {
  const n=low?8:14, sides=low?3:5;
  const point=(a:number,b:number):number[]=>{
    const d=r+Math.cos(b)*t, up=Math.sin(b)*t;
    return vertical?[x+Math.cos(a)*d,y+Math.sin(a)*d,z+up]:[x+Math.cos(a)*d,y+up,z+Math.sin(a)*d];
  };
  for(let i=0;i<n;i++)for(let j=0;j<sides;j++)m.quad([point(i*2*Math.PI/n,j*2*Math.PI/sides),point((i+1)*2*Math.PI/n,j*2*Math.PI/sides),point((i+1)*2*Math.PI/n,(j+1)*2*Math.PI/sides),point(i*2*Math.PI/n,(j+1)*2*Math.PI/sides)],colour);
}
function trap(m:Mesher,x:number,y:number,z:number,low:boolean):void {
  const wire:RGB=[.12,.21,.20];
  m.box(x,y+.04,z,1.05,.08,.70,WOOD);
  for(const s of [-1,1]) {
    for(const t of [-1,1])m.box(x+s*.50,y+.34,z+t*.32,.028,.64,.028,wire);
    m.box(x+s*.50,y+.64,z,.028,.028,.68,wire);
    for(let q=-.32;q<=.321;q+=low?.32:.16)m.box(x+s*.50,y+.34,z+q,.018,.59,.018,wire);
    for(let q=.2;q<.65;q+=low?.4:.2)m.box(x,y+q,z+s*.32,1.0,.018,.018,wire);
    m.box(x,y+.64,z+s*.32,1.03,.028,.028,wire);
  }
  for(let q=-.5;q<=.501;q+=low?.5:.25)m.box(x+q,y+.64,z,.018,.018,.65,wire);
  // Dark funnel mouth and narrow lath, not a solid green crate.
  m.cyl(x,y+.36,z,.16,.02,DARK,'z',low?6:10);m.box(x,y+.66,z,1.05,.035,.06,WOOD);
}
function tote(m:Mesher,x:number,y:number,z:number):void {
  m.box(x,y+.06,z,.75,.12,.55,GREY);
  for(const s of [-1,1]){m.box(x+s*.36,y+.24,z,.04,.42,.55,GREY);m.box(x,y+.24,z+s*.26,.75,.42,.04,GREY);}
  m.box(x,y+.46,z,.8,.055,.6,[.40,.43,.43]);m.box(x,y+.491,z,.67,.02,.47,DARK);
}
function person(m:Mesher,low:boolean):void {
  for(const s of [-1,1]){m.box(s*.12,.42,0,.19,.76,.22,[.035,.08,.095]);m.box(s*.12,.06,.04,.21,.12,.34,DARK);m.box(s*.29,1.07,0,.13,.62,.19,[.12,.20,.23]);}
  m.box(0,1.13,0,.46,.65,.28,[.12,.20,.23]);m.box(0,.9,.15,.35,.75,.04,[.62,.38,.08]);
  for(const s of [-1,1])m.box(s*.13,1.28,.17,.055,.30,.025,[.62,.38,.08]);
  m.box(0,1.60,0,.23,.25,.23,[.55,.37,.25]);m.cyl(0,1.76,0,.15,.13,[.70,.33,.065],'y',low?6:10);
}

/** Twelve-and-a-half metre inshore hull, local +z forward, starboard -x. No real names or numbers. */
function boat(m:Mesher,atlas:SignAtlas,name:string,trim:RGB,low:boolean):void {
  const stations=[[-6.25,1.85,1.27],[-4.8,2.2,1.28],[-1.7,2.25,1.31],[1.7,2.18,1.43],[4.2,1.6,1.78],[5.6,.74,2.02],[6.25,.04,2.13]];
  for(let i=0;i<stations.length-1;i++) {
    const [z,a,h]=stations[i],[zz,b,hh]=stations[i+1];
    for(const s of [-1,1]) {
      m.quad([[s*a,.12,z],[s*b,.12,zz],[s*b,hh,zz],[s*a,h,z]],WHITE);
      m.quad([[s*a,h-.10,z],[s*b,hh-.10,zz],[s*b,hh+.015,zz],[s*a,h+.015,z]],trim);
      m.quad([[s*a*.67,-.85,z],[s*b*.67,-.85,zz],[s*b,.12,zz],[s*a,.12,z]],DARK);
      m.quad([[s*a*.67,-.85,z],[s*b*.67,-.85,zz],[0,-1.05,zz],[0,-1.05,z]],DARK);
    }
    m.quad([[-a+.06,1.1,z],[a-.06,1.1,z],[b-.03,1.1,zz],[-b+.03,1.1,zz]],[.33,.34,.30]);
  }
  m.box(0,.67,-6.24,3.7,1.12,.10,WHITE);m.box(0,-.28,-6.24,2.6,.77,.08,DARK);
  // A long open working deck aft; the wheelhouse and low cuddy are forward.
  m.box(0,2.40,2.04,2.78,2.05,2.95,WHITE);m.box(0,3.47,2.03,3.15,.36,3.35,trim);
  m.box(0,1.70,4.18,2.15,.85,1.70,WHITE);m.box(0,2.15,4.18,2.28,.12,1.85,trim);
  for(const s of [-1,1]) {
    for(const z of [1.05,2.70])m.box(s*1.401,2.90,z,.025,.71,1.22,GLASS);
    m.box(s*1.42,2.12,.90,.035,1.45,.65,trim);m.box(s*1.44,2.52,.90,.02,.55,.49,GLASS);
    m.box(s*2.12,1.52,-2.10,.065,.065,7.3,METAL);
    for(const z of [-5.6,-3.6,-1.5,.8])m.box(s*2.12,1.31,z,.055,.45,.055,METAL);
    m.box(s*.94,1.85,4.43,.035,.28,.8,GLASS);
  }
  for(const x of [-.9,0,.9])m.box(x,2.93,3.531,.76,.72,.025,GLASS);
  m.box(0,2.48,3.56,2.55,.06,.10,trim);m.box(0,1.49,-6.17,3.95,.065,.065,METAL);
  m.cyl(-.55,4.36,1.53,.055,1.75,WHITE,'y',low?6:10);m.box(-.55,4.68,1.53,2.1,.12,.18,WHITE);
  m.cyl(-.52,5.33,1.53,.018,1.5,DARK,'y',5);m.box(.64,3.63,2.3,.42,.20,.50,DARK);
  // Starboard trap hauler: bent gantry, roller and hydraulic drum.
  m.box(-2.18,2.04,-.9,.15,1.85,.15,trim);m.box(-2.48,2.95,-.9,.8,.14,.14,trim);
  m.cyl(-2.77,2.69,-.9,.34,.26,DARK,'z',low?8:14);m.cyl(-2.77,2.69,-.9,.23,.29,METAL,'z',low?8:14);
  for(let i=0;i<(low?2:4);i++)trap(m,.68,1.13+Math.floor(i/2)*.69,-4.65+(i%2)*1.12,low);
  tote(m,-.85,1.12,-4.9);ring(m,-.8,1.15,-2.3,.37,.045,ROPE,low);
  for(const s of [-1,1])m.cyl(s*2.28,.35,-3,.13,.70,DARK,'y',low?6:10);
  const cell=atlas.add(768,112,(g,w,h)=>letters(g,w,h,[name],'#17262c','#e6e6db',{font:'"Courier New",monospace'})).cell;
  // Large lettering wraps the forward hull panels; matching each face keeps it outside the flared bow.
  m.at(0,.76,-6.304,Math.PI);stamp(m,3.45,.56,cell);
  // Repeat the name on the wheelhouse roof fascia: the hull lettering is below the wharf edge from a car seat.
  for(const side of [-1,1]){m.at(side*1.59,3.47,2.03,side*Math.PI/2);stamp(m,3.08,.32,cell);}
  m.at(0,0,0);
  const z0=-.3,z1=4.2,stationsName=[[-.3,2.2212],[1.7,2.18],[4.2,1.6]];
  for(const side of [-1,1])for(let i=0;i<stationsName.length-1;i++){
    const [a,wa]=stationsName[i],[b,wb]=stationsName[i+1];
    fillUV(m);m.quad([[side*(wa+.018),.60,a],[side*(wb+.018),.60,b],[side*(wb+.018),1.16,b],[side*(wa+.018),1.16,a]],[1,1,1]);
    const ua=cell[0]+(cell[2]-cell[0])*(side<0?(a-z0)/(z1-z0):1-(a-z0)/(z1-z0));
    const ub=cell[0]+(cell[2]-cell[0])*(side<0?(b-z0)/(z1-z0):1-(b-z0)/(z1-z0));
    m.uv.push(ua,cell[1],ub,cell[1],ub,cell[3],ua,cell[1],ub,cell[3],ua,cell[3]);
  }
  m.at(0,0,0);
}

export interface FishingArt {
  fixed:THREE.Mesh;boat:THREE.Mesh;crew:THREE.InstancedMesh;lines:THREE.Mesh;triangles:number;
  mooring:THREE.BufferGeometry;wake:THREE.BufferGeometry;wakeMaterial:THREE.Material;mooringMaterial:THREE.Material;
}
export function buildFishing(top:number,sea:number,low:boolean,ground:readonly number[]):FishingArt {
  const atlas=new SignAtlas(1024,512);atlas.add(8,8,(g,w,h)=>{g.fillStyle='#fff';g.fillRect(0,0,w,h);});
  const material=new THREE.MeshLambertMaterial({vertexColors:true,map:atlas.texture,side:THREE.DoubleSide});
  if(low)material.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,1,0),-sea)];
  const m=new Mesher(),b=new Mesher(),p=new Mesher(),l=new Mesher();
  // The gravel approach is part of the terrain, not another sheet or slab. Only the pier cap is concrete.
  m.box(7,top-.20,37,10,.4,54,[.45,.44,.39]);
  for(const x of [2,12]){
    m.box(x,(top+sea-.7)/2,37,.26,top-sea+.7,54,WOOD);
    for(let z=12;z<64;z+=low?6:3){m.box(x,(top+sea-1.4)/2,z,.34,top-sea+1.4,.34,WOOD);m.box(x,top+.25,z,.24,.50,.24,WOOD);}
    m.box(x,top+.48,37,.29,.24,54,WOOD);
  }
  m.box(7,top+.48,64,10,.24,.29,WOOD);m.box(7,(top+sea-.7)/2,64,10,top-sea+.7,.25,WOOD);
  for(let z=14;z<64;z+=low?12:6)m.box(7,top+.006,z,9.6,.012,.025,[.25,.25,.23]);
  for(let z=18;z<63;z+=low?12:8){
    m.at(12.25,sea+.45,z,Math.PI/2);ring(m,0,0,0,.43,.13,DARK,low,true);m.at(0,0,0);
    // The tire hangs from the cap and stays by the hull's waterline at every Hill height.
    m.quad([[12.26,top+.05,z-.025],[12.26,sea+.75,z-.025],[12.26,sea+.75,z+.025],[12.26,top+.05,z+.025]],ROPE);
    for(const x of [2.6,11.4]){m.box(x,top+.14,z,.12,.28,.12,METAL);m.box(x,top+.28,z,.17,.09,.66,METAL);}
  }
  for(const z of [28,58]){
    for(const dz of [-.27,.27])m.box(12.42,(top+sea-.1)/2,z+dz,.07,top-sea+1.4,.07,METAL);
    for(let y=sea-.7;y<top+.7;y+=.32)m.box(12.46,y,z,.07,.06,.62,METAL);
  }
  // A proper stack by the board, instead of scattered traps far back along the pier.
  for(let i=0;i<(low?5:10);i++){
    const u=3+(Math.floor(i/3)%2)*1.15,z=42+Math.floor(i/6)*1.4,y=top+(i%3)*.70;
    trap(m,u,y,z,low);
    m.cyl(u+.56,y+.4,z+.1,.12,.45,i%2?[.9,.28,.035]:[.08,.45,.65],'y',low?6:10,.04);
  }
  for(let i=0;i<(low?2:4);i++)tote(m,9.8,top,52+i*.8);
  for(let i=0;i<(low?1:3);i++)ring(m,10.7,top+.07,49+i*1.25,.48+i*.07,.055,ROPE,low);
  m.box(3.2,top+.5,55,1.3,1.0,1.8,[.55,.55,.51]);m.cyl(3.2,top+1.04,55,.11,.10,DARK,'y',8);
  m.cyl(2.8,top+3.5,10,.12,7,WOOD,'y',low?6:10);m.box(3.4,top+6.5,10,1.4,.12,.1,METAL);m.box(4,top+6.4,10,.6,.14,.35,WHITE);
  m.box(BOARD.u,top+1.2,BOARD.v,.95,1.4,.06,WOOD);m.box(BOARD.u,top+.45,BOARD.v,.13,.9,.13,WOOD);
  const board=atlas.add(256,256,(g,w,h)=>letters(g,w,h,['DECKHAND','WANTED'],'#242926','#d8cda6',{font:'cursive',weights:[1,1.1]})).cell;
  m.at(BOARD.u,top+1.2,BOARD.v-.043,Math.PI);stamp(m,.90,1.30,board);m.at(0,0,0);
  addWharfProps(m,ground,top,sea,low);
  const other=new Mesher();boat(other,atlas,'POSTAGE DUE',BLUE,low);fillUV(other);
  const geo=other.geometry();geo.translate(16.2,sea,22);
  const pos=geo.getAttribute('position'),col=geo.getAttribute('color'),uv=geo.getAttribute('uv');fillUV(m);
  for(let i=0;i<pos.count;i++){m.pos.push(pos.getX(i),pos.getY(i),pos.getZ(i));m.col.push(col.getX(i),col.getY(i),col.getZ(i));m.uv.push(uv.getX(i),uv.getY(i));}geo.dispose();
  boat(b,atlas,'FORWARDING ADDRESS',GREEN,low);person(p,low);
  for(const v of [-4.5,4.5]){
    const x0=12.05,y0=top+.25,z0=BERTH.v+v,x1=BERTH.u-2.15,y1=sea+1.35,z1=BERTH.v+v*.8;
    l.quad([[x0,y0,z0-.025],[x1,y1,z1-.025],[x1,y1,z1+.025],[x0,y0,z0+.025]],ROPE);
  }
  const mesh=(q:Mesher)=>{fillUV(q);return new THREE.Mesh(q.geometry(),material);};
  const fixed=mesh(m),job=mesh(b),crew=new THREE.InstancedMesh(mesh(p).geometry,material,2),lines=mesh(l);
  fixed.name='Fishing wharf and moored boat';job.name='FORWARDING ADDRESS';crew.name='Skipper and new deckhand';lines.name='Cast-off lines or wake';
  // Reuse the cast-off lines' batch for a small, translucent wake: two foam bands that spread and widen astern
  // and a tapering wash between them. Unbroken bands: thin separate dashes read as road markings on the water.
  const w=new Mesher(),bands=low?3:5,reach=22.5;
  for(const side of [-1,1])for(let i=0;i<bands;i++){
    const d0=i*reach/bands,d1=(i+1)*reach/bands,x0=side*(1.2+.2*d0),x1=side*(1.2+.2*d1),h0=.22+.035*d0,h1=.22+.035*d1;
    w.quad([[x0-h0,.035,-6.5-d0],[x0+h0,.035,-6.5-d0],[x1+h1,.035,-6.5-d1],[x1-h1,.035,-6.5-d1]],[.72,.84,.83]);
  }
  for(let i=0;i<bands;i++){
    const d0=i*12/bands,d1=(i+1)*12/bands,h0=Math.max(.2,.75-.045*d0),h1=Math.max(.2,.75-.045*d1);
    w.quad([[-h0,.04,-6.2-d0],[h0,.04,-6.2-d0],[h1,.04,-6.2-d1],[-h1,.04,-6.2-d1]],[.86,.91,.88]);
  }
  fillUV(w);const wake=w.geometry(),rgb=wake.getAttribute('color'),posWake=wake.getAttribute('position'),rgba=new Float32Array(rgb.count*4);
  for(let i=0;i<rgb.count;i++){
    rgba[i*4]=rgb.getX(i);rgba[i*4+1]=rgb.getY(i);rgba[i*4+2]=rgb.getZ(i);
    rgba[i*4+3]=Math.max(0,.48*(1-(Math.abs(posWake.getZ(i))-7)/21))*(.8+.2*Math.sin(posWake.getX(i)*12+posWake.getZ(i)*7)**2);
  }
  wake.setAttribute('color',new THREE.BufferAttribute(rgba,4));
  const wakeMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.65,depthWrite:false,side:THREE.DoubleSide});
  // Flat foam needs both faces, but not the two transparency passes used for closed volumes.
  wakeMaterial.forceSinglePass=true;
  return {fixed,boat:job,crew,lines,mooring:lines.geometry,wake,wakeMaterial,mooringMaterial:material,triangles:m.triangles+b.triangles+p.triangles*2+Math.max(l.triangles,w.triangles)};
}
