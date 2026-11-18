import * as THREE from 'three';
import type {Site,Terrain} from '../terrain';
import {HistoryContacts,type HistoryContact} from './history-contacts';

/** A short, earth-coloured timber abutment. Its far edge meets actual land triangles. */
export class TimberApron {
  readonly group=new THREE.Group();
  readonly site:Site;
  readonly audit={tiles:0,triangles:0,bytes:0,rebuilds:0,maxGrade:0};
  private readonly contacts:HistoryContacts;
  private readonly refs:HistoryContact[]=[];
  private readonly cumulative:number[]=[0];
  private readonly xs:Float64Array;private readonly zs:Float64Array;private readonly top:Float64Array;
  private readonly rows:number;private readonly length:number;
  private ready=false;private dirty=true;private preparedRevision=-1;private stableSource=false;
  private readonly notify=()=>{this.dirty=true;};
  private mesh:THREE.Mesh|null=null;
  constructor(private readonly terrain:Terrain,path:readonly [number,number][],private start:number,private readonly slope:number,readonly half:number){
    for(let i=1;i<path.length;i++)this.cumulative.push(this.cumulative[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
    this.length=this.cumulative[this.cumulative.length-1];this.rows=Math.ceil(this.length)+1;
    this.xs=new Float64Array(this.rows*3);this.zs=new Float64Array(this.rows*3);this.top=new Float64Array(this.rows*3);
    this.contacts=new HistoryContacts(terrain);
    let xmin=Infinity,xmax=-Infinity,zmin=Infinity,zmax=-Infinity;
    for(let r=0;r<this.rows;r++){
      const s=this.length*r/(this.rows-1);let i=0;while(i<path.length-2&&this.cumulative[i+1]<s)i++;
      const a=path[i],b=path[i+1],n=this.cumulative[i+1]-this.cumulative[i],u=(s-this.cumulative[i])/n,dx=(b[0]-a[0])/n,dz=(b[1]-a[1])/n;
      for(let c=0;c<3;c++){const k=r*3+c,side=(c-1)*half,x=a[0]+(b[0]-a[0])*u-dz*side,z=a[1]+(b[1]-a[1])*u+dx*side;this.xs[k]=x;this.zs[k]=z;this.refs.push(this.contacts.watch(x,z,this.notify));xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);zmin=Math.min(zmin,z);zmax=Math.max(zmax,z);}
    }
    this.site={box:[xmin-1,zmin-1,xmax+1,zmax+1],height:(_x,_z,h)=>h,surface:()=>null,
      contactMesh:(x,z)=>this.height(x,z)!==null?1:0,deckHeight:(x,z)=>this.height(x,z),deckDriving:{kind:3,halfWidth:half}};
    this.group.name='timber-abutment';
  }
  height(x:number,z:number):number|null{
    if(!this.ready)return null;let height:number|null=null;
    // Read the same ribbon triangles as the renderer, including the inside of a bank-road turn.
    for(let r=0;r<this.rows-1;r++)for(let c=0;c<2;c++)for(let side=0;side<2;side++){
      const i=r*3+c,a=side?i+1:i,b=i+3,d=side?i+4:i+1;
      const ax=this.xs[a],az=this.zs[a],bx=this.xs[b]-ax,bz=this.zs[b]-az,dx=this.xs[d]-ax,dz=this.zs[d]-az;
      const px=x-ax,pz=z-az,det=bx*dz-bz*dx,u=(px*dz-pz*dx)/det,v=(bx*pz-bz*px)/det;
      if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8){const h=this.top[a]+(this.top[b]-this.top[a])*u+(this.top[d]-this.top[a])*v;height=height===null?h:Math.max(height,h);}
    }
    return height;
  }
  prepare():boolean{
    this.contacts.update();const revision=this.terrain.contactRevision;
    if(revision===this.preparedRevision)return this.stableSource;
    this.preparedRevision=revision;this.stableSource=false;
    for(let k=0;k<this.refs.length;k++){
      const p=this.refs[k];if(!p.known||(this.terrain.surfaceAt(p.x,p.z)?.level??0)<6)return false;
      // Do not permanently raise a span from a transient level-5 triangle while its bank loads.
      // These public source IDs compare the selected mesh with the finest loaded mesh.
      if(this.terrain.meshContactSource(p.x,p.z)!==this.terrain.meshContactSource(p.x,p.z,true))return false;
    }
    this.stableSource=true;return true;
  }
  /** Clearance over the bank at the core join, measured from the actual land mesh. */
  clearance():number{let rise=0;const step=this.length/(this.rows-1);for(let r=0;r<=4&&r<this.rows;r++)for(let c=0;c<3;c++)rise=Math.max(rise,this.refs[r*3+c].height+.04-(this.start+this.slope*r*step));return rise;}
  raise(rise:number):void{this.start+=rise;this.dirty=true;}
  update():void{if(!this.prepare()||!this.dirty)return;this.dirty=false;this.rebuild();}
  private rebuild():void{
    const step=this.length/(this.rows-1),n=this.rows-1;
    for(let r=0;r<this.rows;r++)for(let c=0;c<3;c++){
      const k=r*3+c,t=r/n,t2=t*t,t3=t2*t,end=this.refs[n*3+c].height,derivative=Math.max(-.14,Math.min(.14,(end-this.refs[(n-1)*3+c].height)/step));
      const profile=(2*t3-3*t2+1)*this.start+(t3-2*t2+t)*this.length*this.slope+(-2*t3+3*t2)*end+(t3-t2)*this.length*derivative;
      this.top[k]=r===0?this.start:Math.max(profile,this.refs[k].height);
    }
    const positions:number[]=[],colours:number[]=[],indices:number[]=[];
    const vertex=(x:number,y:number,z:number,shade:number)=>{positions.push(x,y,z);colours.push(.40*shade,.29*shade,.17*shade);return positions.length/3-1;};
    for(let k=0;k<this.top.length;k++)vertex(this.xs[k],this.top[k],this.zs[k],1);
    this.audit.maxGrade=0;
    for(let r=0;r<n;r++){
      for(let c=0;c<2;c++){const i=r*3+c;indices.push(i,i+3,i+1,i+1,i+3,i+4);}
      this.audit.maxGrade=Math.max(this.audit.maxGrade,Math.abs(this.top[(r+1)*3+1]-this.top[r*3+1])/step);
      for(const c of [0,2]){const a=r*3+c,b=a+3,loA=vertex(this.xs[a],Math.min(this.top[a]-.12,this.refs[a].height),this.zs[a],.8),loB=vertex(this.xs[b],Math.min(this.top[b]-.12,this.refs[b].height),this.zs[b],.8);indices.push(a,loA,b,b,loA,loB);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.setIndex(indices);geo.computeVertexNormals();
    if(this.mesh){this.group.remove(this.mesh);this.mesh.geometry.dispose();}else this.mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
    this.mesh.geometry=geo;this.mesh.receiveShadow=true;this.mesh.castShadow=true;this.group.add(this.mesh);this.ready=true;
    this.audit.triangles=indices.length/3;this.audit.bytes=geo.attributes.position.array.byteLength+geo.attributes.normal.array.byteLength+geo.attributes.color.array.byteLength+geo.index!.array.byteLength;this.audit.rebuilds++;
  }
}
