// Minimal HTML/event stand-in for the real standalone createTouchControls entry point.
import assert from 'node:assert/strict';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { spawnSync } from 'node:child_process';

function emptyDocument(width,height) {
 const watchers=[],pending=new Set(),events=new Map();
 const notify=(target,type)=>{for(const w of watchers)if(w.targets.some(t=>t.target===target&&t.options[type]))pending.add(w);};
 class Element {
  children=[];parentElement=null;id='';hidden=false;attributes={};listeners=new Map();classes=new Set();captures=new Set();textContent='';
  style={removeProperty(k){delete this[k];}};
  constructor(tag='div'){this.tagName=tag.toUpperCase();}
  classList={contains:k=>this.classes.has(k),add:(...ks)=>{ks.forEach(k=>this.classes.add(k));notify(this,'attributes');},remove:(...ks)=>{ks.forEach(k=>this.classes.delete(k));notify(this,'attributes');},toggle:(k,on)=>{const yes=on??!this.classes.has(k);yes?this.classes.add(k):this.classes.delete(k);notify(this,'attributes');return yes;}};
  set className(value){this.classes=new Set(value.split(/\s+/).filter(Boolean));notify(this,'attributes');}
  get className(){return [...this.classes].join(' ');}
  appendChild(e){if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);e.parentElement=this;this.children.push(e);notify(this,'childList');return e;}
  insertBefore(e,b){if(!b)return this.appendChild(e);assert.equal(b.parentElement,this,'insertBefore reference must belong to its parent');this.appendChild(e);this.children.pop();this.children.splice(this.children.indexOf(b),0,e);}
  replaceChildren(...nodes){this.children.forEach(e=>{e.parentElement=null;});this.children=[];nodes.forEach(e=>this.appendChild(e));}
  set innerHTML(html){
   this.replaceChildren();const stack=[this];
   for(const match of html.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)){
    if(match[0].startsWith('</')){if(stack.length>1)stack.pop();continue;}
    const e=new Element(match[1]),id=/\bid="([^"]*)"/.exec(match[0]),cls=/\bclass="([^"]*)"/.exec(match[0]);
    if(id)e.id=id[1];if(cls)e.className=cls[1];stack.at(-1).appendChild(e);
    if(!['BR','META','INPUT','IMG','HR'].includes(e.tagName)&&!match[0].endsWith('/>'))stack.push(e);
   }
  }
  querySelector(selector){const id=selector.slice(1);for(const e of this.children){if(e.id===id)return e;const child=e.querySelector(selector);if(child)return child;}return null;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(fn);}
  dispatch(type,fields={}){for(const fn of this.listeners.get(type)??[])fn({type,preventDefault(){},stopPropagation(){},...fields});}
  click(){this.dispatch('click');}
  setPointerCapture(id){this.captures.add(id);}
  get firstChild(){return this.children[0]??null;}
  get clientWidth(){return parseFloat(this.style.width)||this.parentElement?.clientWidth||280;}
  getBoundingClientRect(){const left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0,w=parseFloat(this.style.width)||0,h=parseFloat(this.style.height)||0;return {left,top,width:w,height:h,right:left+w,bottom:top+h};}
 }
 const html=new Element('html'),head=new Element('head'),body=new Element('body');html.appendChild(head);html.appendChild(body);
 const document={head,body,documentElement:html,hidden:false,createElement:tag=>new Element(tag),getElementById:id=>html.querySelector('#'+id),addEventListener(){}};
 const globals={document,innerWidth:width,innerHeight:height,navigator:{standalone:false},window:{visualViewport:{addEventListener(){}}},matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({paddingLeft:'8px',paddingRight:'8px',paddingBottom:'8px',paddingTop:'6px'}),
  addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},
  MutationObserver:class{targets=[];constructor(cb){this.cb=cb;watchers.push(this);}observe(target,options){assert.ok(target,'observe target');this.targets.push({target,options});}},
  ResizeObserver:class{constructor(cb){this.cb=cb;}observe(target){assert.ok(target,'resize target');}}};
 return {globals,flush(){for(let turn=0;pending.size;turn++){assert.ok(turn<20,'mount observers settle');const batch=[...pending];pending.clear();batch.forEach(w=>w.cb([]));}},fire:type=>(events.get(type)??[]).forEach(fn=>fn({type}))};
}

export async function checkTouchControlsMount(prior) {
 const {outputFiles}=await build({stdin:{contents:"export {createTouchControls} from './web/src/touch.ts'; export {installPhoneControls} from './web/src/phone-controls-layout.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',plugins:prior?[{name:'prior-source',setup(b){b.onLoad({filter:/web\/src\/(touch|phone-layout|phone-controls-layout)\.ts$/},a=>{const r=spawnSync('git',['show',`${prior}:web/src/${a.path.split('/').pop()}`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return {contents:r.stdout,loader:'ts'};});}}]:[]});
 const module=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 for(const [width,height] of [[390,844],[844,390]])for(const partial of [false,true]) {
  const f=emptyDocument(width,height),saved=new Map(Object.keys(f.globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  try {
   for(const [k,value] of Object.entries(f.globals))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value});
   document.body.replaceChildren();
   document.head.appendChild(Object.assign(document.createElement('meta'),{name:'viewport',content:'width=device-width, initial-scale=1'}));
   if(partial){const panel=document.createElement('div');panel.id='settings';document.body.appendChild(panel);const outside=document.createElement('button');outside.id='startOver';document.body.appendChild(outside);}
   let reset=0,view=0,horn=0;
   const controls=module.createTouchControls({reset(){reset++;},view(){view++;},horn(){horn++;}});f.flush();
   assert.equal(!!document.getElementById('settings'),partial,'no game settings are manufactured');
   const go=document.getElementById('tcGo'),brake=document.getElementById('tcBrake');
   go.dispatch('pointerdown',{pointerId:11});go.dispatch('pointerdown',{pointerId:12});assert.equal(controls.state.throttle,1);
   go.dispatch('pointerup',{pointerId:11});assert.equal(controls.state.throttle,1,'one finger keeps standalone GO held');
   brake.dispatch('pointerdown',{pointerId:13});assert.equal(controls.state.throttle,-1);
   brake.dispatch('pointerup',{pointerId:13});assert.equal(controls.state.throttle,1);
   go.dispatch('pointercancel',{pointerId:12});assert.equal(controls.state.throttle,0);
   document.getElementById('tcReset').click();document.getElementById('tcView').click();document.getElementById('tcHorn').click();assert.deepEqual([reset,view,horn],[1,1,1]);
   go.dispatch('pointerdown',{pointerId:14});controls.show(false);f.flush();assert.equal(controls.state.throttle,0);assert.equal(go.hidden,true);
   controls.show(true);f.flush();assert.equal(go.hidden,false);
   go.dispatch('pointerdown',{pointerId:15});f.fire('blur');assert.equal(controls.state.throttle,0);
   // A caller may also install just the planner into an existing control root, without any HUD slots.
   document.body.replaceChildren();const root=document.createElement('div');root.id='phoneHud';document.body.appendChild(root);
   module.installPhoneControls(root);f.flush();
  } finally {
   for(const [k,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}
  }
 }
 console.log('PASS real touch controls mount in an empty document and partial shell at both orientations; pedal/buttons/hide/blur and root-only install');
}
