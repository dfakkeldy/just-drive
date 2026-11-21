// The spy precedes EVERY import, including static dependencies of Roads.
const original=Math.random;let calls=0;
Math.random=()=>{calls++;return .5;};
try{
 const assert=(await import('node:assert/strict')).default;
 const THREE=await import('../web/node_modules/three/build/three.module.js');assert(THREE.Group);
 const stockThreeDraws=calls;calls=0;
 const {Roads}=await import('../web/src/roads.ts');
 const {HistoryScene}=await import('../web/src/eras/history-scene.ts');assert.equal(typeof HistoryScene,'function');
 const importCalls=calls;calls=0;new Roads({roads:[]},[0,0],{cartRoads:false});
 console.log('BOOTSTRAP',JSON.stringify({stockThreeDraws,unusedEraImport:importCalls,todayRoadConstructor:calls}));
 assert.equal(importCalls,0,'unused era and all its static dependencies consume no random draws');
 assert.equal(calls,8,'modern Group plus one merged bridge material use eight UUID draws (formerly twelve for two materials)');
 calls=0;new Roads({roads:[]},[0,0],{cartRoads:true});assert.equal(calls,4,'historical Group uses four UUID draws; removed two obsolete material placeholders');
 console.log('PASS spy begins before imports; unused era has no random side effects; modern merged material uses 8 UUID draws; historical Group uses 4');
}finally{Math.random=original;}
