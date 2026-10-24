// Compares the findings of a base analysis with those of a head analysis: NEW, EXISTING, RESOLVED or UNKNOWN.
// Pure: the caller supplies both stored analyses, the Git renames between them, whether that list is complete, and the comparability verdict.
// A match is a statement about findings (static leads), not a test result. Nothing is subtracted or scored.
import { findingRules, fingerprintOf } from './findings.mjs';

const unitRules = new Set(['TEST-NO-FAILURE-ASSERTION', 'TEST-UNREACHED', 'TEST-EXIT-NOT-RUN']);
const listRules = new Set(['CYCLE-VALUE', 'CYCLE-ALL']);
/** The positions of paths in each identity key; every other rule has its path first. */
const pathPositions = { 'ARCH-RULE': [1, 2], 'IMPORT-NAME-MISSING': [0, 1], 'OWNER-CROSS-IMPORT': [0, 1], 'FIX-WITHOUT-TEST': [], 'NEXT-SERVER-IMPORT-IN-CLIENT': [0, 2], 'OPENAPI-PARAM-NAME': [0, 2] };

/** Two stored analyses can be compared only when the same analyzer, configuration, environment and source roots produced them. */
export function comparability(base, head) {
  // A value that is unknown (null) on either side is never the same.
  const same = (pick) => pick(base) !== null && pick(head) !== null && JSON.stringify(pick(base)) === JSON.stringify(pick(head));
  // Without configured roots, each commit gets its roots from its own file list, so one configuration can map other files.
  const roots = (stored) => Array.isArray(stored.data?.roots) ? stored.data.roots : null;
  const reasons = [['repository', (s) => s.inputs.repository], ['analyzer', (s) => [s.inputs.analyzer?.version, s.inputs.analyzer?.source]], ['config', (s) => s.inputs.config],
    ['environment', (s) => [s.inputs.analyzer?.typescript, s.inputs.analyzer?.node, s.inputs.python ?? null]], ['roots', roots]].filter(([, pick]) => !same(pick)).map(([kind]) => kind);
  return { state: reasons.length ? 'NOT_COMPARABLE' : 'COMPARABLE', reasons };
}

/** The identity key with each path moved through the renames. Cycle members are sorted again, as when they were found. */
export function remapKey(ruleId, key, rename) {
  if (listRules.has(ruleId)) return key.map(rename).sort();
  if (unitRules.has(ruleId)) return key.map((unit) => { const cut = unit.lastIndexOf('#'); return rename(unit.slice(0, cut)) + unit.slice(cut); });
  const positions = pathPositions[ruleId] ?? [0];
  return key.map((part, index) => positions.includes(index) ? rename(part) : part);
}

const measuredBoth = (base, head) => [base, head].every((stored) => stored.data.analysis.tests?.coverage?.state === 'measured');
const filesOf = (stored) => {
  const { analysis } = stored.data, tests = analysis.tests;
  return new Set([...analysis.files.map((file) => file.path), ...(analysis.importFiles ?? []).map((file) => file.path), ...(tests?.testFiles ?? []).map((file) => file.path), ...(tests?.unreadable ?? []),
    ...(analysis.packages?.manifests ?? []).map((item) => item.path), ...(analysis.supply?.lockfiles ?? []).map((entry) => entry.path)]);
};

/**
 * `statuses[headId]` is { baseline, matchedBy, base }: EXISTING through the same fingerprint or a rename, NEW, or UNKNOWN
 * ('not-comparable', 'not-measured', 'changed-in-move', 'ambiguous', 'rule-base-changed', 'renames-incomplete'). `resolved` and
 * `baseUnknown` hold base findings with their paths in head terms (after renames), for a scope filter. `complete` is false when
 * the rename list can miss renames: an unmatched finding is then UNKNOWN, not NEW or RESOLVED.
 */
