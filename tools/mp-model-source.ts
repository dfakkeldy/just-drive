// Offline reduction of the production rigs. No second set of hand-written vehicle shapes.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadBlenderCar, type BlenderCar } from '../web/src/car-model';
import { createTruck, TRUCK_SPEC } from '../web/src/truck';
import { createSxs, SXS_SPEC } from '../web/src/sxs';
import { createSxsCabin, createSxsCrew, createSxsUtility, SXS_CABIN_SPEC, SXS_CREW_SPEC, SXS_UTILITY_SPEC } from '../web/src/sxs-variants';
import { CAR_SPEC } from '../web/src/vehicle-spec';
import { createBike, BIKE_SPEC } from '../web/src/bike';
import { createTrailer, TRAILER_SPEC } from '../web/src/trailer';

export const MODEL_TRIANGLES = 696;

// The mail car is a model file (the phone file: fewer faces to reduce). Load it once, before sourceModel('car').
// The caller gives this module a `fetch` that finds models/<file> (tools/mp-models-build.mjs, modelFiles()).
let mailCar: BlenderCar | null = null;
export async function prepareCar(): Promise<void> { mailCar = await loadBlenderCar(true); }
function ghostCar() {
  if (!mailCar) throw new Error('call prepareCar() before sourceModel("car")');
  const car = mailCar.create(false, true);          // off duty, as the code car's ghost was: no roof sign, lamp or mail plate
  // The reducer leaves out every mesh that has a picture (plates, mud). The head lamps have one too, but they are
  // part of the car's shape: give them a plain lamp colour here.
  const lamp = new THREE.MeshStandardMaterial({ color: 0xf2e9c8 });
  car.root.traverse(part => { if (part instanceof THREE.Mesh && (part.material as THREE.Material).name === 'Head lamp') part.material = lamp; });
  return car;
}

export function sourceModel(kind: string): THREE.Group {
  const rig = kind === 'car' ? ghostCar()
    : kind === 'sxs' ? createSxs()
    : kind === 'sxs-utility' ? createSxsUtility()
    : kind === 'sxs-crew' ? createSxsCrew()
    : kind === 'sxs-cabin' ? createSxsCabin()
    : kind === 'bike' ? createBike()
    : createTruck();
  const root=rig.root;
  const wheelGroups: THREE.Object3D[] = kind==='bike' ? [] : [...new Set(Object.values(rig.wheels))];
  if (kind === 'bike') {
    (rig as ReturnType<typeof createBike>).pose({ steer:0,spin:0,front:0,rear:0,stand:0,foot:0,dive:0,crash:0,ground:0,pitch:0,roll:0 });
    // BikeRide places this rig at axle height; the other rigs use a tyre-contact datum.
    root.position.y = BIKE_SPEC.wheelRadius;
  }
  if (kind === 'trailer') {
    const trailer = createTrailer(false);
    trailer.root.position.z = TRUCK_SPEC.hitch!.back + TRAILER_SPEC.drawbar;
    root.add(trailer.root);wheelGroups.push(...trailer.wheels);
  }
  if(rig.extraWheels)wheelGroups.push(...rig.extraWheels);
  root.userData.ghostWheels = new Set(wheelGroups);
  const spec = kind === 'car' ? CAR_SPEC
    : kind === 'sxs' ? SXS_SPEC
    : kind === 'sxs-utility' ? SXS_UTILITY_SPEC
    : kind === 'sxs-crew' ? SXS_CREW_SPEC
    : kind === 'sxs-cabin' ? SXS_CABIN_SPEC
    : kind === 'bike' ? BIKE_SPEC
    : TRUCK_SPEC;
  root.userData.ghostSpec={wheelbase:spec.wheelbase,track:spec.track};
  return root;
}

/** Split real faces to a common vertex count for one instanced morph draw. Never pad with zero-area faces. */
export function equalize(g: THREE.BufferGeometry, target = MODEL_TRIANGLES): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position'), c = src.getAttribute('color');
  const faces: { p: number[][]; c: number[][]; area: number }[] = [];
  const a = new THREE.Vector3(), b = a.clone(), d = a.clone();
  for (let i = 0; i < p.count; i += 3) {
    const ps = [0, 1, 2].map(j => [p.getX(i+j), p.getY(i+j), p.getZ(i+j)]);
    const cs = [0, 1, 2].map(j => [c.getX(i+j), c.getY(i+j), c.getZ(i+j)]);
    a.fromArray(ps[0]); b.fromArray(ps[1]); d.fromArray(ps[2]);
    const area = b.sub(a).cross(d.sub(a)).length();
    if (area > 1e-9) faces.push({ p: ps, c: cs, area });
  }
  if (faces.length > target) throw new Error(`Reduction left ${faces.length} faces, target ${target}`);
  while (faces.length < target) {
    let at = 0; for (let i = 1; i < faces.length; i++) if (faces[i].area > faces[at].area) at = i;
    const f = faces[at], centre = (x: number[][]) => [0,1,2].map(j => (x[0][j]+x[1][j])/2);
    const mid = centre(f.p), colour = centre(f.c);
    faces[at] = { p: [f.p[0], mid, f.p[2]], c: [f.c[0], colour, f.c[2]], area: f.area/2 };
    faces.push({ p: [mid, f.p[1], f.p[2]], c: [colour, f.c[1], f.c[2]], area: f.area/2 });
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(f => f.p.flat()), 3));
  result.setAttribute('color', new THREE.Float32BufferAttribute(faces.flatMap(f => f.c.flat()), 3));
  result.computeVertexNormals(); if (src !== g) src.dispose();
  return result;
}

