import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from './worker-fixtures.mjs';
const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const sample = (n) => ({ readyMs: n, readyToShowMs: n + 10, didFinishLoadMs: n + 20,
  processes: [{ type: 'Browser', workingSetKB: n * 100 }] });
const report = (values) => ({ reportType: 'code-map-electron-startup', schemaVersion: 1, seconds: 5, samples: values.map(sample) });

function fixture(env = { CODE_MAP_ELECTRON_REPORT: '/report.json' }, previous = null) {
  const app = new EventEmitter(), window = new EventEmitter();
  window.webContents = new EventEmitter();
  let elapsed = 50, callback, delay, saved, quits = 0;
  app.getAppMetrics = () => [{ type: 'Browser', memory: { workingSetSize: 123 } }, { type: 'Tab', memory: { workingSetSize: 456 } }];
  app.quit = () => { quits++; };
  const { startProbe } = require('../lib/electron/probe.cjs');
  const active = startProbe(app, { now: () => elapsed, after: (ms, fn) => { delay = ms; callback = fn; } },
    { read: () => previous, write: (path, value) => { saved = { path, value }; } }, env);
  return { app, window, active, tick: (n) => { elapsed = n; }, finish: () => callback(),
    state: () => ({ saved, quits, delay }) };
}

test('Electron probe records process-start milestones and per-process memory then quits', () => {
  const f = fixture();
  f.tick(100); f.app.emit('ready');
  f.app.emit('browser-window-created', {}, f.window);
  const other = new EventEmitter(); other.webContents = new EventEmitter();
  f.app.emit('browser-window-created', {}, other);
  f.tick(200); other.emit('ready-to-show');
  f.tick(300); f.window.webContents.emit('did-finish-load');
  f.tick(400); f.window.emit('ready-to-show');
  f.tick(500); f.window.emit('ready-to-show');
  f.finish();
  assert.equal(f.active, true);
  assert.deepEqual(f.state(), { delay: 5000, quits: 1, saved: { path: '/report.json', value: {
    reportType: 'code-map-electron-startup', schemaVersion: 1, seconds: 5,
    samples: [{ readyMs: 100, readyToShowMs: 400, didFinishLoadMs: 300,
      processes: [{ type: 'Browser', workingSetKB: 123 }, { type: 'Tab', workingSetKB: 456 }] }] } } });
});

test('Electron probe appends bounded samples and preserves missing milestones as null', () => {
  const f = fixture(undefined, report([100])); f.finish();
  assert.equal(f.state().saved.value.samples.length, 2);
  assert.deepEqual(f.state().saved.value.samples[0], sample(100));
  assert.equal(f.state().saved.value.samples[1].readyMs, null);
  assert.equal(f.state().saved.value.samples[1].readyToShowMs, null);
  assert.equal(f.state().saved.value.samples[1].didFinishLoadMs, null);
  assert.throws(() => fixture(undefined, report(Array(100).fill(100))), /100/);
  assert.throws(() => fixture(undefined, {}), /report/i);
  assert.throws(() => fixture({ CODE_MAP_ELECTRON_REPORT: '/report.json', CODE_MAP_ELECTRON_SECONDS: '6' }, report([100])), /seconds/i);
});

test('Electron probe stays inert without a report path and bounds the collection delay', () => {
  const f = fixture({});
  assert.equal(f.active, false);
  assert.equal(f.app.eventNames().length, 0);
  assert.deepEqual(f.state(), { saved: undefined, quits: 0, delay: undefined });
  assert.equal(fixture({ CODE_MAP_ELECTRON_REPORT: '/x', CODE_MAP_ELECTRON_SECONDS: '2' }).state().delay, 2000);
  assert.throws(() => fixture({ CODE_MAP_ELECTRON_REPORT: '/x', CODE_MAP_ELECTRON_SECONDS: '301' }), /seconds/i);
  assert.throws(() => fixture({ CODE_MAP_ELECTRON_REPORT: '/x', CODE_MAP_ELECTRON_SECONDS: 'NaN' }), /seconds/i);
  assert.throws(() => fixture({ CODE_MAP_ELECTRON_REPORT: '/x', CODE_MAP_ELECTRON_SECONDS: '0' }), /seconds/i);
});

