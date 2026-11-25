// Actual local Worker HTTP contract, including static asset priority and pre-script metadata.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AREAS} from '../web/src/area.ts';
const [base,site,out]=process.argv.slice(2),table=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const request=(host,path,extra={},method='GET')=>new Promise((resolve,reject)=>{http.request(base+path,{method,headers:{Host:host,...extra}},response=>{const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));}).on('error',reject).end();});
const paths=['/sugar-camp-quarry','/','/mabou','/mabou/','/mabou-1884','/mabou-1884/','/mabou-1885','/mabou-1884/x','/judique-1884','/judique-1884/','/judique','/nowhere','/?area=judique','/?utm_source=x','/app.js','/sw.js','/version.json','/version-just.json','/mp/v1/mabou/world','/about','/about/','/help','/help/'];
for(const host of ['mmm.fakkeldy.ca','justdrive.fakkeldy.ca','localhost'])for(const path of [...paths,...(host==='justdrive.fakkeldy.ca'?AREAS.map(a=>'/'+a.id):[])]){
 const asked=path+(host==='localhost'?(path.includes('?')?'&':'?')+'site=just':'');const r=await request(host,asked),just=host!=='mmm.fakkeldy.ca',u=new URL(path,'https://example.test');
 let expected=200,asset;
 if(/^\/(about|help)$/.test(u.pathname))asset=site+u.pathname+'/'+(just?'just':'mail')+'/index.html';
 else if(/^\/(about|help)\/$/.test(u.pathname))expected=308;
 else if(['/app.js','/sw.js','/version.json','/version-just.json'].includes(u.pathname))asset=site+u.pathname;
 else if(u.pathname.startsWith('/mp/'))expected=426;
 else if(!just){if(u.pathname==='/')asset=site+'/index.html';else expected=404;}
 else if(['/mabou/','/mabou-1884/','/judique-1884/'].includes(u.pathname))expected=308;
 else if(u.pathname==='/mabou-1884/x')expected=404;
 else if(u.pathname==='/sugar-camp-quarry')asset=site+'/just/westbay/index.html';
 else if(['/mabou-1884','/judique-1884'].includes(u.pathname))asset=site+'/just'+u.pathname+'/index.html';
 else if(u.pathname==='/'&&u.search&&!u.searchParams.has('utm_source'))expected=308;
 else if(u.pathname==='/')asset=site+'/just/home/index.html';
 else {const id=u.pathname.split('/').filter(Boolean)[0]?.toLowerCase()??'mabou',area=AREAS.find(a=>a.id===id);asset=site+'/just/'+(area?.id??'unknown')+'/index.html';if(!area)expected=404;}
 assert.equal(r.status,expected,host+asked);
 if (u.pathname==='/app.js') assert.equal(r.headers['cache-control'],'no-cache','unhashed app must revalidate');
 if (u.pathname.startsWith('/version')) assert.equal(r.headers['cache-control'],'no-store','version must be fresh');
 if(asset){let expected=readFileSync(asset);if(host==='localhost'&&['/','/nowhere','/mabou-1885'].includes(u.pathname))expected=Buffer.from(expected.toString().replace(/(<a\b[^>]*href="\/[^"?]+)(")/g,'$1?site=just$2'));assert.equal(sha(r.body),sha(expected),host+asked+' asset bytes');}
 if(!just && expected===404)assert.equal(r.body.length,0,'mail empty 404 unchanged');
 if(expected===308)assert.equal(r.headers.location,u.pathname==='/'?`http://${host}/mabou${u.search}${host==='localhost'?'&site=just':''}`:`http://${host}${u.pathname.slice(0,-1)}${host==='localhost'?'?site=just':''}`);
 if(u.pathname==='/mabou-1884'&&just){assert.match(r.body.toString(),/<title>Mabou, 1884<\/title>/);assert.match(r.body.toString(),/property="og:url" content="https:\/\/justdrive.fakkeldy.ca\/mabou-1884"/);}
 if(u.pathname==='/judique-1884'&&just){assert.match(r.body.toString(),/<title>Judique, 1884<\/title>/);assert.match(r.body.toString(),/property="og:url" content="https:\/\/justdrive.fakkeldy.ca\/judique-1884"/);}
 if(asset?.endsWith('index.html')&&!/^\/(about|help)$/.test(u.pathname)){
  assert.equal(r.headers['cache-control'],'no-store');const text=r.body.toString();assert.equal([...text.matchAll(/<title>/g)].length,1);
  if(just){const title=text.match(/<title>([^<]+)<\/title>/)[1];assert.doesNotMatch(title,/\b(mail|post|route|shift|carrier|delivery)\b/i);for(const tag of ['title','description','type','url'])assert.match(text,new RegExp('property="og:'+tag+'"'));assert.match(text,/rel="manifest" href="\/manifest-just.webmanifest"/);assert.match(text,/rel="icon" href="data:image\/svg/);}
 }
 table.push({host,path:asked,status:r.status,bytes:r.body.length,sha256:sha(r.body),title:r.body.toString().match(/<title>([^<]+)<\/title>/)?.[1]??'',cache:r.headers['cache-control']??'',location:r.headers.location??''});
}
// Just Listen is one file at the same path on every host. It is a real file, so the script never takes "/listen" for
// a place to drive in; the address without the slash goes to the one with it.
for(const host of ['mmm.fakkeldy.ca','justdrive.fakkeldy.ca','localhost']){
 const page=await request(host,'/listen/');assert.equal(page.status,200,host+'/listen/');
 assert.equal(sha(page.body),sha(readFileSync(site+'/listen/index.html')),host+' Just Listen bytes');assert.equal(page.headers['cache-control'],'no-cache',host+' Just Listen is checked for a new copy at each visit');
 const bare=await request(host,'/listen');assert.ok([301,307,308].includes(bare.status)&&new URL(bare.headers.location,'http://'+host).pathname==='/listen/',host+'/listen goes to /listen/ ('+bare.status+' '+bare.headers.location+')');
 const picture=await request(host,'/listen/icon-512.png');assert.equal(picture.status,200,host+' lock-screen picture');assert.equal(sha(picture.body),sha(readFileSync(site+'/offline/icons/icon-512.png')));
 table.push({host,path:'/listen/',status:page.status,bytes:page.body.length,sha256:sha(page.body),title:page.body.toString().match(/<title>([^<]+)<\/title>/)?.[1]??'',cache:page.headers['cache-control']??'',location:''});
}
// Short link for River Denys Mountain church (deploy/_redirects): served by static assets with no Worker run.
for(const host of ['justdrive.fakkeldy.ca','mmm.fakkeldy.ca','localhost'])for(const path of ['/rdmc','/rdmc/'])for(const method of ['GET','HEAD']){
 const r=await request(host,path,{},method);assert.equal(r.status,302,`${method} ${host}${path}`);
 const dest=new URL(r.headers.location,'https://'+host);
 assert.equal(dest.hostname,'justdrive.fakkeldy.ca',`${method} ${host}${path} host`);
 assert.equal(dest.pathname+dest.search,'/judique?driveAt=630770.2,5080667.56,84',`${method} ${host}${path} target`);
 assert.equal(r.headers['cache-control'],undefined,`${method} ${host}${path} served by static assets, not Worker no-store`);
 if(host!=='justdrive.fakkeldy.ca')assert.equal(r.headers.location,'https://justdrive.fakkeldy.ca/judique?driveAt=630770.2,5080667.56,84',`${method} ${host}${path} cross-host location`);
 if(method==='GET')table.push({host,path,status:r.status,bytes:r.body.length,sha256:sha(r.body),title:'',cache:r.headers['cache-control']??'',location:r.headers.location??''});
}
// Short link to the mail game on Blackstone Road: the same 302 on every host, with no Worker run.
for(const host of ['justdrive.fakkeldy.ca','mmm.fakkeldy.ca','localhost'])for(const path of ['/blackstone','/blackstone/'])for(const method of ['GET','HEAD']){
 const r=await request(host,path,{},method);assert.equal(r.status,302,`${method} ${host}${path}`);
 const dest=new URL(r.headers.location,'https://'+host);
 assert.equal(dest.hostname,'mmm.fakkeldy.ca',`${method} ${host}${path} host`);
 assert.equal(dest.pathname+dest.search,'/?mode=mail&start=blackstone-road:0.43',`${method} ${host}${path} target`);
 if(host!=='mmm.fakkeldy.ca'&&host!=='localhost')assert.equal(r.headers.location,'https://mmm.fakkeldy.ca/?mode=mail&start=blackstone-road:0.43',`${method} ${host}${path} cross-host location`);
 assert.equal(r.headers['cache-control'],undefined,`${method} ${host}${path} served by static assets, not Worker no-store`);
 if(method==='GET')table.push({host,path,status:r.status,bytes:r.body.length,sha256:sha(r.body),title:'',cache:r.headers['cache-control']??'',location:r.headers.location??''});
}
{
 const r=await request('justdrive.fakkeldy.ca','/judique?driveAt=630770.2,5080667.56,84');
 assert.equal(r.status,200,'justdrive church redirect target');
 assert.match(r.body.toString(),/<title>Just Drive: Judique<\/title>/);
}
// A repeat visit sends the page's ETag back. A known place may answer 304; a place that does not exist
// must answer 404 WITH the page that lists the places, never an empty 404.
for(const [path,want] of [['/nowhere',404],['/mabou',304],['/mabou-1884',304],['/judique-1884',304],['/mabou-1885',404],['/',304]]){
 const first=await request('justdrive.fakkeldy.ca',path),etag=first.headers.etag;assert.ok(etag,'ETag on '+path);
 const again=await request('justdrive.fakkeldy.ca',path,{'If-None-Match':etag,'If-Modified-Since':new Date().toUTCString()});
 assert.equal(again.status,want,'conditional '+path);
 if(want===404){assert.equal(sha(again.body),sha(first.body),'conditional 404 keeps its page');assert.match(again.body.toString(),/href="\/mabou"/);}
 else assert.equal(again.body.length,0);
}
// A changed published script must not reuse the old body's validator.
const app=await request('mmm.fakkeldy.ca','/app.js');
assert.ok(app.headers.etag,'app validator exists');
assert.equal((await request('mmm.fakkeldy.ca','/app.js',{'If-None-Match':'"previous-build"'})).status,200);
assert.equal((await request('mmm.fakkeldy.ca','/app.js',{'If-None-Match':app.headers.etag})).status,304);
if(out)writeFileSync(out,JSON.stringify(table,null,2));console.table(table.map(({host,path,status,title,cache,location})=>({host,path,status,title,cache,location})));console.log('PASS both hosts and localhost override: pages, no-script metadata, unchanged mail/asset bytes, path-only root, canonical redirect, repeat visits and multiplayer');
