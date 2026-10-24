// The test changes of a verification run that need the texts of the base and the head (C27): weaker assertions in the test
// cases that the change kept (lib/assertion-compare.mjs), and weaker runner settings (lib/runner-config.mjs). It reads only the
// changed test files and runner configuration files, from Git or from the working tree. Nothing runs, and nothing is written.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareTestFile } from './assertion-compare.mjs';
import { readReviewTarget } from './weakening-files.mjs';
import { reviewDigest, reviewWeakening } from './weakening-reviews.mjs';
import { sourceReader } from './git.mjs';
import { compareRunnerFile, runnerKind } from './runner-config.mjs';

/** Code-map compares a file of at most 4 MiB. Comparison lists keep at most 50 entries, with totals. Reviews retain every entry. */
const maxFileBytes = 4 * 1024 * 1024, shown = 50;

/** Map(path -> text) of a commit, or of the working tree when `sha` is null. A missing, large or unreadable file has no entry. */
function texts(repository, sha, paths) {
  paths = paths.filter((path) => !/[\n\r]/.test(path)); // the blob reader reads one name for each line
  if (!paths.length) return new Map();
  if (sha !== null) return new Map([...sourceReader(repository, sha).read(paths)].filter(([, text]) => Buffer.byteLength(text, 'utf8') <= maxFileBytes));
  const read = (path) => {
    try { const info = lstatSync(join(repository, path)); return info.isFile() && info.size <= maxFileBytes ? readFileSync(join(repository, path), 'utf8') : undefined; } catch { return undefined; }
  };
  return new Map(paths.map((path) => [path, read(path)]).filter(([, text]) => text !== undefined));
}

/**
 * `assertionWeakening`: the weakening entries of the kept test cases in each changed test file that the base and the head
 * analyses scan, with `files` (the compared files) and `unread` (the files that Code-map cannot read). `runnerSettings`: the
 * comparison of each changed runner configuration file, with the number of files in each state. `headSha` null is the working tree.
 */
export function testChanges(repository, { baseSha, headSha, change, baseAnalysis, headAnalysis }) {
  const scanned = (analysis) => new Set((analysis.tests?.testFiles ?? []).filter((file) => file.kind === 'tests').map((file) => file.path));
  const baseTests = scanned(baseAnalysis), headTests = scanned(headAnalysis), basePath = (file) => file.from ?? file.path;
  const kept = change.files.filter((file) => file.status !== 'A' && file.status !== 'D' && headTests.has(file.path) && baseTests.has(basePath(file)));
  const configs = change.files.filter((file) => runnerKind(file.path) || runnerKind(basePath(file)));
  const before = texts(repository, baseSha, [...new Set([...kept, ...configs].filter((file) => file.status !== 'A').map(basePath))]);
  const after = texts(repository, headSha, [...new Set([...kept, ...configs].filter((file) => file.status !== 'D').map((file) => file.path))]);
  const entries = [], unread = [];
  for (const file of kept) {
    const baseText = before.get(basePath(file)), headText = after.get(file.path);
    let found = null;
    // A text that the parser cannot hold, for example one with very deep nesting, counts as unread.
    if (baseText !== undefined && headText !== undefined) try { found = compareTestFile({ basePath: basePath(file), baseText, headPath: file.path, headText }); } catch { found = null; }
    if (found === null) unread.push(file.path);
    else for (const entry of found) entries.push(entry);
  }
  const runner = configs.map((file) => compareRunnerFile({ path: file.path, basePath: basePath(file),
    baseText: file.status === 'A' ? null : before.get(basePath(file)), headText: file.status === 'D' ? null : after.get(file.path) })).filter(Boolean);
  const count = (state) => runner.filter((entry) => entry.state === state).length;
  const digests = new Map();
  const digestOf = (path) => {
    if (digests.has(path)) return digests.get(path);
    if (change.files.some((file) => file.path === path && file.status === 'D')) return reviewDigest('code-map:missing-file');
    const bytes = readReviewTarget(repository, headSha, path);
    const digest = bytes === null ? null : reviewDigest(bytes);
    digests.set(path, digest);
    return digest;
  };
  const reviewEntries = [
    ...entries.map((entry) => ({ ...entry, type: 'assertion', digest: digestOf(entry.path) })),
    ...runner.flatMap((entry) => entry.changes.map((setting) => ({
      id: `weakening:${reviewDigest(JSON.stringify([entry.basePath, entry.runner, setting]))}`,
      type: 'runner', deleted: change.files.some((file) => file.path === entry.path && file.status === 'D'), path: entry.path, basePath: entry.basePath, kind: setting.change, setting: setting.setting,
      base: setting.base, head: setting.head, digest: digestOf(entry.path),
    }))),
  ];
  const reviews = { ...reviewWeakening(repository, reviewEntries), incomplete: runner.some((entry) => entry.state === 'UNKNOWN' || entry.unknown.length > 0) };
  return {
    reviews,
    assertionWeakening: { files: kept.length - unread.length, total: entries.length, entries: entries.slice(0, shown), unread: unread.slice(0, shown) },
    runnerSettings: { files: runner.length, weaker: count('WEAKER'), unknown: count('UNKNOWN'), entries: runner.slice(0, shown) },
  };
}
