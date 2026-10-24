// Shared untrusted-report boundary. Pure: paths are normalized, never opened or executed.
import { posix } from 'node:path';

export const pythonReportKinds = ['mypy-json', 'mypy-text', 'pyright-json', 'ruff-json'];
export const compilerKinds = ['tsc', ...pythonReportKinds];
export const toolOf = (kind = 'tsc') => kind.startsWith('mypy-') ? 'mypy' : kind.split('-')[0];
export const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
export const textValue = (value) => typeof value === 'string' && value.length > 0;
const control = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const slash = (value) => value.replaceAll('\\', '/');
const drive = /^[a-zA-Z]:\//;
const fold = (value) => drive.test(value) ? value[0].toLowerCase() + value.slice(1) : value;
class ReportError extends Error {}
export const requireValue = (condition, message) => { if (!condition) throw new ReportError(message); };

/** Refuse the entire artifact on one invalid diagnostic. Error text never repeats untrusted values. */
export function readPythonReport(text, options, read) {
  const { repository, workingDirectory = '.', maxBytes = 50 * 1024 * 1024, maxDiagnostics = 200000 } = options;
  try {
    requireValue(typeof text === 'string', 'The report must be text.');
    requireValue(text.length <= maxBytes && Buffer.byteLength(text, 'utf8') <= maxBytes, 'The report exceeds its byte limit.');
    requireValue(textValue(repository) && (posix.isAbsolute(slash(repository)) || drive.test(slash(repository))), 'The repository must be absolute.');
    requireValue(typeof workingDirectory === 'string' && !control.test(workingDirectory), 'Invalid working directory.');
    const root = fold(posix.normalize(slash(repository))).replace(/\/$/, '');
    const diagnostics = [];
    let entries = 0;
    const path = (value) => {
      requireValue(textValue(value) && !control.test(value), 'A diagnostic path is missing or contains a control character.');
      const name = fold(slash(value));
      const full = posix.normalize(posix.isAbsolute(name) || drive.test(name) ? name : `${root}/${slash(workingDirectory)}/${name}`);
      requireValue(full.startsWith(`${root}/`) && full.length > root.length + 1, 'A diagnostic path is outside the repository.');
      return full.slice(root.length + 1);
    };
    const count = () => { requireValue(++entries <= Math.min(maxDiagnostics, 200000), 'The report exceeds its diagnostic entry limit.'); };
    const add = (entry) => { diagnostics.push(entry); return entry; };
    const result = read(text.replace(/^\ufeff/, ''), { path, count, add, diagnostics });
    return { ok: true, report: { diagnostics, errors: diagnostics.filter((entry) => entry.category === 'error').length, outside: 0, summary: null, incomplete: false, ...result } };
  } catch (error) {
    if (error instanceof ReportError || error instanceof SyntaxError) return { ok: false, error: error instanceof SyntaxError ? 'The report is not valid JSON.' : error.message };
    throw error;
  }
}

export function diagnostic(file, line, column, category, code, message, tool) {
  requireValue(textValue(message), 'A diagnostic message must be nonempty text.');
  requireValue(code === null || textValue(code), 'A diagnostic code must be text or null.');
  return { file, line, column, category, severity: category, code, message: message.slice(0, 4096), tool };
}
export function appendNote(entry, message) {
  requireValue(textValue(message), 'A diagnostic note must be nonempty text.');
  entry.message = `${entry.message}\n${message}`.slice(0, 4096);
}
