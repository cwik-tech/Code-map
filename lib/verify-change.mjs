// The change of a verification run, from the base to the head: the changed files that Git reports, the changed lines of the
// changed code files, a matcher for the allowed paths of a request, the origin of each new broken import and the test cases
// that the change removed or weakened.
// Read-only Git: a diff with the working tree runs on a private copy of the index (gitRead), and the reads of a split
// index use an unsplit copy (withUnsplitIndex). No project code runs.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createResolver } from './analyze.mjs';
import { diffLines } from './changed-coverage.mjs';
import { git, gitRead, lineCount } from './git.mjs';
import { isCode, isTest } from './project.mjs';

/** Git skipped its exhaustive rename detection (diff.renameLimit). This is the same check as in compare-git.mjs. */
const limitWarning = /renameLimit|rename detection was skipped|too many files/;
const plainStatuses = new Set(['A', 'M', 'D', 'T']);

/**
 * { files: [{ path, status, from }], complete } from `git diff -M --name-status -z`. `headSha` null compares with the
 * working tree and adds the untracked files that Git does not ignore. A copy is an added file, and another status (for
 * example an unmerged file) is a modification. `complete` is false when Git did not look for every rename.
 */
export function changedFiles(repository, baseSha, headSha) {
  const worktree = headSha === null;
  const { stdout, stderr } = gitRead(repository, ['diff', '-M', '--name-status', '-z', baseSha, ...(worktree ? [] : [headSha]), '--'], { worktree });
  const tokens = stdout.split('\0'), byPath = new Map();
  for (let index = 0; tokens[index];) {
    const letter = tokens[index][0];
    if (letter === 'R' || letter === 'C') {
      const from = tokens[index + 1], path = tokens[index + 2];
      byPath.set(path, letter === 'R' ? { path, status: 'R', from } : { path, status: 'A', from: null });
      index += 3;
    } else {
      byPath.set(tokens[index + 1], { path: tokens[index + 1], status: plainStatuses.has(letter) ? letter : 'M', from: null });
      index += 2;
    }
  }
  // A file that left only the index (git rm --cached) is a deletion in the diff and an untracked file on disk. Code-map
  // does not hash it, so it is a modification.
  if (worktree) for (const path of untracked(repository)) {
    const known = byPath.get(path);
    if (!known || known.status === 'D') byPath.set(path, { path, status: known ? 'M' : 'A', from: null });
  }
  return { files: [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1)), complete: !limitWarning.test(stderr) };
}

/**
 * Map(path -> line numbers) of the head lines that the change adds or modifies in each changed code file that is not a test.
 * `files` is the list of changedFiles. One `git diff -U0` without context, with fixed prefixes, without an external diff or text conversion, gives
 * the lines. For the working tree, a new file that Git does not track is not in that diff, so each of its lines is changed.
 */
export function changedLines(repository, baseSha, headSha, files, sourceFiles = new Set()) {
  const worktree = headSha === null, code = files.filter((file) => file.status !== 'D' && (isCode(file.path) && !isTest(file.path) || file.path.endsWith('.py') && sourceFiles.has(file.path)));
  if (!code.length) return new Map();
  // --inter-hunk-context=0 keeps the Git setting diff.interHunkContext from joining hunks with unchanged lines between them.
  const { stdout } = gitRead(repository, ['diff', '-M', '-U0', '--inter-hunk-context=0', '--no-color', '--no-ext-diff', '--no-textconv', '--submodule=short',
    '--src-prefix=a/', '--dst-prefix=b/', baseSha, ...(worktree ? [] : [headSha]), '--'], { worktree });
  const patch = diffLines(stdout), all = (path) => {
    const info = lstatSync(join(repository, path), { throwIfNoEntry: false });
    return info?.isFile() ? Array.from({ length: lineCount(readFileSync(join(repository, path), 'utf8')) }, (_, index) => index + 1) : [];
  };
  return new Map(code.map((file) => [file.path, patch.get(file.path) ?? (worktree && file.status === 'A' ? all(file.path) : [])]));
}

