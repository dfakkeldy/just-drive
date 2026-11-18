import assert from 'node:assert/strict';
// Approved standard depth-cache exception: this exact extra variant, view and mode only.
export const sidewalkDepthProgramKey="depth,highp,srgb-linear,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,1,0,1,0,0,0,0,2,0,0,0,3201,3,144392,srgb,onBeforeCompile() {\n  }";
export const countMetrics=['calls','triangles','geometries','textures','programs','readyTiles','requests'];
export function countDelta(main,current){return Object.fromEntries(countMetrics.map(k=>[k,current[k]-main[k]]));}
export function checkCountDelta(delta,low,groups,context={}){
 if(delta.programs>0){
  assert.equal(low,false,'depth exception is desktop only');
  assert.equal(context.view,'highway19-far-land','no new programs outside named view');
  assert.equal(context.mode,'desktop-mail','no new programs outside named mode');
  assert.equal(delta.programs,1,'exactly one approved depth program');
  assert.deepEqual(context.addedPrograms,[sidewalkDepthProgramKey],'only the approved instanced/no-colour BackSide depth key');
  assert.deepEqual(context.removedPrograms,[],'exception cannot hide other program changes');
 }
 assert.equal(delta.readyTiles,0,'same terrain coverage');
 // B′: one hash-verified companion in a modern surveyed area; zero elsewhere/1884.
 const companion=!context.era&&['mabou','porthood','pointtupper'].includes(context.area??'mabou')?1:0;
 assert.equal(delta.requests,companion,'exactly one selected companion request, zero outside modern surveyed areas');
 assert.ok(delta.textures<=0,'no new textures');assert.ok(delta.geometries<=2,'at most two merged sidewalk geometries');
 const sidewalkDraws=Object.entries(groups).filter(([name])=>name.toLowerCase().includes('sidewalk')).reduce((n,[,v])=>n+v,0);
 assert.ok(delta.calls<=sidewalkDraws,'positive calls must be explained by submitted sidewalk meshes');
 assert.ok(delta.calls<=(low?2:4),'bounded sidewalk draws across render passes');assert.ok(delta.triangles<=(low?4816:12000),'approved per-view triangle delta');
}

export function checkUnchangedCounts(delta,mainKeys,currentKeys){
 assert.deepEqual(delta,Object.fromEntries(countMetrics.map(k=>[k,0])),'all seven count deltas stay zero');
 assert.deepEqual(currentKeys,mainKeys,'program keys unchanged');
}

export function checkProvenCountDelta(delta,expected){
 assert.ok(expected,'view/mode must have a proven delta');
 assert.deepEqual(delta,expected,'all seven deltas must equal the proven sidewalk delta');
}
