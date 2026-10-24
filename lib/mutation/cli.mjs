// Boundary for the mutate command.
import { budgetsFrom } from '../worker/budgets.mjs';
import { mutate } from './run.mjs';
/** Accepts only mutation options and explicit command words. */
export function mutateWork(repository, config, options, positionals, words) {
  const allowed = new Set(['print-selection', 'authorization', 'base', 'head', 'worktree', 'max', 'seed', 'store', 'compact', 'wall-clock-seconds', 'memory-megabytes', 'output-megabytes', 'concurrency']);
  for (const [key, value] of Object.entries(options)) if (!allowed.has(key) && value !== undefined && value !== false && !(key === 'port' && value === '4477')) throw new Error(`mutate does not take --${key}.`);
  if (positionals.length !== words.length + 1) throw new Error('Give the test command after "--".');
  return mutate(repository, config, { authorization: options.authorization, base: options.base, head: options.head, worktree: options.worktree,
    printSelection: options['print-selection'], max: options.max, seed: options.seed, store: options.store, command: words, budgets: budgetsFrom(options) });
}
