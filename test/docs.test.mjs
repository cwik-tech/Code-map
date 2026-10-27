import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { findingRules } from '../lib/findings.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the retrieval reference lists every finding rule with its severity, evidence kind and capability', () => {
  const page = read('docs/retrieval.md');
  for (const [ruleId, rule] of Object.entries(findingRules)) {
    const row = page.split('\n').find((line) => line.startsWith(`| \`${ruleId}\` |`));
    assert.ok(row, `docs/retrieval.md has a row for ${ruleId}`);
    assert.deepEqual(row.split('|').slice(2, 5).map((cell) => cell.trim()), [rule.severity, rule.source, rule.capability], `the row for ${ruleId} matches the registry`);
  }
});

test('the evidence kinds table names every evidence kind that a finding rule uses', () => {
  const page = read('docs/inspection.md');
  for (const source of new Set(Object.values(findingRules).map((rule) => rule.source))) assert.match(page, new RegExp(`^\\| \`${source}\` \\|`, 'm'));
});
