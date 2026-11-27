import { checkStations, radioTextToCheck, START_DIAL, JUST_START_DIAL, SAVED_DIAL, PUBLIC_STATIONS } from './radio-expectations.mjs';
import vm from 'node:vm';
import { Radio } from '../web/src/radio.ts';
import { AREAS } from '../web/src/area.ts';
import { ERAS, readEra } from '../web/src/era.ts';
import { siteRadio } from '../web/src/site.ts';
import { transformSync, build } from '../web/node_modules/esbuild/lib/main.js';
// Exercise the actual builder with tiny authored inputs, then the actual worker with its hashed output.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { harness, hash } from './pwa-harness.mjs';
const dir=mkdtempSync(join(tmpdir(),'mmm-site-offline-'));
try {
 execFileSync('python3',['tools/radio-catalogue-check.py'],{stdio:'inherit'});
 assert.throws(()=>execFileSync('python3',['tools/radio-catalogue-check.py','--drop-station'],{stdio:'pipe'}),error=>error.status===1&&String(error.stderr).includes('Just Drive lost a station or track'),'dropping a generated Just Drive station must fail');
 console.log('PASS generated Just Drive station-drop mutation rejected (exit 1)');
 const plan=JSON.parse(readFileSync('tools/radio_stations.json','utf8'));
 const stations=PUBLIC_STATIONS.map(s=>({dial:s.dial,name:s.name,tracks:s.tracks.map(t=>({file:t.source+'.mp3',title:t.title,seconds:10}))}));
 checkStations(stations,PUBLIC_STATIONS);
 for(const area of AREAS) for(const brand of ['mail','just']) for(const era of ERAS) {
   const resolved=readEra(new URLSearchParams('era='+era.id),area.id);
   assert.equal(resolved.radio,true,brand+' '+area.id+' '+era.id+' offers radio');
   assert.deepEqual(siteRadio({brand,area:area.id}),brand==='just'?{list:'radio-just.json',storageKey:'mmm.radio.just'}:{});
 }
 console.log('PASS radio policy for every area and requested era in both brands (unsupported eras fall back to today)');
 // The Party Line's calls for Get Fired (audio/calls.json, made by build_radio.py): the mail game's offline download holds them.
 const talkDial=PUBLIC_STATIONS.find(s=>s.tracks.some(t=>t.credit==='talk'))?.dial;
 assert.ok(talkDial,'talk station exists in the public catalogue');
 const calls={dial:talkDial,calls:[{file:'talk-react-box-1.mp3',seconds:7,about:'box',caller:'theresa',name:false}],nicknames:[{file:'talk-nick-theresa-box-1.mp3',seconds:1.4,kind:'box',caller:'theresa',name:'Box Basher'}],gaps:{}};
 const callFiles=calls.calls.concat(calls.nicknames).map(c=>'/audio/'+c.file);
 for(const part of ['terrain','audio','offline/icons']) mkdirSync(join(dir,part),{recursive:true});
 for(const [path,body] of [['app.js','globalThis.game=true'],['index.html','<html><head><title>Mabou Mail Madness</title><meta name="description" content="A rural mail route"><link rel="icon" href="old-icon"></head><body><div id="boot"><div><b>Mabou Mail Madness</b>Loading</div></div><script src="./app.js"></script></body></html>'],['terrain/manifest.json','{}'],['audio/radio.json',JSON.stringify({stations,start:START_DIAL})],['audio/radio-just.json',JSON.stringify({stations,start:plan.just_start})],['audio/calls.json',JSON.stringify(calls)],...calls.calls.concat(calls.nicknames).map(c=>['audio/'+c.file,'authored call']),...stations.flatMap(s=>s.tracks.map(t=>['audio/'+t.file,'authored audio'])),...['180','192','512'].map(n=>[`offline/icons/icon-${n}.png`,'icon']),['offline/icons/maskable-512.png','icon']]) writeFileSync(join(dir,path),body);
 execFileSync(process.execPath,['tools/build-pwa.mjs',dir]);
 const json=path=>JSON.parse(readFileSync(dir+path));
 const ordinary=json('/version.json'),just=json('/version-just.json');
 const normalFiles=json(ordinary.index),justFiles=json(just.index);
 for(const [version,index] of [[ordinary,normalFiles],[just,justFiles]]) {
  assert.equal(version.builtAt,index.builtAt);
  assert.match(readFileSync(dir+index.page,'utf8'),new RegExp(`name="mmm-built-at" content="${version.builtAt}"`));
 }
 for(const area of [...AREAS.map(a=>a.id),'mabou-1884','judique-1884']) {
  const html=readFileSync(`${dir}/just/${area}/index.html`,'utf8');
  assert.match(html,new RegExp(`name="mmm-built-at" content="${just.builtAt}"`));
  assert.match(html,new RegExp(`name="mmm-page" content="${just.pageKey}"`));
 }
 assert.ok(normalFiles.files.some(f=>f.url==='/audio/radio.json'),'ordinary radio inventory unchanged');
 assert.ok(!justFiles.files.some(f=>f.url==='/audio/radio.json'),'Just Drive uses its own list');
 assert.ok(justFiles.files.some(f=>f.url==='/audio/radio-just.json'));
 assert.deepEqual(justFiles.files.filter(f=>f.url.endsWith('.mp3')),normalFiles.files.filter(f=>f.url.endsWith('.mp3')&&!callFiles.includes(f.url)),'all shared songs are in both offline inventories');
 for(const url of ['/audio/calls.json',...callFiles]){
  assert.ok(normalFiles.files.some(f=>f.url===url),'the mail game plays Get Fired offline with its calls: '+url);
  assert.ok(!justFiles.files.some(f=>f.url===url),'Just Drive has no Get Fired and saves no calls: '+url);
 }
 console.log('PASS offline: the mail game saves calls.json and every call file; Just Drive saves neither');
 checkStations(json('/audio/radio-just.json').stations,PUBLIC_STATIONS);
 assert.equal(json('/manifest-just.webmanifest').name,'Just Drive: Mabou');
 assert.equal(json('/manifest-just.webmanifest').start_url,'/mabou');
 assert.equal(json('/manifest.webmanifest').name,'Mabou Mail Madness');
 assert.ok(readFileSync(dir+'/index.html','utf8').includes(`name="mmm-just-page" content="${just.pageKey}"`));
 const bad=/\b(mail|post|route|shift|carrier|delivery)\b/i;
 const checkHead=(html,title)=>{
  assert.equal([...html.matchAll(/<title>/g)].length,1);assert.ok(html.includes(`<title>${title}</title>`));
  const description=html.match(/<meta name="description" content="([^"]+)"/)[1];assert.doesNotMatch(description,bad);
  for(const tag of ['title','description','type','url'])assert.match(html,new RegExp(`<meta property="og:${tag}" content="[^"]+"`));
  assert.ok(html.includes(`property="og:title" content="${title}"`));assert.ok(html.includes(`property="og:description" content="${description}"`));
  assert.match(html,/rel="manifest" href="\/manifest-just.webmanifest"/);assert.match(html,/rel="icon" href="data:image\/svg/);assert.doesNotMatch(html,/og:image/);
  const apple=html.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/);if(apple)assert.doesNotMatch(apple[1],bad);
  const boot=html.match(/<div id="boot"><div>([\s\S]*?)<\/div><\/div>/);if(boot)assert.doesNotMatch(boot[1],bad);
 };
 for(const area of AREAS)checkHead(readFileSync(`${dir}/just/${area.id}/index.html`,'utf8'),`Just Drive: ${area.name}`);
 checkHead(readFileSync(dir+'/just/mabou-1884/index.html','utf8'),'Mabou, 1884');
 checkHead(readFileSync(dir+'/just/judique-1884/index.html','utf8'),'Judique, 1884');
 checkHead(readFileSync(dir+'/just/unknown/index.html','utf8'),'Just Drive');
 assert.doesNotMatch(readFileSync(dir+'/just/unknown/index.html','utf8'),/<script/);
 checkHead(readFileSync(dir+justFiles.page,'utf8'),'Just Drive: Mabou');
 for(const index of [normalFiles,justFiles]) for(const f of [...index.shell,...index.files]) {const body=readFileSync(dir+f.url);assert.equal(hash(body),f.hash);assert.equal(body.length,f.bytes);}
 const h=await harness(readFileSync(dir+'/sw.js','utf8'),{origin:'https://justdrive.localhost'});
 for(const f of [...justFiles.shell,...justFiles.files]) h.routes.set(f.url,new Response(readFileSync(dir+f.url)));
 h.routes.set(just.index,new Response(readFileSync(dir+just.index)));
 h.routes.set('/version-just.json',new Response(JSON.stringify(just)));
 h.routes.set(`/offline/start.${just.pageKey}.json`,new Response(JSON.stringify(just)));
 const first=await h.nav('start','mabou?area=judique');assert.equal(first.response.status,200);assert.ok(first.body.includes(just.pageKey),'path wins over area query');
 await h.message('start','start');await h.flush();h.network(false);
 const offline=await h.nav('offline','mabou');assert.ok(offline.body.includes(just.pageKey),'Mabou path works offline');
 const era=await h.nav('era','mabou-1884');assert.equal(era.response.status,200);assert.ok(era.body.includes(just.pageKey),'same Mabou saved shell, era selected by retained alias URL');
 const eraSlash=await h.nav('era-slash','mabou-1884/?q=low');assert.equal(eraSlash.response.status,308);assert.equal(eraSlash.response.headers.get('location'),'https://justdrive.localhost/mabou-1884?q=low');
 for(const path of ['mabou-1885','mabou-1884/x']) { let handled=false;h.listeners.fetch({request:{url:'https://justdrive.localhost/'+path,method:'GET',mode:'navigate'},respondWith(){handled=true;}});assert.equal(handled,false,'unknown path stays with network/404: '+path); }
 const slash=await h.nav('slash','mabou/?touch=1');assert.equal(slash.response.status,308);assert.equal(slash.response.headers.get('location'),'https://justdrive.localhost/mabou?touch=1');
 const root=await h.nav('root','?area=judique');assert.equal(root.response.status,200);assert.ok(root.body.includes(just.pageKey),'root ignores area query in offline worker');
 const home=await h.nav('home','');assert.equal(home.response.status,503,'the bare root is the map of places, a network page');assert.ok(!home.body.includes(just.pageKey),'the map of places never starts the game');assert.match(home.body,/<title>Just Drive<\/title>/);assert.match(home.body,/The map of places needs a connection/);assert.match(home.body,/href="\/mabou\?title=1"/);
 for(const tagged of ['?utm_source=x','?fbclid=y']){const t=await h.nav('home-tag',tagged);assert.equal(t.response.status,503,'a tracking tag still opens the map of places '+tagged);assert.ok(!t.body.includes(just.pageKey));}
 const other=await h.nav('other','judique?area=mabou');assert.equal(other.response.status,503);assert.match(other.body,/Just Drive: Judique/);assert.match(other.body,/href="\/mabou\?title=1"/);assert.doesNotMatch(other.body,/\b(mail|post|route|shift|carrier|delivery)\b/i);
 checkHead(other.body,'Just Drive: Judique');
 const otherEra=await h.nav('other-era','judique-1884');assert.equal(otherEra.response.status,503,'Judique 1884 shares the Judique connection page while only Mabou is saved');assert.match(otherEra.body,/Just Drive: Judique/);
 assert.ok(!h.requests.includes('/version.json'));assert.ok(!h.requests.includes('/audio/radio.json'));
 console.log('PASS real dual inventories/hashes, manifest names, brand page identity, path-first offline start, slash redirect, connection-only area and canonical offline link; Just Drive list and all shared songs; no mail list requests');
} finally {rmSync(dir,{recursive:true,force:true});}

