// The inputs that decide an analysis, and the analysis ID that hashes them. Same inputs, same ID, so a stored analysis
// can be reused, and a follow-up can tell when the code changed. Read-only: Git runs with --no-optional-locks, so it
// does not refresh the index, and file contents are hashed in Node. Nothing is written to the repository.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { protocolPath, deploymentPath, examplePath } from './contracts/inputs.mjs';
import { contractKind } from './contracts/openapi.mjs';
import { codeownersPaths } from './codeowners.mjs';
import { coverageFile } from './coverage.mjs';
import { git, sourceReader } from './git.mjs';
import { readPythonInputs } from './python/inputs.mjs';
import { installedPythonDistributions } from './python/installed.mjs';
import { findInterpreter } from './python/interpreter.mjs';
import { envTemplates } from './frameworks/env.mjs';
import { isStyle } from './packages/styles.mjs';
import { isDeclaration, isPackageConfig } from './packages/manifests.mjs';
import { packageInstallState } from './packages/state.mjs';
import { ignored, isCode } from './project.mjs';
import { triageFile } from './triage.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const tryGit = (repository, args) => { try { return git(repository, args); } catch { return null; } };

/** Key order does not change the hash. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const analysisId = (inputs) => `A-${sha256(canonical(identity(inputs))).slice(0, 16)}`;

/** The inputs without the content digest of the working tree. That digest binds run manifests only, so an edit of an unread file keeps the ID. */
function identity(inputs) {
  if (!inputs.worktree) return inputs;
  const { contentDigest: _, ...worktree } = inputs.worktree;
  return { ...inputs, worktree };
}

/** `ref` is the ref that the collector maps (from selectRef), or null for the working tree. */
export function analysisInputs(repository, config, options, ref) {
  const sha = git(repository, ['rev-parse', '--verify', `${ref ?? 'HEAD'}^{commit}`]).trim();
  const labels = resolve(repository, options.labels ?? config.testLabels), coverage = coverageFile(repository, config);
  const reader = sourceReader(repository, ref), paths = reader.list(), hasPython = paths.some((p) => /\.pyi?$/.test(p) && !ignored(p));
  const packaging = hasPython ? readPythonInputs(paths, reader) : null;
  return {
    manifestVersion: 1, repository,
    ...(hasPython ? { python: findInterpreter(config.python?.interpreter, repository), pythonInstalled: installedPythonDistributions(repository),
      pythonPackaging: sha256(canonical({ texts: [...packaging.texts], unknown: packaging.unknown })) } : {}),
    ...(options.types || config.typeCheck ? { typed: { budgetMs: config.typeBudgetMs ?? 60000 } } : {}),
    selector: { worktree: !!options.worktree, ref: options.worktree ? null : (options.ref ?? null) }, mapped: ref, sha,
    worktree: options.worktree ? worktreeState(repository, config, sha) : null,
    history: history(repository),
    baseBranch: baseBranch(repository),
    config: sha256(canonical(config)),
    labels: { path: relative(repository, labels), digest: existsSync(labels) ? sha256(readFileSync(labels)) : null },
    coverage: coverage ? { path: coverage, digest: sha256(readFileSync(resolve(repository, coverage))), mtime: statSync(resolve(repository, coverage)).mtime.toISOString() } : null,
    analyzer: analyzer(),
    lockfile: lockfile(repository, options.worktree ? null : sha),
    installed: packageInstallState(repository, options.worktree ? null : sha),
  };
}

/** Entries of `git status --porcelain=v1 -z`. A rename or a copy, in either status column, has its original path as the next field. */
export function parseStatus(text) {
  const tokens = text.split('\0'), entries = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.length < 4) continue;
    const status = token.slice(0, 2);
    entries.push({ status, path: token.slice(3), from: /[RC]/.test(status) ? tokens[++index] ?? null : null });
  }
  return entries;
}

/**
 * What the working-tree analysis can see beyond its commit. Each path that differs from the commit is described by itself,
 * not by the index columns of `git status`, so a `git add` without an edit keeps the ID. The collector reads code files, JSON
 * files, declaration files, package config files, Prisma files and the names in env template files, so their content counts. For any other file only its presence counts (an import
 * can resolve to it), so an edit of .env or of a generated page does not change the ID. A tracked symlink to a read file counts with the content it points
 * to, because the collector follows it. Env template and contract symlinks count only as links. The collector does not follow them. `contentDigest` excludes secret env files and template and contract symlink targets. Other changed files count because test results also
 * depend on snapshots and fixtures. It binds run manifests and is not part of the ID. Ignored files are left out, as in the map.
 * The collector also reads schema contracts, deployment names, checked Markdown and the CODEOWNERS file, so its content counts too.
 * The triage file is not an input of the analysis, so only `contentDigest` counts it.
 */
