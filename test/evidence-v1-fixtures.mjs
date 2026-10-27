// Plain evidence fixtures for the evidence-v1 rule set.
import { analysis, request, modified, report, testCase, compilerReport } from './profile-fixtures.mjs';
export const isolated = (cases = [testCase()], fields = {}) => report(cases, { attestation: 'isolated', ...fields });
export const oracle = (fields = {}) => ({ file: 'test/a.test.ts', suite: 'a', name: 'works', criterion: 'AC1', stale: false, ...fields });
export const context = (fields = {}) => ({ request: request({ profileId: 'evidence-v1', ratingRulesVersion: 'ratings-v1' }), comparable: true,
  head: { analysisId: 'head', sha: 'b'.repeat(40), analysis: analysis(), findings: [] },
  base: { analysisId: 'base', sha: 'a'.repeat(40), analysis: analysis(), findings: [] }, labels: {}, change: modified('src/a.ts'), importOrigins: new Map(),
  weakening: { removed: [], weakened: [] }, settingsFiles: ['.code-map.json'], typescript: false,
  reports: { head: [isolated()], base: [isolated([testCase()], { artifact: 'base.xml' })] }, compiler: { head: [compilerReport()], base: [] },
  coverage: { reports: ['lcov'], lineReports: ['lcov'], total: 1, changedLines: { covered: 9, total: 10 }, changedBranches: { covered: 7, total: 10 },
    changedStatements: { covered: 9, total: 10 }, changedFunctions: { covered: 1, total: 1 }, joins: { exact: 1, ambiguous: 0, missing: 0 }, unmeasured: [],
    unmeasuredBy: { statements: [], branches: [], functions: [] } },
  evidence: { api: { state: 'COMPARABLE', complete: true, items: [] }, schemas: { migrations: [] }, schemaUnread: false,
    supply: { state: 'compared', changes: [] }, policy: null, supplyFindings: [], calls: { sites: [], unread: [] }, references: { hits: [] },
    oracles: [], cases: [], isolatedCoverage: null, mutation: [], harness: [] }, ...fields });
