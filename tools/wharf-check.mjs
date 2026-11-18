import assert from 'node:assert/strict';
import { WHARF_SOURCES } from '../web/src/wharf-source.ts';
import { planWharf, insideWharf, buildingBlocker } from '../web/src/wharf-plan.ts';
const source={area:'test',id:'test',name:'',length:30,outline:[[0,0],[30,0],[30,12],[0,12],[0,0]]};
const flat=planWharf(source,()=>2);
assert.ok(flat.length>20);
assert.deepEqual(new Set(flat.map(p=>p.kind)),new Set(['edge','bollard','pole','trap','buoy']));
const shore=(e,n)=>e<0||e>30||n<0||n>12?-.2:2;
const wet=planWharf(source,shore);
assert.ok(wet.some(p=>p.kind==='tyre')&&wet.some(p=>p.kind==='ladder'));
for(const outline of [source.outline,[...source.outline].reverse()])for(const p of planWharf({outline},shore)){
 if(p.kind==='tyre'||p.kind==='ladder')assert.ok(shore(p.e+Math.sin(p.angle),p.n+Math.cos(p.angle))<.1,'hardware points outward for both windings');
}
for(const p of flat){assert.ok(insideWharf(source.outline,p.e,p.n));assert.equal(p.height,2);}
assert.equal(planWharf(source,()=>null).length,0,'no parts before terrain');
assert.equal(planWharf(source,()=>-.2).length,0,'no parts over water');
assert.ok(planWharf(source,(e)=>e>5?10:2).filter(p=>p.kind==='edge').every(p=>Math.abs(p.e-5)>p.length/2),'no curb across step');
// A shed standing on the deck, 0.4 m inside the south curb line: nothing is drawn in it or within 0.5 m of it.
const shed=[[10,.9],[16,.9],[16,6],[10,6]];
const gap=(e,n)=>{if(e>=10&&e<=16&&n>=.9&&n<=6)return 0;const dx=Math.max(10-e,0,e-16),dn=Math.max(.9-n,0,n-6);return Math.hypot(dx,dn);};
for(const footprint of [shed,[...shed].reverse()]){
 const kept=planWharf(source,shore,-.2,buildingBlocker(source.outline,[footprint]));
 assert.ok(kept.some(p=>p.kind==='edge'&&p.e<10)&&kept.some(p=>p.kind==='edge'&&p.e>16),'curbs continue either side of the shed');
 for(const p of kept)assert.ok(gap(p.e,p.n)>=.5,'part clear of building '+JSON.stringify(p));
}
assert.equal(buildingBlocker(source.outline,[[[500,500],[510,500],[510,510]]])(12,3),false,'far buildings ignored');
assert.ok(!WHARF_SOURCES.some(x=>x.area==='mabou'),'fishing and Finlay excluded');
console.log('PASS synthetic outline, all seven parts, unloaded and underwater rejection');
