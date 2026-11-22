import type { IUniform, MeshLambertMaterial } from 'three';

const TERRAIN_SNOW = /* glsl */ `
  if (winterCover > 0.0) {
    float slopeMask = 1.0 - smoothstep(0.31, 0.70, slope);
    float heightMask = smoothstep(0.25, 2.2, vGround - seaLevel);
    float ploughed = rkind > 0.5 && rkind < 8.0
      ? smoothstep(rhalf - 0.58, rhalf + 0.78, rdist + 0.38 * (fine - 0.5)) : 1.0;
    float cover = slopeMask * heightMask * ploughed * (1.0 - brookWater);
    cover *= mix(0.69, 1.0, smoothstep(0.25, 0.66, mid));
    vec3 snow = mix(vec3(0.50, 0.59, 0.69), vec3(0.85, 0.90, 0.95), fine * 0.56 + mid * 0.44);
    albedo = mix(albedo, snow, cover * (1.0 - tree) * winterCover);
    // The distant canopy is a solid stand. Break up the snow and leave the shaded sides dark.
    albedo = mix(albedo, mix(vec3(0.053, 0.077, 0.066), snow, 0.44 * n.y * mid), tree * winterCover);
  }
`;
const TERRAIN_WET = /* glsl */ `
  if (rainWet > 0.0) {
    float roadWet = rkind > 0.5 ? 1.0 - smoothstep(rhalf, rhalf + 0.8, rdist) : 0.0;
    float wetness = rainWet * (1.0 - tree) * (1.0 - brookWater);
    col *= 1.0 - wetness * mix(0.23, 0.48, roadWet);
    // A broad sky reflection on wet ground. The existing road normal and depth still do all the work.
    vec3 view = normalize(cameraPosition - vWorld);
    float grazing = 1.0 - clamp(dot(n, view), 0.0, 1.0);
    col += skyColor * wetness * max(n.y, 0.0) * mix(0.025, 0.11, roadWet) * grazing * grazing;
  }
`;

const weatherFragments = new Map<string, string>();
/** Build a weather variant of each active terrain shader. Clear play uses the exact original source. */
export function weatherTerrainFragment(source: string, winter: boolean, rain: boolean): string {
  if (!winter && !rain) return source;
  const key = `${winter ? 'snow' : ''}:${rain ? 'wet' : ''}:${source}`;
  const cached = weatherFragments.get(key);
  if (cached) return cached;
  const snowAt = '  float diff = max(dot(n, sunDir), 0.0);';
  const wetAt = '  // Mapped water must also be flat:';
  if (!source.includes(snowAt) || !source.includes(wetAt)) throw new Error('Weather terrain shader anchors changed');
  let shader = source;
  if (winter) shader = 'uniform float winterCover;\n' + shader.replace(snowAt, TERRAIN_SNOW + snowAt);
  if (rain) shader = 'uniform float rainWet;\n' + shader.replace(wetAt, TERRAIN_WET + wetAt);
  weatherFragments.set(key, shader);
  return shader;
}

/** Roofs use height relative to their building base and the painted face's upward slope. */
export function snowRoof(material: MeshLambertMaterial, cover: IUniform): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.winterCover = cover;
    shader.vertexShader = 'attribute float snowHeight; varying vec3 vSnowRoof;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvSnowRoof = vec3(snowHeight, normal.y, position.x + position.z * 0.6);',
    );
    shader.fragmentShader = 'uniform float winterCover; varying vec3 vSnowRoof;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>', `#include <color_fragment>
        float roofUp = gl_FrontFacing ? vSnowRoof.y : -vSnowRoof.y;
        float roofCover = smoothstep(1.35, 2.5, vSnowRoof.x) * smoothstep(0.37, 0.76, roofUp);
        float roofGrain = 0.94 + 0.06 * sin(vSnowRoof.z * 2.4 + vSnowRoof.x * 5.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.83, 0.89, 0.96) * roofGrain, roofCover * winterCover);
      `,
    );
  };
  material.customProgramCacheKey = () => 'winter-roof';
}

/** Keep an easy steering margin on touch. The surface's roughness and washboard suspension stay in use. */
export function winterRoadGrip(cover: IUniform | undefined, onRoad: boolean, touch?: boolean): number {
  return cover?.value && onRoad ? (touch ? 0.88 : 0.76) : 1;
}
