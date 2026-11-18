import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep, exitCheck } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method:'PUT' })).json();
const c = await cdp(tab.webSocketDebuggerUrl);
const read = async expression => {
  const r = await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert.ok(!r.error && !r.result.exceptionDetails,JSON.stringify(r));
  return r.result.result.value;
};
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  for (const low of [false,true]) {
    const url = new URL(first); url.search = `site=just&area=pointtupper&mp=0&at=628146.721,5052750.914,0&time=22:00&date=2026-11-15${low?'&q=low':''}`;
    await c.send('Page.navigate',{url:url.href});
    let ready=false;
    for (let i=0;i<240;i++) { await sleep(500); if(await read(`document.documentElement.dataset.mmmReady==='true' && !!window.mmm?.trafficSignals`)){ready=true;break;} }
    assert.ok(ready,'game ready');
    let grounded=false;
    for(let i=0;i<120;i++) {
      if(await read(`(()=>{const m=mmm.camera.matrix.clone(); mmm.trafficSignals.group.children[1].getMatrixAt(0,m);return m.elements[13]>1;})()`)){grounded=true;break;}
      await sleep(500);
    }
    assert.ok(grounded,'head grounded after terrain loads');
    const result = await read(`(()=>{
      const s=mmm.trafficSignals, r=mmm.renderer, group=s.group;
      if(s.stops.length!==14)throw Error('missing approaches');
      const isolated=new mmm.scene.constructor(); isolated.add(group.clone(true));
      const camera=mmm.camera.clone(), head=group.children[1], matrix=mmm.camera.matrix.clone(); head.getMatrixAt(0,matrix);
      const target=mmm.camera.position.clone().setFromMatrixPosition(matrix), stop=s.stops[0];
      if(target.y<1)throw Error('head not grounded');
      camera.position.set(target.x+stop.dx*8,target.y,target.z+stop.dz*8); camera.lookAt(target); camera.updateMatrixWorld();
      r.render(isolated,camera);
      const calls=r.info.render.calls,triangles=r.info.render.triangles, gl=r.getContext();
      const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let bright=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>150)bright++;
      r.render(mmm.scene,mmm.camera);return {calls,triangles,bright,low:mmm.low};
    })()`);
    assert.equal(result.calls,5); assert.equal(result.triangles,924); assert.ok(result.bright>20,'self illuminated lamps without scene lights'); assert.equal(result.low,low);
    console.log('PASS',low?'LOW':'desktop',JSON.stringify(result));
    const shot=await c.send('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${out}/traffic-signals-${low?'low':'desktop'}.png`,Buffer.from(shot.result.data,'base64'));
  }
  c.assertHealthy();
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{}); }
exitCheck();
