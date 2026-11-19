// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// Today's board on the end card, desktop and phone, against a stand-in board server in this process (the door's judge
// and the board's book from web/src/board-rules.ts, no Cloudflare): "Post my result" waits for the tap; with the server
// away (an error page, desktop) and offline (phone), the button says to try later and the share card is as before; posted, the board shows with the
// player's row marked, a tab for the area and for yesterday, and the share line and picture gain the rank; a practice
// card offers no second post. Mail play, plain Get Fired and Just Drive have no board.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;

// The rules, bundled from the game's own source.
const { outputFiles } = await build({ stdin: { contents: "export * from './board-rules'; export { atlanticDate, dailyPlan, dayBefore, drawCard, supplyFor } from './daily-rules';",
  resolveDir: new URL('../web/src', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const R = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

// The stand-in server: the same judge and book as the Worker; a mode to be away.
const fake = { mode: 'up', requests: [], books: new Map(), seen: new Map() };
const bookFor = key => { if (!fake.books.has(key)) { fake.books.set(key, new R.BoardBook([], 0)); fake.seen.set(key, new Map()); } return fake.books.get(key); };
const server = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let text = '';
  req.on('data', d => { text += d; });
  req.on('end', () => {
    fake.requests.push({ method: req.method, url: req.url, body: text });
    // Away as Cloudflare says it when a Worker is over its daily allowance: an error page, no JSON.
    if (fake.mode === 'down') { res.writeHead(503, { ...cors, 'Content-Type': 'text/html' }); res.end('<h1>error code: 1027</h1>'); return; }
    const m = R.BOARD_PATH.exec(req.url), json = (v, status = 200) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (!m) return json({ error: 'shape' }, 404);
    const key = `${m[2]}/${m[3]}`, book = bookFor(key);
    if (req.method === 'GET') return json(book.view(m[2], m[3]));
    let body = null; try { body = JSON.parse(text); } catch { /* refused below */ }
    const v = R.judgePost(body, m[2], m[3], Date.now());
    if (!v.ok) return json({ error: v.error, text: R.REFUSALS[v.error].text }, R.REFUSALS[v.error].status);
    const row = { ...v.row, id: book.posts + 1 }, placed = book.add(row, fake.seen.get(key).get(row.device) ?? null);
    if ('error' in placed) return json({ error: placed.error, text: R.REFUSALS[placed.error].text, ...placed.gone ? { gone: true } : {} }, R.REFUSALS[placed.error].status);
    if (!placed.again) fake.seen.get(key).set(row.device, row.id);
    json({ id: placed.id, rank: placed.rank, posts: book.posts, board: book.view(m[2], m[3]) });
  });
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const boardServer = `http://127.0.0.1:${server.address().port}`;
// Other players today, and yesterday's board.
const today = R.atlanticDate(new Date()), yesterday = R.dayBefore(today), ALL = { boxes: true, lawns: true, relief: true, painter: true, fish: true };
const KINDS = ['box:rock', 'box:lean', 'box:dent', 'box:down', 'lawnMail', 'ditchMail', 'lawnDamage', 'rut', 'boxDown', 'flag', 'relief', 'stuffed'];
const NAMES = ['Frost Heave', 'Cold Coffee', 'Loose Gravel', 'Sleepy Cat', 'Fog Bank', 'Spare Tire', 'Dust Cloud', 'Soft Shoulder', 'Pothole', 'Rail Trail', 'Late Flyer', 'Guard Rail'];
function seed(date, n, start) {
  const plan = R.dailyPlan(date, 'mabou'), squares = R.drawCard(plan.seed, R.supplyFor(plan, ALL)), book = bookFor(`mabou/${date}`);
  for (let i = 0; i < n; i++) {
    const events = Array.from({ length: 6 + (i * 29 + start) % 120 }, (_, k) => [KINDS[(k * 7 + i) % KINDS.length], 1 + k * (1 + i % 3)]);
    const r = R.replay(squares, events), id = book.posts + 1;
    book.add({ id, handle: NAMES[(i + start) % NAMES.length], points: r.total, step: r.step, time: r.firedAt ?? 300, squares: r.filled, vehicle: plan.vehicle, device: R.newDevice(randomBytes(16)) }, null);
  }
}
seed(today, 14, 0); seed(yesterday, 5, 3);

const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 300000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const waitFor = async (expression, what, tries = 80) => { for (let i = 0; i < tries; i++) { if (await read(expression).catch(() => false)) return; await sleep(250); } throw Error(`timed out: ${what}`); };
const waitReady = async () => {
  await waitFor("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift", 'the game settles', 360);
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
};
async function page(phone, query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
  const url = new URL(`/?x=1&title=1&hud=1&radio=0&res=1&${phone ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  await waitReady();
}
const box = sel => read(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return {shown:s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[hidden]')&&r.width>0&&r.height>0,inside:r.left>=-.5&&r.right<=innerWidth+.5,
  text:e.textContent,height:r.height,width:r.width,x:r.left+r.width/2,y:r.top+r.height/2};})()`);
/** A finger on the phone, a mouse on the desktop: a real input event at the element's centre. */
async function tap(sel, phone) {
  await read(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(150);
  const b = await box(sel);
  assert.ok(b?.shown, `${sel} is there to tap: ${JSON.stringify(b)}`);
  if (phone) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
  }
  await sleep(200);
}
/** Today's run to its end card: a few real offences on the road where it starts, then END SHIFT. */
async function endRun() {
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(600);
  await read(`(()=>{const s=mmm.shift,v=mmm.vehicle,k=${JSON.stringify(KINDS.slice(0, 8))};k.forEach((kind,i)=>{s.elapsed=(4+i*3)*20;s.reportScore(kind,v.x,v.z,8);});})()`);
  await sleep(300);
  await read("document.getElementById('endShift').click()");
  await waitFor("!document.getElementById('endingFrame').hidden && !!document.getElementById('dailyBoard')", 'the end card with its board block');
}
const posts = () => fake.requests.filter(r => r.method === 'POST').length;
const state = () => read(`({status:document.getElementById('boardStatus').textContent,post:document.getElementById('boardPost').textContent,
  postHidden:!!document.getElementById('boardPost').closest('[hidden]')||document.getElementById('boardPost').hidden,view:!document.getElementById('boardView').hidden,
  rows:[...document.querySelectorAll('#boardRows li')].map(li=>({you:li.classList.contains('you'),text:li.textContent})),text:mmm.daily.text,
  img:document.querySelector('#dailyShare img').src.length,alt:document.querySelector('#dailyShare img').alt,
  groups:[...document.querySelectorAll('#boardTabs [role=group]')].map(g=>g.getAttribute('aria-label')+':'+g.querySelectorAll('button').length),
  tabs:[...document.querySelectorAll('#boardTabs button')].map(b=>b.textContent+':'+b.getAttribute('aria-pressed'))})`);

try {
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable');
  for (const phone of [false, true]) {
    const name = phone ? 'phone' : 'desktop';
    await page(phone, `daily=1&boardserver=${encodeURIComponent(boardServer)}`);
    await read("['mmm.daily.v1','mmm.board.v1','mmm.fired.best.v1'].forEach(k=>localStorage.removeItem(k))");
    await page(phone, `daily=1&boardserver=${encodeURIComponent(boardServer)}`);
    await endRun();
    const before = posts();
    // The end card: the board block under the share picture; the button waits for the tap.
    const button = await box('#boardPost'), field = await box('#boardName');
    assert.equal(button.text, 'Post my result'); assert.ok(button.height >= 44 && field.height >= 44, `touch-sized: ${JSON.stringify({ button, field })}`);
    assert.ok(button.inside && field.inside, 'fits across');
    assert.equal(posts(), before, 'never automatic: nothing posted before the tap');
    assert.ok(await read("document.getElementById('boardName').value.length >= 3"), 'a name is ready (an invented call sign)');
    const shareBefore = await read('mmm.daily.text');
    await read("document.getElementById('dailyBoard').scrollIntoView({block:'center'})"); await sleep(200);
    await shot(`board-${name}-end`);
    if (!phone) {
      // Away: the server does not answer. The run and its share card are as before; the button says to try later.
      fake.mode = 'down';
      await tap('#boardPost', phone);
      await waitFor("document.getElementById('boardPost').textContent === 'Try later'", 'try later');
      const away = await state();
      assert.match(away.status, /away just now.*Try later/); assert.equal(away.text, shareBefore, 'the share line is unchanged');
      assert.equal(posts(), before + 1, 'one try reached the (away) server');
      await shot(`board-${name}-away`);
      fake.mode = 'up';
    } else {
      // Offline: nothing is sent at all.
      await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await tap('#boardPost', phone);
      await waitFor("document.getElementById('boardPost').textContent === 'Try later'", 'try later offline');
      assert.equal(posts(), before, 'offline sends nothing'); assert.equal((await state()).text, shareBefore);
      await shot(`board-${name}-offline`);
      await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    // A name typed on the device, then the tap that posts.
    await tap('#boardName', phone);
    await read("document.getElementById('boardName').select()");
    await c.send('Input.insertText', { text: phone ? 'Fog Bank 3' : 'Washboard 7' });
    await tap('#boardPost', phone);
    await waitFor("!document.getElementById('boardView').hidden && document.querySelectorAll('#boardRows li.you').length === 1", 'the board with the player marked');
    const sent = JSON.parse(fake.requests.filter(r => r.method === 'POST').at(-1).body);
    assert.deepEqual(Object.keys(sent).sort(), ['area', 'claim', 'date', 'device', 'events', 'handle', 'played', 'seed', 'supply', 'v'], 'the post carries nothing else');
    assert.equal(sent.handle, phone ? 'Fog Bank 3' : 'Washboard 7'); assert.equal(sent.date, today);
    const posted = await state(), rank = posted.rows.findIndex(r => r.you) + 1, total = phone ? 16 : 15;
    console.log(name, 'posted', JSON.stringify({ rank, rows: posted.rows.length, status: posted.status, tabs: posted.tabs, line: posted.text.split('\n')[0] }));
    assert.equal(posted.rows.length, total); assert.match(posted.rows[rank - 1].text, phone ? /Fog Bank 3/ : /Washboard 7/);
    assert.equal(posted.status, `Posted: #${rank} of ${total} on the board.`);
    assert.equal(posted.postHidden, true, 'no second post');
    assert.equal(await read(`getComputedStyle(document.querySelector('#boardRows li.you small'),'::before').content`), '"You · "', 'the row says it is yours, on a line with room');
    assert.ok(posted.text.split('\n')[0].endsWith(`, #${rank} of ${total} on the board`), 'the share line gains the rank');
    assert.ok(posted.alt.endsWith(`#${rank} of ${total} on the board`) && posted.img > 1000, 'the picture is drawn again with the rank');
    assert.deepEqual(posted.tabs, [`Mabou:true`, `Today · ${await read(`(async()=>{const r=await import('/src/daily-rules.ts');return r.shortDate(${JSON.stringify(today)})})()`)}:true`,
      `Yesterday · ${await read(`(async()=>{const r=await import('/src/daily-rules.ts');return r.shortDate(${JSON.stringify(yesterday)})})()`)}:false`]);
    assert.deepEqual(posted.groups, ['Area:1', 'Day:2'], 'two groups of toggle buttons: the area and the day');
    // Every row and tab fits across the card.
    const over = await read(`(()=>{const c=document.getElementById('endingCard').getBoundingClientRect();return [...document.querySelectorAll('#boardRows li,#boardTabs button,#boardButtons button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<c.left-.5||r.right>c.right+.5);}).map(e=>e.id+' '+e.textContent.slice(0,30)+' '+Math.round(e.getBoundingClientRect().left)+'..'+Math.round(e.getBoundingClientRect().right)+' card '+Math.round(c.left)+'..'+Math.round(c.right))})()`);
    assert.deepEqual(over, [], 'the board fits inside the card');
    for (const id of ['#boardToday', '#boardYesterday', '#boardArea-mabou']) assert.ok((await box(id)).height >= 40, `${id} is touch-sized`);
    await read("document.querySelector('#boardRows li.you').scrollIntoView({block:'center'})"); await sleep(200);
    await shot(`board-${name}-posted`);
    // Yesterday: another board, the player's row is not on it.
    await tap('#boardYesterday', phone);
    await waitFor("document.querySelectorAll('#boardRows li').length === 5", 'yesterday’s board');
    const old = await state();
    assert.equal(old.rows.filter(r => r.you).length, 0); assert.ok(old.tabs[2].endsWith(':true'));
    await shot(`board-${name}-yesterday`);
    await tap('#boardToday', phone);
    await waitFor("document.querySelectorAll('#boardRows li.you').length === 1", 'back to today');
    // Practice: the card says the first run is posted, with its rank, and offers no second post.
    await read("[...document.querySelectorAll('#endingChoices button')].find(b=>b.textContent==='Try again (practice)').click()"); await sleep(600);
    await read("document.getElementById('endShift').click()");
    await waitFor("document.getElementById('endingTitle')?.textContent === 'Practice' && !!document.getElementById('boardStatus')", 'the practice card');
    const practice = await state();
    assert.match(practice.status, /^Posted: #\d+ of \d+ on the board\.$/); assert.equal(practice.postHidden, true);
    assert.match(practice.text.split('\n')[0], /on the board$/);
    assert.equal(posts(), before + (phone ? 1 : 2), 'one post per run');
    console.log(`PASS Today’s board ${name}: waits for the tap, ${phone ? 'offline' : 'away'} says try later, posted #${rank} of ${total} with the row marked, tabs for Mabou, today and yesterday, rank on the share line and picture, practice offers no second post`);
  }
  // No board anywhere else: mail play, plain Get Fired, Just Drive.
  await page(false, `mode=mail&boardserver=${encodeURIComponent(boardServer)}`);
  assert.equal(await read("!!document.getElementById('dailyBoard')||!!mmm.daily"), false);
  await page(false, `mode=fired&day=1&run=1&scene=0&boardserver=${encodeURIComponent(boardServer)}`);
  await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(400);
  await read("document.getElementById('endShift').click()");
  await waitFor("!document.getElementById('endingFrame').hidden", 'the Get Fired end card');
  assert.equal(await read("!!document.getElementById('dailyBoard')"), false, 'plain Get Fired has no board');
  await page(false, `site=just&daily=1&boardserver=${encodeURIComponent(boardServer)}`, 'localhost');
  assert.equal(await read("!!document.getElementById('dailyBoard')||!!mmm.daily"), false);
  console.log('PASS no board in mail play, plain Get Fired or Just Drive');
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); server.close(); }
