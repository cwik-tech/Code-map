// Fixtures for the tests of the restricted worker: a committed project in a new temporary folder, a temporary store, a fake
// home folder with a credential file, an authorization in that store and a probe script. This file has no tests.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { loadConfig } from '../lib/project.mjs';
import { newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { runCommand } from '../lib/worker/run.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** The tests that start a run need the Seatbelt backend. This computer has no other backend that a test can check. */
export const sandboxed = { skip: process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') ? false
  : 'needs /usr/bin/sandbox-exec (macOS). Without a backend, Code-map refuses every run, so these tests cannot start one' };
export const budgets = { wallClockSeconds: 60, memoryMegabytes: 2048, outputMegabytes: 8, concurrency: 4 };

/**
 * probe.mjs tries one thing inside the worker and prints the result: "allowed" or the error code. `net <port>` opens a TCP
 * connection to 127.0.0.1, `read <path>` and `write <path>` use a file, and `env` prints the environment as JSON.
 */
const probe = `import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
const [what, target] = process.argv.slice(2);
const attempt = (action) => { try { action(); return 'allowed'; } catch (error) { return error.code; } };
if (what === 'env') console.log(JSON.stringify(process.env));
if (what === 'read') console.log(attempt(() => readFileSync(target)));
if (what === 'write') console.log(attempt(() => writeFileSync(target, 'x')));
if (what === 'net') {
  const socket = connect({ host: '127.0.0.1', port: Number(target) });
  socket.on('connect', () => { console.log('allowed'); socket.destroy(); });
  socket.on('error', (error) => console.log(error.code));
}
`;

/** A committed project with one source file, one node:test file and the probe. The tag "base" names its commit. */
export function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'code-map-worker-'))), work = realpathSync(mkdtempSync(join(tmpdir(), 'code-map-worker-work-')));
  t.after(() => { for (const path of [root, work]) rmSync(path, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  const home = join(work, 'home'), store = join(work, 'store');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'id_rsa'), 'PRIVATE KEY\n');
  put('.gitignore', 'reports/\nnode_modules/\n');
  put('src/sum.mjs', 'export function sum(a, b) { return a + b; }\n');
  // The describe block gives the JUnit cases a suite name.
  put('test/sum.test.mjs', "import assert from 'node:assert/strict';\nimport { describe, test } from 'node:test';\nimport { sum } from '../src/sum.mjs';\n"
    + "describe('sum', () => {\n  test('adds two numbers', () => { assert.equal(sum(1, 2), 3); });\n  test('adds a negative number', () => { assert.equal(sum(1, -2), -1); });\n});\n");
  put('probe.mjs', probe);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  return { root, work, home, store, put, git };
}

/** Saves an authorization of these command words for the fixture repository, and returns its ID. */
export function authorize(fixture, command, { maxima = budgets, now = new Date(), days = 1, repository = fixture.root } = {}) {
  const record = newAuthorization({ repository, command, budgets: maxima, expiresDays: days, now });
  saveAuthorization(fixture.store, record);
  return record.id;
}

/**
 * Runs the command words in the worker for the head commit, with a new authorization whose maxima allow the budgets of the run.
 * The fake home folder, the repository and the store are the protected folders. The parent environment has a token that the run must not see.
 */
export function run(fixture, command, { maxima, ...request } = {}, context = {}) {
  const authorization = request.authorization ?? authorize(fixture, command, { maxima: maxima ?? { ...budgets, ...request.budgets } });
  return runCommand(fixture.root, loadConfig(fixture.root), { command, head: 'HEAD', store: fixture.store, ...request, authorization },
    { protectedFolders: [fixture.home, fixture.root, fixture.store], home: fixture.home, env: { ...process.env, CODE_MAP_TEST_TOKEN: 'secret-token' }, graceMs: 300, ...context });
}

/** The standard output of a run, as the worker kept it. */
export const output = (result) => readFileSync(result.paths.stdout, 'utf8');

/** The time, size and content of every entry under the folder, the .git folder included. */
export function snapshot(root) {
  const state = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), key = relative(root, path), info = lstatSync(path);
      if (entry.isDirectory()) { state[key] = `folder ${info.mtimeMs}`; walk(path); }
      else state[key] = entry.isSymbolicLink() ? `link ${readlinkSync(path)}` : `${info.mtimeMs} ${info.size} ${sha256(readFileSync(path))}`;
    }
  };
  walk(root);
  return state;
}

/** The names in a store folder, or an empty list when the folder does not exist. */
export const entries = (store, name) => existsSync(join(store, name)) ? readdirSync(join(store, name)) : [];
