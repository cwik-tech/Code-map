// Read-only Git access. Nothing here writes to the repository or its .git folder: a command that compares with the
// working tree gets a private copy of the index (gitRead). Path names stay as Git stores them: with -z where the command
// has it, else with core.quotePath=false and unquotePath for the names that Git still quotes.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const maxBuffer = 1024 * 1024 * 1024;
/** No optional locks, no file system monitor (its daemon keeps files in .git; an empty value is off in every Git version),
 * and non-ASCII names as UTF-8. */
const readOnly = ['--no-optional-locks', '-c', 'core.fsmonitor=', '-c', 'core.quotePath=false'];

export function git(directory, args, input) {
  return execFileSync('git', ['-C', directory, ...readOnly, ...args], { encoding: 'utf8', maxBuffer, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The output of a Git command as bytes, for blob contents that are not text. */
export function gitBytes(directory, args, input) {
  return execFileSync('git', ['-C', directory, ...readOnly, ...args], { maxBuffer, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * stdout and stderr of a Git command, with messages in English so that a warning can be matched. With `worktree` the
 * command compares with the working tree: Git then refreshes the stat data and writes the index, also with
 * --no-optional-locks, so the command gets a private copy of the index. Hooks and the split index are off for it,
 * because a write of the copy runs the post-index-change hook and can change the shared index files in .git.
 */
export function gitRead(directory, args, { worktree = false } = {}) {
  const folder = worktree ? mkdtempSync(join(tmpdir(), 'code-map-index-')) : null;
  try {
    const env = { ...process.env, LC_ALL: 'C' }, options = [];
    if (folder) {
      env.GIT_INDEX_FILE = privateIndex(directory, folder);
      options.push('-c', 'core.splitIndex=false', '-c', `core.hooksPath=${join(folder, 'no-hooks')}`);
    }
    const result = spawnSync('git', ['-C', directory, ...readOnly, ...options, ...args], { encoding: 'utf8', maxBuffer, env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return { stdout: result.stdout, stderr: result.stderr };
  } finally {
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
}

/** The copy keeps the time of the index, because Git trusts stat data only for files that are older than the index. */
function privateIndex(directory, folder) {
  const index = resolve(directory, git(directory, ['rev-parse', '--git-path', 'index']).trim()), copy = join(folder, 'index');
  if (existsSync(index)) {
    const { atime, mtime } = statSync(index);
    copyFileSync(index, copy);
    utimesSync(copy, atime, mtime); // a Date has whole milliseconds, so the copy is never newer than the index
    // Reconcile hidden edits on the private index. Keep absent sparse-checkout paths skipped.
    const hidden = git(directory, ['ls-files', '-v', '-z']).split('\0').filter(Boolean)
      .filter((entry) => /^[a-zS]/.test(entry) && (entry[0].toUpperCase() !== 'S' || existsSync(join(directory, entry.slice(2)))))
      .map((entry) => entry.slice(2));
    // Git clears one flag at a time when these options appear together.
    if (hidden.length) for (const flag of ['--no-assume-unchanged', '--no-skip-worktree']) {
      execFileSync('git', ['-C', directory, ...readOnly, '-c', 'core.splitIndex=false',
        '-c', `core.hooksPath=${join(folder, 'no-hooks')}`, 'update-index', flag, '-z', '--stdin'],
      { input: hidden.join('\0') + '\0', env: { ...process.env, GIT_INDEX_FILE: copy }, stdio: 'pipe' });
    }
  }
  return copy;
}

const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** A name that Git printed in C-style quotes ("q\"x", "z\303\251") as the name itself. Other text stays as it is. */
export function unquotePath(text) {
  if (text.length < 2 || text[0] !== '"' || text.at(-1) !== '"') return text;
  const body = Buffer.from(text.slice(1, -1), 'utf8'), bytes = [];
  for (let index = 0; index < body.length; index++) {
    if (body[index] !== 0x5c) { bytes.push(body[index]); continue; }
    const next = String.fromCharCode(body[++index]);
    if (/[0-7]/.test(next)) { bytes.push(parseInt(body.subarray(index, index + 3).toString(), 8)); index += 2; }
    else bytes.push(escapes[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

export function repositoryRoot(directory) {
  return git(directory, ['rev-parse', '--show-toplevel']).trim();
}

const names = (text) => text.split('\0').filter(Boolean);

/** Files of a committed ref, or of the working tree when `ref` is null. */
/** The blob reader sends one name for each line, so a name with a line break is left out of the map. */
const readable = (path) => !/[\n\r]/.test(path);

/**
 * `stat(paths)` gives `{ link, file, size }` for each path that exists, and it reads no content: `link` for a symlink and
 * `file` for a regular file. Thus a caller can refuse a symlink or a large file before it reads the file.
 */
export function sourceReader(directory, ref) {
  if (ref === null) {
    const sha = git(directory, ['rev-parse', 'HEAD']).trim();
    const info = (path) => { try { const item = lstatSync(join(directory, path)); return [[path, { link: item.isSymbolicLink(), file: item.isFile(), size: item.size }]]; } catch { return []; } };
    return {
      label: 'working tree', sha,
      list: () => names(git(directory, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
        .filter((path) => readable(path) && existsSync(join(directory, path))),
      read: (paths) => new Map(paths.map((path) => [path, readFileSync(join(directory, path), 'utf8')])),
      stat: (paths) => new Map(paths.flatMap(info)),
    };
  }
  const sha = git(directory, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  return {
    label: ref, sha,
    list: () => names(git(directory, ['ls-tree', '-r', '-z', '--name-only', sha])).filter(readable),
    read: (paths) => readBlobs(directory, sha, paths),
    stat: (paths) => new Map(!paths.length ? [] : names(git(directory, ['--literal-pathspecs', 'ls-tree', '-l', '-z', sha, '--', ...paths])).map((line) => {
      const tab = line.indexOf('\t'), [mode, type, , size] = line.slice(0, tab).trim().split(/\s+/);
      return [line.slice(tab + 1), { link: mode === '120000', file: type === 'blob' && mode.startsWith('100'), size: Number(size) }];
    })),
  };
}

/** One `git cat-file --batch` process reads every blob; the output is size-prefixed, so bytes are sliced exactly. */
function readBlobs(directory, sha, paths) {
  const result = new Map();
  if (paths.length === 0) return result;
  const output = execFileSync('git', ['-C', directory, ...readOnly, 'cat-file', '--batch'],
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
  // The full ref name and the separator keep a branch with the name of a folder (for example electron) from being read as a path.
  const ranked = branches.map((name) => ({ name, source: time([`refs/heads/${name}`, '--', ...roots]), any: time([`refs/heads/${name}`, '--']) }))
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
