// Exact count policy. GPU geometries/programs/textures mean the fixed view's re-upload set after test-only disposal,
// including the retained water/shadow/environment target pool, not loading-history residency or a leak check. All seven ceilings have zero margin; updates prove five repeats.
import assert from 'node:assert/strict';
export const metrics = ['calls','triangles','geometries','textures','programs','readyTiles','requests'];
export const scenes = [
  {id:'new-player-start',chase:true},
  {id:'village-start',cam:'624230,5103300,4,325,-8,58'},
  {id:'harbour-water',cam:'619062.3,5104643.4,12,105,-13,58'},
  {id:'mines-lookoff-south',cam:'618976,5109274,4,180,-17,64'},
  {id:'works-yard',cam:'620525.19624,5099315.85697,3.2,-34.25384,-5,55'},
  {id:'highway19-far-land',cam:'624467.095,5103372.288,3.5,328,-5,58'},
  // West Bay's ground class runs add one asset request on both devices.
  {id:'quarry-air',area:'westbay',exploreOnly:true,cam:'631900,5063300,450,350,-32,60'},
  {id:'quarry-gate',area:'westbay',exploreOnly:true,trailer:true,cam:'632015,5061860,10,340,-10,65',at:'631920,5062068,333.2'},
  // Cow and four-cattle pasture; the bull remains covered by guardrail-browser.
  {id:'animal-home',animal:true,cam:'619012,5109310,3.2,335,-15,80',at:'619093,5109326,0'},
  // Point Tupper's own start (explore only: no mail there), the scripted chase drive as at new-player-start.
  // pointtupper-start/desktop-explore-truck pinned at 960 calls / 290 geometries / 140 textures / 36 programs (zero margin, three identical runs):
  // #214 added the Port Hawkesbury store and plaza to this view; #3 trimmed the phone cost; desktop keeps textures by design (re-pinned 18 Nov 2026)
  // pointtupper-start/phone-explore-truck pinned at 212 calls (re-pinned 18 Nov 2026): just-drive #1 (sidewalks) lowered it to 211 measured on a base
  // without #3, and #3 (Point Tupper phone budget) measured 212 on a base without #1; together main gives 212, equal to the pre-#1 limit (three identical runs)
  // Harbour lights (just-drive #7) add the five Point Tupper and Causeway lights to this view, measured against main 97100198 in one
  // session on the M4 host: phone +1 call, +1 geometry, +1 program, +2772 triangles; desktop +2 calls, +1 geometry, +1 program,
  // +5544 triangles, no textures. The pins carry exactly that share: phone calls 211 -> 212 and geometries 122 -> 123; desktop calls
  // 988 -> 990, geometries 279 -> 280 and programs 45 -> 46. Triangles and phone programs stay within their pins. On that host main
  // itself measured desktop 997 calls / 283 geometries / 150 textures / 46 programs, above its own pins; that excess is not pinned here.
  // Point Tupper industrial site (pt-industry.ts: power plant stack & boiler dressing, coal yard & conveyors, and four
  // marine terminals; shared Lambert material, no textures, no new day shader programs) enters pointtupper-start's view
  // from Port Hawkesbury with 2 instanced batches: phone +2 calls (203 -> 205, 22 below PHONE_CAP), +20,820 triangles
  // (1,123,375 -> 1,144,195), +2 geometries (120 -> 122), +0 textures (57), +0 programs (17); desktop +2 calls,
  // +31,192 triangles, +0 programs, staying well inside its existing pin (five identical runs on M1 Pro / Edge 158).
  // Point Tupper stockpiles pack (tools/stockpiles-delta/stockpiles.json, 66 kB, coal pile and log yard): installing
  // the pack into data/baked/areas/pointtupper adds +1 asset request (stockpiles.json) to both pointtupper-start rows;
  // both piles sit >1.3 km away and stay culled at the start, so calls, triangles, geometries, textures and programs
  // stay unchanged (24 Nov 2026).
  {id:'pointtupper-start',area:'pointtupper',exploreOnly:true,chase:true},
];
// Breakable yard and field props (mail play and Get Fired; yard-props.ts: three instanced meshes, one shared Lambert material)
// measured in one session on the M4 host against the same tree with the props switched off: mail views with yards in
// range gain at most 3 geometries and no programs or textures; calls +6/+4/+6 on desktop (highway19-far-land,
// new-player-start, village-start) and +3/+2/+2 on the phone; triangles +12888 desktop and +3312 phone at most.
// Pins carry exactly that share where the measured count went over: highway19-far-land/desktop-mail calls 703 -> 709,
// geometries 178 -> 181; highway19-far-land/phone-mail calls 208 -> 211, geometries 90 -> 93; new-player-start/desktop-mail
// calls 618 -> 622, geometries 225 -> 227; village-start/desktop-mail geometries 220 -> 223 (19 Nov 2026). The traffic
// pins (frame-budget-traffic.json) carry the same share: highway19-far-land/desktop-mail calls 708 -> 714, geometries
// 182 -> 185; highway19-far-land/phone-mail calls 209 -> 212, geometries 91 -> 94; new-player-start/desktop-mail calls
// 625 -> 629, geometries 229 -> 231. Triangles stay
// within their pins; phone rows stay under PHONE_CAP. Explore, Just Drive and the explore-truck rows are unchanged.
// The phone draw cap a whole phone frame must fit: the loosest phone pins once the LOW small-props range landed
// (new-player-start 227 calls, works-yard/phone-mail 1,475,392 triangles), frozen so a later saving elsewhere does not
// tighten it. tools/point-tupper-driver-budget.mjs holds the Point Tupper LOW start, AI and all, to it. Raise on purpose only.
// Baked modern bridge decks (bridge-decks.bin, grok-bots#1319 + #1320) add +1 asset request per area at default exag 1.5
// across all 34 rows in frame-budget.json and frame-budget-traffic.json, removing runtime bridge deck solving at start-up
// and restoring Point Tupper's start-up ceiling from 3000/6400 ms back to 2600/6000 ms. In animal-home (all four modes),
// a distant bridge within 1500 m now hydrates its final level-8 deck instead of a coarser level-6/7 build (+88 triangles,
// zero change in calls/geometries/textures/programs; other scenes save 32 to 23,318 triangles or stay exact).
export const PHONE_CAP = Object.freeze({ calls: 227, triangles: 1475392 });
export const modes = [
  {id:'phone-mail',phone:true,explore:false},
  {id:'desktop-mail',phone:false,explore:false},
  {id:'phone-explore-truck',phone:true,explore:true},
  {id:'desktop-explore-truck',phone:false,explore:true},
];
export const keyOf = (scene,mode) => `${scene.id}/${mode.id}`;
export const allKeys = (views=scenes,variants=modes) => views.flatMap(s=>variants.filter(m=>!s.exploreOnly||m.explore).map(m=>keyOf(s,m)));
export function parseArgs(args=[]) {
  const o={action:'check',phone:false,scenes:[],modes:[]};
  for(let i=0;i<args.length;i++) {
    const a=args[i];
    if(a==='--phone') o.phone=true;
    else if(a==='--update') { if(o.action!=='raise') o.action='update'; }
    else if(a==='--raise') o.action='raise';
    else if(a==='--mutations') { assert.equal(args.length,1,'--mutations runs its own explicit subsets'); o.action='mutations'; }
    else if(a==='--scene'||a==='--mode') { const v=args[++i]; assert.ok(v&&!v.startsWith('--'),`${a} needs a value`);o[a==='--scene'?'scenes':'modes'].push(v); }
    else throw Error(`Unknown argument ${a}; use [--phone] [--scene ID] [--mode ID] [--update|--raise|--mutations]`);
  }
  for(const id of o.scenes) assert.ok(scenes.some(s=>s.id===id),`Unknown scene ${id} (SUBSET request)`);
  for(const id of o.modes) assert.ok(modes.some(m=>m.id===id),`Unknown mode ${id} (SUBSET request)`);
  return o;
}
export function selectedRows(o) {
  const rows=scenes.flatMap(scene=>modes.map(mode=>({scene,mode,key:keyOf(scene,mode)})))
    .filter(({scene:s,mode:m})=>(!s.exploreOnly||m.explore)&&(!o.phone||m.phone)&&(!o.scenes.length||o.scenes.includes(s.id))&&(!o.modes.length||o.modes.includes(m.id)));
  assert.ok(rows.length,'Subset selects no known rows'); return rows;
}
export function coverage(baseline,expected=allKeys(),allowNew=false,print=console.error) {
  const expectedSet=new Set(expected), actual=new Set(Object.keys(baseline));
  let failed=expectedSet.size!==expected.length;
  if(failed) print('FAIL coverage: duplicate script scene/mode key');
  for(const key of [...actual].sort()) if(!expectedSet.has(key)) { print(`FAIL coverage: unexpected baseline row ${key} (deleted scene or renamed mode)`);failed=true; }
  for(const key of [...expectedSet].sort()) if(!actual.has(key)&&!allowNew) {print(`FAIL coverage: missing baseline row ${key}; run tools/check-budget.sh --update`);failed=true;}
  for(const [key,row] of Object.entries(baseline)) {
    assert.ok(row&&typeof row==='object',`${key}: invalid ceiling row`);
    assert.deepEqual(Object.keys(row).sort(),[...metrics].sort(),`${key}: ceiling must contain exactly the seven gated counts`);
    for(const k of metrics) assert.ok(Number.isSafeInteger(row[k])&&row[k]>=0,`${key}: invalid ${k} ceiling`);
  }
  return failed;
}
export function assetClass(url) {
  const p=new URL(url).pathname;
  for(const name of ['terrain','areas','audio','models']) if(p.startsWith(`/${name}/`)) return name;
  return null; // Vite /src, /@, /.vite, shell HTML and all other developer requests never gate a player budget.
}
export function command(key,action) {const [scene,mode]=key.split('/');return `tools/check-budget.sh --${action} --scene ${scene} --mode ${mode}`;}
export function compare(key,counts,ceiling,print=console.log) {
  let failed=false; const savings=[];
  for(const k of metrics) {
    assert.ok(Number.isSafeInteger(counts[k])&&counts[k]>=0,`${key}: invalid ${k}`);
    if(counts[k]>ceiling[k]) {failed=true;print(`FAIL ${key}: ${k}=${counts[k]} ceiling=${ceiling[k]}; if you meant to add this cost, run ${command(key,'raise')}; the pull request must say what the player gets for the cost`);}
    else if(counts[k]<ceiling[k]) savings.push(`${k} ${ceiling[k]} -> ${counts[k]}`);
  }
  if(savings.length) print(`SAVING ${key}: ${savings.join(', ')}; lock in with ${command(key,'update')}`);
  return failed;
}
export function updateRow(key,measured,old,raise,print=console.log) {
  const next={};
  for(const k of metrics) {
    assert.ok(Number.isSafeInteger(measured[k])&&measured[k]>=0,`${key}: invalid ${k}`);
    next[k]=old&&!raise?Math.min(old[k],measured[k]):measured[k];
    if(!old||next[k]!==old[k]) print(`${!old?'ADDED':next[k]>old[k]?'RAISED':'LOWERED'} ${key} ${k} ${old?.[k]??'none'} -> ${next[k]}`);
  }
  return next;
}
// One row per scene and mode with a blank line between rows: git needs an unchanged line between two changes,
// so two pull requests that touch different rows (even neighbours) merge without a conflict.
export const serialize = rows => '{\n'+Object.keys(rows).sort().map(k=>'  '+JSON.stringify(k)+':'+JSON.stringify(Object.fromEntries(metrics.map(m=>[m,rows[k][m]])))).join(',\n\n')+'\n}\n';
