// Test coverage, when the project's test runner has written an lcov report (Jest, Vitest, c8 and nyc all can).
// The report is read from the working folder: it is a generated file, usually not committed. parseLcov is pure, and
// code-map verify also uses it for a bound LCOV report (lib/changed-coverage.mjs).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const candidates = ['coverage/lcov.info', 'coverage/lcov/lcov.info', '.coverage/lcov.info'];
const count = (text) => /^\d+$/.test(text.trim()) ? Number(text) : undefined;

/** The LCOV file that readCoverage reads, relative to the repository, or null when there is none. */
export function coverageFile(repository, config) {
  const file = typeof config.coverage === 'string' ? config.coverage : candidates.find((path) => existsSync(resolve(repository, path)));
  return file && existsSync(resolve(repository, file)) ? file : null;
}

/**
 * The records of an LCOV text in their order: { path, found, hit, lines: [[line, hits]], branches: [[line, block, branch, taken]],
 * functions: [[start, end, name]], calls: [[name, hits]], functionsFound }. `place` gives the key of each SF path, or a falsy value
 * to leave the record out. `ignored` counts those records. A field that is not a whole number is left out. A BRDA count "-" means
 * that the block never ran, so its branches were not taken: it is 0. FN gives the start line and the name of a function (LCOV 1),
 * or the start line, the end line and the name (LCOV 2). Its end is null when the record has no end line. FNDA gives the count
 * of a name, and FNF the number of functions.
 */
export function parseLcov(text, place) {
  const records = [];
  let current = null, ignored = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const path = place(line.slice(3).trim());
      current = path ? { path, found: undefined, hit: undefined, lines: [], branches: [], functions: [], calls: [], functionsFound: undefined } : null;
      if (current) records.push(current); else ignored++;
    } else if (current && line.startsWith('FN:')) {
      const [, start, end, name] = /^(\d+),(?:(\d+),)?(.*\S.*)$/.exec(line.slice(3).trim()) ?? [];
      if (start !== undefined && (end === undefined || Number(end) >= Number(start))) current.functions.push([Number(start), end === undefined ? null : Number(end), name.trim()]);
    } else if (current && line.startsWith('FNDA:')) {
      const [, hits, name] = /^(\d+),(.*\S.*)$/.exec(line.slice(5).trim()) ?? [];
      if (hits !== undefined) current.calls.push([name.trim(), Number(hits)]);
    } else if (current && line.startsWith('FNF:')) current.functionsFound = count(line.slice(4));
    else if (current && line.startsWith('LF:')) current.found = count(line.slice(3));
    else if (current && line.startsWith('LH:')) current.hit = count(line.slice(3));
    else if (current && line.startsWith('DA:')) {
      const [number, hits] = line.slice(3).split(',').map(count);
      if (number !== undefined && hits !== undefined) current.lines.push([number, hits]);
    } else if (current && line.startsWith('BRDA:')) {
      const [number, block, branch, taken] = line.slice(5).split(',');
      const at = count(number ?? ''), id = count(block ?? ''), index = count(branch ?? ''), times = taken?.trim() === '-' ? 0 : count(taken ?? '');
      if (at !== undefined && id !== undefined && index !== undefined && times !== undefined) current.branches.push([at, id, index, times]);
    }
    else if (line.trim() === 'end_of_record') current = null;
  }
  return { records, ignored };
}

export function readCoverage(repository, config) {
  const file = coverageFile(repository, config);
  if (!file) return null;
  const files = Object.create(null), lines = Object.create(null), branches = Object.create(null);
  const place = (path) => (isAbsolute(path) ? relative(repository, path) : path).replace(/\\/g, '/');
  // A later record of the same path replaces the line counts, the branch counts and a valid LF/LH pair of an earlier one.
  for (const { path, found, hit, lines: hits, branches: taken } of parseLcov(readFileSync(resolve(repository, file), 'utf8'), place).records) {
    if (Number.isSafeInteger(found) && Number.isSafeInteger(hit) && found >= 0 && hit >= 0 && hit <= found) files[path] = [found, hit];
    for (const [number, value] of hits) (lines[path] ??= Object.create(null))[number] = value;
    for (const [at, id, index, times] of taken) (((branches[path] ??= Object.create(null))[at] ??= Object.create(null))[id] ??= [])[index] = times;
  }
  const report = { file, date: statSync(resolve(repository, file)).mtime.toISOString(), files: { ...files }, revision: null, command: null };
  // Line and branch hits stay in Node for the failure-exit check; they are not embedded in the page or the JSON.
  Object.defineProperty(report, 'lines', { value: lines, enumerable: false });
  Object.defineProperty(report, 'branches', { value: branches, enumerable: false });
  return report;
}
