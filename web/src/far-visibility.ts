import * as THREE from 'three';

/** Seconds between probes of a hidden mesh. */
const RETRY=.2;
/** Existing draws double as probes. A hidden mesh is retried five times per second;
 * moving/turning the camera immediately restores it. There is no proxy draw,
 * terrain guess, GPU readback wait or per-instance loop.
 */
export class FarVisibility {
  private readonly records: {mesh:THREE.Mesh;query:WebGLQuery|null;pending:boolean;active:boolean;visible:boolean;retry:number;version:number}[]=[];
  private pose=0;
  private width=0;private height=0;
  private camera:THREE.Camera|null=null;
  private readonly position=new THREE.Vector3(Infinity,Infinity,Infinity);
  private readonly projection=new THREE.Matrix4();
  private readonly rotation=new THREE.Quaternion();
  private readonly gl:WebGL2RenderingContext;
  constructor(private readonly renderer:THREE.WebGLRenderer, meshes:readonly THREE.Mesh[]){
    this.gl=renderer.getContext() as WebGL2RenderingContext;const gl=this.gl;
    for(const mesh of meshes){
      const record={mesh,query:gl.createQuery(),pending:false,active:false,visible:true,retry:0,version:0};this.records.push(record);
      const before=mesh.onBeforeRender,after=mesh.onAfterRender;
      mesh.onBeforeRender=function(r,s,c,g,m,group){before.call(this,r,s,c,g,m,group);if(c===owner.camera&&!record.pending&&record.query&&!gl.isContextLost()){record.version=owner.pose;gl.beginQuery(gl.ANY_SAMPLES_PASSED,record.query);record.active=true;}};
      mesh.onAfterRender=function(r,s,c,g,m,group){if(record.active){gl.endQuery(gl.ANY_SAMPLES_PASSED);record.active=false;record.pending=true;}after.call(this,r,s,c,g,m,group);};
    }
    const owner=this;
    renderer.domElement.addEventListener('webglcontextlost',()=>{for(const r of this.records){r.query=null;r.pending=r.active=false;r.visible=r.mesh.visible=true;}});
    renderer.domElement.addEventListener('webglcontextrestored',()=>{for(const r of this.records)r.query=gl.createQuery();});
  }
  /** Release a probe even when drawing throws before onAfterRender. */
  settle():void{
    for(const r of this.records)if(r.active){
      if(!this.gl.isContextLost())this.gl.endQuery(this.gl.ANY_SAMPLES_PASSED);
      r.active=false;r.pending=!!r.query&&!this.gl.isContextLost();
    }
  }
  update(camera:THREE.Camera,seconds:number):void{
    const canvas=this.renderer.domElement;
    const moved=canvas.width!==this.width||canvas.height!==this.height||!this.projection.equals(camera.projectionMatrix)||this.position.distanceToSquared(camera.position)>0.0001||Math.abs(this.rotation.dot(camera.quaternion))<.999999996;
    if(moved){this.width=canvas.width;this.height=canvas.height;this.pose++;this.position.copy(camera.position);this.rotation.copy(camera.quaternion);this.projection.copy(camera.projectionMatrix);}
    this.camera=camera;const gl=this.gl;
    for(let i=0;i<this.records.length;i++){
      const r=this.records[i];
      if(r.pending&&r.query&&gl.getQueryParameter(r.query,gl.QUERY_RESULT_AVAILABLE)){
        if(r.version===this.pose)r.visible=!!gl.getQueryParameter(r.query,gl.QUERY_RESULT);r.pending=false;
      }
      if(moved)r.visible=true;
      // Replay and endings pass wall time; driving passes drive time. A deadline from the other clock waits at most RETRY.
      if(r.retry>seconds+RETRY)r.retry=seconds+RETRY;
      r.mesh.visible=r.visible||seconds>=r.retry;
      if(r.mesh.visible&&!r.visible)r.retry=seconds+RETRY;
    }
  }
}
