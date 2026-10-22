import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../lib/server.mjs';

function request(port, path = '/', body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST',
      headers: token === undefined ? {} : { 'x-code-map-token': token } }, res => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('HTTP response timed out')));
    req.on('error', reject); req.end(body);
  });
}

async function server(t, mode = '', env = {}) {
  const child = fork(new URL('./fixtures/server-process.mjs', import.meta.url), [mode],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } });
  const [{ port }] = await once(child, 'message');
  return { port, errors: () => errors };
}

test('chat rejects invalid tokens, malformed JSON and oversized requests without losing the server', async t => {
  const { port } = await server(t);
  const token = (await request(port)).text;
  assert.equal((await request(port, '/missing')).status, 404);
  assert.equal((await request(port, '/api/chat', '{}', 'wrong')).status, 403);
  assert.equal((await request(port, '/api/chat', '{', token)).status, 400);
  assert.equal((await request(port, '/api/chat', 'x'.repeat(400001), token)).status, 413);
  assert.equal((await request(port)).status, 200);
});

test('chat rejects JSON null as an invalid message and remains available', async t => {
  const { port } = await server(t);
  const token = (await request(port)).text;
  assert.equal((await request(port, '/api/chat', 'null', token)).status, 400);
  assert.equal((await request(port)).status, 200);
});

test('a page generation failure returns HTTP 500 and leaves the server available', async t => {
  const { port } = await server(t, 'broken-page');
  const response = await request(port);
  assert.equal(response.status, 500);
  assert.match(response.text, /render failed/);
  assert.equal((await request(port, '/missing')).status, 404);
});

test('chat skips malformed provider stream lines and still returns the following result', { skip: process.platform === 'win32' }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-stream-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Claude is paid and nondeterministic; substitute its external process boundary, never an internal module.
  const provider = join(root, 'claude');
  writeFileSync(provider, '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end", () => process.stdout.write(\'not-json\\n{"type":"result","result":"answer"}\\n\'));\n', { mode: 0o755 });
  const { port } = await server(t, '', { CODE_MAP_CLAUDE: provider });
  const token = (await request(port)).text;
  const response = await request(port, '/api/chat', '{"message":"hello"}', token);
  assert.equal(response.status, 200);
  assert.deepEqual(response.text.trim().split('\n').map(line => JSON.parse(line)), [{ type: 'text', text: 'answer' }, { type: 'done' }]);
});

test('server startup rejects when every fallback port is occupied', { timeout: 5000 }, async t => {
  const first = http.createServer();
  first.listen(0, '127.0.0.1'); await once(first, 'listening');
  const port = first.address().port;
  const blockers = [first];
  t.after(() => { for (const blocker of blockers) blocker.close(); });
  for (let candidate = port + 1; candidate <= port + 20; candidate++) {
    const blocker = http.createServer();
    blockers.push(blocker);
    blocker.listen(candidate, '127.0.0.1'); await once(blocker, 'listening');
  }
  await assert.rejects(startServer({ port, page: () => '', workspace: () => ({}) }), { code: 'EADDRINUSE' });
});
