// The report kind npm-audit: the JSON output of `npm audit --json` from npm 7 and later (auditReportVersion 2). code-map verify
// binds the report through its run manifest, like a test report, and lists its advisories by severity in the executions. The
// rule set static-baseline-v0 has no supply-chain check, so the advisories are information there. The time of the advisory
// database is the start time of the run manifest. Pure: no file access, no clock and no execution. The report is untrusted input.

const severities = ['critical', 'high', 'moderate', 'low', 'info'];
const maxErrors = 100, itemsShown = 20;
const max = { name: 214, title: 300, url: 500, range: 200, code: 100 };
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const clip = (value, length) => (typeof value === 'string' ? value.slice(0, length) : null);
const zero = () => Object.fromEntries(severities.map((severity) => [severity, 0]));

/**
 * `{ ok: true, report }` or `{ ok: false, errors: [{ path, message }] }`. `value` is the text or the parsed JSON. The report has
 * the unique advisories (an advisory of several packages counts once), the vulnerable packages by severity as npm counts them,
 * and the counts in metadata that differ from the observed counts.
 */
export function parseNpmAudit(value, { maxBytes = 50 * 1024 * 1024, maxPackages = 100000 } = {}) {
  if (typeof value === 'string' && (value.length > maxBytes || Buffer.byteLength(value, 'utf8') > maxBytes)) return { ok: false, errors: [{ path: '', message: `The report is larger than ${maxBytes} bytes.` }] };
  let report = value;
  if (typeof value === 'string') { try { report = JSON.parse(value); } catch { return { ok: false, errors: [{ path: '', message: 'The text is not valid JSON.' }] }; } }
  if (!isRecord(report)) return { ok: false, errors: [{ path: '', message: 'The report must be a JSON object.' }] };
  if (isRecord(report.error)) {
    const code = clip(report.error.code, max.code)?.replace(/[^\w.-]/g, '') || 'no code';
    return { ok: false, errors: [{ path: 'error', message: `The report is an npm error (${code}), not an audit result. Run npm audit --json again when it can read the lockfile and the registry.` }] };
  }
  if (report.auditReportVersion !== 2) return { ok: false, errors: [{ path: 'auditReportVersion', message: 'The report is not in the format of npm 7 and later (auditReportVersion 2).' }] };
  const errors = [];
  let dropped = 0;
  const error = (path, message) => { if (errors.length < maxErrors) errors.push({ path, message }); else dropped++; };
  const advisories = new Map(), packages = zero();
  if (!isRecord(report.vulnerabilities)) error('vulnerabilities', 'Must be an object.');
  const entries = isRecord(report.vulnerabilities) ? Object.entries(report.vulnerabilities) : [];
  if (entries.length > maxPackages) return { ok: false, errors: [{ path: 'vulnerabilities', message: `The report has more than ${maxPackages} vulnerable packages.` }] };
  for (const [key, entry] of entries) {
    const path = `vulnerabilities.${key.slice(0, max.name)}`;
    if (!isRecord(entry)) { error(path, 'Must be an object.'); continue; }
    if (typeof entry.name !== 'string') error(`${path}.name`, 'Must be a string.');
    if (!severities.includes(entry.severity)) error(`${path}.severity`, `Must be one of: ${severities.join(', ')}.`);
    else packages[entry.severity]++;
    if (entry.isDirect !== undefined && typeof entry.isDirect !== 'boolean') error(`${path}.isDirect`, 'Must be true or false.');
    for (const field of ['nodes', 'effects']) if (entry[field] !== undefined && !(Array.isArray(entry[field]) && entry[field].every((item) => typeof item === 'string'))) error(`${path}.${field}`, 'Must be an array of strings.');
    if (!Array.isArray(entry.via)) { error(`${path}.via`, 'Must be an array.'); continue; }
    entry.via.forEach((via, index) => readVia(via, `${path}.via[${index}]`, entry, advisories, error));
  }
  const declared = report.metadata?.vulnerabilities;
  if (!isRecord(report.metadata)) error('metadata', 'Must be an object.');
  else if (!isRecord(declared)) error('metadata.vulnerabilities', 'Must be an object.');
  else for (const key of [...severities, 'total']) if (!isCount(declared[key])) error(`metadata.vulnerabilities.${key}`, 'Must be a non-negative integer.');
  if (dropped) errors.push({ path: '', message: `${dropped} more errors are not listed.` });
  if (errors.length) return { ok: false, errors };
  const observed = { ...packages, total: entries.length }, list = [...advisories.values()];
  const bySeverity = zero();
  for (const item of list) bySeverity[item.severity]++;
  list.sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity) || (a.package < b.package ? -1 : a.package > b.package ? 1 : 0) || String(a.source).localeCompare(String(b.source)));
  const mismatches = [...severities, 'total'].filter((key) => declared[key] !== observed[key]).map((key) => ({ field: `metadata.vulnerabilities.${key}`, declared: declared[key], observed: observed[key] }));
  return { ok: true, report: { advisories: { total: list.length, bySeverity, items: list }, packages: { total: entries.length, bySeverity: packages }, mismatches } };
}

