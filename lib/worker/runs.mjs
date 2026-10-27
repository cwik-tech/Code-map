// The stored runs of code-map run: runs/<run ID>/ in the store holds run.json (the record), the kept standard output and
// standard error, and, when the run kept an artifact, the artifact and its run manifest. verify reads a stored run by its ID.
// The store is input like any other file, so loadRun checks each value that verify uses.
import { trustPolicy } from '../trust.mjs';
import { type, release, arch } from 'node:os';
import ts from 'typescript';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isRelativePath, validateManifest } from '../adapters/run-manifest.mjs';
import { readPrivateFile, requirePrivateFolder, storeFolder } from '../store.mjs';
import { runIdPattern } from '../verify-request.mjs';
import { dependencyRecordProblem } from './install.mjs';
import { repositoryDigest } from './authorize.mjs';

export const runFiles = { record: 'run.json', manifest: 'manifest.json', stdout: 'stdout.log', stderr: 'stderr.log' };
/** The file of the artifact in the run folder, for each kind that code-map run keeps: the report kinds that verify reads. */
export const artifactFiles = { 'mypy-json': 'report.jsonl', 'mypy-text': 'report.txt', 'pyright-json': 'report.json', 'ruff-json': 'report.json', 'xstate-trace': 'trace.jsonl', bench: 'bench.json', lcov: 'coverage.lcov', 'istanbul-json': 'coverage.json', harness: 'harness.json', 'stryker-json': 'report.json', 'mutmut-text': 'report.txt', junit: 'report.xml', 'jest-json': 'report.json', 'vitest-json': 'report.json' };
/** An artifact can have at most 50 MiB, the size of the largest report that verify reads. */
export const maxArtifactBytes = 50 * 1024 * 1024;
const maxJsonBytes = 1024 * 1024, sha256Pattern = /^[0-9a-f]{64}$/, backendNames = ['seatbelt', 'bwrap'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A run ID that sorts by time: R-<UTC time>-<8 random hexadecimal characters>. */
export const newRunId = (time) => `R-${time.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(4).toString('hex')}`;

/**
 * A new staging folder in runs/ for one run. The output goes into it while the run lasts. publish() moves it to runs/<run ID>
 * in one rename, so a reader never sees half a run. discard() removes it. Each file is new and private (0600).
 */
export function stageRun(root, runId) {
  const runs = storeFolder(root, 'runs'), staging = mkdtempSync(join(runs, `.staging-${runId}-`));
  const streams = { stdout: openSync(join(staging, runFiles.stdout), 'wx', 0o600), stderr: openSync(join(staging, runFiles.stderr), 'wx', 0o600) };
  let open = true, folder = staging;
  return {
    write: (stream, bytes) => { writeSync(streams[stream], bytes); },
    put: (name, text) => writeFileSync(join(staging, name), text, { flag: 'wx', mode: 0o600 }),
    close: () => { if (open) { open = false; for (const descriptor of Object.values(streams)) closeSync(descriptor); } },
    publish: () => {
      const target = join(runs, runId);
      if (existsSync(target)) throw new Error(`A run with the ID ${runId} already exists in ${runs}. Code-map does not replace an earlier run.`);
      renameSync(staging, target);
      folder = null;
      return target;
    },
    discard: () => { if (folder) rmSync(folder, { recursive: true, force: true }); folder = null; },
  };
}

/** The run manifest of the artifact of a run: the fields of code-map manifest, with the policy "isolated" and the backend. */
export function runManifest({ inputs, command, startedAt, finishedAt, exitStatus, artifact, backend, discovery, filters }) {
  const manifest = { manifestType: 'code-map-run-manifest', schemaVersion: 1, source: { sha: inputs.sha, worktreeDigest: inputs.worktree?.contentDigest ?? null },
    command, workingDirectory: '.', tools: [{ name: 'node', version: process.versions.node }], config: inputs.config, lockfile: inputs.lockfile,
    environment: { policy: 'isolated', node: process.versions.node, platform: process.platform, backend, os: type(), osVersion: release(), architecture: arch(), typescript: ts.version }, startedAt, finishedAt, exitStatus,
    artifacts: [{ path: artifact.path, digest: artifact.digest, kind: artifact.kind }], discovery: { scope: discovery ?? command.join(' '), filters } };
  const checked = validateManifest(manifest);
  if (!checked.ok) throw new Error(`The run manifest is not valid: ${checked.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join(' ')}`);
  return checked.manifest;
}

/** Why a stored record cannot be used by verify, or null. */
function problemOf(record, runId) {
  if (!isRecord(record) || record.recordType !== 'code-map-run-record' || record.schemaVersion !== 1) return 'it is not a code-map-run-record with schema version 1';
  try { trustPolicy(record.trust); } catch (error) { return error.message; }
  if (record.runId !== runId) return `it holds the run ${JSON.stringify(String(record.runId)).slice(0, 80)}`;
  if (!isRecord(record.repository) || !sha256Pattern.test(record.repository.digest)) return 'its repository is not a SHA-256 digest';
  if (record.policy !== 'isolated' || !isRecord(record.backend) || !backendNames.includes(record.backend.name)) return 'it is not an isolated run of a known backend';
  if (!isRecord(record.workspace) || typeof record.workspace.tree !== 'string' || !isAbsolute(record.workspace.tree) || record.workspace.tree.includes('\0')) return 'its workspace is not an absolute path';
  const dependencies = dependencyRecordProblem(record.dependencies, record.source?.sha);
  if (dependencies) return dependencies;
  const { artifact } = record;
  if (artifact === null) return null;
  if (!isRecord(artifact) || !isRelativePath(artifact.path) || artifactFiles[artifact.kind] === undefined || artifact.file !== artifactFiles[artifact.kind] || !sha256Pattern.test(artifact.digest)) {
    return 'its artifact is not a relative path with a known kind, file and SHA-256 digest';
  }
  return null;
}

/**
 * The record, the run manifest and the artifact bytes of a stored run, for verify. A run of another repository, a run without
 * an artifact, or a planted or damaged file is refused with the reason. `max` is the largest artifact that verify can still read.
 */
export function loadRun(root, runId, repository, max = maxArtifactBytes) {
  if (typeof runId !== 'string' || !runIdPattern.test(runId)) throw new Error(`${JSON.stringify(String(runId)).slice(0, 80)} is not a run ID. A run ID looks like R-20261022T101010Z-0123abcd.`);
  const runs = join(root, 'runs'), folder = join(runs, runId);
  try { for (const path of [runs, folder]) requirePrivateFolder(path, 'Remove it, or choose another store with --store <folder>.'); } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`The run ${runId} is not in the store (${runs}). Run code-map verify with the store of code-map run (--store <folder>).`);
    throw error;
  }
  const read = (name, limit) => {
    let bytes;
    try { bytes = readPrivateFile(join(folder, name), limit); } catch (error) { throw new Error(`The file ${name} of the run ${runId} is unreadable: ${error instanceof Error ? error.message : String(error)}.`); }
    if (bytes === null) throw new Error(`The run ${runId} has no ${name}.`);
    return bytes;
  };
  const json = (name) => { try { return JSON.parse(read(name, maxJsonBytes).toString('utf8')); } catch (error) { throw error instanceof SyntaxError ? new Error(`The file ${name} of the run ${runId} is not valid JSON.`) : error; } };
  const record = json(runFiles.record), problem = problemOf(record, runId);
  if (problem) throw new Error(`The record of the run ${runId} is unreadable: ${problem}.`);
  if (record.repository.digest !== repositoryDigest(repository)) throw new Error(`The run ${runId} is of another repository. A run counts only in the repository where it ran.`);
  if (record.artifact === null) throw new Error(`The run ${runId} kept no artifact, so it gives no test report. Run code-map run again with --kind and --artifact.`);
  return { record, manifest: json(runFiles.manifest), bytes: read(record.artifact.file, max) };
}
