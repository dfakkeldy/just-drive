// Execute the browser poll against the transient document seen during navigation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./sidewalks-runtime.mjs',import.meta.url),'utf8');
const expression=source.match(/state=await evaluate\('([^']+)'\)/)?.[1];
assert.ok(expression,'use the actual native-gate navigation poll');
const document={title:'',documentElement:null,getElementById:()=>null};
assert.equal(runInNewContext(expression,{document}).ready,undefined);
document.documentElement={dataset:{mmmReady:'true'}};
assert.equal(runInNewContext(expression,{document}).ready,'true');
document.documentElement=null;
assert.throws(()=>runInNewContext(expression.replace('documentElement?.dataset','documentElement.dataset'),{document}),/null/);
console.log('PASS transient DOM poll; unguarded poll rejected');
// Exercise the actual pose helper and initializer in their production execution order.
const names=source.match(/^const runNames=.*$/m)?.[0];
const helpers=['cached','pose'].map(name=>source.match(new RegExp('^function '+name+'\\(.*$','m'))?.[0]).join('\n');
const beforeCall=source.indexOf(names)<source.indexOf('await proof()');
// import.meta belongs to the source module, so supply its URL in the isolated program.
const execute=initialized=>{
 const code=((initialized?names+'\n':'')+helpers+'\npose("mabou","harbour-west");\n'+(initialized?'':names)).replaceAll('import.meta.url','sourceURL');
 return runInNewContext(code,{readFileSync,URL,sourceURL:new URL('./sidewalks-runtime.mjs',import.meta.url).href});
};
assert.ok(Number.isFinite(execute(beforeCall).e),'proof pose initializes before its first call');
assert.throws(()=>execute(false),/before initialization/);
console.log('PASS proof pose initialization; previous ordering rejected');
