// The merged report keeps every stream within its existing Markdown line budget.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport, maxReportLines } from '../lib/verify-report.mjs';

function combinedResults() {
  const part = { covered: 1, total: 2, share: 50, threshold: 80, files: { measured: 1, unmeasured: ['a.mjs'] } };
  const amount = { base: { bytes: 1, gzipBytes: 1 }, head: { bytes: 2, gzipBytes: 2 }, change: { bytes: 1, percent: 100, gzipBytes: 1 } };
  return {
    intent: 'Combine all report sections', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', changeType: 'fix',
    base: { ref: 'main', sha: 'a'.repeat(40), analysisId: 'A-base' },
    head: { ref: 'HEAD', sha: 'b'.repeat(40), analysisId: 'A-head' },
    comparison: { state: 'COMPARABLE', reasons: [] }, change: { total: 1, paths: ['a.mjs'] },
    readiness: { state: 'INSUFFICIENT_EVIDENCE', blocking: [], insufficient: [], review: [], unassessedCategories: [], unsupportedCategories: [] },
    obligations: Array.from({ length: 45 }, (_, index) => ({ id: `check.${index}`, category: 'structuralIntegrity', required: true,
      applicability: 'APPLICABLE', result: 'UNKNOWN', rationale: 'Evidence is missing.', evidenceIds: [] })),
    limits: Array.from({ length: 10 }, () => 'A rule-set limit.'),
    gaps: Array.from({ length: 10 }, () => ({ text: 'An evidence gap.' })),
    executions: Array.from({ length: 10 }, () => ({ artifact: 'harness.json', kind: 'harness', binding: 'BOUND', side: 'head', eligible: false,
      reasons: [], harness: { mode: 'property', calls: 10, failures: 0, note: 'Information only.' } })),
    executionRuns: Array.from({ length: 5 }, () => ({ commandId: 'tests', side: 'head', status: 'completed', reasons: [] })),
    testValidation: Array.from({ length: 5 }, () => ({ type: 'regression', file: 'a.test.mjs', base: { status: 'failed' },
      head: { status: 'passed' }, confirmed: true, reason: 'Failure sensitivity.' })),
    mutation: Array.from({ length: 3 }, () => ({ artifact: 'mutation.json', counts: { killed: 1, survived: 3 }, score: 25,
      survivors: Array.from({ length: 3 }, () => ({ path: 'a.mjs', line: 1, mutator: 'BooleanLiteral' })), note: 'A survivor is a lead.' })),
    coverage: { reports: ['lcov.info'], lineReports: ['lcov.info'], files: { total: 2, measured: 1, unmeasured: ['a.mjs'] },
      changedLines: part, changedBranches: { ...part, sources: { 'istanbul-json': 1 } }, changedStatements: part,
      changedFunctions: part, outsideRepository: 1 },
    sizes: { state: 'COMPARED', head: {}, base: {}, routes: Array.from({ length: 5 }, () => ({ route: '/home', ...amount })),
      totals: { chunks: amount, css: amount, media: amount } },
  };
}

test('combined mutation, execution, harness, coverage and size output stays within 200 lines', () => {
  const text = renderReport(combinedResults()), lines = text.split('\n').length;
  assert.ok(lines <= maxReportLines, `${lines} report lines exceed ${maxReportLines}`);
  assert.match(text, /^## Mutation information$/m);
  assert.match(text, /^## Authorized execution$/m);
  assert.match(text, /^## Coverage of the changed code$/m);
  assert.match(text, /^## First-load JavaScript$/m);
  assert.match(text, /^## Failed checks$/m);
  assert.match(text, /^## Unknown checks$/m);
  assert.match(text, /^## Limits$/m);
  assert.match(text, /^## Terms in this report$/m);
  assert.match(text, /^## Full results$/m);
  assert.match(text, /property: 10 calls, 0 failures/);
  assert.match(text, /BooleanLiteral/);
  assert.match(text, /Failure sensitivity/);
  assert.match(text, /static\/chunks/);
});


test('combined compiler, oracle and measured coverage sections retain all sections within 200 lines', () => {
  const results = combinedResults();
  const paths = Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`);
  results.coverageEvidence = {
    project: { totals: Object.fromEntries(['lines', 'statements', 'branches', 'functions'].map((kind) => [kind, { covered: 1, total: 2 }])),
      files: { details: paths.map((path) => ({ path, lines: { covered: 1, total: 2 } })) } },
    lost: { label: 'Adjusted base coverage', totals: { lines: 1, branches: 1 }, comparable: true },
    unexecutedExports: { evidence: 'measured', total: 10, details: paths.map((path) => ({ path, line: 1, name: 'read' })) },
    mapping: paths.map((artifact) => ({ artifact, entries: 1, unmapped: 0, errors: [] })),
  };
  results.types = { state: 'KNOWN', compilerCoverage: { state: 'KNOWN', unchecked: paths }, calls: [], staleReferences: [], symbolImpact: { truncated: false } };
  results.generatedTestOracles = Array.from({ length: 3 }, () => ({ file: 'a.test.mjs', independent: true, cases: [{ name: 'case', state: 'CURRENT' }] }));
  const text = renderReport(results);
  assert.ok(text.split('\n').length <= maxReportLines, `${text.split('\n').length} report lines exceed ${maxReportLines}`);
  for (const heading of ['Compiler information', 'Generated test oracles', 'Mutation information', 'Authorized execution', 'Coverage of the changed code',
    'First-load JavaScript', 'Failed checks', 'Unknown checks', 'Limits', 'Terms in this report', 'Full results']) assert.match(text, new RegExp(`^## ${heading}$`, 'm'));
  assert.match(text, /^### Additional measured coverage$/m);
  assert.match(text, /verification-results.json/);
  assert.equal(results.coverageEvidence.project.files.details.length, 10);
  assert.equal(results.types.compilerCoverage.unchecked.length, 10);
});
