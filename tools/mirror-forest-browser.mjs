#!/usr/bin/env node
// Matched runtime before/after: only the mirror canopy LOD expression changes.
// Run through tools/yard-shots.sh. GPU timers are opt-in for the reserved Mac window only.
import {cdp,cdpFetch,exitCheck} from './cdp.mjs';
import {writeFileSync} from 'node:fs';
const [outDir,first]=process.argv.slice(2),base=new URL(first).origin,port=process.env.CDP_PORT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let failed=false;
const check=(ok,name)=>{console.log(`${ok?'ok':'FAIL'} ${name}`);if(!ok)failed=true;};
async function open(query, dpr = 1) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const errors = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
    if (d.method === 'Log.entryAdded' && /WebGL|GL_INVALID/.test(d.params.entry.text)) console.log('WEBGL_LOG', d.params.entry.text);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  } });
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  if (dpr !== 1) {
    const [width, height] = JSON.parse(await read('JSON.stringify([innerWidth, innerHeight])'));
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  }
  await send('Page.navigate', { url: `${base}/?hud=0&${query}` });
  let settled = false;
  // Startup deadline only: allow other threads to use this Mac's GPU. No timing threshold is relaxed.
  for (let i = 0; i < 400; i++) { await sleep(300); if (String(await read('document.title') ?? '').startsWith('settled')) { settled = true; break; } }
  check(settled, `settled: ${query}`);
  await sleep(800);
  check(!errors.length, `no script or shader console errors: ${errors.join(' ').slice(0, 300)}`);
  check(await read('mmm.renderer.info.programs.every(p => !p.diagnostics || p.diagnostics.runnable)'), 'all WebGL programs compile');
  return { read, send, shot: async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const path = `${outDir}/${name}.png`; writeFileSync(path, Buffer.from(r.result.data, 'base64')); console.log(path); }, close: async () => { check(!errors.length, `no errors after case: ${errors.join(' ').slice(0, 500)}`); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close(); } };
}

const results=[];
for(const [name,query] of [
 ['far-shore','cam=623800,5103200,3,25,-2,60'],
 ['high','cam=623600,5102800,75,25,-12,60'],
 ['driving','road=Mabou%20Harbour%20Road&f=0.35&demo=5&view=seat']
]){
 const p=await open(query+'&reflections=1&res=1');
 // Park on the tested harbour road and face the water through the driver's window.
 if(name==='driving'){await p.read('mmm.vehicle.heading-=Math.PI/2;mmm.chase(0);mmm.camera.updateMatrixWorld();true');await sleep(1500);}
 for(const variant of ['before','after']){
  check(await p.read(`(()=>{
   let changed=0;
   for(const t of mmm.terrain.tiles.values())if(t.mirror){
    const m=t.mirror.material;
    m.userData.forestOriginal??=m.fragmentShader;
    m.fragmentShader=${JSON.stringify(variant)}==='before'?m.userData.forestOriginal.replace('smoothstep(200.0, 1400.0, dist) + step(6.0, texel)','smoothstep(280.0, 420.0, dist) + step(3.0, texel)'):m.userData.forestOriginal;
    if(${JSON.stringify(variant)}==='before'&&m.fragmentShader===m.userData.forestOriginal)throw Error('baseline canopy substitution did not change the shader');
    m.needsUpdate=true;changed++;
   }
   return changed>0;
  })()`),'mirror materials selected for '+variant);
  // Warm both programs equally. These GPU samples do not measure cold startup.
  await p.read('new Promise(resolve=>{let n=0;const tick=()=>{if(++n>=30)resolve(true);else requestAnimationFrame(tick);};requestAnimationFrame(tick);})');
  const stats=await p.read(`new Promise(resolve=>{
   const r=mmm.renderer,render=r.render,rows=[],queries=[];
   const gl=r.getContext(),ext=${process.env.MMM_MIRROR_TIMING==='1'}?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
   let main=0;
   r.render=function(scene,camera){
    const target=this.getRenderTarget();
    if(scene.name==='Water visibility')return render.call(this,scene,camera);
    const q=target&&ext?gl.createQuery():null;
    if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
    const out=render.call(this,scene,camera);
    if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(q);}
    rows.push({pass:target?'mirror':'main',calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length});
    if(!target&&++main>=20){
     r.render=render;
     const deadline=performance.now()+10000;
     const finish=()=>{
      const disjoint=ext&&gl.getParameter(ext.GPU_DISJOINT_EXT),pending=queries.some(q=>!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE));
      if(pending&&!disjoint&&performance.now()<deadline){setTimeout(finish,50);return;}
      const gpu=ext&&!disjoint&&!pending?queries.map(q=>gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6).slice(2):null;
      const sorted=gpu?.slice().sort((a,b)=>a-b);
      const gpuMedianMs=sorted?.length?sorted[Math.floor(sorted.length/2)]:null;
      queries.forEach(q=>gl.deleteQuery(q));resolve({rows,gpuMs:gpu,gpuMedianMs,gpuStatus:gpu?'measured warm':ext?'no result: disjoint or timeout':'no result: timer not enabled or unavailable',timingRequested:!!ext,camera:mmm.camera.position.toArray(),focus:mmm.terrain.mirrorFocus.value.toArray()});
     };setTimeout(finish,100);
    }
    return out;
   };
  })`);
  check(stats?.rows.filter(x=>x.pass==='mirror').length>=18,'completed matched mirror frames');
  if(process.env.MMM_MIRROR_TIMING==='1')check(stats?.gpuMs?.length>=18,'native GPU timer samples available and not disjoint');
  results.push({name,variant,...stats});
  await p.shot(name+'-'+variant);
 }
 await p.close();
}
for(let i=0;i<results.length;i+=2){
 const a=results[i],b=results[i+1];
 if(!a?.camera||!b?.camera){check(false,'paired stats present: '+(a?.name??'?'));continue;}
 check(a.camera.every((v,j)=>Math.abs(v-b.camera[j])<1e-3),'paired camera is fixed within 1 mm: '+a.name);
 for(const pass of ['mirror','main']){
  const counts=r=>[...new Set(r.rows.filter(x=>x.pass===pass).map(x=>JSON.stringify(x)))].sort();
  check(JSON.stringify(counts(a))===JSON.stringify(counts(b)),'paired draw counts and program count unchanged: '+a.name+' '+pass);
 }
}
writeFileSync(outDir+'/forest-cost.json',JSON.stringify(results,null,2));
console.log('FOREST_COST',JSON.stringify(results.map(({rows,...r})=>({...r,counts:rows.filter((v,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(v))===i)}))));
exitCheck(failed?1:0);
