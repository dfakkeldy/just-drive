import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AirportSite } from './airport-site';
export { AirportSite };
import type { Terrain } from './terrain';
/** Regular lamp positions are an honest visual approximation, not a surveyed lighting plan. */
export class Airport {
  readonly group=new THREE.Group();
  private matrix=new THREE.Matrix4();
  private lamps:{mesh:THREE.InstancedMesh;points:[number,number][]}[]=[];
  private sock:THREE.Mesh;
  constructor(readonly site:AirportSite,private terrain:Terrain,night:boolean){
    const {data,frame:f,village:v}=site,[a]=data.runway.ends;
    terrain.uniforms.airportFrame.value.set(a[0]-v[0],v[1]-a[1],f.ux,-f.un);
    terrain.uniforms.airportSize.value.set(f.length,data.runway.width);
    const white:[number,number][]=[],green:[number,number][]=[],red:[number,number][]=[];
    for(let i=0;i<=Math.ceil(f.length/data.lighting.edgeSpacing);i++)for(const side of [-1,1]){
      const u=f.length*i/Math.ceil(f.length/data.lighting.edgeSpacing),w=side*(data.runway.width/2+1.5);
      white.push([a[0]+f.ux*u-f.un*w,a[1]+f.un*u+f.ux*w]);
    }
    for(const end of [0,f.length])for(let j=-3;j<=3;j++){
      const w=j*6; (end===0?green:red).push([a[0]+f.ux*end-f.un*w,a[1]+f.un*end+f.ux*w]);
    }
    // No point lights or textures. Small emissive heads remain visible at night.
    for(const [color,points] of [[0xfff1cd,white],[0x42ff87,green],[0xff4835,red]] satisfies [number,[number,number][]][]){
      const mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(night?.32:.16,6,4),new THREE.MeshBasicMaterial({color,toneMapped:false}),points.length);
      mesh.count=0;this.group.add(mesh);this.lamps.push({mesh,points});
    }
    // One merged windsock (pole and five stripes, vertex colours): one draw call, not six.
    const parts:THREE.BufferGeometry[]=[];
    const paint=(g:THREE.BufferGeometry,hex:number)=>{const c=new THREE.Color(hex),n=g.attributes.position.count,a=new Float32Array(n*3);
      for(let i=0;i<n;i++)a.set([c.r,c.g,c.b],i*3);g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;};
    parts.push(paint(new THREE.CylinderGeometry(.06,.06,5,6).translate(0,2.5,0),0x90938e));
    for(let i=0;i<5;i++)parts.push(paint(new THREE.CylinderGeometry(.35-i*.045,.305-i*.045,.45,8,1,true).rotateZ(-Math.PI/2).translate(.2+i*.45,4.9-i*.05,0),i%2?0xeee7d5:0xe87829));
    this.sock=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
    for(const g of parts)g.dispose();
    this.group.add(this.sock);this.sock.visible=false;
  }
  private stamp='';
  /** Hidden beyond 3 km of the airfield. Refit only when the drawn land changes (a new tile, or a
   * different visible LOD, including turning back toward cached airport land). */
  update(camera:{x:number;z:number}){
    const b=this.site.box,dx=Math.max(b[0]-camera.x,0,camera.x-b[2]),dz=Math.max(b[1]-camera.z,0,camera.z-b[3]);
    this.group.visible=Math.hypot(dx,dz)<3000;
    if(!this.group.visible)return;
    const stamp=this.terrain.dataRevision+'|'+this.terrain.drawnRevision;
    if(stamp===this.stamp)return;
    this.stamp=stamp;
    const v=this.site.village,m=this.matrix;
    for(const {mesh,points} of this.lamps){let count=0;
      for(const [e,n] of points){const x=e-v[0],z=v[1]-n,h=this.terrain.meshHeightAt(x,z,true);if(h===null)continue;m.makeTranslation(x,h+.38,z);mesh.setMatrixAt(count++,m);}
      mesh.count=count;mesh.instanceMatrix.needsUpdate=true;
      // Frustum culling needs the bounds of the placed lamps, not of one sphere at the origin.
      mesh.computeBoundingSphere();
    }
    const [e,n]=this.site.data.windsock.point,x=e-v[0],z=v[1]-n,h=this.terrain.meshHeightAt(x,z,true);
    this.sock.visible=h!==null;if(h!==null)this.sock.position.set(x,h,z);
  }
}
