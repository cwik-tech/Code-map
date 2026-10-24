// Authorized worker runs for verify. Copied-test runs stay outside the rule-set evidence.
import { selectTests, selectedOutcomes, selectedWords } from './verify-selection.mjs';
import { generatedMutations } from './mutation/generated.mjs';
import { compareTestCases, testOutcome as outcome } from './verify-test-validation.mjs';
import { loadReports, message } from './verify-reports.mjs';
import { runCommand } from './worker/run.mjs';

const empty = () => ({ status: 'unavailable', cases: [], runs: [] });
/** Runs commands sequentially. The authorization and the worker enforce every run budget. */
export async function executeVerify(repository, config, request, sides, store, env) {
  const inputs = [], executionRuns = [], testValidation = [];
  const declarations = [...(request.regressionTests ?? []).map((item) => ({ ...item, type: 'regression' })),
    ...(request.generatedTests ?? []).map((item) => ({ ...item, type: 'generated' }))];
  const files = [...new Set(declarations.map((item) => item.file))];
  for (const command of request.execution.commands) {
    const selection = selectTests(repository, request, sides, command);
    const normal = { head: null, base: null };
    const launch = async (side, overlay = false, evidence = true) => {
      const entry = { commandId: command.id, side, copiedTests: overlay, ...(selection ? { selection: { ...selection } } : {}), status: 'refused', run: null, stoppedBy: null, reasons: [] };
      executionRuns.push(entry);
      try {
        const result = await runCommand(repository, config, { authorization: request.execution.authorization, command: selectedWords(command, selection),
          ...(side === 'head' && request.head === 'worktree' ? { worktree: true } : { head: sides[side].sha }),
          install: request.execution.install, npmCache: request.execution.npmCache, kind: command.kind, artifact: command.artifact, budgets: request.execution.budgets, store,
          ...(overlay ? { testOverlay: { head: request.head === 'worktree' ? null : sides.head.sha, files } } : {}) }, { env });
        Object.assign(entry, { run: result.record.runId, status: result.exitCode === 0 ? 'completed' : result.record.stoppedBy ? 'stopped' : 'failed',
          dependencies: result.record.dependencies, stoppedBy: result.record.stoppedBy, exitStatus: result.record.exitStatus, reasons: result.record.problems });
        if (result.exitCode !== 0 || !result.record.artifact) return null;
        const input = { run: result.record.runId };
        if (evidence) inputs.push({ ...input, side });
        // Only this informational reader expects the digest of the modified base snapshot.
        const expected = overlay ? { ...sides.base, analysis: sides.head.analysis,
          inputs: { ...sides.base.inputs, worktree: { contentDigest: result.record.source.worktreeDigest } } } : sides[side];
        const loaded = loadReports(repository, [input], { head: expected, base: expected }, undefined, store);
        if (selection) entry.selection.observed = selectedOutcomes(selection, loaded.reports.head);
        return { reports: loaded.reports.head, run: entry.run };
      } catch (error) { entry.reasons.push(message(error)); return null; }
    };
    for (const side of command.sides) normal[side] = await launch(side);
    if (!declarations.length) continue;
    if (!command.sides.includes('head')) normal.head = await launch('head', false, false);
    const copied = request.changeType === 'fix' ? await launch('base', true, false) : null;
    for (const declaration of declarations) {
      const head = normal.head ? outcome(normal.head.reports, declaration, [normal.head.run]) : empty();
      const base = copied ? outcome(copied.reports, declaration, [copied.run]) : empty();
      const compared = compareTestCases(base.cases, head.cases);
      const confirmed = request.changeType === 'fix' && compared.sameCases && base.status === 'failed' && head.status === 'passed';
      const reason = confirmed ? 'The copied head test fails on the base and passes on the head. This confirms failure sensitivity only.'
        : request.changeType === 'fix' && base.cases.length && head.cases.length && !compared.sameCases ? 'The reported case identities differ between base and head. This does not confirm the same regression test.'
        : base.status === 'passed' ? 'The test passes on the base. This proves nothing about the bug.'
          : request.changeType !== 'fix' && head.status === 'passed' ? 'The generated or declared test passes on the head. No bug reproduction was requested.'
            : 'The reports do not confirm a base failure and a head pass. Missing, skipped or refused cases give no confirmation.';
      testValidation.push({ ...declaration, commandId: command.id, base, head, caseResults: compared.cases, confirmed, reason });
    }
  }
  const generatedTestMutations = await generatedMutations(repository, config, request, sides, store, env, inputs);
  return { inputs, executionRuns, testValidation, generatedTestMutations };
}
