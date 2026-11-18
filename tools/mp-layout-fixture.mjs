// Layout-only server stand-in: a long real-format call sign and a full room, without a room server.
// Used only when MP_LAYOUT=1. Normal layout runs still cover Off.
export const mpLayoutScript = `
try { localStorage.setItem('mmm.mp','1');localStorage.removeItem('mmm.mp.room'); } catch {}
const NativeSocket = window.WebSocket;
window.WebSocket = function(url, ...args) {
  if (!String(url).includes('/mp/v1/')) return new NativeSocket(url, ...args);
  const socket = {readyState:1,binaryType:'arraybuffer',send(){},close(){this.readyState=3},onopen:null,onclose:null,onerror:null,onmessage:null};
  setTimeout(()=>socket.onmessage?.({data:JSON.stringify({t:'hello',v:1,id:1,name:'Muddy Culvert 88',hue:0,room:'world',cap:24,
    peers:Array.from({length:23},(_,i)=>({id:i+2,name:'Cedar Lane '+i,hue:i%8}))})}),50);
  return socket;
};`;
