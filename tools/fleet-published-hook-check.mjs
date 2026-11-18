import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from '../web/node_modules/typescript/lib/typescript.js';

/** Inspect the actual flat artifact, not a separately compiled defects module. */
export function publishedPotholeHook(root){
 const app=readFileSync(root+'/app.js','utf8'),ast=ts.createSourceFile('app.js',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),setters=[],guard='Pothole diagnostics require the dev server';
 const directGuard=node=>{let found=false;const scan=n=>{if(n!==node&&ts.isFunctionLike(n))return;if(ts.isStringLiteral(n)&&n.text===guard)found=true;ts.forEachChild(n,scan)};scan(node);return found;};
 const visit=node=>{if(ts.isFunctionDeclaration(node)&&directGuard(node))setters.push(node.getText(ast));ts.forEachChild(node,visit)};visit(ast);
 const tokens=(app.match(/\bsetDiagnosticPotholes\b/g)??[]).length;
 const guardTokens=app.split(guard).length-1;
 if(tokens||guardTokens){assert.ok(setters.length,'a retained setter must have an inspectable production guard');for(const code of setters){const setter=Function('return ('+code+')')();assert.throws(()=>setter(false),/dev server/,'a retained production setter is dead before changing the control flag');}}
 const proof={appSha256:createHash('sha256').update(app).digest('hex'),setterTokens:tokens,guardStringTokens:guardTokens,setterDeclarations:setters.length,status:tokens||guardTokens?'retained production setter rejects calls':'setter and its unique guard are absent',controlFlagTokens:(app.match(/\bdiagnosticPotholes\b/g)??[]).length};
 console.log('PUBLISHED_POTHOLE_HOOK',JSON.stringify(proof));return proof;
}
if(process.argv[1]===new URL(import.meta.url).pathname)publishedPotholeHook(process.argv[2]);
