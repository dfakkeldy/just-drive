// Node checks for room ownership, flight UI, map heading and key help.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const output = await build({ stdin: { contents: `export * from './mp/room-cards';export { callSignHeight } from './mp/ghosts';export { Drone, DRONE_HELP } from './drone';export { MiniMap } from './minimap';`, resolveDir: new URL('../web/src/', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} }; new Function('module','exports',output.outputFiles[0].text)(module,module.exports);
const { mountRoomCard, removeRoomCard, fitRoomCards, Drone, DRONE_HELP, MiniMap, callSignHeight } = module.exports;
const paint = [];
const context = new Proxy({ measureText: text => ({width:text.length*6}) }, { get: (o,k) => o[k] ?? ((...args) => paint.push([k,...args])) });
class Element {
  children=[]; parentElement=null; hidden=false; id=''; textContent=''; listeners={};
  style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};
  classList={values:new Set(),contains(n){return this.values.has(n);},add(n){this.values.add(n);},remove(n){this.values.delete(n);},toggle(n,on=!this.values.has(n)){on?this.values.add(n):this.values.delete(n);}};
  rect={left:1100,right:1430,top:300,bottom:820,width:330,height:520};
  constructor(tag='div'){this.tagName=tag;}
  append(...nodes){for(const n of nodes){if(typeof n==='string')continue;n.remove();n.parentElement=this;this.children.push(n);}}
  appendChild(n){this.append(n);return n;}
  insertBefore(n,next){n.remove();n.parentElement=this;const at=this.children.indexOf(next);this.children.splice(at<0?this.children.length:at,0,n);}
  before(n){this.parentElement.insertBefore(n,this);}
  after(n){const p=this.parentElement;p.insertBefore(n,p.children[p.children.indexOf(this)+1]);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null;}}
  replaceWith(n){this.before(n);this.remove();}
  querySelector(selector){for(const n of this.children){if(selector.split(',').some(s=>s.startsWith('#')?n.id===s.slice(1):n.tagName===s))return n;const found=n.querySelector(selector);if(found)return found;}return null;}
  setAttribute(){} addEventListener(k,v){this.listeners[k]=v;} getContext(){return context;}
  getBoundingClientRect(){return this.rect;} getClientRects(){return this.hidden?[]:[this.rect];}
}
const body=new Element(),head=new Element(),settings=new Element(),header=new Element('header');settings.id='settings';header.id='settingsHeader';settings.append(header);body.append(settings);
Object.assign(globalThis,{document:{body,head,hidden:false,createElement:t=>new Element(t),createComment:()=>new Element('comment'),getElementById:id=>body.querySelector('#'+id)??head.querySelector('#'+id)},innerWidth:1440,innerHeight:900,devicePixelRatio:1,localStorage:{getItem:()=> 'folded',setItem(){}},addEventListener(){},getComputedStyle:()=>({getPropertyValue:()=>'',overflowX:'visible',overflowY:'visible'})});
for(const touch of [false,true]){
 const cards=['gamePanel','racePanel','mpSocial'].map(id=>Object.assign(new Element('details'),{id}));
 for(const card of cards)mountRoomCard(card,touch);
 const home=cards[0].parentElement;
 assert.deepEqual(home.children.filter(n=>n.tagName==='details').map(n=>n.id),['mpSocial','racePanel','gamePanel']);
 if(touch){assert.equal(settings.children[0],header);assert.equal(settings.children[1],home);assert.equal(home.children[0].textContent,'Room');}
 else{
  for(const [id,rect] of [['endShift',{left:1330,right:1430,top:65,bottom:145,width:100,height:80}],['credit',{left:300,right:1430,top:860,bottom:894,width:1130,height:34}]])body.append(Object.assign(new Element(),{id,rect}));
  fitRoomCards();assert.equal(home.style.bottom,'50px');assert.equal(home.style.maxHeight,'695px');
 }
 removeRoomCard(cards[0]);assert.ok(home.parentElement,'other cards keep their home');removeRoomCard(cards[1]);removeRoomCard(cards[2]);assert.equal(home.parentElement,null,'disconnect removes the empty home');
}
for(const height of [280,390,844])for(const distance of [5,30,60])assert.ok(callSignHeight(distance,2,height,true,distance)*2/distance*height/4>=12,'phone ink stays at least 12 CSS px');
assert.deepEqual(DRONE_HELP,[['WASD','Move'],['←/→ or Q/E','Turn'],['↑/↓','Camera'],['Space','Up'],['Shift or C','Down'],['Mouse wheel','Top speed'],['R','Fly back'],['F','Land']]);
const drone=new Drone();drone.launch(0,0,0,0);assert.equal(document.getElementById('droneHints').hidden,false);
const command={forward:0,right:0,up:0,turn:0},under={ground:0,floor:2},roof={x:0,y:0,z:0};
for(let i=0;i<201;i++)drone.update(.1,command,under,roof,0);
assert.equal(drone.hintsHidden,true);assert.equal(document.getElementById('droneHints').hidden,true);
assert.match(drone.readout(true),/^DRONE · Height .*\nDistance .*\nSpeed /);
drone.stow();drone.launch(0,0,0,0);assert.equal(drone.hintsHidden,false,'each flight gets its own hints');drone.stow();assert.equal(document.getElementById('droneHints').hidden,true);
innerWidth=844;innerHeight=390;body.classList.add('droneSticks');
const map=new MiniMap({roads:[]});const root=document.getElementById('miniMap'),original=new Element();body.append(original);original.append(root);
assert.equal(root.classList.contains('folded'),true);map.setFlight(true);assert.equal(root.parentElement,body);assert.equal(root.classList.contains('folded'),false);
assert.equal(document.getElementById('miniMapCanvas').style.width,'96px');
const parked={x:8,z:9};paint.length=0;map.update(1,10,20,Math.PI/2,[],[],[],parked);
assert.ok(paint.some(([op,x])=>op==='rotate'&&x===-Math.PI/2));assert.ok(paint.some(([op,x,z])=>op==='translate'&&x===-10&&z===-20));
const north=paint.find(([op,text])=>op==='fillText'&&text==='N');assert.ok(north&&north[2]<48&&Math.abs(north[3]-48)<1e-6,'north moves left when heading east');
assert.ok(paint.some(([op,x,z])=>op==='arc'&&x===8&&z===9),'parked car gets its own marker');map.setFlight(false);assert.equal(root.parentElement,original);assert.equal(root.classList.contains('folded'),true,'landing restores the map preference and parent');
const main=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8');
const block=main.slice(main.indexOf('    if (miniMap) {',main.indexOf('  culvertMouths?.update')),main.indexOf('    // Paused frames return early'));
const frame=new Function('ctx',`with(ctx){${block}}`);
for(const active of [false,true]){
 const calls=[],vehicle={x:1,z:2,heading:.4},state={x:30,z:40,yaw:.8};
 frame({miniMap:{setFlight:v=>calls.push(['flight',v]),show:v=>calls.push(['show',v]),update:(...args)=>calls.push(['map',...args])},drone:{active,state},playing:!active,clockRuns:true,mapTimer:1,realDt:.05,refreshMap(){},boss:null,vehicle,mapStops:[],mapMarks:[],mapCars:[]});
 assert.deepEqual(calls.slice(0,2),[['flight',active],['show',true]]);assert.deepEqual(calls[2].slice(1,5),[.05,active?30:1,active?40:2,active?-.8:.4]);assert.equal(calls[2][8],active?vehicle:null);
}
assert.match(main,/const hints = drone\.active \? DRONE_HELP/,'pause lists the active drone keys first');
const a=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const b=readFileSync(new URL('../artifact/page.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];assert.equal(a,b,'page style blocks remain identical');
console.log('PASS room order, header, scroll bounds, disconnect cleanup, 12 px names, drone keycaps and hint timer, phone metrics, flight map parent, fold, north, heading, parked car and actual frame wiring; page CSS parity');
