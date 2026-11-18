import { LAND_LIGHT, SUN_SHADOW } from './shaders';

/** The same linear light and white mineral palette as the land, without a separate shadow draw. */
export const COAST_BLOCK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vBase;
varying float vFoot;
attribute float coastFoot;
void main(){
  mat4 world = modelMatrix * instanceMatrix;
  vec4 w = world * vec4(position,1.0);
  mat3 basis = mat3(world);
  vec3 corrected = normal / vec3(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]));
  vNormal = normalize(basis * corrected);
  vLocal = position;vWorld=w.xyz;vBase=world[3].xyz;vFoot=coastFoot;
  vec4 mvPosition = viewMatrix*w;
  gl_Position=projectionMatrix*mvPosition;
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
}
`;

export const COAST_BLOCK_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
${LAND_LIGHT}
${SUN_SHADOW}
uniform float coastExag;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vBase;
varying float vFoot;
void main(){
  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>
  vec3 n=normalize(vNormal);
  float side=hash(floor(vBase.xz)*.17+floor(n.xz*3.0));
  vec3 mineral=mix(vec3(.721,.694,.617),vec3(.871,.855,.784),clamp(vLocal.y*.8+side*.2,0.0,1.0));
#ifdef QUARRY
  mineral=mix(vec3(.75,.715,.635),vec3(.90,.88,.825),clamp(vLocal.y*.6+side*.4,0.0,1.0));
#endif
  float stain=smoothstep(.56,.85,side)*(1.0-smoothstep(.25,.90,vLocal.y))*.38;
  mineral=mix(mineral,vec3(.42,.31,.20),stain);
  float baseHeight=seaLevel+(vFoot-seaLevel)/coastExag;
  float damp=(1.0-smoothstep(.85,1.8,baseHeight))*(1.0-smoothstep(.025,.20,vWorld.y-vFoot));
  mineral=mix(mineral,mineral*vec3(.53,.49,.42),damp*.75);
#ifndef LOW
  mineral*=.96+.07*vnoise(vWorld.xz*5.0+vWorld.y);
#endif
  float diff=max(dot(n,sunDir),0.0);
#ifdef SHADOWS
  diff*=sunShadow(vWorld);
#endif
  vec3 light=sunColor*diff+skyColor*(.65+.55*n.y)+sunColor*vec3(.060,.050,.035);
#ifdef QUARRY
  vec3 warmFill=vec3(max(dot(skyColor,vec3(.3,.5,.2)),.82*smoothstep(0.0,.20,sunDir.y)))*vec3(1.025,1.01,.97);
  light=sunColor*diff+warmFill*(.65+.50*max(n.y,0.0))+sunColor*vec3(.10,.08,.05);
#endif
  vec3 col=applyFog(mineral*light,vWorld,cameraPosition);
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
