import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repository, analyzed } from './nextjs-fixture.mjs';

const files = (source, version = '^33.0.0') => ({
  'package.json': JSON.stringify({ name: 'desktop', main: 'dist/main.js', devDependencies: { electron: version } }),
  'tsconfig.electron.json': JSON.stringify({ compilerOptions: { outDir: 'dist', rootDir: 'electron' }, include: ['electron'] }),
  'electron/main.ts': `import { BrowserWindow, BrowserView, shell } from 'electron';\n${source}\n`,
  'electron/preload.ts': 'export const bridge = 1;\n',
});
const security = (root) => analyzed(root).analysis.frameworks.electron;
const rules = (root, rule) => analyzed(root).findings.filter((f) => f.ruleId === rule);

test('Electron context isolation, sandbox and permission boundaries', (t) => {
  const { root } = repository(t, files(`const prefs = { nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false, allowRunningInsecureContent: true };
const options = { webPreferences: prefs }; new BrowserWindow(options); new BrowserView({ webPreferences: { sandbox: false } });
shell.openExternal(url); shell.openExternal('https://example.com');`));
  assert.equal(rules(root, 'ELECTRON-UNSAFE-WEB-PREFERENCES').length, 6);
  assert.equal(rules(root, 'ELECTRON-NO-PERMISSION-HANDLER').length, 1);
  assert.equal(rules(root, 'ELECTRON-OPEN-EXTERNAL-UNCHECKED').length, 1);
  assert.equal(security(root).windows[0].preferences.sandbox.value, false);
});

test('Electron defaults use the lowest allowed version and preserve unknown values', (t) => {
  const old = repository(t, files('new BrowserWindow({});', '^19.0.0')).root;
  assert.deepEqual(rules(old, 'ELECTRON-UNSAFE-WEB-PREFERENCES').map((f) => f.facts.preference), ['sandbox']);
  const modern = repository(t, files('new BrowserWindow({}); session.setPermissionRequestHandler(handler);', '>=20 <34')).root;
  assert.equal(rules(modern, 'ELECTRON-UNSAFE-WEB-PREFERENCES').length, 0);
  assert.equal(rules(modern, 'ELECTRON-NO-PERMISSION-HANDLER').length, 0);
  const unknown = repository(t, files('new BrowserWindow({ webPreferences: { sandbox: flag } });', 'workspace:*')).root;
  assert.equal(rules(unknown, 'ELECTRON-UNSAFE-WEB-PREFERENCES').length, 0);
  assert.equal(security(unknown).windows[0].preferences.contextIsolation.state, 'UNKNOWN');
  const ancient = repository(t, files('new BrowserWindow({});', '^4.0.0 || ^33.0.0')).root;
  assert.equal(rules(ancient, 'ELECTRON-UNSAFE-WEB-PREFERENCES').length, 3);
});

test('Electron packaging entry points resolve build output and prevent orphan findings', (t) => {
  const { root } = repository(t, files(`import path from 'node:path';
new BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.js') } });
new BrowserView({ webPreferences: { preload: './dist/preload.js' } });`));
  assert.deepEqual(security(root).entries.map(({ path, role }) => [path, role]), [['electron/main.ts', 'main'], ['electron/preload.ts', 'preload']]);
  assert.deepEqual(rules(root, 'FILE-ORPHANED'), []);
});

test('Electron unresolved packaging entries give an electronEntries gap', (t) => {
  const { root, run } = repository(t, { ...files('new BrowserWindow({ webPreferences: { preload: computed } });'), 'package.json': JSON.stringify({ main: 'missing.js', dependencies: { electron: '^33.0.0' } }) });
  const data = analyzed(root);
  assert.equal(data.analysis.frameworks.electron.unresolvedEntries.length, 2);
  const result = run(['inspect', '--ref', 'HEAD', '--summary']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.gaps.find((gap) => gap.key === 'electronEntries').count, 2);
  assert.equal(report.frameworks.electron.detected, true);
});

