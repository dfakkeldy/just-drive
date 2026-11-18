/** Fixed review poses, legacy/fixed/off comparison; one native job. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {open} from './cdp.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url)),[out,port]=process.argv.slice(2);mkdirSync(out,{recursive:true});
const entries=JSON.parse(readFileSync(process.env.PAVED_REVIEW_SHOTS??repo+'tools/paved-r1-poses.json','utf8')).filter(x=>['mabou3-chase','pt-hwy4-top','pt-hwy4-chase','pt2-chase','mabou4-top'].includes(x.name)&&x.on===1);
const mabou=entries.find(x=>x.name==='mabou3-chase');if(mabou){const url=new URL(mabou.url);url.searchParams.set('cam','624141,5103347,45,0,-89,60');url.searchParams.set('camground','1');entries.push({...mabou,name:'mabou3-top',url:url.href});}
const names=process.env.PAVED_CAPTURE_NAMES?.split(',');const selected=names?entries.filter(x=>names.includes(x.name)):entries;
const results=names?JSON.parse(readFileSync(out+'/pictures.json','utf8')).filter(x=>!names.includes(x.name)):[];
for(const item of selected)for(const state of ['before','after','off']){
 const url=new URL(item.url);url.port=port;url.searchParams.set('paved',state==='off'?'0':'1');url.searchParams.set('pavedRevision',state==='before'?'before':'after');
 const page=await open(url.href);
 try{
  if(state==='after'&&item.name==='pt2-chase'){
   const gpu=await page.read(`import('/@fs/${repo}tools/paved-r1-gpu.mjs').then(m=>m.pavedR1Gpu())`);assert.ok(gpu.passed);writeFileSync(out+'/runtime-shader.json',JSON.stringify(gpu,null,2)+'\n');
  }
  const requests=await page.read(`performance.getEntriesByType('resource').filter(x=>x.name.includes('/paved/')).length`);assert.equal(requests>1,state!=='off','paved layer must really load');
  const failed=await page.read(`performance.getEntriesByType('resource').filter(x=>x.name.includes('/paved/')&&x.responseStatus>=400).map(x=>x.name)`);assert.equal(failed.length,0,'paved work data must be available: '+JSON.stringify(failed));
  await page.shot(out+'/'+item.name+'-'+state+'.png');results.push({name:item.name,state,url:url.href});console.log('CAPTURE',item.name,state);
 }finally{await page.close();}
}
writeFileSync(out+'/pictures.json',JSON.stringify(results,null,2)+'\n');console.log('PASS r1 runtime shader and',results.length,'matched captures');
