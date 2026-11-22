import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const ATTRIBUTION_RULES = JSON.parse(readFileSync(new URL('./radio-attribution-rules.json', import.meta.url), 'utf8'));
export const SOURCE_WORDS = new Map(ATTRIBUTION_RULES.groups.flatMap(g=>g.sources.map(source=>[source,g.requires])));
const TOP_KEYS=['note','credits','stations','just_start'],STATION_KEYS=['dial','name','tracks','start'],TRACK_KEYS=['source','title','credit','credit_overrides','public','page'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function distance(a,b){
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
 return row[b.length];
}
function allowedKeys(value,keys,label){
 const bad=Object.keys(value).filter(k=>!keys.includes(k)).sort()[0];
 if(bad){const nearest=[...keys].sort((a,b)=>distance(bad,a)-distance(bad,b)||a.localeCompare(b))[0];assert.fail(`${label}: unknown key '${bad}'; did you mean '${nearest}'?`);}
}
function booleans(value,keys,label){for(const key of keys)if(key in value)assert.equal(typeof value[key],'boolean',`${label}: ${key} must be true or false (JSON booleans)`);}
export function checkCatalogueKeys(plan){
 assert.ok(object(plan),'catalogue must be an object');allowedKeys(plan,TOP_KEYS,'catalogue');assert.ok(Array.isArray(plan.stations),'stations must be a list');
 const seen=new Set();
 for(const station of plan.stations){
  assert.ok(object(station),'station must be an object');allowedKeys(station,STATION_KEYS,'station');booleans(station,['start'],'station');
  assert.ok(typeof station.dial==='string'&&station.dial.trim(),'station needs a dial');station.dial=station.dial.trim().toLowerCase();
  assert.notEqual(station.dial,'off','off is reserved for the radio off setting');assert.ok(!seen.has(station.dial),'duplicate dial '+station.dial+' after trimming/case normalisation');seen.add(station.dial);
  assert.ok(Array.isArray(station.tracks),'station needs tracks');
  for(const track of station.tracks){assert.ok(object(track),'song must be an object');allowedKeys(track,TRACK_KEYS,'song');booleans(track,['public','page'],'song');}
 }
 if(plan.just_start!==undefined&&plan.just_start!==null){assert.ok(typeof plan.just_start==='string'&&plan.just_start.trim(),'just_start must name a dial');plan.just_start=plan.just_start.trim().toLowerCase();assert.ok(seen.has(plan.just_start),'just_start must name an existing dial');}
 return plan;
}
export const CATALOGUE = checkCatalogueKeys(JSON.parse(readFileSync(new URL('./radio_stations.json', import.meta.url), 'utf8')));
export const PUBLIC_STATIONS = CATALOGUE.stations.map(s => ({...s, tracks:s.tracks.filter(t=>t.public===true)})).filter(s=>s.tracks.length);
export const ALL_STATIONS = PUBLIC_STATIONS.map(s => s.dial + ' ' + s.name);
export const START_DIAL = PUBLIC_STATIONS.find(s=>s.start===true)?.dial ?? PUBLIC_STATIONS[0]?.dial;
export const JUST_START_DIAL = PUBLIC_STATIONS.find(s=>s.dial===CATALOGUE.just_start)?.dial ?? PUBLIC_STATIONS[0]?.dial;
export const SAVED_DIAL = PUBLIC_STATIONS.find(s=>s.dial!==JUST_START_DIAL)?.dial ?? JUST_START_DIAL;
export function effectiveCredit(track, credits=CATALOGUE.credits) {
  return {...credits[track.credit],...track.credit_overrides};
}
export function musicCreditText(stations=CATALOGUE.stations, credits=CATALOGUE.credits) {
  // Mirror Python credit_text(): credit by source with dials only; a mixed station's dial says "(2 of 5)", never song titles.
  const groups=new Map();
  for(const s of stations){
    const texts=s.tracks.map(t=>effectiveCredit(t,credits).text);
    for(const text of new Set(texts)){
      const share=texts.filter(t=>t===text).length;
      const dial=s.dial+(share===texts.length?'':` (${share} of ${texts.length})`);
      if(!groups.has(text))groups.set(text,[]);
      groups.get(text).push(dial);
    }
  }
  return [...groups].map(([text,dials])=>text.replace('{dials}',()=>dials.length<3?dials.join(' and '):dials.slice(0,-1).join(', ')+' and '+dials.at(-1))).join(' ');
}
/** The title card's credits, About and Just Listen show this credit; it must not grow with every song (#232). No song titles. */
export const MUSIC_CREDIT_MAX = 1100;
export function checkMusicCreditLength(text, stations=CATALOGUE.stations) {
  assert.ok(text.length<=MUSIC_CREDIT_MAX,`music credit is ${text.length} characters; keep it at most ${MUSIC_CREDIT_MAX} (credit by source and dial, not by song)`);
  for(const title of new Set(stations.flatMap(s=>s.tracks.map(t=>t.title))))assert.ok(!text.includes('“'+title+'”'),'music credit must not list song titles: '+title);
}
const normalized=text=>text.toLowerCase().trim().replace(/\s+/g,' ');
const names=(text,words)=>new RegExp('(?<![a-z0-9_])'+normalized(words).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z0-9_])').test(normalized(text));
/** Mirror Python validate(): each track must satisfy its own fixed source rule. */
export function checkMusicContent(_card, stations=CATALOGUE.stations, credits=CATALOGUE.credits) {
  for(const station of stations){
    assert.ok(!normalized(station.name??'').includes('on this map'),'station name must not say on this map');
    for(const track of station.tracks){
      assert.ok(!normalized(track.title??'').includes('on this map'),'track title must not say on this map');
      const credit=effectiveCredit(track,credits),text=credit.text;
      assert.ok(!normalized(text).includes('on this map'),'each credit text must not say on this map');
      const required=SOURCE_WORDS.get(track.source);
      if(required){
        for(const word of required)assert.ok(names(text,word),track.source+' credit.text must name '+word);
      }else{
        for(const key of ['by','source','licence'])assert.ok(typeof credit[key]==='string'&&credit[key].trim(),'new source needs '+key);
        assert.ok(names(text,credit.by),'new source credit.text must name its maker from by: '+credit.by);
      }
    }
  }
}
export const MUSIC_CREDIT_TEXT = musicCreditText();
export function checkStations(stations, expected=CATALOGUE.stations.filter(s=>s.tracks.length)) {
  assert.deepEqual(stations.map(s => s.dial + ' ' + s.name), expected.map(s=>s.dial+' '+s.name), 'both brands offer every catalogue station');
  assert.ok(stations.every(s => s.tracks.length > 0), 'every station has songs');
  assert.deepEqual(stations.map(s=>s.tracks.map(t=>[t.file,t.title])),expected.map(s=>s.tracks.map(t=>[t.source+'.mp3',t.title])), 'every catalogue track stays in its station');
}
/** Remove only exact catalogue fields from the radio scan; keep all surrounding text. */
export function radioTextToCheck(body, radio, catalogue) {
  let residual = radio.text;
  if (catalogue.stations.some(s => radio.station === `${s.dial} ${s.name}`)) residual = residual.replace(radio.station, '');
  if (radio.track && catalogue.stations.some(s => s.tracks.some(t => t.title === radio.track))) residual = residual.replace(radio.track, '');
  return { body: radio.text ? body.replace(radio.text, residual) : body, radio: residual };
}
