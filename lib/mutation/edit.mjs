// Applies one trusted parser edit to a private worker snapshot. Symlink components are refused.
import { mutationCompileError } from './generate.mjs';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRelativePath } from '../adapters/run-manifest.mjs';
/** Never follows a snapshot symlink, and checks the exact source before writing. */
export function applyMutation(tree, edit) {
  if (!edit || !isRelativePath(edit.path) || !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end)
    || edit.start < 0 || edit.end < edit.start || typeof edit.original !== 'string' || typeof edit.replacement !== 'string') throw new Error('Invalid mutation edit.');
  let path = tree;
  for (const part of edit.path.split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new Error('Mutation paths cannot contain a symlink.');
  }
  if (!lstatSync(path).isFile()) throw new Error('Mutation needs a regular file.');
  const text = readFileSync(path, 'utf8');
  if (edit.end > text.length || text.slice(edit.start, edit.end) !== edit.original) throw new Error('The mutation source changed.');
  if (mutationCompileError(edit.path, text, edit)) {
    const error = new Error('The mutant does not compile.'); error.code = 'MUTATION_COMPILE'; throw error;
  }
  writeFileSync(path, text.slice(0, edit.start) + edit.replacement + text.slice(edit.end));
}