// An installed mail worker on localhost must never be asked to prepare/save a Just Drive preview.
const code=readFileSync('web/src/offline-play.ts','utf8'),work=[],groups=[];
const module={exports:{}};
const context=vm.createContext({module,exports:module.exports,isSecureContext:true,navigator:{serviceWorker:{controller:{postMessage(){work.push('prepare');}},getRegistration(){work.push('registration');}}},document:{createElement:()=>({style:{},setAttribute(){}})}});
vm.runInContext(transformSync(code,{loader:'ts',format:'cjs'}).code,context);
module.exports.offlinePlay({insertBefore:group=>groups.push(group)},null,'just-page','mabou',true,true);
assert.deepEqual(work,[]);assert.equal(groups.length,1);assert.equal(groups[0].textContent,'Offline downloads are not available in this local preview.');assert.ok(!groups[0].innerHTML);
assert.match(readFileSync('web/src/main.ts','utf8'),/__PUBLIC_APP__ && !localJust \? bindOfflineVersion/);
console.log('PASS localhost Just Drive preview offers no download and never contacts an installed mail worker');

const plan=JSON.parse(readFileSync('tools/radio_stations.json','utf8'));
const stations=PUBLIC_STATIONS.map(s=>({...s,tracks:s.tracks.map(t=>({...t,file:t.source+'.mp3',seconds:10}))}));
function savedRadio(RadioClass){
 const saved=Object.fromEntries(['document','Audio','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const element=()=>({style:{},classList:{contains(){return false;},toggle(){},add(){},remove(){}},setAttribute(){},append(){},appendChild(){},addEventListener(){}});
 try{
  globalThis.Audio=class{addEventListener(){}};
  globalThis.document={hidden:false,createElement:element,head:element(),body:element(),getElementById:()=>null,addEventListener(){}};
  for(const [key,start]of[['mmm.radio',START_DIAL],['mmm.radio.just',JUST_START_DIAL],['mmm.radio.just',stations.at(-1).dial]])for(const dial of [null,'retired-dial','off',SAVED_DIAL]){
   globalThis.localStorage={getItem:k=>k===key?dial:null};
   const radio=new RadioClass(stations,'/audio',start,key);
   const expected=dial==='off'?-1:stations.findIndex(s=>s.dial===(dial===SAVED_DIAL?dial:start));
   assert.equal(radio.station,expected,key+' saved dial '+dial);
  }
 }finally{for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}
savedRadio(Radio);
const radioSource=readFileSync('web/src/radio-player.ts','utf8');
const anchor='savedStation : this.first;';assert.ok(radioSource.includes(anchor));
const mutant=await build({entryPoints:['web/src/radio.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'saved-dial-mutant',setup(b){b.onLoad({filter:/radio-player\.ts$/},()=>({contents:radioSource.replace(anchor,'savedStation : saved[0] ? 0 : this.first;'),loader:'ts'}));}}]});
const wrong=await import('data:text/javascript;base64,'+Buffer.from(mutant.outputFiles[0].text).toString('base64'));
assert.throws(()=>savedRadio(wrong.Radio),error=>error.code==='ERR_ASSERTION'&&error.message.includes('saved dial retired-dial'),'unknown saved dial must not fall back to station zero');
console.log('PASS real Radio constructor: unknown/empty saved dial uses each brand start; valid/off kept; station-zero mutant rejected');
const forbidden=/\b(mail|post|route|shift|carrier|delivery)\b/i;
const sample=PUBLIC_STATIONS.find(s=>forbidden.test(s.name))??PUBLIC_STATIONS[0];
const radio={station:`${sample.dial} ${sample.name}`,track:sample.tracks[0].title};radio.text=radio.station+'\n'+radio.track;
for(const extra of ['', ' mail', ' post', ' delivery']){
 const chip={...radio,text:radio.text+extra},scanned=radioTextToCheck('Driving\n'+chip.text,chip,plan);
 assert.equal(forbidden.test(scanned.body)||forbidden.test(scanned.radio),!!extra,'only catalogue fields are allowed in the chip');
}
assert.match(radioTextToCheck('mail outside\n'+radio.text,radio,plan).body,forbidden,'catalogue allowance never hides other body text');
console.log('PASS exact catalogue fields allowed; extra mail/post/delivery text inside radio rejected');
