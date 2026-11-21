#!/usr/bin/env node
// Broken copies of the start key, served to the real page: tools/start-key-browser.mjs must catch each one at its own line.
// Run: node tools/start-key-browser-mutations.mjs (it owns its browser session; about five minutes).
//      --validate checks that every line to break is still in the source, without a browser.
// The source edits exist only in Vite's transforms, never in web/src. START_KEY_MUTATION=name|name runs a few.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mutationSession, serveMutation } from './mutation-session.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// name, the part of the check to run, file in web/src, the line, its broken form, and the line of the check that must fail
const cases = [
  ['a test key', 'just', 'visit.ts', "  'animal',", "  'start', 'animal',",
    'Just Drive: the title card shows, with Start and the credits on the screen'],
  ['the place is not used', 'just', 'main.ts', "if (!asked || (!placeAtStart(startPlacement, asked) && !fleet?.visitQueued)) placeFirstStop('new-visit');", "placeFirstStop('new-visit');",
    'Just Drive: the car stands on Beaton Road'],
  ['at the very end of the road', 'just', 'start-key.ts', 'total - Math.min(START_BACK, total / 2)', 'total',
    'Just Drive: the car stands 150 m before the end of the road'],
  ['the wrong end', 'just', 'start-key.ts', 'const line = endIsLast ? piece.pts : [...piece.pts].reverse();', 'const line = endIsLast ? [...piece.pts].reverse() : piece.pts;',
    'Just Drive: the car stands 150 m before the end of the road'],
  ['turned around', 'just', 'start-key.ts', 'heading: Math.atan2(bx - ax, -(bz - az)), distance', 'heading: Math.atan2(ax - bx, bz - az), distance',
    'Just Drive: the car points at the end of the road'],
  ['an unknown road gets the village', 'just', 'start-key.ts', 'if (!piece) return null;', 'if (!piece) return { x: 0, z: 0, heading: 0, distance: 0 };',
    'Just Drive, unknown road: the normal start'],
  ['the mail site ignores the key', 'mail', 'main.ts', ": startKey(params.get('start'), roads.roads, vehicle.bounds);", ": mailMode ? null : startKey(params.get('start'), roads.roads, vehicle.bounds);",
    'mail site: the car stands on Beaton Road'],
];
const rows = [];
const documents = cases.map(([name, , file, from, to]) => ({ name, edits: [{ file: 'web/src/' + file, from, to }] }));
if (!await mutationSession(root, 'start-key-browser-mutations.mjs', documents, process.argv.slice(2), 'q=low')) {
  try {
    const selected = cases.filter(([name]) => !process.env.START_KEY_MUTATION || process.env.START_KEY_MUTATION.split('|').includes(name));
    assert.ok(selected.length, 'START_KEY_MUTATION matches no mutations');
    for (const [name, family, , , , target] of selected) {
      const marker = name + '-' + randomUUID();
      await serveMutation({ ...documents.find((d) => d.name === name), marker }, process.argv[3]);
      const result = await new Promise((done, reject) => {
        const p = spawn(process.execPath, [root + '/tools/start-key-browser.mjs', ...process.argv.slice(2)],
          { env: { ...process.env, START_KEY_FAMILY: family, START_KEY_EXPECT_MUTATION: marker }, stdio: ['ignore', 'pipe', 'pipe'] });
        let text = '';
        const int = () => p.kill('SIGINT'), term = () => p.kill('SIGTERM');
        process.on('SIGINT', int); process.on('SIGTERM', term);
        p.stdout.on('data', (d) => { text += d; }); p.stderr.on('data', (d) => { text += d; }); p.on('error', reject);
        p.on('close', (code, signal) => { process.off('SIGINT', int); process.off('SIGTERM', term); done({ code, text, signal }); });
      });
      if (result.signal) throw Error('mutation interrupted: ' + result.signal);
      // The right gate: the first line that fails is the one this mutation was made for.
      const failed = result.text.split('\n').find((line) => line.startsWith('FAIL '));
      const detected = result.code !== 0 && !!failed && failed.includes(target);
      rows.push({ name, target, detected, exit: result.code, failed: failed ?? null });
      console.log((detected ? 'DETECTED ' : 'MISSED ') + name);
      if (!detected) console.log(result.text.slice(-5000));
    }
  } finally {
    await serveMutation({ edits: [] }, process.argv[3]);
    writeFileSync(process.argv[2] + '/start-key-browser-mutations.json', JSON.stringify(rows, null, 2));
  }
  assert.ok(rows.length && rows.every((r) => r.detected), 'a browser mutation survived or failed at the wrong gate');
  console.log(`PASS ${rows.length} broken copies of the start key detected in the page, without source writes.`);
}
