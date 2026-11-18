import * as THREE from 'three';
import type { Roads } from './roads';

export interface InfrastructureFeature {
  kind: 'dam' | 'conveyor' | 'pipeline' | 'fence' | 'gate' | 'pier' | 'culvert';
  source: string;
  id: string;
  outline: readonly (readonly [number, number])[];
  points: readonly (readonly [number, number, number])[];
  closed: boolean;
  height?: number;
  gateGround?: readonly [number,number];
  existing?: boolean;
}
type Point = readonly [number, number, number];
export interface InfrastructurePart {
  id: string;
  role: 'concrete' | 'gallery' | 'steel' | 'pipe' | 'deck';
  a: Point;
  b: Point;
  width: number;
  height: number;
  baseA: number;
  baseB: number;
}
/** Coordinates remain in survey metres until the final instance matrix. All vertical bases are baked ground. */
export function infrastructureParts(features: readonly InfrastructureFeature[]): InfrastructurePart[] {
  const parts: InfrastructurePart[] = [];
  for (const f of features) {
    if (f.existing) continue;
    const span = (role: InfrastructurePart['role'], a: Point, b: Point, width: number, height: number, lift: number) => {
      parts.push({ id: f.id, role, a: [a[0], a[1], a[2] + lift], b: [b[0], b[1], b[2] + lift], width, height, baseA: a[2], baseB: b[2] });
    };
    const post = (p: Point, height: number, width = .12) => {
      parts.push({ id: f.id, role: 'steel', a: p, b: [p[0], p[1], p[2] + height], width, height: width, baseA: p[2], baseB: p[2] });
    };
    if (f.kind === 'culvert') {
      for (const [p, q] of [[f.points[0], f.points[1]], [f.points[f.points.length - 1], f.points[f.points.length - 2]]]) {
        if (!p || !q) continue;
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const end: Point = [p[0] + (q[0] - p[0]) / length, p[1] + (q[1] - p[1]) / length, p[2]];
        span('pipe', p, end, 1, 1, .1);
      }
      continue;
    }
    if (f.kind === 'gate' && f.points.length === 1) {
      const p = f.points[0];
      const a: Point = [p[0] - 2, p[1], f.gateGround?.[0] ?? p[2]], b: Point = [p[0] + 2, p[1], f.gateGround?.[1] ?? p[2]];
      post(a, 1.4); post(b, 1.4); span('steel', a, b, .1, .1, 1.1);
      continue;
    }
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1], b = f.points[i];
      switch (f.kind) {
        case 'dam':
          // Polygon faces follow the mapped boundary. The cap below covers its interior.
          span('concrete', a, b, f.closed ? .25 : .8, f.closed ? .7 : 1.2, .2);
          break;
        case 'conveyor':
          span('gallery', a, b, 2.4, 1.6, 5.8); if (i % 8 === 1) post(a, 5, .25);
          if (i === f.points.length - 1) post(b, 5, .25);
          break;
        case 'pipeline':
          span('pipe', a, b, .6, .6, 1.5); if (i % 8 === 1) post(a, 1.2, .18);
          if (i === f.points.length - 1) post(b, 1.2, .18);
          break;
        case 'fence':
        case 'gate': {
          const h = f.height ?? 2;
          post(a, h); if (i === f.points.length - 1) post(b, h);
          span('steel', a, b, .06, .06, h); span('steel', a, b, .05, .05, h * .45);
          break;
        }
        case 'pier':
          span('deck', a, b, 2, .35, 1); post(a, 1, .25);
          if (i === f.points.length - 1) post(b, 1, .25);
          break;
      }
    }
  }
  return parts;
}

