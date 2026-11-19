import { CATALOGUE, musicCreditText, effectiveCredit, checkMusicContent, SOURCE_WORDS, checkCatalogueKeys, checkMusicCreditLength, MUSIC_CREDIT_MAX, MUSIC_CREDIT_TEXT } from './radio-expectations.mjs';
import { AREAS } from '../web/src/area.ts';
// Compare real title templates and actual main.ts radio wiring, including absent/disabled radio.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {build,transform} from '../web/node_modules/esbuild/lib/main.js';
const source=readFileSync('web/src/main.ts','utf8');
// Keep the title baseline at the common tree when origin/main advances.
const baselineHead=execFileSync('git',['merge-base','HEAD','origin/main'],{encoding:'utf8'}).trim();
const original=execFileSync('git',['show',baselineHead+':web/src/title.ts'],{encoding:'utf8'});
async function load(title, generated, publicApp=false, creditSource){
 const plugins=[];
 if(generated!==undefined)plugins.push({name:'credit-mutant',setup(b){b.onLoad({filter:/radio-credits\.generated\.ts$/},()=>({contents:generated,loader:'ts'}));}});
 if(creditSource!==undefined)plugins.push({name:'far-credit-mutant',setup(b){b.onLoad({filter:/[/\\]credits\.ts$/},()=>({contents:creditSource,loader:'ts'}));}});
 const r=await build({stdin:{contents:title,resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{__PUBLIC_APP__:String(publicApp)},plugins});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
}

const tallTitleSource=readFileSync('web/src/title.ts','utf8');
const tallCredits=['<p>Contains modified Copernicus Sentinel data 2026.</p>','<p>Source: Natural Resources Canada, Canadian Wind Turbine Database. Contains information licensed under the Open Government Licence – Canada.</p>','<p>Far land and turbine ground heights: Natural Resources Canada, Medium Resolution Digital Elevation Model (MRDEM-30 DTM). Contains information licensed under the Open Government Licence – Canada.</p>'];
function withoutTallCredits(text,required=false){for(const row of tallCredits){if(required)assert.equal(text.split(row).length,2,'required tall credit occurs once');text=text.replace(row+'\n','');}return text;}

const before=await load(original),current=await load(readFileSync('web/src/title.ts','utf8'));
function dom(){const roots=[];const node=()=>({style:{},classList:{add(){}},setAttribute(){},addEventListener(){},focus(){},append(){},after(){},prepend(){},hidden:false,innerHTML:'',textContent:''});globalThis.document={head:{appendChild(){}},body:{appendChild:n=>roots.push(n)},createElement:()=>{const n=node(),parts=new Map();n.querySelector=key=>{if(!parts.has(key))parts.set(key,node());return parts.get(key);};n.parts=parts;return n;}};globalThis.localStorage={getItem:()=>null};return roots;}
const expressions=text=>{const tree=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true),out={};function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='expose')out.expose=n.getText(tree);if(ts.isCallExpression(n)&&n.expression.getText(tree)==='createTitle')out.title=n.getText(tree);if(ts.isIfStatement(n)&&n.expression.getText(tree)==="!bare && params.get('radio') !== '0'")out.radio=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);return out;};
async function actual(main,query,radio,title=current){const roots=dom(),expr=expressions(main);const c=vm.createContext({ERA:{id:'today',title:null,radio:true,modern:true},createTitle:title.createTitle,touchDevice:true,gameMode:'mail',SITE:{brand:'mail'},AREA:{name:'Mabou',mailTitle:true},ride:{choice:{kind:'car'},setRadio(){}},titleDaily:undefined,bare:false,started:false,terrain:{paved:new URLSearchParams(query).get('paved')!=='0'?{}:null},params:new URLSearchParams(query),loadRadio:()=>Promise.resolve(radio),siteRadio:()=>({}),title:null,radio:null,fired:null});
 const compile=async text=>(await transform(text,{loader:'ts',target:'es2022',define:{'import.meta.env.DEV':'false','import.meta.env.BASE_URL':JSON.stringify('./')}})).code;
 // Include the real dev-only helper now referenced by the extracted radio block.
 if(expr.expose)vm.runInContext(await compile(expr.expose),c);
 vm.runInContext(await compile('title = '+expr.title),c);vm.runInContext(await compile(expr.radio),c);await Promise.resolve();await Promise.resolve();
 const root=roots[0];return withoutTallCredits(root.innerHTML.replace(/<dl>[\s\S]*?<\/dl>/,()=>`<dl>${root.parts.get('dl')?.innerHTML || root.innerHTML.match(/<dl>([\s\S]*?)<\/dl>/)[1]}</dl>`),true);
}
// Cross-brand navigation uses clean addresses, never a trip, room, or local test query.
for (const [just, area, era, path, href, words] of [
 [false, undefined, 'today', '/', 'https://justdrive.fakkeldy.ca/', 'Just want to drive? Just Drive has every area, no mail.'],
 [false, 'Judique', 'today', '/?area=judique&trip=secret', 'https://justdrive.fakkeldy.ca/judique', 'Just want to drive? Just Drive has every area, no mail.'],
 [true, 'Judique', 'today', '/judique', 'https://mmm.fakkeldy.ca/', 'Want a job with your drive? Mabou Mail Madness: the same land, with a mail route.'],
 [false, 'Judique', '1884', '/?area=judique&era=1884', 'https://justdrive.fakkeldy.ca/judique-1884', 'Just want to drive? Just Drive has every area, no mail.'],
 [true, 'Judique', '1884', '/judique-1884', 'https://mmm.fakkeldy.ca/?era=1884&area=judique', 'Want a job with your drive? Mabou Mail Madness: the same land, with a mail route.'],
 [false, 'West Bay', '1884', '/?area=westbay', 'https://justdrive.fakkeldy.ca/', 'Just want to drive? Just Drive has every area, no mail.'],
]) {
 globalThis.location = new URL(path, just ? 'https://justdrive.fakkeldy.ca' : 'https://mmm.fakkeldy.ca');
 const roots = dom();
 current.createTitle(true, () => {}, just ? 'explore' : 'mail', area, undefined, just, true, {id:era,title:null,area:area==='Judique'?'judique':area==='West Bay'?'westbay':'mabou'});
 const html = roots[0].innerHTML;
 const line = html.match(/<span id="titleOtherGame">([\s\S]*?)<\/span>/)?.[1];
 assert.ok(line, 'visible cross-brand line');
 assert.equal(line.replace(/<[^>]*>/g, ''), words);
 assert.equal(line.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&'), href);
 assert.ok(html.indexOf('titleOtherGame') < html.indexOf('<dl>'), 'same position before controls');
 if (!just && !area) assert.match(html, /id="modeExplore"[^>]*>Just drive<\/button>/);
}
delete globalThis.location;
console.log('PASS both brands link to the other website, same-area and 1884 addresses, home fallback and retained mode choice');
const { aboutPage } = await import('./about-pages.mjs');
for (const [brand, host] of [['mail', 'justdrive'], ['just', 'mmm']]) {
 const html = aboutPage(brand);
 assert.match(html, new RegExp('Two games, one island[\\s\\S]*?href="https://'+host+'\\.fakkeldy\\.ca/"'));
 assert.ok(html.indexOf('Two games, one island') < html.indexOf('<div class="actions">'));
}
// Contact is checked on the real page. Music is checked against the catalogue below; edits must not break other title copy.
const groundCredits=[
 '<p>Environment and Climate Change Canada - Environnement et Changement climatique Canada. (2025) “Canadian National Wetlands Inventory - Inventaire national des terres humides du Canada”. Available at: <a href="https://open.canada.ca/data/en/dataset/d5af4ac5-ebdb-4645-bb0a-8ec5cac5e29f">Canadian National Wetlands Inventory</a> (Accessed 14 November 2026). Contains information licensed under the Open Government Licence – Canada.</p>',
 '<p>Contains modified Copernicus Sentinel data 2025, 2026. Only derived ground classes are used.</p>',
];
const noContact=html=>groundCredits.reduce((s,c)=>s.replace(c+'\n',''),html).replace(/<span id="titleOtherGame">[\s\S]*?<\/span>/,'').replace(/<p id="titleMusic">[\s\S]*?<\/p>/,'').replace(/<p id="titleContact">[\s\S]*?<\/p>/,'').replace(/<p id="titleAbout">[\s\S]*?<\/p>/,'').replace(' id="titleMusic"','').replace(/<p id="ns(?:Lidar|Paved)Credit">[\s\S]*?<\/p>\n?/,'');
// The ground classes (pits, open wetland, rail and quarry ground) name every source they read.
const OGL_NS=/Roads, railways, water, building locations, utility lines and towers, forest types, designated areas, and Point Tupper dams, culverts, conveyors and some fences and gates: Province of Nova Scotia\. Contains information licensed under the Open Government Licence – Nova Scotia\./;
function groundAttribution(title){
 for(const just of [false,true])for(const historical of [false,true]){
  const roots=dom();title.createTitle(false,()=>{},'explore','Mabou',undefined,just,true,{id:historical?'1884':'today',title:null,radio:true});
  for(const credit of groundCredits)assert.equal(roots[0].innerHTML.split(credit).length,2,'exact ground credit once in every brand and era');
  assert.match(roots[0].innerHTML,OGL_NS,'the Nova Scotia line names railways and designated areas');
 }
}
groundAttribution(current);
// The credits live in credits.ts; a mutant drops one from what the title renders.
if(process.argv.includes('--mutations'))for(const cut of [...groundCredits,'railways, ','forest types, designated areas']){
 const titleText=readFileSync('web/src/title.ts','utf8');assert.ok(titleText.includes('${LAND_CREDITS}'));
 const mutant=await load(titleText.replaceAll('${LAND_CREDITS}','${LAND_CREDITS.replace('+JSON.stringify(cut)+",'')}"));
 assert.throws(()=>groundAttribution(mutant));console.log('KILLED missing ground attribution');
}
// The new source credit is intentional. Require it on the actual title before
// excluding that one paragraph from the pre-existing title/radio parity check.
// The radio's donation ad says "use the coffee link on the title card": the card holds it exactly once.
assert.equal((await actual(source,'',null)).split('<a id="titleCoffee" href="https://ko-fi.com/fakkeldy" target="_blank" rel="noopener">Buy the developer a coffee</a>').length,2,'the title card holds the coffee link exactly once');
// The open pavement layer is on by default where it is installed: the credit is on the default card exactly once.
assert.equal((await actual(source,'',null)).split('id="nsPavedCredit"').length,2,'default title holds the open pavement credit exactly once');
assert.doesNotMatch(await actual(source,'paved=0',null),/nsPavedCredit/,'paved=0 (layer off) has no credit');
assert.doesNotMatch(await actual(source,'',null),/nsLidarCredit/,'no LiDAR-intensity credit: no intensity is read');
assert.doesNotMatch(await actual(source,'paved=1',null),/nsLidarCredit/,'no LiDAR-intensity credit with the layer forced on');
// The trial is a player choice: it must not bypass the card/menu that owns this credit.
const visitModule=await import('data:text/javascript;base64,'+Buffer.from((await transform(readFileSync('web/src/visit.ts','utf8'),{loader:'ts',format:'esm'})).code).toString('base64'));
assert.equal(visitModule.isTestVisit(new URLSearchParams('area=pointtupper&paved=1')),false);
const credit=(await actual(source,'',null)).match(/<p id="ns(?:Lidar|Paved)Credit">[\s\S]*?<\/p>/)?.[0];
assert.ok(credit);assert.doesNotMatch(credit,/Dan Fakkeldy/);
assert.match(credit,/Contains information licensed under the Open Government Licence – Nova Scotia/);
assert.match(credit,/https:\/\/support\.novascotia\.ca\/services\/open-data-portal-licence/);
assert.doesNotMatch(credit,/LiDAR|unrestricted|201602/);
// The one intentional addition to the frozen title: pin the complete licence credit independently.
const propertyCredit='<p>Property lines (optional, online only): Contains information obtained under license from the Province of Nova Scotia which is provided without warranty or liability for errors or omissions. <a href="https://nsgiwa.novascotia.ca/documents/licenses/MapService/Restricted%20Map%20Services%20License%20-%20NSPRD%20v1.pdf" target="_blank" rel="noopener noreferrer">Licence</a></p>';
// The second intentional addition: the Get Fired choice beside the two modes, pinned here too.
const firedChoice='<button id="modeFired" aria-pressed="false">Get fired</button>';
// The third: Today's run, its own row under the three modes.
const dailyChoice='<div id="dailyChoice"><button id="modeDaily" aria-pressed="false">Today’s run: five minutes, complaint bingo</button></div>';
function expected(){const roots=dom();before.createTitle(true,()=>{});let html=roots[0].innerHTML;const anchor='<p>Built with three.js (MIT licence).</p>';assert.equal(html.split(anchor).length,2);
 // origin/main holds each addition itself once it has landed: add it only to a baseline that has none.
 if(!html.includes(firedChoice)){assert.equal(html.split('>Just drive</button></div>').length,2);html=html.replace('>Just drive</button></div>','>Just drive</button>'+firedChoice+'</div>');}
 if(!html.includes(dailyChoice)){assert.equal(html.split('>Get fired</button></div>').length,2);html=html.replace('>Get fired</button></div>','>Get fired</button></div>'+dailyChoice);}
 return html.includes(propertyCredit)?html:html.replace(anchor,anchor+'\n'+propertyCredit);}
assert.equal(noContact(await actual(source,'',null)).split(firedChoice).length,2,'the mail title offers Get Fired exactly once');
assert.equal(noContact(await actual(source,'',null)).split(dailyChoice).length,2,'the mail title offers Today’s run exactly once');
assert.equal(noContact(await actual(source,'',null)).split(propertyCredit).length,2,'the current title holds the complete property credit exactly once');
for(const [label,query,radio] of [['present','',{start(){}}],['disabled','radio=0',null],['missing','',null]])assert.equal(noContact(await actual(source,query,radio)),noContact(withoutTallCredits(expected())),'mail title matches origin/main: '+label);
console.log('PASS actual main radio wiring and title HTML match main with reviewed music geography and the exact property credit for present, disabled and missing lists');
if(process.argv.includes('--mutations')){
 for(const [i,row] of tallCredits.entries()){
  const missing=await load(tallTitleSource,undefined,false,readFileSync('web/src/credits.ts','utf8').replace(row,''));
  await assert.rejects(()=>actual(source,'',null,missing),{name:'AssertionError'},'missing tall credit '+i);
  console.log('PASS rejected missing tall credit:',i);
 }
 for(const [label,from,to] of [['initial hints',"ride.choice, SITE.brand === 'just', SITE.brand !== 'just'","ride.choice, SITE.brand === 'just', false"],['shared availability update',"if (SITE.brand === 'just') { title?.setRadio",'if (true) { title?.setRadio']]){
  assert.ok(source.includes(from));assert.notEqual(noContact(await actual(source.replace(from,to),'',null)),noContact(withoutTallCredits(expected())),label);console.log('PASS rejected title mutation:',label);
 }
}

const r=await build({stdin:{contents:"export {rideFeatures} from './ride-features';",resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const ride=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
assert.match(ride.rideFeatures({}, {id:'car'}, {}, true, false, false).help,/T: radio/);
assert.doesNotMatch(ride.rideFeatures({}, {id:'car'}, {}, true, false, true).help,/T: radio/);
console.log('PASS mail explore HUD retains its radio hint; only absent Just Drive radio hides it');

// The same named music credit must survive every brand/era branch.
function musicCredits(title, stations=CATALOGUE.stations, credits=CATALOGUE.credits) {
 for(const area of AREAS.map(a=>a.name))for(const just of [false,true])for(const historical of [false,true]){
  const roots=dom();
  title.createTitle(false,()=>{},'explore',area,undefined,just,true,{id:historical?'1884':'today',title:historical?'Mabou, 1884':null,radio:true});
  const html=roots[0].innerHTML,credit=html.match(/<p id="titleMusic">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(credit,'music credit exists for '+just+' '+historical);
  assert.equal(credit,musicCreditText(stations,credits).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),'exact catalogue music credit in every area/brand/era');
  checkMusicContent(credit,stations,credits);
  assert.equal((html.match(/id="titleMusic"/g)||[]).length,1,'music credited exactly once');
 }
}
musicCredits(current);
const defaultCredit=JSON.parse(readFileSync(new URL('./radio-default-credit.json',import.meta.url),'utf8'));
if(createHash('sha256').update(readFileSync('tools/radio_stations.json')).digest('hex')===defaultCredit.catalogueHash){
 for(const title of [current,await load(readFileSync('web/src/title.ts','utf8'),undefined,true)]){
  const roots=dom();title.createTitle(false,()=>{});
  assert.equal(roots[0].innerHTML.match(/<p id="titleMusic">[\s\S]*?<\/p>/)?.[0],defaultCredit.musicHTML,'default music text is byte-identical to the reviewed main literal');
 }
 console.log('PASS fixed default-catalogue music comparison to main literal, both build flags');
}
// An extra paragraph must not change which credits a period card includes.
musicCredits(await load(readFileSync('web/src/title.ts','utf8').replace('const LEGAL = `','const LEGAL = `<p>Extra unrelated paragraph.</p>')));
console.log('PASS shared music credits in both brands and eras, independent of paragraph positions');
// A deliberately private station makes the two generated constants different, even when today's catalogue is all public.
const publicFixture=structuredClone(CATALOGUE);
const hidden=publicFixture.stations.find(s=>s.tracks.some(t=>t.public===true));
assert.ok(hidden,'public credit fixture needs a published station');
for(const track of hidden.tracks)track.public=false;
const publicExpected=publicFixture.stations.map(s=>({...s,tracks:s.tracks.filter(t=>t.public===true)})).filter(s=>s.tracks.length);
assert.notEqual(musicCreditText(publicFixture.stations,publicFixture.credits),musicCreditText(publicExpected,publicFixture.credits),'private-station fixture distinguishes public and all-song credits');
const generate=plan=>execFileSync('python3',['-c',"import sys;sys.path.insert(0,'tools');from radio_catalogue import credits_module;print(credits_module(sys.stdin.buffer.read()),end='')"],{input:JSON.stringify(plan),encoding:'utf8',stdio:['pipe','pipe','pipe']});
// Independent, per-track fixtures stay active when a whole genre is removed from the catalogue.
const contentFixture=(source,text)=>({credits:{fixture:{by:'Fixture maker',source:'authored fixture',licence:'Fixture permission',date:'2026-01-01',text}},stations:[{dial:'x',name:'Fixture',tracks:[{source,title:'Fixture song',credit:'fixture'}]}]});
const checkFixture=plan=>checkMusicContent(null,plan.stations,plan.credits);
for(const [source,words]of SOURCE_WORDS){
 const fixture=contentFixture(source,'Music on {dials}: '+words.join(', ')+'.');
 checkFixture(fixture);generate(fixture);
 for(const word of words){
  const bad=structuredClone(fixture);bad.credits.fixture.text=bad.credits.fixture.text.replace(word,'omitted');
  assert.throws(()=>checkFixture(bad),undefined,'own track content: '+source+' / '+word);
  assert.throws(()=>generate(bad),undefined,'Python pre-write content: '+source+' / '+word);
 }
}
const aiSource='where-two-rivers-meet'; // Fixed independently of the rule under test.
for(const [label,fixture]of [
 ['C2 around Mabou',contentFixture(aiSource,'Music on {dials}: Claude and ElevenLabs Music.')],
 ['C5 forbidden geography',contentFixture('authored-geography','Music on {dials}: Fixture maker, ON tHiS MaP.')],
 ['new maker',contentFixture('authored-new','Music on {dials}: unnamed musician.')]
]){
 assert.throws(()=>checkFixture(fixture),undefined,label+' JS');
 assert.throws(()=>generate(fixture),undefined,label+' Python');
}
const mixed={credits:{one:{by:'First maker',source:'authored',licence:'Fixture',date:'2026-01-01',text:'Music on {dials}: First maker.'},two:{by:'Second maker',source:'authored',licence:'Fixture',date:'2026-01-01',text:'Other music on {dials}: Second maker.'}},stations:[{dial:'x',name:'Fixture',tracks:[{source:'authored-minor',title:'Minor $&',credit:'two'},...[0,1,2].map(i=>({source:'authored-major-'+i,title:'Major '+i,credit:'one'}))]}]};
assert.equal(musicCreditText(mixed.stations,mixed.credits),'Other music on x (1 of 4): Second maker. Music on x (3 of 4): First maker.','R6 unequal counts: each credit says its share, never a song title');
console.log('PASS all fixed-source per-track rules, independent C2/C5 geography and 3-to-1 R6 fixtures');
// The credit stays short as songs are added (#232 doubled it by naming songs): 600 more songs add only digits, Python agrees.
const crowded=structuredClone(mixed);crowded.stations[0].tracks.push(...Array.from({length:600},(_,i)=>({source:'authored-more-'+i,title:'More '+i,credit:i%2?'one':'two'})));
const crowdedText='Other music on x (301 of 604): Second maker. Music on x (303 of 604): First maker.';
assert.equal(musicCreditText(crowded.stations,crowded.credits),crowdedText,'adding songs changes only the counts');
assert.ok(generate(crowded).includes(JSON.stringify('<p id="titleMusic">'+crowdedText+'</p>')),'Python credit_text matches the JS mirror');
for(const stations of [CATALOGUE.stations,CATALOGUE.stations.map(s=>({...s,tracks:s.tracks.filter(t=>t.public===true)})).filter(s=>s.tracks.length)])checkMusicCreditLength(musicCreditText(stations),stations);
const tooLong=structuredClone(mixed);tooLong.credits.one.text='Music on {dials}: First maker. '+'A very long credit. '.repeat(80);
assert.throws(()=>checkMusicCreditLength(musicCreditText(tooLong.stations,tooLong.credits)),/at most/,'JS length cap');
assert.throws(()=>generate(tooLong),/characters, over/,'Python refuses an over-long credit before writing');
// One station split 1:1 says (1 of 2) twice, in both languages.
const even=structuredClone(mixed);even.stations[0].tracks=even.stations[0].tracks.slice(0,2);
const evenText='Other music on x (1 of 2): Second maker. Music on x (1 of 2): First maker.';
assert.equal(musicCreditText(even.stations,even.credits),evenText,'an exact 50/50 split is (1 of 2) for both');
assert.ok(generate(even).includes(JSON.stringify('<p id="titleMusic">'+evenText+'</p>')),'Python agrees on the 50/50 split');
// Python and JS hold the same cap: exactly MUSIC_CREDIT_MAX characters passes both, one more fails both.
const sized=n=>{const plan={credits:{one:structuredClone(mixed.credits.one)},stations:[{dial:'x',name:'Fixture',tracks:[{source:'authored-sized',title:'Sized',credit:'one'}]}]};
 const base='Music on {dials}: First maker.';plan.credits.one.text=base.replace('.',' '+'z'.repeat(n-base.length+'{dials}'.length-'x'.length-1)+'.');return plan;};
assert.equal(musicCreditText(sized(MUSIC_CREDIT_MAX).stations,sized(MUSIC_CREDIT_MAX).credits).length,MUSIC_CREDIT_MAX,'sized fixture length');
checkMusicCreditLength(musicCreditText(sized(MUSIC_CREDIT_MAX).stations,sized(MUSIC_CREDIT_MAX).credits),[]);generate(sized(MUSIC_CREDIT_MAX));
assert.throws(()=>checkMusicCreditLength(musicCreditText(sized(MUSIC_CREDIT_MAX+1).stations,sized(MUSIC_CREDIT_MAX+1).credits),[]),/at most/,'JS cap at MAX+1');
assert.throws(()=>generate(sized(MUSIC_CREDIT_MAX+1)),/characters, over/,'Python cap at MAX+1');
console.log(`PASS music credit ${MUSIC_CREDIT_TEXT.length}/${MUSIC_CREDIT_MAX} characters, no song titles; 600 more songs add only digits`);
for(const [label,edit,word]of [
 ['top typo',p=>{p.just_strat=p.just_start;},'just_start'],
 ['station typo',p=>{p.stations[0].strat=true;},'start'],
 ['track typo',p=>{p.stations[0].tracks[0].pubilc=true;},'public'],
 ['override typo',p=>{p.stations[0].tracks[0].credit_overides={};},'credit_overrides'],
 ['public type',p=>{p.stations[0].tracks[0].public='yes';},'public'],
 ['page type',p=>{p.stations[0].tracks[0].page=1;},'page'],
 ['start type',p=>{p.stations[0].start='true';},'start'],
 ['duplicate whitespace dial',p=>{p.stations[1].dial=' '+p.stations[0].dial+' ';},'duplicate dial'],
 ['reserved uppercase OFF',p=>{p.stations[0].dial=' OFF ';},'off is reserved']
]){const candidate=structuredClone(CATALOGUE);edit(candidate);assert.throws(()=>checkCatalogueKeys(candidate),e=>e.code==='ERR_ASSERTION'&&e.message.includes(word),label);}
const canonical=structuredClone(CATALOGUE);for(const station of canonical.stations)station.dial=' '+station.dial.toUpperCase()+' ';if(canonical.just_start)canonical.just_start=' '+canonical.just_start.toUpperCase()+' ';assert.deepEqual(checkCatalogueKeys(canonical),CATALOGUE);
console.log('PASS JS key/boolean checks mirror Python; dials trim/lower-case and reject duplicate/OFF values');

const titleSource=readFileSync('web/src/title.ts','utf8'),publicGenerated=generate(publicFixture);
musicCredits(await load(titleSource,publicGenerated,true),publicExpected,publicFixture.credits);
musicCredits(await load(titleSource,publicGenerated,false),publicFixture.stations,publicFixture.credits);
console.log('PASS Node public/private cards: a private station is absent only from __PUBLIC_APP__ credits');

if(process.argv.includes('--mutations')){
 const title=readFileSync('web/src/title.ts','utf8');
 const publicAnchor='? PUBLIC_MUSIC_CREDIT : ALL_MUSIC_CREDIT';assert.ok(title.includes(publicAnchor));
 const publicMutant=await load(title.replace(publicAnchor,'? ALL_MUSIC_CREDIT : ALL_MUSIC_CREDIT'),publicGenerated,true);
 assert.throws(()=>musicCredits(publicMutant,publicExpected,publicFixture.credits),undefined,'M7 public card uses all songs');
 console.log('PASS rejected M7: public card using all songs');
 // Regenerate from an edited catalogue, so a self-consistent but incomplete display template cannot escape.
 for(const [label,match,from,to]of [
  ['missing Suno',/Suno/i,'Suno','a tool'],
  ['missing ElevenLabs',/ElevenLabs/i,'ElevenLabs Music','a tool'],
  ['missing performer',/Ishizaka/i,'played by Kimiko Ishizaka','performed on piano'],
  ['missing CC0',/Ishizaka/i,'CC0','a dedication'],
  ['wrong geography',/ElevenLabs/i,'around Mabou','on this map']
 ]){
  const fixture=structuredClone(CATALOGUE);let changed=0;
  for(const station of fixture.stations)for(const track of station.tracks){
   const credit=effectiveCredit(track,fixture.credits);
   if(match.test(credit.by+' '+credit.source)&&credit.text.includes(from)){
    track.credit_overrides={...track.credit_overrides,text:credit.text.replace(from,to)};changed++;
   }
  }
  if(!changed)continue; // No such music remains in this edited catalogue; fixed policy fixtures below still run.
  assert.throws(()=>checkMusicContent(null,fixture.stations,fixture.credits),undefined,label+' per-track JS policy');
  assert.throws(()=>generate(fixture),undefined,label+' Python pre-write policy');
  console.log('PASS rejected catalogue content mutant: '+label);
 }

 const anchor='${LAND_CREDITS}${FAR_CREDITS}${MUSIC_CREDIT}${ENGINE_CREDIT}';assert.ok(title.includes(anchor));
 const eraMutant=await load(title.replace(anchor,'${LAND_CREDITS}${FAR_CREDITS}${ENGINE_CREDIT}'));
 assert.throws(()=>musicCredits(eraMutant),undefined,'missing era credit');
 console.log('PASS rejected credit mutation: missing era credit');

 const generated=readFileSync('web/src/radio-credits.generated.ts','utf8');
 // Each distinct displayed attribution (including its geography, tools and licence) must survive unchanged.
 const templates=[...new Set(CATALOGUE.stations.flatMap(s=>s.tracks.map(t=>effectiveCredit(t).text)))];
 for(const [i,template]of templates.entries()){
  const text=template.split('{dials}').sort((a,b)=>b.length-a.length)[0].replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const from=JSON.stringify(text).slice(1,-1),to=' Incorrect attribution '+i;
  assert.ok(generated.includes(from),'generated attribution anchor');
  const mutant=await load(title,generated.replaceAll(from,to));
  assert.throws(()=>musicCredits(mutant),undefined,'changed attribution '+i);
  console.log('PASS rejected credit mutation: changed attribution '+i);
 }

}

// Exercise the actual main radio block: a horse must not even request a catalogue.
async function vehicleRadioGate(main){
 const block=expressions(main).radio;
 const compiled=(await transform(block,{loader:'ts',target:'es2022',define:{'import.meta.env.DEV':'false','import.meta.env.BASE_URL':JSON.stringify('./')}})).code;
 for(const kind of ['car','bike','horse']){
  const requests=[];
  const context=vm.createContext({bare:false,params:new URLSearchParams('era=1884'),ERA:{radio:true},ride:{kind},SITE:{brand:'mail'},started:false,radio:null,fired:null,siteRadio:()=>({}),loadRadio:(...a)=>{requests.push(a);return Promise.resolve(null);}});
  vm.runInContext(compiled,context);await Promise.resolve();
  assert.equal(requests.length,kind==='horse'?0:1,'radio load for '+kind);
 }
}
await vehicleRadioGate(source);
if(process.argv.includes('--mutations')){
 const anchor="ERA.radio && ride.kind !== 'horse'";assert.ok(source.includes(anchor));
 await assert.rejects(()=>vehicleRadioGate(source.replace(anchor,'ERA.radio')),/radio load for horse/);
 console.log('PASS rejected horse-radio-load mutation');
}
console.log('PASS car/bike load radio; horse does not request its list');
