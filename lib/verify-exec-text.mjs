// Bounded human-readable worker records and informational test validation.
import { plain, table } from './verify-markdown.mjs';
/** Information only. The fixed rule set does not read copied-test outcomes. */
export function executionLines(results) {
  if (!results.executionRuns) return [];
  const runs = results.executionRuns, tests = results.testValidation ?? [];
  return ['## Authorized execution', '',
    ...table(['Command', 'Snapshot', 'Result', 'Dependencies', 'Reason'], runs.slice(0, 5).map((run) => [plain(run.commandId), `${run.side}${run.copiedTests ? ' with head tests' : ''}`,
      plain(run.status), run.dependencies ? plain(`${run.dependencies.mode}: ${run.dependencies.prepared ? 'prepared' : 'preparation not established'}`) : 'Unknown', plain(run.reasons.join(' ')) || 'The command ended within its budgets.'])), '',
    ...(tests.length ? [results.profileId === 'evidence-v1' ? 'Isolated copied-test outcomes can close fix checks. Failure sensitivity does not confirm oracle correctness.' : 'Copied-test results are information only. Fix checks stay UNKNOWN. Confirmation measures failure sensitivity, not oracle correctness.', '',
      ...table(['Test', 'Base', 'Head', 'Evidence'], tests.slice(0, 5).map((item) => [plain(`${item.type}: ${item.file}${item.name ? `: ${item.name}` : ''}`),
        item.base.status, item.head.status, plain(`${item.confirmed ? 'Confirmed. ' : ''}${item.reason}`)])), ''] : []),
    ...(runs.length > 5 || tests.length > 5 ? ['The JSON results contain all execution records and copied-test outcomes.', ''] : [])];
}

/** A bounded view of informational oracle links. JSON retains every declaration and case. */
export function generatedOracleLines(results, limit = 3) {
  const items = results.generatedTestOracles ?? [];
  if (!items.length) return [];
  return ['## Generated test oracles', '',
    'Current human records are required for independence. These links change no check, rating or readiness.', '',
    ...table(['Test', 'Independent oracle', 'Cases'], items.slice(0, Math.min(3, limit)).map((item) => [plain(`${item.file}${item.name ? `: ${item.name}` : ''}`),
      item.independent ? 'Yes' : 'No', plain(item.cases.map((x) => `${x.name}: ${x.state}`).join(', ') || item.state)])),
    'Full case records, people and digests are in generatedTestOracles in the JSON results.', ''];
}

/** Generated mutation links never alter obligations or ratings. */
export function generatedMutationLines(results) {
  const items = results.generatedTestMutations ?? [];
  if (!items.length) return [];
  return ['## Generated test mutation', '', 'File-scoped sensitivity is information under both rule sets.', '',
    ...table(['Test', 'Compilation', 'Type check', 'Head / base', 'Failure-sensitive', 'Oracle', 'Mutants run / killed', 'Supports', 'Reason'], items.slice(0, 5).map((item) => [plain(`${item.file}${item.name ? `: ${item.name}` : ''}`),
      plain(`${item.compilation?.status ?? 'unavailable'}${item.compilation?.diagnostics?.length ? ': ' + item.compilation.diagnostics.slice(0, 2).map((x) => `TS${x.code} ${x.file ?? ''}:${x.line ?? ''} ${x.message}`).join(' | ') : ''}`),
      plain(`${item.typeCheck?.status ?? 'unavailable'}${item.typeCheck?.reason ? ': ' + item.typeCheck.reason : ''}${item.typeCheck?.diagnostics?.length ? ': ' + item.typeCheck.diagnostics.slice(0, 2).map((x) => `TS${x.code} ${x.file ?? ''}:${x.line ?? ''} ${x.message}`).join(' | ') : ''}`),
      `${item.head.status} / ${item.base.status}`, item.failureSensitive ? 'Yes' : 'No', plain(item.oracle?.state ?? 'UNCONFIRMED'),
      `${item.mutants.filter((x) => x.run !== null).length} / ${item.mutants.filter((x) => x.status === 'Killed').length}`,
      plain(item.supports.join(', ')), plain(item.reason)])),
    'The JSON generatedTestMutations field retains every run, mutant location and oracle link.', ''];
}
