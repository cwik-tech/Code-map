// The assertion-level comparison of the test cases that a change kept (C27): fewer assertions, a strict matcher replaced by a
// looser one, and a removed expect.assertions() or expect.hasAssertions(). A changed expected value is not weakening.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTestFile, scanText } from '../lib/assertion-compare.mjs';

const vitest = "import { test, expect } from 'vitest';\nimport { total } from '../src/total';\n";
const nodeAssert = "import { test } from 'node:test';\nimport assert from 'node:assert';\n";
const strictAssert = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n";
/** The entries for one case 'adds' whose body changes from `before` to `after`. */
const compare = (before, after, header = vitest, paths = ['test/total.test.ts', 'test/total.test.ts']) => compareTestFile({
  basePath: paths[0], baseText: `${header}test('adds', () => {\n  ${before}\n});\n`, headPath: paths[1], headText: `${header}test('adds', () => {\n  ${after}\n});\n` });
const kinds = (entries) => entries.map((entry) => [entry.kind, entry.base.text, entry.head.text]);

test('a strict matcher that the head replaces with a looser one gives a looser-matcher entry with both assertion texts', () => {
  const pairs = [
    ['expect(total()).toBe(3);', 'expect(total()).toBeTruthy();'],
    ['expect(total()).toEqual(3);', 'expect(total()).toBeDefined();'],
    ['expect(total()).toStrictEqual({ sum: 3 });', 'expect(total()).not.toBeNull();'],
    ['expect(total()).toBe(3);', 'expect(total()).not.toBeUndefined();'],
    ['expect(total()).toEqual({ sum: 3, count: 2 });', 'expect(total()).toMatchObject({ sum: 3 });'],
    ['expect(total()).toStrictEqual({ sum: 3 });', 'expect(total()).toEqual({ sum: 3 });'],
    ['expect(total()).toEqual([1, 2]);', 'expect(total()).toEqual(expect.anything());'],
    ["expect(() => total(-1)).toThrow('negative input');", 'expect(() => total(-1)).toThrow();'],
    ['expect(() => total(-1)).toThrowError(RangeError);', 'expect(() => total(-1)).toThrowError();'],
  ];
  for (const [before, after] of pairs) {
    assert.deepEqual(kinds(compare(before, after)), [['looser-matcher', before.slice(0, -1), after.slice(0, -1)]], `${before} -> ${after}`);
  }
  const [entry] = compare('expect(total()).toBe(3);', 'expect(total()).toBeTruthy();');
  assert.match(entry.id, /^weakening:[a-f0-9]{64}$/);
  assert.deepEqual(entry, { id: entry.id, kind: 'looser-matcher', path: 'test/total.test.ts', basePath: 'test/total.test.ts', suite: '', name: 'adds', line: 3, baseLine: 3,
    base: { assertions: 1, text: 'expect(total()).toBe(3)' }, head: { assertions: 1, text: 'expect(total()).toBeTruthy()' } });
});

test('assert.ok in place of an equality assertion, and equal in place of strictEqual, are looser matchers of node:assert', () => {
  const pairs = [
    ['assert.equal(total(), 3);', 'assert.ok(total());'],
    ['assert.deepEqual(total(), [1, 2]);', 'assert.ok(total());'],
    ['assert.strictEqual(total(), 3);', 'assert(total());'],
    ['assert.strictEqual(total(), 3);', 'assert.equal(total(), 3);'],
    ['assert.deepStrictEqual(total(), [1]);', 'assert.deepEqual(total(), [1]);'],
    ['assert.equal(3, total());', 'assert.ok(total());'],
  ];
  for (const [before, after] of pairs) assert.deepEqual(kinds(compare(before, after, nodeAssert)), [['looser-matcher', before.slice(0, -1), after.slice(0, -1)]], `${before} -> ${after}`);
  // In node:assert/strict, equal is strictEqual and deepEqual is deepStrictEqual.
  assert.deepEqual(compare('assert.strictEqual(total(), 3);', 'assert.equal(total(), 3);', strictAssert), []);
  assert.deepEqual(compare('assert.deepStrictEqual(total(), [1]);', 'assert.deepEqual(total(), [1]);', strictAssert), []);
  assert.deepEqual(kinds(compare('assert.equal(total(), 3);', 'assert.ok(total());', strictAssert)), [['looser-matcher', 'assert.equal(total(), 3)', 'assert.ok(total())']]);
});

