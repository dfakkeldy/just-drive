import * as THREE from 'three';
import type { Rig } from './vehicle-spec';
interface Block { indices: number[]; box: THREE.Box3; bone: number }
interface MeshBlocks { geometry: THREE.BufferGeometry; version: number; blocks: Block[] }
interface Triangle { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; det: number }
/** Vertical contact index of the drawn deck and gate triangles, rebuilt only when their pose changes. */
export class FleetSurface {
  private readonly bounds = new THREE.Box3();
  private readonly heights = new Map<string, { min: number; max: number }>();
  private readonly blocks = new WeakMap<THREE.Mesh, MeshBlocks>();
  private readonly cells = new Map<string, Triangle[]>();
  constructor(roots: readonly THREE.Object3D[]) {
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const g = node.geometry, count = g.index?.count ?? g.attributes.position.count;
        for (let i = 0; i < count; i += 3) {
          const points = [0, 1, 2].map(n => node.getVertexPosition(g.index?.getX(i + n) ?? i + n, new THREE.Vector3()).applyMatrix4(node.matrixWorld));
          const [a, b, c] = points, det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);

          const triangle = { a, b, c, det }; this.bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c);
          for (let x = Math.floor(Math.min(a.x, b.x, c.x) * 4); x <= Math.floor(Math.max(a.x, b.x, c.x) * 4); x++)
            for (let z = Math.floor(Math.min(a.z, b.z, c.z) * 4); z <= Math.floor(Math.max(a.z, b.z, c.z) * 4); z++) {
              const key = `${x},${z}`, min = Math.min(a.y,b.y,c.y), max = Math.max(a.y,b.y,c.y), range = this.heights.get(key); if (range) { range.min=Math.min(range.min,min); range.max=Math.max(range.max,max); } else this.heights.set(key,{min,max});
              const cell = this.cells.get(key); if (cell) cell.push(triangle); else this.cells.set(key, [triangle]);
            }
        }
      });
    }
  }
  height(x: number, z: number): number {
    let y = -Infinity;
    for (const { a, b, c, det } of this.cells.get(`${Math.floor(x * 4)},${Math.floor(z * 4)}`) ?? []) {
      if (Math.abs(det) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) y = Math.max(y, u * a.y + v * b.y + (1 - u - v) * c.y);
    }
    return y;
  }
  private overlaps(box: THREE.Box3): boolean {
    if (!this.bounds.intersectsBox(box)) return false;
    for (let x=Math.floor(box.min.x*4);x<=Math.floor(box.max.x*4);x++) for(let z=Math.floor(box.min.z*4);z<=Math.floor(box.max.z*4);z++) {
      const h=this.heights.get(`${x},${z}`); if(h&&box.min.y<=h.max&&box.max.y>=h.min)return true;
    }
    return false;
  }
  /** Conservative blocks reject chassis parts above/outside the deck before scanning their triangles. */
  private meshBlocks(mesh: THREE.Mesh): Block[] {
    const g=mesh.geometry,p=g.attributes.position,version=p instanceof THREE.BufferAttribute?p.version:p.data.version,skin=mesh instanceof THREE.SkinnedMesh?mesh:null;
    const cached=this.blocks.get(mesh); if(cached&&cached.geometry===g&&(g.attributes.travelWeight||cached.version===version))return cached.blocks;
    const groups=new Map<number,number[]>(),count=g.index?.count??p.count;
    for(let i=0;i<count;i+=3){const at=[0,1,2].map(n=>g.index?.getX(i+n)??i+n),indices=g.attributes.skinIndex,weights=g.attributes.skinWeight;
      const bone=skin&&indices&&at.every(n=>indices.getX(n)===indices.getX(at[0])&&weights.getX(n)===1)?indices.getX(at[0]):-1;
      const list=groups.get(bone);if(list)list.push(...at);else groups.set(bone,at);
    }
    const blocks:Block[]=[],point=new THREE.Vector3();
    for(const [bone,indices]of groups)for(let start=0;start<indices.length;start+=384){const own=indices.slice(start,start+384),box=new THREE.Box3();
      for(const index of own){point.fromBufferAttribute(p,index);if(skin&&bone>=0)point.applyMatrix4(skin.bindMatrix).applyMatrix4(skin.skeleton.boneInverses[bone]);box.expandByPoint(point)}
      // Only the suspension batches deform their vertices; their clamped stroke is below this bound.
      if(g.attributes.travelWeight){box.min.y-=1;box.max.y+=1;}
      blocks.push({indices:own,box,bone});
    }
    this.blocks.set(mesh,{geometry:g,version,blocks});return blocks;
  }
  /** Chassis triangles may not cut the trailer. Tyres are checked separately against its support surfaces. */
  crosses(rig: Rig, target?: THREE.Matrix4): boolean {
    rig.root.updateWorldMatrix(true, true);
    rig.root.updateMatrixWorld(true); // Refresh attached skinned bind inverses, as the renderer does.
    const delta = target ? target.clone().multiply(rig.root.matrixWorld.clone().invert()) : null;
    const skin = 'bikeMesh' in rig ? rig as Rig & { bikeMesh: THREE.SkinnedMesh } : null;
    skin?.bikeMesh.skeleton.update();
    const wheels = new Set(Object.values(rig.wheels)), wheelBones = skin ? new Set([...wheels].map(w => skin.bikeMesh.skeleton.bones.indexOf(w as THREE.Bone))) : null;
    const ray = new THREE.Ray(), direction = new THREE.Vector3(), hit = new THREE.Vector3();
    const edgesCross = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, triangle: Triangle): boolean => {
      const normal = new THREE.Vector3().subVectors(triangle.b, triangle.a).cross(new THREE.Vector3().subVectors(triangle.c, triangle.a)).normalize();
      const corners = [a, b, c];
      for (let i = 0; i < 3; i++) {
        const from = corners[i], to = corners[(i + 1) % 3], d0 = normal.dot(direction.subVectors(from, triangle.a)), d1 = normal.dot(direction.subVectors(to, triangle.a));
        if (d0 * d1 >= 0 || Math.min(Math.abs(d0), Math.abs(d1)) < .003) continue;
        const length = direction.subVectors(to, from).length(); ray.set(from, direction.multiplyScalar(1 / length));
        if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit) && hit.distanceTo(from) < length - .003) return true;
      }
      return false;
    };
    let blocked = false; const box = new THREE.Box3(), blockMatrix = new THREE.Matrix4();
    rig.root.traverse(node => {
      if (blocked || !(node instanceof THREE.Mesh) || node.name === 'Removable driver') return;
      for (let parent: THREE.Object3D | null = node; parent && parent !== rig.root; parent = parent.parent) if (wheels.has(parent)) return;
      if (skin && node !== skin.bikeMesh) return;
      const g = node.geometry, indices = g.attributes.skinIndex;
      for (const block of this.meshBlocks(node)) {
        if (blocked) break;
        if (skin && block.bone >= 0 && wheelBones?.has(block.bone)) continue;
        if (skin && block.bone >= 0) blockMatrix.copy(node.matrixWorld).multiply(skin.bikeMesh.bindMatrixInverse).multiply(skin.bikeMesh.skeleton.bones[block.bone].matrixWorld);
        else blockMatrix.copy(node.matrixWorld);
        if (delta) blockMatrix.premultiply(delta);
        if (!skin || block.bone >= 0) { box.copy(block.box).applyMatrix4(blockMatrix); if (!this.overlaps(box)) continue; }
        for (let i = 0; i < block.indices.length && !blocked; i += 3) {
        const at = block.indices.slice(i,i+3);
        if (indices && wheelBones && at.every(n => wheelBones.has(indices.getX(n)))) continue;
        const [a, b, c] = at.map(n => (() => { const p = node.getVertexPosition(n, new THREE.Vector3()).applyMatrix4(node.matrixWorld); return delta ? p.applyMatrix4(delta) : p; })());
        const own = { a, b, c, det: 0 }, seen = new Set<Triangle>();
        const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
        for (let x = Math.floor(Math.min(a.x, b.x, c.x) * 4); x <= Math.floor(Math.max(a.x, b.x, c.x) * 4) && !blocked; x++)
          for (let z = Math.floor(Math.min(a.z, b.z, c.z) * 4); z <= Math.floor(Math.max(a.z, b.z, c.z) * 4) && !blocked; z++) {
            const key = `${x},${z}`, range = this.heights.get(key);
            if (!range || minY > range.max || maxY < range.min) continue;
            for (const triangle of this.cells.get(key) ?? []) {
              if (seen.has(triangle)) continue; seen.add(triangle);
              if (minY > Math.max(triangle.a.y, triangle.b.y, triangle.c.y) || maxY < Math.min(triangle.a.y, triangle.b.y, triangle.c.y)) continue;
              if (edgesCross(a, b, c, triangle) || edgesCross(triangle.a, triangle.b, triangle.c, own)) { blocked = true; break; }
            }
      }
      }
      }
    });
    return blocked;
  }

}
