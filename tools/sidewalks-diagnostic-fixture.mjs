import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {instrumentDiagnosticMain,workerSuffix,timedDiagnosticMethod} from './sidewalks-diagnostic.mjs';
const source=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8'),changed=instrumentDiagnosticMain(source);
assert.equal(changed.strip(changed.source),source,'diagnostic strips to exact production source');
function check(suffix){
 const sent=[],input={type:'tile',tile:{level:7}},transfer=[new ArrayBuffer(2)];let calls=0,time=0;
 const self={postMessage(...args){sent.push(args);},onmessage(e){assert.equal(e.data,input);calls++;this.postMessage({type:'active',count:2},transfer);this.postMessage({type:'done',reads:12,completed:2});return 47;}};
 runInNewContext(suffix,{self,performance:{now:()=>++time,timeOrigin:100}});
 assert.equal(self.onmessage({data:input}),47);assert.equal(calls,1);assert.equal(sent[0][1],transfer,'transfer list identity preserved');
 assert.deepEqual(sent.slice(0,2).map(a=>a[0]),[{type:'active',count:2},{type:'done',reads:12,completed:2}]);
 assert.equal(sent[2][0].type,'walk-diagnostic');assert.equal(sent[2][0].reads,12);assert.equal(sent[2][0].completed,2);
}
check(workerSuffix);assert.throws(()=>check(workerSuffix.replace('handler.call(this,event)','undefined')));
function argumentsCheck(wrap){
 const expected=[1,2,3,new Uint8Array(2),new Uint8Array(8)],owner={tag:9},record={calls:0,total:0,max:0};
 const original=function(){assert.equal(this,owner);assert.deepEqual([...arguments],expected,'all five clearCanopy arguments retained');return expected[4];};
 assert.equal(wrap(original,record).apply(owner,expected),expected[4]);
}
argumentsCheck(timedDiagnosticMethod);assert.throws(()=>argumentsCheck(original=>function(a,b,c,d){return original.call(this,a,b,c,d);}));
const expectedError=new Error('original'),record={calls:0,total:0,max:0};assert.throws(()=>timedDiagnosticMethod(()=>{throw expectedError;},record)(),e=>e===expectedError);assert.equal(record.calls,1);
console.log('PASS exact source round trip, worker messages/transfers/results, five-argument and exception preservation; removed-handler and old dropped-argument mutants rejected');
