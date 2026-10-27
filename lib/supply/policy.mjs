// The supply-chain policy of .code-map.json (the optional "supplyChain" field) and the C34 findings of an inventory: a license
// that the policy denies or does not allow, a host that the policy does not allow, and a downloaded package without an integrity
// value. The last rule needs no policy. Without a policy, no finding is about licenses or hosts. Pure.
import { downloaded } from './lockfile.mjs';

const fields = ['deniedLicenses', 'allowedLicenses', 'allowedHosts'];
const maxEntries = 1000, maxLength = 256;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const lower = (text) => text.toLowerCase();

/**
 * The validated policy, or null without one. An invalid policy throws, so that a policy is never ignored in silence. An empty
 * allowed list allows nothing, which is almost always a mistake, so it is an error too. Hosts compare without letter case.
 */
export function supplyPolicy(value) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error('supplyChain must be an object with deniedLicenses, allowedLicenses or allowedHosts.');
  for (const key of Object.keys(value)) if (![...fields, 'forbidInstallScripts'].includes(key)) throw new Error(`supplyChain.${key} is not a known field. The fields are ${fields.join(', ')}.`);
  if (value.forbidInstallScripts !== undefined && typeof value.forbidInstallScripts !== 'boolean') throw new Error('supplyChain.forbidInstallScripts must be true or false.');
  const list = (key) => {
    const entries = value[key];
    if (entries === undefined) return null;
    if (!Array.isArray(entries) || entries.length > maxEntries || !entries.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= maxLength)) {
      throw new Error(`supplyChain.${key} must be an array of at most ${maxEntries} non-empty strings of at most ${maxLength} characters.`);
    }
    if (key !== 'deniedLicenses' && entries.length === 0) throw new Error(`supplyChain.${key} is empty, so it allows nothing. Name at least one entry, or remove the field.`);
    return [...new Set(entries.map((entry) => entry.trim()))];
  };
  return { ...(value.forbidInstallScripts === undefined ? {} : { forbidInstallScripts: value.forbidInstallScripts }), deniedLicenses: list('deniedLicenses') ?? [], allowedLicenses: list('allowedLicenses'), allowedHosts: list('allowedHosts')?.map(lower) ?? null };
}

/**
 * An SPDX expression as a tree: { op: 'AND' | 'OR', parts } or a leaf { text, base }. "X WITH Y" is one leaf, and `base` is X.
 * Operators can be in any letter case. Text that is not an expression (for example "SEE LICENSE IN LICENSE.md") is one leaf.
 */
function parseExpression(text) {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;
  const word = (name) => tokens[index]?.toUpperCase() === name;
  const list = (name, next) => {
    const parts = [next()];
    while (word(name)) { index++; parts.push(next()); }
    return parts.length === 1 ? parts[0] : { op: name, parts };
  };
  const atom = () => {
    if (tokens[index] === '(') { index++; const inner = list('OR', () => list('AND', atom)); if (tokens[index++] !== ')') throw new Error('unbalanced'); return inner; }
    const id = tokens[index++];
    if (id === undefined || id === ')' || ['AND', 'OR', 'WITH'].includes(id.toUpperCase())) throw new Error('unexpected');
    if (!word('WITH')) return { text: lower(id), base: null };
    index++;
    const exception = tokens[index++];
    if (exception === undefined || exception === '(' || exception === ')') throw new Error('unexpected');
    return { text: `${lower(id)} with ${lower(exception)}`, base: lower(id) };
  };
  try {
    const tree = list('OR', () => list('AND', atom));
    if (index === tokens.length) return tree;
  } catch { /* not an SPDX expression */ }
  return { text: lower(text.trim().replace(/\s+/g, ' ')), base: null };
}

/**
 * 'denied', 'not-allowed' or null. A package can use any one choice of an OR and needs each part of an AND, so an OR is denied
 * only when each choice is denied, and allowed when one choice is allowed. A license with an exception counts as its license.
 */
function licenseBreak(license, { denied, allowed }) {
  const tree = parseExpression(license);
  const holds = (node, set, all) => node.op ? (node.op === 'AND') === all ? node.parts.every((part) => holds(part, set, all)) : node.parts.some((part) => holds(part, set, all))
    : set.has(node.text) || (node.base !== null && set.has(node.base));
  // "denied": an AND is denied when one part is denied, so the test for denied swaps the two operators.
  if (denied.size && holds(tree, denied, false)) return 'denied';
  if (allowed && !holds(tree, allowed, true)) return 'not-allowed';
  return null;
}

/** True when the host is allowed. An entry without a port allows each port of that host. */
const hostAllowed = (hosts, host) => hosts.has(host) || hosts.has(host.replace(/:\d+$/, ''));

/**
 * Adds the findings of one inventory through `add(ruleId, key, finding)` of deriveFindings. Local packages (workspace folders
 * and file dependencies) are the project's own code, so no rule checks them. The key has the lockfile and the package path,
 * not the version or the line, so an upgrade that keeps the problem keeps the finding ID.
 */
export function supplyFindings(supply, add) {
  if (!supply?.lockfile) return;
  const { lockfile, policy } = supply, hosts = policy?.allowedHosts ? new Set(policy.allowedHosts) : null;
  // The sets of the policy are made one time, not for each package.
  const licenses = policy && { denied: new Set(policy.deniedLicenses.map(lower)), allowed: policy.allowedLicenses && new Set(policy.allowedLicenses.map(lower)) };
  for (const item of supply.packages) {
    if (item.kind === 'local') continue;
    const label = `${item.name}@${item.version ?? 'unknown version'}`, location = { path: lockfile, line: item.line, symbol: item.name }, paths = [lockfile];
    const facts = { name: item.name, version: item.version, path: item.path, kind: item.kind };
    const evidence = (text) => [{ path: lockfile, line: item.line, text: `${item.path}: ${text}` }];
    const verdict = licenses && item.license !== null ? licenseBreak(item.license, licenses) : null;
    if (verdict) add('DEPENDENCY-LICENSE', [lockfile, item.path, item.license], { location, paths, facts: { ...facts, license: item.license, verdict }, evidence: evidence(`license ${item.license}`),
      text: `${label} in ${item.path} has the license "${item.license}", which the supplyChain policy in .code-map.json ${verdict === 'denied' ? 'denies' : 'does not allow'}. The lockfile records the license that the package declares.` });
    if (hosts && item.host !== null && !hostAllowed(hosts, item.host)) add('DEPENDENCY-HOST', [lockfile, item.path, item.host], { location, paths, facts: { ...facts, host: item.host },
      evidence: evidence(`resolved from ${item.host}`),
      text: `${label} in ${item.path} comes from ${item.host}, which is not in allowedHosts of the supplyChain policy in .code-map.json. A package from an unexpected host can be a substitute.` });
    if (!item.integrity && downloaded(item)) add('DEPENDENCY-NO-INTEGRITY', [lockfile, item.path], { location, paths, facts: { ...facts, host: item.host }, evidence: evidence('no integrity value'),
      text: `${label} in ${item.path} has no integrity value in ${lockfile}, so npm cannot check the downloaded file against a known digest.` });
  }
}
