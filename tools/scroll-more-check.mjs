// Node lifecycle check. Browser rows own painted boxes and hit tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const source=readFileSync('web/src/scroll-more.ts','utf8');
async function verify(contents) {
 const {outputFiles}=await build({stdin:{contents,loader:'ts'},platform:'node',format:'esm',write:false});
 const {scrollMore}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 const frames=[],observers=[],listeners={};let shown=true,child,hostChild,layoutReads=0,scrollTop=0;
 const panel={hidden:false},classes=new Set();
 const scroller={baseHeight:250,style:{},
  get clientHeight(){layoutReads++;return 100;},get clientWidth(){layoutReads++;return 150;},
  get scrollTop(){layoutReads++;return scrollTop;},set scrollTop(value){scrollTop=value;},
  get scrollHeight(){layoutReads++;return Math.max(this.clientHeight,this.baseHeight+(classes.has('moreRoom')?20:0));},
  classList:{contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},
  addEventListener:(name,fn)=>listeners[name]=fn,closest:()=>panel,
  getBoundingClientRect:()=>{layoutReads++;return {left:8,bottom:200};}};
 globalThis.document={createElement:()=>child={style:{},setAttribute(k,v){this[k]=v;}}};
 globalThis.getComputedStyle=()=>{layoutReads++;return {paddingBottom:'16px'};};
 globalThis.requestAnimationFrame=fn=>frames.push(fn);
 globalThis.addEventListener=(name,fn)=>listeners[name]=fn;
 globalThis.ResizeObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}};
 globalThis.MutationObserver=class{targets=[];constructor(fn){this.fn=fn;observers.push(this);}observe(target,options){this.targets.push({target,options});}};
 scrollMore(scroller,()=>shown,'settingsMore',{append:n=>hostChild=n});
 assert.equal(child,hostChild,'host owns the band, not the scroller');assert.equal(child['aria-hidden'],'true');
 const flush=()=>{let count=0;while(frames.length){assert.ok(count++<10,'refresh converges');frames.shift()();}};
 for(let i=0;i<100;i++)observers.at(-1).fn();assert.equal(frames.length,1,'frame mutations coalesce');flush();
 assert.equal(child.hidden,false);assert.ok(classes.has('moreRoom'));assert.equal(child.style.top,'176px');
 scroller.scrollTop=1e6;listeners.scroll();flush();assert.equal(child.hidden,true,'end hides the band');
 scroller.scrollTop=0;shown=false;layoutReads=0;
 for(let i=0;i<100;i++)observers.at(-1).fn();assert.equal(frames.length,1,'closed sheet mutations still coalesce');
 flush();assert.equal(child.hidden,true,'closed sheet hides cue');assert.equal(layoutReads,0,'closed scroller does no layout reads');
 shown=true;scroller.baseHeight=95;assert.ok(classes.has('moreRoom'),'near-fit fixture starts with extra padding');
 observers.at(-1).fn();flush();assert.ok(!classes.has('moreRoom'),'content just inside the box releases extra padding');assert.equal(child.hidden,true,'near-fit content hides the band');
 shown=true;scroller.baseHeight=80;observers.at(-1).fn();flush();assert.equal(child.hidden,true);assert.ok(!classes.has('moreRoom'),'no overflow leaves no padding');
 assert.ok(observers.at(-1).targets.some(t=>t.target===panel&&t.options.attributeFilter.includes('hidden')),'Places hidden state is observed');
}
await verify(source);
for(const [name,from,to] of [
 ['overflow padding','scroller.classList.toggle(\'moreRoom\', room);',''],
 ['shown guard','if (!isShown()) { band.hidden = true; return; }',''],
 ['closed layout read','if (!isShown())','if ((scroller.scrollHeight, !isShown()))'],
 ['padding subtraction',"scroller.scrollHeight - (scroller.classList.contains('moreRoom') ? extra : 0)",'scroller.scrollHeight'],
 ['coalescing','if (!pending) {','if (true) {'],
 ['end cue','scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1','false'],
]){assert.ok(source.includes(from));await assert.rejects(()=>verify(source.replace(from,to)),{name:'AssertionError'},name+' must fail');}
console.log('PASS external band, overflow-only room, top/end/closed states, coalescing, Places visibility, closed-scroller layout reads, padding subtraction and six rejected mutations');
