/** Execute in the native capture page. Actual GLSL versus independent CPU reference.
 * Noise is fixed at .5 so floating-point hash differences cannot hide edge faults.
 */
export async function pavedGpuFixture(){
 const T=await import('/node_modules/three/build/three.module.js');
 const {PAVED_SAMPLE,pavedGroundShader}=await import('/src/paved-shader.ts');
 const {TERRAIN_FRAG}=await import('/src/shaders.ts');
 const {pavedWeight}=await import('/src/paved-weight.ts');
 const canvas=document.createElement('canvas'),renderer=new T.WebGLRenderer({canvas,antialias:false,preserveDrawingBuffer:true});renderer.setSize(1,1,false);renderer.debug.onShaderError=(gl,program,vs,fs)=>{throw Error('Paved fixture compile: '+gl.getShaderInfoLog(fs));};
 const data=new Uint8Array(16);for(let y=0;y<4;y++)data[y*4+1]=1;
 const texture=new T.DataTexture(data.map(v=>v*255),4,4,T.RedFormat,T.UnsignedByteType);texture.internalFormat='R8';texture.minFilter=texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;texture.flipY=false;texture.unpackAlignment=1;texture.needsUpdate=true;
 const scene=new T.Scene(),camera=new T.Camera(),geo=new T.PlaneGeometry(2,2),pixel=new Uint8Array(4);
 const guard=pavedGroundShader(TERRAIN_FRAG).match(/float hardPaved=([^;]+);/)[1];
 const cases=[...[1.4,1.7,2,2.3,3,3.7,4,4.3,4.6].map(x=>({x,z:3,cls:3,carX:0,carZ:0,label:'east/west edge '+x})),{x:3,z:3,cls:4,carX:0,carZ:0,label:'water'},...[0,1].flatMap(noise=>[{x:1,z:3,cls:3,carX:0,carZ:0,noise,label:'bare noise '+noise},{x:3,z:3,cls:3,carX:0,carZ:0,noise,label:'paved noise '+noise}]),...[-377,-420,-477,-500].map(carX=>({x:3,z:3,cls:3,carX,carZ:0,label:'distance fade '+carX}))];
 const variants={original:PAVED_SAMPLE,M2:PAVED_SAMPLE.replace('local/pavedRect.zw','(local+vec2(2.0,0.0))/pavedRect.zw'),M3:PAVED_SAMPLE},results={};
 try{
  for(const [name,sample] of Object.entries(variants)){
   const expr=name==='M3'?'pavedWeight(p)':guard;
   const uniforms={noiseValue:{value:.5},tPaved:{value:texture},pavedRect:{value:new T.Vector4(0,0,8,8)},pavedCar:{value:new T.Vector2()},point:{value:new T.Vector2()},cls:{value:3}};
   const material=new T.RawShaderMaterial({glslVersion:T.GLSL3,uniforms,vertexShader:'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'#define texture2D texture\nprecision highp float;precision highp int;uniform float noiseValue;float vnoise(vec2 p){return noiseValue;}float fbm(vec2 p){return .5;}\n'+sample+'\nuniform vec2 point;uniform float cls;out vec4 color;void main(){vec2 p=point;float hardPaved='+expr+';color=vec4(vec3(hardPaved),1.0);}'});
   const mesh=new T.Mesh(geo,material);scene.add(mesh);const failures=[];
   for(const c of cases){uniforms.noiseValue.value=c.noise??.5;uniforms.point.value.set(c.x,c.z);uniforms.cls.value=c.cls;uniforms.pavedCar.value.set(c.carX,c.carZ);renderer.render(scene,camera);const gl=renderer.getContext();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    const expected=pavedWeight(data,4,4,c.x,c.z,c.cls,c.carX,c.carZ,c.noise??.5),actual=pixel[0]/255;
    if(Math.abs(expected-actual)>.009)failures.push({label:c.label,expected,actual});if(gl.getError())throw Error('Paved GPU fixture WebGL error');
   }
   results[name]={cases:cases.length,passed:failures.length===0,failures};scene.remove(mesh);material.dispose();
  }
  if(!results.original.passed)throw Error('Original pavedWeight GPU mismatch '+JSON.stringify(results.original));
  if(results.M2.passed||results.M3.passed)throw Error('Paved GPU mutant survived '+JSON.stringify(results));
  return results;
 }finally{texture.dispose();geo.dispose();renderer.dispose();renderer.forceContextLoss();}
}
