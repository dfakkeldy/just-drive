// Native hardware-browser pictures. Called while holding the repository's one Mac browser lease.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const out=process.argv[2]??'data/work/threads/bridges',tag=process.env.TAG??'before';mkdirSync(out,{recursive:true});
const viewFile=process.env.BRIDGE_VIEWS??(existsSync(out+'/capture-views.json')?out+'/capture-views.json':new URL('./fixtures/bridge-views.json',import.meta.url));
const views=JSON.parse(readFileSync(viewFile));
const receipts=[];
async function open(url){
 const port=process.env.CDP_PORT,tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json(),c=await cdp(tab.webSocketDebuggerUrl,{deadline:180000});
 const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.error,JSON.stringify(r.error));return r.result.result.value;};
 const close=async()=>{try{await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);}finally{c.close();}};
 try{
  await c.send('Page.enable');await c.send('Page.navigate',{url});let ready=false;
  for(let i=0;i<300;i++){await sleep(250);if(await read(`document.documentElement.dataset.mmmReady==='true'&&!!window.mmm`)){ready=true;break;}}
  assert.ok(ready,'bridge page readiness signal: '+await read('document.title+" "+document.body.innerText.slice(0,500)'));
  return{read,close,shot:async path=>{const r=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(path,Buffer.from(r.result.data,'base64'));}};
 }catch(e){await close();throw e;}
}
for(const v of views){
 const url=new URL(v.url);if(process.env.WEB_PORT)url.port=process.env.WEB_PORT;
 const page=await open(url.href);
 try{
  const settled=await page.read(`(async()=>{for(let i=0;i<300;i++){if(mmm.terrain.pending===0&&!mmm.terrain.roadCuts.pending)return true;await new Promise(r=>setTimeout(r,100))}return false})()`);assert.ok(settled,'bridge terrain and cut atlas ready');
  await page.read(`window.requestAnimationFrame=fn=>{window.bridgeNextFrame=fn;return 0}`);await sleep(100);
  const result=await page.read(`(()=>{const p=new URLSearchParams(location.search).get('at').split(',').map(Number),m=mmm.terrain.manifest,c=mmm.vehicle;c.place(p[0]-m.village[0],m.village[1]-p[1],p[2]*Math.PI/180);if(${JSON.stringify(v.scenario??'')}==='underpass'){c.y=c.prevGround=mmm.terrain.landHeightAt(c.x,c.z);c.captureGround();}if(${JSON.stringify(v.scenario??'')}==='respawn'){c.trail=[{x:c.x,z:c.z,heading:c.heading,y:c.y}];c.respawn();}mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});mmm.chase(1);mmm.roads.update(mmm.camera.position);mmm.scene.updateMatrixWorld(true);mmm.renderer.render(mmm.scene,mmm.camera);const gl=mmm.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {area:mmm.area.id,car:{x:c.x,z:c.z,y:c.y,heading:c.heading},camera:{x:mmm.camera.position.x,y:mmm.camera.position.y,z:mmm.camera.position.z},land:mmm.terrain.heightAt(c.x,c.z),deck:mmm.roads.deckHeight(c.x,c.z),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),draws:mmm.renderer.info.render.calls,pending:mmm.terrain.pending,glError:gl.getError()}})()`);
  assert.doesNotMatch(result.gpu,/swiftshader|llvmpipe|software/i,'hardware renderer required');
  assert.equal(result.glError,0,'bridge render has no WebGL error');
  const prefix=`${tag}-${v.area}-${v.id}`;
  await page.shot(`${out}/${prefix}-seat.png`);
  await page.read(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'v',code:'KeyV',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'v',code:'KeyV',bubbles:true}));mmm.chase(1);mmm.scene.updateMatrixWorld(true);mmm.renderer.render(mmm.scene,mmm.camera)`);
  await page.shot(`${out}/${prefix}-chase.png`);
  result.chase=await page.read('({x:mmm.camera.position.x,y:mmm.camera.position.y,z:mmm.camera.position.z})');
  receipts.push({...v,url:url.href,...result,prefix});writeFileSync(`${out}/${tag}-pictures.json`,JSON.stringify(receipts,null,2)+'\n');
  console.log('CAPTURED',prefix,result.gpu,result.draws);
 }finally{await page.close();}
}
