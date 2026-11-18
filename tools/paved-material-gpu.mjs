/** Real production GLSL noise, desktop/LOW, finite 1 cm material edges and palette mutations. */
export async function pavedMaterialGpu(){
 const T=await import('/node_modules/three/build/three.module.js');
 const {LAND_LIGHT}=await import('/src/shaders.ts');const {PAVED_SAMPLE}=await import('/src/paved-shader.ts');
 const noise=LAND_LIGHT.slice(LAND_LIGHT.indexOf('float hash'),LAND_LIGHT.indexOf('// Sky colour'));
 const material=PAVED_SAMPLE.slice(PAVED_SAMPLE.indexOf('vec3 pavedLotAsphalt'),PAVED_SAMPLE.indexOf('float pavedCarFade'));
 const centres=[['mabou3','mabou',624141,5103347],['pt-hwy4','pointtupper',625972,5055120],['pt2','pointtupper',625665,5051609],['porthood','porthood',613775,5096575]];
 const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(1,1,false);
 if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('Float readback is required for edge proof');
 const side=256,target=new T.WebGLRenderTarget(side,side,{type:T.FloatType}),data=new Float32Array(side*side*4),scene=new T.Scene(),camera=new T.Camera(),geo=new T.PlaneGeometry(2,2);
 const cases=[];
 const variants={original:material,K2:material.replace('  return ', '  road=mix(road,vec3(.030,.030,.033),step(.30,vnoise(p*.11))*.9);\n  return '),K1:material.replace(/\*([0-9.]+);\n}/,'*1.60;\n}'),K3:material.replace(/\*([0-9.]+);\n}/,'*0.95;\n}')};
 for(const [name,fn] of Object.entries(variants))if(name!=='original'&&fn===material)throw Error('mutant did not apply: '+name);
 try{
  for(const [name,area,e,n] of centres){
   const base=area==='mabou'?'terrain':`areas/${area}`,manifest=await(await fetch('/'+base+'/manifest.json')).json();
   for(const low of [false,true])for(const [variant,fn] of Object.entries(variants)){
    const m=new T.RawShaderMaterial({glslVersion:T.GLSL3,uniforms:{origin:{value:new T.Vector2(e-manifest.village[0]-32,manifest.village[1]-n-32)}},vertexShader:'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.);}',fragmentShader:`precision highp float;
${low?'#define LOW\n':''}uniform vec2 origin;out vec4 color;${noise}${fn}
float y(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){vec2 p=origin+(floor(gl_FragCoord.xy)+.5)*.25;float a=y(pavedLotAsphalt(p));vec3 road=mix(vec3(.045,.046,.050),vec3(.070,.070,.072),fbm(p*.35))*(.85+.3*vnoise(p*23.));color=vec4(a,y(pavedLotAsphalt(p+vec2(.01,0.))),y(pavedLotAsphalt(p+vec2(0.,.01))),y(road));}`});
    const mesh=new T.Mesh(geo,m);scene.add(mesh);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,side,side,data);
    let edge=0,sum=0,reference=0;for(let i=0;i<data.length;i+=4){const a=data[i];edge=Math.max(edge,2*Math.abs(a-data[i+1])/Math.max(.0001,a+data[i+1]),2*Math.abs(a-data[i+2])/Math.max(.0001,a+data[i+2]));sum+=a;reference+=data[i+3];}
    const gain=sum/reference;if(!Number.isFinite(edge)||!Number.isFinite(gain)||reference<=0)throw Error('finite GPU samples required');cases.push({name,low,variant,edge,gain});
    // Owner rule: lot asphalt is never darker than the road's own asphalt (gain >= 1), and not glaring (<= 1.12).
    if(variant==='original'&&(edge>.11||gain>1.12||gain<1))throw Error('material edge/gain failed '+JSON.stringify(cases.at(-1)));
    if(variant==='K2'&&edge<=.11)throw Error('big dark patches mutant survived '+JSON.stringify(cases.at(-1)));
    if(variant==='K1'&&gain<=1.12)throw Error('bright lot mutant survived');
    if(variant==='K3'&&gain>=1)throw Error('dark lot mutant survived');
    scene.remove(mesh);m.dispose();
   }
  }
  return {passed:true,cases,threshold:.11,metres:.01,gain:[1,1.12]};
 }finally{geo.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();}
}
