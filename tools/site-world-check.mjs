// Exercise the actual main.ts construction calls and actual model builders, with a recording canvas.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {build,transform} from '../web/node_modules/esbuild/lib/main.js';
process.on('uncaughtException',error=>{console.error(error.name+': '+error.message);console.error((error.stack??'').split('\n').filter(line=>line.includes('file:///')).join('\n'));process.exit(1);});
const words=/\b(mail|post|route|shift|carrier|delivery)\b/i;
globalThis.innerHeight=900;globalThis.innerWidth=1280;
let drawn=[];
const gradient={addColorStop(){}};
globalThis.document={getElementById:()=>null,createElement:()=>{const canvas={width:0,height:0,text:[]};const ctx=new Proxy({canvas,fillText(s){canvas.text.push(String(s));drawn.push(String(s));},strokeText(s){canvas.text.push(String(s));drawn.push(String(s));},measureText:s=>({width:String(s).length*9}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,getImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4)}),createImageData:()=>({data:new Uint8ClampedArray(canvas.width*canvas.height*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});canvas.getContext=()=>ctx;return canvas;}};
const mainPath='web/src/main.ts',main=readFileSync(mainPath,'utf8');
function calls(source){const tree=ts.createSourceFile(mainPath,source,ts.ScriptTarget.Latest,true);const found={};function visit(n){if(ts.isNewExpression(n)&&['Edge','MineSite','Ghosts'].includes(n.expression.getText(tree)))found[n.expression.getText(tree)]=n.getText(tree);if(ts.isCallExpression(n)&&n.expression.getText(tree)==='multiplayerSwitch')found.multiplayer=n.getText(tree);if(ts.isCallExpression(n)&&['garageEntry.build','fleetRig'].includes(n.expression.getText(tree)))found.car=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);return found;}
async function models(overrides={}) {
 const entry="export {Edge} from './edge'; export {MineSite} from './mine-site'; export {GARAGE} from './garage'; export {fleetRig} from './fleet-models'; export {Ghosts} from './mp/ghosts'; export * as THREE from 'three';";
 const r=await build({stdin:{contents:entry,resolveDir:process.cwd()+'/web/src',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'source-cases',setup(b){b.onLoad({filter:/web\/src\/(car|mine-site)\.ts$/},args=>{const key=args.path.split('/').pop();return key in overrides?{contents:overrides[key],loader:'ts'}:undefined;});}}]});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
}
async function run(source,model,brand,mailMode=false){
 const expr=calls(source),out={};const roads={deckHeight:()=>null,roads:[{kind:1,name:'Mabou Mines Road',halfWidth:3,pts:[[0,0],[1200,0]]}]};
 const terrain={clear:[],heightAt:()=>0,surfaceAt:()=>({ground:0,level:6})};
 const context={...model,ERA:{modern:true},document,scene:{},LOW:true,bare:false,params:new URLSearchParams(),touchDevice:false,multiplayerSwitch:host=>host,SITE:{brand,area:'mabou'},AREA:{route:true,id:'mabou'},EXAG:1.5,SEA_LEVEL:1,mailMode,roads,terrain,manifest:{mid:[-1000,-1000,1000,1000],village:[0,0]},VE:0,VN:0,EDGE:120,vehicleSpec:{envelope:{nose:3.2}},vehicle:{bounds:[-1000,-1000,1000,1000]},garageEntry:model.GARAGE[0]};
 for(const label of ['Edge','MineSite','car']) {
  drawn=[];const code=(await transform('globalThis.result = '+expr[label],{loader:'ts',target:'es2022'})).code;const c=vm.createContext(context);vm.runInContext(code,c);
  if(label!=='car') c.result.update(new model.THREE.Vector3(900,0,0));
  out[label]=[...drawn];
 }
 // Every garage builder, including the query-only truck and side by side.
 for(const entry of model.GARAGE){drawn=[];entry.build(mailMode,brand==='just');out['garage/'+entry.id]=[...drawn];}
 drawn=[];
 const host=vm.runInContext((await transform(expr.multiplayer,{loader:'ts'})).code,vm.createContext(context));
 if(source===main){assert.equal(host.heightScale,context.EXAG);assert.equal(host.seaLevel,context.SEA_LEVEL);}
 const ghostCall=calls(readFileSync('web/src/mp/index.ts','utf8')).Ghosts;
 // index.ts passes its local sender-height scale (#156); the same rule, from the host the real call built.
 const sea=host.seaLevel??0,height=y=>y>sea?sea+(y-sea)*(host.heightScale??1):y;
 const ghosts=vm.runInContext(ghostCall,vm.createContext({...model,host,height}));
 const camera=new model.THREE.PerspectiveCamera(51,1,.1,100);camera.position.set(0,2,4);camera.lookAt(0,0,-6);camera.updateMatrixWorld();
 ghosts.update(1/60,[{id:7,name:'Double Mail 55',x:0,z:-6,heading:0,vx:0,vz:0,air:0,steer:0,hue:0,alpha:1,flags:0}],camera);
 assert.ok(drawn.length,'multiplayer canvas exercised');out.multiplayer=[...drawn];
 return out;
}
function clean(result){for(const [model,text] of Object.entries(result))for(const line of text)assert.doesNotMatch(line,words,model+': '+line);}
const current=await models();const result=await run(main,current,'just');clean(result);console.log('PASS Just Drive actual main construction and all vehicle canvas text:',JSON.stringify(result));
// Plain mail and explore retain their original canvas text.
const before={};for(const file of ['car.ts','mine-site.ts'])before[file]=execFileSync('git',['show','origin/main:web/src/'+file],{encoding:'utf8'});
const oldModels=await models(before),oldMain=execFileSync('git',['show','origin/main:'+mainPath],{encoding:'utf8'});
for(const mail of [true,false])assert.deepEqual(await run(main,current,'mail',mail),await run(oldMain,oldModels,'mail',mail),'plain world text unchanged, mailMode='+mail);
console.log('PASS mail and mail-host explore canvas text exactly match origin/main');
if(process.argv.includes('--mutations')) {
 const car=readFileSync('web/src/car.ts','utf8'),mine=readFileSync('web/src/mine-site.ts','utf8');
 for(const [label,file,from,to] of [
  ['boundary','main',"SITE.brand === 'just' ? false : AREA.route",'AREA.route'],
  ['mine sign','mine-site.ts',"this.just ? 'KEEP CLEAR' : 'MAIL STILL COMES'","'MAIL STILL COMES'"],
  ['mine small sign','mine-site.ts',"this.just ? 'CLOSED' : 'NIGHT SHIFT'","'NIGHT SHIFT'"],
  ['car call site','main',"fleetRig(garageEntry, mailMode, LOW, params, SITE.brand === 'just', ERA.modern)",'fleetRig(garageEntry, mailMode, LOW, params)'],
  ['mine call site','main',"manifest.village, SITE.brand === 'just')",'manifest.village)'],
  ['cargo','car.ts',"if (!cleanText) ctx.fillText('RURAL ROUTE'","ctx.fillText('RURAL ROUTE'"],
  ['peer label','main',"label: SITE.brand === 'just' ? (_name, id) => `Driver ${id}` : undefined",'label: undefined'],
  ['unused roof atlas','car.ts',"if (!cleanText) ctx.fillText('MABOU MAIL'","ctx.fillText('MABOU MAIL'"],
 ]) {
  const original=file==='main'?main:file==='car.ts'?car:mine;assert.ok(original.includes(from),label+' mutation applies');
  const changed=original.replace(from,to);const actual=await run(file==='main'?changed:main,file==='main'?current:await models({[file]:changed}),'just');
  assert.throws(()=>clean(actual),undefined,label+' source mutation rejected');console.log('PASS rejected source mutation:',label);
 }
}