/** One "via" entry: the name of another vulnerable package (a transitive effect, no advisory), or an advisory object. */
function readVia(via, path, entry, advisories, error) {
  if (typeof via === 'string') return;
  if (!isRecord(via)) { error(path, 'Must be a string or an object.'); return; }
  for (const field of ['title', 'url', 'name', 'range', 'dependency']) if (via[field] !== undefined && typeof via[field] !== 'string') error(`${path}.${field}`, 'Must be a string.');
  if (via.source !== undefined && !Number.isInteger(via.source) && typeof via.source !== 'string') error(`${path}.source`, 'Must be an integer or a string.');
  if (via.severity !== undefined && !severities.includes(via.severity)) error(`${path}.severity`, `Must be one of: ${severities.join(', ')}.`);
  const id = via.source ?? via.url ?? via.title;
  if (id === undefined) { error(path, 'Must name the advisory with source, url or title.'); return; }
  const key = JSON.stringify([typeof via.source, id]);
  if (advisories.has(key)) return;
  advisories.set(key, { source: typeof via.source === 'string' ? clip(via.source, max.url) : via.source ?? null, title: clip(via.title, max.title), url: clip(via.url, max.url),
    severity: severities.includes(via.severity) ? via.severity : severities.includes(entry.severity) ? entry.severity : 'info', package: clip(via.name ?? entry.name, max.name), range: clip(via.range, max.range) });
}

/**
 * Completes the execution record of a bound npm-audit report: `audit` with the use, the database time, the advisories and the
 * vulnerable packages by severity and the first advisories. When Code-map cannot read the report, the record gets a parse reason.
 */
export function auditExecution(execution, text, run) {
  const parsed = parseNpmAudit(text);
  if (!parsed.ok) {
    execution.reasons.push({ key: 'parse', message: `Code-map cannot read the npm audit report: ${parsed.errors.slice(0, 3).map((item) => `${item.path || 'report'}: ${item.message}`).join(' ')}` });
    return execution;
  }
  const { advisories, packages, mismatches } = parsed.report;
  execution.eligible = true;
  execution.audit = { use: 'information', databaseTime: run.startedAt, advisories: { total: advisories.total, bySeverity: advisories.bySeverity },
    packages, items: advisories.items.slice(0, itemsShown), mismatches };
  return execution;
}

/** Two texts for the verification report: the counts, and a note with the database time and the use of the advisories. */
export function auditWords(audit) {
  const total = audit?.advisories?.total ?? 0, vulnerable = audit?.packages?.total ?? 0;
  const parts = severities.filter((severity) => audit?.advisories?.bySeverity?.[severity]).map((severity) => `${audit.advisories.bySeverity[severity]} ${severity}`);
  const counts = total ? `${total} ${total === 1 ? 'advisory' : 'advisories'} (${parts.join(', ')}) in ${vulnerable} vulnerable ${vulnerable === 1 ? 'package' : 'packages'}` : 'No advisory';
  const time = audit?.databaseTime ? `The advisory database is as of ${audit.databaseTime}, the start time in the run manifest.` : 'The run manifest gives no time for the advisory database.';
  return [counts, `${time} The rule set has no supply-chain check, so the advisories are information only.`];
}
