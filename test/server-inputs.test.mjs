import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';

async function serve(t, { failPage = false } = {}) {
  const module = new URL('../lib/server.mjs', import.meta.url).href;
  const source = `import { startServer } from ${JSON.stringify(module)};
    let token, pages = 0;
    const { server, port } = await startServer({ port: 0,
      page: (value) => { token = value.token; if (${failPage} && ++pages === 2) throw new Error('page unavailable'); return 'ready'; },
      workspace: () => { throw new Error('workspace unavailable'); } });
    server.on('request', (request) => { if (request.method === 'POST') process.send({ type: 'request' }); });
    const response = await fetch('http://127.0.0.1:' + port, { signal: AbortSignal.timeout(3000) });
    await response.text();
    process.send({ type: 'ready', port, token });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  const closed = once(child, 'close');
  t.after(async () => { child.kill(); await closed; });
  const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  assert.equal(ready.type, 'ready', errors);
  return { ...ready, child, errors: () => errors };
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path: '/', timeout: 3000, ...options }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
      response.on('error', reject);
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('HTTP request timed out')));
    outgoing.on('error', reject);
    outgoing.end(options.body);
  });
}

for (const body of ['null', '[]', '"message"', '{"message":42}', '{']) {
  test(`chat rejects invalid body ${body} and continues serving requests`, async (t) => {
    const server = await serve(t);
    assert.equal(await request(server.port, { method: 'POST', path: '/api/chat', body,
      headers: { 'x-code-map-token': server.token } }), 400, server.errors());
    assert.equal(await request(server.port), 200, server.errors());
  });
}

test('an invalid request URL returns a client error and leaves the server running', async (t) => {
  const server = await serve(t);
  assert.equal(await request(server.port, { path: 'http://[' }), 400, server.errors());
  assert.equal(await request(server.port), 200, server.errors());
});

test('a workspace failure returns a server error without terminating the server', async (t) => {
  const server = await serve(t);
  assert.equal(await request(server.port, { method: 'POST', path: '/api/chat', body: '{"message":"hello"}',
    headers: { 'x-code-map-token': server.token } }), 500, server.errors());
  assert.equal(await request(server.port), 200, server.errors());
});

test('a page rendering failure returns a server error and later requests still work', async (t) => {
  const server = await serve(t, { failPage: true });
  assert.equal(await request(server.port), 500, server.errors());
  assert.equal(await request(server.port), 200, server.errors());
});

test('an unauthorized chat request is rejected before opening its workspace', async (t) => {
  const server = await serve(t);
  assert.equal(await request(server.port, { method: 'POST', path: '/api/chat', body: '{"message":"hello"}' }), 403, server.errors());
  assert.equal(await request(server.port), 200, server.errors());
});

test('an aborted chat body leaves the server available', async (t) => {
  const server = await serve(t);
  const handled = once(server.child, 'message', { signal: AbortSignal.timeout(3000) });
  const outgoing = http.request({ hostname: '127.0.0.1', port: server.port, method: 'POST', path: '/api/chat', timeout: 3000,
    headers: { 'x-code-map-token': server.token, 'content-length': '1000' } });
  outgoing.on('timeout', () => outgoing.destroy(new Error('HTTP request timed out')));
  const ended = once(outgoing, 'error');
  outgoing.write('{');
  await handled;
  outgoing.destroy();
  await ended;
  assert.equal(await request(server.port), 200, server.errors());
});
