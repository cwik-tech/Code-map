// mypy 1.11+ JSON lines: https://github.com/python/mypy/blob/v1.11.0/mypy/error_formatter.py
// Text and zero-based JSON columns: https://github.com/python/mypy/blob/v1.11.0/mypy/errors.py
import { appendNote, diagnostic, integer, readPythonReport, record, requireValue } from './python-diagnostics.mjs';

/** Text uses --show-column-numbers --show-error-codes --no-pretty. JSON columns are zero-based, -1 means unknown. */
export function parseMypy(text, options = {}) {
  return readPythonReport(text, options, (input, context) => {
    const { path, count, add, diagnostics } = context;
    let last = null, summary = null, incomplete = false, ended = false;
    for (const raw of input.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      requireValue(!ended, 'A mypy diagnostic follows its summary.');
      if (options.format === 'text') {
        const found = /^Found (\d+) errors? in \d+ files?(?: \(checked \d+ source files?\))?(.*)$/.exec(raw);
        const success = /^Success: no issues found in \d+ source files?$/.test(raw);
        if (found || success) {
          summary = found ? Number(found[1]) : 0;
          requireValue(!found || !found[2] || /^ \(errors prevented further checking\)$/.test(found[2]), 'Invalid mypy summary.');
          incomplete ||= Boolean(found?.[2]); ended = true; continue;
        }
        if (/^[ \t]/.test(raw)) {
          count(); requireValue(last !== null, 'A mypy continuation has no diagnostic.'); appendNote(last, raw.trim()); continue;
        }
      }
      count();
      let item;
      if (options.format === 'text') {
        const match = /^(.*?):(\d+)(?::(\d+))?: (error|note): (.*?)(?:  \[([\w-]+)\])?$/.exec(raw);
        requireValue(match !== null, 'A line is not a mypy text diagnostic.');
        requireValue(match[3] === undefined || integer(Number(match[3]), 1), 'Invalid mypy text column.');
        item = { file: match[1], line: Number(match[2]), column: match[3] === undefined ? -1 : Number(match[3]) - 1, severity: match[4], message: match[5], code: match[6] ?? null, hint: null };
      } else item = JSON.parse(raw);
      requireValue(record(item) && ['error', 'note'].includes(item.severity), 'Invalid mypy diagnostic severity.');
      const file = path(item.file);
      requireValue(integer(item.line, 1) && integer(item.column, -1) && item.column < Number.MAX_SAFE_INTEGER, 'Invalid mypy source coordinates.');
      requireValue(item.hint === undefined || item.hint === null || typeof item.hint === 'string', 'Invalid mypy hint.');
      const entry = diagnostic(file, item.line, item.column === -1 ? null : item.column + 1, item.severity === 'note' ? 'information' : 'error', item.code, item.message, 'mypy');
      if (item.hint) appendNote(entry, item.hint);
      if (item.severity === 'note' && last?.category === 'error' && last.file === file) appendNote(last, entry.message);
      else { add(entry); last = entry; }
      incomplete ||= item.severity === 'error' && (item.code === null || item.code === 'syntax' || /INTERNAL ERROR/.test(item.message));
    }
    const errors = diagnostics.filter((entry) => entry.category === 'error').length;
    requireValue(summary === null || summary === errors, 'The mypy summary does not agree with the error count.');
    return { summary, incomplete };
  });
}
