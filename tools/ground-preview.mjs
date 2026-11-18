// Read-only rehearsal server. Overlay only the three work-root ground files;
// every height, tree and road remains the real shipped input. No data copies.
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const [work,port='5197']=process.argv.slice(2);
if(!work)throw Error('Give the absolute ground work root');
const root=fileURLToPath(new URL('../web',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:Number(port),strictPort:true},plugins:[{
 name:'ground-rehearsal',configureServer(s){
  s.middlewares.use((req,res,next)=>{
   const path=new URL(req.url,'http://localhost').pathname;
   const m=path.match(/^\/(terrain|areas\/([a-z]+))\/(manifest\.json|cover\.png|cover-ground\.bin)$/);
   if(!m)return next();
   const before=new URL(req.headers.referer??'http://localhost').searchParams.get('groundBefore')==='1';
   if(before)return next();
   const area=m[1]==='terrain'?'mabou':m[2];
   try{
    const bytes=readFileSync(resolve(work,area,m[3]));
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',m[3].endsWith('.json')?'application/json':m[3].endsWith('.png')?'image/png':'application/octet-stream');
    res.end(bytes);
   }catch(error){res.statusCode=500;res.end(String(error));}
  });
 }
}]});
await server.listen();console.log('Ground rehearsal http://127.0.0.1:'+port+'; ?groundBefore=1 reads the shipped cover');
