import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./pwa-headers.mjs',import.meta.url),'utf8');
async function test(source) {
 const {parseHeaders,headersFor}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const rules=parseHeaders('/*\n  X-Test: base\n  X-Remove: gone\n/offline/*\n  X-Test: :splat\n  ! X-Remove\n/offline/:dir/:file\n  X-File: :file\nhttps://:sub.example.test/*\n  X-Host: :sub');
 const h=headersFor(rules,'https://game.example.test/offline/nested/app.js');
 assert.equal(h.get('x-test'),'base, nested/app.js');assert.equal(h.get('x-file'),'app.js');assert.equal(h.get('x-remove'),null);assert.equal(h.get('x-host'),'game');
}
await test(source);console.log('PASS header splat, placeholders, combined matches and detach');
for(const [name,from,to] of [['combined matches','added.append','added.set'],['greedy splat',"pattern+='(.*)'","pattern+='([^/]+)'"]]){assert.ok(source.includes(from));let caught=false;try{await test(source.replace(from,to));}catch{caught=true;}assert.ok(caught,name);console.log('caught mutation:',name);}
