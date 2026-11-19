import { readBaseline } from './baseline-source.mjs';
// Route selection uses real server source. A frozen ASSETS page proves mail bytes/headers remain untouched.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from '../web/node_modules/esbuild/lib/main.js';
process.on('uncaughtException',e=>{console.error(e.name+': '+e.message);process.exit(1);});
async function worker(source){const r=await build({stdin:{contents:source,resolveDir:process.cwd()+'/server/src',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'local-worker-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'local'}));b.onLoad({filter:/.*/,namespace:'local'},()=>({contents:'export class DurableObject {}'}));}}]});return (await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'))).default;}
const before=await worker(readBaseline('site-worker','server/src/index.ts'));
const source=readFileSync('server/src/index.ts','utf8'),after=await worker(source),seen=[];
const positional=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const file=positional[0],frozen=file?readFileSync(file):Buffer.from('<title>Mabou Mail Madness</title>frozen mail page');
const env={ASSETS:{fetch:r=>{const p=new URL(r.url).pathname;seen.push(p);return new Response(p==='/'?frozen:p,{headers:{'Cache-Control':'no-store','Content-Type':'text/html; charset=utf-8','X-Asset':'unchanged'}});}}};
const hashes=[];
for(const path of ['/','/?area=judique','/nowhere']){
 const request=new Request('https://mmm.fakkeldy.ca'+path);const a=await before.fetch(request,env),b=await after.fetch(request,env);assert.deepEqual([...a.headers],[...b.headers]);assert.equal(a.status,b.status);const x=Buffer.from(await a.arrayBuffer()),y=Buffer.from(await b.arrayBuffer());assert.deepEqual(x,y);hashes.push({path,before:createHash('sha256').update(x).digest('hex'),after:createHash('sha256').update(y).digest('hex')});
}
for(const [address,target,status] of [['https://justdrive.fakkeldy.ca/sugar-camp-quarry','/just/westbay/',200],['http://localhost/?site=just','/just/home/',200],['http://localhost/judique?site=just&area=mabou','/just/judique/',200],['https://justdrive.fakkeldy.ca/','/just/home/',200],['https://justdrive.fakkeldy.ca/?site=just','/just/home/',200],['https://justdrive.fakkeldy.ca/?utm_source=x&fbclid=y','/just/home/',200],['https://justdrive.fakkeldy.ca/nowhere','/just/unknown/',404],['https://justdrive.fakkeldy.ca/mabou-1884','/just/mabou-1884/',200],['http://localhost/mabou-1884?site=just','/just/mabou-1884/',200],['https://justdrive.fakkeldy.ca/judique-1884','/just/judique-1884/',200],['http://localhost/judique-1884?site=just','/just/judique-1884/',200],['https://justdrive.fakkeldy.ca/mabou-1885','/just/unknown/',404]]){seen.length=0;const response=await after.fetch(new Request(address),env);assert.deepEqual(seen,[target]);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');}
for(const method of ['GET','HEAD']) {
 const slash=await after.fetch(new Request('https://justdrive.fakkeldy.ca/mabou-1884/?q=low',{method}),env);
 assert.equal(slash.status,308);assert.equal(slash.headers.get('location'),'https://justdrive.fakkeldy.ca/mabou-1884?q=low');
}
// The bare root is the map of places (tracking tags too); a root with a game query is an old link: a trip goes to its area, the rest to /mabou.
for(const [address,location] of [['https://justdrive.fakkeldy.ca/?area=judique','https://justdrive.fakkeldy.ca/mabou?area=judique'],['http://localhost/?site=just&era=1884','http://localhost/mabou?site=just&era=1884'],['https://justdrive.fakkeldy.ca/?trip=quarry','https://justdrive.fakkeldy.ca/westbay?trip=quarry'],['https://justdrive.fakkeldy.ca/?trip=quarry&area=westbay&mode=explore','https://justdrive.fakkeldy.ca/westbay?trip=quarry&area=westbay&mode=explore'],['http://localhost/?site=just&trip=quarry&area=judique','http://localhost/judique?site=just&trip=quarry&area=judique'],['https://justdrive.fakkeldy.ca/?trip=quarry&area=nowhere','https://justdrive.fakkeldy.ca/westbay?trip=quarry&area=nowhere']]){seen.length=0;const moved=await after.fetch(new Request(address),env);assert.equal(moved.status,308,address);assert.equal(moved.headers.get('location'),location);assert.deepEqual(seen,[]);}
{const local={ASSETS:{fetch:()=>new Response('<a href="/mabou">x</a><a href="https://mmm.fakkeldy.ca/">y</a>',{headers:{'Content-Type':'text/html'}})}};const home=await (await after.fetch(new Request('http://localhost/?site=just'),local)).text();assert.equal(home,'<a href="/mabou?site=just">x</a><a href="https://mmm.fakkeldy.ca/">y</a>');}
console.log('PASS justdrive root: map page, old root queries go to /mabou or the trip area, local links keep ?site=just');
// A nested path must not be rewritten to a valid era card.
seen.length=0;await after.fetch(new Request('https://justdrive.fakkeldy.ca/mabou-1884/x'),env);assert.deepEqual(seen,['/mabou-1884/x']);
// Each host's /about is its own brand's page; /about/ redirects to /about; "about" is never taken for a place.
for(const [address,target] of [['https://mmm.fakkeldy.ca/about','/about/mail/'],['https://justdrive.fakkeldy.ca/about','/about/just/'],['http://localhost/about?site=just','/about/just/'],['http://localhost/about','/about/mail/'],['https://mmm.fakkeldy.ca/help','/help/mail/'],['https://justdrive.fakkeldy.ca/help','/help/just/'],['http://localhost/help?site=just','/help/just/']]){seen.length=0;const response=await after.fetch(new Request(address),env);assert.deepEqual(seen,[target],address);assert.equal(response.status,200,address);}
for(const host of ['mmm.fakkeldy.ca','justdrive.fakkeldy.ca'])for(const page of ['about','help']){seen.length=0;const response=await after.fetch(new Request(`https://${host}/${page}/`),env);assert.equal(response.status,308);assert.equal(response.headers.get('location'),`https://${host}/${page}`);assert.deepEqual(seen,[]);}
for(const path of ['/helpme','/about/x','/aboutx']){seen.length=0;await after.fetch(new Request('https://mmm.fakkeldy.ca'+path),env);assert.deepEqual(seen,[path],path+' is not a page address');}
for(const method of ['POST','PUT']){seen.length=0;await after.fetch(new Request('https://mmm.fakkeldy.ca/about',{method}),env);assert.deepEqual(seen,['/about'],method+' is not a page read');}
console.log('PASS /about and /help serve each brand its own page, trailing slash redirects, only GET and HEAD');
const mp=await after.fetch(new Request('https://justdrive.fakkeldy.ca/mp/v1/mabou/world'),env);assert.equal(mp.status,426);assert.equal(await mp.text(),'Expected a WebSocket');
if(positional[1])writeFileSync(positional[1],JSON.stringify(hashes,null,2));
console.log('PASS frozen mail ASSETS byte/header hashes unchanged before/after; localhost query override; path-only root; unknown 404; multiplayer GET 426');
if(process.argv.includes('--mutations')){
 const changed=await worker(source.replace('readSite(url.hostname, url.pathname, url.searchParams)','readSite(url.hostname, url.pathname)'));seen.length=0;await changed.fetch(new Request('http://localhost/judique?site=just'),env);assert.notDeepEqual(seen,['/just/judique/']);console.log('PASS rejected source mutation: Worker drops localhost override query');
}
