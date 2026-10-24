// Oracle provenance (C37) through `code-map verify`: each test case that a bound head report ran gets one label, the
// acceptance criteria list their linked cases, and the acceptance checks stay UNKNOWN. Git fixtures in temporary folders.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { caseText, header, junit, outcome, project } from './oracle-fixtures.mjs';

const moved = (edited) => `${header}// The moved file keeps these lines, so that Git finds the rename.\n// One.\n// Two.\n// Three.\n// Four.\n// Five.\n\n`
  + caseText('moves along', 'm') + '\n' + caseText('moves and changes', edited ? 'mm' : 'm');
const base = { 'test/keep.test.ts': header + caseText('stays the same'), 'test/old.test.ts': moved(false),
  'test/login.test.ts': `${header}${caseText('keeps the user')}\n${caseText('edits the name', 'b')}\ndescribe('outer', () => {\n  ${caseText('inner', 'i')}});\n` };
const head = `${header}${caseText('keeps the user')}\n${caseText('edits the name', 'bb')}\ndescribe('outer', () => {\n  ${caseText('inner', 'i')}});\n\n${caseText('adds a case', 'n')}\n`
  + `${caseText('signs in [AC:login]', 's')}\n// Checks the session. @ac login\n${caseText('keeps the session', 'k')}\n// [AC:login]\n\n${caseText('far from the tag', 'f')}\n`
  + `${caseText('names [AC:nope]', 'x')}\n// @ac login.\n${caseText('ends with a dot', 'd')}`;
const cases = [['test/keep.test.ts', 'stays the same'], ['test/login.test.ts', 'keeps the user'], ['test/login.test.ts', 'edits the name'], ['test/login.test.ts', 'outer > inner'],
  ['test/login.test.ts', 'adds a case'], ['test/login.test.ts', 'signs in [AC:login]'], ['test/login.test.ts', 'keeps the session', 'failed'], ['test/login.test.ts', 'far from the tag'],
  ['test/login.test.ts', 'names [AC:nope]'], ['test/login.test.ts', 'ends with a dot'], ['test/moved.test.ts', 'moves along'], ['test/moved.test.ts', 'moves and changes'],
  [null, 'lost case'], ['test/login.test.ts', 'ghost'], ['test/login.test.ts', 'skipped one', 'skipped']].map(([file, name, status = 'passed']) => ({ file, name, status }));
const criteria = [{ id: 'login', text: 'A user can sign in.' }, { id: 'logout', text: 'A user can sign out.' }];
/** The evidence ID of a case: the suite of a file is its path, so it is left out of the name, and a case without a file is in the suite "unnamed". */
const id = (file, name) => `case:reports/head.xml:${file ?? 'unnamed'} > ${name}`;

/** The base commit, then a head commit that edits the login tests and renames test/old.test.ts. Returns the results of one run. */
function verified(t) {
  const fixture = project(t, base), { put, git, commit, request, verify } = fixture;
  put('test/login.test.ts', head);
  git('mv', 'test/old.test.ts', 'test/moved.test.ts'); put('test/moved.test.ts', moved(true));
  const sha = commit('head'), inputs = [junit(fixture, 'head', { sha, cases })];
  return outcome(verify(request({ acceptanceCriteria: criteria, reportInputs: inputs })), 2);
}

test('each case that a bound head report ran has one provenance label, and the results count and list them', (t) => {
  const { results } = verified(t), provenance = results.provenance;
  assert.equal(provenance.total, 14, 'the skipped case did not run');
  assert.deepEqual(provenance.counts, { 'spec-linked': 2, 'pre-existing': 4, 'changed-with-change': 6, unknown: 2 });
  const labelOf = Object.fromEntries(Object.entries(provenance.cases).flatMap(([label, list]) => list.map((entry) => [entry.evidenceId, label])));
  const expected = { 'pre-existing': [['test/keep.test.ts', 'stays the same'], ['test/login.test.ts', 'keeps the user'], ['test/login.test.ts', 'outer > inner'], ['test/moved.test.ts', 'moves along']],
    'changed-with-change': [['test/login.test.ts', 'edits the name'], ['test/login.test.ts', 'adds a case'], ['test/login.test.ts', 'far from the tag'], ['test/login.test.ts', 'names [AC:nope]'],
      ['test/login.test.ts', 'ends with a dot'], ['test/moved.test.ts', 'moves and changes']],
    'spec-linked': [['test/login.test.ts', 'signs in [AC:login]'], ['test/login.test.ts', 'keeps the session']], unknown: [[null, 'lost case'], ['test/login.test.ts', 'ghost']] };
  for (const [label, list] of Object.entries(expected)) for (const [file, name] of list) assert.equal(labelOf[id(file, name)], label, `${name} is ${label}`);
  assert.equal(labelOf[id('test/login.test.ts', 'skipped one')], undefined);
  const lost = provenance.cases.unknown.find((entry) => entry.name === 'lost case'), ghost = provenance.cases.unknown.find((entry) => entry.name === 'ghost');
  assert.match(lost.reason, /no file/); assert.match(ghost.reason, /head analysis has no test case/);
  const linked = provenance.cases['spec-linked'];
  assert.deepEqual(linked.map((entry) => [entry.criteria, entry.origin, entry.status]), [[['login'], 'changed-with-change', 'passed'], [['login'], 'changed-with-change', 'failed']]);
  assert.deepEqual(provenance.unknownCriteria, [{ id: 'nope', cases: 1 }, { id: 'login.', cases: 1 }], 'a tag with an unknown criterion ID links nothing');
  assert.match(provenance.policy, /does not change a check, a rating or the readiness/);
});

