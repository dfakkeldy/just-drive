import * as THREE from 'three';
import { CURVE_GLSL, CURVE_START } from './far-rules';

/** A partially covered far primitive needs depth at a covered MSAA sample.
 * Keep Three's original near-depth interpolant and calculation exactly intact.
 * The extra centroid depth is used only beyond the flat 3 km disc. Marked
 * additions let the image proof restore the original shader in its A frame.
 */
const depthBlock=(body: string): string=>`
// FAR_LOG_DEPTH_BEGIN
${body}
// FAR_LOG_DEPTH_END
`;
export function centroidDepthVertex(source: string, worldXZ?: string): string {
  if(source.includes('FAR_LOG_DEPTH_BEGIN')||!source.includes('#include <logdepthbuf_vertex>'))return source;
  const clipUniform=!worldXZ&&!source.includes('uniform mat4 farClipToWorld;')?'uniform mat4 farClipToWorld;':'';
  const declarations=`#ifdef USE_LOGDEPTHBUF
centroid varying float vFarFragDepth;
centroid varying vec2 vFarDepthXZ;
${clipUniform}
#endif`;
  const point=worldXZ?`vFarDepthXZ = ${worldXZ};`:`vec4 farDepthWorld = farClipToWorld * gl_Position;
vFarDepthXZ = farDepthWorld.xz / farDepthWorld.w - cameraPosition.xz;`;
  return source.replace('#include <logdepthbuf_pars_vertex>','#include <logdepthbuf_pars_vertex>'+depthBlock(declarations))
    .replace('#include <logdepthbuf_vertex>','#include <logdepthbuf_vertex>'+depthBlock(`#ifdef USE_LOGDEPTHBUF
vFarFragDepth = vFragDepth;
${point}
#endif`));
}
export function centroidDepthFragment(source: string): string {
  if(source.includes('FAR_LOG_DEPTH_BEGIN')||!source.includes('#include <logdepthbuf_fragment>'))return source;
  return source.replace('#include <logdepthbuf_pars_fragment>','#include <logdepthbuf_pars_fragment>'+depthBlock(`#ifdef USE_LOGDEPTHBUF
centroid varying float vFarFragDepth;
centroid varying vec2 vFarDepthXZ;
#endif`)).replace('#include <logdepthbuf_fragment>','#include <logdepthbuf_fragment>'+depthBlock(`#ifdef USE_LOGDEPTHBUF
if (length(vFarDepthXZ) > ${CURVE_START.toFixed(1)}) gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFarFragDepth) * logDepthBufFC * 0.5;
#endif`));
}

/** Insert after every model-specific deformation, before log depth. */
export function bendMaterialVertex(source: string): string {
  if (source.includes('float farDrop(') || !source.includes('#include <logdepthbuf_vertex>')) return source;
  const declarations = `${CURVE_GLSL}\nuniform float farCurveOn;\nuniform mat4 farClipToWorld;\n`;
  const bend = `
 if (farCurveOn > 0.0) {
  vec4 farWorld = farClipToWorld * gl_Position;
  float farObjectDrop = farDrop(farWorld.xz / farWorld.w - cameraPosition.xz);
  if (farObjectDrop > 0.0) gl_Position -= projectionMatrix * viewMatrix * vec4(0.0,farObjectDrop,0.0,0.0);
 }
 `;
  return source.replace(/void\s+main\s*\(\s*(?:void)?\s*\)/,match=>declarations+match).replace('#include <logdepthbuf_vertex>',bend+'#include <logdepthbuf_vertex>');
}

/** Watch additions, not every frame: late trees, vehicles and MP ghosts use it too.
 * Install at boot with farCurveOn=0, before the first compile. The clip inverse
 * follows this scene's active camera, including the ordinary reflected camera.
 * Swap-only mirror-tree and fishing wake/mooring materials draw within 80 m,
 * so an unhooked swap has zero bend. A later mirror-proxy add can compile one
 * desktop tree program again; this known exception is measured separately.
 * A material reused under another render root needs that root's camera update
 * too. Shadow depth materials stay renderer-owned and retain local geometry.
 */
export function curveSceneMaterials(scene: THREE.Scene, shared: Record<string, THREE.IUniform>): void {
  const objects=new WeakSet<THREE.Object3D>(),materials=new WeakSet<THREE.Material>();
  const clip={value:new THREE.Matrix4()};
  const before=scene.onBeforeRender;
  scene.onBeforeRender=function(renderer,s,camera,g,m,group){
    clip.value.multiplyMatrices(camera.matrixWorld,camera.projectionMatrixInverse);
    before.call(this,renderer,s,camera,g,m,group);
  };
  const watch=(object: THREE.Object3D): void=>{
    if(objects.has(object))return;objects.add(object);
    if('material' in object){
      const value=object.material as THREE.Material|THREE.Material[];
      for(const material of Array.isArray(value)?value:[value]){
        if(materials.has(material))continue;materials.add(material);
        // The sea has an explicit patch shader. Other raw shaders that own
        // farDrop already bind the shared uniform and must keep their hooks.
        const raw=material as THREE.ShaderMaterial;
        const ownsCurve=object.name==='near-sea'||(raw.isShaderMaterial&&raw.vertexShader.includes('float farDrop('));
        const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
        material.onBeforeCompile=function(shader,renderer){
          compile.call(this,shader,renderer);
          const vertex=ownsCurve?shader.vertexShader:bendMaterialVertex(shader.vertexShader);
          if(vertex!==shader.vertexShader){shader.vertexShader=vertex;shader.uniforms.farCurveOn=shared.farCurveOn;shader.uniforms.farClipToWorld=clip;}
          shader.vertexShader=centroidDepthVertex(shader.vertexShader);shader.uniforms.farClipToWorld=clip;
          if(typeof shader.fragmentShader==='string')shader.fragmentShader=centroidDepthFragment(shader.fragmentShader);
        };
        // Later shader-changing compile-hook replacements must also change this cache key.
        material.customProgramCacheKey=()=>key+'|far-objects-v3';material.needsUpdate=true;
      }
    }
    const add=object.add;
    object.add=function(...children){const result=add.apply(this,children);for(const child of children)watch(child);return result;};
    for(const child of object.children)watch(child);
  };
  watch(scene);
}
