// code-map run: runs one authorized command in the restricted worker, for a commit or the working tree. A private run folder in
// the store keeps the record, the output and, on request, the artifact with its run manifest. A run never falls back to the
// user's normal environment: without a backend, or when the backend cannot start, Code-map refuses it. It never changes the repository.
import { runPhases } from './phases.mjs';
import { dependencyLockfile, installPolicy } from './install.mjs';

import { prepareTrace, traceArtifact, traceCommand } from '../models/trace-run.mjs';
import { runProblems } from './outcome.mjs';
import { signManifest } from './signing.mjs';
import { applyMutation } from '../mutation/edit.mjs';
import { applyTestOverlay, readTestOverlay } from './test-overlay.mjs';
import { measureBench } from './bench.mjs';
import { validateRepeats } from '../bench-report.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isRelativePath } from '../adapters/run-manifest.mjs';
import { git } from '../git.mjs';
import { analysisInputs } from '../inputs.mjs';
import { protectedFolderOf } from '../inspect.mjs';
import { reportKinds } from '../manifest.mjs';
import { storeFolder, storeLocation } from '../store.mjs';
import { runIdPattern } from '../verify-request.mjs';
import { checkAuthorization, commandProblem, loadAuthorization, repositoryDigest } from './authorize.mjs';
import { buildPolicy, cleanEnvironment, defaultProtectedFolders, findBackend, noBackendMessage, sandboxCommand } from './backend.mjs';
import { budgetProblem, claimSlot, graceMs, sampleMs } from './budgets.mjs';
import { artifactFiles, maxArtifactBytes, newRunId, runFiles, runManifest, stageRun } from './runs.mjs';
import { collectArtifact, copyWorktree, createWorkspace, exportCommit, linkNodeModules, removeWorkspace } from './workspace.mjs';

const refProblem = (ref) => typeof ref !== 'string' || ref.length === 0 || ref.length > 255 || ref.startsWith('-') || /[\u0000- \u007f]/.test(ref) || ref.includes('..');
const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');

/** Checks the request at the boundary. Returns the head ref, or null for the working tree. */
function checkRequest({ bench, command, authorization, worktree = false, head, kind, artifact, discovery, filters = [], mutation, mutationArtifact }) {
  if (bench) { validateRepeats(bench); if (kind !== undefined || artifact !== undefined || mutation) throw new Error('Bench runs keep only their timing report.'); }
  if (mutationArtifact !== undefined && (!mutation || !isRelativePath(mutationArtifact))) throw new Error('A mutation artifact needs an edit and a relative report path.');
  if (mutation && (kind !== undefined || artifact !== undefined)) throw new Error('Mutant runs cannot keep normal test artifacts.');
  const words = commandProblem(command);
  if (words) throw new Error(words);
  if (authorization === undefined) throw new Error('code-map run needs --authorization <id>, the ID that code-map authorize printed.');
  if (worktree && head !== undefined) throw new Error('Give either --head or --worktree, not both.');
  if (!worktree && head !== undefined && refProblem(head)) throw new Error(`--head must be a commit, branch or tag, not ${JSON.stringify(String(head)).slice(0, 80)}.`);
  if ((kind === undefined) !== (artifact === undefined)) throw new Error('Give --kind and --artifact together, or neither of them.');
  if (kind !== undefined && kind !== 'harness' && !reportKinds.includes(kind)) throw new Error(`--kind must be one of ${reportKinds.join(', ')}.`);
  if (artifact !== undefined && !isRelativePath(artifact)) throw new Error('--artifact must name the report file by its path relative to the snapshot, for example reports/junit.xml.');
  if ((discovery !== undefined && !isText(discovery)) || !Array.isArray(filters) || !filters.every(isText)) throw new Error('--discovery and --filter must be text.');
  return worktree ? null : head ?? 'HEAD';
}

