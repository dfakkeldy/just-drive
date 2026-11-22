// Run only through check-wharf-browser.sh -> yard-shots.sh -> browser.sh.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {open} from './cdp.mjs';
const [out,first]=process.argv.slice(2),branchOrigin=new URL(first).origin;
assert.ok(process.env.WHARF_MAIN_ROOT,'use check-wharf-browser.sh');
const measuredHead=execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(import.meta.dirname,'..'),encoding:'utf8'}).trim();
const source=readFileSync(new URL('../web/src/wharf-source.ts',import.meta.url),'utf8');
const wharves=JSON.parse(source.split('export const WHARF_SOURCES: readonly WharfSource[] = ')[1].trim().replace(/;$/,''));
const main=await createServer({root:process.env.WHARF_MAIN_ROOT+'/web',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},logLevel:'error'});
const costs=[],pictures=[],costsOnly=process.env.WHARF_COSTS_ONLY==='1';
const reportFile=costsOnly?'wharves-costs.json':'wharves.json';
mkdirSync(out,{recursive:true});
try{
 await main.listen();const mainOrigin='http://127.0.0.1:'+main.httpServer.address().port;
 for(const phone of [false,true]){
  const width=phone?390:1280,height=phone?844:720;
  for(const area of ['mabou','judique','porthood','pointtupper','cansocauseway','westbay']){
   const selected=wharves.filter(s=>s.area===area),base=area==='mabou'?'terrain':'areas/'+area;
   const manifest=JSON.parse(readFileSync(new URL('../data/baked/'+base+'/manifest.json',import.meta.url)));
   const cases=selected.length?selected:[{id:'control',centroid:manifest.village,length:30}];
   for(let i=0;i<cases.length;i++)for(const [label,origin] of [['main',mainOrigin],['branch',branchOrigin]]){
    // Main needs the same representative view per area. Additional branch views supply the full gallery.
    if((label==='main'||costsOnly)&&i>0)continue;
    // Disable grass: the manual settle loop below does not step grass, so fast cover readback must not race main vs branch on Mabou's inland control view.
    const s=cases[i],[e,n]=s.centroid,query=new URLSearchParams({area,mode:'explore',cam:`${e+80},${n-100},75,320,-30,60`,at:`${e},${n},0`,hud:'0',radio:'0',title:'0',res:'1',grass:'0',q:phone?'low':'high',touch:phone?'1':'0',exag:'1.5',hour:'12'});
    const page=await open(origin+'/?'+query);
    try{
     await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:phone});
     if(!phone&&manifest.farLand){
      const until=Date.now()+60000;
      while(!await page.read('!!(window.mmm&&mmm.farVisibility&&mmm.farLand&&mmm.tall&&mmm.farTurbines)')){
       assert.ok(Date.now()<until,`${area}/${label}: far views never loaded on after land`);
       await new Promise(resolve=>setTimeout(resolve,200));
      }
      await page.read(`(()=>{const v=mmm.farVisibility;v.update=()=>{};if(!v.records.length)throw Error('far views have no query meshes');for(const r of v.records)r.mesh.visible=true;})()`);
     }
     const result=await page.read(`(async()=>{
      window.requestAnimationFrame=()=>0;
      const m=mmm,{terrain:t,camera:c,renderer:r,trees,water}=m;let scene=m.vehicle.car.root;while(scene.parent)scene=scene.parent;
      const v=t.manifest.village;c.aspect=${width/height};c.position.set(${e+80}-v[0],75,v[1]-${n-100});c.lookAt(${e}-v[0],2,v[1]-${n});c.updateProjectionMatrix();c.updateMatrixWorld();r.setSize(${width},${height});
      r.info.autoReset=false;const kitTimes=[];
      let quiet=0;
      for(let i=0;i<240;i++){
       t.update(c);trees?.update(t.drawnFine,c.position);m.roads.update(c.position);const kitStart=performance.now();m.wharves?.update(c.position);kitTimes.push(performance.now()-kitStart);
       water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);
       quiet=t.pending===0&&(trees?.pending??0)===0?quiet+1:0;
       if(quiet>=8)break;await new Promise(resolve=>setTimeout(resolve,30));
      }
      if(t.pending)throw Error('terrain did not settle');
      const draw=()=>{r.info.reset();water?.update(c);r.render(scene,c);water?.settle();water?.afterRender(c);return{calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs.length}};
      const counts=draw(),kit=m.wharves,gl=r.getContext();
      let visiblePixels=0;
      if(kit?.placements.length){
       const shown=new Uint8Array(${width*height*4}),hidden=new Uint8Array(shown.length);
       gl.readPixels(0,0,${width},${height},gl.RGBA,gl.UNSIGNED_BYTE,shown);
       kit.group.visible=false;draw();gl.readPixels(0,0,${width},${height},gl.RGBA,gl.UNSIGNED_BYTE,hidden);
       for(let i=0;i<shown.length;i+=4)if(Math.max(Math.abs(shown[i]-hidden[i]),Math.abs(shown[i+1]-hidden[i+1]),Math.abs(shown[i+2]-hidden[i+2]))>8)visiblePixels++;
       kit.group.visible=true;draw();
      }
      // One forced re-plan of every wharf near the camera: the cost a tile load or LOD switch under them pays.
      let wharfPlanMs=0;if(kit){const start=performance.now();for(const st of kit.state)st.stamp='';kit.update(c.position);wharfPlanMs=performance.now()-start;}
      const batches=kit?[...kit.batches.values()].map(mesh=>({name:mesh.name,instances:mesh.count,instanced:mesh.isInstancedMesh})):[];
      return{...counts,wharfUpdateMaxMs:Math.max(...kitTimes),wharfPlanMs,batches,parts:kit?.placements.filter(p=>p.source===${JSON.stringify(s.id)}).length??0,visiblePixels,gpu:gl.getParameter(gl.RENDERER)};
     })()`);
     assert.ok(result&&Number.isFinite(result.calls),'actual WebGL counts');
     if(i===0)costs.push({area,mode:phone?'phone':'desktop',label,...result});
     if(!costsOnly&&label==='branch'&&s.id!=='control'){
      assert.ok(result.parts>0,s.id+' has no rendered parts');
      assert.ok(result.batches.every(b=>b.instanced),'instances only');
      const detail=await page.read(`(async()=>{
       const m=mmm,{camera:c,renderer:r,terrain:t}=m,p=m.wharves.placements.find(p=>p.source===${JSON.stringify(s.id)}&&p.kind==='pole')??m.wharves.placements.find(p=>p.source===${JSON.stringify(s.id)});
       let scene=m.vehicle.car.root;while(scene.parent)scene=scene.parent;
       const x=p.e-t.manifest.village[0],z=t.manifest.village[1]-p.n;
       c.position.set(x+12,p.height+9,z+16);c.lookAt(x,p.height+1,z);c.updateMatrixWorld();
       for(let i=0;i<100;i++){t.update(c);m.trees?.update(t.drawnFine,c.position);m.wharves.update(c.position);if(t.pending===0&&i>8)break;await new Promise(resolve=>setTimeout(resolve,30));}
       const draw=()=>{m.water?.update(c);r.render(scene,c);m.water?.settle();m.water?.afterRender(c)};
       const gl=r.getContext(),a=new Uint8Array(${width*height*4}),b=new Uint8Array(a.length);draw();gl.readPixels(0,0,${width},${height},gl.RGBA,gl.UNSIGNED_BYTE,a);
       m.wharves.group.visible=false;draw();gl.readPixels(0,0,${width},${height},gl.RGBA,gl.UNSIGNED_BYTE,b);m.wharves.group.visible=true;draw();
       let pixels=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>8)pixels++;
       return {pixels};})()`);
      assert.ok(detail.pixels>20,s.id+' has no visible dressing in close view');
      const file=`${area}-${s.id.replace(/[^a-z0-9-]/gi,'_')}-${phone?'phone':'desktop'}.png`;
      await page.shot(out+'/'+file);pictures.push({area,id:s.id,file,...result,detail});
     }
     assert.equal(page.errors.length,0,page.errors.join('\n'));
     console.log(label,area,s.id,phone?'phone':'desktop',JSON.stringify(result));
    }finally{await page.close();}
    writeFileSync(out+'/'+reportFile,JSON.stringify({main:process.env.WHARF_MAIN_SHA,head:measuredHead,costs,pictures},null,2));
   }
  }
 }
 // Matched cost: no change where nothing is dressed; elsewhere at most one added program and a bounded number of
 // instanced calls (seven batches, drawn in the main and shadow passes) and triangles.
 for(const mode of ['desktop','phone'])for(const area of ['mabou','judique','porthood','pointtupper','cansocauseway','westbay']){
  const [m,b]=['main','branch'].map(label=>costs.find(c=>c.area===area&&c.mode===mode&&c.label===label));
  const dressed=wharves.some(s=>s.area===area),d={calls:b.calls-m.calls,triangles:b.triangles-m.triangles,programs:b.programs-m.programs};
  console.log('COST',area,mode,JSON.stringify(d),'planMs',b.wharfPlanMs?.toFixed(2));
  if(!dressed)assert.deepEqual(d,{calls:0,triangles:0,programs:0},area+' '+mode+' has no wharves and must cost nothing');
  else{assert.ok(d.calls>=0&&d.calls<=14,area+' '+mode+' calls +'+d.calls);assert.ok(d.triangles>=0&&d.triangles<=20000,area+' '+mode+' triangles +'+d.triangles);assert.ok(d.programs<=1,area+' '+mode+' programs +'+d.programs);}
 }
 console.log('PASS '+(costsOnly?'all-pass costs only: ':'gallery: ')+'matched main/branch costs for six areas and all dressed wharf pictures, desktop and phone');
}finally{await main.close();}
