// Native GPU loading proof. The production worker builds; the main thread only uploads bounded pages.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {measure} from './frame-budget-check.mjs';
import {modes,scenes} from './frame-budget-policy.mjs';
const out=process.env.BRIDGE_EVIDENCE??process.env.OUT;assert.ok(out);mkdirSync(out,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
writeFileSync(out+'/native-cut-verdict.json',JSON.stringify({head,status:'RUNNING'})+'\n');
const mode=modes.find(m=>m.id==='phone-explore-truck'),views=JSON.parse(readFileSync(new URL('./fixtures/bridge-views.json',import.meta.url))),rows=[];
for(const area of['mabou','judique','porthood','westbay','pointtupper','cansocauseway']){
 const view=views.find(v=>v.area===area),url=new URL(view.url),at=url.searchParams.get('at'),p=at.split(','),scene={id:'cuts-'+area,area,at,cam:[p[0],p[1],3.2,p[2],-5,60].join(',')};
 if(area==='cansocauseway'){scene.at='623614.320852833,5056071.99746173,70.60793148516687';scene.cam='623614.320852833,5056071.99746173,3.2,70.60793148516687,-5,60';}
 const result=await measure(scene,mode,async page=>{const image=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+area+'-cut-native.png',Buffer.from(image.data,'base64'));});
 assert.ok(result.cutWork.workerJobs>0&&result.cutWork.atlases>0,area+' really built a cut atlas');rows.push({area,...result.cutWork,guardrails:result.guardrails});console.log('PASS S3 '+JSON.stringify(rows.at(-1)));
 writeFileSync(out+'/native-cut-results.json',JSON.stringify(rows,null,2)+'\n');
}
let negative='';await assert.rejects(()=>measure(scenes.find(s=>s.id==='works-yard'),mode,async page=>{
 await page.read(`(async()=>{const c=mmm.terrain.roadCuts;c.worker=null;c.workerStarted=true;for(const key of ['steps','frames','maxFrameMs','maxStepMs','workerJobs','maxWorkerMs'])c.audit[key]=0;for(const t of mmm.terrain.tiles.values()){t.roadCutRevision=-1;c.update(t);}for(let i=0;i<1800&&c.pending;i++)await new Promise(r=>setTimeout(r,100));if(c.pending)throw Error('mutant failed to finish cuts');})()`);
}),error=>{negative=error.message;return /cut-field main-thread frame budget|browser cut raster uses its worker|browser cut raster runs off the main thread/.test(negative);});
console.log('KILLED S3 production worker removed: browser gate rejects main-thread rasterization');
writeFileSync(out+'/native-cut-verdict.json',JSON.stringify({head,status:'PASS',areas:rows.length,worstMainMs:Math.max(...rows.map(r=>r.mainWithUploadsMs)),workerRemoval:negative},null,2)+'\n');
