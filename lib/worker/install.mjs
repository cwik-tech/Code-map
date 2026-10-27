// Explicit offline installation policy and bounded execution phases.
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { collectArtifact } from './workspace.mjs';
import { commandProblem } from './command.mjs';
import { isRelativePath } from '../adapters/run-manifest.mjs';
import { isInside, realPath } from '../inspect.mjs';

/** Validates paired install options without reading the cache. */
export function installProblem(install, npmCache) {
  if (install === undefined && npmCache === undefined) return null;
  if (install !== 'offline') return '--install must be offline when --npm-cache is given.';
  if (typeof npmCache !== 'string' || !npmCache.trim() || npmCache.includes('\0')) return '--install offline needs --npm-cache <folder>.';
  return null;
}

/** Resolves the explicitly named cache and refuses folders that expose repository or store files. */
export function installPolicy(install, npmCache, { repository, store } = {}) {
  const problem = installProblem(install, npmCache);
  if (problem) throw new Error(problem);
  if (install === undefined) return undefined;
  const cache = realpathSync(resolve(repository ?? process.cwd(), npmCache));
  if (!statSync(cache).isDirectory()) throw new Error('--npm-cache must name an existing folder.');
  for (const folder of [repository, store].filter(Boolean)) {
    const path = realPath(resolve(folder));
    if (isInside(cache, path) || isInside(path, cache)) throw new Error('The npm cache must not overlap the repository or store.');
  }
  return { mode: 'offline', npmCache: cache };
}

/** Checks stored policy fields. Old authorizations have no install field. */
export function storedInstallProblem(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== 'mode,npmCache' || value.mode !== 'offline'
    || typeof value.npmCache !== 'string' || !isAbsolute(value.npmCache) || value.npmCache.includes('\0')) return 'its install policy is not an offline cache policy';
  return null;
}

/** Uses npm beside the running Node.js binary. No repository executable or PATH lookup applies. */
export function installCommand(policy) {
  const npm = join(dirname(process.execPath), 'npm');
  if (!existsSync(npm)) throw new Error('Offline installation needs npm beside the running Node.js binary.');
  return [process.execPath, realpathSync(npm), 'ci', '--offline', '--ignore-scripts', '--cache', policy.npmCache, '--no-audit', '--no-fund'];
}

/** Reads the actual npm lockfile digest inside the sandbox, with npm shrinkwrap precedence. */
export function dependencyLockfile(tree, sandbox) {
  for (const path of ['npm-shrinkwrap.json', 'package-lock.json']) {
    try { lstatSync(join(tree, path)); } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`Code-map cannot inspect the revision lockfile ${path}.`, { cause: error });
    }
    return { path, digest: collectArtifact(tree, path, 50 * 1024 * 1024, sandbox).digest };
  }
  return null;
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
/** Checks optional dependency metadata before a stored run becomes report input. */
export function dependencyRecordProblem(value, sha) {
  if (value === undefined) return null;
  const problem = 'its dependency preparation record is invalid';
  if (!record(value) || typeof value.sha !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.sha)
    || value.sha !== sha || !['none', 'snapshot', 'clone', 'read-only-link', 'revision-offline'].includes(value.mode)
    || typeof value.prepared !== 'boolean') return problem;
  if (value.lockfile !== null && (!record(value.lockfile) || !isRelativePath(value.lockfile.path) || !digest(value.lockfile.digest))) return problem;
  if (value.install === null) return value.prepared || value.mode === 'revision-offline' ? problem : null;
  const install = value.install;
  if (!record(install) || storedInstallProblem(install.policy) || install.policy === undefined || commandProblem(install.command)
    || !['prepared', 'failed'].includes(install.status) || (install.exitStatus !== null && (!Number.isInteger(install.exitStatus) || install.exitStatus < 0))) return problem;
  return value.mode !== 'revision-offline' || value.prepared !== (install.status === 'prepared')
    || (value.prepared && install.exitStatus !== 0) ? problem : null;
}
