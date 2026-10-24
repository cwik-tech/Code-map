// The documentation of the public API (capability C33). In each snapshot: the exports of the package entry points without
// a JSDoc comment on their declaration. In a comparison: each public export that the change removed or changed while no
// documentation file changed. Both are leads: Code-map does not read the text of a comment or a document. Pure.
import { surfaces } from '../api-compare.mjs';

/** A documentation file: Markdown, or any file in a `docs` folder. */
export const isDocumentation = (path) => /\.(?:md|mdx|markdown)$/i.test(path) || path.split('/').slice(0, -1).includes('docs');

/**
 * { entryPoints, exports, documented, undocumented, unknown, items } for the public exports of a snapshot, or null when an
 * older Code-map stored the analysis without the JSDoc facts. Each item is an undocumented export with `path` (the entry
 * point), `name`, `kind`, `declaredIn` and `line` (in the declaring file). Unknown: a re-export from a package, or a name
 * without a declaration that Code-map can read.
 */
export function publicDocumentation(analysis) {
  const api = analysis.api;
  if (!api || (api.schemaVersion ?? 1) < 2) return null;
  const surface = surfaces(api.files), lines = new Map(analysis.files.map((file) => [file.path, new Map((file.exports ?? []).map((item) => [item.name, item.line]))]));
  const counts = { exports: 0, documented: 0, undocumented: 0, unknown: 0 }, items = [];
  for (const entry of api.entryPoints.files) for (const [name, record] of surface(entry.path)) {
    counts.exports++;
    if (typeof record.documented !== 'boolean') { counts.unknown++; continue; }
    if (record.documented) { counts.documented++; continue; }
    counts.undocumented++;
    items.push({ path: entry.path, name, kind: record.kind, declaredIn: record.declaredIn, line: lines.get(record.declaredIn)?.get(record.declaredName ?? name) ?? null });
  }
  items.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  return { entryPoints: api.entryPoints.files.length, ...counts, items };
}

/**
 * { publicChanges, docsChanged, leads }: the removed and changed exports of the public group, the changed documentation files
 * (`files` is the changed-file list of lib/verify-change.mjs), and a lead for each public change when no documentation changed.
 */
export function documentationLeads(items, files) {
  const changes = items.filter((item) => item.group === 'public' && (item.status === 'REMOVED' || item.status === 'CHANGED'));
  const docsChanged = files.map((file) => file.path).filter(isDocumentation).sort();
  return { publicChanges: changes.length, docsChanged, leads: docsChanged.length ? []
    : changes.map((item) => ({ path: item.path, name: item.name, status: item.status, reasons: item.reasons, declaredIn: (item.head ?? item.base)?.declaredIn ?? null })) };
}
