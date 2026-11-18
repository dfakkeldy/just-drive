import assert from 'node:assert/strict';
import {assertPayloadRequest,assertPayloadComplete} from './sidewalks-quality-browser.mjs';
for(const area of ['mabou','porthood','pointtupper'])for(const low of [false,true]){
 const expected={area,low},path=`/${area==='mabou'?'terrain':'areas/'+area}/sidewalks-${low?'low':'desktop'}.json`;
 assert.equal(assertPayloadRequest(path,expected),true);assertPayloadComplete([path]);
 assert.throws(()=>assertPayloadRequest(path,{...expected,low:!low}),/wrong quality/);assert.throws(()=>assertPayloadRequest(path,{...expected,era:true}),/1884/);
}
assertPayloadComplete([],true);assert.throws(()=>assertPayloadComplete([]),/flat inlined/);assert.throws(()=>assertPayloadComplete(['a','b']),/one selected/);
assert.throws(()=>assertPayloadRequest('/src/sidewalks-packed-mabou.json',{area:'mabou',low:false}),/inlined-module/);
for(const path of ['/src/sidewalks-data.json','/src/sidewalks-cache.ts','/src/sidewalks-assets.ts'])assert.equal(assertPayloadRequest(path,{area:'mabou',low:false,era:true}),false,'code and tiny run recipe are not payloads');
console.log('PASS every-request policy; opposite-quality,era-leak,unknown,duplicate and old-flat missing-request mutants rejected');
