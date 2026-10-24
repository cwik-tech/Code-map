#!/usr/bin/env node
// scripts/calibrate.mjs: replays every case of the calibration corpus, one at a time, and prints the state and the time of each
// case and, for each check, the true and false positives and negatives, precision and recall. `--out <file>` also writes the
// same data as JSON. The exit code is 1 when a case differs from its expected results without a knownFailure mark.
// Run it with `node scripts/calibrate.mjs`. It writes only below the system temporary folder and to the --out file.
import { writeFileSync } from 'node:fs';
import { cases } from '../calibration/cases.mjs';
import { caseState, formatReport, removeTemporaryFolders, runCorpus } from '../calibration/run.mjs';

const outIndex = process.argv.indexOf('--out'), out = outIndex >= 0 ? process.argv[outIndex + 1] : null;
if (outIndex >= 0 && (!out || out.startsWith('--'))) {
  process.stderr.write('Usage: node scripts/calibrate.mjs [--out <file.json>]\n');
  process.exit(2);
}
// The cases remove their folders when they end. A signal stops them first, so remove what is left.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { removeTemporaryFolders(); process.exit(130); });

const run = await runCorpus(cases);
process.stdout.write(formatReport(run));
if (out) {
  const json = { bandMetrics: run.bandMetrics, metrics: run.metrics, metricsByProfile: run.metricsByProfile, totalDurationMs: run.totalDurationMs,
    cases: run.results.map((result) => ({ id: result.id, profileId: result.profileId, skipped: result.skipped ?? null, name: result.name, defect: result.defect, knownFailure: result.knownFailure, state: caseState(result),
      expected: result.expected, readiness: result.readiness, checks: result.checks, ratings: result.ratings ?? null, mismatches: result.mismatches, durationMs: result.durationMs, error: result.error })) };
  writeFileSync(out, JSON.stringify(json, null, 2) + '\n');
  process.stdout.write(`Wrote ${out}\n`);
}
process.exitCode = run.results.some((result) => ['MISMATCH', 'ERROR'].includes(caseState(result))) ? 1 : 0;
