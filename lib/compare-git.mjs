// Renames between a base commit and a head commit or the working tree, for the finding comparison. Read-only Git: the
// diff with the working tree runs on a private copy of the index (see gitRead). Git does not see a move that is not
// staged, because the new file is untracked, so a deleted file and an untracked file with the same blob ID pair here.
// An edited move pairs only by a file name that one deleted file and one untracked file share. Its similarity is 0 (unknown),
// so the comparison gives UNKNOWN, never NEW and RESOLVED, for each finding of those files that does not match.
import { basename } from 'node:path';
import { git, gitRead } from './git.mjs';

/** Git skipped its exhaustive rename detection (diff.renameLimit), so only exact and same-name renames are known. */
const limitWarning = /renameLimit|rename detection was skipped|too many files/;

/**
 * { renames: [{ from, to, similarity }], complete } from `git diff -M --raw -z`; `headSha` null compares with the working
 * tree. `complete` is false when Git did not look for every rename.
 */
export function gitRenames(repository, baseSha, headSha) {
  const args = ['diff', '-M', '--raw', '--no-abbrev', '-z', baseSha, ...(headSha === null ? [] : [headSha]), '--'];
  const { stdout, stderr } = gitRead(repository, args, { worktree: headSha === null });
  const tokens = stdout.split('\0'), renames = [], deleted = new Map();
  for (let index = 0; index < tokens.length;) {
    if (!tokens[index].startsWith(':')) { index++; continue; }
    const [, , blob, , status] = tokens[index].split(' '); // ":<old mode> <new mode> <old blob> <new blob> <status>"
    if (status[0] === 'R' || status[0] === 'C') {
      if (status[0] === 'R') renames.push({ from: tokens[index + 1], to: tokens[index + 2], similarity: Number(status.slice(1)) || 0 });
      index += 3;
    } else {
      if (status === 'D') deleted.set(blob, [...(deleted.get(blob) ?? []), tokens[index + 1]]);
      index += 2;
    }
  }
  if (headSha === null) renames.push(...unstagedMoves(repository, deleted));
  return { renames, complete: !limitWarning.test(stderr) };
}

/** A C-quoted line for `--stdin-paths`, which would read a name that starts with a double quote as quoted. */
const quoted = (path) => `"${path.replace(/[\\"]/g, '\\$&').replace(/[\x00-\x1f]/g, (char) => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`)}"`;

/**
 * A deleted file and an untracked file pair when each is the only one with that blob ID. hash-object without -w writes no
 * object. A file with a filter driver (for example Git LFS) is not hashed, because the driver is a program that can write.
 */
function unstagedMoves(repository, deleted) {
  if (deleted.size === 0) return [];
  const candidates = git(repository, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter((path) => path && !path.endsWith('/'));
  if (candidates.length === 0) return [];
  const filters = git(repository, ['check-attr', '-z', '--stdin', 'filter'], candidates.map((path) => `${path}\0`).join('')).split('\0');
  const untracked = candidates.filter((path, index) => ['unspecified', 'unset'].includes(filters[index * 3 + 2]));
  if (untracked.length === 0) return [];
  const ids = git(repository, ['hash-object', '--stdin-paths'], untracked.map((path) => `${quoted(path)}\n`).join('')).split('\n');
  const added = new Map();
  untracked.forEach((path, index) => added.set(ids[index], [...(added.get(ids[index]) ?? []), path]));
  const moves = [], paired = new Set();
  for (const [blob, from] of deleted) {
    const to = added.get(blob) ?? [];
    if (from.length === 1 && to.length === 1) { moves.push({ from: from[0], to: to[0], similarity: 100 }); paired.add(from[0]).add(to[0]); }
  }
  const byName = (paths) => { const names = new Map(); for (const path of paths) if (!paired.has(path)) names.set(basename(path), [...(names.get(basename(path)) ?? []), path]); return names; };
  const gone = byName([...deleted.values()].flat()), fresh = byName(untracked);
  for (const [name, from] of gone) if (from.length === 1 && fresh.get(name)?.length === 1) moves.push({ from: from[0], to: fresh.get(name)[0], similarity: 0 });
  return moves;
}
