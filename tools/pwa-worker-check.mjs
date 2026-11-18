// Core contracts retained alongside the migration-specific fail/pass suite.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {harness,source} from './pwa-harness.mjs';
async function test(code) {
 const h=await harness(code),a=h.build('A');await h.api.latest();await h.nav('a');await h.get('/terrain/tile.bin');
 assert.equal((await h.api.status(await h.api.stored())).count,1);
 for(const [header,status,body] of [['bytes=2-5',206,'2345'],['bytes=-3',206,'789'],['bytes=7-',206,'789'],['bytes=100-',416,''],['bytes=-0',416,'']]) {
  const r=await h.get('/audio/song.mp3','a',{Range:header});assert.equal(r.status,status);assert.equal(await r.text(),body);assert.equal(r.headers.get('Content-Range'),status===416?'bytes */10':header==='bytes=2-5'?'bytes 2-5/10':'bytes 7-9/10');assert.equal(r.headers.get('Content-Length'),String(body.length));
 }
 for(const validator of ['"other"','W/"other"','Wed, 01 Jan 2020 00:00:00 GMT']) {
  const r=await h.get('/audio/song.mp3','a',{Range:'bytes=2-5','If-Range':validator});assert.equal(r.status,200,'If-Range mismatch needs whole response');assert.equal(r.headers.get('Content-Range'),null);assert.equal(await r.text(),'0123456789');
 }
 h.routes.delete('/audio/song.mp3');assert.equal(await(await h.get('/audio/song.mp3')).text(),'0123456789');
 h.routes.delete('/version.json');assert.match((await h.nav('offline')).body,new RegExp(a.appUrl.replaceAll('.','\\.')));
 const b=h.build('B','land B');h.routes.set(b.appUrl,new Response('partial',{status:206}));assert.equal((await h.api.latest()).version.revision,a.v.revision,'partial shell not committed');
 h.routes.set(b.appUrl,new Response('X'.repeat(Buffer.byteLength('globalThis.build="B"'))));assert.equal((await h.api.latest()).version.revision,a.v.revision,'same-length corrupt shell not committed');
 h.build('B','land B');await h.nav('b');assert.equal(await(await h.get('/terrain/tile.bin','b')).text(),'land B');
 await h.caches.delete('mmm-offline-data-'+b.v.dataRevision);
 for(const response of [new Response('land B',{status:206}),new Response('error',{status:404}),new Response('land C')]) {
  h.routes.set('/terrain/tile.bin',response);assert.equal((await h.get('/terrain/tile.bin','b')).status,409,'invalid whole data never served');
 }
 h.build('B','land B');await h.get('/terrain/tile.bin','b');const before=h.requests.filter(p=>p==='/terrain/tile.bin').length,replies=[];
 await h.api.download(await h.api.stored(),{postMessage:r=>replies.push(r),close(){}});assert.ok(replies.at(-1).done);assert.equal(h.requests.filter(p=>p==='/terrain/tile.bin').length,before,'resume skips saved files');
 await h.message('remove','b',{confirmed:true});assert.equal((await h.api.status(await h.api.stored())).bytes,0);
 h.routes.set('/version.json',new Response(JSON.stringify({disabled:true})));await h.api.latest();await h.flush();assert.equal(h.registered(),false);assert.equal((await h.caches.keys()).length,0);
 const ranged=new Response('0123456789');ranged.arrayBuffer=()=>{throw Error('whole-song JS buffer');};assert.equal(await(await h.api.range(ranged,'bytes=2-3')).text(),'23','range can slice a Blob');
}
async function mpBypass(code) {
 const h=await harness(code);h.build('A');await h.api.latest();let accesses=0;
 for(const name of ['open','match','keys','delete']){const original=h.caches[name];h.caches[name]=async(...args)=>{accesses++;return original(...args);};}
 const count=h.requests.length;
 for(const online of [true,false])for(const path of ['/mp/','/mp/rooms/ABCD','/mp/terrain/not-an-asset','/mp'])for(const mode of ['navigate','cors','websocket']) {
  h.network(online);let answered=false;
  h.listeners.fetch({request:{url:'https://game.test'+path,method:'GET',mode,headers:new Headers({Upgrade:'websocket'})},respondWith:()=>answered=true,waitUntil:()=>{throw Error('mp background work');}});
  assert.equal(answered,false,'/mp must go untouched to network');
 }
 await Promise.resolve();assert.equal(accesses,0,'no room cache read/write');assert.equal(h.requests.length,count,'no room proxy fetch');
}
await mpBypass(source);console.log('PASS /mp HTTP/navigation/WebSocket bypass, online/offline, zero storage or proxy access');
{
 const h=await harness(source);h.build('A');await h.nav('a');let answered=false;
 h.listeners.fetch({request:{url:'https://game.test/areas/judique/manifest.json',method:'GET',mode:'cors'},respondWith:()=>answered=true});assert.equal(answered,false,'connection-only areas bypass the worker');
 assert.equal((await h.get('/terrain/packs.json','a')).status,404,'absent optional pack remains 404');console.log('PASS connection-only area bypass and optional Mabou pack probe');
}

