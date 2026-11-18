import assert from 'node:assert/strict';
import {nearPixelDiff,nearQuantisationAllowed} from './far-near-allowance.mjs';

function imageCase(count,delta,sea=true) {
  const a=new Uint8Array(16*4).fill(40),b=a.slice(),mask=new Uint8Array(16).fill(1),coverage=new Uint8Array(16*4);
  for(let i=0;i<16;i++){coverage[i*4]=255;coverage[i*4+1]=sea?255:0;}
  for(let i=0;i<count;i++)b[i*4+1]+=delta;
  return nearPixelDiff(a,b,mask,coverage);
}
function contract(accept) {
  for(const [n,d]of [[0,0],[1,1],[4,1]])assert.equal(accept(imageCase(n,d)),true);
  assert.equal(accept(imageCase(5,1)),false,'five sea pixels at delta one fail');
  assert.equal(accept(imageCase(1,2)),false,'one sea pixel at delta two fails');
  assert.equal(accept(imageCase(1,1,false)),false,'one land pixel at delta one fails');
  assert.equal(accept({changed:1,seaChanges:1,maxDelta:0}),false);
  assert.equal(accept({changed:0,seaChanges:1,maxDelta:0}),false);
}
contract(nearQuantisationAllowed);
assert.throws(()=>nearPixelDiff(new Uint8Array(4),new Uint8Array(0),new Uint8Array(1),new Uint8Array(4)),RangeError);
for(const[label,from,to]of [
  ['five pixels permitted','changed<=4','changed<=5'],
  ['two byte levels permitted','maxDelta===1','maxDelta>=1 && maxDelta<=2'],
  ['land permitted','seaChanges===changed','true'],
]) {
  const source=nearQuantisationAllowed.toString();assert.ok(source.includes(from));
  const mutant=new Function('return ('+source.replace(from,to)+')')();
  assert.throws(()=>contract(mutant));console.log('KILLED '+label);
}
console.log('PASS sea-only quantisation bounds; five pixels, delta two and land faults fail');
