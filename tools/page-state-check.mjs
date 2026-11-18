// Node checks and source mutations for readiness, permanent error UI and the stop latch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const file='web/src/page-state.ts',source=readFileSync(file,'utf8');
async function load(text) {
  const result=await build({stdin:{contents:text,resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const originalConsole=console;
function env(withBoot=false) {
  const children=[],events={},errors=[],boot=withBoot?{textContent:'Loading'}:null;
  globalThis.document={title:'Mabou Mail Madness',documentElement:{dataset:{}},body:{append:e=>children.push(e)},createElement:()=>({hidden:false,style:{},setAttribute(){}}),getElementById:id=>id==='boot'?boot:null};
  globalThis.addEventListener=(name,fn)=>events[name]=fn;
  globalThis.console={...originalConsole,error:e=>errors.push(e)};
  return {children,events,errors,boot};
}
function verify({pageState}) {
  for(const [query,dev,legacy] of [['',false,false],['fbclid=x',false,false],['area=judique&vehicle=truck&mode=explore',false,false],['q=low&touch=1&room=abcd',false,false],['name=x&hud=0',false,true],['test=',false,true],['',true,true]]) {
    const e=env(),p=pageState(new URLSearchParams(query),dev);
    assert.equal(e.children.length,1,'overlay exists before failure');assert.equal(e.children[0].hidden,true);
    assert.equal(document.documentElement.dataset.mmmReady,'false');
    p.ready(true);assert.equal(document.title,legacy?'settled':'Mabou Mail Madness',query+' dev='+dev);
    assert.equal(document.documentElement.dataset.mmmReady,'true','hidden readiness');
    p.ready(false);assert.equal(document.title,legacy?'loading':'Mabou Mail Madness');
    assert.equal(document.documentElement.dataset.mmmReady,'false');
    const text='The game stopped. Reload the page to try again.';
    for(const kind of ['error','unhandledrejection']) {
      // Before the first frame, with the loading screen up: a failed start, said on the loading screen only.
      let next=env(true),state=pageState(new URLSearchParams(query),dev),error=Error('injected');
      next.events[kind]({error,message:'fallback',reason:error});
      assert.equal(state.stopped,true,'an error before the first frame is a failed start');
      assert.equal(next.boot.textContent,'Mabou Mail Madness could not start: injected. Reload to try again.');
      assert.equal(next.children[0].hidden,true,'one message, not two');assert.deepEqual(next.errors,[error],'console gets original error');
      // Before the first frame, loading screen already removed: the line is the only place left.
      next=env(false);state=pageState(new URLSearchParams(query),dev);next.events[kind]({error,message:'fallback',reason:error});
      assert.equal(state.stopped,true);assert.equal(next.children[0].hidden,false);assert.equal(next.children[0].textContent,text);
      // After the first frame: a stray error must not stop a running game.
      next=env(false);state=pageState(new URLSearchParams(query),dev);state.ready(true);
      next.events[kind]({error,message:'fallback',reason:error});
      assert.equal(state.stopped,false,'a stray late error does not stop a running game');
      assert.equal(next.children[0].hidden,true);assert.equal(document.documentElement.dataset.mmmReady,'true');assert.deepEqual(next.errors,[]);
    }
    // The frame loop's own failure, after the start.
    const next=env(false),state=pageState(new URLSearchParams(query),dev),error=Error('frame');
    state.ready(true);state.fail(error);
    assert.equal(state.stopped,true,'failure stops frame loop');assert.equal(document.documentElement.dataset.mmmReady,'false');
    assert.equal(next.children[0].hidden,false);assert.equal(next.children[0].textContent,text);
    assert.equal(next.children[0].style.position,'fixed');assert.equal(next.children[0].style.visibility,'visible','the line shows during an ending too');
    assert.deepEqual(next.errors,[error],'console gets original error');
    state.fail(Error('second'));assert.deepEqual(next.errors,[error],'failure is latched once');
  }
}
try {
  verify(await load(source));originalConsole.log('PASS player/dev/test readiness, permanent overlay, startup errors/rejections, console error and stop latch');
  if(process.argv.includes('--mutations')) {
    const mutations=[
      ['always title','dev || isTestVisit(params)','true'],
      ['no test title','dev || isTestVisit(params)','dev'],
      ['no dev title','dev || isTestVisit(params)','isTestVisit(params)'],
      ['no hidden signal',"document.documentElement.dataset.mmmReady = String(value);",''],
      ['no overlay','document.body.append(error);',''],
      ['no error line','error.hidden = false;',''],
      ['no console','console.error(why);',''],
      ['no stop','stopped = true;',''],
      ['late errors stop a running game','if (!running) fail(why);','fail(why);'],
      ['start errors ignored','if (!running) fail(why);',''],
      ['two messages at a failed start','else error.hidden = false;','error.hidden = false;'],
      ['no loading-screen message',"if (boot) boot.textContent","if (false) boot.textContent"],
      ['hidden during an ending',"visibility: 'visible' }","visibility: 'inherit' }"],
    ];
    for(const [name,from,to] of mutations) {
      assert.ok(source.includes(from),name+' mutation exists');const module=await load(source.replace(from,to));
      assert.throws(()=>verify(module),undefined,name+' rejected');
    }
    originalConsole.log(`PASS ${mutations.length} page-state mutations rejected`);
  }
} finally {globalThis.console=originalConsole;}
