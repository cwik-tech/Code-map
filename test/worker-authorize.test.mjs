// Authorizations of code-map run: the record, its checks with an injected clock, and a planted or damaged record in the store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAuthorization, commandProblem, loadAuthorization, newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';

const posix = { skip: process.platform === 'win32' && 'needs POSIX modes and symlinks' };
const budgets = { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 };
const command = ['node', '--test', '--test-reporter=junit'];
const created = new Date('2026-10-22T10:00:00.000Z'), day = 24 * 3600 * 1000;
const folders = (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'code-map-authorize-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { store: join(root, 'store'), repository: join(root, 'repo'), other: join(root, 'other') };
};

test('an authorization names the repository by a digest, the exact command words, the maximum budgets and the expiry', (t) => {
  const { store, repository } = folders(t), record = newAuthorization({ repository, command, budgets, expiresDays: 3, now: created });
  assert.match(record.id, /^AUTH-[0-9a-f]{16}$/);
  assert.deepEqual([record.command, record.budgets, record.createdAt, record.expiresAt], [command, budgets, created.toISOString(), new Date(created.getTime() + 3 * day).toISOString()]);
  assert.match(record.repository.digest, /^[0-9a-f]{64}$/);
  const path = saveAuthorization(store, record);
  assert.deepEqual(loadAuthorization(store, record.id), record);
  assert.ok(!readFileSync(path, 'utf8').includes(repository));
  assert.throws(() => newAuthorization({ repository, command, budgets, expiresDays: 91, now: created }), /--expires-days must be a whole number from 1 to 90/);
  assert.throws(() => newAuthorization({ repository, command, budgets: { ...budgets, concurrency: 65 }, expiresDays: 1, now: created }), /concurrency/);
});

test('a run is refused when the authorization expired, is for another repository, for other command words or for smaller budgets', (t) => {
  const { repository, other } = folders(t), record = newAuthorization({ repository, command, budgets, expiresDays: 1, now: created });
  const check = (fields) => checkAuthorization(record, { repository, command, budgets, now: new Date(created.getTime() + 1000), ...fields });
  assert.doesNotThrow(() => check({}));
  assert.throws(() => check({ now: new Date(created.getTime() + day) }), /expired at 2026-10-23T10:00:00\.000Z/);
  assert.throws(() => check({ now: new Date(created.getTime() - 3600 * 1000) }), /created after the current time/);
  assert.throws(() => check({ repository: other }), /is for another repository/);
  assert.throws(() => check({ command: [...command, '--test-only'] }), /is for other command words/);
  assert.throws(() => check({ command: ['node', '--test', '--test-reporter=junit '] }), /is for other command words/, 'a trailing space is another word');
  assert.throws(() => check({ budgets: { ...budgets, wallClockSeconds: 61 } }), /wallClockSeconds 61 is above the maximum 60 of the authorization/);
});

test('command words are checked at the boundary: a list of strings, no NUL, and a first word that is not an option', () => {
  assert.equal(commandProblem(command), null);
  for (const words of [[], 'node --test', ['-e', '0'], ['node', 'a\0b'], [''], ['node', 7], Array(257).fill('x')]) assert.ok(commandProblem(words), JSON.stringify(words).slice(0, 60));
});

test('a planted or damaged authorization in the store is refused: a symlink, another ID, bad fields or a file that others can change', posix, (t) => {
  const { store, repository } = folders(t), record = newAuthorization({ repository, command, budgets, expiresDays: 1, now: created });
  const path = saveAuthorization(store, record), text = readFileSync(path, 'utf8');
  const planted = (value) => { rmSync(path, { force: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); };
  assert.throws(() => loadAuthorization(store, 'AUTH-1'), /is not an authorization ID/);
  assert.throws(() => loadAuthorization(store, 'AUTH-ffffffffffffffff'), /is not in the store/);
  for (const value of ['{ no JSON', { ...record, id: 'AUTH-ffffffffffffffff' }, { ...record, command: ['-x'] }, { ...record, budgets: { ...budgets, extra: 1 } },
    { ...record, expiresAt: 'tomorrow' }, { ...record, extra: true }, { ...record, repository: { digest: 'x' } }]) {
    planted(value);
    assert.throws(() => loadAuthorization(store, record.id), /is unreadable/, JSON.stringify(value).slice(0, 80));
  }
  planted(text);
  chmodSync(path, 0o666);
  assert.throws(() => loadAuthorization(store, record.id), /other users can change it/);
  rmSync(path);
  symlinkSync(join(store, 'elsewhere.json'), path);
  writeFileSync(join(store, 'elsewhere.json'), text);
  assert.throws(() => loadAuthorization(store, record.id), /is unreadable/);
});
