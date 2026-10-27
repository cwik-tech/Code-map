// Reads the text output of the TypeScript compiler, `tsc --noEmit --pretty false` or `tsc -b --pretty false`, into diagnostics.
// A diagnostic line is "path(line,column): error TS1234: message", and an indented line continues the message. A diagnostic
// without a position ("error TS5058: ...") has no file. A summary line "Found N errors" must agree with the error count.
// The report is untrusted: a line of another form or a path with a control character makes the whole report unreadable.
// A compiler report lists errors, not the files that the compiler checked. Pure: no file access, no clock and no execution.
import { posix } from 'node:path';

/** Declared producers. The parser checks the line format, not the compiler version. */
export const supportedProducers = [{ name: 'TypeScript compiler (tsc and tsc -b)', versions: 'the --pretty false text output of TypeScript 4 and later' }];
const located = /^(\S.*?)\((\d+),(\d+)\): (error|warning|suggestion|message) TS(\d+): (.*)$/;
const unlocated = /^(error|warning|suggestion|message) TS(\d+): (.*)$/;
const summaryLine = /^Found (\d+) errors?(?:\.| in .+)?$/;
// C0 and C1 control characters and the bidirectional controls, which can make a path look like another path.
const control = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const maxMessage = 4096;
const drive = /^[A-Za-z]:\//;
const slashed = (path) => path.replaceAll('\\', '/');
/** A Windows drive letter in lower case, so that "C:/repo" and "c:/repo" are one folder. */
const folded = (path) => (drive.test(path) ? path[0].toLowerCase() + path.slice(1) : path);
const positive = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 1;

class TscError extends Error {}
const fail = (message) => { throw new TscError(message); };

/**
 * Returns `{ ok: true, report }` or `{ ok: false, error }`. Untrusted input never throws. `repository` is the absolute path of the
 * repository, and `workingDirectory` the repository-relative working folder of the run, from its run manifest. The report has
 * `diagnostics` ({ file, line, column, category, code, message }, without those outside the repository), `errors` (every error
 * diagnostic, also outside the repository and without a file), `outside` (the diagnostics outside the repository) and `summary`
 * (the error count of the summary lines, or null).
 */
export function parseTsc(text, { repository, workingDirectory = '.', maxBytes = 50 * 1024 * 1024, maxDiagnostics = 200000 } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'The compiler report must be text.' };
  if (typeof repository !== 'string' || !(posix.isAbsolute(slashed(repository)) || drive.test(slashed(repository)))) return { ok: false, error: 'The repository must be an absolute path.' };
  if (text.length > maxBytes || Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, error: `The compiler report is larger than ${maxBytes} bytes.` };
  try {
    return { ok: true, report: read(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, folded(posix.normalize(slashed(repository))).replace(/\/$/, ''), workingDirectory, maxDiagnostics) };
  } catch (error) {
    if (error instanceof TscError) return { ok: false, error: error.message };
    throw error;
  }
}

function read(text, root, workingDirectory, maxDiagnostics) {
  const diagnostics = [];
  let errors = 0, outside = 0, summary = null, last = null, count = 0;
  text.split('\n').forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw, number = index + 1;
    if (line.trim() === '') { last = null; return; }
    if (/^[ \t]/.test(line)) {
      if (!last) fail(`Line ${number} is indented, but no diagnostic comes before it. Write the output of tsc --pretty false without other text.`);
      if (last.message.length < maxMessage) last.message = `${last.message}\n${line.trim()}`.slice(0, maxMessage);
      return;
    }
    const found = summaryLine.exec(line);
    if (found) { summary = (summary ?? 0) + Number(found[1]); last = null; return; }
    const match = located.exec(line), bare = match ? null : unlocated.exec(line);
    if (!match && !bare) fail(`Line ${number} is not a compiler diagnostic, an indented continuation line or a summary line. Write the output of tsc --pretty false without other text.`);
    if (++count > maxDiagnostics) fail(`The compiler report has more than ${maxDiagnostics} diagnostics.`);
    const [category, code, message] = match ? match.slice(4) : bare.slice(1);
    if (!positive(code)) fail(`Line ${number} gives a diagnostic code (TS1234) that is not a whole number from 1.`);
    if (category === 'error') errors++;
    const entry = { file: null, line: null, column: null, category, code: Number(code), message: message.slice(0, maxMessage) };
    if (match) {
      const [path, row, column] = match.slice(1, 4);
      if (control.test(path)) fail(`The path in line ${number} has a control character. Code-map does not read such a path.`);
      if (!positive(row) || !positive(column)) fail(`Line ${number} gives a line or a column that is not a whole number from 1.`);
      Object.assign(entry, { file: placeOf(path, root, workingDirectory), line: Number(row), column: Number(column) });
      // A diagnostic outside the repository counts, but Code-map does not list it and continues no message of it.
      if (entry.file === null) { outside++; last = { message: '' }; return; }
    }
    diagnostics.push(entry);
    last = entry;
  });
  if (summary !== null && summary !== errors) {
    fail(`The summary line says ${summary} errors, but the report has ${errors} error ${errors === 1 ? 'diagnostic' : 'diagnostics'}. The report is not complete or not from one run.`);
  }
  return { diagnostics, errors, outside, summary };
}

/** The repository-relative path of a diagnostic path, or null when it is outside the repository. A relative path starts at the working folder. */
function placeOf(name, root, workingDirectory) {
  const path = folded(slashed(name)), absolute = posix.isAbsolute(path) || drive.test(path);
  if (absolute) {
    const normal = posix.normalize(path);
    return normal.startsWith(`${root}/`) && normal.length > root.length + 1 ? normal.slice(root.length + 1) : null;
  }
  const inside = posix.normalize(posix.join(workingDirectory, path));
  return inside === '.' || inside === '..' || inside.startsWith('../') ? null : inside;
}