test('Electron OS-specific behavior is inventoried and verify reports platformsTouched', (t) => {
  const { root, store, put, git, run } = repository(t, files(`if (process.platform === 'darwin') {}\nif ('win32' !== os.platform()) {}\nif (os.platform() === 'freebsd') {}`));
  assert.deepEqual(security(root).platforms.find((f) => f.path === 'electron/main.ts').platforms, ['darwin', 'freebsd', 'win32']);
  const base = git('rev-parse', 'HEAD');
  put('electron/main.ts', "if (process.platform === 'linux') {}\n");
  git('add', '.'); git('commit', '-qm', 'change platform');
  put('request.json', JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', intent: 'Update platform code.', acceptanceCriteria: [], allowedPaths: ['electron/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [], execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const out = join(store, 'verification');
  const result = run(['verify', '--request', 'request.json', '--out-dir', out]);
  assert.ok([0, 2, 3].includes(result.status), result.stderr);
  const latest = JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8'));
  const output = JSON.parse(readFileSync(join(out, latest.results.path), 'utf8'));
  assert.deepEqual(output.electron.platformsTouched, ['darwin', 'freebsd', 'linux', 'win32']);
  assert.match(readFileSync(join(out, latest.report.path), 'utf8'), /Electron platforms touched: darwin, freebsd, linux, win32/);
});

test('projects without an Electron dependency have no Electron block or findings', (t) => {
  const { root } = repository(t, { 'package.json': '{}', 'src/main.ts': 'new BrowserWindow({ webPreferences: { sandbox: false } });' });
  assert.equal(security(root), undefined);
  assert.equal(analyzed(root).findings.filter((f) => f.ruleId.startsWith('ELECTRON-')).length, 0);
});

test('Electron version lower bounds handle strict comparators, wildcards and unknown ranges', (t) => {
  const strict = repository(t, files('new BrowserWindow({});', '>19')).root;
  assert.equal(rules(strict, 'ELECTRON-UNSAFE-WEB-PREFERENCES').length, 0);
  const wildcard = repository(t, files('new BrowserWindow({});', '19.x || 33.x')).root;
  assert.deepEqual(rules(wildcard, 'ELECTRON-UNSAFE-WEB-PREFERENCES').map((f) => f.facts.preference), ['sandbox']);
  const invalid = repository(t, files('new BrowserWindow({});', '^19 >=33')).root;
  assert.equal(security(invalid).windows[0].preferences.sandbox.state, 'UNKNOWN');
  const unknown = repository(t, files('new BrowserWindow({});', 'file:../electron')).root;
  assert.equal(security(unknown).windows[0].preferences.webSecurity.state, 'UNKNOWN');
});

test('Electron computed options preserve uncertainty and renderer permissions do not cover main windows', (t) => {
  const { root } = repository(t, { ...files(`new BrowserWindow(options); new BrowserView({ webPreferences: { ...dynamic } });`),
    'src/renderer.ts': 'session.setPermissionRequestHandler(handler);' });
  assert.equal(rules(root, 'ELECTRON-UNSAFE-WEB-PREFERENCES').length, 0);
  assert.equal(rules(root, 'ELECTRON-NO-PERMISSION-HANDLER').length, 1);
  assert.equal(security(root).windows[0].preferences.sandbox.state, 'UNKNOWN');
});

test('Electron permission handlers in imported main-process modules cover windows', (t) => {
  const { root } = repository(t, { ...files(`import './permissions'; new BrowserWindow({});`),
    'electron/permissions.ts': 'session.setPermissionRequestHandler(handler);' });
  assert.equal(rules(root, 'ELECTRON-NO-PERMISSION-HANDLER').length, 0);
});

test('Electron summary bounds each inventory and retains total counts', (t) => {
  const { run } = repository(t, files('new BrowserWindow({});\n'.repeat(25)));
  const result = run(['inspect', '--ref', 'HEAD', '--summary']);
  assert.equal(result.status, 0, result.stderr);
  const electron = JSON.parse(result.stdout).frameworks.electron;
  assert.equal(electron.windows.total, 25);
  assert.equal(electron.windows.items.length, 20);
});

test('Electron packaging entry points resolve named path imports through TypeScript output', (t) => {
  const { root } = repository(t, {
    'package.json': JSON.stringify({ main: 'dist-electron/electron/main.js', devDependencies: { electron: '^33.0.0' } }),
    'tsconfig.electron.json': JSON.stringify({ compilerOptions: { rootDir: '.', outDir: 'dist-electron' }, include: ['electron'] }),
    'electron/main.ts': `import { BrowserWindow } from 'electron';
import { join, resolve as resolvePath } from 'node:path'; import { join as joinPath, resolve } from 'path';
new BrowserWindow({ webPreferences: { preload: join(__dirname, 'preload.cjs') } });
new BrowserWindow({ webPreferences: { preload: resolvePath(__dirname, 'preload.cjs') } });
new BrowserWindow({ webPreferences: { preload: joinPath(__dirname, 'preload.cjs') } });
new BrowserWindow({ webPreferences: { preload: resolve(__dirname, 'preload.cjs') } });`,
    'electron/preload.cts': 'export const bridge = 1;',
  });
  const result = analyzed(root);
  assert.deepEqual(result.analysis.frameworks.electron.unresolvedEntries, []);
  assert.deepEqual(result.analysis.frameworks.electron.entries, [{ path: 'electron/main.ts', role: 'main' }, { path: 'electron/preload.cts', role: 'preload' }]);
  assert.deepEqual(result.findings.filter((x) => x.ruleId === 'FILE-ORPHANED'), []);
});

test('Electron named path imports exclude shadowed and unrelated functions', (t) => {
  const { root } = repository(t, files(`import { join } from 'node:path';
import { resolve } from './other';
function local(join) { new BrowserWindow({ webPreferences: { preload: join(__dirname, 'preload.js') } }); }
new BrowserWindow({ webPreferences: { preload: resolve(__dirname, 'preload.js') } });`));
  assert.deepEqual(security(root).unresolvedEntries.map((x) => x.reason), ['dynamic-path', 'dynamic-path']);
  assert.deepEqual(security(root).entries, [{ path: 'electron/main.ts', role: 'main' }]);
});

test('Electron ES-module preload paths resolve bound URL imports through TypeScript output', (t) => {
  const { root, run } = repository(t, {
    'package.json': JSON.stringify({ type: 'module', main: 'dist/electron/main.js', devDependencies: { electron: '^33.0.0' } }),
    'tsconfig.electron.json': JSON.stringify({ compilerOptions: { rootDir: '.', outDir: 'dist', module: 'NodeNext' }, include: ['electron'] }),
    'electron/main.ts': `import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { fileURLToPath as toPath } from 'url';
import * as url from 'node:url';
import * as legacyUrl from 'url';
new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL('./preload.js', import.meta.url)), contextIsolation: true } });
new BrowserWindow({ webPreferences: { preload: toPath(new URL('./preload.js', import.meta.url)) } });
new BrowserWindow({ webPreferences: { preload: url.fileURLToPath(new URL('./preload.js', import.meta.url)) } });
new BrowserWindow({ webPreferences: { preload: legacyUrl.fileURLToPath(new URL('./preload.js', import.meta.url)) } });`,
    'electron/preload.ts': 'export const bridge = 1;',
  });
  const result = analyzed(root);
  assert.deepEqual(result.analysis.frameworks.electron.entries, [{ path: 'electron/main.ts', role: 'main' }, { path: 'electron/preload.ts', role: 'preload' }]);
  assert.deepEqual(result.analysis.frameworks.electron.unresolvedEntries, []);
  assert.deepEqual(result.findings.filter((item) => item.ruleId === 'FILE-ORPHANED'), []);
  const summary = run(['inspect', '--ref', 'HEAD', '--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  const report = JSON.parse(summary.stdout);
  assert.deepEqual(report.frameworks.electron.entries.items, result.analysis.frameworks.electron.entries);
  assert.equal(report.gaps.some((gap) => gap.key === 'electronEntries'), false);
});

test('Electron ES-module preload paths reject shadowed imports and unsupported URL expressions', (t) => {
  const { root } = repository(t, files(`import { fileURLToPath } from 'node:url';
import * as url from 'url';
import { fileURLToPath as unrelated } from './other';
import * as other from './other';
function named(fileURLToPath) { new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL('./preload.js', import.meta.url)) } }); }
function namespace(url) { new BrowserWindow({ webPreferences: { preload: url.fileURLToPath(new URL('./preload.js', import.meta.url)) } }); }
function constructor(URL) { new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL('./preload.js', import.meta.url)) } }); }
new BrowserWindow({ webPreferences: { preload: unrelated(new URL('./preload.js', import.meta.url)) } });
new BrowserWindow({ webPreferences: { preload: other.fileURLToPath(new URL('./preload.js', import.meta.url)) } });
new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL(dynamic, import.meta.url)) } });
new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL('./preload.js', other.url)) } });
new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL('https://example.com/preload.js', import.meta.url)) } });
new BrowserWindow({ webPreferences: { preload: fileURLToPath(new URL('/preload.js', import.meta.url)) } });`));
  assert.deepEqual(security(root).entries, [{ path: 'electron/main.ts', role: 'main' }]);
  assert.deepEqual(security(root).unresolvedEntries.map((item) => item.reason), Array(9).fill('dynamic-path'));
});
