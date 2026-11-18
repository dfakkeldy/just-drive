// Actual game frames, serially, through the repository's bounded native GPU client.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [out,viewsFile]=process.argv.slice(2),port=process.env.CDP_PORT;
const views=JSON.parse(readFileSync(viewsFile,'utf8'));
const receipts=process.env.GROUND_RESUME==='1'&&existsSync(out+'/capture.json')?JSON.parse(readFileSync(out+'/capture.json','utf8')):[];
for(const view of views)for(const stage of ['before','after']){
 const existingName=view.area+'-'+view.name+'-'+stage;
 const saved=receipts.find(r=>r.name===existingName);
 const samePose=saved&&['e','n','heading'].every(k=>saved.view[k]===view[k]);
 if(process.env.GROUND_RESUME==='1'&&samePose&&existsSync(out+'/'+existingName+'.png')&&!(stage==='after'&&process.env.GROUND_REFRESH_AFTER==='1'))continue;
 let tab,c;
 try{
  const params=new URLSearchParams({area:view.area,mode:'explore',view:'chase',at:[view.e,view.n,view.heading].join(','),hud:'0',res:'1',q:'high',date:'2026-08-07',time:'14:00',exag:'1',radio:'0',groundBefore:stage==='before'?'1':'0'});
  const url=(process.env.GROUND_URL??'http://127.0.0.1:5197')+'/?'+params;
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  c=await cdp(tab.webSocketDebuggerUrl);
  const read=async expression=>{
   const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   assert(!r.result?.exceptionDetails,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;
  };
  await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Network.enable');await c.send('Network.setCacheDisabled',{cacheDisabled:true});
  await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url});
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){await sleep(500);if(await read('document.title==="settled"'))break;}
  assert.equal(await read('document.title'),'settled','ground view did not settle: '+url);
  const audit=await read(`(()=>{const m=window.mmm,t=m.terrain,v=m.vehicle;let bad=0,records=0;
   for(const tile of m.trees.tiles.values())if(tile!=='loading')for(const b of tile.batches)for(let k=0;k<b.matrices.length;k+=16){records++;const cls=t.groundClassAt(b.matrices[k+12],b.matrices[k+14]);if(cls===6||cls===8)bad++;}
   return {ground:!!t.manifest.cover.ground,groundClass:t.groundClassAt(v.x,v.z),groundBytes:t.groundCover?.byteLength??0,coverClass:t.coverAt(v.x,v.z),surface:t.surfaceAt(v.x,v.z),vehicle:[v.x+t.manifest.village[0],t.manifest.village[1]-v.z,v.y,v.heading],camera:m.camera.position.toArray(),pending:t.pending,failed:t.failed,trees:records,treesInClearedCells:bad,calls:m.renderer.info.render.calls,triangles:m.renderer.info.render.triangles,low:m.low,grass:!!m.grass,grassGroundShader:!!m.grass?.material.defines.GROUND_CLASSES,canvas:[m.renderer.domElement.width,m.renderer.domElement.height]};})()`);
  assert.equal(audit.ground,stage==='after','wrong cover served');assert.equal(audit.treesInClearedCells,0);
  if(stage==='after')assert.equal(audit.grassGroundShader,true,'grass and terrain must share the new ground palette');
  assert.equal(audit.low,false);assert.equal(audit.grass,true);assert.deepEqual(audit.canvas,[1280,720]);
  assert(Math.hypot(audit.vehicle[0]-view.e,audit.vehicle[1]-view.n)<2,'chase pose drift');
  if(stage==='after'&&view.expected_class!==undefined)assert.equal(audit.coverClass,view.expected_class,'view must show intended class');
  assert(!c.logs.some(m=>/Shader Error|VALIDATE_STATUS false|ERROR: 0:|INVALID_(?:OPERATION|VALUE)/.test(m)),'WebGL shader failure');
  c.assertHealthy();const shot=await c.send('Page.captureScreenshot',{format:'png'});c.assertHealthy();
  const name=view.area+'-'+view.name+'-'+stage;writeFileSync(out+'/'+name+'.png',Buffer.from(shot.result.data,'base64'));
  const previous=receipts.findIndex(r=>r.name===name);if(previous>=0)receipts.splice(previous,1);
  receipts.push({name,url,view,stage,...audit,console:c.logs});writeFileSync(out+'/capture.json',JSON.stringify(receipts,null,2));
  console.log('PASS chase',name,'class',audit.coverClass,'trees',audit.trees,'calls',audit.calls);
 }finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
