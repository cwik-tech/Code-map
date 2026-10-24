// `code-map triage`: writes the triage entry of one finding into .code-map-triage.json. It finds the fingerprint of the finding
// in a stored analysis (--analysis <id>, or the stored analysis of the current code), validates the entry and the file, and
// writes the file through a rename. It collects no code, and it changes no other file.
import { selectRef } from './build.mjs';
import { analysisId, analysisInputs } from './inputs.mjs';
import { commandLine, realPath } from './inspect.mjs';
import { loadAnalysis, storeLocation, validId } from './store.mjs';
import { entryErrors, problems, readTriage, states, triageFile, triageVersion, validateTriage, writeTriage } from './triage.mjs';

const needed = ['finding', 'state', 'reason', 'owner'];
const allowed = new Set([...needed, 'expires', 'analysis', 'worktree', 'ref', 'labels', 'store', 'compact']);
const byFingerprint = (a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0);

/**
 * Adds the entry of one finding, or replaces the entry with the same fingerprint. `today` (YYYY-MM-DD) is the date of the
 * entry and the date of the expiry checks. `words` are the command words after "triage". Each problem throws, and nothing is written.
 */
export function triageFinding(repository, config, options, { words = [], today, env = process.env }) {
  if (words.length) throw new Error(`triage takes no other words: ${words.join(' ')}.`);
  const extra = Object.entries(options).filter(([name, value]) => !allowed.has(name) && value !== undefined && value !== false && !(name === 'port' && value === '4477'));
  if (extra.length) throw new Error(`triage takes only ${[...allowed].map((name) => `--${name}`).join(', ')}, not ${extra.map(([name]) => `--${name}`).join(', ')}.`);
  const missing = needed.filter((name) => typeof options[name] !== 'string');
  if (missing.length) throw new Error(`triage needs ${missing.map((name) => `--${name}`).join(', ')}. For example: code-map triage --finding <id> --state dismissed --reason <text> --owner <name>`);
  if (!states.includes(options.state)) throw new Error(`--state must be confirmed, dismissed or suppressed, not "${options.state}".`);
  if (options.analysis !== undefined && (options.worktree || options.ref !== undefined)) throw new Error('--analysis already identifies the snapshot. Remove --worktree and --ref.');
  const location = storeLocation(options.store, env), store = location.explicit ? ['--store', location.root] : [];
  const stored = options.analysis !== undefined ? named(repository, location, options.analysis) : current(repository, config, options, location, store);
  const finding = stored.findings.find((item) => item.id === options.finding);
  if (!finding) throw new Error(`No finding ${options.finding} in analysis ${stored.id}. List the findings with: ${commandLine(['code-map', 'inspect', '--analysis', stored.id, '--findings', ...store])}`);
  const entry = { fingerprint: finding.fingerprint, ruleId: finding.ruleId, state: options.state, reason: options.reason, owner: options.owner, date: today,
    ...(options.expires === undefined ? {} : { expires: options.expires }) };
  const errors = entryErrors(entry, today);
  if (errors.length) throw new Error(errors.map(([field, message]) => `--${field}: ${message}`).join('\n'));
  const file = readTriage(repository, today), before = file?.entries ?? [], replaced = before.some((item) => item.fingerprint === entry.fingerprint);
  const entries = [...before.filter((item) => item.fingerprint !== entry.fingerprint), entry].sort(byFingerprint);
  const checked = validateTriage({ triageVersion, entries }, today);
  if (!checked.ok) throw new Error(problems(`The triage file ${file?.path ?? triageFile} would not be valid with this entry:`, checked.errors));
  const digest = writeTriage(repository, entries, file?.digest ?? null), { id, ruleId, title, location: place } = finding;
  return { reportType: 'code-map-triage', schemaVersion: 1, path: triageFile, digest, action: replaced ? 'replaced' : 'added',
    analysis: { id: stored.id }, finding: { id, ruleId, title, location: place }, entry };
}

/** The stored analysis with this ID. It must be an analysis of this repository, because the entry goes into its triage file. */
function named(repository, location, id) {
  const stored = loadAnalysis(location.root, validId(id));
  if (!stored) throw new Error(`Analysis ${id} is not in the store (${location.root}). Run code-map inspect --summary in the repository again. Unchanged code gets the same ID.`);
  if (realPath(stored.inputs.repository) !== realPath(repository)) throw new Error(`Analysis ${id} is of the repository ${stored.inputs.repository}, not of ${repository}. Run code-map triage in that repository.`);
  return stored;
}

/** The stored analysis of the current code, selected as `inspect --summary` selects it (--worktree, --ref or the default branch). */
function current(repository, config, options, location, store) {
  const ref = selectRef(repository, config, options), id = analysisId(analysisInputs(repository, config, options, ref)), stored = loadAnalysis(location.root, id);
  if (stored) return stored;
  const select = options.worktree ? ['--worktree'] : options.ref !== undefined ? ['--ref', options.ref] : [];
  const summary = commandLine(['code-map', 'inspect', '--summary', ...select, ...(options.labels === undefined ? [] : ['--labels', options.labels]), ...store]);
  throw new Error(`No stored analysis of the current code (${id}). Run ${summary} first, or give --analysis <id>.`);
}
