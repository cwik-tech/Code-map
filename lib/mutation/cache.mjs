// Revision-keyed mutation results. A cache hit validates the stored artifact and its binding.
import { machineKey, signatureStatus } from '../worker/signing.mjs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { bindingStatus } from '../adapters/run-manifest.mjs';
import { readPrivateFile, storeFolder, writePrivateFile } from '../store.mjs';
import { loadRun } from '../worker/runs.mjs';
import { parseStryker, summarizeMutation } from './report.mjs';
/** Returns a complete, digest-checked run only. Damaged cache entries fail closed. */
export function cachedMutation(root, key, repository, inputs) {
  const bytes = readPrivateFile(join(storeFolder(root, 'mutations'), `${key}.json`), 1024);
  if (bytes === null) return null;
  const entry = JSON.parse(bytes.toString('utf8'));
  const stored = loadRun(root, entry?.runId, repository);
  const local = machineKey(root, { create: false });
  if (signatureStatus(stored.manifest, local ? [local.publicKey] : []).state === 'invalid') throw new Error('The mutation cache manifest signature is invalid.');
  const digest = createHash('sha256').update(stored.bytes).digest('hex');
  const parsed = parseStryker(stored.bytes.toString('utf8'));
  const value = JSON.parse(stored.bytes.toString('utf8'));
  if (!parsed.ok || value.cacheKey !== key || digest !== stored.record.artifact.digest
    || bindingStatus(stored.manifest, inputs, { artifactDigest: digest }).state !== 'BOUND') throw new Error('The mutation cache is stale or damaged.');
  return { reportType: 'code-map-mutation-summary', generator: value.generator ?? 'Stryker', runId: entry.runId, seed: value.seed, candidates: value.candidates,
    selected: parsed.report.mutants.length, counts: summarizeMutation(parsed.report).counts, cached: true, ...(value.selection ? { selection: value.selection } : {}),
    files: { artifact: join(root, 'runs', entry.runId, 'report.json'), manifest: join(root, 'runs', entry.runId, 'manifest.json') } };
}
/** Publishes the cache pointer only after the complete run exists. */
export function cacheMutation(root, key, runId) {
  writePrivateFile(join(storeFolder(root, 'mutations'), `${key}.json`), JSON.stringify({ runId }));
}
