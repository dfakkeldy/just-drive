import {qMetres,qHeight,qUnit,metricDistance} from './history-precision';
import type { Road } from '../roads';
import type { StreamFile } from '../streams';
import type { Place } from '../places';
import { MABOU_1884_TRADES, type Trade1884 } from './mabou-1884-trades';
import { JUDIQUE_1884_TRADES } from './judique-1884-trades';
/** Each 1884 area's printed trades. */
export const HISTORY_TRADES: Readonly<Record<string, readonly Trade1884[]>> = Object.freeze({ mabou: MABOU_1884_TRADES, judique: JUDIQUE_1884_TRADES });

export const TRADE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  'Mill': 'MILL', 'Mills': 'MILL', 'P.O.': 'POST OFFICE', 'T. & P.O.': 'TELEGRAPH AND POST OFFICE',
  'School': 'SCHOOL', 'Forge': 'FORGE', 'Saw Mill': 'SAW MILL', 'Shingle Mill': 'SHINGLE MILL',
  'Weaving Mills': 'WEAVING MILLS', 'Shop': 'SHOP', 'Shops': 'SHOP', 'R.C. Ch.': 'CHURCH', 'Church': 'CHURCH',
  'Cheese Factory': 'CHEESE FACTORY', 'Lobster Factory': 'LOBSTER FACTORY', 'Tannery': 'TANNERY',
  'Stage Stables': 'STAGE STABLES', 'Plaster Quarry': 'PLASTER QUARRY',
  'Sh. Mill': 'SHINGLE MILL', 'R.C. Church': 'CHURCH', 'R.C.Ch.': 'CHURCH',
});
export type Zone = 'village' | 'roadside' | 'remote';
export const siteHash = (key: string): number => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
export interface PeriodSite {
  id: string; x: number; z: number; yaw: number; width: number; length: number;
  kind: Trade1884['kind'] | 'farm'; word: string; source: string;
  method: 'road' | 'water' | 'label' | 'farm'; moved: number; zone?: Zone;
  /** Barn offset in the farmhouse local x/z frame. */
  barn?: { x: number; z: number };
  water?: { x: number; z: number; half: number; yaw: number };
}
/** The barn is a second footprint of one unnamed farmstead. */
export function farmBarn(s: PeriodSite): PeriodSite | null {
  if(!s.barn)return null;
  const {x,z}=s.barn,c=Math.cos(s.yaw),a=Math.sin(s.yaw);
  return {...s,id:s.id+'-barn',x:s.x+x*c+z*a,z:s.z-x*a+z*c,width:8,length:12,barn:undefined};
}
interface Segment { ax: number; az: number; bx: number; bz: number; half: number; bridge: boolean }
interface Hit { x: number; z: number; dx: number; dz: number; dist: number; half: number; bridge: boolean }
/** Stable segment order breaks exact ties. The grid makes cold boot independent of total road/stream length. */
class Segments {
  private cells = new Map<string, Segment[]>();
  constructor(segments: Segment[]) {
    for (const s of segments) {
      for (let z = Math.floor(Math.min(s.az, s.bz) / 128); z <= Math.floor(Math.max(s.az, s.bz) / 128); z++)
        for (let x = Math.floor(Math.min(s.ax, s.bx) / 128); x <= Math.floor(Math.max(s.ax, s.bx) / 128); x++) {
          const key = `${x},${z}`, list = this.cells.get(key);
          if (list) list.push(s); else this.cells.set(key, [s]);
        }
    }
  }
  clearRectangle(site:PeriodSite,margin:number):boolean {
    const r=Math.hypot(site.width,site.length)/2+12,seen=new Set<Segment>(),c=qUnit(Math.cos(site.yaw)),a=qUnit(Math.sin(site.yaw));
    for(let z=Math.floor((site.z-r)/128);z<=Math.floor((site.z+r)/128);z++)for(let x=Math.floor((site.x-r)/128);x<=Math.floor((site.x+r)/128);x++)for(const s of this.cells.get(`${x},${z}`)??[]){
      if(seen.has(s))continue;seen.add(s);
      const ax=qMetres((s.ax-site.x)*c-(s.az-site.z)*a),az=qMetres((s.ax-site.x)*a+(s.az-site.z)*c);
      const bx=qMetres((s.bx-site.x)*c-(s.bz-site.z)*a),bz=qMetres((s.bx-site.x)*a+(s.bz-site.z)*c);
      const w=site.width/2+s.half+margin,l=site.length/2+s.half+margin;let lo=0,hi=1;
      const clip=(p:number,d:number,h:number)=>{if(Math.abs(d)<1e-9)return Math.abs(p)<=h;let t0=(-h-p)/d,t1=(h-p)/d;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);return lo<=hi;};
      if(clip(ax,bx-ax,w)&&clip(az,bz-az,l))return false;
    }
    return true;
  }
  near(x: number, z: number, reach: number): Hit | null {
    let best: Hit | null = null;
    const seen = new Set<Segment>();
    for (let cz = Math.floor((z - reach) / 128); cz <= Math.floor((z + reach) / 128); cz++)
      for (let cx = Math.floor((x - reach) / 128); cx <= Math.floor((x + reach) / 128); cx++)
        for (const s of this.cells.get(`${cx},${cz}`) ?? []) {
          if (seen.has(s)) continue; seen.add(s);
          const dx = s.bx - s.ax, dz = s.bz - s.az, len = Math.hypot(dx, dz);
          if (!len) continue;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (len * len)));
          const px = s.ax + t * dx, pz = s.az + t * dz, dist = metricDistance(x - px, z - pz);
          if (dist <= reach && (!best || dist < best.dist)) best = { x: qMetres(px), z: qMetres(pz), dx: qUnit(dx / len), dz: qUnit(dz / len), dist, half: s.half, bridge: s.bridge };
        }
    return best;
  }
}
const dimensions = (kind: PeriodSite['kind']): [number, number] =>
  kind === 'church' ? [8, 15] : kind === 'factory' || kind === 'stables' ? [9, 19] : kind === 'mill' ? [8, 11] : kind === 'quarry' ? [11, 12] : kind === 'farm' ? [7, 9] : [7, 10];
