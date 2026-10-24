// Compiler evidence for the check "Types are compatible" of static-baseline-v0. The bound TypeScript compiler reports (kind tsc)
// come in context.compiler = { head, base }, apart from the test reports. The check fails for an error of a head report in a changed
// file or in a file that imports one, and it names the errors that a bound base report also has as earlier errors. It passes only
// when an unfiltered head report has no such error and no error that can stop the type check. Pure: it reads only the context of the rule set.
import { pythonTypeCases } from './python-compiler-evidence.mjs';
import { codeExtensions } from '../project.mjs';

const maxNamed = 3;
// tsc reports type errors only when the program has no syntax error and no error in its settings or its file list (emitFilesAndReportErrors).
// Such an error in another file can thus hide the type errors of a changed file. Code-map finds such an error by its file or its code.
// The file is not JavaScript or TypeScript, for example tsconfig.json. Or the code is a syntax code (TS1000 to TS1999, TS8000 to TS8019,
// TS17000 to TS17999), or a code of settings and files (TS5000 to TS6999) that is not the code of an unused declaration.
const unusedCodes = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);
const within = (code, low, high) => code >= low && code <= high;
const canStop = (item) => !codeExtensions.some((extension) => item.file.endsWith(extension)) || within(item.code, 1000, 1999) || within(item.code, 8000, 8019)
  || within(item.code, 17000, 17999) || (within(item.code, 5000, 6999) && !unusedCodes.has(item.code));
// The same word helpers as in static-baseline-v0.mjs.
const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const named = (list, name = (value) => value) => list.slice(0, maxNamed).map(name).join(', ') + (list.length > maxNamed ? `, and ${list.length - maxNamed} more` : '');
const reportIds = (reports) => reports.map((report) => `report:${report.artifact}`);
/** A diagnostic in words: its place, its code and the first line of its message, cut at 100 characters and without its final period. */
const where = (item) => `${item.file === null ? '' : `${item.file}(${item.line},${item.column}) `}TS${item.code}: ${item.message.split('\n')[0].slice(0, 100).replace(/\.$/, '')}`;
/** One error in the base and in the head has the same file (after a rename), code and message. The line can differ. */
const keyOf = (item, file = item.file) => JSON.stringify([file, item.code, item.message]);
const noReport = 'Run the TypeScript compiler on the head, for example npx tsc --noEmit --pretty false > reports/tsc.txt. Write its run manifest with code-map manifest --kind tsc, '
  + "and add both files to reportInputs in the request. Refer to docs/verify.md, section 'Bound compiler reports'.";

/** The files that import a changed file: from the head analysis, and from the base analysis for a changed path that the head does not have. */
function changedImporters(head, base, changed, rename) {
  const of = (analysis, targets) => analysis.files.flatMap((file) => [...(file.imports.some((edge) => targets.has(edge.target)) ? [file.path] : []),
    ...(targets.has(file.path) ? file.tests?.direct ?? [] : [])]);
  const present = new Set(head.analysis.files.map((file) => file.path)), gone = new Set([...changed].filter((path) => !present.has(path)));
  return new Set([...of(head.analysis, changed), ...of(base.analysis, gone).map(rename)]);
}

/**
 * The type check from the facts `f` of static-baseline-v0: `applies` is true when a bound head report exists, and `cases` are the
 * [fails, unknowns, pass] arguments of `decide` in that profile.
 */
