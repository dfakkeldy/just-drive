import * as THREE from 'three';
import {Mesher,type RGB} from '../yard-kit';
import {siteHash,type PeriodSite} from './history-sites';
const WOOD:RGB=[.34,.31,.25],BOARD:RGB=[.43,.42,.37],TRIM:RGB=[.76,.74,.66],STONE:RGB=[.36,.35,.30],DARK:RGB=[.055,.047,.032],GLASS:RGB=[.065,.10,.105];
/** The timber floor may step into a bank; no exposed stone plinth exceeds this height. */
export const MAX_EXPOSED_FOUNDATION=1.2;
/** An original mill bank can be retained when no legal replacement exists; its stone base stays bounded. */
export const MAX_BANK_FOUNDATION=6;
export function periodBaseHeight(s:PeriodSite,high:number,low:number,eave:number):number {
 const steep=high-low>eave*.65;
 if(s.water)return Math.min(high+.12,low+(steep?MAX_BANK_FOUNDATION:MAX_EXPOSED_FOUNDATION)-.12);
 return steep?high+.12:Math.min(high+.12,low+MAX_EXPOSED_FOUNDATION-.12);
}

export interface PeriodProfile {width:number;length:number;eave:number;rise:number;floors:number;wall:RGB;roof:RGB;chimneyX:number;chimneyZ:number;ell:{x:number;z:number;width:number;length:number}|null}
/** Stable proportions stay within the reserved footprint. No random draws enter today's startup. */
export function periodProfile(s:PeriodSite,barn=false):PeriodProfile {
 const r=siteHash(s.id+'-shape'),c=siteHash(s.id+'-paint'),mill=s.kind==='mill',church=s.kind==='church';
 const width=mill?s.width:s.width*(.80+r*.15),length=s.length*(.90+siteHash(s.id+'-length')*.10);
 const eave=barn?3.7+r*.3:church?5.8:s.kind==='school'?3.65:s.kind==='forge'?2.9:mill?(s.word==='SAW MILL'?4.0:s.word==='SHINGLE MILL'?4.9:6.4):s.kind==='farm'?4.0+r*.25:3.9;
 const rise=width/2*(10/12+siteHash(s.id+'-pitch')/6);
 const shade=.90+c*.17;
 const palette:RGB=barn?[.38,.39,.36]:c<.65?[.76,.74,.66]:c<.86?[.43,.44,.41]:[.48,.45,.39];
 const wall=palette.map(v=>v*shade) as RGB,roof:RGB=[.28+r*.035,.265+r*.025,.225+r*.025];
 const ell=s.kind==='farm'&&!barn&&siteHash(s.id+'-ell')<.62?{x:(siteHash(s.id+'-ell-side')<.5?-1:1)*(s.width/2-1.35),z:-length/2+2,width:2.7,length:4}:null;
 return {width,length,eave,rise,floors:mill&&s.word!=='SAW MILL'&&s.word!=='SHINGLE MILL'?2:1,wall,roof,chimneyX:s.kind==='forge'?-width*.29:s.kind==='farm'?(r-.5)*.65:(r-.5)*width*.4,chimneyZ:-length*.16,ell};
}
export function historyGeometry(m:Mesher,codes?:number[]):THREE.BufferGeometry {
 const g=m.geometry(),kind=new Float32Array(m.pos.length/3);
 for(let i=0;i<kind.length;i++)kind[i]=codes?(codes[i]??0):(Math.abs(m.col[i*3]-.36)<.006&&Math.abs(m.col[i*3+1]-.35)<.006&&Math.abs(m.col[i*3+2]-.29)<.006?4:0);
 g.setAttribute('periodStyle',new THREE.BufferAttribute(kind,1));return g;
}
/** Procedural clapboards and staggered shingles use no source-image pixels and no extra draw. */
export function createHistoryMaterial():THREE.MeshLambertMaterial {
 const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float periodStyle;varying float vPeriodStyle;varying vec3 vPeriodP;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPeriodStyle=periodStyle;vPeriodP=position;');
  shader.fragmentShader='varying float vPeriodStyle;varying vec3 vPeriodP;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   if(vPeriodStyle>.5){
    float grain=fract(sin(dot(floor(vPeriodP.xz*17.0)+floor(vPeriodP.y*8.0),vec2(127.1,311.7)))*43758.5453);
    if(vPeriodStyle<1.5){float course=fract(vPeriodP.y/.115);diffuseColor.rgb*=.89+.14*grain;diffuseColor.rgb*=mix(.74,1.0,smoothstep(.02,.09,course));}
    else if(vPeriodStyle<2.5){float row=floor(vPeriodP.y/.17);vec2 shingle=vec2(vPeriodP.z/.25+mod(row,2.0)*.5,vPeriodP.y/.17);vec2 seam=fract(shingle);float tint=fract(sin(dot(floor(shingle),vec2(91.7,37.1)))*17371.7);diffuseColor.rgb*=.77+.33*tint;diffuseColor.rgb*=mix(.66,1.0,smoothstep(.018,.065,min(seam.x,seam.y)));}
    else if(vPeriodStyle<3.5){float across=abs(dFdx(vPeriodP.x))>abs(dFdx(vPeriodP.z))?vPeriodP.x:vPeriodP.z;float board=fract(across/.17);diffuseColor.rgb*=.88+.17*grain;diffuseColor.rgb*=mix(.68,1.0,smoothstep(.015,.055,board));}
    else{float row=floor(vPeriodP.y/.24);float joint=min(fract(vPeriodP.y/.24),fract((vPeriodP.x+vPeriodP.z)/.47+mod(row,2.0)*.5));diffuseColor.rgb*=.85+.20*grain;diffuseColor.rgb*=mix(.64,1.0,smoothstep(.015,.055,joint));}
   }`);
 };
 material.customProgramCacheKey=()=> '1884-wood-and-stone-v2';return material;
}
export function periodBuilding(s:PeriodSite,barn=false,floor:(x:number,z:number)=>number=()=>0):THREE.BufferGeometry {
 const m=new Mesher(),codes:number[]=[],p=periodProfile(s,barn),w=p.width/2,l=p.length/2,h=p.eave,rise=p.rise;
 const mark=(start:number,kind:number)=>{for(let i=start;i<m.pos.length/3;i++)codes[i]=kind;};
 const forge=s.kind==='forge',church=s.kind==='church',school=s.kind==='school',mill=s.kind==='mill',saw=mill&&s.word==='SAW MILL';
  if (s.kind === 'quarry') {
    // A fictional pale gypsum cut, timber derrick and wooden cart, not an invented industrial building.
    m.extrude([[-w, floor(-w,-l)], [w, floor(w,-l)], [w - 1, floor(w-1,-l)+4.2], [1, floor(1,-l)+5.4], [-w + 0.4, floor(-w+.4,-l)+3.1]], -l, -l + 2.2, [0.78, 0.76, 0.66]);
    for (const side of [-1, 1]) { const foot=floor(side*2.9,1)-.12,top=floor(0,1)+4.8,h=top-foot; m.at(side*2.3,(top+foot)/2,1,0,0,Math.atan2(side*1.2,h));m.box(0,0,0,.24,Math.hypot(1.2,h),.24,WOOD,false); }
    m.at(0, 4.8+floor(0,1), 1, 0, 0, .18); m.box(1.9, 0, 0, 4.8, .26, .26, WOOD, false);
    m.at(0, 0, 0); m.cyl(4.25, 3.6+floor(0,1), 1, .035, 4, DARK);
    m.box(1.3, .9+floor(1.3,3.6), 3.6, 2.1, .65, 1.3, BOARD, false);
    for (const x of [.5, 2.1]) for (const z of [2.85, 4.35]) m.cyl(x, .48+floor(x,z), z, .48, .16, WOOD, 'z', 8);
    return historyGeometry(m);
  }
 let start=m.pos.length/3;
 if(saw){
  for(const x of [-w,w])for(let z=-l;z<=l+.01;z+=p.length/4){const bottom=floor(x,z)-.12;m.box(x,(bottom+h)/2,z,.22,h-bottom,.22,WOOD,false);}
  m.box(0,h/2,-l+1.5,p.width,h,3,p.wall);mark(start,3);
 }else{m.box(0,h/2,0,p.width,h,p.length,p.wall);mark(start,barn?3:1);}
 start=m.pos.length/3;m.extrude([[-w,h],[w,h],[0,h+rise]],-l,l,p.wall);mark(start,barn?3:1);
 start=m.pos.length/3;
 for(const side of [-1,1])m.quad([[0,h+rise+.05,-l-.25],[side*(w+.25),h-.12,-l-.25],[side*(w+.25),h-.12,l+.25],[0,h+rise+.05,l+.25]],p.roof);
 mark(start,2);m.box(0,h+rise+.06,0,.12,.10,p.length+.5,WOOD);
 if(p.ell){
  const e=p.ell,eh=2.65,ew=e.width/2,el=e.length/2;start=m.pos.length/3;
  m.box(e.x,eh/2,e.z,e.width,eh,e.length,p.wall);m.at(e.x,0,e.z);m.extrude([[-ew,eh],[ew,eh],[0,eh+ew]],-el,el,p.wall);mark(start,1);
  start=m.pos.length/3;for(const side of [-1,1])m.quad([[0,eh+ew+.05,-el-.2],[side*(ew+.2),eh-.1,-el-.2],[side*(ew+.2),eh-.1,el+.2],[0,eh+ew+.05,el+.2]],p.roof);mark(start,2);m.at(0,0,0);
 }
 if(!saw)for(const x of [-w,w])for(const z of [-l,l])m.box(x,h/2,z,.10,h+.04,.10,TRIM);
 const doorW=forge||barn||mill||s.kind==='stables'?2.2:1.05,doorH=barn||mill?2.6:2.05;
 if(!saw){
  const entrance=Math.max(0,floor(0,l+.05)+.08,barn?floor(-1.1,l+.05)+.08:0,barn?floor(1.1,l+.05)+.08:0);
  const entry=barn?entrance:Math.min(entrance,Math.max(0,h-doorH-.15));
  if(barn){
   // A short earth ramp meets the raised threshold across the whole opening.
   const near=l+.12,far=l+1.1,left=floor(-1.3,far)+.03,right=floor(1.3,far)+.03;
   m.quad([[-1.3,entry,near],[1.3,entry,near],[1.3,right,far],[-1.3,left,far]],[.29,.24,.16]);
   for(const x of [-1.3,1.3])m.quad([[x,floor(x,near)-.04,near],[x,entry,near],[x,floor(x,far)+.03,far],[x,floor(x,far)-.04,far]],[.25,.21,.14]);
  }
  m.box(0,entry+doorH/2,l+.025,doorW,doorH,.06,DARK);
  if(!forge)for(const side of [-1,1])m.box(side*doorW*.25,entry+doorH/2,l+.07,doorW*.48,doorH-.06,.04,WOOD);
  for(const x of [-doorW/2-.055,doorW/2+.055])m.box(x,entry+doorH/2,l+.08,.11,doorH+.1,.1,TRIM);
  m.box(0,entry+doorH+.04,l+.08,doorW+.22,.10,.12,TRIM);
 }
 const window=(x:number,z:number,y:number,side=0,small=false)=>{
  const ww=small?.48:.64,hh=small?.72:1.08;m.at(x,y,z,side*Math.PI/2);
  m.box(0,0,0,ww+.12,hh+.12,.07,TRIM);
  m.quad([[-ww/2,-hh/2,.045],[ww/2,-hh/2,.045],[ww/2,hh/2,.045],[-ww/2,hh/2,.045]],GLASS);
  const bar=(x0:number,y0:number,x1:number,y1:number)=>m.quad([[x0,y0,.065],[x1,y0,.065],[x1,y1,.065],[x0,y1,.065]],TRIM);
  bar(-.02,-hh/2,.02,hh/2);for(const y of [-hh/6,hh/6])bar(-ww/2,y-.018,ww/2,y+.018);
  m.box(0,-hh/2-.1,.025,ww+.20,.10,.15,TRIM);
 };
 if(!forge&&!barn&&!saw){
  for(const x of [-w*.64,w*.64])window(x,l+.05,1.55);
  for(let z=-l+1.5;z<l-1;z+=mill?2.5:3.0)for(const side of [-1,1])for(let level=0;level<p.floors;level++)window(side*(w+.04),z,1.55+level*3,side);
  if(s.kind==='farm')window(0,l+.055,h+.8,0,true);
 }
 m.at(0,0,0);
 if(!church&&!barn&&!saw){
  const brick=siteHash(s.id+'-chimney')<.5,colour:RGB=brick?[.38,.20,.13]:STONE;
  start=m.pos.length/3;m.box(p.chimneyX,h+rise-.55,p.chimneyZ,.62,2.55,.65,colour);mark(start,4);
  m.box(p.chimneyX,h+rise+.78,p.chimneyZ,.78,.16,.8,DARK);
 }
 if(church){m.box(0,h+1.2,l-1.0,1.8,3.0,1.8,p.wall);for(const side of [-1,1])m.box(side*.62,h+3.0,l-1,.14,1.4,1.5,TRIM);m.cyl(0,h+4.75,l-1,1.25,3.1,p.roof,'y',4,0);m.box(0,h+6.8,l-1,.12,1.1,.12,TRIM);m.box(0,h+7,l-1,.65,.12,.12,TRIM);}
 if(school){for(const side of [-1,1])m.box(side*.45,h+rise+.7,0,.12,1.4,1.1,TRIM);m.cyl(0,h+rise+.6,0,.25,.4,[.38,.29,.11],'y',8,.16);m.cyl(0,h+rise+1.65,0,.85,.85,p.roof,'y',4,0);}
 if(mill&&!saw){
  const loading=p.floors===2?4.1:2.8;m.box(0,loading,l+.055,1.35,1.8,.08,WOOD);
  m.box(0,loading+1.2,l+.7,.20,.24,1.8,WOOD,false);m.cyl(0,loading+.35,l+1.45,.025,1.8,DARK,'y',6);
  if(s.word==='SHINGLE MILL')for(let i=0;i<4;i++)m.box(w+1,.3+floor(w+1,-l+1+i),-l+1+i,1.1,.6,.7,[.46,.43,.34]);
 }
 if(saw){
  for(let i=0;i<6;i++){const z=p.length/2-2.5+i*.48;m.cyl(0,.30+floor(0,z),z,.25,p.width*.75,[.28,.22,.15],'x',7);}
 }
 if(forge){
  m.box(0,.35,l+.15,1.45,.7,.65,STONE);m.box(0,.72,l+.15,1.3,.12,.6,DARK);
  m.box(2.6,.4+floor(2.6,s.length/2+1),s.length/2+1,.7,.8,.6,STONE);m.box(2.6,.85+floor(2.6,s.length/2+1),s.length/2+1,1.25,.2,.4,DARK);
 }
 const rw=s.width/2,rl=s.length/2;
 if(s.kind==='tannery')for(const x of [-2,0,2])m.cyl(x,.6+floor(x,-rl-2),-rl-2,.75,1.2,WOOD,'y',10);
 if(s.kind==='stables'){
  const left=floor(-rw+1,rl+2),right=floor(rw-1,rl+2),span=s.width-2;
  for(const x of [-rw+1,rw-1])m.box(x,.8+floor(x,rl+2),rl+2,.13,1.6,.13,WOOD);
  m.at(0,1.15+(left+right)/2,rl+2,0,0,Math.atan2(right-left,span));m.box(0,0,0,Math.hypot(span,right-left),.16,.16,WOOD);m.at(0,0,0);
  for(const z of [-4,0,4])m.box(w+.035,1.25,z,.06,2.5,1.8,DARK);
 }
 if(s.kind==='factory')for(let z=-rl+1;z<rl;z+=2.4)m.box(rw+1,.45+floor(rw+1,z),z,1.3,.9,1.5,BOARD);
 return historyGeometry(m,codes);
}
export function waterWheel(): THREE.BufferGeometry {
  const m = new Mesher();
  for (const x of [-.5,.5]) {
    m.at(x,0,0); m.cyl(0,0,0,2.2,.16,WOOD,'x',16,2.2,null);
    // Open spokes: the paddles form the rim, with no solid disk hiding the brook.
    for (let i=0;i<8;i++) { m.at(x,0,0,0,i*Math.PI/4); m.box(0,0,0,.18,.16,4.0,BOARD,false); }
  }
  for (let i=0;i<16;i++) {
    const a=i*Math.PI/8;m.at(0,Math.cos(a)*2.05,Math.sin(a)*2.05,0,a);m.box(0,0,0,1.4,.22,.5,BOARD,false);
  }
  m.at(0,0,0);m.cyl(0,0,0,.18,2.2,WOOD,'x',10);
  return historyGeometry(m,new Array(m.pos.length/3).fill(3));
}
export function signLines(word:string):string[]{
 if(word.length<=10)return [word];const words=word.split(' ');let best=1,d=Infinity;
 for(let i=1;i<words.length;i++){const n=Math.max(words.slice(0,i).join(' ').length,words.slice(i).join(' ').length);if(n<d){best=i;d=n;}}
 return [words.slice(0,best).join(' '),words.slice(best).join(' ')];
}
export function signSize(word:string):{width:number;height:number}{const lines=signLines(word);return {width:Math.min(8.6,Math.max(4.2,Math.max(...lines.map(l=>l.length))*.57+.8)),height:lines.length>1?2.4:1.6};}
export function historySignAtlas(words:readonly string[]):{texture:THREE.CanvasTexture;cell(word:string):[number,number,number,number];capHeight(word:string):number}{
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;const g=canvas.getContext('2d')!,unique=[...new Set(words.filter(Boolean))],caps=new Map<string,number>();
 for(let i=0;i<unique.length;i++){
  const x=i%2*1024,y=Math.floor(i/2)*256,lines=signLines(unique[i]);g.fillStyle='#f5efdc';g.fillRect(x,y,1024,256);g.strokeStyle='#20382d';g.lineWidth=8;g.strokeRect(x+5,y+5,1014,246);
  const n=Math.max(...lines.map(l=>l.length));let size=Math.min(lines.length>1?122:190,Math.floor(920/(n*.63)));g.font=`900 ${size}px Georgia,serif`;const measured=Math.max(...lines.map(l=>g.measureText(l).width));if(measured>920){size=Math.floor(size*920/measured);g.font=`900 ${size}px Georgia,serif`;}g.fillStyle='#12291f';g.textAlign='center';g.textBaseline='middle';
  for(let j=0;j<lines.length;j++)g.fillText(lines[j],x+512,y+(j+.5)*256/lines.length);
  caps.set(unique[i],((g.measureText('H').actualBoundingBoxAscent+g.measureText('H').actualBoundingBoxDescent)||size*.72)/256*signSize(unique[i]).height);
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
 return {texture,cell(word){const i=unique.indexOf(word),x=i%2/2,y=Math.floor(i/2)/8;return [x,1-y-1/8,x+.5,1-y];},capHeight:word=>caps.get(word)??0};
}
/** Contacts are local. Geometry rebuilds only when these selected terrain sources change. */
export function periodGroundPoints(s:PeriodSite,barn=false):[number,number][]{
 const w=s.width/2,l=s.length/2,p=periodProfile(s,barn),points:[number,number][]=[[0,p.length/2+1],[0,p.length/2+.05]];
 if(barn){for(const x of [-1.1,1.1])points.push([x,p.length/2+.05]);for(const x of [-1.3,1.3])for(const z of [.12,1.1])points.push([x,p.length/2+z]);}
 if(s.kind==='forge')points.push([2.6,l+1]);
 if(s.kind==='tannery')for(const x of [-2,0,2])points.push([x,-l-2]);
 if(s.kind==='stables')points.push([-w+1,l+2],[w-1,l+2]);
 if(s.kind==='factory')for(let z=-l+1;z<l;z+=2.4)points.push([w+1,z]);
 if(s.kind==='mill'&&s.word==='SAW MILL'){for(const x of [-p.width/2,p.width/2])for(let z=-p.length/2;z<=p.length/2+.01;z+=p.length/4)points.push([x,z]);for(let i=0;i<6;i++)points.push([0,p.length/2-2.5+i*.48]);}
 if(s.kind==='mill'&&s.word==='SHINGLE MILL')for(let i=0;i<4;i++)points.push([p.width/2+1,-p.length/2+1+i]);
 if(p.ell)for(const x of [-1,1])for(const z of [-1,1])points.push([p.ell.x+x*p.ell.width/2,p.ell.z+z*p.ell.length/2]);
 if(s.kind==='quarry')points.push([0,l+.2],[-p.width/2,-p.length/2],[p.width/2,-p.length/2],[p.width/2-1,-p.length/2],[1,-p.length/2],[-p.width/2+.4,-p.length/2],[0,1],[-2.9,1],[2.9,1],[1.3,3.6],[.5,2.85],[.5,4.35],[2.1,2.85],[2.1,4.35],[-2,l+.2],[2,l+.2]);
 return points;
}