export function compareFindings(base, head, { renames = [], complete = true, olderFixCommits = new Set(), comparability: verdict }) {
  const statuses = {}, resolved = [], baseUnknown = [];
  const status = (finding, baseline, matchedBy, baseId = null) => { statuses[finding.id] = { baseline, matchedBy, base: baseId }; };
  if (verdict.state !== 'COMPARABLE') {
    for (const finding of head.findings) status(finding, 'UNKNOWN', 'not-comparable');
    return { state: verdict.state, reasons: verdict.reasons, counts: { new: 0, existing: 0, resolved: 0, unknown: head.findings.length }, statuses, resolved, baseUnknown };
  }
  const moves = new Map(renames.map((item) => [item.from, item])), rename = (path) => moves.get(path)?.to ?? path;
  const changedFrom = new Set(renames.filter((item) => item.similarity < 100).map((item) => item.from));
  const changedTo = new Set(renames.filter((item) => item.similarity < 100).map((item) => item.to));
  const measured = measuredBoth(base, head), unmeasured = (finding) => findingRules[finding.ruleId]?.source === 'measured' && !measured;
  const byFingerprint = new Map(head.findings.map((finding) => [finding.fingerprint, finding])), candidates = new Map(), headFiles = filesOf(head);
  // A new common folder gives every file another module, so a rule can stop or start to match an unchanged import.
  // A layer rule matches globs on the whole path, so the common folder does not change it.
  const ruleBaseMoved = base.data.analysis.rules?.base !== head.data.analysis.rules?.base;
  const unsure = (finding, changed) => finding.ruleId === 'ARCH-RULE' && ruleBaseMoved && !finding.facts?.layers ? 'rule-base-changed'
    : finding.paths.some((path) => changed.has(path)) ? 'changed-in-move' : !complete ? 'renames-incomplete' : null;
  for (const finding of base.findings) {
    const paths = finding.paths.map(rename);
    if (unmeasured(finding)) { baseUnknown.push({ finding, paths, matchedBy: 'not-measured' }); continue; }
    const mapped = finding.key ? fingerprintOf(finding.ruleId, remapKey(finding.ruleId, finding.key, rename)) : finding.fingerprint;
    const target = byFingerprint.get(mapped);
    if (target) { candidates.set(target.id, [...(candidates.get(target.id) ?? []), { finding, paths, matchedBy: mapped === finding.fingerprint ? 'fingerprint' : 'rename' }]); continue; }
    // A commit and its file list never change, so an unmatched fix commit only left the head's window of recent commits.
    const reason = finding.ruleId === 'FIX-WITHOUT-TEST' ? 'outside-window' : unsure(finding, changedFrom);
    if (reason) baseUnknown.push({ finding, paths, matchedBy: reason });
    else resolved.push({ finding, paths, matchedBy: headFiles.has(rename(finding.location.path)) ? 'absent' : 'path-removed' });
  }
  for (const finding of head.findings) {
    const matches = candidates.get(finding.id) ?? [];
    if (unmeasured(finding)) status(finding, 'UNKNOWN', 'not-measured');
    else if (matches.length > 1) { status(finding, 'UNKNOWN', 'ambiguous'); baseUnknown.push(...matches.map((match) => ({ finding: match.finding, paths: match.paths, matchedBy: 'ambiguous' }))); }
    else if (matches.length === 1) status(finding, 'EXISTING', matches[0].matchedBy, matches[0].finding.id);
    else {
      // A fix commit that the base history holds is not new: it was only outside the base's window of recent commits.
      const reason = finding.ruleId === 'FIX-WITHOUT-TEST' && olderFixCommits.has(finding.key?.[0]) ? 'outside-window' : unsure(finding, changedTo);
      status(finding, reason ? 'UNKNOWN' : 'NEW', reason);
    }
  }
  const values = Object.values(statuses), count = (baseline) => values.filter((item) => item.baseline === baseline).length;
  return { state: 'COMPARABLE', reasons: [], counts: { new: count('NEW'), existing: count('EXISTING'), resolved: resolved.length, unknown: count('UNKNOWN') + baseUnknown.length },
    statuses, resolved, baseUnknown };
}
