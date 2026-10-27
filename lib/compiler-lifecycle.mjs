// Diagnostic identity and lifecycle from validated, revision-bound compiler reports. Pure information, outside all rule sets.
import { toolOf } from './adapters/python-diagnostics.mjs';
import { createHash } from 'node:crypto';

/** Remove quoted type names and embedded source coordinates. Keep diagnostic codes and other numeric evidence. */
export function normalizedMessage(message, tool = 'tsc') {
  const names = tool === 'tsc' ? message : message.replace(/('[^']*'|"[^"]*"|`[^`]*`)/g, '<quoted>');
  const input = tool === 'mypy' ? names.replace(/\s+\[[\w-]+\]\s*$/gm, '') : names;
  return input.replace(/\btype\s+('[^']*'|"[^"]*"|`[^`]*`)/gi, 'type <quoted>')
    .replace(/\b(line|column)\s+\d+\b/gi, '$1 #').replace(/\(\d+,\s*\d+\)/g, '(#,#)')
    .replace(/:\d+:\d+\b/g, ':#:#').replace(/\s+/g, ' ').trim();
}
const fingerprint = (item, file) => createHash('sha256').update(JSON.stringify([file, item.category, item.code, normalizedMessage(item.message, item.tool ?? 'tsc'), ...(item.tool && item.tool !== 'tsc' ? [item.tool] : [])])).digest('hex').slice(0, 16);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const signature = (report) => JSON.stringify(canonical(report.run));
export function interruptedCompilerReport(report) {
  const tool = toolOf(report.kind);
  if (report.incomplete || report.outside > 0 || (tool !== 'tsc' && ![0, 1].includes(report.exitStatus))) return true;
  const normalNonErrorExit = report.exitStatus === 1 && ((tool === 'ruff' && report.diagnostics.length > 0)
    || (tool === 'pyright' && report.diagnostics.some((item) => item.category === 'warning')));
  if (report.exitStatus !== 0 && report.errors === 0 && !normalNonErrorExit) return true;
  return tool === 'tsc' && report.diagnostics.some((item) => item.category === 'error' && (item.file === null || (item.code >= 1000 && item.code < 2000)
    || (item.code >= 5000 && item.code < 6000) || (item.code >= 8000 && item.code < 8020) || (item.code >= 17000 && item.code < 18000)));
}

/** A unique unfiltered report on each side establishes absence only with comparable runs and complete rename evidence. */
function lifecycleForTool({ head = [], base = [] }, { comparable = false, renames = [], complete = false } = {}) {
  const moves = new Map(renames.map((move) => [move.from, move.to])), reverse = new Map(renames.map((move) => [move.to, move.from]));
  const fromCounts = new Map(), toCounts = new Map();
  for (const move of renames) { fromCounts.set(move.from, (fromCounts.get(move.from) ?? 0) + 1); toCounts.set(move.to, (toCounts.get(move.to) ?? 0) + 1); }
  const ambiguous = new Set(renames.filter((move) => fromCounts.get(move.from) > 1 || toCounts.get(move.to) > 1).flatMap((move) => [move.from, move.to]));
  const edited = new Set(renames.filter((move) => move.similarity < 100).flatMap((move) => [move.from, move.to]));
  const reason = !comparable ? 'not-comparable' : !head.length || !base.length ? 'missing-report'
    : head.length !== 1 || base.length !== 1 ? 'multiple-reports'
    : [...head, ...base].some((report) => report.filtered || interruptedCompilerReport(report)) ? 'incomplete-report'
    : signature(head[0]) !== signature(base[0]) ? 'different-runs' : null;
  const flatten = (reports, side) => reports.flatMap((report) => report.diagnostics.map((diagnostic) => ({ side, artifact: report.artifact, diagnostic: { ...diagnostic, tool: diagnostic.tool ?? toolOf(report.kind) },
    fingerprint: fingerprint({ ...diagnostic, tool: diagnostic.tool ?? toolOf(report.kind) }, side === 'head' ? reverse.get(diagnostic.file) ?? diagnostic.file : diagnostic.file) })));
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

/** Compare each producer separately. A tsc report cannot establish absence for a Python tool. */
export function compilerLifecycle({ head = [], base = [] }, options = {}) {
  const tools = [...new Set([...head, ...base].map((report) => toolOf(report.kind)))];
  if (tools.length <= 1) return lifecycleForTool({ head, base }, options);
  const groups = tools.map((tool) => ({ tool, ...lifecycleForTool({ head: head.filter((report) => toolOf(report.kind) === tool),
    base: base.filter((report) => toolOf(report.kind) === tool) }, options) }));
  const counts = Object.fromEntries(['new', 'existing', 'resolved', 'unknown'].map((label) => [label, groups.reduce((sum, group) => sum + group.counts[label], 0)]));
  return { informationOnly: true, counts, entries: groups.flatMap((group) => group.entries), reason: groups.find((group) => group.reason)?.reason ?? null,
    tools: groups.map(({ tool, counts, reason }) => ({ tool, counts, reason })), limits: [...new Set(groups.flatMap((group) => group.limits))] };
}
