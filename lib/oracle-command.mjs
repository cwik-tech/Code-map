// Records a person's oracle for a case in the stored analysis of the current working tree.
import { analysisId, analysisInputs } from './inputs.mjs';
import { loadAnalysis, storeLocation } from './store.mjs';
import { oracleTestBytes } from './oracle-files.mjs';
import { caseName } from './profiles/static-baseline-v0.mjs';
import { oracleDigest, oracleFile, readOracles, writeOracles } from './oracles.mjs';
const needed = ['case', 'criterion', 'method', 'confirmed-by'];
const allowed = new Set([...needed, 'store', 'compact']);
/** The shell injects the date. This function never asserts that a model is a person. */
export function recordOracle(repository, config, options, { today, words = [], env = process.env }) {
  if (words.length) throw new Error('oracle takes no extra words.');
  const extra = Object.entries(options).filter(([name, value]) => !allowed.has(name) && value !== undefined && value !== false && !(name === 'port' && value === '4477'));
  if (extra.length) throw new Error(`oracle does not accept ${extra.map(([name]) => `--${name}`).join(', ')}.`);
  for (const name of needed) if (typeof options[name] !== 'string' || !options[name].trim()) throw new Error(`oracle needs --${name}.`);
  const location = storeLocation(options.store, env), inputs = analysisInputs(repository, config, { worktree: true }, null);
  const stored = loadAnalysis(location.root, analysisId(inputs));
  if (!stored) throw new Error('No stored analysis of current code. Run code-map inspect --summary --worktree first, with the same --store.');
  const cases = stored.data.analysis.tests?.cases ?? [], nameOf = (x) => caseName({ ...x, file: x.path });
  const found = cases.filter((x, index) => options.case === `case:${index}` || options.case === `case:${nameOf(x)}`
    || options.case.startsWith('case:') && options.case.endsWith(`:${nameOf(x)}`));
  if (found.length !== 1) throw new Error(`The case evidence ID ${options.case} must identify exactly one current stored case.`);
  const item = found[0], texts = oracleTestBytes(stored, [item.path]);
  if (!texts.has(item.path)) throw new Error('Cannot read the current test file safely.');
  const entry = { file: item.path, suite: item.suite ?? null, name: item.name, criterion: options.criterion, digest: oracleDigest(texts.get(item.path)),
    method: options.method, confirmedBy: options['confirmed-by'], date: today };
  const before = readOracles(repository), same = (x) => x.file === entry.file && x.suite === entry.suite && x.name === entry.name && x.criterion === entry.criterion;
  const entries = [...(before?.entries ?? []).filter((x) => !same(x)), entry];
  const current = analysisInputs(repository, config, { worktree: true }, null);
  if (analysisId(current) !== stored.id) throw new Error('The current code changed while recording the oracle. Analyze it again.');
  const digest = writeOracles(repository, entries, before?.digest ?? null);
  return { reportType: 'code-map-oracle', schemaVersion: 1, path: oracleFile, digest, entry };
}
