// Reads a mutation report into the map: one written by `code-map mutate`, or a Stryker report (mutation-testing-report-schema).
// A file's mutants are evidence only while the file is unchanged: the report records its hash, or Stryker its source text.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileHash } from './mutation.mjs';

const defaults = ['docs/code-map/mutation.json', 'reports/mutation/mutation.json']; // ours, then Stryker's own default
const outcomes = new Set(['detected', 'survived', 'timeout', 'error', 'invalid', 'no-coverage', 'ignored']);
const runStatuses = new Set(['checked', 'partial', 'no-tests', 'no-runner', 'baseline-failed', 'not-loaded']);
// The report is a file in the mapped repository, which can be crafted: keep only plain values of the expected shape.
const lineOf = (value) => (Number.isInteger(value) && value > 0 ? value : null);
const text = (value, limit = 200) => (typeof value === 'string' ? value.slice(0, limit) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '');
const strings = (value) => (Array.isArray(value) ? value.slice(0, 20).map((item) => text(item)) : []);
const strykerStatus = { Killed: 'detected', Timeout: 'timeout', Survived: 'survived', NoCoverage: 'no-coverage', CompileError: 'invalid',
  RuntimeError: 'error', Ignored: 'ignored', Pending: 'ignored' };

export function readMutation(repository, config, options, texts) {
  const chosen = [options.mutation, config.mutation, ...defaults].find((path) => typeof path === 'string' && existsSync(resolve(repository, path)));
  if (!chosen) return null;
  const path = resolve(repository, chosen);
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return { file: chosen, tool: null, date: null, files: {}, stale: [], units: [], error: 'The report is not valid JSON.' }; }
  const ours = parsed?.tool === 'code-map mutate', files = {}, stale = [];
  for (const [name, entry] of Object.entries(parsed?.files ?? {})) {
    const file = (isAbsolute(name) ? relative(repository, name) : name).replace(/\\/g, '/');
    const hash = ours ? entry.hash : typeof entry.source === 'string' ? fileHash(entry.source) : null;
    if (!texts.has(file) || !hash || hash !== fileHash(texts.get(file))) { stale.push(file); continue; }
    files[file] = (Array.isArray(entry.mutants) ? entry.mutants : []).map((mutant) => ours
      ? { unit: text(mutant.unit, 500), line: lineOf(mutant.line), kind: text(mutant.kind, 40), original: text(mutant.original), replacement: text(mutant.replacement),
        status: outcomes.has(mutant.status) ? mutant.status : 'ignored', killedBy: strings(mutant.killedBy) }
      : { unit: null, line: lineOf(mutant.location?.start?.line), kind: text(mutant.mutatorName ?? 'mutant', 40), original: '', replacement: text(mutant.replacement),
        status: strykerStatus[mutant.status] ?? 'ignored', killedBy: strings(mutant.killedBy) });
  }
  const units = !ours || !Array.isArray(parsed.units) ? [] : parsed.units.filter((unit) => typeof unit?.key === 'string' && files[unit.key.slice(0, unit.key.lastIndexOf('#'))])
    .map((unit) => ({ key: unit.key, status: runStatuses.has(unit.status) ? unit.status : 'checked', tests: strings(unit.tests), canary: outcomes.has(unit.canary) ? unit.canary : null,
      excluded: Array.isArray(unit.excluded) ? unit.excluded.slice(0, 20).map((item) => ({ path: text(item?.path, 500), failed: strings(item?.failed) })) : [] }));
  return { file: chosen, tool: ours ? 'code-map mutate' : 'stryker', date: statSync(path).mtime.toISOString(), files, stale: stale.sort(), units };
}
