// Every kit Places button, production game frames, real brake key, unchanged fleet physics.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
import {stuntStage} from './stunt-browser-stage.mjs';
import {tyreContacts} from './tyre-contacts.mjs';
const[out,url]=process.argv.slice(2),origin=new URL(url).origin,rows=[],photosOnly=process.env.STUNT_START_PHOTOS_ONLY==='1';
const p=await open(`${origin}/?park=test&mode=explore&vehicle=truck&trailer=1&radio=0&scene=0&hud=1`);
async function navigateVisible(url){
 const pulse=setInterval(()=>{p.send('Page.bringToFront').catch(()=>{});},200);
 try{await p.send('Page.bringToFront');await p.navigate(url);}
 catch(error){const state=await p.read(`({title:document.title,hidden:document.hidden,url:location.href,error:!document.getElementById('gameError')?.hidden,pending:window.mmm?.terrain?.pending,failed:window.mmm?.terrain?.failed,body:document.getElementById('gameError')?.textContent})`).catch(e=>({unavailable:String(e)}));writeFileSync(out+'/navigation-failure.json',JSON.stringify(state,null,2)+'\n');throw error;}
 finally{clearInterval(pulse);}
}
const brake=down=>p.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code:'Space',key:' ',windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
try{
 for(const low of photosOnly?[true]:[false,true])for(const hill of photosOnly?[2.5]:[1,1.5,2,2.5]){
  await navigateVisible(`${origin}/?park=test&mode=explore&vehicle=truck&trailer=1&exag=${hill}&q=${low?'low':'full'}&radio=0&scene=0&hud=1`);
  await p.send('Page.bringToFront');await p.read(stuntStage(tyreContacts));
  for(const index of [0,1]){
   await p.send('Page.bringToFront');
   await p.read(`(async()=>{const {testParkStarts}=await import('/src/stunt-test-park.ts'),s=testParkStarts(st.park)[${index}];await st.focus(st.park.dressing[${index}],-s.lead,s.lateral);})()`);
   await p.read(`(async()=>{
    const {testParkStarts}=await import('/src/stunt-test-park.ts'),start=testParkStarts(st.park)[${index}];
    mmm.places.open();mmm.frame(performance.now());
    const button=document.querySelector('button[data-place="'+start.id+'"]');if(!button)throw Error('missing production Places button');button.click();
    if(Math.hypot(mmm.vehicle.x-start.x,mmm.vehicle.z-start.z)>.01)throw Error('kit Places start refused');
    const gameFrame=mmm.frame,state=window.startReceipt={start,seconds:0,frames:0,done:false,maxLastHalf:0,maxRigLastHalf:0,maxPitch:0,firstPitch:null,minimumLevel:8,hiddenFrames:0,source:'actual Places button and game frames'};let previous=performance.now();
    window.requestAnimationFrame=callback=>nativeRAF(now=>{
     if(state.done&&callback===gameFrame)return;callback(now);if(callback!==gameFrame)return;
     state.rawNow=now;state.rawPrevious=previous;state.hidden=document.hidden;state.busy=mmm.places.busy;if(!document.hidden)state.seconds+=Math.max(0,Math.min(.1,(now-previous)/1000));else state.hiddenFrames++;previous=now;state.frames++;
     const t=mmm.towing,v=mmm.vehicle,pitch=Math.abs(t.pitch)*180/Math.PI;
     state.firstPitch??=t.pitch*180/Math.PI;state.maxPitch=Math.max(state.maxPitch,pitch);if(!document.hidden&&state.seconds>=.5)state.maxLastHalf=Math.max(state.maxLastHalf,pitch);
     for(const q of t.contacts)state.minimumLevel=Math.min(state.minimumLevel,mmm.terrain.surfaceAt(q.x,q.z)?.level??-1);
     state.last={pitch:t.pitch*180/Math.PI,roll:t.roll*180/Math.PI,truckPitch:v.pitch*180/Math.PI,truckRoll:v.roll*180/Math.PI,speed:v.speed,shift:Math.hypot(v.x-start.x,v.z-start.z),attached:t.attached};
     if(!document.hidden&&state.seconds>=.5)state.maxRigLastHalf=Math.max(state.maxRigLastHalf,pitch,Math.abs(t.roll*180/Math.PI),Math.abs(v.pitch*180/Math.PI),Math.abs(v.roll*180/Math.PI));
     if(state.seconds>=1-1e-6)state.done=true;
    });requestAnimationFrame(gameFrame);
   })()`);
   await brake(true);const began=Date.now();let r;
   while(Date.now()-began<120000){await p.send('Page.bringToFront');await brake(true);r=await p.read('startReceipt');writeFileSync(out+'/start-progress.json',JSON.stringify({hill,low,index,wallMs:Date.now()-began,...r},null,2)+'\n');if(r.done)break;await sleep(100);}
   await brake(false);rows.push({hill,low,index,...r});writeFileSync(out+'/stunt-starts.json',JSON.stringify({rows},null,2)+'\n');
   assert.ok(r?.done,'one actual simulated second must complete: '+JSON.stringify(r));
   assert.ok(r.maxPitch<12&&r.maxLastHalf<15&&r.maxRigLastHalf<15&&r.last.attached&&r.minimumLevel===8&&Math.abs(r.last.speed)<.15&&r.last.shift<.25,JSON.stringify(rows.at(-1)));
   const pulse=setInterval(()=>{p.send('Page.bringToFront').catch(()=>{});},100);
   try{
    await p.send('Page.bringToFront');await brake(true);
    await p.read(`(()=>{mmm.frame(performance.now());window.startPhotoActive=true;window.startPhotoDraws=0;function draw(){if(!startPhotoActive)return;const {renderer,scene,camera,water}=st;water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);startPhotoDraws++;window.nativeRAF(draw);}window.nativeRAF(draw);})()`);
    for(let n=0;n<100;n++){if(await p.read('startPhotoDraws>=3'))break;await sleep(50);}
    assert.ok(await p.read('startPhotoDraws>=3&&!document.hidden'),'visible chase render must be present for capture');
    await p.shot(`${out}/start-${index}-${hill}-${low?'low':'full'}.png`);
   }finally{clearInterval(pulse);await p.read('window.startPhotoActive=false');await brake(false);}

   console.log('PASS kit Places start',JSON.stringify({hill,low,index,seconds:r.seconds,firstPitch:r.firstPitch,last:r.last,maxLastHalf:r.maxLastHalf}));
   // Freeze between cases, while retaining the original browser scheduler.
   await p.read('window.requestAnimationFrame=callback=>{window.stoppedFrame=callback;return 0;}');
  }
 }
 assert.equal(rows.length,photosOnly?2:16);
}finally{writeFileSync(out+'/stunt-starts.json',JSON.stringify({rows},null,2)+'\n');await p.close();await sleep(2500);}
