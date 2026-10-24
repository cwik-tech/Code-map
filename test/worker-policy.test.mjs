// The parts of the restricted worker that need no backend: backend selection, the Seatbelt profile, the bwrap arguments,
// the clean environment, the policy checks, the budgets and the process table. Nothing here starts a run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPolicy, cleanEnvironment, defaultProtectedFolders, findBackend, noBackendMessage, sandboxCommand } from '../lib/worker/backend.mjs';
import { budgetsFrom, checkBudgets, claimSlot, members, parsePs } from '../lib/worker/budgets.mjs';
import { bwrapCommand } from '../lib/worker/bwrap.mjs';
import { seatbeltProfile } from '../lib/worker/seatbelt.mjs';

const folder = (t) => { const path = realpathSync(mkdtempSync(join(tmpdir(), 'code-map-policy-'))); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
/** A fake stat result of a program file: its owner and its mode. */
const program = (uid, mode) => () => ({ isFile: () => true, uid, mode: 0o100000 | mode });

test('no backend: another system, a missing program or a program that others can change gives no backend, and the message says why', () => {
  assert.equal(findBackend({ platform: 'win32', stat: program(0, 0o755) }), null);
  assert.equal(findBackend({ platform: 'linux', stat: () => null }), null, 'no bwrap installed');
  assert.equal(findBackend({ platform: 'darwin', stat: program(0, 0o777) }), null, 'a sandbox-exec that others can change is not trusted');
  assert.equal(findBackend({ platform: 'darwin', stat: program(501, 0o755) }), null, 'a sandbox-exec that root does not own is not trusted');
  assert.deepEqual(findBackend({ platform: 'darwin', stat: program(0, 0o755) }), { name: 'seatbelt', executable: '/usr/bin/sandbox-exec' });
  assert.deepEqual(findBackend({ platform: 'linux', stat: (path) => path === '/usr/bin/bwrap' ? program(0, 0o755)() : null }), { name: 'bwrap', executable: '/usr/bin/bwrap' });
  for (const platform of ['win32', 'linux', 'freebsd']) assert.match(noBackendMessage(platform), /refuses to run .* never runs it without (a backend|isolation)/);
  assert.match(noBackendMessage('linux'), /bwrap/);
});

test('the policy reads protected folders only through the workspace, the Node.js folder and the read-only links, and refuses a credential folder', (t) => {
  const root = folder(t), home = join(root, 'home'), workspace = join(home, '.cache', 'code-map', 'workspaces', 'R-1'), node = join(home, '.nvm', 'versions', 'node', 'v24');
  for (const path of [workspace, node, join(home, '.ssh'), join(home, '.config')]) mkdirSync(path, { recursive: true });
  const policy = buildPolicy({ workspace, nodePrefix: node, links: [{ source: join(root, 'repo', 'node_modules'), target: join(workspace, 'tree', 'node_modules') }], protectedFolders: [home, join(root, 'repo')], home });
  assert.deepEqual(policy.readable, [workspace, node, join(root, 'repo', 'node_modules')]);
  assert.deepEqual(policy.protected, [home, join(root, 'repo')]);
  for (const parent of [home, join(home, '.cache'), join(home, '.cache', 'code-map'), join(home, '.nvm'), join(root, 'repo')]) assert.ok(policy.ancestors.includes(parent), parent);
  assert.ok(!policy.ancestors.includes(root), 'a folder outside the protected folders needs no exception');
  assert.ok(policy.secrets.includes(join(home, '.ssh')) && policy.secrets.includes(join(home, '.npmrc')), JSON.stringify(policy.secrets));
  assert.throws(() => buildPolicy({ workspace: join(home, '.config', 'w'), nodePrefix: node, protectedFolders: [home], home }), /workspace .* inside the credential folder/);
  assert.throws(() => buildPolicy({ workspace, nodePrefix: join(home, '.ssh', 'node'), protectedFolders: [home], home }), /Node\.js .* inside the credential folder/);
  assert.throws(() => buildPolicy({ workspace: 'relative/w', nodePrefix: node, protectedFolders: [home], home }), /absolute/);
  const defaults = defaultProtectedFolders({ platform: 'darwin', home, temporary: join(root, 'tmp'), repository: join(root, 'repo'), store: join(root, 'store') });
  for (const path of ['/Users', '/Volumes', home, join(root, 'repo'), join(root, 'store')]) assert.ok(defaults.includes(path), path);
});

test('the Seatbelt profile denies by default, passes each path as a parameter, and lists the exceptions after the protected folders', (t) => {
  const root = folder(t), home = join(root, 'ho"me)'), workspace = join(home, 'w');
  mkdirSync(workspace, { recursive: true });
  const policy = buildPolicy({ workspace, nodePrefix: '/usr/local', protectedFolders: [home], home });
  const { profile, params } = seatbeltProfile(policy), lines = profile.trim().split('\n');
  assert.deepEqual(lines.slice(0, 2), ['(version 1)', '(deny default)']);
  assert.ok(!profile.includes(home), 'a path is never part of the profile text, so it cannot change the profile');
  assert.deepEqual(params.find(([name]) => name === 'PROTECTED_0'), ['PROTECTED_0', home]);
  const at = (pattern) => lines.findIndex((line) => pattern.test(line));
  assert.ok(at(/^\(allow file-read\*\)$/) < at(/^\(deny file-read\* \(subpath \(param "PROTECTED_0"\)\)\)$/), 'reads are open, then the protected folders are closed');
  assert.ok(at(/^\(deny file-read\* \(subpath \(param "PROTECTED_0"\)/) < at(/^\(allow file-read\* \(subpath \(param "READ_0"\)\)/), 'the exceptions come after the protected folders');
  assert.ok(at(/^\(allow file-read\* \(subpath/) < at(/^\(deny file-read\* file-write\* \(subpath \(param "SECRET_0"\)/), 'the credential folders stay closed, also inside an exception');
  assert.equal(lines.filter((line) => /^\(allow file-write\*/.test(line)).join(), '(allow file-write* (subpath (param "WORKSPACE")))', 'writes go only into the workspace');
  assert.ok(lines.includes('(deny network*)') && !lines.some((line) => /allow network/.test(line)), 'no network rule allows a connection');
  const empty = seatbeltProfile({ ...policy, protected: [], ancestors: [], secrets: [] }).profile;
  assert.ok(!/\(deny file-read\*\)/.test(empty), 'an empty list never becomes a rule without a filter, which would close every path');
  const command = sandboxCommand({ name: 'seatbelt', executable: '/usr/bin/sandbox-exec' }, policy, ['node', '--test', '$(id)'], workspace);
  assert.equal(command.file, '/usr/bin/sandbox-exec');
  assert.deepEqual(command.args.slice(-4), ['--', 'node', '--test', '$(id)'], 'the command words go to the backend as they are, with no shell');
});

test('the bwrap arguments give a new namespace without network, bind the workspace, and bind nothing else of a protected folder', (t) => {
  const root = folder(t), home = join(root, 'home'), workspace = join(root, 'store', 'workspaces', 'R-1'), node = join(home, '.nvm', 'v24');
  for (const path of [workspace, node]) mkdirSync(path, { recursive: true });
  const link = { source: join(root, 'repo', 'node_modules'), target: join(workspace, 'tree', 'node_modules') };
  const policy = buildPolicy({ workspace, nodePrefix: node, links: [link], protectedFolders: [home, join(root, 'store')], home });
  const entry = (path) => path === '/bin' ? { isSymbolicLink: () => true } : ['/usr', '/lib'].includes(path) ? { isSymbolicLink: () => false } : null;
  const { file, args } = bwrapCommand('/usr/bin/bwrap', policy, ['node', '--test'], { cwd: join(workspace, 'tree'), entry, readLink: () => 'usr/bin' });
  assert.equal(file, '/usr/bin/bwrap');
  for (const flag of ['--unshare-all', '--die-with-parent', '--new-session']) assert.ok(args.includes(flag), flag);
  assert.ok(!args.includes('--share-net'));
  const pairs = (flag) => args.flatMap((word, index) => word === flag ? [[args[index + 1], args[index + 2]]] : []);
  assert.deepEqual(pairs('--bind'), [[join(workspace, 'tmp'), '/tmp'], [workspace, workspace]]);
  assert.deepEqual(pairs('--ro-bind'), [['/usr', '/usr'], ['/lib', '/lib'], [node, node], [link.source, link.target]]);
  assert.deepEqual(pairs('--symlink'), [['usr/bin', '/bin']]);
  assert.ok(!args.some((word) => word === home || word === join(home, '.ssh')), 'the home folder is not in the new root');
  assert.deepEqual(args.slice(args.indexOf('--chdir'), args.indexOf('--chdir') + 2), ['--chdir', join(workspace, 'tree')]);
  assert.deepEqual(args.slice(-3), ['--', 'node', '--test']);
});

test('the clean environment has only PATH, HOME, TMPDIR, CI and the locale: no token, key or option of the parent', () => {
  const env = cleanEnvironment({ workspace: '/w', nodeDirectory: '/opt/node/bin', env: { PATH: '/evil', HOME: '/Users/me', GITHUB_TOKEN: 'x', NODE_OPTIONS: '--require /tmp/x.js', LANG: 'en_US.UTF-8', LC_ALL: 'bad;value' } });
  assert.deepEqual(env, { PATH: '/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/w/home', TMPDIR: '/w/tmp', CI: '1', LANG: 'en_US.UTF-8' });
  assert.equal(cleanEnvironment({ workspace: '/w', nodeDirectory: '/n', env: {} }).LANG, 'C');
});

test('budget options are whole numbers within the request limits, and a run cannot ask for more than its authorization', () => {
  assert.deepEqual(budgetsFrom({ 'wall-clock-seconds': '30', concurrency: '2' }), { wallClockSeconds: 30, concurrency: 2 });
  for (const [name, value] of [['wall-clock-seconds', '0'], ['memory-megabytes', '65537'], ['output-megabytes', '1.5'], ['concurrency', '-1']]) {
    assert.throws(() => budgetsFrom({ [name]: value }), new RegExp(`--${name} must be a whole number`), `${name} ${value}`);
  }
  const maxima = { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 };
  assert.doesNotThrow(() => checkBudgets(maxima, maxima));
  assert.throws(() => checkBudgets({ ...maxima, memoryMegabytes: 513 }, maxima), /memoryMegabytes 513 is above the maximum 512 of the authorization/);
});

test('the process table gives the run, its descendants and its process group, and nothing else', () => {
  const rows = parsePs('  10   1  10  1000\n  11  10  10  2000\n  12  11  12  3000\n  13   1  10   400\n  14   1  14  9999\nnot a row\n');
  assert.deepEqual(rows.map((row) => row.pid), [10, 11, 12, 13, 14]);
  assert.deepEqual([...members(rows, 10)].sort((a, b) => a - b), [10, 11, 12, 13], 'a descendant in another group and a group member of another parent count');
});

test('a slot is refused when the concurrency budget is used, and a slot of a process that ended is removed', (t) => {
  const slots = join(folder(t), 'slots');
  const release = claimSlot(slots, 'R-20261022T000000Z-00000001', 1);
  assert.throws(() => claimSlot(slots, 'R-20261022T000000Z-00000002', 1), /1 other run is active, and the concurrency budget allows 1/);
  const second = claimSlot(slots, 'R-20261022T000000Z-00000003', 2);
  second(); release();
  writeFileSync(join(slots, 'R-20261022T000000Z-00000009.json'), JSON.stringify({ pid: 2 ** 30, runId: 'R-20261022T000000Z-00000009' }), { mode: 0o600 });
  claimSlot(slots, 'R-20261022T000000Z-00000004', 1)();
  symlinkSync('/etc', join(slots, 'R-20261022T000000Z-00000005.json'));
  assert.throws(() => claimSlot(slots, 'R-20261022T000000Z-00000006', 1), /slot .* is not a private file/);
});

test('read exceptions cannot contain the home folder or a credential target', (t) => {
  const root = folder(t), home = join(root, 'home'), workspace = join(root, 'workspace'), prefix = join(root, 'node');
  mkdirSync(home); mkdirSync(workspace); mkdirSync(prefix);
  const policy = { workspace, nodePrefix: prefix, home, protectedFolders: [home] };
  assert.throws(() => buildPolicy({ ...policy, nodePrefix: home }), /holds .*home/);
  assert.throws(() => buildPolicy({ ...policy, links: [{ source: home, target: join(workspace, 'modules') }] }), /holds .*home/);
  mkdirSync(join(prefix, 'private-config'));
  symlinkSync(join(prefix, 'private-config'), join(home, '.config'));
  assert.throws(() => buildPolicy(policy), /holds .*private-config/);
});

test('Seatbelt closes other devices, file flags, access control lists and the system keychains', (t) => {
  const root = folder(t), policy = buildPolicy({ workspace: join(root, 'workspace'), nodePrefix: '/opt/node', home: join(root, 'home'), protectedFolders: [] });
  const profile = seatbeltProfile(policy).profile;
  assert.ok(profile.includes('(deny file-read* (subpath "/dev"))'));
  assert.ok(!profile.includes('(literal "/dev/console")'));
  assert.ok(profile.includes('(deny file-write-flags)'));
  assert.ok(profile.includes('(deny file-write-acl)'));
  assert.ok(defaultProtectedFolders({ platform: 'darwin', home: root, temporary: root, repository: root, store: root }).includes('/Library/Keychains'));
});
