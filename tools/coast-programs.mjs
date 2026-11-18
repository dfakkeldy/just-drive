import {cartProgram} from '../web/src/eras/cart-programs.ts';
// Enumerate the actual ShaderMaterial constructor define objects, including conditional spreads.
// Unknown forms fail closed: a new material form needs an explicit reader, never a guessed flag list.
import assert from 'node:assert/strict';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
export function coastPrograms(read=file=>readFileSync(new URL('../web/src/'+file,import.meta.url),'utf8'),includeStunts=false,includeCoast=false) {
 const rows=new Map();
 const alternatives=node=>{
  if(ts.isParenthesizedExpression(node))return alternatives(node.expression);
  if(ts.isConditionalExpression(node))return [...alternatives(node.whenTrue),...alternatives(node.whenFalse)];
  assert.ok(ts.isObjectLiteralExpression(node),'unsupported material defines: '+node.getText());
  let sets=[[]];
  for(const p of node.properties){
   if(ts.isSpreadAssignment(p))sets=sets.flatMap(a=>alternatives(p.expression).map(b=>[...a,...b]));
   else{assert.ok(ts.isPropertyAssignment(p)&&p.initializer.getText()==='1','unsupported material flag: '+p.getText());sets=sets.map(a=>[...a,p.name.getText()]);}
  }
  return sets;
 };
 for(const file of ['terrain.ts','main.ts','water.ts']){
  const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const visit=node=>{
   if(ts.isNewExpression(node)&&node.expression.getText(ast)==='THREE.ShaderMaterial'){
    const arg=node.arguments?.[0];assert.ok(arg&&ts.isObjectLiteralExpression(arg),'unsupported material constructor');
    const properties=new Map(arg.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(ast),p.initializer]));
    const choices=n=>{if(!n)return [undefined];if(ts.isParenthesizedExpression(n))return choices(n.expression);if(ts.isConditionalExpression(n)&&file==='terrain.ts'&&n.condition.getText(ast)==='this.cartRoads'&&[['CART_TERRAIN_FRAG','TERRAIN_FRAG'],['CART_WATER_MASK_FRAG','WATER_MASK_FRAG']].some(([era,today])=>n.whenTrue.getText(ast)===era&&n.whenFalse.getText(ast)===today))return [...choices(n.whenTrue),...choices(n.whenFalse)];return [n?.getText(ast)];};
    const names=['vertexShader','fragmentShader'].flatMap(k=>choices(properties.get(k)));
    // Constructors outside these three source files cannot create a terrain/sea/mirror program.
    // A constructor here that does not name its two programs by constants would escape the pin: fail closed.
    assert.ok(names.every(n=>n&&/^[A-Z][A-Z0-9_]*$/.test(n)),'Unsupported shader constructor at '+file+':'+(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1)+': name vertexShader and fragmentShader by program constants, so that the shader pin can see them');
    {
     const variants=properties.has('defines')?alternatives(properties.get('defines')):[[]];
     for(const flags of variants){
      const park=flags.includes('STUNT_PARK');
      assert.equal(park,names[1]==='STUNT_TERRAIN_FRAG','park fragment requires its explicit constructor flag');
      if(park)assert.ok(['TERRAIN_VERT','MIRROR_TERRAIN_VERT'].includes(names[0]));
      if((includeCoast||!flags.includes('COAST_SHORE'))&&(!park||includeStunts))for(const name of names){
      const sorted=[...new Set(flags)].sort(),key=name+':'+sorted.join(',');
      const row=rows.get(key)??{name,flags:sorted,constructors:[]};row.constructors.push(file+':'+(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1));rows.set(key,row);
     }}
    }
   }
   ts.forEachChild(node,visit);
  };visit(ast);
 }
 assert.ok(rows.has('TERRAIN_FRAG:SEA_WATER'),'unshadowed desktop sea-capable land constructor');
 assert.ok(rows.has('TERRAIN_FRAG:MIRROR,SITE_GRAVEL'),'fishing mirror constructor');
 assert.ok(rows.has('SEA_QUERY_FRAG:'),'water query constructor');
 assert.ok(rows.has('WATER_MASK_FRAG:'),'shore mask constructor');
 return [...rows.values()];
}
export function program(source,name){
 if(name==='CART_TERRAIN_FRAG')return cartProgram(program(source,'TERRAIN_FRAG'),'terrain');
 if(name==='CART_WATER_MASK_FRAG')return cartProgram(program(source,'WATER_MASK_FRAG'),'mask');
 const m=source.match(new RegExp('(?:const|export const) '+name+' = /\\* glsl \\*/ `([\\s\\S]*?)`;'));
 assert.ok(m,'program '+name);return m[1].replace(/\$\{(\w+)\}/g,(_,n)=>program(source,n));
}
export function preprocess(source,flags){
 const macros=new Set(flags),stack=[];let active=true;const out=[];
 const condition=s=>{s=s.replace(/defined\s*\(?\s*(\w+)\s*\)?/g,(_,x)=>macros.has(x)?'1':'0');assert.match(s,/^[01\s()!&|]+$/);return !!Function('return ('+s+')')()};
 for(const line of source.split('\n')){const m=line.match(/^\s*#\s*(ifdef|ifndef|if|elif|else|endif|define)\b\s*(.*)/);if(!m){if(active)out.push(line);continue}const [,cmd,arg]=m;if(['ifdef','ifndef','if'].includes(cmd)){const yes=cmd==='if'?condition(arg):macros.has(arg)===(cmd==='ifdef');stack.push({parent:active,taken:yes});active&&=yes}else if(cmd==='else'||cmd==='elif'){const s=stack.at(-1),yes=cmd==='else'||condition(arg);active=s.parent&&!s.taken&&yes;s.taken||=yes}else if(cmd==='endif')active=stack.pop().parent;else if(active){macros.add(arg.split(/\s+/)[0]);out.push(line)}}assert.equal(stack.length,0);
 return out.join('\n').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
}
export const normalized=s=>s.replace(/\s+/g,'');
export {reviewedMirrorCrown} from './mirror-crown.mjs';
const exact=s=>s.replace(/\s+/g,' ').trim(); // retain GLSL token boundaries

// One union for both checks. LOW rows are explicit even if constructors stop using them.
export function shaderProgramBaseline(source,variants=coastPrograms()) {
 const rows=new Map();
 for(const {name,flags} of [...variants,...['TERRAIN_VERT','TERRAIN_FRAG','SEA_VERT','SEA_FRAG'].map(name=>({name,flags:['LOW']}))]){
  assert.ok(!flags.includes('COAST_SHORE'),'coast-only programs must not be pinned');
  const sorted=[...new Set(flags)].sort(),key=name+':'+sorted.join(',');
  rows.set(key,{name,flags:sorted,sha256:createHash('sha256').update(exact(preprocess(program(source,name),sorted))).digest('hex')});
 }
 return {version:1,programs:[...rows.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>row)};
}

export function checkShaderBaseline(source,{
 baselineFile=process.env.SHADER_BASELINE_FILE??fileURLToPath(new URL('./baseline/programs.json',import.meta.url)),
 update=false,report=console.log,
}={}) {
 const current=shaderProgramBaseline(source);
 const shown=relative(process.cwd(),baselineFile)||baselineFile;
 const key=row=>row.name+':'+row.flags.join(',');
 const label=k=>k.replace(':',' [')+']';
 const restore='Restore '+shown+' from git. Do not write a new one to make this check pass.';
 const read=()=>{
  let baseline;
  try{baseline=JSON.parse(readFileSync(baselineFile,'utf8'));}
  catch(error){throw Error('Shader baseline '+shown+' missing, unreadable or invalid ('+(error.code??error.name)+'). '+restore);}
  assert.ok(baseline?.version===1&&Array.isArray(baseline.programs),'Invalid shader baseline '+shown+'. '+restore);
  const saved=new Map();
  for(const row of baseline.programs){
   assert.ok(row&&typeof row.name==='string'&&Array.isArray(row.flags)&&row.flags.every(f=>typeof f==='string')&&/^[a-f0-9]{64}$/.test(row.sha256),'Invalid shader baseline row in '+shown+'. '+restore);
   assert.ok(!saved.has(key(row)),'Duplicate shader baseline variant '+key(row)+' in '+shown+'. '+restore);
   saved.set(key(row),row.sha256);
  }
  return saved;
 };
 // Every difference is named, so that nobody re-pins a program they did not look at.
 const differences=saved=>{
  const changed=[],unpinned=[];
  for(const row of current.programs){
   if(!saved.has(key(row)))unpinned.push(label(key(row)));
   else if(saved.get(key(row))!==row.sha256)changed.push(label(key(row)));
   saved.delete(key(row));
  }
  return {changed,unpinned,obsolete:[...saved.keys()].map(label)};
 };
 const describe=({changed,unpinned,obsolete})=>[
  changed.length?changed.length+' changed: '+changed.join('; '):'',
  unpinned.length?unpinned.length+' not pinned yet: '+unpinned.join('; '):'',
  obsolete.length?obsolete.length+' pinned but no longer built: '+obsolete.join('; '):'',
 ].filter(Boolean).join('. ');
 if(update){
  let before=null;
  try{before=differences(read());}catch{/* no usable baseline: every variant is new */}
  mkdirSync(dirname(baselineFile),{recursive:true});
  writeFileSync(baselineFile,JSON.stringify(current,null,2)+'\n');
  const what=before?(describe(before)||'nothing changed'):'no usable baseline before';
  report('UPDATED shader baseline: '+current.programs.length+' non-coast variants in '+shown+' ('+what+'). List these programs in the pull request.');
  return current;
 }
 const found=differences(read());
 if(found.changed.length||found.unpinned.length||found.obsolete.length){
  throw Error('Shader pin mismatch: '+describe(found)+'. Of '+current.programs.length+' pinned programs. If you did not mean to change EACH of them, fix web/src/shaders.ts (or the material constructor); do not update. Only for an intended change: node tools/coast-source-check.mjs --update, commit '+shown+' in the same pull request, and list the changed programs there.');
 }
 report('PASS shader baseline: '+current.programs.length+' non-coast variants match '+shown);
 return current;
}

/** The explicit-baseline check and its mutation control use this same variant matrix. */
export function compareNonCoastPrograms(current,baseline,variants=coastPrograms()) {
 for(const {name,flags} of variants)assert.equal(exact(preprocess(program(current,name),flags)),exact(preprocess(program(baseline,name),flags)),name+' outside coast '+flags);
}
