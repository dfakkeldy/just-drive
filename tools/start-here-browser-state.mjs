// Browser-check state only. No location data or game settings are retained here.
export const BFCACHE_RESULT_KEY = 'mmm.check.start-here.bfcache';
export const bfcacheRecorder = `addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  // A task, not a microtask: microtasks run between pageshow listeners, before the game's own handler.
  setTimeout(()=>{
    if(location.pathname!=='/mabou')return;
    const button=document.getElementById('titleStartHere'),status=document.getElementById('startHereStatus');
    sessionStorage.setItem(${JSON.stringify(BFCACHE_RESULT_KEY)},JSON.stringify({persisted:true,realm:window.__startHereDocument,buttonPresent:!!button,disabled:button?.disabled??null,status:status?.textContent??null,geoAsks:window.__geoAsks}));
  },0);
});`;
export const safeCondition = expression => `(()=>{try{return !!(${expression});}catch{return false;}})()`;

/** A ready realm must remain the same, with no new navigation, for one second.
 * A replacement document loses its realm id; a navigation begun during an RPC
 * also resets the interval. DOM access errors are sampled as not-ready in-page. */
export async function waitForStableDocument(read, expression, { navigation = () => 0, busy = () => false, now = () => performance.now(), delay = ms => new Promise(r=>setTimeout(r,ms)), stableFor = 1000, timeout = 120000 } = {}) {
  const sample = `(()=>{try{return {ready:!!(${expression}),realm:window.__startHereDocument};}catch{return {ready:false,realm:null};}})()`;
  const deadline=now()+timeout;
  let realm=null,epoch=-1,since=0;
  while(now()<deadline) {
    const before=navigation();let state;
    try { state=await read(sample); }
    catch(error) { if(!/context|navigat/i.test(error.message))throw error; }
    const after=navigation(),time=now();
    if(!busy() && state?.ready && typeof state.realm==='string' && state.realm && before===after) {
      if(state.realm!==realm || after!==epoch) { realm=state.realm;epoch=after;since=time; }
      if(time-since>=stableFor)return realm;
    } else realm=null;
    await delay(100);
  }
  throw Error('timeout waiting for a stable document: '+expression);
}
export function viteInitiator(initiator) {
  for(let stack=initiator?.stack;stack;stack=stack.parent) {
    const frame=stack.callFrames?.find(frame=>frame.url);
    if(frame){try{return new URL(frame.url,'http://browser-check.invalid').pathname==='/@vite/client';}catch{return false;}}
  }
  return false;
}
