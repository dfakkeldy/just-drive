#!/usr/bin/env node
// Broken copies of the burial-ground shader keeper, served to the real page: tools/cemeteries-browser.mjs must
// catch each one at its own line.
// Run: node tools/cemeteries-browser-mutations.mjs (it owns its browser session; about five minutes).
//      --validate checks that every line to break is still in the source, without a browser.
// The source edits exist only in Vite's transforms, never in web/src. CEMETERIES_MUTATION=name|name runs a few.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mutationSession, serveMutation } from './mutation-session.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// name, the part of the check to run, the line of web/src/cemeteries.ts, its broken form, and the line of the check that must fail
const cases = [
  ['no keeper', 'on', 'this.group.add(keeper);', 'void 0;',
    'on: the burial-ground shader is built before first sight'],
  // The keeper hides after its first picture: the shader of the start state is there, a later state gets none.
  ['keeper only in the first picture, then the Shadows switch', 'off', 'this.group.add(keeper);', 'this.group.add(keeper); keeper.onAfterRender = () => { keeper.visible = false; };',
    'off: after the Shadows switch the material has the shader for the new state, before first sight'],
  ['keeper only in the first picture, then a new light', 'lights', 'this.group.add(keeper);', 'this.group.add(keeper); keeper.onAfterRender = () => { keeper.visible = false; };',
    'lights: after a new light in the scene the material has the shader for the new state, before first sight'],
  // Without instance colours three.js builds another shader for the keeper. It is never the one that draws the stones.
  ['keeper without instance colours', 'on', 'keeper.setColorAt(0, new THREE.Color(0xffffff));', 'void 0;',
    'on: first sight builds no shader'],
  ['keeper with an instance to draw', 'on', 'keeper.count = 0;', 'keeper.count = 1;',
    'on: the keeper is in the pictures and makes no draw call'],
];
const rows = [];
const documents = cases.map(([name, , from, to]) => ({ name, edits: [{ file: 'web/src/cemeteries.ts', from, to }] }));
if (!await mutationSession(root, 'cemeteries-browser-mutations.mjs', documents, process.argv.slice(2), 'q=high')) {
  try {
    const selected = cases.filter(([name]) => !process.env.CEMETERIES_MUTATION || process.env.CEMETERIES_MUTATION.split('|').includes(name));
    assert.ok(selected.length, 'CEMETERIES_MUTATION matches no mutations');
    for (const [name, family, , , target] of selected) {
      const marker = name + '-' + randomUUID();
      await serveMutation({ ...documents.find((d) => d.name === name), marker }, process.argv[3]);
      const result = await new Promise((done, reject) => {
        const p = spawn(process.execPath, [root + '/tools/cemeteries-browser.mjs', ...process.argv.slice(2)],
          { env: { ...process.env, CEMETERIES_FAMILY: family, CEMETERIES_EXPECT_MUTATION: marker }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    writeFileSync(process.argv[2] + '/cemeteries-browser-mutations.json', JSON.stringify(rows, null, 2));
  }
  assert.ok(rows.length && rows.every((r) => r.detected), 'a browser mutation survived or failed at the wrong gate');
  console.log(`PASS ${rows.length} broken copies of the burial-ground shader keeper detected in the page, without source writes.`);
}
