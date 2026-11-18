// Point Tupper airport: one browser, serial pages. Each view loads airport=0 and then the airport,
// with fixed cameras and equal viewports, so the counts are a same-run pair on one GPU.
// Usage (registered row): RUN=airport-browser.mjs VIEWS="airport|area=pointtupper" tools/yard-shots.sh 1280 720
// Pictures and counts.json go to $MMM_CHECK_OUT/evidence/airport-browser/ (kept after a pass), else to OUT.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {open,sleep,exitCheck} from './cdp.mjs';
const [out,first]=process.argv.slice(2),base=new URL(first);
const evidence=process.env.MMM_CHECK_OUT?join(process.env.MMM_CHECK_OUT,'evidence','airport-browser'):out;
mkdirSync(evidence,{recursive:true});
// Three instanced lamp batches and one merged windsock: at most four extra draws in a frame (none cast shadows).
const MODEL_DRAWS=4;
const rows=[];
for (const [size,w,h] of [['desktop',1280,720],['phone',390,844]])for(const time of ['13:00','23:00']){
  for(const variant of ['off','airport']){
    const url=new URL(base);url.search=new URLSearchParams({area:'pointtupper',mode:'fly',cam:time==='23:00'?'626390,5057140,105,85,-2,70':'627000,5056400,700,0,-37,70',exag:'1',q:size==='phone'?'low':'high',touch:size==='phone'?'1':'0',study:'1',date:'2026-10-10',time,hud:'0',shadows:'1',...(variant==='off'?{airport:'0'}:{}),name:`${size}-${time}-${variant}`}).toString();
    const tab=await open(url.href);
    try{
      await tab.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:size==='phone'});
      await tab.navigate(url.href); await sleep(1500);
      const counts=await tab.read(`({calls:mmm.renderer.info.render.calls,triangles:mmm.renderer.info.render.triangles,programs:mmm.renderer.info.programs.length,airport:!!mmm.airport,area:mmm.area.id,sites:mmm.terrain.sites.length})`);
      assert.equal(counts.area,'pointtupper');assert.equal(counts.airport,variant==='airport','airport=0 builds no airport');
      if(variant==='airport'){
        // Probe 15 m inside each end: the coarse road texel nearest an exact
        // geometric boundary can be outside. The node check pins the exact ends.
        const g=await tab.read(`(()=>{const a=mmm.airport,s=a.site,v=s.village;return [.01,.5,.99].map(t=>{const p=s.data.runway.ends,e=p[0][0]+(p[1][0]-p[0][0])*t,n=p[0][1]+(p[1][1]-p[0][1])*t;const g=mmm.terrain.surfaceAt(e-v[0],v[1]-n);return {kind:g?.kind,ground:g?.ground};});})()`);
        assert.ok(g.every(x=>x.kind===13&&Number.isFinite(x.ground)),JSON.stringify(g));
        const lit=await tab.read(`mmm.airport.group.children.filter(x=>x.isInstancedMesh).reduce((s,m)=>s+m.count,0)`);
        assert.ok(lit>0,'runway lamps stand on drawn land');
        // The markings really reach a drawn tile: its program has the AIRPORT define and a live runway frame.
        const marked=await tab.read(`(()=>{let n=0;mmm.terrain.group.traverse(o=>{const m=o.material;if(o.isMesh&&o.visible&&m?.defines?.AIRPORT&&m.uniforms?.airportSize?.value.x>0)n++;});return n;})()`);
        assert.ok(marked>0,'a visible land tile draws the AIRPORT markings');
        await tab.shot(`${evidence}/${size}-${time.replace(':','')}.png`);
      }
      assert.equal(tab.errors.length,0,tab.errors.join('\n'));rows.push({size,time,variant,...counts});console.log(JSON.stringify(rows.at(-1)));
    }finally{await tab.close();}
  }
  const [off,on]=rows.slice(-2);
  assert.ok(on.calls-off.calls<=MODEL_DRAWS,`${size} ${time}: airport adds ${on.calls-off.calls} draws (at most ${MODEL_DRAWS})`);
}
writeFileSync(`${evidence}/counts.json`,JSON.stringify({rows},null,2));console.table(rows);
console.log('PASS airport browser: four view pairs, zero console errors');
exitCheck(0);
