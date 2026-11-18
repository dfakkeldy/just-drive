import assert from 'node:assert/strict';
import {readFileSync as read,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {offlineModel} from './offline-models.mjs';
const root=process.argv.slice(2).find(a=>!a.startsWith('--'))??'data/work/pwa/site';
const privatePack=process.env.MMM_PRIVATE_BUILD??'data/work/pwa/artifact-test',privateBuild=privatePack+'/app.js';
const models=readdirSync('web/public/models').filter(name=>name.endsWith('.glb')).sort();
function check(read) {
const dev=read('web/index.html','utf8'),privatePage=read('artifact/page.html','utf8');
assert.equal(dev.match(/<style>([\s\S]*?)<\/style>/)[1],privatePage.match(/<style>([\s\S]*?)<\/style>/)[1],'shell style blocks remain byte-identical');
assert.doesNotMatch(read(privateBuild,'utf8'),/serviceWorker|sw\.js|manifest\.webmanifest|offlinePlay/,'private code compiled out');
assert.doesNotMatch(privatePage,/sw\.js|manifest\.webmanifest/,'private markup inert');
const m=JSON.parse(read(root+'/manifest.webmanifest'));for(const i of m.icons){assert.equal(statSync(root+i.src).isFile(),true);const png=read(root+i.src);const size=Number(i.sizes.split('x')[0]);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
const page=read(root+'/index.html','utf8');assert.match(page,/<script[^>]*src="\/app\.js"/,'ordinary visitor uses the main-site script address');
assert.match(page,/integrity="sha256-[A-Za-z0-9+/]+="/,'ordinary script has browser integrity protection');
const version=JSON.parse(read(root+'/version.json')),index=JSON.parse(read(root+version.index));assert.equal(index.offlineArea,'mabou');assert.equal(Number(/name="mmm-offline-bytes" content="([0-9]+)"/.exec(page)?.[1]),index.totalBytes,'preview includes shell plus Mabou/shared files');assert.ok(index.files.every(f=>!f.url.startsWith('/areas/')),'unopened areas are excluded from offline inventory');const saved=read(root+index.page,'utf8');assert.ok(Number.isSafeInteger(index.builtAt)&&index.builtAt>0,'immutable inventory records build age');assert.match(saved,/<script[^>]*src="\/offline\/app\.[a-f0-9]{64}\.js"/,'saved shell pins its script');assert.doesNotMatch(saved,/integrity=/,'rebuilt saved shell has no stale alias integrity attribute');assert.equal((page.match(/integrity=/g)||[]).length,1,'ordinary script has exactly one integrity attribute');assert.match(page,/mmm-offline-bytes/,'size is delivered without a request');assert.match(page,/viewport-fit=cover/);assert.match(page,/apple-touch-icon/);assert.match(page,/apple-mobile-web-app-capable/);
const headers=read(root+'/_headers','utf8');for(const p of ['/','/index.html','/sw.js','/version.json'])assert.ok(headers.includes(p+'\n  Cache-Control: no-store'));assert.match(headers,/Content-Type: application\/manifest\+json/);
// The models (web/public/models) are site files: the flat build copies no public folder, so each must be carried
// to the public site, to its offline inventory and to the private pack, byte for byte. One rule on top: the mail
// car's files follow its switch (tools/offline-models.mjs). The car is the default, so they are in the inventory;
// with the switch off they would be left out.
assert.ok(models.length>0,'the game has models');
const carSwitch=read('web/src/car-switch.ts','utf8');
assert.ok(models.some(name=>offlineModel(name,carSwitch)),'the offline download carries at least one model');
for(const name of models) {
  const bytes=read('web/public/models/'+name),entry=index.files.find(f=>f.url==='/models/'+name);
  assert.ok(bytes.equals(read(root+'/models/'+name)),'public site carries the model '+name);
  assert.ok(bytes.equals(read(privatePack+'/models/'+name)),'private pack carries the model '+name);
  if(!offlineModel(name,carSwitch)) {assert.ok(!entry,'offline inventory leaves out '+name+' while the mail car is off');continue;}
  assert.ok(entry,'offline inventory lists the model '+name);
  assert.equal(entry.bytes,bytes.length);assert.equal(entry.hash,createHash('sha256').update(bytes).digest('hex'),'offline inventory has the bytes of '+name);
}
assert.ok(headers.includes('/models/*\n  Cache-Control: no-cache\n  Content-Type: model/gltf-binary\n'),'models are served as glTF and revalidated');
}
check(read);console.log('PASS private isolation, byte-identical styles, icon PNG dimensions, viewport, iOS tags, deploy headers, models in the site, the pack and the offline inventory (the mail car\'s only when it is the default)');
if(process.argv.includes('--mutations')) {
  for(const [name,path,change] of [
    ['preview omits shell',root+'/index.html',s=>s.replace(/(name="mmm-offline-bytes" content=")[0-9]+/, '$11')],
    ['unopened area added to inventory',root+JSON.parse(read(root+'/version.json')).index,s=>{const i=JSON.parse(s);i.files.push({url:'/areas/judique/manifest.json',bytes:1,hash:'x'});return JSON.stringify(i);}],
    ['private worker leak',privateBuild,s=>s+';serviceWorker;'],
    ['style drift','web/index.html',s=>s.replace('<style>','<style>body{color:red}')],
    ['ordinary visitor hashed script',root+'/index.html',s=>s.replace('src="/app.js"','src="/offline/app.bad.js"')],
    ['ordinary script integrity removed',root+'/index.html',s=>s.replace(/integrity="[^"]+"/,'')],
    ['viewport fit removed',root+'/index.html',s=>s.replace('viewport-fit=cover','')],
    ['iOS icon removed',root+'/index.html',s=>s.replaceAll('apple-touch-icon','gone')],
    ['stale built headers',root+'/_headers',s=>s.replaceAll('no-store','max-age=3600')],
    ['model missing from the offline inventory',root+JSON.parse(read(root+'/version.json')).index,s=>{const i=JSON.parse(s);i.files=i.files.filter(f=>!f.url.startsWith('/models/'));return JSON.stringify(i);}],
    // The mail car's files follow its switch (tools/offline-models.mjs). It is the default now, so they are in.
    ['the mail car missing from the offline inventory while it is the default',root+JSON.parse(read(root+'/version.json')).index,s=>{const i=JSON.parse(s);const n=i.files.length;i.files=i.files.filter(f=>!/\/models\/mail-car/.test(f.url));assert.equal(n-i.files.length,2,'the inventory held both car files');return JSON.stringify(i);}],
    ['the switch says the code car is the default, but the inventory still holds the mail car','web/src/car-switch.ts',s=>{const t=s.replace('export const BLENDER_CAR_DEFAULT = true;','export const BLENDER_CAR_DEFAULT = false;');assert.notEqual(t,s,'the switch line applies');return t;}],
    ['public site carries another model',root+'/models/'+models[0],s=>Buffer.concat([Buffer.from(s),Buffer.from([0])])],
    ['private pack carries another model',privatePack+'/models/'+models[0],s=>Buffer.concat([Buffer.from(s),Buffer.from([0])])],
    ['model type header removed',root+'/_headers',s=>s.replace('  Content-Type: model/gltf-binary\n','')],
    ['wrong PNG dimensions',root+'/offline/icons/icon-192.png',s=>{s=Buffer.from(s);s.writeUInt32BE(48,16);return s;}]
  ]) {let caught=false;try{check((p,encoding)=>p===path?change(read(p,encoding)):read(p,encoding));}catch{caught=true;}assert.ok(caught,'escaped '+name);console.log('caught mutation:',name);}
}

