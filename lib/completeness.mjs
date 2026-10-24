// Snapshot inventory by stack. A parsed file can also be malformed. CSS scanning is not a CSS parser.
import { ignored, isCode } from './project.mjs';
const stackOf = (path) => /\.[jt]sx$/.test(path) ? 'JSX and TSX' : /\.[cm]?ts$/.test(path) ? 'TypeScript'
  : /\.[cm]?js$/.test(path) ? 'JavaScript' : /\.json$/.test(path) ? 'JSON' : /\.css$/.test(path) ? 'CSS' : 'other';

/** Uses discovery paths, actual parser facts and already read JSON texts. Counts expressions, rather than matching edges. */
export function completenessTable({ paths, files, texts }) {
  const parsed = new Map(files.map((file) => [file.path, file]));
  const rows = new Map(['TypeScript', 'JavaScript', 'JSX and TSX', 'JSON', 'CSS', 'other'].map((stack) => [stack,
    { stack, discovered: 0, supported: 0, parsed: 0, skipped: 0, malformed: 0, dynamicallyUnresolved: 0 }]));
  for (const path of paths.filter((path) => !ignored(path))) {
    const row = rows.get(stackOf(path)), file = parsed.get(path);
    row.discovered++;
    if (isCode(path) || /\.d\.[cm]?ts$/.test(path) || row.stack === 'JSON') row.supported++;
    if (file) {
      row.parsed++; if (file.syntax?.errors) row.malformed++;
      row.dynamicallyUnresolved += (file.edges ?? []).filter((edge) => edge.specifier === null && edge.target === null).length;
    } else if (row.stack === 'JSON' && texts.has(path)) {
      row.parsed++;
      try { JSON.parse(texts.get(path)); } catch { row.malformed++; }
    } else row.skipped++;
  }
  return [...rows.values()];
}
