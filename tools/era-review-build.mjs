import {build} from '../web/node_modules/esbuild/lib/main.js';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {readFileSync} from 'node:fs';import{execFileSync}from'node:child_process';
const root=process.cwd(),ref=process.env.ERA_REVIEW_BASE;
await build({entryPoints:[process.env.ERA_REVIEW_ENTRY??'tools/era-review-check.mjs'],bundle:true,platform:'node',format:'esm',outfile:process.env.ERA_REVIEW_OUT??'/tmp/1884p2-review.mjs',plugins:[{name:'review-source',setup(b){b.onLoad({filter:/tools\/era-deck-check\.mjs$/},a=>{let text=ref?execFileSync('git',['show',ref+':tools/era-deck-check.mjs'],{encoding:'utf8'}):readFileSync(a.path,'utf8');if(process.env.ERA_BRIDGE_GRASS)text=text.replace('const deck=roads.deckHeight(car.x,car.z);',"car.surfaceName='grass';const deck=roads.deckHeight(car.x,car.z);");return{contents:text,loader:'js',resolveDir:root+'/tools'};});b.onLoad({filter:/tools\/era-review-check\.mjs$/},a=>process.env.ERA_OLD_REGRESSION&&ref?{contents:execFileSync('git',['show',ref+':tools/era-review-check.mjs'],{encoding:'utf8'}),loader:'js',resolveDir:root+'/tools'}:null);b.onLoad({filter:/tools\/era-initialization-check\.mjs$/},a=>ref?{contents:execFileSync('git',['show',ref+':tools/era-initialization-check.mjs'],{encoding:'utf8'}),loader:'js',resolveDir:root+'/tools'}:null);b.onLoad({filter:/web\/src\/.*\.ts$/},a=>{
 const rel=a.path.slice(root.length+1);let s=ref?execFileSync('git',['show',ref+':'+rel],{encoding:'utf8'}):readFileSync(a.path,'utf8');
 if(process.env.ERA_INIT_POISON&&rel==='web/src/roads.ts')s='Math.random();\n'+s;
 if(process.env.ERA_HOME_POISON&&rel==='web/src/era.ts'){const t=s.replace(' home:false,','');if(t===s)throw Error('ERA_HOME_POISON anchor missing');s=t;}
 if(process.env.ERA_SKIP_ART_REFIT&&rel==='web/src/eras/history-scene.ts')s=s.replace('model.art.geometry.dispose();model.art.geometry=periodBuilding(s,false,(x,z)=>height(x,z)-base);','if(!model.ready){model.art.geometry.dispose();model.art.geometry=periodBuilding(s,false,(x,z)=>height(x,z)-base);}');
 if(process.env.ERA_SKIP_REFIT&&rel==='web/src/eras/history-scene.ts')s=s.replace('private fit(model:Model):void {','private fit(model:Model):void { if(model.ready)return;');
 if(process.env.ERA_GRID_TIE_POISON&&rel==='web/src/roads.ts')s=s.replace('ri>bestRI||ri===bestRI&&s>=best.seg','true');
 if(process.env.ERA_GRID_ALLOC_POISON&&rel==='web/src/roads.ts')s=s.replace('best=this.eraBridgeHit!;','best={road,dist:0,x:0,z:0,heading:0,seg:0,t:0};');
 if(process.env.ERA_GRID_DUP_POISON&&rel==='web/src/roads.ts')s=s.replace('if(record.seen[s]===this.bridgeQuery)continue;','');
 if(process.env.ERA_STOP_WHEEL&&rel==='web/src/eras/history-scene.ts')s=s.replace(/rotation\.x\s*\+=\s*[^;]+/g,'rotation.x+=0');
 if(/history-scene.ts|history-boards.ts|history-effects.ts|history-life.ts|history-grid.ts|history-contacts.ts|roads.ts|timber-bridge.ts/.test(rel)){
  const ast=ts.createSourceFile(a.path,s,ts.ScriptTarget.Latest,true),patch=[];
  const visit=n=>{if((ts.isMethodDeclaration(n)||ts.isFunctionDeclaration(n))&&n.name&&['update','resolve','deckHeight','eraDeckHeight','deck','periodBridgePlane','query','queryBox','refresh'].includes(n.name.getText(ast))){
   const walk=x=>{if(ts.isNewExpression(x)||ts.isArrayLiteralExpression(x)||ts.isObjectLiteralExpression(x)||ts.isArrowFunction(x)||ts.isFunctionExpression(x)){patch.push([x.getStart(ast),'(globalThis.__eraHotAllocations=(globalThis.__eraHotAllocations||0)+1,']);patch.push([x.end,')']);}ts.forEachChild(x,walk);};if(n.body)walk(n.body);
  }else ts.forEachChild(n,visit);};visit(ast);for(const[at,text]of patch.sort((a,b)=>b[0]-a[0]))s=s.slice(0,at)+text+s.slice(at);
 }
 return{contents:s,loader:'ts',resolveDir:a.path.slice(0,a.path.lastIndexOf('/'))};});}}]});
