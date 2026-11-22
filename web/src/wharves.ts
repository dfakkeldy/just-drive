import * as THREE from 'three';
import { Mesher, type RGB } from './yard-kit';
import type { Terrain } from './terrain';
import { WHARF_SOURCES } from './wharf-source';
import { buildingBlocker, planWharf, type Footprint, type WharfPart, type WharfPlacement } from './wharf-plan';

const WOOD:RGB=[.24,.18,.12], METAL:RGB=[.22,.27,.27], DARK:RGB=[.025,.031,.033];
const PARTS:readonly WharfPart[]=['edge','bollard','ladder','tyre','pole','trap','buoy'];
function brace(m:Mesher,x:number):void { m.box(x,.18,-.55,.07,.07,.9,METAL); }
function geometry(kind:WharfPart):THREE.BufferGeometry {
  const m=new Mesher();
  if(kind==='edge'){
    m.box(0,.04,0,1,.32,.24,[.43,.43,.39]);
    m.box(0,-.26,0,1,.28,.18,WOOD);
  }else if(kind==='bollard'){
    m.box(0,.035,0,.45,.07,.45,METAL);m.cyl(0,.20,0,.09,.34,METAL,'y',8);
    m.box(0,.35,0,.48,.10,.13,METAL);
  }else if(kind==='ladder'){
    for(const x of [-.3,.3]){m.box(x,-.55,-1,.055,1.7,.055,METAL);brace(m,x);}
    for(let y=-1.3;y<.5;y+=.3)m.box(0,y,-1,.65,.055,.055,METAL);
  }else if(kind==='tyre'){
    const g=new THREE.TorusGeometry(.35,.11,4,12);g.translate(0,-.26,-1);
    const triangles=g.toNonIndexed(),positions=triangles.getAttribute('position');
    for(let i=0;i<positions.count;i++){m.pos.push(positions.getX(i),positions.getY(i),positions.getZ(i));m.col.push(...DARK);}
    g.dispose();triangles.dispose();brace(m,0);
  }else if(kind==='pole'){
    m.cyl(0,3.5,0,.10,7,WOOD,'y',8);m.box(.5,6.6,0,1.2,.1,.1,METAL);
    m.box(1,6.5,0,.6,.16,.35,[.8,.79,.69]);
  }else if(kind==='trap'){
    m.box(0,.04,0,1,.08,.7,WOOD);
    for(const s of [-1,1]){
      for(const t of [-1,1])m.box(s*.48,.36,t*.32,.035,.64,.035,METAL);
      m.box(0,.69,s*.32,1,.035,.035,METAL);m.box(s*.48,.69,0,.035,.035,.7,METAL);
      for(let x=-.4;x<.5;x+=.2)m.box(x,.36,s*.32,.018,.64,.018,METAL);
      for(const y of [.22,.44])m.box(0,y,s*.32,1,.018,.018,METAL);
    }
    for(let x=-.4;x<.5;x+=.2)m.box(x,.69,0,.018,.018,.64,METAL);
    m.cyl(0,.35,0,.15,.025,DARK,'z',8);
  }else{
    m.cyl(0,.23,0,.15,.46,[.82,.29,.06],'y',8,.06);m.box(0,.51,0,.04,.10,.04,WOOD);
  }
  const geo=m.geometry();
  if(kind==='bollard')geo.translate(0,.2,0);
  return geo;
}
/** Seven batches per area, shared by every public wharf. No signs, textures, lights or per-part materials. */
export class PublicWharves {
  readonly group=new THREE.Group();
  readonly sources;
  readonly batches=new Map<WharfPart,THREE.InstancedMesh>();
  readonly placements:Array<WharfPlacement & {source:string}>=[];
  /** Wharf plans made so far (each one samples the drawn mesh some thousands of times). */
  plans=0;
  private readonly state;
  private readonly transform=new THREE.Object3D();
  /** `footprints`: the drawn buildings' outlines (east/north metres); no part is placed in or beside one. */
  constructor(area:string,private terrain:Terrain,private village:readonly [number,number],private sea:number,footprints:readonly Footprint[]=[]){
    this.sources=WHARF_SOURCES.filter(s=>s.area===area);
    this.state=this.sources.map(source=>{
      const xs=source.outline.map(p=>p[0]-village[0]),zs=source.outline.map(p=>village[1]-p[1]);
      return {source,blocked:buildingBlocker(source.outline,footprints),near:false,stamp:'',parts:[] as Array<WharfPlacement & {source:string}>,
        box:[Math.min(...xs)-3,Math.min(...zs)-3,Math.max(...xs)+3,Math.max(...zs)+3] as const};
    });
    const material=new THREE.MeshLambertMaterial({vertexColors:true});
    const capacity=this.sources.reduce((sum,s)=>sum+s.outline.slice(1).reduce((v,p,i)=>v+Math.ceil(Math.hypot(p[0]-s.outline[i][0],p[1]-s.outline[i][1])/2),0),0)+128;
    for(const kind of PARTS){
      const mesh=new THREE.InstancedMesh(geometry(kind),material,capacity);
      mesh.name=`Public wharf ${kind}`;mesh.count=0;mesh.visible=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.receiveShadow=true;this.batches.set(kind,mesh);this.group.add(mesh);
    }
    this.group.name='Public wharves';
  }
  /** Each wharf within 1.2 km keeps its own plan. It is planned again only when the drawn land under it changes (a tile
   *  load or eviction, an LOD switch or a hidden quarter), and kept while none of that land is drawn (behind the camera). */
  update(camera:THREE.Vector3):void {
    let dirty=false;
    for(const st of this.state){
      const [x0,z0,x1,z1]=st.box,near=Math.hypot(Math.max(x0-camera.x,0,camera.x-x1),Math.max(z0-camera.z,0,camera.z-z1))<1200;
      if(near!==st.near){st.near=near;dirty=true;}
      if(!near||this.terrain.burst)continue;
      const stamp=this.terrain.drawnOver(x0,z0,x1,z1);
      if(stamp===''||stamp===st.stamp)continue;
      st.stamp=stamp;this.plans++;dirty=true;
      const ground=(e:number,n:number)=>this.terrain.meshHeightAt(e-this.village[0],this.village[1]-n,true);
      st.parts=planWharf(st.source,ground,this.sea,st.blocked).map(p=>({...p,source:st.source.id}));
    }
    if(dirty)this.draw();
  }
  private draw():void {
    for(const mesh of this.batches.values())mesh.count=0;
    this.placements.length=0;
    for(const st of this.state)if(st.near)for(const p of st.parts){
      const mesh=this.batches.get(p.kind);if(!mesh)continue;
      this.transform.position.set(p.e-this.village[0],p.height+p.lift,this.village[1]-p.n);
      this.transform.rotation.set(0,-p.angle,Math.atan(p.slope));this.transform.scale.set(p.kind==='edge'?p.length*Math.hypot(1,p.slope):1,1,1);this.transform.updateMatrix();
      if(mesh.count>=mesh.instanceMatrix.count)throw new Error('Wharf instance capacity exceeded');
      mesh.setMatrixAt(mesh.count++,this.transform.matrix);this.placements.push(p);
    }
    for(const mesh of this.batches.values()){
      mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;
      if(mesh.count){mesh.computeBoundingBox();mesh.computeBoundingSphere();}
    }
  }
}
export const hasWharves=(area:string):boolean=>WHARF_SOURCES.some(s=>s.area===area);
