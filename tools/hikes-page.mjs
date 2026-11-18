import { writeFileSync } from 'node:fs';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function hikesPage(base, query, width = 1600, height = 1000, init = '') {
  const port = process.env.CDP_PORT ?? '9443';
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {ws.onopen=resolve;ws.onerror=reject;});
  let seq=0; const waiting=new Map(), errors=[];
  ws.onmessage=({data})=>{const d=JSON.parse(data);if(d.id){waiting.get(d.id)?.(d);waiting.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description??d.params.exceptionDetails.text);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{waiting.delete(id);reject(Error('CDP timeout '+method));},45000);waiting.set(id,d=>{clearTimeout(timer);resolve(d);});ws.send(JSON.stringify({id,method,params}));});
  const read=async expression=>{const d=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.result?.exceptionDetails)throw Error(JSON.stringify(d.result.exceptionDetails));return d.result?.result?.value;};
  const settle=async()=>{for(let i=0;i<180;i++){await sleep(500);if(await read('document.title')==='settled')return;}throw Error('Page did not settle '+query+' '+errors.join('\n'));};
  const navigate=async query=>{await send('Page.navigate',{url:base+'/?'+query});await settle();};
  const key=async(code,down=true)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,windowsVirtualKeyCode:code==='Enter'?13:code==='Escape'?27:code==='Tab'?9:code.startsWith('Key')?code.charCodeAt(3):32});
  const tap=async code=>{await key(code);await key(code,false);};
  const shot=async name=>{if(process.env.SHOTS==='1')writeFileSync(`${process.env.OUT}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));};
  const close=async()=>{try{await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`,{signal:AbortSignal.timeout(4000)});}finally{ws.close();}};
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:width<1000});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`try{if(!sessionStorage.hikesCheck){localStorage.clear();sessionStorage.hikesCheck='1';}}catch{}\n${init}`});
  try { await navigate(query); } catch(error) {await close(); throw error;}
  const touch=async selector=>{const r=await read(`(()=>{document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'});const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...r}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(250);};
  return {read,send,settle,navigate,key,tap,shot,close,errors,touch};
}
