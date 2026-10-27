// Informational contract evidence. No rating rule consumes this report.
import { compareContracts } from './compare.mjs';
/** Label new diagnostics only when both revisions provide complete example type evidence. */
export function comparedExamples(base, head, comparable) {
  if (!head) return null;
  const known = comparable && base?.typeState === 'COMPLETE' && head.typeState === 'COMPLETE'
    && !(base.gaps?.length || head.gaps?.length);
  const key = (item) => JSON.stringify([item.path, item.block, item.kind, item.code, item.message, item.name]);
  const previous = new Set((base?.issues ?? []).map(key));
  return { ...head, issues: head.issues.map((item) => ({ ...item, status: known ? previous.has(key(item)) ? 'EXISTING' : 'NEW' : 'UNKNOWN' })) };
}
/** Read snapshot evidence and classify schema changes only for comparable analyses. */
export function contractInformation(base, head, comparable = true) {
  const old = base?.frameworks?.protocols, current = head?.frameworks?.protocols;
  if (!(old?.documents.length || current?.documents.length || head?.frameworks?.deployment?.documents.length
    || head?.examples?.blocks || head?.examples?.issues.length || head?.examples?.gaps.length)) return null;
  return { policy: 'information-only', state: comparable && old && current ? 'COMPARABLE' : 'UNKNOWN',
    changes: comparable && old && current ? compareContracts(old.documents, current.documents) : [],
    protocols: current ?? null, deployment: head?.frameworks?.deployment ?? null, examples: comparedExamples(base?.examples, head?.examples, comparable) };
}
/** Paged project lists for supported contracts and documentation examples. */
export function contractParts(analysis, comparison = null) {
  const changes = comparison ? contractInformation(comparison.base.data.analysis, analysis, comparison.result.state === 'COMPARABLE')?.changes ?? [] : [];
  return { 'protocols.documents': analysis.frameworks?.protocols?.documents ?? [],
    'protocols.changes': changes,
    'deployment.documents': analysis.frameworks?.deployment?.documents ?? [],
    'deployment.missingReads': analysis.frameworks?.deployment?.missingReads ?? [],
    'deployment.missingTemplates': analysis.frameworks?.deployment?.missingTemplates ?? [],
    'deployment.unused': analysis.frameworks?.deployment?.unused ?? [],
    'examples.issues': (comparison ? comparedExamples(comparison.base.data.analysis.examples, analysis.examples, comparison.result.state === 'COMPARABLE') : analysis.examples)?.issues ?? [], 'examples.gaps': analysis.examples?.gaps ?? [] };
}
/** Compact inspection summary, with a complete paged list for each evidence kind. */
export function contractSummary(analysis, context) {
  const next = (part) => context.command(['inspect', '--analysis', context.id, ...(context.comparison ? ['--base-analysis', context.comparison.base.id] : []), '--part', part]);
  const info = context.comparison ? contractInformation(context.comparison.base.data.analysis, analysis, context.comparison.result.state === 'COMPARABLE') : null;
  return { ...(analysis.frameworks?.protocols?.documents.length || info?.changes.length ? { protocols: { documents: analysis.frameworks?.protocols?.documents?.length ?? 0, next: next('protocols.documents'),
    ...(info ? { changes: { state: info.state, total: info.changes.length, items: info.changes.slice(0, 20), next: next('protocols.changes') } } : {}) } } : {}),
    ...(analysis.frameworks?.deployment?.documents.length ? { deployment: { documents: analysis.frameworks?.deployment?.documents?.length ?? 0, next: next('deployment.documents') } } : {}),
    ...(analysis.examples?.blocks || analysis.examples?.issues.length || analysis.examples?.gaps.length ? { examples: { blocks: analysis.examples?.blocks ?? 0, checked: analysis.examples?.checked ?? 0, skipped: analysis.examples?.skipped ?? 0, typeState: analysis.examples?.typeState ?? 'UNKNOWN', issues: analysis.examples?.issues?.length ?? 0, next: next('examples.issues') } } : {}) };
}
