import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const current=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8'),call='    sidewalks?.update();\n';
// The one-time full-source byte-equality receipt belongs to the review evidence.
// Keep this regression local to paused readiness so later main.ts edits remain possible.
function check(source){
 const match=source.match(/terrain.update\(camera, true\);([\s\S]*?)page.ready\(([^;]+)\);/);assert.ok(match);
 const advance=Function('quiet','loaded','terrain','sidewalks',match[1]+';return ('+match[2]+');');
 const layer={pending:2,calls:0,update(){this.calls++;this.pending=Math.max(0,this.pending-1);}};
 assert.equal(advance(21,true,{pending:0,failed:0},layer),false,'unfinished paused queue holds readiness');
 assert.equal(advance(22,true,{pending:0,failed:0},layer),true,'bounded paused updates drain the queue');
 assert.equal(layer.pending,0,'paused queue drains');assert.equal(layer.calls,2);
}
const before=current.replace(call,'');
check(current);assert.throws(()=>check(current.replace(call,'')),/bounded paused updates drain the queue/);assert.throws(()=>check(before),/bounded paused updates drain the queue/);
console.log('PASS paused pending queue drains; removal mutant and prior source fail');
