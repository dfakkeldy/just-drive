/** Real review poses, desktop/LOW, area-mean colour and controlled render diagnosis. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {open} from './cdp.mjs';
import {execFileSync} from 'node:child_process';
const repo=fileURLToPath(new URL('..',import.meta.url)),[out,port]=process.argv.slice(2);mkdirSync(out,{recursive:true});
// finish=0: the desktop finish pass (finish.ts) adds drifting cloud shadows, lens corner darkening and film grain
// that shift box brightness by wall time and screen position instead of pavement colour.
const base='mode=explore&hud=0&radio=0&shadows=1&exag=1&sun=original&finish=0';
const poses=[['m3-chase','mabou','at=624141,5103347,270'],['m3-top','mabou','at=624141,5103347,270&cam=624141,5103347,45,0,-89,60&camground=1'],['pt-chase','pointtupper','at=625990,5055120,315'],['pt-top','pointtupper','at=625972,5055120,0&cam=625972,5055138,20,0,-89,50&camground=1']];
const diagnostic=process.env.PAVED_DIAGNOSTIC==='1',results=[];
for(const [name,area,q] of poses){
 if(diagnostic&&!name.endsWith('-top'))continue;
 const modes=diagnostic?(process.env.PAVED_MODES?.split(',')??['control','control-flat','control-nopatch','control-noholes','control-unlit','control-light']):(process.env.PAVED_RENDER_MODES?.split(',')??(process.env.PAVED_BEFORE_WORK?['before','after','off']:['after','off']));
 for(const mode of modes){
  const url=`http://127.0.0.1:${port}/?area=${area}&${q}&${base}&paved=${mode==='off'?0:1}&pavedRevision=${mode==='off'?'after':mode}`;
  const page=await open(url);
  try{
   await page.shot(`${out}/${name}-${mode}.png`);results.push({name,mode,url});console.log('CAPTURE',name,mode);
   if(!diagnostic&&name==='m3-chase'&&mode==='after'){
    const gpu=await page.read(`import('/@fs/${repo}tools/paved-material-gpu.mjs').then(m=>m.pavedMaterialGpu())`);assert.ok(gpu.passed);writeFileSync(out+'/material-gpu.json',JSON.stringify(gpu,null,2)+'\n');
    const canopy=await page.read(`import('/@fs/${repo}tools/paved-r1-gpu.mjs').then(m=>m.pavedR1Gpu())`);assert.ok(canopy.passed);writeFileSync(out+'/canopy-gpu.json',JSON.stringify(canopy,null,2)+'\n');
   }

  }finally{await page.close();}
 }
}
writeFileSync(out+'/pictures.json',JSON.stringify(results,null,2)+'\n');console.log('PASS captures',results.length);

if(!diagnostic)execFileSync('python3',[repo+'tools/paved-colour-measure.py','--pictures',out],{stdio:'inherit'});
