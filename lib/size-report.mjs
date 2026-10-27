// Validation and comparison of imported size reports. These observations never affect readiness.
import { isRelativePath } from './adapters/run-manifest.mjs';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value) => Number.isSafeInteger(value) && value >= 0;
const amount = (value) => record(value) && number(value.bytes) && number(value.gzipBytes);
const path = (value) => isRelativePath(value) && value.startsWith('static/');
const unique = (items) => new Set(items).size === items.length;
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const matches = (value, items) => value.bytes === sum(items, 'bytes') && value.gzipBytes === sum(items, 'gzipBytes');

/** Validates the version, dimensions and accounting of an untrusted size report. */
export function validateSizes(value) {
  const bad = (error) => ({ ok: false, error });
  if (!record(value) || value.reportType !== 'code-map-sizes' || value.schemaVersion !== 1) return bad('Expected code-map-sizes schemaVersion 1.');
  if (Object.keys(value).some((key) => !['reportType', 'schemaVersion', 'buildId', 'nextVersion', 'formats', 'files', 'routes', 'totals', 'unsupported'].includes(key))) return bad('Unknown size report field.');
  if (typeof value.buildId !== 'string' || !value.buildId.trim() || value.buildId.length > 4096) return bad('Invalid buildId.');
  if (value.nextVersion !== null && (typeof value.nextVersion !== 'string' || !value.nextVersion || value.nextVersion.length > 100)) return bad('Invalid nextVersion.');
  if (!Array.isArray(value.formats) || !value.formats.length || !unique(value.formats)
    || !value.formats.every((item) => ['build-manifest.json', 'app-build-manifest.json', 'fallback-build-manifest.json', 'app-path-routes-manifest.json', 'page_client-reference-manifest.js'].includes(item))) return bad('Invalid manifest formats.');
  if (!Array.isArray(value.files) || value.files.length > 20000 || !value.files.every((file) => amount(file) && path(file.path)
    && (file.sources === undefined || Array.isArray(file.sources) && file.sources.length <= 20000
      && file.sources.every((source) => isRelativePath(source) && !source.includes('\\')) && unique(file.sources)))
    || !unique(value.files.map((file) => file.path))) return bad('Invalid or duplicate asset files.');
  const files = new Map(value.files.map((file) => [file.path, file]));
  if (!Array.isArray(value.routes) || value.routes.length > 20000) return bad('Invalid route list.');
  const names = new Set();
  for (const route of value.routes) {
    if (!amount(route) || typeof route.route !== 'string' || !route.route.startsWith('/') || route.route.length > 4096
      || names.has(route.route) || !Array.isArray(route.files) || route.files.length > 20000 || !unique(route.files)
      || !route.files.every((name) => typeof name === 'string' && name.endsWith('.js') && files.has(name))) return bad('Invalid or duplicate route.');
    if (route.css !== undefined && (!amount(route.css) || !Array.isArray(route.css.files) || !unique(route.css.files)
      || !route.css.files.every((name) => typeof name === 'string' && name.endsWith('.css') && files.has(name))
      || !matches(route.css, route.css.files.map((name) => files.get(name))))) return bad('Invalid route CSS totals.');
    names.add(route.route);
    if (!matches(route, route.files.map((name) => files.get(name)))) return bad('Route byte totals disagree with asset files.');
  }
  if (value.unsupported !== undefined && (!Array.isArray(value.unsupported) || value.unsupported.length > 20000
    || !value.unsupported.every((item) => record(item) && typeof item.route === 'string' && item.route.startsWith('/')
      && item.route.length <= 4096 && typeof item.reason === 'string' && item.reason.length > 0 && item.reason.length <= 8192))) return bad('Invalid unsupported routes.');
  if (!record(value.totals)) return bad('Invalid static totals.');
  for (const name of ['chunks', 'css', 'media']) {
    const total = value.totals[name], selected = value.files.filter((file) => name === 'css' ? file.path.endsWith('.css') : file.path.startsWith(`static/${name}/`));
    if (!amount(total) || !number(total.files) || total.files !== selected.length || !matches(total, selected)) return bad('Invalid static totals.');
  }
  return { ok: true, report: value };
}
const delta = (head, base) => {
  const change = (key) => head[key] - base[key];
  const percent = (key) => base[key] === 0 ? null : Math.round(change(key) / base[key] * 10000) / 100;
  return { bytes: change('bytes'), percent: percent('bytes'), gzipBytes: change('gzipBytes'), gzipPercent: percent('gzipBytes') };
};

