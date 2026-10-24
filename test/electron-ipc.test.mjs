import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareFindings } from '../lib/compare.mjs';
import { analyzeElectronIpc } from '../lib/frameworks/electron-ipc.mjs';
import { analyzed, repository } from './nextjs-fixture.mjs';

const files = {
  'package.json': JSON.stringify({ dependencies: { electron: '^33.0.0' } }),
  'src/channels.ts': `export const Channels = { get: 'settings:get' } as const; export enum Names { ping = 'ping' }`,
  'src/wrappers.ts': `import { ipcMain as main, ipcRenderer as page } from 'electron';
export function handleIpc(channel, listener) { main.handle(channel, listener); }
export const invoke = (channel, ...args) => page.invoke(channel, ...args);
export function second(channel) { return invoke(channel); }
export function third(channel) { return second(channel); }`,
  'src/main.ts': `import * as electron from 'electron'; import { handleIpc } from './wrappers'; import { Channels, Names } from './channels';
handleIpc(Channels.get, () => 1); electron.ipcMain.on(Names.ping, () => {});
electron.ipcMain.handleOnce('unused', () => 1); electron.ipcMain.removeHandler('removed');
win.webContents.send('news'); contents.send('typed');
function notify(contents: Electron.WebContents) { contents.send('typed'); }
function listener(event) { event.sender.send('reply'); event.reply('reply'); }
electron.ipcMain.on('request', listener);`,
  'src/preload.ts': `const { ipcRenderer: page } = require('electron'); import { third } from './wrappers'; import { Channels } from './channels';
third(Channels.get); page.send('ping'); page.invoke('missing'); page.invoke('ping'); page.sendSync('request');
page.on('reply', () => {}); page.once('typed', () => {});`,
};
const report = (input) => analyzeElectronIpc({ texts: new Map(Object.entries(input)), files: Object.keys(input).filter((p) => p.endsWith('.ts')).map((path) => ({ path })) });

test('maps aliased IPC, cross-file wrappers, constants and all contract findings', () => {
  const ipc = report(files);
  assert.equal(ipc.wrappers.length, 4);
  assert.equal(ipc.channels.find((c) => c.channel === 'settings:get').consumers.length, 1);
  assert.equal(ipc.channels.find((c) => c.channel === 'settings:get').producers.length, 1);
  assert.deepEqual(ipc.leads.map((x) => [x.ruleId, x.channel]).sort(), [
    ['ELECTRON-IPC-KIND-MISMATCH', 'ping'], ['ELECTRON-IPC-NO-HANDLER', 'missing'],
    ['ELECTRON-IPC-NO-LISTENER', 'news'], ['ELECTRON-IPC-UNUSED-HANDLER', 'unused'],
  ].sort());
  assert.equal(ipc.unknownChannels.length, 0);
  assert.equal(ipc.calls.filter((c) => c.method === 'removeHandler').length, 1);
});

test('matches fixed template prefixes and suppresses uncertain missing and unused contracts', () => {
  const ipc = report({ ...files, 'src/dynamic.ts': `import { ipcMain, ipcRenderer } from 'electron';
ipcMain.handle(dynamic, fn); ipcRenderer.send(dynamic); ipcMain.on(dynamic, fn);
ipcRenderer.invoke(\`task:\${id}\`); ipcMain.handle('task:one', fn);
ipcRenderer.on(dynamic, fn); webContents.send('other');` });
  assert.equal(ipc.unknownChannels.length, 4);
  assert.ok(ipc.unknownChannels.every((x) => x.path === 'src/dynamic.ts' && x.line > 0));
  assert.deepEqual(ipc.leads, []);
  const patterns = report({ 'package.json': files['package.json'], 'src/patterns.ts': `import { ipcMain, ipcRenderer } from 'electron';
ipcMain.handle(\`task:\${id}\`, fn); ipcRenderer.invoke('task:one');
ipcRenderer.on(\`news:\${id}\`, fn); webContents.send('news:one');
ipcRenderer.invoke('task-other');` });
  assert.deepEqual(patterns.leads.map((x) => [x.ruleId, x.channel]), [['ELECTRON-IPC-NO-HANDLER', 'task-other']]);
  const unknownKind = report({ 'package.json': files['package.json'], 'src/unknown.ts': `import { ipcMain, ipcRenderer } from 'electron';
ipcMain.on(dynamic, fn); ipcRenderer.invoke('uncertain');` });
  assert.deepEqual(unknownKind.leads, [], 'an UNKNOWN channel alone cannot establish a kind mismatch');
});

