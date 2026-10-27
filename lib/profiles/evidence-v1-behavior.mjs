// Behavioral checks of the evidence-v1 rule set. All inputs are bound evidence.
import { canonical } from '../inputs.mjs';
const failed = (x) => ['failed', 'errored'].includes(x.status);
const key = (x) => JSON.stringify([x.file ?? x.path, x.suite ?? '', x.name]);
const sameRun = (a, b) => a.comparisonEligible !== false && b.comparisonEligible !== false && a.kind === b.kind && canonical(a.run) === canonical(b.run);
const isolated = (x) => x.attestation === 'isolated';
const movesOf = (context) => new Map(context.change.files.filter((x) => x.status === 'R' && x.from).map((x) => [x.from, x.path]));
const movedCase = (x, moves) => ({ ...x, file: moves.get(x.file ?? x.path) ?? x.file ?? x.path });
/** Current oracle records match the whole case identity and its criterion. */
export const confirms = (record, item, criterion = record.criterion) => !record.stale && record.criterion === criterion
  && record.file === item.file && record.suite === (item.suite ?? null) && record.name === item.name;
/** Isolated base/head pairs with the same command, tools and environment. */
export function referencePairs(context) {
  return context.reports.head.filter(isolated).flatMap((head) => context.reports.base.filter((base) => isolated(base) && sameRun(head, base)).map((base) => ({ head, base })));
}
/** Failure precedes missing evidence. A differential run must compare the requested base. */
export function preserved(context) {
  const e = context.evidence, pairs = referencePairs(context), moves = movesOf(context);
  const oldKey = (x) => key(movedCase(x, moves));
  const differential = e.harness.filter((x) => x.mode === 'differential' && x.base === context.base.sha && isolated(x));
  if (differential.some((x) => x.outcomes.some((y) => ['difference', 'crash', 'hang'].includes(y.kind)))) return ['FAIL', 'A differential input changed its output or error.'];
  for (const { base, head } of pairs) {
    const passed = new Set(base.cases.filter((x) => x.status === 'passed').map(oldKey));
    if (head.cases.some((x) => passed.has(key(x)) && failed(x))) return ['FAIL', 'A case that passed on the reference fails on the isolated head.'];
  }
  if (differential.some((x) => x.inputs >= 20 && x.failures === 0)) return ['PASS', 'An isolated differential run agrees for at least twenty inputs.'];
  const paths = new Set(context.change.paths), reaching = new Set(context.head.analysis.files.filter((x) => paths.has(x.path))
    .flatMap((x) => [...(x.tests?.direct ?? []), ...(x.tests?.transitive ?? [])]));
  const old = (context.base.analysis.tests?.cases ?? []).map((x) => ({ ...movedCase(x, moves), path: moves.get(x.path) ?? x.path })), current = context.head.analysis.tests?.cases ?? [];
  const candidates = old.filter((x) => reaching.has(x.path) && current.some((y) => key(y) === key(x)));
  const origin = (x) => !paths.has(x.path) ? 'pre-existing' : e.cases.find((y) => key(y) === key(x))?.origin;
  if (candidates.some((x) => !['pre-existing', 'changed-with-change'].includes(origin(x)))) return ['UNKNOWN', 'A potentially pre-existing reaching case has no classified text comparison.'];
  const cases = candidates.filter((x) => origin(x) === 'pre-existing');
  if (cases.length && cases.every((x) => pairs.some(({ base, head }) => base.cases.some((y) => oldKey(y) === key(x) && y.status === 'passed')
    && head.cases.some((y) => key(y) === key(x) && y.status === 'passed')))) return ['PASS', 'Each unchanged pre-existing case that reaches changed code passes on both isolated sides.'];
  return ['UNKNOWN', 'No complete reference run or differential run of twenty inputs confirms preserved behavior.'];
}
/** Named regression checks from isolated reports, including authorized copied-test results. */
export function regression(context, reproduction) {
  const declarations = context.request.regressionTests ?? [];
  if (!declarations.length) return ['UNKNOWN', 'The request names no regression test.'];
  const pairs = referencePairs(context), reports = reproduction ? pairs.map((x) => x.base) : context.reports.head.filter(isolated), moves = movesOf(context);
  const outcomes = declarations.map((d) => {
    const matches = (x) => x.file === d.file && (d.name === undefined || x.name === d.name);
    const found = reports.flatMap((x) => x.cases).map((x) => reproduction ? movedCase(x, moves) : x).filter(matches);
    const copied = (context.testValidation ?? []).filter((x) => x.type === 'regression' && x.file === d.file && x.name === d.name);
    const additional = copied.filter((x) => x.caseResults?.length && x.base.cases.length && x.head.cases.length
      && x.caseResults.every((y) => y.base !== 'missing' && y.head !== 'missing'));
    return [...found, ...additional.flatMap((x) => x[reproduction ? 'base' : 'head'].cases)];
  });
  if (reproduction) {
    if (outcomes.every((list) => list.length && list.every((x) => x.status === 'passed'))) return ['FAIL', 'Every named regression test passes on the reference. No test reproduces the bug.'];
    if (outcomes.some((list) => list.some(failed))) return ['PASS', 'A named regression test fails on the isolated reference.'];
  } else {
    if (outcomes.some((list) => list.some(failed))) return ['FAIL', 'A named regression test fails on the isolated head.'];
    if (outcomes.every((list) => list.length && list.every((x) => x.status === 'passed'))) return ['PASS', 'Every named regression test passes on the isolated head.'];
  }
  return ['UNKNOWN', `No complete isolated ${reproduction ? 'reference' : 'head'} evidence exists for the named regression tests.`];
}
/** A tagged case still needs a current human record. Failed tagged cases fail without an oracle. */
export function acceptance(context, criterion) {
  const cases = context.evidence.cases.filter((x) => x.criteria?.includes(criterion));
  if (cases.some(failed)) return ['FAIL', 'A bound head case that names this criterion failed.'];
  if (cases.some((x) => x.status === 'passed' && context.evidence.oracles.some((r) => confirms(r, x, criterion)))) return ['PASS', 'A passed case has a current human oracle record for this criterion.'];
  return ['UNKNOWN', 'No passed linked case has a current human oracle record for this criterion.'];
}

/** A reference must include a case that also ran on the head. */
export function independentReference(context) {
  const moves = movesOf(context);
  return referencePairs(context).some(({ base, head }) => {
    const before = new Set(base.cases.filter((x) => x.status !== 'skipped').map((x) => key(movedCase(x, moves))));
    return head.cases.some((x) => x.status !== 'skipped' && before.has(key(x)));
  });
}
