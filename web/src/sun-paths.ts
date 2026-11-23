import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { directionFromAngles } from './sun';
import { SUN_PATH_INK, SUN_PATH_SELECTED, sunPathArcs, sunPathNameSpots } from './sun-seeker-rules';
import { clipArcAboveHorizon, overlappingSeason, todayPathLabel } from './sun-paths-rules';

/** Behind all near terrain, buildings, trees and 90 km far land; safely inside LOW's 150 km far plane. */
export const SKY_SUN_PATHS_RADIUS = 100_000;
/** Opt-in enabled GPU budget when "Sun paths in the sky" is turned on (default-off adds 0).
 *  Like other opt-in Settings switches (see far-choice.ts), the 34 frame-budget.json pins guard default-off;
 *  this fixed ceiling caps enabled overhead across desktop and phone LOW. */
export const SKY_SUN_PATHS_BUDGET = Object.freeze({
  maxCalls: 6,
  maxGeometries: 4,
  maxTextures: 1,
});
const SEASON_WIDTH = 2.3;
const TODAY_WIDTH = 3.5;
const INK_EXTRA = 2.6;
const MARKER_SCALE = SKY_SUN_PATHS_RADIUS / 180;
const LABEL_HEIGHT_FRACTION = 0.022;
const ATLAS_WIDTH = 512;
const ATLAS_ROW_HEIGHT = 48;

const SKY_CLIP_PARS = `
uniform vec2 uSkyDepthViewport;
uniform vec3 uSkyHorizon;
`;
const SKY_HORIZON_TEST = `
  if (dot(vec3((gl_FragCoord.xy / uSkyDepthViewport) * 2.0 - 1.0, 1.0), uSkyHorizon) < 0.0) discard;
`;
const DEPTH_PARS = `
uniform sampler2D uSkySceneDepth;
uniform float uSkyDepthThreshold;
`;
const DEPTH_TEST = `
  if (uSkyDepthThreshold > 0.0 && texture2D(uSkySceneDepth, gl_FragCoord.xy / uSkyDepthViewport).r < uSkyDepthThreshold) discard;
`;
const LINE_FEATHER_ANCHOR = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );';
const LINE_FEATHER = `
  float skyEdge = abs( vUv.y ) > 1.0 ? length( vec2( vUv.x, abs( vUv.y ) - 1.0 ) ) : abs( vUv.x );
  alpha *= 1.0 - smoothstep( 0.65, 1.0, skyEdge );
  gl_FragColor = vec4( diffuseColor.rgb, alpha );`;

interface PathLabel {
  row: number;
  uWidth: number;
  aspect: number;
  positions: THREE.Vector3[];
  spot: number;
}

interface SkyUniforms {
  uSkyDepthViewport: { value: THREE.Vector2 };
  uSkyHorizon: { value: THREE.Vector3 };
  uSkySceneDepth: { value: THREE.Texture | null };
  uSkyDepthThreshold: { value: number };
}

function anglesAt(az: number, el: number): THREE.Vector3 {
  return directionFromAngles(az, el).multiplyScalar(SKY_SUN_PATHS_RADIUS);
}

/** Threshold in [0, 1] depth-buffer space for the sky sphere at SKY_SUN_PATHS_RADIUS. */
export function skyDepthThreshold(camera: Pick<THREE.PerspectiveCamera, 'near' | 'far'>, logDepth: boolean): number {
  if (logDepth) return Math.log2(1 + SKY_SUN_PATHS_RADIUS) / Math.log2(1 + camera.far);
  const n = camera.near, f = camera.far, z = SKY_SUN_PATHS_RADIUS;
  return (f * (z - n)) / (z * (f - n));
}

/** Screen-space horizon plane vector H such that dot(vec3(ndc.xy, 1), H) >= 0 iff world ray y >= 0 (el >= 0°). */
export function skyHorizonVector(camera: THREE.PerspectiveCamera, out = new THREE.Vector3()): THREE.Vector3 {
  const up = out.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  const e = camera.projectionMatrix.elements;
  const p00 = e[0], p11 = e[5], p02 = e[8], p12 = e[9];
  return out.set(
    up.x / p00,
    up.y / p11,
    (p02 / p00) * up.x + (p12 / p11) * up.y - up.z,
  );
}