export function infrastructureGround(base: number, exag: number, sea: number): number {
  return base > sea ? sea + (base - sea) * exag : base;
}
type XY = readonly [number, number];
const cross = (a: XY, b: XY, c: XY) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function pointSegment(p: XY, a: XY, b: XY): number {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0;
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
}
function segmentDistance(a: XY,b: XY,c: XY,d: XY): number {
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
}
interface RoadSegment {a:XY;b:XY;half:number}
interface RoadGrid {segments:RoadSegment[];cells:Map<string,number[]>}
const ROAD_CELL=32;
const roadCache = new WeakMap<Roads,RoadGrid>();
function nearbyRoads(roads:Roads,minX:number,minZ:number,maxX:number,maxZ:number):RoadSegment[]{
  let grid=roadCache.get(roads);
  if(!grid){
    const segments=roads.roads.flatMap(r=>r.pts.slice(1).map((b,i)=>({a:r.pts[i],b,half:r.halfWidth}))),cells=new Map<string,number[]>();
    segments.forEach((r,id)=>{
      const reach=r.half+.6;
      for(let z=Math.floor((Math.min(r.a[1],r.b[1])-reach)/ROAD_CELL);z<=Math.floor((Math.max(r.a[1],r.b[1])+reach)/ROAD_CELL);z++)
        for(let x=Math.floor((Math.min(r.a[0],r.b[0])-reach)/ROAD_CELL);x<=Math.floor((Math.max(r.a[0],r.b[0])+reach)/ROAD_CELL);x++){
          const key=x+','+z,bucket=cells.get(key);if(bucket)bucket.push(id);else cells.set(key,[id]);
        }
    });
    grid={segments,cells};roadCache.set(roads,grid);
  }
  const ids=new Set<number>();
  for(let z=Math.floor(minZ/ROAD_CELL);z<=Math.floor(maxZ/ROAD_CELL);z++)for(let x=Math.floor(minX/ROAD_CELL);x<=Math.floor(maxX/ROAD_CELL);x++)
    for(const id of grid.cells.get(x+','+z)??[])ids.add(id);
  return [...ids].map(id=>grid.segments[id]);
}

function nearBox(a: XY,b: XY,c: XY,d: XY,radius:number): boolean {
  return Math.max(a[0],b[0])+radius>=Math.min(c[0],d[0])&&Math.min(a[0],b[0])-radius<=Math.max(c[0],d[0])
    &&Math.max(a[1],b[1])+radius>=Math.min(c[1],d[1])&&Math.min(a[1],b[1])-radius<=Math.max(c[1],d[1]);
}
/** Test every road footprint, so a narrow nearby road cannot hide a wider one. */
export function infrastructureRoadClear(roads: Roads, village: readonly [number, number], p: InfrastructurePart): boolean {
  if (Math.min(p.a[2] - p.baseA, p.b[2] - p.baseB) - p.height / 2 >= 4) return true;
  const a:XY=[p.a[0]-village[0],village[1]-p.a[1]],b:XY=[p.b[0]-village[0],village[1]-p.b[1]];
  return nearbyRoads(roads,Math.min(a[0],b[0])-p.width/2,Math.min(a[1],b[1])-p.width/2,Math.max(a[0],b[0])+p.width/2,Math.max(a[1],b[1])+p.width/2).every(r=>!nearBox(a,b,r.a,r.b,r.half+p.width/2+.6)||segmentDistance(a,b,r.a,r.b)>r.half+p.width/2+.6);
}
/** A road capsule must miss the complete triangle, including its edges and interior. */
export function infrastructureCapClear(roads: Roads,village:readonly [number,number],triangle:readonly Point[]): boolean {
  const pts=triangle.map(p=>[p[0]-village[0],village[1]-p[1]] satisfies XY);
  const contains=(p:XY)=>{const sides=pts.map((a,i)=>cross(a,pts[(i+1)%3],p));return sides.every(s=>s>=0)||sides.every(s=>s<=0);};
  const lo:XY=[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1]))],hi:XY=[Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
  return nearbyRoads(roads,lo[0],lo[1],hi[0],hi[1]).every(r=>!nearBox(lo,hi,r.a,r.b,r.half+.6)||!contains(r.a)&&!contains(r.b)&&pts.every((a,i)=>!nearBox(a,pts[(i+1)%3],r.a,r.b,r.half+.6)||segmentDistance(a,pts[(i+1)%3],r.a,r.b)>r.half+.6));
}

