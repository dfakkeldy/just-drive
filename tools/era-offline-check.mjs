import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{harness,source}from'./pwa-harness.mjs';
// One worker serves both eras: it must hold nothing about an era. (This line once compared the worker with main's copy,
// byte for byte. That also failed every later change to the worker, such as the models folder.)
assert(!/history-1884|1884|\bera\b|era=/i.test(source),'the service worker holds nothing about an era');
const h=await harness(),build=h.build('same app with both eras');await h.nav('a','?era=1884');await h.message('start','a');await h.flush();h.network(false);
for(const q of ['', '?era=1884','?era=1884&vehicle=bike','?era=1884&vehicle=horse']){const nav=await h.nav('saved'+q,q);assert.equal(nav.response.status,200);assert(nav.body.includes(build.appUrl));assert.equal(await(await h.get('/terrain/tile.bin','saved'+q)).text(),'land A');}
const builder=readFileSync('tools/build-pwa.mjs','utf8');assert(builder.includes("walk('/terrain')")&&builder.includes("walk('/audio')"));assert(!/history-1884|era=/.test(builder));
console.log('PASS one era-free worker serves today and 1884 navigation from one saved app and the same Mabou terrain; procedural era modules add no separate inventory files');
