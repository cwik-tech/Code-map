// Read exact review target bytes without following repository symlinks.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitBytes } from './git.mjs';
import { readOracleBytes } from './oracle-files.mjs';
import { safeReviewPath } from './weakening-reviews.mjs';
const maxBytes = 4 * 1024 * 1024;
/** Missing, unsafe and oversized targets have no current digest. */
export function readReviewTarget(repository, sha, path) {
  if (!safeReviewPath(path)) return null;
  try {
    if (sha !== null) {
      const mode = git(repository, ['ls-tree', sha, '--', path]).split(' ')[0];
      if (!['100644', '100755'].includes(mode)) return null;
      const size = Number(git(repository, ['cat-file', '-s', `${sha}:${path}`]).trim());
      if (size > maxBytes) return null;
      const bytes = gitBytes(repository, ['cat-file', 'blob', `${sha}:${path}`]);
      return bytes.length <= maxBytes ? bytes : null;
    }
    let target = repository;
    for (const part of path.split('/')) {
      target = join(target, part);
      const info = lstatSync(target, { throwIfNoEntry: false });
      if (!info || info.isSymbolicLink()) return null;
    }
    return readOracleBytes(target, maxBytes);
  } catch { return null; /* An unreadable target cannot have a current review. */ }
}
