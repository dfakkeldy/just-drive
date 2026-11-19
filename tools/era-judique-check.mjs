// Judique 1884: committed layout, printed-label sources, privacy, keep-clear, counts, road names; and Mabou frozen.
// Bundled and run by tools/check-era.sh from web/. Reads baked land only; writes nothing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readEra} from '../web/src/era.ts';
import {HistorySiting,historyPlaces,TRADE_WORDS,farmBarn,siteCorners} from '../web/src/eras/history-sites.ts';
import {historyLayout,getHistoryLayoutData,decodeHistoryLayout} from '../web/src/eras/history-layout.ts';
import {JUDIQUE_1884_TRADES} from '../web/src/eras/judique-1884-trades.ts';
import {JUDIQUE_1884_LAYOUT_JSON} from '../web/src/eras/judique-1884-layout.ts';
import {JUDIQUE_DENSITY} from '../web/src/eras/judique-1884-density.ts';
import {specCellAt,inSpecVillage,densityCellId} from '../web/src/eras/history-density.ts';
import {historyRoadName,historyRoadText} from '../web/src/eras/history-road-names.ts';
import {HISTORY_AREAS} from '../web/src/eras/history-areas.ts';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {eraRoadHalf} from '../web/src/era.ts';
import {homePlaces} from '../web/src/places.ts';
import {densityGround} from './era-density-ground.mjs';
import {getDensityAuditData} from './era-density-data.mjs';
import {verifyDensityInputs} from './era-density-inputs.mjs';
const root=process.env.MMM_ROOT??process.cwd(),sha=file=>createHash('sha256').update(readFileSync(root+'/'+file)).digest('hex');

// 1. Mabou is frozen: any change to its generated layout, audit, counts or labels fails here first.
// The pins live here because this change is what could move Mabou; era-density-generated regenerates it.
const MABOU_FROZEN={
 'web/src/eras/mabou-1884-layout.ts':'c679f1dc15adf756717d923ff04603d1d9c371b9d6bfc24d191e3b8dc4aa889d',
 // The audit's manifest fingerprint leaves out buildingStyles since grok-bots #1288 (no 1884 input reads it); the layout is unchanged.
 'tools/era-density-layout.json':'e9220bcbdc5464bc455740f8d3628e9b9d3639e79f7d80020d796158ae2de9f8',
 'web/src/eras/mabou-1884-density.ts':'d334407249308e3ac893c34f0217fdbdb2bd2bdc4dbff0347f7386a2443204c0',
 'web/src/eras/mabou-1884-trades.ts':'0b70423528df61a4976cd2b1b471db9f4b6cb170e2e87f091c93bc8dac99202a',
};
for(const[file,want]of Object.entries(MABOU_FROZEN))assert.equal(sha(file),want,file+' changed: Mabou 1884 must stay byte-identical');
assert.equal(getHistoryLayoutData('mabou').trades.length,48);
console.log('PASS Mabou 1884 layout, audit, counts and labels are byte-identical to main');

// 2. Era and words.
const era=readEra(new URLSearchParams('era=1884&area=judique'));assert.equal(era.title,'Judique, 1884');assert.equal(era.area,'judique');
assert.equal(historyRoadName('Campbell Road','judique'),'Old Judique Road');assert.equal(historyRoadName('Glendale Mountain Road','judique'),'River Inhabitants Road');
assert.equal(historyRoadName('Campbell Road','mabou'),'Campbell Road','a Judique period name never applies in Mabou');
assert.equal(historyRoadName('Campbell Road'),'Campbell Road');assert.equal(historyRoadName('Highway 19','judique'),'Post Road');
for(const modern of ['Highway 105','Old Trunk 5','Judique Flyer Trail','Ceilidh Coastal Trail'])assert.equal(historyRoadName(modern,'judique'),'cart road',modern);
assert.equal(historyRoadName('River Denys Road','judique'),'River Denys Road');
assert.equal(historyRoadText('Campbell Road meets Highway 105','judique'),'Old Judique Road meets cart road');
console.log('PASS Judique title and period road names (per area; Mabou names unchanged)');

// 3. Printed labels: sources, words and privacy. No person's name in any shipped Judique text.
const ids=JUDIQUE_1884_TRADES.map(t=>t.id);assert.equal(ids.length,37);assert.equal(new Set(ids).size,37);
const allowed=new Set(['School','Forge','Sh. Mill','Mill','Mills','Stage Stables','Shop','P.O.','R.C. Church','Church','R.C.Ch.']);
for(const t of JUDIQUE_1884_TRADES){assert(allowed.has(t.word),t.id+' word '+t.word);assert(TRADE_WORDS[t.word],t.id+' has a sign word');assert.match(t.id,/^F19-JUD-\d{3}$/);
 assert.equal(t.source,`Geological Survey of Canada, Cape Breton sheet 19 (1884), label ${t.id}`);}
