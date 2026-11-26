/** Optional class-only NSTDB designated-area layer. No class request or texture on the default path.
 * Classes: 0 unknown, 1 hard paved (asphalt), 2 owner-observed gravel lot. The atlas is RG8: red is asphalt, green
 * is gravel, each expanded to 0/255 so the hardware filter gives a continuous 2 m edge. Owner stall rows (painted
 * lines on an asphalt lot) come in the index, in EPSG:2961 metres; the nearest few go to the ground shader as uniforms. */
import * as THREE from 'three';
import { readFile } from './store';
import { pavedGroundShader, pavedGrassShader, STALL_ROWS } from './paved-shader';
const SIDE=128, SIZE=256, RADIUS=2, ACROSS=RADIUS*2+1, PIXELS=SIDE*ACROSS;
/** A stall row: front (aisle) line e0,n0 -> e1,n1; stalls reach `depth` metres to its left, one line every `spacing`. */
export type StallRow=[e0:number,n0:number,e1:number,n1:number,depth:number,spacing:number];
interface Index {source?:string;version:number;area:string;epsg:number;origin:[number,number];tileMetres:number;resolution:number;side:number;classes:Record<string,string>;tiles:string[];railTiles?:string[];stalls?:StallRow[]}
interface Entry {i:number;j:number;name:string;data:Uint8Array|null;loading:boolean;failed:boolean;attempts:number;retryAt:number}
export function classTile(buffer:ArrayBuffer):Uint8Array {
  const data=new Uint8Array(buffer);
  if(data.length!==SIDE*SIDE||data.some(v=>v>2))throw Error('Invalid paved class tile');
  return data;
}
export class Paved {
  /** The live car, including while a free camera pauses vehicle physics. */
  car: {x:number;z:number} | null = null;
  readonly texture:THREE.DataTexture;
  readonly uniforms:Record<string,THREE.IUniform>;
  applyGround(material:THREE.ShaderMaterial):void {
    material.fragmentShader=pavedGroundShader(material.fragmentShader);Object.assign(material.uniforms,this.uniforms);
  }
  applyGrass(material:THREE.ShaderMaterial):void {
    material.vertexShader=pavedGrassShader(material.vertexShader);Object.assign(material.uniforms,this.uniforms);
  }
  private readonly pixels=new Uint8Array(PIXELS*PIXELS*2);
  private readonly stallA=Array.from({length:STALL_ROWS},()=>new THREE.Vector4());
  private readonly stallB=Array.from({length:STALL_ROWS},()=>new THREE.Vector4());
  private readonly stallCount={value:0};
  /** Stall rows in world metres: front origin x,z, unit direction x,z; length, depth, spacing. */
  private readonly stalls:{x:number;z:number;dx:number;dz:number;len:number;depth:number;spacing:number}[];
  private readonly rect=new THREE.Vector4(0,0,0,0);
  private readonly carPosition=new THREE.Vector2();
  private nextRetry=Infinity;
  private readonly names:Set<string>;
  private readonly entries=new Map<string,Entry>();
  private left=NaN;private top=NaN;private active=0;private waiting=0;
  private readonly vx:number;private readonly vy:number;
  constructor(private readonly index:Index,private readonly base:string,village:readonly [number,number],private readonly now:()=>number=()=>performance.now()) {
    if(index.version!==1||!['mabou','judique','porthood','westbay','pointtupper','cansocauseway'].includes(index.area)||index.epsg!==2961||index.tileMetres!==SIZE||index.resolution!==2||index.side!==SIDE||
       index.origin.length!==2||!index.origin.every(Number.isFinite)||![...index.tiles,...(index.railTiles??[])].every(n=>/^\d+_\d+\.r8$/.test(n))||
       !(index.stalls??[]).every(r=>r.length===6&&r.every(Number.isFinite)&&r[4]>0&&r[5]>0))throw Error('Invalid paved index');
    this.vx=village[0];this.vy=village[1];this.names=new Set(index.tiles);
    this.stalls=(index.stalls??[]).map(([e0,n0,e1,n1,depth,spacing])=>{
      const len=Math.hypot(e1-e0,n1-n0);
      return {x:e0-this.vx,z:this.vy-n0,dx:(e1-e0)/len,dz:-(n1-n0)/len,len,depth,spacing};
    });
    this.texture=new THREE.DataTexture(this.pixels,PIXELS,PIXELS,THREE.RGFormat,THREE.UnsignedByteType);
    this.texture.internalFormat='RG8';this.texture.magFilter=this.texture.minFilter=THREE.LinearFilter;
    this.texture.generateMipmaps=false;this.texture.flipY=false;this.texture.unpackAlignment=1;this.texture.needsUpdate=true;
    this.uniforms={tPaved:{value:this.texture},pavedRect:{value:this.rect},pavedCar:{value:this.carPosition},
      pavedStallA:{value:this.stallA},pavedStallB:{value:this.stallB},pavedStallCount:this.stallCount};
  }
  /** Class bytes are shared with tree planting. No extra draw or GPU texture.
   * A failed class read holds planting in the tree loader's bounded retry path. */
  async treeMask(key:string):Promise<Uint8Array|null> {
    const name=key+'.r8';
    if(!this.names.has(name))return null;
    const cached=this.entries.get(name)?.data;if(cached)return cached;
    return classTile(await (await readFile(this.base,`paved/${name}`)).arrayBuffer());
  }
  /** The inn uses the same mapped cells for tire contact and visible pavement. */
  maritimeInnAsphaltAt(x: number, z: number): boolean {
    if (this.index.area !== 'pointtupper') return false;
    const east = x + this.vx, north = this.vy - z;
    // Local window around the inn's front and rear lots. The mapped class defines the edges.
    if (east < 628535 || east > 628647 || north < 5052436 || north > 5052540) return false;
    const col = Math.floor((east - this.index.origin[0]) / this.index.resolution);
    const row = Math.floor((this.index.origin[1] - north) / this.index.resolution);
    const tile = this.entries.get(`${Math.floor(col / SIDE)}_${Math.floor(row / SIDE)}.r8`);
    return tile?.data?.[(row % SIDE) * SIDE + col % SIDE] === 1;
  }
  get pending():number { return this.waiting; }
  private countWaiting():void {
    this.waiting=0;for(const e of this.entries.values())if(!e.data&&!e.failed)this.waiting++;
  }
  /** Called each frame, but allocates/queues only after crossing a 256 m cell. */
  update(x:number,z:number):void {
    this.carPosition.set(x,z);
    if(this.nextRetry<=this.now()){this.nextRetry=Infinity;this.pump();}
    const left=Math.floor((x+this.vx-this.index.origin[0])/SIZE)-RADIUS;
    const top=Math.floor((this.index.origin[1]-this.vy+z)/SIZE)-RADIUS;
    if(left===this.left&&top===this.top)return;
    this.left=left;this.top=top;
    this.rect.set(this.index.origin[0]+left*SIZE-this.vx,this.vy-this.index.origin[1]+top*SIZE,SIZE*ACROSS,SIZE*ACROSS);
    this.pixels.fill(0);
    this.pickStalls(x,z);
    for(const [key,e] of this.entries)if(e.i<left||e.i>=left+ACROSS||e.j<top||e.j>=top+ACROSS)this.entries.delete(key);
    for(let j=top;j<top+ACROSS;j++)for(let i=left;i<left+ACROSS;i++){
      const name=`${i}_${j}.r8`;
      if(!this.names.has(name))continue;
      let e=this.entries.get(name);
      if(!e){e={i,j,name,data:null,loading:false,failed:false,attempts:0,retryAt:0};this.entries.set(name,e);}
      if(e.data)this.copy(e);
    }
    this.texture.needsUpdate=true;this.countWaiting();this.pump();
  }
  /** The rows nearest the car (by their middle), refreshed when the car crosses a 256 m cell. */
  private pickStalls(x:number,z:number):void {
    const near=this.stalls.map(s=>({s,d:Math.hypot(s.x+s.dx*s.len/2-x,s.z+s.dz*s.len/2-z)})).filter(r=>r.d<SIZE*RADIUS).sort((a,b)=>a.d-b.d).slice(0,STALL_ROWS);
    near.forEach(({s},k)=>{this.stallA[k].set(s.x,s.z,s.dx,s.dz);this.stallB[k].set(s.len,s.depth,s.spacing,0);});
    this.stallCount.value=near.length;
  }
  private copy(e:Entry):void {
    const col=(e.i-this.left)*SIDE,row=(e.j-this.top)*SIDE;
    // Expand classes to the full normalized range before hardware filtering: red asphalt, green gravel.
    // Filtering byte values 0/1 loses fractional edge precision on Metal.
    for(let r=0;r<SIDE;r++)for(let c=0;c<SIDE;c++){
      const v=e.data![r*SIDE+c],k=((row+r)*PIXELS+col+c)*2;
      this.pixels[k]=v===1?255:0;this.pixels[k+1]=v===2?255:0;
    }
  }
  private pump():void {
    for(const e of this.entries.values()){
      if(this.active>=4)return;
      if(e.data||e.loading)continue;
      if(e.failed&&e.retryAt>this.now()){this.nextRetry=Math.min(this.nextRetry,e.retryAt);continue;}
      e.failed=false;
      e.loading=true;this.active++;this.countWaiting();
      void readFile(this.base,`paved/${e.name}`).then(blob=>blob.arrayBuffer()).then(buffer=>{
        if(this.entries.get(e.name)!==e)return;
        e.data=classTile(buffer);this.copy(e);this.texture.needsUpdate=true;
      }).catch(error=>{if(this.entries.get(e.name)!==e)return;e.failed=true;e.loading=false;e.attempts++;e.retryAt=this.now()+Math.min(30000,1000*2**(e.attempts-1));this.nextRetry=Math.min(this.nextRetry,e.retryAt);console.warn('Paved tile unavailable; will retry',e.name,error);}).finally(()=>{this.active--;this.countWaiting();this.pump();});
    }
  }
}
/** `indexRead` is the index read main.ts started beside the other boot reads; without it, the index is read here. */
export async function loadPaved(base:string,village:readonly [number,number],area:string,indexRead?:Promise<Blob>):Promise<Paved> {
  const index=JSON.parse(await (await (indexRead??readFile(base,'paved/index.json'))).text()) as Index;
  if(index.area!==area||index.source!=='nstdb-designated-open-v1')throw Error('Paved source/area mismatch');
  return new Paved(index,base,village);
}
