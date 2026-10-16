import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { startServer } from '../lib/server.mjs';
import { chatWorkspace } from '../lib/snapshot.mjs';

const posixOnly = { skip: process.platform === 'win32' ? 'needs POSIX file modes and a shebang' : false };

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function serve(t) {
  const started = await startServer({ workspace: () => ({ directory: tmpdir(), note: '' }), port: 0, page: ({ token }) => token });
  t.after(() => { started.server.closeAllConnections(); started.server.close(); });
  const token = (await request(started.port)).body;
  const chat = (body, headers = {}) => request(started.port, { method: 'POST', path: '/api/chat', body,
    headers: { 'content-type': 'application/json', 'x-code-map-token': token, ...headers } });
  return { port: started.port, token, chat };
}

test('the chat server answers only requests addressed to its own host and origin', async (t) => {
  const { port, token, chat } = await serve(t);
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.equal((await request(port, { headers: { host: `localhost:${port}` } })).status, 200);
  const rebound = await request(port, { headers: { host: `attacker.example:${port}` } });
  assert.equal(rebound.status, 403);
  assert.ok(!rebound.body.includes(token));
  assert.equal((await chat('{}', { host: `attacker.example:${port}` })).status, 403);
  assert.equal((await chat('{}', { origin: `http://attacker.example:${port}` })).status, 403);
  assert.equal((await chat('{}', { origin: `https://127.0.0.1:${port}` })).status, 403);
  // Its own origin passes the checks; the empty message is then refused before Claude Code starts.
  assert.equal((await chat('{}', { origin: `http://127.0.0.1:${port}` })).status, 400);
});

test('the chat starts Claude Code without the repository settings, MCP servers or other tools', posixOnly, async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-claude-'));
  const fake = join(folder, 'claude');
  writeFileSync(fake, '#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on(\'end\', () => process.stdout.write('
    + 'JSON.stringify({ type: \'result\', result: JSON.stringify(process.argv.slice(2)) }) + \'\\n\'));\n', { mode: 0o755 });
  const previous = process.env.CODE_MAP_CLAUDE;
  process.env.CODE_MAP_CLAUDE = fake;
  t.after(() => {
    if (previous === undefined) delete process.env.CODE_MAP_CLAUDE; else process.env.CODE_MAP_CLAUDE = previous;
    rmSync(folder, { recursive: true, force: true });
  });
  const { chat } = await serve(t);
  const reply = await chat(JSON.stringify({ message: 'What does this do?' }));
  assert.equal(reply.status, 200);
  const text = reply.body.trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.type === 'text');
  assert.ok(text, reply.body);
  const args = JSON.parse(text.text);
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after('--setting-sources'), 'user');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(after('--tools'), 'Read,Grep,Glob');
});

test('chat snapshots live in a private folder that this user owns', posixOnly, (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-snapshot-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = join(folder, 'tmp');
  mkdirSync(process.env.TMPDIR);
  t.after(() => {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    rmSync(folder, { recursive: true, force: true });
  });
  const repository = join(folder, 'repository');
  mkdirSync(repository);
  const run = (...args) => execFileSync('git', ['-C', repository, '-c', 'user.name=test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  run('init', '-q');
  writeFileSync(join(repository, 'a.txt'), 'first\n');
  run('add', 'a.txt');
  run('commit', '-q', '--no-verify', '-m', 'first');
  const first = run('rev-parse', 'HEAD').trim();
  writeFileSync(join(repository, 'a.txt'), 'second\n');
  run('commit', '-q', '--no-verify', '-am', 'second');

  const hash = createHash('sha256').update(repository).digest('hex').slice(0, 12);
  const home = join(folder, 'home');
  mkdirSync(home);
  writeFileSync(join(home, 'notes.txt'), 'keep\n');
  const unchanged = () => assert.deepEqual(readdirSync(home), ['notes.txt']);

  // An older code-map left its folder open, and another user planted a symlink in it. That folder is never touched.
  const old = join(process.env.TMPDIR, 'code-map');
  mkdirSync(old);
  chmodSync(old, 0o777);
  symlinkSync(home, join(old, hash));
  const root = join(process.env.TMPDIR, 'code-map-chat');
  const base = join(root, hash);
  const place = chatWorkspace(repository, first, 'main', false);
  assert.ok(place.directory.startsWith(base + sep));
  assert.equal(readFileSync(join(place.directory, 'a.txt'), 'utf8'), 'first\n');
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(old).mode & 0o777, 0o777);
  unchanged();

  // A folder that other users can open is refused, not deleted: a delete there could be raced with symlinks.
  chmodSync(root, 0o777);
  assert.throws(() => chatWorkspace(repository, first, 'main', false), /not a private folder that you own/);
  assert.ok(statSync(place.directory).isDirectory());
  chmodSync(root, 0o700);

  // A symlink in place of this repository's folder is refused, so the cleanup never deletes files elsewhere.
  rmSync(base, { recursive: true });
  symlinkSync(home, base);
  assert.throws(() => chatWorkspace(repository, first, 'main', false), /not a private folder that you own/);
  unchanged();

  // A symlink in place of the folder itself, for example planted by another user, is refused.
  rmSync(root, { recursive: true });
  symlinkSync(folder, root);
  assert.throws(() => chatWorkspace(repository, first, 'main', false), /not a private folder that you own/);
  unchanged();
});
