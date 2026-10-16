// The chat must read the same version of the code that the map shows. When the mapped commit is not the
// checked-out one, this exports that commit into a private, temporary folder (the repository is not touched)
// and Claude Code runs there.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git.mjs';

export function chatWorkspace(repository, sha, label, worktree) {
  if (worktree) return { directory: repository, note: 'The map shows the working tree, including uncommitted changes. You are in that working tree.' };
  if (git(repository, ['rev-parse', 'HEAD']).trim() === sha) {
    return { directory: repository, note: `The map shows ${label} at commit ${sha.slice(0, 7)}, which is the checked-out commit. You are in the repository.` };
  }
  const base = join(privateRoot(), createHash('sha256').update(repository).digest('hex').slice(0, 12));
  mkdirSync(base, { recursive: true, mode: 0o700 });
  requirePrivate(base); // its old snapshots are deleted below, so it must not be a symlink to somewhere else
  const name = sha.slice(0, 12), directory = join(base, name), marker = join(directory, '.code-map-snapshot');
  if (!existsSync(marker)) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const archive = join(base, `${name}.tar`);
    git(repository, ['archive', '--format=tar', `--output=${archive}`, sha]);
    execFileSync('tar', ['-xf', archive, '-C', directory]);
    rmSync(archive, { force: true });
    writeFileSync(marker, `${sha}\n`);
  }
  for (const other of readdirSync(base)) if (other !== name) rmSync(join(base, other), { recursive: true, force: true });
  return { directory, note: `You are in a read-only copy of ${label} at commit ${sha.slice(0, 7)}: exactly the version the map shows. `
    + `The repository itself (${repository}) has a different branch checked out, so answer from this copy and do not look elsewhere.` };
}

/** The snapshot folder has a fixed name, and on Linux the temporary folder is shared: another user could create the
 * name first or swap in a symlink. So it must be a real folder that this user owns and that nobody else can open. */
/** An older code-map used `code-map` and left it open to other users. That folder is never reused or deleted:
 * others could have planted symlinks in it, and they can race a recursive delete with more of them. */
export function privateRoot() {
  const root = join(tmpdir(), 'code-map-chat');
  mkdirSync(root, { recursive: true, mode: 0o700 }); // the Windows temporary folder is already per user
  return requirePrivate(root);
}

function requirePrivate(path) {
  if (process.platform === 'win32') return path;
  const info = lstatSync(path);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error(`code-map: ${path} is not a private folder that you own, so the chat cannot use it. `
      + 'Remove it, or set TMPDIR to a folder that only you use.');
  }
  return path;
}