const files=['web/src/eras/judique-1884-trades.ts','web/src/eras/judique-1884-layout.ts','web/src/eras/judique-1884-density.ts'].map(f=>readFileSync(root+'/'+f,'utf8'));
const shipped=[JSON.stringify(JUDIQUE_1884_TRADES),JUDIQUE_1884_LAYOUT_JSON,JSON.stringify(HISTORY_AREAS.judique)].join('\n');
// Possessives and Scottish-surname prefixes are how the sheet prints people's names (for example on shops and mills).
// Possessives: every shipped value. Mc/Mac name forms: the whole source files too, comments included. Labels: the word whitelist above.
assert.doesNotMatch(shipped,/[A-Za-z]'s\b/,'no possessive (a printed owner name) in Judique 1884 data');
for(const text of [shipped,...files])assert.doesNotMatch(text,/\bM[cᶜ][A-Z]|\bMac[A-Z]/,'no person names in Judique 1884 files');
for(const id of ['F19-JUD-046','F19-JUD-068','F19-JUD-020'])assert(![shipped,...files].some(t=>t.includes(id)),id+' (a printed person name) is not shipped');
console.log('PASS 37 printed Judique labels with exact sources; no person names in shipped Judique data');

// 4. The committed layout: decode, sites, places, keep-clear, counts.
const base=root+'/data/baked/areas/judique',audit=getDensityAuditData('judique');
console.log('PASS judique land fingerprints',JSON.stringify(verifyDensityInputs(base,audit.header.fingerprints)));
assert.throws(()=>decodeHistoryLayout(JUDIQUE_1884_LAYOUT_JSON,48),/48 trades/,'Judique layout is not a Mabou layout');
const land=densityGround(base),origin=land.manifest.village,{trades,farms}=historyLayout(origin,'judique');
assert.equal(trades.length,37);assert.deepEqual(trades.map(t=>t.id),ids,'one building per printed label, in table order');
const roads=JSON.parse(readFileSync(base+'/roads.json','utf8')).roads.filter(r=>r.kind!==5).map(r=>({...r,halfWidth:eraRoadHalf(r.kind,r.halfWidth),pts:r.pts.map(p=>[p[0]-origin[0],origin[1]-p[1]])}));
const approaches=new HistoryBridgeApproaches({roads},{seaLevel:-.2,exag:1.5},land.approachHeight);
const homes=homePlaces().map(p=>({x:p.e-origin[0],z:origin[1]-p.n}));
const keep=homes.map(h=>({box:[h.x-200,h.z-200,h.x+200,h.z+200]}));
const siting=new HistorySiting(roads,JSON.parse(readFileSync(base+'/streams.json','utf8')),origin,(x,z)=>![0,4].includes(land.cover(x,z)),land.drawn,land.cover,[...approaches.sites,...keep]);
for(const s of trades){assert(siting.safe(s,trades.filter(p=>p!==s)),s.id+' dry footprint clear of roads, water, approaches and the keep-clear box');
 const label=JUDIQUE_1884_TRADES.find(t=>t.id===s.id);assert(Math.hypot(s.x-(label.e-origin[0]),s.z-(origin[1]-label.n))<=300,s.id+' within 300 m of its printed label');}
const places=historyPlaces(trades,origin,'judique');assert.equal(places.length,37);
for(const p of places){assert.equal(p.area,'judique');assert.match(p.note,/^The 1884 survey sheet prints ".+" near here\. This building and its exact place are invention\.$/);}
const centres=[...trades,...farms].flatMap(s=>{const b=farmBarn(s);return b?[s,b]:[s];});
for(const s of centres)for(const h of homes)for(const[x,z]of siteCorners(s))assert(Math.max(Math.abs(x-h.x),Math.abs(z-h.z))>200,s.id+' stays 200 m clear of the author\'s house');
const map=s=>[origin[0]+s.x,origin[1]-s.z],deficits=audit.header.deficits,physical={};
for(const f of farms){assert.equal(inSpecVillage(JUDIQUE_DENSITY,...map(f)),f.zone==='village',f.id+' zone');if(f.zone!=='village'){const id=specCellAt(JUDIQUE_DENSITY,...map(f));physical[id]=(physical[id]??0)+1;}}
for(let row=0;row<JUDIQUE_DENSITY.residences.length;row++)for(let col=0;col<JUDIQUE_DENSITY.residences[row].length;col++){
 const id=densityCellId(col,row),counted=JUDIQUE_DENSITY.residences[row][col],deficit=deficits.find(d=>d.cell===id);
 assert.equal(physical[id]??0,deficit?.built??counted,id+' built count equals the 1884 count, or an explicit deficit');
}
assert.equal(farms.filter(f=>f.zone==='village').length,JUDIQUE_DENSITY.villageResidences);
for(const f of farms){const others=[...trades,...farms.filter(p=>p!==f)],barn=farmBarn(f);assert(siting.safe(f,others),f.id+' dry and clear');if(barn)assert(siting.safe(barn,others),f.id+' barn dry and clear');
 for(const p of farms)if(p!==f)assert(Math.hypot(p.x-f.x,p.z-f.z)>=(p.zone==='village'&&f.zone==='village'?18:60),'farm spacing');}
assert(farms.every(f=>f.word===''&&f.source===''),'farms carry no map words');
const total=JUDIQUE_DENSITY.residences.flat().reduce((a,b)=>a+b,0)+JUDIQUE_DENSITY.villageResidences;
console.log('JUDIQUE',JSON.stringify({trades:trades.length,farms:farms.length,counted:total,deficits,zones:Object.fromEntries(['village','roadside','remote'].map(z=>[z,farms.filter(f=>f.zone===z).length]))}));
console.log('PASS Judique layout: 37 sited trades, invented farms at the counted density, keep-clear and spacing');
