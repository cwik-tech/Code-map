// Runs compiler analysis with a hard wall-clock budget. A stopped worker contributes no partial facts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const unknown = (reason) => ({ state: 'UNKNOWN', reason, programs: [], exports: {}, calls: [], references: [] });
/** Snapshot texts only. The worker never reads project files or runs project code. */
export function typedFacts(texts, { budgetMs = 60000 } = {}) {
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 120000) throw new Error('typeBudgetMs must be from 1 to 120000.');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url))], {
    input: JSON.stringify([...texts]), encoding: 'utf8', timeout: budgetMs, maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error?.code === 'ETIMEDOUT') return unknown('budget');
  if (run.status !== 0) return unknown('compiler-worker');
  try {
    const value = JSON.parse(run.stdout);
    if (!value || !['COMPLETE', 'UNKNOWN'].includes(value.state) || !Array.isArray(value.programs)
      || !value.exports || !Array.isArray(value.calls) || !Array.isArray(value.references)) return unknown('invalid-worker-result');
    return value;
  } catch { return unknown('invalid-worker-result'); }
}
