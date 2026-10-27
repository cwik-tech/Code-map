// Unit tests of decision tables (C24): validation, overlapping rules, combinations that no rule covers, the limit of 4,096
// combinations for the complete list, and the pairwise cases above that limit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDecisionTable, exhaustiveLimit, pairwiseCases, validateDecisionTable } from '../lib/models/decision-table.mjs';

const discount = { tableVersion: 1, name: 'discount', subject: { file: 'src/price.ts', export: 'discount' },
  conditions: [{ name: 'member', values: [true, false] }, { name: 'total', values: ['low', 'high'] }],
  rules: [{ when: { member: true }, then: 10 }, { when: { member: true, total: 'high' }, then: 15 }, { when: { member: false, total: 'low' }, then: 0 }] };
/** A table of `count` conditions with two values each, and one rule for c0 = 1. */
const wide = (count, rules = [{ when: { c0: 1 }, then: 'yes' }]) => ({ ...discount, conditions: Array.from({ length: count }, (_, index) => ({ name: `c${index}`, values: [0, 1] })), rules });
const valid = (value) => { const checked = validateDecisionTable(value); assert.equal(checked.ok, true, JSON.stringify(checked.problems)); return checked.table; };
const problems = (value) => { const checked = validateDecisionTable(value); assert.equal(checked.ok, false); return checked.problems.map((item) => `${item.path}: ${item.message}`); };

test('every combination of a small table: the covered ones, an overlap with a conflict, and a gap', () => {
  const result = checkDecisionTable(valid(discount));
  assert.deepEqual([result.method, result.combinations, result.gapsComplete], ['all', 4, true]);
  assert.deepEqual(result.cases, [
    { values: { member: true, total: 'low' }, rules: [0], expected: 10, state: 'covered' },
    { values: { member: true, total: 'high' }, rules: [0, 1], expected: null, state: 'conflict' },
    { values: { member: false, total: 'low' }, rules: [2], expected: 0, state: 'covered' },
    { values: { member: false, total: 'high' }, rules: [], expected: null, state: 'gap' },
  ]);
  assert.deepEqual(result.overlaps, [{ rules: [0, 1], conflict: true, example: { member: true, total: 'high' } }]);
  assert.deepEqual(result.gaps, [{ member: false, total: 'high' }]);
});

test('two rules with the same outcome overlap without a conflict, and rules that differ in one condition do not overlap', () => {
  const result = checkDecisionTable(valid({ ...discount, rules: [{ when: {}, then: 'a' }, { when: { total: 'low' }, then: 'a' }, { when: { member: false, total: 'high' }, then: 'b' }] }));
  assert.deepEqual(result.overlaps, [{ rules: [0, 1], conflict: false, example: { member: true, total: 'low' } }, { rules: [0, 2], conflict: true, example: { member: false, total: 'high' } }]);
  assert.deepEqual(result.cases.map((item) => item.state), ['covered', 'covered', 'covered', 'conflict']);
  assert.deepEqual(result.gaps, []);
});

test('at most 4,096 combinations give the complete list; one more condition gives pairwise cases', () => {
  assert.equal(exhaustiveLimit, 4096);
  const all = checkDecisionTable(valid(wide(12)));
  assert.deepEqual([all.method, all.combinations, all.cases.length, all.gaps.length, all.gapsComplete], ['all', 4096, 4096, 2048, true]);
  const pairwise = checkDecisionTable(valid(wide(13)));
  assert.deepEqual([pairwise.method, pairwise.combinations, pairwise.gapsComplete], ['pairwise', 8192, false]);
  assert.equal(pairwise.cases.length, 10, 'the greedy method needs 10 cases for 13 conditions with two values each');
  // Every pair of values of two conditions is in at least one case.
  const names = Array.from({ length: 13 }, (_, index) => `c${index}`);
  for (const [i, a] of names.entries()) for (const b of names.slice(i + 1)) for (const x of [0, 1]) for (const y of [0, 1]) {
    assert.ok(pairwise.cases.some((item) => item.values[a] === x && item.values[b] === y), `${a}=${x} with ${b}=${y}`);
  }
  assert.ok(pairwise.gaps.length > 0 && pairwise.gaps.every((values) => values.c0 === 0), 'the pairwise cases find the gap where c0 is 0');
  assert.deepEqual(checkDecisionTable(valid(wide(13))), pairwise, 'the same table always gives the same cases');
});

test('the pairwise method covers every pair of conditions with more values, in a fixed order', () => {
  const sizes = [3, 4, 2, 5];
  const cases = pairwiseCases(sizes);
  for (let i = 0; i < sizes.length; i++) for (let j = i + 1; j < sizes.length; j++) for (let a = 0; a < sizes[i]; a++) for (let b = 0; b < sizes[j]; b++) {
    assert.ok(cases.some((item) => item[i] === a && item[j] === b), `${i}=${a} with ${j}=${b}`);
  }
  assert.ok(cases.length >= 20 && cases.length < 3 * 4 * 2 * 5, `${cases.length} cases`);
  assert.deepEqual(cases[0], [0, 0, 0, 0], 'the first case starts with the first uncovered pair');
  assert.deepEqual(pairwiseCases(sizes), cases);
});

test('a decision table is validated strictly, and each problem has its path', () => {
  const lines = problems({ ...discount, tableVersion: 2, owner: 'x', subject: { file: '/etc/x.ts' },
    conditions: [{ name: 'member', values: [true, true] }, { name: 'member', values: [] }, { name: 'kind', values: [{ deep: 1 }] }],
    rules: [{ when: { member: 'maybe' }, then: 1 }, { when: { color: 'red' }, then: 2 }, { when: {}, then: [1] }, { then: 3 }] });
  for (const pattern of [/^tableVersion: must be 1/, /^owner: is not a known field/, /^subject\.file: must be a path inside the repository/, /^subject\.export: must be a text/,
    /^conditions\[0\]\.values\[1\]: repeats the value true/, /^conditions\[1\]\.name: repeats the condition "member"/, /^conditions\[1\]\.values: must be a list of 1 to 32 values/,
    /^conditions\[2\]\.values\[0\]: must be a text, a number, true, false or null/, /^rules\[0\]\.when\.member: must be one of the values of the condition/,
    /^rules\[1\]\.when\.color: is not a condition of the table/, /^rules\[2\]\.then: must be a text, a number, true, false or null/, /^rules\[3\]\.when: must be an object/]) {
    assert.ok(lines.some((line) => pattern.test(line)), `${pattern} in ${lines.join(' | ')}`);
  }
  assert.match(problems(wide(21)).join(), /conditions: must have at most 20 conditions/);
  assert.match(problems({ ...discount, rules: Array.from({ length: 257 }, () => ({ when: {}, then: 1 })) }).join(), /rules: must have at most 256 rules/);
  assert.match(problems({ ...discount, subject: { file: 'src/../../x.ts', export: 'x' } }).join(), /subject\.file: must be a path inside the repository/);
  assert.match(problems(null).join(), /^: must be an object/);
});
