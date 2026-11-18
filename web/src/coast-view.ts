import { Vector2, type Camera, type Material, type ShaderMaterial, type WebGLRenderer } from 'three';
const buffer = new Vector2();
/** Vertical world metres per drawing-buffer pixel at unit distance, including camera zoom. */
export const coastPixelScale = (camera: Camera, height: number): number =>
  2 / (Math.abs(camera.projectionMatrix.elements[5]) * Math.max(1, height));
/** Called by LOW coast land meshes immediately before their actual draw, after any Picture/resize change. */
export function updateCoastView(renderer: WebGLRenderer, camera: Camera, material: Material): void {
  const uniform = (material as ShaderMaterial).uniforms?.coastPixelScale;
  if (uniform) uniform.value = coastPixelScale(camera, renderer.getDrawingBufferSize(buffer).y);
}