export const INFRASTRUCTURE_COLORS = { concrete: 0x96958b, gallery: 0x707778, steel: 0x767b75, pipe: 0x777d7e, deck: 0x807b6c } as const;

export class PointInfrastructure {
  readonly group = new THREE.Group();
  readonly parts: readonly InfrastructurePart[];
  constructor(features: readonly InfrastructureFeature[], village: readonly [number, number], exag: number, sea: number, roads: Roads) {
    const begun=performance.now();
    this.group.name = 'Point Tupper mapped infrastructure';
    // A point gate (two posts and a bar) is drawn whole or not at all: never a lone post beside a road.
    const all = infrastructureParts(features), clear = all.map(p => infrastructureRoadClear(roads, village, p));
    const pointGates = new Set(features.filter(f => f.kind === 'gate' && f.points.length === 1).map(f => f.id));
    const blocked = new Set(all.filter((p, i) => !clear[i] && pointGates.has(p.id)).map(p => p.id));
    this.parts = all.filter((p, i) => clear[i] && !blocked.has(p.id));
    const world = (p: Point, base = p[2]) => new THREE.Vector3(p[0] - village[0], infrastructureGround(base, exag, sea) + p[2] - base, village[1] - p[1]);
    // Two instance batches, one draw each: every box part (one colour per instance) and every pipe.
    for (const batch of ['boxes', 'pipe'] as const) {
      const parts = this.parts.filter(p => (p.role === 'pipe') === (batch === 'pipe'));
      if (!parts.length) continue;
      const geo = batch === 'pipe' ? new THREE.CylinderGeometry(.5, .5, 1, 8, 1, true).rotateX(Math.PI / 2) : new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: batch === 'pipe' ? INFRASTRUCTURE_COLORS.pipe : 0xffffff, side: batch === 'pipe' ? THREE.DoubleSide : THREE.FrontSide }), parts.length);
      mesh.name = batch;
      if (batch === 'boxes') { const c = new THREE.Color(); parts.forEach((p, i) => mesh.setColorAt(i, c.setHex(INFRASTRUCTURE_COLORS[p.role]))); }
      const transform = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
      parts.forEach((p, i) => {
        const a = world(p.a, p.baseA), b = world(p.b, p.baseB), delta = b.clone().sub(a);
        transform.position.copy(a).add(b).multiplyScalar(.5);
        const direction=delta.clone().normalize();
        const right=Math.abs(direction.y)>.999999 ? new THREE.Vector3(1,0,0) : new THREE.Vector3().crossVectors(up,direction).normalize();
        const vertical=new THREE.Vector3().crossVectors(direction,right).normalize();
        transform.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,vertical,direction));
        transform.scale.set(p.width, p.height, delta.length());
        transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      });
      mesh.computeBoundingSphere(); this.group.add(mesh);
    }
    const positions: number[] = [];
    for (const f of features) {
      if (f.kind !== 'dam' || !f.closed) continue;
      const pts = f.points.slice(0, -1), contour = pts.map(p => new THREE.Vector2(p[0] - village[0], village[1] - p[1]));
      for (const triangle of THREE.ShapeUtils.triangulateShape(contour, [])) {
        if (!infrastructureCapClear(roads,village,triangle.map(index=>pts[index]))) continue;
        for (const index of triangle) { const p = world(pts[index]); positions.push(p.x, p.y + .25, p.z); }
      }
    }
    if (positions.length) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x858477, side: THREE.DoubleSide }));
      mesh.name = 'dam caps'; this.group.add(mesh);
    }
    this.group.userData.buildMs=performance.now()-begun;
  }
}
