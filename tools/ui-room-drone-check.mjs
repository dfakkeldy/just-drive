// Node checks for room ownership, flight UI, map heading and key help.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const output = await build({ stdin: { contents: `export * from './mp/room-cards';export {Multiplayer} from './mp/index';export { SocialView } from './mp/social-view';export { RaceView } from './mp/race';export { GameView } from './mp/games';export { PerspectiveCamera } from 'three';export { Ghosts, callSignHeight } from './mp/ghosts';export { Drone, createDroneSticks, DRONE_HELP, DRONE_TOUCH_HELP } from './drone';export { MiniMap } from './minimap';`, resolveDir: new URL('../web/src/', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} }; new Function('module','exports',output.outputFiles[0].text)(module,module.exports);
const { Multiplayer, mountRoomCard, removeRoomCard, fitRoomCards, RoomCountdown, RaceView, GameView, Drone, createDroneSticks, DRONE_HELP, MiniMap, Ghosts, SocialView, PerspectiveCamera, callSignHeight, DRONE_TOUCH_HELP } = module.exports;
const paint = [];
const context = new Proxy({ measureText: text => ({width:text.length*6}) }, { get: (o,k) => o[k] ?? ((...args) => paint.push([k,...args])) });
class Element {
  children=[]; parentElement=null; hidden=false; open=false; id=''; textContent=''; listeners={}; dataset={}; reads=0;
  style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};
  classList={values:new Set(),contains(n){return this.values.has(n);},add(n){this.values.add(n);},remove(n){this.values.delete(n);},toggle(n,on=!this.values.has(n)){on?this.values.add(n):this.values.delete(n);}};
  rect={left:1100,right:1430,top:300,bottom:820,width:330,height:520};
  constructor(tag='div'){this.tagName=tag;}
  append(...nodes){for(const n of nodes){if(typeof n==='string')continue;n.remove();n.parentElement=this;this.children.push(n);}}
  appendChild(n){this.append(n);return n;}
  add(n){this.append(n);}
  insertBefore(n,next){n.remove();n.parentElement=this;const at=this.children.indexOf(next);this.children.splice(at<0?this.children.length:at,0,n);}
  before(n){this.parentElement.insertBefore(n,this);}
  after(n){const p=this.parentElement;p.insertBefore(n,p.children[p.children.indexOf(this)+1]);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null;}}
  replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes);}
  replaceWith(n){this.before(n);this.remove();}
  querySelector(selector){if(selector==='b' && this.innerHTML?.includes('<b>') && !this.children.some(n=>n.tagName==='b'))this.append(new Element('b'));for(const n of this.children){if(selector.split(',').some(s=>s.startsWith('#')?n.id===s.slice(1):n.tagName===s))return n;const found=n.querySelector(selector);if(found)return found;}return null;}
  attributes={};setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];} addEventListener(k,v){this.listeners[k]=v;} getContext(){return context;}
  getBoundingClientRect(){this.reads++;return this.rect;} getClientRects(){return this.hidden?[]:[this.rect];}
}
const windowListeners=new Map();
const resize=()=>{for(const listener of windowListeners.get('resize')??[])listener();};
const body=new Element(),head=new Element(),settings=new Element(),header=new Element('header');settings.id='settings';header.id='settingsHeader';settings.append(header);body.append(settings);
Object.assign(globalThis,{document:{body,head,hidden:false,addEventListener(){},createElement:t=>new Element(t),createComment:()=>new Element('comment'),createTextNode:t=>Object.assign(new Element('text'),{textContent:t}),getElementById:id=>body.querySelector('#'+id)??head.querySelector('#'+id)},innerWidth:1440,innerHeight:900,devicePixelRatio:1,localStorage:{getItem:()=> 'folded',setItem(){}},addEventListener(type,listener){if(!windowListeners.has(type))windowListeners.set(type,new Set());windowListeners.get(type).add(listener);},removeEventListener(type,listener){windowListeners.get(type)?.delete(listener);},getComputedStyle:()=>({getPropertyValue:()=>'',overflowX:'visible',overflowY:'visible'})});
for(const touch of [false,true]){
 const cards=['gamePanel','racePanel','mpSocial'].map(id=>Object.assign(new Element('details'),{id}));
 for(const card of cards)mountRoomCard(card,touch);
 const home=cards[0].parentElement;
 assert.deepEqual(home.children.filter(n=>n.tagName==='details').map(n=>n.id),['mpSocial','racePanel','gamePanel']);
 if(touch){assert.equal(settings.children[0],header);assert.equal(settings.children[1],home);assert.equal(home.children[0].textContent,'Room');}
 else{
  for(const [id,rect] of [['endShift',{left:1330,right:1430,top:65,bottom:145,width:100,height:80}],['credit',{left:300,right:1430,top:860,bottom:894,width:1130,height:34}]])body.append(Object.assign(new Element(),{id,rect}));
  fitRoomCards();assert.equal(home.style.bottom,'50px');assert.equal(home.style.maxHeight,'695px');
  const endShift=document.getElementById('endShift');endShift.classList.add('inPanel');settings.append(endShift);settings.classList.add('open');
  const reads=endShift.reads;fitRoomCards();assert.equal(endShift.reads,reads,'END SHIFT inside Settings is not measured as a HUD blocker');
  assert.equal(home.style.maxHeight,'718px','END SHIFT inside open Settings leaves the room column in place');
  settings.classList.remove('open');
 }
 removeRoomCard(cards[0]);assert.ok(home.parentElement,'other cards keep their home');removeRoomCard(cards[1]);removeRoomCard(cards[2]);assert.equal(home.parentElement,null,'disconnect removes the empty home');
}
// The gear observes timestamps even when the capped chat array keeps the same length.
{
 const gear=Object.assign(new Element(),{id:'gear'});body.append(gear);
 const badge=new Element(),unreadDot=new Element(),net={status:'on',count:1,me:{id:1},chats:[]};
 const room=Object.assign(Object.create(Multiplayer.prototype),{gear,badge,unreadDot,net,newestChat:-Infinity,unread:false});
 room.updateGear();assert.equal(badge.textContent,'1');assert.equal(badge.hidden,false);assert.equal(gear.getAttribute('aria-label'),'Settings and room: 1 other driver');
 net.chats=Array.from({length:6},(_,i)=>({id:1,at:i}));room.updateGear();assert.equal(unreadDot.hidden,true,'own chat is not unread');
 net.chats.shift();net.chats.push({id:2,at:6});room.updateGear();assert.equal(unreadDot.hidden,false);assert.match(gear.getAttribute('aria-label'),/, new message$/);
 settings.classList.add('open');room.updateGear();assert.equal(unreadDot.hidden,true);assert.doesNotMatch(gear.getAttribute('aria-label'),/new message/);settings.classList.remove('open');
 net.count=0;room.updateGear();assert.equal(badge.hidden,true);assert.equal(gear.getAttribute('aria-label'),'Settings and room: nobody else on the road');
 net.status='retry';room.updateGear();assert.equal(gear.getAttribute('aria-label'),'Settings');assert.equal(unreadDot.hidden,true);gear.remove();
}
// Use CSS-like column geometry to check both the open and folded footprints.
for(const id of ['endShift','credit'])document.getElementById(id).remove();
for(const [width,height] of [[1280,720],[1440,900]])for(const folded of [false,true]){
 innerWidth=width;innerHeight=height;
 for(const id of ['mailButton','cameraButton','placeArrival']){
  const card=Object.assign(new Element('details'),{id:'mpSocial'});mountRoomCard(card,false);
  const home=card.parentElement;
  home.getBoundingClientRect=()=>{const w=parseFloat(home.style.width||'332'),right=width-(home.style.right?parseFloat(home.style.right):10),bottom=height-parseFloat(home.style.bottom||'80'),h=Math.min(folded?40:800,parseFloat(home.style.maxHeight||'800'));return {left:right-w,right,top:bottom-h,bottom,width:w,height:h};};
  const top=id==='cameraButton'?height-234:id==='mailButton'?height-164:height-142;
  const blocker=Object.assign(new Element(),{id,rect:{left:width-334,right:width-24,top,bottom:height-32,width:310,height:height-32-top}});
  const photo=Object.assign(new Element(),{id:'photoTag',rect:{left:width-244,right:width-14,top:138,bottom:260,width:230,height:122}});
  body.append(blocker,photo);fitRoomCards();
  let r=home.getBoundingClientRect();assert.equal(r.bottom,top-10,`${id}: lower bound at ${width}x${height}, folded=${folded}`);assert.ok(r.top>=photo.rect.bottom+10);
  // A tall upper card leaves no useful space above the buttons: move left.
  photo.rect.bottom=top-30;photo.rect.height=photo.rect.bottom-photo.rect.top;
  fitRoomCards();r=home.getBoundingClientRect();assert.ok(r.right<=blocker.rect.left-10,'short column moves left of the lower HUD');
  assert.ok(r.height>0&&r.left>=10&&r.top>=0&&r.bottom<=height);
  blocker.hidden=true;photo.hidden=true;fitRoomCards();assert.equal(home.style.right,'','hidden blockers release the corner');
  blocker.remove();photo.remove();removeRoomCard(card);
 }
}
// At 720x480, keep a usable scroll area between the radio and the right buttons.
innerWidth=720;innerHeight=480;
{
 const card=Object.assign(new Element('details'),{id:'mpSocial'});mountRoomCard(card,false);const home=card.parentElement;
 home.getBoundingClientRect=()=>{const width=parseFloat(home.style.width||'332'),right=720-(parseFloat(home.style.right)||10);return {left:right-width,right,width};};
 const fixtures=[['radio',10,424,328,452],['photoTag',470,138,706,220],['cameraButton',628,246,696,306],['mailButton',628,316,696,384],['credit',200,450,710,480]].map(([id,left,top,right,bottom])=>Object.assign(new Element(),{id,rect:{left,top,right,bottom,width:right-left,height:bottom-top}}));
 body.append(...fixtures);fitRoomCards();
 assert.equal(home.style.width,'240px');assert.equal(home.style.right,'102px');assert.equal(home.style.maxHeight,'210px','narrow fallback clears both HUD columns');
 for(const fixture of fixtures)fixture.remove();removeRoomCard(card);
}
innerWidth=1440;innerHeight=900;
const pill=Object.assign(new Element(),{id:'mpChip',rect:{bottom:66,height:44}});body.append(pill);
const count=new RoomCountdown('testCountdown',false),countNode=document.getElementById('testCountdown');
assert.equal(countNode.getAttribute('aria-hidden'),'true');
const countSay=body.children.find(n=>n.className==='roomCountdownSay');assert.equal(countSay.getAttribute('role'),'status');
for(const [ms,visual,spoken] of [[5000,'5','5'],[4000,'4','5'],[3000,'3','3'],[2000,'2','3'],[1000,'1','3'],[0,'GO','GO'],[-999,'GO','GO']]){
 assert.equal(count.update(ms),spoken);assert.equal(countSay.textContent,spoken==='GO'?'GO':`Start in ${spoken}`);assert.equal(countNode.textContent,visual);assert.equal(countNode.hidden,false);
}
const pillReads=pill.reads;for(let i=0;i<20;i++)count.update(-500);
assert.equal(pill.reads,pillReads,'same count reuses the pill position');assert.equal(countNode.style.top,'76px');
count.update(-1000);assert.equal(countNode.hidden,true,'GO leaves after one second');count.update(5000);count.update(null);assert.equal(countNode.hidden,true,'disconnect clears the count');assert.equal(countSay.textContent,'');count.dispose();assert.equal(countSay.parentElement,null);pill.remove();
// Run the actual social view. A stable phrase needs no layout reads on later frames.
const camera=new PerspectiveCamera(60,innerWidth/innerHeight,.1,1000);camera.updateMatrixWorld();
const net={canChat:true,gamesSupported:true,roster:[],chats:[],names:new Map(),bubbles:new Map(),me:{id:1}};
for(const touch of [false,true]){
 const social=new SocialView(net,()=>0,touch);
 assert.equal(document.getElementById('mpSocial').open,!touch,'desktop chat starts open; phone starts folded');social.dispose();
}
net.roster=[{id:1,name:'Dusty Tire',hue:0},{id:2,name:'Muddy Wheel',hue:1}];net.names=new Map(net.roster.map(p=>[p.id,p.name]));
const social=new SocialView(net,()=>0),me={x:0,y:0,z:-20};
const tags=[{id:2,left:650,right:790,top:360,bottom:400},{id:1,left:650,right:790,top:420,bottom:450}];
net.bubbles.set(1,{id:1,phrase:0,at:performance.now()});net.bubbles.set(2,{id:2,phrase:1,at:performance.now()});
const peers=[{id:2,x:0,z:-20,air:0}];social.update(camera,peers,me,tags);
const bubbles=[...document.getElementById('mpChatBubbles').children];
assert.equal(document.getElementById('mpSocial').querySelector('details'),null,'one disclosure only');
assert.equal(document.getElementById('mpSocial').querySelector('h4').textContent,'Drivers (2)');
assert.equal(document.getElementById('mpRoster').children[0].children[0].style.background,'#305b83','roster dot matches the tag palette');
assert.equal(bubbles[0].textContent.startsWith('Dusty Tire: '),true,'bubbles name their speaker');
for(const bubble of bubbles){assert.equal(bubble.reads,1);assert.ok(parseFloat(bubble.style.top)<=352,'bubble clears its own and neighbouring tags');}
for(let i=0;i<20;i++)social.update(camera,peers,me,tags);
for(const bubble of bubbles)assert.equal(bubble.reads,1,'unchanged phrase reuses measured size');
net.bubbles.get(1).phrase=4;social.update(camera,peers,me,tags);assert.equal(bubbles[0].reads,2,'new phrase is measured once');
body.classList.add('tcOn');social.update(camera,peers,me,tags);assert.equal(bubbles[0].reads,3,'phone font gets its own measurement');
const tiles=Object.assign(new Element(),{id:'phoneTop',rect:{left:0,right:1440,top:0,bottom:200,width:1440,height:56}});body.append(tiles);
bubbles[0].rect={left:0,right:100,top:0,bottom:20,width:100,height:20};net.bubbles.get(1).phrase=5;social.update(camera,peers,me,tags);
assert.equal(bubbles[0].hidden,false);assert.ok(parseFloat(bubbles[0].style.top)-20>=tiles.rect.bottom+8,'phone bubbles clear the tile row by eight pixels');
for(let i=0;i<20;i++)social.update(camera,peers,me,tags);
assert.equal(tiles.reads,1,'stable phone bubbles reuse the tile rectangle');
tiles.rect={...tiles.rect,bottom:300};resize();social.update(camera,peers,me,tags);assert.equal(bubbles[0].hidden,true,'hide a bubble if its tag leaves no clear space below the tiles');assert.equal(tiles.reads,2,'resize refreshes the tile rectangle once');social.update(camera,peers,me,tags);assert.equal(tiles.reads,2);tiles.remove();
body.classList.remove('tcOn');social.dispose();assert.equal(windowListeners.get('resize').size,0,'dispose removes the resize listener');
// Draw two frames, including an empty one: labels reuse the same pool objects.
const ghosts=new Ghosts({ground:()=>0,low:false,cap:2});
const peer={id:2,name:'Dusty Tire',hue:0,x:0,z:-20,air:0,heading:0,alpha:1,flags:0,steer:0};
ghosts.update(.1,[peer],camera);assert.equal(ghosts.tagBoxes.length,1);const tag=ghosts.tagBoxes[0];
ghosts.update(.1,[],camera);assert.equal(ghosts.tagBoxes.length,0);
ghosts.update(.1,[{...peer,x:2}],camera);assert.equal(ghosts.tagBoxes[0],tag,'drawn label keeps its pooled rectangle');ghosts.dispose();
for(const height of [280,390,844])for(const distance of [5,30,60])assert.ok(callSignHeight(distance,2,height,true,distance)*2/distance*height/4>=12,'phone ink stays at least 12 CSS px');
assert.deepEqual(DRONE_HELP,[['R','Fly back'],['F','Land'],['WASD','Move'],['←/→ or Q/E','Turn'],['↑/↓','Camera'],['Space','Up'],['Shift or C','Down'],['Mouse wheel','Top speed']]);
const gear=Object.assign(new Element(),{id:'gear',rect:{left:1386,right:1430,top:10,bottom:54,width:44,height:44}}),endShift=Object.assign(new Element(),{id:'endShift',rect:{left:1320,right:1430,top:64,bottom:108,width:110,height:44}});body.append(gear,endShift);
const drone=new Drone();drone.launch(0,0,0,0);assert.equal(document.getElementById('droneHints').hidden,false);
assert.equal(document.getElementById('droneHints').style.top,'118px','help starts ten pixels below the lowest control');assert.equal(document.getElementById('droneHints').style.right,'10px','help aligns with the gear');
const dock=document.getElementById('droneHints');let dockWrites=0;
for(const key of ['top','right']){let value=dock.style[key];Object.defineProperty(dock.style,key,{get:()=>value,set:v=>{value=v;dockWrites++;}});}
const still={forward:0,right:0,up:0,turn:0};
for(let i=0;i<5;i++)drone.update(.25,still,{ground:0,floor:2},{x:0,y:0,z:0},0);
assert.equal(dockWrites,0,'unchanged control boxes cause no help position writes');
endShift.rect={...endShift.rect,bottom:128};gear.rect={...gear.rect,right:1410};drone.update(.25,still,{ground:0,floor:2},{x:0,y:0,z:0},0);
assert.equal(dock.style.top,'138px');assert.equal(dock.style.right,'30px');assert.equal(dockWrites,2,'moved controls update both help coordinates');
endShift.classList.add('inPanel');drone.update(.25,still,{ground:0,floor:2},{x:0,y:0,z:0},0);assert.equal(dock.style.top,'64px','an inPanel END SHIFT does not move drone hints');
gear.remove();endShift.remove();
const help=document.getElementById('droneHints');let hidden=help.hidden,hiddenWrites=0;
Object.defineProperty(help,'hidden',{get:()=>hidden,set:v=>{hidden=v;hiddenWrites++;}});
const command={forward:0,right:0,up:0,turn:0},under={ground:0,floor:2},roof={x:0,y:0,z:0};
for(let i=0;i<301;i++)drone.update(.1,command,under,roof,0);
assert.equal(hiddenWrites,1,'hint timer writes hidden only at the transition');assert.equal(drone.hintsHidden,true);assert.equal(document.getElementById('droneHints').hidden,true);
assert.match(drone.readout(true),/^DRONE · Height .*\nFrom the car .*\nSpeed .*\nHeading [NESW]{1,2}$/);
drone.callHome();assert.equal(drone.readout(true).split('\n').length,4,'return state shares the heading line, keeping the landscape map clear');assert.match(drone.readout(true),/Heading N · returning$/);
drone.stow();drone.launch(0,0,0,0);assert.equal(drone.hintsHidden,false,'each flight gets its own hints');drone.stow();assert.equal(document.getElementById('droneHints').hidden,true);
innerWidth=844;innerHeight=390;body.classList.add('droneSticks');
const map=new MiniMap({roads:[]});const root=document.getElementById('miniMap'),original=new Element();body.append(original);original.append(root);
assert.equal(root.classList.contains('folded'),true);map.setFlight(true);assert.equal(root.parentElement,body);assert.equal(root.classList.contains('folded'),false);
assert.equal(document.getElementById('miniMapCanvas').style.width,'156px','flight uses the shared readout column');
assert.equal(body.style['--droneCol'],'158px');
// Keep the 96px flight compass coverage as well as the new flight default.
map.size=96;
const parked={x:8,z:9};paint.length=0;map.update(1,10,20,Math.PI/2,[],[],[],parked);
assert.ok(paint.some(([op,x])=>op==='rotate'&&x===-Math.PI/2));assert.ok(paint.some(([op,x,z])=>op==='translate'&&x===-10&&z===-20));
for(const letter of ['N','E','S','W'])assert.ok(paint.some(([op,text])=>op==='fillText'&&text===letter),'compass paints '+letter);
assert.ok(paint.some(([op,x,y,r])=>op==='arc'&&x===0&&y===0&&r===41),'96px compass ring is inset seven pixels');
const north=paint.find(([op,text])=>op==='fillText'&&text==='N');assert.ok(north&&north[2]<48&&Math.abs(north[3]-48)<1e-6,'north moves left when heading east');
assert.ok(paint.some(([op,x,z])=>op==='arc'&&x===8&&z===9),'parked car gets its own marker');map.setFlight(false);assert.equal(root.parentElement,original);assert.equal(root.classList.contains('folded'),true,'landing restores the map preference and parent');
map.size=124;map.shown=78;map.folded=false;paint.length=0;map.update(1,10,20,0,[],[],[],parked);
assert.ok(paint.some(([op,text])=>op==='fillText'&&text==='N'));
for(const letter of ['E','S','W'])assert.ok(!paint.some(([op,text])=>op==='fillText'&&text===letter),'tiny driving map omits '+letter);
map.folded=true;
// An explicit fold choice during flight persists on landing and in storage.
let stored;localStorage.setItem=(key,value)=>{if(key==='mmm.map')stored=value;};
map.setFlight(true);const mapHead=document.getElementById('miniMapHead');
mapHead.listeners.click();assert.equal(stored,'folded');
mapHead.listeners.click();assert.equal(stored,'open');
map.setFlight(false);assert.equal(root.classList.contains('folded'),false,'landing keeps the choice made in flight');
map.setFlight(true);mapHead.listeners.click();map.setFlight(false);assert.equal(root.classList.contains('folded'),true);assert.equal(stored,'folded');
// Execute both shipping countdown paths, including phone summaries and strips.
const savedPerformance=globalThis.performance;
let countdownNow=5000;
globalThis.performance={now:()=>countdownNow};
globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
for(const touch of [false,true]){
 const strip=Object.assign(new Element(),{id:'phoneStatus'});body.append(strip);
 const host={touch,bare:false,scene:{add(){},remove(){}},ground:()=>0,vehicle:{x:0,y:0,z:0,speed:0},roads:[]};
 const racer={id:1,next:0,time:null,out:false};
 const net={status:'on',me:{id:1},names:new Map([[1,'Dusty Tire']]),roster:[{id:1}],count:1,gamesSupported:true,race:{serial:1,host:1,startAt:10000,route:{roadId:1,gates:[{x:0,z:0},{x:10,z:0}]},racers:[racer]},game:null,serverNow:()=>countdownNow};
 const race=new RaceView(net,host),spoken=[];
 const racePanel=document.getElementById('racePanel'),raceSay=body.children.find(n=>n.className==='roomCountdownSay');
 for(const now of [5000,6000,7000,8000,9000,10000]){
  countdownNow=now;race.update();spoken.push(raceSay.textContent);
  assert.equal(racePanel.querySelector('p').textContent,now<10000?'Stay inside the start ring until GO.':'GO · checkpoint 1/2 · 0.0 s You are at the gold ring.');
  if(now===5000){assert.equal(racePanel.open,touch,'only touch opens at countdown');racePanel.open=false;}
  else assert.equal(racePanel.open,false,'closing a countdown card stays closed');
 }
 assert.deepEqual(spoken,['Start in 5','Start in 5','Start in 3','Start in 3','Start in 3','GO']);
 assert.equal(document.getElementById('raceStatus').id,racePanel.querySelector('button').getAttribute('aria-describedby'));

 assert.equal(document.getElementById('raceCountdown').textContent,'GO');
 racer.out=true;countdownNow=10500;race.update();assert.match(document.getElementById('racePanel').querySelector('p').textContent,/^Out · left start early/,'GO does not hide disqualification');
 countdownNow=11000;race.update();assert.equal(document.getElementById('raceCountdown').hidden,true);
 if(touch){
  const strip=document.getElementById('raceReadout');
  assert.equal(strip.hidden,false,'phone keeps its race strip');
  racer.out=false;racer.next=1;race.update();assert.equal(strip.textContent,'Race · ring 2/2 · 1.0 s');
  racer.time=1200;race.update();assert.equal(strip.textContent,'Finished · 1.20 s');
  racer.time=null;racer.out=true;race.update();assert.equal(strip.textContent,'Race · out');
  racer.out=false;countdownNow=net.race.startAt+600000;race.update();assert.equal(strip.textContent,'Race timed out.');
  net.race.racers=[];countdownNow=11000;race.update();assert.equal(strip.textContent,'Spectating · 1.0 s','a spectator\'s strip says Spectating');
 }
 net.race.route=null;net.race.startAt=0;race.update();
 assert.equal(document.getElementById('raceStatus').textContent,'Pick a course to start.');
 assert.equal(document.getElementById('raceStatus').style.color,'var(--ink-dim)');
 assert.equal(racePanel.querySelector('button').disabled,true);
 net.race.host=2;race.update();assert.equal(document.getElementById('raceStatus').textContent,'The room host picks the course. Host controls the race.');
 assert.equal(document.getElementById('raceStatus').style.color,'');race.dispose();
 let gameLeft=5000;net.race=null;net.game={kind:1,phase:1,serial:1,host:1,table:[],tag:null};net.gameLeft=()=>gameLeft;net.game.tag={holder:0,parcel:{x:120,z:0}};
 const game=new GameView(net,host),cues=[];
 for(const left of [5000,4000,3000,2000,1000]){gameLeft=left;game.update(.1,[],camera);cues.push(body.children.find(n=>n.className==='roomCountdownSay').textContent);assert.equal(document.getElementById('gamePanel').querySelector('p').textContent,'The parcel waits on the road until GO.');}
 if(touch)assert.match(document.getElementById('gameReadout').textContent,/Parcel tag in 1 · 120 m E/,'countdown readout points to the parcel');
 assert.deepEqual(cues,['Start in 5','Start in 5','Start in 3','Start in 3','Start in 3']);
 net.game.phase=2;gameLeft=180000;countdownNow=20000;game.update(.1,[],camera);assert.equal(document.getElementById('gameCountdown').textContent,'GO');assert.match(document.getElementById('gamePanel').querySelector('p').textContent,/^3:00 left\./);assert.equal(body.children.find(n=>n.className==='roomCountdownSay').textContent,'GO');
 countdownNow=21000;game.update(.1,[],camera);assert.equal(document.getElementById('gameCountdown').hidden,true);game.dispose();strip.remove();
}
globalThis.performance=savedPerformance;
const sticks=createDroneSticks(()=>{}),returnButton=document.getElementById('droneReturn');let labelWrites=0;
const setLabel=returnButton.setAttribute.bind(returnButton);returnButton.setAttribute=(key,value)=>{if(key==='aria-label')labelWrites++;setLabel(key,value);};
sticks.show(true);for(let i=0;i<20;i++)sticks.show(true);assert.equal(labelWrites,1,'stable flight label is written once');
sticks.show(true,true);assert.equal(labelWrites,2);assert.equal(returnButton.getAttribute('aria-label'),'Land now');sticks.show(true,true);assert.equal(labelWrites,2);sticks.show(false);
const main=readFileSync(new URL('../web/src/main.ts',import.meta.url),'utf8');
const noteSetup=main.slice(main.indexOf('const settingsRoomPauseNote ='),main.indexOf('function syncPauseUI():'));
for(const touchDevice of [false,true]){
 const panel=new Element(),heading=Object.assign(new Element(),{id:'settingsHeader'});panel.append(heading);
 const note=new Function('touchDevice','settingsPanel',noteSetup.replace(")!.after",").after")+'return settingsRoomPauseNote;')(touchDevice,panel);
 assert.equal(panel.children.length,touchDevice?1:2);if(note){assert.equal(panel.children[1],note);assert.equal(note.textContent,'A room keeps going when you pause.');assert.equal(note.hidden,true);}
 const visibility=main.match(/  if \(settingsRoomPauseNote\) settingsRoomPauseNote.hidden = !room;/)[0];
 for(const room of [false,true,false]){new Function('settingsRoomPauseNote','room',visibility)(note,room);if(note)assert.equal(note.hidden,!room);}
}
const block=main.slice(main.indexOf('    if (miniMap) {',main.indexOf('  culvertMouths?.update')),main.indexOf('    // Paused frames return early'));
const frame=new Function('ctx',`with(ctx){${block}}`);
for(const active of [false,true]){
 const calls=[],vehicle={x:1,z:2,heading:.4},state={x:30,z:40,yaw:.8};
 frame({miniMap:{setFlight:v=>calls.push(['flight',v]),show:v=>calls.push(['show',v]),update:(...args)=>calls.push(['map',...args])},drone:{active,state},playing:!active,clockRuns:true,mapTimer:1,realDt:.05,refreshMap(){},boss:null,vehicle,mapStops:[],mapMarks:[],mapCars:[]});
 assert.deepEqual(calls.slice(0,2),[['flight',active],['show',true]]);assert.deepEqual(calls[2].slice(1,5),[.05,active?30:1,active?40:2,active?-.8:.4]);assert.equal(calls[2][8],active?vehicle:null);
}
const hintsSource=main.slice(main.indexOf('    const hints ='),main.indexOf("    document.querySelector<HTMLDetailsElement>('#pauseKeys')"));
const pauseHints=new Function('ctx',`with(ctx){${hintsSource};return hints;}`);
for(const touchDevice of [false,true])for(const active of [false,true])for(const device of ['keyboard','gamepad']){
 const driving=[['Driving','Controls']],pad=[['Pad','Controls']];
 const hints=pauseHints({drone:{active},touchDevice,DRONE_HELP,DRONE_TOUCH_HELP,gamepad:{device},padKeys:()=>pad,ride:{kind:'car'},mailMode:true,radio:null,TOUCH:driving,DRIVING_TOUCH:driving,KEYS:driving,DRIVING_KEYS:driving});
 assert.deepEqual(hints,active?(touchDevice?DRONE_TOUCH_HELP:DRONE_HELP):device==='gamepad'?pad:driving);
 if(active&&touchDevice)assert.deepEqual(hints,[['Left stick','Climb and turn'],['Right stick','Fly'],['RETURN TO CAR','Fly back. LAND NOW lands at once.']]);
}
const a=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const b=readFileSync(new URL('../artifact/page.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];assert.equal(a,b,'page style blocks remain identical');
assert.ok(a.includes('body:not(.tcOn):not(.droneOn) #mailCard>#stopHint:not(:empty)+#mailScore{padding-top:0}'),'tally removes top padding only below a nonempty hint outside drone flight');
assert.doesNotMatch(a,/body:not\(\.tcOn\) #mailCard>#mailScore\{padding-top:0\}/,'no unconditional zero top padding on a lone tally');
assert.ok(a.includes(':not(.indoorOn):has(#placesButton:not([hidden])) #pauseButton'),'indoor controls close the chip gap');
assert.ok(a.includes(':not(.indoorOn):has(#placesButton:not([hidden])) #bigMapButton'),'indoor map closes the chip gap');
console.log('PASS lower HUD and photo clearance, short-column fallback, desktop chat default, cached bubble sizes, pooled label boxes, touch and desktop pause execution, flight fold persistence; room order, header, scroll bounds, disconnect cleanup, 12 px names, drone keycaps and hint timer, phone metrics, flight map parent, fold, north, heading, parked car and actual frame wiring; page CSS parity');
