// Approved Mabou-only release: other ready areas are connection-only, not silently saved.
import assert from 'node:assert/strict';
import {harness,source} from './pwa-harness.mjs';
async function test(code){
 const h=await harness(code),a=h.build('A');await h.nav('a');await h.message('start','a');await h.flush();
 h.routes.set('/areas/judique/manifest.json',new Response('judique online'));h.routes.set('/areas/porthood/manifest.json',new Response('porthood online'));
 for(const id of ['judique','porthood']) {
  const online=await h.nav(id,'?area='+id);assert.equal(online.response.status,200);assert.equal(await(await h.get('/areas/'+id+'/manifest.json',id)).text(),id+' online');
  h.routes.set('/audio/song.mp3',new Response('online shared radio'));assert.equal(await(await h.get('/audio/song.mp3',id,{},'')).text(),'online shared radio','other-area radio uses the connection');
  h.network(false);const offline=await h.nav(id+'-offline','?area='+id);assert.equal(offline.response.status,503);assert.match(offline.body,/This area needs a connection/);assert.ok(!offline.body.includes(a.appUrl),'never substitute the Mabou game for another area');h.network(true);
 }
 for(const [name,bin]of h.bins)if(name.includes('data-'))assert.ok([...bin.keys()].every(p=>!p.startsWith('/areas/')),'no other-area data stored');
 assert.equal(await(await h.get('/audio/song.mp3','a')).text(),'0123456789','online area audio never overwrites the saved Mabou song');
 h.network(false);assert.ok((await h.nav('mabou','?area=mabou')).body.includes(a.appUrl),'saved Mabou remains playable');
}
await test(source);console.log('PASS two ready online-only areas, honest offline response, no saved other-area files, Mabou retained');
async function dispatch(code){for(const online of [true,false]) {const h=await harness(code);h.network(online);for(const area of ['judique','porthood']){let answered=false;h.listeners.fetch({request:{url:'https://game.test/areas/'+area+'/8/0_0.png',method:'GET',mode:'cors'},respondWith:p=>{answered=true;Promise.resolve(p).catch(()=>{});}});assert.equal(answered,false);}}}
await dispatch(source);console.log('PASS other-area tile requests never enter offline handling, online or offline');
if(process.argv.includes('--mutations'))for(const[name,from,to,run]of[
 ['other area guesses Mabou',"&& !mabouURL(url)) {event.respondWith(connectionNavigation(r));return;}",") {event.respondWith(navigation(event));return;}",test],
 ['other-area resource interception',"if(url.pathname.startsWith('/areas/')) return;",'',dispatch]
]){assert.ok(source.includes(from),name+' applies');let caught=false;try{await run(source.replace(from,to));}catch{caught=true;}assert.ok(caught,'escaped '+name);console.log('caught mutation:',name);}
