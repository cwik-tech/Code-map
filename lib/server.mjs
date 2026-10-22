// Local server for `code-map serve`: serves the map and answers chat questions with Claude Code.
// It listens on 127.0.0.1 only, answers only requests addressed to that address, and every chat request must carry
// a token that only the served page knows, so other websites open in the browser cannot use it.
// Claude Code gets read-only tools and none of the mapped repository's own settings, hooks or MCP servers.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const systemPrompt = [
  'You are helping the owner of this repository understand its code. They are looking at a visual code map',
  'and asking about the part they selected. Answer in plain English and keep it short; use a few bullets when it helps.',
  'Define each abbreviation the first time you use it. When you refer to code, give its location as path:line,',
  'for example src/cli/server.ts:19, so the map can link to it. Read and search files as needed.',
  'Never try to change files or run commands.',
].join(' ');

export function startServer({ workspace, port, page }) {
  const token = randomBytes(24).toString('hex');
  const server = http.createServer((request, response) => {
    // DNS rebinding: a website can point its own name at 127.0.0.1, but the browser still sends that name.
    const own = (address) => address === `127.0.0.1:${server.address().port}` || address === `localhost:${server.address().port}`;
    if (!own(request.headers.host)) return response.writeHead(403).end();
    const origin = request.headers.origin;
    if (origin !== undefined && !(origin.startsWith('http://') && own(origin.slice('http://'.length)))) return response.writeHead(403).end();
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
      try {
        const html = page({ token });
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(html);
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error?.stack ?? error));
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') return chat(request, response, token, workspace());
    response.writeHead(404).end();
  });
  // A port already in use (often an older code-map left running) moves on to the next free one.
  return new Promise((resolve, reject) => {
    let candidate = port;
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && candidate < port + 20) server.listen(++candidate, '127.0.0.1');
      else reject(error);
    });
    server.once('listening', () => resolve({ server, port: server.address().port }));
    server.listen(candidate, '127.0.0.1');
  });
}

async function chat(request, response, token, place) {
  if (request.headers['x-code-map-token'] !== token) return response.writeHead(403).end();
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 400_000) return response.writeHead(413).end(); }
  let input;
  try { input = JSON.parse(body); } catch { return response.writeHead(400).end(); }
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || typeof input.message !== 'string' || input.message.trim() === '') return response.writeHead(400).end();
  response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  const send = (event) => { if (!response.writableEnded) response.write(JSON.stringify(event) + '\n'); };
  const child = runClaude(place, prompt(input), typeof input.session === 'string' ? input.session : null, send);
  response.on('close', () => { if (child.exitCode === null) child.kill('SIGTERM'); });
  child.on('close', () => { send({ type: 'done' }); response.end(); });
}

function prompt(input) {
  const context = input.context && typeof input.context === 'object' ? input.context : null;
  if (!context?.path) return input.message;
  const where = context.kind === 'decl' ? `${context.declKind ?? 'declaration'} ${context.name} in ${context.path}`
    + (context.start ? ` (lines ${context.start}–${context.end})` : '') : `${context.kind ?? 'item'} ${context.path}`;
  const about = context.summary ? `\nIts description in the map: ${context.summary}` : '';
  const code = typeof context.code === 'string' && context.code
    ? `\n\nThe selected code (${context.path}${context.codeStart ? `, from line ${context.codeStart}` : ''}):\n\`\`\`\n${context.code}\n\`\`\``
    : '';
  const contents = typeof context.contents === 'string' && context.contents ? `\n\nWhat it contains:\n${context.contents}` : '';
  return `Selected in the code map: ${where}.${about}${code}${contents}\n\nQuestion: ${input.message}`;
}

/** Runs `claude -p` with streamed JSON output and forwards text, tool activity and the session id. */
function runClaude(place, text, session, send) {
  const repository = place.directory;
  const command = process.env.CODE_MAP_CLAUDE || 'claude';
  // The mapped repository is untrusted: its .claude settings could add hooks that run commands, and its .mcp.json
  // could add tools. Only the user's own settings load, no MCP servers start, and only the three read tools exist.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--setting-sources', 'user', '--strict-mcp-config', '--tools', 'Read,Grep,Glob',
    '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch',
    '--append-system-prompt', `${systemPrompt} ${place.note}`, ...(session ? ['--resume', session] : [])];
  const child = spawn(command, args, { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(text);
  let buffer = '', errors = '', streamed = false, wrote = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const result = forward(event, send, streamed, wrote, repository);
      streamed ||= result.streamed; wrote ||= result.wrote;
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-4000); });
  child.on('error', (error) => {
    send({ type: 'error', message: error.code === 'ENOENT'
      ? 'The Claude Code command (`claude`) was not found. Install Claude Code and log in, or set CODE_MAP_CLAUDE to its path.'
      : String(error.message) });
  });
  child.on('close', (code) => {
    if (code !== 0 && code !== null && !wrote) send({ type: 'error', message: errors.trim() || `Claude Code exited with code ${code}` });
  });
  return child;
}

function forward(event, send, streamed, wrote, repository) {
  const out = { streamed: false, wrote: false };
  if (event.session_id && ((event.type === 'system' && event.subtype === 'init') || event.type === 'result')) send({ type: 'session', id: event.session_id });
  if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
    send({ type: 'text', text: event.event.delta.text });
    return { streamed: true, wrote: true };
  }
  if (event.type === 'assistant') {
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use') send({ type: 'tool', text: toolLabel(block, repository) });
      if (block.type === 'text' && !streamed && block.text) { send({ type: 'text', text: block.text }); out.wrote = true; }
    }
  }
  if (event.type === 'result') {
    if (event.is_error) send({ type: 'error', message: String(event.result ?? 'Claude Code reported an error') });
    else if (!wrote && !out.wrote && typeof event.result === 'string') { send({ type: 'text', text: event.result }); out.wrote = true; }
  }
  return out;
}

function toolLabel(block, repository) {
  const input = block.input ?? {};
  const target = String(input.file_path ?? input.pattern ?? input.path ?? '').replace(repository + '/', '');
  const verb = { Read: 'Reading', Grep: 'Searching for', Glob: 'Listing' }[block.name] ?? block.name;
  return `${verb} ${String(target)}`.trim();
}
