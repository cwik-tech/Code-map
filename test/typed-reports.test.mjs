import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildManifest } from '../lib/manifest.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { analysisInputs } from '../lib/inputs.mjs';
import { defaults } from '../lib/project.mjs';

for (const [label, fields, accepted] of [
  ['successful unfiltered', {}, true],
  ['filtered', { discovery: { scope: 'one file', filters: ['src/a.ts'] } }, false],
  ['failed', { exitStatus: 1 }, false],
  ['stale', { config: '0'.repeat(64) }, false],
]) test(`a ${label} bound tsc-files report is ${accepted ? 'accepted' : 'refused'} as discovery information`, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'typed-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
  git('add', '.'); git('commit', '-qm', 'base');
  writeFileSync(join(root, 'files.txt'), `${join(root, 'a.ts')}\n`);
  const manifest = buildManifest(root, defaults, { artifact: 'files.txt', kind: 'tsc-files', exitStatus: '0', command: ['tsc', '--listFilesOnly'] });
  const value = { ...manifest, source: { ...manifest.source, worktreeDigest: null }, ...fields };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(value));
  const inputs = analysisInputs(root, defaults, { ref: 'HEAD' }, 'HEAD');
  const side = { inputs, sha: inputs.sha, analysis: { files: [] } };
  const result = loadReports(root, [{ artifact: 'files.txt', manifest: 'manifest.json' }], { head: side, base: side });
  assert.equal(result.executions[0].eligible, accepted);
  assert.equal(result.compilerFiles.head.length, accepted ? 1 : 0);
  assert.deepEqual(result.compiler.head, []);
  assert.deepEqual(result.reports.head, []);
});

test('file discovery never counts an absolute path that normalizes outside the repository', async () => {
  const { parseTscFiles } = await import('../lib/types/discovery.mjs');
  const parsed = parseTscFiles('/repo/../outside.ts\n', { repository: '/repo' });
  assert.deepEqual(parsed.files, []);
});
