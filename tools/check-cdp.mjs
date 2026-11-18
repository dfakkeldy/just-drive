#!/usr/bin/env node
// Transport fault injection, no browser/GPU/ports. Exercise hung requests and real disconnect events.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cdp, sleep, waitForSettled, exitCheck, DEADLINE } from './cdp.mjs';
const Original = globalThis.WebSocket;
class Socket {
  static last;
  constructor(url) {
    Socket.last = this; this.url = url;
    if (url !== 'never-opens') setTimeout(() => this.onopen?.(), 0);
  }
  send(data) {
    const request = JSON.parse(data);
    if (request.method.endsWith('.enable')) queueMicrotask(() => this.message({ id: request.id, result: {} }));
    if (request.method === 'Runtime.evaluate') queueMicrotask(() => this.message({id:request.id,result:{exceptionDetails:{text:'fixture evaluate error'}}}));
    if (request.method === 'bad-command') queueMicrotask(() => this.message({ id: request.id, error: { message: 'unsupported' } }));
  }
  message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { queueMicrotask(() => this.onclose?.()); }
}
globalThis.WebSocket = Socket;
if (process.argv.includes('--exit-ok')) exitCheck(0);
else if (process.argv.includes('--exit-fail')) exitCheck(1);
else if (process.argv.includes('--exit-invalid')) exitCheck(2);
else if (process.argv.includes('--late')) {
  const c = await cdp('fixture');
  console.log('PASS the page settled');
  Socket.last.message({method:'Runtime.exceptionThrown',params:{exceptionDetails:{text:'late fixture page error'}}});
  c.close(); exitCheck(0);
} else if (process.argv.includes('--evaluate')) {
  const c = await cdp('fixture');
  await c.send('Runtime.evaluate', {expression:'throw new Error("fixture evaluate")'});
} else try {
  assert.equal(DEADLINE,60000); console.log('PASS default deadline 60000ms; explicit shorter limits remain usable');
  await assert.rejects(cdp('never-opens', { deadline: 30 }), /connection timeout/);
  console.log('PASS connect deadline');
  for (const reason of ['timeout', 'close', 'crash', 'exception']) {
    const c = await cdp('fixture', { deadline: 50 });
    const requests = Promise.allSettled([c.send('never-answers-a'), c.send('never-answers-b')]);
    if (reason === 'close') Socket.last.close();
    if (reason === 'crash') Socket.last.message({ method: 'Inspector.targetCrashed' });
    if (reason === 'exception') Socket.last.message({ method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'fixture exception' } } });
    const results = await requests;
    assert.ok(results.every(result => result.status === 'rejected'));
    await assert.rejects(c.send('after-failure'));
    c.close(); process.exitCode = 0;
    console.log(`PASS ${reason} rejects every pending and later request`);
  }
  const c = await cdp('fixture');
  assert.equal((await c.send('bad-command')).error.message, 'unsupported', 'raw CDP keeps the error envelope for optional-feature fallbacks');
  Socket.last.message({ method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'late exception' } } });
  assert.equal(process.exitCode, 1, 'an exception after the last request still fails a check');
  c.close(); process.exitCode = 0;
  await sleep(0);
  console.log('PASS protocol error envelope preserved; late exception fails checks');
  for (const mode of ['--late','--evaluate']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode], {encoding:'utf8',timeout:5000});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /check-cdp.mjs/);
    assert.match(result.stderr, mode==='--late' ? /late fixture page error/ : /expression: throw new Error/);
    if(mode==='--late')assert.match(result.stdout,/PASS the page settled/);
    console.log(`PASS ${mode}: exit 1, check name and ${mode==='--late'?'page reason':'throwing expression'} on stderr`);
  }
  for (const [mode,status] of [['--exit-ok',0],['--exit-fail',1],['--exit-invalid',2]]) {
    const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),mode],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,status,result.stderr);
  }
  console.log('PASS explicit 0/1/2 exits preserved; explicit pass cannot erase late page failure');
  let polls=0;
  const originalNow=Date.now;Date.now=()=>Number.MAX_SAFE_INTEGER;
  try {assert.equal(await waitForSettled(async()=>++polls===240,'http://fixture/',{delay:0}),true);}
  finally {Date.now=originalNow;}
  assert.equal(polls,240);
  console.log('PASS settle allows all 240 polls, independent of elapsed wall time');
} finally { globalThis.WebSocket = Original; }
