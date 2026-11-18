// Event/DOM stand-in for the real multiplayerSwitch + startHere controllers. No renderer or browser.
export function pageDom(address, local, session) {
  const originals = Object.fromEntries(['document','Element','MutationObserver','location','history','localStorage','sessionStorage','navigator','addEventListener','setTimeout','clearTimeout','queueMicrotask','__connections'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const capture=[], leaving=[], tasks=[], timers=new Map(), navigations=[], observers=new Set(), windowEvents=new Map();
  let document;
  class Element {
    children=[];listeners={};disabled=false;hidden=false;id='';className='';textContent='';attributes={};dataset={};style={};value='';
    get parentElement(){return this.parent??null;}
    append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}
    appendChild(n){this.append(n);return n;}
    insertBefore(n,before){const i=before===null?this.children.length:this.children.indexOf(before);if(i<0)throw Error('missing reference node');this.children.splice(i,0,n);n.parent=this;}
    before(n){this.parent.insertBefore(n,this);}
    setAttribute(k,v){this.attributes[k]=String(v);}
    getAttribute(k){return this.attributes[k]??null;}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    dispatch(type){const event={target:this,stopPropagation(){}};if(type==='click')capture.forEach(fn=>fn(event));for(let node=this;node;node=node.parent)for(const fn of node.listeners[type]??[])fn(event);}
    click(){if(!this.disabled)this.dispatch('click');}
    matches(s){return s[0]==='#'?this.id===s.slice(1):s[0]==='.'?this.className.split(' ').includes(s.slice(1)):this.tag===s;}
    closest(s){for(let n=this;n;n=n.parent)if(n.matches(s))return n;return null;}
    querySelector(s){if(s==='.mpJoin input'){/* innerHTML here is flat: the room-code input is the first input after .mpJoin (the name row comes earlier) */const all=[],walk=n=>{for(const c of n.children){all.push(c);walk(c);}};walk(this);const at=all.findIndex(n=>n.matches('.mpJoin'));return at<0?null:all.slice(at).find(n=>n.tag==='input')??null;}for(const n of this.children){if(n.matches(s))return n;const found=n.querySelector(s);if(found)return found;}return null;}
    set innerHTML(text){
      this.children=[];
      // Controllers only query these controls; geometry/layout belongs to the parent's browser proof.
      for(const [,tag,attrs] of text.matchAll(/<(button|small|output|input|div|label)\b([^>]*)>/g)) {
        const n=new Element();n.tag=tag;
        for(const [,key,value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){n.setAttribute(key,value);if(key==='class')n.className=value;}
        n.disabled=/\bdisabled\b/.test(attrs);n.hidden=/\bhidden\b/.test(attrs);this.append(n);
      }
    }
  }
  const body=new Element(),head=new Element(),title=new Element(),card=new Element(),start=new Element();
  title.id='title';card.id='titleCard';start.id='titleStart';title.append(card);card.append(start);
  let starts=0;start.addEventListener('click',()=>{starts++;title.hidden=true;});
  document={body,head,createElement:tag=>Object.assign(new Element(),{tag}),querySelector:s=>body.querySelector(s),getElementById:id=>body.querySelector('#'+id),addEventListener(type,fn,options){if(type==='click'&&options?.capture)capture.push(fn);}};
  const url=new URL(address);
  const globals={document,Element,MutationObserver:class{constructor(fn){this.fn=fn;}observe(){observers.add(this);}disconnect(){observers.delete(this);}},location:{href:url.href,origin:url.origin,hostname:url.hostname,pathname:url.pathname,search:url.search,assign:next=>navigations.push(next)},localStorage:local,sessionStorage:session,navigator:{},addEventListener:(type,fn)=>{if(type==='pagehide')leaving.push(fn);const list=windowEvents.get(type)??[];list.push(fn);windowEvents.set(type,list);},setTimeout:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),queueMicrotask:fn=>tasks.push(fn)};
  globals.history={state:null,replaceState(state,_title,address){this.state=state;const next=new URL(address,globals.location.href);Object.assign(globals.location,{href:next.href,origin:next.origin,hostname:next.hostname,pathname:next.pathname,search:next.search});}};
  for(const [k,value] of Object.entries(globals))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value});
  return {document,title,start,navigations,dispatchWindow(type,event={}){for(const fn of windowEvents.get(type)??[])fn(event);},mountTitle(){body.append(title);tasks.push(()=>{for(const o of [...observers])o.fn();});},get starts(){return starts;},flush:async()=>{while(tasks.length)tasks.shift()();await Promise.resolve();await Promise.resolve();},close(){leaving.forEach(fn=>fn());for(const [k,desc] of Object.entries(originals)){if(desc)Object.defineProperty(globalThis,k,desc);else delete globalThis[k];}}};
}
