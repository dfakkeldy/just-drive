// Frozen source inputs are data for the checks, so their original extensions end in .txt.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readBaseline(name, path, root = process.env.MMM_ROOT ?? resolve(import.meta.dirname, '..')) {
  return readFileSync(resolve(root, 'tools/baseline/source', name, path + '.txt'), 'utf8');
}
