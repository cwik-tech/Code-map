// The supply-chain parts of a summary: the counts of the inventory, the dependency change from a base analysis, the evidence
// gaps, and the complete lists for the --dependencies pages. Pure: the caller gives the inventories and the `next` commands.
import { compareSupply } from './compare.mjs';
import { downloaded } from './lockfile.mjs';

const defaultHost = 'registry.npmjs.org';
/** The summary shows at most this many licenses and this many examples of the dependency change. The pages have all of them. */
const licensesShown = 20, examplesShown = 5;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const remote = (supply) => supply.packages.filter((item) => item.kind !== 'local');

/** The counts of all packages, then the counts of the packages that are not local. */
function counts(supply) {
  const list = remote(supply), count = (test) => list.filter(test).length;
  return { packages: supply.packages.length, local: supply.packages.length - list.length, dev: count((item) => item.dev === true), optional: count((item) => item.optional === true),
    peer: count((item) => item.peer === true), installScripts: count((item) => item.installScript === true), withoutIntegrity: count((item) => downloaded(item) && !item.integrity),
    otherHosts: count((item) => item.host !== null && item.host !== defaultHost), unknownHost: count((item) => downloaded(item) && item.host === null) };
}

/** The licenses of the packages that are not local, most frequent first. `license: null` counts the packages without one. */
function licenses(supply) {
  const tally = new Map();
  for (const item of remote(supply)) tally.set(item.license, (tally.get(item.license) ?? 0) + 1);
  const items = [...tally].map(([license, count]) => ({ license, count }))
    .sort((a, b) => b.count - a.count || (a.license === null) - (b.license === null) || (a.license < b.license ? -1 : a.license > b.license ? 1 : 0));
  return { total: items.length, items: items.slice(0, licensesShown) };
}

/** The `supply` part of a summary. `next` is the command for the complete package list. */
export function supplyView(supply, next) {
  const read = supply.lockfile !== null;
  return { lockfile: supply.lockfile, lockfileVersion: supply.lockfileVersion, lockfiles: supply.lockfiles, nested: supply.nested,
    counts: read ? counts(supply) : null, licenses: read ? licenses(supply) : null, policy: supply.policy, next: read ? next : null };
}

/**
 * The `supply` part of a comparison: none when neither analysis has a lockfile, null when the analyses are not comparable (as
 * for the complexity change), and otherwise the counts, at most five examples and the command for the complete list.
 */
export function supplyChange(comparison, head, next) {
  const base = comparison.base.data.analysis.supply;
  if (!base && !head) return {};
  if (comparison.result.state !== 'COMPARABLE') return { supply: null };
  const change = compareSupply(base ?? null, head ?? null);
  return { supply: { state: change.state, reasons: change.reasons, counts: change.counts, examples: change.changes.slice(0, examplesShown), next: change.state === 'compared' ? next : null } };
}

/** The complete list of a --dependencies page: the packages of the head, or with a comparison the dependency changes. */
export function dependencyList(supply, comparison) {
  if (!comparison) return { view: supply ? { lockfile: supply.lockfile, counts: supply.lockfile === null ? null : counts(supply) } : null, items: supply?.packages ?? [] };
  const base = comparison.base.data.analysis.supply;
  if ((!base && !supply) || comparison.result.state !== 'COMPARABLE') return { view: null, items: [] };
  const change = compareSupply(base ?? null, supply ?? null);
  return { view: { state: change.state, reasons: change.reasons, counts: change.counts }, items: change.changes };
}

/** The evidence that the inventory cannot give, in the shape of the summary gaps: { key, source, text, count }. */
export function supplyGaps(supply) {
  if (!supply) return [];
  const gaps = [], add = (key, text, count) => gaps.push({ key, source: 'inventory', ...(count === undefined ? {} : { count }), text });
  const unreadable = supply.lockfiles.filter((entry) => ['invalid', 'too-large', 'unsupported-version'].includes(entry.state));
  for (const entry of unreadable) add('lockfileUnreadable', `Code-map cannot read ${entry.path}: ${entry.error} No dependency evidence comes from it.`, 1);
  const others = supply.lockfiles.filter((entry) => entry.state === 'not-read' || entry.state === 'ignored'), nested = supply.nested.count;
  if (others.length || nested) {
    const named = [...others.map((entry) => entry.state === 'ignored' ? `${entry.path} (another root lockfile takes precedence)` : `${entry.path} (${entry.manager})`),
      ...(nested ? [`${plural(nested, 'lockfile')} in subfolders, for example ${supply.nested.paths[0]}`] : [])];
    add('lockfilesNotRead', `Code-map reads one supported lockfile at the repository root. These lockfiles are not read: ${named.join(', ')}.`, others.length + nested);
  }
  const npmV1 = supply.lockfileVersion === 1 && ['package-lock.json', 'npm-shrinkwrap.json'].includes(supply.lockfile);
  if (npmV1) add('lockfileVersion1', 'The lockfile has version 1, which records no install scripts, no licenses and no peer flags. Their counts and the license policy do not cover it.', supply.packages.length);
  const policy = supply.policy, list = remote(supply);
  const unlicensed = list.filter((item) => item.license === null).length, hostless = list.filter((item) => downloaded(item) && item.host === null).length;
  if (!npmV1 && unlicensed && (policy?.deniedLicenses.length || policy?.allowedLicenses)) {
    add('licensesUnknown', `${plural(unlicensed, 'package has', 'packages have')} no license in the lockfile, so the license policy does not cover ${unlicensed === 1 ? 'it' : 'them'}.`, unlicensed);
  }
  if (hostless && policy?.allowedHosts) add('hostsUnknown', `${plural(hostless, 'package has', 'packages have')} no resolved URL in the lockfile, so the host policy does not cover ${hostless === 1 ? 'it' : 'them'}.`, hostless);
  add('advisories', 'Inspection uses no advisory database. code-map verify reads bound npm-audit and osv-snapshot reports as information. Refer to docs/verify.md.', undefined);
  return gaps;
}