test('Electron startup validator rejects unknown fields and unbounded or invalid samples', () => {
  const { validateStartup } = require('../lib/electron/startup-schema.cjs');
  assert.equal(validateStartup(report([100, 200])).ok, true);
  assert.equal(validateStartup({ ...report([1]), extra: true }).ok, false);
  assert.equal(validateStartup({ ...report([1]), schemaVersion: 2 }).ok, false);
  assert.equal(validateStartup(report([])).ok, false);
  assert.equal(validateStartup(report(Array(101).fill(1))).ok, false);
  assert.equal(validateStartup({ ...report([1]), seconds: 301 }).ok, false);
  assert.equal(validateStartup({ ...report([1]), samples: [{ ...sample(1), readyMs: -1 }] }).ok, false);
  assert.equal(validateStartup({ ...report([1]), samples: [{ ...sample(1), readyMs: Infinity }] }).ok, false);
  assert.equal(validateStartup({ ...report([1]), samples: [{ ...sample(1), processes: Array(257).fill({ type: 'Tab', workingSetKB: 1 }) }] }).ok, false);
  assert.equal(validateStartup({ ...report([1]), samples: [{ ...sample(1), processes: [{ type: 'x'.repeat(129), workingSetKB: 1 }] }] }).ok, false);
  assert.equal(validateStartup({ ...report([1]), samples: [{ ...sample(1), processes: [{ type: 'Tab', workingSetKB: '1' }] }] }).ok, false);
});

