import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export type Point = [number, number, number];
export type Profile = [number, number];

export function path(points: Profile[]): THREE.Shape {
  const shape = new THREE.Shape(); points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y)); shape.closePath(); return shape;
}
export function reverseTriangles(g: THREE.BufferGeometry): void {
  const index = g.index;
  if(index)for(let i=0;i<index.count;i+=3){const a=index.getX(i);index.setX(i,index.getX(i+2));index.setX(i+2,a);}
  else { const order:number[]=[];for(let i=0;i<g.attributes.position.count;i+=3)order.push(i+2,i+1,i);g.setIndex(order); }
}
/** Split cap triangles before folding a window frame onto a rounded cab. Hole walls keep their own normals. */
function refine(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const g=source.index?source.toNonIndexed():source,p=g.attributes.position,n=g.attributes.normal;
  const positions:number[]=[],normals:number[]=[];
  type Vertex=[number,number,number,number,number,number];
  const get=(i:number):Vertex=>[p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)];
  const length=(a:Vertex,b:Vertex)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const triangle=(a:Vertex,b:Vertex,c:Vertex,depth=0):void=>{
    const ab=length(a,b),bc=length(b,c),ca=length(c,a);
    if(Math.max(ab,bc,ca)>.46&&depth<7){
      if(bc>ab&&bc>=ca){triangle(b,c,a,depth);return;}if(ca>ab&&ca>bc){triangle(c,a,b,depth);return;}
      const mid=a.map((v,i)=>(v+b[i])/2) as Vertex;triangle(a,mid,c,depth+1);triangle(mid,b,c,depth+1);return;
    }
    for(const v of [a,b,c]){positions.push(v[0],v[1],v[2]);normals.push(v[3],v[4],v[5]);}
  };
  for(let i=0;i<p.count;i+=3)triangle(get(i),get(i+1),get(i+2));
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));result.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  if(g!==source)g.dispose();source.dispose();return result;
}

