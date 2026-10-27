// Shared by the CommonJS preload and the report importer. All report input is untrusted.
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shape = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const bounded = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const times = ['readyMs', 'readyToShowMs', 'didFinishLoadMs'];

function validateStartup(value) {
  const bad = (error) => ({ ok: false, error });
  if (!shape(value, ['reportType', 'schemaVersion', 'seconds', 'samples'])
    || value.reportType !== 'code-map-electron-startup' || value.schemaVersion !== 1) return bad('Expected strict code-map-electron-startup schemaVersion 1 report.');
  if (!Number.isInteger(value.seconds) || value.seconds < 1 || value.seconds > 300) return bad('Startup seconds must be from 1 to 300.');
  if (!Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 100) return bad('Startup report needs 1 to 100 samples.');
  for (const sample of value.samples) {
    if (!shape(sample, [...times, 'processes']) || !times.every((key) => sample[key] === null || bounded(sample[key], 86400000))) return bad('Invalid startup milestone. Use milliseconds or null for an unobserved event.');
    if (!Array.isArray(sample.processes) || sample.processes.length < 1 || sample.processes.length > 256) return bad('Startup sample needs 1 to 256 processes.');
    for (const process of sample.processes) {
      if (!shape(process, ['type', 'workingSetKB']) || typeof process.type !== 'string' || !process.type.length || process.type.length > 128
        || !bounded(process.workingSetKB, 1e12)) return bad('Invalid startup process type or working-set memory in KB.');
    }
  }
  return { ok: true, report: value };
}
module.exports = { validateStartup };
