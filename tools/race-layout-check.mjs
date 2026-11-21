// Uses layout-check's real page, multiplayer fixture, phone sizes and safe-area harness.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { layoutFaults } from './hud-layout-geometry.mjs';

// Keep Province requests inside the page. The drawing is synthetic, never Province data.
export const racePropertyScript = `
localStorage.setItem('mmm:province-license:v1','accepted');
const realFetch=window.fetch;
window.fetch=async (input,options)=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.hostname.endsWith('novascotia.ca')){
    const c=document.createElement('canvas');c.width=c.height=640;
    const g=c.getContext('2d');g.strokeStyle='#7dffc9';
    for(let x=30;x<640;x+=80){g.beginPath();g.moveTo(x,0);g.lineTo(x+40,640);g.stroke();}
    return new Response(await new Promise(r=>c.toBlob(r,'image/png')),{headers:{'Content-Type':'image/png'}});
  }
  return realFetch(input,options);
};`;

const ids=['phoneLine','hud','shiftHud','stopHint','miniMap','relief','radio','photoTag','gear',
  'tcReset','tcView','tcHorn','tcSteer','tcTrack','tcBrake','tcGo','tcPull',
  'cameraButton','mailButton','placesButton','bikeJump','miniMapHead'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rectangles=`(() => {
  const visible=e=>e&&!e.hidden&&!e.closest('[hidden]')&&e.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
  const box=e=>{const b=e.getBoundingClientRect();return [e.id,b.left,b.top,b.right,b.bottom];};
  return ${JSON.stringify(ids)}.flatMap(id=>{const e=document.getElementById(id);return visible(e)?[box(e)]:[];});
})()`;
const panelBox=`(() => {
  const e=document.getElementById('racePanel'),r=e.getBoundingClientRect(),s=document.getElementById('settings').getBoundingClientRect();
  if(!r.width||!r.height||getComputedStyle(e).visibility==='hidden')return null;
  // Only the part painted inside the scroll panel can cover anything.
  return [e.id,Math.max(r.left,s.left),Math.max(r.top,s.top),Math.min(r.right,s.right),Math.min(r.bottom,s.bottom)];
})()`;

const overGoMutant=`(() => {
  const e=document.getElementById('raceReadout'),r=document.getElementById('tcGo').getBoundingClientRect();
  e.style.cssText='position:fixed;max-width:none;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';
})()`;
async function inspectReadout(p,w,h,insets,expected) {
  assert.equal(await p.read(`document.getElementById('settings').classList.contains('open')`),false,'race is readable while driving, Settings CLOSED');
  const readout=await p.read(`(() => {
    const e=document.getElementById('raceReadout');if(!e)return null;
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    const clips=[];let painted=!!e.getClientRects().length&&r.width>0&&r.height>0;
    for(let a=e;a;a=a.parentElement){const c=getComputedStyle(a);painted&&=!a.hidden&&c.display!=='none'&&c.visibility==='visible'&&Number(c.opacity)>0;
      const b=a.getBoundingClientRect();if(a!==e&&['hidden','clip','auto','scroll'].some(v=>[c.overflowX,c.overflowY].includes(v)))clips.push([b.left,b.top,b.right,b.bottom]);}
    return {rect:[e.id,r.left,r.top,r.right,r.bottom],painted,text:e.textContent,fits:e.scrollWidth<=e.clientWidth+1,pointerEvents:s.pointerEvents,whiteSpace:s.whiteSpace,overflow:s.overflow,textOverflow:s.textOverflow,lineHeight:parseFloat(s.lineHeight),padding:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom),clips};
  })()`);
  assert.ok(readout?.painted,'race readout is painted: positive rect, visible styles and ancestors');
  assert.equal(readout.text,expected,'visible countdown/time/result text');
  assert.equal(readout.pointerEvents,'none','readout cannot take driving touches');
  assert.equal(readout.whiteSpace,'nowrap');assert.equal(readout.overflow,'hidden');assert.equal(readout.textOverflow,'ellipsis');
  const controls=await p.read(rectangles);
  // No hit-test/occlusion filter: EVERY visible id counts, including controls under an overlay.
  for(const b of controls)assert.deepEqual(layoutFaults([readout.rect,b],w,h,[],insets),[],'race readout clears '+b[0]);
  assert.ok(readout.fits,'full race strip text fits its bar');
  const [,left,top,right,bottom]=readout.rect;
  assert.ok(bottom-top<=readout.lineHeight+readout.padding+.1,'readout stays on one line');
  for(const [l,t,r,b] of readout.clips)assert.ok(left>=l-.1&&top>=t-.1&&right<=r+.1&&bottom<=b+.1,'readout is not clipped by an ancestor');
  return {readout,controls};
}

export async function raceLayoutCheck({open,safeArea,sizes,outDir}) {
  // check-all removes its transient OUT on success. Retain named deliverables under data/work instead.
  const pictures=resolve(outDir,'../../race-layout-r2');mkdirSync(pictures,{recursive:true});
  const receipt=[];
  // Capture the exact pre-fix placement, not a guessed rectangle or a second copy of the physics.
  const oldStyle='position:fixed;right:10px;bottom:calc(80px + env(safe-area-inset-bottom,0px));z-index:7;background:#102531ed;color:#fff;border:1px solid #70939e;border-radius:10px;padding:10px;max-width:min(310px,80vw);max-height:45vh;overflow:auto;font:13px/1.4 system-ui';
  for(const [w,h,plain] of sizes) {
    const p=await open(w,h,'mode=mail');
    const shot=async name=>writeFileSync(`${pictures}/${name}.png`,Buffer.from((await p.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).result.data,'base64'));
    try {
      assert.ok(p.settled,'real game settles');
      if(w===1024&&h===768)assert.equal(await p.read(`matchMedia('(pointer: coarse)').matches`),true,'tablet case really has a coarse pointer');
      await p.read(`(()=>{const m=mmm.mp.current;window.raceCommands=[];m.net.raceCommand=(...args)=>raceCommands.push(args);m.net.serverNow=()=>20000;
        m.net.race={host:m.net.me.id,serial:1,route:null,startAt:0,racers:[]};m.race.update();})()`);
      for(const safe of plain?[false]:[false,true]) {
        const insets=await safeArea(p,w,h,safe);
        for(const property of [false,true]) for(const folded of [false,true]) {
          const name=`race-${w}x${h}-${safe?'safe':'plain'}-property-${property?'on':'off'}-${folded?'folded':'map'}`;
          await p.read(`(()=>{document.getElementById('settings').classList.remove('open');const toggle=document.getElementById('propertyLines');
            if(toggle.checked!==${property}){toggle.click();if(document.getElementById('propertyDialog')?.open)document.getElementById('propertyAgree').click();}
            const map=document.getElementById('miniMap');if(map.classList.contains('folded')!==${folded})document.getElementById('miniMapHead').click();})()`);
          await sleep(250);
          assert.equal(await p.read(`document.getElementById('propertyLines').checked`),property,'real property toggle');
          const controls=await p.read(rectangles);
          for(const id of ['phoneLine','gear','tcSteer','tcBrake','tcGo','tcReset','tcView','tcHorn','cameraButton','mailButton'])
            assert.ok(controls.some(b=>b[0]===id),'missing actual touch/HUD rectangle '+id);
          // Reproduce the former body-mounted pill and prove the overlap oracle detects it.
          const prior=await p.read(`(()=>{const e=document.getElementById('racePanel');window.savedRaceParent=e.parentElement;window.savedRaceNext=e.nextSibling;window.savedRaceStyle=e.style.cssText;
            window.savedSummaryStyle=e.querySelector('summary').style.cssText;
            document.body.append(e);e.style.cssText=${JSON.stringify(oldStyle)};e.querySelector('summary').style.cssText='';e.open=false;
            const r=e.getBoundingClientRect();return [e.id,r.left,r.top,r.right,r.bottom];})()`);
          const priorFaults=controls.flatMap(b=>layoutFaults([prior,b],w,h,[],insets));
          if(w===390&&h===844&&!safe&&!folded){
            assert.ok(priorFaults.some(f=>/racePanel\+tc(Go|Brake)/.test(f)),'old portrait placement covers a pedal');
            await shot(`${name}-before`);
          }
          await p.read(`(()=>{const e=document.getElementById('racePanel');savedRaceParent.insertBefore(e,savedRaceNext);e.style.cssText=savedRaceStyle;e.querySelector('summary').style.cssText=savedSummaryStyle;})()`);
          // Closed Settings paints no race pill at all. Test every rectangle, not only GO's centre.
          assert.equal(await p.read(panelBox),null,'race UI has no painted box over driving controls');
          assert.deepEqual(await p.read(`(${JSON.stringify(controls.filter(b=>['gear','tcReset','tcView','tcHorn','tcSteer','tcBrake','tcGo','tcPull','cameraButton','mailButton','miniMapHead','relief','radio','placesButton','bikeJump'].includes(b[0])).map(b=>b[0]))}).filter(id=>{
            const e=document.getElementById(id),r=e.getBoundingClientRect(),at=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
            return !(at===e||e.contains(at));})`),[],'all visible touch controls and HUD receive their own hit');
          if(!safe&&!folded)await shot(`${name}-after-driving`);
          assert.equal(await p.read(`!!document.getElementById('racePanel').closest('#settings')`),true,'phone race lives inside Settings');
          assert.equal(await p.read(`document.getElementById('settings').firstElementChild.id`),'settingsHeader','Settings header is first when the sheet opens');
          assert.equal(await p.read(`document.getElementById('racePanel').parentElement.id`),'mpRoom','race lives in the labelled Room group below the header');
          await p.read(`document.getElementById('gear').click();document.getElementById('racePanel').scrollIntoView({block:'center'})`);
          const summary=await p.read(`(()=>{const e=document.querySelector('#racePanel summary'),r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {height:r.height,reachable:at===e||e.contains(at)};})()`);
          assert.ok(summary.height>=56&&summary.reachable,'Room race is a reachable full-size Settings target');
          assert.equal(await p.read(`getComputedStyle(document.getElementById('racePanel')).position`),'static','expanded race scrolls inside Settings');

          await p.read(`document.querySelector('#racePanel summary').click()`);
          assert.equal(await p.read(`document.getElementById('racePanel').open`),true,'real summary opens race');
          await p.read(`(()=>{const e=document.querySelector('#racePanel select');e.value='0';e.dispatchEvent(new Event('change'));})()`);
          assert.equal(await p.read(`raceCommands.at(-1)?.[0]`),'select','course selection still dispatches');
          // Countdown, running time and results must PAINT while Settings is CLOSED.
          await p.read(`document.getElementById('gear').click()`);
          const states=[];
          for(const state of ['countdown','running','finished','spectator']) {
            await p.read(`(()=>{const m=mmm.mp.current,s=m.net.race;s.serial++;s.route={roadId:m.host?.roads?.[0]?.id??1,gates:[{x:mmm.vehicle.x,z:mmm.vehicle.z},{x:mmm.vehicle.x+50,z:mmm.vehicle.z},{x:mmm.vehicle.x+100,z:mmm.vehicle.z}]};
              s.startAt=${state==='countdown'?25000:7600};s.racers=${state==='spectator'?'[]':`[{id:m.net.me.id,next:1,time:${state==='finished'?2000:'null'},out:false}]`};m.race.update();})()`);
            const expected=state==='countdown'?'Race starts in 5':state==='running'?'Race · ring 2/3 · 12.4 s':state==='spectator'?'Spectating · 12.4 s':'Finished · 2.00 s';
            if(process.env.RACE_LAYOUT_MUTANT==='go')await p.read(overGoMutant);
            const measured=await inspectReadout(p,w,h,insets,expected);states.push({state,...measured});
            if(property&&!folded)await shot(`${name}-${state}`);
            if(state==='countdown'){
              const cues=await p.read(`(()=>{const m=mmm.mp.current,s=m.net.race,cues=[];for(const left of [5000,4000,3000,2000,1000,0]){s.startAt=m.net.serverNow()+left;m.race.update();cues.push([...document.querySelectorAll('body > .roomCountdownSay')].map(e=>e.textContent).filter(Boolean).join(''));}s.startAt=25000;m.race.update();return cues;})()`);
              assert.deepEqual(cues,['Start in 5','Start in 5','Start in 3','Start in 3','Start in 3','GO'],'body countdown voice remains available with Settings closed');
              const saved=await p.read(`document.getElementById('raceReadout').style.cssText`);
              await p.read(overGoMutant);
              try{await assert.rejects(()=>inspectReadout(p,w,h,insets,expected),{message:/raceReadout\+tcGo/},'GO-overlap mutant must fail the SAME painted-layout assertions');}
              finally{await p.read(`document.getElementById('raceReadout').style.cssText=${JSON.stringify(saved)}`);}
              console.log(`KILLED readout-over-GO ${w}x${h} safe=${safe} property=${property} folded=${folded}`);
            }
            // Keep the full Settings status regression too; hidden text is never the driving proof.
            const text=await p.read(`document.getElementById('racePanel').textContent`);
            assert.match(text,state==='countdown'?/Race starts in 5[\s\S]*Stay inside the start ring until GO\./:state==='running'?/Race · 12\.4 s[\s\S]*GO · checkpoint 2\/3 · 12\.4 s/:state==='spectator'?/Room race[\s\S]*Spectating · join the next race\./:/Race finished · results[\s\S]*Finished · 2\.00 s/);
          }
          await p.read(`document.getElementById('gear').click()`);
          for(const selector of ['summary','select','button:first-of-type','button:last-of-type']) {
            const reach=await p.read(`(()=>{const e=document.querySelector('#racePanel ${selector}');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.height>=56&&(at===e||e.contains(at));})()`);
            assert.ok(reach,'reachable race control '+selector);
          }
          await p.read(`document.querySelector('#racePanel button:last-of-type').scrollIntoView({block:'center'});document.querySelector('#racePanel button:last-of-type').click()`);
          assert.equal(await p.read(`raceCommands.at(-1)?.[0]`),'cancel','Clear race still dispatches');
          if(!safe&&!folded)await shot(`${name}-after-settings`);
          // Closing Settings, with the race details left open, must remove every race rectangle again.
          await p.read(`document.getElementById('gear').click()`);
          assert.equal(await p.read(panelBox),null,'open race details never leak out of closed Settings');
          receipt.push({w,h,safe,property,folded,controls,prior,priorFaults,racePaintedBox:null,states});
          await p.read(`(()=>{const m=mmm.mp.current;m.net.race={host:m.net.me.id,serial:m.net.race.serial+1,route:null,startAt:0,racers:[]};m.race.update();document.getElementById('racePanel').open=false;})()`);
          assert.equal(await p.read(`document.getElementById('raceReadout').hidden`),true,'clearing the course hides the readout');
        }
      }
      console.log(`PASS race ${w}x${h}: every touch/HUD rectangle, properties off/on, open/folded map, safe areas, Settings access and live race text`);
    } finally { await p.close(); }
  }
  writeFileSync(`${pictures}/rectangles.json`,JSON.stringify(receipt,null,2)+'\n');
  console.log('Race layout pictures and rectangles: '+pictures);
}
