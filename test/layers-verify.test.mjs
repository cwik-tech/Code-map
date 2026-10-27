// `code-map verify` with layers and no "rules": the layer rules count as declared rules, so the architecture-rule check
// (structure.architecture-rules) applies, and a new layer break blocks. The rule set static-baseline-v0 does not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Change the engine.', acceptanceCriteria: [],
  allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
const twoLayers = [{ name: 'ui', paths: ['src/ui/**'] }, { name: 'core', paths: ['src/core/**'] }];

/** A committed project with the layers and the head change, and the architecture-rule check of its verification. */
function verifyWith(t, layers, head) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-layers-verify-')), work = mkdtempSync(join(tmpdir(), 'code-map-layers-verify-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  put('.code-map.json', JSON.stringify({ layers }));
  put('src/core/engine.ts', 'export function engine() { return 1; }\n');
  put('src/ui/view.ts', "export function view() { return 'v'; }\n");
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\ntest('engine returns one', () => { expect(engine()).toBe(1); });\n");
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  for (const [path, text] of Object.entries(head)) put(path, text);
  git('add', '.'); git('commit', '-qm', 'head');
  writeFileSync(join(work, 'request.json'), JSON.stringify(request));
  const output = spawnSync(process.execPath, [cli, 'verify', '--request', join(work, 'request.json'), '--store', join(work, 'store'), '--out-dir', join(work, 'out')],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  return { status: output.status, summary, check: results.obligations.find((item) => item.id === 'structure.architecture-rules') };
}

test('verify with layers only: a new import from a lower layer to a higher layer fails the architecture-rule check and blocks', (t) => {
  const { status, summary, check } = verifyWith(t, twoLayers, { 'src/core/engine.ts': "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n" });
  assert.deepEqual([status, summary.readiness], [2, 'BLOCKED']);
  assert.ok(summary.blocking.includes('structure.architecture-rules'), JSON.stringify(summary.blocking));
  assert.equal(check.result, 'FAIL');
  assert.match(check.rationale, /NEW ARCH-RULE finding/);
});

test('verify with layers only: an import from a higher layer to a lower layer passes, under the layer rule as a declared rule', (t) => {
  const { status, check } = verifyWith(t, twoLayers, { 'src/ui/view.ts': "import { engine } from '../core/engine';\nexport function view() { return String(engine()); }\n" });
  assert.equal(status, 3);
  assert.deepEqual([check.applicability, check.result], ['APPLICABLE', 'PASS']);
  assert.match(check.rationale, /under 1 declared rule/);
});

test('verify with one layer only: no pair of layers gives a rule, so the architecture-rule check is NOT_APPLICABLE', (t) => {
  const { check } = verifyWith(t, [{ name: 'all', paths: ['src/**'] }], { 'src/core/engine.ts': "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n" });
  assert.equal(check.result, 'NOT_APPLICABLE');
});
