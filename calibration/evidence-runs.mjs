// Extra bound evidence for v1 calibration fixtures. Authorizations apply only to these temporary test repositories.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest } from '../lib/manifest.mjs';
import { loadConfig } from '../lib/project.mjs';
import { newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { runCommand } from '../lib/worker/run.mjs';
import { oracleDigest, writeOracles } from '../lib/oracles.mjs';
export const sandboxAvailable = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
/** Writes fixture-authored test evidence with an explicit test-only reviewer name. */
export function fixtureOracle(root, item) {
  if (!item.oracle) return;
  writeOracles(root, [{ ...item.oracle, digest: oracleDigest(readFileSync(join(root, item.oracle.file))), method: 'Calibration fixture only.', confirmedBy: 'Fixture reviewer', date: '2026-10-23' }], null);
}
/** Runs authorized fixture commands or writes the declared external report at one snapshot. */
export async function extraEvidence(root, item, side, store, budgets) {
  const config = loadConfig(root), inputs = [];
  mkdirSync(join(root, 'reports'), { recursive: true });
  for (const report of (item.evidenceReports ?? []).filter((x) => x.side === side)) {
    const artifact = `reports/${report.name}.txt`, manifest = `reports/${report.name}.manifest.json`;
    writeFileSync(join(root, artifact), report.content);
    // Harness is an internal kind. The fixture manifest uses the same versioned schema.
    const value = buildManifest(root, config, { artifact, kind: report.kind === 'harness' ? 'junit' : report.kind,
      exitStatus: String(report.exitStatus), command: ['fixture-report'], filters: [] });
    value.source.worktreeDigest = null;
    value.artifacts[0].kind = report.kind;
    writeFileSync(join(root, manifest), JSON.stringify(value));
    inputs.push({ artifact, manifest });
  }
  for (const report of (item.workerReports ?? []).filter((x) => x.side === side)) {
    const authorization = newAuthorization({ repository: root, command: report.words, budgets, expiresDays: 1, now: new Date() });
    saveAuthorization(store, authorization);
    const result = await runCommand(root, config, { command: report.words, head: side === 'base' ? 'base' : 'tip', kind: report.kind,
      artifact: report.artifact, authorization: authorization.id, budgets, store });
    if (result.exitCode !== 0) throw new Error(`Fixture worker failed: ${result.record.problems.join(' ')}`);
    inputs.push({ run: result.record.runId });
  }
  return inputs;
}
