// The inspection shell adds optional run evidence without a dependency from static inspection to the worker.
import { retrieveInspection as retrieve } from '../compiler-inspect.mjs';
import { loadAnalysis, storeLocation } from '../store.mjs';
import { inspectTrace } from './trace-view.mjs';

/** Reads a normal summary, then attaches trace information without changing stored static analysis. */
export function retrieveTrace(repository, config, options, env = process.env, today = null) {
  if (options.run === undefined) return retrieve(repository, config, options, env, today);
  const conflicting = ['part', 'full', 'finding', 'findings', 'complexity', 'api', 'dependencies', 'schemas', 'impact', 'undocumented'];
  if (!options.summary || options.file?.length || options.change || conflicting.some((key) => options[key] !== undefined && options[key] !== false)) {
    throw new Error('inspect --run needs --summary without another report selection.');
  }
  const summary = retrieve(repository, config, options, env, today), root = storeLocation(options.store, env).root;
  const stored = loadAnalysis(root, summary.analysis.id);
  if (!stored) throw new Error('The selected analysis is no longer in the store.');
  return { ...summary, xstateTrace: inspectTrace(repository, config, root, options.run, stored) };
}
