// Diagnostic identity and lifecycle from validated, revision-bound compiler reports. Pure information, outside all rule sets.
import { createHash } from 'node:crypto';

/** Remove quoted type names and embedded source coordinates. Keep diagnostic codes and other numeric evidence. */
export function normalizedMessage(message) {
  return message.replace(/\btype\s+('[^']*'|"[^"]*"|`[^`]*`)/gi, 'type <quoted>')
    .replace(/\b(line|column)\s+\d+\b/gi, '$1 #').replace(/\(\d+,\s*\d+\)/g, '(#,#)')
    .replace(/:\d+:\d+\b/g, ':#:#').replace(/\s+/g, ' ').trim();
}
const fingerprint = (item, file) => createHash('sha256').update(JSON.stringify([file, item.category, item.code, normalizedMessage(item.message)])).digest('hex').slice(0, 16);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const signature = (report) => JSON.stringify(canonical(report.run));
const interrupted = (report) => report.outside > 0 || (report.exitStatus !== 0 && report.errors === 0)
  || report.diagnostics.some((item) => item.category === 'error' && (item.file === null || (item.code >= 1000 && item.code < 2000)
    || (item.code >= 5000 && item.code < 6000) || (item.code >= 8000 && item.code < 8020) || (item.code >= 17000 && item.code < 18000)));

/** A unique unfiltered report on each side establishes absence only with comparable runs and complete rename evidence. */
export function compilerLifecycle({ head = [], base = [] }, { comparable = false, renames = [], complete = false } = {}) {
  const moves = new Map(renames.map((move) => [move.from, move.to])), reverse = new Map(renames.map((move) => [move.to, move.from]));
  const fromCounts = new Map(), toCounts = new Map();
  for (const move of renames) { fromCounts.set(move.from, (fromCounts.get(move.from) ?? 0) + 1); toCounts.set(move.to, (toCounts.get(move.to) ?? 0) + 1); }
  const ambiguous = new Set(renames.filter((move) => fromCounts.get(move.from) > 1 || toCounts.get(move.to) > 1).flatMap((move) => [move.from, move.to]));
  const edited = new Set(renames.filter((move) => move.similarity < 100).flatMap((move) => [move.from, move.to]));
  const reason = !comparable ? 'not-comparable' : !head.length || !base.length ? 'missing-report'
    : head.length !== 1 || base.length !== 1 ? 'multiple-reports'
    : [...head, ...base].some((report) => report.filtered || interrupted(report)) ? 'incomplete-report'
    : signature(head[0]) !== signature(base[0]) ? 'different-runs' : null;
  const flatten = (reports, side) => reports.flatMap((report) => report.diagnostics.map((diagnostic) => ({ side, artifact: report.artifact, diagnostic,
    fingerprint: fingerprint(diagnostic, side === 'head' ? reverse.get(diagnostic.file) ?? diagnostic.file : diagnostic.file) })));
  const before = flatten(base, 'base'), after = flatten(head, 'head'), group = (entries) => {
    const map = new Map();
    for (const entry of entries) {
      const group = map.get(entry.fingerprint) ?? [];
      group.push(entry); map.set(entry.fingerprint, group);
    }
    return map;
  };
  const old = group(before), fresh = group(after), entries = [], consumed = new Set();
  for (const entry of after) {
    const matches = old.get(entry.fingerprint) ?? [], duplicates = matches.length > 1 || fresh.get(entry.fingerprint).length > 1;
    const unknown = reason ?? (ambiguous.has(entry.diagnostic.file) ? 'ambiguous-rename' : duplicates ? 'ambiguous' : !complete ? 'renames-incomplete' : edited.has(entry.diagnostic.file) && !matches.length ? 'changed-in-move' : null);
    const baseline = unknown ? 'UNKNOWN' : matches.length ? 'EXISTING' : 'NEW';
    if (baseline === 'EXISTING') consumed.add(entry.fingerprint);
    entries.push({ ...entry, baseline, matchedBy: unknown ?? (matches.length ? moves.has(matches[0].diagnostic.file) ? 'rename' : 'fingerprint' : 'absent'),
      ...(baseline === 'EXISTING' ? { previousFingerprint: matches[0].fingerprint } : {}) });
  }
  for (const entry of before) {
    if (consumed.has(entry.fingerprint)) continue;
    const unknown = reason ?? (ambiguous.has(entry.diagnostic.file) ? 'ambiguous-rename' : fresh.has(entry.fingerprint) || old.get(entry.fingerprint).length > 1 ? 'ambiguous'
      : !complete ? 'renames-incomplete' : edited.has(entry.diagnostic.file) ? 'changed-in-move' : null);
    entries.push({ ...entry, baseline: unknown ? 'UNKNOWN' : 'RESOLVED', matchedBy: unknown ?? 'absent' });
  }
  const count = (label) => entries.filter((entry) => entry.baseline === label).length;
  return { informationOnly: true, counts: { new: count('NEW'), existing: count('EXISTING'), resolved: count('RESOLVED'), unknown: count('UNKNOWN') },
    reason, entries, limits: ['Reports and their discovery scope are self-attested. Diagnostics do not establish compiler file discovery.',
      'Quoted type names are normalized. Repeated normalized identities are ambiguous. Multiple reports per side cannot establish individual lifecycle.'] };
}
