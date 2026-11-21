import {rasterCuts} from './road-cut-raster';
const scope=globalThis as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer:Transferable[])=>void};
const buffer=()=>{const data=new Float32Array(64*64*4*64);
  // Commit the pages here too: a zero-filled allocation can otherwise leave its
  // first physical writes (and page faults) to the main-thread upload pump.
  data.fill(1);data.fill(0);scope.postMessage({buffer:data},[data.buffer]);};
buffer();
scope.onmessage=({data})=>{
  if(data.buffer){buffer();return;}
  const began=performance.now(),steps=rasterCuts(data.triangles,...data.bounds as [number,number,number,number]);let next=steps.next();while(!next.done)next=steps.next();
  scope.postMessage({id:data.id,raster:next.value,ms:performance.now()-began},next.value?[next.value.data.buffer]:[]);
};
