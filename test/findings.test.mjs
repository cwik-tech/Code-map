import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject, createReport } from '../lib/analysis.mjs';
import { deriveFindings, findingRules, summaryItems } from '../lib/findings.mjs';
import { ruleViolations } from '../lib/rules.mjs';
import { page } from '../lib/overview.mjs';

function data(sources, { tests = {}, rules = [] } = {}) {
  const resolve = createResolver(new Set([...Object.keys(sources), ...Object.keys(tests)]), { aliases: [], baseUrl: null });
  const facts = (entries, options) => Object.entries(entries).map(([path, source]) => analyzeFile(path, source, resolve, options));
  const d = { project: 'fixture', ref: 'working tree', sha: 'fixture', coverageSnapshot: 'working-tree', rules,
    files: facts(sources), testFiles: facts(tests, { tests: true }).map((test) => ({ ...test, scan: test.testScan })), coChanges: { changes: {} }, changes: { uncommitted: [] } };
  d.analysis = analyzeProject(d);
  return d;
}

test('architecture rules use the viewer semantics: module or path tokens, "*" for any other module, and import lines', () => {
  const d = data({
    'src/core/engine.ts': "import { view } from '../ui/view';\nimport { util } from '../lib/util';\nimport { own } from './own';\nexport const engine = [view, util, own];",
    'src/core/own.ts': 'export const own = 1;',
    'src/ui/view.ts': "import { engine } from '../core/engine';\nexport const view = engine;",
    'src/lib/util.ts': 'export const util = 1;',
  }, { rules: ['core -> ui', 'ui -> *', 'not a rule'] });
  const { rules } = d.analysis;
  assert.deepEqual(rules.declared, ['core -> ui', 'ui -> *']);
  assert.deepEqual(rules.invalid, ['not a rule']);
  assert.deepEqual(rules.violations, [
    { rule: 'core -> ui', from: 'src/core/engine.ts', to: 'src/ui/view.ts', lines: [1] },
    { rule: 'ui -> *', from: 'src/ui/view.ts', to: 'src/core/engine.ts', lines: [1] },
  ]);
  const report = createReport(d, { files: ['src/lib/util.ts'] });
  assert.deepEqual(report.rules.violations, [], 'a file selection keeps only violations that touch it');
  assert.equal(report.summary.ruleViolations, 2, 'project totals stay unfiltered');
  assert.equal(createReport(d, { files: ['src/ui/view.ts'] }).rules.violations.length, 2);
});

test('finding IDs come from the rule and the semantic location, so they survive line moves and reruns', () => {
  const before = data({ 'src/a.ts': "import { b } from './b';\nexport const a = () => b();", 'src/b.ts': "import { a } from './a';\nexport const b = () => a;" });
  const after = data({ 'src/a.ts': "\n\n// moved down\nimport { b } from './b';\nexport const a = () => b();", 'src/b.ts': "import { a } from './a';\nexport const b = () => a;" });
  const cycle = (findings) => findings.find((item) => item.ruleId === 'CYCLE-VALUE');
  assert.equal(cycle(deriveFindings(before.analysis)).id, cycle(deriveFindings(after.analysis)).id);
  assert.notEqual(cycle(deriveFindings(before.analysis)).location.line, cycle(deriveFindings(after.analysis)).location.line);
  assert.deepEqual(deriveFindings(before.analysis), deriveFindings(before.analysis));
  const ids = deriveFindings(before.analysis).map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('findings cover graph and test evidence, and name their evidence kind and capability', () => {
  const d = data({
    'src/parse.ts': "export function parse(x: string) {\n  if (!x) throw new Error('bad');\n  return x;\n}\nexport const spare = 1;",
    'src/broken.ts': "import { gone } from './gone';\nexport const broken = gone;",
  }, { tests: { 'test/parse.test.ts': "import { test, expect } from 'vitest';\nimport { parse } from '../src/parse';\ntest('parses', () => { expect(parse('ok')).toBe('ok'); });\ntest.only('focused', () => { expect(1).toBe(1); });\ntest('nothing', () => { parse('x'); });" } });
  const findings = deriveFindings(d.analysis);
  const of = (ruleId) => findings.filter((item) => item.ruleId === ruleId);
  assert.deepEqual(of('IMPORT-UNRESOLVED').map((item) => [item.location.path, item.location.line, item.facts.specifier]), [['src/broken.ts', 1, './gone']]);
  assert.deepEqual(of('TEST-NO-FAILURE-ASSERTION').map((item) => item.location.symbol), ['parse']);
  assert.deepEqual(of('EXPORT-UNREFERENCED').map((item) => item.location.symbol), ['spare']);
  assert.deepEqual(of('TEST-FOCUSED').map((item) => item.location.symbol), ['focused']);
  assert.deepEqual(of('TEST-NO-ASSERTIONS').map((item) => item.location.symbol), ['nothing']);
  for (const item of findings) {
    const rule = findingRules[item.ruleId];
    assert.ok(rule, `${item.ruleId} is registered`);
    assert.equal(item.severity, rule.severity);
    assert.equal(item.source, rule.source);
    assert.match(rule.capability, /^C\d\d$/);
  }
  assert.deepEqual(findings.map((item) => item.severity), [...findings.map((item) => item.severity)].sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b)));
});

