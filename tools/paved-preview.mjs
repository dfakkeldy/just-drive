import { readBaseline } from './baseline-source.mjs';
/** Local review server: overlay WORK paved tiles without touching promoted data.
 * node tools/paved-preview.mjs /absolute/data/work/bakes/paved-open [port]
 */
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {createReadStream,existsSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('..',import.meta.url));
const [work,port='54781']=process.argv.slice(2);
if(!work)throw Error('Give the open bake work root');
let mode='after';
const legacy=process.env.PAVED_BEFORE_WORK? (process.env.PAVED_BEFORE_REF ? execFileSync('git',['show',process.env.PAVED_BEFORE_REF],{cwd:repo,encoding:'utf8'}) : readBaseline('paved-shader','web/src/paved-shader.ts')) : null;
const current=readFileSync(resolve(repo,'web/src/paved-shader.ts'),'utf8');
const control=legacy?.replace(/  return mix\(road,[^\n]+;/,'  return road;');
const server=await createServer({root:resolve(repo,'web'),server:{host:'127.0.0.1',port:Number(port),strictPort:true},plugins:[{name:'work-pavement-only',enforce:'pre',configureServer(s){
 s.middlewares.use((req,res,next)=>{
  if(legacy&&(req.url??'').startsWith('/?')){const next=new URL(req.url,'http://localhost').searchParams.get('pavedRevision')??'after';if(next!==mode){mode=next;s.moduleGraph.invalidateAll();}}
  const path=(req.url??'').split('?')[0],match=/^\/(terrain|areas\/(mabou|judique|porthood|westbay|pointtupper|cansocauseway))\/paved\/(index\.json|\d+_\d+\.r8)$/.exec(path);
  if(!match)return next();
  const file=resolve(mode==='before'?process.env.PAVED_BEFORE_WORK:work,match[2]??'mabou','paved',match[3]);
  if(!existsSync(file)){res.statusCode=404;res.end('No open paved tile');return;}
  res.setHeader('Content-Type',file.endsWith('.json')?'application/json':'application/octet-stream');res.setHeader('Cache-Control','no-store');createReadStream(file).pipe(res);
 });
},transform(code,id){
 const file=id.split('?')[0];
 if(legacy&&file.endsWith('/paved-shader.ts')){
  if(mode==='nofinish')return {code:current.replace(/  float pavementFinish=[^;]+;\n  if\(pavementFinish>0.0\)\{[\s\S]*?\n  }/,''),map:null};
  if(mode==='before')return {code:legacy,map:null};
  if(mode.startsWith('control'))return {code:mode==='control-lotflat'?control.replace('  canopy *=','  n=normalize(mix(n,vec3(0.0,1.0,0.0),hardPaved));\n  canopy *='):control,map:null};
 }
 if(mode.startsWith('control')&&file.endsWith('/shaders.ts')){
  if(mode==='control-flat')code=code.replace('vec3 n = normalize(vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.02)), nxz.y));','vec3 n = vec3(0.0,1.0,0.0);');
  if(mode==='control-nopatch')code=code.replace('asphalt = mix(asphalt, vec3(0.030, 0.030, 0.033), step(0.72, vnoise(p * 0.11)) * 0.6);','asphalt = asphalt;');
  if(mode==='control-noholes')code=code.replace(/surface = mix\(surface, mix\(vec3\(0.060,[^\n]+;/,'surface = surface;');
  if(mode==='control-light')code=code.replace('gl_FragColor = vec4(col, 1.0);','gl_FragColor = vec4(light * .25, 1.0); return;');
  if(mode==='control-unlit')code=code.replace('gl_FragColor = vec4(col, 1.0);','gl_FragColor = vec4(albedo, 1.0); return;');
  return {code,map:null};
 }
}}]});
await server.listen();console.log('Open pavement WORK overlay on '+port);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit();});
