// Which source files recent work changed, for the blast radius of a change. Read-only Git.
import { git } from './git.mjs';

const maxCommits = 30;

/**
 * The last commits of the mapped branch with the source files each one changed, plus (when there is one) the files
 * changed since the branch left main/master, and uncommitted changes when the working tree is mapped.
 */
export function readChanges(repository, sha, roots, keep, worktree) {
  const pathspec = roots.includes('.') ? [] : ['--', ...roots];
  const commits = recentCommits(repository, sha, pathspec, keep);
  const base = baseChanges(repository, sha, pathspec, keep);
  let uncommitted = null;
  if (worktree) {
    const tracked = lines(tryGit(repository, ['diff', '--name-only', 'HEAD', ...pathspec]));
    const untracked = lines(tryGit(repository, ['ls-files', '--others', '--exclude-standard', ...pathspec]));
    uncommitted = [...new Set([...tracked, ...untracked])].filter(keep).sort();
  }
  return { commits, base, uncommitted };
}

function recentCommits(repository, sha, pathspec, keep) {
  const args = ['log', '--first-parent', '-n', String(maxCommits), '--name-only', '--format=%x00%H%x09%cI%x09%s'];
  let output = tryGit(repository, [...args.slice(0, 1), '--diff-merges=first-parent', ...args.slice(1), sha, ...pathspec]);
  if (output === null) output = tryGit(repository, [...args, sha, ...pathspec]) ?? '';
  return output.split('\0').filter((chunk) => chunk.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [commit, date, ...subject] = head.split('\t');
    return { sha: commit.slice(0, 10), date, subject: subject.join('\t'), files: [...new Set(rest.filter(Boolean).filter(keep))] };
  }).filter((commit) => commit.files.length > 0);
}

/** Files changed since the mapped commit split from the main branch; null when there is no main branch or no split. */
function baseChanges(repository, sha, pathspec, keep) {
  for (const name of ['main', 'master', 'origin/main', 'origin/master']) {
    const target = tryGit(repository, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`])?.trim();
    if (!target) continue;
    if (target === sha) return null;
    const fork = tryGit(repository, ['merge-base', target, sha])?.trim();
    if (!fork || fork === sha) return null;
    const count = Number(tryGit(repository, ['rev-list', '--count', '--first-parent', `${fork}..${sha}`])?.trim() || 0);
    const files = lines(tryGit(repository, ['diff', '--name-only', fork, sha, ...pathspec])).filter(keep).sort();
    return { name, fork: fork.slice(0, 10), commits: count, files };
  }
  return null;
}

function tryGit(repository, args) { try { return git(repository, args); } catch { return null; } }
function lines(text) { return (text ?? '').split('\n').filter(Boolean); }

/**
 * How often each source file changed, and which files changed in the same commits (change coupling).
 * Bulk commits (formatting, renames, many files at once) are skipped because they couple everything with everything.
 */
export function readCoChanges(repository, sha, roots, keep, known) {
  const pathspec = roots.includes('.') ? [] : ['--', ...roots];
  const output = tryGit(repository, ['log', '--no-merges', '-n', '3000', '--name-only', '--format=%x00', sha, ...pathspec]) ?? '';
  const changes = new Map(), shared = new Map();
  for (const chunk of output.split('\0')) {
    const files = [...new Set(chunk.split('\n').filter((path) => path && keep(path) && known.has(path)))];
    if (files.length === 0) continue;
    for (const path of files) changes.set(path, (changes.get(path) ?? 0) + 1);
    if (files.length > 25) continue;
    for (const a of files) for (const b of files) {
      if (a >= b) continue;
      const key = a + '\n' + b;
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const partners = new Map();
  for (const [key, count] of shared) {
    if (count < 3) continue;
    const [a, b] = key.split('\n');
    for (const [x, y] of [[a, b], [b, a]]) {
      if (count / changes.get(x) < 0.3) continue;
      if (!partners.has(x)) partners.set(x, []);
      partners.get(x).push([y, count]);
    }
  }
  for (const list of partners.values()) list.sort((p, q) => q[1] - p[1]).splice(8);
  return { changes: Object.fromEntries(changes), partners: Object.fromEntries(partners) };
}

const fixWindow = 100;
const fixSubject = /\b(fix|fixes|fixed|fixing|bug|bugfix|hotfix|regression|repair|repairs|repaired)\b/i;

/**
 * Bug-fix commits among the last commits of the mapped branch, with the source and test files each one changed.
 * A fix is recognised by its subject only; a regression test added in a later commit is not linked to its fix.
 */
export function readFixCommits(repository, sha, keep, isTest) {
  const output = tryGit(repository, ['log', '--no-merges', '-n', String(fixWindow), '--name-only', '--format=%x00%H%x09%cI%x09%s', sha]) ?? '';
  const chunks = output.split('\0').filter((chunk) => chunk.trim());
  const commits = chunks.map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [commit, date, ...subject] = head.split('\t');
    const files = [...new Set(rest.filter(Boolean))];
    return { sha: commit.slice(0, 10), date, subject: subject.join('\t'), sources: files.filter(keep).sort(), tests: files.filter(isTest).sort() };
  });
  return { window: fixWindow, scanned: commits.length, commits: commits.filter((commit) => fixSubject.test(commit.subject) && commit.sources.length > 0) };
}
