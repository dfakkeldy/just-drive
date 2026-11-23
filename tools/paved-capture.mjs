/** One native browser; fixed chase poses; production shaders; WORK overlay only. */
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('..',import.meta.url));
import {open,sleep} from './cdp.mjs';
const [out,port]=process.argv.slice(2);mkdirSync(out,{recursive:true});
const places={pointtupper:[[629823,5052817,270],[625665,5051609,0],[628507,5052485,90]],porthood:[[613775,5096575,0],[613371,5096965,180],[614005,5096007,90]],mabou:[[623211,5102195,0],[624915,5103591,180],[624141,5103347,270],[625568,5101986,315],[625873,5102143,0]]};
const shots=[];
for(const [area,poses] of Object.entries(places))for(const [i,pose] of poses.entries())for(const on of [false,true]){
 const url=`http://127.0.0.1:${port}/?area=${area}&mode=explore&at=${pose.join(',')}&paved=${on?1:0}&hud=0&radio=0&shadows=1&exag=1&sun=original`;
 const page=await open(url);
 try{
  // The dev server serves each module as its own resource, and a page loads more than the default 250-entry resource
  // timing buffer holds, so a late paved fetch can drop out of it (with #156's modules it does). Reload with a larger
  // buffer, under a marker parameter the game ignores, so the settle wait cannot read the previous page.
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'performance.setResourceTimingBufferSize(100000)'});
  await page.navigate(url+'&timingBuffer=1');
  assert.equal(await page.read(`document.getElementById('gameError')?.hidden`),true);
  assert.ok(await page.read(`performance.getEntriesByType('resource').length`)<100000,'resource timing buffer holds every request');
  const requests=await page.read(`performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.includes('/paved/'))`);
  assert.equal(requests.length>0,on,'default must make no paved request');
  assert.equal(await page.read(`!!window.mmm?.terrain?.paved`),on,'the paved layer exists only when asked for');
  const file=`${out}/${area}-${i+1}-${on?'on':'off'}.png`;
  const result=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(file,Buffer.from(result.result.data,'base64'));
  shots.push({area,place:i+1,on,pose,url,file,pavedRequests:requests.length});
  console.log('CAPTURE',file);
  if(area==='pointtupper'&&i===0&&on){
   const gpu=await page.read(`import('/@fs/${repo}tools/paved-gpu-fixture.mjs').then(m=>m.pavedGpuFixture())`);
   writeFileSync(out+'/gpu-fixture.json',JSON.stringify(gpu,null,2)+'\n');
   const r1=await page.read(`import('/@fs/${repo}tools/paved-r1-gpu.mjs').then(m=>m.pavedR1Gpu())`);assert.ok(r1.passed);writeFileSync(out+'/runtime-shader.json',JSON.stringify(r1,null,2)+'\n');
   console.log('PASS native paved GLSL fixture',JSON.stringify(Object.fromEntries(Object.entries(gpu).map(([k,v])=>[k,v.passed]))));
  }
  assert.equal(page.errors.length,0,page.errors.join('\n'));
 }finally{await page.close();}
}
writeFileSync(out+'/pictures.json',JSON.stringify(shots,null,2)+'\n');
console.log('PASS open paved captures:',shots.length,'matched chase pictures (18 required lot views plus 4 apron views)');

// Print the local review chart in this same browser job, if one was prepared.
if(existsSync(out+'/metrics.html')){
 const page=await open(`http://127.0.0.1:${port}/@fs/${out}/metrics.html`);
 try{
  const pdf=await page.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  writeFileSync(out+'/metrics.pdf',Buffer.from(pdf.result.data,'base64'));
  console.log('PRINT',out+'/metrics.pdf');
 }finally{await page.close();}
}
