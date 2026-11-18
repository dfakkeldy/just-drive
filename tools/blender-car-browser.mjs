#!/usr/bin/env node
// Serial matching pictures and isolated rig costs through the existing car-shots/CDP harness.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
assert.ok(out && first && port, 'run with RUN=blender-car-browser.mjs VIEWS=front tools/car-shots.sh');
const rows=[];
for (const model of ['original','blender']) for (const detail of ['desktop','low']) {
  for (const view of detail==='desktop'?['front','rear','side','driver-side','dirty']:['front']) {
    const url=new URL(first);url.searchParams.set('model',model);url.searchParams.set('detail',detail);url.searchParams.set('still','1');
    url.searchParams.set('dirt',view==='dirty'?'1':'0');url.searchParams.set('view',view==='dirty'?'front':view);
    const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
    const errors=[];
    const c=await cdp(tab.webSocketDebuggerUrl,{onEvent:d=>{if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text)}});
    const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true});assert.ok(!r.result.exceptionDetails,JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
    try {
      await c.send('Runtime.enable');await c.send('Page.enable');await c.send('Page.navigate',{url:url.href});
      let ready=false;
      for(let i=0;i<150;i++){await sleep(100);if(await read('document.title==="settled"')){ready=true;break}}
      assert.ok(ready,`settled ${model}: ${errors.join('\n')}`);assert.deepEqual(errors,[]);
      const stats=await read(`(() => {
        const {car,scene,camera,renderer}=carPreview;
        car.root.updateMatrixWorld(true);
        const original = scene.children.filter(n=>n!==car.root&&!n.isLight).map(n=>[n,n.visible]);original.forEach(([n])=>n.visible=false);
        let triangles=0; const materials=new Set(), culling=[];
        car.root.traverse(n=>{if(n.isMesh){triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);culling.push([n,n.frustumCulled]);n.frustumCulled=false;}});
        car.setDirt(.75);renderer.render(scene,camera);const calls=renderer.info.render.calls,drawn=renderer.info.render.triangles;
        culling.forEach(([n,v])=>n.frustumCulled=v);original.forEach(([n,v])=>n.visible=v);
        const pivots=Object.fromEntries(Object.entries(car.wheels).map(([key,w])=>[key,{spin:w.position.toArray(),axle:w.parent.position.toArray(),steer:key[0]!=='f'||car.steer[key]===w.parent,underBody:car.body.children.includes(w.parent)}]));
        const mud=[...materials].find(m=>m.polygonOffset);
        const dirt=[-1,0,.5,1,2,NaN].map(a=>{car.setDirt(a);return [mud.opacity,mud.visible]});car.setDirt(Number(new URLSearchParams(location.search).get('dirt')));
        car.setWindowDown(true);const down=!car.driverWindow.visible;car.setWindowDown(false);const up=car.driverWindow.visible;
        return {triangles,drawCalls:calls,renderedTriangles:drawn,materials:materials.size,pivots,dirt,down,up,eye:car.driverEye.position.toArray(),brakes:car.brakeLights.length,brakesDistinct:new Set(car.brakeLights).size===car.brakeLights.length};
      })()`);
      assert.deepEqual(stats.dirt,[[0,false],[0,false],[.5,true],[1,true],[1,true],[0,false]]);
      assert.ok(stats.down&&stats.up&&stats.brakesDistinct&&stats.brakes>=2);
      // The phone car's eye is 14 cm further back and 5 cm lower, so a phone's near plane (0.45 m) does not cut its
      // pillar, wheel and roof edge (tools/blender/mail-car.py).
      (model==='blender'&&detail==='low'?[.43,1.31,.06]:[.43,1.36,-.08]).forEach((v,i)=>assert.ok(Math.abs(stats.eye[i]-v)<1e-6,`${model} ${detail} driver eye`));
      for(const [key,p] of Object.entries(stats.pivots)){
        assert.ok(p.steer&&!p.underBody);[0,.35,0].forEach((v,i)=>assert.ok(Math.abs(p.spin[i]-v)<1e-6));
        [key.endsWith('l')?-.785:.785,0,key.startsWith('f')?-1.31:1.31].forEach((v,i)=>assert.ok(Math.abs(p.axle[i]-v)<1e-6));
      }
      if(view==='front'){rows.push({model,detail,...stats});console.log(model,detail,JSON.stringify(stats));}
      await sleep(100);
      if(detail==='desktop'||model==='blender'){
        const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${model==='blender'?'fable':model}${detail==='low'?'-low':''}-${view}.png`,Buffer.from(shot.result.data,'base64'));
      }
    } finally {c.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);}
  }
}
for(const detail of ['desktop','low']){
  const after=rows.find(r=>r.model==='blender'&&r.detail===detail);
  assert.ok(after.triangles<=(detail==='low'?8000:40000),'desktop 40k / LOW 8k triangles');assert.ok(after.drawCalls<=30,'draw-call budget');
  if(detail==='low') assert.ok(after.triangles < rows.find(r=>r.model==='blender'&&r.detail==='desktop').triangles*.45,'LOW uses its own reduced asset');
}
writeFileSync(`${out}/comparison.json`,JSON.stringify(rows,null,2)+'\n');
// The side-by-side page must load both independent rigs, and the flag must survive navigation.
const url=new URL(first);url.searchParams.set('model','both');url.searchParams.set('still','1');url.searchParams.set('dirt','0');
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const c=await cdp(tab.webSocketDebuggerUrl);
try{await c.send('Page.enable');await c.send('Page.navigate',{url:url.href});let ready=false;for(let i=0;i<150;i++){await sleep(100);const r=await c.send('Runtime.evaluate',{expression:'document.title==="settled" && carPreview.cars.length===2 && [...document.querySelectorAll("nav a")].every(a=>a.href.includes("model=both"))',returnByValue:true});if(r.result.result.value){ready=true;break}}assert.ok(ready,'both mode');const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/both-front.png`,Buffer.from(shot.result.data,'base64'));}finally{c.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`)}
console.log('Blender preview contracts, pictures and budgets passed');

// Reuse this one owned browser for the untouched car's existing six-view regression check.
mkdirSync(`${out}/original-check`, { recursive: true });
const urls = ['front','rear','side','top','driver','far'].map(view => { const url = new URL(first); url.search = `view=${view}`; return url.href; });
execFileSync(process.execPath, [new URL('./car-check.mjs', import.meta.url).pathname, `${out}/original-check`, ...urls], { stdio: 'inherit', env: process.env });
console.log('node tools/car-check.mjs: exit 0');