/** The backend must start a command with this policy before Code-map runs the real command. Otherwise the run is refused. */
function probe(backend, policy, workspace, environment) {
  const truth = existsSync('/usr/bin/true') ? '/usr/bin/true' : '/bin/true', sandbox = sandboxCommand(backend, policy, [truth], workspace.tree);
  const result = spawnSync(sandbox.file, sandbox.args, { cwd: workspace.tree, env: environment, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    throw new Error(`The ${backend.name} backend cannot start a run on this computer: ${(result.error?.message ?? result.stderr ?? '').trim() || `exit status ${result.status}`}. `
      + 'Code-map refuses to run the command, because it never runs it without isolation.');
  }
}

/** Removes the workspaces and staging folders of runs that have no slot: runs that ended without cleanup, for example after a crash. */
function removeLeftovers(root) {
  const active = new Set(readdirSync(join(root, 'slots')).map((name) => name.replace(/\.json$/, '')));
  for (const name of readdirSync(storeFolder(root, 'workspaces'))) if (runIdPattern.test(name) && !active.has(name)) removeWorkspace(join(root, 'workspaces', name));
  for (const name of readdirSync(storeFolder(root, 'runs'))) {
    const owner = /^\.staging-(R-\d{8}T\d{6}Z-[0-9a-f]{8})-/.exec(name)?.[1];
    if (owner && !active.has(owner)) rmSync(join(root, 'runs', name), { recursive: true, force: true });
  }
}

/** The inputs of the snapshot: the commit, the digest of the working tree, the configuration and the lockfile, as code-map manifest records them. */
function snapshotInputs(repository, config, head) {
  if (head === null) return analysisInputs(repository, config, { worktree: true }, null);
  try { git(repository, ['rev-parse', '--verify', '--quiet', `${head}^{commit}`]); } catch { throw new Error(`--head ${JSON.stringify(head)} is not a commit in this repository.`); }
  return analysisInputs(repository, config, { worktree: false, ref: head }, head);
}

/**
 * Runs the command words of `request` in the worker. `request`: authorization, command, head or worktree, kind and artifact,
 * discovery, filters, budgets (each one at most the maximum of the authorization) and store. `context` holds the parameters
 * of the tests: now, platform, backend, protectedFolders, home, env, graceMs and sampleMs. Returns the record, the paths of
 * the run folder, the summary for stdout and the exit code: 0 when the run ended by itself and kept each requested file, else 1.
 */
export async function runCommand(repository, config, request, context = {}) {
  const { now = () => new Date(), platform = process.platform, env = process.env, home = homedir() } = context;
  if (request.traceXstate) {
    if (request.kind !== undefined || request.artifact !== undefined || request.mutation) throw new Error('--trace-xstate keeps its own artifact and cannot combine with another artifact or mutation.');
    request = { ...request, command: traceCommand(request.command), kind: 'xstate-trace', artifact: traceArtifact };
  }
  const head = checkRequest(request), { command, kind, artifact, filters = [] } = request;
  const root = storeLocation(request.store, env).root;
  if (protectedFolderOf(repository, root) !== null) throw new Error(`The store ${root} is inside the repository or its Git folders. Choose a store outside them with --store <folder>.`);
  const authorization = loadAuthorization(root, request.authorization), budgets = { ...authorization.budgets, ...request.budgets }, limits = budgetProblem(budgets);
  if (limits) throw new Error(`The budgets of the run are not valid: ${limits}.`);
  const install = installPolicy(request.install, request.npmCache, { repository, store: root });
  checkAuthorization(authorization, { repository, command, budgets, now: now(), install: request.install, npmCache: request.npmCache });
  const backend = context.backend === undefined ? findBackend({ platform }) : context.backend;
  if (!backend) throw new Error(noBackendMessage(platform));
  let inputs = snapshotInputs(repository, config, head);
  const overlayFiles = request.testOverlay ? readTestOverlay(repository, request.testOverlay) : null;
  const runId = newRunId(now());
  const release = claimSlot(storeFolder(root, 'slots'), runId, budgets.concurrency);
  let workspace = null, stage = null;
  try {
    removeLeftovers(root);
    workspace = createWorkspace(join(root, 'workspaces'), runId);
    if (head === null) {
      copyWorktree(repository, workspace.tree);
      const after = analysisInputs(repository, config, { worktree: true }, null);
      if (after.sha !== inputs.sha || after.worktree.contentDigest !== inputs.worktree.contentDigest) throw new Error('The working tree changed while Code-map copied it. Run the command again when the files are stable.');
    } else exportCommit(repository, inputs.sha, workspace.tree);
    if (request.mutation) applyMutation(workspace.tree, request.mutation, { repository, config });
    const overlay = overlayFiles ? applyTestOverlay(workspace.tree, overlayFiles, inputs) : null;
    if (overlay) inputs = { ...inputs, worktree: { contentDigest: overlay.digest } };
    const modules = install ? { mode: 'revision-offline', source: null } : linkNodeModules(repository, workspace.tree, { platform }), nodeDirectory = dirname(process.execPath);
    const policy = buildPolicy({ workspace: workspace.folder, nodePrefix: dirname(nodeDirectory), home,
      links: [...(modules.source ? [{ source: modules.source, target: join(workspace.tree, 'node_modules') }] : []),
        ...(install ? [{ source: install.npmCache, target: install.npmCache }] : [])],
      protectedFolders: context.protectedFolders ?? defaultProtectedFolders({ platform, home, temporary: tmpdir(), repository, store: root }) });
    context.prepare?.(workspace, inputs);
    if (request.traceXstate) prepareTrace(workspace);
    const environment = cleanEnvironment({ workspace: workspace.folder, nodeDirectory, env });
    probe(backend, policy, workspace, environment);
    const lockfile = install ? dependencyLockfile(workspace.tree, { backend, policy, environment }) : inputs.lockfile;
    stage = stageRun(root, runId);
    const startedAt = now();
    let result, installation = null, benchmark = null;
    if (request.bench) {
      const sandbox = sandboxCommand(backend, policy, command, workspace.tree);
      const measured = await measureBench({ command, sandbox, workspace, environment, budgets, write: stage.write,
        intervalMs: context.sampleMs ?? sampleMs, grace: context.graceMs ?? graceMs, repeats: request.bench });
      result = measured.result;
      benchmark = measured.report;
    } else {
      ({ result, installation } = await runPhases({ backend, policy, command, install, workspace, environment, budgets, write: stage.write, context }));
    }
    const finishedAt = now();
    stage.close();
    const problems = runProblems(result, budgets);
    if (installation?.status === 'failed') problems.push('The revision has no prepared dependencies. The offline npm install failed. See stderr for the npm message.');
    let kept = null;
    if (request.bench && !benchmark && !problems.length) problems.push('Benchmark command failed. No timing report is available.');
    if (benchmark && !problems.length) {
      const bytes = Buffer.from(`${JSON.stringify(benchmark, null, 2)}\n`);
      kept = { path: 'bench.json', kind: 'bench', digest: createHash('sha256').update(bytes).digest('hex'), file: artifactFiles.bench };
      stage.put(kept.file, bytes);
    }
    if (artifact !== undefined && problems.length === 0) {
      try {
        const { bytes, digest } = collectArtifact(workspace.tree, artifact, maxArtifactBytes, { backend, policy, environment });
        kept = { path: artifact, kind, digest, file: artifactFiles[kind] };
        stage.put(kept.file, bytes);
      } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    }
    // Mutant reports have no normal artifact or manifest. They cannot enter rating evidence.
    let mutationReport = null;
    if (request.mutationArtifact !== undefined && problems.length === 0) {
      try {
        const { bytes, digest } = collectArtifact(workspace.tree, request.mutationArtifact, maxArtifactBytes, { backend, policy, environment });
        mutationReport = { path: request.mutationArtifact, digest, file: 'mutant-report' };
        stage.put(mutationReport.file, bytes);
      } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    }
    const removed = removeWorkspace(workspace.folder);
    if (!removed) problems.push(`Code-map cannot remove the workspace ${workspace.folder}. Remove it yourself.`);
    const record = { recordType: 'code-map-run-record', schemaVersion: 1, runId, ...(authorization.trust === undefined ? {} : { trust: authorization.trust }), authorizationId: authorization.id, repository: { digest: repositoryDigest(repository) },
      ...(overlay ? { testOverlay: overlay.tests } : {}),
      source: { selector: { worktree: head === null, ref: head }, sha: inputs.sha, worktreeDigest: inputs.worktree?.contentDigest ?? null }, command,
      dependencies: { sha: inputs.sha, lockfile, mode: modules.mode,
        prepared: installation?.status === 'prepared', install: installation },
      policy: 'isolated', network: 'denied', backend: { ...backend }, workspace: { tree: workspace.tree, nodeModules: modules.mode, removed },
      ...(request.mutation ? { mutation: request.mutation } : {}),
      ...(request.mutationArtifact !== undefined ? { mutationReport } : {}), budgets, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitStatus: result.exitStatus, signal: result.signal, stoppedBy: result.stoppedBy, output: result.output, memory: result.memory, disk: result.disk, processes: result.processes, artifact: kept, problems };
    if (kept) stage.put(runFiles.manifest, `${JSON.stringify(signManifest(runManifest({ inputs, command, startedAt: record.startedAt, finishedAt: record.finishedAt, exitStatus: result.exitStatus,
      artifact: kept, backend: backend.name, discovery: request.discovery, filters }), root), null, 2)}\n`);
    stage.put(runFiles.record, `${JSON.stringify(record, null, 2)}\n`);
    const folder = stage.publish(), file = (name) => join(folder, name);
    const paths = { folder, record: file(runFiles.record), stdout: file(runFiles.stdout), stderr: file(runFiles.stderr),
      ...(mutationReport ? { mutationArtifact: file(mutationReport.file) } : {}),
      artifact: kept ? file(kept.file) : null, manifest: kept ? file(runFiles.manifest) : null };
    const summary = { reportType: 'code-map-run-summary', schemaVersion: 1, runId, policy: 'isolated', backend: backend.name, exitStatus: result.exitStatus,
      signal: result.signal, stoppedBy: result.stoppedBy, problems, files: paths };
    workspace = null;
    return { record, paths, summary, exitCode: result.stoppedBy || problems.length ? 1 : 0 };
  } finally {
    stage?.close();
    stage?.discard();
    if (workspace) removeWorkspace(workspace.folder);
    release();
  }
}
