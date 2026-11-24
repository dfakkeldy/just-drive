import {deckWithinReach} from './bridge-contact';
import {GeomHasher,hashStreams,type BakedBridgeDecks,type BakedBridgeSpan} from './bridge-decks';
import * as THREE from 'three';
import type {Road,RoadHit} from './roads';
import type {Terrain} from './terrain';
import type {CellMask} from './road-cuts';
import {BRIDGE_CROSSINGS} from './bridge-crossings';
import {prepareTimberPlans, timberPlan} from './eras/timber-bridge';
import {Mesher, type RGB} from './yard-kit';
import {emitPonyTrussSuperstructure, PONY_TRUSS} from './november-bridges';

const APPROACH_LIGHT_ANCHOR = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';
const APPROACH_LIGHTS_BEGIN = '#include <lights_fragment_begin>';
const APPROACH_DIR_START = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const APPROACH_DIR_END = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
const APPROACH_VERT_PARS = /* glsl */ `
attribute vec4 approach;
varying vec4 vApproach;
varying vec3 vBridgeWorld;
varying vec3 vBridgeNormal;
`;
const APPROACH_VERT_BODY = /* glsl */ `
#include <begin_vertex>
vApproach = approach;
vBridgeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBridgeNormal = normalize(mat3(modelMatrix) * objectNormal);
`;
const APPROACH_FRAG_PARS = /* glsl */ `
uniform vec3 uBridgeSunDir;
uniform vec3 uBridgeSunColor;
uniform vec3 uBridgeSkyColor;
uniform vec3 uBridgeFogColor;
uniform float uBridgeFogDensity;
uniform float uBridgeSeaLevel;
uniform float uBridgeWinterCover;
uniform float uBridgeRainWet;
varying vec4 vApproach;
varying vec3 vBridgeWorld;
varying vec3 vBridgeNormal;
float bridgeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bridgeNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bridgeHash(i), bridgeHash(i + vec2(1.0, 0.0)), f.x),
    mix(bridgeHash(i + vec2(0.0, 1.0)), bridgeHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
const APPROACH_FRAG_COLOR = /* glsl */ `
#include <color_fragment>
if (vApproach.x > 0.5) {
  vec2 bp = vBridgeWorld.xz;
  float bGrit = bridgeNoise(bp * 3.1), bSpeck = bridgeNoise(bp * 23.0);
  vec3 bGravel = mix(vec3(0.200, 0.180, 0.150), vec3(0.300, 0.270, 0.230), bGrit) * (0.8 + 0.4 * bSpeck);
  float bDist = abs(vApproach.y), bHalf = vApproach.z, bKind = vApproach.x;
  vec3 bSurf = bGravel;
  if (bKind > 4.5 && bKind < 5.5) {
    // Rail trail (kind 5): fine crusher dust and worn tracks matching TERRAIN_FRAG.
    vec3 bDust = mix(vec3(0.300, 0.280, 0.240), vec3(0.380, 0.360, 0.315), bGrit) * (0.92 + 0.16 * bSpeck);
    float bWorn = 1.0 - smoothstep(0.15, 0.5, abs(bDist - bHalf * 0.45));
    bSurf = mix(bDust, bDust * 0.88, bWorn);
    float bEdge = bDist + (bridgeNoise(bp * 1.9) - 0.5) * 0.16;
    bSurf = mix(bSurf, bGravel, smoothstep(bHalf - 0.25, bHalf + 0.08, bEdge));
  } else if (bKind > 3.5 && bKind < 4.5) {
    // Dirt track (kind 4): dirt ruts with a grassy centre matching TERRAIN_FRAG.
    float bRut = 1.0 - smoothstep(0.2, 0.45, abs(bDist - 0.75));
    vec3 bGrass = mix(vec3(0.130, 0.120, 0.045), vec3(0.210, 0.180, 0.065), bridgeNoise(bp * 0.06)) * (0.85 + 0.3 * bridgeNoise(bp * 0.9));
    bSurf = mix(mix(bGrass, vec3(0.160, 0.170, 0.060), 0.5), vec3(0.170, 0.130, 0.090) * (0.85 + 0.3 * bSpeck), bRut);
  } else {
    // Gravel road (kind 3) and washboard gravel road (code 6): wheel tracks and optional 0.62 m ridges.
    float bTrack = 1.0 - smoothstep(0.15, 0.55, abs(bDist - bHalf * 0.5));
    bSurf = mix(bGravel, bGravel * 0.72, bTrack);
    if (bKind > 5.5) {
      float bCamDist = length(cameraPosition - vBridgeWorld);
      float bCrest = 0.5 - 0.5 * cos(vApproach.w * 10.134);
      bSurf *= 1.0 - 0.30 * (1.0 - bCrest) * (1.0 - smoothstep(25.0, 90.0, bCamDist));
    }
    bSurf = mix(bSurf, bGravel, smoothstep(bHalf - 0.12, bHalf + 0.18, bDist));
  }
  if (uBridgeWinterCover > 0.0) {
    float bFine = bridgeNoise(bp * 0.9);
    float bMid = 0.6 * bridgeNoise(bp * 0.03) + 0.34 * bridgeNoise(bp * 0.0609 + 11.0);
    float bPloughed = smoothstep(bHalf - 0.58, bHalf + 0.78, bDist + 0.38 * (bFine - 0.5));
    float bHeight = smoothstep(0.25, 2.2, vBridgeWorld.y - uBridgeSeaLevel);
    float bCover = bHeight * bPloughed * mix(0.69, 1.0, smoothstep(0.25, 0.66, bMid));
    vec3 bSnow = mix(vec3(0.50, 0.59, 0.69), vec3(0.85, 0.90, 0.95), bFine * 0.56 + bMid * 0.44);
    bSurf = mix(bSurf, bSnow, bCover * uBridgeWinterCover);
  }
  diffuseColor.rgb = bSurf;
}
`;
const APPROACH_FRAG_LIGHT = /* glsl */ `
${APPROACH_LIGHT_ANCHOR}
if (vApproach.x > 0.5) {
  vec3 bNorm = normalize(vBridgeNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  // Scale only the shadowed directional sun by PI to match TERRAIN_FRAG; local spot/point lamps stay 1x.
  vec3 bDirect = (reflectedLight.directDiffuse - bDirDiffuse) + bDirDiffuse * PI;
  vec3 bIndirect = diffuseColor.rgb * (uBridgeSkyColor * (0.65 + 0.55 * max(bNorm.y, 0.0)) + uBridgeSunColor * vec3(0.060, 0.050, 0.035));
  outgoingLight = bDirect + bIndirect + totalEmissiveRadiance;
  if (uBridgeRainWet > 0.0) {
    float bRoadWet = 1.0 - smoothstep(vApproach.z, vApproach.z + 0.8, abs(vApproach.y));
    outgoingLight *= 1.0 - uBridgeRainWet * mix(0.23, 0.48, bRoadWet);
    vec3 bView = normalize(cameraPosition - vBridgeWorld);
    float bGrazing = 1.0 - clamp(dot(bNorm, bView), 0.0, 1.0);
    outgoingLight += uBridgeSkyColor * uBridgeRainWet * max(bNorm.y, 0.0) * mix(0.025, 0.11, bRoadWet) * bGrazing * bGrazing;
  }
  vec3 bFogV = vBridgeWorld - cameraPosition;
  float bFogDist = length(bFogV);
  float bHmid = max(0.5 * (vBridgeWorld.y + cameraPosition.y), 0.0);
  float bFogF = 1.0 - exp(-bFogDist * uBridgeFogDensity * exp(-bHmid / 900.0));
  float bFogS = max(dot(bFogV / max(bFogDist, 1.0), uBridgeSunDir), 0.0);
  vec3 bHaze = uBridgeFogColor + uBridgeSunColor * 0.12 * pow(bFogS, 5.0);
  outgoingLight = mix(outgoingLight, bHaze, clamp(bFogF, 0.0, 1.0));
}
`;
/** Shade unpaved bridge approaches (gravel roads, tracks, rail trails) with the terrain's own noise and lighting so they
 *  join the road without reading as flat concrete. Decks, rails and paved approaches keep plain vertex colours. */
function applyApproachShader(material:THREE.MeshLambertMaterial,uniforms?:Record<string,THREE.IUniform>):void {
  const zero={value:0};
  const sunDir=uniforms?.sunDir??{value:new THREE.Vector3(0.4,0.7,0.5).normalize()};
  const sunColor=uniforms?.sunColor??{value:new THREE.Color(4,3.6,3.3)};
  const skyColor=uniforms?.skyColor??{value:new THREE.Color(0.3,0.44,0.72)};
  const fogColor=uniforms?.fogColor??{value:new THREE.Color(0.62,0.66,0.72)};
  const fogDensity=uniforms?.fogDensity??zero;
  const seaLevel=uniforms?.seaLevel??zero;
  const winterCover=uniforms?.winterCover??zero;
  const rainWet=uniforms?.rainWet??zero;
  const lightsChunk=THREE.ShaderChunk.lights_fragment_begin;
  const patchedLights=lightsChunk.includes(APPROACH_DIR_START)&&lightsChunk.includes(APPROACH_DIR_END)
    ?lightsChunk
      .replace(APPROACH_DIR_START,'vec3 bDirBefore = reflectedLight.directDiffuse;\n'+APPROACH_DIR_START)
      .replace(APPROACH_DIR_END,'vec3 bDirDiffuse = reflectedLight.directDiffuse - bDirBefore;\n'+APPROACH_DIR_END)
    :null;
  material.onBeforeCompile=shader=>{
    if(!patchedLights||!shader.fragmentShader.includes(APPROACH_LIGHTS_BEGIN)||!shader.fragmentShader.includes(APPROACH_LIGHT_ANCHOR)){
      console.warn('[modern-bridges] the Lambert light sum has moved: unpaved approaches lose terrain lighting');
    }
    shader.uniforms.uBridgeSunDir=sunDir;
    shader.uniforms.uBridgeSunColor=sunColor;
    shader.uniforms.uBridgeSkyColor=skyColor;
    shader.uniforms.uBridgeFogColor=fogColor;
    shader.uniforms.uBridgeFogDensity=fogDensity;
    shader.uniforms.uBridgeSeaLevel=seaLevel;
    shader.uniforms.uBridgeWinterCover=winterCover;
    shader.uniforms.uBridgeRainWet=rainWet;
    shader.vertexShader=APPROACH_VERT_PARS+shader.vertexShader.replace('#include <begin_vertex>',APPROACH_VERT_BODY);
    let frag=APPROACH_FRAG_PARS+shader.fragmentShader.replace('#include <color_fragment>',APPROACH_FRAG_COLOR);
    if(patchedLights)frag=frag.replace(APPROACH_LIGHTS_BEGIN,patchedLights).replace(APPROACH_LIGHT_ANCHOR,APPROACH_FRAG_LIGHT);
    shader.fragmentShader=frag;
  };
  material.customProgramCacheKey=()=>'mmm-modern-bridge-approach-v2';
}

const APPROACH = 16, MAX_APPROACH = 96, CELL = 64, TRI_CELL = 2;
const EMPTY: readonly number[] = [];
// Signed Cantor pairing avoids row-wrap aliases, including raw-UTM fixtures. Wheel queries allocate no strings.
const key = (x:number,z:number,size:number) => {const cx=Math.floor(x/size),cz=Math.floor(z/size),a=cx>=0?2*cx:-2*cx-1,b=cz>=0?2*cz:-2*cz-1;return(a+b)*(a+b+1)/2+b;};
/** The segment of a polyline that holds distance s: the first i whose end cum[i+1] is not below s, else the last
 *  segment (at most `last`). It is a binary search for the old scan `while(i<last&&s>cum[i+1])i++`. cum never
 *  decreases, so `s>cum[i+1]` holds on a prefix; a NaN s fails every test and gives segment 0, as the scan did. */
const segmentAt = (cum:readonly number[],last:number,s:number):number => {let lo=0,hi=last;while(lo<hi){const mid=(lo+hi)>>1;if(s>cum[mid+1])lo=mid+1;else hi=mid;}return lo;};
/** Spans whose deck line comes this close to the camera build each frame (main drew a deck within 1500 m of pts[0]). */
const DRAW = 1500;
/** The lift test points of a solver triangle (build): its centre, then a 4-step barycentric lattice, 3 weights each. */
const CHECKS=(()=>{const w=[1/3,1/3,1/3];for(let a=0;a<=4;a++)for(let b=0;b<=4-a;b++)w.push(a/4,b/4,(4-a-b)/4);return new Float64Array(w);})();
/** Each lattice test point's place in quarter cells from its quad's first corner: row and column in [a,c,b], then
 *  row and column in [b,c,d]. Neighbouring triangles share edge and corner points. */
const CHECK_CELLS=(()=>{const o:number[]=[];for(let a=0;a<=4;a++)for(let b=0;b<=4-a;b++){const c=4-a-b;o.push(b,c,b+c,a+c);}return new Int8Array(o);})();
/** Math.hypot(a,b)>limit and Math.hypot(a,b)<=limit, for lo and hi equal to limit² times 1-1e-9 and 1+1e-9. The
 *  rounding error of a*a+b*b and of Math.hypot is below 1e-15 of the value, so outside lo..hi the answer is already
 *  certain. Math.hypot runs only inside that band, or for NaN, with the same arguments. */
const longer=(a:number,b:number,limit:number,lo:number,hi:number):boolean=>{const q=a*a+b*b;return q>hi||!(q<lo)&&Math.hypot(a,b)>limit;};
const noLonger=(a:number,b:number,limit:number,lo:number,hi:number):boolean=>{const q=a*a+b*b;return q<lo||!(q>hi)&&Math.hypot(a,b)<=limit;};
const STEP=.245,STEP_LO=STEP*STEP*(1-1e-9),STEP_HI=STEP*STEP*(1+1e-9),STEEP=.246,STEEP_LO=STEEP*STEEP*(1-1e-9),STEEP_HI=STEEP*STEEP*(1+1e-9);
/** Whether the grade solver's step for a damping lambda (build) is longer than a limit: Math.hypot(a/d,b/d) of its
 *  old norm closure, as one function instead of a closure per triangle. For d in 1..1e150 it first compares a*a+b*b
 *  with lo*d*d and hi*d*d, which carry a few 1e-16 of rounding like a/d and b/d, so a sure answer skips the
 *  divisions; an overflowed a*a+b*b means a step far over the limit. Otherwise (or NaN) longer() decides. */
const stepLonger=(lambda:number,sum:number,xx:number,xz:number,zz:number,gx:number,gz:number,determinant:number,limit:number,lo:number,hi:number):boolean=>{
  const d=1+lambda*sum+lambda*lambda*determinant,a=(1+lambda*zz)*gx-lambda*xz*gz,b=(1+lambda*xx)*gz-lambda*xz*gx;
  if(d>=1&&d<1e150){const q=a*a+b*b,dd=d*d;if(q>hi*dd)return true;if(q<lo*dd)return false;}
  return longer(a/d,b/d,limit,lo,hi);
};
/** The grade solver's damping for a steep triangle (build): hi after doubling it while the step is longer than .245,
 *  then 26 bisections, or -1 when 32 doublings leave a step longer than .246. A loop that stops on its test has a
 *  step of at most .245 (or NaN), so that second test is false. The first midpoint is often the last hi found too
 *  long (`longest`), whose answer is known. A small function of its own, so the engine can inline stepLonger. */
const stepLength=(sum:number,xx:number,xz:number,zz:number,gx:number,gz:number,determinant:number):number=>{
  let lo=0,hi=1/Math.max(xx,zz,1e-12),longest=NaN;
  for(let n=0;;n++){if(n===32){if(stepLonger(hi,sum,xx,xz,zz,gx,gz,determinant,STEEP,STEEP_LO,STEEP_HI))return -1;break;}if(!stepLonger(hi,sum,xx,xz,zz,gx,gz,determinant,STEP,STEP_LO,STEP_HI))break;longest=hi;hi*=2;}
  for(let n=0;n<26;n++){const mid=(lo+hi)/2;if(n===0&&mid===longest||stepLonger(mid,sum,xx,xz,zz,gx,gz,determinant,STEP,STEP_LO,STEP_HI))lo=mid;else hi=mid;}
  return hi;
};
/** update() holds built decks during a land burst only while the camera stays within HOLD_REACH metres (across the
 *  map) of where the hold began; a single step longer than HOLD_JUMP starts a new hold there (Terrain's BURST_DISTANCE). */
const HOLD_REACH = 30, HOLD_JUMP = 150;
/** True when (x,z) is within `reach` of the polyline. pts[0] comes first with main's own distance formula. */
const nearLine = (pts:readonly (readonly [number,number])[],x:number,z:number,reach:number):boolean => {
  if(Math.hypot(pts[0][0]-x,pts[0][1]-z)<reach)return true;
  for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j],dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz,t=n>0?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/n)):0;
    if(Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<reach)return true;}
  return false;
};
interface BridgeRoad extends Road {inferred?:boolean;sources?:readonly string[];road?:number;sourceRoad?:number}
interface Approach {road:Road;cum:number[];distance:number;direction:number;offsetX:number;offsetZ:number}
interface Span {
  road:BridgeRoad;chainKey:string;geomHash:bigint;hasNearbySpans:boolean;baked:BakedBridgeSpan|null;bakedVerified:boolean;bakedPrevWidth:number;bakedPrevNarrowRail:boolean;bakedPrevStartLength:number;bakedPrevEndLength:number;bakedWashHash:bigint;kinds:readonly number[]; pts:[number,number][]; cum:number[]; length:number; width:number; timber:boolean;
  x0:number;z0:number;x1:number;z1:number; y0:number;y1:number;outer0:number;outer1:number;level:number;revision:number;serial:number;
  skinBox:Float64Array;corridor:Float64Array;probes:Float64Array; triangles:Float32Array|null;triangleDeck:Uint8Array; cells:Map<number,number[]>; geometry:THREE.BufferGeometry|null;approachRanges:Int32Array;members:ReadonlySet<number>;parallel:Span[];narrowRail:boolean;forceBuild:boolean;followed:boolean;startLength:number;endLength:number;smoothStart:boolean;smoothEnd:boolean;extendStart:boolean;extendEnd:boolean;
  /** Half width of each carried road, for a sidewalk reserved on the deck (Roads.bridgeWalks). */
  halves:readonly (readonly [number,number])[];
  /** isSpan's numbers for each segment of pts: a, b-a, its squared length (or 1), its box and that box's margin. */
  segments:Float64Array;
  start?:Approach;end?:Approach;
}

/** One abutment plane per connected span; the rendered triangles are also the wheel surface. */
export class ModernBridges {
  private readonly spans:Span[]=[];
  private readonly cells=new Map<number,number[]>();
  // The existing span lists in row order, so a padded hull query can skip the empty cells outside the map. `spans` holds
  // each span's listed cell rectangle (x0, z0, x1, z1 per span index), for the grid form of the same query.
  private clearanceGrid?: {x:number;z:number;w:number;h:number;members:(readonly number[]|undefined)[];spans:Int32Array};
  private readonly material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  private mesh:THREE.Mesh|null=null;
  /** Road ids whose spans are left out of the drawn mesh (the canal swing span while a vessel passes). */
  private readonly hidden=new Set<number>();
  private readonly driving={kind:9,halfWidth:6,washboard:false,road:true,roadKind:1};
  private sampling=false;
  private bakedLand:Float64Array|null=null;
  private bakedLandAt=0;
  private cachedStreams:unknown=undefined;
  private cachedStreamsHash=0n;
  private manifestTiles:Map<number,Set<string>>|null=null;
  private manifestMaxLevel=0;
  private readonly rejectedBaked=new WeakSet<BakedBridgeSpan>();
  /** Cumulative lengths of each road an approach follows, made once per road. */
  private readonly roadCum=new Map<Road,number[]>();
  private dirty=false;
  ponyDeckVersion=0;
  readonly audit={builds:0,bakedBuilds:0,merges:0,heightTrianglesMax:0};
  private runList:{pts:readonly (readonly [number,number])[];roads:ReadonlySet<number>;halfWidth:number}[]|null=null;
  /** Each span's centre line and the road ids it carries (its members and source road), for traffic that follows a road. */
  get runs():readonly {pts:readonly (readonly [number,number])[];roads:ReadonlySet<number>;halfWidth:number}[] {
    return this.runList??=this.spans.map(r=>({pts:r.pts,roads:new Set(r.road.sourceRoad===undefined?r.members:[...r.members,r.road.sourceRoad]),halfWidth:r.width}));
  }

  constructor(roads:readonly Road[],private terrain:Terrain,private group:THREE.Group,bakedSpans?:readonly BridgeRoad[],private nearest?:(x:number,z:number,reach:number,filter:(r:Road)=>boolean)=>RoadHit|null,private walks?:ReadonlyMap<number,{side:number;width:number}>,private bakedDecks?:BakedBridgeDecks|null){
    applyApproachShader(this.material,(terrain as {uniforms?:Record<string,THREE.IUniform>}).uniforms);
    const all:BridgeRoad[]=[...roads],m=terrain.manifest;
    if(m&&bakedSpans)for(const r of bakedSpans)all.push({...r,sourceRoad:r.road,pts:r.pts.map(([e,n]):[number,number]=>[e-m.village[0],m.village[1]-n])});
    const bakedSources=new Set(bakedSpans?.flatMap(r=>r.sources??[])??[]);
    if(m){
      // Bridge roads by kind for the cover test. A crossing added below joins its list, so it covers later crossings.
      const decks=new Map<number,BridgeRoad[]>(),deck=(r:BridgeRoad)=>{let list=decks.get(r.kind);if(!list)decks.set(r.kind,list=[]);list.push(r);};
      for(const r of all)if(r.bridge)deck(r);
      for(let i=0;i<BRIDGE_CROSSINGS.length;i++){
        const c=BRIDGE_CROSSINGS[i];if(c.area!==(m.area?.id??'mabou'))continue;
        if(c.sources.every(source=>bakedSources.has(source)))continue;
        const pts=c.pts.map(([e,n]):[number,number]=>[e-m.village[0],m.village[1]-n]),same=decks.get(c.kind);
        // A future corrected bake wins. Do not lay a duplicate deck over an already flagged span.
        let covered=0;
        if(same)for(const p of pts)if(same.some(r=>{for(let j=1;j<r.pts.length;j++){
          const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
          if(Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)<2)return true;
        }return false;}))covered++;
        if(covered>=pts.length*.8)continue;
        const crossing:BridgeRoad={id:-100000-i,name:c.name,kind:c.kind,halfWidth:c.halfWidth,bridge:true,pts,inferred:c.inferred,sourceRoad:c.road};
        all.push(crossing);deck(crossing);
      }
    }
    // Survey records change from track to rail-trail at some internal joins. They still share one deck.
    const connectivity=all.map(r=>({...r,kind:r.name==='Railroad'?6:r.kind<=3?1:4}));
    // Plans join only bridge roads, in array order, so the bridge records alone give the same plans. The plans are
    // keyed by array identity: both calls take this one array. timberPlan reads only the road's id.
    const spanRoads=connectivity.filter(r=>r.bridge);
    prepareTimberPlans(spanRoads);const seen=new Set<string>();
    // Indices into `all` by road id, so a span collects its carried roads in `all` order without a full scan.
    const byId=new Map<number,number[]>();for(let i=0;i<all.length;i++){let list=byId.get(all[i].id);if(!list)byId.set(all[i].id,list=[]);list.push(i);}
    for(const road of all){
      if(!road.bridge)continue;const plan=timberPlan(road,spanRoads);if(seen.has(plan.chainKey))continue;seen.add(plan.chainKey);
      const pts=plan.path,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
      const length=cum[cum.length-1];if(length<.01)continue;
      const members=new Set(plan.chainKey.split(',').map(Number));
      const found:number[]=[];for(const id of members){const list=byId.get(id);if(list)found.push(...list);}
      const carried=found.sort((a,b)=>a-b).map(i=>all[i]);
      const width=Math.max(...carried.map(r=>r.halfWidth))+.45;
      const timber=road.kind>=4||road.name==='Railroad'||carried.some(r=>r.inferred);
      const segments=new Float64Array((pts.length-1)*10);
      for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j],dx=b[0]-a[0],dz=b[1]-a[1];segments.set([a[0],a[1],dx,dz,dx*dx+dz*dz||1,Math.min(a[0],b[0]),Math.max(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[1],b[1]),.01+2e-7*(Math.abs(dx)+Math.abs(dz))],(j-1)*10);}
      const r:Span={road,chainKey:plan.chainKey,geomHash:0n,hasNearbySpans:false,baked:null,bakedVerified:false,bakedPrevWidth:width,bakedPrevNarrowRail:false,bakedPrevStartLength:16,bakedPrevEndLength:16,bakedWashHash:0n,members,segments,halves:carried.map(r=>[r.id,r.halfWidth] as const),parallel:[],narrowRail:false,forceBuild:false,followed:false,startLength:16,endLength:16,smoothStart:false,smoothEnd:false,extendStart:false,extendEnd:false,kinds:[...new Set(carried.map(r=>r.kind))],pts,cum,length,width,timber,x0:Infinity,z0:Infinity,x1:-Infinity,z1:-Infinity,y0:0,y1:0,outer0:0,outer1:0,level:-1,revision:-1,serial:0,skinBox:new Float64Array([Infinity,Infinity,-Infinity,-Infinity]),corridor:new Float64Array(),probes:new Float64Array(),triangles:null,triangleDeck:new Uint8Array(),cells:new Map(),geometry:null,approachRanges:new Int32Array()};
      r.start=this.approach(r,false);r.end=this.approach(r,true);
      const corridor:number[]=[];for(let s=-APPROACH;s<length+APPROACH;s+=4){const a=this.at(r,s),b=this.at(r,Math.min(s+4,length+APPROACH));corridor.push(a.x,a.z,b.x,b.z);}r.corridor=new Float64Array(corridor);
      const probes:number[]=[];
      for(let s=-MAX_APPROACH;s<length+MAX_APPROACH+8;s+=8){const p=this.at(r,Math.min(s,length+MAX_APPROACH));for(const u of[-width,0,width]){
        const x=p.x+p.nx*u,z=p.z+p.nz*u;probes.push(x,z,NaN);r.x0=Math.min(r.x0,x);r.z0=Math.min(r.z0,z);r.x1=Math.max(r.x1,x);r.z1=Math.max(r.z1,z);
      }}
      r.probes=new Float64Array(probes);const index=this.spans.push(r)-1;
      for(const p of pts){r.x0=Math.min(r.x0,p[0]-width);r.z0=Math.min(r.z0,p[1]-width);r.x1=Math.max(r.x1,p[0]+width);r.z1=Math.max(r.z1,p[1]+width);}
      r.x0-=6;r.z0-=6;r.x1+=6;r.z1+=6;
      for(const x of[r.x0,r.x1])for(const z of[r.z0,r.z1])if(!Number.isSafeInteger(key(x,z,TRI_CELL)))throw new RangeError('Bridge grid exceeds exact numeric cell range');
      for(let z=Math.floor(r.z0/CELL);z<=Math.floor(r.z1/CELL);z++)for(let x=Math.floor(r.x0/CELL);x<=Math.floor(r.x1/CELL);x++){
        const k=key(x*CELL,z*CELL,CELL);let list=this.cells.get(k);if(!list)this.cells.set(k,list=[]);list.push(index);
      }
    }
    // A single railway and a roadway can share a canal crossing. Their schematic road widths
    // must not form overlapping driving surfaces. Grade-separated crossings remain full width.
    for(let i=0;i<this.spans.length;i++)for(let j=i+1;j<this.spans.length;j++){
      const a=this.spans[i],b=this.spans[j];if((a.road.name==='Railroad')===(b.road.name==='Railroad'))continue;
      const rail=a.road.name==='Railroad'?a:b,other=rail===a?b:a;let parallel=0,total=0;
      for(let d=0;d<=rail.length;d+=8){total++;const p=this.at(rail,d);
        for(let k=1;k<other.pts.length;k++){const q=other.pts[k-1],v=other.pts[k],dx=v[0]-q[0],dz=v[1]-q[1],n=Math.hypot(dx,dz)||1,t=((p.x-q[0])*dx+(p.z-q[1])*dz)/(n*n);
          if(t<0||t>1||Math.abs(dx*p.nz-dz*p.nx)/n<.95)continue;
          if(Math.hypot(p.x-q[0]-dx*t,p.z-q[1]-dz*t)<rail.width+other.width+.5){parallel++;break;}
        }
      }if(parallel>=3&&parallel>=total*.5){a.parallel.push(b);b.parallel.push(a);}
    }
    for(const r of this.spans)r.geomHash=this.spanGeomHash(r);
    if(this.spans.length){
      const mask=this.mask();
      terrain.sites?.push({mask,box:[Math.min(...this.spans.map(r=>r.x0)),Math.min(...this.spans.map(r=>r.z0)),Math.max(...this.spans.map(r=>r.x1)),Math.max(...this.spans.map(r=>r.z1))],
        sitingBoxes:this.spans.map(r=>[r.x0,r.z0,r.x1,r.z1] as const),
        roadField:false,samplesTerrain:false,height:(_x,_z,h)=>h,surface:()=>null,deckDriving:this.driving,deckMask:(x,z,kind)=>this.maskPaint(x,z,kind),deckClear:(x,z,pad)=>this.clearCorridor(x,z,pad),deckClearGrid:(xs,zs,pad)=>this.clearGrid(xs,zs,pad),roadBedHeight:(x,z)=>this.roadBedHeight(x,z),roadCutHeight:(x,z)=>this.query(x,z,true,false,undefined,false,0,false),roadCutRevision:(x0,z0,x1,z1)=>this.cutRevision(x0,z0,x1,z1),roadCutTriangles:(x0,z0,x1,z1)=>this.cutTriangles(x0,z0,x1,z1),deckContactHeight:(x,z,referenceY)=>this.contactHeightAt(x,z,referenceY)});
    }
  }

  overlaps(x:number,z:number,pad=0):boolean{return this.clearCorridor(x,z,pad);}
  private maskPaint(x:number,z:number,kind:number):boolean {
    if(!this.isSpan(x,z,kind))return false;
    const list=this.cells.get(key(x,z,CELL));
    if(list)for(const index of list){const r=this.spans[index];
      const lower=this.nearest?.(x,z,12,road=>!road.bridge&&!r.members.has(road.id)&&r.road.sourceRoad!==road.id);
      if(!lower||lower.dist>lower.road.halfWidth+1.9)continue;
      for(let j=1;j<r.pts.length;j++){const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
        if(Math.abs(dx*Math.cos(lower.heading)+dz*Math.sin(lower.heading))/len>.2)return false;
      }
    }
    return true;
  }

  /** The 64 m cells of the span grid: outside them query() and isSpan() are null or false, and so are the deck and
   *  contact callbacks the site builds on them. (overlaps() and the deckClear and deckClearGrid callbacks also scan
   *  neighbouring cells within their pad, so they can be true just outside; nothing gates them on the mask.) */
  private mask():CellMask {
    let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
    for(const r of this.spans){x0=Math.min(x0,Math.floor(r.x0/CELL));z0=Math.min(z0,Math.floor(r.z0/CELL));x1=Math.max(x1,Math.floor(r.x1/CELL));z1=Math.max(z1,Math.floor(r.z1/CELL));}
    const w=x1-x0+1,h=z1-z0+1,bits=new Uint8Array(w*h),members=new Array<readonly number[]|undefined>(w*h),spans=new Int32Array(this.spans.length*4);
    for(let s=0;s<this.spans.length;s++){const r=this.spans[s];spans.set([Math.floor(r.x0/CELL),Math.floor(r.z0/CELL),Math.floor(r.x1/CELL),Math.floor(r.z1/CELL)],s*4);}
    for(const r of this.spans)for(let z=Math.floor(r.z0/CELL);z<=Math.floor(r.z1/CELL);z++)for(let x=Math.floor(r.x0/CELL);x<=Math.floor(r.x1/CELL);x++){
      const i=(z-z0)*w+x-x0;
      if(bits[i]===1)continue;
      bits[i]=1;
      members[i]=this.cells.get(key(x*CELL,z*CELL,CELL));
    }
    this.clearanceGrid={x:x0,z:z0,w,h,members,spans};
    return {x0:x0*CELL,z0:z0*CELL,size:CELL,w,h,bits};
  }
  /** Footprint only: safe while terrain tiles are being decoded, before deck heights exist. */
  private isSpan(x:number,z:number,kind:number):boolean {
    const list=this.cells.get(key(x,z,CELL));if(!list)return false;
    for(const index of list){const r=this.spans[index];if(kind>=0&&!r.kinds.includes(kind))continue;const g=r.segments,reach=r.width+.0001;for(let k=0;k<g.length;k+=10){
      // A point outside the segment's box grown by the reach and a margin is farther than the reach: within t's
      // 1e-7 slack the foot stays 2e-7 of the length inside the box, and rounding here is far below 1 cm. Then
      // |x-a-dx*t| or |z-a-dz*t| is above the reach, and so is Math.hypot. A NaN point is never skipped.
      const e=reach+g[k+9];if(x>g[k+6]+e||x<g[k+5]-e||z>g[k+8]+e||z<g[k+7]-e)continue;
      const ax=g[k],az=g[k+1],dx=g[k+2],dz=g[k+3],t=((x-ax)*dx+(z-az)*dz)/g[k+4];
      if(t>=-1e-7&&t<=1.0000001&&Math.hypot(x-ax-dx*t,z-az-dz*t)<=reach)return true;
    }}return false;
  }

  /** Only the averaged tree hull is cleared. Bare-earth heights and the water below stay untouched. */
  private clearCorridor(x:number,z:number,pad:number):boolean {
    const grid=this.clearanceGrid;
    if(!grid)return false;
    const x0=Math.max(0,Math.floor((x-pad)/CELL)-grid.x),x1=Math.min(grid.w-1,Math.floor((x+pad)/CELL)-grid.x);
    const z0=Math.max(0,Math.floor((z-pad)/CELL)-grid.z),z1=Math.min(grid.h-1,Math.floor((z+pad)/CELL)-grid.z);
    if(x0>x1||z0>z1)return false;
    for(let cz=z0;cz<=z1;cz++)for(let cx=x0;cx<=x1;cx++){
      const list=grid.members[cz*grid.w+cx];if(!list)continue;
      for(const index of list){const r=this.spans[index];
        const c=r.corridor,reach=Math.max(r.width,r.road.halfWidth+.45)+pad;
        for(let i=0;i<c.length;i+=4){
          const ax=c[i],az=c[i+1],dx=c[i+2]-ax,dz=c[i+3]-az,px=x-ax,pz=z-az;
          // Reject points outside the expanded segment box before projecting onto the segment.
          if(px-Math.max(0,dx)>reach||Math.min(0,dx)-px>reach||pz-Math.max(0,dz)>reach||Math.min(0,dz)-pz>reach)continue;
          const n=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,(px*dx+pz*dz)/n));
          if(Math.hypot(px-dx*t,pz-dz*t)<=reach)return true;
        }
      }
    }return false;
  }
  /** clearCorridor at every point of a grid (Site.deckClearGrid: xs and zs ascending), or null when it is false at all of
   *  them. clearCorridor reads a span only from the cells listed for it, so a point can match a span only when its padded
   *  cell range meets the span's cell rectangle. Each corridor piece visits only the points inside its reach box, and
   *  each point keeps clearCorridor's own tests, on the live corridor and width. */
  private clearGrid(xs:Float64Array,zs:Float64Array,pad:number):Uint8Array|null {
    const grid=this.clearanceGrid,nx=xs.length,nz=zs.length;
    if(!grid||!nx||!nz)return null;
    // Each point's padded cell range, as clearCorridor computes it (before its clamp to the map, which holds every span).
    const lx=new Float64Array(nx),hx=new Float64Array(nx),lz=new Float64Array(nz),hz=new Float64Array(nz);
    for(let a=0;a<nx;a++){lx[a]=Math.floor((xs[a]-pad)/CELL);hx[a]=Math.floor((xs[a]+pad)/CELL);}
    for(let b=0;b<nz;b++){lz[b]=Math.floor((zs[b]-pad)/CELL);hz[b]=Math.floor((zs[b]+pad)/CELL);}
    // First index whose coordinate is at least v. The slack keeps every point the box test could accept.
    const first=(v:Float64Array,at:number)=>{let lo=0,hi=v.length;while(lo<hi){const m=(lo+hi)>>1;if(v[m]<at)lo=m+1;else hi=m;}return lo;};
    const slack=1e-3;let out:Uint8Array|null=null;
    for(let s=0;s<this.spans.length;s++){
      const cx0=grid.spans[s*4],cz0=grid.spans[s*4+1],cx1=grid.spans[s*4+2],cz1=grid.spans[s*4+3];
      if(lx[0]>cx1||hx[nx-1]<cx0||lz[0]>cz1||hz[nz-1]<cz0)continue;
      const r=this.spans[s],c=r.corridor,reach=Math.max(r.width,r.road.halfWidth+.45)+pad;
      for(let i=0;i<c.length;i+=4){
        const ax=c[i],az=c[i+1],dx=c[i+2]-ax,dz=c[i+3]-az;
        const a0=first(xs,ax+Math.min(0,dx)-reach-slack),a1=first(xs,ax+Math.max(0,dx)+reach+slack)-1;
        const b0=first(zs,az+Math.min(0,dz)-reach-slack),b1=first(zs,az+Math.max(0,dz)+reach+slack)-1;
        for(let b=b0;b<=b1;b++){
          if(lz[b]>cz1||hz[b]<cz0)continue;
          const pz=zs[b]-az;
          for(let a=a0;a<=a1;a++){
            if(out?.[b*nx+a]||lx[a]>cx1||hx[a]<cx0)continue;
            const px=xs[a]-ax;
            if(px-Math.max(0,dx)>reach||Math.min(0,dx)-px>reach||pz-Math.max(0,dz)>reach||Math.min(0,dz)-pz>reach)continue;
            const n=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,(px*dx+pz*dz)/n));
            if(Math.hypot(px-dx*t,pz-dz*t)<=reach)(out??=new Uint8Array(nx*nz))[b*nx+a]=1;
          }
        }
      }
    }
    return out;
  }

  private approach(r:Span,end:boolean):Approach|undefined {
    if(!this.nearest)return;
    const p=r.pts[end?r.pts.length-1:0],q=r.pts[end?r.pts.length-2:1],dx=p[0]-q[0],dz=p[1]-q[1];
    const eligible=(road:Road)=>!road.bridge&&(road.name==='Railroad')===(r.road.name==='Railroad')&&(road.kind<=3)===(r.road.kind<=3);
    const hit=(r.road.sourceRoad===undefined?null:this.nearest(p[0],p[1],2,road=>eligible(road)&&road.id===r.road.sourceRoad))??(r.road.name?this.nearest(p[0],p[1],2,road=>eligible(road)&&road.name===r.road.name):null)??this.nearest(p[0],p[1],2,eligible);
    if(!hit)return;
    const a=hit.road.pts[hit.seg],b=hit.road.pts[hit.seg+1],sx=b[0]-a[0],sz=b[1]-a[1],dot=dx*sx+dz*sz;
    if(Math.abs(dot)<Math.hypot(dx,dz)*Math.hypot(sx,sz)*.35)return;
    // Spans that meet the same road share one length table (in Mabou, 98 approaches follow 54 roads).
    let cum=this.roadCum.get(hit.road);
    if(!cum){cum=[0];for(let i=1;i<hit.road.pts.length;i++)cum.push(cum[i-1]+Math.hypot(hit.road.pts[i][0]-hit.road.pts[i-1][0],hit.road.pts[i][1]-hit.road.pts[i-1][1]));this.roadCum.set(hit.road,cum);}
    return{road:hit.road,cum,distance:cum[hit.seg]+(cum[hit.seg+1]-cum[hit.seg])*hit.t,direction:Math.sign(dot),offsetX:p[0]-hit.x,offsetZ:p[1]-hit.z};
  }

  private at(r:Span,s:number):{x:number;z:number;nx:number;nz:number;yaw:number}{
    const approach=s<0?r.start:s>r.length?r.end:undefined;
    if(approach){
      const d=s<0?-s:s-r.length,along=approach.distance+approach.direction*d,p=approach.road.pts,cum=approach.cum;
      const i=segmentAt(cum,p.length-2,along);
      const a=p[i],b=p[i+1],n=cum[i+1]-cum[i]||1,t=(along-cum[i])/n,sign=approach.direction*(s<0?-1:1),dx=(b[0]-a[0])/n*sign,dz=(b[1]-a[1])/n*sign;
      const u=Math.min(1,d/(s<0?r.startLength:r.endLength)),blend=1-u*u*(3-2*u);
      const edge=s<0?0:r.pts.length-2,ca=r.pts[edge],cb=r.pts[edge+1],cn=Math.hypot(cb[0]-ca[0],cb[1]-ca[1])||1,turn=Math.min(1,d/4);
      const tx=(cb[0]-ca[0])/cn*(1-turn)+dx*turn,tz=(cb[1]-ca[1])/cn*(1-turn)+dz*turn,tn=Math.hypot(tx,tz)||1;
      return{x:a[0]+(b[0]-a[0])*t+approach.offsetX*blend,z:a[1]+(b[1]-a[1])*t+approach.offsetZ*blend,nx:-tz/tn,nz:tx/tn,yaw:Math.atan2(tx,tz)};
    }
    const i=segmentAt(r.cum,r.pts.length-2,s);
    const a=r.pts[i],b=r.pts[i+1],n=r.cum[i+1]-r.cum[i]||1,t=(s-r.cum[i])/n,dx=(b[0]-a[0])/n,dz=(b[1]-a[1])/n;
    return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,nx:-dz,nz:dx,yaw:Math.atan2(dx,dz)};
  }
  private land(x:number,z:number):number|null {
    if(this.bakedLand){
      if(this.bakedLandAt>=this.bakedLand.length)throw new RangeError('Baked bridge land table exhausted');
      const v=this.bakedLand[this.bakedLandAt++];return v===v?v:null;
    }
    // withDeck calls back here. During construction this one site is excluded, and contact scopes are cleared.
    return this.terrain.constructionHeightAt?this.terrain.constructionHeightAt(x,z):this.terrain.heightAt(x,z);
  }
  private curveData(r:Span,end:boolean,length:number,side=0):number[] {
    const bank=this.at(r,end?r.length:0),toe=this.at(r,end?r.length+length:-length),width=this.widthAt(r,end?r.length+length:-length);
    const a=this.land(toe.x+toe.nx*side*width,toe.z+toe.nz*side*width)??this.terrain.seaLevel;
    const b=Math.max(end?r.y1:r.y0,(this.land(bank.x+bank.nx*side*r.width,bank.z+bank.nz*side*r.width)??-Infinity)+.05);
    const before=this.at(r,end?r.length+length-1:-length-1),after=this.at(r,end?r.length+length+1:-length+1);
    const slope=((this.land(after.x+after.nx*side*width,after.z+after.nz*side*width)??a)-(this.land(before.x+before.nx*side*width,before.z+before.nz*side*width)??a))/2;
    const m=Math.max(-.079,Math.min(.079,slope)),n=0,y0=end?b:a,y1=end?a:b,m0=end?n:m,m1=end?m:n;
    const transition=Math.min(12,length/3),middle=(y1-y0-transition*(m0+m1)/2)/(length-transition);
    return [y0,y1,m0,m1,transition,middle,length];
  }
  private curveValue(c:readonly number[],t:number):number {
    const [y0,,m0,m1,run,m,length]=c,d=t*length;
    const integral=(u:number)=>u*u*u-.5*u*u*u*u;
    if(d<run){const u=d/run;return y0+m0*d+(m-m0)*run*integral(u);}
    const first=y0+run*(m0+m)/2;
    if(d<=length-run)return first+m*(d-run);
    const e=d-(length-run),u=e/run;return first+m*(length-2*run)+m*e+(m1-m)*run*integral(u);
  }
  private curve(r:Span,end:boolean,length:number,t:number,side=0):number {
    return this.curveValue(this.curveData(r,end,length,side),t);
  }
  private toeLength(r:Span,end:boolean,minimum=16):number {
    const columns=Math.ceil(2*r.width/.75),smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;let best=minimum,bestGrade=Infinity;
    if(end)r.smoothEnd=false;else r.smoothStart=false;
    for(let length=minimum;length<=MAX_APPROACH;length++){
      const p=this.at(r,end?r.length+length:-length),width=this.widthAt(r,end?r.length+length:-length);let grade=0,previous:number|null=null;
      for(let j=0;j<=columns;j++){const u=-width+2*width*j/columns,h=this.land(p.x+p.nx*u,p.z+p.nz*u);if(h===null){grade=Infinity;break;}if(Math.abs(u)<=width-.25){if(previous!==null)grade=Math.max(grade,Math.abs(h-previous)/(2*width/columns));previous=h;}else previous=null;}
      if(grade<bestGrade){bestGrade=grade;best=length;}
      if(grade>=.243)continue;
      if(smooth){const c=this.curveData(r,end,length),value=(t:number)=>this.curveValue(c,t),lo=Math.min(value(0),value(1)),hi=Math.max(value(0),value(1));let valid=Math.max(Math.abs(c[2]),Math.abs(c[3]),Math.abs(c[5]))<=.0795&&1.5*Math.max(Math.abs(c[5]-c[2]),Math.abs(c[3]-c[5]))/c[4]<=.011;
        for(let k=0;k<=20;k++){const h=value(k/20);if(h<lo-.02||h>hi+.02)valid=false;}
        if(!valid)continue;if(end)r.smoothEnd=true;else r.smoothStart=true;
      }return length;
    }return best;
  }
  private prepareCorridor(r:Span):void {
    const path:number[]=[];
    for(let s=-r.startLength;s<r.length+r.endLength;s+=4){const a=this.at(r,s),b=this.at(r,Math.min(s+4,r.length+r.endLength));path.push(a.x,a.z,b.x,b.z);}
    r.corridor=new Float64Array(path);
  }
  private widthAt(r:Span,s:number):number {
    if(r.narrowRail)return 1.25;
    const half=s<0?(r.start?.road.halfWidth??r.road.halfWidth):(r.end?.road.halfWidth??r.road.halfWidth),blend=Math.min(1,Math.max(0,s<0?-s:s-r.length)/4);
    return r.width+(half-r.width)*blend;
  }
  private top(r:Span,along:number,x:number,z:number):number {
    if(r.triangles){const h=this.ownHeight(r,x,z);if(h!==null)return h;}
    if(along>=0&&along<=r.length){const t=along/r.length,smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;return r.y0+(r.y1-r.y0)*(smooth?t*t*(3-2*t):t);}
    if(along<0?r.smoothStart:r.smoothEnd){const end=along>r.length,length=end?r.endLength:r.startLength,p=this.at(r,along),width=this.widthAt(r,along),side=((x-p.x)*p.nx+(z-p.z)*p.nz)/width;return this.curve(r,end,length,end?(along-r.length)/length:(along+length)/length,side);}
    const d=along<0?-along:along-r.length,t=Math.max(0,Math.min(1,1-d/(along<0?r.startLength:r.endLength))),blend=t*t*(3-2*t),land=this.land(x,z)??this.terrain.seaLevel,bank=along<0?r.y0:r.y1;
    return land+(Math.max(land,bank)-land)*blend;
  }

  /** Fingerprint the span's centreline, carried road kinds/widths, attached approaches, and every neighbouring span
   *  sharing any 64 m cell (both parallel crossings and perpendicular/overlapping footprints) so a stale bake is never reused. */
  private spanGeomHash(r:Span):bigint {
    const h=new GeomHasher();
    h.num(r.road.kind);h.num(r.road.halfWidth);h.num(r.timber?1:0);h.num(r.pts.length);
    for(const p of r.pts){h.num(p[0]);h.num(p[1]);}
    for(const ap of[r.start,r.end]){
      if(!ap){h.num(-1);continue;}
      h.num(1);h.num(ap.distance);h.num(ap.direction);h.num(ap.offsetX);h.num(ap.offsetZ);
      h.num(ap.road.kind);h.num(ap.road.halfWidth);h.num(ap.road.pts.length);
      for(const p of ap.road.pts){h.num(p[0]);h.num(p[1]);}
    }
    const nearby=new Set<Span>();
    for(let z=Math.floor(r.z0/CELL);z<=Math.floor(r.z1/CELL);z++)for(let x=Math.floor(r.x0/CELL);x<=Math.floor(r.x1/CELL);x++){
      const list=this.cells.get(key(x*CELL,z*CELL,CELL));
      if(list)for(const idx of list){const o=this.spans[idx];if(o!==r)nearby.add(o);}
    }
    for(const q of r.parallel)nearby.add(q);
    r.hasNearbySpans=nearby.size>0;
    const others=[...nearby].sort((a,b)=>a.chainKey<b.chainKey?-1:a.chainKey>b.chainKey?1:0);
    h.num(others.length);
    for(const o of others){
      h.num(o.road.kind);h.num(o.road.halfWidth);h.num(o.width);h.num(o.road.name==='Railroad'?1:0);h.num(r.parallel.includes(o)?1:0);h.num(o.pts.length);
      for(const p of o.pts){h.num(p[0]);h.num(p[1]);}
    }
    return h.done();
  }

  private terrainStreamsHash():bigint {
    const s=this.terrain.streams;
    if(s!==this.cachedStreams){this.cachedStreams=s;this.cachedStreamsHash=hashStreams(s);}
    return this.cachedStreamsHash;
  }

  private probesChanged(r:Span,touch:boolean):boolean {
    if(!this.terrain.meshContactSource)return true;
    let changed=false;
    for(let i=0;i<r.probes.length;i+=3){
      const source=this.terrain.meshContactSource(r.probes[i],r.probes[i+1],true,touch);
      if(source!==r.probes[i+2]){changed=true;r.probes[i+2]=source;}
    }
    return changed;
  }

  private probeTargetLevel(x:number,z:number,fallbackLevel:number):number {
    const m=this.terrain.manifest;
    if(!m?.levels)return fallbackLevel;
    if(!this.manifestTiles){
      this.manifestTiles=new Map();
      let maxLv=0;
      for(const [k,list]of Object.entries(m.levels)){
        const lv=Number(k);
        if(list.length){this.manifestTiles.set(lv,new Set(list));if(lv>maxLv)maxLv=lv;}
      }
      this.manifestMaxLevel=maxLv;
    }
    const top=Math.max(this.manifestMaxLevel,fallbackLevel);
    for(let lv=top;lv>=0;lv--){
      const set=this.manifestTiles.get(lv);if(!set)continue;
      const size=m.size/2**lv,i=Math.floor((x+m.village[0]-m.origin[0])/size),j=Math.floor((z-m.village[1]+m.origin[1])/size);
      if(set.has(`${i}_${j}`))return lv;
    }
    return fallbackLevel;
  }

  /** Fingerprint live ground heights across every solver/emitter terrain input (full grid vertices, solver triangle
   *  interior CHECKS lattice & centroids, 0.5 m clearance line, toe slopes, fallback toeLength candidates out to
   *  MAX_APPROACH, piers and parallel crossing banks) once every probe reaches its finest manifest tile level. */
  private spanLandHash(r:Span,startLength:number,endLength:number,finalWidth:number,narrowRail:boolean,smoothStart:boolean,smoothEnd:boolean,y0:number,y1:number,fallbackLevel:number):bigint|null {
    const prevS=r.startLength,prevE=r.endLength,prevW=r.width,prevNR=r.narrowRail,prevSampling=this.sampling,prevBakedLand=this.bakedLand;
    r.startLength=startLength;r.endLength=endLength;r.width=finalWidth;r.narrowRail=narrowRail;this.sampling=true;this.bakedLand=null;
    try{
      const h=new GeomHasher(),len=r.length,coreRows=Math.ceil(len),rows=coreRows+startLength+endLength,columns=Math.ceil(2*finalWidth/.75);
      const along=(i:number)=>i<=startLength?i-startLength:i<=startLength+coreRows?len*(i-startLength)/coreRows:len+i-startLength-coreRows;
      const sample=(x:number,z:number):boolean=>{
        const surf=this.terrain.surfaceAt(x,z);
        if(!surf||surf.level<this.probeTargetLevel(x,z,fallbackLevel))return false;
        const y=this.land(x,z);
        h.num(y===null?0:1);h.num(y??0);
        return true;
      };
      // When approach length grew past APPROACH (16 m), sample pre-extension bank/outer stations AND any offset-approach
      // toeLength() candidates (16..startLength/endLength) in the APPROACH coordinate frame used before extension.
      if(startLength!==APPROACH||endLength!==APPROACH){
        r.startLength=APPROACH;r.endLength=APPROACH;
        for(const s of[0,-3,-6,-8,-APPROACH,len,len+3,len+6,len+8,len+APPROACH]){const p=this.at(r,s);if(!sample(p.x,p.z))return null;}
        for(const [end,sLen]of[[false,startLength],[true,endLength]]as const){
          if(sLen===APPROACH)continue;
          const ap=end?r.end:r.start;
          if(!ap||ap.offsetX===0&&ap.offsetZ===0)continue;
          for(let L=APPROACH;L<=sLen;L++){
            const q=this.at(r,end?len+L:-L),w=this.widthAt(r,end?len+L:-L);
            for(let j=0;j<=columns;j++){const u=-w+2*w*j/columns;if(!sample(q.x+q.nx*u,q.z+q.nz*u))return null;}
            for(const ds of[-1,0,1]){const c=this.at(r,end?len+L+ds:-L+ds);if(!sample(c.x,c.z))return null;}
          }
        }
        r.startLength=startLength;r.endLength=endLength;
      }
      // Match build(r)'s exact Float32 grid (x, z) coordinates so interior CHECKS sample the identical points.
      const gxz=new Float32Array((rows+1)*(columns+1)*2);
      for(let i=0,v=0;i<=rows;i++){
        const s=along(i),p=this.at(r,s),width=this.widthAt(r,s);
        for(let j=0;j<=columns;j++,v++){
          const u=-width+2*width*j/columns,x=p.x+p.nx*u,z=p.z+p.nz*u;
          gxz[v*2]=x;gxz[v*2+1]=z;
          if(!sample(x,z))return null;
        }
      }
      // Hash every solver triangle-interior lift point (CHECKS centroids and 4x4 quarter-cell lattice) on the core deck
      // and adjacent bank rows (or all rows when another span shares a 64 m cell), independent of neighbor hydration order.
      const i0=r.hasNearbySpans?0:Math.max(0,startLength-1),i1=r.hasNearbySpans?rows:Math.min(rows,startLength+coreRows+1);
      const memoRow=4*columns+1,memoX=new Float64Array(5*memoRow),memoZ=new Float64Array(memoX.length),memoState=new Uint8Array(memoX.length);
      for(let i=i0;i<i1;i++)for(let j=0;j<columns;j++){
        const a=(i*(columns+1)+j)*2,b=a+2,c=a+(columns+1)*2,d=c+2;
        for(let half=0;half<2;half++){
          const t0=half===0?a:b,t1=c,t2=half===0?b:d;
          for(let q=0;q<CHECKS.length;q+=3){
            const w0=CHECKS[q],w1=CHECKS[q+1],w2=CHECKS[q+2];
            const x=gxz[t0]*w0+gxz[t1]*w1+gxz[t2]*w2,z=gxz[t0+1]*w0+gxz[t1+1]*w1+gxz[t2+1]*w2;
            if(q===0){
              if(!sample(x,z))return null;
            }else{
              const e=(q/3-1)*4+half*2,slot=((4*i+CHECK_CELLS[e])%5)*memoRow+4*j+CHECK_CELLS[e+1];
              if(memoState[slot]===0||memoX[slot]!==x||memoZ[slot]!==z||x===0&&!Object.is(memoX[slot],x)||z===0&&!Object.is(memoZ[slot],z)){
                memoState[slot]=1;memoX[slot]=x;memoZ[slot]=z;
                if(!sample(x,z))return null;
              }
            }
          }
        }
      }
      // Sample every centreline approach/bank station (covers odd-column spans where u=0 lies between grid columns).
      for(let s=-startLength-1;s<=0;s++){const p=this.at(r,s);if(!sample(p.x,p.z))return null;}
      for(let s=0;s<=endLength+1;s++){const p=this.at(r,len+s);if(!sample(p.x,p.z))return null;}
      for(let s=.5;s<len;s+=.5){const p=this.at(r,s);if(!sample(p.x,p.z))return null;}
      if(len>35)for(const s of[len*.12,len*.88]){const p=this.at(r,s);if(!sample(p.x,p.z))return null;}
      // Sample every per-column toe-slope point read by curveData (both sides of each approach toe).
      for(const s of[-startLength-1,-startLength+1,len+endLength-1,len+endLength+1]){
        const p=this.at(r,s),width=this.widthAt(r,s);
        for(let j=0;j<=columns;j++){const u=-width+2*width*j/columns;if(!sample(p.x+p.nx*u,p.z+p.nz*u))return null;}
      }
      // If toeLength() fell through to its best-grade fallback instead of terminating at startLength/endLength,
      // cover every candidate station out to MAX_APPROACH that could change toe selection.
      const smooth=r.road.kind<=3&&len>=20&&Math.abs(y1-y0)/len<.06;
      for(const [end,sLen,isSmooth]of[[false,startLength,smoothStart],[true,endLength,smoothEnd]]as const){
        const p=this.at(r,end?len+sLen:-sLen),width=this.widthAt(r,end?len+sLen:-sLen);
        let grade=0,previous:number|null=null;
        for(let j=0;j<=columns;j++){
          const u=-width+2*width*j/columns,h0=this.land(p.x+p.nx*u,p.z+p.nz*u);
          if(h0===null){grade=Infinity;break;}
          if(Math.abs(u)<=width-.25){if(previous!==null)grade=Math.max(grade,Math.abs(h0-previous)/(2*width/columns));previous=h0;}else previous=null;
        }
        if(grade>=.243||(smooth&&!isSmooth)){
          for(let L=sLen+1;L<=MAX_APPROACH;L++){
            const q=this.at(r,end?len+L:-L),w=this.widthAt(r,end?len+L:-L);
            for(let j=0;j<=columns;j++){const u=-w+2*w*j/columns;if(!sample(q.x+q.nx*u,q.z+q.nz*u))return null;}
            if(smooth)for(const ds of[-1,0,1]){const c=this.at(r,end?len+L+ds:-L+ds);if(!sample(c.x,c.z))return null;}
          }
        }
      }
      const partners=[...r.parallel].sort((a,b)=>a.chainKey<b.chainKey?-1:a.chainKey>b.chainKey?1:0);
      for(const q of partners){
        for(const s of[0,-3,-6,-8,q.length,q.length+3,q.length+6,q.length+8]){
          const p=this.at(q,s);
          if(!sample(p.x,p.z))return null;
        }
      }
      return h.done();
    }finally{
      r.startLength=prevS;r.endLength=prevE;r.width=prevW;r.narrowRail=prevNR;this.sampling=prevSampling;this.bakedLand=prevBakedLand;
    }
  }

  /** Fingerprint the washboard road-distance axes read by emit()'s toeFrame so staged tile arrival refreshes approach UVs. */
  private washAxisHash(r:Span):bigint {
    if(!(r.road.washboard||r.start?.road.washboard||r.end?.road.washboard))return 0n;
    const h=new GeomHasher();
    for(const sToe of[-r.startLength,r.length+r.endLength]){
      const toe=this.at(r,sToe),tx=toe.nz,tz=-toe.nx,hw=this.widthAt(r,sToe);
      let axis:[number,number]|null=null;
      for(let d=0;d<=hw&&!axis;d+=0.5)for(const sgn of d===0?[0]:[-1,1]){
        axis=this.terrain.roadAlongAxis?.(toe.x+toe.nx*d*sgn,toe.z+toe.nz*d*sgn,tx,tz)??null;
        if(axis)break;
      }
      h.num(axis?1:0);h.num(axis?axis[0]:tx);h.num(axis?axis[1]:tz);
    }
    return h.done();
  }

  /** Hydrate one span from its baked final-land deck without running the grade solver. Returns true when handled
   *  (hydrated, or waiting for level-6 bank tiles); returns false to fall back to the runtime solver. */
  private tryHydrateBaked(r:Span,touch=true,probeChecked=false):boolean {
    const decks=this.bakedDecks;
    if(!decks)return false;
    if(!!this.terrain.streams!==decks.hasStreams||this.terrainStreamsHash()!==decks.streamsHash)return false;
    const m=this.terrain.manifest;
    if(m&&(m.village[0]!==decks.village[0]||m.village[1]!==decks.village[1]))return false;
    const entry=decks.find(r.chainKey,r.width,!!r.road.ponyTruss,r.geomHash);
    if(!entry||this.rejectedBaked.has(entry)){r.baked=null;r.bakedVerified=false;return false;}
    if(!touch&&!probeChecked&&!r.forceBuild&&!this.probesChanged(r,false))return true;
    const a=this.at(r,-3),b=this.at(r,r.length+3),s0=this.terrain.surfaceAt(a.x,a.z),s1=this.terrain.surfaceAt(b.x,b.z);
    if(!s0||!s1||Math.min(s0.level,s1.level)<6)return true;
    const liveHash=this.spanLandHash(r,entry.startLength,entry.endLength,entry.finalWidth,entry.narrowRail,entry.smoothStart,entry.smoothEnd,entry.y0,entry.y1,entry.level);
    if(liveHash!==null&&liveHash!==entry.landHash){this.rejectedBaked.add(entry);r.baked=null;r.bakedVerified=false;return false;}
    const coreRows=Math.ceil(r.length),rows=coreRows+entry.startLength+entry.endLength,columns=Math.ceil(2*entry.finalWidth/.75);
    if(rows!==entry.rows||columns!==entry.columns||entry.gridY.length!==(rows+1)*(columns+1)){this.rejectedBaked.add(entry);r.baked=null;r.bakedVerified=false;r.forceBuild=true;return false;}
    const prev={width:r.width,narrowRail:r.narrowRail,y0:r.y0,y1:r.y1,outer0:r.outer0,outer1:r.outer1,level:r.level,startLength:r.startLength,endLength:r.endLength,smoothStart:r.smoothStart,smoothEnd:r.smoothEnd,forceBuild:r.forceBuild,extendStart:r.extendStart,extendEnd:r.extendEnd,triangles:r.triangles,triangleDeck:r.triangleDeck,cells:new Map(r.cells),approachRanges:r.approachRanges,skinBox:new Float64Array(r.skinBox)};
    let geometry:THREE.BufferGeometry|null=null;
    this.sampling=true;this.bakedLand=entry.emitLand;this.bakedLandAt=0;
    try{
      r.width=entry.finalWidth;r.narrowRail=entry.narrowRail;r.y0=entry.y0;r.y1=entry.y1;r.outer0=entry.outer0;r.outer1=entry.outer1;
      r.level=entry.level;r.startLength=entry.startLength;r.endLength=entry.endLength;r.smoothStart=entry.smoothStart;r.smoothEnd=entry.smoothEnd;
      r.forceBuild=false;r.extendStart=false;r.extendEnd=false;r.triangles=null;
      const grid=new Float32Array((rows+1)*(columns+1)*3);
      const along=(i:number)=>i<=r.startLength?i-r.startLength:i<=r.startLength+coreRows?r.length*(i-r.startLength)/coreRows:r.length+i-r.startLength-coreRows;
      for(let i=0,v=0;i<=rows;i++){const s=along(i),p=this.at(r,s);
        for(let j=0;j<=columns;j++,v++){const width=this.widthAt(r,s),u=-width+2*width*j/columns,k=v*3;grid[k]=p.x+p.nx*u;grid[k+1]=entry.gridY[v];grid[k+2]=p.z+p.nz*u;}
      }
      geometry=this.emit(r,grid);
      if(this.bakedLandAt!==entry.emitLand.length)throw new RangeError('Baked bridge land count mismatch');
      const hadBaked=!!r.baked,sameEntry=r.baked===entry;
      this.prepareCorridor(r);r.geometry?.dispose();r.geometry=geometry;r.baked=entry;
      if(!hadBaked){r.bakedPrevStartLength=prev.startLength;r.bakedPrevEndLength=prev.endLength;}
      if(!sameEntry){r.bakedPrevWidth=prev.width;r.bakedPrevNarrowRail=prev.narrowRail;}
      r.bakedWashHash=this.washAxisHash(r);
      r.bakedVerified=liveHash===entry.landHash;
      if(!r.bakedVerified)this.probesChanged(r,false);
      r.serial=++this.audit.builds;this.audit.bakedBuilds++;
      if(r.width!==prev.width)this.runList=null;
      if(r.road.ponyTruss)this.ponyDeckVersion++;
      this.dirty=true;
      return true;
    }catch{
      geometry?.dispose();
      r.width=prev.width;r.narrowRail=prev.narrowRail;r.y0=prev.y0;r.y1=prev.y1;r.outer0=prev.outer0;r.outer1=prev.outer1;
      r.level=prev.level;r.startLength=prev.startLength;r.endLength=prev.endLength;r.smoothStart=prev.smoothStart;r.smoothEnd=prev.smoothEnd;
      r.forceBuild=prev.forceBuild;r.extendStart=prev.extendStart;r.extendEnd=prev.extendEnd;r.triangles=prev.triangles;r.triangleDeck=prev.triangleDeck;
      r.cells=prev.cells;r.approachRanges=prev.approachRanges;r.skinBox=prev.skinBox;
      this.rejectedBaked.add(entry);r.baked=null;r.bakedVerified=false;r.forceBuild=true;
      return false;
    }finally{this.bakedLand=null;this.bakedLandAt=0;this.sampling=false;}
  }

  /** touch=false (a followed span beyond DRAW): the source check does not mark its bank tiles as used, so a far
   *  bridge does not keep old land tiles from eviction. A rebuild still reads the land it needs. */
  private ensure(r:Span,touch=true):void {
    if(r.baked&&r.bakedVerified&&!r.forceBuild&&r.baked.finalWidth===r.width)return;
    const revision=this.terrain.dataRevision??0;if(r.revision===revision)return;r.revision=revision;
    if(r.baked&&!r.forceBuild&&r.baked.finalWidth===r.width){
      if(!touch&&!this.probesChanged(r,false))return;
      const liveHash=this.spanLandHash(r,r.baked.startLength,r.baked.endLength,r.baked.finalWidth,r.baked.narrowRail,r.baked.smoothStart,r.baked.smoothEnd,r.baked.y0,r.baked.y1,r.baked.level);
      if(liveHash===null)return;
      if(liveHash===r.baked.landHash){
        if(this.washAxisHash(r)===r.bakedWashHash){r.bakedVerified=true;return;}
        if(this.tryHydrateBaked(r,touch,true))return;
      }
      const oldW=r.width;
      r.width=r.bakedPrevWidth;r.narrowRail=r.bakedPrevNarrowRail;
      r.startLength=r.bakedPrevStartLength;r.endLength=r.bakedPrevEndLength;
      if(r.width!==oldW)this.runList=null;
      this.rejectedBaked.add(r.baked);r.baked=null;r.bakedVerified=false;r.forceBuild=true;
    }
    if(this.tryHydrateBaked(r,touch))return;
    let changed=r.forceBuild||!r.geometry,known=true;
    for(let i=0;i<r.probes.length;i+=3){const source=this.terrain.meshContactSource?.(r.probes[i],r.probes[i+1],true,touch)??revision;
      if(source!==r.probes[i+2])changed=true;r.probes[i+2]=source;if(source<0)known=false;
    }
    if(!changed||!known)return;
    this.sampling=true;
    try{
      const a=this.at(r,-3),b=this.at(r,r.length+3),s0=this.terrain.surfaceAt(a.x,a.z),s1=this.terrain.surfaceAt(b.x,b.z);
      if(!s0||!s1||Math.min(s0.level,s1.level)<6)return;
      // The road bed supplies abutment height. A higher hillside beside the curb is not the road bed.
      // Coarse draw triangles can span a ravine. They are not bank elevations.
      // In particular, do not extrapolate the uphill road across the bank edge.
      const bank=(s:number)=>{const p=this.at(r,s);return this.land(p.x,p.z)??this.terrain.seaLevel;};
      r.y0=Math.max(bank(0),bank(-3),bank(-6),bank(-8))+.04;r.y1=Math.max(bank(r.length),bank(r.length+3),bank(r.length+6),bank(r.length+8))+.04;
      for(const q of r.parallel){
        const bank=(s:number)=>{const p=this.at(q,s);return this.land(p.x,p.z)??-Infinity;},a=Math.max(bank(0),bank(-3),bank(-6),bank(-8))+.04,b=Math.max(bank(q.length),bank(q.length+3),bank(q.length+6),bank(q.length+8))+.04;
        if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs((a+b)/2-(r.y0+r.y1)/2)>.75)continue;
        for(const t of[r,q]){const rail=t.road.name==='Railroad',width=rail?1.25:t.road.halfWidth;
          if(t.width>width){t.width=width;t.narrowRail=rail;t.forceBuild=true;t.revision=-1;}
        }
      }
      // A few DTM spans retain a small road hump. Clear it with one level lift, not a local ramp.
      // The ends remain within the 45 cm slab thickness of the surveyed bank.
      let clearance=0;for(let s=.5;s<r.length;s+=.5){const p=this.at(r,s);clearance=Math.max(clearance,(this.land(p.x,p.z)??-Infinity)+.03-(r.y0+(r.y1-r.y0)*s/r.length));}
      clearance=Math.min(.4,clearance);r.y0+=clearance;r.y1+=clearance;
      r.outer0=bank(-APPROACH);r.outer1=bank(r.length+APPROACH);
      r.level=Math.min(s0.level,s1.level);
      r.forceBuild=false;r.startLength=this.toeLength(r,false);r.endLength=this.toeLength(r,true);r.triangles=null;let grid=this.build(r);
      // Only the last attempt is drawn. An earlier attempt only says whether an approach grows. emit() writes only
      // span fields that the next emit() rewrites, and toeLength() and build() read none of them.
      for(let attempt=0;attempt<12&&(r.extendStart||r.extendEnd);attempt++){
        if(r.extendStart&&r.startLength<MAX_APPROACH)r.startLength=this.toeLength(r,false,Math.min(MAX_APPROACH,r.startLength+8));
        if(r.extendEnd&&r.endLength<MAX_APPROACH)r.endLength=this.toeLength(r,true,Math.min(MAX_APPROACH,r.endLength+8));
        if(r.startLength===MAX_APPROACH&&r.endLength===MAX_APPROACH&&!r.extendStart&&!r.extendEnd)break;
        r.triangles=null;grid=this.build(r);
      }
      const geometry=this.emit(r,grid);
      this.prepareCorridor(r);r.geometry?.dispose();r.geometry=geometry;r.serial=++this.audit.builds;if(r.road.ponyTruss)this.ponyDeckVersion++;this.dirty=true;
    }finally{this.sampling=false;}
  }

  /** No temporary vectors, hits, arrays or keys are created on a cached wheel query. */
  deckHeightAt(x:number,z:number,minimum=false,metadata=false):number|null {return this.query(x,z,minimum,metadata);}
  /** The deck height from a deck that is already built; never builds or rebuilds a span. For layers that follow the
   * deck (the sidewalks): Roads builds each deck within DRAW of the camera and bumps bridgeRevision, and they read it
   * again then. A query that builds would solve a deck inside their frame budget and skip the start-burst hold. */
  builtDeckHeightAt(x:number,z:number):number|null {
    const h=this.query(x,z,false,false,undefined,false,0,false);if(this.sampling||this.terrain.cartRoads)return h;
    // Mark the spans this read depends on as followed: update() keeps them built and current at any camera distance (a
    // far crossing seen through a narrow view still gets its deck and walk, and later finer bank land or a walk widening
    // reaches it). The build happens there, outside the caller's frame budget. On a hit, only the spans under the point
    // (another span in the same cell is not this read's deck); on a miss, the unbuilt spans of the cell, since one of
    // them may be the deck. A followed span is skipped after that; another built span in the cell pays one triangle
    // lookup (its own 2 m cell) per hit, the same work as the read itself.
    const list=this.cells.get(key(x,z,CELL));
    if(list)for(let i=0;i<list.length;i++){const r=this.spans[list[i]];if(!r.followed&&(h===null?!r.geometry:this.ownHeight(r,x,z)!==null))r.followed=true;}
    return h;
  }
  private contactHeightAt(x:number,z:number,referenceY?:number):number|null {return this.query(x,z,false,true,referenceY,true,0,referenceY!==undefined);}
  private query(x:number,z:number,minimum:boolean,metadata:boolean,referenceY?:number,contact=false,partFilter=0,build=true):number|null {
    if(this.sampling||this.terrain.cartRoads)return null;const list=this.cells.get(key(x,z,CELL));if(!list)return null;
    let best:number|null=null,tested=0;
    for(let i=0;i<list.length;i++){
      const r=this.spans[list[i]];if(build)this.ensure(r);const t=r.triangles;if(!t)continue;
      const indices=r.cells.get(key(x,z,TRI_CELL))??EMPTY;
      for(let j=0;j<indices.length;j++){
        const k=indices[j];if(partFilter===1&&r.triangleDeck[k/9]===1||partFilter===2&&r.triangleDeck[k/9]!==1)continue;tested++;const ax=t[k],az=t[k+2],bx=t[k+3]-ax,bz=t[k+5]-az,cx=t[k+6]-ax,cz=t[k+8]-az;
        const det=bx*cz-bz*cx;if(Math.abs(det)<1e-10)continue;
        const dx=x-ax,dz=z-az,u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;
        if(u< -1e-7||v< -1e-7||u+v>1.0000001)continue;
        const y=t[k+1]+u*(t[k+4]-t[k+1])+v*(t[k+7]-t[k+1]);if(contact&&r.triangleDeck[k/9]===1&&!deckWithinReach(y,referenceY))continue;if(best===null||(minimum?y<best:y>best)){best=y;
          if(!metadata)continue;
          this.applyDriving(r,r.triangleDeck[k/9]);
        }
      }
    }
    this.audit.heightTrianglesMax=Math.max(this.audit.heightTrianglesMax,tested);return best;
  }
  private roadBedHeight(x:number,z:number):number|null {
    // Earthworks belong to approaches, never to the water/land under a structural span.
    // The source footprint also covers millimetre seams in the Float32 contact grid.
    if(this.isSpan(x,z,-1)||this.query(x,z,true,false,undefined,false,2,false)!==null)return null;
    const h=this.query(x,z,true,false,undefined,false,1,false);return h===null?null:h-.03;
  }
  private applyDriving(r:Span,part:number):void {
    const deck=part===1,road=(part===0?r.start?.road:part===2?r.end?.road:r.road)??r.road;
    const wash=!!(r.road.washboard||road.washboard);
    this.driving.kind=wash?road.kind:deck?(r.timber?5:9):road.kind;
    this.driving.halfWidth=deck?r.width:r.narrowRail?1.25:road.halfWidth;this.driving.washboard=wash;this.driving.roadKind=road.kind;
  }
  private ownHeight(r:Span,x:number,z:number):number|null {
    const a=r.triangles;if(!a)return null;const indices=r.cells.get(key(x,z,TRI_CELL))??EMPTY;
    for(let j=0;j<indices.length;j++){const k=indices[j],ax=a[k],az=a[k+2],bx=a[k+3]-ax,bz=a[k+5]-az,cx=a[k+6]-ax,cz=a[k+8]-az,det=bx*cz-bz*cx;if(Math.abs(det)<1e-10)continue;
      const dx=x-ax,dz=z-az,u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)return a[k+1]+u*(a[k+4]-a[k+1])+v*(a[k+7]-a[k+1]);
    }return null;
  }
  private cutRevision(x0:number,z0:number,x1:number,z1:number):number {
    let value=0;for(const r of this.spans)if(r.geometry&&r.skinBox[0]<=x1&&r.skinBox[2]>=x0&&r.skinBox[1]<=z1&&r.skinBox[3]>=z0)value+=r.serial;return value;
  }
  private cutTriangles(x0:number,z0:number,x1:number,z1:number):readonly Float32Array[] {
    return this.spans.filter(r=>r.triangles&&r.skinBox[0]<=x1&&r.skinBox[2]>=x0&&r.skinBox[1]<=z1&&r.skinBox[3]>=z0).map(r=>r.triangles!);
  }
  /** Built deck elevation at fraction t along a bridge span, or null before the deck is built. */
  bridgeElevation(id:number,t:number):number|null {
    const r=this.spans.find(s=>s.members.has(id));
    if(!r||!r.geometry||!r.triangles)return null;
    return r.y0+(r.y1-r.y0)*Math.max(0,Math.min(1,t));
  }
  /** Built terrain detail level of a bridge deck, or 0 before the deck is built. */
  bridgeDeckLevel(id:number):number {
    const r=this.spans.find(s=>s.members.has(id));
    return r&&r.geometry?Math.max(0,r.level):0;
  }
  /** Build serial of a bridge deck, or 0 before the deck is built. */
  bridgeDeckSerial(id:number):number {
    const r=this.spans.find(s=>s.members.has(id));
    return r&&r.geometry?r.serial:0;
  }
  /** Read-only bridge bank elevations [y0, y1] and terrain detail level without building or mutating scene meshes. */
  bridgeBankElevations(id:number,out:[number,number]):number {
    const r=this.spans.find(s=>s.members.has(id));
    if(!r)return 0;
    const built=!!(r.geometry&&r.triangles&&r.level>=6);
    const rev=this.terrain.dataRevision??0;
    if(built&&(r.baked||r.level>=8||r.revision===rev)){
      out[0]=r.y0;out[1]=r.y1;
      return r.level;
    }
    const a=this.at(r,-3),b=this.at(r,r.length+3),s0=this.terrain.surfaceAt(a.x,a.z),s1=this.terrain.surfaceAt(b.x,b.z);
    if(!s0||!s1||Math.min(s0.level,s1.level)<6){
      if(built){out[0]=r.y0;out[1]=r.y1;return r.level;}
      return 0;
    }
    const level=Math.min(s0.level,s1.level);
    const bank=(s:number)=>{const p=this.at(r,s);return this.land(p.x,p.z)??this.terrain.seaLevel;};
    let y0=Math.max(bank(0),bank(-3),bank(-6),bank(-8))+.04,y1=Math.max(bank(r.length),bank(r.length+3),bank(r.length+6),bank(r.length+8))+.04;
    let clearance=0;for(let s=.5;s<r.length;s+=.5){const p=this.at(r,s);clearance=Math.max(clearance,(this.land(p.x,p.z)??-Infinity)+.03-(y0+(y1-y0)*s/r.length));}
    clearance=Math.min(.4,clearance);y0+=clearance;y1+=clearance;
    out[0]=y0;out[1]=y1;
    return level;
  }
  /** Hide or show the deck of the spans that carry road `id`: its surface, underside, rails and supports. The
   *  approaches stay drawn, since the road cuts under them stay. Drawing only: contact, cuts and paint stay. A no-op
   *  when unchanged, so a caller may set it every frame; a change re-merges the mesh at once. */
  setHidden(id:number,hide:boolean):void {
    if(this.hidden.has(id)===hide)return;
    if(hide)this.hidden.add(id);else this.hidden.delete(id);
    if(this.mesh)this.merge();else this.dirty=true;
  }
  private drawn(r:Span):boolean {
    for(const id of this.hidden)if(r.road.id===id||r.members.has(id)||r.road.sourceRoad===id)return false;
    return true;
  }
  update(cam:THREE.Vector3):void {
    if(this.walks&&this.walks.size!==this.walkCount)this.reserveWalks();
    // The box is a cheap prefilter. Only a deck line within DRAW builds here, plus any span a built-deck reader follows
    // (Span.followed), at any distance; a query (contact, deck height or placement) still builds any span on demand.
    // While the game waits for the driver (Terrain.holdBackground) during a land burst (Terrain.burst), a span that has
    // a deck keeps it here: each finer level under its banks would build it again. The first update after that builds
    // it on the land of the moment. A span with no deck builds at once, and so does a forced build: its width has
    // changed, and its footprint already uses the new width. The hold also ends when the camera moves more than
    // HOLD_REACH across the map from where it began (the drone or the free camera before the first pedal). Height does
    // not count: the parked camera rises with the car as the land arrives (64 m at Point Tupper). A step of more than
    // HOLD_JUMP (a placement or a place jump, Terrain's burst rule) starts a new hold where the camera lands.
    const hold=this.holding(cam);
    for(let i=0;i<this.spans.length;i++){const r=this.spans[i];if(hold&&r.geometry&&!r.forceBuild)continue;
      const near=cam.x>r.x0-DRAW&&cam.x<r.x1+DRAW&&cam.z>r.z0-DRAW&&cam.z<r.z1+DRAW&&nearLine(r.pts,cam.x,cam.z,DRAW);if(near||r.followed)this.ensure(r,near);}
    if(this.dirty)this.merge();
  }
  // Hold state, made on the first hold (a fixture may build this class without its field initialisers).
  private holdAt:THREE.Vector3|null=null;private holdLast:THREE.Vector3|null=null;private holdEnded=false;
  private holding(cam:THREE.Vector3):boolean {
    if(this.terrain.burst!==true||this.terrain.holdBackground!==true){this.holdAt=null;this.holdEnded=false;return false;}
    const jump=!this.holdAt||!this.holdLast||cam.distanceTo(this.holdLast)>HOLD_JUMP;
    this.holdLast=(this.holdLast??new THREE.Vector3()).copy(cam);
    if(jump){this.holdAt=(this.holdAt??new THREE.Vector3()).copy(cam);this.holdEnded=false;}
    else if(Math.hypot(cam.x-this.holdAt!.x,cam.z-this.holdAt!.z)>HOLD_REACH)this.holdEnded=true;
    return!this.holdEnded;
  }
  private walkCount=0;
  /** A sidewalk on a bridge (main's sidewalk layer) needs the deck to reach past it, as the old deck's widened parapet
   *  did: half width + walk + 0.3 m. Both sides widen, and a deck never narrows again, so a sidewalk layer that gives
   *  up later leaves a wide deck. Spans narrowed beside a railway keep their narrow width. */
  private reserveWalks():void {
    this.walkCount=this.walks!.size;
    for(const r of this.spans){if(r.parallel.length)continue;let need=r.width;
      for(const [id,half]of r.halves){const walk=this.walks!.get(id);if(walk)need=Math.max(need,half+walk.width+.3);}
      if(need>r.width){r.width=need;r.forceBuild=true;r.revision=-1;this.runList=null;}
    }
  }
  private merge():void {
    this.dirty=false;
    // A hidden span keeps only its approach vertices (approachRanges: start, end pairs).
    let count=0;for(const r of this.spans){if(!r.geometry)continue;if(this.drawn(r))count+=r.geometry.getAttribute('position').count;else for(let i=0;i<r.approachRanges.length;i+=2)count+=r.approachRanges[i+1]-r.approachRanges[i];}
    const geometry=new THREE.BufferGeometry();
    for(const name of['position','normal','color']as const){const data=new Float32Array(count*3);let at=0;for(const r of this.spans){const a=r.geometry?.getAttribute(name);if(!a)continue;
      if(this.drawn(r)){data.set(a.array,at);at+=a.array.length;}
      else for(let i=0;i<r.approachRanges.length;i+=2){const part=(a.array as Float32Array).subarray(r.approachRanges[i]*3,r.approachRanges[i+1]*3);data.set(part,at);at+=part.length;}
    }geometry.setAttribute(name,new THREE.BufferAttribute(data,3));}
    let hasApproach=false;for(const r of this.spans)if(r.geometry?.getAttribute('approach')){hasApproach=true;break;}
    if(hasApproach){const data=new Float32Array(count*4);let at=0;for(const r of this.spans){const p=r.geometry?.getAttribute('position');if(!p)continue;const a=r.geometry?.getAttribute('approach');
      if(this.drawn(r)){if(a)data.set(a.array,at);at+=p.count*4;}
      else for(let i=0;i<r.approachRanges.length;i+=2){const len=(r.approachRanges[i+1]-r.approachRanges[i])*4;if(a)data.set((a.array as Float32Array).subarray(r.approachRanges[i]*4,r.approachRanges[i+1]*4),at);at+=len;}
    }geometry.setAttribute('approach',new THREE.BufferAttribute(data,4));}
    geometry.computeBoundingSphere();
    if(!this.mesh){this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.name='Modern bridge decks';this.mesh.receiveShadow=true;this.group.add(this.mesh);}
    else{this.mesh.geometry.dispose();this.mesh.geometry=geometry;}this.audit.merges++;this.terrain.updateRoadCuts?.();
  }
  /** The span's solved height grid (x, y, z per point; rows along the span, columns across). It also sets
   *  r.extendStart and r.extendEnd. ensure() turns the last attempt into a mesh with emit(). */
  private build(r:Span,relaxCurve=false):Float32Array {
    const coreRows=Math.ceil(r.length),rows=coreRows+r.startLength+r.endLength,columns=Math.ceil(2*r.width/.75),grid=new Float32Array((rows+1)*(columns+1)*3);
    const curves0=r.smoothStart?Array.from({length:columns+1},(_,j)=>this.curveData(r,false,r.startLength,-1+2*j/columns)):null,curves1=r.smoothEnd?Array.from({length:columns+1},(_,j)=>this.curveData(r,true,r.endLength,-1+2*j/columns)):null;
    const along=(i:number)=>i<=r.startLength?i-r.startLength:i<=r.startLength+coreRows?r.length*(i-r.startLength)/coreRows:r.length+i-r.startLength-coreRows;
    for(let i=0;i<=rows;i++){const s=along(i),p=this.at(r,s);
      for(let j=0;j<=columns;j++){const width=this.widthAt(r,s),u=-width+2*width*j/columns,x=p.x+p.nx*u,z=p.z+p.nz*u,k=(i*(columns+1)+j)*3;grid[k]=x;const c=s<0?curves0?.[j]:s>r.length?curves1?.[j]:null,t=s<0?(s+r.startLength)/r.startLength:(s-r.length)/r.endLength,h=c?this.curveValue(c,t):this.top(r,s,x,z);grid[k+1]=(s>=0&&s<=r.length||this.isSpan(x,z,-1))?Math.max(h,(this.land(x,z)??-Infinity)+.05):h;grid[k+2]=z;}
    }
    const floor=new Float64Array((rows+1)*(columns+1));floor.fill(-Infinity);
    const fixed=new Uint8Array(floor.length);
    for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++){const n=i*(columns+1)+j,s=along(i);if(s>=0&&s<=r.length||this.isSpan(grid[n*3],grid[n*3+2],-1))floor[n]=grid[n*3+1];if(!relaxCurve&&(s<0?r.smoothStart:s>r.length?r.smoothEnd:false)&&Math.abs(j-columns/2)<=.51)fixed[n]=1;if(i===0||i===rows){const width=this.widthAt(r,s),u=-width+2*width*j/columns;if(Math.abs(u)<=width-.25)fixed[n]=1;}}
    const slope=(a:number,b:number,c:number)=>{const dx=grid[b]-grid[a],dz=grid[b+2]-grid[a+2],ex=grid[c]-grid[a],ez=grid[c+2]-grid[a+2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-8)return 0;const dy=grid[b+1]-grid[a+1],ey=grid[c+1]-grid[a+1];return Math.hypot((dy*ez-ey*dz)/det,(dx*ey-ex*dy)/det);};
    // The grade solver visits each quad's triangles [a,c,b] then [b,c,d], in row order, until no height moves.
    // A visit reads only its three corners' heights and floors: x, z and `fixed` never change. So a visit whose
    // corners have not changed since its last visit repeats that visit exactly: it moves nothing and gives the
    // same toe flags (the values 2 and 4 in `flags`). `changed` holds the visit (a count) that last changed a corner's
    // height or floor; `seen` holds each triangle's last visit.
    const seen=new Int32Array(rows*columns*2),flags=new Uint8Array(seen.length),changed=new Int32Array(floor.length);let visit=0;
    const memoRow=4*columns+1,memoX=new Float64Array(5*memoRow),memoZ=new Float64Array(memoX.length),memoLand=new Float64Array(memoX.length),memoState=new Uint8Array(memoX.length);
    let badStart=false,badEnd=false;
    for(let pass=0;pass<600;pass++){
      let moved=false,lifted=false;badStart=badEnd=false;
      for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
        const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;
        for(let half=0;half<2;half++){
          const t0=half===0?a:b,t1=c,t2=half===0?b:d,n0=t0/3,n1=t1/3,n2=t2/3,id=(i*columns+j)*2+half;
          if(pass===0)for(let q=0;q<CHECKS.length;q+=3){
            const w0=CHECKS[q],w1=CHECKS[q+1],w2=CHECKS[q+2];let x=0,y=0,z=0;
            x+=grid[t0]*w0;y+=grid[t0+1]*w0;z+=grid[t0+2]*w0;x+=grid[t1]*w1;y+=grid[t1+1]*w1;z+=grid[t1+2]*w1;x+=grid[t2]*w2;y+=grid[t2+1]*w2;z+=grid[t2+2]*w2;
            // A lattice point shared with a neighbour takes isSpan and land from the memo when its x and z are the
            // same bits. Both are fixed for a fixed point during a build. The memo keeps the last 5 lattice rows.
            let ground:number|null;
            if(q===0){if(!this.isSpan(x,z,-1))continue;ground=this.land(x,z);}
            else{
              const e=(q/3-1)*4+half*2,slot=((4*i+CHECK_CELLS[e])%5)*memoRow+4*j+CHECK_CELLS[e+1];let state=memoState[slot];
              if(state===0||memoX[slot]!==x||memoZ[slot]!==z||x===0&&!Object.is(memoX[slot],x)||z===0&&!Object.is(memoZ[slot],z)){
                if(!this.isSpan(x,z,-1))state=1;else{const h=this.land(x,z);state=h==null?3:2;memoLand[slot]=h??0;}
                memoState[slot]=state;memoX[slot]=x;memoZ[slot]=z;
              }
              if(state===1)continue;ground=state===2?memoLand[slot]:null;
            }
            const lift=(ground??-Infinity)+.05-y;
            if(lift>0){lifted=true;visit++;
              grid[t0+1]+=lift;floor[n0]=Math.max(floor[n0],grid[t0+1]);changed[n0]=visit;
              grid[t1+1]+=lift;floor[n1]=Math.max(floor[n1],grid[t1+1]);changed[n1]=visit;
              grid[t2+1]+=lift;floor[n2]=Math.max(floor[n2],grid[t2+1]);changed[n2]=visit;
            }
          }
          const last=seen[id];
          if(last!==0&&changed[n0]<last&&changed[n1]<last&&changed[n2]<last){const f=flags[id];if(f&2)badStart=true;if(f&4)badEnd=true;continue;}
          const now=seen[id]=++visit;flags[id]=0;
          // slope(t0,t1,t2), inline.
          const dx=grid[t1]-grid[t0],dz=grid[t1+2]-grid[t0+2],ex=grid[t2]-grid[t0],ez=grid[t2+2]-grid[t0+2],det=dx*ez-dz*ex;
          if(Math.abs(det)<1e-8)continue;
          const dy=grid[t1+1]-grid[t0+1],ey=grid[t2+1]-grid[t0+1];
          if(noLonger((dy*ez-ey*dz)/det,(dx*ey-ex*dy)/det,STEEP,STEEP_LO,STEEP_HI))continue;
          flags[id]=1;
          // That slope test already rejected a near-zero det.
          const cx0=(dz-ez)/det,cx1=ez/det,cx2=-dz/det,cz0=(ex-dx)/det,cz1=-ex/det,cz2=dx/det,free0=!fixed[n0],free1=!fixed[n1],free2=!fixed[n2];
          let gx=0,gz=0,xx=0,xz=0,zz=0;gx+=cx0*grid[t0+1];gz+=cz0*grid[t0+1];gx+=cx1*grid[t1+1];gz+=cz1*grid[t1+1];gx+=cx2*grid[t2+1];gz+=cz2*grid[t2+1];
          if(free0){xx+=cx0*cx0;xz+=cx0*cz0;zz+=cz0*cz0;}if(free1){xx+=cx1*cx1;xz+=cx1*cz1;zz+=cz1*cz1;}if(free2){xx+=cx2*cx2;xz+=cx2*cz2;zz+=cz2*cz2;}
          const determinant=(free0?1:0)+(free1?1:0)+(free2?1:0)===1?0:Math.max(0,xx*zz-xz*xz),sum=xx+zz;
          const hi=stepLength(sum,xx,xz,zz,gx,gz,determinant);
          if(hi===-1){if(i===0){badStart=true;flags[id]|=2;}else if(i===rows-1){badEnd=true;flags[id]|=4;}continue;}
          const den=1+hi*sum+hi*hi*determinant,px=((1+hi*zz)*gx-hi*xz*gz)/den,pz=((1+hi*xx)*gz-hi*xz*gx)/den;
          // A store that keeps the value but flips the sign of zero still counts as a change for `changed`.
          if(free0){const before=grid[t0+1];grid[t0+1]=Math.max(floor[n0],before-hi*(cx0*px+cz0*pz));if(grid[t0+1]!==before)moved=true;if(!Object.is(grid[t0+1],before))changed[n0]=now;}
          if(free1){const before=grid[t1+1];grid[t1+1]=Math.max(floor[n1],before-hi*(cx1*px+cz1*pz));if(grid[t1+1]!==before)moved=true;if(!Object.is(grid[t1+1],before))changed[n1]=now;}
          if(free2){const before=grid[t2+1];grid[t2+1]=Math.max(floor[n2],before-hi*(cx2*px+cz2*pz));if(grid[t2+1]!==before)moved=true;if(!Object.is(grid[t2+1],before))changed[n2]=now;}
        }
      }
      // A lift in the first pass can raise a corner after a neighbour that shares it was visited. That neighbour can
      // now be steep, though it was not steep at its visit. So a pass that lifted always runs one more pass.
      if(!moved&&!lifted)break;
    }
    // A toe with a steep crossfall needs a longer approach to find a sound road section.
    let invalid=false;
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;if(Math.max(slope(a,c,b),slope(b,c,d))>.249){invalid=true;if(i<r.startLength)badStart=true;else if(i>=r.startLength+coreRows)badEnd=true;else badStart=badEnd=true;}}
    // A hillside floor can conflict with the fixed gentle centre curve. Keep the
    // curve as the initial shape, then let the full-width grade constraint win.
    if(!relaxCurve&&(r.smoothStart||r.smoothEnd)&&invalid)return this.build(r,true);
    r.extendStart=badStart&&r.startLength<MAX_APPROACH;r.extendEnd=badEnd&&r.endLength<MAX_APPROACH;
    return grid;
  }
  /** The mesh of a solved grid. It sets the span's wheel triangles, their cells, skin box and approach ranges. */
  private emit(r:Span,grid:Float32Array):THREE.BufferGeometry {
    const m=new Mesher(),coreRows=Math.ceil(r.length),rows=coreRows+r.startLength+r.endLength,columns=Math.ceil(2*r.width/.75),top=new Float32Array(rows*columns*18),deckFlags=new Uint8Array(rows*columns*2);let count=0;
    const along=(i:number)=>i<=r.startLength?i-r.startLength:i<=r.startLength+coreRows?r.length*(i-r.startLength)/coreRows:r.length+i-r.startLength-coreRows;
    // Vertex ranges of the approaches (surface, stripes and fill), which stay drawn when the span's deck is hidden.
    const approachRanges:number[]=[];
    const approach=(emit:()=>void)=>{const from=m.pos.length/3;emit();const to=m.pos.length/3;if(to===from)return;
      if(approachRanges.length&&approachRanges[approachRanges.length-1]===from)approachRanges[approachRanges.length-1]=to;else approachRanges.push(from,to);};
    const stride=columns+1,surface:number[]=[];
    const hasWash=!!(r.road.washboard||r.start?.road.washboard||r.end?.road.washboard);
    const WASH_PERIOD=(2*Math.PI)/10.134;
    const toeFrame=(sToe:number):{base:number;cross:number}|null=>{
      if(!hasWash)return null;
      const toe=this.at(r,sToe),tx=toe.nz,tz=-toe.nx,hw=this.widthAt(r,sToe);
      let axis:[number,number]|null=null;
      for(let d=0;d<=hw&&!axis;d+=0.5){
        for(const sgn of d===0?[0]:[-1,1]){
          axis=this.terrain.roadAlongAxis?.(toe.x+toe.nx*d*sgn,toe.z+toe.nz*d*sgn,tx,tz)??null;
          if(axis)break;
        }
      }
      const ax=axis?axis[0]:tx,az=axis?axis[1]:tz;
      const base=(((toe.x*ax+toe.z*az)%WASH_PERIOD)+WASH_PERIOD)%WASH_PERIOD;
      return {base,cross:toe.nx*ax+toe.nz*az};
    };
    const startFrame=toeFrame(-r.startLength),endFrame=toeFrame(r.length+r.endLength);
    const vertexApproach=(v:number,code:number,half:number,part:number)=>{
      if(!code){surface.push(0,0,0,0);return;}
      const vi=v/3,ri=Math.floor(vi/stride),cj=vi-ri*stride,sv=along(ri),wv=this.widthAt(r,sv),uv=-wv+2*wv*cj/columns;
      let w=sv;
      if(code===6){
        const frame=part===0?startFrame:endFrame,sToe=part===0?-r.startLength:r.length+r.endLength;
        if(frame){
          const dToe=part===0?sv-sToe:sToe-sv,blend=Math.max(0,1-dToe/3);
          w=(sv-sToe)+frame.base+uv*frame.cross*blend;
        }
      }
      surface.push(code,uv,half,w);
    };
    const triangle=(a:number,b:number,c:number,color:RGB,part:number,code:number,half:number)=>{
      deckFlags[count/9]=part;
      if((grid[b+2]-grid[a+2])*(grid[c]-grid[a])-(grid[b]-grid[a])*(grid[c+2]-grid[a+2])<0){const swap=b;b=c;c=swap;}
      top[count]=grid[a];top[count+1]=grid[a+1];top[count+2]=grid[a+2];top[count+3]=grid[b];top[count+4]=grid[b+1];top[count+5]=grid[b+2];top[count+6]=grid[c];top[count+7]=grid[c+1];top[count+8]=grid[c+2];count+=9;
      vertexApproach(a,code,half,part);vertexApproach(b,code,half,part);vertexApproach(c,code,half,part);
      const draw=()=>m.tri(grid[a],grid[a+1],grid[a+2],grid[b],grid[b+1],grid[b+2],grid[c],grid[c+1],grid[c+2],color);
      if(part===1)draw();else approach(draw);
    };
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;
      const s=(along(i)+along(i+1))/2,part=s<0?0:s>r.length?2:1,deck=part===1;
      const road=(s<0?r.start?.road:r.end?.road)??r.road,kind=road.kind;
      const washboard=!!(r.road.washboard||road.washboard);
      const code=deck||kind<=2?0:kind===3?(washboard?6:3):kind===5?5:4;
      const half=r.narrowRail?1.25:road.halfWidth;
      const uMid=-r.width+2*r.width*(j+.5)/columns;
      const color:RGB=deck?(r.road.ponyTruss?(Math.abs(uMid)<=PONY_TRUSS.clearHalf?[.16,.165,.17]:[.42,.41,.39]):r.timber?[.31+(i%3)*.012,.225+(i%3)*.008,.14]:[.205,.215,.21]):kind<=2?[.16,.16,.17]:kind===3?[.25,.225,.19]:kind===5?[.34,.32,.28]:[.17,.13,.09];
      triangle(a,c,b,color,part,code,half);triangle(b,c,d,color,part,code,half);
    }
    r.triangleDeck=deckFlags;r.triangles=top;r.cells.clear();r.skinBox.set([Infinity,Infinity,-Infinity,-Infinity]);
    for(let i=0;i<top.length;i+=9){
      r.skinBox[0]=Math.min(r.skinBox[0],top[i],top[i+3],top[i+6]);r.skinBox[1]=Math.min(r.skinBox[1],top[i+2],top[i+5],top[i+8]);r.skinBox[2]=Math.max(r.skinBox[2],top[i],top[i+3],top[i+6]);r.skinBox[3]=Math.max(r.skinBox[3],top[i+2],top[i+5],top[i+8]);
      const x0=Math.floor(Math.min(top[i],top[i+3],top[i+6])/TRI_CELL),x1=Math.floor(Math.max(top[i],top[i+3],top[i+6])/TRI_CELL);
      const z0=Math.floor(Math.min(top[i+2],top[i+5],top[i+8])/TRI_CELL),z1=Math.floor(Math.max(top[i+2],top[i+5],top[i+8])/TRI_CELL);
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const k=key(x*TRI_CELL,z*TRI_CELL,TRI_CELL);let list=r.cells.get(k);if(!list)r.cells.set(k,list=[]);list.push(i);}
    }
    approach(()=>{for(let i=0;i<rows;i++){
      const s0=along(i),s1=along(i+1);
      if(s0>=0&&s1<=r.length)continue;
      const road=(s0<0?r.start?.road:r.end?.road)??r.road;if(road.kind!==1)continue;
      const a=this.at(r,s0),b=this.at(r,s1),ya=this.top(r,s0,a.x,a.z)+.008,yb=this.top(r,s1,b.x,b.z)+.008;
      const stripe=(u:number,width:number,color:RGB)=>m.quad([[a.x+a.nx*(u-width/2),ya,a.z+a.nz*(u-width/2)],[b.x+b.nx*(u-width/2),yb,b.z+b.nz*(u-width/2)],[b.x+b.nx*(u+width/2),yb,b.z+b.nz*(u+width/2)],[a.x+a.nx*(u+width/2),ya,a.z+a.nz*(u+width/2)]],color);
      for(const side of[-1,1]){stripe(side*.115,.12,[.55,.4,.04]);stripe(side*(road.halfWidth-.27),.12,[.55,.55,.52]);}
    }});
    // Approach fill closes the road edge down to the original soil; it is not a deck-coloured slab.
    approach(()=>{for(let i=0;i<rows;i++){
      const s=(along(i)+along(i+1))/2;if(s>=0&&s<=r.length)continue;
      for(const side of[0,columns]){const a=(i*(columns+1)+side)*3,b=a+(columns+1)*3;
        const ay=Math.min(grid[a+1]-.08,(this.land(grid[a],grid[a+2])??grid[a+1])-.3),by=Math.min(grid[b+1]-.08,(this.land(grid[b],grid[b+2])??grid[b+1])-.3);
        m.quad([[grid[a],grid[a+1],grid[a+2]],[grid[b],grid[b+1],grid[b+2]],[grid[b],by,grid[b+2]],[grid[a],ay,grid[a+2]]],[.18,.13,.08]);
      }
    }});
    const concrete:RGB=[.36,.38,.36],steel:RGB=[.38,.42,.42],wood:RGB=[.27,.19,.115],rail:RGB=r.timber?[.39,.29,.18]:steel;
    // The underside follows the same triangles. A coarse box must never stick through the driving top.
    const fascia=r.timber?wood:concrete;
    const bottom=(a:number,b:number,c:number)=>{
      if((grid[b+2]-grid[a+2])*(grid[c]-grid[a])-(grid[b]-grid[a])*(grid[c+2]-grid[a+2])>0){const swap=b;b=c;c=swap;}
      m.tri(grid[a],grid[a+1]-.45,grid[a+2],grid[b],grid[b+1]-.45,grid[b+2],grid[c],grid[c+1]-.45,grid[c+2],fascia);
    };
    for(let i=0;i<rows;i++){
      const s=(along(i)+along(i+1))/2;if(s<0||s>r.length)continue;
      for(let j=0;j<columns;j++){
        const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;
        bottom(a,b,c);bottom(b,d,c);
        if(j===0||j===columns-1){const u=j===0?a:d,v=j===0?c:b;m.quad([[grid[u],grid[u+1],grid[u+2]],[grid[v],grid[v+1],grid[v+2]],[grid[v],grid[v+1]-.45,grid[v+2]],[grid[u],grid[u+1]-.45,grid[u+2]]],fascia);}
      }
    }
    if(r.road.ponyTruss){
      emitPonyTrussSuperstructure(m,r.pts,r.y0,r.y1,r.width,-.45);
    }else for(let s=0;s<r.length;s+=3){const run=Math.min(3,r.length-s),p=this.at(r,s+run/2),a=this.at(r,s),b=this.at(r,s+run),y=this.top(r,s+run/2,p.x,p.z),grade=(this.top(r,s+run,b.x,b.z)-this.top(r,s,a.x,a.z))/run,pitch=-Math.atan(grade),stretch=Math.hypot(1,grade);m.at(p.x,y,p.z,p.yaw,pitch);
      for(const side of[-1,1]){
        const edge=this.top(r,s+run/2,p.x+p.nx*side*r.width,p.z+p.nz*side*r.width)-y;
        m.box(side*(r.width-.12),edge+.11,0,.25,.22,run*stretch+.03,r.timber?wood:concrete);
        m.box(side*(r.width+.08),edge+.82,0,.12,.16,run*stretch+.03,rail);
        m.box(side*(r.width+.08),edge+.43,0,.09,.11,run*stretch+.03,rail);
        if((this.land(p.x,p.z)??-Infinity)<y-.8)m.box(side*r.width*.72,-.8,0,.28,.5,run*stretch+.03,r.timber?wood:steel);
        m.at(p.x,y,p.z,p.yaw);m.box(side*(r.width+.08),edge+.45,0,.14,.9,.14,rail);m.at(p.x,y,p.z,p.yaw,pitch);
      }
      if(!r.timber&&(r.start?.road.kind??r.road.kind)===1&&r.road.halfWidth>=2.8)for(const side of[-1,1])m.box(side*.115,.005,0,.12,.008,run*stretch+.01,[.55,.4,.04]);
    }
    const support=(s:number,abutment:boolean)=>{const p=this.at(r,s),y=this.top(r,s,p.x,p.z),ground=this.land(p.x,p.z)??this.terrain.seaLevel-4,bottom=Math.min(y-.9,ground-.25),h=y-.45-bottom;
      m.at(p.x,bottom,p.z,p.yaw);
      if(r.timber){for(const side of[-1,1])m.box(side*r.width*.72,h/2,0,.28,h,.32,wood);m.box(0,h-.12,0,2*r.width,.26,.38,wood);}
      else m.box(0,h/2,0,abutment?2*(r.width+.2):2*r.width*.7,h,abutment?1.1:.75,concrete);
    };
    support(0,true);support(r.length,true);
    if(r.timber)for(let s=8;s<r.length-4;s+=8)support(s,false);
    else if(r.length>35){support(r.length*.12,false);support(r.length*.88,false);}
    r.approachRanges=new Int32Array(approachRanges);
    const geometry=m.geometry(),approachAttr=new Float32Array((m.pos.length/3)*4);
    approachAttr.set(surface);
    geometry.setAttribute('approach',new THREE.BufferAttribute(approachAttr,4));
    return geometry;
  }
}
