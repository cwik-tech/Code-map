// A stored trace is compared only after its manifest, signature and snapshot binding pass.
import { createHash } from 'node:crypto';
import { validateManifest, bindingStatus } from '../adapters/run-manifest.mjs';
import { loadRun } from '../worker/runs.mjs';
import { machineKey, signatureStatus } from '../worker/signing.mjs';
import { traceInformation } from './trace-report.mjs';

/** Adds an informational trace view to a selected inspection snapshot. */
export function inspectTrace(repository, config, root, runId, stored) {
  const { record, manifest, bytes } = loadRun(root, runId, repository);
  const checked = validateManifest(manifest), digest = createHash('sha256').update(bytes).digest('hex');
  if (!checked.ok || record.artifact.kind !== 'xstate-trace' || record.artifact.digest !== digest) throw new Error('The run has no valid XState trace artifact.');
  const local = machineKey(root, { create: false });
  const signature = signatureStatus(manifest, [...(local ? [local.publicKey] : []), ...(config.trustedRunKeys ?? [])]);
  if (signature.state === 'invalid') throw new Error('The trace manifest signature is invalid.');
  if (!manifest.artifacts.some((item) => item.kind === 'xstate-trace' && item.path === record.artifact.path && item.digest === digest)) throw new Error('The manifest does not name the trace artifact.');
  const binding = bindingStatus(manifest, stored.inputs, { artifactDigest: digest });
  return { run: runId, binding: binding.state, reasons: binding.reasons, signature,
    information: binding.state === 'BOUND' ? traceInformation(bytes.toString('utf8'), stored.data.analysis.models?.states ?? []) : null };
}
