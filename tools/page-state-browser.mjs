// G3_PUBLIC_ORIGIN=http://127.0.0.1:5346 WEB_PORT=5345 CDP_PORT=9545 node tools/page-state-browser.mjs
// Serve a tools/build_site.sh result at G3_PUBLIC_ORIGIN and Vite at WEB_PORT, using an owned Chromium.
// main.ts is the only animation-frame producer on this page; minification may rename its callback.
import assert from 'node:assert/strict';
const dev = process.env.G3_DEV_ORIGIN ?? `http://127.0.0.1:${process.env.WEB_PORT ?? 5345}`;
const prod = process.env.G3_PUBLIC_ORIGIN;
assert.ok(prod, 'G3_PUBLIC_ORIGIN must serve a production build');
const port = process.env.CDP_PORT ?? 9545;
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const failures=[];
async function run(label, origin, query, verify, injection='') {
  const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),15000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
  const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const until=async expression=>{const end=Date.now()+90000;while(Date.now()<end){if(await read(expression))return;await sleep(100);}throw Error('timeout: '+expression);};
  try {
    await send('Page.enable');await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.clear();window.__g3Frames=0;window.__g3Queued=0;const raf=requestAnimationFrame;window.requestAnimationFrame=callback=>{window.__g3Queued++;return raf.call(window,now=>{window.__g3Frames++;window.__g3Queued--;callback(now);});};${injection}`});
    await send('Page.navigate',{url:origin+'/'+query});
    await verify({read,until,send,errors});console.log('PASS '+label);
  } catch(error) { failures.push(label);console.log('FAIL '+label+': '+error.message); }
  finally {await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});ws.close();}
}
  await run('production player title and hidden readiness',prod,'',async({read,until})=>{
    await until(`window.__g3Frames>30 && !document.getElementById('boot')`);
    await until(`document.title==='settled' || document.documentElement.dataset.mmmReady==='true'`);
    assert.equal(await read('document.title'),'Mabou Mail Madness');
    assert.equal(await read('document.documentElement.dataset.mmmReady'),'true');
    assert.equal(await read(`!document.getElementById('title').hidden`),true);
  });
  await run('production test parameter keeps legacy signal',prod,'?name=g3&hud=0',async({read,until})=>{
    await until(`document.title==='settled'`);assert.equal(await read('document.documentElement.dataset.mmmReady'),'true');
  });
await run('dev keeps legacy signal',dev,'',async({read,until})=>{
  await until(`document.title==='settled'`);assert.equal(await read('document.documentElement.dataset.mmmReady'),'true');
});
for (const query of ['?fbclid=x','?vehicle=truck']) await run('player title card '+query,dev,query,async({read,until})=>{
  await until(`window.__g3Frames>30`);assert.equal(await read(`!!document.getElementById('titleStart')&&!document.getElementById('title').hidden`),true);
});
await run('stray late rejection and error keep the game running',dev,'?name=g3&hud=0',async({read,until})=>{
  await until(`document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.renderer`);
  const frames=await read('window.__g3Frames');
  await read(`window.__g3Strays=[];addEventListener('unhandledrejection',ev=>{if(ev.reason?.message==='G3 stray')window.__g3Strays.push('async');});addEventListener('error',ev=>{if(ev.message.includes('G3 stray sync'))window.__g3Strays.push('sync');});Promise.reject(new Error('G3 stray'));setTimeout(()=>{throw new Error('G3 stray sync');});void 0;`);
  await until(`window.__g3Strays.length===2 && window.__g3Frames>${frames}+5 && document.documentElement.dataset.mmmReady==='true'`);
  assert.deepEqual((await read('window.__g3Strays')).sort(),['async','sync'],'both stray error events fired');
  assert.equal(await read(`document.getElementById('gameError').hidden`),true,'stray errors do not show the fatal line');
});
await run('startup failure while boot is up uses only the loading screen',prod,'?name=g3&hud=0',async({read,until,errors})=>{
  await until(`document.getElementById('boot')?.textContent.includes('Mabou Mail Madness could not start:')`);
  assert.equal(await read(`document.getElementById('boot').textContent`),'Mabou Mail Madness could not start: G3 injected context startup. Reload to try again.');
  assert.equal(await read(`getComputedStyle(document.getElementById('boot')).visibility`),'visible');
  assert.equal(await read(`document.getElementById('gameError').hidden`),true,'one message, not two');
  assert.equal(await read('document.documentElement.dataset.mmmReady'),'false');
  await sleep(500);
  assert.equal(await read('window.__g3Frames'),0,'failed start never enters the frame loop');
  assert.equal(await read('window.__g3Queued'),0,'failed start queues no game frame');
  assert.ok(errors.some(s=>s.includes('G3 injected context startup')),'startup error reaches console');
},`const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){if(this.id==='c'&&args[0]==='webgl2'){window.__g3Injected=true;throw new Error('G3 injected context startup');}return context.apply(this,args);};`);
const errorText='The game stopped. Reload the page to try again.';
async function stopped({read,until,errors}) {
  await until(`window.__g3Injected`);await sleep(500);
  assert.equal(await read(`document.getElementById('boot')===null`),true,'boot already removed');
  assert.equal(await read(`document.getElementById('gameError')?.textContent`),errorText,'persistent failure line');
  assert.equal(await read(`getComputedStyle(document.getElementById('gameError')).position`),'fixed');
  assert.equal(await read(`document.getElementById('gameError').hidden`),false);
  const frames=await read('window.__g3Frames');await sleep(500);
  assert.equal(await read('window.__g3Frames'),frames,'no repeating frames after failure');
  assert.equal(await read('window.__g3Queued'),0,'no queued game frame');
  assert.equal(await read('document.documentElement.dataset.mmmReady'),'false');
  assert.ok(errors.some(s=>s.includes('G3 injected')),'original error reaches console');
}
await run('startup throws after boot removal',prod,'?name=g3&hud=0',stopped,`const remove=Element.prototype.remove;Element.prototype.remove=function(){const boot=this.id==='boot';remove.call(this);if(boot){window.__g3Injected=true;throw Error('G3 injected startup');}};`);
await run('frame exception stops loop with message',dev,'?name=g3&hud=0',async(p)=>{
  await p.until(`document.title==='settled' && !!window.mmm?.renderer`);
  await p.read(`mmm.renderer.render=()=>{window.__g3Injected=true;throw Error('G3 injected frame');}`);await stopped(p);
});
await run('frame failure line stays visible during an ending',dev,'?name=g3&hud=0',async(p)=>{
  await p.until(`document.title==='settled' && !!window.mmm?.renderer`);
  await p.read(`document.body.appendChild(Object.assign(document.createElement('div'),{id:'g3EndingWitness'}));document.body.classList.add('hasEnding');`);
  assert.equal(await p.read(`getComputedStyle(document.getElementById('g3EndingWitness')).visibility`),'hidden','the real ending rule is active');
  await p.read(`mmm.renderer.render=()=>{window.__g3Injected=true;throw new Error('G3 injected ending frame');}`);
  await stopped(p);
  assert.equal(await p.read(`getComputedStyle(document.getElementById('gameError')).visibility`),'visible');
});
console.log(failures.length?`FAIL ${failures.length} page checks`:'PASS all page-state browser checks');
process.exitCode=failures.length?1:0;
