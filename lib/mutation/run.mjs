// Mutation orchestration uses the restricted worker for the baseline and every edit.
import { collect, mapData } from '../build.mjs';
import { testFilesSelector } from '../verify-exec-request.mjs';
import { mutationSelection, selectedWords } from '../verify-selection.mjs';
import { assertionOutcome, supportsAssertionReport } from './outcome.mjs';
import { signManifest } from '../worker/signing.mjs';
import { cacheMutation, cachedMutation } from './cache.mjs';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../git.mjs';
import { analysisInputs, canonical } from '../inputs.mjs';
import { changedFiles, changedLines } from '../verify-change.mjs';
import { runCommand } from '../worker/run.mjs';
import { newRunId, runManifest, stageRun } from '../worker/runs.mjs';
import { copyWorktree, exportCommit } from '../worker/workspace.mjs';
import { storeLocation } from '../store.mjs';
import { equivalentCandidate, generateMutants, sampleMutants } from './generate.mjs';
import { parseStryker, summarizeMutation } from './report.mjs';
const digest = (text) => createHash('sha256').update(text).digest('hex');
const ref = (value) => typeof value === 'string' && value.length > 0 && value.length <= 255 && !value.startsWith('-') && !/[\u0000- \u007f]/.test(value) && !value.includes('..');
/** Runs a bounded deterministic sample. Failed baselines refuse mutation evidence. */
export async function mutate(repository, config, request, context = {}) {
  const max = Number(request.max ?? 20), seed = Number(request.seed ?? 0), now = context.now ?? (() => new Date());
  if (!ref(request.base) || (request.head !== undefined && !ref(request.head))) throw new Error('Mutation needs valid --base and --head refs.');
  if (request.worktree && request.head !== undefined) throw new Error('Give either --head or --worktree.');
  if (!Number.isSafeInteger(max) || max < 1 || max > 1000 || !Number.isSafeInteger(seed)) throw new Error('--max must be 1 to 1000. --seed must be an integer.');
  const selector = testFilesSelector(request.command);
  if (selector.problem) throw new Error(selector.problem);
  const head = request.worktree ? null : git(repository, ['rev-parse', '--verify', `${request.head ?? 'HEAD'}^{commit}`]).trim();
  const base = git(repository, ['rev-parse', '--verify', `${request.base}^{commit}`]).trim();
  const inputs = analysisInputs(repository, config, { worktree: head === null }, head);
  const changed = changedLines(repository, base, head, changedFiles(repository, base, head).files);
  const folder = mkdtempSync(join(tmpdir(), 'code-map-mutants-'));
  let items;
  const sources = new Map();
  try {
    if (head === null) copyWorktree(repository, folder); else exportCommit(repository, head, folder);
    items = [...changed].sort(([a], [b]) => a < b ? -1 : 1).flatMap(([path, lines]) => {
      let full = folder;
      for (const part of path.split('/')) { full = join(full, part); if (lstatSync(full).isSymbolicLink()) return []; }
      const source = readFileSync(full, 'utf8'); sources.set(path, source);
      return generateMutants(path, source, lines);
    });
  } finally { rmSync(folder, { recursive: true, force: true }); }
  const selected = sampleMutants(items, max, seed);
  let selection = null;
  if (selector.present) {
    const options = head === null ? { worktree: true } : { ref: head };
    const facts = collect(repository, config, options);
    const analysis = mapData(repository, config, facts, 2, head === null).analysis;
    selection = mutationSelection(analysis, [...new Set(selected.map((edit) => edit.path))].sort());
  }
  const command = selectedWords({ words: request.command }, selection);
  const selectionFields = selection ? { selection } : {};
  const workerRequest = { authorization: request.authorization, command, store: request.store,
    ...(head === null ? { worktree: true } : { head }), budgets: request.budgets };
  const stable = () => {
    const current = analysisInputs(repository, config, { worktree: head === null }, head);
    if (canonical(current) !== canonical(inputs)) throw new Error('The mutation inputs changed during the run.');
  };
  stable();
  if (request.printSelection) return { ...selectionFields, command };
  const baseline = await runCommand(repository, config, workerRequest, context);
  if (baseline.exitCode !== 0 || baseline.record.exitStatus !== 0) throw new Error(`The mutation baseline failed (${baseline.record.runId}). No mutation report was written.`);
  const root = storeLocation(request.store).root;
  const cacheKey = digest(canonical({ classificationVersion: 3, inputs, base, seed, max, command, ...selectionFields, ...(baseline.record.trust === undefined ? {} : { trust: baseline.record.trust }), budgets: baseline.record.budgets, backend: baseline.record.backend }));
  const cached = cachedMutation(root, cacheKey, repository, inputs);
  if (cached) { stable(); return cached; }
  const files = Object.create(null), runs = [];
  for (const [index, edit] of selected.entries()) {
    stable();
    let status, statusReason, runId = null;
    try {
      const result = await runCommand(repository, config, { ...workerRequest, mutation: edit }, context);
      runId = result.record.runId;
      status = result.record.stoppedBy === 'wallClockSeconds' ? 'Timeout' : result.exitCode !== 0 || result.record.signal !== null ? 'RuntimeError'
        : result.record.exitStatus === 0 ? 'Survived' : 'RuntimeError';
      statusReason = result.record.problems.join(' ');
      if (status === 'RuntimeError' && result.exitCode === 0 && result.record.signal === null) {
        const outcome = supportsAssertionReport(command) ? assertionOutcome(readFileSync(result.paths.stdout, 'utf8'))
          : { status: 'RuntimeError', reason: 'Unknown failure classification. Authorize Node with --test --test-reporter=tap for assertion evidence.' };
        status = outcome.status;
        statusReason = outcome.reason;
      }
    } catch (error) { status = error?.code === 'MUTATION_COMPILE' ? 'CompileError' : 'RuntimeError'; statusReason = error instanceof Error ? error.message : String(error); }
    files[edit.path] ??= { source: sources.get(edit.path), language: /\.[cm]?tsx?$/.test(edit.path) ? 'typescript' : 'javascript', mutants: [] };
    const candidate = status === 'Survived' ? equivalentCandidate(edit.path, sources.get(edit.path), edit) : null;
    files[edit.path].mutants.push({ id: String(index), mutatorName: edit.mutatorName, replacement: edit.replacement, location: edit.location, status, statusReason,
      ...(candidate ? { equivalentCandidate: candidate } : {}) });
    runs.push({ id: String(index), runId, status });
  }
  stable();
  const report = { schemaVersion: '1', files, seed, order: 'path, offset, mutator', base, head: inputs.sha,
    worktreeDigest: inputs.worktree?.contentDigest ?? null, baseline: baseline.record.runId, runs, candidates: items.length,
    cacheKey, ...selectionFields,
    note: 'A survivor is a lead. Equivalent candidates still count as survived. A person must review each candidate.' };
  const bytes = JSON.stringify(report, null, 2) + '\n', parsed = parseStryker(bytes);
  if (!parsed.ok) throw new Error(`The mutation report is invalid: ${parsed.error}`);
  const counts = summarizeMutation(parsed.report).counts;
  const id = newRunId(now()), stage = stageRun(root, id);
  try {
    const artifact = { path: 'mutation.json', file: 'report.json', kind: 'stryker-json', digest: digest(bytes) };
    const finishedAt = now().toISOString(), manifest = runManifest({ inputs, command, startedAt: baseline.record.startedAt,
      finishedAt, exitStatus: 0, artifact, backend: baseline.record.backend.name, filters: selection?.files ?? [], discovery: 'Changed-line mutation sample' });
    if (selection) manifest.discovery.selection = selection;
    const record = { ...baseline.record, runId: id, artifact, finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(baseline.record.startedAt), mutationRuns: runs };
    stage.put('report.json', bytes); stage.put('manifest.json', JSON.stringify(signManifest(manifest, root))); stage.put('run.json', JSON.stringify(record));
    stage.close();
    const published = stage.publish();
    cacheMutation(root, cacheKey, id);
    return { reportType: 'code-map-mutation-summary', runId: id, seed, candidates: items.length, selected: selected.length, counts, ...selectionFields,
      files: { artifact: join(published, 'report.json'), manifest: join(published, 'manifest.json') } };
  } finally { stage.close(); stage.discard(); }
}
