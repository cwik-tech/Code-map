// Optional compiler evidence is information only. Accepted rating checks never read this section.
import { plain } from '../verify-markdown.mjs';
import { compareApi, surfaces } from '../api-compare.mjs';
import { compilerCoverage } from './discovery.mjs';
import { symbolImpact } from './impact.mjs';

/** New typed observations do not alter the profile checks, ratings, or readiness. */
export function typeInformation(base, head, comparison, change, fileReports = []) {
  const typed = head.data.analysis.typed;
  if (!typed && !fileReports.length) return undefined;
  const api = compareApi(base, head, { renames: comparison.renames, complete: comparison.complete,
    state: comparison.result.state, reasons: comparison.result.reasons });
  const publicChanges = api.items.filter((item) => item.group === 'public');
  const surface = surfaces(head.data.analysis.api.files);
  const affected = (call) => publicChanges.some((item) => {
    if (item.status !== 'CHANGED') return false;
    const record = surface(item.path).get(item.name);
    return call.export.path === item.path && call.export.name === item.name
      || call.export.path === record?.declaredIn && call.export.name === (record?.declaredName ?? item.name);
  });
  const impact = symbolImpact(api.items, head.data.analysis, { base: base.data.analysis, renames: comparison.renames });
  const targetOf = (ref) => {
    if (ref.target) return ref.target;
    const oldPath = comparison.renames.find((item) => item.to === ref.path)?.from ?? ref.path;
    return base.data.analysis.files.find((file) => file.path === oldPath)?.imports.find((edge) => edge.specifier === ref.specifier)?.target;
  };
  const stale = (typed?.references ?? []).filter((ref) => {
    const target = targetOf(ref);
    return typeof target === 'string' && api.items.some((item) => ['REMOVED', 'RENAMED'].includes(item.status)
      && (item.pair?.from ?? item.name) === ref.name && [item.path, item.basePath, item.base?.declaredIn].includes(target));
  });
  const coverage = compilerCoverage(change.files.filter((file) => file.status !== 'D').map((file) => file.path), typed, fileReports);
  return { state: typed?.state ?? 'UNKNOWN', reason: typed?.reason ?? null, compilerCoverage: coverage,
    typeCheck: { state: coverage.state === 'UNKNOWN' ? 'UNKNOWN' : 'DISCOVERED', unchecked: coverage.unchecked,
      note: 'File discovery does not replace bound compiler diagnostics.' },
    programs: typed?.programs ?? [], api: publicChanges, calls: (typed?.calls ?? []).filter(affected),
    symbolImpact: impact, staleReferences: stale,
    limits: ['External and dynamic consumers remain unknown.', 'Compiler library types use the installed Code-map TypeScript.',
      'Project dependencies outside the snapshot are unresolved. Unknown argument types never establish compatibility.'] };
}
/** Compact Markdown keeps compiler information separate from the accepted check table. */
export function typeLines(types, limit = 10) {
  if (!types) return [];
  return ['## Compiler information', '', `Typed facts: ${types.state}. File discovery: ${types.compilerCoverage.state}.`,
    ...types.compilerCoverage.unchecked.slice(0, limit).map((path) => `- Unchecked: ${plain(path)}`),
    `Incompatible changed-public-export calls: ${types.calls.filter((call) => call.compatibility === 'INCOMPATIBLE').length}.`,
    `Type-aware stale references: ${types.staleReferences.length}. Symbol walk truncated: ${types.symbolImpact.truncated}.`, '',
    'These observations do not change the selected rule set.', ''];
}
