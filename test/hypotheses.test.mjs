// Hypotheses of a language model (C44): the strict schema of the file, the evidence check (grounded or ungrounded), the
// Markdown section as model output, and proof that a hypothesis changes no check, rating, readiness or exit code.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groundHypotheses, hypothesisLimits, readHypotheses, validateHypotheses } from '../lib/hypotheses.mjs';
import { renderReport } from '../lib/verify-report.mjs';
import { validateRequest } from '../lib/verify-request.mjs';
import { findingRules } from '../lib/verify-words.mjs';
import { caseText, header, junit, outcome, project, valid } from './oracle-fixtures.mjs';

const item = (fields = {}) => ({ id: 'H-1', kind: 'risk', claim: 'The login keeps an old session.', evidenceIds: ['path:src/login.ts'], ...fields });
const file = (items = [item()], fields = {}) => ({ hypothesesVersion: 1, model: 'example-model-1', items, ...fields });
const paths = (value) => { const checked = validateHypotheses(value); assert.equal(checked.ok, false); return checked.errors.map((error) => error.path); };

test('a valid hypotheses file is accepted, and each field is checked strictly', () => {
  const proposed = { file: 'test/login.test.ts', name: 'drops the old session', text: "test('drops the old session', () => {});" };
  const checked = validateHypotheses(file([item(), item({ id: 'H-2', kind: 'missing-test', proposedTest: proposed })]));
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.hypotheses.items[1].proposedTest, proposed);
  assert.deepEqual(paths(file([item()], { extra: 1 })), ['extra'], 'an unknown field is an error');
  assert.deepEqual(paths(file([item({ note: 'x' })])), ['items[0].note']);
  assert.deepEqual(paths(file([item({ proposedTest: { ...proposed, run: true } })])), ['items[0].proposedTest.run']);
  assert.deepEqual(paths(file([item({ kind: 'bug' }), item({ id: 'H-1', claim: ' ' })])), ['items[0].kind', 'items[1].id', 'items[1].claim']);
  assert.deepEqual(paths(file([item({ evidenceIds: [] }), item({ id: 'H-2', evidenceIds: ['a\u001bb', 'x', 'x'] })])), ['items[0].evidenceIds', 'items[1].evidenceIds[0]', 'items[1].evidenceIds[2]']);
  assert.deepEqual(paths(file([item({ proposedTest: { ...proposed, file: '../outside.ts' } }), item({ id: 'H-2', proposedTest: { ...proposed, file: 'test/a\u0007.ts' } })])),
    ['items[0].proposedTest.file', 'items[1].proposedTest.file'], 'a path with a control character is an error');
  assert.deepEqual(paths({ ...file(), hypothesesVersion: 2, model: '' }), ['hypothesesVersion', 'model']);
  assert.deepEqual(paths([]), ['']);
  assert.deepEqual(paths(file(Array.from({ length: hypothesisLimits.items + 1 }, (_, index) => item({ id: `H-${index}` })))), ['items']);
});

test('the request can name a hypotheses file with a repository-relative path', () => {
  const check = (hypotheses) => validateRequest({ ...valid, hypotheses });
  assert.equal(check('reports/hypotheses.json').ok, true);
  assert.equal(validateRequest(valid).ok, true, 'the field is optional');
  for (const value of ['/tmp/h.json', '../h.json', '', 7, null]) assert.deepEqual(check(value).errors.map((error) => error.path), ['hypotheses'], String(value));
});

test('a hypothesis is grounded only when each evidence ID is in the results, and an ungrounded one names the missing IDs', () => {
  const loaded = { path: 'reports/h.json', state: 'VALID', model: 'm', errors: [], items: [item(), item({ id: 'H-2', evidenceIds: ['path:src/login.ts', 'case:r.xml:x', 'F-1'] })] };
  const grounded = groundHypotheses(loaded, new Set(['path:src/login.ts', 'F-1']));
  assert.deepEqual(grounded.items.map((entry) => [entry.id, entry.grounded, entry.missingEvidenceIds]), [['H-1', true, []], ['H-2', false, ['case:r.xml:x']]]);
  assert.deepEqual([grounded.file.total, grounded.file.grounded, grounded.file.ungrounded], [2, 1, 1]);
  assert.match(grounded.file.label, /model output, not evidence/);
});

