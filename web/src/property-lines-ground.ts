import * as THREE from 'three';
import type { Terrain } from './terrain';

const DECLARATIONS = `
uniform sampler2D propertyGroundImage;
uniform vec4 propertyGroundRect;
uniform vec2 propertyGroundCar;
uniform float propertyGroundOn;
`;
const PAINT = `
  vec2 propertyUV = (vWorld.xz - propertyGroundRect.xy) / propertyGroundRect.zw;
  if (propertyGroundOn > 0.5 && all(greaterThanEqual(propertyUV, vec2(0.0)))
      && all(lessThanEqual(propertyUV, vec2(1.0))) && vWorld.y - vGround < 0.5) {
    vec4 lines = texture2D(propertyGroundImage, vec2(propertyUV.x, 1.0 - propertyUV.y));
    float fade = 1.0 - smoothstep(150.0, 220.0, distance(vWorld.xz, propertyGroundCar));
    col = mix(col, lines.rgb, lines.a * fade);
  }
`;
const FOG = '  col = applyFog(col, vWorld, cameraPosition);';

/** Paint the live image on the actual land fragments. No mesh, heights, or boundary features are derived. */
export class PropertyGround {
  private texture: THREE.Texture | null = null;
  private image: HTMLImageElement | null = null;
  private readonly materials = new Map<THREE.ShaderMaterial, { source: string; forget: () => void }>();
  private readonly imageUniform: { value: THREE.Texture | null } = { value: null };
  private readonly uniforms = {
    propertyGroundImage: this.imageUniform,
    propertyGroundRect: { value: new THREE.Vector4() },
    propertyGroundCar: { value: new THREE.Vector2() },
    propertyGroundOn: { value: 1 },
  };
  constructor(private terrain: Terrain) {}
  applyGround(material: THREE.ShaderMaterial): void {
    if (!this.texture || this.materials.has(material) || !material.fragmentShader.includes(FOG)) return;
    const forget = () => { this.materials.delete(material); material.removeEventListener('dispose', forget); };
    this.materials.set(material, { source: material.fragmentShader, forget });
    material.addEventListener('dispose', forget);
    material.fragmentShader = DECLARATIONS + material.fragmentShader.replace(FOG, PAINT + FOG);
    Object.assign(material.uniforms, this.uniforms); material.needsUpdate = true;
  }
  show(image: HTMLImageElement, rect: readonly [number, number, number, number], car: { x: number; z: number }): void {
    const starting = !this.texture;
    if (this.image !== image) {
      this.texture?.dispose();
      this.texture = new THREE.Texture(image); this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = false; this.texture.minFilter = THREE.LinearFilter;
      this.texture.needsUpdate = true; this.image = image;
      this.uniforms.propertyGroundImage.value = this.texture;
    }
    this.uniforms.propertyGroundOn.value = 1;
    this.uniforms.propertyGroundRect.value.set(...rect);
    this.uniforms.propertyGroundCar.value.set(car.x, car.z);
    if (starting) {
      this.terrain.propertyOverlay = this;
      this.terrain.group.traverse(object => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial) this.applyGround(object.material);
      });
    }
  }
  /** A pause or a coverage gap: stop painting without restoring shaders, so resuming never recompiles the land. */
  blank(): void { this.uniforms.propertyGroundOn.value = 0; }
  /** Off, mode change, hidden attribution or page exit: restore every original shader and release the texture. */
  hide(): void {
    if (!this.texture) return;
    this.terrain.propertyOverlay = null;
    for (const [material, original] of this.materials) {
      material.removeEventListener('dispose', original.forget);
      material.fragmentShader = original.source;
      for (const key of Object.keys(this.uniforms)) delete material.uniforms[key];
      material.needsUpdate = true;
    }
    this.materials.clear(); this.texture.dispose(); this.texture = null; this.image = null;
    this.uniforms.propertyGroundImage.value = null;
  }
}
