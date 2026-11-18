import * as THREE from 'three';
/** A small shared palette and faceted primitives. Each interior owns and releases its resources. */
export class MineArt {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly palette = new Map<number, THREE.MeshLambertMaterial>();
  private geometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose();
    const pos = geo.getAttribute('position'), colors: number[] = [];
    for (let i = 0; i < pos.count; i++) { const shade = .8 + .18 * Math.abs(Math.sin(Math.floor(i / 3) * 7.13)); colors.push(shade, shade, shade); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); this.geometries.push(geo); return geo;
  }
  readonly cube = this.geometry(new THREE.BoxGeometry(1, 1, 1));
  readonly rock = this.geometry(new THREE.IcosahedronGeometry(1, 0));
  readonly cylinder = this.geometry(new THREE.CylinderGeometry(1, 1, 1, 6));
  material(color: number): THREE.MeshLambertMaterial {
    let mat = this.palette.get(color);
    if (!mat) { mat = new THREE.MeshLambertMaterial({ color, vertexColors: true, flatShading: true }); this.palette.set(color, mat); this.materials.push(mat); }
    return mat;
  }
  box(parent: THREE.Object3D, color: number, x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh {
    return this.shape(parent, this.cube, color, x, y, z, w, h, d);
  }
  shape(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.material(color)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
  }
  glow(parent: THREE.Object3D, color: number, x: number, y: number, z: number, size: number): THREE.Mesh {
    const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 2 }); this.materials.push(mat);
    const mesh = new THREE.Mesh(this.cube, mat); mesh.scale.setScalar(size); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  board(parent: THREE.Object3D, lines: string[], x: number, y: number, z: number, w: number, h: number, chalk = false, oldFirst = chalk): THREE.Mesh {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const c = canvas.getContext('2d')!; c.fillStyle = chalk ? '#172524' : '#d5c6a0'; c.fillRect(0, 0, 1024, 512);
    c.strokeStyle = chalk ? '#6d6250' : '#433e32'; c.lineWidth = 18; c.strokeRect(14, 14, 996, 484);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const lineHeight = 430 / lines.length;
    lines.forEach((line, i) => {
      const old = oldFirst && i === 0;
      c.fillStyle = old ? '#687773' : chalk ? '#fff9c6' : '#252a25';
      c.font = `bold ${old ? 44 : lines.length > 3 ? 52 : 66}px monospace`;
      c.fillText(line, 512, 42 + lineHeight * (i + .5), 930);
      if (old) { c.strokeStyle = '#9a8d70'; c.lineWidth = 7; c.beginPath(); c.moveTo(110, 42 + lineHeight * (i + .5) - 8); c.lineTo(910, 42 + lineHeight * (i + .5) + 8); c.stroke(); }
    });
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; this.textures.push(tex);
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: chalk ? tex : null, emissive: chalk ? 0xffffff : 0x000000, emissiveIntensity: .7, side: THREE.DoubleSide });
    this.materials.push(mat); const geo = new THREE.PlaneGeometry(w, h); this.geometries.push(geo);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  }
  cart(parent: THREE.Object3D): { root: THREE.Group; parcel: THREE.Group } {
    const root = new THREE.Group(); parent.add(root);
    this.box(root, 0x565e5c, 0, .45, 0, 1.45, .25, 2);
    for (const x of [-.72, .72]) this.box(root, 0x78817c, x, .9, 0, .12, .8, 2.1);
    for (const z of [-1, 1]) this.box(root, 0x646c67, 0, .9, z, 1.4, .8, .12);
    for (const x of [-.58, .58]) for (const z of [-.65, .65]) {
      const wheel = this.shape(root, this.cylinder, 0x222a29, x, .23, z, .24, .16, .24); wheel.rotation.z = Math.PI / 2;
    }
    const parcel = new THREE.Group(); parcel.position.set(0, .62, 0); root.add(parcel);
    this.box(parcel, 0xb59057, 0, .25, 0, .8, .5, .65);
    this.box(parcel, 0xede0b7, 0, .51, 0, .14, .012, .66);
    this.box(parcel, 0xe9dcc2, .2, .515, .1, .22, .015, .2);
    return { root, parcel };
  }
  dispose(): void { for (const g of this.geometries) g.dispose(); for (const m of this.materials) m.dispose(); for (const t of this.textures) t.dispose(); }
}
