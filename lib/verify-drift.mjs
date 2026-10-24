// Settings drift checks and obligation updates for verification evaluations.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { readLimited } from './verify-reports.mjs';

const maxRequestBytes = 1024 * 1024;

/** The settings files whose content in the working folder differs from the head commit. A file that Code-map cannot read counts as different. */
export function settingsDrift(repository, sha, paths) {
  const current = (path) => { try { return existsSync(join(repository, path)) ? readLimited(join(repository, path), maxRequestBytes, 'settings file').toString('utf8') : null; } catch { return undefined; } };
  const committed = (path) => { try { return git(repository, ['cat-file', 'blob', `${sha}:${path}`]); } catch { return null; } };
  return paths.filter((path) => current(path) !== committed(path));
}

/**
 * Both analyses read the settings in the working folder. For a head commit with other settings there, the settings check fails.
 * When .code-map.json differs, the architecture-rule check stays UNKNOWN, because the head commit can have other rules.
 */
export function withDrift(evaluation, drift) {
  if (!drift.length) return evaluation;
  const evidenceIds = drift.map((path) => `path:${path}`), rulesDrift = drift.includes('.code-map.json');
  const nextAction = 'Undo the settings change in the working folder, or put it aside with git stash, so that the working folder has the settings of the head commit. Then run code-map verify again.';
  const change = (item) => {
    if (item.id === 'completeness.settings-unchanged') {
      const rationale = `The working folder has other settings than the head commit in ${drift.join(', ')}. Both analyses read the settings of the working folder, so a relaxed rule can hide a break.`;
      return { ...item, applicability: 'APPLICABLE', result: 'FAIL', eligible: true, evidenceIds: [...new Set([...evidenceIds, ...(item.result === 'FAIL' ? item.evidenceIds : [])])],
        rationale: item.result === 'FAIL' ? `${rationale} ${item.rationale}` : rationale, nextAction };
    }
    if (item.id !== 'structure.architecture-rules' || !rulesDrift) return item;
    const { applicabilityReason: _, ...rest } = item;
    return { ...rest, applicability: item.applicability === 'NOT_APPLICABLE' ? 'UNKNOWN' : item.applicability, result: 'UNKNOWN', eligible: false, evidenceIds: ['path:.code-map.json'],
      rationale: 'The analyses read the architecture rules from .code-map.json in the working folder, not from the head commit, so this check stays UNKNOWN.', nextAction };
  };
  const updated = withChecks(evaluation, evaluation.obligations.map(change));
  if (!rulesDrift) return updated;
  const input = updated.categories.structuralIntegrity;
  const uncertain = (predicate) => ['si.new-architecture-break', 'si.rules-declared', 'si.no-rule-finding-on-change'].includes(predicate.id)
    ? { ...predicate, met: null, evidenceIds: ['path:.code-map.json'] } : predicate;
  return { ...updated, categories: { ...updated.categories, structuralIntegrity: { ...input,
    fundamental: input.fundamental.map(uncertain),
    bands: Object.fromEntries(Object.entries(input.bands).map(([band, predicates]) => [band, predicates.map(uncertain)])) } } };
}

/** The evaluation with these obligations, also in the rating input of each category. */
export function withChecks(evaluation, obligations) {
  const byId = new Map(obligations.map((item) => [item.id, item]));
  return { ...evaluation, obligations, categories: Object.fromEntries(Object.entries(evaluation.categories).map(([name, input]) =>
    [name, { ...input, obligations: (input.obligations ?? []).map((item) => byId.get(item.id) ?? item) }])) };
}