test('the summary shows at most 20 findings and 5 of each rule, highest severity first', () => {
  const sources = { 'src/use.ts': "import { e0 } from './many';\nexport const use = e0;", 'src/many.ts': Array.from({ length: 30 }, (_, i) => `export const e${i} = ${i};`).join('\n') };
  for (let i = 0; i < 8; i++) Object.assign(sources, { [`src/c${i}a.ts`]: `import { b } from './c${i}b';\nexport const a = b;`, [`src/c${i}b.ts`]: `import { a } from './c${i}a';\nexport const b = a;` });
  const findings = deriveFindings(data(sources).analysis);
  const shown = summaryItems(findings);
  assert.equal(shown.length, 10);
  assert.deepEqual(shown.map((item) => item.ruleId), [...Array(5).fill('CYCLE-VALUE'), ...Array(5).fill('EXPORT-UNREFERENCED')]);
});

test('pages report totals and the next command, and validate their bounds', () => {
  const list = Array.from({ length: 7 }, (_, i) => i);
  const command = (offset) => `next ${offset}`;
  assert.deepEqual(page(list, { offset: 0, limit: 3 }, command), { total: 7, offset: 0, limit: 3, items: [0, 1, 2], next: 'next 3' });
  assert.deepEqual(page(list, { offset: 6, limit: 3 }, command), { total: 7, offset: 6, limit: 3, items: [6], next: null });
  assert.deepEqual(page(list, { offset: 9, limit: 3 }, command).items, []);
});

test('architecture rules give the module base that they used, so a comparison can see a changed base', () => {
  const files = [{ path: 'src/app/core/engine.ts', imports: ['src/app/ui/view.ts'] }, { path: 'src/app/ui/view.ts', imports: [] }];
  const result = (list) => { const { base, violations } = ruleViolations(list, ['core -> ui']); return [base, violations.length]; };
  assert.deepEqual(result(files), ['src/app', 1]);
  assert.deepEqual(result([...files, { path: 'src/main.ts', imports: [] }]), ['src', 0], 'a file in a shallower folder moves the base, and the modules change');
});

test('rules split at the first arrow and trim both sides; a long run of spaces is parsed quickly', () => {
  const parse = (text) => { const { declared, invalid } = ruleViolations([], [text]); return declared.length ? 'valid' : invalid.length ? 'invalid' : 'none'; };
  assert.deepEqual(['a -> b', '  a->->b ', 'a ->', '-> b', 'a\n-> b', 'a b'].map(parse), ['valid', 'valid', 'invalid', 'invalid', 'valid', 'invalid']);
  const started = process.hrtime.bigint();
  assert.equal(parse('a' + ' '.repeat(200000) + 'b'), 'invalid');
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 200);
});

test('an import of a name that the target file does not export is a finding; targets with unknown exports are skipped and counted', () => {
  const d = data({
    'src/a.ts': "import { gone, kept } from './b';\nimport def from './c';\nimport { x } from './cjs';\nimport { y, kept as k } from './star';\nimport { w } from './ext';\nimport type { T } from './b';\nexport { kept as again, nope } from './b';\nexport const a = [gone, kept, def, x, y, k, w];",
    'src/b.ts': 'export const kept = 1;\nexport type T = number;',
    'src/c.ts': 'export const z = 1;',
    'src/cjs.ts': 'module.exports = { x: 1 };',
    'src/star.ts': "export * from './b';",
    'src/ext.ts': "export * from 'some-package';",
  }, { tests: { 'test/a.test.ts': "import { test } from 'vitest';\nimport { old } from '../src/b';\ntest('uses old', () => { old; });" } });
  const missing = deriveFindings(d.analysis).filter((item) => item.ruleId === 'IMPORT-NAME-MISSING');
  assert.deepEqual(missing.map((item) => [item.location.path, item.location.line, item.facts.target, item.facts.name]).sort(), [
    ['src/a.ts', 1, 'src/b.ts', 'gone'], ['src/a.ts', 2, 'src/c.ts', 'default'], ['src/a.ts', 4, 'src/star.ts', 'y'], ['src/a.ts', 7, 'src/b.ts', 'nope'], ['test/a.test.ts', 2, 'src/b.ts', 'old'],
  ]);
  assert.deepEqual(d.analysis.importNames.unchecked, { exportStar: 1, commonJs: 1, bindingPattern: 0, exportAssignment: 0, noExports: 0 });
});
