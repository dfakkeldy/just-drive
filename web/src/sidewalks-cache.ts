import { WALK_RUNS, type WalkPlan, type WalkRoad, type WalkSection } from './sidewalk-layout';
import { SIDEWALK_ASSETS } from './sidewalks-assets';
import { readFile } from './store';
export interface CachedPlan extends Omit<WalkPlan,'pieces'> {pieces:number[][]}
export interface CachedTile {pixels:number[];members:[number[],number[]][];heightMembers?:[number[],number[]][]}
export interface WalkCoverage {col:number;row:number;cols:number;rows:number;cells:number[][]}
export interface CompiledRange {bucket:number;start:number;count:number;refs:number[];tops:number[];offsets:number[];blendTops?:number[];blends?:number[][]}
export interface CompiledSurface {refs:number[];tops:number[];lifts:number[];probes:[number,number][];probeBytes?:string}
export interface CompiledJob {heightTiles?:string[];drawTiles?:string[];surfaces:CompiledSurface[];ranges:CompiledRange[];refs:number[];centre:[number,number];bridge:boolean}
export interface CompiledGeometry {positions:string;uv:string;colors:string;sphere:[number,number,number,number]}
export interface CompiledWalk {coverage?:WalkCoverage;points:[number,number][];bridgeRefs:boolean[];topOwners:number[][];topCount:number;bridgeJobs:number[];jobs:CompiledJob[];geometries:(CompiledGeometry|null)[]}
export interface CachedArea {id:string;roads:[number,string|null,number,number,boolean][];plans:CachedPlan[];tiles:[number,number,number,number,number,number,number[]|string][];compiled?:CompiledWalk[];terrain:Record<string,CachedTile>}
export interface SelectedWalkArea extends Omit<CachedArea,'plans'|'compiled'|'terrain'> {plan:CachedPlan;compiled:CompiledWalk;terrain:Record<string,{pixels:number[];members:[number[],number[]];heightMembers?:[number[],number[]]}>}
/** Keep the established quality-indexed runtime API without decoding an unused quality. */
export function restoreSelectedWalk(data:SelectedWalkArea):CachedArea {
  const terrain:CachedArea['terrain']={};
  for(const [key,t]of Object.entries(data.terrain))terrain[key]={pixels:t.pixels,members:[t.members,t.members],...(t.heightMembers?{heightMembers:[t.heightMembers,t.heightMembers]}:{})};
  return {id:data.id,roads:data.roads,tiles:data.tiles,plans:[data.plan,data.plan],compiled:[data.compiled,data.compiled],terrain};
}
/** Start this while the regular manifest is loading. No graph search or obstacle tests in the page. */
const unavailable=new Set<string>();
export async function loadSidewalkData(area:string,base:string,low=false):Promise<CachedArea|null> {
  if(!Object.hasOwn(SIDEWALK_ASSETS,area))return null;
  const asset=SIDEWALK_ASSETS[area]![low?'low':'desktop'];
  try {
    if(asset.file!==`sidewalks-${low?'low':'desktop'}.json`)throw new Error('Sidewalk asset quality mismatch');
    const blob=await readFile(base,asset.file,true);
    if(blob.size!==asset.bytes)throw new Error('Sidewalk asset length mismatch');
    const bytes=await blob.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==asset.sha256)throw new Error('Sidewalk asset hash mismatch');
    const data=await unpack(JSON.parse(new TextDecoder().decode(bytes)),low);
    if(data.id!==area)throw new Error('Sidewalk asset area mismatch');
    return data;
  } catch(error) {const key=area+'/'+asset.file;if(!unavailable.has(key)){unavailable.add(key);console.warn('Sidewalk data unavailable; skipping sidewalks',area,error);}return null;}
}
async function unpack(packed:{payload:string;version:number;quality?:string},low=false):Promise<CachedArea> {
  if(low&&(packed.version!==3||packed.quality!=='low')||!low&&packed.version!==2)throw new Error('Sidewalk payload quality mismatch');
  const native=(Uint8Array as unknown as {fromBase64?:(s:string)=>Uint8Array}).fromBase64;
  const bytes=native?native(packed.payload):Uint8Array.from(atob(packed.payload),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const data=await new Response(stream).json();
  return low?restoreSelectedWalk(data as SelectedWalkArea):data as CachedArea;
}
export function readWalkPlan(data:CachedArea,low:boolean):WalkPlan {
  const roads=new Map<number,WalkRoad>(data.roads.map(r=>[r[0],{id:r[0],name:r[1],kind:r[2],halfWidth:r[3],bridge:r[4],pts:[]}]));
  const cached=data.plans[low?1:0];
  const section=(row:number[],offset:number):WalkSection=>({road:roads.get(row[offset])!,centre:[row[offset+1],row[offset+2]],normal:[row[offset+3],row[offset+4]],inner:[row[offset+5],row[offset+6]],outer:[row[offset+7],row[offset+8]],lift:row[offset+9],along:row[offset+10]});
  return {...cached,pieces:cached.pieces.map(row=>({run:WALK_RUNS[row[0]],a:section(row,3),b:section(row,14),material:row[1]?'concrete':'asphalt',buffer:!!row[2]}))};
}