test('a changed expected value, a stronger matcher or a matcher of the same strength gives no entry', () => {
  const pairs = [
    ['expect(total()).toBe(3);', 'expect(total()).toBe(4);'],
    ["expect(total()).toEqual({ sum: 3 });", "expect(total()).toEqual({ sum: 4, count: 1 });"],
    ["expect(() => total(-1)).toThrow('negative');", "expect(() => total(-1)).toThrow('below zero');"],
    ['expect(total()).toBeTruthy();', 'expect(total()).toBe(3);'],
    ['expect(total()).toEqual(3);', 'expect(total()).toBe(3);'],
    ['expect(total()).not.toBe(3);', 'expect(total()).toBeDefined();'],
    ['expect(total()).toBe(3);', 'expect(total(1)).toBeTruthy();'],
  ];
  for (const [before, after] of pairs) assert.deepEqual(compare(before, after), [], `${before} -> ${after}`);
  for (const [before, after] of [['assert.equal(total(), 3);', 'assert.equal(total(), 4);'], ['assert.equal(total(), 3);', 'assert.strictEqual(total(), 3);'], ['assert.ok(total());', 'assert.equal(total(), 3);']]) {
    assert.deepEqual(compare(before, after, nodeAssert), [], `${before} -> ${after}`);
  }
});

test('a removed expect.assertions(n) or expect.hasAssertions() gives a plan-removed entry, and a changed count does not', () => {
  const body = 'expect(total()).toBe(3);';
  assert.deepEqual(kinds(compare(`expect.assertions(1);\n  ${body}`, body)), [['plan-removed', 'expect.assertions(1)', null]]);
  assert.deepEqual(kinds(compare(`expect.hasAssertions();\n  ${body}`, body)), [['plan-removed', 'expect.hasAssertions()', null]]);
  assert.deepEqual(compare(`expect.assertions(2);\n  ${body}`, `expect.assertions(1);\n  ${body}`), []);
  assert.deepEqual(compare(`expect.hasAssertions();\n  ${body}`, `expect.assertions(1);\n  ${body}`), []);
});

test('fewer assertions than in the base give an entry with the counts and the removed assertions', () => {
  const entries = compare('expect(total()).toBe(3);\n  expect(total(1)).toBe(4);\n  expect(total(2)).toBe(5);', 'expect(total(2)).toBe(5);');
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.base, entry.head]),
    [['fewer-assertions', { assertions: 3, text: 'expect(total()).toBe(3) | expect(total(1)).toBe(4)' }, { assertions: 1, text: null }]]);
  // An assertion in a local helper counts for each case that calls the helper.
  const helper = `${vitest}const check = (value) => { expect(value).toBe(3); expect(value).toBeGreaterThan(0); };\n`;
  const viaHelper = compareTestFile({ basePath: 'test/a.test.ts', baseText: `${helper}test('adds', () => { check(total()); });\n`,
    headPath: 'test/a.test.ts', headText: `${vitest}test('adds', () => { expect(total()).toBe(3); });\n` });
  assert.deepEqual(viaHelper.map((entry) => [entry.kind, entry.base.assertions, entry.head.assertions, entry.base.text]),
    [['fewer-assertions', 2, 1, 'expect(value).toBe(3) | expect(value).toBeGreaterThan(0)']]);
  const many = Array.from({ length: 8 }, (_, index) => `expect(total(${index})).toBe(${index});`).join('\n  ');
  assert.equal(compare(many, 'expect(total(7)).toBe(7);')[0].base.text, 'expect(total(0)).toBe(0) | expect(total(1)).toBe(1) | expect(total(2)).toBe(2) | and 4 more');
  assert.deepEqual(compare('expect(total()).toBe(3);', 'expect(total()).toBe(3);\n  expect(total(1)).toBe(4);'), [], 'more assertions are not weaker');
});