function typescriptCases(f) {
  const heads = (f.context.compiler?.head ?? []).filter((report) => !report.kind || report.kind === 'tsc'), bases = (f.context.compiler?.base ?? []).filter((report) => !report.kind || report.kind === 'tsc');
  const relevant = new Set([...f.changed, ...changedImporters(f.head, f.base, f.changed, f.rename)]);
  const errors = heads.flatMap((report) => report.diagnostics.filter((item) => item.category === 'error').map((item) => ({ ...item, artifact: report.artifact })));
  const located = errors.filter((item) => item.file !== null), hits = located.filter((item) => relevant.has(item.file)), other = located.length - hits.length;
  const before = new Set(bases.flatMap((report) => report.diagnostics.filter((item) => item.category === 'error' && item.file !== null).map((item) => keyOf(item, f.rename(item.file)))));
  const earlier = hits.filter((item) => before.has(keyOf(item))), global = errors.filter((item) => item.file === null);
  const stopping = located.filter((item) => !relevant.has(item.file) && canStop(item)), reportsOf = (list) => reportIds(heads.filter((report) => list.some((item) => item.artifact === report.artifact)));
  const silent = heads.filter((report) => report.exitStatus !== 0 && report.errors === 0), outside = heads.reduce((sum, report) => sum + (report.outside ?? 0), 0);
  const subject = `The bound compiler ${heads.length === 1 ? 'report of the head has' : 'reports of the head have'}`, files = [...new Set(hits.map((item) => item.file))];
  const fails = [[hits.length > 0, `${subject} ${plural(hits.length, 'error')} in changed files or in files that import one: ${named(hits, where)}.`
    + (earlier.length ? ` ${plural(earlier.length, 'of these errors is', 'of these errors are')} also in a bound base report, so ${earlier.length === 1 ? 'it is an earlier error' : 'they are earlier errors'}: ${named(earlier, where)}.` : ''),
  hits.map((item) => `diagnostic:${item.artifact}:${item.file}:${item.line}:${item.column}:TS${item.code}`),
  `Correct the type errors in ${named(files)}. Then run the compiler on the head again, write a new run manifest, and run code-map verify again.`]];
  const unknowns = [
    [heads.length === 0, 'No bound TypeScript compiler report of the head exists, so the types of the change are not checked. A bound compiler report of the head would close this check.', f.analyses, noReport],
    [global.length > 0, `${subject} ${plural(global.length, 'error')} without a file, for example an invalid compiler option. Such an error can stop the compiler before it checks the files: ${named(global, where)}.`,
      reportsOf(global), 'Correct the compiler settings or the command, and run the compiler on the head again.'],
    [stopping.length > 0, `${subject} ${plural(stopping.length, 'syntax or settings error')} in other files: ${named(stopping, where)}. The compiler reports type errors only when the program `
      + 'has no syntax error and no settings error. Thus, it can have skipped the type check of the changed files.', reportsOf(stopping),
      'Correct these errors. Then run the compiler on the head again, write a new run manifest, and run code-map verify again.'],
    [silent.length > 0, `${plural(silent.length, 'compiler run')} did not end with exit status 0, but ${silent.length === 1 ? 'its report has' : 'their reports have'} no error: ${named(silent, (report) => `${report.artifact} (exit status ${report.exitStatus ?? 'not recorded'})`)}.`,
      reportIds(silent), 'Read the output of the compiler run: the compiler can stop before it reports an error, for example when it cannot read its settings.'],
    [!heads.some((report) => !report.filtered), 'Each bound compiler report of the head comes from a run with a filter, so the run can have left out a changed file.', reportIds(heads),
      'Run the compiler on the whole project of the head without a filter, and add the bound report to reportInputs in the request.']];
  const pass = [`${subject} no error in a changed file or in a file that imports one.${other ? ` ${plural(other, 'error')} ${other === 1 ? 'is' : 'are'} in other files.` : ''}`
    + (outside ? ` Code-map ignored ${plural(outside, 'diagnostic')} outside the repository.` : ''), reportIds(heads)];
  return { applies: heads.length > 0, cases: [fails, unknowns, pass] };
}

/** Combine the two language families in one existing obligation. Lint reports never enter these cases. */
export function typeCases(f) {
  const ts = typescriptCases(f), relevant = new Set([...f.changed, ...changedImporters(f.head, f.base, f.changed, f.rename)]);
  const py = pythonTypeCases(f, relevant);
  const needsPython = [...relevant].some((file) => /\.pyi?$/.test(file));
  const selected = [...(f.context.typescript === true || ts.applies ? [ts] : []), ...(needsPython || py.applies ? [py] : [])];
  if (selected.length === 0) return { applies: false, cases: ts.cases };
  if (selected.length === 1) return selected[0];
  const combined = (index) => {
    const active = selected.flatMap((part) => part.cases[index]).filter((entry) => entry[0]);
    return [[active.length > 0, active.map((entry) => entry[1]).join(' '), active.flatMap((entry) => entry[2]), active.map((entry) => entry[3]).join(' ')]];
  };
  return { applies: ts.applies || py.applies, cases: [combined(0), combined(1),
    [selected.map((part) => part.cases[2][0]).join(' '), selected.flatMap((part) => part.cases[2][1])]] };
}
