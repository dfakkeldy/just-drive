// tools/check-page-access.sh
// Production static pages and PlacesUI, with real browser input and accessibility names.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { aboutPage, helpPage } from './about-pages.mjs';
import { cdp, cdpFetch } from './cdp.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [out] = process.argv.slice(2);
const FIXTURE=`import {PlacesUI} from './places-ui'; import {placesFor} from './places'; window.accessNoRoad=true; window.accessJumps=0; new PlacesUI(placesFor([624000,5103000]),[624000,5103000],{nearest:()=>window.accessNoRoad ? null : {x:0,z:0,heading:0,road:{kind:1,name:'Fixture road'},dist:0,seg:0,t:0}},{canOpen:()=>true,pause:()=>{},jump:()=>{window.accessJumps++}});`;
// The trap mutant is the production places-ui.ts with its Tab wrap and focusin containment removed.
// Each anchor must match once, so a rewrite of places-ui.ts fails here instead of passing a no-op mutant.
const TRAP_MUTANT=[["if (ev.code === 'Tab') {","if (false) {"],["document.addEventListener('focusin', ","((_type, _listener) => {})('focusin', "]];
const mutate=edits=>({name:'trap-mutant',setup(b){b.onLoad({filter:/places-ui\.ts$/},({path})=>{let src=readFileSync(path,'utf8');for(const [from,to] of edits){assert.equal(src.split(from).length,2,'mutant anchor '+from);src=src.replace(from,to);}return {contents:src,loader:'ts'};});}});
const panelBundle=async edits=>(await build({stdin:{contents:FIXTURE,resolveDir:root+'web/src',loader:'ts'},bundle:true,write:false,format:'esm',plugins:edits?[mutate(edits)]:[]})).outputFiles[0].text;
const bundle=await panelBundle(), trapMutant=await panelBundle(TRAP_MUTANT);
const style = readFileSync(root+'web/index.html','utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const server = createServer((req,res)=>{
  const path=req.url.split('?')[0];
  if(path==='/panel'||path==='/panel-mutant') {res.setHeader('Content-Type','text/html');res.end(`<html lang="en"><head><title>Places check</title><style>${style}</style></head><body><script type="module" src="${path}.js"></script></body></html>`);}
  else if(path==='/panel.js'||path==='/panel-mutant.js') {res.setHeader('Content-Type','text/javascript');res.end(path==='/panel.js'?bundle:trapMutant);}
  else if(path.startsWith('/about/img/')) {res.setHeader('Content-Type','image/jpeg');res.end(readFileSync(root+'assets/about/'+path.split('/').at(-1)));}
  else if(path==='/about/page-links.js') {res.setHeader('Content-Type','text/javascript');res.end(readFileSync(root+'tools/page-links.js'));}
  else if(!/^\/(about|help)\/(mail|just)$/.test(path)){res.writeHead(404);res.end();}
  else {const [,kind,brand]=path.split('/');res.setHeader('Content-Type','text/html');res.end((kind==='help'?helpPage:aboutPage)(brand==='just'?'just':'mail'));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const tab=await(await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/new?about:blank`,{method:'PUT'})).json();
const c=await cdp(tab.webSocketDebuggerUrl),{send}=c;
const read=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.result.value;
// Enter text is needed for native button keypress activation in CDP.
const pointer=async selector=>{const p=await read(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
const key=async(key,code=key,modifiers=0)=>{const windowsVirtualKeyCode=({Enter:13,Tab:9,Space:32,Escape:27,KeyL:76})[code];await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode,...(code==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});};
async function load(path){await send('Page.navigate',{url:base+path});for(let n=0;n<100;n++){if(await read(`location.pathname===${JSON.stringify(path)}&&document.readyState==='complete'`))return;await new Promise(r=>setTimeout(r,50));}throw Error('load timeout');}
async function shot(name){assert.equal(await read(`Promise.all(Array.from(document.images).map(async img=>{img.loading='eager';try{await img.decode();return img.naturalWidth>0;}catch{return false;}})).then(results=>results.every(Boolean))`),true,'images load');await read('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(r)))');writeFileSync(`${out}/after-${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).result.data,'base64'));}
async function names(){const tree=(await send('Accessibility.getFullAXTree')).result.nodes;const controls=tree.filter(n=>!n.ignored&&['link','button','combobox','checkbox','dialog','alertdialog'].includes(n.role?.value));assert.ok(controls.length);for(const n of controls)assert.ok(n.name?.value?.trim(),`unnamed ${n.role.value}`);return controls;}
// The open Places panel must be one named modal dialog in the accessibility tree.
async function dialog(){const tree=(await send('Accessibility.getFullAXTree')).result.nodes;const found=tree.filter(n=>!n.ignored&&n.role?.value==='dialog');assert.equal(found.length,1,'one open dialog');assert.equal(found[0].name?.value,'Places','dialog name');assert.equal(found[0].properties?.find(p=>p.name==='modal')?.value?.value,true,'dialog is modal');}
// Tab from the last control and Shift+Tab from the first stay inside the open panel.
// Recorded in window capture after the panel's own capture listener (which stops propagation).
// The panel must own Tab (default prevented): native Tab past the last control leaves the page for the browser's own
// controls, which headless Edge may not show, so the landing spot alone cannot prove the trap.
async function trapHolds(){const ends=await read(`(()=>{if(!window.accessTabLog){window.accessTabLog=[];addEventListener('keydown',e=>{if(e.code==='Tab')accessTabLog.push(e.defaultPrevented);},true);}accessTabLog.length=0;const b=[...document.querySelectorAll('#placesPanel button')];b.at(-1).focus();return b.length;})()`);await key('Tab');const forward=await read(`document.activeElement===document.querySelector('#placesPanel button')`);await key('Tab','Tab',8);const back=await read(`document.activeElement===[...document.querySelectorAll('#placesPanel button')].at(-1)`);const owned=await read(`accessTabLog.length===2&&accessTabLog.every(Boolean)`);return ends>1&&forward&&back&&owned;}
async function audit(root){
 assert.deepEqual(await read(`(()=>{const root=document.querySelector(${JSON.stringify(root)});let last=0;const errors=[];for(const h of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){const level=+h.tagName[1];if(last&&level>last+1)errors.push(h.textContent);last=level;}for(const img of root.querySelectorAll('img'))if(!img.hasAttribute('alt'))errors.push('missing alt');for(const list of root.querySelectorAll('ul,ol'))if([...list.children].some(x=>x.tagName!=='LI'))errors.push('list child');return errors;})()`),[],'headings, image alternatives and list children');
 if(root==='body')assert.equal(await read(`document.querySelectorAll('main h1').length`),1,'one page heading');
 await names();
 // A full-page screenshot does not expand an inner scroll view. Offscreen text ranges
 // used to sample the dim overlay outside Places, rather than their painted card.
 // Bring every text element into view and sample only pixels inside its scroll clips.
 const count=await read(`(()=>{const list=[...document.querySelectorAll(${JSON.stringify(root)}+' *')].filter(el=>el.getClientRects().length&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));list.forEach((el,i)=>el.dataset.contrastIndex=i);return list.length;})()`);
 const failures=[];
 for(let index=0;index<count;index++){
  await read(`document.querySelector('[data-contrast-index="${index}"]').scrollIntoView({block:'center',inline:'nearest'});window.accessHide=document.createElement('style');accessHide.textContent='*{-webkit-text-fill-color:transparent!important;text-shadow:none!important}';document.head.append(accessHide)`);
  const background=(await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).result.data;
  await read('accessHide.remove()');
  failures.push(...await read(`(async()=>{
   const image=new Image();image.src='data:image/png;base64,${background}';await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
   const el=document.querySelector('[data-contrast-index="${index}"]'),cs=getComputedStyle(el),errors=[];let samples=0;
   const rgb=s=>s.match(/[\\d.]+/g).map(Number);
   const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
   const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   const large=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.66&&+cs.fontWeight>=700);
   let left=0,top=0,right=innerWidth,bottom=innerHeight;
   for(let p=el.parentElement;p;p=p.parentElement){const st=getComputedStyle(p),r=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(st.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}if(/auto|scroll|hidden|clip/.test(st.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}}
   for(const node of el.childNodes){
    if(node.nodeType!==3||!node.textContent.trim())continue;
    const range=document.createRange();range.selectNodeContents(node);
    for(const rect of range.getClientRects())for(let y=Math.max(top,Math.ceil(rect.top)+2);y<Math.min(bottom,rect.bottom-2);y+=4)for(let x=Math.max(left,Math.ceil(rect.left)+2);x<Math.min(right,rect.right-2);x+=4){
     const at=document.elementFromPoint(x,y);if(at!==el&&!el.contains(at))continue;
     samples++;const bg=[...ctx.getImageData(Math.floor(x*image.width/innerWidth),Math.floor(y*image.height/innerHeight),1,1).data].slice(0,3),fg=blend(rgb(cs.color),bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
     if(ratio+.01<(large?3:4.5)){errors.push([node.textContent.trim().slice(0,45),Number(ratio.toFixed(2))]);break;}
    }
   }
   if(!samples)errors.push(['unmeasured text',el.textContent.trim().slice(0,45)]);
   return errors;
  })()`));
 }
 assert.deepEqual(failures,[],'rendered text contrast');
 const controls=await read(`Array.from(document.querySelectorAll(${JSON.stringify(root)}+' a[href],'+${JSON.stringify(root)}+' button')).filter(e=>e.getClientRects().length).map((e,i)=>{e.dataset.accessIndex=String(i);return e.textContent.trim()})`);
 assert.ok(controls.length,'visible controls exist');
 if(root==='body')await read('document.activeElement.blur(); window.scrollTo(0,0)');
 else await read(`document.querySelector('[data-access-index="0"]').focus()`);
 for(let i=0;i<controls.length;i++){
  if(root==='body'||i)await key('Tab');
  assert.equal(await read('document.activeElement.dataset.accessIndex'),String(i),'Tab reading order '+controls[i]);
  assert.ok(await read(`(()=>{const e=document.activeElement,s=getComputedStyle(e),r=e.getBoundingClientRect();return e.matches(':focus-visible')&&s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2&&r.bottom>0&&r.top<innerHeight;})()`),'visible keyboard focus '+controls[i]);
 }
 if(root!=='body'){await key('Tab');assert.equal(await read('document.activeElement.dataset.accessIndex'),'0','forward wrap');await key('Tab','Tab',8);assert.equal(await read('document.activeElement.dataset.accessIndex'),String(controls.length-1),'reverse wrap');}
}
try {
 await send('Page.enable');
 for(const [size,width,height] of [['desktop',1280,800],['phone',390,844]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  for(const brand of ['mail','just'])for(const kind of ['about','help']){
   await load(`/${kind}/${brand}`);await shot(`${kind}-${brand}-${size}`);
   await audit('body');
   // Prove both native Enter and the page's Space activation on every link without leaving the page.
   await read(`window.activations=0;document.addEventListener('click',e=>{if(e.target.closest('a')){e.preventDefault();window.activations++;}})`);
   const count=await read(`document.querySelectorAll('main a[href]').length`);
   for(let i=0;i<count;i++){await read(`document.querySelectorAll('main a[href]')[${i}].focus()`);for(const [k,code] of [['Enter','Enter'],[' ','Space']]){const before=await read('activations');await key(k,code);assert.equal(await read('activations'),before+1,`${kind} link ${i} ${code}`);}}
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   assert.equal(await read(`Array.from(document.querySelectorAll('main *')).some(e=>{const s=getComputedStyle(e);return s.animationName!=='none'||s.transitionDuration.split(',').some(t=>parseFloat(t)>0);})`),false,'reduced motion');
   await send('Emulation.setEmulatedMedia',{features:[]});
  }
  await load('/panel');await key('Tab');assert.equal(await read('document.activeElement.id'),'placesButton');await key('Enter');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),false,'Enter opens Places');await shot(`places-${size}`);
  assert.equal(await read(`document.querySelector('#placesList').tagName`),'UL','Places is a real list');assert.equal(await read(`document.querySelector('#placesList').getAttribute('role')`),'list','Places list keeps its role');assert.equal(await read(`document.getElementById(document.querySelector('#placesButton').getAttribute('aria-controls'))===document.querySelector('#placesPanel')`),true,'PLACES controls the panel');await dialog();assert.equal(await read(`document.querySelector('#placesButton').getAttribute('aria-expanded')`),'true','PLACES reports open');
  await read(`document.querySelector('#placesBody').scrollTop=1e6`);
  assert.equal(await read(`(()=>{const e=document.querySelector('#placesClose'),r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(at===e||e.contains(at));})()`),true,'Back stays in view at the end of Places');
  await read(`document.querySelector('#placesBody').scrollTop=0`);
  await audit('#placesCard');assert.equal(await trapHolds(),true,'Tab stays in Places');await key('Escape');assert.equal(await read(`document.querySelector('#placesButton').getAttribute('aria-expanded')`),'false','PLACES reports closed');assert.equal(await read('document.activeElement.id'),'placesButton','Escape restores opener');
  for(const [k,code] of [[' ','Space'],['Enter','Enter']]){await key(k,code);assert.equal(await read('document.querySelector("#placesPanel").hidden'),false,'open '+code);await read(`document.querySelector('#placesClose').focus()`);await key(k,code);assert.equal(await read('document.querySelector("#placesPanel").hidden'),true,'close '+code);}
  await read('document.activeElement.blur()');await key('l','KeyL');await key('Escape');assert.equal(await read('document.activeElement===document.body'),true,'L restores earlier focus');await key(' ','Space');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,'Space after L/Escape does not reopen');
  // L typed into a text field (Settings name or room code) is a letter, not the Places key.
  await read(`window.accessField=Object.assign(document.createElement('input'),{type:'text'});accessField.setAttribute('aria-label','Name');document.body.append(accessField);accessField.focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'l',code:'KeyL',text:'l',windowsVirtualKeyCode:76});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'l',code:'KeyL',windowsVirtualKeyCode:76});assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,'L in a text field does not open Places');assert.equal(await read('accessField.value'),'l','L in a text field types');await read('accessField.remove()');
  await read(`document.querySelector('#placesButton').focus()`);await key('Enter');await read(`document.querySelector('#placesList button').focus()`);await key(' ','Space');assert.equal(await read(`document.querySelector('#placesError').hidden`),false,'Space activates place choice');
  await key('Escape');await read('document.activeElement.blur()');await pointer('#placesButton');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),false,'pointer opens');await key('Escape');assert.equal(await read('document.activeElement===document.body'),true,'pointer open then Escape leaves no control focused');await key(' ','Space');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,'Space after a pointer open stays the brake');
  await pointer('#placesButton');await pointer('#placesClose');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,'pointer Back closes');assert.equal(await read('document.activeElement===document.body'),true,'pointer Back leaves no control focused');await key(' ','Space');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,'Space after pointer Back stays the brake');await read('window.accessNoRoad=false;document.activeElement.blur()');
  for(const [k,code] of [['Enter','Enter'],[' ','Space']]){
   await key('l','KeyL');const before=await read('accessJumps');await key(k,code);assert.equal(await read('accessJumps'),before+1,'keyboard place jump '+code);assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true);assert.equal(await read('document.activeElement===document.body'),true,'L choice leaves no control focused');await key(' ','Space');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,'brake does not reopen after L choice');
  }
  await read(`document.querySelector('#placesButton').focus()`);await key('Enter');
  // Programmatic outside focus is contained while the background stays inert.
  await read(`document.querySelector('#placesButton').inert=false;document.querySelector('#placesButton').focus()`);assert.equal(await read(`document.activeElement===document.querySelector('#placesList button')`),true,'focusin trap');await key('Escape');
  for(const method of ['pointer','keyboard']){
   await read(`document.querySelector('#placesButton').focus()`);if(method==='pointer')await pointer('#placesButton');else await key('Enter');const before=await read('accessJumps');await key('Enter');assert.equal(await read('accessJumps'),before+1,method+' choice jumps');assert.notEqual(await read('document.activeElement.id'),'placesButton',method+' choice clears control focus');await key(' ','Space');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),true,method+' choice keeps brake Space');
  }
  await read(`document.querySelector('#placesButton').focus()`);await key('Enter');
  // Remove all naming sources from a live production button. The same AX-name assertion must reject it.
  await read(`const victim=document.querySelector('#placesClose');victim.textContent='';victim.removeAttribute('aria-label');victim.removeAttribute('aria-labelledby');victim.removeAttribute('title')`);
  await assert.rejects(names,/unnamed button/);console.log('PASS missing-label mutant rejected '+size);
  // A dialog that loses its label must fail both the name sweep and the dialog check.
  await read(`document.querySelector('#placesPanel').removeAttribute('aria-labelledby')`);
  await assert.rejects(dialog,/dialog name/);await read(`document.querySelector('#placesClose').textContent='Back'`);await assert.rejects(names,/unnamed dialog/);console.log('PASS unlabelled-dialog mutant rejected '+size);
  // The production module without its focus trap: the same probe must see focus leave the open panel.
  await load('/panel-mutant');await read(`document.querySelector('#placesButton').focus()`);await key('Enter');assert.equal(await read(`document.querySelector('#placesPanel').hidden`),false,'mutant opens');
  assert.equal(await trapHolds(),false,'trap mutant must let focus out');
  await read(`document.querySelector('#placesButton').inert=false;document.querySelector('#placesButton').focus()`);assert.equal(await read(`document.activeElement.id`),'placesButton','focusin mutant must let focus out');console.log('PASS focus-trap mutant rejected '+size);
 }
 console.log('PASS page-access');
} finally {await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/close/${tab.id}`).catch(()=>{});c.close();server.close();}