function worktreeState(repository, config, sha) {
  const template = (path) => envTemplates.includes(path.split('/').at(-1));
  const privateLink = (path) => path.endsWith('.sql') || template(path) || protocolPath(path) || deploymentPath(path) || examplePath(path) || contractKind(path) !== null || isStyle(path);
  const secret = (path) => /^\.env(?:\.|$)/.test(path.split('/').at(-1)) && !template(path);
  const link = (path) => { try { return lstatSync(join(repository, path)).isSymbolicLink(); } catch { return false; } };
  const read = (path) => /(?:^|\/)(?:requirements[^/]*\.txt|uv\.lock|poetry\.lock|Pipfile(?:\.lock)?)$/.test(path) && !ignored(path) || /\.pyi?$/.test(path) && !ignored(path) || ['pyproject.toml', 'pytest.ini', 'setup.cfg'].includes(path) || isCode(path) || protocolPath(path) || deploymentPath(path) || examplePath(path) || isStyle(path) || isDeclaration(path) || (isPackageConfig(path) && !ignored(path)) || /\.(?:jsonc?|prisma|sql)$/.test(path) || path === config.budgetsFrom || codeownersPaths.includes(path) || (template(path) && !link(path));
  const committed = new Map(), paths = new Set(), entries = new Map(), contents = [];
  for (const line of git(repository, ['--no-optional-locks', 'ls-tree', '-r', '-z', '--full-tree', sha]).split('\0')) {
    const tab = line.indexOf('\t'), [mode, , oid] = line.slice(0, tab).split(' ');
    if (tab > 0) committed.set(line.slice(tab + 1), { mode, oid });
  }
  for (const { path, from } of parseStatus(git(repository, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']))) {
    paths.add(path);
    if (from !== null) paths.add(from);
  }
  // `git status` does not look at a file marked assume-unchanged (a lowercase tag) or skip-worktree (S), so such a file is compared here.
  for (const line of git(repository, ['--no-optional-locks', 'ls-files', '-v', '-z']).split('\0')) if (/^[a-zS] /.test(line)) paths.add(line.slice(2));
  for (const path of [...paths].sort()) {
    const before = committed.get(path);
    if (secret(path)) {
      if (existsSync(join(repository, path)) !== (before !== undefined)) entries.set(path, `${path}\0${before ? 'deleted' : 'added'}`);
      continue;
    }
    const now = difference(repository, path, before, privateLink(path));
    if (now !== null) contents.push(`${path}\0${now}`);
    if (path === triageFile) continue;
    if (read(path)) { if (now !== null) entries.set(path, `${path}\0${now}`); }
    else if (template(path) && link(path) && now !== null) entries.set(path, `${path}\0symlink`);
    else if (existsSync(join(repository, path)) !== (before !== undefined)) entries.set(path, `${path}\0${before ? 'deleted' : 'added'}`);
  }
  // A tracked symlink shows the content of its target. A committed target counts through its own status, so only a target
  // that the commit does not hold (ignored, untracked or outside the repository) counts here, in both digests.
  for (const [path, { mode }] of committed) {
    if (secret(path) || privateLink(path) || mode !== '120000' || paths.has(path) || !outsideCommit(repository, path, committed)) continue;
    // A broken link is the same broken link that the commit holds, for example in a fresh clone without the ignored target.
    if (!existsSync(join(repository, path))) continue;
    const line = `${path}\0${contentHash(join(repository, path))}`;
    contents.push(line);
    if (read(path) && path !== triageFile) entries.set(path, line);
  }
  const lines = [...entries.values()].sort(), digest = (list) => list.length ? sha256(list.join('\n')) : null;
  // A clean working tree is its commit, so it has no digest, as in a run manifest of that commit.
  return { digest: digest(lines), entries: lines.length, contentDigest: digest(contents) };
}

/** What is at the path now, or null when it is the same as in the commit. A file with the Git blob ID of the commit is the same. */
function difference(repository, path, before, protectLink = false) {
  const full = join(repository, path);
  if (protectLink) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) {
      const parent = join(repository, ...parts.slice(0, index));
      try { if (lstatSync(parent).isSymbolicLink()) return `ancestor-link:${sha256(readlinkSync(parent))}`; }
      catch { return before ? 'deleted' : null; }
    }
  }
  let info;
  try { info = lstatSync(full); } catch { return before ? 'deleted' : null; }
  if (protectLink && info.isSymbolicLink()) {
    const target = readlinkSync(full), blob = createHash(before?.oid.length === 64 ? 'sha256' : 'sha1').update(`blob ${Buffer.byteLength(target)}\0${target}`).digest('hex');
    return before?.mode === '120000' && blob === before.oid ? null : `link:${sha256(target)}`;
  }
  if (!info.isFile()) return contentHash(full);
  const { content, blob } = fileHashes(full, before?.oid.length === 64 ? 'sha256' : 'sha1');
  return before?.mode.startsWith('100') && blob === before.oid ? null : content;
}

