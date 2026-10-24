// Published CLI schema: https://github.com/microsoft/pyright/blob/main/docs/command-line.md#json-output
import { diagnostic, integer, readPythonReport, record, requireValue } from './python-diagnostics.mjs';

export function parsePyright(text, options = {}) {
  return readPythonReport(text, options, (input, { path, count, add, diagnostics }) => {
    const report = JSON.parse(input);
    requireValue(record(report) && Array.isArray(report.generalDiagnostics) && record(report.summary), 'Invalid pyright report.');
    for (const item of report.generalDiagnostics) {
      count();
      requireValue(record(item) && ['error', 'warning', 'information'].includes(item.severity), 'Invalid pyright diagnostic severity.');
      const start = item.range?.start, end = item.range?.end;
      requireValue(item.range === undefined || (record(start) && record(end) && [start.line, start.character, end.line, end.character].every((value) => integer(value) && value < Number.MAX_SAFE_INTEGER)
        && (end.line > start.line || (end.line === start.line && end.character >= start.character))), 'Invalid pyright source range.');
      add(diagnostic(path(item.file), start ? start.line + 1 : null, start ? start.character + 1 : null, item.severity, item.rule === undefined ? null : item.rule, item.message, 'pyright'));
    }
    for (const [field, severity] of [['errorCount', 'error'], ['warningCount', 'warning'], ['informationCount', 'information']]) {
      requireValue(integer(report.summary[field]) && report.summary[field] === diagnostics.filter((entry) => entry.category === severity).length, 'The pyright summary does not agree with its diagnostics.');
    }
    return { summary: report.summary.errorCount };
  });
}