export function reduceModel(root: THREE.Group): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [], wheels = new Map<THREE.Object3D,THREE.BufferGeometry[]>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const v = new THREE.Vector3(), color = new THREE.Color();
  root.traverseVisible(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = (Array.isArray(obj.material) ? obj.material[0] : obj.material) as THREE.MeshStandardMaterial;
    const original = obj.geometry, p = original.getAttribute('position'), c = original.getAttribute('color');
    // Texture-only overlays (mud, plates) carry no shape and no marks into the ghost.
    if (mat.map) return;
    materials.add(mat);
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    const g = original.clone(), positions = new Float32Array(p.count * 3), colours = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (obj instanceof THREE.SkinnedMesh) obj.applyBoneTransform(i, v);
      v.applyMatrix4(obj.matrixWorld); v.toArray(positions, i*3);
      color.copy(mat.color); if (mat.vertexColors && c) color.multiply(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)));
      color.toArray(colours, i*3);
    }
    for (const key of Object.keys(g.attributes)) g.deleteAttribute(key);
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    let ancestor: THREE.Object3D | null=obj,wheel:THREE.Object3D|null=null;
    while(ancestor){if(root.userData.ghostWheels.has(ancestor)){wheel=ancestor;break;}ancestor=ancestor.parent;}
    const target=wheel ? wheels.get(wheel) ?? [] : geometries;if(wheel)wheels.set(wheel,target);
    target.push(g.index ? g.toNonIndexed() : g); if (g.index) g.dispose();
  });
  const hulls:THREE.BufferGeometry[]=[];
  for(const pieces of wheels.values()){
    const whole=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());const p=whole.getAttribute('position');
    const points:THREE.Vector3[]=[];
    // Support points from the real wheel mesh, including tread and rim. Keep its diameter and width.
    for(const side of [-1,1])for(let n=0;n<8;n++){
      const a=n*Math.PI/4,dir=new THREE.Vector3(side*.3,Math.sin(a),Math.cos(a));let best=-Infinity,at=0;
      for(let i=0;i<p.count;i++){const dot=p.getX(i)*dir.x+p.getY(i)*dir.y+p.getZ(i)*dir.z;if(dot>best){best=dot;at=i;}}
      points.push(new THREE.Vector3().fromBufferAttribute(p,at));
    }
    const hull=new ConvexGeometry(points),c=new THREE.Color(0x202628),colours=new Float32Array(hull.getAttribute('position').count*3);
    for(let i=0;i<colours.length;i+=3)c.toArray(colours,i);hull.setAttribute('color',new THREE.BufferAttribute(colours,3));hull.deleteAttribute('normal');hulls.push(hull);whole.dispose();
  }
  const wheelTriangles=hulls.reduce((n,g)=>n+g.getAttribute('position').count/3,0),allowance=MODEL_TRIANGLES-wheelTriangles;
  const merged = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
  // Vertex clustering removes sub-pixel trim, but keeps small disconnected parts (especially wheels).
  // A whole-rig edge collapse spends the entire allowance on body panels and can erase wheels.
  const cluster = (cell: number): THREE.BufferGeometry => {
    const p = merged.getAttribute('position'), c = merged.getAttribute('color');
    const cells = new Map<string, number>(), ids: number[] = [], points: number[][] = [], colours: number[][] = [], counts: number[] = [];
    for(let i=0;i<p.count;i++) {
      const key = [Math.round(p.getX(i)/cell),Math.round(p.getY(i)/cell),Math.round(p.getZ(i)/cell),
        Math.round(c.getX(i)*8),Math.round(c.getY(i)*8),Math.round(c.getZ(i)*8)].join(',');
      let id = cells.get(key);
      if(id===undefined) { id=points.length;cells.set(key,id);points.push([0,0,0]);colours.push([0,0,0]);counts.push(0); }
      ids.push(id);counts[id]++;
      for(let j=0;j<3;j++){points[id][j]+=p.array[i*3+j];colours[id][j]+=c.array[i*3+j];}
    }
    points.forEach((p,i)=>p.forEach((_,j)=>{p[j]/=counts[i];colours[i][j]/=counts[i];}));
    const pos: number[]=[],col: number[]=[],seen=new Set<string>();
    for(let i=0;i<ids.length;i+=3){
      const face=ids.slice(i,i+3);if(new Set(face).size<3)continue;
      const key=[...face].sort((a,b)=>a-b).join(',');if(seen.has(key))continue;seen.add(key);
      for(const id of face){pos.push(...points[id]);col.push(...colours[id]);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));return g;
  };
  let cell=.04, reduced=cluster(cell);
  while(reduced.getAttribute('position').count/3>allowance){
    cell*=1.12;reduced.dispose();reduced=cluster(cell);
    if(cell>1)throw new Error('Production rig cannot fit the ghost triangle allowance');
  }
  merged.dispose();
  const all=mergeGeometries([reduced,...hulls]);reduced.dispose();hulls.forEach(g=>g.dispose());
  const result = equalize(all); all.dispose();
  // Clustering can lift a tyre edge by a few centimetres. Restore the common ground datum.
  result.computeBoundingBox(); result.translate(0, -result.boundingBox!.min.y, 0);
  root.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) { materials.add(m); for (const t of Object.values(m)) if(t instanceof THREE.Texture) textures.add(t); } if(obj instanceof THREE.SkinnedMesh)obj.skeleton.dispose(); } });
  materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  return result;
}
