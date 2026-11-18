// Address identity stays separate from area, room and current driving state.
import assert from 'node:assert/strict';
import { readSite, areaAddress, eraAddress, SITE_AREAS } from '../web/src/site.ts';
import { readEra } from '../web/src/era.ts';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { justPage } from './site-pages.mjs';
const result = await build({stdin:{contents:"export {roomInvitation} from './mp/switch'; export {periodRides} from './garage'; export {createTitle} from './title'; export {bootTripParams} from './quarry-trip';",resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {roomInvitation,periodRides,createTitle,bootTripParams} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
for (const host of ['justdrive.fakkeldy.ca','justdrive.localhost','localhost']) {
 const q = new URLSearchParams('site=just&era=today&trip=old&driveAt=1,2&start=old&q=low&vehicle=bike&room=abcd&touch=1');
 const site = readSite(host,'/mabou-1884',q);
 assert.deepEqual(site,{brand:'just',area:'mabou',era:'1884'});
 assert.equal(readEra(q,site.area,site.era).id,'1884','short address wins conflicting era query');
 globalThis.location={hostname:host,pathname:'/mabou-1884',search:'?site=just'};
 assert.equal(periodRides(new URLSearchParams(host==='localhost'?'site=just':'')),true,'alias offers the horse without an era query');
 assert.equal(roomInvitation('https://'+host,'/mabou-1884','abcd','mabou',q),'https://'+host+'/mabou?room=abcd'+(host==='localhost'?'&site=just':''));
 assert.equal(eraAddress(site,true,'/mabou',q),'/mabou-1884?site=just&q=low&vehicle=bike&room=abcd&touch=1');
 assert.equal(eraAddress(site,false,'/mabou-1884',q),'/mabou?site=just&q=low&vehicle=bike&room=abcd&touch=1');
 assert.equal(q.get('trip'),'old','input query is private');
 for(const area of SITE_AREAS) assert.ok(areaAddress(site,area,'/mabou-1884',new URLSearchParams('site=just')).startsWith('/'+area+'?'),'switch uses real area');
 for(const path of ['/mabou-1885','/mabou-1884/x','/mabou-1884/x/'])assert.equal(readSite(host,path,q).area,null,path);
}
// A trip on the era door keeps the door's address through boot normalisation (review: it once fell back to /mabou).
for (const host of ['justdrive.fakkeldy.ca','localhost']) {
 const search='?'+(host==='localhost'?'site=just&':'')+'trip=quarry&vehicle=horse';
 globalThis.location={hostname:host,pathname:'/mabou-1884',search,hash:''};
 let replaced=null;globalThis.history={state:null,replaceState:(_s,_t,url)=>{replaced=url;}};
 const booted=bootTripParams();
 const address=replaced??'/mabou-1884'+search;
 assert.ok(address.startsWith('/mabou-1884?'),'trip boot keeps the era door: '+address);
 const after=new URL(address,'https://'+host);
 globalThis.location={hostname:host,pathname:after.pathname,search:after.search,hash:''};
 assert.equal(readSite(host,after.pathname,after.searchParams).era,'1884','reload stays in 1884');
 assert.equal(periodRides(booted),true,'horse still offered after trip boot');
 delete globalThis.history;
}
console.log('PASS trip boot on the era door keeps /mabou-1884 and the horse');
{ // readEra is called by the page and again by each ride check: one warning per distinct message.
 const warn=console.warn,seen=[];console.warn=m=>seen.push(m);
 try{for(let i=0;i<3;i++)assert.equal(readEra(new URLSearchParams('era=1884'),'porthood').id,'today');readEra(new URLSearchParams('era=1999'),'mabou');readEra(new URLSearchParams('era=1999'),'mabou');}finally{console.warn=warn;}
 assert.deepEqual(seen,['Era 1884 is not available in porthood; loading today.','Unknown era "1999"; loading today.']);
 console.log('PASS readEra warns once per distinct message');
}
delete globalThis.location;
assert.deepEqual(readSite('mmm.fakkeldy.ca','/mabou-1884'),{brand:'mail',area:null});
const page=justPage('<html><head></head><body><div id="boot"><div>Loading</div></div></body></html>',{id:'mabou',name:'Mabou'},true);
assert.match(page,/<title>Mabou, 1884<\/title>/);assert.match(page,/property="og:title" content="Mabou, 1884"/);assert.match(page,/property="og:url" content="https:\/\/justdrive.fakkeldy.ca\/mabou-1884"/);
console.log('PASS era alias identity, horse, canonical rooms/area switches, clean reversible addresses, non-era query preservation and metadata');

// Compare the actual site's mail template through both builders, with clock/app/data held fixed.
// This separates template drift from the required new shared JS hash and build identities.
const {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} = await import('node:fs');
const {tmpdir} = await import('node:os');
const {execFileSync} = await import('node:child_process');
const {pathToFileURL} = await import('node:url');
const {createHash} = await import('node:crypto');
const base=execFileSync('git',['merge-base','HEAD','origin/main'],{encoding:'utf8'}).trim();
const oldBuilder=execFileSync('git',['show',base+':tools/build-pwa.mjs'],{encoding:'utf8'});
const oldPages=execFileSync('git',['show',base+':tools/site-pages.mjs'],{encoding:'utf8'});
const absoluteImports=code=>code.replace(/from '(\.\.?\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(process.cwd()+'/tools/'+p).href}'`);
const oldPageModule='data:text/javascript;base64,'+Buffer.from(absoluteImports(oldPages)).toString('base64');
const buildSource=(code,before)=>absoluteImports(code).replaceAll('import.meta.'+'url',JSON.stringify(pathToFileURL(process.cwd()+'/tools/build-pwa.mjs').href)).replace(pathToFileURL(process.cwd()+'/tools/./site-pages.mjs').href,before?oldPageModule:pathToFileURL(process.cwd()+'/tools/site-pages.mjs').href);
const script=readFileSync('tools/build_site.sh','utf8');
const head=script.match(/cat <<'HEAD'\n([\s\S]*?)\nHEAD/)[1]+'\n';
const html=head+readFileSync('artifact/page.html','utf8').split('\n').filter(line=>line!=='<title>Mabou Mail Madness</title>').join('\n').replaceAll(' · A private test build',' · Preview build')+'</body>\n</html>\n';
const dir=mkdtempSync(tmpdir()+'/mmm-era-door-mail-');
try {
 const app=process.env.ERA_DOOR_PUBLIC_APP?readFileSync(process.env.ERA_DOOR_PUBLIC_APP):Buffer.from('globalThis.mailParityFixture=true;');
 const roots=[];
 for(const [label,code]of [['before',oldBuilder],['after',readFileSync('tools/build-pwa.mjs','utf8')]]){
  const folder=dir+'/'+label;mkdirSync(folder+'/terrain',{recursive:true});mkdirSync(folder+'/offline/icons',{recursive:true});
  for(const [name,body]of [['index.html',html],['app.js',app],['terrain/manifest.json','{}'],...['180','192','512','maskable-512'].map(n=>['offline/icons/'+(n.startsWith('maskable')?n:'icon-'+n)+'.png','icon'])])writeFileSync(folder+'/'+name,body);
  const source=`Date.now=()=>1794672000000;process.argv[2]=${JSON.stringify(folder)};\n`+buildSource(code,label==='before');
  try { execFileSync(process.execPath,['--input-type=module','--eval',source],{stdio:'pipe'}); } catch(error) { throw Error(String(error.stderr)); }
  roots.push(readFileSync(folder+'/index.html'));
  assert.equal(JSON.parse(readFileSync(folder+'/manifest.webmanifest')).start_url,'/');
 }
 assert.deepEqual(roots[1],roots[0],'mail page bytes unchanged when build/app/data identities are fixed');
 console.log('PASS MAIL_PAGE_BYTE_PARITY '+JSON.stringify({base,bytes:roots[0].length,sha256:createHash('sha256').update(roots[0]).digest('hex'),actualPublicBundle:!!process.env.ERA_DOOR_PUBLIC_APP}));
} finally {rmSync(dir,{recursive:true,force:true});}

// Pin mail HTML/CSS outside the independently checked cross-brand line and phone width fix.
const {AREAS} = await import('../web/src/area.ts');
const {ERAS} = await import('../web/src/era.ts');
const titleBefore = await build({stdin:{contents:execFileSync('git',['show',base+':web/src/title.ts'],{encoding:'utf8'}),resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const oldTitle = (await import('data:text/javascript;base64,'+Buffer.from(titleBefore.outputFiles[0].text).toString('base64'))).createTitle;
const crossBrandStyles = [
 '#titleOtherGame{display:block;font-size:13px;line-height:1.4;margin-top:8px}\n',
 '#titleOtherGame a{color:inherit;text-underline-offset:3px}\n',
 '#titleOtherGame a:focus-visible{outline:3px solid #fff;outline-offset:3px}\n',
 '/* content-box 100% plus padding overflowed narrow screens on cards without a multiplayer control (1884): */\n@media(max-width:719px){#titleCard{box-sizing:border-box}}\n',
];
function card(make, just, area, era, mode) {
 const roots=[],styles=[];
 const node=()=>({style:{},classList:{add(){}},setAttribute(){},addEventListener(){},focus(){},innerHTML:'',textContent:'',hidden:false});
 globalThis.document={head:{appendChild(n){styles.push(n.textContent);}},body:{appendChild(n){roots.push(n);}},createElement(){const n=node();n.querySelector=()=>node();return n;}};
 globalThis.localStorage={getItem:()=>null};
 globalThis.location={hostname:just?'justdrive.fakkeldy.ca':'mmm.fakkeldy.ca',pathname:'/'+area.id,search:era.id==='today'?'':'?era=1884'};
 make(true,()=>{},mode,area.name,undefined,just,true,era);
 // The About line holds credits and links (help, coffee); it changes for its own reasons, not the era door's.
 let html = roots[0].innerHTML.replace(/<p id="titleAbout">[\s\S]*?<\/p>/,'<p id="titleAbout"></p>');
 if (!just) {
  const line = html.match(/<span id="titleOtherGame">[\s\S]*?<\/span>/)?.[0];
  if (make === createTitle) {
   const historical = ['mabou', 'judique'].includes(area.id);
   const path = era.id === 'today' ? area.id : historical ? `${area.id}-1884` : '';
   assert.equal(line, `<span id="titleOtherGame">Just want to drive? <a href="https://justdrive.fakkeldy.ca/${path}">Just Drive has every area, no mail.</a></span>`);
   for (const css of crossBrandStyles) assert.ok(styles[0].includes(css), 'reviewed title CSS: '+css);
  }
  if (line) html = html.replace(line, '');
  // Remove only these exact approved rules. Other CSS changes still fail the frozen comparison.
  for (let i = 0; i < styles.length; i++) for (const css of crossBrandStyles) styles[i] = styles[i].replace(css, '');
 }
 return {html,styles};
}
for(const area of AREAS)for(const era of ERAS)for(const mode of ['mail','explore']){
 const just=card(createTitle,true,area,era,mode);
 assert.equal(just.html.includes('id="titleEra"'),['mabou','judique'].includes(area.id),area.id+' '+era.id+' '+mode);
 assert.deepEqual(card(createTitle,false,area,era,mode),card(oldTitle,false,area,era,mode),'mail card HTML/styles outside reviewed cross-brand changes: '+area.id+' '+era.id+' '+mode);
}
for(const k of ['document','localStorage','location'])delete globalThis[k];
console.log('PASS every area/era/mode visibility; exact cross-brand line and phone CSS; all other mail HTML/styles match branch base');
