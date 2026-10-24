// Unit tests of the triage file (C41): validation, the states, expiry with an injected date, unused entries and renames.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTriage, entryErrors, readTriage, triageFile, validateTriage, writeTriage } from '../lib/triage.mjs';

const today = '2026-10-22';
const fp = (digit) => String(digit).repeat(16);
const entry = (fields = {}) => ({ fingerprint: fp(1), ruleId: 'EXPORT-UNREFERENCED', state: 'dismissed', reason: 'A plugin loads it by name.', owner: 'tomasz', date: '2026-10-01', ...fields });
const file = (...entries) => ({ triageVersion: 1, entries });
const finding = (digit, ruleId = 'EXPORT-UNREFERENCED') => ({ id: `${ruleId}-${fp(digit).slice(0, 10)}`, ruleId, fingerprint: fp(digit) });
/** The error messages of a file, as "path: message" lines. */
const errors = (value) => { const checked = validateTriage(value, today); assert.equal(checked.ok, false); return checked.errors.map((error) => `${error.path}: ${error.message}`); };

test('a file with each state is valid, and a suppression can last exactly 365 days', () => {
  const value = file(entry(), entry({ fingerprint: fp(2), state: 'confirmed' }), entry({ fingerprint: fp(3), state: 'suppressed', date: '2026-01-01', expires: '2027-01-01' }));
  const checked = validateTriage(value, today);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.triage.entries, value.entries);
  assert.deepEqual(entryErrors(entry({ state: 'suppressed', date: '2024-02-29', expires: '2025-02-28' }), today), [], 'a leap day counts as a day');
});

test('validation names each problem with its path: unknown fields, a missing reason, an expiry past the limit and a duplicate fingerprint', () => {
  const lines = errors({ triageVersion: 2, entries: [
    entry({ color: 'red' }),
    entry({ fingerprint: fp(2), reason: '   ' }),
    entry({ fingerprint: fp(3), state: 'suppressed', date: '2026-01-01', expires: '2027-01-02' }),
    entry({ fingerprint: fp(1), state: 'confirmed' }),
  ], extra: true });
  for (const pattern of [/^extra: is not a known field/, /^triageVersion: must be 1/, /^entries\[0\]\.color: is not a known field\. The fields are fingerprint, ruleId, state, reason, owner, date, expires/,
    /^entries\[1\]\.reason: is necessary/, /^entries\[2\]\.expires: must be at most 365 days after the date 2026-01-01/, /^entries\[3\]\.fingerprint: repeats the fingerprint of entries\[0\]/]) {
    assert.ok(lines.some((line) => pattern.test(line)), `${pattern} in ${lines.join(' | ')}`);
  }
  assert.equal(lines.length, 6);
});

test('validation refuses a bad state, rule, fingerprint, owner or date, and an expiry that does not fit the state', () => {
  const cases = [
    [{ state: 'ignored' }, /^state: must be confirmed, dismissed or suppressed/],
    [{ ruleId: 'NO-SUCH-RULE' }, /^ruleId: must be a rule ID of Code-map: ARCH-RULE, /],
    [{ fingerprint: 'ABC' }, /^fingerprint: must be the 16 hexadecimal characters/],
    [{ owner: 'two\nlines' }, /^owner: is necessary: a name of 1 to 100 characters on one line/],
    [{ owner: undefined }, /^owner: is necessary/],
    [{ date: '2026-02-30' }, /^date: must be a calendar date in the form YYYY-MM-DD/],
    [{ date: '2026-10-24' }, /^date: is after the current date 2026-10-22/],
    [{ state: 'suppressed' }, /^expires: is necessary for the state suppressed/],
    [{ state: 'suppressed', expires: '2026-09-30' }, /^expires: must not be before the date 2026-10-01/],
    [{ expires: '2026-12-01' }, /^expires: applies only to the state suppressed/],
    [{ reason: 'x'.repeat(1001) }, /^reason: is necessary: a text of 1 to 1000 characters/],
  ];
  for (const [fields, pattern] of cases) {
    const messages = entryErrors(entry(fields), today).map(([field, message]) => `${field}: ${message}`);
    assert.equal(messages.length, 1, `${JSON.stringify(fields)}: ${messages.join(' | ')}`);
    assert.match(messages[0], pattern);
  }
  assert.deepEqual(entryErrors(entry({ date: '2026-10-23' }), today), [], 'one day after the current date is allowed for time zones');
  assert.match(errors([]).join(' '), /must be an object with triageVersion and entries/);
  assert.match(errors({ triageVersion: 1, entries: {} }).join(' '), /^entries: must be a list/);
  assert.throws(() => validateTriage(file(), '22.10.2026'), /current date/);
});

