// The finish pass (finish-choice.ts): who gets it by default, and the settings switch both ways.
// Runs the real module in node with a small stand-in page and storage. --mutations proves the cases can fail.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../web/package.json',import.meta.url)),{buildSync}=require('esbuild');
const SRC=new URL('../web/src/finish-choice.ts',import.meta.url).pathname;
const source=readFileSync(SRC,'utf8');

function load(text){
  const code=buildSync({stdin:{contents:text,resolveDir:new URL('../web/src',import.meta.url).pathname,loader:'ts',sourcefile:'finish-choice.ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const m={exports:{}};new Function('module','exports',code)(m,m.exports);return m.exports;
}

// Storage that can refuse writes (blocked) or refuse to forget a saved value (stuck).
function page(search='',{blocked=false,stuck=false}={}){
  const data=new Map();
  globalThis.localStorage={getItem:k=>data.has(k)?data.get(k):null,
    setItem:(k,v)=>{if(blocked)throw Error('blocked');data.set(k,String(v));},
    removeItem:k=>{if(blocked||stuck)throw Error('blocked');data.delete(k);}};
  const el=()=>{const e={style:{},children:[],listeners:{},append(...c){e.children.push(...c);},addEventListener(t,f){e.listeners[t]=f;}};return e;};
  globalThis.document={createElement:el,getElementById:()=>null,addEventListener(){}};
  globalThis.addEventListener=()=>{};
  globalThis.location={search};
  return data;
}
function settings(mod,on,search){
  const panel={inserted:[],insertBefore(g){panel.inserted.push(g);}};const went=[];
  mod.finishSetting(panel,null,on,s=>went.push(s));
  const group=panel.inserted[0],label=group.children[0],box=label.children[0],note=group.children[1];
  return {went,box,note,toggle(){box.checked=!box.checked;box.listeners.change();}};
}

function cases(mod){
  const P=s=>new URLSearchParams(s);
  // Default: a desktop at full detail gets the cheap-edge finish with clouds; it has the switch.
  assert.deepEqual(mod.finishChoice(P(''),false,false,true),{mode:'on',offered:true,samples:0,low:false,clouds:true,canvasSamples:false,oneSample:true},'desktop full detail');
  // Phones, touch and low detail draw as before: no pass, no switch.
  for(const [touch,low,what] of [[true,false,'touch at full detail'],[true,true,'phone'],[false,true,'desktop low detail']]){
    const c=mod.finishChoice(P(''),touch,low,true);
    assert.equal(c.mode,null,what);assert.equal(c.offered,false,what);assert.equal(c.clouds,false,what);assert.equal(c.oneSample,false,what);
    assert.equal(c.canvasSamples,!low,what+': canvas edge samples as on main');assert.equal(c.samples,undefined,what);
  }
  // Switched off, or finish=0: the old picture, canvas edge samples back.
  for(const [s,saved,what] of [['',false,'switched off'],['finish=0',true,'finish=0'],['finish=0&clouds=1',true,'finish=0 wins over part flags']]){
    const c=mod.finishChoice(P(s),false,false,saved);
    assert.equal(c.mode,null,what);assert.equal(c.canvasSamples,true,what);assert.equal(c.clouds,false,what);assert.equal(c.oneSample,false,what);
  }
  assert.equal(mod.finishChoice(P(''),false,false,false).offered,true,'switched off still shows the switch');
  // Clouds only with clear weather; the rest of the finish stays.
  for(const s of ['weather=fog','weather=overcast','date=2026-06-21']){const c=mod.finishChoice(P(s),false,false,true);assert.equal(c.mode,'on',s);assert.equal(c.clouds,false,s);}
  // Test flags work on any device, and do not offer the switch to a phone.
  const flagged=mod.finishChoice(P('finish=1'),true,true,true);assert.equal(flagged.mode,'on');assert.equal(flagged.offered,false);assert.equal(flagged.canvasSamples,false,'low never has canvas samples');
  assert.equal(mod.finishChoice(P('finish=plain'),false,false,true).mode,'plain');

  // The switch, storage working: off saves "0" and reloads; on removes it and reloads.
  let data=page('?a=1&finish=1&clouds=1');let ui=settings(mod,true);
  ui.toggle();assert.equal(data.get('mmm.finish'),'0','off is saved');assert.deepEqual(ui.went,['a=1'],'off reloads without finish flags');
  assert.equal(mod.savedFinish(),false);
  ui=settings(mod,false);ui.toggle();assert.equal(data.has('mmm.finish'),false,'on clears the saved off');assert.deepEqual(ui.went,['a=1']);
  assert.equal(mod.savedFinish(),true,'nothing saved means on');
  // Storage blocked: off goes into the address for this visit; on drops it again.
  data=page('?a=1',{blocked:true});ui=settings(mod,true);ui.toggle();assert.deepEqual(ui.went,['a=1&finish=0'],'blocked off uses finish=0');
  globalThis.location.search='?a=1&finish=0';ui=settings(mod,false);ui.toggle();assert.deepEqual(ui.went,['a=1'],'blocked on drops finish=0');
  // A saved off that cannot be removed: stay off and say so, no reload.
  data=page('',{stuck:true});data.set('mmm.finish','0');ui=settings(mod,false);ui.toggle();
  assert.deepEqual(ui.went,[]);assert.equal(ui.box.checked,false);assert.equal(ui.box.disabled,true);assert.match(ui.note.textContent,/does not let the game save/);
}

cases(load(source));console.log('PASS finish-choice: default only on desktop full detail; phones, touch, low and finish=0 keep the old picture; switch off and on, blocked and stuck storage');
if(process.argv.includes('--mutations')){
  const mutants=[
    ['touch gets the default',['const offered = !touch && !low;','const offered = !low;']],
    ['low gets the default',['const offered = !touch && !low;','const offered = !touch;']],
    ['saved off ignored',['asked === null && offered && saved','asked === null && offered']],
    ['clouds in fog',["params.get('weather') !== 'fog'",'true']],
    ['on does not clear the saved off',["intend(KEY, want ? null : '0')","intend(KEY, '0')"]],
    ['flags kept on reload',["for (const key of ['finish', 'clouds', 'canvasAA', 'finishSamples']) query.delete(key);",'']],
    ['blocked off not in address',["if (!saved && !want) query.set('finish', '0');",'']],
  ];
  for(const [name,[from,to]] of mutants){assert.ok(source.includes(from),'mutation anchor: '+name);assert.throws(()=>cases(load(source.replace(from,to))),{name:'AssertionError'},'survived: '+name);console.log('KILLED '+name);}
}
