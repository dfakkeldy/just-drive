// Pure address rules, real source mutations, storage isolation and canonical invitations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const path='web/src/site.ts', source=readFileSync(path,'utf8');
async function load(text) { const {outputFiles}=await build({stdin:{contents:text,resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,platform:'node',format:'esm',write:false}); return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64')); }
const registry=(await load(source)).SITE_AREAS;
const rows=[];
for(const host of ['justdrive.fakkeldy.ca','justdrive.localhost','JUSTDRIVE.FAKKELDY.CA']) {
 for(const area of registry) for(const path of [`/${area}`,`/${area}/`,`/${area.toUpperCase()}`]) rows.push([host,path,'area=nowhere',{brand:'just',area}]);
 rows.push([host,'/','',{brand:'just',area:'mabou'}],[host,'/nowhere','area=mabou',{brand:'just',area:null}],[host,'/','area=judique',{brand:'just',area:'mabou'}]);
}
for(const host of ['mmm.fakkeldy.ca','artifact.example','notjustdrive.fakkeldy.ca','x.justdrive.fakkeldy.ca','127.0.0.1']) for(const path of ['/','/mabou','/judique','/nowhere']) rows.push([host,path,'site=just&area=judique',{brand:'mail',area:null}]);
rows.push(['localhost','/mabou','site=just',{brand:'just',area:'mabou'}],['localhost','/judique','site=just&area=mabou',{brand:'just',area:'judique'}],['localhost','/','site=just&area=porthood',{brand:'just',area:'mabou'}],['localhost','/nowhere','site=just',{brand:'just',area:null}],['localhost','/mabou','site=other',{brand:'mail',area:null}],['localhost','/mabou','',{brand:'mail',area:null}]);
function verify(m) {
 for(const [host,path,query,expected] of rows) assert.deepEqual(m.readSite(host,path,new URLSearchParams(query)),expected,`${host}${path}?${query}`);
 for(const brand of ['mail','just']) {
  const site={brand,area:'mabou'},q=new URLSearchParams('area=mabou&vehicle=bike&touch=1&site=just');
  assert.deepEqual(m.siteRadio(site),brand==='mail'?{}:{list:'radio-just.json',storageKey:'mmm.radio.just'});
  assert.equal(m.areaAddress(site,'judique','/mabou',q),brand==='just'?'/judique?vehicle=bike&touch=1&site=just':'/mabou?area=judique&vehicle=bike&touch=1&site=just');
  assert.equal(q.get('area'),'mabou','query not mutated');
 }
 assert.equal(m.areaAddress({brand:'just',area:'mabou'},'mabou','/',new URLSearchParams()),'/mabou');
 // A road name can exist in two areas, so an area change drops a start link. The other keys stay.
 for(const brand of ['mail','just']) assert.equal(m.areaAddress({brand,area:'mabou'},'judique','/mabou',new URLSearchParams('start=old-mill-road&vehicle=bike')),brand==='just'?'/judique?vehicle=bike':'/mabou?vehicle=bike&area=judique',`${brand}: an area change drops the start link`);
}
verify(await load(source));
console.log(`PASS ${rows.length} host/path/query cases, canonical links and radio gate`);
if(process.argv.includes('--mutations')) {
 const changes=[['host case','hostname.toLowerCase()','hostname'],['host label',"host.split('.')[0] === 'justdrive'","host.includes('justdrive')"],['override host',"host === 'localhost' && ", ''],['override value',"params.get('site') === 'just'","params.has('site')"],['ignore area query',"segment ?? 'mabou'","segment ?? params.get('area') ?? 'mabou'"],['root',"?? 'mabou'","?? 'judique'"],['area case',"?? 'mabou').toLowerCase()","?? 'mabou')"],['unknown',"?? null","?? 'mabou'"],['radio list',"list: 'radio-just.json'","list: 'radio.json'"],['radio storage',"storageKey: 'mmm.radio.just'","storageKey: 'mmm.radio'"],['path links',"`/${id}` : pathname","pathname : pathname"],['start link kept on area change',"query.delete('start');",'']];
 for(const [label,from,to] of changes) {assert.ok(source.includes(from),label);const m=await load(source.replace(from,to));assert.throws(()=>verify(m),undefined,label);}
 console.log(`PASS ${changes.length} real site source mutations rejected`);
}
const {outputFiles}=await build({stdin:{contents:"export * from './mode'; export {roomInvitation,multiplayerHost} from './mp/switch'; export {vehicleChoice,restoreVehiclePose} from './vehicle-choice';",resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const just={brand:'just',area:'mabou'};
for(const query of ['', 'mode=mail','mode=explore']) assert.equal(m.readMode(new URLSearchParams(query),()=>{throw Error('storage read');},just),'explore');
globalThis.location={hostname:'justdrive.fakkeldy.ca',pathname:'/mabou',search:'?mode=mail',reload(){throw Error('reload');}};
Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('storage accessed');}});
m.chooseMode('mail');assert.equal(location.search,'?mode=mail');
assert.equal(m.multiplayerHost('justdrive.fakkeldy.ca'),true);
assert.equal(m.roomInvitation('https://justdrive.fakkeldy.ca','/mabou','abcd','judique'),'https://justdrive.fakkeldy.ca/mabou?room=abcd');
assert.equal(m.roomInvitation('https://mmm.fakkeldy.ca','/','abcd','judique'),'https://mmm.fakkeldy.ca/?room=abcd&area=judique');
console.log('PASS Just Drive mode never reads/writes storage, host switch and both invitation forms');

const config=readFileSync('deploy/wrangler.jsonc','utf8');for(const origin of ['https://justdrive.fakkeldy.ca','http://justdrive.fakkeldy.ca'])assert.ok(config.includes(origin),origin+' allowed');
console.log('PASS both Just Drive origins in deployment configuration');

assert.equal(m.roomInvitation('http://localhost:5351','/mabou','abcd','judique',new URLSearchParams('site=just')),'http://localhost:5351/mabou?room=abcd&site=just');
console.log('PASS localhost brand override retained by canonical invitation');

assert.equal(m.roomInvitation('https://justdrive.fakkeldy.ca','/','abcd','judique',new URLSearchParams('area=judique')),'https://justdrive.fakkeldy.ca/mabou?room=abcd');

const poses=new Map();globalThis.sessionStorage={setItem:(k,v)=>poses.set(k,v),getItem:k=>poses.get(k)??null,removeItem:k=>poses.delete(k)};
location.hostname='justdrive.fakkeldy.ca';location.pathname='/';location.search='?area=judique&vehicle=car';
let placed=0;const vehicle={x:1,z:2,heading:.3,bounds:null,place(){placed++;}};
m.vehicleChoice('car',vehicle).choose('bike');assert.equal(JSON.parse(poses.get('mmm.vehicle.pose')).area,'mabou');assert.equal(m.restoreVehiclePose(vehicle),true);assert.equal(placed,1);
location.hostname='mmm.fakkeldy.ca';location.search='?area=judique&vehicle=car';m.vehicleChoice('car',vehicle).choose('bike');assert.equal(JSON.parse(poses.get('mmm.vehicle.pose')).area,'judique');
console.log('PASS vehicle choice/pose uses path-only Just Drive root; mail area query unchanged');

assert.deepEqual(JSON.parse(config.match(/\"run_worker_first\":\s*(\[[^\]]*\])/)[1]),['/mp/*','/']);console.log('PASS only exact root and existing multiplayer paths are Worker-first');
