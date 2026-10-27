// The commands `code-map authorize` and `code-map run`: they check the command-line options, call the worker and return the
// JSON summary that the command prints. Each problem throws, and the command then exits with code 1 and prints nothing on stdout.
import { traceCommand } from '../models/trace-run.mjs';
import { trustPolicy } from '../trust.mjs';
import { protectedFolderOf } from '../inspect.mjs';
import { storeLocation } from '../store.mjs';
import { expiryDays, newAuthorization, saveAuthorization } from './authorize.mjs';
import { budgetFlags, budgetsFrom, defaultBudgets } from './budgets.mjs';
import { runCommand } from './run.mjs';

const budgetOptions = Object.values(budgetFlags);
const allowed = { authorize: new Set(['trust', 'trace-xstate', 'install', 'npm-cache', 'store', 'expires-days', 'compact', ...budgetOptions]),
  bench: new Set(['store', 'authorization', 'head', 'worktree', 'runs', 'warmup', 'compact', ...budgetOptions]),
  run: new Set(['trace-xstate', 'install', 'npm-cache', 'store', 'authorization', 'head', 'worktree', 'kind', 'artifact', 'discovery', 'filter', 'compact', ...budgetOptions]) };

/** Refuses an option that the command does not take. The parser gives default values to some options, and these do not count. */
function onlyOptions(name, options) {
  const extra = Object.entries(options).filter(([key, value]) => !allowed[name].has(key) && value !== undefined && value !== false && !(key === 'port' && value === '4477'));
  if (extra.length) throw new Error(`code-map ${name} does not take ${extra.map(([key]) => `--${key}`).join(', ')}.`);
}

/**
 * `code-map authorize [options] --command <words...>`: saves an authorization for this repository in the store and returns its
 * summary with the authorization ID. `words` is null when --command is missing. The user runs this command, not an agent.
 */
export function authorizeWork(repository, options, positionals, words) {
  onlyOptions('authorize', options);
  if (positionals.length > 1) throw new Error(`code-map authorize takes no other words: ${positionals.slice(1).join(' ')}. Give the command words after --command.`);
  if (words === null) throw new Error('code-map authorize needs --command <words...> as its last option. Each word after --command is one command word.');
  if (words.length === 0) throw new Error('--command needs the command words, for example: --command node --test.');
  const text = options['expires-days'], days = text === undefined ? expiryDays.default : /^\d+$/.test(text) ? Number(text) : Number.NaN;
  const { root } = storeLocation(options.store);
  if (protectedFolderOf(repository, root) !== null) throw new Error(`The store ${root} is inside the repository or its Git folders. Choose a store outside them with --store <folder>.`);
  const trust = options.trust === undefined ? undefined : trustPolicy(JSON.parse(options.trust));
  const record = newAuthorization({ trust, repository, command: options['trace-xstate'] ? traceCommand(words) : words, budgets: { ...defaultBudgets, ...budgetsFrom(options) }, install: options.install, npmCache: options['npm-cache'], expiresDays: days, now: new Date() });
  const file = saveAuthorization(root, record);
  return { reportType: 'code-map-authorization', schemaVersion: 1, authorizationId: record.id, ...(trust === undefined ? {} : { trust }), command: record.command, ...(record.install ? { install: record.install } : {}), budgets: record.budgets,
    createdAt: record.createdAt, expiresAt: record.expiresAt, file };
}

/** `code-map run --authorization <id> [--head <ref>|--worktree] [--kind <kind> --artifact <path>] -- <command...>`. `words` are the words after "--". */
export function runWork(repository, config, options, positionals, words) {
  onlyOptions('run', options);
  if (positionals.length !== words.length + 1) throw new Error('code-map run takes no other words before "--". Give the command words after "--".');
  return runCommand(repository, config, { install: options.install, npmCache: options['npm-cache'], authorization: options.authorization, command: words, traceXstate: options['trace-xstate'], head: options.head, worktree: options.worktree, kind: options.kind,
    artifact: options.artifact, discovery: options.discovery, filters: options.filter ?? [], budgets: budgetsFrom(options), store: options.store });
}

/** Runs controlled timings with explicit repeat counts and the worker's normal budgets. */
export function benchWork(repository, config, options, positionals, words) {
  onlyOptions('bench', options);
  if (positionals.length !== words.length + 1) throw new Error('bench takes command words only after "--".');
  const count = (value) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return runCommand(repository, config, { authorization: options.authorization, command: words, head: options.head,
    worktree: options.worktree, bench: { runs: count(options.runs), warmup: count(options.warmup) },
    budgets: budgetsFrom(options), store: options.store });
}
