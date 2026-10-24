// Python syntax compatibility is informational and never changes a rating rule.
import { compareApi } from '../api-compare.mjs';
import { callSites } from '../impact/calls.mjs';

export function pythonApiInformation(base, head, comparison) {
  const python = head.data.analysis.api?.python ?? {};
  if (!Object.keys(python).length && !Object.keys(base.data.analysis.api?.python ?? {}).length) return undefined;
  const changes = compareApi(base, head, { renames: comparison.renames, complete: comparison.complete,
    state: comparison.result.state, reasons: comparison.result.reasons });
  const items = changes.items.filter((i) => /\.pyi?$/.test(i.path));
  // Call facts were parsed with these source files in this exact snapshot.
  const calls = callSites(items, head, new Map(Object.keys(python).map((path) => [path, ''])));
  return { informationOnly: true, state: changes.state, reasons: changes.reasons, items, calls,
    unknownModules: Object.entries(python).filter(([, p]) => p.publicApi.state === 'UNKNOWN' || p.publicApi.unknownNames.length)
      .map(([path, p]) => ({ path, reason: p.publicApi.reason, names: p.publicApi.unknownNames })),
    limits: ['Annotations are compared as text. No Python type checker runs.', 'External and dynamic consumers remain UNKNOWN.'] };
}
