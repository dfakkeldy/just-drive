#!/usr/bin/env node
// The fishing checks park the game's frame loop before they step the car (park-frame.mjs).
// A fake page whose first frame after the title is slow (300 ms) must still be parked, and the
// parked loop must not run on its own afterwards. The old fixed 100 ms wait fails this page: it
// takes no frame, and the real loop then runs between the check's steps (fishing-hills-check,
// R14 at hill 1 on Linux).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parkMainFrame } from './park-frame.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A page with one game loop. Each frame asks for the next one; the browser answers after `delay` ms.
function fakePage(delay) {
  const page = { frames: 0 };
  const ctx = vm.createContext({ setTimeout, performance });
  ctx.requestAnimationFrame = fn => { setTimeout(() => fn(performance.now()), delay); return 1; };
  ctx.frame = function frame() { if (page.stopped) return; page.frames++; ctx.requestAnimationFrame(ctx.frame); };
  ctx.window = ctx;
  ctx.requestAnimationFrame(ctx.frame);
  page.read = async expression => vm.runInContext(expression, ctx);
  page.ctx = ctx;
  return page;
}
// The pass-through the fishing harness installs after it parks the loop (fishing-browser.mjs).
const PASS_THROUGH = 'const mainFrame=window.nextFrame;window.requestAnimationFrame=fn=>{if(fn===mainFrame)window.nextFrame=fn;else setTimeout(()=>fn(performance.now()),0);return 0}';
async function framesOnTheirOwn(page) {
  await page.read(PASS_THROUGH);
  const before = page.frames;
  await sleep(600);
  return page.frames - before;
}

// 1. The fixture reproduces the failure with the old fixed wait.
{
  const page = fakePage(300);
  await page.read('window.requestAnimationFrame=fn=>{window.nextFrame=fn;return 0}');
  await sleep(100);
  assert.equal(await page.read('typeof window.nextFrame'), 'undefined', 'fixture: the old 100 ms wait takes no frame from a slow page');
  assert.ok(await framesOnTheirOwn(page) > 0, 'fixture: the loop then runs on its own');
  page.stopped = true;
}
// 2. parkMainFrame parks the slow page's real frame, and the loop stays parked.
for (const delay of [16, 300, 1500]) {
  const page = fakePage(delay);
  await parkMainFrame(page.read, sleep);
  assert.equal(page.ctx.nextFrame, page.ctx.frame, `the main frame is parked (first frame after ${delay} ms)`);
  assert.equal(await framesOnTheirOwn(page), 0, `the parked loop does not run on its own (first frame after ${delay} ms)`);
  page.stopped = true;
}
// 3. A page with no frame loop fails with a clear message, not a later physics assertion.
{
  const ctx = vm.createContext({});
  ctx.window = ctx;
  await assert.rejects(parkMainFrame(async e => vm.runInContext(e, ctx), sleep, 200), /did not ask for a next frame/);
}
// 4. The fishing harness uses it, and keeps no fixed wait.
const harness = readFileSync(new URL('./fishing-browser.mjs', import.meta.url), 'utf8');
assert.match(harness, /await parkMainFrame\(read,sleep\)/, 'fishing-browser.mjs parks the frame with parkMainFrame');
assert.doesNotMatch(harness, /nextFrame=fn;return 0}`\);\s*await sleep\(/, 'fishing-browser.mjs has no fixed wait after the catcher');
console.log('PASS park-frame: a slow first frame is still parked; the parked loop never runs on its own; no fixed wait');
