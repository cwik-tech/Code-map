// Verification reads both selected revisions. Rollout leads stay outside the rating rules.
import { readHead } from '../impact/head-files.mjs';
import { isCode, isTest, ignored } from '../project.mjs';
import { hasSchemas } from './compare.mjs';
import { schemaRollout } from './rollout.mjs';
/** Returns information, or UNKNOWN when the snapshots cannot be compared. */
export function rolloutInformation(base, head, comparison, complete) {
  if (!hasSchemas(base.data.schemas) && !hasSchemas(head.data.schemas)) return undefined;
  if (comparison.result.state !== 'COMPARABLE') return { state: 'UNKNOWN', informationOnly: true, leads: [], reason: 'The snapshots are not comparable.' };
  const wanted = (path) => isCode(path) && !isTest(path) && !ignored(path);
  const before = readHead(base, wanted), after = readHead(head, wanted);
  const result = schemaRollout(base.data.schemas, head.data.schemas, before.texts, after.texts, comparison.renames, complete);
  if (after.skipped) for (const lead of result.leads) if (lead.kind === 'one-step-contract') {
    lead.kind = 'UNKNOWN'; lead.note = 'Skipped head files prevent a consumer-removal conclusion.';
  }
  return { ...result, skipped: { base: before.skipped, head: after.skipped } };
}
