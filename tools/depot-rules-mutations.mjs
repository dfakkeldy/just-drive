#!/usr/bin/env node
// Depot rules check and in-memory mutation suite (no source writes, no browser, no land required).
// Usage: node tools/depot-rules-mutations.mjs [--mutations]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checkPath = resolve(root, 'tools/depot-rules-check.mjs');

async function runCheck(edits = {}) {
  const result = await build({
    entryPoints: [checkPath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      {
        name: 'depot-mutants',
        setup(b) {
          b.onResolve({ filter: /^three$/ }, () => ({
            path: pathToFileURL(resolve(root, 'web/node_modules/three/build/three.module.js')).href,
            external: true,
          }));
          b.onLoad({ filter: /web\/src\/(depot-rules|interiors)\.ts$/ }, args => {
            const rel = args.path.slice(root.length + 1);
            if (!edits[rel]) return null;
            let text = readFileSync(args.path, 'utf8');
            for (const [from, to] of edits[rel]) {
              assert.equal(text.split(from).length, 2, `anchor missing in ${rel}: ${from}`);
              text = text.replace(from, to);
            }
            return { contents: text, loader: 'ts' };
          });
        },
      },
    ],
  });
  const code = result.outputFiles[0].text;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
}

const base = await runCheck();
if (base.status !== 0) {
  console.error(base.stdout, base.stderr);
  process.exit(base.status ?? 1);
}
process.stdout.write(base.stdout);

if (!process.argv.includes('--mutations')) process.exit(0);

const MUTANTS = {
  'allow-depot-off': { 'web/src/depot-rules.ts': [["areaDepot && modern && params.get('depot') !== '0'", 'areaDepot && modern']] },
  'allow-loading-in-fired': { 'web/src/depot-rules.ts': [["gameMode === 'mail'", "gameMode !== 'explore'"]] },
  'auto-load-on-title-test': { 'web/src/depot-rules.ts': [["(plainVisit && !params.has('title'))", 'plainVisit']] },
  'skip-interrogation-on-suspension': { 'web/src/depot-rules.ts': [["outcome === 'suspension' ||", 'false ||']] },
  'skip-interrogation-on-boss-warning': { 'web/src/depot-rules.ts': [["(bossSeenCount > 0 && outcome !== 'clear')", 'false']] },
  'always-neat-grade': { 'web/src/depot-rules.ts': [["Math.abs(lane) <= SWEET_SPOT ? 'neat' : 'crammed'", "'neat'"]] },
  'break-loading-skip': { 'web/src/depot-rules.ts': [["this.phase = 'done';\n    this.hatchClose = 1;", "this.hatchClose = 1;"]] },
  'drop-boss-seen-priority': { 'web/src/depot-rules.ts': [['(c.seen ? 100 : 0) +', '0 +']] },
  'ignore-interrogation-skip': { 'web/src/depot-rules.ts': [["this.skipped = true;\n    this.phase = 'done';", 'this.skipped = true;']] },
  'drop-seen-offences': { 'web/src/depot-rules.ts': [["if (s.kind !== 'speeding' && s.kind !== 'schoolBus') continue;", 'continue;']] },
  'proximity-matches-virtual-door': { 'web/src/interiors.ts': [['d.radius > 0 && Math.hypot', 'Math.hypot']] },
  'finish-before-reset': { 'web/src/interiors.ts': [["game.dispose(); this.passage = { kind: 'drive' }; this.returnFade = .4; this.lastWall = 0;\n    this.hud.hidden = true; this.dress(null);\n    this.receive({ door, result });", "this.receive({ door, result });\n    game.dispose(); this.passage = { kind: 'drive' }; this.returnFade = .4; this.lastWall = 0;\n    this.hud.hidden = true; this.dress(null);"]] },
  'drop-after-shift-clock': { 'web/src/interiors.ts': [['p.door.afterShift && typeof document', 'false && typeof document']] },
};

let killed = 0;
for (const [name, edits] of Object.entries(MUTANTS)) {
  const r = await runCheck(edits);
  assert.notEqual(r.status, 0, `mutant survived: ${name}`);
  console.log(`KILLED ${name} (exit ${r.status})`);
  killed++;
}
console.log(`PASS ${killed} depot mutations killed.`);