function patchSkyFragment(fragmentShader: string, clipHorizon: boolean, testSceneDepth: boolean): string {
  const main = fragmentShader.indexOf('void main()');
  if (main < 0) return fragmentShader;
  const open = fragmentShader.indexOf('{', main);
  if (open < 0) return fragmentShader;
  const pars = (clipHorizon || testSceneDepth ? SKY_CLIP_PARS : '') + (testSceneDepth ? DEPTH_PARS : '');
  const body = (clipHorizon ? SKY_HORIZON_TEST : '') + (testSceneDepth ? DEPTH_TEST : '');
  if (!body) return fragmentShader;
  return fragmentShader.slice(0, main) + pars + fragmentShader.slice(main, open + 1) + body + fragmentShader.slice(open + 1);
}

function patchLineFeather(fragmentShader: string): string {
  return fragmentShader.includes(LINE_FEATHER_ANCHOR)
    ? fragmentShader.replace(LINE_FEATHER_ANCHOR, LINE_FEATHER)
    : fragmentShader;
}

/** Build one merged geometry for the sun marker: ink outline disc behind gold inner disc (1 draw). */
function buildMarkerGeometry(): THREE.BufferGeometry {
  const segments = 24;
  const inkColor = new THREE.Color(SUN_PATH_INK);
  const goldColor = new THREE.Color(SUN_PATH_SELECTED);
  const positions: number[] = [];
  const colors: number[] = [];
  const addDisc = (radius: number, z: number, color: THREE.Color) => {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      positions.push(
        0, 0, z,
        Math.cos(a0) * radius, Math.sin(a0) * radius, z,
        Math.cos(a1) * radius, Math.sin(a1) * radius, z,
      );
      for (let v = 0; v < 3; v++) colors.push(color.r, color.g, color.b);
    }
  };
  addDisc(2.02 * MARKER_SCALE, -1, inkColor);
  addDisc(1.32 * MARKER_SCALE, 0, goldColor);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Paint all path label pills into a single shared CanvasTexture atlas (1 GPU texture, 1 draw). */
