/* Public host only, installed only after the player asks to download.
 * A COMPLETE shell + data version remains saved and remains the offline choice until
 * a newer version is COMPLETE. Online selection never promotes incomplete data.
 * Collection protects that complete version, every live page, and the version being filled.
 * Offline scope is Mabou terrain/coast, the models and the shared radio; other areas stay on the network.
 * Bind a page before serving its data. No polling or frame-loop work.
 * Just Listen (/listen/) is a page of its own, outside every download. The worker never answers for /listen/ files.
 * The songs that page asks for go to the network, and nothing of it is saved here. The page is known by its client
 * address, never by a referrer (a script can set that).
 */
const JUST = new URL(self.location.origin).hostname.split('.')[0].toLowerCase() === 'justdrive';
const areaPath = url => { const id = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase(); return typeof JUST_ALIASES !== 'undefined' && Object.hasOwn(JUST_ALIASES, id) ? JUST_ALIASES[id] : id; };
// The Just Drive bare root is the map of places (tools/just-home.mjs), a network page. A root with a game query is an old
// game link; the site key and link-tracking tags (as in server/src/index.ts) do not count.
const justHome = url => JUST && url.pathname==='/' && ![...url.searchParams.keys()].some(k => k!=='site' && k!=='fbclid' && k!=='gclid' && !k.startsWith('utm_'));
const gameNavigation = url => (url.pathname==='/' && !justHome(url)) || url.pathname==='/index.html' || (JUST && /^\/[^/]+\/?$/.test(url.pathname) && (typeof JUST_AREAS === 'undefined' ? [] : JUST_AREAS).includes(url.pathname.split('/').filter(Boolean)[0]?.toLowerCase()));
const listenPath = path => path==='/listen' || path.startsWith('/listen/');
const PREFIX = 'mmm-offline-', META = PREFIX + 'meta-v1', KEY = '/__mmm_offline_state', READY = '/__mmm_offline_ready', COMPLETE = '/__mmm_offline_complete', FILL = '/__mmm_offline_fill';
const NAVIGATION_BUDGET_MS = 1000, BACKGROUND_BUDGET_MS = 30000;
const UPDATE_TEXT = 'A new version of the game is ready. Start again to get it.';
let state, ready, complete, filling, loading, job, order = 0, disabled = false, generation = 0;
const versions = new Map(), bindings = new Map(), pageLoads = new Map();
const full = r => r && r.status === 200 && r.type !== 'opaque' && !r.headers.has('Content-Range');
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const shellName = s => PREFIX + 'shell-' + s.version.revision;
const dataName = s => PREFIX + 'data-' + s.version.dataRevision;
const versionKey = revision => '/__mmm_version/' + revision;
const bindingKey = id => '/__mmm_client/' + encodeURIComponent(id);
const hold = (event, promise) => { if (event?.waitUntil) event.waitUntil(promise.catch(() => {})); else promise.catch(() => {}); };
const storageFailure = cause => Object.assign(new Error('Saving is not available in this window.'), { storageFailure:true, cause });
async function openStore(name) { if(disabled) throw storageFailure(Error('Offline saving is off.')); try { return await caches.open(name); } catch(e) { throw storageFailure(e); } }
async function matchStore(cache, key) { try { return await cache.match(key); } catch(e) { throw storageFailure(e); } }
function prepare(s) {
  const known=versions.get(s.version.revision);if(known) return known;
  s.order = s.index.builtAt || s.order || Math.max(Date.now(),order+1); order=Math.max(order,s.order);
  s.pageKey = s.index.pageKey || s.version.pageKey || s.version.revision;
  s.entries = new Map([...s.index.shell, ...s.index.files].map(f => [f.url, f]));
  versions.set(s.version.revision,s); return s;
}
// New builds outrank legacy records; immutable build time orders late reports from older tabs.
const newestFirst=(a,b)=>Number(!!b.index.builtAt)-Number(!!a.index.builtAt) || b.order-a.order;
const record = s => JSON.stringify({ version:s.version, index:s.index, order:s.order });
async function stored() {
  if (state) return state;
  const r = await matchStore(await openStore(META),KEY);
  if (r) state = prepare(await r.json());
  return state;
}
// Only a durable, verified full download can advance COMPLETE. Never use KEY/READY as proof.
async function offlineComplete() {
  const meta=await openStore(META),saved=[];
  for(const key of await meta.keys()) {
    const path=new URL(key.url).pathname;
    if(path===COMPLETE || path.startsWith(COMPLETE+'/')) {const r=await matchStore(meta,key);if(r)saved.push(prepare(await r.json()));}
  }
  // Per-version completion records are append-only: an old worker cannot overwrite a newer completion.
  complete=saved.sort(newestFirst)[0];
  if(!complete) {
    // Migrate fully saved pre-protocol downloads; a shell-only old KEY is not complete.
    const candidates=[];
    for(const key of await meta.keys()) if(new URL(key.url).pathname.startsWith('/__mmm_version/')) {
      const r=await matchStore(meta,key);if(r)candidates.push(prepare(await r.json()));
    }
    for(const s of candidates.sort(newestFirst)) if(await isComplete(s)) {await promoteComplete(s);break;}
  }
  if(!ready) {const r=await matchStore(meta,READY);if(r)ready=prepare(await r.json());}
  // A fill may finish after a newer app-only shell was prepared. Its shared data is now complete too.
  if(complete && ready && newestFirst(ready,complete)<0 && ready.version.dataRevision===complete.version.dataRevision) {
    try {await promoteComplete(ready);}catch { /* Keep the prior committed choice if promotion has no room. */ }
  }
  return complete;
}
async function isComplete(s) {
  const data=await openStore(dataName(s)),shell=await openStore(shellName(s));
  const paths=new Set((await data.keys()).map(r=>new URL(r.url).pathname));
  if(!s.index.files.every(f=>paths.has(f.url))) return false;
  for(const f of s.index.shell) if(!await matchStore(shell,f.url))return false;
  return true;
}
async function promoteComplete(s) {
  if(!await isComplete(s))return false;
  const meta=await openStore(META);
  await meta.put(COMPLETE+'/'+s.version.revision,new Response(record(s)));
  if(!complete || newestFirst(s,complete)<=0) complete=s;
  if(filling?.version.revision===s.version.revision) {await meta.delete(FILL);filling=undefined;}
  return true;
}
async function remembered(revision) {
  if (versions.has(revision)) return versions.get(revision);
  const r = await matchStore(await openStore(META),versionKey(revision));
  if (r) return prepare(await r.json());
  const current = await stored();
  return current?.version.revision === revision ? current : undefined;
}
async function binding(id) {
  if (bindings.has(id)) return bindings.get(id);
  const r = await matchStore(await openStore(META),bindingKey(id));
  if (r) { const b = await r.json(); bindings.set(id,b); return b; }
}
function bind(id, s, event, seen = true) {
  if (!id || !s || disabled) return;
  const b = { revision:s.version.revision, seen, at:Date.now() }; bindings.set(id,b);
  hold(event,(async()=>{
    const cache = await openStore(META);
    await cache.put(versionKey(b.revision),new Response(record(s)));
    await cache.put(bindingKey(id),new Response(JSON.stringify(b)));
  })());
}
async function forget(id) {
  if (!id) return;
  bindings.delete(id);
  try { await (await openStore(META)).delete(bindingKey(id)); } catch { /* Storage can be unavailable. */ }
}
async function checked(entry, signal) {
  const r = await fetch(entry.url,{cache:'no-store',signal});
  if (!full(r)) throw Object.assign(new Error('Download failed. Try again online.'),{integrity:true});
  const bytes = await r.arrayBuffer();
  if ((entry.bytes !== undefined && bytes.byteLength !== entry.bytes) || await digest(bytes) !== entry.hash) {
    throw Object.assign(new Error(UPDATE_TEXT),{integrity:true});
  }
  const headers = new Headers(r.headers); headers.delete('Content-Encoding'); headers.set('Content-Length',String(bytes.byteLength));
  return new Response(bytes,{status:200,headers});
}
async function notify(id, type) {
  try { const client = await self.clients.get?.(id); client?.postMessage({type,text:UPDATE_TEXT}); } catch { /* Closed page. */ }
}
async function unavailable(event) {
  hold(event,notify(event?.clientId,'version-unavailable'));
  return new Response(JSON.stringify({error:UPDATE_TEXT}),{status:409,headers:{'Content-Type':'application/json','X-MMM-Update':'1','Cache-Control':'no-store'}});
}
async function collect() {
  // A close event is not sent to workers. Collect at navigation/setup/settings activity.
  if (!self.clients.matchAll || disabled) return;
  try {
    const live = (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>{const u=new URL(c.url),p=u.pathname;return mabouURL(u) && (gameNavigation(u) || p.startsWith('/offline/page.'));});
    const ids = new Set(live.map(c=>c.id)), cache = await openStore(META);
    for (const key of await cache.keys()) {
      const path = new URL(key.url).pathname;
      if (path.startsWith('/__mmm_client/')) {
        const id = decodeURIComponent(path.slice('/__mmm_client/'.length));
        if (!bindings.has(id)) { const r = await cache.match(key); if(r) bindings.set(id,await r.json()); }
      }
    }
    if(!ready) {const r=await cache.match(READY);if(r) ready=prepare(await r.json());}
    const saved=await offlineComplete();
    if(!filling) {const r=await matchStore(cache,FILL);if(r)filling=prepare(await r.json());}
    const keep = new Set([state?.version.revision,ready?.version.revision,saved?.version.revision,filling?.version.revision].filter(Boolean));
    if(job) keep.add(job.state.version.revision);
    for (const [id,b] of bindings) {
      if (ids.has(id) || (!b.seen && Date.now()-b.at < 30000)) keep.add(b.revision);
      else { bindings.delete(id); await cache.delete(bindingKey(id)); }
    }
    // An unbound live page might still be starting. Preserve stores until it identifies itself.
    if (live.some(c=>!bindings.has(c.id))) {for(const revision of versions.keys()) if(!keep.has(revision)) versions.delete(revision);return;}
    const data = new Set(), shells = new Set();
    for (const revision of keep) {
      const s = await remembered(revision);
      if(s) { data.add(dataName(s)); shells.add(shellName(s)); }
    }
    for (const name of await caches.keys()) {
      if ((name.startsWith(PREFIX+'data-') && !data.has(name)) || (name.startsWith(PREFIX+'shell-') && !shells.has(name))) await caches.delete(name);
    }
    for (const key of await cache.keys()) {
      const path = new URL(key.url).pathname;
      if((path.startsWith('/__mmm_version/') && !keep.has(path.slice('/__mmm_version/'.length))) || (path.startsWith(COMPLETE+'/') && !keep.has(path.slice(COMPLETE.length+1)))) await cache.delete(key);
    }
    for(const revision of versions.keys()) if(!keep.has(revision)) versions.delete(revision);
  } catch { /* Cleanup must never block ordinary play. */ }
}
async function kill() {
  disabled = true; generation++; job?.controller.abort();
  if(job) await job.done.catch(()=>{});
  await Promise.all((await caches.keys()).filter(n=>n.startsWith(PREFIX)).map(n=>caches.delete(n)));
  state=undefined; ready=undefined; complete=undefined; filling=undefined; // An unregistered worker still controls its old documents: retain their read-only identities.
  await self.registration.unregister();
}
function validate(v) {
  if(v.schema!==1 || !/^[a-f0-9]{64}$/.test(v.revision) || !/^[a-f0-9]{64}$/.test(v.dataRevision) || v.index!==`/offline/files.${v.revision}.json`) throw Error('Invalid game version.');
}
async function indexFor(v, signal) {
  validate(v);
  if(versions.has(v.revision)) return versions.get(v.revision);
  try {const saved=await remembered(v.revision);if(saved) return saved;} catch { /* Fetch metadata on a healthy network if storage is blocked. */ }
  const r = await fetch(v.index,{cache:'no-store',signal});
  if(!full(r)) throw Error('Download failed. Try again online.');
  const bytes = await r.arrayBuffer();
  if(await digest(bytes)!==v.revision) throw Object.assign(new Error(UPDATE_TEXT),{integrity:true});
  const index=JSON.parse(new TextDecoder().decode(bytes));
  if(index.builtAt!==undefined && (!Number.isSafeInteger(index.builtAt) || index.builtAt<=0)) throw Error('Invalid game build time.');
  if(index.schema!==1 || !index.shell.some(f=>f.url===index.page) || (v.pageKey && index.pageKey!==v.pageKey)) throw Error('Invalid game files.');
  for(const f of [...index.shell,...index.files]) if(!/^\/(offline|terrain|audio|models)\/[\w./-]+$/.test(f.url) && f.url!=='/manifest.webmanifest' && f.url!=='/manifest-just.webmanifest') throw Error('Invalid game path.');
  return prepare({version:v,index});
}
async function saveShell(s,signal) {
  const cache=await openStore(shellName(s));
  // In parallel: the shell holds app.js and its chunks (web/area-chunks-build.ts), and each file is one request.
  await Promise.all(s.index.shell.map(async f=>{if(!await matchStore(cache,f.url)) await cache.put(f.url,await checked(f,signal));}));
  await (await openStore(META)).put(versionKey(s.version.revision),new Response(record(s)));
}
async function saveDelivered(s) {
  await saveShell(s,AbortSignal.timeout(BACKGROUND_BUDGET_MS));
  if(!state) {await (await openStore(META)).put(KEY,new Response(record(s)));state=s;}
  const next=await latest();return next;
}
async function checkLatest() {
  if(disabled) return {state:null,verified:true};
  if(loading) return loading;
  loading=(async()=>{
    let old;
    try {
      old=await stored();
      await offlineComplete();
      const signal=AbortSignal.timeout(BACKGROUND_BUDGET_MS);
      const r=await fetch(JUST ? '/version-just.json' : '/version.json',{cache:'no-store',signal});
      if(!full(r)) throw Error('Version unavailable.');
      const v=await r.json();
      if(v.disabled===true) { await kill(); return {state:null,verified:true}; }
      validate(v);
      if(old?.version.revision===v.revision) {
        if(ready && ready.version.revision!==v.revision) {ready=old;await (await openStore(META)).put(READY,new Response(record(old)));}
        return {state:old,verified:true};
      }
      if(ready?.version.revision===v.revision) return {state:ready,verified:true};
      const next=await indexFor(v,signal);await saveShell(next,signal);
      // Only a complete, verified shell becomes the next start. Live pages keep their own bindings.
      const meta=await openStore(META);
      await meta.put(versionKey(v.revision),new Response(record(next)));
      await meta.put(READY,new Response(record(next)));
      ready=next;
      await promoteComplete(next);
      if(!old) {await meta.put(KEY,new Response(record(next)));state=next;}
      return {state:next,verified:true};
    } catch(e) { if(e.storageFailure) throw e; return {state:old,verified:false}; }
  })();
  try { return await loading; } finally { loading=undefined; }
}
async function latest() {return (await checkLatest()).state;}
async function forPage(pageKey, id, event) {
  let b;
  try { b=await binding(id); } catch { /* Recover identity from the page's immutable bootstrap. */ }
  if(b) {
    let s;
    try { s=await remembered(b.revision); } catch { /* The in-memory state may still be available. */ }
    if(s && (!pageKey || pageKey===s.pageKey)) { if(!b.seen) bind(id,s,event); return s; }
    if(s) return null; // Never silently rebind a running page to another build.
  }
  if(pageKey) {
    let s=[...versions.values()].find(s=>s.pageKey===pageKey);
    if(!s) {
      try {
        const meta=await openStore(META);
        for(const key of await meta.keys()) if(new URL(key.url).pathname.startsWith('/__mmm_version/')) {
          const r=await meta.match(key); if(r) { const candidate=prepare(await r.json()); if(candidate.pageKey===pageKey) { s=candidate; break; } }
        }
      } catch { /* Healthy network can recover even when storage is blocked. */ }
    }
    if(!s) {
      let pending=pageLoads.get(pageKey);
      if(!pending) {
        pending=(async()=>{
          try {
            const r=await fetch(`/offline/start.${pageKey}.json`,{cache:'no-store',signal:AbortSignal.timeout(BACKGROUND_BUDGET_MS)});
            if(!full(r)) return null;
            const v=await r.json();
            if(v.disabled===true) {const s=await indexFor(v,AbortSignal.timeout(BACKGROUND_BUDGET_MS));await kill();return s;}
            if(v.pageKey!==pageKey) return null;
            return await indexFor(v,AbortSignal.timeout(BACKGROUND_BUDGET_MS));
          } catch {return null;}
          finally {pageLoads.delete(pageKey);}
        })();pageLoads.set(pageKey,pending);
      }
      s=await pending;if(!s) return null;
    }
    bind(id,s,event); return s;
  }
  if(id!=='__non_client__') return null; // A legacy running page with no identity must restart, never borrow the latest data.
  // Old saved shells have no page token. Their navigation binding remains authoritative.
  // Test/non-client callers get a stable binding as well; never switch them underneath a fetch.
  let s;
  try { s=await stored(); } catch { return undefined; }
  if(s) bind(id,s,event);
  return s;
}
async function pageResponse(s) { return matchStore(await openStore(shellName(s)),s.index.page); }
async function deliveredPage(response,s) {
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
  if(s.index.pageKey) return new Response(response.body,{status:response.status,headers});
  // A previously saved shell can predate the message listener. Keep its game script, add only recovery UI.
  const listener=`<script>navigator.serviceWorker.addEventListener('message',e=>{if(!['update-ready','version-unavailable'].includes(e.data?.type))return;const show=()=>{if(document.getElementById('offlineUpdate'))return;document.getElementById('boot')?.remove();const n=document.createElement('aside');n.id='offlineUpdate';n.setAttribute('role','status');n.style.cssText='position:fixed;z-index:100;left:8px;right:8px;top:calc(68px + env(safe-area-inset-top));padding:12px;background:#0b1620;color:white;font:14px system-ui';const t=document.createElement('span');t.textContent=${JSON.stringify(UPDATE_TEXT)};const b=document.createElement('button');b.id='offlineReload';b.textContent='Start again';b.style.cssText='min-height:44px;margin-left:12px';b.onclick=()=>location.reload();n.append(t,b);document.body.append(n);};if(document.body)show();else addEventListener('DOMContentLoaded',show,{once:true});});</script>`;
  const html=await response.text();headers.delete('Content-Length');headers.delete('ETag');
  return new Response(html.includes('</body>')?html.replace('</body>',listener+'</body>'):html+listener,{status:response.status,headers});
}
function mabouURL(url) {return (JUST ? (areaPath(url)==='index.html' ? 'mabou' : areaPath(url) || 'mabou') : url.searchParams.get('area') || 'mabou')==='mabou';}
async function connectionNavigation(request) {
  try {const r=await fetch(request,{cache:'no-store'});if(r.ok)return r;}catch { /* The selected area has no saved copy. */ }
  const home=justHome(new URL(request.url));
  const meta=JUST && !home && typeof JUST_META!=='undefined' ? JUST_META[areaPath(new URL(request.url)) || 'mabou'] ?? JUST_META.unknown : null;
  const name=meta?.title ?? (JUST ? 'Just Drive' : 'Mabou Mail Madness'), head=meta?.head ?? `<title>${name}</title>`, href=JUST ? '/mabou?title=1' : '/?area=mabou&amp;title=1';
  const words=home ? 'The map of places needs a connection.' : 'This area needs a connection.';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${head}<body style="margin:0;background:#0b1620;color:#eef2f6;font:18px/1.5 system-ui;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))"><main><h1>${name}</h1><p id="offlineAreaConnection" role="status">${words}</p><a href="${href}" style="display:inline-flex;align-items:center;min-height:44px;padding:8px 16px;border-radius:6px;background:#d0632e;color:white;text-decoration:none">Play Mabou offline</a></main></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
async function navigation(event) {
  const request=event.request, id=event.resultingClientId || event.clientId;
  const started=Date.now();
  let old, fallback;
  try {
    const selectedBefore=await stored();
    old=await offlineComplete() || selectedBefore;
    if(!ready) {const r=await matchStore(await openStore(META),READY);if(r) ready=prepare(await r.json());}
    // An app-only prepared build can use the same saved land even if the next probe stalls.
    // A data-changing build needs a healthy probe before replacing the last playable offline start.
    if(!complete && old && ready && ready.version.dataRevision===old.version.dataRevision) old=ready;
    if(old) { fallback=await pageResponse(old); if(fallback) bind(id,old,event,false); }
  } catch { await forget(id); return fetch(request,{cache:'no-store'}); }
  const probe=checkLatest(),update=probe.then(result=>result.verified?result.state:old);
  hold(event,probe.then(async ({state:next,verified})=>{
    if(verified && next && old && next.version.revision!==old.version.revision) {
      const clients=await self.clients.matchAll?.({type:'window',includeUncontrolled:true}) || [];
      await Promise.all(clients.map(c=>notify(c.id,'update-ready')));
    }
    await collect();
  }));
  try {
    // One overall navigation deadline covers version, inventory and every shell file.
    const deadline=new Promise(resolve=>AbortSignal.timeout(Math.max(1,NAVIGATION_BUDGET_MS-(Date.now()-started))).addEventListener('abort',()=>resolve(old),{once:true}));
    const selected=fallback ? await Promise.race([update,deadline]) : await update;
    if(disabled) { await forget(id); return fetch(request,{cache:'no-store'}); }
    if(selected) {
      const response=selected===old && fallback ? fallback : await pageResponse(selected);
      if(response) {
        bind(id,selected,event,false);state=selected;
        hold(event,(async()=>{await (await openStore(META)).put(KEY,new Response(record(selected)));await collect();})());
        return deliveredPage(response,selected);
      }
    }
  } catch { /* Storage access fails open to the network, never to another revision's data. */ }
  await forget(id); return fetch(request,{cache:'no-store'});
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

// Blob.slice avoids a whole-song JavaScript ArrayBuffer for every Safari range probe.
async function range(response, header) {
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m) return response;
  const blob=await response.blob(), size=blob.size;
  const start=m[1] ? Number(m[1]) : Math.max(0,size-Number(m[2]));
  const end=m[1] ? (m[2] ? Math.min(Number(m[2]),size-1) : size-1) : size-1;
  const headers=new Headers(response.headers); headers.set('Accept-Ranges','bytes');
  if((!m[1] && !Number(m[2])) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=size) {
    headers.set('Content-Range',`bytes */${size}`);headers.set('Content-Length','0');return new Response(null,{status:416,headers});
  }
  headers.set('Content-Range',`bytes ${start}-${end}/${size}`); headers.set('Content-Length',String(end-start+1));
  return new Response(blob.slice(start,end+1),{status:206,headers});
}
async function resetResource(request,path,event) {
  const b=bindings.get(event.clientId), token=new URL(request.url).searchParams.get('mmm-page');
  const s=b ? versions.get(b.revision) : [...versions.values()].find(s=>s.pageKey===token);
  if(!s) return fetch(request); // A new, uncontrolled online document has no old identity to preserve.
  const entry=s.entries.get(path);if(!entry) return path.endsWith('/packs.json')?fetch(request):unavailable(event);
  try {const r=await checked(entry);return request.headers.has('Range')?range(r,request.headers.get('Range')):r;}
  catch(e) {if(e.integrity)return unavailable(event);throw e;}
}
// A chunk of app.js (web/area-chunks-build.ts) is named by its content hash: any saved copy is the right file, so it
// needs no page binding. A late import must not meet a binding race and be told to update.
async function chunk(request,path) {
  try { const r=await caches.match(path); if(r) return r; } catch { /* Read failure: check a network copy of the chunk. */ }
  // Not saved: check the network copy against the chunk's entry (sha256 and byte count), as for every other shell file.
  // Any saved shell index that lists the name has the same entry. Only a page from a saved shell asks for /offline/
  // files, and saving that shell stored its index. Only with storage blocked is there no index: then the network copy.
  let entry=[...versions.values()].find(s=>s.entries.has(path))?.entries.get(path);
  try {
    if(!entry) {
      const meta=await openStore(META);
      for(const key of await meta.keys()) if(new URL(key.url).pathname.startsWith('/__mmm_version/')) {
        const r=await matchStore(meta,key); entry=r ? prepare(await r.json()).entries.get(path) : undefined; if(entry) break;
      }
    }
  } catch { /* Storage is blocked: no saved index names the file. */ }
  return entry ? checked(entry) : fetch(request);
}
async function resource(request,path,event={}) {
  if(path.startsWith('/areas/')) return fetch(request);
  if(path.startsWith('/offline/chunks/')) return chunk(request,path);
  const isData=path.startsWith('/terrain/') || path.startsWith('/audio/') || path.startsWith('/models/') || path.startsWith('/areas/');
  if(disabled) return isData ? resetResource(request,path,event) : fetch(request);
  const token=new URL(request.url).searchParams.get('mmm-page'), id=event.clientId || '__non_client__';
  if(path.startsWith('/audio/') && !token && event.clientId) {
    try {const client=await self.clients.get?.(event.clientId);if(client && (listenPath(new URL(client.url).pathname) || !mabouURL(new URL(client.url))))return fetch(request);}catch { /* Use normal identity recovery for Mabou. */ }
  }
  let s;
  try { s=await forPage(token,id,event); } catch { /* Read failures fall back to healthy network. */ }
  if(disabled) return isData ? resetResource(request,path,event) : fetch(request);
  if(s===null) return unavailable(event);
  const entry=s?.entries.get(path);
  if(!entry) {
    if(isData && s) {
      // packs.json is an optional probe, not a file in an unpacked public build.
      if(path.endsWith('/packs.json')) return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
      // Every model is in the offline download now, the mail car's too (tools/offline-models.mjs). A page saved
      // before the car was the default has no car in its own download: if it asks for one (?car=blender), the
      // answer is the same as for any other file it does not own, and the update it is told about has the car.
      return unavailable(event);
    }
    const hashed=/^\/offline\/app\.([a-f0-9]{64})\.js$/.exec(path);
    if(hashed) {
      try { const r=await caches.match(path); if(r) return r; } catch { /* Read failure: verify a network copy. */ }
      return checked({url:path,hash:hashed[1]});
    }
    return fetch(request);
  }
  const ticket=generation;
  let cache,r;
  try { cache=await openStore(isData ? dataName(s) : shellName(s)); r=await matchStore(cache,path); } catch { /* Read failure: use a verified network copy. */ }
  if(!r) {
    try { r=await checked(entry); }
    catch(e) { if(e.integrity && isData) return unavailable(event); throw e; }
    if(cache) { const copy=r.clone(); hold(event,(async()=>{if(ticket===generation && !disabled) await cache.put(path,copy);})()); }
  }
  const ifRange=request.headers.get('If-Range');
  const allowed=!ifRange || (!ifRange.startsWith('W/') && (ifRange===r.headers.get('ETag') || ifRange===r.headers.get('Last-Modified')));
  return allowed && request.headers.has('Range') ? range(r,request.headers.get('Range')) : r;
}
self.addEventListener('fetch',event=>{
  const r=event.request,url=new URL(r.url);
  if(url.pathname==='/mp' || url.pathname.startsWith('/mp/')) return; // Rooms and WebSockets always belong to the network.
  if(r.method!=='GET' || url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/areas/')) return;
  if(JUST && r.mode==='navigate' && gameNavigation(url) && url.pathname!=='/' && url.pathname.endsWith('/')) {url.pathname=url.pathname.slice(0,-1);event.respondWith(Response.redirect(url.href,308));return;}
  if(r.mode==='navigate' && justHome(url)) {event.respondWith(connectionNavigation(r));return;}
  if(r.mode==='navigate' && gameNavigation(url) && !mabouURL(url)) {event.respondWith(connectionNavigation(r));return;}
  if(disabled) {if(/^\/(terrain|audio|models|areas)\//.test(url.pathname)) event.respondWith(resetResource(r,url.pathname,event));return;}
  if(r.mode==='navigate' && gameNavigation(url)) event.respondWith(navigation(event));
  else if(/^\/(terrain|audio|models|areas|offline)\//.test(url.pathname) || (url.pathname==='/manifest.webmanifest' || url.pathname==='/manifest-just.webmanifest')) event.respondWith(resource(r,url.pathname,event));
});
async function status(s) {
  let saved;try {saved=await (await openStore(dataName(s))).keys();}catch(e){throw storageFailure(e);}
  const keys=new Set(saved.map(r=>new URL(r.url).pathname));
  let bytes=0,count=0;for(const f of s.index.files) if(keys.has(f.url)) {bytes+=f.bytes;count++;}
  let done=count===s.index.files.length && await isComplete(s),error;
  if(done) {
    try {
      const meta=await openStore(META);
      if(!await matchStore(meta,COMPLETE+'/'+s.version.revision)) await promoteComplete(s);
    } catch(e) {
      // Bytes alone are not Done: the durable offline-choice commit must also succeed.
      done=false;error=e.name==='QuotaExceededError' || e.cause?.name==='QuotaExceededError' ? 'Not enough room. Free some space, then resume.' : 'Saving is not available in this window. You can still play online.';
    }
  }
  const savedComplete=error ? complete : await offlineComplete();
  if(!filling) {const r=await matchStore(await openStore(META),FILL);if(r)filling=prepare(await r.json());}
  let shellBytes=0;const shell=await openStore(shellName(s));
  for(const f of s.index.shell) if(await matchStore(shell,f.url))shellBytes+=f.bytes;
  const downloadBytes=s.index.files.reduce((n,f)=>n+f.bytes,0)+s.index.shell.reduce((n,f)=>n+f.bytes,0);
  return {downloadBytes,shellBytes,removable:bytes>0 || !!savedComplete || !!filling,bytes,count,total:s.index.files.reduce((n,f)=>n+f.bytes,0),files:s.index.files.length,done,running:!!job && job.state.version.dataRevision===s.version.dataRevision,revision:s.version.revision,...(error?{error}:{})};
}
async function releaseFill(s) {
  try {
    const meta=await openStore(META),r=await matchStore(meta,FILL);
    if(r && (await r.json()).version.revision===s.version.revision) await meta.delete(FILL);
    if(filling?.version.revision===s.version.revision) filling=undefined;
  } catch { /* Conservative retention if cleanup is unavailable. */ }
}
async function download(s,port,visited=[]) {
  if(s.index.files.some(f=>f.url.startsWith('/areas/'))) {await Promise.all([...bindings].filter(([,b])=>b.revision===s.version.revision).map(([id])=>notify(id,'version-unavailable')));port.postMessage({running:false,error:UPDATE_TEXT});port.close();return;}
  if(job) {port.postMessage({error:'A download is already running. Stop it in the other window first.'});port.close();return;}
  const current={controller:new AbortController(),state:s,done:null};job=current;
  current.done=(async()=>{
    let error;
    try {
      const meta=await openStore(META);
      await meta.put(FILL,new Response(record(s)));filling=s;
      await saveShell(s,current.controller.signal);
      if(!state) {await (await openStore(META)).put(KEY,new Response(record(s)));state=s;}
      const cache=await openStore(dataName(s));
      const keys=new Set((await cache.keys()).map(r=>new URL(r.url).pathname));
      const missing=s.index.files.filter(f=>!keys.has(f.url));
      let last=0;const progress=await status(s);port.postMessage(progress);
      const transfer=async files=>{
        let i=0;
        const worker=async()=>{
          while(i<files.length && !current.controller.signal.aborted) {
            const f=files[i++];
            try {
              const response=await checked(f,current.controller.signal);
              if(current.controller.signal.aborted) break;
              await cache.put(f.url,response);progress.bytes+=f.bytes;progress.count++;
              if(Date.now()-last>200) {last=Date.now();port.postMessage({...progress,running:true});}
            } catch(e) {if(!current.controller.signal.aborted) error=e;current.controller.abort();}
          }
        };
        await Promise.all(Array.from({length:4},worker));
      };
      // Files loaded before registration are known to this page, but were never seen by the worker.
      const wanted=new Set(Array.isArray(visited)?visited.filter(p=>typeof p==='string'):[]);
      await transfer(missing.filter(f=>wanted.has(f.url)));
      if(!current.controller.signal.aborted) {
        port.postMessage({...progress,running:true,primed:true});
        await transfer(missing.filter(f=>!wanted.has(f.url)));
      }
      if(!error && !current.controller.signal.aborted) await promoteComplete(s);
    } catch(e) {error=e;current.controller.abort();}
    finally {await releaseFill(s);if(job===current) job=undefined;}
    if(error?.integrity && error.message===UPDATE_TEXT) await Promise.all([...bindings].filter(([,b])=>b.revision===s.version.revision).map(([id])=>notify(id,'version-unavailable')));
    try {
      const result=await status(s);
      port.postMessage({...result,running:false,stopped:current.controller.signal.aborted,...(error?{error:error.name==='QuotaExceededError' || error.cause?.name==='QuotaExceededError' ? 'Not enough room. Free some space, then resume.' : error.integrity ? error.message : error.storageFailure ? 'Saving is not available in this window. You can still play online.' : 'Download stopped. Try again online.'}:{})});
    } catch {port.postMessage({running:false,error:'Saving is not available in this window. You can still play online.'});}
    finally {port.close();await collect();}
  })();
  return current.done;
}
async function stopJob() {const active=job;active?.controller.abort();if(active) await active.done.catch(()=>{});}
self.addEventListener('message',event=>{
  const port=event.ports[0];
  if(event.data.type==='collect') {hold(event,collect());return;}
  if(!port) return;
  hold(event,(async()=>{
    if(disabled) throw Error('Saving is turned off. You can still play online.');
    const id=event.source?.id || '__non_client__';
    const s=await forPage(event.data.pageKey,id,event);
    if(disabled) throw Error('Saving is turned off. You can still play online.');
    if(!s) {hold(event,notify(id,'version-unavailable'));throw Error(UPDATE_TEXT);}
    if(event.data.type==='prepare') {
      let current;try {current=await stored();}catch {}
      if(!current) hold(event,saveDelivered(s).then(async next=>{if(next && next.version.revision!==s.version.revision) await notify(id,'update-ready');await collect();}));
      else if(ready && ready.version.revision!==s.version.revision) hold(event,notify(id,'update-ready'));
      port.postMessage({bound:true});port.close();return;
    }
    if(event.data.type==='start') return download(s,port,event.data.visited);
    if(event.data.type==='stop' || event.data.type==='remove') await stopJob();
    if(event.data.type==='remove') {
      // Older pages cannot remove their download without the new confirmation step.
      if(event.data.confirmed!==true) throw Error('Start again online to update the download controls.');
      generation++;
      // Remove all saved data, including the protected fallback, only after explicit confirmation.
      for(const name of await caches.keys()) if(name.startsWith(PREFIX+'data-')) {
        const cache=await openStore(name),keys=await cache.keys();
        for(let i=0;i<keys.length;i+=32)await Promise.all(keys.slice(i,i+32).map(key=>cache.delete(key)));
        await caches.delete(name);
      }
      const meta=await openStore(META);for(const key of await meta.keys())if(new URL(key.url).pathname.startsWith(COMPLETE))await meta.delete(key);await meta.delete(FILL);
      complete=undefined;filling=undefined;
    }
    port.postMessage(await status(s));port.close();await collect();
  })().catch(e=>{port.postMessage({running:false,error:e.storageFailure ? 'Saving is not available in this window. You can still play online.' : e.message});port.close();}));
});
