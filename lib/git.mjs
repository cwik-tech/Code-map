// Read-only Git access. Nothing here writes to the repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const maxBuffer = 1024 * 1024 * 1024;

export function git(directory, args, input) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', maxBuffer, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function repositoryRoot(directory) {
  return git(directory, ['rev-parse', '--show-toplevel']).trim();
}

/** Files of a committed ref, or of the working tree when `ref` is null. */
export function sourceReader(directory, ref) {
  if (ref === null) {
    const sha = git(directory, ['rev-parse', 'HEAD']).trim();
    return {
      label: 'working tree', sha,
      list: () => git(directory, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean)
        .filter((path) => existsSync(join(directory, path))),
      read: (paths) => new Map(paths.map((path) => [path, readFileSync(join(directory, path), 'utf8')])),
    };
  }
  const sha = git(directory, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  return {
    label: ref, sha,
    list: () => git(directory, ['ls-tree', '-r', '--name-only', sha]).split('\n').filter(Boolean),
    read: (paths) => readBlobs(directory, sha, paths),
  };
}

/** One `git cat-file --batch` process reads every blob; the output is size-prefixed, so bytes are sliced exactly. */
function readBlobs(directory, sha, paths) {
  const result = new Map();
  if (paths.length === 0) return result;
  const output = execFileSync('git', ['-C', directory, 'cat-file', '--batch'],
    { input: paths.map((path) => `${sha}:${path}`).join('\n') + '\n', maxBuffer });
  let offset = 0;
  for (const path of paths) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString('utf8').split(' ');
    if (header[1] !== 'blob') { offset = headerEnd + 1; continue; } // "missing" or a submodule entry
    const size = Number(header[2]);
    result.set(path, output.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8'));
    offset = headerEnd + 1 + size + 1;
  }
  return result;
}

/** Without --ref: the local branch whose source changed most recently. Commits touching only documents do not count. */
export function growingBranch(directory, roots) {
  const time = (args) => Number(git(directory, ['log', '-1', '--format=%ct', ...args]).trim() || 0);
  const branches = git(directory, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean);
  if (branches.length === 0) return 'HEAD';
  const ranked = branches.map((name) => ({ name, source: time([name, '--', ...roots]), any: time([name]) }))
    .sort((a, b) => b.source - a.source || b.any - a.any);
  return ranked[0].name;
}

/** Every local branch at the mapped commit, so a task branch and its parent branch both show. */
export function branchesAt(directory, sha) {
  return git(directory, ['branch', '--format=%(refname:short)', '--points-at', sha]).split('\n').filter(Boolean).join(', ');
}

export function lineCount(text) {
  if (text.length === 0) return 0;
  return text.split('\n').length - Number(text.endsWith('\n'));
}
