// Four independent band comparisons. Band distances have no arithmetic meaning.
import { names } from './verify-words.mjs';
import { plain, table } from './verify-markdown.mjs';

/** Shows comparison reasons and each category without combining ratings. */
export function comparisonLines(comparison) {
  if (!comparison) return [];
  return ['## Category band comparison', '',
    `Baseline run: [${plain(comparison.baselineRunId)}](../${comparison.baselineRunId}/verification-report.md). State: ${plain(comparison.state)}.`, '',
    ...comparison.reasons.map((reason) => `- ${plain(reason)}`),
    ...table(['Category', 'Base band', 'Head band', 'Comparison'], Object.entries(comparison.categories).map(([id, item]) =>
      [names[id], item.base === null ? 'Unassessed' : String(item.base), item.head === null ? 'Unassessed' : String(item.head),
        item.state === 'COMPARED' ? item.direction : `UNKNOWN. ${plain(item.reason)}`])), '',
    'Band directions are ordinal. No total, average or numeric distance applies.', ''];
}
