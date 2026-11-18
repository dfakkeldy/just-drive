// Local built-site server. The mutable root file lets the checks switch complete builds without another port.
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream, watch, appendFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import {parseHeaders,headersFor} from './pwa-headers.mjs';
const headerRules=new Map();
const rootFile = process.argv[2], port = Number(process.argv[3] ?? 5230);
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.mp3':'audio/mpeg','.png':'image/png','.glb':'model/gltf-binary'};
const faultFile=process.argv[4], gates=new Set();
function fault() {try{return faultFile?JSON.parse(readFileSync(faultFile,'utf8')):{};}catch{return {};}}
if(faultFile) watch(faultFile,()=>{const f=fault();for(const gate of gates)if(!f.path || f.path!==gate.path){gates.delete(gate);gate.release();}});
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname,f=fault();
  if(process.argv[5])appendFileSync(process.argv[5],JSON.stringify({path,time:Date.now()})+'\n');
  if(f.path===path || f.paths?.includes(path)) {
    if(f.status) {res.writeHead(f.status,{'Cache-Control':'no-store'});res.end('test fault');return;}
    if(f.hang) await new Promise(release=>{const gate={path,release};gates.add(gate);res.on('close',()=>{gates.delete(gate);release();});});
    if(f.delay) await new Promise(r=>setTimeout(r,f.delay));
  }
  if(res.destroyed)return;
  try {
    const root=readFileSync(rootFile,'utf8').trim(), url=new URL(req.url,'http://localhost');
    const name=decodeURIComponent(url.pathname)==='/' ? '/index.html' : decodeURIComponent(url.pathname);
    if(name==='/_headers') throw Error('configuration');
    const file=resolve(root,'.'+name);
    if (!file.startsWith(resolve(root)+'/')) throw Error('path');
    const stat=statSync(file); if(!stat.isFile()) throw Error('file');
    res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');
    res.setHeader('Cache-Control','public, max-age=0, must-revalidate'); res.setHeader('Content-Length',stat.size);
    res.setHeader('Accept-Ranges','bytes');
    const mtime=statSync(root+'/_headers').mtimeMs;let cached=headerRules.get(root);
    if(!cached || cached.mtime!==mtime) {cached={mtime,rules:parseHeaders(readFileSync(root+'/_headers','utf8'))};headerRules.set(root,cached);}
    for(const [name,value] of headersFor(cached.rules,url)) res.setHeader(name,value);
    // No range handling here: all asserted 206s must have been made by the worker.
    if (req.method==='HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch {res.writeHead(404,{'Content-Type':'text/html'});res.end('<p>Missing</p>');}
}).listen(port,'127.0.0.1',()=>console.log(`built site: 127.0.0.1:${port}`));
