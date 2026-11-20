#!/usr/bin/env node
// No browser: exercise the production rectangle writer, then use an independent viewport/band oracle.
import assert from 'node:assert/strict';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync } from 'node:fs';
import { layoutFaults, targetFaults } from './hud-layout-geometry.mjs';
import { checkTouchControlsMount } from './touch-controls-mount.mjs';
if(process.argv.includes('--prior-empty-document')) {
 try {await checkTouchControlsMount('7c29525');} catch(error) {console.error(error.name+': '+error.message);process.exit(1);}
 process.exit(0);
}
await checkTouchControlsMount();
const source=readFileSync('web/src/phone-controls-layout.ts','utf8');
const css=readFileSync('web/src/phone-layout.ts','utf8');
const carrier=readFileSync('web/index.html','utf8');
const browser=readFileSync('tools/phone-hud-browser.mjs','utf8');
// The built site puts the carrier's <style> after the module CSS, so the landscape strip rule must outrank
// the carrier's body.tcOn.compactPhone #placeArrival min-width by specificity, not by order.
assert.ok(/body\.tcOn\.compactPhone #placeArrival\{[^}]*min-width:min\(220px,100%\)/.test(carrier),'carrier keeps its arrival min-width');
assert.ok(css.includes('body.tcOn.compactPhone #phoneHud #placeArrival{width:fit-content;min-width:0}'),'landscape arrival strip fits its text over the carrier rule');
const legacy=readFileSync('tools/layout-check.mjs','utf8');
assert.ok(browser.includes("document.body.classList.contains('tcOn') && document.documentElement.dataset.mmmReady==='true'"),'named Just Drive waits on the hidden ready signal');
assert.doesNotMatch(browser,/document\.title\s*===\s*['"]settled/,'named pages retain their titles');
assert.match(carrier,/#phoneHud #radio b\{width:auto;white-space:normal;overflow:visible;text-overflow:clip/,'frequency-first station names wrap within their chip');
assert.match(carrier,/#phoneHint #stopHint\{[^}]*white-space:pre-line[^}]*-webkit-line-clamp:2;max-height:36px/,'phone hint keeps two full lines');
assert.match(css,/flex-wrap:nowrap;gap:2px/,'radio is two complete fixed-height lines');
const ordinarySong = 'body.tcOn #radio:not(.lost):not(.weak):not(.call) span{display:none!important}';
assert.equal(css.split(ordinarySong).length - 1, 2, 'both compact radio rules preserve lost, weak and call status');
assert.doesNotMatch(css, /body\.tcOn #radio span\{display:none!important\}/, 'no blanket rule hides radio status');
assert.ok(14*3+2*2+10<=56,'three station-name lines, two gaps, padding and border fit the chip');
assert.match(css,/installPhoneControls\(root\)/,'actual phone grid must install the tested writer');
assert.match(css,/#phoneAux\{width:180px;height:56px\}/,'absolute utility buttons retain their header grid reservation');
assert.match(css,/calc\(22vh - 56px\)/,'short landscape headers clear the band');
const mutations=process.argv.includes('--mutations') ? [
 ['grown-status-ignored','Math.max(56, v.statusHeight ?? 56)','56'],
 ['fixed-portrait-pedals','Math.min(100, available)','100'],
 ['ignore-safe-bottom','const bottom = v.height - v.bottom - 8','const bottom = v.height - 8'],
 ['landscape-stacking-removed','sideDrive || rightSpace < 142','false'],
 ['native-safe-area-unobserved','resize.observe(root);','/* native padding changes not observed */'],
 ['readout-overflow-ignored','return start + height + 6 > Math.min(...stops);','return false;'],
 ['writer-not-positioned',"position: 'absolute'","position: 'static'"],
] : [];
async function verify(text, styles=css) {
 const {outputFiles}=await build({stdin:{contents:text,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const {phoneControls,placePhoneControls,movePhoneReadouts,phoneReadoutsInSettings,installPhoneControls}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 let cases=0;
 const views=[];
 for(let width=320;width<=480;width+=20)for(let height=460;height<=1000;height+=20)if(height>=width)
  for(const [bottom,top] of [[0,6],...(height>=553?[[34,63]]:[])])views.push({width,height,left:0,right:0,bottom,top,safeTop:top===63?47:0});
 for(let width=500;width<=1100;width+=25)for(let height=265;height<=500;height+=15)if(width>height)
  for(const inset of [false,true])for(const standalone of [false,true])views.push({width,height,left:inset?47:0,right:inset?47:0,bottom:inset?21:0,top:Math.min(standalone?16:6,Math.max(0,.22*height-56)),safeTop:0});
 for(const [width,height,inset] of [[320,568,false],[320,640,false],[360,740,false],[280,653,false],[344,1000,false],[600,400,false],[568,280,false],[320,460,false],[553,375,false],[667,375,true],[568,320,false],[640,360,false],[375,553,false],[375,667,false],[390,664,false],[390,844,false],[430,932,false]])
  views.push({width,height,left:inset?47:0,right:inset?47:0,bottom:inset?21:0,top:width>height?Math.min(6,Math.max(0,.22*height-56)):6});
 const inventory=legacy.match(/const SIZES = \(process\.env\.SIZES \?\? '([^']+)'/);assert.ok(inventory,'browser size inventory');
 for(const token of inventory[1].split(/\s+/)){
  const [w,h]=token.replace('-plain','').split('x').map(Number);
  for(const safe of token.endsWith('-plain')?[false]:[false,true]) {
   const portrait=h>=w,left=safe&&!portrait?47:0,bottom=safe?(portrait?34:21):0,safeTop=safe&&portrait?47:0;
   views.push({width:w,height:h,left,right:left,bottom,top:portrait?safeTop+6:Math.min(6,Math.max(0,.22*h-56)),safeTop});
  }
 }
 for(const {width,height,left,right,bottom,top,safeTop=0} of views)for(const hintHeight of (width>height?[0,14,36]:[0,36,96,186]))for(const mail of [false,true])for(const pull of [false,true]) {
  const elements=new Map();
  const find=id=>{if(!elements.has(id))elements.set(id,{style:{removeProperty(k){delete this[k];}}});return elements.get(id);};
  placePhoneControls(phoneControls({width,height,left,right,bottom,top,hintHeight,mail,pull}),find);
  const boxes=[...elements.entries()].filter(([,e])=>e.style.position).map(([id,e])=>{
   assert.equal(e.style.position,'absolute','the applied rectangle must own placement');
   const x=parseFloat(e.style.left),y=parseFloat(e.style.top),w=parseFloat(e.style.width),h=parseFloat(e.style.height);
   return {id,x,y,w,h};
  });
  const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.01&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.01;
  const landscape=width>height;
  const band={x:width/4,y:height*(landscape?.22:.30),w:width/2,h:height*(landscape?.56:.42)};
  for(const b of boxes) {
   assert.ok(b.w>=(['mailButton','cameraButton'].includes(b.id)?64:56)&&b.h>=(['mailButton','cameraButton'].includes(b.id)?64:56),'touch minimum '+b.id);
   const utility=['tcReset','tcView','tcHorn'].includes(b.id);
   const minTop=landscape&&utility?top:top+56;
   assert.ok(b.x>=left-.01&&b.x+b.w<=width-right+.01&&b.y>=minTop-.01&&b.y+b.h<=height-bottom+.01,'viewport/top row clearance '+JSON.stringify({width,height,bottom,b}));
   assert.ok(!overlap(b,band),'protected driving band '+JSON.stringify({width,height,bottom,b}));
  }
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(!overlap(boxes[i],boxes[j]),'controls overlap '+boxes[i].id+' '+boxes[j].id);
  const statusHeight=!landscape&&!mail&&pull&&width===280?75:56;
  const view={statusHeight,width,height,left,right,bottom,top,hintHeight:landscape&&mail?Math.max(36,hintHeight):hintHeight,mail,pull};
  const menu=phoneReadoutsInSettings(view), x0=left+8, x1=width-right-8, gap=4;
  const strip=Math.min(190,.22*width,.25*width-12-left), info=[];
  const add=(id,x,y,w,h)=>info.push([id,x,y,x+w,y+h]);
  const gearRight=landscape?x1-186:x1;
  add('gear',gearRight-56,top,56,56);
  const places=mail?0:80;
  if(places)add('placesButton',gearRight-62-places,top,places,56);
  // Model the rendered bar, including padding. The old content-box cap spilled 10px into a 6px gap.
  const droneInFlow=!boxes.some(b=>b.id==='droneButton'), statusEnd=gearRight-62-places-(places?6:0)-(droneInFlow?62:0);
  if(droneInFlow)add('droneButton',gearRight-118,top,56,56);
  const statusWidth=Math.min(landscape?Infinity:440,statusEnd-x0);
  const lineRule=styles.match(/body\.tcOn\.compactPhone #phoneLine\{([^}]+)\}/)?.[1];assert.ok(lineRule,'phone line CSS');
  const padding=Number(lineRule.match(/padding:2px (\d+)px/)[1])*2;
  const borderBox=/box-sizing:border-box/.test(lineRule), fits=/width:fit-content/.test(lineRule);
  assert.ok(/max-width:100%/.test(lineRule),'phone line caps its width');
  for(const content of [36,120,360,600]) {
    const paintedWidth=borderBox?Math.min(fits?content+padding:statusWidth,statusWidth):Math.min(content,statusWidth)+padding;
    assert.ok(paintedWidth<=statusWidth+.01,'speed bar ends at least 6px before gear or DRONE '+JSON.stringify({width,height,statusWidth,paintedWidth}));
    if(borderBox&&content+padding<statusWidth)assert.equal(paintedWidth,content+padding,'short bar fits its content');
  }
  add(mail?'phoneLine':'hud',x0,top,statusWidth,statusHeight);
  if(hintHeight&&!(landscape&&menu))add(mail?'stopHint':'placeArrival',x0,top+statusHeight+6,landscape||height<600?strip:x1-x0-62,landscape?(mail?36:14):hintHeight);
  const start=top+statusHeight+12+(landscape?(mail?36:14):hintHeight);
  if(!menu) for(const folded of [false,true])for(const photo of [false,true]) {
   const rows=[...info], push=(...b)=>rows.push(b), mapWidth=folded?58:Math.min(landscape?78:86,landscape?Math.max(58,(strip-gap)*.8/1.8):strip);
   const mapHeight=folded?58:mapWidth+56;
   push('miniMap',x0,start,x0+mapWidth,start+mapHeight);
   if(landscape){
    const col=Math.max(58,(strip-gap)*.8/1.8), row=56+Math.max(0,mapHeight-116)/2;
    if(mail)push('relief',x0+col+gap,start,x0+strip,start+56);
    push('radio',x0+col+gap,start+row+gap,x0+strip,start+row+gap+56);
    if(mail&&photo)push('photoTag',x0,start+2*row+2*gap,x0+strip,start+2*row+2*gap+(height<320?23:36));
   }else{
    if(mail)push('relief',x0,start+mapHeight+gap,x0+strip,start+mapHeight+gap+56);
    const radioY=start+mapHeight+2*gap+(mail?56:0);
    push('radio',x0,radioY,x0+strip,radioY+56);
    if(mail&&photo)push('photoTag',x0,radioY+56+gap,x0+strip,radioY+56+gap+(height<=700?23:49));
   }
   const controls=boxes.map(b=>[b.id==='tcSteer'?'tcTrack':b.id,b.x,b.y,b.x+b.w,b.y+b.h]);
   const list=[...rows,...controls], safe={left,right,top:safeTop,bottom};
   assert.deepEqual(layoutFaults(list,width,height,[],safe),[],'browser geometry rules '+JSON.stringify(view));
   assert.deepEqual(targetFaults(list,['miniMap','radio','relief','gear','tcReset','tcView','tcHorn','tcBrake','tcGo','tcPull','mailButton','cameraButton']),[],'browser touch-size rules');
  }
  else {
   const list=[...info,...boxes.map(b=>[b.id==='tcSteer'?'tcTrack':b.id,b.x,b.y,b.x+b.w,b.y+b.h])];
   assert.deepEqual(layoutFaults(list,width,height,[],{left,right,top:safeTop,bottom}),[],'browser geometry with readouts in settings '+JSON.stringify(view));
  }
  assert.equal(boxes.some(b=>b.id==='tcPull'),pull,'PULL presence');
  assert.equal(boxes.some(b=>b.id==='mailButton'),mail,'MAIL presence');
  placePhoneControls(null,find);assert.ok([...elements.values()].every(e=>!e.style.position),'orientation/mode change restores grid placement');
  cases++;
 }
 // Reparent the same nodes; their bindings and readout identities must survive the narrow-view menu.
 const home={children:[],appendChild(e){e.parentElement=this;this.children.push(e);}}, panel={...home,children:[],hidden:true};
 const radio={listener:()=>{}}, map={}, readouts={parentElement:home,children:[map,radio]};
 movePhoneReadouts(true,readouts,home,panel);assert.equal(readouts.parentElement,panel);assert.equal(panel.hidden,false);
 assert.equal(readouts.children[1],radio);assert.ok(radio.listener);
 movePhoneReadouts(false,readouts,home,panel);assert.equal(readouts.parentElement,home);assert.equal(panel.hidden,true);
 assert.ok(phoneReadoutsInSettings({width:390,height:844,left:0,right:0,bottom:0,mail:false,pull:false,statusHeight:700,hintHeight:0}),'grown status reserves space before readouts');
 assert.ok(phoneReadoutsInSettings({width:667,height:375,left:47,right:47,bottom:21,mail:true,pull:false}));
 assert.ok(!phoneReadoutsInSettings({width:844,height:390,left:0,right:0,bottom:0,mail:true,pull:false}));
 // Native safe-area CSS changes need no window resize or DOM-style mutation.
 const all=[],resizeHooks=[];
 class Element {
  id='';children=[];parentElement=null;hidden=false;style={removeProperty(k){delete this[k];}};classes=new Set(['tcOn']);
  classList={contains:k=>this.classes.has(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};
  constructor(id=''){this.id=id;all.push(this);}
  appendChild(e){if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);e.parentElement=this;this.children.push(e);return e;}
  insertBefore(e,b){this.appendChild(e);this.children.pop();this.children.splice(this.children.indexOf(b),0,e);}
  getBoundingClientRect(){return {height:innerWidth>innerHeight?14:36};}
 }
 let safe={top:0,bottom:0};
 const root=new Element('phoneHud'),middle=new Element('phoneMiddle'),readout=new Element('phoneReadouts'),settings=new Element('settings');
 middle.appendChild(readout);settings.appendChild(new Element('startOver'));
 for(const id of ['phoneDrive','phoneHint','stopHint','tcSteer','tcBrake','tcGo','tcReset','tcView','tcHorn','cameraButton','mailButton'])new Element(id);
 globalThis.document={body:new Element('body'),documentElement:new Element('html'),createElement:()=>new Element(),getElementById:id=>all.find(e=>e.id===id)??null};
 globalThis.innerWidth=390;globalThis.innerHeight=844;globalThis.window={visualViewport:{addEventListener(){}}};globalThis.addEventListener=()=>{};
 globalThis.getComputedStyle=()=>({paddingLeft:((safe.left??0)+8)+'px',paddingRight:((safe.right??0)+8)+'px',paddingTop:(safe.top+6)+'px',paddingBottom:(safe.bottom+8)+'px'});
 globalThis.MutationObserver=class{observe(){}};
 globalThis.ResizeObserver=class{constructor(cb){this.cb=cb;}observe(target){resizeHooks.push({target,cb:this.cb});}};
 installPhoneControls(root);
 safe={top:47,bottom:34};
 for(const hook of resizeHooks)if(hook.target===root)hook.cb([]);
 const applied=['tcSteer','tcBrake','tcGo','tcReset','tcView','tcHorn','cameraButton','mailButton'].map(id=>{
  const s=document.getElementById(id).style,x=parseFloat(s.left),y=parseFloat(s.top),w=parseFloat(s.width),h=parseFloat(s.height);
  return [id==='tcSteer'?'tcTrack':id,x,y,x+w,y+h];
 });
 assert.deepEqual(layoutFaults(applied,390,844,[],{top:47,bottom:34,left:0,right:0}),[],'native safe-area update must clear the home indicator without a resize/style event');
 globalThis.innerWidth=667;globalThis.innerHeight=375;safe={top:0,bottom:21,left:47,right:47};
 for(const hook of resizeHooks)if(hook.target===root)hook.cb([]);
 assert.equal(readout.parentElement.id,'phoneReadoutsPanel','actual installer moves narrow readouts');
 assert.equal(document.getElementById('stopHint').parentElement.id,'phoneReadoutsPanel','full landscape hint remains reachable');
 globalThis.innerWidth=390;globalThis.innerHeight=844;safe={top:47,bottom:34};
 for(const hook of resizeHooks)if(hook.target===root)hook.cb([]);
 assert.equal(readout.parentElement,middle,'actual installer restores the same readouts');
 assert.equal(document.getElementById('stopHint').parentElement.id,'phoneHint','actual installer restores the hint');
 return cases;
}
console.log('PASS '+await verify(source)+' production size/hint-grid layouts using browser geometry rules, native safe-area lifecycle, PULL and menu restoration');
if(process.argv.includes('--mutations')) {
 assert.ok(css.includes('box-sizing:border-box;width:fit-content;max-width:100%'),'speed bar mutation anchor');
 await assert.rejects(()=>verify(source,css.replace('box-sizing:border-box;width:fit-content;max-width:100%','width:fit-content;max-width:100%')),{name:'AssertionError'},'content-box speed bar must fail the same gap assertion');
 console.log('KILLED padded-speed-bar-overflow (assertion failure)');
}
for(const [name,from,to] of mutations){assert.equal(source.split(from).length,2,name+' anchor');await assert.rejects(()=>verify(source.replace(from,to)),{name:'AssertionError'});console.log('KILLED '+name+' (assertion failure)');}
