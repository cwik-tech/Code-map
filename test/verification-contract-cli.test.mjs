// Acceptance tests import only interfaces that existed before the C45 changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { project, outcome } from './oracle-fixtures.mjs';

test('verification stores the versioned schema contract and rubric conditions', (t) => {
  const f = project(t), first = outcome(f.verify(f.request()), 3);
  assert.ok(first.results.rubric, 'A run must store its rubric definition.');
  assert.equal(first.results.rubric.categories.verificationCoverage.bands['3'].length > 0, true);
  assert.equal(typeof first.results.rubric.categories.verificationCoverage.bands['3'][0].condition, 'string');
  assert.equal(first.results.rubric.thresholds.changedLines, 80);
  const schema = JSON.parse(readFileSync(new URL('../schemas/verification-results-v1.schema.json', import.meta.url)));
  assert.equal(schema.$id, 'urn:code-map:verification-results:1');
});

test('verification compares a stored baseline without changing ratings or readiness', (t) => {
  const f = project(t);
  f.put('src/login.ts', 'export const login = (name: string) => name.trim();\n');
  f.commit('head');
  const first = outcome(f.verify(f.request()), 3);
  const second = outcome(f.verify(f.request({ baselineReport: first.summary.runId })), 3);
  assert.equal(second.results.ratingComparison.state, 'COMPARABLE');
  assert.equal(second.results.ratingComparison.baselineRunId, first.summary.runId);
  assert.equal(second.results.ratingComparison.categories.behavioralConfidence.state, 'UNKNOWN');
  assert.deepEqual(second.results.ratings, first.results.ratings);
  assert.deepEqual(second.results.obligations, first.results.obligations);
  assert.deepEqual(second.results.readiness, first.results.readiness);
  assert.match(second.markdown, /Category band comparison/);
  assert.ok(second.markdown.includes(`](../${first.summary.runId}/verification-report.md)`));
});

test('a historical baseline without rubric metadata stays UNKNOWN with a reason', (t) => {
  const f = project(t), first = outcome(f.verify(f.request()), 3);
  delete first.results.rubric;
  delete first.results.ratingScope;
  writeFileSync(first.summary.files.results, JSON.stringify(first.results));
  const second = outcome(f.verify(f.request({ baselineReport: first.summary.runId })), 3);
  assert.equal(second.results.ratingComparison.state, 'UNKNOWN');
  assert.match(second.results.ratingComparison.reasons.join(' '), /rubric/);
  assert.equal(second.results.ratingComparison.categories.structuralIntegrity.state, 'UNKNOWN');
});
