// Deterministic Cache/Client/Fetch model. Real browser checks cover the same migration boundaries.
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const source=readFileSync(new URL('../web/pwa/sw.js',import.meta.url),'utf8');
let buildOrdinal=Date.now();
export async function harness(code=source,shared={}) {
 const origin=shared.origin ?? 'https://game.test';
 const bins=shared.bins||new Map(),routes=shared.routes||new Map(),listeners={},live=shared.live||new Map(),pageKeys=new Map(),messages=[],requests=[],pending=new Set();
 let fault,online=true,registered=true;
 const key=k=>new URL(typeof k==='string'?k:k.url,origin).pathname;
 const fail=(op,name,path='')=>{if(fault?.op===op&&name.includes(fault.bucket)&&(!fault.key || path.includes(fault.key))){if(fault.once) {const e=fault;fault=undefined;throw new DOMException('blocked',e.name||'SecurityError');}throw new DOMException('blocked',fault.name||'SecurityError');}};
 const caches={open:async name=>{fail('open',name);if(!bins.has(name))bins.set(name,new Map());const bin=bins.get(name);return {
  match:async k=>{fail('match',name);return bin.get(key(k))?.clone();},
  put:async(k,r)=>{fail('put',name,key(k));bin.set(key(k),r.clone());},delete:async k=>bin.delete(key(k)),
  keys:async()=>{fail('keys',name);return [...bin.keys()].map(p=>new Request(origin+p));}
 };},keys:async()=>[...bins.keys()],delete:async n=>bins.delete(n),match:async k=>{fail('match','global');for(const bin of bins.values())if(bin.has(key(k)))return bin.get(key(k)).clone();}};
 const waitUntil=p=>{pending.add(p);p.catch(()=>{}).finally(()=>pending.delete(p));};
 const client=id=>({id,url:typeof live.get(id)==='string'?live.get(id):origin+'/',postMessage:m=>messages.push({id,...m})});
 const context=vm.createContext({caches,crypto:webcrypto,Response,Headers,Request,URL,Map,Set,Uint8Array,TextDecoder,AbortController,AbortSignal,Date,Promise,console,setTimeout,clearTimeout,
  fetch:async(input,opts={})=>{const path=key(input);requests.push(path);if(!online)throw Error('offline');if(opts.signal?.aborted)throw opts.signal.reason;const r=routes.get(path);if(typeof r==='function')return r(opts);if(!r)throw Error('offline');return r.clone();},
  self:{location:{origin:origin},registration:{unregister:async()=>{registered=false;}},skipWaiting:async()=>{},clients:{claim:async()=>{},get:async id=>live.has(id)?client(id):undefined,matchAll:async()=>[...live.keys()].map(client)},addEventListener:(name,f)=>listeners[name]=f}});
 vm.runInContext(code,context);
 const api=vm.runInContext('({latest,stored,resource,range,status,download,kill,collect:typeof collect==="function"?collect:undefined})',context);
 function build(label,data='land A',options={}) {
  const entry=(url,b)=>({url,bytes:Buffer.byteLength(b),hash:hash(b)});
  const builtAt=options.builtAt ?? ++buildOrdinal;
  const app='globalThis.build='+JSON.stringify(label),appUrl='/offline/app.'+hash(app)+'.js',pageKey=hash(label+data+builtAt);
  const page=(options.legacy?'':`<meta name="mmm-page" content="${pageKey}">`)+`<script src="${appUrl}"></script>`,pageUrl='/offline/page.'+hash(page)+'.html';
  const files=[entry('/terrain/tile.bin',data),entry('/terrain/unseen.bin',data+' unseen'),entry('/audio/song.mp3','0123456789'),...(options.areas?[entry('/areas/fixture/manifest.json',JSON.stringify({land:data}))]:[])],shell=[entry(pageUrl,page),entry(appUrl,app)];
  const index={schema:1,...(options.legacy?{}:{builtAt}),...(options.legacy?{}:{pageKey}),page:pageUrl,shell,files},encoded=JSON.stringify(index),revision=hash(encoded),v={schema:1,revision,dataRevision:hash(JSON.stringify(files)),...(options.legacy?{}:{pageKey}),index:'/offline/files.'+revision+'.json'};
  for(const [url,b] of [[pageUrl,page],[appUrl,app],['/terrain/tile.bin',data],['/terrain/unseen.bin',data+' unseen'],['/audio/song.mp3','0123456789'],[v.index,encoded],['/version.json',JSON.stringify(v)],['/offline/start.'+pageKey+'.json',JSON.stringify(v)],['/',page],['/index.html',page]])routes.set(url,new Response(b));
  if(options.areas)routes.set('/areas/fixture/manifest.json',new Response(JSON.stringify({land:data})));
  return {v,index,pageUrl,appUrl,pageKey};
 }
 async function nav(id,query='') {
  live.set(id,origin+'/'+query);let response;const waits=[];
  listeners.fetch({request:{url:origin+'/'+query,method:'GET',mode:'navigate'},clientId:'',resultingClientId:id,waitUntil:p=>{waits.push(p);waitUntil(p);},respondWith:p=>response=p});
  const r=await response;const body=await r.clone().text();const token=/mmm-page" content="([a-f0-9]+)"/.exec(body)?.[1];if(token)pageKeys.set(id,token);
  return {response:r,body,background:Promise.allSettled(waits)};
 }
 async function get(path,id='a',headers={},token=pageKeys.get(id)) {
  if(!live.has(id))live.set(id,true);const url=new URL(path,origin);if(token)url.searchParams.set('mmm-page',token);
  const waits=[];const r=await api.resource(new Request(url,{headers}),url.pathname,{clientId:id,waitUntil:p=>{waits.push(p);waitUntil(p);}});await Promise.allSettled(waits);return r;
 }
 async function message(type,id='a',extra={}) {
  const replies=[];let done;
  listeners.message({data:{type,pageKey:pageKeys.get(id),...extra},source:{id},ports:[{postMessage:r=>replies.push(r),close(){}}],waitUntil:p=>{done=p;waitUntil(p);}});
  await done;return replies;
 }
 const flush=async()=>{for(let i=0;i<10&&pending.size;i++)await Promise.allSettled([...pending]);};
 return {api,build,nav,get,message,flush,bins,routes,caches,context,listeners,live,pageKeys,messages,requests,waitUntil,
  fault:f=>fault=f,network:on=>online=on,close:id=>live.delete(id),registered:()=>registered,
  restart:()=>vm.runInContext('state=undefined;typeof complete!=="undefined"&&(complete=undefined);typeof filling!=="undefined"&&(filling=undefined);typeof ready!=="undefined"&&(ready=undefined);typeof versions!=="undefined"&&versions.clear();typeof bindings!=="undefined"&&bindings.clear();',context)};
}