/** Untracked files that Git does not ignore. A name that ends with "/" is a nested repository, not a file. */
const untracked = (repository) => git(repository, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter((path) => path && !path.endsWith('/'));

/**
 * Runs `work` with GIT_INDEX_FILE set to a private copy of the index that is not split. Each time that Git reads a split
 * index, it sets the time of the shared index file in .git (sharedindex.*) to now. One `git update-index --no-split-index`
 * makes the copy in a private Git folder with copies of HEAD, the index and the shared index files, so Git sets the time
 * of a copy. The copy keeps the time of the index, because Git trusts stat data only for files that are older than the
 * index. Without shared index files, or when Git cannot make the copy, `work` reads the index of the repository.
 */
export function withUnsplitIndex(repository, work) {
  const [gitFolder, commonFolder, index] = git(repository, ['rev-parse', '--absolute-git-dir', '--git-common-dir', '--git-path', 'index']).trim().split('\n')
    .map((path) => resolve(repository, path));
  const shared = readdirSync(gitFolder).filter((name) => /^sharedindex\.[0-9a-f]+$/.test(name));
  if (!shared.length || !existsSync(index)) return work();
  const folder = mkdtempSync(join(tmpdir(), 'code-map-unsplit-')), copy = join(folder, 'index'), previous = process.env.GIT_INDEX_FILE;
  const cleanup = () => {
    if (previous === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = previous;
    rmSync(folder, { recursive: true, force: true });
  };
  try {
    try {
      for (const name of ['HEAD', ...shared]) copyFileSync(join(gitFolder, name), join(folder, name));
      const { atime, mtime } = statSync(index);
      copyFileSync(index, copy);
      utimesSync(copy, atime, mtime);
      execFileSync('git', ['-C', repository, '--no-optional-locks', '-c', 'core.fsmonitor=', '-c', 'core.splitIndex=false', '-c', `core.hooksPath=${join(folder, 'no-hooks')}`,
        'update-index', '--no-split-index'], { stdio: 'pipe', env: { ...process.env, GIT_DIR: folder, GIT_COMMON_DIR: commonFolder, GIT_WORK_TREE: repository, GIT_INDEX_FILE: copy } });
      process.env.GIT_INDEX_FILE = copy;
    } catch { /* No copy: the reads use the index of the repository, as for an index that is not split. */ }
    const result = work();
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) { cleanup(); throw error; }
}

/** Every path of a change and every rename source, sorted and without duplicates. */
export const changedPaths = (change) => [...new Set(change.files.flatMap((file) => (file.from ? [file.path, file.from] : [file.path])))].sort();

/** The glob matcher of the allowed paths. It is in lib/glob.mjs, because the layers and CODEOWNERS use it too. */
export { matchesGlob } from './glob.mjs';

/** A path of the base in head terms. A rename is { from, to } from gitRenames, or a file { path, from } from changedFiles. */
function forward(renames) {
  const moves = new Map(renames.filter((item) => item.from).map((item) => [item.from, item.to ?? item.path]));
  return (path) => moves.get(path) ?? path;
}
const pair = (...parts) => parts.join('\0');
/** Whether an import with this specifier in `path` can resolve to `target`. A package or alias specifier always can. */
const canResolveTo = (path, target, specifier) => typeof specifier !== 'string' || !specifier.startsWith('.')
  || createResolver(new Set([target]), { aliases: [], baseUrl: null })(path, specifier) === target;

/**
 * Map(headFindingId -> origin) for each NEW IMPORT-UNRESOLVED or IMPORT-NAME-MISSING finding of the head. 'lost-consumer':
 * the base had the same import, and it resolved there. 'new-import': the base had no such import. 'undecided': Code-map
 * cannot tell. Import edges include tests and package-root config files. Older analyses use export consumers for test imports.
 */
export function importOrigins(baseAnalysis, headFindings, labels, renames) {
  const rename = forward(renames), sources = new Map([...baseAnalysis.files, ...(baseAnalysis.importFiles ?? [])].map((file) => [rename(file.path), file]));
  const tests = new Set((baseAnalysis.tests?.testFiles ?? []).map((file) => rename(file.path)));
  const names = baseAnalysis.importNames ?? {};
  const missing = new Set((names.missing ?? []).map((item) => pair(rename(item.source), rename(item.target), item.name)));
  // An older analysis has no list of skipped imports. Then only an own export of the target shows that a name resolved.
  const skipped = names.skipped ? new Set(names.skipped.map((item) => pair(rename(item.source), rename(item.target)))) : null;
  const exported = (target, name) => sources.get(target)?.exports?.find((item) => item.name === name);
  const resolved = (path, target, name) => sources.has(target) && !missing.has(pair(path, target, name))
    && (exported(target, name) !== undefined || (skipped !== null && !skipped.has(pair(path, target))));
  const unresolvedOrigin = (path, specifier) => {
    const file = sources.get(path);
    if (!file) return tests.has(path) ? 'undecided' : 'new-import';
    const same = file.imports.filter((edge) => edge.specifier === specifier);
    return !same.length ? 'new-import' : same.some((edge) => edge.target !== null) ? 'lost-consumer' : 'undecided';
  };
  const nameOrigin = (path, target, name) => {
    const file = sources.get(path);
    if (!file && tests.has(path)) return (exported(target, name)?.consumers ?? []).some((consumer) => rename(consumer) === path) ? 'lost-consumer' : 'undecided';
    if (!file) return 'new-import';
    const named = file.imports.filter((edge) => [...(edge.typeNames ?? []), ...(edge.valueNames ?? [])].includes(name));
    if (named.some((edge) => edge.target !== null && rename(edge.target) === target)) return resolved(path, target, name) ? 'lost-consumer' : 'undecided';
    // The base imported the name from another file or from no file. The specifier can be the same if it now resolves to the target.
    return named.some((edge) => canResolveTo(path, target, edge.specifier)) ? 'undecided' : 'new-import';
  };
  const origins = new Map();
  for (const finding of headFindings) {
    if (labels[finding.id] !== 'NEW') continue;
    if (finding.ruleId === 'IMPORT-UNRESOLVED') origins.set(finding.id, unresolvedOrigin(finding.key[0], finding.key[1]));
    if (finding.ruleId === 'IMPORT-NAME-MISSING') origins.set(finding.id, nameOrigin(...finding.key));
  }
  return origins;
}

const weakeningRules = new Set(['TEST-PARKED', 'TEST-NO-ASSERTIONS', 'TEST-SWALLOWED-ERROR']);

/** The identity of each test case, as in its finding keys: the path, the suite, the name and the ordinal among the same names in the file. */
export function caseIdentities(cases, rename) {
  const seen = new Map();
  return cases.map((item) => {
    const name = JSON.stringify([item.path, item.suite ?? '', item.name]), ordinal = seen.get(name) ?? 0;
    seen.set(name, ordinal + 1);
    return { item, id: JSON.stringify([rename(item.path), item.suite ?? '', item.name, ordinal]) };
  });
}

/**
 * The test cases that the change removed or weakened. `removed`: the active or focused base cases whose identity (after the
 * renames) is not in the head, with their base path and line. An unreadable head path gives no removal conclusion. `weakened`: the NEW head findings that park a case, leave
 * it without an assertion or ignore its errors, for a case that the base had. A case that the change added is never weakened.
 */
export function testWeakening(baseAnalysis, headAnalysis, renames, labels, headFindings) {
  const rename = forward(renames), unreadable = new Set(headAnalysis.tests?.unreadable ?? []);
  const base = caseIdentities(baseAnalysis.tests?.cases ?? [], rename), known = new Set(base.map((entry) => entry.id));
  const head = new Set(caseIdentities(headAnalysis.tests?.cases ?? [], (path) => path).map((entry) => entry.id));
  const previous = new Map(base.map(({ id, item }) => [id, item]));
  const expectedFailures = caseIdentities(headAnalysis.tests?.cases ?? [], (path) => path)
    .filter(({ id, item }) => previous.has(id) && !previous.get(id).expectedFailure && item.expectedFailure)
    .map(({ item }) => ({ path: item.path, suite: item.suite, name: item.name, line: item.line }));
  return {
    expectedFailures,
    removed: base.filter(({ item, id }) => ['active', 'focused', 'expected-failure'].includes(item.status) && !head.has(id) && !unreadable.has(rename(item.path)))
      .map(({ item }) => ({ path: item.path, suite: item.suite, name: item.name, line: item.line })),
    weakened: headFindings.filter((finding) => weakeningRules.has(finding.ruleId) && labels[finding.id] === 'NEW' && known.has(JSON.stringify(finding.key)))
      .map((finding) => ({ findingId: finding.id, ruleId: finding.ruleId, path: finding.key[0], name: finding.key[2] })),
  };
}

/** The bounded source patch for informational coverage comparison. Git uses the same read-only index handling as changedLines. */
export function coveragePatch(repository, baseSha, headSha) {
  const worktree = headSha === null;
  return gitRead(repository, ['diff', '-M', '-U0', '--inter-hunk-context=0', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', baseSha, ...(worktree ? [] : [headSha]), '--'], { worktree }).stdout;
}
