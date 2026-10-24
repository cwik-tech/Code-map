// The test changes of a verification run from the texts of the base and the head: weaker assertions of the kept test cases
// and weaker runner settings, read from Git for a head commit and from the files for the working tree. The fixture is in a
// temporary folder, and the reads change nothing in the repository. A file that is too large, or that the parser cannot hold, is unread.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testChanges } from '../lib/test-changes.mjs';
import { changedFiles } from '../lib/verify-change.mjs';

const header = "import { test, expect } from 'vitest';\nimport { total } from '../src/total';\n";
const testFile = (matcher) => `${header}test('adds', () => {\n  expect(total(1, 2)).${matcher};\n});\n`;
const scanned = (...paths) => ({ tests: { testFiles: paths.map((path) => ({ path, kind: 'tests' })) } });

test('testChanges compares the kept cases through a rename and the changed runner configurations, for the working tree and for a commit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-test-changes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('src/total.ts', 'export const total = (a: number, b: number) => a + b;\n');
  put('test/old.test.ts', testFile('toBe(3)'));
  put('test/big.test.ts', testFile('toBe(3)'));
  put('test/deep.test.ts', testFile('toBe(3)'));
  put('vitest.config.ts', "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { coverage: { thresholds: { lines: 80 } } } });\n");
  put('jest.config.js', 'module.exports = { coverageThreshold: { global: { branches: 90 } } };\n');
  put('package.json', '{ "name": "app", "version": "1.0.0" }\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  git('mv', 'test/old.test.ts', 'test/new.test.ts');
  put('test/new.test.ts', testFile('toBeTruthy()'));
  put('test/big.test.ts', `${testFile('toBe(3)')}// ${'x'.repeat(4 * 1024 * 1024)}\n`);
  put('test/fresh.test.ts', testFile('toBeDefined()'));
  put('test/deep.test.ts', `${testFile('toBe(3)')}const deep = ${'['.repeat(20000)}${']'.repeat(20000)};\n`);
  put('vitest.config.ts', "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { coverage: { thresholds: { lines: 60 } } } });\n");
  rmSync(join(root, 'jest.config.js'));
  put('package.json', '{ "name": "app", "version": "1.1.0" }\n');
  const analyses = { baseAnalysis: scanned('test/old.test.ts', 'test/big.test.ts', 'test/deep.test.ts'), headAnalysis: scanned('test/new.test.ts', 'test/big.test.ts', 'test/deep.test.ts', 'test/fresh.test.ts') };

  const check = (result, label) => {
    assert.deepEqual([result.assertionWeakening.files, result.assertionWeakening.total, result.assertionWeakening.unread], [1, 1, ['test/big.test.ts', 'test/deep.test.ts']], label);
    assert.deepEqual(result.assertionWeakening.entries.map((entry) => [entry.kind, entry.path, entry.basePath, entry.base.text, entry.head.text]),
      [['looser-matcher', 'test/new.test.ts', 'test/old.test.ts', 'expect(total(1, 2)).toBe(3)', 'expect(total(1, 2)).toBeTruthy()']], label);
    assert.deepEqual(result.runnerSettings.entries.map((entry) => [entry.path, entry.state, entry.changes.map((change) => [change.setting, change.change, change.base, change.head])]), [
      ['jest.config.js', 'WEAKER', [['coverageThreshold.global.branches', 'removed', 90, null]]],
      ['vitest.config.ts', 'WEAKER', [['test.coverage.thresholds.lines', 'lowered', 80, 60]]],
    ], `${label}: a package.json without a jest field is not listed`);
    assert.deepEqual([result.runnerSettings.files, result.runnerSettings.weaker, result.runnerSettings.unknown], [2, 2, 0], label);
  };
  const worktree = changedFiles(root, baseSha, null);
  assert.ok(worktree.files.some((file) => file.status === 'R' && file.path === 'test/new.test.ts'), JSON.stringify(worktree.files));
  const status = git('status', '--porcelain');
  check(testChanges(root, { baseSha, headSha: null, change: worktree, ...analyses }), 'working tree');
  assert.equal(git('status', '--porcelain'), status, 'the reads change nothing');
  git('add', '-A'); git('commit', '-qm', 'head');
  const headSha = git('rev-parse', 'HEAD');
  check(testChanges(root, { baseSha, headSha, change: changedFiles(root, baseSha, headSha), ...analyses }), 'commit');
});
