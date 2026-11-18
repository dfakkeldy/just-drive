import * as THREE from 'three';

/** A transaction retains object identities, including controller caches and their shared references. */
export function checkpoint(objects: object[], roots: THREE.Object3D[]): () => void {
  const restores: (() => void)[] = [], seen = new Set<object>();
  const excluded = new Set(['car', 'terrain', 'roads', 'spec', 'world', 'model', 'placementTrial']);
  const visit = (object: object): void => {
    if (seen.has(object)) return; seen.add(object);
    if (ArrayBuffer.isView(object)) {
      const array = object as unknown as Float32Array, copy = array.slice(); restores.push(() => array.set(copy)); return;
    }
    if (object instanceof THREE.Object3D || object instanceof THREE.BufferGeometry || object instanceof THREE.Material) return;
    const record = object as Record<string, unknown>, values = Object.entries(record).filter(([key]) => !excluded.has(key));
    const length = Array.isArray(object) ? object.length : null;
    // Cached camera metadata can alias a deeply frozen shared spec. Retain that identity without writing it.
    if (!Object.isFrozen(object)) restores.push(() => { for (const [key, value] of values) record[key] = value; if (length !== null) (object as unknown[]).length = length; });
    for (const [, value] of values) if (value && typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (Array.isArray(value) || ArrayBuffer.isView(value) || proto === Object.prototype || value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Quaternion || value instanceof THREE.Euler || value instanceof THREE.Matrix3 || value instanceof THREE.Matrix4) visit(value);
    }
  };
  for (const object of objects) visit(object);
  const nodes = new Set<THREE.Object3D>();
  for (const root of roots) root.traverse(node => nodes.add(node));
  for (const node of nodes) {
    if (node instanceof THREE.SkinnedMesh) {
      const sphere = node.boundingSphere?.clone() ?? null, box = node.boundingBox?.clone() ?? null;
      restores.push(() => { node.boundingSphere = sphere?.clone() ?? null; node.boundingBox = box?.clone() ?? null; });
    }
    if (node instanceof THREE.Mesh && node.geometry.attributes.travelWeight) {
      const g = node.geometry, position = g.attributes.position.array.slice(), normal = g.attributes.normal.array.slice();
      const box = g.boundingBox?.clone() ?? null, sphere = g.boundingSphere?.clone() ?? null;
      restores.push(() => { (g.attributes.position.array as Float32Array).set(position); (g.attributes.normal.array as Float32Array).set(normal); g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true; g.boundingBox = box?.clone() ?? null; g.boundingSphere = sphere?.clone() ?? null; });
    }
    const euler = { ...node.rotation };
    const parent = node.parent, position = node.position.clone(), quaternion = node.quaternion.clone(), scale = node.scale.clone(), visible = node.visible;
    restores.push(() => { if (parent && node.parent !== parent) parent.add(node); else if (!parent) node.removeFromParent(); node.position.copy(position); node.quaternion.copy(quaternion); Object.assign(node.rotation, euler); node.scale.copy(scale); node.visible = visible; node.updateMatrix(); });
  }
  return () => { for (const restore of restores) restore(); for (const root of roots) { root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); } for (const node of nodes) if (node instanceof THREE.SkinnedMesh) node.skeleton.update(); };
}

/** One reusable before-frame image for provisional physics. Large vertex buffers are allocated once,
 * not copied into new arrays on every frame. History objects are weakly cached so old crumbs can die. */
