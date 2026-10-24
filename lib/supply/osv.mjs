// Frozen OSV matching. Only npm SEMVER ranges and explicit affected versions are supported.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function parts(value) {
  const match = typeof value === 'string' ? pattern.exec(value) : null;
  return match && !match[4]?.split('.').some((v) => /^0\d+$/.test(v)) ? match : null;
}
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const numeric = (a, b) => Math.sign(a.length - b.length) || textOrder(a, b);
/** Compare strict semantic versions without integer precision loss. Invalid values return null. */
export function compareSemver(a, b) {
  const x = parts(a), y = parts(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) { const order = numeric(x[i], y[i]); if (order) return order; }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  const p = x[4].split('.'), q = y[4].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined || q[i] === undefined) return p[i] === undefined ? -1 : 1;
    const n = /^\d+$/.test(p[i]), m = /^\d+$/.test(q[i]);
    const order = n && m ? numeric(p[i], q[i]) : n !== m ? n ? -1 : 1 : textOrder(p[i], q[i]);
    if (order) return order;
  }
  return 0;
}
function validRange(range) {
  if (!record(range) || range.type !== 'SEMVER' || !Array.isArray(range.events) || !range.events.length) return false;
  let open = false, previous = null;
  for (const event of range.events) {
    if (!record(event) || Object.keys(event).length !== 1) return false;
    const [key, value] = Object.entries(event)[0];
    if (!['introduced', 'fixed', 'last_affected'].includes(key) || !(key === 'introduced' && value === '0') && !parts(value)) return false;
    if ((key === 'introduced') === open) return false;
    if (previous !== null && (value === '0' || compareSemver(value, previous) < 0)) return false;
    open = key === 'introduced'; previous = value === '0' ? null : value;
  }
  return true;
}
/** Validate an exported list of OSV records. Unsupported npm ranges refuse the snapshot. */
export function parseOsv(text, { maxBytes = 50 * 1024 * 1024, maxRecords = 100000 } = {}) {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) throw new Error('OSV snapshot is not text or exceeds its byte limit.');
    const input = JSON.parse(text), records = Array.isArray(input) ? input : input?.records;
    let provenance = { state: 'UNKNOWN', source: null, snapshotDate: null, reason: 'The artifact has no database snapshot provenance.' };
    if (!Array.isArray(input)) {
      const meta = input?.snapshot;
      if (!record(meta) || typeof meta.source !== 'string' || !meta.source.trim() || meta.source.length > 2048
        || typeof meta.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(meta.exportedAt)
        || !Number.isFinite(Date.parse(meta.exportedAt))
        || new Date(meta.exportedAt).toISOString().slice(0, 19) !== meta.exportedAt.slice(0, 19)) throw new Error('OSV snapshot needs a source and an exportedAt UTC timestamp.');
      provenance = { state: 'KNOWN', source: meta.source, snapshotDate: meta.exportedAt };
    }
    if (!Array.isArray(records) || records.length > maxRecords) throw new Error('OSV snapshot must be a bounded array of records.');
    for (const item of records) {
      if (!record(item) || typeof item.id !== 'string' || !item.id.length || item.id.length > 256 || !Array.isArray(item.affected)) throw new Error('Invalid OSV advisory identity or affected list.');
      if (item.severity !== undefined && (!Array.isArray(item.severity) || !item.severity.every((s) => record(s) && typeof s.type === 'string' && typeof s.score === 'string'))) throw new Error('Invalid OSV severity.');
      if (item.withdrawn !== undefined && typeof item.withdrawn !== 'string') throw new Error('Invalid OSV withdrawal time.');
      for (const affected of item.affected) {
        if (!record(affected) || !record(affected.package) || typeof affected.package.name !== 'string' || typeof affected.package.ecosystem !== 'string') throw new Error('Invalid OSV affected package.');
        if (affected.package.ecosystem !== 'npm') continue;
        if (affected.versions !== undefined && (!Array.isArray(affected.versions) || !affected.versions.every((v) => parts(v)))) throw new Error('Invalid OSV affected versions.');
        if (affected.ranges !== undefined && (!Array.isArray(affected.ranges) || !affected.ranges.every(validRange))) throw new Error('Unsupported OSV range. Use ordered SEMVER introduced, fixed or last_affected events.');
        if (!affected.versions?.length && !affected.ranges?.length) throw new Error('OSV package has no affected versions or ranges.');
      }
    }
    return { ok: true, records, provenance };
  } catch (error) { return { ok: false, error: error.message }; }
}
function inRange(version, range) {
  let inside = false;
  for (const event of range.events) {
    if (event.introduced !== undefined) {
      if (event.introduced === '0' || compareSemver(version, event.introduced) >= 0) inside = true;
    } else {
      const end = event.fixed ?? event.last_affected;
      const order = compareSemver(version, end);
      if (inside && (order < 0 || event.last_affected !== undefined && order === 0)) return true;
      inside = false;
    }
  }
  return inside;
}
/** Match validated advisories to the selected inventory, with explicit unknown versions. */
export function matchOsv(records, supply, snapshotDate) {
  const items = new Map(), unknown = [];
  const index = new Map();
  for (const p of supply?.packages ?? []) {
    if (p.kind === 'local') continue;
    if (!parts(p.version)) { unknown.push({ package: p.name, version: p.version }); continue; }
    if (!index.has(p.name)) index.set(p.name, new Set());
    index.get(p.name).add(p.version);
  }
  for (const advisory of records) for (const affected of advisory.affected) {
    if (advisory.withdrawn || affected.package.ecosystem !== 'npm') continue;
    for (const version of index.get(affected.package.name) ?? []) {
      if (affected.versions?.includes(version) || affected.ranges?.some((range) => inRange(version, range))) {
        const entry = { id: advisory.id, severity: advisory.severity?.length ? advisory.severity : typeof advisory.database_specific?.severity === 'string'
          ? [{ type: 'database_specific', score: advisory.database_specific.severity }] : typeof affected.ecosystem_specific?.severity === 'string'
            ? [{ type: 'ecosystem_specific', score: affected.ecosystem_specific.severity }] : null, package: affected.package.name, version, snapshotDate };
        items.set(JSON.stringify([entry.id, entry.package, version]), entry);
      }
    }
  }
  return { use: 'information', snapshotDate, items: [...items.values()].sort((a, b) => textOrder(JSON.stringify(a), JSON.stringify(b))), unknown };
}
/** Compare advisory identities, package names and locked versions. */
export function compareAdvisories(base, head) {
  const key = (v) => JSON.stringify([v.id, v.package, v.version]);
  const before = new Set(base.map(key)), after = new Set(head.map(key));
  return { added: head.filter((v) => !before.has(key(v))), removed: base.filter((v) => !after.has(key(v))) };
}
/** Complete one bound execution. Match both sides against the same frozen snapshot. */
export function osvExecution(execution, text, run, sides) {
  const parsed = parseOsv(text);
  if (!parsed.ok) { execution.reasons.push({ key: 'parse', message: parsed.error }); return execution; }
  const supply = (side) => sides[side].analysis.supply;
  if (['base', 'head'].some((side) => supply(side)?.lockfiles?.length && !supply(side).lockfile)
    || !supply('head')?.lockfile && !supply('base')?.lockfile) {
    execution.reasons.push({ key: 'inventory', message: 'OSV comparison needs a readable inventory and no unreadable root lockfile.' }); return execution;
  }
  const base = matchOsv(parsed.records, supply('base'), parsed.provenance.snapshotDate), head = matchOsv(parsed.records, supply('head'), parsed.provenance.snapshotDate);
  execution.osv = { ...head, provenance: parsed.provenance, executedAt: run.startedAt, comparison: compareAdvisories(base.items, head.items) };
  execution.eligible = true;
  return execution;
}
