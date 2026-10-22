// Reads a mutation report into the map: one written by `code-map mutate`, or a Stryker report (mutation-testing-report-schema).
// A file's mutants are evidence only while the file is unchanged: the report records its hash, or Stryker its source text.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileHash } from './mutation.mjs';

const defaults = ['docs/code-map/mutation.json', 'reports/mutation/mutation.json']; // ours, then Stryker's own default
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
    files[file] = (entry.mutants ?? []).map((mutant) => ours
      ? { unit: mutant.unit, line: mutant.line, kind: mutant.kind, original: mutant.original, replacement: mutant.replacement, status: mutant.status, killedBy: mutant.killedBy ?? [] }
      : { unit: null, line: mutant.location?.start?.line ?? null, kind: mutant.mutatorName ?? 'mutant', original: '', replacement: String(mutant.replacement ?? ''),
        status: strykerStatus[mutant.status] ?? 'ignored', killedBy: mutant.killedBy ?? [] });
  }
  const units = ours ? (parsed.units ?? []).filter((unit) => files[unit.key.slice(0, unit.key.lastIndexOf('#'))]).map(({ key, status, tests, canary, excluded }) => ({ key, status, tests, canary, excluded: excluded ?? [] })) : [];
  return { file: chosen, tool: ours ? 'code-map mutate' : 'stryker', date: statSync(path).mtime.toISOString(), files, stale: stale.sort(), units };
}
