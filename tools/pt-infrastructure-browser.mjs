// Same runner and fixed cameras for clean-main and branch measurements. Start only through yard-shots.sh.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
const [out,...urls]=process.argv.slice(2);
if(out==='--compare'){
 const [main,branch]=urls;
 for(const name of ['conveyor-desktop','dam-desktop','conveyor-phone']){
  const a=JSON.parse(readFileSync(`${main}/${name}.json`)),b=JSON.parse(readFileSync(`${branch}/${name}.json`));
  assert.deepEqual(a.pose,b.pose);assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.equal(a.gpu,b.gpu);assert.ok(a.gpu);assert.equal(a.infrastructure,0);assert.equal(b.infrastructure,name.endsWith("-phone")?0:3);console.log(name,JSON.stringify({main:a,branch:b}));
 }
 process.exit(0);
}
mkdirSync(out,{recursive:true});
for(const url of urls){
 const name=new URL(url).searchParams.get('name'),c=await open(url);
 try{
  const phone=new URL(url).searchParams.get('touch')==='1';
  if(phone){await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await c.navigate(url);}
  await sleep(1500);
  const result=await c.read(`(()=>{const m=mmm,r=m.renderer,gl=r.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length,area:m.area.id,renderer:gl.getParameter(gl.RENDERER),width:innerWidth,height:innerHeight,pose:[m.camera.position.x,m.camera.position.y,m.camera.position.z],infrastructureBuildMs:m.scene.getObjectByName('Point Tupper mapped infrastructure')?.userData.buildMs??0,infrastructure:m.scene.getObjectByName('Point Tupper mapped infrastructure')?.children.length??0};})()`);
  const q=new URL(url).searchParams;assert.equal(result.area,q.get('area')??'pointtupper');assert.equal(result.infrastructure,Number(q.get('expect')??process.env.PT_EXPECT_INFRA??3));assert.equal(c.errors.length,0);
  await c.shot(`${out}/${name}.png`);writeFileSync(`${out}/${name}.json`,JSON.stringify(result,null,2));console.log(name,JSON.stringify(result));
 }finally{await c.close();}
}
