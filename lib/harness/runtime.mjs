// Fixed sandbox entry point. It writes bounded JSON lines and one harness report.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { migrate } from './migrate.mjs';
import { validateSpec } from './spec.mjs';
import { generate, seeded, shrink } from './generator.mjs';
import { projectLoader } from './loader.mjs';
import { workspaceFiles, fileChanges, comparable } from './effects.mjs';
import { mutate, retainCoverage } from './corpus.mjs';
import { validBlockCoverage } from './coverage.mjs';
import { stable } from './normalize.mjs';
import { inside, jsonFile, fileBytes } from './files.mjs';
import { validateDecisionTable, checkDecisionTable } from '../models/decision-table.mjs';
import { validateStateModel } from '../models/state-model.mjs';
const root = process.cwd(), spec = validateSpec(jsonFile(root, '.code-map-harness/spec.json'));
const metadata = jsonFile(root, '.code-map-harness/metadata.json');
const report = { reportType: 'code-map-harness', harnessVersion: 1, mode: spec.mode, subject: spec.subject, parameters: spec, ...metadata,
  seed: spec.seed ?? null, generatorVersion: 'mulberry32-v1', count: spec.count ?? null, finite: true, calls: [], failures: [] };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bytes = 0;
function record(input, result, side = 'head', source) {
  const entry = { input, result, side, ...(source ? { source } : {}) }, text = JSON.stringify(entry);
  bytes += Buffer.byteLength(text);
  if (bytes > 8 * 1024 * 1024 || report.calls.length >= 20000) throw new Error('Harness results exceed 8 MiB or 20000 calls');
  report.calls.push(entry);
  process.stdout.write(text + '\n');
  return result;
}
const loader = (workspace) => projectLoader(workspace, [spec.subject, ...(spec.invariant ? [spec.invariant] : [])]);