async function savedBeforeTheCar(code) {
 // The mail car's model is in the offline download like every other model. A page saved before the car was the
 // default has no car in its own download. If it asks for one (?car=blender), it is treated like any other file
 // the page does not own: refused, with the update notice. The update it is told about has the car. The same
 // when the site has switched this worker off. (An earlier build passed this one file to the network.)
 const h=await harness(code);h.build('A');await h.nav('a');
 h.routes.set('/models/mail-car.glb',new Response('a newer car'));
 const asked=await h.get('/models/mail-car.glb','a');assert.equal(asked.status,409,'a model outside the page\'s own download is refused, the mail car\'s too');
 assert.ok(h.messages.some(m=>m.type==='version-unavailable'),'and the player is told to update');
 const k=await harness(code);k.build('A');await k.nav('a');await k.get('/terrain/tile.bin','a');
 k.routes.set('/version.json',new Response(JSON.stringify({disabled:true})));await k.api.latest();await k.flush();assert.equal(k.registered(),false,'the worker is switched off');
 k.routes.set('/models/mail-car-low.glb',new Response('a newer car'));
 assert.equal((await k.get('/models/mail-car-low.glb','a')).status,409,'switched off, the same model is refused too');
}
await savedBeforeTheCar(source);console.log('PASS a page saved before the mail car was the default: its request for the car model is refused with the update notice, also with the worker switched off');
{
 for(const [name,from,to] of [
  ['an unlisted model passed to the network',"      return unavailable(event);\n    }\n    const hashed=","      if(path.startsWith('/models/')) return fetch(request);\n      return unavailable(event);\n    }\n    const hashed="],
  ['an unlisted model passed to the network when the worker is switched off',"path.endsWith('/packs.json')?fetch(request):unavailable(event);","path.endsWith('/packs.json')||path.startsWith('/models/')?fetch(request):unavailable(event);"]
 ]) {assert.ok(source.includes(from),name+' applies');let caught=false;try{await savedBeforeTheCar(source.replace(from,to));}catch{caught=true;}assert.ok(caught,'escaped: '+name);console.log('caught mutation:',name);}
}
const mpGuard="if(url.pathname==='/mp' || url.pathname.startsWith('/mp/')) return;";assert.ok(source.includes(mpGuard));let mpCaught=false;
try{await mpBypass(source.replace(mpGuard,"if(url.pathname.startsWith('/mp')) {event.respondWith(new Response('wrong'));return;}"));}catch{mpCaught=true;}assert.ok(mpCaught,'mp interception mutation caught');console.log('caught mutation: room interception');
await test(source);console.log('PASS core shell, offline, full-response integrity, ranges, resume, removal and kill');
{
 const legacy=await harness(source),a=legacy.build('legacy','land A',{legacy:true});await legacy.api.latest();legacy.routes.delete('/version.json');const page=await legacy.nav('legacy');
 assert.ok(page.body.includes(a.appUrl),'legacy game script unchanged');assert.match(page.body,/offlineUpdate/,'cached legacy HTML receives the recovery listener');assert.equal(page.response.headers.get('cache-control'),'no-store');
 assert.equal(await(await legacy.get('/terrain/tile.bin','legacy')).text(),'land A');console.log('PASS cached pre-protocol shell recovery listener and pinned data');
}

if(process.argv.includes('--mutations')) {
 for(const [name,from,to] of [
  ['If-Range ignored',"const allowed=!ifRange ||","const allowed=true ||"],
  ['Content-Range omitted',"headers.set('Content-Range',`bytes ${start}-${end}/${size}`);",''],
  ['range status','{status:206,headers}','{status:200,headers}'],
  ['partial accepted',"r.status === 200","r.ok"],
  ['integrity off','await digest(bytes) !== entry.hash','false'],
  ['resume disabled','s.index.files.filter(f=>!keys.has(f.url))','s.index.files.filter(f=>true)'],
  ['remove disabled',"if(event.data.type==='remove') {","if(false) {"],
  ['kill unregister off','await self.registration.unregister();','/* no unregister */']
 ]) {assert.ok(source.includes(from),name+' applies');let caught=false;try{await test(source.replace(from,to));}catch{caught=true;}assert.ok(caught,'escaped '+name);console.log('caught mutation:',name);}
}
{
 const names=new Set(['mmm-offline-broken','other-app']),events={};let unregistered=false,claimed=false;
 const c=vm.createContext({Promise,caches:{keys:async()=>[...names],delete:async n=>names.delete(n)},self:{skipWaiting:async()=>{},registration:{unregister:async()=>{unregistered=true}},clients:{claim:async()=>{claimed=true}},addEventListener:(n,f)=>events[n]=f}});
 vm.runInContext(readFileSync(new URL('../web/pwa/sw-reset.js',import.meta.url),'utf8'),c);let done;events.activate({waitUntil:p=>done=p});await done;assert.ok(unregistered&&claimed);assert.deepEqual([...names],['other-app']);console.log('PASS emergency replacement activation contract');
}
