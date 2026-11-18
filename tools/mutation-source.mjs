// Shared by the dev-only Vite plugin and browser mutation launchers. Never writes source.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
export function mutationSources(root, document) {
  if (!document || !Array.isArray(document.edits)) throw Error('MMM_MUTATION: expected {edits: [...]}');
  const sourceRoot = realpathSync(resolve(root, 'web/src')), sources = new Map();
  for (const edit of document.edits) {
    if (typeof edit.file !== 'string') throw Error('MMM_MUTATION: missing file');
    const path = resolve(root, edit.file), rel = relative(resolve(root, 'web/src'), path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error(`MMM_MUTATION: outside web/src: ${edit.file}`);
    const real = realpathSync(path), realRel = relative(sourceRoot, real);
    if (realRel.startsWith('..') || isAbsolute(realRel)) throw Error(`MMM_MUTATION: outside web/src: ${edit.file}`);
    if (typeof edit.from !== 'string' || !edit.from || typeof edit.to !== 'string') throw Error(`MMM_MUTATION: invalid edit: ${edit.file}`);
    const source = sources.get(path) ?? readFileSync(path, 'utf8');
    if (edit.from === edit.to) throw Error(`MMM_MUTATION: no-op edit in ${edit.file}`);
    const matches = source.split(edit.from).length - 1;
    if (!edit.all && matches > 1) throw Error(`MMM_MUTATION: expected exactly one anchor in ${edit.file}, found ${matches}: ${JSON.stringify(edit.from)}`);
    if (!source.includes(edit.from)) throw Error(`missing mutation anchor ${document.name ?? '(unnamed)'} in ${edit.file}: ${JSON.stringify(edit.from)}`);
    sources.set(path, edit.all ? source.split(edit.from).join(edit.to) : source.replace(edit.from, () => edit.to));
  }
  if (document.marker) for (const [path, source] of sources) sources.set(path, source + '\nObject.assign(globalThis,{__mmmMutation:' + JSON.stringify(document.marker) + ',__mmmMutationSources:[...new Set([...(globalThis.__mmmMutationSources??[]),' + JSON.stringify(document.marker) + '])]});\n');
  return sources;
}
export function validateMutations(root, cases) {
  // All cases, even filtered-out cases, must validate before starting any browser or writing JSON.
  const errors = [];
  for (const document of cases) try { mutationSources(root, document); } catch (error) { errors.push(error.message); }
  if (errors.length) throw Error(errors.join('\n'));
}
