import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-entrypoints-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'src/core.mjs': "export function checked(x) { if (x < 0) throw new Error('negative'); return x * 2; }\n",
    'bin/tool.mjs': "import { checked } from '../src/core.mjs'; process.stdout.write(String(checked(Number(process.argv[2]))));\n",
    'test/cli.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('CLI doubles', () => {
  const result = spawnSync(process.execPath, ['bin/tool.mjs', '2'], { encoding: 'utf8', timeout: 1000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, '4');
});
test('CLI rejects negative', () => {
  const result = spawnSync(process.execPath, ['bin/tool.mjs', '-1'], { encoding: 'utf8', timeout: 1000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /negative/);
});
`,
    '.code-map.json': JSON.stringify({ roots: ['bin', 'src'], testEntrypoints: { 'test/cli.test.mjs': ['bin/tool.mjs'] } }),
  };
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args]);
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  return root;
}
function run(root, args) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
}

test('declared subprocess links select real CLI tests without granting direct assertion evidence', (t) => {
  const root = fixture(t);
  const inspected = run(root, ['inspect', '--worktree', '--file', 'src/core.mjs']);
  assert.equal(inspected.status, 0, inspected.stderr);
  const report = JSON.parse(inspected.stdout);
  assert.deepEqual(report.files[0].tests.declared, ['test/cli.test.mjs']);
  assert.deepEqual(report.files[0].tests.direct, []);
  assert.deepEqual(report.tests.units[0].declaredTests, ['test/cli.test.mjs']);
  assert.equal(report.tests.units[0].failureDirect, 0);
  assert.equal(report.tests.units[0].reachability, 'declared');
  assert.equal(report.tests.cases.length, 2, 'scoped reports retain declared subprocess test inventory');
  assert.equal(report.testSummary.counts.cases, 2, 'the scoped summary includes the declared test cases');
  assert.match(report.testSummary.observations.find(item => item.key === 'noFailureAssertion').evidence[0].text, /declared subprocess/);
  const mutated = run(root, ['mutate', '--worktree', '--file', 'src/core.mjs']);
  assert.equal(mutated.status, 0, mutated.stderr);
  const mutation = JSON.parse(readFileSync(join(root, 'docs/code-map/mutation.json'), 'utf8'));
  assert.deepEqual(mutation.units[0].tests, ['test/cli.test.mjs']);
  assert.deepEqual(mutation.files['src/core.mjs'].mutants.map(item => item.status), ['detected', 'detected']);
});

test('historical snapshots ignore configured entrypoints that did not exist in that revision', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.code-map.json'), JSON.stringify({ roots: ['bin', 'src'], testEntrypoints: { 'test/cli.test.mjs': ['bin/future.mjs'] } }));
  const result = run(root, ['inspect', '--ref', 'HEAD']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).files.find(file => file.path === 'src/core.mjs').tests.declared, undefined);
});

for (const [name, mapping] of [['non-object', []], ['non-array targets', { 'test/cli.test.mjs': 'bin/tool.mjs' }],
  ['escaping path', { 'test/cli.test.mjs': ['../tool.mjs'] }], ['missing entrypoint', { 'test/cli.test.mjs': ['bin/missing.mjs'] }]]) {
  test(`rejects ${name} entrypoint mappings before executing tests`, (t) => {
    const root = fixture(t);
    writeFileSync(join(root, '.code-map.json'), JSON.stringify({ roots: ['bin', 'src'], testEntrypoints: mapping }));
    const result = run(root, ['inspect', '--worktree']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /testEntrypoints/);
  });
}
