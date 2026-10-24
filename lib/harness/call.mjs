// One call inside a sandbox subprocess. Its current directory is its snapshot root.
import { readFileSync, writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { routeCases, responseProblems, httpMethods } from './route.mjs';
import { inside, jsonFile } from './files.mjs';
import { startBlockCoverage } from './coverage.mjs';
import { stable } from './normalize.mjs';
const { spec, input, state } = JSON.parse(readFileSync(0, 'utf8')), root = process.cwd();
const send = (value) => writeSync(3, JSON.stringify(value));
const started = performance.now();
let phase = 'load', takeCoverage;
const rejections = [];
process.on('unhandledRejection', (error) => {
  if (rejections.length >= 100) return;
  const value = { name: String(error?.name ?? 'ThrownValue').slice(0, 200), message: String(error?.message ?? error).slice(0, 4096) };
  rejections.push(value);
  writeSync(4, JSON.stringify({ type: 'rejection', error: value }) + '\n');
});
let faultCalls = 0, keepAlive;
if (spec.mode === 'fault') globalThis.fetch = async (_url, options) => {
  faultCalls++;
  writeSync(4, '{"type":"fetch"}\n');
  if (spec.fault === 'reject') throw new TypeError('Injected fetch failure');
  if (spec.fault === 'hang') {
    keepAlive ??= setInterval(() => {}, 2147483647);
    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }
  return new Response('Injected fetch error', { status: spec.status ?? 503 });
};
const finish = async (result) => {
  clearInterval(keepAlive);
  process.once('beforeExit', async () => {
    try {
      const coverage = takeCoverage ? await takeCoverage() : undefined;
      send({ ...result, ...(coverage ? { coverage } : {}), durationMs: performance.now() - started,
        ...(spec.mode === 'fault' ? { faultCalls } : {}) });
    } catch (error) {
      send({ status: 'UNKNOWN', reason: `Block coverage failed: ${error.message}`, durationMs: performance.now() - started });
    }
  });
};
try {
  const module = await import(pathToFileURL(inside(root, spec.subject.file)).href), subject = module[spec.subject.export];
  if (spec.mode === 'fuzz') takeCoverage = await startBlockCoverage(pathToFileURL(inside(root, spec.subject.file)).href, spec.subject.file);
  let output, invariant;
  if (spec.mode === 'route') {
    phase = 'subject';
    const cases = routeCases(jsonFile(root, spec.contract), spec.path, httpMethods.filter((method) => typeof module[method] === 'function'));
    const checks = [];
    for (const operation of cases) {
      if (operation.state === 'UNKNOWN') { checks.push({ method: operation.method, problems: [`UNKNOWN:${operation.reason}`] }); continue; }
      try {
        const request = new Request(operation.url, { method: operation.method, headers: operation.headers, ...(operation.body === undefined ? {} : { body: operation.body }) });
        const response = await module[operation.method](request, { params: Promise.resolve(operation.params) });
        if (!(response instanceof Response)) { checks.push({ method: operation.method, problems: ['not-a-response'] }); continue; }
        const reader = response.body?.getReader(), chunks = [];
        let size = 0;
        if (reader) while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 262144) { await reader.cancel(); throw new Error('Route response exceeds 256 KiB'); }
          chunks.push(Buffer.from(chunk.value));
        }
        const bytes = Buffer.concat(chunks);
        let body = null;
        try { body = JSON.parse(new TextDecoder().decode(bytes)); }
        catch {
          if (response.status !== 204 && operation.method !== 'HEAD') {
            checks.push({ method: operation.method, status: response.status, problems: ['invalid-json-response'] }); continue;
          }
        }
        checks.push({ method: operation.method, status: response.status, problems: responseProblems(operation, response.status, body) });
      } catch (error) {
        checks.push({ method: operation.method, problems: [`threw:${error instanceof Error ? error.name : 'ThrownValue'}`] });
      }
    }
    if (!checks.length) checks.push({ method: null, problems: ['UNKNOWN:no-exported-methods'] });
    output = { checks };
  } else if (spec.mode === 'state-model') {
    phase = 'state';
    const require = createRequire(pathToFileURL(`${root}/package.json`));
    let api, version;
    try { api = require('xstate'); version = require('xstate/package.json').version; }
    catch { throw Object.assign(new Error('XState is not installed in the project'), { harnessUnknown: true }); }
    if (/^4\./.test(version) && typeof subject?.transition === 'function') output = subject.transition(state.from, { type: state.event }).value;
    else if (/^5\./.test(version) && typeof api.transition === 'function' && typeof subject?.resolveState === 'function') {
      const snapshot = subject.resolveState({ value: state.from, context: subject.config?.context ?? {} });
      output = api.transition(subject, snapshot, { type: state.event })[0].value;
    } else throw Object.assign(new Error(`XState ${version} has no supported pure transition API for this export`), { harnessUnknown: true });
  } else if (spec.mode === 'zod-boundaries') {
    if (typeof subject?.safeParse !== 'function') throw new Error('The schema export has no safeParse function');
    phase = 'schema';
    const parsed = await subject.safeParse(input);
    if (!parsed || typeof parsed.success !== 'boolean') throw new Error('safeParse returned no boolean success');
    output = parsed.success;
  } else {
    if (typeof subject !== 'function') throw new Error('The subject export is not a function');
    phase = 'subject';
    output = await subject(input);
    if (spec.mode === 'property' || (spec.mode === 'fuzz' && spec.invariant)) {
      phase = 'invariant';
      const module = await import(pathToFileURL(inside(root, spec.invariant.file)).href);
      if (typeof module[spec.invariant.export] !== 'function') throw new Error('The invariant export is not a function');
      invariant = await module[spec.invariant.export](input, output);
      if (typeof invariant !== 'boolean') throw new Error('The invariant must return true or false');
    }
  }
  phase = 'normalize';
  const result = { status: 'returned', output: spec.mode === 'route' ? output : stable(output, spec.ignoreFields ?? []), ...(invariant === undefined ? {} : { invariant }) };
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text) > 262144) throw new Error('The call output exceeds 256 KiB');
  await finish({ ...result, durationMs: performance.now() - started });
} catch (error) {
  const name = error instanceof Error ? Object.getPrototypeOf(error)?.constructor?.name ?? error.name : 'ThrownValue', message = error instanceof Error ? error.message : String(error);
  const unknown = phase !== 'subject' || error?.harnessUnknown;
  await finish({ status: unknown ? 'UNKNOWN' : 'threw', ...(unknown ? { reason: message.slice(0, 4096) } : { error: { name: String(name).slice(0, 200), message: String(message).slice(0, 4096) } }), durationMs: performance.now() - started });
}
