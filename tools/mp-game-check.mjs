#!/usr/bin/env node
import { multiplayerPage } from './mp-browser-page.mjs';
import { cdp, exitCheck } from './cdp.mjs';
// Player-facing multiplayer against local wrangler only. Judge by the exit code.
import { writeFileSync } from 'node:fs';
const [out, first] = process.argv.slice(2), base = new URL(first).origin;
const PORT = process.env.CDP_PORT ?? '9466', SERVER = process.env.MP_SERVER ?? 'ws://127.0.0.1:5267';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fails = [], pages = [];
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fails.push(name); };
const title = '[data-mp="title"]', settings = '[data-mp="settings"]';
const forbidden = '/src/mp/(index|net|ghosts|horn)\\.ts';
async function open(url, clean = false) {
  const tab=await multiplayerPage(PORT);
  const errors = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  } });
  const read = async expression => {
    await send('Page.bringToFront');
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  const until = async (expr, ms = 45000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await read(expr)) return true; await sleep(150); }
    return false;
  };
  const resize = async (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const click = async selector => read(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const navigate = async address => { await send('Page.navigate', { url: address }); check(await until('!!window.mmm && document.title.startsWith("settled")', 240000), `settled ${new URL(address).search}`); };
  await send('Runtime.enable'); await send('Page.enable'); await resize(1280, 720);
  if (clean) await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!sessionStorage.getItem('mpSwitchClean')) { localStorage.clear(); sessionStorage.setItem('mpSwitchClean','1'); }` });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__sockets=[];const Original=WebSocket;window.WebSocket=class extends Original { constructor(...args){super(...args);if(String(args[0]).includes('/mp/v1/')) window.__sockets.push(this);} };` });
  const p = { read, send, until, click, shot, resize, navigate, errors, close: async () => { await tab.close(); ws.close(); } };
  pages.push(p); await navigate(url); return p;
}
const toggle = `${settings} .mpToggle`;
async function joined(p) { check(await p.until('mmm.mp.current?.net.status === "on"'), 'connection joins'); }
async function bots(p, phone = false) {
  await p.read(`(() => {
    const mp = mmm.mp.current, v = mmm.vehicle, fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    window.__bots = ${phone ? '[9,15]' : '[36,64]'}.map((ahead, i) => {
      const ws = new WebSocket(mp.net.options.urls[0]);
      ws.onopen = () => ws.send(mp.encode({ flags: 8, steer: 0, heading: v.heading + (i ? -.25 : .25), t: 1,
        x: v.x + fx * ahead + rx * (i ? -3.4 : 3.4), z: v.z + fz * ahead + rz * (i ? -3.4 : 3.4), vx: 0, vz: 0, air: 0 }));
      return ws;
    });
  })()`);
  const drawn = await p.until('mmm.mp.current.net.count === 2 && mmm.mp.current.ghosts.drawn === 2');
  const state = await p.read(`({count:mmm.mp.current.net.count,drawn:mmm.mp.current.ghosts.drawn,states:__bots.map(b=>b.readyState),views:mmm.mp.current.net.views(performance.now()).map(v=>({x:v.x,z:v.z,alpha:v.alpha})),car:{x:mmm.vehicle.x,z:mmm.vehicle.z}})`);
  check(drawn, `two near cars are known and drawn ${JSON.stringify(state)}`);
}
try {
  const p = await open(`${base}/`, true);
  const off = await p.read(`({off:document.querySelector('${title} .mpToggle')?.getAttribute('aria-checked'), title:!document.getElementById('title').hidden,
    current:!!mmm.mp.current, sockets:__sockets.length, loaded:performance.getEntriesByType('resource').filter(r=>new RegExp(${JSON.stringify(forbidden)}).test(r.name)).length})`);
  check(off.off === 'false' && off.title && !off.current && off.sockets === 0 && off.loaded === 0, `plain visit Off; no connection or implementation modules ${JSON.stringify(off)}`);
  await p.resize(390,844); await p.navigate(`${base}/?touch=1&mp=0`);
  const height = await p.read(`(() => {
    const card=document.getElementById('titleCard'), group=document.querySelector('${title}'), next=group.nextSibling;
    const withMultiplayer=card.getBoundingClientRect().height;
    group.remove(); const main=card.getBoundingClientRect().height; card.insertBefore(group,next);
    const dl=card.querySelector('dl');
    return {withMultiplayer,main,added:withMultiplayer-main,controlsOpen:getComputedStyle(dl).display!=='none' && !dl.closest('details:not([open])'),
      compact:document.querySelector('${title} .mpRooms').hidden && document.querySelector('${title} .mpInvite').hidden};
  })()`);
  writeFileSync(`${out}/switch-title-height.json`,JSON.stringify(height,null,2));
  check(height.controlsOpen && height.compact && height.added < 150, `phone Off card keeps main instructions open and adds only the short block: ${JSON.stringify(height)}`);
  await p.resize(1280,720);
  // A dev server override is only for this local rehearsal. The title must still be shown.
  await p.navigate(`${base}/?title=1&mpserver=${encodeURIComponent(SERVER)}`);
  await p.click(`${title} .mpToggle`);
  await p.click(`${title} .mpPrivate`); await p.click(`${title} .mpNew`);
  check(await p.read(`document.querySelector('${title} .mpInvite').hidden`), 'a code made by this player has no invitation line');
  await p.click(`${title} .mpOpen`);
  await sleep(300);
  check(await p.read('mmm.mp.current === null && __sockets.length === 0'), 'On on the title remains pending until Start');
  await p.click('#titleStart'); await joined(p);
  check(await p.read('mmm.mp.current.net.room') === 'mabou/world' && (await p.read('mmm.mp.current.net.options.urls[0]')).endsWith('/mabou/world'), 'open road is mabou/world');
  check(await p.until(`document.querySelector('${settings} .mpStatus').textContent.includes(mmm.mp.current.net.me.name)`), 'settings show the server call sign');
  // Freeze just the pose for a deterministic byte comparison of the existing map canvas.
  await p.read('mmm.vehicle.place(mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading)');
  await sleep(650);
  const mapBefore = await p.read('document.getElementById("miniMapCanvas").toDataURL()');
  await bots(p); await sleep(600);
  check(await p.read('document.getElementById("miniMapCanvas").toDataURL()') !== mapBefore, 'two cars change the mini map');
  await p.shot('switch-driving-desktop');
  await p.read('window.__oldMp=mmm.mp.current;window.__oldSocket=__sockets[0]');
  await p.read(`document.getElementById('settings').classList.add('open');document.querySelector('${toggle}').focus()`);
  for (const type of ['keyDown','keyUp']) await p.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
  await sleep(650);
  check(await p.read('!mmm.mp.current && __oldSocket.readyState === 3 && !__oldMp.ghosts.group.parent && __oldMp.ghosts.drawn === 0 && !document.getElementById("mpChip")'), 'Off closes socket, removes ghosts and chip');
  check(await p.read('document.getElementById("miniMapCanvas").toDataURL()') === mapBefore, 'Off map is byte-equal to the view before other cars');
  await p.read('__bots.forEach(b=>b.close())');
  await p.read(`document.querySelector('${toggle}').focus()`);
  for (const type of ['keyDown','keyUp']) await p.send('Input.dispatchKeyEvent',{type,key:' ',code:'Space',windowsVirtualKeyCode:32,...(type==='keyDown'?{text:' '}:{})});
  await joined(p);
  check(await p.read(`document.querySelector('${toggle}').matches(':focus-visible') && !document.getElementById('shiftReport').hidden === false`), 'keyboard Space and Enter work on the switch with visible focus, without ending the shift');
  check(await p.read('mmm.mp.current !== __oldMp && document.querySelectorAll("#mpChip").length === 1'), 'On again creates one fresh connection and chip');

  await p.click(`${settings} .mpPrivate`); await joined(p);
  const oldCode = await p.read(`document.querySelector('${settings} output').textContent`);
  await p.click(`${settings} .mpNew`); await joined(p);
  const code = await p.read(`document.querySelector('${settings} output').textContent`);
  check(/^[A-HJKMNPQRSTUVWXYZ]{4}$/.test(code) && code !== oldCode, `New code shows four safe letters: ${code}`);
  for (const bad of ['AB1D', 'ABCDE']) {
    await p.read(`(() => {const i=document.querySelector('${settings} .mpJoin input'); i.value=${JSON.stringify(bad)};i.dispatchEvent(new Event('input'));})()`);
    check(await p.read(`document.querySelector('${settings} .mpUse').disabled && !document.querySelector('${settings} .mpError').hidden`) && await p.read('mmm.mp.current.net.room') === `mabou/${code.toLowerCase()}`, `refused typed ${bad}`);
  }
  // Actual keyboard input into the field must not drive, reset, honk, or end the shift.
  await p.read(`document.getElementById('settings').classList.add('open');document.querySelector('${settings} .mpJoin input').value='';document.querySelector('${settings} .mpJoin input').focus();window.__pose={x:mmm.vehicle.x,z:mmm.vehicle.z};`);
  for (const [key, keyCode] of [['w',87],['a',65],['h',72],['r',82]]) {
    await p.send('Input.dispatchKeyEvent', {type:'keyDown', key, code:`Key${key.toUpperCase()}`, windowsVirtualKeyCode:keyCode, text:key});
    await sleep(100);
    await p.send('Input.dispatchKeyEvent', {type:'keyUp', key, code:`Key${key.toUpperCase()}`, windowsVirtualKeyCode:keyCode});
  }
  check(await p.read(`Math.hypot(mmm.vehicle.x-__pose.x,mmm.vehicle.z-__pose.z)<.01 && !document.getElementById('shiftReport').hidden === false`), 'letters in the room field do not drive or end the shift');
  // Intercept only clipboard delivery, so the exact copied link can open the second page.
  await p.read(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}})`);
  await p.click(`${settings} .mpCopy`);
  const invitation = await p.read('window.__copied');
  check(invitation === `${base}/?room=${code.toLowerCase()}`, 'copy invitation uses only origin, path, and code');
  const q = await open(`${invitation}&mpserver=${encodeURIComponent(SERVER)}`);
  check(await q.read(`document.querySelector('${title} .mpToggle').getAttribute('aria-checked') === 'true' && document.querySelector('${title} .mpInvite').textContent === 'You are invited to private room ${code}' && mmm.mp.current === null && __sockets.length === 0`), 'invitation is On-pending with its room line and no socket');
  await q.shot('switch-title-desktop');
  await q.resize(390,844); await q.navigate(`${invitation}&touch=1&mpserver=${encodeURIComponent(SERVER)}`);
  await q.read(`document.querySelector('${title}').scrollIntoView({block:'center'})`);
  await q.shot('switch-title-phone');
  await q.click('#titleStart'); await joined(q);
  check(await q.read('mmm.mp.current.net.room') === `mabou/${code.toLowerCase()}`, 'invited tab joins the private room');
  check(await p.until('mmm.mp.current.net.count === 1'), 'first tab sees invited driver');
  check(await q.until('mmm.mp.current.net.count === 1'), 'invited driver sees first tab');
  await q.close(); pages.splice(pages.indexOf(q),1);

  // Clipboard denial reveals a selected, read-only link.
  await p.read(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}})`);
  await p.click(`${settings} .mpCopy`);
  check(await p.read(`(() => {const i=document.querySelector('${settings} .mpLink');return !i.hidden && i.readOnly && i.selectionEnd-i.selectionStart===i.value.length && i.value===${JSON.stringify(invitation)}})()`), 'clipboard fallback selects the complete invitation');
  // A valid mixed-case typed code changes rooms in lower case.
  await p.read(`(() => {const i=document.querySelector('${settings} .mpJoin input');i.value='aBcD';i.dispatchEvent(new Event('input'));})()`);
  check(await p.read(`document.querySelector('${settings} .mpJoin input').value`) === 'ABCD', 'typed room display is upper case');
  await p.click(`${settings} .mpUse`); await joined(p);
  check(await p.read('mmm.mp.current.net.room') === 'mabou/abcd', 'typed room uses lower case on the wire');
  check(await p.read(`document.querySelector('${title} .mpInvite').hidden`), 'a typed code has no invitation line');
  await p.navigate(`${base}/?title=1&mpserver=${encodeURIComponent(SERVER)}`);
  check(await p.read(`document.querySelector('${title} .mpToggle').getAttribute('aria-checked')==='true' && document.querySelector('${title} output').textContent==='ABCD' && !mmm.mp.current`), 'saved On and room survive a reload, with pending consent');
  await p.navigate(`${base}/?mp=0`);
  check(await p.read(`document.querySelector('${title} .mpToggle').getAttribute('aria-checked')==='false' && !mmm.mp.current && __sockets.length===0 && performance.getEntriesByType('resource').filter(r=>new RegExp(${JSON.stringify(forbidden)}).test(r.name)).length===0`), '?mp=0 overrules saved On and loads no implementation');

  // A fresh driving placement for horn and phone pictures.
  await p.navigate(`${base}/?road=Mabou%20Harbour%20Road&f=.4&mp=1&mpserver=${encodeURIComponent(SERVER)}&hud=1`); await joined(p);
  await p.read('mmm.vehicle.place(mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading)');
  await p.click(`${settings} .mpOpen`); await joined(p); await bots(p);
  await p.send('Input.dispatchKeyEvent', { type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9 });
  await p.send('Input.dispatchKeyEvent', { type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9 });
  const honks = await p.read('mmm.mp.current.horns.count');
  const report = async (flags, distance, stamp) => p.read(`__bots[0].send(mmm.mp.current.encode({flags:${flags},steer:0,heading:0,t:${stamp},x:mmm.vehicle.x+${distance},z:mmm.vehicle.z,vx:0,vz:0,air:0}))`);
  await report(12,40,1000); await sleep(750);
  check(await p.read('mmm.mp.current.horns.count') === honks+1, 'near horn rising edge calls horn once');
  await sleep(700); check(await p.read('mmm.mp.current.horns.count') === honks+1, 'held horn flag does not repeat');
  await report(8,40,2000); await sleep(650); await report(12,400,3000); await sleep(850);
  check(await p.read('mmm.mp.current.horns.count') === honks+1, 'horn at 400 metres does not sound');
  await report(8,11,4000); await sleep(500);
  // Local H and phone HORN carry the flag on the next report.
  await p.read(`document.activeElement?.blur();window.__sentHorn=0;const n=mmm.mp.current.net,send=n.ws.send.bind(n.ws);n.ws.send=data=>{if(data instanceof ArrayBuffer && (new DataView(data).getUint8(2)&4)) __sentHorn++;send(data)}`);
  for (const type of ['keyDown','keyUp']) await p.send('Input.dispatchKeyEvent', {type,key:'h',code:'KeyH',windowsVirtualKeyCode:72});
  check(await p.until('__sentHorn === 1'), 'H sends this player horn flag');

  await p.read('__bots.forEach(b=>b.close())');
  check(await p.until('mmm.mp.current.net.count === 0'), 'script cars finish leaving before the next view');
  // Navigate directly while On: pagehide disposes this car, and the next hello must not list its old seat.
  await p.navigate(`${base}/?road=Mabou%20Harbour%20Road&f=.4&mp=1&touch=1&mpserver=${encodeURIComponent(SERVER)}&hud=1`); await p.resize(844,390); await joined(p);
  await p.read('mmm.vehicle.place(mmm.vehicle.x,mmm.vehicle.z,mmm.vehicle.heading)'); await bots(p, true);
  check(await p.read('!document.getElementById("mpChip")'), 'touch has no floating chip');
  const labelPixels=await p.read(`(() => {
    const mesh=mmm.mp.current.ghosts.labels, camera=mmm.camera, sizes=[];
    for(let i=0;i<mesh.count;i++) {
      const matrix=mesh.matrixWorld.clone();mesh.getMatrixAt(i,matrix);
      const a=mesh.position.clone().set(0,-.5,0).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld).project(camera);
      const b=mesh.position.clone().set(0,.5,0).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld).project(camera);
      sizes.push(Math.abs(a.y-b.y)*innerHeight/2*32/64);
    }
    return sizes;
  })()`);
  check(labelPixels.length===2 && labelPixels.every(px=>px>=11.9&&px<=12.1), `phone call-sign font is the 12 CSS px floor: ${JSON.stringify(labelPixels)}`);
  await p.shot('switch-driving-phone');
  await p.read(`window.__phoneHorn=0;const n=mmm.mp.current.net,send=n.ws.send.bind(n.ws);n.ws.send=data=>{if(data instanceof ArrayBuffer && (new DataView(data).getUint8(2)&4)) __phoneHorn++;send(data)}`);
  await p.click('#tcHorn'); check(await p.until('__phoneHorn === 1'), 'phone HORN sends the horn flag');
  await p.click('#gear');
  await p.read(`document.querySelector('${settings}').scrollIntoView({block:'start'})`);
  await p.shot('switch-settings-phone');
  check(await p.read(`document.querySelector('${settings} .mpStatus').textContent.includes(mmm.mp.current.net.me.name)`), 'phone settings contain the call sign');
  for (const page of pages) check(page.errors.length === 0, `no page exceptions ${page.errors.join(' | ')}`);
} finally { for (const page of pages) await page.close(); }
console.log(fails.length ? `FAILED: ${fails.length}` : 'multiplayer switch game check: passed');
exitCheck(fails.length ? 1 : 0);
