// Bound head bundle observations. No rating rule reads these leads.
import { isRelativePath } from './adapters/run-manifest.mjs';

/** Keeps repository-like source names. Absolute paths and traversal never become source evidence. */
export function sourceName(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const name = value.replace(/^webpack:\/\/[^/]*\//, '').replace(/^\.\//, '');
  return isRelativePath(name) && !name.includes('\\') && !name.includes('?') ? name : null;
}

/** Reads only sources and indexed sections from a bounded, already loaded source-map file. */
export function mapSources(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 3 || depth > 16) throw new Error('Invalid source map.');
  if (value.sourceRoot !== undefined && typeof value.sourceRoot !== 'string') throw new Error('Invalid source map root.');
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections) || value.sections.length > 20000) throw new Error('Invalid source map sections.');
    return [...new Set(value.sections.flatMap((section) => mapSources(section?.map, depth + 1)))].sort();
  }
  if (!Array.isArray(value.sources) || value.sources.length > 20000 || !value.sources.every((item) => typeof item === 'string')) throw new Error('Invalid source map sources.');
  return [...new Set(value.sources.map((name) => sourceName((value.sourceRoot ?? '') + (value.sourceRoot && !value.sourceRoot.endsWith('/') ? '/' : '') + name)).filter(Boolean))].sort();
}
const stem = (path) => path.replace(/\.[cm]?[jt]sx?$/, '');
const namedChunk = (path, source) => {
  const name = path.replace(/^static\/chunks\//, '').replace(/\.js$/, '').replace(/-[a-f0-9]{6,}$/i, '');
  return name === stem(source);
};

/** Lists unused chunks and orphan leads contradicted by route chunk names or source maps. */
export function bundleEvidence(sizes, analysis) {
  if (sizes.head.length !== 1) return { state: sizes.head.length ? 'AMBIGUOUS' : 'UNAVAILABLE', unusedChunks: [], reachedOrphans: [] };
  const report = sizes.head[0], used = new Set(report.routes.flatMap((route) => route.files));
  const chunks = report.files.filter((file) => file.path.startsWith('static/chunks/') && file.path.endsWith('.js'));
  const routed = chunks.filter((file) => used.has(file.path));
  const reachedOrphans = (analysis.packages?.leads.orphaned ?? []).flatMap((lead) => {
    const source = routed.find((file) => file.sources?.includes(lead.path));
    const named = routed.find((file) => namedChunk(file.path, lead.path));
    const chunk = source ?? named;
    return chunk ? [{ ...lead, chunk: chunk.path, via: source ? 'source-map' : 'chunk-name' }] : [];
  });
  return { state: 'HEAD_BOUND', artifact: report.artifact ?? null,
    unusedChunks: chunks.filter((file) => !used.has(file.path)), reachedOrphans };
}