/** Compares one bound report per side. Multiple reports on a side remain explicitly ambiguous. */
export function compareSizes({ head, base }) {
  if (!head.length && !base.length) return null;
  if (head.length > 1 || base.length > 1) return { state: 'AMBIGUOUS', head, base, routes: [], added: [], removed: [], totals: null };
  const h = head[0] ?? null, b = base[0] ?? null;
  const heads = new Map((h?.routes ?? []).map((route) => [route.route, route]));
  const bases = new Map((b?.routes ?? []).map((route) => [route.route, route]));
  const routes = [...new Set([...heads.keys(), ...bases.keys()])].map((route) => {
    const current = heads.get(route) ?? null, previous = bases.get(route) ?? null;
    return { route, head: current, base: previous, change: current && previous ? delta(current, previous) : null };
  }).sort((a, b) => (b.change?.bytes ?? 0) - (a.change?.bytes ?? 0) || a.route.localeCompare(b.route, 'en'));
  const totals = Object.fromEntries(['chunks', 'css', 'media'].map((key) => [key, { head: h?.totals[key] ?? null, base: b?.totals[key] ?? null,
    change: h && b ? delta(h.totals[key], b.totals[key]) : null }]));
  return { state: h && b ? 'COMPARED' : h ? 'HEAD_ONLY' : 'BASE_ONLY', head: h, base: b, routes,
    added: h && b ? routes.filter((r) => !r.base) : [], removed: h && b ? routes.filter((r) => !r.head) : [], totals };
}

/** A short Markdown section. The caller supplies its Markdown escaper. */
export function sizeLines(sizes, plain) {
  if (!sizes) return [];
  const lines = ['## First-load JavaScript', '', 'Size reports are self-attested observations. They do not affect ratings or readiness.', ''];
  if (sizes.state === 'AMBIGUOUS') return [...lines, 'Multiple bound size reports exist on one side. No size comparison is available.', ''];
  if (sizes.state !== 'COMPARED') lines.push('No size change is available. Only one side has a bound size report.', '');
  const bytes = (value) => value ? `${value.bytes} / ${value.gzipBytes}` : 'None';
  const change = (value) => value ? `${value.bytes} (${value.percent === null ? 'undefined' : `${value.percent}%`}), gzip ${value.gzipBytes}` : 'None';
  lines.push('| Route | Base bytes / gzip | Head bytes / gzip | Change bytes (%) |', '| --- | --- | --- | --- |');
  const selected = sizes.state === 'COMPARED' ? sizes.routes.filter((r) => r.change?.bytes > 0 || r.change?.gzipBytes > 0 || !r.head || !r.base) : sizes.routes;
  for (const row of selected.slice(0, 5)) lines.push(`| ${plain(row.route, 100)}${!row.base && sizes.base ? ' (new)' : !row.head && sizes.head ? ' (removed)' : ''} | ${bytes(row.base)} | ${bytes(row.head)} | ${change(row.change)} |`);
  if (selected.length > 5) lines.push(`${selected.length - 5} more routes are in verification-results.json.`);
  for (const [name, value] of Object.entries(sizes.totals)) lines.push(`| static/${name} | ${bytes(value.base)} | ${bytes(value.head)} | ${change(value.change)} |`);
  return [...lines, ''];
}
