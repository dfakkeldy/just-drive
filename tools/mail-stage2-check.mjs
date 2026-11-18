#!/usr/bin/env node
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'mmm-mail-stage2-'));
const mutations = [
  ['ground-delivery', 'props.ts', '      const ground = this.terrain.heightAt(p.x, p.z);', '      if (landed) return i; const ground = this.terrain.heightAt(p.x, p.z);'],
  ['wide-opening', 'mailbox-rules.ts', 'width * .435', 'width * 2'],
  ['back-door', 'mailbox-rules.ts', 'a.z <= face || b.z > face', 'a.z === b.z'],
  ['no-lean', 'mailbox-rules.ts', 'speed >= 2 / 3.6 ? 1', 'speed >= 20 / 3.6 ? 1'],
  ['no-dent', 'props.ts', 'if (slot.dent && item.motion && item.motion.damage >= 2)', 'if (false)'],
  ['fall-also-wobbles','props.ts','if (!m.down && m.contact <= 0)','if (m.contact <= 0)'],
  ['no-visible-lean', 'props.ts', 'const angle = m.angle +', 'const angle = 0 +'],
  ['early-fall', 'mailbox-rules.ts', 'speed >= 20 / 3.6 ? 3', 'speed >= 8 / 3.6 ? 3'],
  ['reset-keeps-damage', 'props.ts', 'm.damage = 0;', 'm.damage = m.damage;'],
  ['damage-heals', 'props.ts', 'damage > m.damage', 'damage !== m.damage'],
  ['untransformed-opening', 'props.ts', 'this.inverse.copy(this.dummy.matrix).invert();', 'this.inverse.makeTranslation(-p.x, -ground, -p.z);'],
  ['paused-damage', 'mail.ts', 'const factor = dt > 0 ?', 'const factor = true ?'],
  ['miss-not-scored', 'mail.ts', 'this.rest(p, ground); this.miss(p);', 'this.rest(p, ground);'],
];
try {
  for (const mutant of [null, ...(process.argv.includes('--mutations') ? mutations : [])]) {
    const file = join(dir, (mutant?.[0] ?? 'baseline') + '.mjs');
    await build({ entryPoints: ['tools/mail-stage2-cases.mjs'], bundle: true, platform: 'node', format: 'esm', outfile: file,
      nodePaths: [process.cwd() + '/web/node_modules'], logLevel: 'silent', plugins: [{ name: 'mutations', setup(b) {
        if (mutant) b.onLoad({ filter: /web\/src\/.*\.ts$/ }, args => {
          if (!args.path.endsWith('/' + mutant[1])) return;
          const source = readFileSync(args.path, 'utf8');
          assert.equal(source.split(mutant[2]).length, 2, mutant[0] + ' anchor');
          return { contents: source.replace(mutant[2], mutant[3]), loader: 'ts' };
        });
      } }] });
    const result = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    if (!mutant) { process.stdout.write(result.stdout + result.stderr); assert.equal(result.status, 0, 'baseline'); }
    else {
      assert.equal(result.status, 1, mutant[0] + ' must fail'); assert.match(result.stderr, /AssertionError/);
      console.log('KILLED ' + mutant[0] + ': assertion failure');
    }
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