test('ignores projects without an Electron dependency and unrelated shadowed APIs', () => {
  assert.equal(report({ ...files, 'package.json': '{}' }), null);
  const ipc = report({ 'package.json': files['package.json'], 'src/a.ts': `import { ipcRenderer } from 'electron'; ipcRenderer.toString('not-ipc'); function local(ipcRenderer) { ipcRenderer.invoke('fake'); } const fake = { send() {} }; fake.send('fake');` });
  assert.equal(ipc.calls.length, 0);
});

test('stores IPC findings and paginates the informational summary inventory', (t) => {
  const repo = repository(t, files), result = analyzed(repo.root);
  assert.ok(result.findings.some((x) => x.ruleId === 'ELECTRON-IPC-NO-HANDLER' && x.capability === 'C26'));
  const output = repo.run(['inspect', '--summary', '--worktree', '--store', repo.store]);
  assert.equal(output.status, 0, output.stderr);
  const summary = JSON.parse(output.stdout);
  assert.equal(summary.frameworks.electronIpc.wrappers, 4);
  const command = summary.frameworks.electronIpc.next;
  const page = repo.run([...command.split(' ').slice(1), '--limit', '1']);
  assert.equal(page.status, 0, page.stderr);
  assert.equal(JSON.parse(page.stdout).page.items.length, 1);
});

test('resolves const aliases, computed object members and typed WebContents without executing code', () => {
  const ipc = report({ 'package.json': files['package.json'], 'src/calls.ts': `
import { ipcMain as main, ipcRenderer as page } from 'electron';
import type { WebContents } from 'electron';
const key = 'ready'; const Channels = { ready: key } as const;
main.once(Channels['ready'], () => {}); page.sendSync(key);
function emit(target: WebContents) { target.send('update'); }
page.once('update', () => {});
throw new Error('Project code must never run');` });
  assert.deepEqual(ipc.channels.map((x) => x.channel), ['ready', 'update']);
  assert.equal(ipc.calls.length, 4);
  assert.deepEqual(ipc.leads, []);
});

test('bounds wrapper following at three levels and does not confuse same-name local wrappers', () => {
  const ipc = report({ ...files, 'src/bounds.ts': `import { third } from './wrappers';
export function fourth(channel) { return third(channel); }
fourth('too-deep');
function local() { function third(channel) { return channel; } third('local'); }` });
  assert.ok(!ipc.channels.some((x) => x.channel === 'too-deep' || x.channel === 'local'));
  assert.ok(!ipc.wrappers.some((x) => x.name === 'fourth'));
});

test('labels a channel rename as NEW, retains EXISTING leads and resolves a repaired contract', (t) => {
  const repo = repository(t, files), base = analyzed(repo.root);
  repo.put('src/preload.ts', files['src/preload.ts'].replace("page.invoke('missing')", "page.invoke('renamed')"));
  repo.git('add', '.'); repo.git('commit', '-qm', 'rename');
  const head = analyzed(repo.root);
  const stored = (result) => ({ data: { analysis: result.analysis }, findings: result.findings.filter((x) => x.ruleId.startsWith('ELECTRON-IPC-')) });
  const comparison = compareFindings(stored(base), stored(head), { comparability: { state: 'COMPARABLE', reasons: [] } });
  const renamed = head.findings.find((x) => x.ruleId === 'ELECTRON-IPC-NO-HANDLER' && x.facts.channel === 'renamed');
  const retained = head.findings.find((x) => x.ruleId === 'ELECTRON-IPC-KIND-MISMATCH');
  assert.equal(comparison.statuses[renamed.id].baseline, 'NEW');
  assert.equal(comparison.statuses[retained.id].baseline, 'EXISTING');
  assert.equal(comparison.resolved.find((x) => x.finding.ruleId === 'ELECTRON-IPC-NO-HANDLER').finding.facts.channel, 'missing');
});

