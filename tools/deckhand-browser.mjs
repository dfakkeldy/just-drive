// Run only through tools/yard-shots.sh and tools/browser.sh.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep,exitCheck} from './cdp.mjs';
const [out,first]=process.argv.slice(2),base=new URL(first).origin;
const page=await open(`${base}/?at=618856,5110138,0&cam=618844,5110122,4,325,-5,60&camground=1&q=high&hud=0&radio=0&res=1`);
try {
  for(let i=0;i<100&&!await page.read('mmm.deckhand?.group.visible');i++)await sleep(200);
  assert.equal(await page.read('mmm.deckhand.group.visible'),true,'guide is on real loaded land');
  const facts=await page.read(`(()=>{
    const d=mmm.deckhand,p=d.group.position,c=mmm.vehicle,t=mmm.terrain;
    // Height the game loop gave the feet, read before this probe calls update itself.
    const gameY=p.y,exag=t.exag,sea=t.seaLevel;
    const rows=[];
    for(const dx of [-40,-20,20,40,40.1]){
      d.update(1/60,{x:p.x+dx,z:p.z},mmm.camera.position);
      rows.push({dx,pointing:d.pointing,yaw:d.body.rotation.y});
    }
    d.update(1/60,{x:p.x+18,z:p.z-6},mmm.camera.position);
    const h=mmm.terrain.meshHeightAt(p.x,p.z,true);
    return {rows,height:p.y,gameY,drawn:h,exag,sea,road:mmm.roads.nearest(p.x,p.z,200)?.dist,area:mmm.area.id};
  })()`);
  for(const r of facts.rows){assert.equal(r.pointing,Math.abs(r.dx)<=40);if(r.pointing)assert.ok(Math.abs(r.yaw-Math.sign(r.dx)*Math.PI/2)<1e-6);}
  // Independent of meshHeightAt: tools/deckhand-placement.py surveys the baked ground under the 1 m footprint at 1.390-1.428 m.
  const lift=h=>h>facts.sea?facts.sea+(h-facts.sea)*facts.exag:h,low=lift(1.390)-.15,high=lift(1.428)+.15;
  assert.ok(facts.gameY>=low&&facts.gameY<=high,`game loop feet ${facts.gameY} outside surveyed dry ground ${low}..${high}`);
  assert.ok(Math.abs(facts.height-facts.gameY)<1e-9,'probe update keeps the game loop height');
  await page.read(`(()=>{const d=mmm.deckhand,p=d.group.position;d.update=()=>{};const s=mmm.vehicle.car.root.parent;
    s.onBeforeRender=(_r,_s,c)=>{c.fov=55;c.updateProjectionMatrix();c.position.set(p.x+4,p.y+2.6,p.z+5);c.lookAt(p.x,p.y+.9,p.z);c.updateMatrixWorld();};})()`);
  for(const [name,width,height,mobile] of [['desktop',1280,720,false],['phone',390,844,true]]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await sleep(700);await page.shot(`${out}/deckhand-${name}.png`);
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await page.read(`(()=>{const p=mmm.deckhand.group.position;mmm.vehicle.car.root.parent.onBeforeRender=(_r,_s,c)=>{c.fov=55;c.updateProjectionMatrix();c.position.set(p.x+16,p.y+12,p.z-23);c.lookAt(p.x,p.y,p.z+4);c.updateMatrixWorld();};})()`);
  await sleep(700);await page.shot(`${out}/deckhand-wharf.png`);
  writeFileSync(`${out}/deckhand-browser.json`,JSON.stringify(facts,null,2));console.log('PASS deckhand real land, 40 m turn, desktop/phone pictures',facts);
  await page.navigate(`${base}/?era=1884&at=618856,5110138,0&q=low&hud=0&res=1`);
  assert.equal(await page.read('mmm.deckhand'),null,'no modern figure in 1884');
} finally {await page.close();}
exitCheck();