/** Geometry is collected by material and by moving parent: six tyre spins and one suspended body. */
export class TruckSurfaces {
  private batches=new Map<THREE.Object3D,Map<THREE.Material,THREE.BufferGeometry[]>>();
  constructor(readonly body:THREE.Group, private low=false){}
  add(g:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D=this.body):void {
    let group=this.batches.get(parent);if(!group){group=new Map();this.batches.set(parent,group);}
    let list=group.get(m);if(!list){list=[];group.set(m,list);}
    const geo=g.index?g.toNonIndexed():g;if(geo!==g)g.dispose();geo.deleteAttribute('uv');list.push(geo);
  }
  box(at:Point,size:Point,m:THREE.Material,parent:THREE.Object3D=this.body,rotation=0):void {
    const g=new THREE.BoxGeometry(...size);if(rotation)g.rotateX(rotation);g.translate(...at);this.add(g,m,parent);
  }
  round(at:Point,size:Point,m:THREE.Material,r=.035,parent:THREE.Object3D=this.body,rotation=0):void {
    const g=this.low?new THREE.BoxGeometry(...size):new RoundedBoxGeometry(...size,1,Math.min(r,...size.map(v=>v/3)));if(rotation)g.rotateX(rotation);g.translate(...at);this.add(g,m,parent);
  }
  tube(points:Point[],r:number,m:THREE.Material,parent:THREE.Object3D=this.body,sides=6,steps=points.length*3):void {
    if(this.low){sides=Math.min(sides,4);steps=Math.max(2,Math.ceil(steps/3));}
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),steps,r,sides,false),m,parent);
  }
  patch(point:(u:number,v:number)=>Point,cols:number,rows:number,m:THREE.Material,flip=false):void {
    if(this.low){cols=Math.max(2,Math.ceil(cols/3));rows=Math.max(1,Math.ceil(rows/3));}
    const positions:number[]=[],indices:number[]=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      positions.push(...point(i/cols,j/rows));
      if(i<cols&&j<rows){const a=j*(cols+1)+i,b=a+cols+1;indices.push(...(flip?[a,a+1,b,a+1,b+1,b]:[a,b,a+1,a+1,b,b+1]));}
    }
    const kept:number[]=[];
    for(let k=0;k<indices.length;k+=3){
      const a=indices[k]*3,b=indices[k+1]*3,c=indices[k+2]*3,ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2],vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
      if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)>1e-10)kept.push(indices[k],indices[k+1],indices[k+2]);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(kept);g.computeVertexNormals();
    // Surface derivatives avoid a row of small, false dents in a glossy panel's reflection.
    const n=g.attributes.normal;
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      const u=i/cols,v=j/rows,e=.0001,ua=point(u-e,v),ub=point(u+e,v),va=point(u,v-e),vb=point(u,v+e);
      const a=new THREE.Vector3(ub[0]-ua[0],ub[1]-ua[1],ub[2]-ua[2]),b=new THREE.Vector3(vb[0]-va[0],vb[1]-va[1],vb[2]-va[2]),normal=b.cross(a).normalize();if(flip)normal.negate();n.setXYZ(j*(cols+1)+i,normal.x,normal.y,normal.z);
    }
    this.add(g,m);
  }
  /** Both the mirrored triangles and every window-hole wall are oriented before the caps are curved. */
  cab(outline:Profile[],holes:Profile[][],sideX:(y:number,z:number)=>number,m:THREE.Material):void {
    const shape=path(outline);
    for(const points of holes){const hole=points.map(p=>new THREE.Vector2(...p));if(THREE.ShapeUtils.isClockWise(hole))hole.reverse();shape.holes.push(new THREE.Path(hole));}
    for(const sign of [-1,1]){
      const source=new THREE.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:false}),g=this.low?source:refine(source),old=g.attributes.normal.clone(),p=g.attributes.position;
      for(let i=0;i<p.count;i++){const z=p.getX(i),y=p.getY(i),d=p.getZ(i);p.setXYZ(i,sign*(sideX(y,z)-d),y,z);}
      if(sign<0)reverseTriangles(g);g.computeVertexNormals();const n=g.attributes.normal;
      for(let i=0;i<p.count;i++)if(Math.abs(old.getZ(i))>.99){const y=p.getY(i),z=p.getZ(i),out=old.getZ(i)<0?1:-1,dy=(sideX(y+.001,z)-sideX(y-.001,z))/.002,dz=(sideX(y,z+.001)-sideX(y,z-.001))/.002,l=Math.hypot(1,dy,dz);n.setXYZ(i,sign*out/l,-dy*out/l,-dz*out/l);}
      this.add(g,m);
    }
  }
  window(points:Profile[],sign:number,sideX:(y:number,z:number)=>number,m:THREE.Material):void {
    const source=new THREE.ShapeGeometry(path(points)),g=this.low?source:refine(source),p=g.attributes.position;
    for(let i=0;i<p.count;i++){const z=p.getX(i),y=p.getY(i);p.setXYZ(i,sign*(sideX(y,z)-.012),y,z);}
    if(sign>0)reverseTriangles(g);g.computeVertexNormals();this.add(g,m);
  }
  /** A front/rear casting in X/Y, including a correctly wound hole, folded onto a shallow curved fascia. */
  frame(outline:Profile[],holes:Profile[][],zAt:(x:number,y:number)=>number,depth:number,m:THREE.Material,back=false):void {
    const shape=path(outline);for(const points of holes){const h=points.map(p=>new THREE.Vector2(...p));if(THREE.ShapeUtils.isClockWise(h))h.reverse();shape.holes.push(new THREE.Path(h));}
    const source=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false}),g=this.low?source:refine(source),p=g.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),d=p.getZ(i);p.setZ(i,zAt(x,y)+(back?-d:d));}
    if(back)reverseTriangles(g);g.computeVertexNormals();this.add(g,m);
  }
  finish(red:THREE.Material):THREE.Mesh[] {
    const brakes:THREE.Mesh[]=[];
    for(const [parent,group]of this.batches)for(const [m,list]of group){const g=mergeGeometries(list);if(!g)throw Error('Pickup material layout mismatch');for(const old of list)old.dispose();const mesh=new THREE.Mesh(g,m);mesh.name=m.name;mesh.castShadow=true;parent.add(mesh);if(m===red)brakes.push(mesh);}
    return brakes;
  }
}
