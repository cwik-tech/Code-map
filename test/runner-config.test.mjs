// The runner settings that a change can weaken (C27): Vitest and Jest coverage thresholds, excluded test files,
// passWithNoTests, bail and retry, read from object literals with the TypeScript parser. Other code is UNKNOWN.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareRunnerFile, runnerKind } from '../lib/runner-config.mjs';

const vitestConfig = (test) => `import { configDefaults, defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  plugins: [],\n  test: ${test},\n});\n`;
const changes = (entry) => entry.changes.map((change) => [change.setting, change.change, change.base, change.head]);

test('runnerKind knows the Vitest, Vite and Jest configuration files and package.json', () => {
  assert.deepEqual(['vitest.config.ts', 'packages/a/vitest.config.mts', 'vite.config.js', 'jest.config.cjs', 'jest.config.json', 'package.json', 'web/package.json', 'src/config.ts',
    'vitest.workspace.ts', 'jest.setup.ts', 'vitest.config.json'].map(runnerKind), ['vitest', 'vitest', 'vite', 'jest', 'jest', 'package', 'package', null, null, null, null]);
});

test('lowered or removed Vitest coverage thresholds, added excludes, passWithNoTests and a lowered bail or raised retry are weaker settings', () => {
  const base = vitestConfig("{ coverage: { thresholds: { lines: 80, branches: 70, functions: 60 } }, exclude: [...configDefaults.exclude, 'tmp/**'], passWithNoTests: false, bail: 3, retry: 0 }");
  const head = vitestConfig("{ coverage: { thresholds: { lines: 75, functions: 90 } }, exclude: [...configDefaults.exclude, 'e2e/**'], passWithNoTests: true, bail: 1, retry: 2 }");
  const entry = compareRunnerFile({ path: 'vitest.config.ts', basePath: 'vitest.config.ts', baseText: base, headText: head });
  assert.deepEqual([entry.runner, entry.state, entry.unknown, entry.reason], ['vitest', 'WEAKER', [], null]);
  assert.deepEqual(changes(entry), [
    ['test.coverage.thresholds.lines', 'lowered', 80, 75],
    ['test.coverage.thresholds.branches', 'removed', 70, null],
    ['test.exclude', 'added', ['...configDefaults.exclude', 'tmp/**'], ['...configDefaults.exclude', 'e2e/**']],
    ['test.passWithNoTests', 'enabled', false, true],
    ['test.bail', 'lowered', 3, 1],
    ['test.retry', 'raised', 0, 2],
  ]);
  assert.deepEqual(entry.changes.find((change) => change.setting === 'test.exclude').added, ['e2e/**']);
  // The older Vitest form keeps the thresholds in coverage itself, and "100: true" sets each of the four to 100.
  const older = compareRunnerFile({ path: 'vite.config.ts', basePath: 'vite.config.ts', baseText: vitestConfig('{ coverage: { 100: true } }'), headText: vitestConfig('{ coverage: { lines: 90 } }') });
  assert.deepEqual(changes(older), [['test.coverage.thresholds.lines', 'lowered', 100, 90], ['test.coverage.thresholds.functions', 'removed', 100, null],
    ['test.coverage.thresholds.branches', 'removed', 100, null], ['test.coverage.thresholds.statements', 'removed', 100, null]]);
});

test('raised thresholds, fewer excludes, the same settings and a default exclude list are not weaker', () => {
  const base = vitestConfig("{ coverage: { thresholds: { lines: 80 } }, exclude: ['tmp/**', 'e2e/**'], retry: 2 }");
  const head = vitestConfig("{ coverage: { thresholds: { lines: 85, branches: 50 } }, exclude: ['e2e/**'], retry: 1 }");
  assert.deepEqual([compareRunnerFile({ path: 'vitest.config.ts', baseText: base, headText: head }).state, compareRunnerFile({ path: 'vitest.config.ts', baseText: base, headText: base }).state],
    ['NOT_WEAKER', 'NOT_WEAKER']);
  const defaults = compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{}'), headText: vitestConfig('{ exclude: [...configDefaults.exclude] }') });
  assert.deepEqual([defaults.state, defaults.changes], ['NOT_WEAKER', []], 'the default excludes are not added excludes');
});

