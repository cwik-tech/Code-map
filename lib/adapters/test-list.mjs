// Reads runner discovery JSON for Vitest, Jest, Playwright and Mocha.
// Discovery gives test files and cases, not execution outcomes. Pure, bounded and untrusted input.
import { runnerEntries } from './runner-list.mjs';
import { isAbsolute, posix, relative, sep } from 'node:path';

/** Declared producers. The parser checks the shape, not the producer version. */
export const supportedProducers = [
  { name: 'vitest list --json', versions: 'an array of { name, file, projectName?, location? }, or of { file, projectName? } with --filesOnly' },
  { name: 'jest --listTests --json', versions: 'an array of test file paths' },
  { name: 'playwright test --list --reporter=json', versions: 'suites with specs and project tests' },
  { name: 'mocha --dry-run --reporter json', versions: 'tests and pending arrays with file and fullTitle' },
];
const formats = ['vitest-list', 'jest-list', 'playwright-list', 'mocha-list'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isName = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0');
/** A longer path cannot name a file, so `real` does not see it. */
const maxPath = 4096;

/**
 * Returns `{ ok: true, report: { format, files, cases, outside } }` or `{ ok: false, error }`. `files` are the sorted repository-relative
 * test files, and `cases` the { file, name } entries (null for a list of files only). A path is absolute, or
 * relative to `workingDirectory`. An absolute path counts after `real` resolves its links. `real` must be cheap, because it can run
 * for each entry, and an error of `real` keeps the path. Each path outside the repository counts in `outside`.
 */
export function parseTestList(text, { format, repository, workingDirectory = '.', real = (path) => path, maxBytes = 50 * 1024 * 1024, maxEntries = 200000 } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'The discovery report must be text.' };
  if (!formats.includes(format)) return { ok: false, error: `The format must be ${formats.join(' or ')}.` };
  if (typeof repository !== 'string' || !isAbsolute(repository)) return { ok: false, error: 'The repository must be an absolute path.' };
  if (text.length > maxBytes || Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, error: `The discovery report is larger than ${maxBytes} bytes.` };
  let entries;
  try { entries = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return { ok: false, error: 'The discovery report is not valid JSON.' }; }
  if (format === 'playwright-list' || format === 'mocha-list') {
    const converted = runnerEntries(entries, format, maxEntries, maxBytes);
    if (converted.error) return { ok: false, error: converted.error };
    entries = converted.entries;
  }
  if (!Array.isArray(entries)) return { ok: false, error: 'The discovery report must be a JSON array.' };
  if (entries.length > maxEntries) return { ok: false, error: `The discovery report has more than ${maxEntries} entries.` };
  let outside = 0;
  const inside = (path) => (path === '.' || path === '..' || path.startsWith('../') || posix.isAbsolute(path) ? null : path);
  const fromRoot = (name) => inside(relative(repository, name).split(sep).join('/'));
  const place = (name) => {
    const resolved = () => { try { return name.length > maxPath ? name : real(name); } catch { return name; } };
    const path = isAbsolute(name) ? fromRoot(name) ?? fromRoot(resolved()) : inside(posix.normalize(posix.join(workingDirectory, name.replaceAll('\\', '/'))));
    if (path === null) outside++;
    return path;
  };
  const files = new Set(), cases = [];
  if (format === 'jest-list') {
    for (const [index, entry] of entries.entries()) {
      if (!isName(entry)) return { ok: false, error: `[${index}]: Must be a non-empty string, the path of a test file.` };
      const file = place(entry);
      if (file !== null) files.add(file);
    }
    return { ok: true, report: { format, files: [...files].sort(), cases: null, outside } };
  }
  let named = null;
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `[${index}]: Must be an object with a file.` };
    if (!isName(entry.file)) return { ok: false, error: `[${index}].file: Must be a non-empty string, the path of a test file.` };
    for (const key of ['name', 'projectName']) if (entry[key] !== undefined && typeof entry[key] !== 'string') return { ok: false, error: `[${index}].${key}: Must be a string.` };
    if (named !== null && named !== (entry.name !== undefined)) return { ok: false, error: `[${index}]: Either every entry or no entry has a name. Write the output of one vitest list command.` };
    named = entry.name !== undefined;
    const file = place(entry.file);
    if (file === null) continue;
    files.add(file);
    if (named) cases.push({ file, name: entry.name, ...(format === 'mocha-list' && entry.status === 'skipped' ? { status: 'skipped' } : {}) });
  }
  return { ok: true, report: { format, files: [...files].sort(), cases: named === false ? null : cases, outside } };
}
