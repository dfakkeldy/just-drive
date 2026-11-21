// Called only by the public build. No timers or work in the game's frame loop.
interface Progress { bytes: number; total: number; count: number; files: number; done: boolean; running: boolean; removable?: boolean; downloadBytes?: number; shellBytes?: number; error?: string }
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
export function offlinePlay(panel: HTMLElement | null, before: HTMLElement | null, pageKey='', area='mabou', just=false, localPreview=false): void {
  if (!panel || !isSecureContext || !('serviceWorker' in navigator)) return;
  const group = Object.assign(document.createElement('section'), { id:'offlinePlay' });
  group.setAttribute('aria-label','Offline play');
  group.style.cssText='margin-top:12px;border-top:1px solid #53616b;padding-top:10px;font-size:13px;line-height:1.4;max-width:280px';
  if(localPreview) {
    group.textContent='Offline downloads are not available in this local preview.';
    panel.insertBefore(group,before);return;
  }
  if(area!=='mabou') {
    group.innerHTML='<b>Play without internet</b><p>This area needs a connection. Offline play is available in Mabou.</p>';
    panel.insertBefore(group,before);return;
  }
  group.innerHTML=`<b>Play Mabou without internet</b><p style="margin:6px 0">On iPhone or iPad, use Share → Add to Home Screen, then download here. Safari tabs can lose saved data after seven days without use; low space can also remove it.</p>
    <div id="offlineSize"></div><progress id="offlineProgress" hidden max="1" value="0" style="width:100%;height:10px" aria-label="Download progress"></progress>
    <div id="offlineStatus" role="status" aria-live="polite"></div><div id="offlineStorage" style="color:#b9c3cc;margin:5px 0"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button id="offlineStart" type="button">Download for offline play</button><button id="offlineStop" type="button" hidden>Stop</button><button id="offlineRemove" type="button" hidden>Remove download</button></div>
    <div id="offlineConfirm" role="group" aria-label="Remove download" hidden><p>Remove the download? You will need the internet to download it again.</p><div style="display:flex;gap:6px"><button id="offlineConfirmRemove" type="button">Remove</button><button id="offlineCancelRemove" type="button">Cancel</button></div></div>`;
  for (const button of group.querySelectorAll('button')) button.style.cssText='flex:1;min-height:44px;border-radius:6px;border:1px solid #6b7780;background:none;color:inherit;font:inherit;cursor:pointer;padding:6px';
  panel.insertBefore(group,before);
  const get = <T extends HTMLElement>(id: string) => group.querySelector<T>(`#offline${id}`)!;
  const start=get<HTMLButtonElement>('Start'), stop=get<HTMLButtonElement>('Stop'), remove=get<HTMLButtonElement>('Remove');
  const text=get('Status'), size=get('Size'), storage=get('Storage'), bar=get<HTMLProgressElement>('Progress');
  let progress: Progress | undefined, working=false, ownDownload=false, confirming=false, sequence=0;
  const show=(p: Progress) => {
    if (p.error) text.textContent=p.error;
    if (typeof p.total !== 'number') { working=false; ownDownload=false; start.disabled=false; stop.hidden=true; remove.disabled=false; return; }
    progress=p; working=p.running; if(!p.running) ownDownload=false;
    const full=p.downloadBytes ?? p.total,saved=p.bytes+(p.shellBytes ?? 0);
    size.textContent=`Full download: ${mb(full)}`;
    bar.max=full; bar.value=saved;
    bar.hidden=!(p.running || saved>0);
    if (!p.error) text.textContent=p.done ? 'Done: this game now works without the internet.' : `${mb(saved)} of ${mb(full)}${p.running ? (ownDownload ? ' · Keep this window open.' : ' · Another window is downloading. Reopen Settings for progress.') : p.bytes ? ' · Stopped. Resume when ready.' : ' · Places you drive are saved as you go.'}`;
    start.hidden=p.done || p.running; start.disabled=false; start.textContent='Download for offline play';
    stop.hidden=!p.running; remove.hidden=!(p.removable ?? (p.bytes>0)) || confirming; remove.disabled=p.running;
  };
  const talk=(type:string, callback=show, confirmed=false) => {
    const target=navigator.serviceWorker.controller;
    if (!target) { text.textContent='Offline play is not ready. Close and open the game online.'; return; }
    const ticket=++sequence;
    if(type==='start') {working=true;ownDownload=true;}
    const channel=new MessageChannel();
    channel.port1.onmessage=e=>{ const p=e.data as Progress; if(ticket===sequence) callback(p); if (type!=='start' || !p.running) { channel.port1.close(); } };
    const visited=type==='start' && typeof performance!=='undefined' ? performance.getEntriesByType('resource').map(e=>new URL(e.name,location.href)).filter(u=>u.origin===location.origin && /^\/(terrain|audio|models|areas)\//.test(u.pathname)).map(u=>u.pathname) : [];
    target.postMessage({type,pageKey,confirmed,visited},[channel.port2]);
  };
  const total=Number(document.querySelector<HTMLMetaElement>('meta[name="mmm-offline-bytes"]')?.content || 0);
  progress={bytes:0,total,count:0,files:0,done:false,running:false};
  size.textContent=total ? `Full download: ${mb(total)}` : 'Download size will be checked when you start.';
  // Existing players already have a controlling worker. This never registers or probes storage.
  if(navigator.serviceWorker.controller) {
    talk('prepare',()=>talk('status'));
    void navigator.serviceWorker.getRegistration('/').then(registration=>registration?.update()).catch(()=>{});
  }
  const connect=async():Promise<void>=>{
    if(navigator.serviceWorker.controller) return;
    // This entire lifecycle exists only inside the player's click path.
    const probe=await caches.open('mmm-offline-probe');await probe.put('/__probe',new Response('ok'));await caches.delete('mmm-offline-probe');
    const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    if(!navigator.serviceWorker.controller) await new Promise<void>((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();};
      const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',done);reject(Error('not ready'));},8000);
      navigator.serviceWorker.addEventListener('controllerchange',done);
    });
    void registration.update().catch(()=>{});
    await new Promise<void>((resolve,reject)=>talk('prepare',p=>{if(p.error)reject(Error(p.error));else resolve();}));
  };
  start.addEventListener('click',async()=>{
    if (working || !progress) return;
    start.disabled=true;
    text.textContent='Getting ready…';
    try {
      await connect();
      const kept=await navigator.storage?.persist?.().catch(()=>false);
      storage.textContent=kept ? 'The browser agreed to keep this download.' : 'The browser did not agree to keep this download. It may remove it.';
      const estimate=await navigator.storage?.estimate?.();
      if (!estimate || estimate.quota===undefined || estimate.usage===undefined) { storage.textContent+=' Free space could not be checked.'; }
      else if (estimate.quota-estimate.usage < ((progress.downloadBytes ?? progress.total)-progress.bytes-(progress.shellBytes ?? 0))*1.15+8*1048576) {
        text.textContent='Not enough room. Free some space, then try again.'; start.disabled=false; return;
      }
      talk('start');
    } catch(error) { text.textContent=error instanceof Error && error.message==='A new version of the game is ready. Start again to get it.' ? error.message : 'Saving is not available in this window. You can still play online.'; start.disabled=false; }
  });
  stop.addEventListener('click',()=>talk('stop'));
  remove.addEventListener('click',()=>{
    confirming=true;remove.hidden=true;
    const box=get('Confirm');box.hidden=false;get<HTMLButtonElement>('ConfirmRemove').focus();
  });
  get<HTMLButtonElement>('CancelRemove')?.addEventListener('click',()=>{
    confirming=false;get('Confirm').hidden=true;remove.hidden=!(progress?.removable ?? !!progress?.bytes);remove.focus();
  });
  get<HTMLButtonElement>('ConfirmRemove')?.addEventListener('click',()=>{
    confirming=false;get('Confirm').hidden=true;remove.hidden=false;remove.disabled=true;
    text.textContent='Removing download…';
    talk('remove',p=>{show(p);if(!p.error) text.textContent=just ? 'Download removed. Your settings are kept.' : 'Download removed. Your career and settings are kept.';},true);
  });
  // Refresh saved-file counts only when the settings are opened, never while driving.
  document.getElementById('gear')?.addEventListener('click',()=>{if(!ownDownload && navigator.serviceWorker.controller) talk('status');});
}
