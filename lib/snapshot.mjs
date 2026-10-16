// The chat must read the same version of the code that the map shows. When the mapped commit is not the
// checked-out one, this exports that commit into a private, temporary folder (the repository is not touched)
// and Claude Code runs there.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git.mjs';

export function chatWorkspace(repository, sha, label, worktree) {
  if (worktree) return { directory: repository, note: 'The map shows the working tree, including uncommitted changes. You are in that working tree.' };
  if (git(repository, ['rev-parse', 'HEAD']).trim() === sha) {
    return { directory: repository, note: `The map shows ${label} at commit ${sha.slice(0, 7)}, which is the checked-out commit. You are in the repository.` };
  }
  const base = join(tmpdir(), 'code-map', createHash('sha256').update(repository).digest('hex').slice(0, 12));
  const name = sha.slice(0, 12), directory = join(base, name), marker = join(directory, '.code-map-snapshot');
  if (!existsSync(marker)) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
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
