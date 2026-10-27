// Revision policy information supplements the existing analysis inputs. It never supplies a profile check.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { sourceReader } from './git.mjs';
import { canonical } from './inputs.mjs';
import { settingsProblems } from './project.mjs';
import { ruleViolations } from './rules.mjs';
import { layerViolations, withLayers } from './layers.mjs';
import { ownershipOf, codeownersPaths } from './codeowners.mjs';
import { compareApi } from './api-compare.mjs';

/** Read only the architecture policy from the selected snapshot. Missing settings mean an empty policy. */
function readPolicy(repository, ref) {
  const reader = sourceReader(repository, ref), stat = reader.stat(['.code-map.json']).get('.code-map.json');
  if (!stat) return { rules: [], layers: [], exceptions: [], ownership: null };
  if (!stat.file || stat.link || stat.size > 1024 * 1024) throw new Error('The revision policy must be a regular file of at most 1 MiB.');
  const parsed = JSON.parse(reader.read(['.code-map.json']).get('.code-map.json'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The revision policy must be an object.');
  const { rules = [], layers = [], allowed = [], layerExceptions = [], ownership } = parsed;
  if (!Array.isArray(rules) || rules.some((item) => typeof item !== 'string')) throw new Error('The revision rules must be strings.');
  const problems = settingsProblems({ layers, allowed, layerExceptions, ownership });
  if (problems.length) throw new Error(problems.join(' '));
  return { rules, layers, exceptions: [...allowed, ...layerExceptions], ownership: ownership ?? null };
}

const difference = (before, after) => before.filter((item) => !after.includes(item));
const filesOf = (stored) => stored.data.analysis.files.map((file) => ({ path: file.path,
  imports: [...new Set(file.imports.map((edge) => edge.target).filter((target) => target !== null))], edges: file.imports }));
function ownerEvidence(repository, ref) {
  const reader = sourceReader(repository, ref), stats = reader.stat(codeownersPaths);
  const path = codeownersPaths.find((name) => stats.has(name));
  if (!path) return null;
  const stat = stats.get(path);
  if (ref === null && path.includes('/') && lstatSync(join(repository, path.split('/')[0])).isSymbolicLink()) {
    return { path, problem: 'CODEOWNERS has a symlinked parent folder.' };
  }
  if (!stat.file || stat.link || stat.size >= 3 * 1024 * 1024) return { path, problem: 'CODEOWNERS is unreadable or too large.' };
  return { path, text: reader.read([path]).get(path) };
}
const evaluate = (files, policy, codeowners) => {
  const result = withLayers(ruleViolations(files, policy.rules), files, policy.layers, policy.exceptions);
  const ownership = ownershipOf(files, codeowners, policy.ownership);
  if (ownership) {
    ownership.state = policy.ownership?.forbidCrossOwnerImports && (!codeowners || ownership.ignored.length || ownership.unowned) ? 'UNKNOWN' : 'OBSERVED';
    if (ownership.state === 'UNKNOWN') ownership.reason = 'Ownership evidence is missing, unreadable or incomplete.';
  }
  return { ...result, ownership, violations: [...result.violations,
    ...(ownership?.violations ?? []).map((item) => ({ ...item, rule: 'OWNER-CROSS-IMPORT' }))] };
};
const witness = (item) => canonical([item.rule, item.from, item.to]);
const edgeKey = (item) => canonical([item.from, item.to]);

/** Evaluate both snapshots under both revision policies. Invalid historical policy stays explicitly unknown. */
export function revisionPolicy(head, base) {
  try {
    const repository = head.inputs.repository, before = readPolicy(repository, base.data.sha);
    const after = readPolicy(repository, head.inputs.selector.worktree ? null : head.data.sha);
    const baseFiles = filesOf(base), headFiles = filesOf(head);
    const baseOwners = ownerEvidence(repository, base.data.sha), headOwners = ownerEvidence(repository, head.inputs.selector.worktree ? null : head.data.sha);
    const evaluations = { basePolicy: { base: evaluate(baseFiles, before, baseOwners), head: evaluate(headFiles, before, headOwners) },
      headPolicy: { base: evaluate(baseFiles, after, baseOwners), head: evaluate(headFiles, after, headOwners) } };
    const was = new Map(before.layers.map((item) => [item.name, item])), now = new Map(after.layers.map((item) => [item.name, item]));
    const relaxed = new Map();
    for (const side of ['base', 'head']) {
      const current = new Set(evaluations.headPolicy[side].violations.map(edgeKey));
      for (const item of evaluations.basePolicy[side].violations) if (!current.has(edgeKey(item))) relaxed.set(witness(item), item);
    }
    return { informationOnly: true, state: canonical(before) === canonical(after) ? 'UNCHANGED' : 'CHANGED', base: before, head: after,
      rules: { added: difference(after.rules, before.rules), removed: difference(before.rules, after.rules) },
      layers: { added: difference([...now.keys()], [...was.keys()]), removed: difference([...was.keys()], [...now.keys()]),
        reordered: [...now.keys()].filter((name) => was.has(name) && before.layers.findIndex((item) => item.name === name) !== after.layers.findIndex((item) => item.name === name)),
        relaxed: difference(layerViolations([], before.layers, before.exceptions)?.declared ?? [], layerViolations([], after.layers, after.exceptions)?.declared ?? []),
        changed: [...now.keys()].filter((name) => was.has(name) && canonical(was.get(name)) !== canonical(now.get(name))) },
      relaxed: [...relaxed.values()], evaluations };
  } catch (error) {
    return { informationOnly: true, state: 'UNKNOWN', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Public export changes are information. Null permission means that the request supplies no public scope. */
export function publicInterfaceInformation(head, comparison, allowed = null) {
  const { base, renames, complete, result } = comparison;
  const changes = compareApi(base, head, { renames, complete, state: result.state, reasons: result.reasons });
  return { informationOnly: true, state: changes.state, reasons: changes.reasons, allowedPublicChanges: allowed,
    items: changes.items.filter((item) => item.group === 'public').map((item) => ({ ...item, allowed: allowed === null ? null : allowed.includes(item.name) })) };
}
