// Fixtures for the tests of the rule set static-baseline-v0: a valid request, two analyses, a change, bound test reports and
// a context builder. Each test overrides only the fields that it is about. This file has no tests, and `npm test` does not run it.
import assert from 'node:assert/strict';
import { evaluateProfile, profile } from '../lib/profiles/static-baseline-v0.mjs';
import { rateCategory, readiness } from '../lib/ratings.mjs';
import { validateRequest } from '../lib/verify-request.mjs';

/** A valid request; each test overrides only the fields that it is about. */
export const request = (fields = {}) => {
  const result = validateRequest({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'main', head: 'worktree', intent: 'Change a.',
    acceptanceCriteria: [], allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } }, ...fields });
  assert.equal(result.ok, true);
  return result.request;
};
export const source = (path, fields = {}) => ({ path, imports: [], tests: { direct: [], transitive: [] }, exports: [], ...fields });
/** Two source files and one test file that reaches src/a.ts, with one declared rule and no finding. */
export const analysis = (fields = {}) => ({ files: [source('src/a.ts', { tests: { direct: ['test/a.test.ts'], transitive: [] } }), source('src/b.ts')],
  cycles: { all: [], value: [] }, rules: { declared: ['ui -> db'], invalid: [], violations: [] }, importNames: { missing: [], unchecked: {}, skipped: [] }, unsupportedFiles: {},
  tests: { cases: [{ path: 'test/a.test.ts', suite: 'a', name: 'works', status: 'active' }], testFiles: [{ path: 'test/a.test.ts', kind: 'tests' }], unreadable: [] }, ...fields });
export const finding = (ruleId, id, paths = ['src/a.ts']) => ({ id, ruleId, paths, location: { path: paths[0], line: 1 } });
export const run = { command: ['npx', 'vitest', 'run'], tools: [{ name: 'vitest', version: '2.1.0' }], environment: { policy: 'local', node: '20', platform: 'darwin' } };
export const report = (cases, fields = {}) => ({ artifact: 'reports/head.xml', kind: 'junit', digest: 'd'.repeat(64), filtered: false, exitStatus: 0, cases, run, ...fields });
export const testCase = (status = 'passed', name = 'works', file = 'test/a.test.ts') => ({ file, suite: 'a', name, status });
/** One compiler diagnostic and one bound compiler report (kind tsc). The exit status is 2 when the report has an error, as tsc gives. */
export const diagnostic = (file, code = 2322, fields = {}) => ({ file, line: 1, column: 1, category: 'error', code, message: `Error TS${code} in ${file}.`, ...fields });
export const compilerReport = (diagnostics = [], fields = {}) => {
  const errors = diagnostics.filter((item) => item.category === 'error').length;
  return { artifact: 'reports/tsc.txt', kind: 'tsc', digest: 'e'.repeat(64), attestation: 'self-attested', filtered: false, exitStatus: errors ? 2 : 0, errors, outside: 0, diagnostics,
    run: { ...run, command: ['npx', 'tsc', '--noEmit', '--pretty', 'false'], tools: [{ name: 'typescript', version: '6.0.3' }] }, ...fields };
};
export const modified = (...paths) => ({ files: paths.map((path) => ({ path, status: 'M', from: null })), paths: [...paths].sort(), complete: true });
/** A clean, comparable change of src/a.ts in a project without TypeScript. `head` and `base` merge into the default sides. */
const context = ({ head = {}, base = {}, ...fields } = {}) => ({ request: request(), comparable: true, comparisonReasons: [],
  head: { analysisId: 'head-1', sha: 'b'.repeat(40), analysis: analysis(), findings: [], ...head },
  base: { analysisId: 'base-1', sha: 'a'.repeat(40), analysis: analysis(), findings: [], ...base },
  labels: {}, change: modified('src/a.ts'), importOrigins: new Map(), weakening: { removed: [], weakened: [] },
  settingsFiles: ['.code-map.json', 'docs/code-map/test-labels.json'], typescript: false, reports: { head: [], base: [], ineligible: [] }, compiler: { head: [], base: [] }, coverage: null, ...fields });
/** Evaluates a context and gives each obligation by ID, each category rating and the readiness state. */
export const evaluate = (fields) => {
  const output = evaluateProfile(context(fields)), byId = Object.fromEntries(output.obligations.map((item) => [item.id, item]));
  const ratings = Object.fromEntries(Object.entries(output.categories).map(([name, input]) => [name, rateCategory(input)]));
  return { ...output, byId, ratings, value: (name) => ratings[name].value, ready: readiness(output.obligations, ratings, { requiredCategories: profile.requiredCategories }) };
};
export const passing = { reports: { head: [report([testCase()])], base: [], ineligible: [] } };
