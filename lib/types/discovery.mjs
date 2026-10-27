// Compiler file discovery is information. It never changes an accepted profile result.
import { posix } from 'node:path';

/** Parses one path per line from tsc --listFilesOnly. Rejects diagnostics and relative traversal. */
export function parseTscFiles(text, { repository, workingDirectory = '.' } = {}) {
  const files = [], root = repository?.replaceAll('\\', '/').replace(/\/$/, '');
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    if (/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(line) || !/\.[cm]?[jt]sx?$/.test(line) || /^(?:error |.*\): error TS)/.test(line)) return { ok: false, error: 'Invalid tsc file list.' };
    const path = posix.normalize(line.replaceAll('\\', '/'));
    if (posix.isAbsolute(path) || /^[A-Za-z]:\//.test(path)) {
      if (root && path.startsWith(`${root}/`)) files.push(posix.normalize(path.slice(root.length + 1)));
    } else {
      const normalized = posix.normalize(posix.join(workingDirectory, path));
      if (normalized.startsWith('../') || normalized === '..') return { ok: false, error: 'File list leaves the repository.' };
      files.push(normalized);
    }
  }
  return { ok: true, files: [...new Set(files)].sort() };
}
/** UNKNOWN includes each changed code file absent from all complete programs and bound file lists. */
export function compilerCoverage(changed, typed, reports) {
  const checked = new Set([...(typed?.programs ?? []).filter((program) => program.state === 'COMPLETE').flatMap((program) => program.files),
    ...reports.flatMap((report) => report.files ?? [])]);
  const unchecked = changed.filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !checked.has(path)).sort();
  return { state: unchecked.length || (!typed && !reports.length) ? 'UNKNOWN' : 'KNOWN', unchecked, checked: [...checked].sort() };
}