function outsideCommit(repository, path, committed) {
  let target;
  try { target = realpathSync(join(repository, path)); } catch { return true; } // a broken link
  const inside = relative(realpathSync(repository), target), key = inside.split(sep).join('/');
  if (inside.startsWith('..') || isAbsolute(inside)) return true;
  // A link to a committed folder is inside the commit: the files of the folder count through their own status.
  return !committed.has(key) && ![...committed.keys()].some((path) => path.startsWith(`${key}/`));
}

function contentHash(path) {
  let info;
  try { info = lstatSync(path); } catch { return 'deleted'; }
  if (!info.isSymbolicLink()) return info.isFile() ? fileHashes(path).content : 'not-a-file';
  const target = existsSync(path) && statSync(path).isFile() ? fileHashes(path).content : 'none';
  return `link:${sha256(readlinkSync(path))}:${target}`;
}

/** The SHA-256 of a file and its Git blob ID. It reads in parts, so a large untracked file does not fill the memory. */
function fileHashes(path, algorithm = 'sha1') {
  const descriptor = openSync(path, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const content = createHash('sha256'), blob = createHash(algorithm).update(`blob ${fstatSync(descriptor).size}\0`);
    for (let size; (size = readSync(descriptor, buffer)) > 0;) { content.update(buffer.subarray(0, size)); blob.update(buffer.subarray(0, size)); }
    return { content: content.digest('hex'), blob: blob.digest('hex') };
  } finally { closeSync(descriptor); }
}

/**
 * How much history Git shows, and in which form. A shallow clone shows only part of it; grafts and replace refs change the
 * parents that Git shows. The co-change, hotspot and fix findings come from that history.
 */
function history(repository) {
  const [shallow, boundary, grafts] = git(repository, ['rev-parse', '--is-shallow-repository', '--git-path', 'shallow', '--git-path', 'info/grafts']).split('\n');
  const digestOf = (file) => { const path = resolve(repository, file); return existsSync(path) ? sha256(readFileSync(path)) : null; };
  const replaced = git(repository, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/replace/']);
  return { shallow: shallow === 'true', boundary: digestOf(boundary), grafts: digestOf(grafts), replace: replaced ? sha256(replaced) : null };
}

/** The branch that `--change branch` compares with: the first of these that exists, as in lib/changes.mjs. */
function baseBranch(repository) {
  for (const name of ['main', 'master', 'origin/main', 'origin/master']) {
    const sha = tryGit(repository, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`])?.trim();
    if (sha) return { name, sha };
  }
  return null;
}

/** The root lockfile and the SHA-256 of its content, from the working tree or from the commit. Run manifests use the same digest. */
function lockfile(repository, sha) {
  for (const path of lockfiles) {
    if (sha === null && existsSync(join(repository, path))) return { path, digest: sha256(readFileSync(join(repository, path))) };
    if (sha === null || !tryGit(repository, ['rev-parse', '--verify', '--quiet', `${sha}:${path}`])) continue;
    return { path, digest: sha256(execFileSync('git', ['-C', repository, 'cat-file', 'blob', `${sha}:${path}`], { maxBuffer: 1024 * 1024 * 1024 })) };
  }
  return null;
}

let analyzerCache = null;
/** The analyzer's own version: package version, a hash of its source files, and the TypeScript and Node versions. */
export function analyzer() {
  if (analyzerCache) return analyzerCache;
  const home = new URL('..', import.meta.url), hash = createHash('sha256');
  const files = (folder) => readdirSync(new URL(folder, home), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${folder}${entry.name}/`) : (/\.(mjs|py)$/.test(entry.name)) ? [`${folder}${entry.name}`] : []);
  for (const path of ['package.json', ...files('lib/'), ...files('bin/')].sort()) hash.update(`${path}\0`).update(readFileSync(new URL(path, home))).update('\0');
  const { version } = JSON.parse(readFileSync(new URL('package.json', home), 'utf8'));
  analyzerCache = { version, source: hash.digest('hex'), typescript: ts.version, node: process.versions.node };
  return analyzerCache;
}

/** The kinds of input that differ between two manifests, for a freshness check. */
export function changedInputs(stored, current) {
  const same = (a, b) => canonical(a) === canonical(b);
  const kinds = [['commit', (m) => [m.mapped, m.sha]], ['history', (m) => m.history], ['worktree', (m) => identity(m).worktree], ['base-branch', (m) => m.baseBranch], ['config', (m) => m.config],
    ['typed', (m) => m.typed ?? null], ['labels', (m) => m.labels], ['coverage', (m) => m.coverage], ['lockfile', (m) => m.lockfile], ['installed', (m) => m.installed ?? null],
    ['analyzer', (m) => [m.analyzer.version, m.analyzer.source]], ['environment', (m) => [m.analyzer.typescript, m.analyzer.node, m.python ?? null]]];
  return kinds.filter(([, pick]) => !same(pick(stored), pick(current))).map(([kind]) => kind);
}