test('only a case of the base and the head that runs in both is compared, through a rename, by suite, name and ordinal', () => {
  const base = `${vitest}describe('sum', () => {\n  test('adds', () => { expect(total()).toBe(3); });\n  test('adds', () => { expect(total(1)).toBe(4); });\n});\n`
    + "test('parked', () => { expect(total()).toBe(3); });\ntest('stays', () => { expect(total()).toBe(3); });\n";
  const head = `${vitest}describe('sum', () => {\n  test('adds', () => { expect(total()).toBe(3); });\n  test('adds', () => { expect(total(1)).toBeTruthy(); });\n});\n`
    + "test.skip('parked', () => { expect(total()).toBeTruthy(); });\ntest('fresh', () => { expect(total()).toBeTruthy(); });\ndescribe('other', () => { test('stays', () => { expect(total()).toBeTruthy(); }); });\n";
  const entries = compareTestFile({ basePath: 'test/old.test.ts', baseText: base, headPath: 'test/new.test.ts', headText: head });
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.path, entry.basePath, entry.suite, entry.name, entry.line, entry.baseLine, entry.head.text]),
    [['looser-matcher', 'test/new.test.ts', 'test/old.test.ts', 'sum', 'adds', 5, 5, 'expect(total(1)).toBeTruthy()']],
    'a skipped head case is TEST-PARKED, an added case is not compared, and a case in another suite is another case');
});

test('two long assertions that differ only after 160 characters are compared by their full text, and the text shows the matcher', () => {
  const subject = `total(${'1, '.repeat(60)}1)`;
  const [entry, ...rest] = compare(`expect(${subject}).toBe(3);`, `expect(${subject}).toBeTruthy();`);
  assert.deepEqual([entry?.kind, rest], ['looser-matcher', []]);
  assert.ok(entry.base.text.length <= 160 && entry.base.text.endsWith('.toBe(3)'), entry.base.text);
  assert.ok(entry.head.text.length <= 160 && entry.head.text.endsWith('.toBeTruthy()'), entry.head.text);
  assert.ok(entry.base.text.startsWith('expect(total(1, 1, '), entry.base.text);
  const other = `total(${'1, '.repeat(60)}2)`;
  assert.deepEqual(compare(`expect(${subject}).toBe(3);`, `expect(${other}).toBeTruthy();`), [],
    'two subjects with the same first 160 characters are two subjects, so the two assertions do not pair');
});

test('the scan of a text gives each case its assertion details, and a long assertion text is cut at 160 characters', () => {
  const long = `expect(total(${'1, '.repeat(100)}1)).toBe(3);`;
  const [item] = scanText('test/long.test.ts', `${vitest}test('long', () => { ${long} expect.hasAssertions(); });\n`);
  assert.equal(item.checks.length, 1);
  assert.equal(item.checks[0].text.length, 160);
  assert.ok(item.checks[0].text.endsWith(')).toBe(3)'), 'the text keeps the end of the call');
  assert.deepEqual([item.checks[0].family, item.checks[0].matcher, item.checks[0].negated], ['expect', 'toBe', false]);
  assert.deepEqual(item.plans, ['expect.hasAssertions()']);
});


test('a literal that contains expect.anything() is an expected value, and a spaced call is an asymmetric matcher', () => {
  assert.deepEqual(compare('expect(total()).toEqual("old");', 'expect(total()).toEqual("expect.anything()");'), []);
  assert.deepEqual(compare('expect(total()).toEqual(/old/);', 'expect(total()).toEqual(/expect.anything()/);'), []);
  assert.equal(compare('expect(total()).toEqual(3);', 'expect(total()).toEqual({ value: expect . anything () });')[0]?.kind, 'looser-matcher');
});

test('the evidence of removed long assertions stays within 160 characters', () => {
  const body = Array.from({ length: 4 }, (_, index) => `expect(total(${index})).toBe("${'x'.repeat(180)}");`).join(' ');
  const [entry] = compare(body, 'expect(total()).toBe(3);');
  assert.equal(entry.kind, 'fewer-assertions');
  assert.ok(entry.base.text.length <= 160, `evidence has ${entry.base.text.length} characters`);
});
