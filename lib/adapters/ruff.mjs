// Ruff JSON CLI format: https://docs.astral.sh/ruff/settings/#output-format
// Checked against Ruff's actual output on a temporary, invented fixture file.
import { diagnostic, integer, readPythonReport, record, requireValue } from './python-diagnostics.mjs';

const location = (point) => record(point) && integer(point.row, 1) && integer(point.column, 1);
const range = (start, end) => location(start) && location(end) && (end.row > start.row || (end.row === start.row && end.column >= start.column));
export function parseRuff(text, options = {}) {
  return readPythonReport(text, options, (input, { path, count, add }) => {
    const entries = JSON.parse(input);
    requireValue(Array.isArray(entries), 'A ruff report must be a JSON array.');
    let incomplete = false;
    for (const item of entries) {
      count();
      requireValue(record(item) && range(item.location, item.end_location), 'Invalid ruff diagnostic location.');
      requireValue(item.fix === null || (record(item.fix) && (item.fix.message === null || typeof item.fix.message === 'string') && ['safe', 'unsafe', 'displayonly'].includes(item.fix.applicability)
        && Array.isArray(item.fix.edits) && item.fix.edits.length > 0 && item.fix.edits.every((edit) => record(edit) && typeof edit.content === 'string' && range(edit.location, edit.end_location))), 'Invalid ruff fix.');
      add({ ...diagnostic(path(item.filename), item.location.row, item.location.column, item.code === null ? 'error' : 'warning', item.code, item.message, 'ruff'), fixable: item.fix !== null });
      incomplete ||= item.code === null || item.code === 'invalid-syntax';
    }
    return { incomplete };
  });
}
