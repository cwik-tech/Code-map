// code-map manifest: the run manifest of a test report, a TypeScript compiler report (kind tsc) or a coverage report (kinds lcov
// and istanbul-json), a size or audit report, or a runner discovery report that the user's own run wrote, so that code-map verify can bind the report to the analyzed code. It runs no
// project code: the command words after "--" are only recorded as the command of the run. The manifest describes the files as
// they are now, so the command must run right after the run.
import { type, release, arch } from 'node:os';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { isRelativePath, validateManifest } from './adapters/run-manifest.mjs';
import { analysisInputs } from './inputs.mjs';

export const reportKinds = ['electron-startup', 'xstate-trace', 'stryker-json', 'junit', 'jest-json', 'vitest-json', 'tsc', 'tsc-files', 'lcov', 'istanbul-json', 'sizes', 'bench', 'npm-audit', 'osv-snapshot', 'vitest-list', 'jest-list', 'playwright-list', 'mocha-list'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A validated run manifest for one report. `now` is the time of the manifest when the user gives no run times. */
export function buildManifest(repository, config, { artifact, kind, exitStatus, command, discovery, filters = [], workingDirectory = '.', now = new Date() }) {
  if (typeof artifact !== 'string' || !isRelativePath(artifact)) throw new Error('--artifact must name the report file by its path relative to the repository, for example reports/junit.xml.');
  if (!reportKinds.includes(kind)) throw new Error(`--kind must be one of ${reportKinds.join(', ')}.`);
  if (typeof exitStatus !== 'string' || !/^-?\d+$/.test(exitStatus)) throw new Error('--exit-status must be the whole-number exit status of the run, for example 0 or 1.');
  if (!Array.isArray(command) || command.length === 0) throw new Error('Give the command of the run after "--", for example: code-map manifest ... -- npx vitest run --reporter=junit');
  let info;
  try { info = lstatSync(resolve(repository, artifact)); } catch { throw new Error(`The report ${artifact} does not exist.`); }
  if (!info.isFile()) throw new Error(`The report ${artifact} is not a file.`);
  const inputs = analysisInputs(repository, config, { worktree: true }, null), time = now.toISOString();
  const manifest = { manifestType: 'code-map-run-manifest', schemaVersion: 1, source: { sha: inputs.sha, worktreeDigest: inputs.worktree.contentDigest },
    command, workingDirectory: workingDirectory.split(sep).join('/'), tools: [{ name: 'node', version: process.versions.node }], config: inputs.config, lockfile: inputs.lockfile,
    environment: { policy: 'self-attested', node: process.versions.node, platform: process.platform, os: type(), osVersion: release(), architecture: arch(), typescript: ts.version }, startedAt: time, finishedAt: time,
    exitStatus: Number(exitStatus), artifacts: [{ path: artifact, digest: sha256(readFileSync(resolve(repository, artifact))), kind }],
    discovery: { scope: discovery ?? command.join(' '), filters } };
  const checked = validateManifest(manifest);
  if (!checked.ok) throw new Error(`The manifest is not valid: ${checked.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join(' ')}`);
  return checked.manifest;
}