export function siteCorners(s: Pick<PeriodSite, 'x' | 'z' | 'yaw' | 'width' | 'length'>, margin = 0): [number, number][] {
  const c = Math.cos(s.yaw), a = Math.sin(s.yaw), result: [number, number][] = [[s.x, s.z]];
  // Include midpoints too: a small channel can pass between corner samples.
  for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
    const x = u * (s.width / 2 + margin), z = v * (s.length / 2 + margin);
    result.push([s.x + x * c + z * a, s.z - x * a + z * c]);
  }
  return result;
}
export class HistorySiting {
  readonly road: Segments;
  private stream: Segments;
  constructor(roads: readonly Road[], streams: StreamFile | null, origin: readonly [number, number],
    private dry: (x: number, z: number) => boolean,
    private ground: (x: number,z: number,id?:string)=>number|null = () => null,
    _cover: (x:number,z:number)=>number = () => 2,
    private exclusions: readonly {box:readonly [number,number,number,number]}[] = []) {
    this.road = new Segments(roads.filter(r => r.kind >= 1 && r.kind <= 4).flatMap(r => r.pts.slice(1).map((p, i) =>
      ({ ax: r.pts[i][0], az: r.pts[i][1], bx: p[0], bz: p[1], half: r.halfWidth, bridge: r.bridge }))));
    this.stream = new Segments((streams?.streams ?? []).flatMap(s => s.pts.slice(1).map((p, i) =>
      ({ ax: s.pts[i][0] - origin[0], az: origin[1] - s.pts[i][1], bx: p[0] - origin[0], bz: origin[1] - p[1], half: s.half, bridge: false }))));
  }
  safe(s: PeriodSite, occupied: readonly PeriodSite[] = []): boolean {
    const corners=siteCorners(s,2).map(([x,z])=>[qMetres(x),qMetres(z)]),xs=corners.map(p=>p[0]),zs=corners.map(p=>p[1]);
    if(this.exclusions.some(e=>Math.max(...xs)>=e.box[0]&&Math.min(...xs)<=e.box[2]&&Math.max(...zs)>=e.box[1]&&Math.min(...zs)<=e.box[3]))return false;
    // A conservative enclosing disk keeps the whole footprint clear of roads and narrow brooks.
    const radius = qMetres(Math.hypot(s.width, s.length) / 2 + 1);
    const closeMill=s.kind==='mill'&&s.method==='water';
    const waterRadius=radius+(s.kind==='farm'?4:0); // Stay outside the brook's 2.4 m terrain cut and its sampled edge.
    const road = this.road.near(s.x, s.z, radius + 12), water = this.stream.near(s.x, s.z, waterRadius + 12);
    return (!road || road.dist > qMetres(road.half + radius)) && (closeMill?this.stream.clearRectangle(s,.55):!water || water.dist > qMetres(water.half + waterRadius))
      && siteCorners(s, closeMill?.3:2).every(([x, z]) => this.dry(qMetres(x), qMetres(z)))
      && occupied.flatMap(p=>{const barn=farmBarn(p);return barn?[p,barn]:[p];})
        .every(p => metricDistance(p.x - s.x, p.z - s.z) > qMetres(radius + Math.hypot(p.width, p.length) / 2 + 4));
  }
  private grade(site: PeriodSite): number {
    const h=siteCorners(site).map(([x,z])=>this.ground(qMetres(x),qMetres(z),site.id));
    return h.some(v=>v===null)?0:qHeight(Math.max(...h as number[])-Math.min(...h as number[]));
  }
  trades(origin: readonly [number, number],preferred:readonly PeriodSite[]=[],table:readonly Trade1884[]=MABOU_1884_TRADES): PeriodSite[] {
    const result: PeriodSite[] = [];
    for (const trade of table) {
      const prior=preferred.find(s=>s.id===trade.id);if(prior&&this.safe(prior,result)){result.push({...prior});continue;}
      const x = trade.e - origin[0], z = origin[1] - trade.n, [width, length] = trade.kind==='mill'?(trade.word==='Weaving Mills'?[8,16]:trade.word==='Saw Mill'?[7,17]:trade.word==='Shingle Mill'||trade.word==='Sh. Mill'?[6,9]:[6.4,11]):dimensions(trade.kind);
      const site: PeriodSite = { id: trade.id, kind: trade.kind, word: TRADE_WORDS[trade.word], source: trade.source,
        x, z, yaw: 0, width, length, method: 'label', moved: 0 };
      const water = trade.kind === 'mill' ? this.stream.near(x, z, 300) : null;
      const road = this.road.near(x, z, 250);
      const anchor = water ?? road;
      const candidates: PeriodSite[] = [];
      if (anchor) {
        const radius = Math.hypot(width, length) / 2;
        for (const along of [0, -12, 12, -24, 24, -48, 48, -80, 80]) {
          // Follow bends in the actual line. A tangent extrapolation can put a wheel beside an empty ravine.
          const line=water?this.stream:this.road;
          const a=line.near(anchor.x+anchor.dx*along,anchor.z+anchor.dz*along,40)??anchor;
          const nx=-a.dz,nz=a.dx,preferred=(x-a.x)*nx+(z-a.z)*nz>=0?1:-1;
          for(const side of [preferred,-preferred]){
            const setback=water?a.half+width/2+.95:a.half+radius+7,px=a.x+nx*side*setback,pz=a.z+nz*side*setback;
            const yaw=water?Math.atan2(a.dx,a.dz):Math.atan2(-nx*side,-nz*side);
            candidates.push({...site,x:px,z:pz,yaw,method:water?'water':'road',
              ...(water?{water:{x:a.x+nx*side*(a.half+.1),z:a.z+nz*side*(a.half+.1),half:a.half,yaw}}:{})});
          }
        }
        // Roads use the nearest clear setback. Mills can follow the same brook to a gentler bank.
        // Among gentle mill banks use the nearest to the label. No historic parcel is inferred.
        candidates.sort((a,b)=>{
          if(!water)return metricDistance(a.x-x,a.z-z)-metricDistance(b.x-x,b.z-z);
          const ga=this.grade(a),gb=this.grade(b),flatA=ga<=1.2,flatB=gb<=1.2;
          if(flatA!==flatB)return flatA?-1:1;
          if(!flatA&&Math.round(ga*20)!==Math.round(gb*20))return Math.round(ga*20)-Math.round(gb*20);
          return metricDistance(a.x-x,a.z-z)-metricDistance(b.x-x,b.z-z);
        });
      }
      let chosen = candidates.find(c => this.safe(c, result));
      if (!chosen) {
        // Keep an isolated printed label when safe. If its point is wet/occupied, choose the first dry ring point.
        const fallback = [{ ...site }];
        for (let radius = 12; radius <= 300; radius += 12) for (let a = 0; a < 16; a++)
          fallback.push({ ...site, x: x + Math.cos(a * Math.PI / 8) * radius, z: z + Math.sin(a * Math.PI / 8) * radius });
        chosen = fallback.find(c => this.safe(c, result));
      }
      if (!chosen) throw new Error(`No dry site for trade ${trade.id}`);
      chosen.moved = Math.hypot(chosen.x - x, chosen.z - z);
      result.push(chosen);
    }
    return result;
  }

}
export function historyPlaces(sites: readonly PeriodSite[], origin: readonly [number, number], area: 'mabou' | 'judique' = 'mabou'): Place[] {
  const table = HISTORY_TRADES[area] ?? MABOU_1884_TRADES;
  return sites.filter(s => s.kind !== 'farm').map(s => {
    const trade = table.find(t => t.id === s.id)!;
    return { id: s.id, area, kind: 'site', name: s.word, e: origin[0] + s.x, n: origin[1] - s.z,
      note: `The 1884 survey sheet prints "${trade.word}" near here. This building and its exact place are invention.`, sources: [s.source] };
  });
}
