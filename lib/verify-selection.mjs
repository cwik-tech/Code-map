// Impact and baseline selection for explicitly opted-in verification commands.
import { changeImpact, removedImports } from './impact/reach.mjs';
import { changedFiles } from './verify-change.mjs';
import { safeTestPath } from './verify-exec-request.mjs';
import { commandProblem } from './worker/command.mjs';

/** Uses both revision graphs and retains a common sorted denominator for comparable command words. */
export function selectTests(repository, request, sides, command) {
  if (command.baselineSuite === undefined) return null;
  const change = changedFiles(repository, sides.base.sha, request.head === 'worktree' ? null : sides.head.sha);
  const paths = change.files.filter((x) => x.status !== 'D').map((x) => x.path);
  const oldPaths = change.files.map((x) => x.from ?? x.path);
  const removed = change.files.filter((x) => ['D', 'R'].includes(x.status)).map((x) => x.from ?? x.path);
  const head = changeImpact(sides.head.analysis, paths, undefined, removedImports(sides.base.analysis, sides.head.analysis, removed));
  const base = changeImpact(sides.base.analysis, oldPaths);
  const impact = [...new Set([...head.tests, ...base.tests].map((x) => x.path))].sort();
  const files = [...new Set([...command.baselineSuite, ...impact])].sort();
  const complete = change.complete && head.complete && base.complete;
  return { policy: 'impact-plus-baseline-v1', state: complete ? 'KNOWN' : 'UNKNOWN',
    reason: complete ? 'The static impact walk and declared baseline define this selection.' : 'The impact walk is incomplete. Selected tests do not prove complete impact coverage.',
    baseline: command.baselineSuite, impact, files, total: files.length };
}
/** Empty selectors never expand into an accidental full-suite command. The worker authorizes the final words. */
export function selectedWords(command, selection) {
  if (!selection) return command.words;
  if (!selection.files.length) throw new Error('The test selection is empty. No command runs.');
  if (selection.files.some((file) => !safeTestPath(file) || file.startsWith('-'))) throw new Error('Selection needs a safe relative test path.');
  const words = command.words.flatMap((word) => word === '{testFiles}' ? selection.files : [word]);
  const problem = commandProblem(words);
  if (problem) throw new Error(problem);
  return words;
}

/** Missing file-level outcomes remain unknown, even when the worker exits successfully. */
export function selectedOutcomes(selection, reports) {
  const reported = reports.flatMap((report) => report.cases);
  const files = selection.files.map((file) => {
    const cases = reported.filter((item) => item.file === file);
    return { file, cases: cases.length, passed: cases.filter((item) => item.status === 'passed').length,
      failed: cases.filter((item) => ['failed', 'errored'].includes(item.status)).length,
      skipped: cases.filter((item) => item.status === 'skipped').length };
  });
  const missing = files.filter((item) => item.cases === 0).map((item) => item.file);
  return { state: missing.length ? 'UNKNOWN' : 'KNOWN', missing, files };
}

/** Selects tests from the head graph for changed source files that have sampled mutants. */
export function mutationSelection(analysis, sources) {
  const impact = changeImpact(analysis, sources);
  const files = [...new Set(impact.tests.map((item) => item.path))].sort();
  return { policy: 'impact-v1', state: impact.complete ? 'KNOWN' : 'UNKNOWN',
    reason: impact.complete ? 'The static head impact walk defines this selection.'
      : 'The impact walk is incomplete. Selected tests do not prove complete impact coverage.',
    sources, files, total: files.length };
}
