// The texts of the head snapshot of a comparison, read when the comparison runs, because the stored analysis keeps no
// source text. A commit is read from Git. A working tree is read from disk, and a symlink is skipped there, because it can
// point outside the repository. Read-only.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, sourceReader } from '../git.mjs';

/** A larger file is not read. The search counts it as skipped. */
export const maxFileBytes = 1024 * 1024;

/** A tracked descendant of a replaced folder must not follow that folder's symlink. */
function localFile(repository, path) {
  let current = repository;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (!info || info.isSymbolicLink()) return null;
    if (index === parts.length - 1) return info.isFile() ? info : null;
    if (!info.isDirectory()) return null;
  }
  return null;
}

/**
 * { texts: Map(path -> text), skipped } for the head files that `wanted(path)` accepts. `skipped` counts the files that are
 * too large or binary (a NUL character). A symlink is never read.
 */
export function readHead(stored, wanted) {
  const { repository, selector } = stored.inputs, texts = new Map();
  let skipped = 0;
  const keep = (path, text) => { if (text.includes('\0')) skipped++; else texts.set(path, text); };
  if (selector.worktree) {
    for (const path of sourceReader(repository, null).list().filter(wanted)) {
      const info = localFile(repository, path);
      if (!info) continue;
      if (info.size > maxFileBytes) skipped++;
      else keep(path, readFileSync(join(repository, path), 'utf8'));
    }
    return { texts, skipped };
  }
  // Each entry is "<mode> blob <object> <size>\t<path>". A symlink has mode 120000, and a submodule is a commit entry.
  const small = [];
  for (const entry of git(repository, ['ls-tree', '-r', '-l', '-z', stored.data.sha]).split('\0')) {
    const match = /^(\d+) blob [0-9a-f]+ +(\d+)\t([^\n\r]+)$/.exec(entry);
    if (!match || match[1] === '120000' || !wanted(match[3])) continue;
    if (Number(match[2]) > maxFileBytes) skipped++;
    else small.push(match[3]);
  }
  for (const [path, text] of sourceReader(repository, stored.data.sha).read(small)) keep(path, text);
  return { texts, skipped };
}
