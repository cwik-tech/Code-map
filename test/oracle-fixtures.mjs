// Fixtures for the tests of oracle provenance, model hypotheses and the run context: a committed TypeScript project with
// a test file, a JUnit report with chosen cases and its run manifest, and runners of code-map verify. This file has no tests.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const valid = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Change the login tests.', acceptanceCriteria: [],
  allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
/** One test case of a test file: `test('<name>', () => { expect(login('<value>')).toBe('<value>'); });` */
export const caseText = (name, value = 'a') => `test('${name}', () => { expect(login('${value}')).toBe('${value}'); });\n`;
export const header = "import { test, expect } from 'vitest';\nimport { login } from '../src/login';\n\n";

/** A committed project with src/login.ts and the files in `files`. Git ignores reports/. The tag "base" names its commit. */
export function project(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-oracle-')), work = mkdtempSync(join(tmpdir(), 'code-map-oracle-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'reports/\n');
  put('.code-map.json', JSON.stringify({ rules: [] }));
  put('src/login.ts', 'export function login(name: string) { return name; }\n');
  for (const [path, text] of Object.entries(files)) put(path, text);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  const store = join(work, 'store'), out = join(work, 'out');
  let count = 0;
  /** A request file outside the repository with the valid request and these fields. */
  const request = (fields = {}) => {
    const path = join(work, `request-${count++}.json`);
    writeFileSync(path, JSON.stringify({ ...valid, ...fields }));
    return path;
  };
  const run = (args) => spawnSync(process.execPath, [cli, 'verify', ...args, '--store', store], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const verify = (path, args = ['--out-dir', out]) => run(['--request', path, ...args]);
  const context = (runId, args = ['--out-dir', out]) => run(['--context', runId, ...args]);
  const commit = (message) => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  return { root, work, out, store, put, git, request, verify, context, commit };
}

const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * A JUnit report of `cases` and its run manifest in the ignored reports/ folder, bound to the commit `sha` and, for a working tree
 * with changes, to its `worktreeDigest`. Each case is
 * { name, file, status }, and the status is passed, failed or skipped. As Vitest does, each file has a suite with its path as
 * the name. A case without a file has no file attribute, and it is in the suite "unnamed".
 */
export function junit({ root, put }, name, { sha, cases, worktreeDigest = null }) {
  const failed = cases.filter((item) => item.status === 'failed').length, files = [...new Set(cases.map((item) => item.file ?? 'unnamed'))];
  const suite = (file) => {
    const own = cases.filter((item) => (item.file ?? 'unnamed') === file);
    const body = own.map((item) => `<testcase${item.file ? ` classname="${xml(item.file)}" file="${xml(item.file)}"` : ''} name="${xml(item.name)}">`
      + `${item.status === 'failed' ? '<failure message="expected a value"/>' : item.status === 'skipped' ? '<skipped/>' : ''}</testcase>`).join('');
    return `<testsuite name="${xml(file)}" tests="${own.length}" failures="${own.filter((item) => item.status === 'failed').length}">${body}</testsuite>`;
  };
  const text = `<?xml version="1.0"?>\n<testsuites>${files.map(suite).join('')}</testsuites>\n`;
  const artifact = `reports/${name}.xml`, path = `reports/${name}.manifest.json`;
  put(artifact, text);
  put(path, JSON.stringify({ manifestType: 'code-map-run-manifest', schemaVersion: 1, source: { sha, worktreeDigest }, command: ['npx', 'vitest', 'run', '--reporter=junit'],
    workingDirectory: '.', tools: [{ name: 'vitest', version: '3.2.4' }], config: sha256(canonical(loadConfig(root))), lockfile: null,
    environment: { policy: 'local', node: process.versions.node, platform: process.platform }, startedAt: '2026-10-22T18:00:00.000Z', finishedAt: '2026-10-22T18:00:05.000Z',
    exitStatus: failed ? 1 : 0, artifacts: [{ path: artifact, digest: sha256(text), kind: 'junit' }], discovery: { scope: 'vitest run', filters: [] } }));
  return { artifact, manifest: path };
}

/** The summary on stdout, with the exit code that the test expects, and the results file that it names. */
export function outcome(output, code) {
  assert.equal(output.status, code, output.stderr);
  const summary = JSON.parse(output.stdout);
  assert.equal(summary.exitCode, code);
  return { summary, results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
}
