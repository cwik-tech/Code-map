// Import sidecar-bound compiler reports for one summary comparison. Reuse verification's validation and binding boundary.
import { retrieve, comparisonOf } from './inspect.mjs';
import { loadAnalysis, storeLocation } from './store.mjs';
import { compilerKinds } from './adapters/python-diagnostics.mjs';
import { compilerLifecycle } from './compiler-lifecycle.mjs';
import { loadReports } from './verify-reports.mjs';

/** Compiler reports are accepted only for a newly requested summary comparison. */
export function checkCompilerOptions(options) {
  const head = options['compiler-report'], base = options['base-compiler-report'];
  if (head !== undefined && (!options.summary || options.base === undefined || options.analysis !== undefined)) {
    throw new Error('--compiler-report needs --summary --base <ref>.');
  }
  if (base !== undefined && head === undefined) throw new Error('--base-compiler-report needs --compiler-report.');
}

/** Keep compiler report loading in the CLI shell, outside structural retrieval and its dependency graph. */
export function retrieveInspection(repository, config, options, env = process.env, today = null) {
  checkCompilerOptions(options);
  const summary = retrieve(repository, config, options, env, today);
  if (options['compiler-report'] === undefined) return summary;
  const location = storeLocation(options.store, env), head = loadAnalysis(location.root, summary.analysis.id);
  const base = loadAnalysis(location.root, summary.comparison.base.id);
  if (!head || !base) throw new Error('The comparison analyses are no longer in the store. Run the summary again.');
  return { ...summary, ...inspectCompiler(repository, options, head, comparisonOf(head, base, summary.analysis.freshness), location.root) };
}

/** Reports stay separate from cached structural analyses. Each artifact uses the sidecar <artifact>.manifest.json. */
export function inspectCompiler(repository, options, head, comparison, store) {
  if (options['compiler-report'] === undefined) return {};
  const side = (stored) => ({ inputs: stored.inputs, sha: stored.data.sha, analysis: stored.data.analysis });
  const inputs = [['head', options['compiler-report']], ['base', options['base-compiler-report']]]
    .filter(([, artifact]) => artifact !== undefined).map(([side, artifact]) => ({ artifact, manifest: `${artifact}.manifest.json`, side }));
  const loaded = loadReports(repository, inputs, { head: side(head), base: side(comparison.base) }, undefined, store);
  // A report that binds to the wrong requested side cannot stand in for the requested report.
  const compiler = { head: [], base: [] };
  loaded.executions.forEach((execution, index) => {
    if (!execution.eligible) return;
    if (execution.side !== inputs[index].side || !compilerKinds.includes(execution.kind)) {
      execution.eligible = false;
      execution.reasons.push({ key: 'compiler-side', message: 'A compiler report must bind as kind tsc, mypy-json, mypy-text, pyright-json or ruff-json to its requested side.' });
    } else compiler[execution.side].push(...loaded.compiler[execution.side].filter((report) => report.artifact === execution.artifact));
  });
  const result = compilerLifecycle(compiler, { comparable: comparison.result.state === 'COMPARABLE', renames: comparison.renames, complete: comparison.complete });
  const newDiagnostics = result.entries.filter((entry) => entry.baseline === 'NEW');
  const preview = (entry) => ({ ...entry, artifact: entry.artifact.slice(0, 200),
    diagnostic: { ...entry.diagnostic, file: entry.diagnostic.file?.slice(0, 200) ?? null, message: entry.diagnostic.message.slice(0, 160) } });
  return { compiler: { ...result, entries: result.entries.slice(0, 20).map(preview), newDiagnostics: newDiagnostics.slice(0, 20).map(preview),
    truncated: result.entries.length > 20 || newDiagnostics.length > 20, executions: loaded.executions } };
}
