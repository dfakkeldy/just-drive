import * as THREE from 'three';

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 particle;
uniform vec3 span;
uniform float clock;
uniform float amount;
uniform float snow;
varying vec2 vShape;
varying float vOpacity;
void main() {
  vec3 velocity = mix(vec3(2.7, -16.0, 0.8), vec3(0.85, -1.65, 0.4), snow);
  vec3 drift = velocity * clock;
  if (snow > 0.5) {
    float phase = clock * 1.7 + particle.w * 40.0;
    drift.xz += vec2(sin(phase), cos(phase * 0.79)) * 0.48;
  }
  // Wrap in world axes, so turning the lens does not drag the particles along.
  vec3 offset = mod(particle.xyz * span + drift - cameraPosition + span * 0.5, span) - span * 0.5;
  mat3 orientation = mat3(viewMatrix);
  vec3 eye = orientation * offset;
  vec2 axis = -(orientation * velocity).xy + vec2(0.0001, 0.0);
  axis = normalize(axis);
  vec2 across = vec2(axis.y, -axis.x);
  vec2 size = mix(vec2(0.009, mix(0.15, 0.39, amount)), vec2(0.038, 0.039), snow);
  eye.xy += (position.x * across * size.x + position.y * axis * size.y) * mix(0.65, 1.35, particle.w);
  float edge = max(max(abs(offset.x) / span.x, abs(offset.y) / span.y), abs(offset.z) / span.z);
  vOpacity = (1.0 - smoothstep(0.34, 0.5, edge)) * smoothstep(1.2, 3.8, -eye.z);
  vShape = position.xy;
  gl_Position = projectionMatrix * vec4(eye, 1.0);
  #include <logdepthbuf_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float snow;
uniform float amount;
uniform vec3 skyColor;
varying vec2 vShape;
varying float vOpacity;
void main() {
  #include <logdepthbuf_fragment>
  float streak = (1.0 - smoothstep(0.08, 0.5, abs(vShape.x))) * (1.0 - smoothstep(0.13, 0.5, abs(vShape.y)));
  float flake = 1.0 - smoothstep(0.09, 0.5, length(vShape));
  float alpha = vOpacity * mix(streak * mix(0.32, 0.65, amount), flake * 0.87, snow);
  vec3 tint = mix(vec3(0.65, 0.73, 0.82), vec3(0.91, 0.95, 1.0), snow);
  gl_FragColor = vec4(tint * clamp(skyColor * 1.35 + 0.08, 0.08, 1.35), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** One instanced draw, with fixed seeds and no particle uploads after boot. The world depth still hides flakes and streaks. */
export function precipitation(kind: 'rain' | 'snow', amount: number, low: boolean, clock: THREE.IUniform, skyColor: THREE.IUniform): THREE.Mesh {
  const snow = kind === 'snow';
  const maxCount = low ? (snow ? 620 : 480) : (snow ? 1400 : 1100);
  const count = snow ? maxCount : Math.round(maxCount * amount);
  const seeds = new Float32Array(count * 4);
  let state = 28517;
  for (let i = 0; i < seeds.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    seeds[i] = state / 4294967296;
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
  geometry.setAttribute('particle', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
    uniforms: {
      clock, skyColor, amount: { value: amount }, snow: { value: Number(snow) },
      span: { value: low ? new THREE.Vector3(24, 13, 24) : new THREE.Vector3(34, 18, 34) },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'weather-precipitation';
  mesh.frustumCulled = false; // The shader puts the instances around the current camera.
  mesh.renderOrder = 20;
  return mesh;
}