test('follows injected wrappers through object properties without guessing names', (t) => {
  const fixture = {
    'package.json': files['package.json'],
    'electron/ipcGuard.ts': `import { ipcMain } from 'electron';
export function handleIpc(channel: string, listener: (...args: unknown[]) => unknown) { ipcMain.handle(channel, listener); }
export function onIpc(channel: string, listener: (...args: unknown[]) => unknown) { ipcMain.on(channel, listener); }`,
    'electron/ipc/handlers.ts': `import type { handleIpc } from '../ipcGuard.js';
interface Deps { handleIpc: (channel: string, listener: (...args: unknown[]) => unknown) => void }
export function registerHandlers(deps: Deps) { const { handleIpc } = deps; handleIpc('settings:get', () => ({})); }
export function renamed(deps) { const { register: local } = deps; local('renamed', () => {}); }
export function direct(deps) { deps.register('direct', () => {}); }
export function destructured({ register }) { register('destructured', () => {}); }
export function multiple(deps) { deps.register('multiple', () => {}); }
export function unrelated(deps) { deps.handleIpc('fake', () => {}); }
export function relay(deps) { direct({ register: deps.register }); }
export function tooDeep(deps) { relay({ register: deps.register }); }`,
    'electron/main.ts': `import { handleIpc, onIpc } from './ipcGuard.js';
import { registerHandlers, renamed, direct, destructured, multiple, unrelated, relay, tooDeep } from './ipc/handlers.js';
registerHandlers({ handleIpc }); renamed({ register: handleIpc }); direct({ register: onIpc });
destructured({ register: handleIpc }); multiple({ register: handleIpc }); multiple({ register: onIpc });
unrelated({ handleIpc: () => {} }); relay({ register: handleIpc }); tooDeep({ register: onIpc });`,
    'electron/preload.ts': `import { ipcRenderer } from 'electron';
ipcRenderer.invoke('settings:get'); ipcRenderer.invoke('renamed'); ipcRenderer.send('direct');
ipcRenderer.invoke('destructured'); ipcRenderer.invoke('multiple'); ipcRenderer.send('multiple'); ipcRenderer.invoke('fake');`,
  };
  const repo = repository(t, fixture), ipc = analyzed(repo.root).analysis.frameworks.electronIpc;
  assert.deepEqual(ipc.leads.map((x) => [x.ruleId, x.channel]), [['ELECTRON-IPC-NO-HANDLER', 'fake']]);
  assert.deepEqual(ipc.channels.find((x) => x.channel === 'multiple').consumers.map((x) => x.kind).sort(), ['handle', 'on']);
  assert.deepEqual(ipc.channels.find((x) => x.channel === 'direct').consumers.map((x) => x.kind).sort(), ['handle', 'on']);
  assert.equal(ipc.unknownChannels.length, 0);
});

test('injected wrapper propagation stops at three levels and isolates parameter bindings', () => {
  const ipc = report({
    'package.json': files['package.json'],
    'src/main.ts': `import { ipcMain } from 'electron';
function handle(channel, listener) { ipcMain.handle(channel, listener); }
function shallow({ register }) { register('shallow', () => {}); }
function middle({ register }) { shallow({ register }); }
function deep({ register }) { middle({ register }); }
function other({ register }) { register('unrelated', () => {}); }
middle({ register: handle }); deep({ register: handle }); other({ register: () => {} });
function deepOnly(deps) { deps.register('too-deep', () => {}); }
function hop(deps) { deepOnly({ register: deps.register }); }
function start(deps) { hop({ register: deps.register }); }
start({ register: handle });`,
  });
  assert.deepEqual(ipc.channels.map((x) => x.channel), ['shallow']);
  assert.equal(ipc.calls.filter((x) => x.channel?.value === 'shallow').length, 1);
});
