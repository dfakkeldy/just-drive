// A multiplayer test driver needs its own browser storage, just like a distinct visitor.
import { cdp, cdpFetch } from './cdp.mjs';
// Headless windows all open at 0,0 with one size, so the front one occludes the rest and the browser marks them
// hidden (no frames; the game goes silent). Each visitor's window gets its own place, like two monitors.
let windows=0;
export async function separateWindow(browser,targetId){
  const {windowId}=(await browser.send('Browser.getWindowForTarget',{targetId})).result;
  await browser.send('Browser.setWindowBounds',{windowId,bounds:{left:2000*++windows,top:0}});
}
export async function multiplayerPage(port) {
  const version=await(await cdpFetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser=await cdp(version.webSocketDebuggerUrl);
  const {browserContextId}= (await browser.send('Target.createBrowserContext')).result;
  const {targetId}= (await browser.send('Target.createTarget',{url:'about:blank',browserContextId})).result;
  await separateWindow(browser,targetId);
  return {
    webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/${targetId}`,
    close:async()=>{try{await browser.send('Target.disposeBrowserContext',{browserContextId});}finally{browser.ws.close();}},
  };
}
