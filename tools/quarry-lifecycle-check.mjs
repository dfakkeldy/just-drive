import assert from 'node:assert/strict';
import {QuarryJourney} from '../web/src/quarry-journey.ts';
import {bootTripParams,tripStorageKey} from '../web/src/quarry-trip.ts';
import {APRON} from '../web/src/quarry-site.ts';
const village=[642342,5063327],apron={x:APRON.e-village[0],z:village[1]-APRON.n,heading:0};
const element=()=>({dataset:{},setAttribute(){},parentElement:null,append(n){n.parentElement=this},classList:{contains:()=>false}});
const body=element();globalThis.document={body,head:element(),createElement:element,getElementById:()=>null};
function environment(search){
 const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 globalThis.location=new URL('http://localhost/'+search);globalThis.history={state:null,replaceState(_s,_t,url){globalThis.location=new URL(url,location)}};return values;
}
const route={points:[{x:apron.x+500,z:apron.z},apron],cumulative:[0,500],length:500,start:{x:apron.x+500,z:apron.z,heading:0},near:{x:apron.x+100,z:apron.z,heading:0},destination:apron,turns:[],joins:[]};
const selected=process.env.QUARRY_LIFECYCLE_CASE;
if(!selected||selected==='B1')for(const id of['quarry','quarry-gate']){
 const values=environment('?trip='+id+'&area=westbay&mode=explore&vehicle=truck&trailer=1'),saved={x:631990.288835-village[0],z:village[1]-5061900.059997,heading:1.1780972451,arrived:true};values.set(tripStorageKey(id),JSON.stringify(saved));
 const truck={x:route.start.x,z:route.start.z,heading:0,speed:0,placementGuard:p=>Math.hypot(p.x-saved.x,p.z-saved.z)>10,restart(x,z,heading){Object.assign(this,{x,z,heading})}},map={setRoute(p){this.route=p}};
 const j=new QuarryJourney(new URLSearchParams(location.search),{},village,()=>truck,map,route);j.place();
 assert.equal(j.arrived,true,'B1 completion survives replacement-truck rejection before any update');assert.equal(j.remaining,0);assert.ok(Math.hypot(truck.x-apron.x,truck.z-apron.z)<1,'B1 completed reload uses the safe unloading apron');assert.equal(truck.placementGuard(truck),true);assert.equal(map.route.length,0);j.update(1.2,true);assert.equal(JSON.parse(values.get(tripStorageKey(id))).arrived,true);
 console.log('PASS B1',id,'completed small-vehicle save, rejected truck pose, safe completed reload');
}
if(!selected||selected==='B2')for(const id of['quarry','quarry-gate']){
 const values=environment('?trip='+id),key=tripStorageKey(id),other=tripStorageKey(id==='quarry'?'quarry-gate':'quarry');values.set(key,JSON.stringify({...apron,arrived:true}));values.set(other,'other trip');
 const fresh=bootTripParams();assert.equal(values.get(key),undefined,'B2 a new bare trip link clears its old completion and pose');assert.equal(values.get(other),'other trip');for(const[k,v]of Object.entries({area:'westbay',mode:'explore',vehicle:'truck',trailer:'1'}))assert.equal(fresh.get(k),v);
 const saved=JSON.stringify({...apron,arrived:true});values.set(key,saved);const expanded=location.search;bootTripParams();assert.equal(location.search,expanded);assert.equal(values.get(key),saved,'B2 reload of the expanded trip keeps its completed save');
 for(const [k,v]of[['area','judique'],['mode','mail'],['vehicle','bike']]){location.search=expanded;const q=new URLSearchParams(location.search);q.set(k,v);location.search='?'+q;assert.equal(bootTripParams().has('trip'),false,'explicit '+k+' choice ends the trip');}
 console.log('PASS B2',id,'bare link starts fresh; expanded reload resumes; later choices end trip');
}