test('each acceptance criterion lists its linked cases and whether they passed, and its check stays UNKNOWN with the passing cases in its rationale', (t) => {
  const { results, markdown } = verified(t), [login, logout] = results.provenance.criteria;
  assert.deepEqual([login.id, login.linked, login.passed, login.failed], ['login', 2, 1, 1]);
  assert.deepEqual(login.cases.map((entry) => [entry.evidenceId, entry.status]), [[id('test/login.test.ts', 'signs in [AC:login]'), 'passed'], [id('test/login.test.ts', 'keeps the session'), 'failed']]);
  assert.deepEqual([logout.id, logout.linked, logout.cases], ['logout', 0, []]);
  const byId = Object.fromEntries(results.obligations.map((item) => [item.id, item])), check = byId['acceptance.login'], open = byId['acceptance.logout'];
  assert.deepEqual([check.result, check.eligible, open.result], ['UNKNOWN', false, 'UNKNOWN']);
  assert.match(check.rationale, /1 linked test case passed in the bound head reports: test\/login\.test\.ts > signs in \[AC:login\]\./);
  assert.match(check.rationale, /1 linked test case failed: test\/login\.test\.ts > keeps the session\./);
  assert.match(check.rationale, /does not confirm its expected result, so the check stays UNKNOWN/);
  assert.deepEqual(check.evidenceIds, ['request:acceptanceCriteria.login', id('test/login.test.ts', 'signs in [AC:login]'), id('test/login.test.ts', 'keeps the session')]);
  assert.match(open.rationale, /No test case of the bound head reports names this criterion/);
  assert.match(open.nextAction, /\[AC:logout\]/);
  assert.equal(results.ratings.behavioralConfidence.state, 'UNASSESSED', 'no rating changes because of a label');
  const row = markdown.split('\n').find((line) => line.startsWith('| Test oracles |'));
  assert.match(row, /The bound head reports ran 14 test cases\. Oracle provenance: 2 spec-linked, 4 pre-existing, 6 changed with the change and 2 unknown\./);
  assert.match(row, /`login` \(1 of 2 passed\)/);
  assert.match(markdown, /\| Oracle provenance \| Where the expected result of a test case comes from/);
});

test('without a bound head test report, the provenance is empty and each acceptance check says that no case names it', (t) => {
  const { request, verify } = project(t, { 'test/keep.test.ts': header + caseText('stays the same') });
  const { results, markdown } = outcome(verify(request({ head: 'worktree', acceptanceCriteria: criteria })), 3);
  assert.deepEqual([results.provenance.total, results.provenance.counts], [0, { 'spec-linked': 0, 'pre-existing': 0, 'changed-with-change': 0, unknown: 0 }]);
  assert.deepEqual(results.provenance.criteria.map((entry) => [entry.id, entry.linked]), [['login', 0], ['logout', 0]]);
  assert.match(results.obligations.find((item) => item.id === 'acceptance.login').rationale, /No test case of the bound head reports names this criterion/);
  assert.match(markdown, /\| Test oracles \| No bound head report ran a test case/);
  assert.deepEqual(results.request.acceptanceCriteria, criteria);
});

test('for a working-tree head, Code-map reads the case texts from the files, and an edited, a new and an unchanged case get their labels', (t) => {
  const fixture = project(t, { 'test/login.test.ts': header + caseText('keeps the user') + '\n' + caseText('edits the name', 'b') }), { root, put, git, request, verify } = fixture;
  put('test/login.test.ts', header + caseText('keeps the user') + '\n' + caseText('edits the name', 'bb'));
  put('test/new.test.ts', `${header}// @ac login\n${caseText('signs in')}`);
  const worktreeDigest = analysisInputs(root, loadConfig(root), { worktree: true }, null).worktree.contentDigest;
  const ran = [['test/login.test.ts', 'keeps the user'], ['test/login.test.ts', 'edits the name'], ['test/new.test.ts', 'signs in']].map(([file, name]) => ({ file, name, status: 'passed' }));
  const inputs = [junit(fixture, 'head', { sha: git('rev-parse', 'HEAD'), worktreeDigest, cases: ran })];
  const { results } = outcome(verify(request({ head: 'worktree', acceptanceCriteria: criteria, reportInputs: inputs })), 3);
  assert.deepEqual(results.executions.map((item) => [item.binding, item.eligible]), [['BOUND', true]]);
  const labels = Object.values(results.provenance.cases).flat().map((entry) => [entry.name, entry.label, entry.origin, entry.criteria ?? null]);
  assert.deepEqual(labels.sort(), [['edits the name', 'changed-with-change', 'changed-with-change', null], ['keeps the user', 'pre-existing', 'pre-existing', null],
    ['signs in', 'spec-linked', 'changed-with-change', ['login']]]);
});