async function call(input, { workspace = root, state, limit = spec.callTimeoutMs, side = 'head', source } = {}) {
  const started = performance.now();
  let before;
  try { before = workspaceFiles(workspace, spec.ignoreFields); }
  catch (error) { return record(input, { status: 'UNKNOWN', reason: error.message, durationMs: performance.now() - started }, side, source); }
  const stdout = [], stderr = [], rejections = [];
  let faultCalls = 0;
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', ...loader(workspace), fileURLToPath(new URL('./call.mjs', import.meta.url))],
      { cwd: workspace, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
    let logs = 0, outputBytes = 0, eventBytes = 0, events = '', forced = null;
    const chunks = [];
    const error = (name, message) => ({ status: 'UNKNOWN', reason: `${name}: ${message}`, durationMs: performance.now() - started });
    const stop = (result) => {
      if (forced) return;
      forced = result;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => stop({ status: 'hang', durationMs: performance.now() - started }), limit);
    const log = (target, chunk) => {
      const left = Math.max(0, 262144 - logs);
      target.push(chunk.subarray(0, left)); logs += chunk.length;
      if (logs > 262144) stop(error('HarnessOutputLimit', 'Subject logs exceed 256 KiB'));
    };
    child.stdout.on('data', (chunk) => log(stdout, chunk)); child.stderr.on('data', (chunk) => log(stderr, chunk));
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', (chunk) => {
      eventBytes += Buffer.byteLength(chunk);
      if (eventBytes > 1048576) { stop(error('HarnessOutputLimit', 'Call events exceed 1 MiB')); return; }
      events += chunk;
      const lines = events.split('\n'); events = lines.pop();
      for (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { stop(error('HarnessProtocolError', 'Invalid call event')); return; }
        if (event?.type === 'fetch' && spec.mode === 'fault') faultCalls++;
        else if (event?.type === 'rejection' && typeof event.error?.name === 'string' && event.error.name.length <= 200
          && typeof event.error?.message === 'string' && event.error.message.length <= 4096 && rejections.length < 100) rejections.push(event.error);
        else { stop(error('HarnessProtocolError', 'Invalid call event shape')); return; }
      }
    });
    child.stdio[3].on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 262144) stop(error('HarnessOutputLimit', 'The call output exceeds 256 KiB'));
      else chunks.push(chunk);
    });
    child.stdin.on('error', () => { /* Early child exits are reported by close. */ });
    child.once('error', (failure) => { forced = error(failure.name, failure.message.slice(0, 4096)); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (forced) { resolve(forced); return; }
      if (code !== 0) { resolve({ status: 'crashed', error: { name: 'ProcessExit', message: `The call exited with status ${code}, signal ${signal}` }, durationMs: performance.now() - started }); return; }
      if (events.length) { resolve(error('HarnessProtocolError', 'Incomplete call event')); return; }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { resolve(error('HarnessProtocolError', `The call ended without valid JSON (${code})`)); return; }
      if (!value || typeof value !== 'object' || !['returned', 'threw', 'UNKNOWN'].includes(value.status)
        || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0
        || (value.status === 'returned' && (!Object.hasOwn(value, 'output') || ((spec.mode === 'property' || spec.invariant) && typeof value.invariant !== 'boolean')))
        || (value.status === 'threw' && (typeof value.error?.name !== 'string' || typeof value.error?.message !== 'string'))
        || (value.status === 'UNKNOWN' && typeof value.reason !== 'string')
        || (value.coverage !== undefined && !validBlockCoverage(value.coverage))
        || (spec.mode === 'fuzz' && ['returned', 'threw'].includes(value.status) && value.coverage === undefined)) resolve(error('HarnessProtocolError', 'The call result has an invalid shape'));
      else resolve(value);
    });
    child.stdin.end(JSON.stringify({ spec, input, state }));
  });
  const value = result;
  const effects = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), rejections, files: [] };
  try { effects.files = fileChanges(before, workspaceFiles(workspace, spec.ignoreFields)); }
  catch (error) { return record(input, { status: 'UNKNOWN', reason: error.message, effects, durationMs: performance.now() - started }, side, source); }
  return record(input, { ...value, ...(spec.mode === 'fault' ? { faultCalls } : {}), effects }, side, source);
}
if (spec.mode !== 'migrate') loader(root);
if (spec.mode === 'migrate') {
  report.migration = await migrate(root, spec, metadata.migrations);
  if (report.migration.status !== 'PASS') report.failures.push({ kind: report.migration.status === 'UNKNOWN' ? 'UNKNOWN' : 'mismatch', ...report.migration });
} else if (spec.mode === 'differential') {
  const corpus = fileBytes(root, spec.inputs), inputs = JSON.parse(corpus.toString('utf8'));
  if (!Array.isArray(inputs) || inputs.length > 10000) throw new Error('Differential inputs must be an array of at most 10000 values');
  report.inputDigest = createHash('sha256').update(corpus).digest('hex');
  report.normalization = { ignoreFields: spec.ignoreFields ?? [] };
  for (const input of inputs) {
    const base = await call(input, { workspace: inside(root, '.code-map-harness/base'), side: 'base' }), head = await call(input);
    const semantic = comparable;
    if (base.status === 'UNKNOWN' || head.status === 'UNKNOWN') report.failures.push({ kind: 'UNKNOWN', input, base, head });
    else if (base.status === 'crashed' || head.status === 'crashed') report.failures.push({ kind: 'crash', input, base, head });
    else if (base.status === 'hang' || head.status === 'hang' || !same(semantic(base), semantic(head))) report.failures.push({ kind: 'difference', input, base, head });
  }
} else if (spec.mode === 'property') {
  const random = seeded(spec.seed);
  for (let index = 0; index < spec.count; index++) {
    const input = generate(spec.generator, random), result = await call(input);
    if (result.status === 'returned' && result.invariant === true) continue;
    let shrunkInput = input, attempts = 0, changed = result.status === 'returned' && result.invariant === false;
    while (changed && attempts < 100) {
      changed = false;
      for (const candidate of shrink(spec.generator, shrunkInput)) {
        if (attempts >= 100) break;
        attempts++;
        const check = await call(candidate);
        if (check.status === 'returned' && check.invariant === false) { shrunkInput = candidate; changed = true; break; }
      }
    }
    report.failures.push({ kind: result.status === 'UNKNOWN' ? 'UNKNOWN' : 'property', input, result, shrunkInput, shrinkAttempts: attempts });
    break;
  }
} else if (spec.mode === 'fuzz') {
  const random = seeded(spec.seed), start = performance.now();
  report.corpus = { guidance: 'v8-block-and-outcome', size: 0, classes: [], seeds: [], mutations: 0, blocks: [] };
  report.coverage = { measure: 'v8-block', coveredBlocks: 0, history: [], note: 'Block coverage is not path coverage. Finite runs cannot prove safety.' };
  report.timeBudgetMs = spec.timeBudgetMs;
  while (performance.now() - start < spec.timeBudgetMs && report.calls.length < 10000) {
    const initial = spec.corpus ?? [], index = report.calls.length;
    const source = index < initial.length ? 'corpus' : report.corpus.size > 0 && (index - initial.length) % 2 === 1 ? 'mutation' : 'generated';
    const useCorpus = source === 'mutation';
    const input = source === 'corpus' ? initial[index] : useCorpus ? mutate(spec.generator, report.corpus.seeds[Math.floor(random() * report.corpus.size)].input, random) : generate(spec.generator, random);
    if (useCorpus) report.corpus.mutations++;
    const remaining = spec.timeBudgetMs - (performance.now() - start);
    if (remaining <= 0) break;
    const result = await call(input, { limit: Math.min(spec.callTimeoutMs, remaining), source });
    const budgetEnded = result.status === 'hang' && remaining < spec.callTimeoutMs;
    if (!budgetEnded) report.corpus = retainCoverage(report.corpus, input, result);
    report.coverage.coveredBlocks = report.corpus.blocks.length;
    report.coverage.history.push({ call: report.calls.length, elapsedMs: performance.now() - start,
      coveredBlocks: report.coverage.coveredBlocks, corpusSize: report.corpus.size });
    if (budgetEnded) { report.budgetExhausted = true; break; }
    if (result.status === 'hang') { report.failures.push({ kind: 'hang', input, result }); break; }
    if (result.status === 'UNKNOWN') { report.failures.push({ kind: 'UNKNOWN', input, result }); break; }
    if (result.status === 'returned' && result.invariant === false) report.failures.push({ kind: 'invariant', input, result });
    const allowed = spec.allowedErrors ?? [];
    if (result.status === 'crashed' || (result.status === 'threw' && !allowed.includes(result.error.name))
      || result.effects.rejections.some((error) => !allowed.includes(error.name))) report.failures.push({ kind: 'crash', input, result });
  }
  report.durationMs = performance.now() - start;
} else if (['zod-boundaries', 'json-boundaries', 'range-boundaries'].includes(spec.mode)) {
  report.boundaryResults = [];
  for (const unknown of metadata.boundaries.unknown) report.failures.push({ kind: 'UNKNOWN', ...unknown });
  for (const item of metadata.boundaries.cases) {
    const index = report.calls.length;
    const result = await call(item.input);
    report.boundaryResults.push({ case: report.boundaryResults.length, call: index, expected: item.expected, actual: result.status === 'returned' && typeof result.output === 'boolean' ? result.output : null });
    if (result.status === 'UNKNOWN') report.failures.push({ kind: 'UNKNOWN', ...item, result });
    else if (result.status !== 'returned' || result.output !== item.expected) report.failures.push({ kind: 'mismatch', ...item, result });
  }
} else if (spec.mode === 'fault') {
  const inputs = jsonFile(root, spec.inputs);
  if (!Array.isArray(inputs) || inputs.length > 10000) throw new Error('Fault inputs must be an array of at most 10000 values');
  for (const input of inputs) {
    const result = await call(input);
    if (result.status === 'hang' && result.faultCalls > 0) report.failures.push({ kind: 'missing-timeout', input, result });
    else if (result.status === 'hang') report.failures.push({ kind: 'UNKNOWN', input, result, reason: 'The call timed out before an injected fetch was observed' });
    else if (result.status === 'UNKNOWN' || result.faultCalls === 0) report.failures.push({ kind: 'UNKNOWN', input, result, reason: result.reason ?? 'The subject did not call fetch' });
    else if (result.status === 'crashed' || (spec.mustHandle && (result.status === 'threw' || result.effects.rejections.length))) report.failures.push({ kind: 'escaped-error', input, result });
  }
} else if (spec.mode === 'decision-table') {
  const checked = validateDecisionTable(jsonFile(root, spec.table));
  if (!checked.ok) throw new Error(`Invalid decision table: ${JSON.stringify(checked.problems)}`);
  if (checked.table.subject.file !== spec.subject.file || checked.table.subject.export !== spec.subject.export) throw new Error('The decision table subject differs from the harness subject');
  const table = checkDecisionTable(checked.table);
  report.method = table.method; report.combinations = table.combinations;
  for (const item of table.cases) {
    const result = await call(item.values);
    if (result.status === 'UNKNOWN') report.failures.push({ kind: 'UNKNOWN', input: item.values, reason: result.reason });
    else if (item.state !== 'covered') report.failures.push({ kind: 'UNKNOWN', input: item.values, reason: item.state });
    else if (result.status !== 'returned' || !same(result.output, stable(item.expected))) report.failures.push({ kind: 'mismatch', input: item.values, expected: item.expected, result });
  }
} else if (spec.mode === 'route') {
  const result = await call(null);
  if (result.status !== 'returned') report.failures.push({ kind: result.status === 'UNKNOWN' ? 'UNKNOWN' : 'mismatch', result });
  else for (const check of result.output.checks) {
    const unknown = check.problems.filter((x) => x.startsWith('UNKNOWN:')), known = check.problems.filter((x) => !x.startsWith('UNKNOWN:'));
    if (known.length) report.failures.push({ ...check, kind: 'mismatch', problems: known });
    if (unknown.length) report.failures.push({ ...check, kind: 'UNKNOWN', problems: unknown });
  }
} else {
  const checked = validateStateModel(jsonFile(root, spec.model));
  if (!checked.ok) throw new Error(`Invalid state model: ${JSON.stringify(checked.problems)}`);
  if (checked.model.subject && (checked.model.subject.file !== spec.subject.file || checked.model.subject.export !== spec.subject.export)) throw new Error('The state model subject differs from the harness subject');
  for (const transition of checked.model.transitions) {
    const result = await call(transition, { state: transition });
    if (result.status === 'UNKNOWN') report.failures.push({ kind: 'UNKNOWN', input: transition, reason: result.reason });
    else if (result.status !== 'returned' || !same(result.output, stable(transition.to))) report.failures.push({ kind: 'mismatch', input: transition, expected: transition.to, result });
  }
}
report.executed = report.calls.length;
const text = JSON.stringify(report);
if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Harness report exceeds 16 MiB');
writeFileSync('.code-map-harness/result.json', text);
