import assert from 'node:assert/strict';
import {readSite, areaAddress} from '../web/src/site.ts';
import {sugarCampStart, MARBLE_MOUNTAIN} from '../web/src/sugar-camp-start.ts';
import {bootTripParams} from '../web/src/quarry-trip.ts';
assert.equal(readSite('justdrive.fakkeldy.ca','/westbay').area,'westbay');
assert.equal(readSite('justdrive.fakkeldy.ca','/sugar-camp-quarry').area,'westbay');
assert.equal(areaAddress(readSite('justdrive.fakkeldy.ca','/westbay'),'mabou','/westbay',new URLSearchParams('poster=sugar-camp-quarry&q=low')),'/mabou?q=low','an area change drops the poster start');
globalThis.history={state:null,replaceState(...args){assert.ok(args[2].startsWith('/westbay?'));}};
globalThis.location={hostname:'justdrive.fakkeldy.ca',pathname:'/sugar-camp-quarry',hash:'',search:'?era=1884&vehicle=horse&trip=quarry&at=1,2'};
const p=bootTripParams();for(const [key,value] of Object.entries({area:'westbay',era:'today',vehicle:'truck',trailer:'1'}))assert.equal(p.get(key),value);
assert.equal(p.get('poster'),'sugar-camp-quarry');assert.equal(p.has('start'),false);assert.equal(p.has('trip'),false);assert.equal(p.has('at'),false);
const village=[MARBLE_MOUNTAIN.e-100,MARBLE_MOUNTAIN.n-100];
const roads=[{kind:2,pts:[[0,0],[200,-200]]},{kind:5,pts:[[100,-100],[101,-101]]}];
const a=sugarCampStart(roads,village,[0,-90,90,0]);assert.ok(a);assert.ok(a.x<=88&&a.z>=-88);assert.ok(Math.cos(a.heading)<0);
const b=sugarCampStart([{...roads[0],pts:[...roads[0].pts].reverse()}],village,[0,-90,90,0]);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8);assert.ok(Math.abs(Math.sin(a.heading-b.heading))<1e-8);
console.log('PASS alias modern fleet preset, clipped nearest road, southward tangent independent of digitisation');

const {readFileSync}=await import('node:fs');
try {
 const manifest=JSON.parse(readFileSync('data/baked/areas/westbay/manifest.json'));
 const data=JSON.parse(readFileSync('data/baked/areas/westbay/roads.json'));
 const box=[628364-manifest.village[0],manifest.village[1]-5078756,654988-manifest.village[0],manifest.village[1]-5058276];
 const world=data.roads.map(r=>({...r,pts:r.pts.map(([e,n])=>[e-manifest.village[0],manifest.village[1]-n])}));
 const pose=sugarCampStart(world,manifest.village,[box[0]+120,box[1]+120,box[2]-120,box[3]-120]);assert.ok(pose);assert.ok(pose.distance<50);assert.ok(Math.cos(pose.heading)<0);console.log('REAL ROAD CANDIDATE',JSON.stringify({...pose,e:pose.x+manifest.village[0],n:manifest.village[1]-pose.z}));
} catch(error) {if(error.code!=='ENOENT')throw error;console.log('Real land absent; analytic test passed');}
