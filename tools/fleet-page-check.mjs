// Keep the dev and public page-state checks in one owned browser job.
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import net from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../',import.meta.url)),script=name=>fileURLToPath(new URL(name,import.meta.url));
const [out]=process.argv.slice(2),rootFile=resolve(out,'public-root');
writeFileSync(rootFile,process.env.PWA_SITE??resolve(out,'../pwa-retry/site'));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const server=spawn(process.execPath,[script('./pwa-server.mjs'),rootFile,String(port)],{cwd:repository,stdio:'ignore'});
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/version.json`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 if(!ready)throw Error('Public test server did not start');
 const child=spawn(process.execPath,[script('./page-state-browser.mjs')],{cwd:repository,env:{...process.env,G3_PUBLIC_ORIGIN:`http://127.0.0.1:${port}`},stdio:'inherit'});
 const pageExit=await new Promise(r=>child.on('exit',(code,signal)=>r(signal?1:code??1)));
 writeFileSync(resolve(out,'page-results.json'),JSON.stringify({pageExit},null,2)+'\n');
 process.exitCode=pageExit;
}finally{if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done}}
