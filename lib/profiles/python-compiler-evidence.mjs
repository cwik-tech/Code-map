// Bound Python type reports feed the existing type obligation. Ruff is deliberately excluded.
import { interruptedCompilerReport, normalizedMessage } from '../compiler-lifecycle.mjs';
import { toolOf } from '../adapters/python-diagnostics.mjs';

export const pythonTypeKinds = ['mypy-json', 'mypy-text', 'pyright-json'];
const key = (item, tool, file = item.file) => JSON.stringify([tool, file, item.code, normalizedMessage(item.message, tool)]);
const show = (item) => `${item.file}(${item.line},${item.column ?? '?'}) ${item.tool} ${item.code ?? 'fatal'}: ${item.message.split('\n')[0].slice(0, 100)}`;
const ids = (reports) => reports.map((report) => `report:${report.artifact}`);
export const completePythonTypeReport = (report) => !report.filtered && !interruptedCompilerReport(report);

export function pythonTypeCases(f, relevant) {
  const heads = (f.context.compiler?.head ?? []).filter((report) => pythonTypeKinds.includes(report.kind));
  const bases = (f.context.compiler?.base ?? []).filter((report) => pythonTypeKinds.includes(report.kind));
  const refused = (f.context.compiler?.refused ?? []).filter((report) => report.side === 'head');
  const before = new Set(bases.filter(completePythonTypeReport).flatMap((report) => report.diagnostics.filter((item) => item.category === 'error')
    .map((item) => key(item, toolOf(report.kind), f.rename(item.file)))));
  const hits = heads.filter(completePythonTypeReport).flatMap((report) => report.diagnostics.filter((item) => item.category === 'error' && relevant.has(item.file) && /\.pyi?$/.test(item.file))
    .map((item) => ({ ...item, tool: toolOf(report.kind), artifact: report.artifact })));
  const earlier = hits.filter((item) => before.has(key(item, item.tool)));
  const names = hits.slice(0, 3).map(show).join(', ');
  const missing = 'No bound Python type report of the head exists. A bound mypy-json, mypy-text or pyright-json report would close this check.';
  const action = 'Run the project type checker without filters. Bind its report with code-map manifest --kind mypy-json, mypy-text or pyright-json, and add the report and manifest to reportInputs.';
  return { applies: heads.length > 0 || bases.length > 0 || (f.context.compiler?.refused?.length ?? 0) > 0, cases: [
    [[hits.length > 0, `The bound Python type reports have ${hits.length} error(s) in changed files or in files that import one: ${names}.`
      + (earlier.length ? ` ${earlier.length} earlier error(s) also occur in a bound base report.` : ''),
    hits.map((item) => `diagnostic:${item.artifact}:${item.file}:${item.line}:${item.column}:${item.tool}:${item.code}`), 'Correct the Python type errors and bind a new head report.']],
    [[refused.length > 0, 'A bound Python type report was refused. Read its execution reasons. A complete report would close this check.', ids(refused), action],
      [heads.length === 0, missing, f.analyses, action],
      [heads.length > 0 && !heads.some(completePythonTypeReport), 'The Python type reports are filtered or interrupted. The type check is UNKNOWN.', ids(heads), action],
      [heads.some(interruptedCompilerReport), 'A Python type run is incomplete. Its diagnostics cannot establish compatible types.', ids(heads), action]],
    ['The bound Python type reports have no error in a changed Python file or in a file that imports one.', ids(heads)],
  ] };
}
