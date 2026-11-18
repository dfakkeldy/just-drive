import { readSite } from './site';
export type QuarryTripId='quarry'|'quarry-gate';
export interface TripPose {x:number;z:number;heading:number}
export const tripId=(params:URLSearchParams):QuarryTripId|null=>params.get('trip')==='quarry'?'quarry':params.get('trip')==='quarry-gate'?'quarry-gate':null;
/** The sole preset expansion. A missing or unknown trip returns the original query, byte for byte. */
export function tripParams(params:URLSearchParams):URLSearchParams{
  if(!tripId(params))return params;
  const preset={area:'westbay',mode:'explore',vehicle:'truck',trailer:'1'};
  const result=new URLSearchParams(params);
  // Explicit contradictory choices win: a preset is a starting state, never a constraint on later controls.
  if(Object.entries(preset).some(([key,value])=>params.has(key)&&params.get(key)!==value)){result.delete('trip');return result;}
  for(const [key,value] of Object.entries(preset))result.set(key,value);
  for(const key of ['at','driveAt','road','f','dir','demo','shot'])result.delete(key);
  return result;
}
/** Canonicalise only recognised trips, before other controls read the current address. */
export function bootTripParams():URLSearchParams{
  const raw=new URLSearchParams(location.search);
  if (readSite(location.hostname,location.pathname,raw).brand === 'just' && location.pathname.replace(/\/$/, '').toLowerCase() === '/sugar-camp-quarry') {
    for (const [key,value] of Object.entries({area:'westbay',mode:'explore',vehicle:'truck',trailer:'1',era:'today'})) raw.set(key,value);
    // The poster link has its own key: the start key names a road, and is read only by main.ts.
    for (const key of ['trip','at','driveAt','road','start','poster','demo','shot','cam']) raw.delete(key);
    raw.set('poster','sugar-camp-quarry');
    history.replaceState(history.state,'','/westbay?'+raw+location.hash);
    return raw;
  }
  const params=tripParams(raw);
  if(!tripId(raw))return params;
  // A new bare/partly expanded link is an approach request; the canonical address is a reload.
  if(tripId(params)&&!['area','mode','vehicle','trailer'].every(k=>raw.has(k))){
    try{sessionStorage.removeItem(tripStorageKey(tripId(raw)!));}catch{/* storage blocked */}
  }
  const site=readSite(location.hostname,location.pathname,raw);
  // Only an explicit recognised area path is a later choice. The root has no explicit area.
  // A bare trip still supplies its initial area; an unchanged expanded address survives reload.
  if(location.pathname.split('/').filter(Boolean).length>0&&site.brand==='just'&&site.area&&site.area!=='westbay'&&raw.get('area')==='westbay'&&['area','mode','vehicle','trailer'].every(k=>raw.has(k))){
    params.delete('trip');params.set('area',site.area);
  }
  const area=params.get('area')??site.area;
  // An era door (/mabou-1884) stays on its own address while the trip keeps its area.
  const path=site.brand==='just'&&area?'/'+(site.era&&area===site.area?`${area}-${site.era}`:area):location.pathname;
  if(path!==location.pathname||params.toString()!==raw.toString())history.replaceState(history.state,'',path+'?'+params+location.hash);
  return params;
}
export const tripStorageKey=(id:QuarryTripId):string=>'mmm.trip.'+id;
export function tripAddress(id:QuarryTripId):string{
  const raw=new URLSearchParams(location.search),site=readSite(location.hostname,location.pathname,raw);
  const base=new URLSearchParams({trip:id});if(raw.get('site')==='just'&&site.brand==='just')base.set('site','just');
  const q=tripParams(base),path=site.brand==='just'?'/'+q.get('area'):location.pathname;
  return path+'?'+q;
}
/** An explicit menu selection starts afresh; reloads keep the saved journey. */
export function startTrip(id:QuarryTripId):void {
  try{sessionStorage.removeItem(tripStorageKey(id));}catch{/* private window */}
  location.href=tripAddress(id);
}
export const PARK_NOTICE = 'Sugar Camp Off-Road Park is made up for this game. The old quarry is real, private land.';
