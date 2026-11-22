/** Native execution of production shader chunks, including mutation sensitivity. */
export async function pavedR1Gpu(){
 const T=await import('/node_modules/three/build/three.module.js');
 const {pavedGroundShader,PAVED_SAMPLE,PAVED_STALLS}=await import('/src/paved-shader.ts');
 const {TERRAIN_FRAG}=await import('/src/shaders.ts');
 const actual=pavedGroundShader(TERRAIN_FRAG);
 const lot=PAVED_SAMPLE.slice(PAVED_SAMPLE.indexOf('vec3 pavedLotAsphalt'),PAVED_SAMPLE.indexOf('float pavedCarFade'));
 const initial=actual.slice(actual.indexOf('  float hardPaved='),actual.indexOf('  // ---- roads: painted'));
 const canopy=actual.slice(actual.indexOf('  float tree = smoothstep'),actual.indexOf('#if !defined(LOW)',actual.indexOf('  float tree = smoothstep')));
 const shoulder=actual.slice(actual.indexOf('    shoulder *= 1.0-hardPaved;'),actual.indexOf('#ifdef QUARRY',actual.indexOf('    albedo = mix(albedo, gravel, shoulder')));
 const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(1,1,false);
 const target=new T.WebGLRenderTarget(1,1),scene=new T.Scene(),camera=new T.Camera(),geo=new T.PlaneGeometry(2,2),pixel=new Uint8Array(4);
 const render=(chunk,height=0)=>{
  const mat=new T.RawShaderMaterial({glslVersion:T.GLSL3,uniforms:{height:{value:height}},vertexShader:'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',fragmentShader:`precision highp float;uniform float height;out vec4 color;float vnoise(vec2 p){return .5;}float fbm(vec2 p){return .5;}float pavedWeight(vec2 p){return 1.;}float pavedEdge(float v,vec2 p){return v;}float pavedStallPaint(vec2 p,float aa){return 0.;}vec2 pavedClasses(vec2 p){return vec2(1.,0.);}float pavedCarFade(vec2 p){return 1.;}vec3 treeColor(vec2 p,vec2 w,float b,float d,vec2 f){return vec3(0.2);} ${lot}
 void main(){vec2 p=vec2(0.);vec3 albedo=vec3(.1),vWorld=vec3(0.);float cls=3.,canopy=height,hull=0.,fine=.5,big=.5,dist=0.;vec2 landFootprint=vec2(0.);${chunk}color=vec4(albedo,1.);}`});
  const mesh=new T.Mesh(geo,mat);scene.add(mesh);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);scene.remove(mesh);mat.dispose();return [...pixel].slice(0,3);
 };
 try{
  const clean=render(initial+canopy+'albedo *=1.-.25*under;',0),shade=render(initial+canopy+'albedo *=1.-.25*under;',25);
  const canopyHeights=[4,12,20,25].map(h=>render(initial+canopy+'albedo *=1.-.25*under;',h));
  const halfMutant=render(initial.replace('1.0-hardPaved;','1.0-0.5*hardPaved;')+canopy+'albedo *=1.-.25*under;',25);
  const canopyMutant=render(initial.replace('  canopy *= 1.0-hardPaved;','')+canopy+'albedo *=1.-.25*under;',4);
  const mouth=render(initial+'float shoulder=1.,rkind=3.;vec3 gravel=vec3(.8);'+shoulder);
  const shoulderMutant=render(initial+'float shoulder=1.,rkind=3.;vec3 gravel=vec3(.8);'+shoulder.replace('    shoulder *= 1.0-hardPaved;',''));
  const equal=(a,b)=>a.every((x,i)=>Math.abs(x-b[i])<=1);
  if(!canopyHeights.every(p=>equal(clean,p)))throw Error('canopy shading returned on pavement');
  if(equal(clean,halfMutant))throw Error('canopy-half mutant survived');
  if(equal(clean,canopyMutant))throw Error('canopy mutant survived');
  if(!equal(clean,mouth))throw Error('gravel shoulder paints paved mouth');
  if(equal(clean,shoulderMutant))throw Error('shoulder mutant survived');
  // Judique lots delta lots with the REAL sample, stall and lot chunks on a tiny RG class texture (noise held at .5). Grass is pure
  // blue, so any blue left over grass that the lot should cover; asphalt and gravel have blue at or under green.
  const lots=(chunk,data,rect,point,stallCode=PAVED_STALLS)=>{
   const tex=new T.DataTexture(new Uint8Array(data),data.length/2,1,T.RGFormat,T.UnsignedByteType);tex.internalFormat='RG8';
   tex.minFilter=tex.magFilter=T.LinearFilter;tex.generateMipmaps=false;tex.flipY=false;tex.unpackAlignment=1;tex.needsUpdate=true;
   const A=Array.from({length:8},()=>new T.Vector4(0,0,1,0)),B=Array.from({length:8},()=>new T.Vector4(11,5.5,2.75,0));
   const mat=new T.RawShaderMaterial({glslVersion:T.GLSL3,uniforms:{tPaved:{value:tex},pavedRect:{value:new T.Vector4(...rect)},pavedCar:{value:new T.Vector2()},
    pavedStallA:{value:A},pavedStallB:{value:B},pavedStallCount:{value:1},point:{value:new T.Vector2(...point)}},
    vertexShader:'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader:'#define texture2D texture\nprecision highp float;float vnoise(vec2 p){return .5;}float fbm(vec2 p){return .5;}\n'+PAVED_SAMPLE+stallCode+
     '\nuniform vec2 point;out vec4 color;void main(){vec2 p=point;float cls=3.,canopy=0.,dist=10.;vec3 albedo=vec3(0.,0.,1.);'+chunk+'color=vec4(albedo,1.);}'});
   const mesh=new T.Mesh(geo,mat);scene.add(mesh);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
   scene.remove(mesh);mat.dispose();tex.dispose();return [...pixel].slice(0,3);
  };
  const seamTex=[255,0,255,0,0,255,0,255],seamRect=[0,0,8,2],grassLeft=c=>c[2]-c[1];
  const seam={asphalt:lots(initial,seamTex,seamRect,[1,1]),seam:lots(initial,seamTex,seamRect,[4,1]),gravel:lots(initial,seamTex,seamRect,[7,1])};
  const seamMutant=lots(initial.replace('float stone=min((lotGravel+lotRim*.85)/max(1.0-hardPaved,0.001),1.0);','float stone=lotGravel+lotRim*.85;'),seamTex,seamRect,[4,1]);
  for(const [k,c] of Object.entries(seam))if(grassLeft(c)>12)throw Error('grass shows through the lot at the '+k+': '+c);
  if(grassLeft(seamMutant)<=12)throw Error('asphalt/gravel seam mutant survived');
  const allAsphalt=[255,0,255,0,255,0,255,0],stallRect=[-8,-8,16,16],y=c=>c[0]+c[1]+c[2];
  const stalls={line:lots(initial,allAsphalt,stallRect,[2.75,-2]),right:lots(initial,allAsphalt,stallRect,[2.75,2]),between:lots(initial,allAsphalt,stallRect,[1.4,-2])};
  const flipped=PAVED_STALLS.replace('vec2(a.w,-a.z)','vec2(-a.w,a.z)');
  if(flipped===PAVED_STALLS)throw Error('stall side mutant did not apply');
  const sideMutant=lots(initial,allAsphalt,stallRect,[2.75,-2],flipped);
  if(!(y(stalls.line)>3*y(stalls.right)&&y(stalls.line)>3*y(stalls.between)))throw Error('stall lines must paint left of the row: '+JSON.stringify(stalls));
  if(y(sideMutant)>1.5*y(stalls.right))throw Error('stall side mutant survived');
  return {clean,shade,canopyHeights,halfMutant,mouth,canopyMutant,shoulderMutant,seam,seamMutant,stalls,sideMutant,passed:true};
 }finally{target.dispose();geo.dispose();renderer.dispose();renderer.forceContextLoss();}
}
