import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from '../web/node_modules/typescript/lib/typescript.js';

/** Inspect the actual published build (app.js and every chunk: web/area-chunks-build.ts), not a separately compiled defects module. */
export function publishedPotholeHook(root){
 const chunks=existsSync(root+'/chunks')?readdirSync(root+'/chunks').filter(name=>name.endsWith('.js')).sort().map(name=>'chunks/'+name):[];
 const guard='Pothole diagnostics require the dev server',setters=[];let tokens=0,guardTokens=0,controlFlagTokens=0;
 for(const name of ['app.js',...chunks]){
  const app=readFileSync(root+'/'+name,'utf8'),ast=ts.createSourceFile(name,app,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const directGuard=node=>{let found=false;const scan=n=>{if(n!==node&&ts.isFunctionLike(n))return;if(ts.isStringLiteral(n)&&n.text===guard)found=true;ts.forEachChild(n,scan)};scan(node);return found;};
  const visit=node=>{if(ts.isFunctionDeclaration(node)&&directGuard(node))setters.push(node.getText(ast));ts.forEachChild(node,visit)};visit(ast);
  tokens+=(app.match(/\bsetDiagnosticPotholes\b/g)??[]).length;
  guardTokens+=app.split(guard).length-1;
  controlFlagTokens+=(app.match(/\bdiagnosticPotholes\b/g)??[]).length;
 }
 if(tokens||guardTokens){assert.ok(setters.length,'a retained setter must have an inspectable production guard');for(const code of setters){const setter=Function('return ('+code+')')();assert.throws(()=>setter(false),/dev server/,'a retained production setter is dead before changing the control flag');}}
 const proof={appSha256:createHash('sha256').update(readFileSync(root+'/app.js')).digest('hex'),chunks,setterTokens:tokens,guardStringTokens:guardTokens,setterDeclarations:setters.length,status:tokens||guardTokens?'retained production setter rejects calls':'setter and its unique guard are absent',controlFlagTokens};
 console.log('PUBLISHED_POTHOLE_HOOK',JSON.stringify(proof));return proof;
}
if(process.argv[1]===new URL(import.meta.url).pathname)publishedPotholeHook(process.argv[2]);
