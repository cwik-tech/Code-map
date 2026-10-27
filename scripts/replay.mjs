#!/usr/bin/env node
// Measures static verification results for local fix commits. Runs no project code.
import { replayLabels } from '../calibration/real-labels.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) options.set(args[i], args[i + 1]);
if (args.includes('--labels')) {
  if (args.length !== 2 || args[0] !== '--labels' || !args[1]) {
    process.stderr.write('Usage: node scripts/replay.mjs --labels <folder>\n'); process.exit(2);
  }
  try {
    const report = replayLabels(resolve(args[1]));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(report.cases.some((x) => x.mismatches.length) ? 1 : 0);
  } catch (error) { process.stderr.write(`replay: ${error.message}\n`); process.exit(1); }
}
const repo = options.get('--repo'), limit = options.get('--limit');
if (args.length !== 4 || options.size !== 2 || !repo || !/^[1-9]\d*$/.test(limit ?? '') || !Number.isSafeInteger(Number(limit))) {
  process.stderr.write('Usage: node scripts/replay.mjs --repo <path> --limit <n>\n');
  process.exit(2);
}
const root = resolve(repo), cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const git = (...parts) => execFileSync('git', ['--no-optional-locks', '-C', root, ...parts], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
let work;
try {
  const before = git('status', '--porcelain');
  work = mkdtempSync(join(tmpdir(), 'code-map-replay-'));
  try {
    // Git selects subjects only. The root commit has no parent and cannot define a change.
    const history = git('log', '--format=%H%x09%P%x09%s').trim().split('\n');
    const selected = history.map((row) => row.split('\t')).filter(([, parents, subject]) => parents && /^fix/i.test(subject ?? '')).slice(0, Number(limit));
    process.stdout.write('commit\treadiness\tfailed checks\tunknown checks\ttime\n');
    for (const [head, parents] of selected) {
      const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: parents.split(' ')[0], head,
        intent: 'Replay a historical fix with static evidence.', acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'fix',
        profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
        execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
      const requestPath = join(work, 'request.json');
      writeFileSync(requestPath, JSON.stringify(request));
      const started = performance.now();
      const run = spawnSync(process.execPath, [cli, 'verify', '--request', requestPath, '--store', join(work, 'store'), '--out-dir', join(work, 'out')],
        { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
      if (![0, 1, 2, 3].includes(run.status)) throw new Error(`Verification of ${head} failed: ${run.error?.message ?? run.stderr}`);
      const summary = JSON.parse(run.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
      if (typeof summary.readiness !== 'string' || !Array.isArray(results.obligations)
        || !results.obligations.every((item) => typeof item?.id === 'string' && typeof item.result === 'string')) throw new Error('Invalid verification output.');
      const ids = (state) => results.obligations.filter((item) => item.result === state).map((item) => item.id).join(',') || '-';
      process.stdout.write(`${head}\t${summary.readiness}\t${ids('FAIL')}\t${ids('UNKNOWN')}\t${((performance.now() - started) / 1000).toFixed(3)} s\n`);
    }
  } finally {
    if (git('status', '--porcelain') !== before) throw new Error('Repository status changed during replay.');
  }
} catch (error) {
  process.stderr.write(`replay: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
