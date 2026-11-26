// Actual game frames, serially, through the repository's bounded native GPU client.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [out,viewsFile]=process.argv.slice(2),port=process.env.CDP_PORT;
const views=JSON.parse(readFileSync(viewsFile,'utf8'));
const receipts=process.env.GROUND_RESUME==='1'&&existsSync(out+'/capture.json')
 ?JSON.parse(readFileSync(out+'/capture.json','utf8')).filter(r=>r.view.area!=='westbay'||r.stage==='installed')
 :[];
// Just Drive #78 installed the corrected West Bay pack. Its earlier rehearsal
// overlay is stale. Keep the A/B views for the two areas still in rehearsal.
const westBayCoverHashes={
 'cover-ground.bin':'e76149dc5aa06500a7e971f326e7e8244cc11232dc75c5d249867cefbb8f25fd',
 'cover.png':'cdc82db313786ce44806781afba999bd0bd189959fda82c3af4518f6f8248a0d',
};
for(const view of views)for(const stage of view.area==='westbay'?['installed']:['before','after']){
 const installed=stage==='installed';
 const expectsGround=stage!=='before';
 const existingName=view.area+'-'+view.name+'-'+stage;
 const saved=receipts.find(r=>r.name===existingName);
 const savedInstalledPack=Object.entries(westBayCoverHashes).every(([file,sha])=>saved?.coverHashes?.[file]===sha);
 const samePose=saved&&['e','n','heading'].every(k=>saved.view[k]===view[k]);
 if(process.env.GROUND_RESUME==='1'&&(!installed||(process.env.GROUND_MUTATE_STALE_WESTBAY!=='1'&&savedInstalledPack))&&samePose&&existsSync(out+'/'+existingName+'.png')&&!(expectsGround&&process.env.GROUND_REFRESH_AFTER==='1'))continue;
 let tab,c;
 try{
  const params=new URLSearchParams({area:view.area,mode:'explore',view:'chase',at:[view.e,view.n,view.heading].join(','),hud:'0',res:'1',q:'high',date:'2026-08-07',time:'14:00',exag:'1',radio:'0',groundBefore:stage==='after'||(installed&&process.env.GROUND_MUTATE_STALE_WESTBAY==='1')?'0':'1'});
  const url=(process.env.GROUND_URL??'http://127.0.0.1:5197')+'/?'+params;
  tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const coverResponses=new Map();
  const origin=new URL(url).origin;
  c=await cdp(tab.webSocketDebuggerUrl,{onEvent:({method,params})=>{
   if(!installed||method!=='Network.responseReceived')return;
   const responseUrl=new URL(params.response.url);
   for(const file of Object.keys(westBayCoverHashes)){
    if(responseUrl.origin===origin&&responseUrl.pathname==='/areas/westbay/'+file&&params.response.status===200){
     coverResponses.set(file,params.requestId);
    }
   }
  }});
  const read=async expression=>{
   const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   assert(!r.result?.exceptionDetails,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;
  };
  await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Network.enable',{maxTotalBufferSize:64*1024*1024,maxResourceBufferSize:24*1024*1024});await c.send('Network.setCacheDisabled',{cacheDisabled:true});
  await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url});
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){await sleep(500);if(await read('document.title==="settled"'))break;}
  assert.equal(await read('document.title'),'settled','ground view did not settle: '+url);
  const audit=await read(`(()=>{const m=window.mmm,t=m.terrain,v=m.vehicle;let bad=0,records=0;
   for(const tile of m.trees.tiles.values())if(tile!=='loading')for(const b of tile.batches)for(let k=0;k<b.matrices.length;k+=16){records++;const cls=t.groundClassAt(b.matrices[k+12],b.matrices[k+14]);if(cls===6||cls===8)bad++;}
   return {ground:!!t.manifest.cover.ground,groundClass:t.groundClassAt(v.x,v.z),groundBytes:t.groundCover?.byteLength??0,coverClass:t.coverAt(v.x,v.z),surface:t.surfaceAt(v.x,v.z),vehicle:[v.x+t.manifest.village[0],t.manifest.village[1]-v.z,v.y,v.heading],camera:m.camera.position.toArray(),pending:t.pending,failed:t.failed,trees:records,treesInClearedCells:bad,calls:m.renderer.info.render.calls,triangles:m.renderer.info.render.triangles,low:m.low,grass:!!m.grass,grassGroundShader:!!m.grass?.material.defines.GROUND_CLASSES,canvas:[m.renderer.domElement.width,m.renderer.domElement.height]};})()`);
  assert.equal(audit.ground,expectsGround,'wrong cover served');
  let coverHashes;
  if(installed){
   coverHashes={};
   for(const [file,expected] of Object.entries(westBayCoverHashes)){
    const requestId=coverResponses.get(file);
    assert.ok(requestId,'missing installed West Bay response for '+file);
    const {result,error}=await c.send('Network.getResponseBody',{requestId});
    assert.ok(!error,'could not read West Bay '+file+': '+JSON.stringify(error));
    assert.equal(result?.base64Encoded,true,'West Bay response must contain binary data: '+file);
    coverHashes[file]=createHash('sha256').update(Buffer.from(result.body,'base64')).digest('hex');
    assert.equal(coverHashes[file],expected,'wrong installed West Bay ground pack served: '+file);
   }
  }
  assert.equal(audit.treesInClearedCells,0);
  if(expectsGround){
   assert.ok(audit.groundBytes>0,'ground classes must load');
  }
  if(expectsGround)assert.equal(audit.grassGroundShader,true,'grass and terrain must share the new ground palette');
  assert.equal(audit.low,false);assert.equal(audit.grass,true);assert.deepEqual(audit.canvas,[1280,720]);
  assert(Math.hypot(audit.vehicle[0]-view.e,audit.vehicle[1]-view.n)<2,'chase pose drift');
  let expectedClass=view.expected_class;
  // The installed correction reclassified the old bog pose as wooded wetland.
  if(installed&&view.e===643923.84&&view.n===5065658.5)expectedClass=9;
  if(installed&&view.e===631920&&view.n===5062068)expectedClass=1;
  if(expectsGround&&expectedClass!==undefined){
   assert.equal(audit.coverClass,expectedClass,'view must show intended class');
   assert.equal(audit.groundClass,[6,8].includes(expectedClass)?expectedClass:0,'CPU clearing class must match the view');
  }
  assert(!c.logs.some(m=>/Shader Error|VALIDATE_STATUS false|ERROR: 0:|INVALID_(?:OPERATION|VALUE)/.test(m)),'WebGL shader failure');
  c.assertHealthy();const shot=await c.send('Page.captureScreenshot',{format:'png'});c.assertHealthy();
  const name=view.area+'-'+view.name+'-'+stage;writeFileSync(out+'/'+name+'.png',Buffer.from(shot.result.data,'base64'));
  const previous=receipts.findIndex(r=>r.name===name);if(previous>=0)receipts.splice(previous,1);
  receipts.push({name,url,view,stage,coverHashes,...audit,console:c.logs});writeFileSync(out+'/capture.json',JSON.stringify(receipts,null,2));
  console.log('PASS chase',name,'class',audit.coverClass,'trees',audit.trees,'calls',audit.calls);
 }finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
}
