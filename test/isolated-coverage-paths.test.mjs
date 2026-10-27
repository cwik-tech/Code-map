import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReports } from '../lib/verify-reports.mjs';
import { repositoryDigest } from '../lib/worker/authorize.mjs';
import { artifactFiles, runManifest, stageRun } from '../lib/worker/runs.mjs';

const lcov = (paths) => paths.map(path => `SF:${path}\nDA:1,1\nend_of_record\n`).join('');
const istanbul = (paths) => JSON.stringify(Object.fromEntries(paths.map(path => [path, {
  path, statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } } },
  s: { 0: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {},
}])));

// Real stored-file ingestion with producer-format fixtures; this does not claim a worker executed the counters.
function storedCoverage(t, kind, format) {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'code-map-coverage-paths-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const repository = join(folder, 'repository'), store = join(folder, 'store');
  mkdirSync(repository);
  const runId = 'R-20261027T000000Z-0123abcd', tree = join(store, 'workspaces', runId, 'tree');
  mkdirSync(join(tree, 'src'), { recursive: true });
  writeFileSync(join(tree, 'src/absolute.mjs'), 'export const a = 1;\n');
  const bytes = Buffer.from(format([join(tree, 'src/absolute.mjs'), 'src/relative.mjs', join(folder, 'external.mjs')]));
  const inputs = { sha: 'a'.repeat(40), config: 'b'.repeat(64), lockfile: null, worktree: null };
  const artifact = { path: artifactFiles[kind], file: artifactFiles[kind], kind,
    digest: createHash('sha256').update(bytes).digest('hex') };
  const manifest = runManifest({ inputs, command: ['node', '--test'], startedAt: '2026-10-27T00:00:00Z',
    finishedAt: '2026-10-27T00:00:01Z', exitStatus: 0, artifact, backend: 'seatbelt', filters: [] });
  const stage = stageRun(store, runId);
  stage.put('run.json', JSON.stringify({ recordType: 'code-map-run-record', schemaVersion: 1, runId,
    repository: { digest: repositoryDigest(repository) }, policy: 'isolated', backend: { name: 'seatbelt' }, workspace: { tree }, artifact }));
  stage.put('manifest.json', JSON.stringify(manifest));
  stage.put(artifact.file, bytes);
  stage.close(); stage.publish();
  // Normal worker cleanup removes the workspace before the saved report is imported.
  rmSync(tree, { recursive: true });
  const side = { inputs, sha: inputs.sha, analysis: { tests: { testFiles: [] } } };
  return { load: (which) => loadReports(repository, [{ run: runId, side: which }], { head: side, base: side }, undefined, store, { extended: true }) };
}

for (const [kind, format] of [['lcov', lcov], ['istanbul-json', istanbul]]) {
  for (const side of ['head', 'base']) {
    test(`${kind} ${side} coverage preserves isolated paths after workspace cleanup and rejects external paths`, (t) => {
      const loaded = storedCoverage(t, kind, format).load(side);
      const measured = (side === 'head' ? loaded.coverage : loaded.baseCoverage)[0];
      assert.equal(loaded.executions[0].binding, 'BOUND');
      assert.ok(measured, 'a bound coverage report is retained');
      assert.deepEqual([...measured.files.keys()].sort(), ['src/absolute.mjs', 'src/relative.mjs']);
      assert.deepEqual([...measured.ratingFiles.keys()].sort(), ['src/absolute.mjs', 'src/relative.mjs']);
      assert.equal(measured.outside, 1, 'only the file outside the originating workspace is excluded');
    });
  }
}
