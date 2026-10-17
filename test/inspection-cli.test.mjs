import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-inspect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('src/parent.ts', "import { child } from './child';\nexport interface Shared { id: string }\nexport const parent = () => child();\n");
  put('src/child.ts', "import type { Shared } from './parent';\nexport function child(input?: Shared) { return input?.id; }\n");
  put('test/parent.test.ts', "import { parent } from '../src/parent';\n");
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return { root, put };
}
function run(root, args) { return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }); }

test('inspect emits a compact selected-file report without HTML and shares its analysis with generated HTML', (t) => {
  const { root } = repository(t);
  const output = run(root, ['inspect', '--ref', 'HEAD', '--file', 'src/parent.ts']);
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.files.map(f => f.path), ['src/parent.ts']);
  assert.equal(report.cycles.all.length, 1);
  assert.equal(report.cycles.value.length, 0);
  assert.equal(report.sharedTypes[0].name, 'Shared');
  assert.deepEqual(report.files[0].tests.direct, ['test/parent.test.ts']);
  assert.equal(report.files[0].source, undefined, 'compact reports omit source bodies');
  assert.equal(existsSync(join(root, 'docs/code-map/code-map.html')), false);

  const built = run(root, ['--ref', 'HEAD', '--out', 'map.html']);
  assert.equal(built.status, 0, built.stderr);
  const data = JSON.parse(readFileSync(join(root, 'map.html'), 'utf8').match(/^const DATA = (.*);$/m)[1]);
  assert.deepEqual(data.analysis.cycles, report.cycles);
  assert.deepEqual(data.analysis.sharedTypes, report.sharedTypes);
});

test('JSON output supports change sets and files while preserving stdout and reporting invalid selection', (t) => {
  const { root, put } = repository(t);
  put('src/child.ts', "export function child() { return 'changed'; }\n");
  const output = run(root, ['inspect', '--worktree', '--change', 'uncommitted', '--file', 'src/parent.ts', '--out', 'report.json']);
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stdout, '');
  const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
  assert.deepEqual(report.selection.files, ['src/child.ts', 'src/parent.ts']);
  assert.equal(report.snapshot.workingTree, true);
  assert.equal(report.cycles.all.length, 0);
  const invalid = run(root, ['inspect', '--ref', 'HEAD', '--file', 'src/missing.ts']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /src\/missing.ts/);
  assert.equal(invalid.stdout, '');
});
