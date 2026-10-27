// The user command receives context and cannot change stored verification results through the review API.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelOutput } from '../lib/model-review.mjs';
import { project, outcome } from './oracle-fixtures.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function fixture(t) {
  const f = project(t), { summary } = outcome(f.verify(f.request()), 3);
  const path = join(f.out, 'runs', summary.runId, 'review-hypotheses.json');
  const run = (code, extra = []) => spawnSync(process.execPath, [cli, 'review', '--run', summary.runId, '--out-dir', f.out,
    ...extra, '--model-command', process.execPath, '-e', code], { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  return { ...f, summary, path, run };
}
test('review sends run context, validates hypotheses and preserves the report and manifest', (t) => {
  const f = fixture(t), before = Object.values(f.summary.files).map((path) => readFileSync(path, 'utf8'));
  const output = f.run(`let s=''; process.stdin.on('data', x=>s+=x); process.stdin.on('end', ()=>{
    const c=JSON.parse(s); process.stdout.write(JSON.stringify({hypothesesVersion:1,model:'fixture',items:[
      {id:'risk',kind:'risk',claim:c.runId,evidenceIds:['request:intent']},
      {id:'unknown',kind:'other',claim:'A lead.',evidenceIds:['absent']}]})); });`);
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).grounded, 1);
  assert.equal(JSON.parse(output.stdout).ungrounded, 1);
  assert.equal(JSON.parse(readFileSync(f.path)).items[0].claim, f.summary.runId);
  assert.deepEqual(Object.values(f.summary.files).map((path) => readFileSync(path, 'utf8')), before);
});
for (const [name, code, extra, pattern] of [
  ['invalid JSON', `process.stdout.write('invalid')`, [], /JSON/],
  ['invalid schema', `process.stdout.write('{}')`, [], /hypothesesVersion/],
  ['timeout', 'setInterval(()=>{},1000)', ['--wall-clock-seconds', '1'], /time limit/],
  ['output limit', `process.stdout.write('x'.repeat(262145))`, [], /output limit/],
  ['stderr limit', `process.stderr.write('x'.repeat(262145))`, [], /output limit/],
  ['failed command', 'process.exit(9)', [], /exit/],
]) test(`review rejects ${name} without a hypotheses file`, (t) => {
  const f = fixture(t), output = f.run(code, extra);
  assert.equal(output.status, 1, output.stderr);
  assert.match(output.stderr, pattern);
  assert.equal(existsSync(f.path), false);
});
test('a failed later review preserves the last validated hypotheses file', (t) => {
  const f = fixture(t), valid = { hypothesesVersion: 1, model: 'fixture', items: [] };
  const first = f.run(`process.stdout.write(${JSON.stringify(JSON.stringify(valid))})`);
  assert.equal(first.status, 0, first.stderr);
  const before = readFileSync(f.path, 'utf8'), invalid = f.run(`process.stdout.write('{}')`);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(readFileSync(f.path, 'utf8'), before);
});
test('stdout and stderr share one output budget', (t) => {
  const f = fixture(t), output = f.run(`process.stdout.write('x'.repeat(140000)); process.stderr.write('x'.repeat(140000));`);
  assert.equal(output.status, 1, output.stderr);
  assert.match(output.stderr, /output limit/);
  assert.equal(existsSync(f.path), false);
});

test('aborting review settles when a detached descendant keeps the output pipe open', { timeout: 5000 }, async (t) => {
  const f = project(t), path = join(f.work, 'descendant.pid'), controller = new AbortController();
  const watcher = watch(f.work, { persistent: false });
  let descendant;
  t.after(() => {
    watcher.close();
    if (descendant) {
      try { process.kill(-descendant, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  });
  const started = new Promise((resolve) => watcher.on('change', (event, name) => {
    if (name === 'descendant.pid') { descendant = Number(readFileSync(path, 'utf8')); resolve(); }
  }));
  const code = `const {spawn}=require('node:child_process'),fs=require('node:fs');
    const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','inherit','inherit']});
    fs.writeFileSync(process.argv[1]+'.tmp',String(c.pid)); fs.renameSync(process.argv[1]+'.tmp',process.argv[1]); c.unref(); process.exit(0);`;
  const output = modelOutput([process.execPath, '-e', code, path], {}, { cwd: f.root, milliseconds: 10000, signal: controller.signal });
  const rejected = assert.rejects(output, /aborted/);
  await started;
  controller.abort();
  await rejected;
});