test('a hypotheses file that is too large, not JSON, missing or outside the repository gives no hypothesis and a reason', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const { root, work, put } = project(t);
  put('reports/large.json', JSON.stringify(file([item({ claim: 'x'.repeat(hypothesisLimits.bytes) })])));
  put('reports/broken.json', '{ "hypothesesVersion": ');
  writeFileSync(join(work, 'outside.json'), JSON.stringify(file()));
  symlinkSync(join(work, 'outside.json'), join(root, 'reports', 'outside.json'));
  for (const [path, pattern] of [['reports/large.json', /larger than 262144 bytes/], ['reports/broken.json', /not valid JSON/], ['reports/missing.json', /Cannot read/],
    ['reports/outside.json', /outside the repository/]]) {
    const loaded = readHypotheses(root, path);
    assert.deepEqual([loaded.state, loaded.items], ['INVALID', []], path);
    assert.match(loaded.errors[0].message, pattern);
  }
});

test('the report shows the hypotheses in their own section as model output, with control characters and Markdown escaped', () => {
  const hypothesis = { ...item({ claim: 'Risk \u001b[31m | <b>bold</b>\nsecond line ‮', proposedTest: { file: 'test/\u202ex.ts', name: 'n', text: 't' } }), grounded: false, missingEvidenceIds: ['path:x|y'] };
  const results = { obligations: [], readiness: { state: 'INSUFFICIENT_EVIDENCE', exitCode: 3 }, base: { ref: 'main', sha: 'a', analysisId: 'A' }, head: { ref: 'HEAD', sha: 'b', analysisId: 'B' },
    change: { total: 0, paths: [] }, comparison: { state: 'COMPARABLE', reasons: [] }, intent: 'x', llmHypotheses: [hypothesis],
    llmHypothesesFile: { path: 'reports/h.json', state: 'VALID', model: 'model\u0007', errors: [], total: 1, grounded: 0, ungrounded: 1, label: 'model output, not evidence' } };
  const markdown = renderReport(results), lines = markdown.split('\n'), start = lines.indexOf('## Model hypotheses (model output, not evidence)');
  assert.notEqual(start, -1);
  const section = lines.slice(start, lines.indexOf('## Terms in this report')).join('\n');
  assert.match(section, /not evidence/); assert.match(section, /change no check, rating or readiness/);
  assert.match(section, /Risk \\\\u001b\\\[31m \\\| \\<b\\>bold\\<\/b\\> second line \\\\u202e/);
  assert.match(section, /Ungrounded: `path:x\\\|y` is not in the results/);
  assert.match(section, /n in `test\/\\u202ex\.ts`/, 'a bidirectional control in the path of a proposed test is a visible escape');
  assert.doesNotMatch(markdown, /[\u0000-\u0009\u000b-\u001f\u007f‮]/);
  const invalid = renderReport({ ...results, llmHypotheses: [], llmHypothesesFile: { path: 'reports/h.json', state: 'INVALID',
    errors: [{ path: 'items[0].kind', message: 'Must be one of: risk.' }, { path: 'items[0].\u202ekey\u001b', message: 'Unknown field.' }] } });
  assert.match(invalid, /Code-map did not use it: the field `items\[0\]\.kind`: Must be one of: risk\./);
  assert.match(invalid, /the field `items\[0\]\.\\u202ekey\\u001b`: Unknown field\./, 'an unknown key of the file is shown with visible escapes');
  assert.doesNotMatch(invalid, /[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/);
});

test('with many hypotheses and long lists, the report stays within 200 lines and names the count of the others', () => {
  const many = Array.from({ length: 100 }, (_, index) => ({ ...item({ id: `H-${index}` }), grounded: true, missingEvidenceIds: [] }));
  const check = (index, fields) => ({ id: `c.${index}`, category: 'structuralIntegrity', required: true, blocking: false, applicability: 'APPLICABLE', result: 'UNKNOWN', eligible: false,
    evidenceIds: Array.from({ length: 30 }, (_, number) => `E-${number}`), rationale: 'Open.', ...fields });
  const results = { obligations: [...Array.from({ length: 45 }, (_, index) => check(index, { result: 'FAIL', eligible: true })), ...Array.from({ length: 45 }, (_, index) => check(index + 45))],
    readiness: { state: 'BLOCKED', blocking: [], exitCode: 2 }, base: { ref: 'main', sha: 'a', analysisId: 'A' }, head: { ref: 'HEAD', sha: 'b', analysisId: 'B' }, intent: 'x',
    change: { total: 0, paths: [] }, comparison: { state: 'COMPARABLE', reasons: [] }, limits: Array.from({ length: 30 }, (_, index) => `Limit ${index}.`),
    gaps: Array.from({ length: 30 }, (_, index) => ({ key: `g${index}`, text: `Gap ${index}.` })), provenance: { total: 3, counts: { 'spec-linked': 1, 'pre-existing': 1, 'changed-with-change': 1, unknown: 0 }, criteria: [] },
    executions: Array.from({ length: 30 }, (_, index) => ({ artifact: `r${index}.xml`, kind: 'junit', side: 'head', binding: 'BOUND', eligible: true, reasons: [], cases: 3, failed: 0 })),
    llmHypotheses: many, llmHypothesesFile: { path: 'reports/h.json', state: 'VALID', model: 'm', errors: [], total: 100, grounded: 100, ungrounded: 0 } };
  const markdown = renderReport(results), lines = markdown.split('\n');
  assert.ok(lines.length <= 200, `${lines.length} lines`);
  assert.match(markdown, /## Model hypotheses \(model output, not evidence\)/);
  assert.match(markdown, /100 hypotheses/);
  const few = renderReport({ ...results, obligations: [], limits: [], gaps: [], executions: [] });
  assert.match(few, /The table lists 5 of 100 hypotheses\. The other 95 are in verification-results\.json\./);
  // A coverage section and a Terms row for each finding rule make the full report longer than 200 lines. The check tables then list fewer checks.
  const coverage = { reports: ['reports/lcov.info'], changedLines: { covered: 1, total: 2, share: 50, threshold: 70 }, changedBranches: { covered: 1, total: 2, share: 50, threshold: 50 },
    files: { total: 5, measured: 2, unmeasured: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }, outsideRepository: 2 };
  const longest = renderReport({ ...results, coverage, obligations: results.obligations.map((entry) => ({ ...entry, rationale: `Open: ${Object.keys(findingRules).join(' ')}.` })) });
  assert.ok(longest.split('\n').length <= 200, `${longest.split('\n').length} lines`);
  assert.match(longest, /The table lists 1\d of 45 failed checks\./);
  for (const rule of Object.keys(findingRules)) assert.match(longest, new RegExp(`\\| ${rule} \\| A finding rule`), rule);
});

test('a hypothesis changes no check, rating, readiness or exit code, and the results keep it apart from the evidence', (t) => {
  const fixture = project(t, { 'test/login.test.ts': header + caseText('keeps the user') }), { put, commit, request, verify } = fixture;
  put('src/login.ts', 'export function login(name: string) { return name.trim(); }\n');
  const sha = commit('head'), reportInputs = [junit(fixture, 'head', { sha, cases: [{ file: 'test/login.test.ts', name: 'keeps the user', status: 'passed' }] })];
  put('reports/hypotheses.json', JSON.stringify(file([item({ evidenceIds: ['path:src/login.ts', 'report:reports/head.xml', 'request:intent'] }),
    item({ id: 'H-2', kind: 'intent-mismatch', claim: 'The change also needs a logout.', evidenceIds: ['path:src/logout.ts'] }),
    item({ id: 'H-3', kind: 'missing-test', claim: 'No test checks a name with spaces.', evidenceIds: ['case:reports/head.xml:test/login.test.ts > keeps the user'],
      proposedTest: { file: 'test/login.test.ts', name: 'trims the name', text: "test('trims the name', () => { expect(login(' a ')).toBe('a'); });" } })])));
  put('reports/invalid.json', JSON.stringify(file([item({ verdict: 'PASS' })])));
  const runs = [undefined, 'reports/hypotheses.json', 'reports/invalid.json'].map((hypotheses) => outcome(verify(request({ reportInputs, ...(hypotheses ? { hypotheses } : {}) })), 3));
  const decided = ({ summary, results }) => ({ obligations: results.obligations, ratings: results.ratings, readiness: results.readiness, failed: summary.failed, blocking: summary.blocking });
  for (const other of runs.slice(1)) assert.deepEqual(decided(other), decided(runs[0]));
  const [none, used, refused] = runs.map(({ results }) => results);
  assert.deepEqual([none.llmHypotheses, none.llmHypothesesFile], [[], null]);
  assert.deepEqual(used.llmHypotheses.map((entry) => [entry.id, entry.grounded, entry.missingEvidenceIds]), [['H-1', true, []], ['H-2', false, ['path:src/logout.ts']], ['H-3', true, []]]);
  assert.deepEqual([used.llmHypothesesFile.state, used.llmHypothesesFile.model, used.llmHypothesesFile.grounded, used.llmHypothesesFile.ungrounded], ['VALID', 'example-model-1', 2, 1]);
  assert.match(used.llmHypothesesFile.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!used.obligations.some((entry) => JSON.stringify(entry).includes('H-1')), 'no check names a hypothesis');
  assert.deepEqual([refused.llmHypothesesFile.state, refused.llmHypotheses], ['INVALID', []]);
  assert.deepEqual(refused.llmHypothesesFile.errors.map((error) => error.path), ['items[0].verdict']);
  assert.deepEqual(runs.map(({ summary }) => summary.hypotheses), [null, { state: 'VALID', total: 3, grounded: 2, ungrounded: 1 }, { state: 'INVALID', total: 0, grounded: 0, ungrounded: 0 }]);
  assert.match(runs[1].markdown, /## Model hypotheses \(model output, not evidence\)/);
});
