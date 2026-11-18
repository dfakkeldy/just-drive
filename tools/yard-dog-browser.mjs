// Run only through tools/yard-shots.sh and tools/browser.sh.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep, exitCheck } from './cdp.mjs';
const [out,first]=process.argv.slice(2),base=new URL(first).origin;
async function openPage(url) {
  const port=process.env.CDP_PORT;
  const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const c=await cdp(tab.webSocketDebuggerUrl);
  const read=async expression=>(await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.result.value;
  const navigate=async next=>{
    await c.send('Page.navigate',{url:next});await c.send('Page.bringToFront');
    for(let i=0;i<900;i++) {
      if(await read(`document.title==='settled'&&location.href===${JSON.stringify(next)}`)){c.assertHealthy();return;}
      if(i%60===0)console.log('Loading Mabou '+JSON.stringify(await read('({title:document.title,pending:window.mmm?.terrain.pending,failed:window.mmm?.terrain.failed})')));
      await sleep(500);
    }
    throw Error('Mabou did not settle within the software-renderer deadline');
  };
  await c.send('Page.enable');
  const close=async()=>{try{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);}finally{c.close();}};
  try{await navigate(url);}catch(error){await close();throw error;}
  return {read,send:c.send,navigate,close,shot:async path=>{const r=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(path,Buffer.from(r.result.data,'base64'));}};
}
const page=await openPage(`${base}/?at=625186.89,5096638.05,150&x=1&hud=0&q=low&shadows=0&res=1`);
try {
  for(let i=0;i<100;i++) {
    if(await page.read('!!window.mmm?.yardDog?.rig'))break;
    await sleep(300);
  }
  assert.ok(await page.read('!!window.mmm.yardDog?.rig'),'yard dog renders on real terrain');
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
  for(let i=0;i<30&&await page.read("window.mmm.yardDog.audio?.state!=='running'");i++)await sleep(100);
  const facts=await page.read(`(()=>{
    const m=window.mmm,d=m.yardDog,s=m.yardDogSite;
    const gap=Math.min(...m.props.mail.concat(m.props.sites).map(p=>Math.hypot(p.x-s.x,p.z-s.z)));
    const rows=[];let jawOpens=0;
    for(const direction of [-1,1]) {
      Object.assign(d.rules,new d.rules.constructor(s.edge));
      const states=new Set();let bark=0,minAcross=Infinity,maxAlong=0;
      for(let i=0;i<1500;i++) {
        const p=s.world(direction*(-38+i*.1),0),velocity=direction*6;
        d.update(1/60,{...p,vx:Math.sin(s.heading)*velocity,vz:-Math.cos(s.heading)*velocity});
        jawOpens+=Number(d.jaw.rotation.x>.1);states.add(d.rules.state);bark+=Number(d.rules.bark);minAcross=Math.min(minAcross,d.rules.across);maxAlong=Math.max(maxAlong,Math.abs(d.rules.along));
      }
      rows.push({direction,states:[...states],bark,minAcross,maxAlong,final:d.rules.state});
    }
    let triangles=0,draws=0;d.group.traverse(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
    return {gap,rows,triangles,draws,jawOpens,audio:d.audio?.state,area:m.area.id};
  })()`);
  assert.equal(facts.audio,'running','bark audio unlocks after input');assert.ok(facts.jawOpens>0,'barks animate the jaw');
  assert.equal(facts.area,'mabou');assert.ok(facts.gap>=300);
  assert.ok(facts.triangles<5000&&facts.draws<=12,'bounded dog geometry');
  for(const r of facts.rows){for(const s of ['run','bark','follow','guard','return'])assert.ok(r.states.includes(s),s);assert.ok(r.maxAlong<=18);assert.ok(r.bark>=2);assert.equal(r.final,'home');}
  // Use the actual draw path and real world terrain. Freeze only the inspected dog pose for photographs.
  await page.read(`(()=>{
    const m=window.mmm,d=m.yardDog,s=m.yardDogSite,p=s.world(-7,0);
    Object.assign(d.rules,new d.rules.constructor(s.edge));
    for(let i=0;i<150;i++)d.update(1/60,{...p,vx:0,vz:0});
    d.update=()=>{};m.vehicle.place(p.x,p.z,s.heading);m.vehicle.speed=0;
    const scene=m.vehicle.car.root.parent;
    scene.onBeforeRender=(_r,_s,c)=>{const p=d.rig.position;c.fov=48;c.updateProjectionMatrix();c.position.set(p.x-Math.cos(s.heading)*5-Math.sin(s.heading)*3,p.y+2.0,p.z-Math.sin(s.heading)*5+Math.cos(s.heading)*3);c.lookAt(p.x,p.y+.45,p.z);c.updateMatrixWorld();};
  })()`);
  // Let real audio time advance. Check the actual waveform and the source's end callback.
  await sleep(300);
  assert.equal(await page.read('window.mmm.yardDog.voice'),null,'queued bark sources finish');
  await page.read(`(()=>{const d=mmm.yardDog;d.bark(8);const a=d.audio.createAnalyser();d.voice.connect(a);window.yardBarkProbe=a;})()`);
  await sleep(60);
  const energy=await page.read(`(()=>{const samples=new Float32Array(2048);yardBarkProbe.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs));})()`);
  assert.ok(energy>.001,'generated bark has an audible waveform');
  await sleep(300);
  assert.equal(await page.read('window.mmm.yardDog.voice'),null,'bark gain is released after the source ends');
  await page.read('yardBarkProbe.disconnect();delete window.yardBarkProbe');
  console.log('PASS generated bark waveform and asynchronous cleanup');
  for(const [name,width,height,mobile] of [['desktop',1280,720,false],['phone',390,844,true]]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await sleep(1000);await page.shot(`${out}/yard-dog-${name}.png`);
  }
  console.log('PASS yard dog Mabou browser '+JSON.stringify(facts));
  writeFileSync(`${out}/yard-dog-browser.json`,JSON.stringify(facts,null,2));
  // Area and era exclusion must hold on real page loads, without adding a test switch to production.
  await page.navigate(`${base}/?era=1884&at=625186.89,5096638.05,150&x=1&q=low&hud=0&res=1`);
  assert.equal(await page.read('window.mmm.yardDog'),null,'no yard dog in 1884');
  console.log('PASS no yard dog in the historic era');
} finally {await page.close();}
exitCheck();
