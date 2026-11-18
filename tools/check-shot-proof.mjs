// Run through yard-shots.sh. A real page that stalls or throws must fail without a successful picture.
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const [out, first] = process.argv.slice(2);
const fixture = new URL('/@fs/' + fileURLToPath(new URL('./check-ports-probe.html', import.meta.url)), first);
for (const mode of ['stall', 'throw']) {
  fixture.search = `mode=${mode}&name=g4-${mode}`;
  const file = `${out}/g4-${mode}.png`;
  if (existsSync(file)) unlinkSync(file);
  const start = Date.now();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./shot.mjs', import.meta.url)), out, fixture.href], {
    env: { ...process.env, SHOT_TIMEOUT_MS: mode === 'stall' ? '1200' : '6000' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const code = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timer);
  const elapsed = Date.now() - start;
  assert.equal(code, 1, output); assert.ok(elapsed < 8000, `${mode}: exceeded failure deadline`);
  assert.equal(existsSync(file), false, 'failed page writes no picture');
  assert.match(output, mode === 'stall' ? /did not settle/ : /fixture page exception/);
  console.log(`PASS shot ${mode}: exit ${code}, ${elapsed}ms, no picture; ${output.trim().split('\n').at(-1)}`);
}
