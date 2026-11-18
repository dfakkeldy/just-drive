#!/usr/bin/env node
// Deliberately break physical entry, the gulf course, sea anchoring and the low camera, then restore each.
import {assert,writeFileSync,out,port,tab,ws,errors,send,read,key,load} from './fishing-browser.mjs';
const valid = async()=>read(`({gulf:ft.f.art.boat.position.x < -1800,low:ft.camera.position.y<8,afloat:Math.abs(ft.f.art.boat.position.y+.2)<.06,bowUp:ft.f.art.boat.rotation.x<-.02})`);
try {
  await send('Runtime.enable');await send('Page.enable');await load('&fishingCheck=1&exag=2.5');
  const clean=await read('ft.route()');assert.ok(clean.offer && clean.air===0 && clean.entryStep<.035 && clean.entryVy<3,'R14 clean physical entry');
  await read(`ft.endings.close();ft.f.judge.reset();window.savedHeight=ft.terrain.heightAt;ft.terrain.heightAt=function(x,z){const h=window.savedHeight.call(this,x,z),v=z-ft.s.z;return h===null?h:v>6&&v<7.2?h+.65:h};ft.c.restart(ft.s.x+137.52,ft.s.z-305.83,168*Math.PI/180)`);
  const broken=await read('ft.route()');console.log('Broken entrance',JSON.stringify({...broken,trace:undefined}));
  assert.throws(()=>assert.ok(broken.air===0&&broken.entryStep<.035&&broken.entryVy<3),'REJECTED R14 stepped entry');
  await read('ft.terrain.heightAt=window.savedHeight;ft.fixture()');await key('Enter','Enter',13);
  const duration=await read('ft.f.departureDuration()');await read(`ft.endingAt(${duration})`);assert.deepEqual(await valid(),{gulf:true,low:true,afloat:true,bowUp:true});
  await read('window.savedMove=ft.endings.move;ft.endings.move=seconds=>{window.savedMove(seconds);ft.camera.position.y=130}');await read('ft.endingAt(ft.endings.seconds+1)');
  assert.equal((await valid()).low,false,'REJECTED R15 map camera');await read('ft.endings.move=window.savedMove;ft.endingAt(ft.endings.seconds+1)');
  await read('ft.endings.move=seconds=>window.savedMove(Math.min(seconds,35));ft.endingAt(ft.endings.seconds+1)');
  assert.equal((await valid()).gulf,false,'REJECTED R15 stops inside harbour');await read('ft.endings.move=window.savedMove;ft.endingAt(ft.endings.seconds+1)');
  await read('window.savedPose=ft.f.pose;ft.f.pose=function(seconds){window.savedPose.call(this,seconds);this.art.boat.position.y+=this.site.top};ft.endingAt(ft.endings.seconds+1)');
  assert.equal((await valid()).afloat,false,'REJECTED R14 boat follows exaggerated deck');await read('ft.f.pose=window.savedPose;ft.endingAt(ft.endings.seconds+1)');
  assert.deepEqual(await valid(),{gulf:true,low:true,afloat:true,bowUp:true},'R14-15 restored');
  await read(`(async()=>{for(let i=0;i<20;i++){ft.terrain.update(ft.camera);ft.draw();await new Promise(r=>setTimeout(r,80))}})()`);
  assert.ok(await read('ft.r.info.programs.every(p=>!p.diagnostics||p.diagnostics.runnable)'),'R15 low-angle programs compile');
  assert.equal(errors.length,0,errors.join('\n'));
  writeFileSync(`${out}/course-mutation-results.json`,JSON.stringify({clean:{...clean,trace:undefined},broken:{...broken,trace:undefined},restored:await valid()},null,2));
  console.log('PASS actual-entry, high camera, inland stop and exaggerated floating-height regressions fail, then restored course/sea/camera pass.');
} finally {await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);ws.close();}