function buildLabelAtlas(items: readonly { text: string; color: string }[]): { texture: THREE.Texture; metrics: { uWidth: number; aspect: number }[] } {
  const rows = Math.max(1, items.length);
  if (typeof document === 'undefined') {
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return {
      texture,
      metrics: items.map(({ text }) => ({ uWidth: Math.min(1, Math.max(0.2, text.length * 0.04)), aspect: Math.max(2, text.length * 0.55) })),
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = rows * ATLAS_ROW_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const font = '650 22px system-ui, -apple-system, "Segoe UI", sans-serif';
  const metrics: { uWidth: number; aspect: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const { text, color } = items[i];
    ctx.font = font;
    const textW = Math.ceil(ctx.measureText(text).width);
    const pillW = Math.min(ATLAS_WIDTH, Math.max(72, textW + 28));
    const pillH = 40;
    const y0 = i * ATLAS_ROW_HEIGHT + (ATLAS_ROW_HEIGHT - pillH) / 2;
    ctx.beginPath();
    ctx.roundRect(1, y0 + 1, pillW - 2, pillH - 2, 8);
    ctx.fillStyle = 'rgba(16, 26, 36, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pillW / 2, y0 + pillH / 2 + 0.5);
    metrics.push({ uWidth: pillW / ATLAS_WIDTH, aspect: pillW / pillH });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { texture, metrics };
}

function appendPolylineSegments(
  points: readonly { az: number; el: number }[],
  colorA: THREE.Color,
  positions: number[],
  colors: number[],
  colorB?: THREE.Color,
): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = anglesAt(points[i].az, points[i].el);
    const b = anglesAt(points[i + 1].az, points[i + 1].el);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    // When today matches a solstice or equinox, alternate gold and the season colour every 2 segments (~2°).
    const c = colorB && ((i >> 1) & 1) === 1 ? colorB : colorA;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
}

/** Sun Seeker sun-path arcs drawn in the sky during normal driving. Lazy-built only when the setting is on.
 *  Budget when on: at most 6 draws total (2 merged season draws, 2 today draws, 1 merged sun marker, 1 label atlas).
 *  Drawn in its own overlay scene after the world (and finish pass, when on) so clouds and glare never wash out
 *  the paths, while depth-testing against the world's depth buffer (canvas depth directly, or Finish's depth texture)
 *  so hills, buildings, trees and far land hide the arcs cleanly. */
export class SkySunPaths {
  readonly overlay = new THREE.Scene();
  readonly group = new THREE.Group();
  private readonly arcsGroup = new THREE.Group();
  private readonly marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly lineMaterials = new Set<LineMaterial>();
  private labelMesh: THREE.InstancedMesh | null = null;
  private labelAtlas: THREE.Texture | null = null;
  private labelRowsAttr: THREE.InstancedBufferAttribute | null = null;
  private labelWidthAttr: THREE.InstancedBufferAttribute | null = null;
  private readonly labels: PathLabel[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly labelPos = new THREE.Vector3();
  private readonly labelScale = new THREE.Vector3();
  private readonly labelMatrix = new THREE.Matrix4();
  private readonly viewport = new THREE.Vector2(1, 1);
  private readonly horizon = new THREE.Vector3(0, 1, 0);
  private readonly useDepthTexture: boolean;
  private readonly skyUniforms: SkyUniforms;
  private width: number;
  private height: number;
  private cacheKey = '';

  constructor(date: string, lat: number, lon: number, sun: { az: number; el: number }, width: number, height: number, useDepthTexture = false) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.useDepthTexture = useDepthTexture;
    this.skyUniforms = {
      uSkyDepthViewport: { value: this.viewport },
      uSkyHorizon: { value: this.horizon },
      uSkySceneDepth: { value: null },
      uSkyDepthThreshold: { value: -1 },
    };
    this.group.name = 'Sky sun paths';

    const markerMat = this.withSkyClip(new THREE.MeshBasicMaterial({
      vertexColors: true, depthTest: !useDepthTexture, depthWrite: false, toneMapped: false, transparent: true,
    }));
    this.marker = new THREE.Mesh(buildMarkerGeometry(), markerMat);
    this.marker.renderOrder = 2;
    this.marker.castShadow = false;
    this.marker.receiveShadow = false;
    this.marker.frustumCulled = false;
    this.group.add(this.arcsGroup, this.marker);
    this.overlay.add(this.group);

    this.setDate(date, lat, lon, sun);
  }

  /** Rebuild arc geometry only when the date or place changes, never per frame. */
  setDate(date: string, lat: number, lon: number, sun?: { az: number; el: number }): boolean {
    if (sun) this.setSun(sun.az, sun.el);
    const key = `${date}|${lat}|${lon}`;
    if (key === this.cacheKey) return false;
    this.cacheKey = key;
    this.clearArcs();

    const { today, seasons } = sunPathArcs(date, lat, lon);
    const matchingSeason = overlappingSeason(today, seasons);
    const labelItems: { text: string; color: string; spots: { az: number; el: number }[] }[] = [];

    // 1. All non-matching seasonal arcs merged into one LineSegmentsGeometry (2 draws: ink + vertex-colored).
    const seasonPositions: number[] = [];
    const seasonColors: number[] = [];
    for (const season of seasons) {
      if (season === matchingSeason) continue;
      const clipped = clipArcAboveHorizon(season.arc);
      if (clipped.length >= 2) {
        appendPolylineSegments(clipped, new THREE.Color(season.color), seasonPositions, seasonColors);
      }
      labelItems.push({ text: season.name, color: season.color, spots: sunPathNameSpots(season.arc, season.labelAt, [2.2, -2.2]) });
    }
    if (seasonPositions.length) {
      const seasonGeo = new LineSegmentsGeometry().setPositions(seasonPositions).setColors(seasonColors);
      const seasonInk = this.makeLineMaterial(SUN_PATH_INK, SEASON_WIDTH + INK_EXTRA, false);
      const seasonCol = this.makeLineMaterial('#ffffff', SEASON_WIDTH, true);
      this.addSegments(seasonGeo, seasonInk, seasonCol, -2, -1);
    }

    // 2. Today's arc (2 draws: ink + gold, or alternating gold/season colour on a solstice or equinox).
    const todayClipped = clipArcAboveHorizon(today);
    const todayPositions: number[] = [];
    const todayColors: number[] = [];
    if (todayClipped.length >= 2) {
      appendPolylineSegments(
        todayClipped,
        new THREE.Color(SUN_PATH_SELECTED),
        todayPositions,
        todayColors,
        matchingSeason ? new THREE.Color(matchingSeason.color) : undefined,
      );
    }
    if (todayPositions.length) {
      const todayGeo = new LineSegmentsGeometry().setPositions(todayPositions).setColors(todayColors);
      const todayInk = this.makeLineMaterial(SUN_PATH_INK, TODAY_WIDTH + INK_EXTRA, false);
      const todayCol = this.makeLineMaterial('#ffffff', TODAY_WIDTH, true);
      this.addSegments(todayGeo, todayInk, todayCol, 0, 1);
    }
    labelItems.push({
      text: todayPathLabel(date, matchingSeason?.name),
      color: SUN_PATH_SELECTED,
      spots: sunPathNameSpots(today, .6, [2.2, -2.2]),
    });

    // 3. One shared atlas + one InstancedMesh for all path labels (1 draw max, 0 when none in view).
    this.buildLabels(labelItems);
    return true;
  }

  setSun(az: number, el: number): void {
    this.marker.visible = el >= 0;
    if (this.marker.visible) this.marker.position.copy(anglesAt(az, el));
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    for (const material of this.lineMaterials) material.resolution.set(this.width, this.height);
  }

  /** Position the sky sphere on the camera (not its rotation) and update visibility/labels. */
  prepare(camera: THREE.PerspectiveCamera, visible: boolean): boolean {
    this.group.visible = visible;
    if (!visible) return false;
    this.group.position.copy(camera.position);
    this.marker.quaternion.copy(camera.quaternion);
    this.updateLabels(camera);
    this.group.updateMatrixWorld(true);
    return true;
  }

  /** Render the sky arcs over the finished frame, depth-tested against the scene depth buffer and horizon-clipped. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, depthTexture: THREE.DepthTexture | null, visible: boolean): void {
    if (!this.prepare(camera, visible)) return;
    renderer.getDrawingBufferSize(this.viewport);
    skyHorizonVector(camera, this.horizon);
    if (this.useDepthTexture) {
      this.skyUniforms.uSkySceneDepth.value = depthTexture;
      this.skyUniforms.uSkyDepthThreshold.value = depthTexture
        ? skyDepthThreshold(camera, renderer.capabilities.logarithmicDepthBuffer) : -1;
    }
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(this.overlay, camera); }
    finally { renderer.autoClear = clear; }
  }

  private buildLabels(items: readonly { text: string; color: string; spots: { az: number; el: number }[] }[]): void {
    const count = items.length;
    if (!count) return;
    const { texture, metrics } = buildLabelAtlas(items);
    this.labelAtlas = texture;
    const rows = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    const widths = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    rows.setUsage(THREE.DynamicDrawUsage);
    widths.setUsage(THREE.DynamicDrawUsage);
    this.labelRowsAttr = rows;
    this.labelWidthAttr = widths;

    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('aLabelRow', rows);
    plane.setAttribute('aLabelUWidth', widths);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      depthTest: !this.useDepthTexture,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
    });
    const uniforms = this.skyUniforms;
    const useDepth = this.useDepthTexture;
    const rowCount = count;
    const padV = (ATLAS_ROW_HEIGHT - 40) / (2 * rowCount * ATLAS_ROW_HEIGHT);
    const pillV = 40 / (rowCount * ATLAS_ROW_HEIGHT);
    material.onBeforeCompile = shader => {
      if (useDepth) Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'attribute float aLabelRow, aLabelUWidth;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv.x = uv.x * aLabelUWidth;
        vMapUv.y = 1.0 - (aLabelRow / ${rowCount}.0 + ${padV.toFixed(6)} + (1.0 - uv.y) * ${pillV.toFixed(6)});`);
      if (useDepth) shader.fragmentShader = patchSkyFragment(shader.fragmentShader, false, true);
    };
    material.customProgramCacheKey = () => `sky-sun-paths-labels:${rowCount}:${useDepth ? 'depth' : 'direct'}`;

    const mesh = new THREE.InstancedMesh(plane, material, count);
    mesh.renderOrder = 3;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    this.labelMesh = mesh;
    this.group.add(mesh);

    for (let i = 0; i < count; i++) {
      this.labels.push({
        row: i,
        uWidth: metrics[i].uWidth,
        aspect: metrics[i].aspect,
        positions: items[i].spots.filter(s => s.el >= 2).map(({ az, el }) => anglesAt(az, el)),
        spot: 0,
      });
    }
  }

  private updateLabels(camera: THREE.PerspectiveCamera): void {
    const mesh = this.labelMesh;
    if (!mesh || !this.labelRowsAttr || !this.labelWidthAttr) return;
    const viewHeight = 2 * SKY_SUN_PATHS_RADIUS * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const spriteH = viewHeight * LABEL_HEIGHT_FRACTION;
    const inv = camera.matrixWorldInverse, proj = camera.projectionMatrix, p = this.scratch;
    const narrow = camera.aspect < 0.85;
    const maxY = narrow ? 0.48 : 0.72, keepY = narrow ? 0.56 : 0.80;
    const maxX = narrow ? 0.50 : 0.76, keepX = narrow ? 0.58 : 0.84;
    const fits = (localPos: THREE.Vector3, limX: number, limY: number): boolean => {
      p.copy(localPos).add(camera.position).applyMatrix4(inv);
      if (p.z >= 0) return false;
      p.applyMatrix4(proj);
      return Math.abs(p.x) < limX && p.y > -limY && p.y < limY && p.z > -1 && p.z < 1;
    };
    let drawn = 0;
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i];
      if (!label.positions.length) continue;
      if (label.spot >= label.positions.length) label.spot = 0;
      let chosen = fits(label.positions[label.spot], keepX, keepY) ? label.spot : -1;
      for (let j = 0; chosen < 0 && j < label.positions.length; j++) {
        if (j !== label.spot && fits(label.positions[j], maxX, maxY)) chosen = j;
      }
      if (chosen < 0) {
        label.spot = 0;
        continue;
      }
      label.spot = chosen;
      this.labelPos.copy(label.positions[chosen]);
      this.labelScale.set(spriteH * label.aspect, spriteH, 1);
      this.labelMatrix.compose(this.labelPos, camera.quaternion, this.labelScale);
      mesh.setMatrixAt(drawn, this.labelMatrix);
      this.labelRowsAttr.setX(drawn, label.row);
      this.labelWidthAttr.setX(drawn, label.uWidth);
      drawn++;
    }
    mesh.count = drawn;
    mesh.visible = drawn > 0;
    if (drawn > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      this.labelRowsAttr.needsUpdate = true;
      this.labelWidthAttr.needsUpdate = true;
    }
  }

  /** Clip fragments strictly above the level horizon (el >= 0°) and, when Finish is on, against scene depth. */
  private withSkyClip<M extends THREE.Material>(material: M): M {
    const uniforms = this.skyUniforms;
    const useDepth = this.useDepthTexture;
    if (material instanceof THREE.ShaderMaterial) {
      Object.assign(material.uniforms, uniforms);
      material.fragmentShader = patchSkyFragment(material.fragmentShader, true, useDepth);
      material.customProgramCacheKey = () => `sky-sun-paths-line:${material.vertexColors ? 'vc' : 'flat'}:${useDepth ? 'depth' : 'direct'}`;
      return material;
    }
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = patchSkyFragment(shader.fragmentShader, true, useDepth);
    };
    material.customProgramCacheKey = () => `sky-sun-paths-marker:${useDepth ? 'depth' : 'direct'}`;
    return material;
  }

  private makeLineMaterial(hex: string, linewidth: number, vertexColors: boolean): LineMaterial {
    const material = new LineMaterial({
      color: hex,
      linewidth,
      vertexColors,
      depthTest: !this.useDepthTexture,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
    });
    material.fragmentShader = patchLineFeather(material.fragmentShader);
    this.withSkyClip(material);
    material.resolution.set(this.width, this.height);
    this.lineMaterials.add(material);
    return material;
  }

  private addSegments(geometry: LineSegmentsGeometry, inkMat: LineMaterial, colorMat: LineMaterial, inkOrder: number, colorOrder: number): void {
    for (const [material, order] of [[inkMat, inkOrder], [colorMat, colorOrder]] as const) {
      const line = new LineSegments2(geometry, material);
      line.renderOrder = order;
      line.castShadow = false;
      line.receiveShadow = false;
      line.frustumCulled = false;
      this.arcsGroup.add(line);
    }
  }

  private clearArcs(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const child of [...this.arcsGroup.children] as LineSegments2[]) {
      geometries.add(child.geometry);
      child.removeFromParent();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of this.lineMaterials) material.dispose();
    this.lineMaterials.clear();
    if (this.labelMesh) {
      this.labelMesh.geometry.dispose();
      (this.labelMesh.material as THREE.Material).dispose();
      this.labelMesh.dispose();
      this.labelMesh.removeFromParent();
      this.labelMesh = null;
    }
    this.labelAtlas?.dispose();
    this.labelAtlas = null;
    this.labelRowsAttr = this.labelWidthAttr = null;
    this.labels.length = 0;
  }

  dispose(): void {
    this.clearArcs();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.marker.removeFromParent();
    this.group.removeFromParent();
    this.cacheKey = '';
  }
}
