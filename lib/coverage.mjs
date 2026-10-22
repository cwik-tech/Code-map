// Test coverage, when the project's test runner has written an lcov report (Jest, Vitest, c8 and nyc all can).
// The report is read from the working folder: it is a generated file, usually not committed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const candidates = ['coverage/lcov.info', 'coverage/lcov/lcov.info', '.coverage/lcov.info'];

export function readCoverage(repository, config) {
  const file = typeof config.coverage === 'string' ? config.coverage : candidates.find((path) => existsSync(resolve(repository, path)));
  if (!file || !existsSync(resolve(repository, file))) return null;
  const files = Object.create(null), lines = Object.create(null), branches = Object.create(null);
  let current = null;
  let found, hit;
  const finish = () => {
    if (current && Number.isSafeInteger(found) && Number.isSafeInteger(hit) && found >= 0 && hit >= 0 && hit <= found) files[current] = [found, hit];
    current = null;
    found = undefined;
    hit = undefined;
  };
  const count = (text) => /^\d+$/.test(text.trim()) ? Number(text) : undefined;
  for (const line of readFileSync(resolve(repository, file), 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      finish();
      const path = line.slice(3).trim();
      current = (isAbsolute(path) ? relative(repository, path) : path).replace(/\\/g, '/');
    } else if (current && line.startsWith('LF:')) found = count(line.slice(3));
    else if (current && line.startsWith('LH:')) hit = count(line.slice(3));
    else if (current && line.startsWith('DA:')) {
      const [number, hits] = line.slice(3).split(',').map(count);
      if (number !== undefined && hits !== undefined) (lines[current] ??= Object.create(null))[number] = hits;
    } else if (current && line.startsWith('BRDA:')) {
      // BRDA:<line>,<block>,<branch>,<taken>; "-" means the block never ran, so its branches were not taken.
      const [number, block, branch, taken] = line.slice(5).split(',');
      const at = count(number ?? ''), id = count(block ?? ''), index = count(branch ?? ''), times = taken?.trim() === '-' ? 0 : count(taken ?? '');
      if (at !== undefined && id !== undefined && index !== undefined && times !== undefined) (((branches[current] ??= Object.create(null))[at] ??= Object.create(null))[id] ??= [])[index] = times;
    }
    else if (line.trim() === 'end_of_record') finish();
  }
  finish();
  const report = { file, date: statSync(resolve(repository, file)).mtime.toISOString(), files: { ...files }, revision: null, command: null };
  // Line and branch hits stay in Node for the failure-exit check; they are not embedded in the page or the JSON.
  Object.defineProperty(report, 'lines', { value: lines, enumerable: false });
  Object.defineProperty(report, 'branches', { value: branches, enumerable: false });
  return report;
}
