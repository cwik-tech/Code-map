// Parse diagnostics (C40): the syntax errors of each file, the SYNTAX-ERROR finding and the gap in the summary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { deriveFindings } from '../lib/findings.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const resolve = createResolver(new Set(), { aliases: [], baseUrl: null });

test('each file records the number of syntax errors, with the line and message of the first one', () => {
  assert.deepEqual(analyzeFile('src/broken.ts', 'export const a = 1;\nexport const b = ;\nfunction (\n', resolve).syntax, { errors: 3, line: 2, message: 'Expression expected.' });
  assert.deepEqual(analyzeFile('src/ok.ts', 'export const a = 1;\n', resolve).syntax, { errors: 0, line: null, message: null });
  assert.equal(analyzeFile('src/view.jsx', 'export const View = () => <p>{1}</p>;\n', resolve).syntax.errors, 0, 'JSX in a JSX file is valid');
  assert.equal(analyzeFile('src/view.ts', 'export const View = () => <p>{1}</p>;\n', resolve).syntax.errors > 0, true, 'JSX in a .ts file is a syntax error');
  assert.equal(analyzeFile('test/a.test.ts', "import { test } from 'node:test';\ntest('x', () => {\n", resolve, { tests: true }).syntax.errors, 1, 'test files are parsed too');
});

test('a source file or a test file with a syntax error is a SYNTAX-ERROR finding; a clean file is not', () => {
  const files = [analyzeFile('src/broken.ts', 'export const a = ;\n', resolve), analyzeFile('src/ok.ts', 'export const ok = 1;\n', resolve)];
  const testFiles = [analyzeFile('test/broken.test.ts', "import { test } from 'node:test';\ntest('x', () => {\n", resolve, { tests: true })].map((file) => ({ ...file, scan: file.testScan }));
  const analysis = analyzeProject({ project: 'fixture', ref: 'working tree', sha: 'fixture', coverageSnapshot: 'working-tree', rules: [], files, testFiles, coChanges: { changes: {} }, changes: { uncommitted: [] } });
  assert.deepEqual(analysis.files.map((file) => [file.path, file.syntax.errors]), [['src/broken.ts', 1], ['src/ok.ts', 0]]);
  assert.deepEqual(analysis.syntaxErrors.map((item) => [item.path, item.test, item.errors, item.line]), [['src/broken.ts', false, 1, 1], ['test/broken.test.ts', true, 1, 3]]);
  const found = deriveFindings(analysis).filter((item) => item.ruleId === 'SYNTAX-ERROR');
  assert.deepEqual(found.map((item) => [item.location.path, item.location.line, item.severity, item.source, item.capability]),
    [['src/broken.ts', 1, 'medium', 'inventory', 'C40'], ['test/broken.test.ts', 3, 'medium', 'inventory', 'C40']]);
  assert.match(found[0].text, /Expression expected/);
  assert.deepEqual(found[0].key, ['src/broken.ts'], 'the identity key is the path alone');
});

test('acceptance: the summary counts the files with syntax errors as a gap, and the findings reach their evidence', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-parse-')), store = mkdtempSync(join(tmpdir(), 'code-map-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('src/broken.ts', 'export const a = ;\n');
  put('src/ok.ts', 'export const ok = 1;\n');
  put('src/poll.ts', 'export function start(tick: () => void) {\n  setInterval(tick, 1000);\n}\n');
  put('test/ok.test.ts', "import { test } from 'node:test';\nimport { ok } from '../src/ok';\ntest('ok', () => { if (!ok) throw new Error('x'); });\n");
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  const run = (args) => {
    const output = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(output.status, 0, output.stderr);
    return JSON.parse(output.stdout);
  };
  const summary = run(['inspect', '--summary', '--worktree', '--store', store]);
  const gap = summary.gaps.find((item) => item.key === 'syntaxErrors');
  assert.equal(gap?.count, 1);
  assert.equal(gap.source, 'inventory');
  const byRule = Object.fromEntries(summary.findings.byRule.map((rule) => [rule.ruleId, rule.count]));
  assert.equal(byRule['SYNTAX-ERROR'], 1);
  assert.equal(byRule['INTERVAL-NOT-CLEARED'], 1);
  const item = summary.findings.items.find((entry) => entry.ruleId === 'SYNTAX-ERROR');
  const detail = run(['inspect', '--analysis', summary.analysis.id, '--finding', item.id, '--store', store]);
  assert.deepEqual(detail.details.syntax, { path: 'src/broken.ts', test: false, errors: 1, line: 1, message: 'Expression expected.' });
  const interval = summary.findings.items.find((entry) => entry.ruleId === 'INTERVAL-NOT-CLEARED');
  const intervalDetail = run(['inspect', '--analysis', summary.analysis.id, '--finding', interval.id, '--store', store]);
  assert.match(intervalDetail.details.file, /--file src\/poll\.ts/, 'a pattern finding gives the command for its file report');
  const report = run(['inspect', '--analysis', summary.analysis.id, '--file', 'src/poll.ts', '--store', store]);
  assert.deepEqual(report.files[0].patterns.map((entry) => [entry.kind, entry.line, entry.scope, entry.reason]), [['interval-not-cleared', 2, 'start', 'not-stored']]);
  assert.deepEqual(report.files[0].syntax, { errors: 0, line: null, message: null });

  put('src/broken.ts', 'export const a = 1;\n');
  const fixed = run(['inspect', '--summary', '--worktree', '--store', store]);
  assert.equal(fixed.gaps.some((entry) => entry.key === 'syntaxErrors'), false, 'a project with no syntax error has no such gap');
});