test('electron-probe prints an absolute probe path and an opt-in example without Electron installed', () => {
  const r = spawnSync(process.execPath, [cli, 'electron-probe'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\/lib\/electron\/probe.cjs/);
  assert.match(r.stdout, /CODE_MAP_ELECTRON_REPORT=.*electron --require/);
});

test('verify binds Electron startup reports and compares slower and noisy heads as information', (t) => {
  const f = project(t), command = ['electron', '--require', '/probe.cjs', '.'];
  f.put('package.json', JSON.stringify({ devDependencies: { electron: '33.0.0' } }));
  f.git('add', '.'); f.git('commit', '-qm', 'Electron fixture');
  const base = f.git('rev-parse', 'HEAD');
  const invoke = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  const bind = (name, values) => {
    const artifact = `reports/${name}.json`, manifest = `reports/${name}.manifest.json`;
    f.put(artifact, JSON.stringify(report(values)));
    const r = invoke(['manifest', '--kind', 'electron-startup', '--artifact', artifact, '--exit-status', '0', '--out', manifest, '--', ...command]);
    assert.equal(r.status, 0, r.stderr);
    return { artifact, manifest };
  };
  const b = bind('base', [99, 100, 101]);
  f.put('src/sum.mjs', 'export function sum(a, b) { return a - b; }\n');
  const verify = (h) => {
    const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'worktree', intent: 'Measure startup.',
      acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
      reportInputs: [b, h], execution: { enabled: false, authorization: null,
        budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
    f.put('reports/request.json', JSON.stringify(request));
    const r = invoke(['verify', '--request', 'reports/request.json', '--store', f.store, '--out-dir', `${f.work}/out`]);
    assert.equal(r.status, 3, r.stderr);
    const summary = JSON.parse(r.stdout);
    return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
  };
  const slow = bind('slow', [199, 200, 201]), first = verify(slow);
  assert.equal(first.results.electronStartup.state, 'COMPARED');
  assert.equal(first.results.electronStartup.metrics.readyMs.changePercent, 100);
  assert.equal(first.results.electronStartup.metrics.readyMs.outsideNoise, true);
  assert.equal(first.results.electronStartup.metrics.readyToShowMs.outsideNoise, true);
  assert.equal(first.results.electronStartup.metrics.didFinishLoadMs.outsideNoise, true);
  assert.equal(first.results.electronStartup.metrics.totalMemoryKB.outsideNoise, true);
  assert.equal(first.results.executions[0].attestation, 'self-attested');
  assert.equal(first.results.executions[0].kind, 'electron-startup');
  assert.equal(first.results.executions[0].side, 'base');
  assert.equal(first.results.executions[1].side, 'head');
  assert.match(first.markdown, /Electron startup and memory/);
  assert.equal(first.results.obligations.some((x) => x.id.includes('electron')), false);
  const noisy = verify(bind('noisy', [80, 120, 160]));
  assert.equal(noisy.results.electronStartup.metrics.readyMs.outsideNoise, false);
  assert.deepEqual(noisy.results.ratings, first.results.ratings);
  assert.deepEqual(noisy.results.readiness, first.results.readiness);
  f.put(slow.artifact, '{}');
  assert.equal(verify(slow).results.executions[1].eligible, false);
});

test('Electron startup comparisons keep missing or incompatible observations UNKNOWN and honor timing thresholds', async () => {
  const { compareStartup, startupInformation } = await import('../lib/electron/startup-report.mjs');
  const bound = (values) => ({ ...report(values), run: { command: ['electron', '.'], tools: [], environment: {} } });
  const base = [bound([100, 100, 100])], head = [bound([120, 120, 120])];
  assert.equal(compareStartup({ base, head }, { minimumChangePercent: 30 }).metrics.readyMs.outsideNoise, false);
  assert.equal(compareStartup({ base, head: [] }).state, 'UNKNOWN');
  assert.equal(compareStartup({ base, head: [{ ...head[0], seconds: 6 }] }).state, 'UNKNOWN');
  assert.equal(compareStartup({ base, head: [bound([120])] }).state, 'UNKNOWN');
  assert.equal(compareStartup({ base, head: [{ ...head[0], run: {} }] }).state, 'UNKNOWN');
  const missing = { ...bound([120]), samples: [{ ...sample(120), readyMs: null }] };
  assert.equal(compareStartup({ base: [bound([100])], head: [missing] }).metrics.readyMs.state, 'UNKNOWN');
  assert.equal(compareStartup({ base: [bound([0])], head: [bound([1])] }).metrics.readyMs.state, 'UNKNOWN');
  assert.equal(startupInformation('{', {}).ok, false);
  assert.equal(startupInformation(JSON.stringify(report([1])), { exitStatus: 1 }).ok, false);
  assert.equal(startupInformation(JSON.stringify(report([1])), { exitStatus: 0, discovery: { filters: ['one'] } }).ok, false);
  assert.equal(startupInformation(' '.repeat(4 * 1024 * 1024 + 1), {}).ok, false);
});

test('Electron probe quits after a report write failure', () => {
  const { startProbe } = require('../lib/electron/probe.cjs');
  const app = new EventEmitter(); let finish, quits = 0;
  app.getAppMetrics = () => [{ type: 'Browser', memory: { workingSetSize: 1 } }];
  app.quit = () => { quits++; };
  startProbe(app, { now: () => 1, after: (_ms, fn) => { finish = fn; } },
    { read: () => null, write: () => { throw new Error('disk full'); } }, { CODE_MAP_ELECTRON_REPORT: '/x' });
  assert.throws(() => finish(), /disk full/);
  assert.equal(quits, 1);
});


test('Electron report files preserve the previous report and an existing temporary file on write failure', (t) => {
  const { probeFiles } = require('../lib/electron/probe.cjs');
  const root = mkdtempSync(join(tmpdir(), 'electron-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'report.json'), files = probeFiles();
  assert.equal(files.read(path), null);
  files.write(path, report([100]));
  assert.deepEqual(files.read(path), report([100]));
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, 'preserve this file');
  assert.throws(() => files.write(path, report([200])), /EEXIST/);
  assert.equal(readFileSync(temporary, 'utf8'), 'preserve this file');
  assert.deepEqual(files.read(path), report([100]));
  writeFileSync(path, ' '.repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => files.read(path), /4 MiB/);
  assert.throws(() => files.read(root), /regular file/);
});