test('Jest settings: coverageThreshold for each key, testPathIgnorePatterns, passWithNoTests and bail, also in the "jest" field of package.json', () => {
  const base = "module.exports = {\n  coverageThreshold: { global: { lines: 90, branches: 80 }, './src/core/': { branches: 100 } },\n  testPathIgnorePatterns: ['/node_modules/'],\n};\n";
  const head = "module.exports = {\n  coverageThreshold: { global: { lines: 85, branches: 80 } },\n  testPathIgnorePatterns: ['/node_modules/', '/slow/'],\n  passWithNoTests: true,\n  bail: true,\n};\n";
  const entry = compareRunnerFile({ path: 'jest.config.js', baseText: base, headText: head });
  assert.deepEqual([entry.runner, entry.state], ['jest', 'WEAKER']);
  assert.deepEqual(changes(entry), [['coverageThreshold.global.lines', 'lowered', 90, 85], ['coverageThreshold../src/core/.branches', 'removed', 100, null],
    ['testPathIgnorePatterns', 'added', ['/node_modules/'], ['/node_modules/', '/slow/']], ['passWithNoTests', 'enabled', null, true], ['bail', 'enabled', null, 1]]);
  const typed = "import type { Config } from 'jest';\nconst config: Config = { testPathIgnorePatterns: ['/node_modules/', '/e2e/'] };\nexport default config;\n";
  assert.deepEqual(changes(compareRunnerFile({ path: 'jest.config.ts', baseText: 'export default {};\n', headText: typed })),
    [['testPathIgnorePatterns', 'added', null, ['/node_modules/', '/e2e/']]], 'without a list, Jest ignores /node_modules/, so only /e2e/ is new');

  const json = compareRunnerFile({ path: 'jest.config.json', baseText: '{ "bail": 1, "coverageThreshold": { "global": { "lines": 90 } } }', headText: '{ "bail": 2 }' });
  assert.deepEqual([json.runner, json.state, ...changes(json)], ['jest', 'WEAKER', ['coverageThreshold.global.lines', 'removed', 90, null]], 'jest.config.json is a Jest configuration');
  assert.equal(compareRunnerFile({ path: 'jest.config.json', baseText: '[]', headText: '[]' }).reason, 'The base configuration is not an object. The head configuration is not an object.');
  const pkg = (jest) => JSON.stringify({ name: 'app', version: '1.0.0', ...(jest ? { jest } : {}) }, null, 2);
  const fromPackage = compareRunnerFile({ path: 'package.json', baseText: pkg({ coverageThreshold: { global: { statements: 70 } } }), headText: pkg({ coverageThreshold: { global: { statements: 60 } } }) });
  assert.deepEqual([fromPackage.runner, ...changes(fromPackage)], ['jest', ['coverageThreshold.global.statements', 'lowered', 70, 60]]);
  assert.equal(compareRunnerFile({ path: 'package.json', baseText: pkg(null), headText: pkg(null).replace('1.0.0', '1.1.0') }), null, 'a package.json without a jest field is not a runner setting');
  assert.equal(compareRunnerFile({ path: 'vite.config.ts', baseText: 'export default { plugins: [] };\n', headText: 'export default { plugins: [react()] };\n' }), null,
    'a Vite configuration without Vitest settings is not a runner setting');
});