export function reusableCheckpoint(objects: object[], roots: THREE.Object3D[], skip: readonly THREE.Object3D[] = []): () => () => void {
  type Record = { save(): void; restore(): void };
  const cache = new WeakMap<object, Record>(), nodes = new WeakMap<THREE.Object3D, Record>();
  const pending: Record[] = [], seen = new Set<object>(), skipped = new Set(skip), skins: THREE.SkinnedMesh[] = [];
  const excluded = new Set(['car', 'terrain', 'roads', 'spec', 'world', 'model', 'placementTrial']);
  const visit = (value: object): void => {
    if (seen.has(value) || value instanceof THREE.Object3D || value instanceof THREE.Material || value instanceof THREE.BufferGeometry) return;
    seen.add(value); let record = cache.get(value);
    if (!record) {
      if (ArrayBuffer.isView(value)) {
        const array = value as unknown as Float32Array, copy = array.slice();
        record = { save: () => copy.set(array), restore: () => array.set(copy) };
      } else {
        const object = value as { [key: string]: unknown }, array = Array.isArray(value);
        const keys = array ? [] : Object.keys(object).filter(k => !excluded.has(k));
        const values: unknown[] = []; let length = 0;
        record = {
          save() {
            length = array ? (value as unknown[]).length : keys.length;
            while (array && keys.length < length) keys.push(String(keys.length));
            for (let i = 0; i < length; i++) {
              const v = values[i] = object[keys[i]];
              if (v && typeof v === 'object') visit(v);
            }
          },
          restore() {
            if (Object.isFrozen(value)) return;
            if (array) (value as unknown[]).length = length;
            for (let i = 0; i < length; i++) object[keys[i]] = values[i];
          },
        };
      }
      cache.set(value, record);
    }
    pending.push(record); record.save();
  };
  const nodeRecord = (node: THREE.Object3D): Record => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let visible = true, parent: THREE.Object3D | null = null;
    const angleKeys = Object.keys(node.rotation), angles: { [key: string]: unknown } = {};
    const mesh = node instanceof THREE.Mesh ? node : null, g = mesh?.geometry;
    const position = g?.attributes.travelWeight ? g.attributes.position.array.slice() as Float32Array : null;
    const normal = position ? g!.attributes.normal.array.slice() as Float32Array : null;
    const box = new THREE.Box3(), sphere = new THREE.Sphere(); let oldBox: THREE.Box3 | null = null, oldSphere: THREE.Sphere | null = null;
    const skin = node instanceof THREE.SkinnedMesh ? node : null, skinBox = new THREE.Box3(), skinSphere = new THREE.Sphere();
    let oldSkinBox: THREE.Box3 | null = null, oldSkinSphere: THREE.Sphere | null = null;
    return {
      save() {
        p.copy(node.position); q.copy(node.quaternion); for (const key of angleKeys) angles[key] = (node.rotation as unknown as { [key: string]: unknown })[key]; s.copy(node.scale); visible = node.visible; parent = node.parent;
        if (position) { position.set(g!.attributes.position.array); normal!.set(g!.attributes.normal.array); oldBox = g!.boundingBox; oldSphere = g!.boundingSphere; if (oldBox) box.copy(oldBox); if (oldSphere) sphere.copy(oldSphere); }
        if (skin) { oldSkinBox = skin.boundingBox; oldSkinSphere = skin.boundingSphere; if (oldSkinBox) skinBox.copy(oldSkinBox); if (oldSkinSphere) skinSphere.copy(oldSkinSphere); }
      },
      restore() {
        if (parent && node.parent !== parent) parent.add(node); else if (!parent) node.removeFromParent();
        node.position.copy(p); node.quaternion.copy(q); Object.assign(node.rotation, angles); node.scale.copy(s); node.visible = visible; node.updateMatrix();
        if (position) { (g!.attributes.position.array as Float32Array).set(position); (g!.attributes.normal.array as Float32Array).set(normal!); g!.attributes.position.needsUpdate = g!.attributes.normal.needsUpdate = true; g!.boundingBox = oldBox; g!.boundingSphere = oldSphere; oldBox?.copy(box); oldSphere?.copy(sphere); }
        if (skin) { const bounds = skin as { boundingBox: THREE.Box3 | null; boundingSphere: THREE.Sphere | null }; bounds.boundingBox = oldSkinBox; bounds.boundingSphere = oldSkinSphere; oldSkinBox?.copy(skinBox); oldSkinSphere?.copy(skinSphere); }
      },
    };
  };
  const restore = () => { for (const r of pending) r.restore(); for (const root of roots) { root.updateWorldMatrix(true, true); root.updateMatrixWorld(true); } for (const skin of skins) skin.skeleton.update(); };
  return () => {
    pending.length = 0; skins.length = 0; seen.clear(); for (const object of objects) visit(object);
    for (const root of roots) root.traverse(node => { for (let p: THREE.Object3D | null = node; p; p = p.parent) if (skipped.has(p)) return; if (seen.has(node)) return; seen.add(node); if (node instanceof THREE.SkinnedMesh) skins.push(node); let r = nodes.get(node); if (!r) { r = nodeRecord(node); nodes.set(node, r); } r.save(); pending.push(r); });
    return restore;
  };
}
