// Failure rules can target the Nth write, a key, a value, or a silent drop. No browser timers or I/O.
export class FailureStore {
  data=new Map([['mmm.detail','high']]); writes=[]; readFail=()=>false; rule=()=>false; count=0;
  getItem(key){if(this.readFail(key))throw new Error('read blocked');return this.data.get(key)??null;}
  change(key,value){
    const call={n:++this.count,key,value};this.writes.push(call);const action=this.rule(call);
    if(action==='throw'||action===true)throw new Error('write blocked');
    if(action==='drop')return;
    if(value===null)this.data.delete(key);else this.data.set(key,String(value));
  }
  setItem(key,value){this.change(key,String(value));}removeItem(key){this.change(key,null);}
  arm(rule){this.rule=rule;this.count=0;this.writes=[];}
}
export class Element {
  style={};dataset={};children=[];listeners={};disabled=false;classList={add(){}};
  append(...items){this.children.push(...items);}prepend(...items){this.children.unshift(...items);}insertBefore(item){this.children.push(item);}
  addEventListener(name,fn){this.listeners[name]=fn;}setAttribute(){}
}
export function environment(store,href='https://example.test/'){
 const win=new EventTarget(),doc=new EventTarget();doc.hidden=false;doc.createElement=()=>new Element();
 let time=0;const nav=[];
 Object.assign(globalThis,{document:doc,localStorage:store,addEventListener:win.addEventListener.bind(win),location:{href,search:new URL(href).search,replace(url){nav.push(url);}},history:{replaceState(_a,_b,url){globalThis.location.href=url;globalThis.location.search=new URL(url).search;}}});
 return {win,doc,nav,clock:()=>time,advance:ms=>{time+=ms;},hide(){doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));},show(){doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));},leave(){win.dispatchEvent(new Event('pagehide'));},freeze(){doc.dispatchEvent(new Event('freeze'));}};
}