test('a configuration that is not an object literal, or a setting that code computes, is UNKNOWN', () => {
  const computed = vitestConfig('{ retry: 1 }').replace('defineConfig({', 'defineConfig(({ mode }) => ({').replace('\n});\n', '\n}));\n');
  const notLiteral = compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{ retry: 1 }'), headText: computed });
  assert.deepEqual([notLiteral.state, notLiteral.changes, notLiteral.reason], ['UNKNOWN', [], 'The head configuration is not an object literal.']);
  assert.equal(compareRunnerFile({ path: 'jest.config.js', baseText: "module.exports = require('./jest.base');\n", headText: "module.exports = require('./jest.base');\n" }).state, 'UNKNOWN');
  const fromCode = compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{ coverage: { thresholds: { lines: 80 } } }'), headText: vitestConfig('{ coverage: { thresholds: { lines: minimum } } }') });
  assert.deepEqual([fromCode.state, fromCode.unknown, fromCode.reason], ['UNKNOWN', ['test.coverage.thresholds.lines'], 'These settings have no literal value: test.coverage.thresholds.lines.']);
  const spread = compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{ retry: 0 }'), headText: vitestConfig('{ ...shared, passWithNoTests: true }') });
  assert.deepEqual([spread.state, changes(spread), spread.unknown.includes('test.retry')], ['WEAKER', [['test.passWithNoTests', 'enabled', null, true]], true],
    'a spread can set any setting before it, but a setting after it is known');
  const unread = compareRunnerFile({ path: 'vitest.config.ts', baseText: undefined, headText: vitestConfig('{}') });
  assert.deepEqual([unread.state, unread.reason], ['UNKNOWN', 'Code-map cannot read the base configuration.']);
  const invalid = compareRunnerFile({ path: 'package.json', baseText: '{ "jest": { "bail": 1 } }', headText: '{ "jest": { "bail": 1 }' });
  assert.deepEqual([invalid.state, invalid.reason], ['UNKNOWN', 'The head configuration is not valid JSON.']);
  const deep = '['.repeat(20000) + ']'.repeat(20000);
  const nested = compareRunnerFile({ path: 'package.json', baseText: '{ "jest": { "bail": 1 } }', headText: `{ "jest": { "bail": 1 }, "x": ${deep} }` });
  assert.deepEqual([nested.state, nested.reason], ['UNKNOWN', 'Code-map cannot parse the head configuration.'], 'a text that the parser cannot hold does not stop the run');
  assert.equal(compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{}'), headText: `export default { test: {}, x: ${deep} };\n` }).reason, 'Code-map cannot parse the head configuration.');
});

test('an added configuration compares with the defaults, and a deleted one removes its settings', () => {
  const added = compareRunnerFile({ path: 'vitest.config.ts', baseText: null, headText: vitestConfig("{ passWithNoTests: true, exclude: ['e2e/**'] }") });
  assert.deepEqual(changes(added), [['test.exclude', 'added', null, ['e2e/**']], ['test.passWithNoTests', 'enabled', null, true]]);
  const deleted = compareRunnerFile({ path: 'jest.config.js', baseText: 'module.exports = { coverageThreshold: { global: { lines: 80 } } };\n', headText: null });
  assert.deepEqual([deleted.state, ...changes(deleted)], ['WEAKER', ['coverageThreshold.global.lines', 'removed', 80, null]]);
  const renamed = compareRunnerFile({ path: 'config/vitest.config.ts', basePath: 'vitest.config.ts', baseText: vitestConfig('{ bail: 1 }'), headText: vitestConfig('{ bail: 1 }') });
  assert.deepEqual([renamed.path, renamed.basePath, renamed.state], ['config/vitest.config.ts', 'vitest.config.ts', 'NOT_WEAKER']);
});


test('computed exclude entries and malformed configuration syntax stay UNKNOWN', () => {
  const computed = compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{}'), headText: vitestConfig('{ exclude: [...shared] }') });
  assert.deepEqual([computed.state, computed.changes, computed.unknown], ['UNKNOWN', [], ['test.exclude']]);
  const identifier = compareRunnerFile({ path: 'jest.config.js', baseText: 'module.exports = {};', headText: 'module.exports = { testPathIgnorePatterns: [ignored] };' });
  assert.deepEqual([identifier.state, identifier.changes, identifier.unknown], ['UNKNOWN', [], ['testPathIgnorePatterns']]);
  const broken = compareRunnerFile({ path: 'vitest.config.ts', baseText: vitestConfig('{}'), headText: 'export default { test: { retry: 2 };' });
  assert.equal(broken.state, 'UNKNOWN');
  assert.deepEqual(broken.changes, []);
});
