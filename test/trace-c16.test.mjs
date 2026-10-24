import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed, sha256 } from './worker-fixtures.mjs';
import { stable } from '../lib/harness/normalize.mjs';
import { comparable } from '../lib/harness/effects.mjs';
const subject = { file: 'subject.mjs', export: 'subject' };
async function execute(f, spec) {
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand),
    spec: { harnessVersion: 1, subject, callTimeoutMs: 1000, ...spec }, store: f.store },
    { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
}

test('differential detects returned values file contents and rejection differences separately and replays shared inputs', sandboxed, async (t) => {
  const f = project(t);
  const source = phase => `import { writeFileSync, readFileSync } from 'node:fs';
export function subject(input) {
  let denied; try { readFileSync(${JSON.stringify(f.home + '/.ssh/id_rsa')}); denied = false; } catch (e) { denied = e.code; }
  if (input === 'log') { console.log('${phase}'); console.error('${phase}'); }
  if (input === 'file') writeFileSync('value.txt', '${phase}');
  if (input === 'rejection') Promise.reject(new Error('${phase}'));
  return { value: input === 'output' ? '${phase}' : input, denied };
}`;
  const corpus = '["output","file","rejection","log"]\n';
  f.put('subject.mjs', source('base')); f.put('inputs.json', corpus);
  f.git('add', '.'); f.git('commit', '-qm', 'base harness');
  const base = f.git('rev-parse', 'HEAD');
  f.put('subject.mjs', source('head')); f.git('add', '.'); f.git('commit', '-qm', 'head harness');
  const spec = { mode: 'differential', base, inputs: 'inputs.json' };
  const report = await execute(f, spec), replay = await execute(f, spec);
  assert.equal(report.inputDigest, sha256(corpus));
  assert.equal(report.base.sha, base);
  assert.deepEqual(report.calls.map(({ input, side }) => [input, side]), [
    ['output', 'base'], ['output', 'head'], ['file', 'base'], ['file', 'head'], ['rejection', 'base'], ['rejection', 'head'], ['log', 'base'], ['log', 'head'],
  ]);
  assert.deepEqual(report.failures.map(({ input, kind }) => [input, kind]), [['output', 'difference'], ['file', 'difference'], ['rejection', 'difference'], ['log', 'difference']]);
  assert.deepEqual(report.failures[0].base.output, stable({ value: 'base', denied: 'EPERM' }));
  assert.deepEqual(report.failures[0].head.output, stable({ value: 'head', denied: 'EPERM' }));
  assert.equal(report.failures[1].base.effects.files[0].after.digest, sha256('base'));
  assert.equal(report.failures[1].head.effects.files[0].after.digest, sha256('head'));
  assert.deepEqual(report.failures[2].base.effects.rejections, [{ name: 'Error', message: 'base' }]);
  assert.deepEqual(report.failures[2].head.effects.rejections, [{ name: 'Error', message: 'head' }]);
  assert.equal(report.failures[3].base.effects.stdout, 'base\n');
  assert.equal(report.failures[3].head.effects.stdout, 'head\n');
  assert.equal(report.failures[3].base.effects.stderr, 'base\n');
  assert.equal(report.failures[3].head.effects.stderr, 'head\n');
  assert.deepEqual(replay.calls.map(c => [c.input, c.side, comparable(c.result)]), report.calls.map(c => [c.input, c.side, comparable(c.result)]));
  assert.equal(replay.inputDigest, report.inputDigest);
});

test('declared timestamp id and nonce fields normalize recursively while undeclared differences remain visible', () => {
  const base = { timestamp: '2020-01-01T00:00:00Z', id: 'a', child: { nonce: 1, value: 7 } };
  const head = { timestamp: '2026-01-01T00:00:00Z', id: 'b', child: { nonce: 2, value: 7 } };
  assert.notDeepEqual(stable(base), stable(head));
  assert.deepEqual(stable(base, ['timestamp', 'id', 'nonce']), stable(head, ['timestamp', 'id', 'nonce']));
  assert.deepEqual(stable(base, ['timestamp', 'id', 'nonce']), { $type: 'object', value: { child: { $type: 'object', value: { value: 7 } } } });
  assert.notDeepEqual(stable(base, ['id', 'nonce']), stable(head, ['id', 'nonce']));
});