test('each state applies with the injected date: a dismissal and an active suppression hide a finding, a confirmation and an expired suppression do not', () => {
  const triage = { entries: [entry(), entry({ fingerprint: fp(2), state: 'confirmed' }), entry({ fingerprint: fp(3), state: 'suppressed', expires: '2026-10-22' }),
    entry({ fingerprint: fp(4), state: 'suppressed', expires: '2026-10-21' }), entry({ fingerprint: fp(5) }), entry({ fingerprint: fp(6), ruleId: 'ARCH-RULE' })] };
  const findings = [1, 2, 3, 4, 6].map((digit) => finding(digit));
  const applied = applyTriage(triage, findings, today);
  const view = (digit) => { const note = applied.notes.get(finding(digit).id); return note && [note.entry.state, note.hidden, note.expired, note.matchedBy]; };
  assert.deepEqual([1, 2, 3, 4, 6].map(view), [['dismissed', true, false, 'fingerprint'], ['confirmed', false, false, 'fingerprint'], ['suppressed', true, false, 'fingerprint'],
    ['suppressed', false, true, 'fingerprint'], undefined]);
  assert.deepEqual(applied.expired, [{ fingerprint: fp(4), ruleId: 'EXPORT-UNREFERENCED', owner: 'tomasz', expires: '2026-10-21', finding: finding(4).id }]);
  assert.deepEqual(applied.unused.map((item) => [item.fingerprint, item.cause]), [[fp(5), 'no-finding'], [fp(6), 'rule-differs']]);
  // The next day, the suppression that ended on 2026-10-22 has expired too.
  assert.equal(applyTriage(triage, findings, '2026-10-23').notes.get(finding(3).id).hidden, false);
});

test('in a comparison, an entry of a base finding applies to the head finding that matches it after a rename', () => {
  const base = finding(7), head = finding(8);
  const comparison = { base: { findings: [base] }, result: { statuses: { [head.id]: { baseline: 'EXISTING', matchedBy: 'rename', base: base.id } } } };
  const triage = { entries: [entry({ fingerprint: fp(7) })] };
  const note = applyTriage(triage, [head], today, comparison).notes.get(head.id);
  assert.deepEqual([note.entry.fingerprint, note.matchedBy, note.hidden], [fp(7), 'rename', true]);
  assert.deepEqual(applyTriage(triage, [head], today).unused.map((item) => item.fingerprint), [fp(7)], 'without the comparison the entry is unused');
});

test('the file is read with its digest, refused when it is not a regular file, and written through a rename that checks for a concurrent change', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-triage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(readTriage(root, today), null, 'no file, no triage');
  const digest = writeTriage(root, [entry()], null);
  const text = readFileSync(join(root, triageFile), 'utf8');
  assert.deepEqual(JSON.parse(text), file(entry()));
  assert.match(text, /^\{\n {2}"triageVersion": 1,/);
  const read = readTriage(root, today);
  assert.deepEqual([read.digest, read.entries], [digest, [entry()]]);
  assert.throws(() => writeTriage(root, [entry({ state: 'confirmed' })], 'f'.repeat(64)), /changed while Code-map wrote it/);
  assert.deepEqual(readdirSync(root), [triageFile], 'a refused write leaves no temporary file');
  writeFileSync(join(root, triageFile), '{"triageVersion": 1, "entries": [');
  assert.throws(() => readTriage(root, today), /The triage file .* is not valid JSON/);
  writeFileSync(join(root, triageFile), JSON.stringify(file(entry({ reason: '' }))));
  assert.throws(() => readTriage(root, today), /is not valid:\n {2}entries\[0\]\.reason: is necessary/);
  rmSync(join(root, triageFile));
  writeFileSync(join(root, 'elsewhere.json'), JSON.stringify(file()));
  if (process.platform !== 'win32') {
    symlinkSync(join(root, 'elsewhere.json'), join(root, triageFile));
    assert.throws(() => readTriage(root, today), /is not a regular file/);
  }
});
