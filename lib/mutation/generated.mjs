// File-scoped generated mutation runs are informational under every verification profile.
import { mkdtempSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, analysisInputs } from '../inputs.mjs';
import { changeImpact } from '../impact/reach.mjs';
import { measuredFiles } from '../coverage-evidence.mjs';
import { changedFiles, changedLines } from '../verify-change.mjs';
import { loadReports, reportCases } from '../verify-reports.mjs';
import { oracleProvenance } from '../provenance.mjs';
import { compareTestCases, generatedCommand, generatedMutantStatus, generatedSensitivity, supportedObligations, unavailableGenerated, testOutcome } from '../verify-test-validation.mjs';
import { runCommand } from '../worker/run.mjs';
import { copyWorktree, exportCommit } from '../worker/workspace.mjs';
import { compileGenerated } from './compile.mjs';
import { generateMutants, sampleMutants } from './generate.mjs';

/** Static file reach selects candidates. Bound head coverage locations restrict changed candidates. */
export function generatedCandidates(analysis, file, changed, coverage) {
  const measured = measuredFiles(coverage), hasLocations = [...measured.values()].some((value) => value.lines !== null || value.statements !== null);
  const hit = (path, line) => {
    const data = measured.get(path);
    if (data?.lines !== null && data?.lines !== undefined) return (data.lines.get(line)?.count ?? 0) > 0;
    return [...(data?.statements?.values() ?? [])].some((item) => item.count > 0 && item.from <= line && line <= item.to);
  };
  return new Map([...changed].flatMap(([path, lines]) => {
    if (!changeImpact(analysis, [path]).tests.some((item) => item.path === file && item.kind !== 'type')) return [];
    const selected = hasLocations ? lines.filter((line) => hit(path, line)) : lines;
    return selected.length ? [[path, selected]] : [];
  }));
}
function editsOf(repository, head, lines) {
  const tree = mkdtempSync(join(tmpdir(), 'code-map-generated-'));
  try {
    if (head === null) copyWorktree(repository, tree); else exportCommit(repository, head, tree);
    return [...lines].sort(([a], [b]) => a.localeCompare(b)).flatMap(([path, changed]) => {
      let full = tree;
      for (const part of path.split('/')) { full = join(full, part); if (lstatSync(full).isSymbolicLink()) return []; }
      return generateMutants(path, readFileSync(full, 'utf8'), changed);
    });
  } finally { rmSync(tree, { recursive: true, force: true }); }
}
const unavailable = () => ({ status: 'unavailable', cases: [], runs: [] });
/** Runs at most 20 deterministic changed-line mutants per generated declaration and command. */
export async function generatedMutations(repository, config, request, sides, store, env, inputs) {
  if (!request.generatedTests?.length) return [];
  const headRef = request.head === 'worktree' ? null : sides.head.sha;
  const files = changedFiles(repository, sides.base.sha, headRef), changed = changedLines(repository, sides.base.sha, headRef, files.files);
  const coverage = loadReports(repository, [...request.reportInputs, ...inputs], sides, undefined, store).coverage;
  const stable = () => {
    const current = analysisInputs(repository, config, { worktree: headRef === null, ref: sides.head.inputs.selector.ref,
      types: !!sides.head.inputs.typed }, sides.head.inputs.mapped);
    if (canonical(current) !== canonical(sides.head.inputs)) throw new Error('The generated mutation inputs changed during the run.');
  };
  const compilations = new Map();
  const output = [], commands = request.execution.commands.filter((item) => item.generatedTestWords);
  for (const declaration of request.generatedTests) {
    if (!commands.length) {
      output.push(...unavailableGenerated([declaration], 'No generatedTestWords command template was declared.'));
    }
    for (const command of commands) {
      const words = generatedCommand(command.generatedTestWords, declaration.file);
      const item = { file: declaration.file, ...(declaration.name === undefined ? {} : { name: declaration.name }), commandId: command.id, words,
        attribution: declaration.name === undefined ? 'file' : 'reported-case', head: unavailable(), base: unavailable(), mutants: [], candidates: 0, truncated: false,
        compilation: { status: 'unavailable', diagnostics: [] }, typeCheck: { status: 'unavailable', reason: 'Compilation has not run.' }, failureSensitive: false, supports: [], reason: '' };
      output.push(item);
      const worker = { authorization: declaration.mutationAuthorization ?? request.execution.authorization, command: words, store, budgets: request.execution.budgets };
      const launch = async (side, mutation) => {
        stable();
        const result = await runCommand(repository, config, { ...worker,
          ...(side === 'head' && headRef === null ? { worktree: true } : { head: sides[side].sha }),
          ...(mutation ? { mutation, mutationArtifact: command.artifact } : { kind: command.kind, artifact: command.artifact }),
          ...(side === 'base' ? { testOverlay: { head: headRef, files: [declaration.file] } } : {}) }, { env });
        stable();
        return result;
      };
      const read = (result, side) => {
        const expected = side === 'base' ? { ...sides.base, analysis: sides.head.analysis,
          inputs: { ...sides.base.inputs, worktree: { contentDigest: result.record.source.worktreeDigest } } } : sides.head;
        if (result.exitCode !== 0 || !result.record.artifact) return [];
        return loadReports(repository, [{ run: result.record.runId }], { head: expected, base: expected }, undefined, store).reports.head;
      };
      try {
        stable();
        if (!compilations.has(declaration.file)) compilations.set(declaration.file, compileGenerated(repository, headRef, declaration.file));
        const { typeCheck, ...compilation } = compilations.get(declaration.file);
        item.compilation = compilation; item.typeCheck = typeCheck;
        stable();
        if (item.compilation.status === 'failed') { item.reason = 'Generated file compilation failed. No generated-file command ran.'; continue; }
        const baseline = await launch('head');
        const reports = read(baseline, 'head');
        item.head = testOutcome(reports, declaration, [baseline.record.runId]);
        const links = oracleProvenance(repository, { request, reports, change: { ...files, paths: files.files.map((x) => x.path) },
          head: { ...sides.head, worktree: headRef === null }, base: { ...sides.base, worktree: false } });
        item.taggedObligations = [...new Set(links.entries.filter((x) => x.file === declaration.file
          && (declaration.name === undefined || x.name === declaration.name)).flatMap((x) => (x.criteria ?? []).map((id) => `acceptance.${id}`)))];
        if (baseline.exitCode !== 0 || baseline.record.exitStatus !== 0 || item.head.status !== 'passed'
          || reports.flatMap((x) => x.cases).some((x) => x.file !== declaration.file)) {
          item.reason = 'The exact generated-file command has no passing head baseline. No mutants ran.'; continue;
        }
        if (request.changeType === 'fix') {
          try {
            const base = await launch('base'); item.base = testOutcome(read(base, 'base'), declaration, [base.record.runId]);
            item.baseFailureConfirmed = compareTestCases(item.base.cases, item.head.cases).sameCases && item.base.status === 'failed';
          } catch (error) { item.baseReason = error instanceof Error ? error.message : String(error); }
        }
        const candidates = generatedCandidates(sides.head.analysis, declaration.file, changed, coverage);
        const edits = editsOf(repository, headRef, candidates);
        item.candidates = edits.length; item.truncated = edits.length > 20;
        for (const edit of sampleMutants(edits, 20, 0)) {
          const mutant = { path: edit.path, location: edit.location, mutatorName: edit.mutatorName, replacement: edit.replacement,
            test: declaration.file, status: 'RuntimeError', run: null };
          try {
            const result = await launch('head', edit); mutant.run = result.record.runId;
            const parsed = result.paths.mutationArtifact ? reportCases(readFileSync(result.paths.mutationArtifact, 'utf8'), command.kind,
              result.record.workspace.tree, { workingDirectory: '.' }, new Set([declaration.file])) : { cases: [] };
            const cases = parsed.cases ?? [];
            mutant.status = generatedMutantStatus(result, cases, reports.flatMap((x) => x.cases));
            mutant.cases = cases;
            mutant.selectedFailure = generatedSensitivity(declaration, item.head, [{ status: mutant.status, cases }]);
            mutant.reason = parsed.error ?? result.record.problems.join(' ');
          } catch (error) { mutant.status = error?.code === 'MUTATION_COMPILE' ? 'CompileError' : 'RuntimeError'; mutant.reason = error instanceof Error ? error.message : String(error); }
          item.mutants.push(mutant);
        }
        item.failureSensitive = generatedSensitivity(declaration, item.head, item.mutants);
        const selectedLinks = links.entries.filter((entry) => declaration.name === undefined || entry.name === declaration.name);
        item.supports = item.failureSensitive ? supportedObligations(item.mutants, selectedLinks) : [];
        item.reason = 'File-scoped command outcomes measure sensitivity. Static reach and head coverage do not prove per-test line execution or oracle correctness.';
      } catch (error) { item.reason = error instanceof Error ? error.message : String(error); }
    }
  }
  stable();
  return output;
}
