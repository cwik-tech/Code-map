// Mutation reports are information. They do not enter the static baseline checks.
import { parseStryker } from './report.mjs';
/** Attaches validated head mutants to the execution record, or a refusal reason. */
export function mutationExecution(execution, text, run, used = { mutants: 0 }, limits = { mutants: 400000 }) {
  const parsed = parseStryker(text, { maxMutants: (limits.mutants ?? 400000) - used.mutants });
  if (!parsed.ok) execution.reasons.push({ key: 'parse', message: parsed.error });
  if (execution.side !== 'head') execution.reasons.push({ key: 'side', message: 'Mutation information needs a bound report of the head.' });
  if (run.exitStatus !== 0) execution.reasons.push({ key: 'exit-status', message: 'Mutation information needs a successful report command.' });
  if (run.discovery === null) execution.reasons.push({ key: 'discovery', message: 'Mutation information needs a discovery scope.' });
  if (!execution.reasons.length) { used.mutants += parsed.report.mutants.length; execution.eligible = true; execution.mutation = parsed.report; }
  return execution;
}
