// One owned browser session. The outer launcher creates JSON before Vite starts.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateMutations } from './mutation-source.mjs';
export async function child(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const p = spawn(command, args, options);
    const int = () => p.kill('SIGINT'), term = () => p.kill('SIGTERM');
    process.on('SIGINT', int); process.on('SIGTERM', term);
    p.once('error', reject);
    p.once('close', (code, signal) => {
      process.off('SIGINT', int); process.off('SIGTERM', term);
      resolve({ code: code ?? (signal === 'SIGINT' ? 130 : 143), signal });
    });
  });
}
export async function mutationSession(root, script, cases, args, query) {
  validateMutations(root, cases);
  if (args.includes('--validate')) { console.log(`PASS ${cases.length} mutation anchors validated before startup`); return true; }
  if (process.env.MMM_MUTATION) return false;
  const base = resolve(root, 'data/work/mutations'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(base + '/mutation-');
  const out = process.env.OUT ? resolve(process.env.OUT) : dir; mkdirSync(out, {recursive:true});
  const file = dir + '/edits.json'; writeFileSync(file, '{"edits":[]}');
  let succeeded = false;
  try {
    const result = await child('bash', [root + '/tools/yard-shots.sh', '1600', '1000'], {
      env: { ...process.env, MMM_MUTATION: file, RUN: script, HUD: '1', SHOTS: '0', VIEWS: 'mutations|' + query, OUT: out }, stdio: 'inherit',
    });
    process.exitCode = result.code; succeeded = result.code === 0;
  } finally {
    if (succeeded || process.env.OUT) rmSync(dir, { recursive: true, force: true });
    else console.error('Mutation run failed; evidence kept at ' + dir);
  }
  return true;
}
export async function serveMutation(document, url) {
  const base=realpathSync(resolve(import.meta.dirname,'../data/work/mutations'));
  const path=realpathSync(process.env.MMM_MUTATION),rel=relative(base,path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('MMM_MUTATION: runner JSON must be in data/work/mutations');
  const bytes = JSON.stringify(document), hash = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path, bytes);
  const response = await fetch(new URL('/__mmm_mutation', url), { signal: AbortSignal.timeout(10000) });
  if (!response.ok || (await response.json()).hash !== hash) throw Error('MMM_MUTATION: no matching Vite receipt');
}
