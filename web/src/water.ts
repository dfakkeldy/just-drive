import * as THREE from 'three';
import { toggle } from './settings';
import type { Terrain } from './terrain';
import { SEA_QUERY_FRAG, SEA_VERT } from './shaders';

/** A clipped mirror of the shore, updated each visible frame. The phone never constructs it. */
interface Visibility { query: WebGLQuery | null; pending: boolean; active: boolean; visible: boolean }

export class WaterReflections {
  readonly uniforms = {
    tReflection: { value: null as THREE.Texture | null },
    waterViewport: { value: new THREE.Vector2(1, 1) },
    reflectionTexel: { value: new THREE.Vector2(1, 1) },
    reflectionOn: { value: 0 },
    tShore: { value: null as THREE.Texture | null },
    shoreRect: { value: new THREE.Vector4() },
    waterOrigin: { value: new THREE.Vector2() },
  };
  /** Small sites can join the existing clipped pass without a second mirror. */
  include(site: THREE.Object3D): void { this.reflected.add(site); }
  private readonly target: THREE.WebGLRenderTarget;
  private readonly mirror = new THREE.PerspectiveCamera();
  private readonly look = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly gl: WebGL2RenderingContext;
  private readonly seaVisibility: Visibility = { query: null, pending: false, active: false, visible: false };
  private readonly landVisibility: Visibility = { query: null, pending: false, active: false, visible: false };
  private visible = false;
  private valid = false;
  private lost = false;
  private readonly projection = new THREE.Matrix4();
  private readonly nearTrees = new THREE.Group();
  private readonly treeCache = new Map<THREE.InstancedMesh, THREE.InstancedMesh>();
  private readonly treeAt = new THREE.Vector3(Infinity, 0, Infinity);
  private treeChildren = -1;
  private readonly emptyTrees = new Map<THREE.InstancedMesh, string>();
  private readonly seaMaterial: THREE.Material;
  private readonly seaQueryMaterial: THREE.ShaderMaterial;
  private on = true;
  private shoreMade = false;
  private siteWater = false;
  /** Reuse the one clipped pass for a nearby inland pool. Existing areas retain the sea plane. */
  setLevel(level:number,visible=false):void {
    if(this.level!==level){this.level=level;this.clip[0].constant=-level;this.invalidate();}
    this.siteWater=visible;
  }
  /** The optional far patch uses the same mask in colour and occlusion draws. */
  transformSea(vertex: (source: string) => string, fragment: (source: string) => string): void {
    const vertexShader=vertex(SEA_VERT),fragmentShader=fragment(SEA_QUERY_FRAG);
    this.seaQueryMaterial.vertexShader=vertexShader;
    this.seaQueryMaterial.fragmentShader=fragmentShader;
    this.seaQueryMaterial.needsUpdate=true;
  }
  private maskWarm = false;
  private readonly savedScissor = new THREE.Vector4();
  private readonly hidden: THREE.Object3D[] = [];
  private readonly clear = new THREE.Color();
  private readonly clip: THREE.Plane[];

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly sea: THREE.Mesh, private level: number, private readonly reflected: Set<THREE.Object3D>,
    private readonly terrain: Terrain, private readonly trees: THREE.Group | null, asked: string | null) {
    this.clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -level)];
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    // The mirror holds light before tone mapping, so it wants a half-float image. A graphics chip that cannot draw
    // into one (neither colour-buffer float extension) gets eight bits: bright spots clip, the mirror still works.
    const float = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.seaMaterial = sea.material as THREE.Material;
    // While the sea is hidden it is drawn with a plain, cheap sea colour (with the logarithmic depth buffer a hidden
    // pixel still runs its shader). The answer that the sea has come into view arrives a frame or two late: in those
    // frames the player sees this plain sea, not a hole.
    this.seaQueryMaterial = new THREE.ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: SEA_QUERY_FRAG,
      uniforms: (sea.material as THREE.ShaderMaterial).uniforms });
    this.resetQueries();
    renderer.domElement.addEventListener('webglcontextlost', () => {
      this.lost = true; this.maskWarm = false; this.invalidate();
      // Remove the old target's GL disposal listener while the lost context still owns it.
      // Otherwise a later resize tries to delete objects from the previous context generation.
      this.target.dispose();
      for (const state of [this.seaVisibility, this.landVisibility]) { state.query = null; state.pending = state.active = state.visible = false; }
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.lost = false; this.resetQueries(); this.invalidate();
    });
    if (trees) this.reflected.delete(trees);
    this.nearTrees.visible = false; this.nearTrees.name = 'Mirror trees'; scene.add(this.nearTrees); this.reflected.add(this.nearTrees);
    const saved = (() => { try { return localStorage.getItem('mmm.reflections'); } catch { return null; } })();
    this.on = (asked ?? saved) !== '0';
    this.uniforms.tReflection.value = this.target.texture;
    this.target.texture.generateMipmaps = false;
    this.uniforms.waterOrigin.value.set(...terrain.manifest.village);
    const dry = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
    dry.needsUpdate = true;
    this.uniforms.tShore.value = dry;
    // The sea's own draw carries the query that tells when the camera returns to water.
    sea.renderOrder = 2;
    sea.onBeforeRender = () => this.begin(this.seaVisibility);
    sea.onAfterRender = () => this.end(this.seaVisibility);
    toggle('reflections', 'Water reflections', this.on, on => { this.on = on; this.invalidate(); });
  }

  /** A second pool at another elevation uses the sky fallback, never the wrong planar image. */
  matchesLevel(level:number):boolean {return Math.abs(this.level-level)<.01;}

  /** Derive shore distance once from the existing map, not from invented sea-floor heights. */
  private shore(): void {
    const image = (this.terrain.uniforms.tCover.value as THREE.Texture).image as HTMLImageElement | undefined;
    if (this.shoreMade || !image?.width) return;
    this.shoreMade = true;
    const w = Math.ceil(image.width / 2), h = Math.ceil(image.height / 2);
    const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const d = new Uint8Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = pixels[i * 4 + 2] === 4 ? 255 : 0;
    // Chamfer distance: three units per map pixel, capped at 85 pixels from land.
    for (let y = 1; y < h; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      d[i] = Math.min(d[i], d[i - 1] + 3, d[i - w] + 3, d[i - w - 1] + 4, d[i - w + 1] + 4);
    }
    for (let y = h - 2; y >= 0; y--) for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      d[i] = Math.min(d[i], d[i + 1] + 3, d[i + w] + 3, d[i + w - 1] + 4, d[i + w + 1] + 4);
    }
    const texture = new THREE.DataTexture(d, w, h, THREE.RedFormat);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1; texture.needsUpdate = true;
    this.uniforms.tShore.value?.dispose(); this.uniforms.tShore.value = texture;
    const c = this.terrain.manifest.cover, v = this.terrain.manifest.village;
    this.uniforms.shoreRect.value.set(c.xmin - v[0], v[1] - c.ymax, 1 / (c.xmax - c.xmin), 1 / (c.ymax - c.ymin));
  }

  private invalidate(): void {
    this.valid = false; this.visible = false; this.uniforms.reflectionOn.value = 0;
  }

  private resetQueries(): void {
    for (const state of [this.seaVisibility, this.landVisibility]) {
      state.query = this.gl.createQuery(); state.pending = state.active = state.visible = false;
    }
  }

  private begin(state: Visibility): void {
    if (this.lost || this.gl.isContextLost() || state.pending || !state.query) return;
    this.gl.beginQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE, state.query); state.active = true;
  }

  private end(state: Visibility): void {
    if (!state.active || this.lost) return;
    this.gl.endQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE); state.active = false; state.pending = true;
  }

  /** Call after the main render, also when it threw: a sea draw that failed has not closed its query. */
  settle(): void {
    if (!this.seaVisibility.active) return;
    this.seaVisibility.active = false;
    if (!this.lost && !this.gl.isContextLost()) { this.gl.endQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE); this.seaVisibility.pending = true; }
  }

  private read(state: Visibility): void {
    if (state.pending && state.query && this.gl.getQueryParameter(state.query, this.gl.QUERY_RESULT_AVAILABLE)) {
      state.visible = this.gl.getQueryParameter(state.query, this.gl.QUERY_RESULT) as boolean; state.pending = false;
    }
  }

  /** Count painted tidal water against the completed main depth buffer, without painting or clearing it. */
  afterRender(camera: THREE.PerspectiveCamera): void {
    if (this.lost || this.gl.isContextLost()) return;
    // Warm this program while the first tiles load, rather than on a later turn away from open water.
    const mask = !this.maskWarm || (this.on && !this.seaVisibility.visible) ? this.terrain.waterMask() : null;
    if (!this.maskWarm && mask) {
      const clear = this.renderer.autoClear, test = this.renderer.getScissorTest();
      const shadow = this.renderer.shadowMap.autoUpdate, needs = this.renderer.shadowMap.needsUpdate;
      this.renderer.getScissor(this.savedScissor);
      this.renderer.autoClear = false; this.renderer.setScissor(0, 0, 1 / this.renderer.getPixelRatio(), 1 / this.renderer.getPixelRatio()); this.renderer.setScissorTest(true);
      this.renderer.shadowMap.autoUpdate = this.renderer.shadowMap.needsUpdate = false;
      try { this.renderer.render(mask, camera); this.maskWarm = true; }
      finally {
        this.renderer.autoClear = clear; this.renderer.setScissor(this.savedScissor); this.renderer.setScissorTest(test);
        this.renderer.shadowMap.autoUpdate = shadow; this.renderer.shadowMap.needsUpdate = needs;
      }
    }
    if (this.seaVisibility.visible || !this.on) { this.landVisibility.visible = false; return; }
    if (!mask) { this.landVisibility.visible = false; return; }
    if (this.landVisibility.pending) return;
    const clear = this.renderer.autoClear, shadow = this.renderer.shadowMap.autoUpdate, needs = this.renderer.shadowMap.needsUpdate;
    this.renderer.autoClear = false; this.renderer.shadowMap.autoUpdate = this.renderer.shadowMap.needsUpdate = false;
    this.begin(this.landVisibility);
    try { this.renderer.render(mask, camera); }
    finally {
      this.end(this.landVisibility); this.renderer.autoClear = clear;
      this.renderer.shadowMap.autoUpdate = shadow; this.renderer.shadowMap.needsUpdate = needs;
    }
  }

  /** Keep actual tree shapes close to the shore. The coarser land carries measured canopy further away. */
  private updateTrees(focus: THREE.Vector3): void {
    if (!this.trees) return;
    const rebuild = this.treeAt.distanceToSquared(focus) > 64 || this.treeChildren !== this.trees.children.length;
    if (rebuild) { this.treeAt.copy(focus); this.treeChildren = this.trees.children.length; this.emptyTrees.clear(); }
    for (const proxy of this.treeCache.values()) proxy.visible = false;
    for (const child of this.trees.children) {
      const source = child as THREE.InstancedMesh;
      if (!source.isInstancedMesh || !source.visible) continue;
      // The trees repack a tile's shapes as the car moves (every three metres) and change its material with
      // distance. A proxy made from an older packing is made again, and takes the present shape and material.
      const packing = `${source.instanceMatrix.version}:${source.count}:${source.geometry.id}:${(source.material as THREE.Material).id}`;
      if (!rebuild && this.emptyTrees.get(source) === packing) continue;
      let proxy = this.treeCache.get(source);
      if (!rebuild && proxy && proxy.userData.packing === packing) { proxy.visible = proxy.count > 0; continue; }
      const matrices = source.instanceMatrix.array, colours = source.instanceColor?.array;
      let selected = 0;
      for (let i = 0; i < source.count; i++) {
        const k = i * 16, dx = matrices[k + 12] - focus.x, dz = matrices[k + 14] - focus.z;
        if (dx * dx + dz * dz > 330 * 330) continue;
        if (!proxy) {
          proxy = new THREE.InstancedMesh(source.geometry, source.material, source.instanceMatrix.count);
          proxy.instanceColor = colours ? new THREE.InstancedBufferAttribute(new Float32Array(source.instanceMatrix.count * 3), 3) : null;
          proxy.frustumCulled = true; proxy.castShadow = false; proxy.receiveShadow = false;
          proxy.userData.shadowSet = true; this.nearTrees.add(proxy); this.treeCache.set(source, proxy);
        }
        for (let j = 0; j < 16; j++) proxy.instanceMatrix.array[selected * 16 + j] = matrices[k + j];
        if (colours && proxy.instanceColor) for (let j = 0; j < 3; j++) proxy.instanceColor.array[selected * 3 + j] = colours[i * 3 + j];
        selected++;
      }
      if (!proxy) this.emptyTrees.set(source, packing); else this.emptyTrees.delete(source);
      if (proxy) {
        proxy.geometry = source.geometry; proxy.material = source.material; proxy.userData.packing = packing;
        proxy.count = selected; proxy.visible = selected > 0; proxy.instanceMatrix.needsUpdate = true;
        if (proxy.instanceColor) proxy.instanceColor.needsUpdate = true;
        if (selected) proxy.computeBoundingSphere();
      }
    }
    if (rebuild) for (const [source, proxy] of this.treeCache) if (!source.parent) {
      this.nearTrees.remove(proxy); proxy.dispose(); this.treeCache.delete(source);
    }
  }

  update(camera: THREE.PerspectiveCamera): void {
    this.uniforms.reflectionOn.value = 0;
    if (this.lost || this.gl.isContextLost()) return;
    this.shore();
    this.renderer.getDrawingBufferSize(this.uniforms.waterViewport.value);
    this.read(this.seaVisibility); this.read(this.landVisibility);
    this.sea.material = this.seaVisibility.visible ? this.seaMaterial : this.seaQueryMaterial;
    const visible = this.on && (this.siteWater || this.seaVisibility.visible || this.landVisibility.visible) && camera.position.y > this.level;
    const size = this.uniforms.waterViewport.value;
    const width = Math.min(1024, Math.ceil(size.x / 2)), height = Math.max(1, Math.round(width * size.y / size.x));
    const changed = this.target.width !== width || this.target.height !== height || !this.projection.equals(camera.projectionMatrix);
    if (!visible) { this.invalidate(); return; }
    if (!this.visible || changed) this.valid = false;
    this.visible = true;
    this.valid = false;
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    this.uniforms.reflectionTexel.value.set(1 / width, 1 / height);
    const mirror = this.mirror;
    mirror.copy(camera); mirror.position.y = 2 * this.level - camera.position.y;
    camera.getWorldDirection(this.direction); this.direction.y *= -1;
    this.look.copy(mirror.position).add(this.direction);
    mirror.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    mirror.up.y *= -1; mirror.up.negate(); mirror.lookAt(this.look);
    mirror.far = Math.min(camera.far, 6000); mirror.updateProjectionMatrix(); mirror.updateMatrixWorld();
    this.updateTrees(camera.position);
    const oldTarget = this.renderer.getRenderTarget(), oldTone = this.renderer.toneMapping;
    const oldShadow = this.renderer.shadowMap.autoUpdate, oldNeeds = this.renderer.shadowMap.needsUpdate, oldEnabled = this.renderer.shadowMap.enabled;
    const alpha = this.renderer.getClearAlpha(); this.renderer.getClearColor(this.clear);
    for (const child of this.scene.children) if (child.visible && !this.reflected.has(child) && !(child as THREE.Light).isLight) {
      this.hidden.push(child); child.visible = false;
    }
    this.nearTrees.visible = true;
    const oldClip = this.renderer.clippingPlanes, oldAutoClear = this.renderer.autoClear;
    this.renderer.clippingPlanes = this.clip;
    this.uniforms.tReflection.value = null;
    this.renderer.shadowMap.autoUpdate = this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    // The existing mirror stops at 6 km. Preserve its flat local scenery so
    // curving a distant reflected hill cannot change water beside the player.
    // Far land/turbines are not part of this local reflection set.
    const curve = this.seaQueryMaterial.uniforms.farCurveOn, previousCurve = curve?.value;
    if (curve) curve.value = 0;
    try {
      this.renderer.setRenderTarget(this.target); this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(); this.renderer.autoClear = false;   // one clear, not a second one by the render itself
      this.terrain.withReflection(mirror, camera.position, () => this.renderer.render(this.scene, mirror));
      this.projection.copy(camera.projectionMatrix); this.valid = true;
    } finally {
      if (curve) curve.value = previousCurve;
      this.uniforms.tReflection.value = this.target.texture;
      this.renderer.clippingPlanes = oldClip; this.renderer.autoClear = oldAutoClear; this.nearTrees.visible = false;
      for (const child of this.hidden) child.visible = true; this.hidden.length = 0;
      this.renderer.setRenderTarget(oldTarget); this.renderer.setClearColor(this.clear, alpha);
      this.renderer.toneMapping = oldTone; this.renderer.shadowMap.autoUpdate = oldShadow; this.renderer.shadowMap.needsUpdate = oldNeeds; this.renderer.shadowMap.enabled = oldEnabled;
    }
    this.uniforms.reflectionOn.value = this.valid ? 1 : 0;
  }
}
